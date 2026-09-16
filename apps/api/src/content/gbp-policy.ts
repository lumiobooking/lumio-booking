/**
 * What may go on a Google Business Profile — checked before it is sent.
 *
 * THREE LEVELS, NOT TWO
 *
 * This file used to answer yes/no: a word on the list refused the post. That
 * was built for the one real fear — a Business Profile suspension is a shop
 * that has vanished from Maps — but it refused a great deal Google actually
 * allows. "Nude" is the most-used nail colour in America. "Detox" is a
 * body-scrub on every spa menu. "Thẻ tín dụng" means the shop takes cards.
 * A writer who is stopped four times for words like those stops trusting the
 * check, and then ignores the one that mattered.
 *
 * So a finding now lands in one of three places:
 *
 *   BLOCKER — Google forbids it outright and a profile can be suspended for
 *     it: sexual content, hate and threats, weapons, illegal drugs, gambling
 *     for money, a promise to cure a disease. Nobody overrides these. They
 *     are deliberately few and deliberately unambiguous.
 *
 *   RISK — Google RESTRICTS it: alcohol and tobacco promotion, medical
 *     services, financial services, politics, prescription products. A post
 *     like this may be rejected, and a med-spa that really does inject filler
 *     has to be able to say so. The team is shown the rule and may accept it
 *     (see `ack` in gbp-cta); the salon's own screen never can.
 *
 *   WARNING — the spam filter and plain good practice: all caps, six
 *     exclamation marks, "#1 in town". Said, never enforced.
 *
 * And a fourth answer that is better than all three: SOFTEN. The Google copy
 * is already derived from the caption (the phone number and hashtags are
 * stripped, not refused), so a word Google's classifier dislikes but the
 * writer meant innocently is swapped in the Google copy alone. "Sexy red" is
 * "gorgeous red" on Maps and stays "sexy red" on Facebook. No refusal, no
 * rewrite by hand.
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
 *    well lit, no significant alterations or excessive filters".
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

/** How hard a finding bites. See the file header. */
export type Level = 'hard' | 'risky' | 'warn';

export interface Issue {
  code: string;
  level: Level;
  /** Said to the writer. Vietnamese, with the English alongside for the UI's T(). */
  vi: string;
  en: string;
  /** The words that tripped it, so the writer can find them. */
  match?: string;
}

export interface GbpTextCheck {
  /** Absolute. No override exists. */
  blockers: Issue[];
  /** Restricted by Google — the team may accept the risk. */
  risks: Issue[];
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
 * Words Google's classifier reads as adult content and a salon means as a
 * colour or a compliment. Swapped in the GOOGLE copy only, keeping the
 * caption the writer typed intact everywhere else — the alternative was
 * refusing "nude pink almond set", which is a real post a real shop writes
 * every week. Case and the rest of the sentence are left alone.
 */
const SOFTEN: { re: RegExp; to: string; vi: string; en: string }[] = [
  { re: /(?<![\p{L}\p{N}])sexiest(?![\p{L}\p{N}])/giu, to: 'most gorgeous', vi: '"sexiest" → "most gorgeous"', en: '"sexiest" → "most gorgeous"' },
  { re: /(?<![\p{L}\p{N}])sexy(?![\p{L}\p{N}])/giu, to: 'gorgeous', vi: '"sexy" → "gorgeous"', en: '"sexy" → "gorgeous"' },
  { re: /(?<![\p{L}\p{N}])nudes(?![\p{L}\p{N}])/giu, to: 'neutrals', vi: '"nudes" → "neutrals"', en: '"nudes" → "neutrals"' },
  { re: /(?<![\p{L}\p{N}])nude(?![\p{L}\p{N}])/giu, to: 'neutral', vi: '"nude" → "neutral" (Google đọc "nude" là nội dung người lớn)', en: '"nude" → "neutral" (Google reads "nude" as adult content)' },
  { re: /(?<![\p{L}\p{N}])gợi cảm(?![\p{L}\p{N}])/giu, to: 'cuốn hút', vi: '"gợi cảm" → "cuốn hút"', en: '"gợi cảm" → "cuốn hút"' },
  { re: /(?<![\p{L}\p{N}])18\s?\+/gu, to: '', vi: 'bỏ "18+"', en: 'dropped "18+"' },
];

/** What the Google copy changed, said in one line each. */
export interface Softened { vi: string; en: string }

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
export function gbpSummary(message: string): { text: string; removed: Removed[]; softened: Softened[] } {
  const removed = new Set<Removed>();
  const softened: Softened[] = [];
  let t = String(message ?? '');
  t = t.replace(URL_RE, () => { removed.add('link'); return ''; });
  t = t.replace(EMAIL_RE, () => { removed.add('email'); return ''; });
  t = t.replace(PHONE_RE, (m) => { if (!looksLikePhone(m)) return m; removed.add('phone'); return ''; });
  t = t.replace(HANDLE_RE, () => { removed.add('handle'); return ''; });
  t = t.replace(HASHTAG_RE, () => { removed.add('hashtag'); return ''; });
  for (const s of SOFTEN) {
    if (!s.re.test(t)) continue;
    s.re.lastIndex = 0;
    t = t.replace(s.re, s.to);
    softened.push({ vi: s.vi, en: s.en });
  }
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
  return { text: kept.join('\n').trim(), removed: Array.from(removed), softened };
}

// ---- words ---------------------------------------------------------------------

/** A whole word, in any script — \b does not know Vietnamese letters. */
const word = (alts: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, 'iu');

/** A price, a discount, a deal — the thing that turns a mention into a promotion. */
const PROMO = word('giảm giá|giảm \\d+%|khuyến mãi|khuyến mại|ưu đãi|miễn phí|free|sale|deal|combo|mua \\d+ tặng \\d+|buy \\d+ get|happy hour|\\d+k|\\d+ ?(?:đ|vnd|usd)|\\$ ?\\d+|\\d+%|tặng kèm|giá (?:chỉ|sốc|rẻ)|only \\$?\\d+|special|coupon|voucher');

interface Rule {
  code: string;
  re: RegExp;
  /**
   * 'hard'  — a blocker, always.
   * 'risky' — a risk the team may accept.
   * 'promo' — a risk only when a price or a deal sits on the same line
   *           (Google's own line between mentioning and promoting);
   *           a warning otherwise.
   * 'warn'  — advice.
   */
  kind: 'hard' | 'risky' | 'promo' | 'warn';
  vi: string;
  en: string;
}

const RULES: Rule[] = [
  // ---- absolute: Google forbids, a profile can be suspended -------------------
  {
    code: 'adult', kind: 'hard',
    re: word('porn|khiêu dâm|escort|erotic|xxx|happy ending|onlyfans|strip(?:per|tease)|khỏa thân|khoả thân|sexual|dâm ô|mại dâm'),
    vi: 'Nội dung người lớn bị cấm tuyệt đối trên Google Business Profile — hồ sơ có thể bị khoá.',
    en: 'Adult content is absolutely forbidden on a Google Business Profile — the profile can be suspended.',
  },
  {
    code: 'hate', kind: 'hard',
    re: word('kỳ thị|racist|con đĩ|đĩ|whore|slut|nigg\\w*|faggot|retard(?:ed)?|kill (?:them|him|her|you)|giết (?:người|hại|chết)|đe doạ giết'),
    vi: 'Lời lẽ xúc phạm, thù ghét hoặc đe doạ bị cấm tuyệt đối.',
    en: 'Abusive, hateful or threatening language is strictly forbidden.',
  },
  {
    code: 'weapons', kind: 'hard',
    re: word('súng|guns?|firearms?|ammo|ammunition|rifle|pistol|vũ khí|taser'),
    vi: 'Vũ khí là hàng cấm trên Google Business Profile.',
    en: 'Weapons are forbidden goods on a Google Business Profile.',
  },
  {
    code: 'drugs', kind: 'hard',
    re: word('cần sa|cannabis|marijuana|weed|thc|cocaine|ma túy|heroin|meth|opioid'),
    vi: 'Chất cấm bị cấm tuyệt đối — hồ sơ có thể bị khoá.',
    en: 'Illegal drugs are absolutely forbidden — the profile can be suspended.',
  },
  {
    code: 'gambling', kind: 'hard',
    re: word('casino|sòng bài|cá cược|cá độ|betting|đánh bạc|lô đề|nhà cái'),
    vi: 'Cờ bạc ăn tiền bị cấm trên Google Business Profile.',
    en: 'Gambling for money is forbidden on a Google Business Profile.',
  },
  {
    code: 'cure-claim', kind: 'hard',
    re: word('chữa (?:khỏi|dứt điểm)|trị (?:dứt điểm|tận gốc)|cures? (?:cancer|diabetes|covid|acne forever)|anti-?cancer|chống ung thư|trị ung thư|trị tiểu đường|diệt (?:khuẩn|virus) 100%|kills? (?:99|100)%|thuốc chữa'),
    vi: 'Hứa chữa khỏi bệnh là "thông tin y tế sai lệch" — Google cấm tuyệt đối. Mô tả dịch vụ, đừng hứa kết quả y khoa.',
    en: 'Promising to cure a disease is deceptive health information — absolutely forbidden. Describe the service; do not promise a medical result.',
  },

  // ---- restricted: Google may reject; the team may accept the risk ------------
  {
    code: 'alcohol', kind: 'promo',
    re: word('bia|beer|rượu|wine|vang|cocktail|champagne|prosecco|vodka|whisky|whiskey|tequila|soju|sake|mimosa|nhậu|đồ uống có cồn|alcohol|liquor|brewery|nhà máy bia'),
    vi: 'Google không cho quảng cáo, ghi giá hay khuyến mãi đồ uống có cồn. Được nhắc tới, không được rao bán — bỏ giá/ưu đãi khỏi dòng đó.',
    en: 'Google does not allow deals, prices or promotions for alcohol. Mentioning it is fine; selling it is not — take the price/offer off that line.',
  },
  {
    code: 'tobacco', kind: 'promo',
    re: word('thuốc lá|thuốc lào|vape|vaping|e-?cig(?:arette)?s?|shisha|hookah|cigar|xì gà|nicotine|tobacco'),
    vi: 'Thuốc lá, vape, shisha là hàng hạn chế — Google không cho khuyến mãi hay ghi giá.',
    en: 'Tobacco, vape and shisha are restricted goods — Google allows no promotion or pricing.',
  },
  {
    code: 'medical', kind: 'risky',
    re: word('botox|filler|tiêm (?:filler|botox|meso|trắng|tan mỡ)|injections?|phẫu thuật|surgery|truyền (?:trắng|dịch)|iv drip|iv therapy|prescription drugs?|thuốc kê đơn|xanax|adderall|ozempic|semaglutide|steroids?'),
    vi: 'Dịch vụ/sản phẩm y khoa là mục Google HẠN CHẾ — bài có thể bị từ chối. Nếu tiệm có giấy phép và thật sự làm dịch vụ này thì bấm "Tôi hiểu, vẫn đăng"; nếu không, bỏ từ đó ra.',
    en: 'Medical services and products are RESTRICTED by Google — the post may be rejected. If the shop is licensed and really offers this, accept the risk; otherwise take the word out.',
  },
  {
    code: 'finance', kind: 'risky',
    re: word('vay (?:tiền|vốn|nhanh|nóng)|payday loans?|cho vay|crypto|bitcoin|forex|đầu tư sinh lời|guaranteed returns?|mortgage|lãi suất \\d+'),
    vi: 'Dịch vụ tài chính (cho vay, đầu tư, crypto) là mục Google hạn chế — bài có thể bị từ chối.',
    en: 'Financial services (loans, investments, crypto) are restricted by Google — the post may be rejected.',
  },
  {
    code: 'political', kind: 'risky',
    re: word('bầu cử|election day|tranh cử|chiến dịch tranh cử|đảng cộng sản|communist party|political party|biểu tình|protest march|trump|biden|harris'),
    vi: 'Nội dung chính trị bị Google coi là "lạc đề" với hồ sơ doanh nghiệp và thường bị từ chối. Bài Business Profile nên chỉ nói về tiệm.',
    en: 'Political content is "off-topic" for a business profile and is usually rejected. A Business Profile post should be about the shop only.',
  },
  {
    code: 'body-claim', kind: 'risky',
    re: word('giảm \\d+ ?(?:kg|cân|lbs?|pounds?)|lose \\d+ ?(?:lbs?|kg|pounds)|giảm cân cấp tốc|thải độc (?:cơ thể|gan|máu)|xoá (?:hoàn toàn|vĩnh viễn)|permanent(?:ly)? removes?'),
    vi: 'Con số cam kết về cơ thể ("giảm 5kg", "xoá vĩnh viễn") dễ bị Google xếp vào quảng cáo y tế gây hiểu lầm. Nói "hỗ trợ", "thường thấy", đừng cam kết con số.',
    en: 'A promised body result ("lose 5kg", "removes permanently") reads as a misleading health claim. Say "helps" or "typically", not a guaranteed number.',
  },
  {
    code: 'weapon-minor', kind: 'risky',
    re: word('pepper spray|dao găm|knife sale|bình xịt hơi cay'),
    vi: 'Món này nằm trong nhóm hàng hạn chế của Google — cân nhắc bỏ khỏi bài.',
    en: 'This sits in Google’s restricted-goods group — consider taking it out of the post.',
  },
  {
    code: 'cbd', kind: 'risky',
    re: word('cbd|hemp oil|dầu gai dầu'),
    vi: 'CBD/hemp là hàng hạn chế trên Google kể cả khi hợp pháp ở bang của tiệm — bài có thể bị từ chối.',
    en: 'CBD/hemp is restricted on Google even where it is legal in the shop’s state — the post may be rejected.',
  },

  // ---- advice ----------------------------------------------------------------
  {
    code: 'lottery', kind: 'warn',
    re: word('lottery|xổ số|poker|slot machine|jackpot'),
    vi: 'Từ liên quan cờ bạc dễ bị bộ lọc của Google để ý dù tiệm chỉ nói vui. Cân nhắc đổi từ.',
    en: 'Gambling words draw Google’s filter even when used playfully. Consider another word.',
  },
  {
    code: 'sweepstake', kind: 'warn',
    re: word('raffle|quay số|bốc thăm|giveaway|sweepstakes?|trúng thưởng|rút thăm'),
    vi: 'Quay số/bốc thăm dễ bị Google coi là cờ bạc nếu phải mua hàng để tham gia. Ghi rõ "không cần mua" và điều kiện.',
    en: 'A raffle or giveaway reads as gambling to Google when a purchase is required. State "no purchase necessary" and the terms.',
  },
  {
    code: 'financing', kind: 'warn',
    re: word('trả góp|installments?|financing|0% apr|pay later|klarna|affirm|afterpay'),
    vi: 'Trả góp là ưu đãi tài chính — Google có thể coi là quảng cáo dịch vụ tài chính. Nói ngắn ("có trả góp"), không ghi lãi suất/điều khoản.',
    en: 'Financing is a financial offer — Google may read it as promoting financial services. Keep it to "financing available"; no rates or terms.',
  },
  {
    code: 'detox', kind: 'warn',
    re: word('detox|thải độc|giải độc'),
    vi: 'Từ "detox/thải độc" là tên dịch vụ bình thường ở spa, nhưng nếu đi kèm lời hứa chữa bệnh thì Google mới chặn. Giữ nguyên nếu đó là tên dịch vụ.',
    en: '"Detox" is an ordinary spa service name; Google only objects when it comes with a promise to cure. Keep it if that is the service name.',
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
 * stripped rather than reported, "sexy" has already become "gorgeous", and
 * there is no point warning about a hashtag that is already gone.
 */
export function gbpTextIssues(text: string): GbpTextCheck {
  const blockers: Issue[] = [];
  const risks: Issue[] = [];
  const warnings: Issue[] = [];
  const t = String(text ?? '');
  const lines = t.split(/\r?\n/);
  const seen = new Set<string>();
  const add = (list: Issue[], r: Rule, level: Level, match: string) => {
    if (seen.has(r.code)) return;
    seen.add(r.code);
    list.push({ code: r.code, level, vi: r.vi, en: r.en, match });
  };

  for (const r of RULES) {
    if (r.kind === 'promo') {
      for (const line of lines) {
        const m = r.re.exec(line);
        if (!m) continue;
        if (PROMO.test(line)) add(risks, r, 'risky', m[0]);
        else add(warnings, r, 'warn', m[0]);
        break;
      }
      continue;
    }
    const m = r.re.exec(t);
    if (!m) continue;
    if (r.kind === 'hard') add(blockers, r, 'hard', m[0]);
    else if (r.kind === 'risky') add(risks, r, 'risky', m[0]);
    else add(warnings, r, 'warn', m[0]);
  }

  // ---- how it is written: Google's spam filter, and plain good manners ----
  const letters = t.replace(/[^\p{L}]/gu, '');
  const upper = letters.replace(/[^\p{Lu}]/gu, '');
  if (letters.length >= 20 && upper.length / letters.length > 0.7) {
    warnings.push({ code: 'caps', level: 'warn', vi: 'Viết HOA toàn bộ bị bộ lọc spam của Google để ý. Viết thường, in hoa vài từ nhấn là đủ.', en: 'ALL CAPS trips Google’s spam filter. Write normally; capitalise a word or two for emphasis.' });
  }
  if (/[!?]{3,}|\.{5,}/.test(t)) {
    warnings.push({ code: 'punctuation', level: 'warn', vi: 'Dấu "!!!" / "???" liên tiếp là dấu hiệu spam với Google. Một dấu là đủ.', en: '"!!!" / "???" reads as spam to Google. One is enough.' });
  }
  const emojis = (t.match(EMOJI_RE) ?? []).length;
  if (emojis > 8) {
    warnings.push({ code: 'emoji', level: 'warn', vi: `Bài có ${emojis} emoji — trên Google Maps trông như spam và có bài bị từ chối vì thế. Giữ dưới 5.`, en: `${emojis} emoji — looks like spam on Maps and posts have been rejected for it. Keep it under 5.` });
  }
  return { blockers, risks, warnings };
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
 *
 * A format Google cannot read is a blocker and not a risk on purpose: this
 * is not a policy judgement, it is a file Google's fetcher will reject an
 * hour later with "media could not be processed". Accepting that risk buys
 * nothing but a failure nobody is watching.
 */
export function gbpImageIssues(media: MediaLike[]): GbpTextCheck {
  const blockers: Issue[] = [];
  const warnings: Issue[] = [];
  const photos = (media ?? []).filter((m) => m.kind === 'image');
  const bad = photos.find((m) => BAD_EXT_RE.test(m.url));
  if (bad) {
    blockers.push({ code: 'format', level: 'hard', vi: 'Google Business chỉ nhận ảnh JPG hoặc PNG. Ảnh này là định dạng khác — tải lại bằng nút "Tải ảnh lên" (hệ thống tự chuyển sang JPG).', en: 'Google Business takes JPG or PNG only. This one is another format — re-upload it with "Upload photos" (it is converted to JPG).', match: bad.url.split('/').pop() });
  }
  if (photos.length > 1) {
    warnings.push({ code: 'one-photo', level: 'warn', vi: `Google chỉ lấy ảnh đầu tiên (bài có ${photos.length} ảnh). Kéo ảnh đẹp nhất lên đầu.`, en: `Google takes the first photo only (this post has ${photos.length}). Drag the best one to the top.` });
  }
  return { blockers, risks: [], warnings };
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
  /** The text Google receives, after the contact block is stripped and words softened. */
  summary: string;
  removed: Removed[];
  /** Words changed for Google only, said in one line each. */
  softened: Softened[];
  blockers: Issue[];
  risks: Issue[];
  warnings: Issue[];
}

export function checkGbpPost(message: string, media: MediaLike[]): GbpCheck {
  const { text, removed, softened } = gbpSummary(message);
  const t = gbpTextIssues(text);
  const i = gbpImageIssues(media);
  const blockers = [...t.blockers, ...i.blockers];
  const risks = [...t.risks, ...i.risks];
  const warnings = [...t.warnings, ...i.warnings];
  if (!text && String(message ?? '').trim()) {
    blockers.unshift({ code: 'empty', level: 'hard', vi: 'Sau khi bỏ số điện thoại/link/hashtag theo policy Google, bài không còn chữ. Thêm vài dòng mô tả.', en: 'Once the phone number, links and hashtags are stripped per Google policy, nothing is left. Add a few lines of text.' });
  }
  return { summary: text, removed, softened, blockers, risks, warnings };
}

/**
 * Risks the team has read and accepted, by code. Stored on the post (see
 * gbp-cta), so a med-spa that accepted "medical" once does not answer it
 * again every time the caption is edited — and a NEW kind of risk still
 * stops the post, because the code is different.
 */
export function unacceptedRisks(risks: Issue[], ack: readonly string[] | null | undefined): Issue[] {
  const ok = new Set((ack ?? []).map((c) => String(c)));
  return risks.filter((r) => !ok.has(r.code));
}

/**
 * One line for the planner's refusal: the first blocker, or the first risk
 * nobody has accepted. Null when the post may go.
 */
export function gbpRefusal(message: string, media: MediaLike[], ack?: readonly string[] | null): string | null {
  const c = checkGbpPost(message, media);
  const first = c.blockers[0] ?? unacceptedRisks(c.risks, ack)[0];
  if (!first) return null;
  const where = first.match ? ` (từ "${first.match}")` : '';
  const how = first.level === 'risky' ? ' — team Lumio có thể bấm "Tôi hiểu, vẫn đăng" nếu tiệm thật sự làm dịch vụ này.' : '';
  return `Google Business: ${first.vi}${where}${how}`;
}
