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
  ): Promise<number | null> {
    const tv = totalValue ? '&metric_type=total_value' : '';
    const url = `${GRAPH}/${encodeURIComponent(id)}/insights?metric=${encodeURIComponent(metric)}&period=day${tv}&since=${since}&until=${until}&access_token=${encodeURIComponent(token)}`;
    try {
      const r = await getJson(url);
      if (!r.ok || !Array.isArray(r.json?.data) || !r.json.data.length) return null;
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
  ): Promise<number | null> {
    for (const m of metrics) {
      for (const tv of shapes) {
        const v = await this.insight(id, m, since, until, token, tv);
        if (v != null) return v;
      }
    }
    return null;
  }

  private fb(id: string, metrics: string[], since: string, until: string, token: string) {
    return this.firstInsight(id, metrics, since, until, token, [false]);
  }
  private ig(id: string, metrics: string[], since: string, until: string, token: string) {
    // Newer IG metrics REQUIRE metric_type=total_value; older ones reject it.
    return this.firstInsight(id, metrics, since, until, token, [true, false]);
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
  private async igMediaBreakdown(igId: string, since: string, until: string, token: string): Promise<PostInsight[]> {
    const from = new Date(`${since}T00:00:00Z`).getTime();
    const to = new Date(`${until}T23:59:59Z`).getTime();
    const s = Math.floor(from / 1000), u = Math.floor(to / 1000);
    let list: any[] = [];
    try {
      const r = await getJson(`${GRAPH}/${encodeURIComponent(igId)}/media?fields=id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count&since=${s}&until=${u}&limit=50&access_token=${encodeURIComponent(token)}`);
      if (r.ok && Array.isArray(r.json?.data)) list = r.json.data;
    } catch {
      return [];
    }
    // The edge's since/until can be loose — keep only media actually posted this month.
    list = list.filter((m) => { const t = Date.parse(m?.timestamp || ''); return !Number.isFinite(t) || (t >= from && t <= to); }).slice(0, 40);

    const insights = async (mediaId: string, metrics: string[]): Promise<Record<string, number | null> | null> => {
      try {
        const r = await getJson(`${GRAPH}/${encodeURIComponent(mediaId)}/insights?metric=${metrics.join(',')}&access_token=${encodeURIComponent(token)}`);
        if (!r.ok || !Array.isArray(r.json?.data)) return null;
        const map: Record<string, number | null> = {};
        for (const d of r.json.data) { const v = d?.values?.[0]?.value ?? d?.total_value?.value; map[d.name] = numOrNull(v); }
        return map;
      } catch {
        return null;
      }
    };

    const posts = await Promise.all(list.map(async (m): Promise<PostInsight> => {
      const isReel = String(m.media_product_type || '').toUpperCase() === 'REELS' || String(m.media_type || '').toUpperCase() === 'VIDEO';
      const full = isReel ? ['reach', 'saved', 'shares', 'total_interactions', 'views'] : ['reach', 'saved', 'shares', 'total_interactions'];
      let ins = await insights(m.id, full);
      if (!ins) ins = (await insights(m.id, ['reach'])) ?? {};
      const likes = numOrNull(m.like_count), comments = numOrNull(m.comments_count);
      const interactions = ins.total_interactions ?? ((likes ?? 0) + (comments ?? 0) + (ins.saved ?? 0) + (ins.shares ?? 0));
      return {
        id: String(m.id),
        type: isReel ? 'reel' : String(m.media_type || 'post').toLowerCase(),
        timestamp: m.timestamp ?? null,
        permalink: m.permalink ?? null,
        thumbnail: m.thumbnail_url || m.media_url || null,
        caption: m.caption ? String(m.caption).replace(/\s+/g, ' ').slice(0, 120) : null,
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
    return posts;
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
  private async fbPostBreakdown(pageId: string, since: string, until: string, token: string): Promise<PostInsight[]> {
    const from = new Date(`${since}T00:00:00Z`).getTime();
    const to = new Date(`${until}T23:59:59Z`).getTime();
    const s = Math.floor(from / 1000), u = Math.floor(to / 1000);
    const fields = 'id,message,story,created_time,permalink_url,full_picture,shares,likes.summary(true),comments.summary(true)';
    let list: Record<string, unknown>[] = [];
    for (const edge of ['published_posts', 'feed']) {
      try {
        const r = await getJson(`${GRAPH}/${encodeURIComponent(pageId)}/${edge}?fields=${fields}&since=${s}&until=${u}&limit=50&access_token=${encodeURIComponent(token)}`);
        if (r.ok && Array.isArray(r.json?.data)) { list = r.json.data; break; }
      } catch { /* try next edge */ }
    }
    list = list.filter((m) => { const t = Date.parse(String((m as { created_time?: string }).created_time || '')); return !Number.isFinite(t) || (t >= from && t <= to); }).slice(0, 40);
    const posts: PostInsight[] = list.map((m: any) => {
      const likes = numOrNull(m?.likes?.summary?.total_count);
      const comments = numOrNull(m?.comments?.summary?.total_count);
      const shares = numOrNull(m?.shares?.count);
      const cap = m?.message || m?.story || '';
      const isVid = /\/(videos|reel)/i.test(String(m?.permalink_url || ''));
      return {
        id: String(m.id),
        type: isVid ? 'video' : 'post',
        timestamp: m.created_time ?? null,
        permalink: m.permalink_url ?? null,
        thumbnail: m.full_picture ?? null,
        caption: cap ? String(cap).replace(/\s+/g, ' ').slice(0, 120) : null,
        likes,
        comments,
        reach: null,
        views: null,
        saved: null,
        shares,
        interactions: (likes ?? 0) + (comments ?? 0) + (shares ?? 0),
      };
    });
    posts.sort((a, b) => (b.interactions ?? 0) - (a.interactions ?? 0));
    return posts;
  }

  // ---- Organic pull --------------------------------------------------------

  async fetchOrganic(creds: ChannelCreds, month: string): Promise<OrganicResult> {
    const token = creds.token;
    if (!token) throw new Error('Thiếu agency token trên server (META_AGENCY_TOKEN)');
    const ref = this.pageRef(creds);
    if (!ref) throw new Error('Thiếu Facebook Page ID/username');
    const { since, until } = monthBounds(month);

    const page = await this.node(ref, 'id,name,followers_count,fan_count,instagram_business_account', token);
    if (!page || !page.id) {
      throw new Error('Không đọc được Facebook Page (kiểm tra Page ID và asset đã gán cho token)');
    }
    const pageId = page.id as string;
    const out: OrganicResult = {};

    // --- Facebook Page (organic). Most of these are deprecated in 2026 → null. ---
    const [fbReach, fbViews, fbEngRaw, fbNewFollowers, fbPostList] = await Promise.all([
      this.fb(pageId, ['page_impressions_unique'], since, until, token),
      this.fb(pageId, ['page_impressions', 'page_views_total'], since, until, token),
      this.fb(pageId, ['page_post_engagements'], since, until, token),
      this.fb(pageId, ['page_daily_follows_unique', 'page_fan_adds_unique', 'page_fan_adds'], since, until, token),
      this.fbPostBreakdown(pageId, since, until, token),
    ]);
    // Page-level engagement insight is dead; sum per-post like+comment+share (still live) instead.
    const fbEngSum = fbPostList.length ? fbPostList.reduce((acc, p) => acc + (p.interactions ?? 0), 0) : null;
    const fb: OrganicMetrics = {
      accountName: page.name ?? null,
      followers: numOrNull(page.followers_count ?? page.fan_count),
      newFollowers: fbNewFollowers,
      reach: fbReach,
      views: fbViews,
      engagement: fbEngSum ?? fbEngRaw,
      profileViews: null,
      postsCount: fbPostList.length || null,
      posts: fbPostList,
      raw: { pageId, name: page.name ?? null },
    };
    out.facebook = fb;

    // --- Instagram (organic), resolved from the linked business account. ---
    const igId: string | undefined = page.instagram_business_account?.id;
    if (igId) {
      const igNode = await this.node(igId, 'followers_count,media_count,username', token);
      const [igReach, igViews, igEngagement, igNewFollowers, igProfileViews, igPostList, igSeries, igAud] = await Promise.all([
        this.ig(igId, ['reach'], since, until, token),
        this.ig(igId, ['views', 'impressions'], since, until, token),
        this.ig(igId, ['total_interactions', 'accounts_engaged'], since, until, token),
        this.ig(igId, ['follower_count'], since, until, token),
        this.ig(igId, ['profile_views'], since, until, token),
        this.igMediaBreakdown(igId, since, until, token),
        this.igFollowerSeries(igId, since, until, token),
        this.igAudience(igId, token),
      ]);
      out.instagram = {
        accountName: igNode?.username ? `@${igNode.username}` : null,
        followers: numOrNull(igNode?.followers_count),
        newFollowers: igNewFollowers,
        reach: igReach,
        views: igViews,
        engagement: igEngagement,
        profileViews: igProfileViews,
        postsCount: igPostList.length || numOrNull(igNode?.media_count),
        posts: igPostList,
        series: igSeries,
        audience: igAud,
        raw: { igId, username: igNode?.username ?? null },
      };
    }

    return out;
  }
}
