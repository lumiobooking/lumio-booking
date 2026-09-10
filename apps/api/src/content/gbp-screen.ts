/**
 * The second look at a Google post: a model reads the picture and the text.
 *
 * The word list in gbp-policy catches what a word list can — "botox",
 * "casino", a phone number. It cannot see a beer bottle in the middle of
 * the photo, a competitor's logo, a customer's face, a phone number baked
 * into the picture, or an insult the list never heard of. Google's
 * reviewers can, and a Business Profile suspension is the price. So before
 * a post is locked for Google, Haiku looks at the actual photo and the
 * actual caption against Google's policy and answers in JSON.
 *
 * It is a gate, not an editor: it returns reasons, never rewrites. And it
 * fails OPEN on network trouble — the word list still stands, and a shop
 * whose post waits an hour because Anthropic was slow is worse served than
 * one whose post went out with only the word list checked. Fail closed only
 * on a verdict.
 */

export interface ScreenVerdict {
  ok: boolean;
  /** Policy lines the post breaks — refusals. Vietnamese. */
  blockers: string[];
  /** Things a reviewer would raise an eyebrow at — said, not enforced. */
  warnings: string[];
  /** Whether a photo was actually looked at. */
  sawImage: boolean;
}

export function gbpScreenPrompt(input: { summary: string; hasPhoto: boolean; shopName: string; trade: string }): { system: string; user: string } {
  const system = `Bạn là người kiểm duyệt nội dung cho bài đăng "Cập nhật" trên Google Business Profile (Google Maps) của một doanh nghiệp nhỏ. Việc của bạn: đối chiếu ẢNH và CHỮ với chính sách của Google và trả lời CHỈ bằng JSON.

CHÍNH SÁCH GOOGLE BUSINESS PROFILE (tóm tắt đúng nguồn support.google.com/business/answer/7213077 và contributionpolicy/answer/7400114):
1. Không có số điện thoại trong nội dung (Google tự gắn nút Gọi). Ảnh có số điện thoại/email/link in lên cũng tính.
2. HÀNG HẠN CHẾ: rượu bia, thuốc lá/vape, cờ bạc, vũ khí, dược phẩm, thiết bị/dịch vụ y tế, dịch vụ người lớn, dịch vụ tài chính. KHÔNG được quảng bá: không giá, không khuyến mãi, không link/liên hệ để mua. Nhắc tới thoáng qua thì được (ly rượu trong góc bàn ăn = được; poster "bia 20k" = không).
3. Cấm: nội dung khiêu dâm/gợi dục, bạo lực/máu me, thù ghét/xúc phạm/đe doạ, nguy hiểm, khủng bố, lạc đề (chính trị, bầu cử), lừa đảo/mạo danh, tin sai lệch (đặc biệt lời hứa y tế: chữa khỏi, giảm cân, thải độc).
4. Thông tin cá nhân không có sự đồng ý: mặt khách hàng chụp lén, biển số xe, giấy tờ tuỳ thân, tin nhắn riêng.
5. Trẻ em: tuyệt đối không có bối cảnh gợi dục; ảnh trẻ em nói chung phải là bối cảnh gia đình bình thường.
6. Ảnh phải "phản ánh thực tế": không chỉnh sửa sai lệch, không filter quá đà, không ảnh AI giả cảnh tiệm, không ảnh stock có watermark, không ảnh chụp màn hình, không logo/thương hiệu của người khác, không meme. Rõ nét, đủ sáng.
7. Đúng doanh nghiệp: ảnh và chữ phải về chính tiệm này (${input.shopName}, ngành ${input.trade}) — không phải sản phẩm/tiệm khác.

CÁCH CHẤM:
- "blockers": vi phạm rõ theo mục 1-7 → bài KHÔNG được đăng. Mỗi lý do 1 câu tiếng Việt, nói rõ thấy gì và sửa thế nào.
- "warnings": không vi phạm nhưng dễ bị Google từ chối hoặc trông thiếu chuyên nghiệp (ảnh tối/mờ, chữ chèn quá nhiều, giá to đùng, quá nhiều emoji, câu khẳng định "số 1"). Mỗi ý 1 câu.
- Nếu không thấy vấn đề, cả hai mảng để trống. Đừng bịa vấn đề để cho có.
- Hình ảnh nail/tóc/mi/spa bình thường (bàn tay, móng, tóc, bàn chân trong liệu trình pedicure) là HỢP LỆ, không phải nội dung người lớn.

Trả lời đúng một object JSON, không giải thích ngoài JSON:
{"ok": true|false, "blockers": ["..."], "warnings": ["..."]}`;

  const user = `Nội dung sẽ gửi lên Google (sau khi hệ thống đã tự bỏ số điện thoại, link, hashtag):
"""
${input.summary || '(không có chữ)'}
"""
${input.hasPhoto ? 'Ảnh đính kèm ở trên là ảnh DUY NHẤT sẽ lên Google. Hãy xem kỹ ảnh.' : 'Bài này không có ảnh.'}
Chấm theo chính sách và trả JSON.`;
  return { system, user };
}

/** Read the model's answer; anything unparseable is "could not tell", never "blocked". */
export function parseScreenVerdict(raw: string, sawImage: boolean): ScreenVerdict | null {
  const text = String(raw ?? '');
  const braced = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  if (!braced) return null;
  let parsed: { ok?: unknown; blockers?: unknown; warnings?: unknown };
  try { parsed = JSON.parse(braced) as typeof parsed; } catch { return null; }
  const list = (v: unknown) => (Array.isArray(v) ? v : [])
    .map((x) => String(x ?? '').trim())
    .filter((x) => x.length > 3)
    .slice(0, 6)
    .map((x) => x.slice(0, 300));
  const blockers = list(parsed.blockers);
  const warnings = list(parsed.warnings);
  // The boolean and the list must agree: a "true" with reasons attached is
  // a model hedging, and the reasons are what the writer needs.
  return { ok: parsed.ok !== false && blockers.length === 0, blockers, warnings, sawImage };
}

/** One line for the refusal, from a verdict. */
export function screenRefusal(v: ScreenVerdict | null): string | null {
  if (!v || v.ok) return null;
  return `Google Business (AI kiểm duyệt): ${v.blockers.join(' ')}`;
}
