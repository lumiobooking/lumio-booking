/**
 * WALK-IN 2.0, STEP 3 — "about how long?". Pure.
 *
 * The question every walk-in asks, answered from the floor as it is: who is
 * free now, when each busy technician frees up, and how long the people
 * ahead will take. Shown as a RANGE ("5–10 min"), never a promise — the way
 * queue products present it — and rounded to 5 minutes so it does not jump
 * on every refresh.
 */

export interface EstimateInput {
  /** Minutes until each technician in the rotation can start someone: 0 = free now. */
  techFreeIn: number[];
  /** Length in minutes of each visit ahead of this customer, in queue order. */
  aheadMinutes: number[];
}

const round5 = (n: number) => Math.max(0, Math.round(n / 5) * 5);

/** When this customer can start, in minutes from now (null = nobody works today). */
export function startsIn(input: EstimateInput): number | null {
  const slots = input.techFreeIn.filter((m) => Number.isFinite(m)).map((m) => Math.max(0, m));
  if (!slots.length) return null;
  for (const len of input.aheadMinutes) {
    slots.sort((a, b) => a - b);
    slots[0] += len > 0 ? len : 30;
  }
  return Math.min(...slots);
}

/** "now" when a chair is free and nobody is ahead; else a 5-minute-rounded range. */
export function waitEstimate(input: EstimateInput): { min: number; max: number } | null {
  const s = startsIn(input);
  if (s == null) return null;
  if (s <= 2) return { min: 0, max: 0 };
  const min = Math.max(5, round5(s));
  const max = min + Math.max(5, round5(min * 0.3));
  return { min, max };
}

/** Each waiting customer's estimate, in queue order: everyone before her is "ahead". */
export function queueEstimates(techFreeIn: number[], queueMinutes: number[]): ({ min: number; max: number } | null)[] {
  return queueMinutes.map((_, i) => waitEstimate({ techFreeIn, aheadMinutes: queueMinutes.slice(0, i) }));
}
