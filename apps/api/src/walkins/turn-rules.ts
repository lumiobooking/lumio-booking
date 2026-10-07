/**
 * CHIA TUA — the salon's own rules for who gets the next customer. Pure.
 *
 * The defaults are exactly what the floor did before these rules existed, so
 * a salon that never opens the settings sees no change:
 *   - every finished leg is worth its service's turn value (1, ½, 0);
 *   - a requested client counts the same as a walk-in;
 *   - a completed booking is one turn;
 *   - fewest turns first, then the owner's priority, then list order.
 * What a salon can change, and why (claude/turn-system-research.md):
 *   mode       COUNT (as above) · MONEY (lowest service $ today goes first — fair
 *              when a full set and a polish change are both "one turn") ·
 *              HYBRID (count, but a leg under `halfBelowCents` is only ½ a turn);
 *   tieBreak   PRIORITY_LIST (as before) · LAST_FINISHED (whoever has been free
 *              longest) · CLOCK_IN (whoever came in first);
 *   requestWeight     what a requested client counts: 1 / 0.5 / 0;
 *   appointmentWeight what a completed booking counts: ONE / BY_SERVICE / NONE.
 * Phase 3:
 *   reverseServiceIds the services nobody wants (a $10 polish change): a leg made
 *              only of these goes to the technician with the MOST turns — "tua ngược";
 *   newTechDays / newTechBoost  a technician in her first N days is read as
 *              ½ / 1 turn behind, so she is handed clients first and builds a book;
 *   ownerInRotation  false = the owner (a staff member whose login is the salon
 *              admin) only takes clients who asked for her by name.
 */

export type TurnMode = 'COUNT' | 'MONEY' | 'HYBRID';
export type TieBreak = 'PRIORITY_LIST' | 'LAST_FINISHED' | 'CLOCK_IN';
export type AppointmentWeight = 'ONE' | 'BY_SERVICE' | 'NONE';
/** Back from a break: keep her place (HOLD) or go to the end of the line (BOTTOM). */
export type BreakPolicy = 'HOLD' | 'BOTTOM';
/** She passed a customer on: nothing (FREE), it still counts as her turn, or she goes to the end. */
export type SkipPolicy = 'FREE' | 'COUNT_AS_TURN' | 'BOTTOM';
/** Clocked in late (past the schedule + grace): nothing, or ½ / 1 turn added for the day. */
export type LatePolicy = 'NONE' | 'PLUS_HALF' | 'PLUS_ONE';

export interface TurnRules {
  mode: TurnMode;
  /** HYBRID: a leg whose lines total less than this is ½ a turn. 0 = off. */
  halfBelowCents: number;
  tieBreak: TieBreak;
  requestWeight: 1 | 0.5 | 0;
  appointmentWeight: AppointmentWeight;
  breakPolicy: BreakPolicy;
  skipPolicy: SkipPolicy;
  latePolicy: LatePolicy;
  /** Minutes after the scheduled start before a clock-in counts as late. */
  lateGraceMin: number;
  /** "Tua ngược": a leg of only these services goes to whoever has the MOST turns. */
  reverseServiceIds: string[];
  /** A technician in her first N days (0 = off) counts `newTechBoost` turns behind. */
  newTechDays: number;
  newTechBoost: 0.5 | 1;
  /** false = the owner takes requested clients only; the dispatcher skips her. */
  ownerInRotation: boolean;
}

export const TURN_RULES_KEY = 'turn_rules';

export const DEFAULT_TURN_RULES: TurnRules = {
  mode: 'COUNT', halfBelowCents: 0, tieBreak: 'PRIORITY_LIST', requestWeight: 1, appointmentWeight: 'ONE',
  breakPolicy: 'HOLD', skipPolicy: 'FREE', latePolicy: 'NONE', lateGraceMin: 15,
  reverseServiceIds: [], newTechDays: 0, newTechBoost: 0.5, ownerInRotation: true,
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T => (allowed.includes(v as T) ? (v as T) : dflt);

export function cleanTurnRules(raw: unknown): TurnRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const half = Math.round(Number(r.halfBelowCents));
  const rw = Number(r.requestWeight);
  const grace = Math.round(Number(r.lateGraceMin));
  const newDays = Math.round(Number(r.newTechDays));
  const reverse = Array.isArray(r.reverseServiceIds) ? [...new Set(r.reverseServiceIds.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64))].slice(0, 100) : [];
  return {
    mode: oneOf(r.mode, ['COUNT', 'MONEY', 'HYBRID'] as const, DEFAULT_TURN_RULES.mode),
    halfBelowCents: Number.isFinite(half) && half > 0 ? Math.min(half, 100_000_000) : 0,
    tieBreak: oneOf(r.tieBreak, ['PRIORITY_LIST', 'LAST_FINISHED', 'CLOCK_IN'] as const, DEFAULT_TURN_RULES.tieBreak),
    requestWeight: rw === 0 ? 0 : rw === 0.5 ? 0.5 : 1,
    appointmentWeight: oneOf(r.appointmentWeight, ['ONE', 'BY_SERVICE', 'NONE'] as const, DEFAULT_TURN_RULES.appointmentWeight),
    breakPolicy: oneOf(r.breakPolicy, ['HOLD', 'BOTTOM'] as const, DEFAULT_TURN_RULES.breakPolicy),
    skipPolicy: oneOf(r.skipPolicy, ['FREE', 'COUNT_AS_TURN', 'BOTTOM'] as const, DEFAULT_TURN_RULES.skipPolicy),
    latePolicy: oneOf(r.latePolicy, ['NONE', 'PLUS_HALF', 'PLUS_ONE'] as const, DEFAULT_TURN_RULES.latePolicy),
    lateGraceMin: Number.isFinite(grace) && grace >= 0 ? Math.min(grace, 240) : DEFAULT_TURN_RULES.lateGraceMin,
    reverseServiceIds: reverse,
    newTechDays: Number.isFinite(newDays) && newDays > 0 ? Math.min(newDays, 365) : 0,
    newTechBoost: Number(r.newTechBoost) === 1 ? 1 : 0.5,
    ownerInRotation: r.ownerInRotation === undefined || r.ownerInRotation === null ? true : r.ownerInRotation !== false && r.ownerInRotation !== 'false',
  };
}

/**
 * Minutes late: how far past the scheduled start (HH:mm of the salon day) a
 * clock-in landed, beyond the grace. 0 = on time (or no schedule to be late for).
 */
export function minutesLate(clockInMs: number, dayStartMs: number, startTime: string | null | undefined, graceMin: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(startTime ?? '');
  if (!m) return 0;
  const sched = Number(m[1]) * 60 + Number(m[2]);
  const actual = (clockInMs - dayStartMs) / 60000;
  return Math.max(0, Math.round(actual - sched - graceMin));
}

/** What a late clock-in costs under the rules. */
export function latePenalty(rules: TurnRules, lateMin: number): number {
  if (lateMin <= 0) return 0;
  return rules.latePolicy === 'PLUS_ONE' ? 1 : rules.latePolicy === 'PLUS_HALF' ? 0.5 : 0;
}

/** "Go to the end of the line": the turns to add so she no longer ranks before anyone. */
export function toBottomDelta(mine: number, others: number[]): number {
  if (!others.length) return 0;
  const max = Math.max(...others);
  return max > mine ? Math.round((max - mine) * 100) / 100 : 0;
}

/** What one finished leg is worth in turns under these rules. */
export function legTurns(leg: { turnValue: number; pinned?: boolean; priceCents?: number }, rules: TurnRules = DEFAULT_TURN_RULES): number {
  let v = typeof leg.turnValue === 'number' ? leg.turnValue : 1;
  if (rules.mode === 'HYBRID' && rules.halfBelowCents > 0 && v > 0 && (leg.priceCents ?? 0) < rules.halfBelowCents) v = Math.min(v, 0.5);
  if (leg.pinned) v = v * rules.requestWeight;
  return Math.round(v * 100) / 100;
}

/** What one completed booking is worth. */
export function appointmentTurns(serviceTurnValue: number | null | undefined, rules: TurnRules = DEFAULT_TURN_RULES): number {
  if (rules.appointmentWeight === 'NONE') return 0;
  if (rules.appointmentWeight === 'BY_SERVICE') return typeof serviceTurnValue === 'number' ? serviceTurnValue : 1;
  return 1;
}

/** Facts the tie-break needs, per technician. */
export interface TieFacts {
  /** When she last finished a leg today (ms); undefined = nothing finished yet. */
  lastDone?: Map<string, number>;
  /** When she clocked in today (ms); undefined = no clock-in. */
  clockIn?: Map<string, number>;
}

/**
 * Who goes first of two technicians with the SAME score. Negative = a first.
 * LAST_FINISHED: the one free longest (never finished today beats everyone);
 * CLOCK_IN: the one who came in first (no clock-in goes last);
 * then, always: the owner's priority, then list order (a stable sort keeps it).
 */
export function tieCompare(a: { id: string; priority: number }, b: { id: string; priority: number }, rules: TurnRules, facts: TieFacts = {}): number {
  if (rules.tieBreak === 'LAST_FINISHED') {
    const la = facts.lastDone?.get(a.id) ?? 0;
    const lb = facts.lastDone?.get(b.id) ?? 0;
    if (la !== lb) return la - lb;
  } else if (rules.tieBreak === 'CLOCK_IN') {
    const ca = facts.clockIn?.get(a.id) ?? Number.POSITIVE_INFINITY;
    const cb = facts.clockIn?.get(b.id) ?? Number.POSITIVE_INFINITY;
    if (ca !== cb) return ca - cb;
  }
  return b.priority - a.priority;
}

/** A leg that is ONLY unwanted services is handed out in reverse (most turns first). */
export function isReverseLeg(serviceIds: string[], rules: TurnRules): boolean {
  if (!rules.reverseServiceIds.length || !serviceIds.length) return false;
  const set = new Set(rules.reverseServiceIds);
  return serviceIds.every((id) => set.has(id));
}

/** The head start a new technician gets today: a negative turn value, or 0 when the rule is off or she is not new. */
export function newTechBoost(startedAt: Date | string | null | undefined, now: Date, rules: TurnRules): number {
  if (!rules.newTechDays || !startedAt) return 0;
  const days = (now.getTime() - new Date(startedAt).getTime()) / 86400000;
  return days >= 0 && days < rules.newTechDays ? -rules.newTechBoost : 0;
}
