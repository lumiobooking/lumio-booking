/**
 * WALK-IN 2.0, STEP 2 — the desk's optional rules. Pure.
 *
 * Every rule here is OFF unless the salon owner turns it on, so a salon that
 * does nothing keeps exactly today's floor. They live in one setting
 * (`desk_policy`), next to — never inside — the turn rules (turn_rules), which
 * these never change:
 *
 *   requireService   a visit with no service cannot be finished / sent to the
 *                    till (the "Chưa chọn dịch vụ" pile at the till).
 *   overrideReason   the desk may seat a customer with someone other than the
 *                    technician the rules suggest, but says why; suggestion,
 *                    choice and reason are kept for the end-of-day review.
 *   protectBooking   the dispatcher does not hand a walk-in to a technician
 *                    whose next booking starts before that walk-in would end
 *                    (plus a buffer) — the booked client is not kept waiting.
 *   waitTargetMin    a waiting card turns amber after this many minutes.
 *   payNudge         a visit waiting to pay longer than payNudgeMin pings the
 *                    desk's phones, once per visit.
 */
import { lastActivity } from './unpaid-sweep';
import { canRunTogether, legsOf, needFor, pickTech, type DispatchOptions, type TechInfo, type TicketLike } from './walkin-legs';

export const DESK_POLICY_KEY = 'desk_policy';
export const PAY_WARNED_KEY = 'walkin_pay_warned';

export interface DeskPolicy {
  requireService: boolean;
  overrideReason: boolean;
  protectBooking: boolean;
  bookingBufferMin: number;
  waitTargetMin: number;
  payNudge: boolean;
  payNudgeMin: number;
  /** Step 3: text "your turn is coming" when this many people or fewer are ahead (0 = off). */
  notifyAhead: number;
  /** Step 3: a called customer who has not been seated after this many minutes is a no-show (0 = off). */
  noShowMin: number;
}

export const DEFAULT_DESK_POLICY: DeskPolicy = {
  requireService: false,
  overrideReason: false,
  protectBooking: false,
  bookingBufferMin: 10,
  waitTargetMin: 10,
  payNudge: false,
  payNudgeMin: 10,
  notifyAhead: 0,
  noShowMin: 0,
};

const int = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

/** Anything stored or sent → a valid policy; unknown keys dropped, numbers clamped. */
export function cleanDeskPolicy(v: unknown): DeskPolicy {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const d = DEFAULT_DESK_POLICY;
  return {
    requireService: o.requireService === true,
    overrideReason: o.overrideReason === true,
    protectBooking: o.protectBooking === true,
    bookingBufferMin: int(o.bookingBufferMin, 0, 60, d.bookingBufferMin),
    waitTargetMin: int(o.waitTargetMin, 3, 120, d.waitTargetMin),
    payNudge: o.payNudge === true,
    payNudgeMin: int(o.payNudgeMin, 3, 240, d.payNudgeMin),
    notifyAhead: int(o.notifyAhead, 0, 5, d.notifyAhead),
    noShowMin: int(o.noShowMin, 0, 60, d.noShowMin),
  };
}

/** Why the desk picked someone else than the suggestion. */
export const OVERRIDE_REASONS = ['customer_request', 'specialist', 'tech_yielded', 'other'] as const;
export type OverrideReason = (typeof OVERRIDE_REASONS)[number];
export function cleanOverrideReason(v: unknown): OverrideReason | null {
  return (OVERRIDE_REASONS as readonly string[]).includes(String(v)) ? (v as OverrideReason) : null;
}

/** Does the visit carry at least one service line? */
export function hasService(items: unknown): boolean {
  return Array.isArray(items) && items.some((it) => it && typeof it === 'object' && Boolean((it as { serviceId?: unknown }).serviceId));
}

/** The error a blocked "Xong" returns — a code the screens recognise, and a sentence for a person. */
export const NO_SERVICE_ERROR = 'NO_SERVICE: Chọn dịch vụ đã làm trước khi bấm Xong · Pick the service done before finishing.';
export const OVERRIDE_REASON_ERROR = 'OVERRIDE_REASON: Chọn lý do khi giao cho thợ khác thợ được gợi ý · Pick a reason for choosing another technician.';

/**
 * Can this technician take a visit of `minutes` now and still be free for her
 * next booking (with `bufferMin` to spare)? No booking → yes.
 */
export function fitsBeforeBooking(nowMs: number, minutes: number, bookingAtMs: number | undefined | null, bufferMin: number): boolean {
  if (bookingAtMs == null || !Number.isFinite(bookingAtMs)) return true;
  const len = minutes > 0 ? minutes : 30;
  return nowMs + (len + Math.max(0, bufferMin)) * 60000 <= bookingAtMs;
}

export type NamedTicket = TicketLike & { customerName?: string | null };
export interface UnpaidLong { id: string; name: string; minutes: number }

/** Visits waiting to pay for `minutes` or more since their last activity, not pinged before. */
export function newlyUnpaidTooLong(tickets: NamedTicket[], now: Date, minutes: number, warned: string[]): UnpaidLong[] {
  const seen = new Set(warned);
  const out: UnpaidLong[] = [];
  for (const t of tickets) {
    if (seen.has(t.id) || !t.awaitingPayment) continue;
    const m = Math.floor((now.getTime() - lastActivity(t).getTime()) / 60000);
    if (m >= minutes) out.push({ id: t.id, name: (t.customerName || '').trim() || 'Walk-in', minutes: m });
  }
  return out.sort((a, b) => b.minutes - a.minutes);
}

export function payNudgeAlert(list: UnpaidLong[]): { title: string; body: string; url: string; tag: string } | null {
  if (!list.length) return null;
  return {
    title: `💳 Chờ tính tiền quá lâu · Waiting to pay (${list.length})`,
    body: list.slice(0, 3).map((x) => `${x.name} ${x.minutes}′`).join(' · ') + (list.length > 3 ? ` +${list.length - 3}` : ''),
    url: '/salon/walkins',
    tag: 'walkin-pay',
  };
}

/**
 * The technician the salon's own rules would give this waiting customer now:
 * her named technician if she asked for one, else the fairest free one who
 * does the services (and, with protectBooking, is free before her next
 * booking). Null when nobody free fits — the customer waits.
 */
export function suggestFor(t: TicketLike, free: TechInfo[], team: TechInfo[], turns: Map<string, number>, opts: DispatchOptions = {}): string | null {
  const legs = legsOf(t);
  const running = legs.filter((l) => l.status === 'SERVING').map((l) => l.zone);
  const leg = legs.find((l) => l.status === 'WAITING' && running.every((z) => canRunTogether(z, l.zone)));
  if (!leg) return null;
  if (leg.pinned && leg.staffId) return leg.staffId;
  const nowMs = opts.now ?? Date.now();
  const able = free.filter((f) => !leg.skippedBy.includes(f.id)
    && fitsBeforeBooking(nowMs, leg.minutes, opts.bookingAt?.get(f.id), opts.bookingBufferMin ?? 0));
  return pickTech(able, needFor(leg, team, opts), turns, opts)?.id ?? null;
}

// ---------------------------------------------------------------- step 3: calling customers

export const CALLED_KEY = 'walkin_called';
export const NOTIFIED_KEY = 'walkin_notified';

/** The queue in order; who should get "your turn is coming" now (people ahead ≤ N), each once, phone required. */
export function upcomingToNotify(queue: { id: string; phone: string | null }[], notifyAhead: number, notified: string[]): string[] {
  if (!(notifyAhead > 0)) return [];
  const seen = new Set(notified);
  return queue.filter((q, i) => i <= notifyAhead && q.phone && !seen.has(q.id)).map((q) => q.id);
}

/** Called customers still waiting after `minutes` — no-shows (rule off when minutes is 0). */
export function calledTooLong(called: Record<string, { at: string }>, waitingIds: string[], now: Date, minutes: number): string[] {
  if (!(minutes > 0)) return [];
  return waitingIds.filter((id) => {
    const at = Date.parse(called[id]?.at ?? '');
    return Number.isFinite(at) && now.getTime() - at >= minutes * 60000;
  });
}

/** Keep only entries for tickets still waiting (the setting never grows without end). */
export function pruneCalled(called: unknown, waitingIds: string[]): Record<string, { at: string; by?: string | null }> {
  const src = (called && typeof called === 'object' ? called : {}) as Record<string, { at?: unknown; by?: unknown }>;
  const out: Record<string, { at: string; by?: string | null }> = {};
  for (const id of waitingIds) {
    const v = src[id];
    if (v && typeof v.at === 'string') out[id] = { at: v.at, by: typeof v.by === 'string' ? v.by : null };
  }
  return out;
}

/** The texts — short, the salon's name first, in the salon's language. */
export function turnSoonSms(salon: string, vi: boolean): string {
  return vi ? `${salon}: Sắp tới lượt bạn. Vui lòng quay lại quầy trong ít phút nữa.` : `${salon}: You're almost up! Please head back to the front desk in a few minutes.`;
}
export function yourTurnSms(salon: string, vi: boolean): string {
  return vi ? `${salon}: Tới lượt bạn rồi! Mời bạn vào quầy.` : `${salon}: It's your turn! Please come to the front desk.`;
}
