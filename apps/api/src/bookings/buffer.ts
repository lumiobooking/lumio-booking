/**
 * TIME BETWEEN APPOINTMENTS — the salon's rest/clean-up gap.
 *
 * One number per salon (booking rules `bufferMinutes`, 0–60): a technician's
 * next booking may not start until this long after the last one ends. It
 * shapes what customers and the bots are OFFERED (availability, auto-assign)
 * and what an online booking may take; the front desk can still squeeze a
 * client in by hand. 0 = back to back, as before. Pure.
 */
export const MAX_BUFFER_MINUTES = 60;

export function bufferOf(rules: { bufferMinutes?: unknown } | null | undefined): number {
  const n = Number((rules as { bufferMinutes?: unknown } | null | undefined)?.bufferMinutes ?? 0);
  return Number.isFinite(n) ? Math.min(MAX_BUFFER_MINUTES, Math.max(0, Math.round(n))) : 0;
}

/** A booking as it blocks the technician: its own time plus the gap on either side. */
export function padSpan<T extends { start: Date; end: Date }>(s: T, minutes: number): T {
  if (!minutes) return s;
  const ms = minutes * 60_000;
  return { ...s, start: new Date(s.start.getTime() - ms), end: new Date(s.end.getTime() + ms) };
}
