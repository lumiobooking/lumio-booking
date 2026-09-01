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
 * that stops. If a post is aimed at Facebook and Instagram but carries no image,
 * Instagram cannot take it at all — the Content Publishing API has no text-only
 * post. Publishing to Facebook alone and reporting success would tell the salon
 * their Instagram is being kept alive when it is not. So a post that cannot be
 * fully delivered says so, names the missing piece, and is not sent anywhere the
 * salon did not get to see coming.
 *
 * PLATFORM LIMITS ARE FACTS, NOT PREFERENCES
 *
 * Instagram rejects a caption over 2,200 characters and rejects media with more
 * than 30 hashtags. Over the line the API returns an error, so the post simply
 * does not go out — at 9am on the morning the salon expected it. Both are
 * checked here, before the post is accepted into the queue, where the person who
 * wrote it is still looking at it.
 */

/** Instagram caption ceiling. Over this the Graph API rejects the container. */
export const IG_CAPTION_MAX = 2200;
/** Instagram hashtag ceiling per media. */
export const IG_HASHTAG_MAX = 30;
/** Facebook Page post ceiling. Generous, but not infinite. */
export const FB_MESSAGE_MAX = 63_206;

export type Channel = 'facebook' | 'instagram';

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
  /** A public https image URL. Instagram cannot post without one. */
  imageUrl: string | null;
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
  plans: ChannelPlan[];
  /** True only when every requested channel can actually receive the post. */
  ready: boolean;
  /** The blocking problems, deduped, for one line on the screen. */
  problems: string[];
}

const hashtagCount = (s: string) => (s.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;

/** A public https URL. Meta fetches this itself, so localhost cannot work. */
export function usableImageUrl(url: string | null | undefined): boolean {
  const u = (url ?? '').trim();
  if (!/^https:\/\//i.test(u)) return false;
  // Meta's servers fetch the image. An address only this machine can resolve
  // produces a container error minutes after the salon has walked away.
  if (/^https:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(u)) return false;
  if (/^https:\/\/[^/]*\.local(\b|[:/])/i.test(u)) return false;
  return true;
}

export function planPublish(draft: PostDraft, page: ConnectedPage | null): PublishPlan {
  const wanted = Array.from(new Set(draft.channels ?? []));
  const text = (draft.message ?? '').trim();
  const plans: ChannelPlan[] = [];

  for (const channel of wanted) {
    const refusal = refuse(channel, draft, text, page);
    plans.push({
      channel,
      ok: refusal === null,
      targetId: refusal === null ? (channel === 'facebook' ? page!.pageId : page!.igId) : null,
      refusal,
    });
  }

  const problems = Array.from(new Set(plans.filter((p) => !p.ok).map((p) => p.refusal!)));
  return {
    plans,
    // Not "at least one channel works". A post the salon believes is going to
    // both places must go to both places or wait until it can.
    ready: wanted.length > 0 && plans.every((p) => p.ok),
    problems,
  };
}

function refuse(channel: Channel, draft: PostDraft, text: string, page: ConnectedPage | null): string | null {
  if (!page) return 'Tiệm chưa kết nối Trang Facebook. Vào Cài đặt → Messenger để kết nối trước.';
  if (!page.enabled) return `Trang ${page.pageName ?? ''} đang tắt kết nối. Bật lại rồi mới đăng được.`.replace('  ', ' ');
  if (!text) return 'Bài chưa có nội dung.';

  if (channel === 'facebook') {
    if (text.length > FB_MESSAGE_MAX) return `Nội dung dài ${text.length} ký tự, quá giới hạn ${FB_MESSAGE_MAX} của Facebook.`;
    if (draft.imageUrl && !usableImageUrl(draft.imageUrl)) return 'Link ảnh phải là https công khai — Facebook tự tải ảnh về từ link này.';
    return null;
  }

  // ---- Instagram ----
  if (!page.igId) {
    return 'Trang Facebook này chưa liên kết tài khoản Instagram chuyên nghiệp. Liên kết trong cài đặt Trang trên Facebook rồi kết nối lại.';
  }
  // The Content Publishing API has no text-only post. There is no way to make
  // this work by trying harder, so it is refused here instead of failing in a
  // scheduler run at 9am.
  if (!draft.imageUrl) return 'Instagram bắt buộc phải có ảnh hoặc video — không đăng được bài chỉ có chữ.';
  if (!usableImageUrl(draft.imageUrl)) return 'Link ảnh phải là https công khai — Instagram tự tải ảnh về từ link này.';
  if (text.length > IG_CAPTION_MAX) return `Caption dài ${text.length} ký tự, quá giới hạn ${IG_CAPTION_MAX} của Instagram.`;
  const tags = hashtagCount(text);
  if (tags > IG_HASHTAG_MAX) return `Bài có ${tags} hashtag, quá giới hạn ${IG_HASHTAG_MAX} của Instagram.`;
  return null;
}

// ---- when the scheduler should pick a post up ------------------------------

export interface QueuedPost {
  id: string;
  status: string;
  scheduledAt: Date;
  attempts: number;
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
    const at = p.scheduledAt.getTime();
    if (at > now.getTime()) continue;
    if (now.getTime() - at > LATE_GRACE_MS) expired.push(p);
    else send.push(p);
  }
  return { send, expired };
}
