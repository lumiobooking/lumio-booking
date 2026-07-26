import { ChannelCreds, MonthlyMetrics, OrganicMetrics, OrganicResult, PostInsight, SocialConnector, VerifyResult, getJson, postForm } from './social-connector.interface';

const TT = 'https://open.tiktokapis.com/v2';
const doFetch: any = (globalThis as any).fetch;
const num = (v: any) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/**
 * TikTok ORGANIC (non-paid) account + video insights via the Display API v2.
 *   Token refresh: POST /v2/oauth/token/ (client_key, client_secret, refresh_token).
 *   Account stats: GET  /v2/user/info/?fields=follower_count,likes_count,video_count.
 *   Videos:        POST /v2/video/list/?fields=... (view/like/comment/share per video).
 * Reach, impressions, profile views and demographics are NOT exposed by TikTok's
 * public API — those fields stay null (same resilient pattern as Facebook).
 */
export class TikTokOrganicConnector implements SocialConnector {
  readonly platform = 'tiktok' as const;
  readonly label = 'TikTok';
  readonly enabled = true;
  readonly hasSpend = false;

  /** Short-lived access token from the salon refresh token (or a raw access token). */
  private async accessToken(creds: ChannelCreds): Promise<string> {
    if (creds.token) return creds.token;
    const key = creds.clientId, secret = creds.clientSecret, refresh = creds.refreshToken;
    if (!refresh || !key || !secret) throw new Error('Thiếu TikTok client key/secret (server) hoặc refresh token của salon');
    const j = await postForm(`${TT}/oauth/token/`, { client_key: key, client_secret: secret, grant_type: 'refresh_token', refresh_token: refresh });
    if (!j || !j.access_token) throw new Error(j?.error_description || j?.error || 'Không lấy được TikTok access token');
    return String(j.access_token);
  }

  async verify(creds: ChannelCreds): Promise<VerifyResult> {
    try {
      const token = await this.accessToken(creds);
      const r = await getJson(`${TT}/user/info/?fields=open_id,display_name,follower_count`, { Authorization: `Bearer ${token}` });
      const err = r.json?.error;
      if (!r.ok || (err && err.code && err.code !== 'ok')) return { ok: false, error: err?.message || `TikTok ${r.status}` };
      const name = r.json?.data?.user?.display_name;
      return { ok: true, accountName: name ? `@${name}` : undefined };
    } catch (e) { return { ok: false, error: String((e as Error).message) }; }
  }

  async fetchOrganic(creds: ChannelCreds, month: string): Promise<OrganicResult> {
    const token = await this.accessToken(creds);
    const [y, m] = month.split('-').map(Number);
    const from = Math.floor(Date.UTC(y, m - 1, 1) / 1000);
    const to = Math.floor(Date.UTC(y, m, 1) / 1000); // exclusive: start of next month

    // --- Account-level stats ---
    const u = await getJson(`${TT}/user/info/?fields=open_id,display_name,follower_count,likes_count,video_count`, { Authorization: `Bearer ${token}` });
    if (!u.ok || (u.json?.error && u.json.error.code && u.json.error.code !== 'ok')) {
      throw new Error(u.json?.error?.message || `TikTok user/info ${u.status}`);
    }
    const user = u.json?.data?.user || {};

    // --- Videos posted this month (list is newest-first; page until past the month) ---
    const fields = 'id,title,video_description,cover_image_url,share_url,create_time,like_count,comment_count,share_count,view_count';
    const posts: PostInsight[] = [];
    let cursor: number | undefined; let more = true; let guard = 0;
    while (more && guard < 10) {
      guard++;
      const body: Record<string, unknown> = { max_count: 20 };
      if (cursor != null) body.cursor = cursor;
      const res = await doFetch(`${TT}/video/list/?fields=${fields}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || (j?.error && j.error.code && j.error.code !== 'ok')) break;
      const d = j?.data || {};
      const vids: any[] = Array.isArray(d.videos) ? d.videos : [];
      for (const v of vids) {
        const ct = Number(v?.create_time) || 0;
        if (ct && ct < from) { more = false; break; }
        if (ct >= from && ct < to) {
          const likes = num(v?.like_count), comments = num(v?.comment_count), shares = num(v?.share_count);
          posts.push({
            id: String(v?.id ?? ''), type: 'video',
            timestamp: ct ? new Date(ct * 1000).toISOString() : null,
            permalink: v?.share_url || null, thumbnail: v?.cover_image_url || null,
            caption: v?.title || v?.video_description || null,
            likes, comments, shares, views: num(v?.view_count), reach: null, saved: null,
            interactions: (likes ?? 0) + (comments ?? 0) + (shares ?? 0),
          });
        }
      }
      more = more && !!d.has_more && vids.length > 0;
      cursor = num(d.cursor) ?? undefined;
    }

    const viewsSum = posts.length ? posts.reduce((a, p) => a + (p.views ?? 0), 0) : null;
    const engSum = posts.length ? posts.reduce((a, p) => a + (p.interactions ?? 0), 0) : null;
    const tiktok: OrganicMetrics = {
      accountName: user.display_name ? `@${user.display_name}` : null,
      followers: num(user.follower_count),
      newFollowers: null,   // computed month-over-month in the service
      reach: null,          // TikTok does not expose organic reach
      views: viewsSum,
      engagement: engSum,
      profileViews: null,
      postsCount: posts.length || null,
      posts,
      raw: { openId: user.open_id ?? null, totalLikes: num(user.likes_count), videoCount: num(user.video_count) },
    };
    return { tiktok };
  }

  async fetchMonthly(_creds: ChannelCreds, _month: string): Promise<MonthlyMetrics> {
    throw new Error('TikTok uses organic insights (fetchOrganic)');
  }
}
