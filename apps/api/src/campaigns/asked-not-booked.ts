/**
 * "HỎI NHƯNG CHƯA ĐẶT" — people who asked and never booked.
 *
 * Someone writes on Messenger/Instagram/web chat/Zalo, or rings the AI
 * hotline, asks about a set or a price, and never books. Those are the
 * warmest leads a salon has, and until now nobody saw them again once the
 * conversation scrolled away.
 *
 * Two ways to reach them, and the rules that keep both honest:
 *  - The LIST (everyone): every recent asker with no booking since, with what
 *    they asked, how to reach them, and whether the chat window is still open
 *    (Meta allows a normal reply for 24h after the customer's last message —
 *    after that a chat cannot be written to, so the list says "call" or
 *    "message on their channel" instead of pretending).
 *  - The AUTOMATIC message: only to a KNOWN customer (a salon customer record
 *    with an email, or SMS consent) — never to a stranger's page-scoped id,
 *    never a text without consent. Runs inside the existing campaigns engine
 *    (opt-in per salon, one send per person per 30 days).
 *
 * Pure: the service feeds rows in, this decides.
 */

export interface AskThread {
  id: string; name: string | null; channel: string; lastText: string | null;
  lastCustomerAt: Date | null; status: string; customerId: string | null;
  customer?: { firstName: string; phone: string | null; email: string | null } | null;
}
export interface AskCall {
  id: string; fromNumber: string | null; outcome: string; createdAt: Date; lastText: string | null;
}
export interface BookingLike { customerId: string; createdAt: Date; startTime: Date; phone: string | null }

export interface AskRow {
  key: string; // 'chat:<id>' | 'call:<id>'
  kind: 'chat' | 'call';
  refId: string;
  name: string | null;
  channel: string;
  asked: string | null;
  at: string;
  phone: string | null;
  email: string | null;
  customerId: string | null;
  /** The chat can still be answered (inside Meta's 24h window, with a margin). */
  canMessage: boolean;
}

const HOUR = 3_600_000;
export const CALL_ASK_OUTCOMES = ['info', 'no_action', 'voicemail', 'handoff', 'forwarded'];

/** Phone numbers compared on their last 10 digits (+1 or not, spaces or not). */
export function phoneKey(p: string | null | undefined): string {
  const d = String(p ?? '').replace(/\D+/g, '');
  return d.length >= 7 ? d.slice(-10) : '';
}

/** What a caller asked, from the call transcript: their longest line, trimmed. */
export function askedFromTranscript(transcript: unknown): string | null {
  const turns = Array.isArray(transcript) ? (transcript as { role?: string; content?: unknown }[]) : [];
  const said = turns.filter((t) => t?.role === 'user' && typeof t.content === 'string').map((t) => String(t.content).trim()).filter(Boolean);
  if (!said.length) return null;
  const best = said.reduce((a, b) => (b.length > a.length ? b : a));
  return best.length > 200 ? `${best.slice(0, 197)}…` : best;
}

/**
 * Who asked within the last `days` and has not booked since.
 * A booking "since" = any booking made from 3 days before they asked onward,
 * or any visit still to come — either way they are not a lost lead.
 */
export function askedNotBooked(o: {
  threads: AskThread[]; calls: AskCall[]; bookings: BookingLike[];
  handled: Record<string, string>; now: Date; days: number;
}): AskRow[] {
  const since = o.now.getTime() - o.days * 24 * HOUR;
  const byCustomer = new Map<string, BookingLike[]>();
  const byPhone = new Map<string, BookingLike[]>();
  for (const b of o.bookings) {
    byCustomer.set(b.customerId, [...(byCustomer.get(b.customerId) ?? []), b]);
    const k = phoneKey(b.phone);
    if (k) byPhone.set(k, [...(byPhone.get(k) ?? []), b]);
  }
  const bookedAfter = (list: BookingLike[] | undefined, at: Date) =>
    (list ?? []).some((b) => b.createdAt.getTime() >= at.getTime() - 3 * 24 * HOUR || b.startTime.getTime() >= o.now.getTime());

  const rows: AskRow[] = [];
  for (const t of o.threads) {
    const at = t.lastCustomerAt;
    if (!at || at.getTime() < since || t.status === 'done') continue;
    const key = `chat:${t.id}`;
    if (o.handled[key] && new Date(o.handled[key]).getTime() >= at.getTime()) continue; // handled after their last message
    if (t.customerId && bookedAfter(byCustomer.get(t.customerId), at)) continue;
    const phone = t.customer?.phone ?? null;
    if (phone && bookedAfter(byPhone.get(phoneKey(phone)), at)) continue;
    rows.push({
      key, kind: 'chat', refId: t.id,
      name: t.customer?.firstName || t.name || null,
      channel: t.channel || 'messenger',
      asked: t.lastText ?? null,
      at: at.toISOString(),
      phone, email: t.customer?.email ?? null, customerId: t.customerId,
      canMessage: o.now.getTime() - at.getTime() < 23 * HOUR,
    });
  }
  // One row per caller: their latest call.
  const latestCall = new Map<string, AskCall>();
  for (const c of o.calls) {
    const k = phoneKey(c.fromNumber);
    if (!k || c.createdAt.getTime() < since || !CALL_ASK_OUTCOMES.includes(c.outcome)) continue;
    const cur = latestCall.get(k);
    if (!cur || c.createdAt > cur.createdAt) latestCall.set(k, c);
  }
  for (const [k, c] of latestCall) {
    const key = `call:${c.id}`;
    if (o.handled[key]) continue;
    if (bookedAfter(byPhone.get(k), c.createdAt)) continue;
    rows.push({
      key, kind: 'call', refId: c.id, name: null, channel: 'hotline', asked: c.lastText,
      at: c.createdAt.toISOString(), phone: c.fromNumber, email: null, customerId: null, canMessage: false,
    });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

/** The automatic message's audience: asked exactly `daysAfter` days ago (a 1-day band, so each fires once). */
export function dueForMessage(rows: AskRow[], now: Date, daysAfter: number): AskRow[] {
  const upper = now.getTime() - daysAfter * 24 * HOUR;
  const lower = upper - 24 * HOUR;
  return rows.filter((r) => {
    const t = new Date(r.at).getTime();
    return t >= lower && t < upper;
  });
}
