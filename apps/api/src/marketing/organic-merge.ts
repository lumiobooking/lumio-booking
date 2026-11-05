/**
 * ONE MONTH'S SOCIAL NUMBERS MUST NOT FLICKER.
 *
 * The daily sync re-reads every salon's month. Meta and TikTok answer some
 * calls and refuse others at random (rate limits, a token that lost a
 * permission for an hour, a metric that times out). The row used to be
 * replaced whole with each answer, so a number read yesterday became "—"
 * today and came back tomorrow: "lúc có lúc không".
 *
 * Rule: a field the platform did not answer this time (null) keeps the value
 * we already had for that month — from an earlier sync or typed by hand.
 * A real answer (including 0) always wins. The fields kept are listed, so the
 * report can say a number is from an earlier read.
 *
 * Views also carry WHERE they came from ('page' = the platform's own monthly
 * total, 'posts' = the month's posts added up). Two different measures must
 * not be compared month to month: that printed "▼90%" when one month was the
 * Page total and the next the posts' sum.
 */

export const ORGANIC_FIELDS = ['followers', 'newFollowers', 'reach', 'views', 'engagement', 'profileViews', 'postsCount'] as const;
export type OrganicField = (typeof ORGANIC_FIELDS)[number];

export type OrganicRow = Partial<Record<OrganicField, number | null>> & { raw?: unknown; source?: string | null };

const rawOf = (r: OrganicRow | null | undefined): Record<string, unknown> =>
  r?.raw && typeof r.raw === 'object' && !Array.isArray(r.raw) ? (r.raw as Record<string, unknown>) : {};

/** The new read, with any field it left blank filled from what was stored. Pure. */
export function mergeOrganic(prev: OrganicRow | null | undefined, next: OrganicRow): { row: OrganicRow; kept: OrganicField[] } {
  const row: OrganicRow = { ...next };
  const kept: OrganicField[] = [];
  if (!prev) return { row, kept };
  const pr = rawOf(prev);
  const nr = { ...rawOf(next) };
  for (const f of ORGANIC_FIELDS) {
    if (row[f] == null && prev[f] != null) {
      // Views from a different measure than the one this read would have used stays — it is still the best we have.
      row[f] = prev[f] as number;
      kept.push(f);
    }
  }
  if (kept.includes('views') && pr.viewsSource != null) nr.viewsSource = pr.viewsSource;
  // The post list: an empty list with no count is "could not read", not "posted nothing".
  const prevPosts = Array.isArray(pr.posts) ? pr.posts : [];
  const nextPosts = Array.isArray(nr.posts) ? nr.posts : [];
  if (!nextPosts.length && next.postsCount == null && prevPosts.length) nr.posts = prevPosts;
  for (const k of ['series', 'audience'] as const) {
    const empty = nr[k] == null || (Array.isArray(nr[k]) && !(nr[k] as unknown[]).length);
    if (empty && pr[k] != null && !(Array.isArray(pr[k]) && !(pr[k] as unknown[]).length)) nr[k] = pr[k];
  }
  nr.kept = kept;
  row.raw = nr;
  return { row, kept };
}

/**
 * Views of two months are comparable only when measured the same way. A row
 * from before the measure was recorded compares only with another such row:
 * the first month after the change prints no arrow rather than a wrong one.
 */
export function sameViewsMeasure(cur: OrganicRow | null | undefined, prev: OrganicRow | null | undefined): boolean {
  return (rawOf(cur).viewsSource ?? null) === (rawOf(prev).viewsSource ?? null);
}
