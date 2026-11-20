/**
 * rt227 — "(#551) This person isn't available right now".
 *
 * Seen on Lumio Agency (Lien Vo, 20 Nov 2026): the customer COMMENTED on a post
 * ("Ib nhe") and never wrote to the Page. Meta puts such a person in the Page
 * inbox with its own note — "Lien Vo đã bình luận về bài viết của bạn. Lien Vo
 * sẽ chỉ nhìn thấy đoạn chat này sau khi bạn bắt đầu cuộc trò chuyện…" — but a
 * normal Messenger send to them is refused with #551: they have not opened a
 * conversation. The one way in is a PRIVATE REPLY to their comment (recipient
 * = the comment id): one message, within 7 days of the comment. Once they
 * answer, it is an ordinary conversation.
 */

/** Meta's "commented on your post" note, in Vietnamese or English. */
const NOTICE = /(đã bình luận về bài viết|commented on your (post|ad)|bình luận về (bài viết|quảng cáo) của bạn)/i;

export function isCommentNotice(text: unknown): boolean {
  return NOTICE.test(String(text ?? ''));
}

/**
 * The post a comment notice points at, as Graph's "<pageOrUser>_<story>" id.
 * Accepts story.php?story_fbid=…&id=… and /<id>/posts/<story> links.
 */
export function postIdFromNotice(text: unknown): string | null {
  const s = String(text ?? '');
  const a = s.match(/story_fbid=(\d+)[^\s)]*?[&?]id=(\d+)/) || s.match(/[?&]id=(\d+)[^\s)]*?story_fbid=(\d+)/);
  if (a) {
    // the second pattern captures (id, story) in the other order
    const [story, owner] = /story_fbid=(\d+)[^\s)]*?[&?]id=(\d+)/.test(s) ? [a[1], a[2]] : [a[2], a[1]];
    return `${owner}_${story}`;
  }
  const b = s.match(/facebook\.com\/(\d+)\/posts\/(\d+)/);
  return b ? `${b[1]}_${b[2]}` : null;
}

/** Did this customer only comment (Meta's notice is there, and no Messenger line of theirs after it)? */
export function commentOnly(history: { role?: string; content?: unknown; source?: string }[]): { notice: string; commentText: string | null } | null {
  if (!Array.isArray(history)) return null;
  let idx = -1;
  for (let i = history.length - 1; i >= 0; i -= 1) if (isCommentNotice(history[i]?.content)) { idx = i; break; }
  if (idx < 0) return null;
  // rt227b: a customer who has written to the Page before is NOT comment-only,
  // whatever Meta's note says — the owner caught this on Lien Vo, who had a
  // long conversation with the salon above the note.
  if (history.slice(0, idx).some((t) => t && t.role === 'user' && !isCommentNotice(t.content) && String(t.content ?? '').trim())) return null;
  const after = history.slice(idx + 1).filter((t) => t && t.role === 'user');
  // The comment itself comes through as the customer's line right after the
  // notice; a second line of theirs means they wrote on Messenger — ordinary.
  if (after.length >= 2) return null;
  return { notice: String(history[idx].content ?? ''), commentText: after.length ? String(after[0].content ?? '').trim() || null : null };
}

export type GraphComment = { id: string; message?: string; from?: { id?: string; name?: string }; created_time?: string };

/** Which comment on the post is this customer's: same id, else same name, else the same words. */
export function pickComment(comments: GraphComment[], who: { psid?: string | null; name?: string | null; text?: string | null }): GraphComment | null {
  const norm = (v: unknown) => String(v ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  const list = Array.isArray(comments) ? comments.filter((c) => c && c.id) : [];
  return list.find((c) => who.psid && c.from?.id === who.psid)
    ?? list.find((c) => who.name && norm(c.from?.name) === norm(who.name) && (!who.text || norm(c.message) === norm(who.text)))
    ?? list.find((c) => who.name && norm(c.from?.name) === norm(who.name))
    ?? list.find((c) => who.text && norm(c.message) === norm(who.text))
    ?? null;
}

export const COMMENT_ONLY_REASON = 'Khách này mới BÌNH LUẬN bài viết, chưa nhắn tin cho Page — Meta không cho gửi tin Messenger thường. Lumio đã thử gửi 1 tin riêng qua bình luận nhưng không được (Meta chỉ cho 1 tin, trong 7 ngày kể từ lúc khách bình luận). Hãy trả lời ngay dưới bình luận của khách trên bài viết; khi khách nhắn lại, trả lời ở đây bình thường.';
export const UNREACHABLE_REASON = 'Meta báo tài khoản của khách hiện KHÔNG nhận được tin từ Page này (mã #551). Đây không phải lỗi quá 24 giờ — nhân viên vẫn được trả lời trong 7 ngày. Thường là: khách đã chặn/tắt tin nhắn của Page, tài khoản khách bị khoá/tạm ẩn, hoặc khách từng nhắn với Page KHÁC của tiệm chứ không phải Page này. Thử gửi cùng tin trong Meta Business Suite: nếu ở đó gửi được thì báo Lumio kiểm tra; nếu ở đó cũng không gửi được thì là do phía tài khoản khách — gọi điện nếu có số.';
