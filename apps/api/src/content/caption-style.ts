/**
 * How a caption is written here — one standard, whoever writes it.
 *
 * WHAT WAS WRONG
 *
 *   "Gel Polish Change in real time. Clean lines. Precision hand. Every detail
 *    locked in. This is what $25 / 20 minutes looks like when you book with
 *    us. Zero stress, zero mistakes. Swipe in bio to book your next refresh."
 *
 * Seven fragments chained with full stops, a claim nobody can check ("zero
 * mistakes"), an idiom that does not exist ("swipe in bio"), and nine
 * hashtags picked for volume. It reads as an ad written by software, which is
 * the one thing a small salon's page must never read as — the whole reason a
 * customer books a neighbourhood shop over a chain is that a person is there.
 *
 * THE SHAPE
 *
 *   1. HOOK   one line, nine words or fewer: a specific claim, a number, or
 *             the question the viewer already has. Not an adjective pile.
 *   2. PROOF  one sentence with the concrete detail — minutes, bookings,
 *             how long it lasts — and ONLY a figure the data supplied.
 *      (blank line)
 *   3. ASK    exactly one action, one place: book via the link in bio. Real
 *             scarcity only when the book shows it (a quiet slot), never
 *             invented.
 *   4. TALK   optionally, one question that earns a comment.
 *      (blank line)
 *   5. TAGS   five to eight: two local, three for the service, the rest broad.
 *
 * Whole sentences, in the owner's voice, under sixty words before the tags,
 * two emoji at most and only at line ends. The same rules go to the model as
 * text and to the template captions as code, and `captionIssues` reads a
 * finished caption back against them — so a bad one is caught, not shipped.
 */

/** The rules, as the drafting prompt states them. Vietnamese because the prompt is. */
export const CAPTION_RULES = `CAPTION — viết theo đúng khung này, mỗi phần một dòng:
  Dòng 1 (HOOK): ≤ 9 từ. Một con số, một khẳng định cụ thể, hoặc đúng câu khách đang tự hỏi. Không xếp tính từ.
  Dòng 2 (BẰNG CHỨNG): một câu trọn vẹn có chi tiết thật — phút, số lượt đặt, giữ được bao lâu. CHỈ dùng số đã có trong dữ liệu; không có số thì không bịa.
  (dòng trống)
  Dòng 3 (KÊU GỌI): đúng MỘT hành động, một nơi: "Book in 30 seconds — link in bio." Chỉ nói "còn ít chỗ" khi dữ liệu ghi khung giờ trống.
  Dòng 4 (tuỳ chọn): một câu hỏi để khách bình luận.
  (dòng trống)
  Hashtags: 5–8 tag — 2 tag địa phương, 3 tag đúng dịch vụ, còn lại tag rộng.
CẤM: câu cụt xếp nối nhau ("Clean lines. Precision hand."), "swipe in bio" (không có cụm này — là "link in bio"), lời hứa không kiểm chứng được ("zero mistakes", "perfect every time"), quá 60 từ trước hashtag, quá 2 emoji, emoji giữa câu. Giọng là chủ tiệm nói với hàng xóm, không phải quảng cáo.`;

/** How the model must write "reason": short, sourced, and never about itself. */
export const REASON_RULES = `"reason": tối đa 2 câu, nêu đúng con số hoặc sự kiện đã dẫn tới ý này. KHÔNG nhắc "Ý 1/2/3", "rank", "định dạng", "thư viện", hay bất kỳ luật nào trong hướng dẫn này — chủ tiệm đọc câu này, không phải người viết prompt.`;

/** How the model must write "shotList": numbered scenes with a length each. */
export const SHOTLIST_RULES = `"shotList": 3–5 cảnh, ngăn cách bằng " · ", mỗi cảnh ghi rõ quay gì và mấy giây, ví dụ "Cận bộ móng xoay dưới đèn (3s) · Tay thợ tháo bộ cũ (4s)". Không viết thành đoạn văn.`;

export interface CaptionParts {
  hook: string;
  proof?: string | null;
  ask: string;
  talk?: string | null;
}

/** Assemble the shape. Blank lines are the structure; nothing else is added. */
export function composeCaption(p: CaptionParts): string {
  const top = [p.hook.trim(), (p.proof ?? '').trim()].filter(Boolean).join('\n');
  const bottom = [p.ask.trim(), (p.talk ?? '').trim()].filter(Boolean).join('\n');
  return `${top}\n\n${bottom}`;
}

const EMOJI = /\p{Extended_Pictographic}/gu;

/**
 * What a finished caption gets wrong, in words a person can act on.
 *
 * Empty means it passes. This is read against the model's output on every
 * draft and against the templates in their tests — the template that fails
 * its own standard is caught before the standard is shipped.
 */
export function captionIssues(caption: string): string[] {
  const out: string[] = [];
  const body = caption.split(/\n\s*#|\s#\w/)[0] ?? caption; // before the tags
  const words = body.trim().split(/\s+/).filter(Boolean);
  if (words.length > 60) out.push(`quá dài: ${words.length} từ trước hashtag (tối đa 60)`);

  if (/swipe\s+in\s+bio|swipe\s+up\s+in\s+bio/i.test(caption)) out.push('"swipe in bio" không tồn tại — là "link in bio"');

  // Fragments: three or more consecutive "sentences" of four words or fewer.
  // "Clean lines. Precision hand. Every detail locked in." is the pattern —
  // adjectives with full stops between them, and no verb doing any work.
  const sentences = body.replace(/\n+/g, ' ').split(/[.!?]+\s+/).map((s) => s.trim()).filter(Boolean);
  let run = 0;
  for (const sn of sentences) {
    run = sn.split(/\s+/).length <= 4 ? run + 1 : 0;
    if (run >= 3) { out.push('chuỗi câu cụt nối nhau — viết thành câu trọn vẹn'); break; }
  }

  if (/zero mistakes|perfect every time|flawless every|guaranteed|100%/i.test(caption)) out.push('lời hứa không kiểm chứng được');

  const emojis = (caption.match(EMOJI) ?? []).length;
  if (emojis > 2) out.push(`${emojis} emoji (tối đa 2)`);

  const tags = (caption.match(/#\w+/g) ?? []).length;
  if (tags > 0 && (tags < 5 || tags > 8)) out.push(`${tags} hashtag (cần 5–8)`);

  if (!/\n\s*\n/.test(body.trim())) out.push('thiếu dòng trống tách phần kêu gọi');
  return out;
}
