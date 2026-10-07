/**
 * MỤC TIÊU RIÊNG — pure. A technician's own targets for the week and the
 * month (service sales, visits), and how far along she is. Hers alone: set
 * from her app, read back only by her, never shown to the owner or the team.
 */

export interface Goal { weekCents: number | null; monthCents: number | null; weekVisits: number | null; monthVisits: number | null }
export interface Actual { serviceCents: number; visits: number }

const int = (v: unknown, max: number): number | null => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, max);
};

/** What she typed, kept sane: whole positive numbers, nothing absurd; empty = no goal. */
export function cleanGoal(raw: unknown): Goal {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    weekCents: int(r.weekCents, 1_000_000_000),
    monthCents: int(r.monthCents, 1_000_000_000),
    weekVisits: int(r.weekVisits, 10_000),
    monthVisits: int(r.monthVisits, 10_000),
  };
}

export function hasGoal(g: Goal): boolean {
  return g.weekCents != null || g.monthCents != null || g.weekVisits != null || g.monthVisits != null;
}

export interface Progress { key: 'weekCents' | 'monthCents' | 'weekVisits' | 'monthVisits'; target: number; actual: number; pct: number; left: number; done: boolean }

/** Each goal she set, with where she stands. pct is capped at 100 for the bar; `done` once reached. */
export function goalProgress(g: Goal, week: Actual, month: Actual): Progress[] {
  const out: Progress[] = [];
  const push = (key: Progress['key'], target: number | null, actual: number) => {
    if (target == null) return;
    const pct = Math.min(100, Math.round((actual / target) * 100));
    out.push({ key, target, actual, pct, left: Math.max(0, target - actual), done: actual >= target });
  };
  push('weekCents', g.weekCents, week.serviceCents);
  push('weekVisits', g.weekVisits, week.visits);
  push('monthCents', g.monthCents, month.serviceCents);
  push('monthVisits', g.monthVisits, month.visits);
  return out;
}

/** Monday → Sunday of the week holding `day` (YYYY-MM-DD), and the 1st → last of its month. */
export function weekAndMonth(day: string): { week: { from: string; to: string }; month: { from: string; to: string } } {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const shift = (base: Date, n: number) => { const x = new Date(base); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const lastOfMonth = new Date(Date.UTC(y, m + 1, 0, 12)).toISOString().slice(0, 10);
  return { week: { from: shift(d, -dow), to: shift(d, 6 - dow) }, month: { from: `${day.slice(0, 7)}-01`, to: lastOfMonth } };
}
