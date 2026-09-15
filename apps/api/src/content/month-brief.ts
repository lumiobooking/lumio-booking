/**
 * THE MONTH, IN THE OWNER'S WORDS — written by the team, read by the shop.
 *
 * WHY THIS EXISTS
 *
 * The 30-day grid shows what will be posted on which day. That is the team's
 * view of a month. The shop owner's question is different and comes first:
 * what is this month FOR, what are we going after, and what do you need from
 * me? A calendar of forty chips does not answer it; a paragraph does.
 *
 * So each month carries a short brief with four parts, in the order an owner
 * reads them: the focus (the one problem this month works on), the goals
 * (what "it worked" will look like), the direction (what the posts will be
 * about), and what the shop must supply for any of it to happen. The last
 * part is a checklist on purpose — it is the only part the owner acts on.
 *
 * The team writes it on the plan screen. The shop sees it at the top of its
 * own screen and on its phone, above the week's jobs, in plain words: no
 * method, no metrics vocabulary, nothing that needs the team to explain.
 */

export interface MonthBrief {
  /** "YYYY-MM", the salon's calendar month. */
  month: string;
  /** The one problem this month works on. */
  focus: string;
  /** What success looks like by the end of the month. */
  goals: string;
  /** What the content will be about — themes, not a list of posts. */
  direction: string;
  /** What the shop must supply or do. One item per line. */
  needs: string[];
  updatedAt: string | null;
  updatedBy: string | null;
}

export const MONTH_BRIEF_KEY = 'content_month_brief';
export const BRIEF_LIMITS = { focus: 300, goals: 500, direction: 700, needItem: 160, needs: 12 } as const;

/** "2026-09" for an instant in a zone. */
export function monthKeyIn(at: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit' }).formatToParts(at);
    const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
    const m = parts.find((p) => p.type === 'month')?.value ?? '01';
    return `${y}-${m}`;
  } catch {
    return at.toISOString().slice(0, 7);
  }
}

export function isMonthKey(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function emptyBrief(month: string): MonthBrief {
  return { month, focus: '', goals: '', direction: '', needs: [], updatedAt: null, updatedBy: null };
}

const clean = (v: unknown, max: number) => String(v ?? '').replace(/\r/g, '').trim().slice(0, max);

/** A stored or submitted brief, validated. Never throws; junk reads as empty. */
export function cleanBrief(raw: unknown, month: string): MonthBrief {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const needsRaw = Array.isArray(o.needs)
    ? o.needs
    : typeof o.needs === 'string' ? o.needs.split('\n') : [];
  const needs = needsRaw.map((n) => clean(n, BRIEF_LIMITS.needItem)).filter(Boolean).slice(0, BRIEF_LIMITS.needs);
  return {
    month,
    focus: clean(o.focus, BRIEF_LIMITS.focus),
    goals: clean(o.goals, BRIEF_LIMITS.goals),
    direction: clean(o.direction, BRIEF_LIMITS.direction),
    needs,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : null,
    updatedBy: typeof o.updatedBy === 'string' ? o.updatedBy : null,
  };
}

/** True when there is something worth showing the shop. */
export function briefHasContent(b: MonthBrief): boolean {
  return Boolean(b.focus || b.goals || b.direction || b.needs.length);
}

/**
 * What the SHOP sees — the same fields, and nothing the team did not write
 * for the shop to read. There is no method in a brief by construction, but
 * the rebuild-field-by-field rule of client-view applies here too: a field
 * added to MonthBrief later does not reach the shop until someone lists it.
 */
export function briefForShop(b: MonthBrief | null): {
  month: string; focus: string; goals: string; direction: string; needs: string[]; updatedAt: string | null;
} | null {
  if (!b || !briefHasContent(b)) return null;
  return { month: b.month, focus: b.focus, goals: b.goals, direction: b.direction, needs: b.needs, updatedAt: b.updatedAt };
}
