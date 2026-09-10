/**
 * What may go on a Google Business Profile — checked before it is sent.
 *
 * WHY THIS IS STRICTER THAN FACEBOOK
 *
 * A Facebook post that breaks a rule is taken down. A Google post that breaks
 * one can get the whole Business Profile suspended — and a suspended profile
 * is a shop that has vanished from Maps, from "nail salon near me", from the
 * phone number people tap. Recovering it takes weeks of appeals. So the rule
 * here is not "warn and let them decide": anything Google's policy forbids is
 * refused at write time, in the writer's language, with the fix.
 *
 * WHAT GOOGLE ACTUALLY SAYS (support.google.com/business/answer/7213077 and
 * the Maps user-generated content policy, contributionpolicy/answer/7400114)
 *
 *  - No phone number in the post text. Google adds its own Call button from
 *    the verified profile.
 *  - Restricted goods — alcohol, tobacco, gambling, firearms, pharmaceuticals,
 *    health/medical devices, adult services, financial services — may not be
 *    PROMOTED: no deals, prices, coupons, links or contact for them.
 *    Incidental mentions are fine (a menu with wine on it).
 *  - No sexually explicit, dangerous, hateful, violent or off-topic content
 *    (political posts are the usual off-topic rejection).
 *  - No misinformation, and deceptive health claims in particular.
 *  - No personal information without consent.
 *  - Photos: JPG or PNG, 10 KB – 5 MB, at least 250 × 250 px, "in focus,
 *    well lit, no significant alterations or excessive filters" — the image
 *    should represent reality.
 *
 * Two kinds of finding come out of here. A BLOCKER is a policy line: the post
 * is refused until it changes. A WARNING is Google's automated spam filter
 * or plain good practice — all caps, six exclamation marks, "#1 in town" —
 * and the writer may go ahead.
 *
 * Words alone cannot catch everything (a photo of a beer, an insult in a
 * language this list does not know). That is the AI screen's job, in
 * gbp-screen; this file is the part that is fast, free, and testable.
 */

/**
 * A Google Business Profile post ("local post") holds 1,500 characters and ONE
 * photo — the API takes no video and no carousel, and there is no scheduling
 * on Google's side at all, which is why Lumio's sweep does it.
 */
export const GBP_SUMMARY_MAX = 1500;

/** The shape social-publish uses; declared here so this file imports nothing from it. */
interface MediaLike { url: string; kind: 'image' | 'video' }

export interface Issue {
  code: string;
  /** Said to the writer. Vietnamese, with the English alongside for the UI's T(). */
  vi: string;
  en: string;
  /** The words that tripped it, so the writer can find them. */
  match?: string;
}

export interface GbpTextCheck {
  blockers: Issue[];
  warnings: Issue[];
}

// ---- the text Google will actually receive -----------------------------------

const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const URL_RE = /(?:https?:\/\/|www\.)[^\s]+/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const HANDLE_RE = /(?<![\w.])@[\w.]{2,}/g;
const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;
/** A line that is only decoration once its content is gone: "📞 " or "• ". */
const EMPTY_LINE_RE = /^[\s\p{P}\p{S}\p{Extended_Pictographic}️]*$/u;

/** Digits in a phone match — a price "$1,200.00" must not count as one. */
const looksLikePhone = (m: string) => (m.match(/\d/g) ?? []).length >= 9 && !/[$€£₫%]/.test(m);

export type Removed = 'phone' | 'link' | 'email' | 'handle' | 'hashtag';

/**
 * The caption, made fit for Google.
 *
 * The salon's contact block — phone, website, Instagram handle, hashtags —
 * is right on Facebook and wrong on Google: the phone number is refused
 * outright, links and handles are "advertising and solicitation", and
 * hashtags do nothing on Maps but look like spam. One caption feeds every
 * channel, so the Google copy is derived rather than typed twice, and the
 * preview shows exactly this.
 */
export function gbpSummary(message: string): { text: string; removed: Removed[] } {
  const removed = new Set<Removed>();
  let t = String(message ?? '');
  t = t.replace(URL_RE, () => { removed.add('link'); return ''; });
  t = t.replace(EMAIL_RE, () => { removed.add('email'); return ''; });
  t = t.replace(PHONE_RE, (m) => { if (!looksLikePhone(m)) return m; removed.add('phone'); return ''; });
  t = t.replace(HANDLE_RE, () => { removed.add('handle'); return ''; });
  t = t.replace(HASHTAG_RE, () => { removed.add('hashtag'); return ''; });
  const lines = t.split(/\r?\n/).map((l) => l.replace(/[ \t]+/g, ' ').trim());
  const kept: string[] = [];
  for (const l of lines) {
    if (EMPTY_LINE_RE.test(l)) {
      // Keep ONE blank line between paragraphs; drop the decoration that a
      // stripped phone line leaves behind.
      if (kept.length && kept[kept.length - 1] !== '') kept.push('');
      continue;
    }
    kept.push(l);
  }
  while (kept.length && kept[kept.length - 1] === '') kept.pop();
  // Not truncated here: the planner refuses past the ceiling, so what is
  // sent is always what was approved, never a caption cut mid-sentence.
  return { text: kept.join('\n').trim(), removed: Array.from(removed) };
}

// ---- words ---------------------------------------------------------------------

/** A whole word, in any script — \b does not know Vietnamese letters. */
const word = (alts: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, 'iu');

/** A price, a discount, a deal — the thing that turns a mention into a promotion. */
const PROMO = word('giảm giá|giảm \\d+%|khuyến mãi|khuyến mại|ưu đãi|miễn phí|free|sale|deal|combo|mua \\d+ tặng \\d+|buy \\d+ get|happy hour|\\d+k|\\d+ ?(?:đ|vnd|usd)|\\$ ?\\d+|\\d+%|tặng kèm|giá (?:chỉ|sốc|rẻ)|only \\$?\\d+|special|coupon|voucher');

interface Rule { code: string; re: RegExp; kind: 'block' | 'warn' | 'promo'; vi: string; en: string }

/**
 * `promo` rules block only when a price or deal sits on the same line — the
 * policy's own distinction between promoting a restricted product and
 * mentioning it. Everything else blocks or warns on the word alone.
 */
const RULES: Rule[] = [
  {
    code: 'alcohol', kind: 'promo',
    re: word('bia|beer|rượu|wine|vang|cocktail|champagne|prosecco|vodka|whisky|whiskey|tequila|soju|sake|mimosa|nhậu|đồ uống có cồn|alcohol|liquor|brewery|nhà máy bia'),
    vi: 'Google không cho quảng cáo, ghi giá hay khuyến mãi đồ uống có cồn trên Business Profile. Được nhắc tới, không được rao bán — bỏ giá/ưu đãi khỏi dòng đó.',
    en: 'Google does not allow deals, prices or promotions for alcohol on a Business Profile. Mentioning it is fine; selling it is not — take the price/offer off that line.',
  },
  {
    code: 'tobacco', kind: 'promo',
    re: word('thuốc lá|thuốc lào|vape|vaping|e-?cig(?:arette)?s?|shisha|hookah|cigar|xì gà|nicotine|tobacco'),
    vi: 'Thuốc lá, vape, shisha là hàng bị hạn chế — Google không cho khuyến mãi hay ghi giá.',
    en: 'Tobacco, vape and shisha are restricted goods — Google allows no promotion or pricing.',
  },
  {
    code: 'gambling', kind: 'block',
    re: word('casino|sòng bài|cá cược|cá độ|betting|lottery|xổ số|lô đề|poker|slot machine|jackpot|đánh bạc|gambling'),
    vi: 'Nội dung cờ bạc/cá cược bị cấm trên Google Business Profile.',
    en: 'Gambling and betting content is not allowed on a Google Business Profile.',
  },
  {
    code: 'sweepstake', kind: 'warn',
    re: word('raffle|quay số|bốc thăm|giveaway|sweepstakes?|trúng thưởng|rút thăm'),
    vi: 'Quay số/bốc thăm dễ bị Google coi là cờ bạc nếu phải mua hàng để tham gia. Ghi rõ "không cần mua" và điều kiện.',
    en: 'A raffle or giveaway reads as gambling to Google when a purchase is required. State "no purchase necessary" and the terms.',
  },
  {
    code: 'weapons', kind: 'block',
    re: word('súng|guns?|firearms?|ammo|ammunition|đạn|rifle|pistol|vũ khí|taser|pepper spray|dao găm|knife sale'),
    vi: 'Vũ khí là hàng bị hạn chế — không đăng lên Google Business Profile.',
    en: 'Weapons are restricted goods — not for a Google Business Profile post.',
  },
  {
    code: 'drugs', kind: 'block',
    re: word('cần sa|cannabis|marijuana|weed|thc|cbd|kush|cocaine|ma túy|opioid|xanax|adderall|steroids?|ozempic|semaglutide|thuốc kê đơn|prescription drugs?|pharmacy deals?'),
    vi: 'Dược phẩm/chất bị kiểm soát bị cấm quảng bá trên Google Business Profile.',
    en: 'Pharmaceuticals and controlled substances may not be promoted on a Google Business Profile.',
  },
  {
    code: 'medical', kind: 'block',
    re: word('botox|filler|tiêm (?:filler|botox|meso|trắng|tan mỡ)|injections?|phẫu thuật|surgery|truyền (?:trắng|dịch)|iv drip|iv therapy|thuốc giảm cân|diet pills?'),
    vi: 'Dịch vụ y khoa/thiết bị y tế (tiêm, filler, botox, phẫu thuật, truyền) là mục Google hạn chế — không quảng bá qua bài đăng Business Profile.',
    en: 'Medical services and devices (injections, filler, botox, surgery, IV) are restricted by Google — not for a Business Profile post.',
  },
  {
    code: 'health-claim', kind: 'block',
    re: word('chữa (?:khỏi|bệnh|dứt điểm)|trị (?:bệnh|dứt điểm|tận gốc)|cure[sd]?|heals?|thải độc|detox(?:ify|ing)?|giảm \\d+ ?(?:kg|cân|lbs?)|lose \\d+ ?(?:lbs?|kg|pounds)|weight loss|giảm cân cấp tốc|diệt (?:khuẩn|virus) 100%|kills? (?:99|100)%|anti-?cancer|chống ung thư|trị tiểu đường|cures? diabetes'),
    vi: 'Lời hứa chữa bệnh, giảm cân, thải độc là "thông tin y tế gây hiểu lầm" theo policy Google. Mô tả dịch vụ, đừng hứa kết quả y khoa.',
    en: 'Promises to cure, detox or lose weight count as deceptive health claims under Google policy. Describe the service; do not promise a medical result.',
  },
  {
    code: 'adult', kind: 'block',
    re: word('sex|sexy|sexual|sexiest|nude|nudes|khỏa thân|khoả thân|porn|escort|erotic|xxx|happy ending|sensual|người lớn 18\\+|18\\+|onlyfans|strip(?:per|tease)'),
    vi: 'Google tự động từ chối bài có từ "sex/sexy/nude…" kể cả dùng vô hại (ví dụ "sexy nails"). Đổi sang "quyến rũ", "sang", "gorgeous", "classy".',
    en: 'Google auto-rejects posts containing "sex/sexy/nude…" even in harmless use ("sexy nails"). Say "gorgeous", "classy", "stunning" instead.',
  },
  {
    code: 'finance', kind: 'block',
    re: word('vay (?:tiền|vốn|nhanh|nóng)|loans?|payday|credit card offer|thẻ tín dụng|crypto|bitcoin|forex|đầu tư sinh lời|guaranteed returns?|lãi suất|mortgage|cho vay'),
    vi: 'Dịch vụ tài chính (cho vay, đầu tư, crypto) là mục Google hạn chế — không quảng bá qua bài đăng.',
    en: 'Financial services (loans, investments, crypto) are restricted by Google — not for a Business Profile post.',
  },
  {
    code: 'financing', kind: 'warn',
    re: word('trả góp|installments?|financing|0% apr|pay later|klarna|affirm|afterpay'),
    vi: 'Trả góp là ưu đãi tài chính — Google có thể coi là quảng cáo dịch vụ tài chính. Nói ngắn ("có trả góp"), không ghi lãi suất/điều khoản.',
    en: 'Financing is a financial offer — Google may read it as promoting financial services. Keep it to "financing available"; no rates or terms.',
  },
  {
    code: 'political', kind: 'block',
    re: word('bầu cử|election|vote for|trump|biden|harris|obama|đảng cộng sản|chính trị|political|biểu tình|protest|cộng sản|communist|democrat|republican'),
    vi: 'Nội dung chính trị là "lạc đề" với hồ sơ doanh nghiệp — Google từ chối. Bài Business Profile chỉ nói về tiệm.',
    en: 'Political content is "off-topic" for a business profile and gets rejected. A Business Profile post is about the shop only.',
  },
  {
    code: 'hate', kind: 'block',
    re: word('kỳ thị|racist|đồ ngu|thằng ngu|con đĩ|đĩ|whore|slut|nigg\\w*|faggot|retard(?:ed)?|kill (?:them|him|her|you)|giết'),
    vi: 'Lời lẽ xúc phạm, thù ghét hoặc đe doạ bị cấm tuyệt đối.',
    en: 'Abusive, hateful or threatening language is strictly forbidden.',
  },
  {
    code: 'covid', kind: 'warn',
    re: word('covid|corona|vaccine|vắc ?xin|vaccin'),
    vi: 'Nội dung liên quan COVID/vắc-xin bị Google soi rất kỹ (misinformation). Chỉ nói về giờ mở cửa/biện pháp của tiệm, không đưa ý kiến y tế.',
    en: 'COVID/vaccine content is screened hard by Google (misinformation). Stick to your own hours and measures; no medical opinions.',
  },
  {
    code: 'superlative', kind: 'warn',
    re: word('#1|số 1|number one|tốt nhất|rẻ nhất|đẹp nhất|best in (?:town|the city|\\w+)|the best|duy nhất|cam kết 100%|100% guaranteed|guaranteed|đảm bảo 100%|top 1|uy tín nhất'),
    vi: 'Khẳng định "số 1 / tốt nhất / cam kết 100%" là claim không chứng minh được — Google xếp vào nội dung gây hiểu lầm. Nói cụ thể thay vì so sánh.',
    en: '"#1 / best / 100% guaranteed" is a claim nobody can back — Google files it under misleading content. Be specific instead of superlative.',
  },
];

const EMOJI_RE = /\p{Extended_Pictographic}/gu;

/**
 * Every finding on the text Google would receive.
 *
 * Run on the OUTPUT of gbpSummary, not the raw caption: a phone number is
 * stripped rather than reported, and there is no point warning about a
 * hashtag that is already gone.
 */
export function gbpTextIssues(text: string): GbpTextCheck {
  const blockers: Issue[] = [];
  const warnings: Issue[] = [];
  const t = String(text ?? '');
  const lines = t.split(/\r?\n/);
  const seen = new Set<string>();
  const add = (list: Issue[], r: Rule, match: string) => {
    if (seen.has(r.code)) return;
    seen.add(r.code);
    list.push({ code: r.code, vi: r.vi, en: r.en, match });
  };

  for (const r of RULES) {
    if (r.kind === 'promo') {
      for (const line of lines) {
        const m = r.re.exec(line);
        if (!m) continue;
        if (PROMO.test(line)) add(blockers, r, m[0]);
        else add(warnings, r, m[0]);
        break;
      }
      continue;
    }
    const m = r.re.exec(t);
    if (m) add(r.kind === 'block' ? blockers : warnings, r, m[0]);
  }

  // ---- how it is written: Google's spam filter, and plain good manners ----
  const letters = t.replace(/[^\p{L}]/gu, '');
  const upper = letters.replace(/[^\p{Lu}]/gu, '');
  if (letters.length >= 20 && upper.length / letters.length > 0.7) {
    warnings.push({ code: 'caps', vi: 'Viết HOA toàn bộ bị bộ lọc spam của Google để ý. Viết thường, in hoa vài từ nhấn là đủ.', en: 'ALL CAPS trips Google’s spam filter. Write normally; capitalise a word or two for emphasis.' });
  }
  if (/[!?]{3,}|\.{5,}/.test(t)) {
    warnings.push({ code: 'punctuation', vi: 'Dấu "!!!" / "???" liên tiếp là dấu hiệu spam với Google. Một dấu là đủ.', en: '"!!!" / "???" reads as spam to Google. One is enough.' });
  }
  const emojis = (t.match(EMOJI_RE) ?? []).length;
  if (emojis > 8) {
    warnings.push({ code: 'emoji', vi: `Bài có ${emojis} emoji — trên Google Maps trông như spam và có bài bị từ chối vì thế. Giữ dưới 5.`, en: `${emojis} emoji — looks like spam on Maps and posts have been rejected for it. Keep it under 5.` });
  }
  return { blockers, warnings };
}

// ---- photos --------------------------------------------------------------------

export const GBP_IMAGE_MIN_PX = 250;
export const GBP_IMAGE_MIN_BYTES = 10 * 1024;
export const GBP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Extensions Google will not take, when the link shows one. */
const BAD_EXT_RE = /\.(gif|webp|heic|heif|svg|bmp|tiff?|avif)(\?|#|$)/i;

/**
 * What can be said about the photos from their links alone.
 * Video is refused by the planner already; here it is format and count.
 */
export function gbpImageIssues(media: MediaLike[]): GbpTextCheck {
  const blockers: Issue[] = [];
  const warnings: Issue[] = [];
  const photos = (media ?? []).filter((m) => m.kind === 'image');
  const bad = photos.find((m) => BAD_EXT_RE.test(m.url));
  if (bad) {
    blockers.push({ code: 'format', vi: 'Google Business chỉ nhận ảnh JPG hoặc PNG. Ảnh này là định dạng khác — tải lại bằng nút "Tải ảnh lên" (hệ thống tự chuyển sang JPG).', en: 'Google Business takes JPG or PNG only. This one is another format — re-upload it with "Upload photos" (it is converted to JPG).', match: bad.url.split('/').pop() });
  }
  if (photos.length > 1) {
    warnings.push({ code: 'one-photo', vi: `Google chỉ lấy ảnh đầu tiên (bài có ${photos.length} ảnh). Kéo ảnh đẹp nhất lên đầu.`, en: `Google takes the first photo only (this post has ${photos.length}). Drag the best one to the top.` });
  }
  return { blockers, warnings };
}

/**
 * Judge a photo from the headers its host answers with — the check the
 * sweep runs before handing the link to Google, who would otherwise fail the
 * whole post with "media could not be processed" an hour after the writer
 * left. Null when the headers are fine or say nothing.
 */
export function gbpImageHeaderProblem(h: { contentType?: string | null; contentLength?: number | null }): string | null {
  const type = (h.contentType ?? '').toLowerCase().split(';')[0].trim();
  if (type && !/^image\/(jpe?g|png)$/.test(type)) {
    return `Google chỉ nhận JPG/PNG; ảnh này là ${type || 'định dạng khác'}. Tải lại bằng "Tải ảnh lên".`;
  }
  const len = h.contentLength ?? null;
  if (len !== null && len > 0) {
    if (len < GBP_IMAGE_MIN_BYTES) return `Ảnh quá nhỏ (${Math.round(len / 1024)} KB) — Google yêu cầu từ 10 KB và ít nhất 250×250 px.`;
    if (len > GBP_IMAGE_MAX_BYTES) return `Ảnh quá nặng (${(len / 1024 / 1024).toFixed(1)} MB) — Google nhận tối đa 5 MB. Tải lại bằng "Tải ảnh lên" để hệ thống nén.`;
  }
  return null;
}

/** Pixel size, when the screen has measured it. */
export function gbpImageSizeProblem(w: number, h: number): string | null {
  if (w > 0 && h > 0 && (w < GBP_IMAGE_MIN_PX || h < GBP_IMAGE_MIN_PX)) {
    return `Ảnh ${w}×${h} px — Google yêu cầu ít nhất ${GBP_IMAGE_MIN_PX}×${GBP_IMAGE_MIN_PX} px (nên 720×720 trở lên).`;
  }
  return null;
}

// ---- the whole verdict -----------------------------------------------------------

export interface GbpCheck {
  /** The text Google receives, after the contact block is stripped. */
  summary: string;
  removed: Removed[];
  blockers: Issue[];
  warnings: Issue[];
}

export function checkGbpPost(message: string, media: MediaLike[]): GbpCheck {
  const { text, removed } = gbpSummary(message);
  const t = gbpTextIssues(text);
  const i = gbpImageIssues(media);
  const blockers = [...t.blockers, ...i.blockers];
  const warnings = [...t.warnings, ...i.warnings];
  if (!text && String(message ?? '').trim()) {
    blockers.unshift({ code: 'empty', vi: 'Sau khi bỏ số điện thoại/link/hashtag theo policy Google, bài không còn chữ. Thêm vài dòng mô tả.', en: 'Once the phone number, links and hashtags are stripped per Google policy, nothing is left. Add a few lines of text.' });
  }
  return { summary: text, removed, blockers, warnings };
}

/** One line for the planner's refusal: the first blocker, in Vietnamese. */
export function gbpRefusal(message: string, media: MediaLike[]): string | null {
  const c = checkGbpPost(message, media);
  const first = c.blockers[0];
  if (!first) return null;
  const where = first.match ? ` (từ "${first.match}")` : '';
  return `Google Business: ${first.vi}${where}`;
}
