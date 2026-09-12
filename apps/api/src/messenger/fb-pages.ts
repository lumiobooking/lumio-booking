/**
 * Walking Meta's cursor, so an agency sees all of its clients' Pages.
 *
 * WHAT WAS WRONG
 *
 * `/me/accounts` was fetched once. Graph returns 25 rows per collection by
 * default and hands back a cursor for the rest; the cursor was never followed.
 * An account holding sixty client Pages therefore showed twenty-five, and the
 * other thirty-five were not "hard to connect" — as far as this product was
 * concerned they did not exist. The picker's own search box said "search in 25
 * pages", which reads as a fact about the account. It was a fact about one
 * unfollowed cursor.
 *
 * WHY IT LIVES HERE AND NOT IN THE SERVICE
 *
 * The walk has the properties worth testing — where it stops, what it does
 * with a half-failed run, what it does when Meta repeats a row — and none of
 * them are worth standing a Nest container up to check. It takes its fetcher
 * as an argument, so a test is a function that returns objects.
 */

/** One row of Graph's /me/accounts — a Page and the token that speaks for it. */
export interface FbPageRow {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: { id?: string };
}

export interface FbPagesBody {
  data?: FbPageRow[];
  paging?: { next?: string };
  error?: { message?: string };
}

/** Fetch one URL and give back Graph's parsed body, or throw. */
export type GraphFetch = (url: string) => Promise<FbPagesBody>;

/**
 * A cursor loop against somebody else's API is a hung OAuth callback waiting
 * to happen, so the walk is bounded on both axes and says so in the trace when
 * it stops early rather than pretending it saw everything.
 */
export const FB_PAGE_LIMIT = 100;
export const FB_MAX_HOPS = 12;
export const FB_MAX_ROWS = 600;

export function firstAccountsUrl(userToken: string): string {
  return 'https://graph.facebook.com/v21.0/me/accounts'
    + `?limit=${FB_PAGE_LIMIT}&fields=id,name,access_token,instagram_business_account`
    + `&access_token=${encodeURIComponent(userToken)}`;
}

export interface WalkResult {
  pages: FbPageRow[];
  /** Set only when NOTHING could be read. A later hop failing is not an error:
   *  eighty of a hundred Pages beats an error message and none of them. */
  error?: string;
  /** True when the walk stopped while Meta still had more to give. */
  truncated: boolean;
}

export async function walkFbPages(
  userToken: string,
  get: GraphFetch,
  trace: string[] = [],
): Promise<WalkResult> {
  const out: FbPageRow[] = [];
  const seen = new Set<string>();
  let url: string | null = firstAccountsUrl(userToken);
  let truncated = false;

  for (let hop = 0; url && hop < FB_MAX_HOPS; hop += 1) {
    let body: FbPagesBody;
    try {
      body = await get(url);
    } catch (e) {
      trace.push(`accounts hop ${hop + 1}: THREW — ${String(e).slice(0, 90)}`);
      if (!out.length) return { pages: [], error: `network:${String(e).slice(0, 100)}`, truncated: true };
      return { pages: out, truncated: true };
    }
    if (body?.error) {
      trace.push(`accounts hop ${hop + 1}: ERROR — ${body.error.message || 'unknown'}`);
      if (!out.length) return { pages: [], error: body.error.message || 'unknown', truncated: true };
      return { pages: out, truncated: true };
    }
    const batch = body?.data ?? [];
    // Meta repeats rows across cursor pages when the underlying list shifts
    // mid-walk. Without the id set an agency gets the same Page twice and the
    // picker shows a duplicate it cannot explain.
    for (const row of batch) {
      if (row && row.id && !seen.has(row.id)) { seen.add(row.id); out.push(row); }
    }
    trace.push(`accounts hop ${hop + 1}: +${batch.length} (total ${out.length})`);
    url = body?.paging?.next ?? null;
    if (out.length >= FB_MAX_ROWS) {
      trace.push(`accounts: stopped at the ${FB_MAX_ROWS}-page ceiling`);
      truncated = Boolean(url);
      break;
    }
    if (url && hop === FB_MAX_HOPS - 1) {
      trace.push('accounts: more pages exist beyond the hop limit');
      truncated = true;
    }
  }
  return { pages: out, truncated };
}
