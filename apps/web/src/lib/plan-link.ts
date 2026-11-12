/**
 * The client's plan link (/plan/{token}, 12/11/2026): the month a salon is
 * sent instead of a Google Sheet. Pure helpers, so the grid and the counters
 * can be tested without a browser.
 */
export type PlanStatus = 'held' | 'wait' | 'approved' | 'posted';
export interface PlanPostLite { id: string; scheduledAt: string; clientStatus: PlanStatus }

/** YYYY-MM-DD of an instant, on the SALON's calendar (not the viewer's). */
export function dayKeyIn(iso: string | Date, tz?: string): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  try { return d.toLocaleDateString('en-CA', tz ? { timeZone: tz } : {}); } catch { return d.toLocaleDateString('en-CA'); }
}

/** "2026-11" → the 35 or 42 day keys of its Monday-first grid; null = a cell outside the month. */
export function monthCells(ym: string): (string | null)[] {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(`${ym}-${String(d).padStart(2, '0')}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function shiftYm(ym: string, by: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The month the link opens on: the one holding the first post still waiting, else today's. */
export function openingMonth(posts: PlanPostLite[], tz: string | undefined, now: Date = new Date()): string {
  const waiting = posts.filter((p) => p.clientStatus === 'wait').sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];
  return dayKeyIn(waiting ? waiting.scheduledAt : now, tz).slice(0, 7);
}

export function countsOf(posts: PlanPostLite[]): Record<PlanStatus, number> {
  const c: Record<PlanStatus, number> = { held: 0, wait: 0, approved: 0, posted: 0 };
  for (const p of posts) c[p.clientStatus]++;
  return c;
}

/** Posts by salon day, each day in time order. */
export function byDayOf<T extends PlanPostLite>(posts: T[], tz?: string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const p of [...posts].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))) {
    const k = dayKeyIn(p.scheduledAt, tz);
    m.set(k, [...(m.get(k) ?? []), p]);
  }
  return m;
}
