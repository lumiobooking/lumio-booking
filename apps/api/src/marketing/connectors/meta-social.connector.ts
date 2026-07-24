import {
  ChannelCreds,
  MonthlyMetrics,
  OrganicMetrics,
  OrganicResult,
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
    const [fbReach, fbViews, fbEngagement, fbNewFollowers, fbPosts] = await Promise.all([
      this.fb(pageId, ['page_impressions_unique'], since, until, token),
      this.fb(pageId, ['page_impressions', 'page_views_total'], since, until, token),
      this.fb(pageId, ['page_post_engagements'], since, until, token),
      this.fb(pageId, ['page_daily_follows_unique', 'page_fan_adds_unique', 'page_fan_adds'], since, until, token),
      this.countEdge(pageId, 'published_posts', since, until, token),
    ]);
    const fb: OrganicMetrics = {
      accountName: page.name ?? null,
      followers: numOrNull(page.followers_count ?? page.fan_count),
      newFollowers: fbNewFollowers,
      reach: fbReach,
      views: fbViews,
      engagement: fbEngagement,
      profileViews: null,
      postsCount: fbPosts,
      raw: { pageId, name: page.name ?? null },
    };
    out.facebook = fb;

    // --- Instagram (organic), resolved from the linked business account. ---
    const igId: string | undefined = page.instagram_business_account?.id;
    if (igId) {
      const igNode = await this.node(igId, 'followers_count,media_count,username', token);
      const [igReach, igViews, igEngagement, igNewFollowers, igProfileViews, igPosts] = await Promise.all([
        this.ig(igId, ['reach'], since, until, token),
        this.ig(igId, ['views', 'impressions'], since, until, token),
        this.ig(igId, ['total_interactions', 'accounts_engaged'], since, until, token),
        this.ig(igId, ['follower_count'], since, until, token),
        this.ig(igId, ['profile_views'], since, until, token),
        this.countEdge(igId, 'media', since, until, token),
      ]);
      out.instagram = {
        accountName: igNode?.username ? `@${igNode.username}` : null,
        followers: numOrNull(igNode?.followers_count),
        newFollowers: igNewFollowers,
        reach: igReach,
        views: igViews,
        engagement: igEngagement,
        profileViews: igProfileViews,
        postsCount: igPosts ?? numOrNull(igNode?.media_count),
        raw: { igId, username: igNode?.username ?? null },
      };
    }

    return out;
  }
}
