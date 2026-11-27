/**
 * rt245 — lead report by day / week / month, per staff member and for the
 * whole salon (27/11/2026).
 *
 * "Tôi muốn xem thống kê lead hàng ngày, hàng tuần, hàng tháng, từng thành
 * viên và tổng công ty, bạn nào hiệu quả, bạn nào không."
 *
 * Built from what the inbox already records: the assignment log (who got which
 * conversation when, who answered, who let it go), the conversations (new
 * chats, which became a customer with a phone) and appointments (who booked).
 * Every number is bucketed in the SALON's time zone. Pure: no database, no clock.
 */
import type { LogRow } from './turn-team';

export type Grain = 'day' | 'week' | 'month';
/** How many periods each view shows. */
export const PERIODS: Record<Grain, number> = { day: 31, week: 12, month: 12 };

/** Passed on because the holder did not act in time — counts against them. */
const LOST = new Set(['reassign-unread', 'reassign-unreplied']);
/** The holder said "Không nhận" (in Lumio or on their Messenger): released at once, counted apart. */
const DECLINE = 'skip';
// rt248: the same turn rules as the scoreboard (turn-team.ts NOT_TURN_REASONS).
const NOT_TURN = new Set(['unassign', 'first-reply', 'backlog', 'opened', 'prospect', 'took-by-reply']);

/** Y-M-D of an instant on the salon's wall clock. */
export function localYmd(d: Date, tz: string): string {
  try {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
    return `${g('year')}-${g('month')}-${g('day')}`;
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

const ymdPlus = (ymd: string, days: number) => {
  const t = new Date(`${ymd}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};

/** The period an instant falls in: the day, the Monday of its week, or the month. */
export function periodKey(d: Date, tz: string, grain: Grain): string {
  const ymd = localYmd(d, tz);
  if (grain === 'day') return ymd;
  if (grain === 'month') return ymd.slice(0, 7);
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return ymdPlus(ymd, -((dow + 6) % 7));
}

/** The periods shown, oldest first, ending with the one `now` is in. */
export function periodsBack(now: Date, tz: string, grain: Grain, n = PERIODS[grain]): string[] {
  const last = periodKey(now, tz, grain);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    if (grain === 'day') out.push(ymdPlus(last, -i));
    else if (grain === 'week') out.push(ymdPlus(last, -7 * i));
    else {
      const [y, m] = last.split('-').map(Number);
      const idx = y * 12 + (m - 1) - i;
      out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`);
    }
  }
  return out;
}

/** How far back to read so the oldest period is whole (a little over). */
export function sinceFor(now: Date, grain: Grain): Date {
  const days = grain === 'day' ? 32 : grain === 'week' ? 12 * 7 + 8 : 372;
  return new Date(now.getTime() - days * 86_400_000);
}

export type Cell = {
  /** Different customers this person was given (each counted once per period). */
  received: number;
  /**
   * rt248: turns given — a new customer, a customer passed on to them, or their
   * own customer writing back. Every percentage below is out of this.
   */
  turns: number;
  /** Turns they answered (a human reply before the turn ended). */
  answered: number;
  /** Answered before the turn would have passed on. */
  onTime: number;
  /** Median seconds to the first answer. */
  medianSec: number | null;
  /** Turns passed on from them for not acting in time (not opened / not answered). */
  lost: number;
  /** rt248: turns they released with "Không nhận" (went to the next person at once). */
  declined: number;
  /** rt248: customers nobody held that they answered on their own (not a turn). */
  selfTaken: number;
  /** Conversations they held that now have a customer with a phone. */
  contact: number;
  /** Bookings made while they held the conversation. */
  booked: number;
};

/** `hasContact`: a phone / email is known (typed by the customer, saved, or on a lead card). */
export type ThreadIn = { id: string; createdAt: Date; customerId: string | null; hasContact?: boolean };
export type BookingIn = { threadId: string; at: Date };

export type Rating = 'good' | 'ok' | 'weak' | 'few';
export type Reason = 'slow' | 'lost' | 'declines' | 'lowConv' | 'noBooking';

export type PersonReport = {
  userId: string;
  cells: Record<string, Cell>;
  total: Cell & { convPct: number | null; onTimePct: number | null; lostPct: number | null; declinePct: number | null };
  rating: Rating;
  reasons: Reason[];
};

export type LeadReport = {
  grain: Grain;
  periods: string[];
  people: PersonReport[];
  /** The salon as a whole: every new conversation, not only the ones given to staff (AI included). */
  company: Record<string, { newChats: number; withContact: number; booked: number; bookedByStaff: number }>;
  companyTotal: { newChats: number; withContact: number; booked: number; bookedByStaff: number };
  /** The team's booking rate on the conversations it held, the bar each person is measured against. */
  teamConvPct: number | null;
};

/** Fewer conversations than this in the whole range: too early to judge someone. */
export const MIN_SAMPLE = 10;

type Acc = { threads: Set<string>; turns: number; answered: number; onTime: number; secs: number[]; lost: number; declined: number; selfTaken: number; contact: Set<string>; booked: number };
const acc = (): Acc => ({ threads: new Set(), turns: 0, answered: 0, onTime: 0, secs: [], lost: 0, declined: 0, selfTaken: 0, contact: new Set(), booked: 0 });
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };
const toCell = (a: Acc): Cell => ({ received: a.threads.size, turns: a.turns, answered: a.answered, onTime: a.onTime, medianSec: median(a.secs), lost: a.lost, declined: a.declined, selfTaken: a.selfTaken, contact: a.contact.size, booked: a.booked });
const pct = (n: number, d: number) => (d > 0 ? Math.round((n * 100) / d) : null);

/** Judge one person against the team over the whole range. */
export function rate(t: { received: number; turns: number; onTime: number; answered: number; lost: number; declined: number; booked: number }, teamConvPct: number | null): { rating: Rating; reasons: Reason[] } {
  if (t.turns < MIN_SAMPLE) return { rating: 'few', reasons: [] };
  // Declined turns went straight to someone else: they are not judged as slow
  // answers, so on-time is measured over the turns the person kept.
  const kept = Math.max(0, t.turns - t.declined);
  const onTimePct = kept ? (pct(t.onTime, kept) ?? 0) : 100;
  const lostPct = pct(t.lost, t.turns) ?? 0;
  const declinePct = pct(t.declined, t.turns) ?? 0;
  const conv = pct(t.booked, t.received) ?? 0;
  const reasons: Reason[] = [];
  if (kept >= MIN_SAMPLE / 2 && onTimePct < 50) reasons.push('slow');
  if (lostPct > 30) reasons.push('lost');
  if (declinePct > 40) reasons.push('declines');
  if (teamConvPct && teamConvPct > 0 && conv < teamConvPct * 0.5) reasons.push('lowConv');
  if (t.booked === 0 && (teamConvPct ?? 0) > 0) { if (!reasons.includes('lowConv')) reasons.push('noBooking'); }
  if (reasons.length) return { rating: 'weak', reasons };
  if (onTimePct >= 80 && lostPct <= 10 && conv >= (teamConvPct ?? 0)) return { rating: 'good', reasons: [] };
  return { rating: 'ok', reasons: [] };
}

/**
 * The report. `logs` are the assignment rows (any order) from a little before
 * the first period; `threads` the salon's conversations created in the range
 * plus any the logs mention; `bookings` the first booking per conversation;
 * `limitMins` the salon's answer-in-time limit for a conversation.
 */
export function leadReport(o: {
  grain: Grain; tz: string; now: Date;
  logs: LogRow[]; threads: ThreadIn[]; bookings: BookingIn[];
  limitMins: (threadId: string) => number;
}): LeadReport {
  const periods = periodsBack(o.now, o.tz, o.grain);
  const inRange = new Set(periods);
  const key = (d: Date) => periodKey(d, o.tz, o.grain);
  const tBy = new Map(o.threads.map((t) => [t.id, t]));
  const reach = (id: string) => { const t = tBy.get(id); return !!t && (t.hasContact ?? !!t.customerId); };
  const per = new Map<string, Map<string, Acc>>(); // user → period → acc
  const cellOf = (u: string, p: string) => { let m = per.get(u); if (!m) { m = new Map(); per.set(u, m); } let a = m.get(p); if (!a) { a = acc(); m.set(p, a); } return a; };

  const sorted = [...o.logs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  // The turn in progress on each conversation: who, since when, its period.
  const open = new Map<string, { userId: string; at: Date; p: string }>();
  // Who held each conversation from when — to give a booking to the person holding it then.
  const holds = new Map<string, { userId: string; at: number }[]>();
  const hold = (threadId: string, userId: string, at: Date) => { const h = holds.get(threadId) ?? []; h.push({ userId, at: at.getTime() }); holds.set(threadId, h); };
  for (const r of sorted) {
    const p = key(r.createdAt);
    if (r.reason === 'took-by-reply' && r.userId) {
      // Their own initiative: not a turn, but theirs from now on.
      if (inRange.has(p)) { const a = cellOf(r.userId, p); a.selfTaken += 1; if (reach(r.threadId)) a.contact.add(r.threadId); }
      open.delete(r.threadId);
      hold(r.threadId, r.userId, r.createdAt);
      continue;
    }
    if (r.reason === 'backlog' || r.reason === 'prospect') {
      // Old customers given out to follow up: theirs, no clock.
      if (r.userId) hold(r.threadId, r.userId, r.createdAt);
      open.delete(r.threadId);
      continue;
    }
    if (!NOT_TURN.has(r.reason) && r.userId) {
      // A pass from the holder ends their turn: not acting in time, or "Không nhận".
      const cur = open.get(r.threadId);
      if (r.fromUserId && (LOST.has(r.reason) || r.reason === DECLINE)) {
        const bucket = cur && cur.userId === r.fromUserId ? cur.p : p;
        if (inRange.has(bucket)) { const f = cellOf(r.fromUserId, bucket); if (r.reason === DECLINE) f.declined += 1; else f.lost += 1; }
      }
      open.set(r.threadId, { userId: r.userId, at: r.createdAt, p });
      hold(r.threadId, r.userId, r.createdAt);
      if (inRange.has(p)) {
        const a = cellOf(r.userId, p);
        a.turns += 1;
        a.threads.add(r.threadId);
        if (reach(r.threadId)) a.contact.add(r.threadId);
      }
    } else if (r.reason === 'first-reply' && r.userId) {
      const cur = open.get(r.threadId);
      if (cur && cur.userId === r.userId) {
        if (inRange.has(cur.p)) {
          const a = cellOf(r.userId, cur.p);
          const sec = Math.max(0, Math.round((r.createdAt.getTime() - cur.at.getTime()) / 1000));
          a.answered += 1;
          a.secs.push(sec);
          const lim = o.limitMins(r.threadId);
          if (!lim || sec <= lim * 60) a.onTime += 1;
        }
        open.delete(r.threadId);
      }
    } else if (r.reason === 'unassign') {
      open.delete(r.threadId);
    }
  }

  const company: LeadReport['company'] = {};
  for (const p of periods) company[p] = { newChats: 0, withContact: 0, booked: 0, bookedByStaff: 0 };
  for (const t of o.threads) {
    const p = key(t.createdAt);
    if (!company[p]) continue;
    company[p].newChats += 1;
    if (t.hasContact ?? !!t.customerId) company[p].withContact += 1;
  }
  for (const b of o.bookings) {
    const p = key(b.at);
    if (!company[p]) continue;
    company[p].booked += 1;
    const h = (holds.get(b.threadId) ?? []).filter((x) => x.at <= b.at.getTime());
    const holder = h.length ? h[h.length - 1].userId : null;
    if (holder) { cellOf(holder, p).booked += 1; company[p].bookedByStaff += 1; }
  }

  // The team bar: bookings on held conversations / conversations held, over the range.
  let teamRecv = 0;
  let teamBooked = 0;
  const totals = new Map<string, Acc>();
  for (const [u, m] of per) {
    const t = acc();
    for (const p of periods) {
      const a = m.get(p);
      if (!a) continue;
      a.threads.forEach((x) => t.threads.add(x));
      a.contact.forEach((x) => t.contact.add(x));
      t.turns += a.turns; t.answered += a.answered; t.onTime += a.onTime; t.secs.push(...a.secs);
      t.lost += a.lost; t.declined += a.declined; t.selfTaken += a.selfTaken; t.booked += a.booked;
    }
    totals.set(u, t);
    teamRecv += t.threads.size;
    teamBooked += t.booked;
  }
  const teamConvPct = pct(teamBooked, teamRecv);

  const people: PersonReport[] = [...per.keys()].map((u) => {
    const m = per.get(u)!;
    const cells: Record<string, Cell> = {};
    for (const p of periods) cells[p] = toCell(m.get(p) ?? acc());
    const tc = toCell(totals.get(u)!);
    const { rating, reasons } = rate(tc, teamConvPct);
    return {
      userId: u, cells, rating, reasons,
      total: { ...tc, convPct: pct(tc.booked, tc.received), onTimePct: pct(tc.onTime, Math.max(0, tc.turns - tc.declined)), lostPct: pct(tc.lost, tc.turns), declinePct: pct(tc.declined, tc.turns) },
    };
  }).filter((x) => x.total.turns > 0 || x.total.lost > 0 || x.total.booked > 0 || x.total.selfTaken > 0)
    .sort((a, b) => b.total.booked - a.total.booked || b.total.received - a.total.received);

  const companyTotal = { newChats: 0, withContact: 0, booked: 0, bookedByStaff: 0 };
  for (const p of periods) { const c = company[p]; companyTotal.newChats += c.newChats; companyTotal.withContact += c.withContact; companyTotal.booked += c.booked; companyTotal.bookedByStaff += c.bookedByStaff; }

  return { grain: o.grain, periods, people, company, companyTotal, teamConvPct };
}

/** CSV for the owner's own spreadsheet: one row per person per period, plus the salon. */
export function leadReportCsv(r: LeadReport, names: Map<string, string>): string {
  const q = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [['Kỳ', 'Người', 'Khách nhận', 'Lượt turn', 'Đã trả lời', 'Trả lời đúng hạn', 'Phản hồi trung vị (giây)', 'Bỏ turn (quá giờ)', 'Từ chối', 'Tự nhận', 'Có SĐT', 'Chốt', 'Tỉ lệ chốt %'].join(',')];
  for (const p of r.periods) {
    for (const x of r.people) {
      const c = x.cells[p];
      if (!c.turns && !c.lost && !c.booked && !c.selfTaken) continue;
      lines.push([p, names.get(x.userId) ?? x.userId, c.received, c.turns, c.answered, c.onTime, c.medianSec ?? '', c.lost, c.declined, c.selfTaken, c.contact, c.booked, pct(c.booked, c.received) ?? ''].map(q).join(','));
    }
    const c = r.company[p];
    lines.push([p, 'TỔNG TIỆM (chat mới)', c.newChats, '', '', '', '', '', '', '', c.withContact, c.booked, pct(c.booked, c.newChats) ?? ''].map(q).join(','));
  }
  return lines.join('\n');
}
