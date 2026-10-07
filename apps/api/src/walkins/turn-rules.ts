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
 */

export type TurnMode = 'COUNT' | 'MONEY' | 'HYBRID';
export type TieBreak = 'PRIORITY_LIST' | 'LAST_FINISHED' | 'CLOCK_IN';
export type AppointmentWeight = 'ONE' | 'BY_SERVICE' | 'NONE';

export interface TurnRules {
  mode: TurnMode;
  /** HYBRID: a leg whose lines total less than this is ½ a turn. 0 = off. */
  halfBelowCents: number;
  tieBreak: TieBreak;
  requestWeight: 1 | 0.5 | 0;
  appointmentWeight: AppointmentWeight;
}

export const TURN_RULES_KEY = 'turn_rules';

export const DEFAULT_TURN_RULES: TurnRules = {
  mode: 'COUNT', halfBelowCents: 0, tieBreak: 'PRIORITY_LIST', requestWeight: 1, appointmentWeight: 'ONE',
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T => (allowed.includes(v as T) ? (v as T) : dflt);

export function cleanTurnRules(raw: unknown): TurnRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const half = Math.round(Number(r.halfBelowCents));
  const rw = Number(r.requestWeight);
  return {
    mode: oneOf(r.mode, ['COUNT', 'MONEY', 'HYBRID'] as const, DEFAULT_TURN_RULES.mode),
    halfBelowCents: Number.isFinite(half) && half > 0 ? Math.min(half, 100_000_000) : 0,
    tieBreak: oneOf(r.tieBreak, ['PRIORITY_LIST', 'LAST_FINISHED', 'CLOCK_IN'] as const, DEFAULT_TURN_RULES.tieBreak),
    requestWeight: rw === 0 ? 0 : rw === 0.5 ? 0.5 : 1,
    appointmentWeight: oneOf(r.appointmentWeight, ['ONE', 'BY_SERVICE', 'NONE'] as const, DEFAULT_TURN_RULES.appointmentWeight),
  };
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
