/**
 * What this business actually does, in its own words.
 *
 * THE MISTAKE THIS FIXES
 *
 * Every recommendation in the content, ads and SEO engine was keyed off
 * `businessType` — a four-value enum set by an operator in Super Admin. That
 * enum can say SALON, RESTAURANT, REAL_ESTATE or SERVICE, and a great many real
 * businesses are none of those. A marketing agency serving Vietnamese families
 * in Texas is nominally "SERVICE", which is true and useless: it produces
 * advice about before-and-after photos of a job well done, aimed at homeowners,
 * in a radius around a shopfront. Every word of it plausible, all of it wrong.
 *
 * Meanwhile the business had already described itself — properly, in sentences,
 * in its own settings and in the intro learned from its website and fanpage —
 * and none of that reached this engine. The richest description of the customer
 * was sitting one table away from the code guessing about them.
 *
 * So the order of authority is inverted here:
 *
 *   1. what the business DECLARED about itself (settings, website, fanpage)
 *   2. what its own data shows (services it sells, where it is)
 *   3. the industry enum — LAST, and only as a coarse bucket for picking a
 *      starter format library when nothing better exists
 *
 * When a declaration exists, the enum stops being an input to the advice and
 * becomes a footnote. When it does not, this says so plainly instead of letting
 * a four-value guess pose as understanding.
 *
 * WHAT IT REFUSES TO DO
 *
 * It does not infer who a business serves from its name, its neighbourhood's
 * demographics, or the language of its bot. Serving Vietnamese customers is a
 * fact about a business that the business knows and this code does not; the
 * only honest way to have it is to be told. There is a field for that, and when
 * it is empty the engine says "chưa khai báo" rather than filling it in.
 */

import { bi, type Txt } from './i18n';

export interface DeclaredProfile {
  /** What the business does, in its own words. The most important field here. */
  whatWeDo: string;
  /** Who it serves — the answer this code must never invent. */
  whoWeServe: string;
  /** Languages the business actually operates in, e.g. "Tiếng Việt, English". */
  languages: string;
  /** Where it serves: a neighbourhood, a metro, a state, or "toàn quốc / online". */
  serviceArea: string;
  /** What makes customers choose it over the one down the road. */
  edge: string;
  /** Assumptions to never make about this business. */
  avoid: string;
}

export const EMPTY_PROFILE: DeclaredProfile = {
  whatWeDo: '', whoWeServe: '', languages: '', serviceArea: '', edge: '', avoid: '',
};

export interface ProfileSources {
  /** The salon-declared profile from settings. Highest authority. */
  declared?: Partial<DeclaredProfile> | null;
  /** One-line intro learned from the website / fanpage during setup. */
  bizIntro?: string | null;
  /** The owner's extra guidance written for the bot. */
  aiInstruction?: string | null;
  website?: string | null;
  tenantName?: string | null;
  serviceNames?: string[];
  city?: string | null;
  region?: string | null;
  /** The coarse enum. Deliberately last. */
  industry?: string | null;
}

export interface ResolvedIdentity {
  /** What to print on screen where the trade label used to go. */
  label: Txt;
  /** True when the business itself has said what it does. */
  declared: boolean;
  /** How much of the profile is filled in, 0-6. */
  filled: number;
  profile: DeclaredProfile;
  /** Where each fact came from, so nobody has to guess at the provenance. */
  provenance: Txt[];
  /** What is still missing and what it costs to leave it missing. */
  gaps: { field: keyof DeclaredProfile; label: Txt; cost: Txt }[];
}

const clean = (s?: string | null, max = 600) => String(s ?? '').trim().slice(0, max);

const FIELD_LABEL: Record<keyof DeclaredProfile, Txt> = {
  whatWeDo: bi('Doanh nghiệp làm gì', 'What the business does'),
  whoWeServe: bi('Phục vụ ai', 'Who it serves'),
  languages: bi('Ngôn ngữ', 'Languages'),
  serviceArea: bi('Khu vực phục vụ', 'Service area'),
  edge: bi('Điểm khác biệt', 'What sets it apart'),
  avoid: bi('Điều KHÔNG được giả định', 'What must NOT be assumed'),
};

/** Why each empty field matters, in terms of what goes wrong without it. */
const FIELD_COST: Record<keyof DeclaredProfile, Txt> = {
  whatWeDo: bi(
    'Thiếu ô này thì hệ thống chỉ còn mã ngành bốn giá trị để đoán — và mọi gợi ý sẽ nghe hợp lý nhưng sai nghề.',
    'Without this, the system has only a four-value industry code to guess from — and every suggestion comes out plausible but about the wrong trade.'),
  whoWeServe: bi(
    'Không ai suy ra được tệp khách từ tên tiệm hay dân cư quanh đó. Bỏ trống thì gợi ý nhắm vào "người ở gần", tức là không nhắm vào ai cả.',
    'Nobody can infer your customers from your name or the neighbourhood. Left blank, the advice targets "people nearby", which is to say nobody in particular.'),
  languages: bi(
    'Quyết định caption viết tiếng gì và quảng cáo nhắm nhóm ngôn ngữ nào. Đoán sai là chạy quảng cáo tiếng Anh cho tệp đọc tiếng Việt.',
    'Decides which language captions are written in and which language group the ads target. Guess wrong and you run English ads at a Vietnamese-reading audience.'),
  serviceArea: bi(
    'Doanh nghiệp phục vụ toàn quốc mà bị nhắm bán kính 5 dặm là vứt đi phần lớn ngân sách.',
    'A nationwide business targeted at a 5-mile radius throws away most of its budget.'),
  edge: bi(
    'Không có nó thì nội dung chỉ mô tả dịch vụ, không nói được vì sao chọn mình thay vì chỗ khác.',
    'Without it the content only describes the service, and never says why to choose you over the place down the road.'),
  avoid: bi(
    'Chỗ để chặn những giả định đã từng sai. Bỏ trống thì hệ thống lặp lại chúng.',
    'This is where you block the assumptions that have already been wrong. Left blank, the system repeats them.'),
};

export function resolveIdentity(src: ProfileSources): ResolvedIdentity {
  const d = src.declared ?? {};
  const provenance: Txt[] = [];

  const profile: DeclaredProfile = {
    whatWeDo: clean(d.whatWeDo),
    whoWeServe: clean(d.whoWeServe),
    languages: clean(d.languages, 120),
    serviceArea: clean(d.serviceArea, 200),
    edge: clean(d.edge),
    avoid: clean(d.avoid),
  };
  if (profile.whatWeDo) provenance.push(bi('Mô tả do tiệm tự khai', 'Description written by the business'));

  // The website/fanpage intro fills whatWeDo only when the salon has not written
  // its own. It is a decent description of the business but it was written to
  // greet a customer, not to brief a strategist, so a real declaration wins.
  if (!profile.whatWeDo && clean(src.bizIntro)) {
    profile.whatWeDo = clean(src.bizIntro);
    provenance.push(bi('Giới thiệu học từ website/fanpage', 'Intro learned from the website / Facebook page'));
  }
  if (clean(src.aiInstruction) && !profile.edge) {
    profile.edge = clean(src.aiInstruction);
    provenance.push(bi('Ghi chú chủ tiệm viết cho bot', 'Owner notes written for the bot'));
  }
  if (!profile.serviceArea && src.city && src.region) {
    profile.serviceArea = `${src.city}, ${src.region}`;
    provenance.push(bi('Địa chỉ trong cài đặt', 'Address in salon settings'));
  }
  if (clean(src.website)) provenance.push(`Website: ${clean(src.website, 120)}`);
  if (src.serviceNames?.length) {
    provenance.push(bi(
      `${src.serviceNames.length} dịch vụ đã khai trong hệ thống`,
      `${src.serviceNames.length} services listed in the system`,
    ));
  }

  const filled = (Object.keys(profile) as (keyof DeclaredProfile)[]).filter((k) => profile[k]).length;
  const declared = Boolean(profile.whatWeDo);

  const gaps = (Object.keys(FIELD_LABEL) as (keyof DeclaredProfile)[])
    .filter((k) => !profile[k])
    .map((k) => ({ field: k, label: FIELD_LABEL[k], cost: FIELD_COST[k] }));

  // The label is the business's own first sentence, never the enum. An enum
  // shown as a heading is what let "ngành nail" sit on top of a marketing
  // agency's screen for a week without anyone being able to see the cause.
  // The declared label is the business's OWN sentence, so it is not translated:
  // translating what a business calls itself is how a name stops being a name.
  // Only the "we have not been told" placeholder has two languages.
  const label: Txt = declared
    ? firstSentence(profile.whatWeDo)
    : src.tenantName
      ? bi(`${src.tenantName} — chưa khai báo ngành nghề`, `${src.tenantName} — business not described yet`)
      : bi('Chưa khai báo ngành nghề', 'Business not described yet');

  return { label, declared, filled, profile, provenance, gaps };
}

function firstSentence(s: string): string {
  const cut = s.split(/[.;\n]/)[0].trim();
  return cut.length > 4 ? cut.slice(0, 140) : s.slice(0, 140);
}

/**
 * The identity block for the prompt.
 *
 * Placed first and phrased as an override, because the model receives an
 * industry code further down and will otherwise reason from it: a bucket is a
 * much easier thing to pattern-match against than a sentence, and the whole
 * failure this file exists to fix was the bucket winning.
 */
export function identityToPrompt(id: ResolvedIdentity, industry?: string | null): string {
  if (!id.declared) {
    return [
      'DOANH NGHIỆP NÀY CHƯA TỰ KHAI BÁO NGÀNH NGHỀ.',
      `Chỉ có mã ngành thô: ${industry || 'không rõ'}. Mã này là bốn giá trị dùng chung cho cả nền tảng,`,
      'KHÔNG mô tả được doanh nghiệp cụ thể nào.',
      'Vì vậy: chỉ đưa gợi ý chung, KHÔNG mô tả khách hàng của họ, KHÔNG giả định họ bán gì,',
      'và nói thẳng trong phần lý do rằng đây là gợi ý nền vì chưa có mô tả doanh nghiệp.',
    ].join('\n');
  }
  const L = ['DOANH NGHIỆP NÀY TỰ MÔ TẢ NHƯ SAU — ĐÂY LÀ NGUỒN ĐÚNG NHẤT, ƯU TIÊN TRÊN MỌI THỨ KHÁC:'];
  L.push(`- Làm gì: ${id.profile.whatWeDo}`);
  if (id.profile.whoWeServe) L.push(`- Phục vụ ai: ${id.profile.whoWeServe}`);
  if (id.profile.languages) L.push(`- Ngôn ngữ: ${id.profile.languages}`);
  if (id.profile.serviceArea) L.push(`- Khu vực: ${id.profile.serviceArea}`);
  if (id.profile.edge) L.push(`- Khác biệt: ${id.profile.edge}`);
  if (id.profile.avoid) L.push(`- TUYỆT ĐỐI KHÔNG giả định: ${id.profile.avoid}`);
  if (!id.profile.whoWeServe) {
    L.push('- Chưa khai tệp khách. KHÔNG được tự suy ra tệp khách từ tên, từ khu vực hay từ ngành.');
  }
  L.push(
    `LƯU Ý: hệ thống có gắn mã ngành "${industry || 'không rõ'}" cho doanh nghiệp này, nhưng đó chỉ là`,
    'một ô phân loại thô để chọn thư viện định dạng. Nếu mô tả ở trên mâu thuẫn với mã ngành,',
    'LUÔN theo mô tả ở trên. Không được đưa ra gợi ý của một ngành mà mô tả trên không nói tới.',
  );
  return L.join('\n');
}
