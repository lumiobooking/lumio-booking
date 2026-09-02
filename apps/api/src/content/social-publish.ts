/**
 * Scheduled publishing to a salon's own Facebook Page and Instagram account.
 *
 * WHY THIS EXISTS
 *
 * The content plan already drafts a week of posts from the salon's own numbers.
 * Until now the last step was "copy this text, open Facebook, paste it" — the
 * step a nail technician standing at the chair with both hands wet does not do.
 * A plan nobody executes is not a plan. Scheduling is the whole product here.
 *
 * WHAT THIS FILE IS, AND IS NOT
 *
 * This is the DECISION half: given one scheduled post and the pages a tenant has
 * connected, decide what may be published where, and when it must be refused.
 * It performs no network calls, which is exactly why it can be tested: every
 * rule below is a rule about the salon's data or about a documented platform
 * limit, not about a mocked HTTP response.
 *
 * THE REFUSALS MATTER MORE THAN THE HAPPY PATH
 *
 * A publisher that silently does half of what it was asked is worse than one
 * that stops. If a post is aimed at Facebook and Instagram but carries no media,
 * Instagram cannot take it at all — the Content Publishing API has no text-only
 * post. Publishing to Facebook alone and reporting success would tell the salon
 * their Instagram is being kept alive when it is not. So a post that cannot be
 * fully delivered says so, names the missing piece, and is not sent anywhere the
 * salon did not get to see coming.
 *
 * PLATFORM LIMITS ARE FACTS, NOT PREFERENCES
 *
 * Instagram rejects a caption over 2,200 characters, rejects media with more
 * than 30 hashtags, and accepts between 2 and 10 items in a carousel. Over any
 * of those lines the API returns an error, so the post simply does not go out —
 * at 9am on the morning the salon expected it. All three are checked here,
 * before the post is accepted into the queue, while the person who wrote it is
 * still looking at it.
 */

/** Instagram caption ceiling. Over this the Graph API rejects the container. */
export const IG_CAPTION_MAX = 2200;
/** Instagram hashtag ceiling per media. */
export const IG_HASHTAG_MAX = 30;
/** Facebook Page post ceiling. Generous, but not infinite. */
export const FB_MESSAGE_MAX = 63_206;
/** An Instagram carousel holds between 2 and 10 items. */
export const IG_CAROUSEL_MIN = 2;
export const IG_CAROUSEL_MAX = 10;

export type Channel = 'facebook' | 'instagram';
export type MediaKind = 'image' | 'video';

export interface MediaItem {
  /** Public https URL. Meta's servers fetch it themselves. */
  url: string;
  kind: MediaKind;
}

/** What the post IS, derived from its media rather than stored separately. */
export type PostShape = 'text' | 'image' | 'video' | 'carousel';

export interface ConnectedPage {
  pageId: string;
  /** The linked Instagram professional account, when the salon has one. */
  igId: string | null;
  igUsername: string | null;
  pageName: string | null;
  enabled: boolean;
}

export interface PostDraft {
  /** Where the salon asked for it to go. */
  channels: Channel[];
  message: string;
  /** In display order. The first item is the one the feed shows. */
  media: MediaItem[];
}

export interface ChannelPlan {
  channel: Channel;
  ok: boolean;
  /** Graph node the publish call is made against. */
  targetId: string | null;
  /** Said to the salon, in their language, when ok is false. */
  refusal: string | null;
}

export interface PublishPlan {
  shape: PostShape;
  plans: ChannelPlan[];
  /** True only when every requested channel can actually receive the post. */
  ready: boolean;
  /** The blocking problems, deduped, for one line on the screen. */
  problems: string[];
}

const hashtagCount = (s: string) => (s.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;

/**
 * A link to a SHARING PAGE rather than to the file itself.
 *
 * This is the mistake everybody makes, and it is invisible: a Google Drive
 * "share" link opens a picture in a browser, so it looks exactly like an image
 * link. It is not. Meta's servers fetch that URL and receive an HTML viewer
 * page — some hundred kilobytes of Google's JavaScript — and the post fails
 * with a message about an unsupported format, hours later, for a link the salon
 * watched load correctly in their own tab.
 *
 * Refusing it while they are still looking at the screen is worth more than any
 * error message afterwards. Returns the fix, or null when the link is fine.
 */
export function sharePageProblem(url: string): string | null {
  const u = (url ?? '').trim();
  if (/drive\.google\.com|docs\.google\.com/i.test(u)) {
    return 'Link Google Drive là trang xem, không phải file ảnh — Facebook tải về chỉ nhận được trang web. Dùng nút "Tải ảnh lên" ở dưới, hoặc dán link ảnh từ website của tiệm.';
  }
  if (/dropbox\.com/i.test(u) && !/(\?|&)(raw|dl)=1/i.test(u)) {
    return 'Link Dropbox này là trang xem. Đổi đuôi thành ?raw=1, hoặc dùng nút "Tải ảnh lên".';
  }
  if (/1drv\.ms|onedrive\.live\.com|sharepoint\.com/i.test(u)) {
    return 'Link OneDrive là trang xem, không phải file ảnh. Dùng nút "Tải ảnh lên" ở dưới.';
  }
  if (/photos\.google\.com|photos\.app\.goo\.gl/i.test(u)) {
    return 'Link Google Photos không tải file trực tiếp được. Dùng nút "Tải ảnh lên" ở dưới.';
  }
  // A path that ends in a page extension is a page, whatever the host.
  if (/\.(html?|php|aspx)(\?|#|$)/i.test(u)) {
    return 'Link này trỏ tới một trang web, không phải file ảnh hay video.';
  }
  return null;
}

/** A public https URL. Meta fetches this itself, so localhost cannot work. */
export function usableMediaUrl(url: string | null | undefined): boolean {
  const u = (url ?? '').trim();
  if (!/^https:\/\//i.test(u)) return false;
  // Meta's servers fetch the file. An address only this machine can resolve
  // produces a container error minutes after the salon has walked away.
  if (/^https:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(u)) return false;
  if (/^https:\/\/[^/]*\.local(\b|[:/])/i.test(u)) return false;
  if (sharePageProblem(u)) return false;
  return true;
}

/**
 * Guess image or video from the URL, for the moment a salon pastes a link.
 *
 * Only a default for the picker — the stored `kind` is what publishing uses,
 * because a URL with no extension (a CDN with a signed path, say) tells us
 * nothing, and guessing wrong sends a video to the photo endpoint.
 */
export function guessKind(url: string): MediaKind {
  return /\.(mp4|mov|m4v|avi|webm|mkv)(\?|#|$)/i.test((url ?? '').trim()) ? 'video' : 'image';
}

export function shapeOf(media: MediaItem[]): PostShape {
  const m = media ?? [];
  if (!m.length) return 'text';
  if (m.length > 1) return 'carousel';
  return m[0].kind === 'video' ? 'video' : 'image';
}

export function planPublish(draft: PostDraft, page: ConnectedPage | null): PublishPlan {
  const wanted = Array.from(new Set(draft.channels ?? []));
  const text = (draft.message ?? '').trim();
  const media = (draft.media ?? []).filter((m) => m && typeof m.url === 'string');
  const shape = shapeOf(media);
  const plans: ChannelPlan[] = [];

  for (const channel of wanted) {
    const refusal = refuse(channel, { text, media, shape }, page);
    plans.push({
      channel,
      ok: refusal === null,
      targetId: refusal === null ? (channel === 'facebook' ? page!.pageId : page!.igId) : null,
      refusal,
    });
  }

  const problems = Array.from(new Set(plans.filter((p) => !p.ok).map((p) => p.refusal!)));
  return {
    shape,
    plans,
    // Not "at least one channel works". A post the salon believes is going to
    // both places must go to both places or wait until it can.
    ready: wanted.length > 0 && plans.every((p) => p.ok),
    problems,
  };
}

interface Checked { text: string; media: MediaItem[]; shape: PostShape }

function refuse(channel: Channel, c: Checked, page: ConnectedPage | null): string | null {
  if (!page) return 'Tiệm chưa kết nối Trang Facebook. Vào Cài đặt → Messenger để kết nối trước.';
  if (!page.enabled) return `Trang ${page.pageName ?? ''} đang tắt kết nối. Bật lại rồi mới đăng được.`.replace('  ', ' ');
  if (!c.text && !c.media.length) return 'Bài chưa có nội dung.';

  // The share-page case gets its own sentence, because "must be a public https
  // link" is exactly what a Google Drive share link looks like to its owner.
  const share = c.media.map((m) => sharePageProblem(m.url)).find(Boolean);
  if (share) return share;
  const bad = c.media.find((m) => !usableMediaUrl(m.url));
  if (bad) return 'Link ảnh/video phải là https công khai — Facebook và Instagram tự tải file về từ link này.';

  if (channel === 'facebook') {
    if (c.text.length > FB_MESSAGE_MAX) return `Nội dung dài ${c.text.length} ký tự, quá giới hạn ${FB_MESSAGE_MAX} của Facebook.`;
    if (!c.text && !c.media.length) return 'Bài chưa có nội dung.';
    // A Facebook post is one video, or one or more photos — not both at once.
    // The API has no single call that mixes them, and quietly dropping the
    // video would publish something the salon never wrote.
    const vids = c.media.filter((m) => m.kind === 'video').length;
    if (vids && c.media.length > 1) {
      return 'Facebook không đăng chung video với ảnh trong một bài. Tách thành hai bài, hoặc bỏ bớt.';
    }
    return null;
  }

  // ---- Instagram ----
  if (!page.igId) {
    return 'Trang Facebook này chưa liên kết tài khoản Instagram chuyên nghiệp. Liên kết trong cài đặt Trang trên Facebook rồi kết nối lại.';
  }
  // The Content Publishing API has no text-only post. There is no way to make
  // this work by trying harder, so it is refused here instead of failing in a
  // scheduler run at 9am.
  if (!c.media.length) return 'Instagram bắt buộc phải có ảnh hoặc video — không đăng được bài chỉ có chữ.';
  if (c.media.length > IG_CAROUSEL_MAX) {
    return `Instagram chỉ cho tối đa ${IG_CAROUSEL_MAX} ảnh/video trong một bài. Bài này đang có ${c.media.length}.`;
  }
  if (c.text.length > IG_CAPTION_MAX) return `Caption dài ${c.text.length} ký tự, quá giới hạn ${IG_CAPTION_MAX} của Instagram.`;
  const tags = hashtagCount(c.text);
  if (tags > IG_HASHTAG_MAX) return `Bài có ${tags} hashtag, quá giới hạn ${IG_HASHTAG_MAX} của Instagram.`;
  return null;
}

/**
 * Meta's error, turned into the one thing the salon can actually do.
 *
 * Graph errors are written for the developer who wrote the call, not for the
 * person holding the phone. The worst of them is #200:
 *
 *   "(#200) If posting to a group, requires app being installed in the group,
 *    and either publish_to_groups permission with user token, or both
 *    pages_read_engagement and pages_manage_posts permission with page token…"
 *
 * Four clauses about groups the salon is not posting to, and the real cause is
 * none of them: the stored Page access token was minted BEFORE pages_manage_posts
 * was requested, so it does not carry it. Adding the permission in the Meta
 * dashboard changes nothing for an existing token. The fix is one sentence —
 * reconnect the Page — and that sentence appears nowhere in Meta's text.
 *
 * The raw message is kept alongside, never replaced: it is what makes a support
 * conversation possible, and paraphrasing away the only precise string in the
 * system is how a support queue fills up with "it says an error".
 */
export function explainMetaError(raw: string | null | undefined): string | null {
  const e = (raw ?? '').toLowerCase();
  if (!e) return null;

  if (e.includes('pages_manage_posts') || e.includes('publish_to_groups') || e.includes('#200')) {
    return 'Trang Facebook đang thiếu quyền đăng bài. Vào Cài đặt → Messenger, bấm KẾT NỐI LẠI Trang và tick tất cả các ô Facebook hỏi. Quyền mới chỉ có hiệu lực với kết nối mới — thêm quyền ở Meta không sửa được kết nối cũ.';
  }
  if (e.includes('instagram_content_publish') || e.includes('instagram_business_content_publish')) {
    return 'Tài khoản Instagram đang thiếu quyền đăng bài. Kết nối lại Trang ở Cài đặt → Messenger và tick tất cả các ô.';
  }
  // A token that has genuinely died, rather than one missing a scope.
  if (e.includes('session has expired') || e.includes('access token') && (e.includes('expired') || e.includes('invalid'))) {
    return 'Kết nối Facebook đã hết hạn. Vào Cài đặt → Messenger và kết nối lại Trang.';
  }
  if (e.includes('#190')) {
    return 'Facebook đã thu hồi kết nối (đổi mật khẩu, gỡ ứng dụng, hoặc hết hạn). Kết nối lại Trang ở Cài đặt → Messenger.';
  }
  if (e.includes('rate limit') || e.includes('#4') && e.includes('limit')) {
    return 'Facebook đang giới hạn số lần đăng của Trang này. Chờ khoảng một giờ rồi thử lại — không phải lỗi nội dung bài.';
  }
  // Instagram's answer when media_publish is handed a container it will not
  // accept. The words point at the id; the cause is almost never the id.
  if (e.includes('media id is not available')) {
    return 'Instagram chưa nhận được ảnh. Thường do ảnh chưa xử lý xong hoặc không đúng chuẩn: '
      + 'phải là JPG, rộng 320–1440px, tỷ lệ trong khoảng 4:5 (dọc) đến 1.91:1 (ngang) — '
      + 'ảnh quá dài hoặc quá vuông-cao sẽ bị từ chối. Bấm "Đăng ngay" để thử lại trước.';
  }
  if (e.includes('media_type') || e.includes('unsupported') || e.includes('aspect ratio')) {
    return 'Facebook/Instagram không nhận được file này. Kiểm tra link mở được từ trình duyệt lạ, và ảnh/video đúng định dạng thường (JPG, PNG, MP4).';
  }
  if (e.includes('not a video') || e.includes('image_url') || e.includes('video_url')) {
    return 'Link ảnh/video không tải được. Mở thử link đó ở tab ẩn danh — nếu phải đăng nhập mới xem được thì Meta cũng không tải được.';
  }
  return null;
}

// ---- when the scheduler should pick a post up ------------------------------

export interface QueuedPost {
  id: string;
  status: string;
  scheduledAt: Date;
  attempts: number;
  /** A salon comment the team has not answered. A held post does not publish. */
  heldAt?: Date | null;
}

/** Give up after this many tries rather than retrying a bad post forever. */
export const MAX_ATTEMPTS = 3;
/**
 * How late a post may still go out.
 *
 * A server that was down for two hours should still send this morning's post;
 * one that was down for two days should not suddenly publish Tuesday's offer on
 * Thursday. Six hours is long enough to survive an outage and short enough that
 * nothing arrives on the wrong day.
 */
export const LATE_GRACE_MS = 6 * 60 * 60 * 1000;

export function dueNow(posts: QueuedPost[], now: Date): { send: QueuedPost[]; expired: QueuedPost[] } {
  const send: QueuedPost[] = [];
  const expired: QueuedPost[] = [];
  for (const p of posts ?? []) {
    if (p.status !== 'scheduled') continue;
    if (p.attempts >= MAX_ATTEMPTS) continue;
    // The one case the calendar waits: the salon said something and nobody
    // answered. Publishing over an open comment is how the wrong price goes
    // out with the client watching.
    if (p.heldAt) continue;
    const at = p.scheduledAt.getTime();
    if (at > now.getTime()) continue;
    if (now.getTime() - at > LATE_GRACE_MS) expired.push(p);
    else send.push(p);
  }
  return { send, expired };
}

// ---- planning a month ahead ------------------------------------------------

/**
 * Two posts to the same account within this window read as spam to a follower
 * and, on Instagram, compete with each other in the same ranking pass.
 */
export const CROWDING_MS = 3 * 60 * 60 * 1000;

export interface SpacingWarning {
  /** The later of the two posts — the one the salon would move. */
  id: string;
  minutesApart: number;
  message: string;
}

/**
 * Where a month of scheduled content collides with itself.
 *
 * This is advice, never a refusal. Two posts an hour apart is a bad idea, not an
 * impossible one, and a salon publishing a flash offer at 11 and a follow-up at
 * 12 knows something this code does not. The queue says so and moves on.
 */
export function crowding(posts: { id: string; scheduledAt: Date; channels: Channel[] }[]): SpacingWarning[] {
  const out: SpacingWarning[] = [];
  for (const channel of ['facebook', 'instagram'] as Channel[]) {
    const on = (posts ?? [])
      .filter((p) => p.channels?.includes(channel))
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
    for (let i = 1; i < on.length; i += 1) {
      const gap = on[i].scheduledAt.getTime() - on[i - 1].scheduledAt.getTime();
      if (gap >= CROWDING_MS) continue;
      const mins = Math.round(gap / 60_000);
      out.push({
        id: on[i].id,
        minutesApart: mins,
        message: `Cách bài trước ${mins < 60 ? `${mins} phút` : `${Math.round(mins / 60)} tiếng`} trên ${channel === 'facebook' ? 'Facebook' : 'Instagram'}. Đăng dồn thì bài sau ăn mất người xem của bài trước.`,
      });
    }
  }
  return out;
}

/**
 * The Instagram profile grid, as it will look once everything has published.
 *
 * Newest first, three per row — the salon's own profile page, before it exists.
 * Only posts that will actually appear there: Instagram, with media, not
 * cancelled. A grid that shows a Facebook-only post is a grid that lies about
 * what the profile will look like.
 */
export function igGrid<T extends { channels: Channel[]; media: MediaItem[]; status: string; scheduledAt: Date }>(
  posts: T[],
): T[] {
  return (posts ?? [])
    .filter((p) => p.channels?.includes('instagram'))
    .filter((p) => (p.media ?? []).length > 0)
    .filter((p) => p.status !== 'cancelled' && p.status !== 'expired')
    .sort((a, b) => b.scheduledAt.getTime() - a.scheduledAt.getTime());
}
