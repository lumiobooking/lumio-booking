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
import { bi, viOf, enOf, type Txt } from './i18n';

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
  /** Days the plan says to run, and the quiet block being filled. Bilingual,
   *  because they are printed on the screen inside these sentences — flattening
   *  them to Vietnamese at the call site is what put Vietnamese day names in the
   *  middle of an English ad set. */
  runDayLabels: Txt[];
  quietLabel: Txt | null;
  dailyCents: number | null;
  days: number;
  ceilingCents: number | null;
  targetBookings: number | null;
  weekKey: string;
  money: (cents: number) => string;
}

export interface AdSetSpec {
  /** What to type in the ad set's name box. The salon's own service and town
   *  read the same either way; only the words we supply differ. */
  name: Txt;
  who: Txt;
  where: Txt;
  when: Txt;
  exclude: Txt | null;
}

export interface CreativeSpec {
  /** Google: up to 30 chars each. Meta: the short line above the image.
   *  These stay single strings on purpose: they are the ad's OWN words, pasted
   *  into the platform as written, and the character limit below is counted on
   *  the one string that actually runs. A headline is not a phrase the product
   *  says to the owner, so it is not translated. */
  headlines: string[];
  /** Google: up to 90 chars each. Meta: the body text. See headlines. */
  descriptions: string[];
  /** Which button to pick — an instruction to the person building it. */
  cta: Txt;
  /** The URL when there is one (the salon's own, untranslated), otherwise the
   *  sentence saying what is missing. */
  landing: Txt;
  /** What picture or clip to use — never a stock-photo instruction. */
  visual: Txt;
}

export interface CampaignSpec {
  platform: AdPlatform;
  /** What to type in the "Campaign name" box. */
  name: Txt;
  objective: Txt;
  adSets: AdSetSpec[];
  creative: CreativeSpec;
  budgetLine: Txt;
  /** Ticked before the campaign is turned on, not after. */
  before: Txt[];
  /** Exact numbers, on exact days. */
  measure: Txt[];
  /** Copy that had to be cut to fit, and should be rewritten by a person. */
  warnings: Txt[];
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Cut on a word boundary, never mid-word, and report when anything was lost. */
function fit(text: string, max: number, warnings: Txt[], whatVi: string, whatEn: string): string {
  const t = clean(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  const out = (at > max * 0.5 ? cut.slice(0, at) : cut).trim();
  // Two numbers and a quoted phrase in one sentence, so each language is
  // written out whole rather than stitched from translated fragments.
  warnings.push(bi(
    `"${t}" dài ${t.length} ký tự, quá giới hạn ${max} của ${whatVi} — đã cắt còn "${out}". Nên viết lại cho gọn thay vì để máy cắt.`,
    `"${t}" runs ${t.length} characters, past the ${max}-character limit on a ${whatEn} — cut back to "${out}". Better to rewrite it short than to let the machine cut it.`));
  return out;
}

const slug = (s: string | null) =>
  (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/Đ/g, 'D').replace(/đ/g, 'd').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || null;

export function buildCampaignSpec(i: CampaignSpecInput): CampaignSpec {
  const warnings: Txt[] = [];
  const where = i.city && i.region ? `${i.city}, ${i.region}` : i.city || i.region || null;
  const svc = i.topServiceName;
  const name = i.businessName;

  // The campaign name carries what it is, where, and which week — so that in
  // three months' reporting nobody is guessing what "Campaign 2 (copy)" was.
  // The two names differ only in the words WE supply: the service slug and the
  // town come from the salon and read the same in either language, so an owner
  // reading English does not end up typing "Dich-vu" into Ads Manager.
  const kind = i.platform === 'google' ? 'Search' : i.platform === 'meta' ? 'Messages' : 'OA';
  const svcSlug = slug(svc);
  const citySlug = slug(i.city) ?? 'Local';
  const campaignName = bi(
    [kind, svcSlug ?? 'Dich-vu', citySlug, i.weekKey].join('_'),
    [kind, svcSlug ?? 'Service', citySlug, i.weekKey].join('_'),
  );

  const runDaysVi = i.runDayLabels.length ? i.runDayLabels.map(viOf).join(', ') : 'cả tuần';
  const runDaysEn = i.runDayLabels.length ? i.runDayLabels.map(enOf).join(', ') : 'all week';
  // The town is the salon's own data and is never translated; only the "we were
  // not told where" fallback has two languages.
  const radiusVi = where ? `Bán kính 3-5 dặm quanh ${where}` : 'Bán kính 3-5 dặm quanh tiệm';
  const radiusEn = where ? `A 3 to 5 mile radius around ${where}` : 'A 3 to 5 mile radius around the shop';
  const radius = bi(radiusVi, radiusEn);
  const excludeLine = bi(
    'Loại trừ danh sách khách quen đã tải lên (Customer list → Exclude)',
    'Exclude the regulars list you uploaded (Customer list → Exclude)');

  const adSets: AdSetSpec[] = [];
  const before: Txt[] = [];
  let creative: CreativeSpec;
  let objective: Txt;

  if (i.platform === 'google') {
    objective = bi(
      'Search + Maps. Không bật Display, không bật Performance Max ở chiến dịch đầu — cả hai tiêu tiền ở chỗ không tách ra đọc được.',
      'Search + Maps. Leave Display off, and leave Performance Max off on the first campaign — both spend the money in places you cannot pull apart and read.');
    adSets.push({
      name: bi(`${svcSlug ?? 'Dich-vu'}_${citySlug}_Exact`, `${svcSlug ?? 'Service'}_${citySlug}_Exact`),
      who: svc
        ? bi(
          `Người đang tìm đúng "${svc}" và các cách viết gần giống. Để ở Phrase match, chưa dùng Broad.`,
          `People searching for "${svc}" and the near spellings of it. Keep it on Phrase match, do not go Broad yet.`)
        : bi(
          'Người tìm tên dịch vụ của tiệm. Để ở Phrase match, chưa dùng Broad.',
          'People searching for what you do by name. Keep it on Phrase match, do not go Broad yet.'),
      where: bi(
        `${radiusVi}, đặt "Presence: people in this location" — KHÔNG phải "people interested in".`,
        `${radiusEn}, set to "Presence: people in this location" — NOT "people interested in".`),
      when: bi(
        `Bật ${runDaysVi}.${i.quietLabel ? ` Tăng giá thầu vào khung ${viOf(i.quietLabel)} vì đó là chỗ đang trống.` : ''}`,
        `Run it ${runDaysEn}.${i.quietLabel ? ` Bid higher on the ${enOf(i.quietLabel)} block, because that is the one sitting empty.` : ''}`),
      exclude: excludeLine,
    });
    const h: string[] = [];
    if (svc && i.city) h.push(fit(`${svc} ở ${i.city}`, GOOGLE_HEADLINE_MAX, warnings, 'tiêu đề Google', 'Google headline'));
    else if (svc) h.push(fit(svc, GOOGLE_HEADLINE_MAX, warnings, 'tiêu đề Google', 'Google headline'));
    if (name) h.push(fit(name, GOOGLE_HEADLINE_MAX, warnings, 'tiêu đề Google', 'Google headline'));
    h.push('Đặt lịch online');
    if (i.offerHeadline) h.push(fit(i.offerHeadline, GOOGLE_HEADLINE_MAX, warnings, 'tiêu đề Google', 'Google headline'));
    // A review count is only worth saying when there is enough of it to mean
    // something. "3 đánh giá" advertises that the salon is new.
    if (i.reviewCount && i.reviewCount >= 20) h.push(fit(`${i.reviewCount} đánh giá Google`, GOOGLE_HEADLINE_MAX, warnings, 'tiêu đề Google', 'Google headline'));

    const d: string[] = [];
    d.push(fit(
      where ? `Đặt lịch trực tuyến, xem giờ trống ngay. ${where}.` : 'Đặt lịch trực tuyến, xem giờ trống ngay.',
      GOOGLE_DESC_MAX, warnings, 'mô tả Google', 'Google description',
    ));
    if (svc) d.push(fit(`Chuyên ${svc}. Chọn giờ, xác nhận qua tin nhắn.`, GOOGLE_DESC_MAX, warnings, 'mô tả Google', 'Google description'));

    creative = {
      headlines: h, descriptions: d,
      cta: bi('Đặt lịch (Book now)', 'Book now'),
      landing: i.bookingUrl ?? bi(
        'CHƯA CÓ — phải có trang đặt lịch trước khi bật quảng cáo. Trả tiền để đưa người tới một trang không đặt được lịch là trả tiền để họ bỏ đi.',
        'MISSING — there has to be a booking page before the ads go on. Paying to send people to a page they cannot book on is paying for them to leave.'),
      visual: bi(
        'Google Search không có ảnh. Ảnh nằm ở hồ sơ Google Business — đó mới là thứ người ta nhìn sau khi bấm.',
        'Google Search carries no picture. The pictures sit on your Google Business profile — that is what people actually look at after they click.'),
    };
    before.push(
      i.reviewCount !== null && i.reviewCount < 20
        ? bi(
          `Hồ sơ Google Business mới có ${i.reviewCount} đánh giá. Quảng cáo đưa người tới xem hồ sơ đó — xin thêm cho đủ 20 trước khi trả tiền.`,
          `Your Google Business profile has only ${i.reviewCount} reviews. The ad sends people to look at that profile — get it up to 20 before you pay for clicks.`)
        : bi(
          'Hồ sơ Google Business: đủ ảnh, giờ mở cửa, bảng giá, đã trả lời đánh giá gần nhất.',
          'Google Business profile: photos, hours, prices, and the most recent reviews answered.'),
      bi(
        'Gắn UTM vào link đặt lịch (utm_source=google, utm_medium=cpc) — không có nó thì tuần sau không biết booking từ đâu ra.',
        'Put UTMs on the booking link (utm_source=google, utm_medium=cpc) — without them, next week you will not know where the bookings came from.'),
      bi(
        'Bật theo dõi chuyển đổi ở bước "đặt lịch xong", không phải ở lượt bấm vào trang.',
        'Turn conversion tracking on at the "booking finished" step, not on the click into the page.'),
    );
  } else if (i.platform === 'meta') {
    objective = bi(
      'Mục tiêu Messages hoặc Leads. KHÔNG chọn Engagement hay Video views — lượt thích không đặt lịch.',
      'Pick the Messages or Leads objective. Do NOT pick Engagement or Video views — likes do not book appointments.');
    if (i.lapsedCount >= 20) {
      adSets.push({
        name: bi(`Khach-cu-${i.lapsedCount}`, `Lapsed-${i.lapsedCount}`),
        who: bi(
          `${i.lapsedCount} khách cũ lâu chưa quay lại, tải lên làm Custom Audience. Họ biết tiệm, biết đường, đã từng trả tiền — đây là tệp rẻ nhất tồn tại.`,
          `${i.lapsedCount} past customers who have not been back in a while — upload them as a Custom Audience. They know the shop, they know the drive, they have paid you before; nothing else is this cheap.`),
        where: bi(
          'Không cần giới hạn địa lý: danh sách đã là người từng tới.',
          'No location limit needed: the list is already people who have been in.'),
        when: bi(`Bật ${runDaysVi}.`, `Run it ${runDaysEn}.`),
        exclude: bi(
          'Loại người đã đặt lịch trong 30 ngày qua.',
          'Exclude anyone who has booked in the last 30 days.'),
      });
    }
    adSets.push({
      // Nothing here but the town, so the name reads the same in both languages.
      name: `Retarget-30d_${citySlug}`,
      who: bi(
        'Người đã nhắn tin, xem trang hoặc xem video 30 ngày qua mà chưa đặt lịch. Rẻ hơn nhiều so với người lạ.',
        'People who messaged you, opened the page or watched a video in the last 30 days and still have not booked. Far cheaper than strangers.'),
      where: radius,
      when: bi(`Bật ${runDaysVi}.`, `Run it ${runDaysEn}.`),
      exclude: excludeLine,
    });
    adSets.push({
      name: bi(`Nguoi-la_${citySlug}`, `Cold_${citySlug}`),
      who: bi(
        'Người lạ trong bán kính, không đặt sở thích gì thêm — để máy tự tìm. Tệp sở thích hẹp ở ngân sách nhỏ chỉ làm giá mỗi kết quả đắt lên.',
        'Strangers inside the radius, with no interest targeting on top — let the machine find them. Narrowing by interests on a small budget only drives the cost per result up.'),
      where: radius,
      when: bi(`Bật ${runDaysVi}.`, `Run it ${runDaysEn}.`),
      exclude: excludeLine,
    });
    creative = {
      headlines: [
        svc && i.city ? `${svc} ở ${i.city}` : svc ?? name ?? 'Đặt lịch',
        'Nhắn tin đặt giờ',
      ].filter(Boolean),
      descriptions: [
        // Ad copy, so it is one string — and the quiet-slot label is unwrapped
        // with viOf() rather than dropped into the template as an object.
        clean(`${svc ? `Còn giờ trống cho ${svc}` : 'Còn giờ trống'}${i.quietLabel ? ` khung ${viOf(i.quietLabel)}` : ''}${where ? ` tại ${where}` : ''}. Nhắn tin để chọn giờ, tiệm xác nhận ngay.`),
        i.offerHeadline ? clean(i.offerHeadline) : '',
      ].filter(Boolean),
      cta: bi('Gửi tin nhắn (Send message)', 'Send message'),
      landing: i.bookingUrl ?? bi(
        'Hộp thư trang — trả lời trong giờ mở cửa, và có sẵn câu trả lời cho "bao nhiêu tiền" và "mấy giờ còn trống".',
        'Your page inbox — answer it during opening hours, with replies ready for "how much" and "what time is open".'),
      visual: bi(
        'Dùng chính clip hoặc ảnh đang có lượt xem cao nhất trên trang. Thứ người thật đã xem hết là thứ đã qua kiểm chứng — đừng dựng cái mới cho quảng cáo đầu tiên.',
        'Use whichever clip or photo already has the most views on your page. Something real people watched to the end is already proven — do not shoot something new for a first ad.'),
    };
    before.push(
      bi(
        'Tải danh sách khách quen lên và đặt ở Exclude cho mọi ad set. Bỏ bước này thì tiền chảy vào người tuần sau vẫn tới.',
        'Upload the regulars list and put it in the Exclude box on every ad set. Skip this and the money goes to people who are coming in next week anyway.'),
      bi(
        'Kiểm tra hộp thư trang: ai trả lời, trong bao lâu. Quảng cáo Messages mà không ai trả lời trong 1 giờ là tiền đổ đi.',
        'Check the page inbox: who answers, and how fast. A Messages ad nobody answers within an hour is money poured away.'),
      bi(
        'Gắn UTM (utm_source=facebook, utm_medium=paid) vào mọi link đặt lịch trong bài.',
        'Put UTMs (utm_source=facebook, utm_medium=paid) on every booking link in the post.'),
    );
  } else {
    objective = bi(
      'Zalo OA: đẩy tới người theo dõi trước, mua quảng cáo sau.',
      'Zalo OA: push it to your followers first, buy ads after.');
    adSets.push({
      name: `OA-follower_${citySlug}`,
      who: bi(
        'Người đã theo dõi OA. Tệp có sẵn luôn rẻ hơn tệp phải mua.',
        'People already following the OA. An audience you have always costs less than one you buy.'),
      where: radius,
      when: bi(`Bật ${runDaysVi}.`, `Run it ${runDaysEn}.`),
      exclude: excludeLine,
    });
    creative = {
      headlines: [svc ?? name ?? 'Đặt lịch'],
      descriptions: [clean(`${svc ? `Còn giờ trống cho ${svc}` : 'Còn giờ trống'}${where ? ` tại ${where}` : ''}.`)],
      cta: bi('Nhắn tin', 'Send a message'),
      landing: i.bookingUrl ?? bi('Trang đặt lịch của tiệm.', 'Your own booking page.'),
      visual: bi('Ảnh thật chụp tại tiệm.', 'A real photo taken in the shop.'),
    };
    before.push(bi(
      'Đăng lên OA cho người theo dõi trước, xem có ai nhắn không, rồi mới trả tiền.',
      'Post it to your OA followers first, see whether anyone messages, and only then pay.'));
  }

  // Money and day counts in one sentence, so each language is written out
  // whole: the clause order is not the same twice.
  const budgetLine: Txt = i.dailyCents && i.ceilingCents
    ? bi(
      `${i.money(i.dailyCents)}/ngày × ${i.days} ngày = ${i.money(i.dailyCents * i.days)}. Đặt ngân sách ở cấp chiến dịch (CBO), không đặt riêng từng ad set — ngân sách nhỏ chia nhỏ nữa thì không ad set nào đủ dữ liệu để máy học.`,
      `${i.money(i.dailyCents)}/day × ${i.days} days = ${i.money(i.dailyCents * i.days)}. Set the budget at the campaign level (CBO), not on each ad set — split a small budget again and no ad set gets enough data for the machine to learn from.`)
    : bi(
      'Chưa tính được ngân sách — xem phần ngưỡng chi phía trên.',
      'No budget worked out yet — see the spending limit above.');

  const measure: Txt[] = [];
  if (i.ceilingCents) {
    measure.push(bi(
      `Ngày 3: tiền đã chi ÷ số booking quảng cáo mang về. Trên ${i.money(i.ceilingCents)}/booking là đang lỗ.`,
      `Day 3: money spent ÷ bookings the ads brought in. Over ${i.money(i.ceilingCents)} a booking and you are losing money.`));
    measure.push(bi(
      `Ngày 7: nếu vẫn trên ${i.money(i.ceilingCents)} — tắt. Đừng chờ hết chiến dịch để "cho nó chạy đủ".`,
      `Day 7: still over ${i.money(i.ceilingCents)}? Switch it off. Do not wait out the campaign to "give it a fair run".`));
    measure.push(bi(
      `Ngày ${i.days}: đếm có bao nhiêu người là khách LẦN ĐẦU. Đây mới là con số nói quảng cáo có mang khách mới về hay chỉ bán lại cho khách cũ.`,
      `Day ${i.days}: count how many of them were FIRST-TIME customers. That is the number that says whether the ads brought new people in or just sold again to the ones you had.`));
  }
  if (i.targetBookings) {
    measure.push(bi(
      `Đích của chiến dịch này: ${i.targetBookings} booking. Ít hơn thì con số "mỗi booking tốn bao nhiêu" chưa đọc được, không phải là chiến dịch thất bại.`,
      `What this campaign is aiming at: ${i.targetBookings} bookings. Fewer than that and the cost-per-booking number cannot be read yet — which is not the same as the campaign failing.`));
  }
  measure.push(bi(
    'Ghi lại số ở cùng một chỗ mỗi tuần. Một chiến dịch không được ghi lại thì tháng sau không ai nhớ nó đã tốn bao nhiêu.',
    'Write the numbers down in the same place every week. A campaign nobody wrote down is one nobody remembers the cost of a month later.'));

  return { platform: i.platform, name: campaignName, objective, adSets, creative, budgetLine, before, measure, warnings };
}
