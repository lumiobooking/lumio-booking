/**
 * rt231 — "chia turn đang đổ về bạn Nhi, còn 2 bạn còn lại không được".
 *
 * Every time a customer is given out, the people in the list who could NOT
 * take it are counted with the reason (not in Lumio / not on shift, holding
 * the maximum, away…). The owner then sees, for the last 7 days, exactly why
 * someone gets fewer customers — instead of guessing that the rotation is
 * unfair. Kept per salon in its own settings row; names only, no customer data.
 */

export interface SkipCounts { [userId: string]: { name: string; total: number; why: Record<string, number> } }
export interface SkipBook { days: Record<string, SkipCounts> }

export const SKIPS_KEY = 'chat_turn_skips';
export const SKIP_DAYS = 7;

const dayOf = (now: Date) => now.toISOString().slice(0, 10);

/** Count one give-out: everyone in the list who was passed over, with why. */
export function tallySkips(book: SkipBook | null | undefined, pool: { userId: string; name: string; blockers: string[]; inRotation?: boolean }[], pickedId: string | null, now: Date = new Date()): SkipBook {
  const days: Record<string, SkipCounts> = { ...(book?.days ?? {}) };
  const today = dayOf(now);
  const oldest = dayOf(new Date(now.getTime() - (SKIP_DAYS - 1) * 86_400_000));
  for (const d of Object.keys(days)) if (d < oldest) delete days[d];
  const cur: SkipCounts = { ...(days[today] ?? {}) };
  for (const a of pool) {
    if (a.inRotation === false || a.userId === pickedId) continue;
    const why = (a.blockers ?? []).filter((b) => b !== 'not-in-list');
    if (!why.length) continue;
    const row = cur[a.userId] ? { ...cur[a.userId], why: { ...cur[a.userId].why } } : { name: a.name, total: 0, why: {} as Record<string, number> };
    row.name = a.name;
    row.total += 1;
    for (const b of why) row.why[b] = (row.why[b] ?? 0) + 1;
    cur[a.userId] = row;
  }
  days[today] = cur;
  return { days };
}

/** The last 7 days added up, most skipped first. */
export function skipSummary(book: SkipBook | null | undefined, now: Date = new Date()): { userId: string; name: string; total: number; why: Record<string, number> }[] {
  const oldest = dayOf(new Date(now.getTime() - (SKIP_DAYS - 1) * 86_400_000));
  const sum = new Map<string, { userId: string; name: string; total: number; why: Record<string, number> }>();
  for (const [d, counts] of Object.entries(book?.days ?? {})) {
    if (d < oldest) continue;
    for (const [id, r] of Object.entries(counts)) {
      const s = sum.get(id) ?? { userId: id, name: r.name, total: 0, why: {} };
      s.total += r.total;
      for (const [b, n] of Object.entries(r.why)) s.why[b] = (s.why[b] ?? 0) + n;
      sum.set(id, s);
    }
  }
  return [...sum.values()].sort((a, b) => b.total - a.total);
}
