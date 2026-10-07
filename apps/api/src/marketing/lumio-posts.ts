/**
 * POSTS LUMIO ITSELF PUT ON A CHANNEL, for the monthly report.
 *
 * TikTok only tells an app how many videos an account posted when the app holds
 * the `video.list` permission, and the owner decided not to apply for more
 * TikTok permissions. So the report's "posts" line for TikTok was empty. But
 * every post Lumio published is in our own table, with the network's answer
 * (id, link) — that is a count we can stand behind: "N videos posted through
 * Lumio this month". It does not count what the salon posted by hand in the
 * TikTok app, and the report says so (source: 'lumio').
 */

export interface PostRowLike { postedAt: Date | string | null; results: unknown }
export interface LumioPost { url: string | null; timestamp: string | null; id: string | null }

/** Successful posts on `channel` whose post went up in [from, to). Pure. */
export function lumioPostsOn(rows: PostRowLike[], channel: string, from: Date, to: Date): LumioPost[] {
  const out: LumioPost[] = [];
  for (const r of rows) {
    const at = r.postedAt ? new Date(r.postedAt) : null;
    if (!at || Number.isNaN(at.getTime()) || at < from || at >= to) continue;
    const results = Array.isArray(r.results) ? (r.results as Record<string, unknown>[]) : [];
    for (const x of results) {
      if (!x || x.channel !== channel) continue;
      // A failure, or a network that did not answer ("unsure"), is not a post we can vouch for.
      if (x.error || x.unsure) continue;
      out.push({ url: typeof x.url === 'string' ? x.url : null, timestamp: at.toISOString(), id: typeof x.id === 'string' ? x.id : null });
    }
  }
  return out;
}

/** UTC month bounds, "2026-10" → [Oct 1, Nov 1). */
export function monthBounds(month: string): { from: Date; to: Date } {
  const [y, m] = month.split('-').map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}
