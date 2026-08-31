/**
 * One proposed campaign, spelled out far enough that somebody can build it.
 *
 * WHAT THE ADS TAB STOPPED SHORT OF
 *
 * `platformPlans()` decides WHERE to spend, HOW MUCH, and WHEN TO STOP. All of
 * that is judgement, and all of it was right. What it never produced was the
 * thing a person sits down and types into Ads Manager at nine on a Monday: what
 * to call the campaign, which objective to pick, who goes in the ad set, what
 * the ad actually says, and what to tick before turning it on. The plan ended
 * at "run Search + Maps"; the work starts there.
 *
 * So this file is deliberately not more strategy. It is the form, filled in.
 *
 * WHERE THE WORDS COME FROM, AND WHERE THEY DO NOT
 *
 * Every line of ad copy here is built from something the salon itself declared
 * or the book itself recorded: the business name, the city, the service it sells
 * most, the offer the discount engine already justified, the review count that
 * really exists. Nothing is invented to sound better.
 *
 * That rules out the entire vocabulary of stock ad copy — "best", "top-rated",
 * "award-winning", "#1 in town", a five-star claim, a price nobody set, a
 * discount nobody approved. Not because it reads badly, but because a claim we
 * made up becomes a claim the salon is making. Google and Meta both reject
 * unsubstantiated superlatives, US states police them as advertising claims,
 * and the salon is the one who answers for it. A blank we admit to is a blank
 * somebody fills in; a fabricated line is one nobody knows to check.
 *
 * THE CHARACTER LIMITS ARE ENFORCED, NOT SUGGESTED
 *
 * Google's responsive search ads cut headlines at 30 characters and descriptions
 * at 90. Copy written past the limit is not "slightly long" — it is rejected, or
 * silently truncated mid-word in the auction. So every generated string is cut
 * to fit on a word boundary here, and anything that had to be cut is reported,
 * because a headline that lost its second half should be rewritten by a person
 * rather than shipped short.
 */

import type { AdPlatform } from '../common/booking-channel';

/** Google responsive search ad limits. These are platform facts, not choices. */
export const GOOGLE_HEADLINE_MAX = 30;
export const GOOGLE_DESC_MAX = 90;

export interface CampaignSpecInput {
  platform: AdPlatform;
  /** The salon's own name, as it should appear to a stranger. */
  businessName: string | null;
  city: string | null;
  region: string | null;
  /** The service the book says it sells most. */
  topServiceName: string | null;
  /** The offer the discount engine already justified, if any. Never invented. */
  offerHeadline: string | null;
  /** Real reviews on file. Used only when there are enough to be worth saying. */
  reviewCount: number | null;
  /** Where the ad sends people. Empty when the salon has no booking page yet. */
  bookingUrl: string | null;
  /** Customers overdue a visit — the cheapest audience that exists. */
  lapsedCount: number;
  /** Days the plan says to run, and the quiet block being filled. */
  runDayLabels: string[];
  quietLabel: string | null;
  dailyCents: number | null;
  days: number;
  ceilingCents: number | null;
  targetBookings: number | null;
  weekKey: string;
  money: (cents: number) => string;
}

export interface AdSetSpec {
  name: string;
  who: string;
  where: string;
  when: string;
  exclude: string | null;
}

export interface CreativeSpec {
  /** Google: up to 30 chars each. Meta: the short line above the image. */
  headlines: string[];
  /** Google: up to 90 chars each. Meta: the body text. */
  descriptions: string[];
  cta: string;
  landing: string;
  /** What picture or clip to use — never a stock-photo instruction. */
  visual: string;
}

export interface CampaignSpec {
  platform: AdPlatform;
  /** What to type in the "Campaign name" box. */
  name: string;
  objective: string;
  adSets: AdSetSpec[];
  creative: CreativeSpec;
  budgetLine: string;
  /** Ticked before the campaign is turned on, not after. */
  before: string[];
  /** Exact numbers, on exact days. */
  measure: string[];
  /** Copy that had to be cut to fit, and should be rewritten by a person. */
  warnings: string[];
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Cut on a word boundary, never mid-word, and report when anything was lost. */
function fit(text: string, max: number, warnings: string[], what: string): string {
  const t = clean(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  const out = (at > max * 0.5 ? cut.slice(0, at) : cut).trim();
  warnings.push(`"${t}" dài ${t.length} ký tự, quá giới hạn ${max} của ${what} — đã cắt còn "${out}". Nên viết lại cho gọn thay vì để máy cắt.`);
  return out;
}

const slug = (s: string | null) =>
  (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/Đ/g, 'D').replace(/đ/g, 'd').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || null;

export function buildCampaignSpec(i: CampaignSpecInput): CampaignSpec {
  const warnings: string[] = [];
  const where = i.city && i.region ? `${i.city}, ${i.region}` : i.city || i.region || null;
  const svc = i.topServiceName;
  const name = i.businessName;

  // The campaign name carries what it is, where, and which week — so that in
  // three months' reporting nobody is guessing what "Campaign 2 (copy)" was.
  const parts = [
    i.platform === 'google' ? 'Search' : i.platform === 'meta' ? 'Messages' : 'OA',
    slug(svc) ?? 'Dich-vu',
    slug(i.city) ?? 'Local',
    i.weekKey,
  ];
  const campaignName = parts.join('_');

  const runDays = i.runDayLabels.length ? i.runDayLabels.join(', ') : 'cả tuần';
  const radius = where ? `Bán kính 3-5 dặm quanh ${where}` : 'Bán kính 3-5 dặm quanh tiệm';
  const excludeLine = 'Loại trừ danh sách khách quen đã tải lên (Customer list → Exclude)';

  const adSets: AdSetSpec[] = [];
  const before: string[] = [];
  let creative: CreativeSpec;
  let objective: string;

  if (i.platform === 'google') {
    objective = 'Search + Maps. Không bật Display, không bật Performance Max ở chiến dịch đầu — cả hai tiêu tiền ở chỗ không tách ra đọc được.';
    adSets.push({
      name: `${slug(svc) ?? 'Dich-vu'}_${slug(i.city) ?? 'Local'}_Exact`,
      who: svc
        ? `Người đang tìm đúng "${svc}" và các cách viết gần giống. Để ở Phrase match, chưa dùng Broad.`
        : 'Người tìm tên dịch vụ của tiệm. Để ở Phrase match, chưa dùng Broad.',
      where: `${radius}, đặt "Presence: people in this location" — KHÔNG phải "people interested in".`,
      when: `Bật ${runDays}.${i.quietLabel ? ` Tăng giá thầu vào khung ${i.quietLabel} vì đó là chỗ đang trống.` : ''}`,
      exclude: excludeLine,
    });
    const h: string[] = [];
    if (svc && i.city) h.push(fit(`${svc} ở ${i.city}`, GOOGLE_HEADLINE_MAX, warnings, 'tiêu đề Google'));
    else if (svc) h.push(fit(svc, GOOGLE_HEADLINE_MAX, warnings, 'tiêu đề Google'));
    if (name) h.push(fit(name, GOOGLE_HEADLINE_MAX, warnings, 'tiêu đề Google'));
    h.push('Đặt lịch online');
    if (i.offerHeadline) h.push(fit(i.offerHeadline, GOOGLE_HEADLINE_MAX, warnings, 'tiêu đề Google'));
    // A review count is only worth saying when there is enough of it to mean
    // something. "3 đánh giá" advertises that the salon is new.
    if (i.reviewCount && i.reviewCount >= 20) h.push(fit(`${i.reviewCount} đánh giá Google`, GOOGLE_HEADLINE_MAX, warnings, 'tiêu đề Google'));

    const d: string[] = [];
    d.push(fit(
      where ? `Đặt lịch trực tuyến, xem giờ trống ngay. ${where}.` : 'Đặt lịch trực tuyến, xem giờ trống ngay.',
      GOOGLE_DESC_MAX, warnings, 'mô tả Google',
    ));
    if (svc) d.push(fit(`Chuyên ${svc}. Chọn giờ, xác nhận qua tin nhắn.`, GOOGLE_DESC_MAX, warnings, 'mô tả Google'));

    creative = {
      headlines: h, descriptions: d,
      cta: 'Đặt lịch (Book now)',
      landing: i.bookingUrl ?? 'CHƯA CÓ — phải có trang đặt lịch trước khi bật quảng cáo. Trả tiền để đưa người tới một trang không đặt được lịch là trả tiền để họ bỏ đi.',
      visual: 'Google Search không có ảnh. Ảnh nằm ở hồ sơ Google Business — đó mới là thứ người ta nhìn sau khi bấm.',
    };
    before.push(
      i.reviewCount !== null && i.reviewCount < 20
        ? `Hồ sơ Google Business mới có ${i.reviewCount} đánh giá. Quảng cáo đưa người tới xem hồ sơ đó — xin thêm cho đủ 20 trước khi trả tiền.`
        : 'Hồ sơ Google Business: đủ ảnh, giờ mở cửa, bảng giá, đã trả lời đánh giá gần nhất.',
      'Gắn UTM vào link đặt lịch (utm_source=google, utm_medium=cpc) — không có nó thì tuần sau không biết booking từ đâu ra.',
      'Bật theo dõi chuyển đổi ở bước "đặt lịch xong", không phải ở lượt bấm vào trang.',
    );
  } else if (i.platform === 'meta') {
    objective = 'Mục tiêu Messages hoặc Leads. KHÔNG chọn Engagement hay Video views — lượt thích không đặt lịch.';
    if (i.lapsedCount >= 20) {
      adSets.push({
        name: `Khach-cu-${i.lapsedCount}`,
        who: `${i.lapsedCount} khách cũ lâu chưa quay lại, tải lên làm Custom Audience. Họ biết tiệm, biết đường, đã từng trả tiền — đây là tệp rẻ nhất tồn tại.`,
        where: 'Không cần giới hạn địa lý: danh sách đã là người từng tới.',
        when: `Bật ${runDays}.`,
        exclude: 'Loại người đã đặt lịch trong 30 ngày qua.',
      });
    }
    adSets.push({
      name: `Retarget-30d_${slug(i.city) ?? 'Local'}`,
      who: 'Người đã nhắn tin, xem trang hoặc xem video 30 ngày qua mà chưa đặt lịch. Rẻ hơn nhiều so với người lạ.',
      where: radius,
      when: `Bật ${runDays}.`,
      exclude: excludeLine,
    });
    adSets.push({
      name: `Nguoi-la_${slug(i.city) ?? 'Local'}`,
      who: 'Người lạ trong bán kính, không đặt sở thích gì thêm — để máy tự tìm. Tệp sở thích hẹp ở ngân sách nhỏ chỉ làm giá mỗi kết quả đắt lên.',
      where: radius,
      when: `Bật ${runDays}.`,
      exclude: excludeLine,
    });
    creative = {
      headlines: [
        svc && i.city ? `${svc} ở ${i.city}` : svc ?? name ?? 'Đặt lịch',
        'Nhắn tin đặt giờ',
      ].filter(Boolean),
      descriptions: [
        clean(`${svc ? `Còn giờ trống cho ${svc}` : 'Còn giờ trống'}${i.quietLabel ? ` khung ${i.quietLabel}` : ''}${where ? ` tại ${where}` : ''}. Nhắn tin để chọn giờ, tiệm xác nhận ngay.`),
        i.offerHeadline ? clean(i.offerHeadline) : '',
      ].filter(Boolean),
      cta: 'Gửi tin nhắn (Send message)',
      landing: i.bookingUrl ?? 'Hộp thư trang — trả lời trong giờ mở cửa, và có sẵn câu trả lời cho "bao nhiêu tiền" và "mấy giờ còn trống".',
      visual: 'Dùng chính clip hoặc ảnh đang có lượt xem cao nhất trên trang. Thứ người thật đã xem hết là thứ đã qua kiểm chứng — đừng dựng cái mới cho quảng cáo đầu tiên.',
    };
    before.push(
      'Tải danh sách khách quen lên và đặt ở Exclude cho mọi ad set. Bỏ bước này thì tiền chảy vào người tuần sau vẫn tới.',
      'Kiểm tra hộp thư trang: ai trả lời, trong bao lâu. Quảng cáo Messages mà không ai trả lời trong 1 giờ là tiền đổ đi.',
      'Gắn UTM (utm_source=facebook, utm_medium=paid) vào mọi link đặt lịch trong bài.',
    );
  } else {
    objective = 'Zalo OA: đẩy tới người theo dõi trước, mua quảng cáo sau.';
    adSets.push({
      name: `OA-follower_${slug(i.city) ?? 'Local'}`,
      who: 'Người đã theo dõi OA. Tệp có sẵn luôn rẻ hơn tệp phải mua.',
      where: radius, when: `Bật ${runDays}.`, exclude: excludeLine,
    });
    creative = {
      headlines: [svc ?? name ?? 'Đặt lịch'],
      descriptions: [clean(`${svc ? `Còn giờ trống cho ${svc}` : 'Còn giờ trống'}${where ? ` tại ${where}` : ''}.`)],
      cta: 'Nhắn tin',
      landing: i.bookingUrl ?? 'Trang đặt lịch của tiệm.',
      visual: 'Ảnh thật chụp tại tiệm.',
    };
    before.push('Đăng lên OA cho người theo dõi trước, xem có ai nhắn không, rồi mới trả tiền.');
  }

  const budgetLine = i.dailyCents && i.ceilingCents
    ? `${i.money(i.dailyCents)}/ngày × ${i.days} ngày = ${i.money(i.dailyCents * i.days)}. Đặt ngân sách ở cấp chiến dịch (CBO), không đặt riêng từng ad set — ngân sách nhỏ chia nhỏ nữa thì không ad set nào đủ dữ liệu để máy học.`
    : 'Chưa tính được ngân sách — xem phần ngưỡng chi phía trên.';

  const measure: string[] = [];
  if (i.ceilingCents) {
    measure.push(`Ngày 3: tiền đã chi ÷ số booking quảng cáo mang về. Trên ${i.money(i.ceilingCents)}/booking là đang lỗ.`);
    measure.push(`Ngày 7: nếu vẫn trên ${i.money(i.ceilingCents)} — tắt. Đừng chờ hết chiến dịch để "cho nó chạy đủ".`);
    measure.push(`Ngày ${i.days}: đếm có bao nhiêu người là khách LẦN ĐẦU. Đây mới là con số nói quảng cáo có mang khách mới về hay chỉ bán lại cho khách cũ.`);
  }
  if (i.targetBookings) {
    measure.push(`Đích của chiến dịch này: ${i.targetBookings} booking. Ít hơn thì con số "mỗi booking tốn bao nhiêu" chưa đọc được, không phải là chiến dịch thất bại.`);
  }
  measure.push('Ghi lại số ở cùng một chỗ mỗi tuần. Một chiến dịch không được ghi lại thì tháng sau không ai nhớ nó đã tốn bao nhiêu.');

  return { platform: i.platform, name: campaignName, objective, adSets, creative, budgetLine, before, measure, warnings };
}
