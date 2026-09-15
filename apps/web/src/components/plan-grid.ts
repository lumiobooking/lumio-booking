/**
 * The arithmetic behind the 30-day grid — kept out of the .tsx on purpose.
 *
 * The web test project compiles TypeScript but not JSX, so a spec that imports
 * a component file cannot even load. Everything a test needs to prove — how
 * days are laid out, how blocks tile, which day a post lands on — lives here,
 * in plain TypeScript, and PlanGrid.tsx draws it.
 */

import type { Job, WeekView } from './WeekPlanBoard';
import { dayKeyInTz } from '../lib/datetime';

export interface AheadBlock {
  weekKey: string;
  label: string;
  /** Salon-local date of the block's first day, "YYYY-MM-DD". */
  from: string;
  startDate: string;
  week: WeekView;
  edited: boolean;
  approvedAt: string | null;
  ticks: Record<string, number[]>;
  auto: Record<string, number[]>;
}

export interface GridPost {
  id: string;
  channels: string[];
  message: string;
  scheduledAt: string;
  status: string;
  media?: { url: string; kind: string }[];
  stage?: string | null;
  held?: unknown;
}

export const KIND_ICON: Record<string, string> = {
  film: '🎬', photo: '📷', post: '📤', story: '📸', offer: '🏷️', winback: '💬', engage: '💚', gbp: '📍', event: '🎪', rest: '·',
};
export const CH_DOT: Record<string, string> = { facebook: '#1877f2', instagram: '#e1306c', google: '#34a853', tiktok: '#69c9d0' };

export const WD_VI = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
export const WD_EN = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const MONTH_VI = ['Th1', 'Th2', 'Th3', 'Th4', 'Th5', 'Th6', 'Th7', 'Th8', 'Th9', 'Th10', 'Th11', 'Th12'];
export const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "YYYY-MM-DD" + n days, in plain calendar arithmetic (no zones involved). */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}
/** Whole days from `a` to `b`, both "YYYY-MM-DD". Negative when b is earlier. */
export function daysBetween(a: string, b: string): number {
  const u = (k: string) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((u(b) - u(a)) / 86_400_000);
}
/** 0 = Monday … 6 = Sunday, for a "YYYY-MM-DD" key. */
export function mondayIndex(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export interface GridDay {
  key: string;
  jobs: { job: Job; weekKey: string; done: boolean; who: 'salon' | 'agency' | null }[];
  posts: GridPost[];
  /** Inside the 30-day window the grid is about. */
  inWindow: boolean;
  past: boolean;
  today: boolean;
}

/**
 * Lay the plan blocks and the posts onto calendar days.
 *
 * Pure, so it is testable: given blocks that each start on `from` and run
 * seven days, and posts with instants, produce one row per calendar day from
 * this week's Monday through the fifth Sunday.
 */
export function layoutGrid(blocks: AheadBlock[], posts: GridPost[], todayKey: string, tz: string): GridDay[] {
  const first = addDays(todayKey, -mondayIndex(todayKey));
  const days: GridDay[] = [];
  const byKey = new Map<string, GridDay>();
  for (let i = 0; i < 35; i++) {
    const key = addDays(first, i);
    const offset = daysBetween(todayKey, key);
    const day: GridDay = { key, jobs: [], posts: [], inWindow: offset >= 0 && offset < 30, past: offset < 0, today: offset === 0 };
    days.push(day);
    byKey.set(key, day);
  }
  for (const b of blocks) {
    const isDone = (j: Job) => {
      const st = j.brief?.steps ?? [];
      if (!st.length || !j.id) return false;
      const t = [...(b.ticks[j.id] ?? []), ...(b.auto?.[j.id] ?? [])];
      return st.every((_, i) => t.includes(i));
    };
    b.week.days.forEach((d, i) => {
      const day = byKey.get(addDays(b.from, i));
      if (!day) return;
      for (const job of d.jobs) {
        if (job.kind === 'rest') continue;
        day.jobs.push({ job, weekKey: b.weekKey, done: isDone(job), who: ((job as { who?: 'salon' | 'agency' }).who ?? null) });
      }
    });
  }
  for (const p of posts) {
    if (p.status === 'cancelled' || p.status === 'expired') continue;
    const day = byKey.get(dayKeyInTz(p.scheduledAt, tz));
    if (day) day.posts.push(p);
  }
  for (const d of days) d.posts.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  return days;
}
