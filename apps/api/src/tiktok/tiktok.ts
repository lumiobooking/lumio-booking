/**
 * TikTok, as a place the calendar can post to.
 *
 * WHY THIS EXISTS
 *
 * The way agencies post to a client's TikTok today is by logging into the
 * client's account from the agency's own devices. TikTok reads that as a
 * hijacked account — new device, new city, several accounts from one IP —
 * and locks it, and the client loses years of followers over a Tuesday post.
 * The Content Posting API is the sanctioned door: the client authorises
 * Lumio ONCE from their own phone, Lumio holds a token, nobody ever types
 * the client's password again.
 *
 * WHAT TIKTOK REQUIRES (developers.tiktok.com — Content Posting API, Direct
 * Post, Content Sharing Guidelines; read September 2026)
 *
 *  - An app with the Content Posting API product and the `video.publish`
 *    scope. Until TikTok AUDITS the app, every post it makes is forced to
 *    private (SELF_ONLY) — the API refuses any other privacy level with
 *    `unaudited_client_can_only_post_to_private_accounts`.
 *  - Before every post: query creator_info and honour what it says — the
 *    privacy levels this account may use, the longest video it may post,
 *    and whether comments / duet / stitch are switched off in the app.
 *  - The person must CHOOSE the privacy level; the UI may not default it.
 *    Comment / duet / stitch are toggles the person sets. A commercial
 *    content disclosure toggle must be offered ("Your brand" → labelled
 *    Promotional content; "Branded content" → labelled Paid partnership).
 *  - The consent line "By posting, you agree to TikTok's Music Usage
 *    Confirmation" (plus the Branded Content Policy when disclosed) and a
 *    note that the post may take a few minutes to appear.
 *  - Video only through this door (MP4 / H.264), pulled from a URL on a
 *    domain verified in the developer portal, or uploaded in chunks.
 *  - 6 init calls per minute per account; a daily cap TikTok does not
 *    publish (`spam_risk_too_many_posts`).
 *  - Access tokens live 24 hours, refresh tokens 365 days.
 *
 * The audit is the agency's job, once, in the developer portal; the rest is
 * here. Every rule above that can be checked before the post is due is
 * checked in `tiktokRefusal`, so a post that TikTok would refuse at 9 am is
 * refused while the writer is still looking at it.
 */

export const TIKTOK_KEY = 'tiktok';
export const TIKTOK_SCOPES = 'user.info.basic,video.publish';
export const TIKTOK_CAPTION_MAX = 2200;
/**
 * The most Lumio will move to TikTok for one post. TikTok itself takes up
 * to 4 GB; a gigabyte matches Instagram Reels' ceiling and no salon clip
 * needs more. Moved in 64 MB pieces, never held whole (see service).
 */
export const TIKTOK_FILE_MAX_BYTES = 1024 * 1024 * 1024;
/** A file up to this size is fetched whole; past it, in HTTP ranges. */
export const TIKTOK_WHOLE_FETCH_MAX = 96 * 1024 * 1024;

export type TikTokPrivacy = 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';
export const TIKTOK_PRIVACY: TikTokPrivacy[] = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];

export const PRIVACY_LABEL: Record<TikTokPrivacy, { vi: string; en: string }> = {
  PUBLIC_TO_EVERYONE: { vi: 'Công khai', en: 'Everyone' },
  MUTUAL_FOLLOW_FRIENDS: { vi: 'Bạn bè (theo dõi lẫn nhau)', en: 'Friends' },
  FOLLOWER_OF_CREATOR: { vi: 'Người theo dõi', en: 'Followers' },
  SELF_ONLY: { vi: 'Chỉ mình tôi (riêng tư)', en: 'Only me (private)' },
};

/** What creator_info answered, kept on the connection for an hour. */
export interface CreatorInfo {
  privacyOptions: TikTokPrivacy[];
  maxDurationSec: number;
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  checkedAt: string;
}

export interface TikTokSettings {
  connected: boolean;
  openId: string;
  displayName: string;
  username: string;
  avatarUrl: string;
  /** Secrets — never sent to a browser. */
  accessToken: string;
  accessExpiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
  connectedAt: string;
  creator: CreatorInfo | null;
  /** The last error TikTok gave, for the screen. */
  lastError: string | null;
}

export const TIKTOK_DEFAULTS: TikTokSettings = {
  connected: false, openId: '', displayName: '', username: '', avatarUrl: '',
  accessToken: '', accessExpiresAt: '', refreshToken: '', refreshExpiresAt: '', connectedAt: '',
  creator: null, lastError: null,
};

/** What the screen may know — the tokens stay on the server. */
export function publicTikTok(s: TikTokSettings) {
  return {
    connected: s.connected && Boolean(s.refreshToken),
    displayName: s.displayName || null,
    username: s.username || null,
    avatarUrl: s.avatarUrl || null,
    connectedAt: s.connectedAt || null,
    creator: s.creator,
    needsReconnect: needsReconnect(s),
    lastError: s.lastError,
  };
}

/** The refresh token has a year; past it, only the person can renew it. */
export function needsReconnect(s: TikTokSettings, now = Date.now()): boolean {
  if (!s.connected || !s.refreshToken) return false;
  const exp = Date.parse(s.refreshExpiresAt || '');
  return Number.isFinite(exp) && exp <= now;
}

/** An access token is refreshed a little early; TikTok's live 24 hours. */
export function accessStale(s: TikTokSettings, now = Date.now(), marginMs = 5 * 60 * 1000): boolean {
  const exp = Date.parse(s.accessExpiresAt || '');
  return !s.accessToken || !Number.isFinite(exp) || exp - marginMs <= now;
}

// ---- OAuth -----------------------------------------------------------------------

export function tiktokAuthorizeUrl(o: { clientKey: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    client_key: o.clientKey,
    scope: TIKTOK_SCOPES,
    response_type: 'code',
    redirect_uri: o.redirectUri,
    state: o.state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${q.toString()}`;
}

export interface TokenAnswer {
  access_token?: string; expires_in?: number; refresh_token?: string; refresh_expires_in?: number;
  open_id?: string; scope?: string; error?: string; error_description?: string;
}

/** Turn TikTok's token answer into stored settings. Null when it is not one. */
export function settingsFromToken(prev: TikTokSettings, t: TokenAnswer, now = Date.now()): TikTokSettings | null {
  if (!t.access_token || !t.refresh_token || !t.open_id) return null;
  const scopes = String(t.scope ?? '').split(',').map((x) => x.trim());
  if (!scopes.includes('video.publish')) return null;
  return {
    ...prev,
    connected: true,
    openId: t.open_id,
    accessToken: t.access_token,
    accessExpiresAt: new Date(now + (Number(t.expires_in) || 86_400) * 1000).toISOString(),
    refreshToken: t.refresh_token,
    // A refresh answer may omit refresh_expires_in; keep what we had then.
    refreshExpiresAt: t.refresh_expires_in
      ? new Date(now + Number(t.refresh_expires_in) * 1000).toISOString()
      : prev.refreshExpiresAt || new Date(now + 365 * 86_400_000).toISOString(),
    connectedAt: prev.connectedAt || new Date(now).toISOString(),
    lastError: null,
  };
}

/** creator_info's answer, in our shape. Null when it is not an answer. */
export function parseCreatorInfo(raw: unknown, now = new Date()): CreatorInfo | null {
  const d = (raw as { data?: Record<string, unknown> } | null)?.data;
  if (!d || typeof d !== 'object') return null;
  const opts = Array.isArray(d.privacy_level_options) ? d.privacy_level_options : [];
  const privacyOptions = opts.filter((x): x is TikTokPrivacy => (TIKTOK_PRIVACY as string[]).includes(String(x)));
  return {
    privacyOptions,
    maxDurationSec: Number(d.max_video_post_duration_sec) || 0,
    commentDisabled: Boolean(d.comment_disabled),
    duetDisabled: Boolean(d.duet_disabled),
    stitchDisabled: Boolean(d.stitch_disabled),
    checkedAt: now.toISOString(),
  };
}

// ---- the post's own settings ---------------------------------------------------------

/**
 * What a person must decide for every TikTok post. The guidelines are
 * explicit that the privacy level is CHOSEN, never defaulted, so a post
 * without one is not ready — the composer shows the dropdown blank.
 */
export interface TikTokPostOptions {
  privacy: TikTokPrivacy;
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  /** The commercial content toggle was switched on. */
  disclose: boolean;
  /** "Your brand" — the shop promoting itself → labelled Promotional content. */
  yourBrand: boolean;
  /** "Branded content" — paid partnership → labelled Paid partnership. */
  brandedContent: boolean;
  /** AI-generated content flag. */
  aigc: boolean;
}

/** The composer's object, checked. Null when no privacy level was chosen. */
export function cleanTikTokOptions(raw: unknown): TikTokPostOptions | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const privacy = String(r.privacy ?? '');
  if (!(TIKTOK_PRIVACY as string[]).includes(privacy)) return null;
  const disclose = Boolean(r.disclose);
  return {
    privacy: privacy as TikTokPrivacy,
    allowComment: r.allowComment !== false,
    allowDuet: Boolean(r.allowDuet),
    allowStitch: Boolean(r.allowStitch),
    disclose,
    yourBrand: disclose && Boolean(r.yourBrand),
    brandedContent: disclose && Boolean(r.brandedContent),
    aigc: Boolean(r.aigc),
  };
}

/** What the connection knows that a post has to fit. */
export interface TikTokTarget {
  connected: boolean;
  needsReconnect: boolean;
  displayName: string | null;
  creator: CreatorInfo | null;
}

export function targetOf(s: TikTokSettings | null): TikTokTarget | null {
  if (!s || !s.connected || !s.refreshToken) return null;
  return { connected: true, needsReconnect: needsReconnect(s), displayName: s.displayName || s.username || null, creator: s.creator };
}

interface DraftLike { text: string; media: { url: string; kind: 'image' | 'video' }[] }

/**
 * Why this post cannot go to TikTok as it stands — one sentence for the
 * writer, or null. Everything TikTok would refuse at send time that can be
 * known now: connection, one video, caption length, the chosen privacy
 * level against what the account allows, the disclosure rules.
 */
export function tiktokRefusal(draft: DraftLike, target: TikTokTarget | null, opts: TikTokPostOptions | null): string | null {
  if (!target) return 'Tiệm chưa kết nối TikTok. Bấm "Kết nối TikTok" ở đầu tab Lịch đăng bài — chủ tài khoản đăng nhập một lần trên máy của họ, không cần đưa mật khẩu cho ai.';
  if (target.needsReconnect) return 'Kết nối TikTok đã hết hạn (TikTok cấp quyền tối đa 1 năm). Bấm "Kết nối lại TikTok".';
  const videos = draft.media.filter((m) => m.kind === 'video');
  const photos = draft.media.filter((m) => m.kind === 'image');
  if (!videos.length) return 'TikTok cần một video (MP4). Bài chỉ có ảnh hoặc chỉ có chữ không đăng lên TikTok được — bỏ TikTok khỏi bài này hoặc thêm video.';
  if (videos.length > 1) return 'TikTok đăng đúng một video mỗi bài. Bỏ bớt video.';
  if (photos.length) return 'TikTok không đăng chung ảnh với video. Bỏ ảnh, hoặc bỏ TikTok khỏi bài này (Facebook vẫn đăng đủ).';
  if (!/^https:\/\//i.test(videos[0].url)) return 'Link video phải là https công khai — TikTok tự tải file về.';
  if (draft.text.length > TIKTOK_CAPTION_MAX) return `Caption dài ${draft.text.length} ký tự, quá giới hạn ${TIKTOK_CAPTION_MAX} của TikTok.`;
  if (!opts) return 'Chưa chọn quyền riêng tư cho bài TikTok (Công khai / Bạn bè / Người theo dõi / Chỉ mình tôi). TikTok bắt buộc người đăng tự chọn.';
  const c = target.creator;
  if (c && c.privacyOptions.length && !c.privacyOptions.includes(opts.privacy)) {
    const allowed = c.privacyOptions.map((p) => PRIVACY_LABEL[p].vi).join(' / ');
    return `Tài khoản TikTok này chỉ cho phép: ${allowed}. ${c.privacyOptions.length === 1 && c.privacyOptions[0] === 'SELF_ONLY' ? 'Khi app Lumio chưa được TikTok duyệt (audit), mọi bài chỉ đăng ở chế độ riêng tư — chọn "Chỉ mình tôi" để đăng thử, bài lên công khai sau khi duyệt.' : 'Chọn lại quyền riêng tư.'}`;
  }
  if (opts.disclose && !opts.yourBrand && !opts.brandedContent) return 'Đã bật "Nội dung thương mại" nhưng chưa chọn "Thương hiệu của tiệm" hay "Nội dung được tài trợ".';
  if (opts.brandedContent && opts.privacy === 'SELF_ONLY') return 'Nội dung được tài trợ (Paid partnership) không được đặt ở chế độ "Chỉ mình tôi" — TikTok từ chối. Chọn Công khai hoặc Người theo dõi.';
  if (c) {
    if (opts.allowComment && c.commentDisabled) return 'Tài khoản đã tắt bình luận trong cài đặt TikTok — bỏ tick "Cho phép bình luận".';
    if (opts.allowDuet && c.duetDisabled) return 'Tài khoản đã tắt Duet trong cài đặt TikTok — bỏ tick "Cho phép Duet".';
    if (opts.allowStitch && c.stitchDisabled) return 'Tài khoản đã tắt Stitch trong cài đặt TikTok — bỏ tick "Cho phép Stitch".';
  }
  return null;
}

/** The body of POST /v2/post/publish/video/init/. */
export function initBody(
  caption: string,
  opts: TikTokPostOptions,
  source: { kind: 'url'; url: string } | { kind: 'file'; size: number; chunkSize: number; chunks: number },
) {
  return {
    post_info: {
      title: caption.slice(0, TIKTOK_CAPTION_MAX),
      privacy_level: opts.privacy,
      disable_comment: !opts.allowComment,
      disable_duet: !opts.allowDuet,
      disable_stitch: !opts.allowStitch,
      brand_content_toggle: opts.brandedContent,
      brand_organic_toggle: opts.yourBrand,
      ...(opts.aigc ? { is_aigc: true } : {}),
    },
    source_info: source.kind === 'url'
      ? { source: 'PULL_FROM_URL', video_url: source.url }
      : { source: 'FILE_UPLOAD', video_size: source.size, chunk_size: source.chunkSize, total_chunk_count: source.chunks },
  };
}

/**
 * How a file is cut for FILE_UPLOAD. TikTok: a chunk is 5–64 MB, the last
 * one may carry the remainder (up to 128 MB); a file under 5 MB goes whole.
 * total_chunk_count = floor(size / chunk_size).
 */
export function chunkPlan(size: number): { chunkSize: number; chunks: number; ranges: [number, number][] } {
  const MB = 1024 * 1024;
  const chunkSize = size <= 64 * MB ? size : 64 * MB;
  const chunks = Math.max(1, Math.floor(size / chunkSize));
  const ranges: [number, number][] = [];
  for (let i = 0; i < chunks; i += 1) {
    const start = i * chunkSize;
    const end = i === chunks - 1 ? size - 1 : start + chunkSize - 1;
    ranges.push([start, end]);
  }
  return { chunkSize, chunks, ranges };
}

/** TikTok's error code, turned into the one thing the team can do. */
export function explainTikTokError(code: string | null | undefined, message?: string | null): string {
  const c = String(code ?? '');
  const raw = message ? ` (${message})` : '';
  switch (c) {
    case 'unaudited_client_can_only_post_to_private_accounts':
      return 'App Lumio chưa được TikTok duyệt (Content Posting audit) nên chỉ đăng được ở chế độ "Chỉ mình tôi". Đổi quyền riêng tư sang Chỉ mình tôi để đăng, hoặc chờ TikTok duyệt app.';
    case 'spam_risk_too_many_posts':
      return 'TikTok chặn vì tài khoản này đã đăng quá số bài trong ngày qua API. Dời bài sang ngày mai.';
    case 'spam_risk_user_banned_from_posting':
      return 'TikTok đang cấm tài khoản này đăng bài. Chủ tài khoản kiểm tra trong app TikTok.';
    case 'url_ownership_unverified':
      return 'Tên miền chứa video chưa được xác minh trong TikTok Developer Portal (URL prefix). Lumio sẽ tự chuyển sang tải file trực tiếp — báo đội Lumio nếu lỗi lặp lại.';
    case 'privacy_level_option_mismatch':
      return 'Quyền riêng tư đã chọn không có trong danh sách tài khoản cho phép. Mở bài, chọn lại.';
    case 'access_token_invalid':
    case 'scope_not_authorized':
      return 'Kết nối TikTok không còn hiệu lực hoặc thiếu quyền đăng video. Bấm "Kết nối lại TikTok".';
    case 'rate_limit_exceeded':
      return 'TikTok giới hạn 6 lần đăng/phút mỗi tài khoản. Hệ thống sẽ thử lại.';
    case 'video_pull_failed':
    case 'file_format_check_failed':
    case 'video_format_check_failed':
      return 'TikTok không đọc được file video — cần MP4 (H.264), tải lại bằng nút "Tải video lên".';
    case 'duration_check_failed':
      return 'Video dài hơn mức tài khoản này được đăng (xem "Tối đa" trong ô TikTok của bài).';
    case 'frame_rate_check_failed':
    case 'picture_size_check_failed':
      return 'Video không đúng chuẩn TikTok (khung hình/kích thước). Xuất lại 1080×1920, 30fps.';
    default:
      return `TikTok từ chối${c ? `: ${c}` : ''}${raw}`;
  }
}

/** The public link, once TikTok has told us the video's id. */
export function tiktokPostUrl(username: string | null, videoId: string | null): string | null {
  if (!videoId) return null;
  return username ? `https://www.tiktok.com/@${username}/video/${videoId}` : `https://www.tiktok.com/video/${videoId}`;
}

/** status/fetch: what it says and whether to keep waiting. */
export function readPublishStatus(raw: unknown): { status: string; failReason: string | null; postIds: string[]; done: boolean; ok: boolean } {
  const d = (raw as { data?: Record<string, unknown> } | null)?.data ?? {};
  const status = String(d.status ?? '');
  const failReason = d.fail_reason ? String(d.fail_reason) : null;
  const ids = Array.isArray(d.publicaly_available_post_id) ? d.publicaly_available_post_id.map((x) => String(x)) : [];
  const ok = status === 'PUBLISH_COMPLETE';
  const done = ok || status === 'FAILED';
  return { status, failReason, postIds: ids, done, ok };
}
