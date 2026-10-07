import { clip } from '../../common/json-safe';
import { inWindow, isOwnFbPost, monthWindow, type MonthWindow } from '../month-window';
import {
  ChannelCreds,
  MonthlyMetrics,
  OrganicMetrics,
  OrganicResult,
  PostInsight,
  SocialConnector,
  VerifyResult,
  getJson,
  monthBounds,
} from './social-connector.interface';

// Version is env-overridable: Meta retires older versions ~2 years out and
// gates metric availability by version, so bumping it must NOT need a code change.
const GRAPH = 'https://graph.facebook.com/' + (process.env.META_GRAPH_VERSION || 'v21.0');
const numOrNull = (v: any) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/**
 * Facebook Page + linked Instagram ORGANIC insights (reach, views, engagement,
 * follower growth) for the monthly client report. Reads on the shared agency
 * System-User token; the salon only supplies its Facebook Page ID/username and
 * the linked IG account is auto-resolved from the Page.
 *
 * Resilience first: Meta deprecated most Page-Insights metrics across Nov-2025
 * and Jun-2026, so EVERY metric is fetched independently and any failure yields
 * null — a dead metric drops out of the report instead of breaking the sync.
 * Follower TOTALS come from stable node fields, never from an insight.
 */
export class MetaSocialConnector implements SocialConnector {
  readonly platform = 'meta_social' as const;
  readonly label = 'Facebook & Instagram (organic)';
  readonly enabled = true;
  readonly hasSpend = false;

  /** Accept a numeric Page ID, a @username, or a full facebook.com URL. */
  private pageRef(creds: ChannelCreds): string {
    let s = (creds.externalAccountId || '').trim();
    if (!s) return s;
    const m = s.match(/facebook\.com\/(?:profile\.php\?id=)?([^/?#]+)/i);
    if (m) s = m[1];
    return s.replace(/^@/, '');
  }

  async verify(creds: ChannelCreds): Promise<VerifyResult> {
    const token = creds.token;
    if (!token) return { ok: false, error: 'Thiếu agency token trên server (META_AGENCY_TOKEN)' };
    const ref = this.pageRef(creds);
    if (!ref) return { ok: false, error: 'Cần Facebook Page ID hoặc username' };
    const r = await getJson(
      `${GRAPH}/${encodeURIComponent(ref)}?fields=name,followers_count,fan_count,instagram_business_account{username}&access_token=${encodeURIComponent(token)}`,
    );
    if (!r.ok) return { ok: false, error: r.json?.error?.message || `Meta ${r.status}` };
    if (!r.json?.id && !r.json?.name) return { ok: false, error: 'Không đọc được Trang (kiểm tra Page ID và asset đã gán cho token)' };
    const ig = r.json?.instagram_business_account?.username;
    const name = r.json?.name ? `${r.json.name}${ig ? ` · IG @${ig}` : ''}` : undefined;
    return { ok: true, accountName: name };
  }

  /** meta_social carries no ad spend — organic sync uses fetchOrganic instead. */
  async fetchMonthly(): Promise<MonthlyMetrics> {
    return { raw: { note: 'meta_social is organic-only; use fetchOrganic' } };
  }

  // ---- Graph helpers -------------------------------------------------------

  private async node(id: string, fields: string, token: string): Promise<any | null> {
    try {
      const r = await getJson(`${GRAPH}/${encodeURIComponent(id)}?fields=${fields}&access_token=${encodeURIComponent(token)}`);
      return r.ok ? r.json : null;
    } catch {
      return null;
    }
  }

  /**
   * One insight metric summed/aggregated over the range. Returns null on ANY
   * error (invalid/deprecated metric, permission, empty) so it never throws.
   */
  private async insight(
    id: string,
    metric: string,
    since: string,
    until: string,
    token: string,
    totalValue: boolean,
    errs?: string[],
  ): Promise<number | null> {
    const tv = totalValue ? '&metric_type=total_value' : '';
    const url = `${GRAPH}/${encodeURIComponent(id)}/insights?metric=${encodeURIComponent(metric)}&period=day${tv}&since=${since}&until=${until}&access_token=${encodeURIComponent(token)}`;
    try {
      const r = await getJson(url);
      if (!r.ok || !Array.isArray(r.json?.data) || !r.json.data.length) {
        // Kept, not swallowed: "why is this number blank" must be answerable
        // from the stored sync without anyone reproducing the call.
        errs?.push(`${metric}${totalValue ? '(total)' : ''}: ${String(r.json?.error?.message || (r.ok ? 'no data' : `HTTP ${r.status}`)).slice(0, 140)}`);
        return null;
      }
      const d = r.json.data[0];
      if (d?.total_value && d.total_value.value != null) return numOrNull(d.total_value.value);
      if (Array.isArray(d?.values)) {
        let sum = 0;
        let seen = false;
        for (const v of d.values) {
          const n = numOrNull(typeof v?.value === 'object' ? undefined : v?.value);
          if (n != null) { sum += n; seen = true; }
        }
        return seen ? sum : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Try candidate metric names (and both total_value/plain shapes); first hit wins. */
  private async firstInsight(
    id: string,
    metrics: string[],
    since: string,
    until: string,
    token: string,
    shapes: boolean[],
    errs?: string[],
    fallbackToken?: string,
  ): Promise<number | null> {
    // The second token only when it is a different one: trying the same
    // token twice doubles the calls and changes nothing.
    const tokens = fallbackToken && fallbackToken !== token ? [token, fallbackToken] : [token];
    for (const tk of tokens) {
      for (const m of metrics) {
        for (const tv of shapes) {
          const v = await this.insight(id, m, since, until, tk, tv, errs);
          if (v != null) return v;
        }
      }
    }
    return null;
  }

  private fb(id: string, metrics: string[], since: string, until: string, token: string) {
    return this.firstInsight(id, metrics, since, until, token, [false]);
  }

  /**
   * Facebook Page viewers for the month. Meta's 2026 metric
   * (page_total_media_view_unique) is a UNIQUE count, so it is asked for as
   * ONE month, never as daily values added up; the retired names follow.
   */
  private async fbMonthlyReach(id: string, since: string, until: string, token: string): Promise<number | null> {
    for (const period of ['month', 'days_28']) {
      try {
        const r = await getJson(`${GRAPH}/${encodeURIComponent(id)}/insights?metric=page_total_media_view_unique&period=${period}&since=${since}&until=${until}&access_token=${encodeURIComponent(token)}`);
        const d = r.ok && Array.isArray(r.json?.data) ? r.json.data[0] : null;
        const vals = Array.isArray(d?.values) ? d.values : [];
        // The last full-month value inside the range; days_28 is a rolling window — its last point is the closest to "the month".
        const v = vals.length ? numOrNull(vals[vals.length - 1]?.value) : null;
        if (v != null) return v;
      } catch { /* next */ }
    }
    return this.fb(id, ['page_impressions_unique', 'page_impressions_organic_unique'], since, until, token);
  }
  private ig(id: string, metrics: string[], since: string, until: string, token: string, errs?: string[], fallbackToken?: string) {
    // Newer IG metrics REQUIRE metric_type=total_value; older ones reject it.
    return this.firstInsight(id, metrics, since, until, token, [true, false], errs, fallbackToken);
  }

  /** Best-effort count of objects on a time-bounded edge (paged, capped at 100). */
  private async countEdge(id: string, edge: string, since: string, until: string, token: string): Promise<number | null> {
    try {
      const s = Math.floor(new Date(`${since}T00:00:00Z`).getTime() / 1000);
      const u = Math.floor(new Date(`${until}T23:59:59Z`).getTime() / 1000);
      const r = await getJson(`${GRAPH}/${encodeURIComponent(id)}/${edge}?fields=id&since=${s}&until=${u}&limit=100&access_token=${encodeURIComponent(token)}`);
      if (!r.ok || !Array.isArray(r.json?.data)) return null;
      return r.json.data.length;
    } catch {
      return null;
    }
  }

  /** Instagram per-post breakdown for the month: media list + each post's
   *  interactions (reach/views/saved/shares/total). Resilient — a post whose
   *  insights fail still reports likes/comments from the node fields. */
  private async igMediaBreakdown(igId: string, win: MonthWindow, token: string, fallbackToken?: string, errs?: string[]): Promise<{ posts: PostInsight[]; count: number }> {
    const s = Math.floor(win.from / 1000), u = Math.floor(win.to / 1000);
    let list: any[] = [];
    // Newest first, 50 a page. The old read took ONE page: a month with more
    // than 50 posts — or an earlier month once 50 newer posts existed, when
    // the edge ignores since/until — was cut short. Pages are followed until
    // the media are older than the month.
    let next: string | null = `${GRAPH}/${encodeURIComponent(igId)}/media?fields=id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count&since=${s}&until=${u}&limit=50&access_token=${encodeURIComponent(token)}`;
    try {
      for (let page = 0; next && page < 12; page++) {
        const r = await getJson(next);
        next = null;
        if (!r.ok || !Array.isArray(r.json?.data)) break;
        const data = r.json.data as any[];
        list.push(...data);
        const oldest = Math.min(...data.map((m) => Date.parse(m?.timestamp || '')).filter(Number.isFinite));
        const nx = r.json?.paging?.next;
        if (data.length && typeof nx === 'string' && nx.startsWith('https://') && !(oldest < win.from)) next = nx;
      }
    } catch {
      if (!list.length) return { posts: [], count: 0 };
    }
    // Strict month filter (salon time): a post that cannot prove its month is not counted.
    const seen = new Set<string>();
    list = list.filter((m) => m?.id && !seen.has(String(m.id)) && seen.add(String(m.id)) && inWindow(m?.timestamp, win));
    // The true monthly count, taken BEFORE the display cap — the count used to stop at 40.
    const count = list.length;
    list = list.slice(0, 40);

    let postErrs = 0;
    // Per-post insights need instagram_manage_insights; the token that listed
    // the posts may not hold it, so the second token gets a turn.
    const tokens = fallbackToken && fallbackToken !== token ? [token, fallbackToken] : [token];
    const insights = async (mediaId: string, metrics: string[]): Promise<Record<string, number | null> | null> => {
      for (const tk of tokens) {
        try {
          const r = await getJson(`${GRAPH}/${encodeURIComponent(mediaId)}/insights?metric=${metrics.join(',')}&access_token=${encodeURIComponent(tk)}`);
          if (!r.ok || !Array.isArray(r.json?.data)) {
            if (errs && postErrs++ < 2) errs.push(`post ${metrics.length > 1 ? metrics.join('+') : metrics[0]}: ${String(r.json?.error?.message || `HTTP ${r.status}`).slice(0, 140)}`);
            continue;
          }
          const map: Record<string, number | null> = {};
          for (const d of r.json.data) { const v = d?.values?.[0]?.value ?? d?.total_value?.value; map[d.name] = numOrNull(v); }
          return map;
        } catch {
          /* next token */
        }
      }
      return null;
    };

    const posts = await Promise.all(list.map(async (m): Promise<PostInsight> => {
      const isReel = String(m.media_product_type || '').toUpperCase() === 'REELS' || String(m.media_type || '').toUpperCase() === 'VIDEO';
      let ins = await insights(m.id, ['reach', 'saved', 'shares', 'total_interactions', 'views']);
      if (!ins) ins = await insights(m.id, ['reach', 'saved', 'shares', 'total_interactions']);
      if (!ins) ins = (await insights(m.id, ['reach'])) ?? {};
      // One metric Instagram will not give for this kind of post fails the
      // whole list above, and the fallbacks drop views. Views are what the
      // top-posts ranking sorts by, so they are asked for on their own.
      if (ins.views == null) {
        const v = await insights(m.id, ['views']);
        if (v?.views != null) ins = { ...ins, views: v.views };
      }
      const likes = numOrNull(m.like_count), comments = numOrNull(m.comments_count);
      const interactions = ins.total_interactions ?? ((likes ?? 0) + (comments ?? 0) + (ins.saved ?? 0) + (ins.shares ?? 0));
      return {
        id: String(m.id),
        type: isReel ? 'reel' : String(m.media_type || 'post').toLowerCase(),
        timestamp: m.timestamp ?? null,
        permalink: m.permalink ?? null,
        thumbnail: m.thumbnail_url || m.media_url || null,
        caption: m.caption ? clip(String(m.caption).replace(/\s+/g, ' '), 120) : null,
        likes,
        comments,
        reach: ins.reach ?? null,
        views: ins.views ?? null,
        saved: ins.saved ?? null,
        shares: ins.shares ?? null,
        interactions,
      };
    }));
    posts.sort((a, b) => (b.interactions ?? 0) - (a.interactions ?? 0));
    return { posts, count };
  }

  /** Daily new-follows over the month (IG). Frontend turns it into a growth line. */
  private async igFollowerSeries(igId: string, since: string, until: string, token: string): Promise<{ date: string; value: number }[]> {
    try {
      const r = await getJson(`${GRAPH}/${encodeURIComponent(igId)}/insights?metric=follower_count&period=day&since=${since}&until=${until}&access_token=${encodeURIComponent(token)}`);
      const vals = r.json?.data?.[0]?.values;
      if (!r.ok || !Array.isArray(vals)) return [];
      return vals.map((v: { end_time?: string; value?: unknown }) => ({ date: String(v?.end_time || '').slice(0, 10), value: numOrNull(v?.value) ?? 0 })).filter((x) => x.date);
    } catch {
      return [];
    }
  }

  /** IG follower demographics: gender + age breakdown (needs >= 100 followers). */
  private async igAudience(igId: string, token: string): Promise<{ gender?: Record<string, number>; age?: Record<string, number> } | null> {
    const one = async (breakdown: string): Promise<Record<string, number> | null> => {
      try {
        const r = await getJson(`${GRAPH}/${encodeURIComponent(igId)}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=${breakdown}&access_token=${encodeURIComponent(token)}`);
        const results = r.json?.data?.[0]?.total_value?.breakdowns?.[0]?.results;
        if (!r.ok || !Array.isArray(results)) return null;
        const map: Record<string, number> = {};
        for (const it of results) { const k = String(it?.dimension_values?.[0] ?? ''); const v = numOrNull(it?.value); if (k && v != null) map[k] = v; }
        return Object.keys(map).length ? map : null;
      } catch {
        return null;
      }
    };
    const [gender, age] = await Promise.all([one('gender'), one('age')]);
    if (!gender && !age) return null;
    return { gender: gender ?? undefined, age: age ?? undefined };
  }

  /** Facebook post breakdown for the month. Page-level Insights are deprecated,
   *  but per-post like/comment/share COUNTS still come from node-edge summaries
   *  (published_posts, falling back to /feed) — so FB engagement is still real. */
  private async fbPostBreakdown(pageId: string, win: MonthWindow, token: string): Promise<{ posts: PostInsight[]; monthCount: number | null; status: number; error: string | null }> {
    const s = Math.floor(win.from / 1000), u = Math.floor(win.to / 1000);
    // A PAGE access token (minted from the system-user token for the assigned page)
    // is the reliable way to read a page's own posts. Fall back to the agency token.
    let pageToken = token;
    try {
      const tk = await getJson(`${GRAPH}/${encodeURIComponent(pageId)}?fields=access_token&access_token=${encodeURIComponent(token)}`);
      if (tk.ok && tk.json?.access_token) pageToken = String(tk.json.access_token);
    } catch { /* keep agency token */ }
    // Try every place FB content can live: normal posts (published_posts/feed/posts)
    // AND Reels (video_reels — a separate edge). Reels are what most salons post,
    // and crossposted IG Reels land here. Client-side filter by date afterwards.
    // `from`: the feed also carries visitors' posts on the Page — only the Page's own count.
    const postFields = 'id,message,story,from,created_time,permalink_url,full_picture,shares,likes.summary(true),comments.summary(true)';
    // created_time is asked for on Reels too: `updated_time` moves whenever a
    // Reel is edited, which put an August Reel into September's count.
    const reelFields = 'id,description,created_time,updated_time,permalink_url,likes.summary(true),comments.summary(true)';
    // since/until on every edge, and pages followed: a bare `limit=60` read
    // the page's 60 NEWEST items, so a report for an earlier month missed
    // posts whenever the page had posted a lot since.
    const range = `&since=${s}&until=${u}`;
    const edges: Array<[string, string]> = [
      ['published_posts', postFields],
      ['feed', postFields],
      ['posts', postFields],
      ['video_reels', reelFields],
    ];
    const collected: Record<string, unknown>[] = [];
    // One post can come back twice: as a Page post (id "page_post", permalink
    // .../reel/123 or .../videos/123) AND on the video_reels edge (id "123").
    // Keyed by the video id when there is one, so a Reel counts once.
    const byKey = new Map<string, Record<string, unknown>>();
    const videoIdOf = (it: Record<string, unknown>, edge: string): string | null => {
      if (edge === 'video_reels') return String(it.id ?? '') || null;
      const m = String(it.permalink_url ?? '').match(/\/(?:reel|videos)\/(\d+)/i);
      return m ? m[1] : null;
    };
    let status = 0;
    let error: string | null = null;
    // Which edges answered and which refused — kept per edge, so a month that
    // read only Reels (the three post edges all refused) still says so instead
    // of reporting "2 bài" as if that were the whole month.
    const edgeOk = new Set<string>();
    const edgeErr: Record<string, string> = {};
    for (const [edge, flds] of edges) {
      // Three ways to ask, in order: the month window; the same without a
      // window (an edge that refuses since/until); and a minimal field list
      // without `from` / `story` / `shares` (a field the token may not read
      // makes Graph refuse the WHOLE call — better a post without its author
      // than no posts at all; the own-post filter then simply has no `from`).
      const slim = flds.replace(/,(from|story|shares|full_picture)(?=,|$)/g, '');
      const attempts = [
        `${GRAPH}/${encodeURIComponent(pageId)}/${edge}?fields=${flds}&limit=100${range}&access_token=${encodeURIComponent(pageToken)}`,
        `${GRAPH}/${encodeURIComponent(pageId)}/${edge}?fields=${flds}&limit=100&access_token=${encodeURIComponent(pageToken)}`,
        `${GRAPH}/${encodeURIComponent(pageId)}/${edge}?fields=${slim}&limit=100${range}&access_token=${encodeURIComponent(pageToken)}`,
      ];
      let attempt = 0;
      let next: string | null = attempts[0];
      for (let page = 0; next && page < 5; page++) {
        try {
          const r = await getJson(next);
          status = r.status;
          next = null;
          if (r.ok && Array.isArray(r.json?.data)) {
            error = null;
            edgeOk.add(edge);
            for (const it of r.json.data as Record<string, unknown>[]) {
              const id = String(it?.id ?? '');
              if (!id) continue;
              const vid = videoIdOf(it, edge);
              const key = vid ? `v:${vid}` : `p:${id}`;
              const had = byKey.get(key);
              if (had) {
                // Keep what the first copy had (caption, picture), fill the gaps.
                for (const [k, v] of Object.entries(it)) if (had[k] == null && v != null) had[k] = v;
                if (vid) had._vid = vid;
                continue;
              }
              const row = { ...it, ...(vid ? { _vid: vid } : {}) };
              byKey.set(key, row);
              collected.push(row);
            }
            const nx = r.json?.paging?.next;
            if (typeof nx === 'string' && nx.startsWith('https://') && r.json.data.length) next = nx;
          } else {
            const msg = r.json?.error?.message ? String(r.json.error.message).slice(0, 140) : `HTTP ${r.status}`;
            edgeErr[edge] = msg;
            if (page === 0 && attempt < attempts.length - 1) {
              // The month filter below still applies to whatever the next way returns.
              attempt += 1;
              next = attempts[attempt];
              page = -1;
            } else if (!error) {
              error = msg;
            }
          }
        } catch (e) { const msg = String((e as Error).message).slice(0, 120); edgeErr[edge] = msg; if (!error) error = msg; next = null; }
      }
    }
    // Reels came in but every ordinary-post edge refused: say which and why,
    // because the count is then Reels only, not the month.
    const postEdges = ['published_posts', 'feed', 'posts'];
    if (!postEdges.some((e) => edgeOk.has(e))) {
      const why = postEdges.map((e) => edgeErr[e]).find(Boolean);
      if (why) error = `bài thường không đọc được (${why})`;
    }
    let list = collected;
    // STRICT month filter. The old rule kept anything whose date failed to
    // parse — and Reels carry `updated_time`, not `created_time`, so every
    // Reel the page ever posted passed as "this month" forever. That is how a
    // salon read "Tổng bài 40" twelve months in a row. A post that cannot
    // prove its month does not belong in a monthly count.
    list = list.filter((m) => {
      const mm = m as { created_time?: string; updated_time?: string; from?: { id?: string }; story?: string; message?: string };
      return inWindow(mm.created_time || mm.updated_time, win) && isOwnFbPost(mm, pageId);
    });
    // The true monthly count, taken BEFORE the display cap: the report says
    // how many were posted, the list shows at most 40 of them.
    const fbMonthCount = list.length;
    list = list.slice(0, 40);
    const posts: PostInsight[] = list.map((m: any) => {
      const likes = numOrNull(m?.likes?.summary?.total_count);
      const comments = numOrNull(m?.comments?.summary?.total_count);
      const shares = numOrNull(m?.shares?.count);
      const cap = m?.message || m?.story || m?.description || '';
      const isVid = Boolean(m?._vid) || /\/(videos|reel)/i.test(String(m?.permalink_url || '')) || m?.description != null;
      return {
        id: String(m._vid ?? m.id),
        type: isVid ? 'reel' : 'post',
        timestamp: m.created_time ?? m.updated_time ?? null,
        permalink: m.permalink_url ?? null,
        thumbnail: m.full_picture ?? null,
        caption: cap ? clip(String(cap).replace(/\s+/g, ' '), 120) : null,
        likes,
        comments,
        reach: null,
        views: null,
        saved: null,
        shares,
        interactions: (likes ?? 0) + (comments ?? 0) + (shares ?? 0),
      };
    });
    // Every post's views and viewers, from post insights. Meta's 2026 names
    // first (post_media_views = "Lượt xem" in Business Suite, post_total_media_
    // views_unique = "Số người tiếp cận"); the pre-June-2026 names as a
    // fallback for whatever still answers to them. A photo post has views
    // too — before, only Reels were asked, so a month of photo posts read "0".
    const postNodeId = (m: any, p: PostInsight) => String(m?.id ?? p.id);
    await Promise.all(posts.map(async (p, i) => {
      const m = list[i] as any;
      const ins = async (id: string, metrics: string[]): Promise<Record<string, number> | null> => {
        try {
          const r = await getJson(`${GRAPH}/${encodeURIComponent(id)}/insights?metric=${metrics.join(',')}&access_token=${encodeURIComponent(pageToken)}`);
          if (!r.ok || !Array.isArray(r.json?.data)) return null;
          const out: Record<string, number> = {};
          for (const d of r.json.data) {
            const v = Array.isArray(d?.values) ? d.values[0]?.value : d?.value;
            const n = numOrNull(typeof v === 'object' ? undefined : v);
            if (d?.name && n != null) out[String(d.name)] = n;
          }
          return out;
        } catch { return null; }
      };
      const pid = postNodeId(m, p);
      let r = await ins(pid, ['post_media_views', 'post_total_media_views_unique']);
      if (!r || !Object.keys(r).length) r = await ins(pid, ['post_impressions', 'post_impressions_unique']);
      if (r) {
        p.views = r.post_media_views ?? r.post_impressions ?? p.views;
        p.reach = r.post_total_media_views_unique ?? r.post_impressions_unique ?? p.reach;
      }
      // A Reel's own play count + cover live on the video object; used when
      // post insights said nothing (a Reel read from the video_reels edge).
      if ((p.type === 'reel' || p.type === 'video') && (p.views == null || !p.thumbnail)) {
        try {
          const v = await getJson(`${GRAPH}/${encodeURIComponent(p.id)}?fields=views,picture&access_token=${encodeURIComponent(pageToken)}`);
          if (v.ok) { if (p.views == null) p.views = numOrNull(v.json?.views); if (!p.thumbnail && v.json?.picture) p.thumbnail = String(v.json.picture); }
        } catch { /* views/cover unavailable */ }
      }
    }));
    posts.sort((a, b) => (b.interactions ?? 0) - (a.interactions ?? 0));
    return { posts, monthCount: error && !posts.length ? null : fbMonthCount, status, error };
  }

  // ---- Organic pull --------------------------------------------------------

  async fetchOrganic(creds: ChannelCreds, month: string): Promise<OrganicResult> {
    const token = creds.token;
    if (!token) throw new Error('Thiếu agency token trên server (META_AGENCY_TOKEN)');
    const ref = this.pageRef(creds);
    if (!ref) throw new Error('Thiếu Facebook Page ID/username');
    const bounds = monthBounds(month);
    const since = bounds.since;
    // The month is not over yet? Ask up to TODAY. Instagram refuses an insights
    // range that ends in the future, and it refused it silently — the report
    // showed a blank reach, views and engagement for the current month.
    const today = new Date().toISOString().slice(0, 10);
    const until = bounds.until > today && since <= today ? today : bounds.until;
    const fallback = creds.fallbackToken;
    // Posts are counted midnight-to-midnight in the salon's own timezone.
    const win = monthWindow(month, creds.timezone);

    const page = await this.node(ref, 'id,name,followers_count,fan_count,instagram_business_account', token);
    if (!page || !page.id) {
      throw new Error('Không đọc được Facebook Page (kiểm tra Page ID và asset đã gán cho token)');
    }
    const pageId = page.id as string;
    const out: OrganicResult = {};

    // --- Facebook Page (organic). Most of these are deprecated in 2026 → null. ---
    // Page-level insights REQUIRE a Page access token (a system-user token alone
    // returns nothing), so mint one up front and use it for the reach/engagement/
    // new-follower reads. If it still comes back null, Meta genuinely dropped it.
    let fbPageToken = token;
    try {
      const tk = await getJson(`${GRAPH}/${encodeURIComponent(pageId)}?fields=access_token&access_token=${encodeURIComponent(token)}`);
      if (tk.ok && tk.json?.access_token) fbPageToken = String(tk.json.access_token);
    } catch { /* fall back to the system-user token */ }
    const [fbReach, fbViews, fbEngRaw, fbNewFollowers, fbRes] = await Promise.all([
      this.fbMonthlyReach(pageId, since, until, fbPageToken),
      this.fb(pageId, ['page_media_view', 'page_media_view_organic', 'page_impressions', 'page_views_total'], since, until, fbPageToken),
      this.fb(pageId, ['page_post_engagements'], since, until, fbPageToken),
      this.fb(pageId, ['page_daily_follows_unique', 'page_fan_adds_unique', 'page_fan_adds'], since, until, fbPageToken),
      this.fbPostBreakdown(pageId, win, token),
    ]);
    const fbPostList = fbRes.posts;
    // Page-level engagement insight is dead; sum per-post like+comment+share (still live) instead.
    const fbEngSum = fbPostList.length ? fbPostList.reduce((acc, p) => acc + (p.interactions ?? 0), 0) : null;
    const fbViewsSum = fbPostList.some((p) => p.views != null) ? fbPostList.reduce((acc, p) => acc + (p.views ?? 0), 0) : null;
    // No page-level monthly viewers from Meta? The posts' own viewers, added
    // up (a person reached by two posts counts twice — labelled as such).
    const fbReachSum = fbPostList.some((p) => p.reach != null) ? fbPostList.reduce((acc, p) => acc + (p.reach ?? 0), 0) : null;
    const fbReachFinal = fbReach ?? fbReachSum;
    const fb: OrganicMetrics = {
      accountName: page.name ?? null,
      followers: numOrNull(page.followers_count ?? page.fan_count),
      newFollowers: fbNewFollowers,
      reach: fbReachFinal,
      views: fbViewsSum ?? fbViews,
      engagement: fbEngSum ?? fbEngRaw,
      profileViews: null,
      postsCount: fbRes.monthCount,
      posts: fbPostList,
      raw: { pageId, name: page.name ?? null, fbDebug: { count: fbPostList.length, status: fbRes.status, error: fbRes.error, reachSource: fbReach != null ? 'page' : fbReachSum != null ? 'posts' : null } },
    };
    out.facebook = fb;

    // --- Instagram (organic), resolved from the linked business account. ---
    const igId: string | undefined = page.instagram_business_account?.id;
    if (igId) {
      const igNode = (await this.node(igId, 'followers_count,media_count,username', token))
        ?? (fallback ? await this.node(igId, 'followers_count,media_count,username', fallback) : null);
      const igErrs: string[] = [];
      const [igReach, igViews, igEngagement, igNewFollowers, igProfileViews, igPostList0, igSeries, igAud] = await Promise.all([
        this.ig(igId, ['reach'], since, until, token, igErrs, fallback),
        this.ig(igId, ['views', 'impressions'], since, until, token, igErrs, fallback),
        this.ig(igId, ['total_interactions', 'accounts_engaged'], since, until, token, igErrs, fallback),
        this.ig(igId, ['follower_count'], since, until, token, igErrs, fallback),
        this.ig(igId, ['profile_views'], since, until, token, undefined, fallback),
        this.igMediaBreakdown(igId, win, token, fallback, igErrs),
        this.igFollowerSeries(igId, since, until, token),
        this.igAudience(igId, token),
      ]);
      // The post list with the second token when the first one read nothing.
      const igRes = igPostList0.posts.length || !fallback ? igPostList0 : await this.igMediaBreakdown(igId, win, fallback);
      const igPostList = igRes.posts;
      // Account-level numbers missing, but the month's posts were read? Sum
      // what the posts say, exactly as the Facebook side already does. Reach
      // is NOT summed: the same person reached by two posts is one person.
      const igEngSum = igPostList.length ? igPostList.reduce((acc, p) => acc + (p.interactions ?? 0), 0) : null;
      const igViewsSum = igPostList.some((p) => p.views != null) ? igPostList.reduce((acc, p) => acc + (p.views ?? 0), 0) : null;
      out.instagram = {
        accountName: igNode?.username ? `@${igNode.username}` : null,
        followers: numOrNull(igNode?.followers_count),
        newFollowers: igNewFollowers,
        reach: igReach,
        views: igViews ?? igViewsSum,
        engagement: igEngagement ?? igEngSum,
        profileViews: igProfileViews,
        // Zero posts this month is a real answer and it prints as 0. The old
        // fallback swapped in media_count — the account's LIFETIME total — the
        // moment a month was quiet, which is a different number wearing the
        // same label.
        postsCount: igRes.count,
        posts: igPostList,
        series: igSeries,
        audience: igAud,
        raw: { igId, username: igNode?.username ?? null, igDebug: { until, posts: igRes.count, errors: igErrs.slice(0, 10) } },
      };
    }

    return out;
  }
}
