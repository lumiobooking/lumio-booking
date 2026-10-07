/**
 * CHIA TUA — the week (or any range) in numbers, per technician. Pure.
 *
 * The owner's Sunday question: "did the turns come out even?" Per technician
 * over the range: turns (legs + bookings + corrections), service money, how
 * many of her clients asked for her by name, how many she passed on, and the
 * days she took at least one turn. Same finished-leg rule as the live floor
 * (walkin-legs.ts), so the report and the board never disagree.
 */
import { appointmentTurns, legTurns, TurnRules } from './turn-rules';
import { legPrice, legsOf, TicketLike } from './walkin-legs';

export interface ReportAppt { assignedStaffId: string | null; completedAt: Date | string | null; priceCents: number | null; turnValue?: number | null; seated?: boolean }
/** A correction belongs to the salon day it was made for (`day`), else the instant it was typed. */
export interface ReportAdjust { staffId: string; delta: number; createdAt?: Date | string; day?: string }
export interface ReportSkip { staffId: string; at: Date | string }

export interface TechReport {
  staffId: string;
  turns: number; legs: number; requested: number; bookings: number; adjustments: number; skips: number;
  moneyCents: number;
  /** Day keys (YYYY-MM-DD) with at least one turn. */
  days: string[];
  /** Service money per turn — the "fair" check in MONEY-minded salons. */
  perTurnCents: number;
}

export interface TurnReport {
  from: string; to: string;
  techs: TechReport[];
  totals: { turns: number; moneyCents: number; requested: number; skips: number };
  /** Spread between the most and the fewest turns (same-day technicians only make sense per day; this is the range). */
  spread: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * @param dayOf  a date → the salon's day key (its timezone); the caller owns the zone.
 * @param inRange  from ≤ dayKey ≤ to, inclusive, as day keys.
 */
export function turnReport(
  tickets: TicketLike[], appts: ReportAppt[], adjustments: ReportAdjust[], skips: ReportSkip[],
  range: { from: string; to: string }, rules: TurnRules, dayOf: (d: Date) => string,
): TurnReport {
  const inRange = (key: string) => key >= range.from && key <= range.to;
  const rows = new Map<string, TechReport>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) { r = { staffId: id, turns: 0, legs: 0, requested: 0, bookings: 0, adjustments: 0, skips: 0, moneyCents: 0, days: [], perTurnCents: 0 }; rows.set(id, r); }
    return r;
  };
  const day = (r: TechReport, key: string) => { if (!r.days.includes(key)) r.days.push(key); };
  for (const t of tickets) {
    const closed = t.status === 'DONE';
    for (const leg of legsOf(t)) {
      if (!leg.staffId) continue;
      const finished = leg.status === 'DONE' || (closed && leg.status !== 'WAITING') || (t.awaitingPayment && leg.status !== 'WAITING');
      if (!finished) continue;
      const when = leg.doneAt ? new Date(leg.doneAt) : t.doneAt ? new Date(t.doneAt) : null;
      if (!when) continue;
      const key = dayOf(when);
      if (!inRange(key)) continue;
      const r = row(leg.staffId);
      const price = legPrice(t, leg);
      const v = legTurns({ turnValue: leg.turnValue, pinned: leg.pinned, priceCents: price }, rules);
      r.turns = r2(r.turns + v); r.legs += 1; r.moneyCents += price;
      if (leg.pinned) r.requested += 1;
      day(r, key);
    }
  }
  for (const a of appts) {
    if (!a.assignedStaffId || !a.completedAt || a.seated) continue;
    const key = dayOf(new Date(a.completedAt));
    if (!inRange(key)) continue;
    const r = row(a.assignedStaffId);
    const v = appointmentTurns(a.turnValue, rules);
    r.turns = r2(r.turns + v); r.bookings += 1; r.moneyCents += a.priceCents ?? 0;
    day(r, key);
  }
  for (const adj of adjustments) {
    const key = adj.day ?? (adj.createdAt ? dayOf(new Date(adj.createdAt)) : '');
    if (!inRange(key)) continue;
    const r = row(adj.staffId);
    r.turns = r2(r.turns + adj.delta); r.adjustments = r2(r.adjustments + adj.delta);
  }
  for (const s of skips) {
    const key = dayOf(new Date(s.at));
    if (!inRange(key)) continue;
    row(s.staffId).skips += 1;
  }
  const techs = [...rows.values()].map((r) => ({ ...r, days: [...r.days].sort(), perTurnCents: r.turns > 0 ? Math.round(r.moneyCents / r.turns) : 0 }))
    .sort((a, b) => b.turns - a.turns || b.moneyCents - a.moneyCents);
  const totals = techs.reduce((s, r) => ({ turns: r2(s.turns + r.turns), moneyCents: s.moneyCents + r.moneyCents, requested: s.requested + r.requested, skips: s.skips + r.skips }), { turns: 0, moneyCents: 0, requested: 0, skips: 0 });
  const spread = techs.length ? r2(Math.max(...techs.map((t) => t.turns)) - Math.min(...techs.map((t) => t.turns))) : 0;
  return { from: range.from, to: range.to, techs, totals, spread };
}

/** The Monday-to-Sunday week that holds `dayKey`, as day keys. */
export function weekOf(dayKey: string): { from: string; to: string } {
  const d = new Date(`${dayKey}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const mon = new Date(d.getTime() - dow * 86400000);
  const sun = new Date(mon.getTime() + 6 * 86400000);
  return { from: mon.toISOString().slice(0, 10), to: sun.toISOString().slice(0, 10) };
}
