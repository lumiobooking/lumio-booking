/**
 * Who to aim at, sized from the market — and what that makes the budget.
 *
 * THE CORRECTION THIS FILE IS
 *
 * Everything the ads tab said was derived from the shop's own booking history:
 * which channel had worked, what its customers had paid, when they had come.
 * For a shop with twenty-two bookings that is close to reading tea leaves, and
 * more importantly it answers the wrong question. "Who should I target?" is a
 * question about the tens of thousands of people who have NEVER been in the
 * book. No amount of history can name them.
 *
 * So the chain here runs outward-in:
 *
 *   how many adults live around the shop   (Census)
 *     → which slice of them is the target  (Census + what the shop says it does)
 *       → how many the shop can physically serve  (its own chairs and hours)
 *         → what share of the target that is       (arithmetic)
 *           → what it may cost to buy them         (its own margin)
 *
 * Only the last step needs the shop's own numbers, and it needs them
 * unavoidably: no market data anywhere can tell a business what it can afford.
 *
 * WHAT IT STILL WILL NOT DO
 *
 * It does not know the competition. There is no free, reliable, per-ZIP census
 * of nail salons, and inventing a market-share figure would be the most
 * damaging number on the page precisely because it would look like the most
 * sophisticated one. What replaces it is the penetration test: not "you will
 * win X% of this market" but "to fill your empty chairs you would need X% of
 * this segment — decide for yourself whether that is plausible on your street".
 *
 * It also does not forecast bookings from a budget. Reach and cost-per-click
 * belong to the ad platforms and vary weekly; the platforms' own estimators
 * will tell the owner, for free, before spending anything.
 */

import type { AreaAudience, AgeBand } from './census-audience';
import { adultsIn } from './census-audience';
import { bi, join, viOf, enOf, type Txt } from './i18n';
import { count, money0, share, type PlainStep } from './plain';

export interface TargetSegment {
  key: string;
  label: Txt;
  /** People in this segment, from the Census. */
  size: number;
  /** How the size was arrived at, so a reader can disagree with the definition. */
  basis: Txt;
  /** Why this segment for THIS business. */
  why: Txt;
  /** What to type into the ad platform. */
  targeting: Txt[];
}

/**
 * A `PlainStep` whose four reader-facing phrases carry both languages.
 *
 * `PlainStep` (./plain) types them as `string`, and that file still serves
 * callers written before the language pass, so the shape is widened here
 * rather than there. `Txt` is `string | Bi`, so this is a strict superset:
 * same keys, same order, same meaning.
 */
export interface MarketStep extends Omit<PlainStep, 'title' | 'line' | 'action' | 'why'> {
  title: Txt;
  line: Txt;
  action: Txt | null;
  why: Txt;
}

export interface MarketPlan {
  /** Adults 18+ in the ZIPs asked about. Null when the Census did not answer. */
  adults: number | null;
  /** Ranked; the first is the recommendation. */
  segments: TargetSegment[];
  /** The recommended one, expanded. */
  primary: TargetSegment | null;
  /** Households that can comfortably afford this shop's ticket. */
  affordable: { usd: number; households: number; pct: number } | null;
  /** New customers the shop could seat over the window. */
  capacity: number | null;
  /** Share of the primary segment needed to fill that capacity. */
  penetrationPct: number | null;
  penetrationVerdict: 'easy' | 'realistic' | 'stretch' | 'impossible' | 'unknown';
  /** Most that can be spent over the window and still pay back. */
  maxSpendCents: number | null;
  /** The argument, in order: what it is, what to do, and why if asked. */
  steps: MarketStep[];
  /**
   * Flattened one-liners, for the prompt and for anything that wants text.
   *
   * Vietnamese only, like every other prompt input — the prompt library is one
   * language on purpose. The screen reads `steps`, which carries both.
   */
  reasoning: string[];
  /** Stated every time. */
  limits: Txt[];
}

export interface MarketInput {
  area: AreaAudience;
  /** 'SALON' | 'RESTAURANT' | 'REAL_ESTATE' | 'SERVICE'. */
  industry: string;
  /** What the business itself says it does and who it serves. Outranks the enum. */
  declaredWhoWeServe?: string | null;
  declaredWhatWeDo?: string | null;
  /** What a first visit is worth, and what is left after paying the technician. */
  firstVisitTicketCents: number | null;
  grossMarginPct: number | null;
  cpaCeilingCents: number | null;
  /** Appointments that would fit in the quiet blocks over the campaign window. */
  openSlots: number | null;
  campaignDays: number;
  city: string | null;
  region: string | null;
  radiusMiles?: number;
  money: (cents: number) => string;
}

const WORKING_AGE: AgeBand[] = ['25-34', '35-44', '45-54'];
const WIDE_ADULT: AgeBand[] = ['25-34', '35-44', '45-54', '55-64'];
const ALL_ADULT: AgeBand[] = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];

/** A segment is only worth naming if a campaign could plausibly reach it. */
const MIN_SEGMENT = 400;

const n = (x: number) => x.toLocaleString('en-US');

/**
 * The same share sentence `share()` writes, in both languages.
 *
 * `share()` lives in ./plain and speaks Vietnamese; that file is not part of
 * this pass, so the English half is written here and follows the same rule it
 * does — under 1% a percentage stops meaning anything, so it becomes a count of
 * people out of a count of people.
 */
function shareTxt(part: number, whole: number): Txt {
  const vi = share(part, whole);
  if (!vi) return '';
  const pct = (part / whole) * 100;
  return bi(vi, pct < 1
    ? `${count(part)} people out of ${count(whole)}`
    : `${Math.round(pct)}% (${count(part)} of ${count(whole)})`);
}

/**
 * Does the business say it serves a particular language community?
 *
 * This is checked BEFORE the trade, on purpose. A marketing agency for
 * Vietnamese business owners in the US and a nail salon in the same ZIP have
 * almost nothing in common as advertisers, and the four-value industry enum
 * cannot tell them apart — that is the failure that put nail-salon advice on
 * an agency's screen. What the business wrote about itself can.
 */
function languageMatch(area: AreaAudience, declared: string): { name: string; people: number; pct: number } | null {
  const text = declared.toLowerCase();
  const hints: [RegExp, string][] = [
    [/việt|viet\b|vietnamese/i, 'Vietnamese'],
    [/hispanic|latino|spanish|mexic/i, 'Spanish'],
    [/hoa\b|chinese|mandarin|cantonese/i, 'Chinese'],
    [/hàn|korean/i, 'Korean'],
    [/philipin|filipino|tagalog/i, 'Tagalog'],
  ];
  for (const [re, name] of hints) {
    if (re.test(text)) {
      const hit = area.languages.find((l) => l.name === name);
      if (hit) return hit;
    }
  }
  return null;
}

export function buildMarketPlan(i: MarketInput): MarketPlan {
  const a = i.area;
  // The place name is the shop's own data and is never translated; only the
  // "we do not know where you are" fallback is written in both languages.
  const whereVi = i.city && i.region ? `${i.city}, ${i.region}` : i.region || 'khu vực quanh tiệm';
  const whereEn = i.city && i.region ? `${i.city}, ${i.region}` : i.region || 'the area around the shop';
  const radius = i.radiusMiles ?? 5;
  const adults = a.ok ? adultsIn(a, ALL_ADULT, 'all') : null;
  const limits: Txt[] = [
    bi(
      `Số liệu theo MÃ ZIP của Cục Thống kê Mỹ${a.year ? ` (ACS 5 năm ${a.year})` : ''}, không phải một vòng tròn ${radius} dặm. ZIP có thể rộng hoặc hẹp hơn nhiều.`,
      `These are US Census figures by ZIP CODE${a.year ? ` (${a.year} 5-year ACS)` : ''}, not a ${radius}-mile circle. A ZIP can be much wider or much narrower.`),
    bi(
      'KHÔNG có dữ liệu đối thủ. Không ai bán được số liệu đáng tin về từng tiệm trong từng ZIP, nên ở đây không có "thị phần" — chỉ có "cần bao nhiêu phần trăm tệp này để lấp hết chỗ trống", và chủ tiệm là người biết con phố của mình.',
      'There is NO competitor data. Nobody sells trustworthy figures on every shop in every ZIP, so there is no "market share" here — only "what share of this group it would take to fill your empty chairs", and you are the one who knows your own street.'),
    bi(
      'ACS là trung bình 5 năm. Nó mô tả cấu trúc dân cư, không phải nhu cầu tháng này.',
      'The ACS is a 5-year average. It describes who lives there, not what demand looks like this month.'),
    bi(
      'Không có dự báo số booking từ ngân sách. Ước tính tiếp cận và giá mỗi lượt hiển thị là thứ chính nền tảng quảng cáo cho xem miễn phí trước khi chi.',
      'No booking forecast from a budget. Reach and cost per impression are what the ad platforms themselves show you, free, before you spend a dollar.'),
  ];

  if (!a.ok || !adults) {
    return {
      adults: null, segments: [], primary: null, affordable: null,
      capacity: i.openSlots ?? null, penetrationPct: null, penetrationVerdict: 'unknown',
      maxSpendCents: null,
      steps: [{
        key: 'market', icon: '📍',
        title: bi('Chưa có số liệu khu vực', 'No area figures yet'),
        line: bi(
          'Hệ thống đang lấy dân số quanh tiệm, chạy nền mỗi giờ.',
          'The system is pulling the population around the shop; it runs in the background every hour.'),
        action: null,
        // The Census notes are already bilingual; `join` keeps each side whole.
        why: a.notes.length
          ? join(a.notes, ' ')
          : bi('Chưa lấy được dữ liệu từ Cục Thống kê Mỹ.', 'Could not get the data from the US Census Bureau yet.'),
      }],
      reasoning: [
        'Chưa có số liệu dân cư nên chưa xác định được tệp mục tiêu từ thị trường.',
        ...a.notes.map(viOf),
      ],
      limits,
    };
  }

  // ---- candidate segments, each sized from the Census ----------------------
  const segments: TargetSegment[] = [];
  const declared = `${i.declaredWhoWeServe ?? ''} ${i.declaredWhatWeDo ?? ''}`.trim();

  const lang = declared ? languageMatch(a, declared) : null;
  if (lang && lang.people >= MIN_SEGMENT) {
    segments.push({
      key: 'language',
      label: bi(
        `Cộng đồng nói ${lang.name === 'Vietnamese' ? 'tiếng Việt' : lang.name} quanh ${whereVi}`,
        `${lang.name}-speaking community around ${whereEn}`),
      size: lang.people,
      basis: bi(
        `${n(lang.people)} người từ 5 tuổi trở lên nói ${lang.name} ở nhà (${lang.pct}% dân số vùng) — Cục Thống kê Mỹ, bảng C16001.`,
        `${n(lang.people)} people aged 5 and over speak ${lang.name} at home (${lang.pct}% of the area) — US Census Bureau, table C16001.`),
      why: bi(
        'Chính doanh nghiệp khai đang phục vụ cộng đồng này. Đây là tệp hẹp nhất mà vẫn đủ lớn, và là tệp mà đối thủ nói tiếng Anh không chạm tới được — lợi thế ngôn ngữ là thứ tiền không mua được.',
        'The business itself says this is who it serves. It is the tightest audience that is still big enough, and the one an English-speaking competitor cannot reach — a language advantage is not something money can buy.'),
      targeting: [
        bi(
          `Meta: Vị trí = bán kính ${radius} dặm quanh tiệm; Ngôn ngữ = ${lang.name}. Đặt ngôn ngữ TRƯỚC mọi tiêu chí sở thích.`,
          `Meta: Location = ${radius}-mile radius around the shop; Language = ${lang.name}. Set the language BEFORE any interest targeting.`),
        bi(
          'Google: chạy quảng cáo bằng chính ngôn ngữ đó, và bật cả từ khoá tiếng Anh có tên khu vực — cộng đồng này tìm bằng cả hai.',
          'Google: run the ads in that language, and keep English keywords with the area name switched on too — this community searches in both.'),
        bi(
          'Nội dung viết bằng ngôn ngữ của họ, không phải bản dịch máy của quảng cáo tiếng Anh.',
          'Write the copy in their language. Do not run a machine translation of the English ad.'),
      ],
    });
  }

  const industry = (i.industry || 'SALON').toUpperCase();
  const womenCore = adultsIn(a, WORKING_AGE, 'female');
  const womenWide = adultsIn(a, WIDE_ADULT, 'female');
  const adultsCore = adultsIn(a, WORKING_AGE, 'all');
  const adultsWide = adultsIn(a, WIDE_ADULT, 'all');

  if (industry === 'SALON' && womenCore >= MIN_SEGMENT) {
    segments.push({
      key: 'women-core',
      label: bi(`Phụ nữ 25–54 quanh ${whereVi}`, `Women 25–54 around ${whereEn}`),
      size: womenCore,
      basis: bi(
        `${n(womenCore)} phụ nữ 25–54 tuổi trong các ZIP quanh tiệm — Cục Thống kê Mỹ, bảng B01001.`,
        `${n(womenCore)} women aged 25–54 in the ZIP codes around the shop — US Census Bureau, table B01001.`),
      why: bi(
        'Nhóm chi đều đặn nhất cho dịch vụ làm đẹp định kỳ, và là nhóm có lịch cố định nên dễ thành khách quen hơn nhóm trẻ hơn.',
        'The group that spends most steadily on regular beauty services, and the one with a fixed weekly routine, so they turn into regulars more easily than a younger crowd.'),
      targeting: [
        bi(
          `Meta: Nữ, 25–54, bán kính ${radius} dặm quanh địa chỉ tiệm, chế độ "người đang sống trong khu vực này".`,
          `Meta: Women, 25–54, a ${radius}-mile radius around the shop address, set to "people living in this location".`),
        bi(
          'Google: không đặt giới tính — người gõ "tiệm nail gần đây" đã tự khai nhu cầu rồi, lọc thêm chỉ làm hẹp vô ích và đắt hơn.',
          'Google: leave gender off — somebody typing "nail salon near me" has already told you what they want, and filtering further only narrows the reach and raises the price.'),
      ],
    });
  }
  if (industry === 'RESTAURANT' && adultsWide >= MIN_SEGMENT) {
    segments.push({
      key: 'adults-wide',
      label: bi(`Người lớn 25–64 quanh ${whereVi}`, `Adults 25–64 around ${whereEn}`),
      size: adultsWide,
      basis: bi(
        `${n(adultsWide)} người 25–64 tuổi trong các ZIP quanh tiệm — bảng B01001.`,
        `${n(adultsWide)} people aged 25–64 in the ZIP codes around the shop — table B01001.`),
      why: bi(
        'Quán ăn bán cho cả hộ gia đình lẫn người đi làm; thu hẹp theo giới tính ở đây chỉ cắt mất một nửa nhu cầu.',
        'A restaurant sells to households and to people at work alike; narrowing by gender here just cuts half the demand away.'),
      targeting: [
        bi(`Meta: mọi giới tính, 25–64, bán kính ${radius} dặm.`, `Meta: all genders, 25–64, a ${radius}-mile radius.`),
        bi(
          'Google: từ khoá theo món và theo khu vực, giờ chạy trùng khung đặt bàn.',
          'Google: keywords by dish and by area, running in the hours people book tables.'),
      ],
    });
  }
  if (industry === 'REAL_ESTATE' && adultsIn(a, ['35-44', '45-54', '55-64'], 'all') >= MIN_SEGMENT) {
    const size = adultsIn(a, ['35-44', '45-54', '55-64'], 'all');
    segments.push({
      key: 'adults-3564',
      label: bi(`Người lớn 35–64 quanh ${whereVi}`, `Adults 35–64 around ${whereEn}`),
      size,
      basis: bi(`${n(size)} người 35–64 tuổi — bảng B01001.`, `${n(size)} people aged 35–64 — table B01001.`),
      why: bi(
        'Độ tuổi có khả năng vay và có nhu cầu đổi nhà cao nhất.',
        'The ages most likely to qualify for a loan and to be looking to move.'),
      targeting: [
        bi(
          `Meta: 35–64, bán kính rộng hơn (${radius * 3} dặm) — người mua nhà đi xa hơn người đi làm móng.`,
          `Meta: 35–64, a wider radius (${radius * 3} miles) — home buyers travel further than someone getting their nails done.`),
        bi(
          'Google: từ khoá theo tên khu dân cư cụ thể, không phải theo thành phố.',
          'Google: keywords by the specific neighborhood name, not by the city.'),
      ],
    });
  }
  if (!segments.length && adultsCore >= MIN_SEGMENT) {
    segments.push({
      key: 'adults-core',
      label: bi(`Người lớn 25–54 quanh ${whereVi}`, `Adults 25–54 around ${whereEn}`),
      size: adultsCore,
      basis: bi(`${n(adultsCore)} người 25–54 tuổi — bảng B01001.`, `${n(adultsCore)} people aged 25–54 — table B01001.`),
      why: bi(
        'Chưa có căn cứ để thu hẹp hơn: doanh nghiệp chưa mô tả tệp phục vụ và ngành nghề chưa đủ đặc thù để suy ra.',
        'Nothing to narrow it with yet: the business has not said who it serves, and the industry code is too coarse to work it out from.'),
      targeting: [
        bi(`Meta: 25–54, bán kính ${radius} dặm quanh tiệm.`, `Meta: 25–54, a ${radius}-mile radius around the shop.`),
        bi(
          'Mô tả rõ "tệp khách phục vụ" trong hồ sơ tiệm để hệ thống thu hẹp được tệp này — tệp càng hẹp, mỗi đồng càng đi xa.',
          'Fill in "who you serve" in the shop profile so the system can narrow this down — the tighter the audience, the further each dollar goes.'),
      ],
    });
  }

  // Affluence as a SECOND axis, never a segment of its own: a household with
  // money is not a customer, it is a household with money.
  const ticket = i.firstVisitTicketCents ?? 0;
  const line = ticket >= 15_000 ? 150_000 : ticket >= 7_000 ? 100_000 : 75_000;
  const affordable = a.incomeAtLeast.find((x) => x.usd === line) ?? null;
  if (affordable && womenWide >= MIN_SEGMENT && industry === 'SALON' && affordable.pct >= 25) {
    segments.push({
      key: 'women-affluent',
      label: bi(
        `Phụ nữ 25–64 trong hộ thu nhập trên $${n(line)}`,
        `Women 25–64 in households earning over $${n(line)}`),
      size: Math.round(womenWide * (affordable.pct / 100)),
      basis: bi(
        `${n(womenWide)} phụ nữ 25–64 × ${affordable.pct}% hộ gia đình có thu nhập từ $${n(line)}/năm (bảng B19001). Đây là PHÉP NHÂN hai tỷ lệ, không phải một con số đếm được — coi là ước lượng quy mô, không phải danh sách người.`,
        `${n(womenWide)} women aged 25–64 × the ${affordable.pct}% of households earning $${n(line)} a year or more (table B19001). That is two rates MULTIPLIED, not a head count — read it as a size estimate, not as a list of people.`),
      why: bi(
        'Tệp hẹp hơn và chịu giá tốt hơn. Chỉ đáng chạy khi tiệm có dịch vụ cao cấp thật để bán cho họ; nếu menu chỉ có dịch vụ cơ bản thì thu hẹp kiểu này chỉ làm giá thầu đắt lên mà không bán được gì hơn.',
        'A tighter audience that takes a higher price better. Only worth running if the shop really has a premium service to sell them; with a basic menu, narrowing like this only makes the bidding dearer without selling anything more.'),
      targeting: [
        bi(
          `Meta: Nữ 25–64, bán kính ${radius} dặm, chồng thêm tiêu chí thu nhập hộ gia đình nếu nền tảng còn cho phép ở khu vực này.`,
          `Meta: Women 25–64, a ${radius}-mile radius, with household income layered on top if the platform still allows it in this area.`),
        bi(
          'Nếu không chồng được thu nhập: nhắm theo mã ZIP có thu nhập cao nhất trong danh sách thay vì theo cả vùng.',
          'If income cannot be layered on: target the highest-income ZIP codes on the list instead of the whole area.'),
      ],
    });
  }

  segments.sort((a2, b2) => (a2.key === 'language' ? -1 : b2.key === 'language' ? 1 : b2.size - a2.size));
  const primary = segments[0] ?? null;

  // ---- what the shop can actually absorb ----------------------------------
  const capacity = i.openSlots ?? null;
  const penetrationPct = primary && capacity && primary.size > 0
    ? Math.round((capacity / primary.size) * 10_000) / 100
    : null;
  const penetrationVerdict: MarketPlan['penetrationVerdict'] = penetrationPct === null ? 'unknown'
    : penetrationPct <= 0.5 ? 'easy'
      : penetrationPct <= 2 ? 'realistic'
        : penetrationPct <= 5 ? 'stretch' : 'impossible';

  const maxSpendCents = capacity && i.cpaCeilingCents ? capacity * i.cpaCeilingCents : null;

  // ---- the argument, in order ---------------------------------------------
  //
  // Three layers per block, and the order is the point: what it IS, then what
  // to DO, then — only if asked — how it was worked out. The old version put
  // the derivation in the same sentence as the finding, so every line carried
  // its own methodology and an owner had to read a paragraph to learn one
  // thing. They are not marketing people; they have a shop to run.
  const steps: MarketStep[] = [];

  steps.push({
    key: 'market', icon: '📍',
    title: bi('Khu vực quanh tiệm', 'The area around the shop'),
    line: bi(
      `${n(adults)} người trưởng thành sống trong các mã ZIP của tiệm.`,
      `${n(adults)} adults live in the shop's ZIP codes.`),
    action: null,
    why: bi(
      `Đếm từ điều tra dân số Mỹ (ACS 5 năm${a.year ? ` ${a.year}` : ''}), bảng B01001, cộng theo các ZIP của tiệm. Đây là số người thật đang sống ở đó, không phải số khách của tiệm.`,
      `Counted from the US Census (${a.year ? `${a.year} ` : ''}5-year ACS), table B01001, added up across the shop's ZIP codes. These are real people living there, not the shop's customers.`),
  });

  if (primary) {
    steps.push({
      key: 'target', icon: '🎯',
      title: bi('Nên nhắm vào ai', 'Who to aim at'),
      line: bi(
        `${viOf(primary.label)} — ${n(primary.size)} người.`,
        `${enOf(primary.label)} — ${n(primary.size)} people.`),
      action: bi(
        `Đặt đúng tệp này trong trình quản lý quảng cáo: ${viOf(primary.targeting[0])}`,
        `Set exactly this audience in the ads manager: ${enOf(primary.targeting[0])}`),
      why: bi(
        `${viOf(primary.basis)} ${viOf(primary.why)}`,
        `${enOf(primary.basis)} ${enOf(primary.why)}`),
    });
  }

  if (affordable) {
    const rich = affordable.pct >= 50;
    steps.push({
      key: 'price', icon: '💵',
      title: bi('Giá của tiệm so với vùng', 'Your prices against the area'),
      line: i.firstVisitTicketCents
        ? bi(
          `${affordable.pct}% hộ ở đây thu nhập trên $${n(affordable.usd)}/năm. Khách mới của tiệm trả trung bình ${money0(i.firstVisitTicketCents, i.money)}.`,
          `${affordable.pct}% of households here earn over $${n(affordable.usd)} a year. A new customer at this shop pays ${money0(i.firstVisitTicketCents, i.money)} on average.`)
        : bi(
          `${affordable.pct}% hộ ở đây thu nhập trên $${n(affordable.usd)}/năm.`,
          `${affordable.pct}% of households here earn over $${n(affordable.usd)} a year.`),
      action: !i.firstVisitTicketCents
        ? null
        : rich
          ? bi(
            'Đừng giảm giá. Thêm một dịch vụ cao cấp vào menu và mời khách nâng cấp — vùng này trả nổi.',
            'Do not discount. Put a premium service on the menu and offer the upgrade — this area can pay for it.')
          : bi(
            'Giữ nguyên giá. Cạnh tranh bằng việc có chỗ trống đúng giờ khách cần, không bằng giá rẻ hơn.',
            'Hold your prices. Compete on having an opening when the customer wants one, not on being cheaper.'),
      why: bi(
        `Số hộ theo mức thu nhập lấy từ bảng B19001 của điều tra dân số (${n(affordable.households)} hộ). `
        + (i.firstVisitTicketCents
          ? 'Hoá đơn khách mới lấy từ lần đầu tiên của mỗi khách trong sổ của tiệm. Vùng chi mạnh mà giá tiệm thấp nghĩa là dư địa nằm ở bán thêm, không phải ở giảm giá.'
          : 'Chưa đủ lịch hẹn để biết khách mới trả bao nhiêu, nên chưa so được với sức chi của vùng.'),
        `Household counts by income come from Census table B19001 (${n(affordable.households)} households). `
        + (i.firstVisitTicketCents
          ? 'The new-customer ticket is each customer\'s first visit in your own book. An area that spends well and a low price at the shop means the room to grow is in selling more, not in cutting prices.'
          : 'Not enough appointments yet to know what a new customer pays, so there is nothing to hold up against what the area can spend.')),
    });
  }

  if (capacity !== null && primary) {
    const v = penetrationVerdict;
    const need = shareTxt(capacity, primary.size);
    steps.push({
      key: 'capacity', icon: '🪑',
      title: bi('Tiệm nhận thêm được bao nhiêu khách', 'How many more customers you can take'),
      line: bi(
        `Còn chỗ cho ${capacity} khách mới trong ${i.campaignDays} ngày — cần ${viOf(need)}.`,
        `Room for ${capacity} new customers in ${i.campaignDays} days — that takes ${enOf(need)}.`),
      action: v === 'impossible'
        ? bi(
          'Chưa chạy quảng cáo. Mời khách cũ quay lại trước — rẻ hơn nhiều và lấp được chỗ trống này.',
          'Do not run ads yet. Bring past customers back first — far cheaper, and it fills these gaps.')
        : v === 'stretch'
          ? bi(
            'Chạy được, nhưng đừng kỳ vọng lấp hết trong hai tuần đầu.',
            'You can run it, but do not expect every slot to fill in the first two weeks.')
          : bi(
            'Con số này nằm trong tầm với — vấn đề là tiếp cận đúng người, không phải thiếu người.',
            'This number is well within reach — the problem is reaching the right people, not a shortage of them.'),
      why: v === 'impossible'
        ? bi(
          'Số chỗ trống nhiều hơn thứ tệp này nuôi nổi. Muốn lấp hết thì phải mở rộng bán kính hoặc thêm dịch vụ, chứ không phải chi thêm tiền.',
          'There are more empty slots than this audience can feed. Filling them all means widening the radius or adding services, not spending more.')
        : bi(
          'Chỗ trống đếm từ các khung giờ vắng nhất của tiệm trong 4 tuần qua, quy đổi theo thời lượng dịch vụ trung bình và tính cho đúng 2 tuần chiến dịch.',
          'The open slots are counted from your quietest hours over the last 4 weeks, converted at your average service length and scaled to the 2 weeks of the campaign.'),
    });
  }

  if (maxSpendCents && i.cpaCeilingCents) {
    steps.push({
      key: 'budget', icon: '💰',
      title: bi(`Tối đa nên chi trong ${i.campaignDays} ngày`, `The most to spend over ${i.campaignDays} days`),
      line: bi(
        `${money0(maxSpendCents, i.money)} — và chỉ khi mỗi khách mới tốn dưới ${money0(i.cpaCeilingCents, i.money)}.`,
        `${money0(maxSpendCents, i.money)} — and only if each new customer costs under ${money0(i.cpaCeilingCents, i.money)}.`),
      action: bi(
        `Bắt đầu nhỏ. Sau 3 ngày, lấy tiền đã chi chia cho số khách mới: dưới ${money0(i.cpaCeilingCents, i.money)} thì tăng dần, trên thì tắt.`,
        `Start small. After 3 days, divide what you spent by the new customers it brought: under ${money0(i.cpaCeilingCents, i.money)}, raise it slowly; over, shut it off.`),
      why: bi(
        `${capacity} chỗ trống × ${money0(i.cpaCeilingCents, i.money)} tiền lãi mỗi khách mới = ${money0(maxSpendCents, i.money)}. `
        + 'Chi hơn mức đó thì dù mọi đồng đều ra khách vẫn không hoàn vốn, vì không còn ghế trống để ngồi. '
        + 'Tiền lãi mỗi khách = hoá đơn lần đầu trừ phần trả cho thợ.',
        `${capacity} open slots × ${money0(i.cpaCeilingCents, i.money)} of profit per new customer = ${money0(maxSpendCents, i.money)}. `
        + 'Spend past that and you do not get it back even if every dollar brings someone in, because there is no chair left for them to sit in. '
        + 'Profit per customer = the first bill minus what the technician is paid.'),
    });
  } else if (!i.cpaCeilingCents) {
    steps.push({
      key: 'budget', icon: '💰',
      title: bi('Chưa tính được nên chi bao nhiêu', 'Cannot work out a budget yet'),
      line: bi('Còn thiếu tỷ lệ ăn chia với thợ.', 'The commission split with your technicians is missing.'),
      action: bi(
        'Điền tỷ lệ ăn chia trong hồ sơ từng thợ (Nhân sự → sửa thợ). Xong là có ngay con số nên chi.',
        'Fill in the commission split on each technician (Staff → edit technician). Once it is in, the spending figure appears.'),
      why: bi(
        'Dân số nói được nhắm vào ai, nhưng không nói được tiệm trả bao nhiêu một khách thì còn lãi. Chỉ số liệu của chính tiệm mới trả lời được, và tỷ lệ ăn chia là mảnh còn thiếu.',
        'Census data can say who to aim at, but not how much you can pay for a customer and still come out ahead. Only your own numbers answer that, and the commission split is the piece that is missing.'),
    });
  }

  // Vietnamese, because this is what the prompt reads — see `reasoning` above.
  const reasoning = steps.map((st) => `${viOf(st.line)}${st.action ? ` → ${viOf(st.action)}` : ''}`);

  return {
    adults, segments, primary, affordable, capacity,
    penetrationPct, penetrationVerdict, maxSpendCents, steps, reasoning, limits,
  };
}
