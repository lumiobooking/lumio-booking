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

export interface TargetSegment {
  key: string;
  label: string;
  /** People in this segment, from the Census. */
  size: number;
  /** How the size was arrived at, so a reader can disagree with the definition. */
  basis: string;
  /** Why this segment for THIS business. */
  why: string;
  /** What to type into the ad platform. */
  targeting: string[];
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
  /** The argument, in order, each line carrying its own number. */
  reasoning: string[];
  /** Stated every time. */
  limits: string[];
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
  const where = i.city && i.region ? `${i.city}, ${i.region}` : i.region || 'khu vực quanh tiệm';
  const radius = i.radiusMiles ?? 5;
  const adults = a.ok ? adultsIn(a, ALL_ADULT, 'all') : null;
  const limits = [
    `Số liệu theo MÃ ZIP của Cục Thống kê Mỹ${a.year ? ` (ACS 5 năm ${a.year})` : ''}, không phải một vòng tròn ${radius} dặm. ZIP có thể rộng hoặc hẹp hơn nhiều.`,
    'KHÔNG có dữ liệu đối thủ. Không ai bán được số liệu đáng tin về từng tiệm trong từng ZIP, nên ở đây không có "thị phần" — chỉ có "cần bao nhiêu phần trăm tệp này để lấp hết chỗ trống", và chủ tiệm là người biết con phố của mình.',
    'ACS là trung bình 5 năm. Nó mô tả cấu trúc dân cư, không phải nhu cầu tháng này.',
    'Không có dự báo số booking từ ngân sách. Ước tính tiếp cận và giá mỗi lượt hiển thị là thứ chính nền tảng quảng cáo cho xem miễn phí trước khi chi.',
  ];

  if (!a.ok || !adults) {
    return {
      adults: null, segments: [], primary: null, affordable: null,
      capacity: i.openSlots ?? null, penetrationPct: null, penetrationVerdict: 'unknown',
      maxSpendCents: null,
      reasoning: [
        'Chưa có số liệu dân cư nên chưa xác định được tệp mục tiêu từ thị trường.',
        ...a.notes,
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
      label: `Cộng đồng nói ${lang.name === 'Vietnamese' ? 'tiếng Việt' : lang.name} quanh ${where}`,
      size: lang.people,
      basis: `${n(lang.people)} người từ 5 tuổi trở lên nói ${lang.name} ở nhà (${lang.pct}% dân số vùng) — Cục Thống kê Mỹ, bảng C16001.`,
      why: 'Chính doanh nghiệp khai đang phục vụ cộng đồng này. Đây là tệp hẹp nhất mà vẫn đủ lớn, và là tệp mà đối thủ nói tiếng Anh không chạm tới được — lợi thế ngôn ngữ là thứ tiền không mua được.',
      targeting: [
        `Meta: Vị trí = bán kính ${radius} dặm quanh tiệm; Ngôn ngữ = ${lang.name}. Đặt ngôn ngữ TRƯỚC mọi tiêu chí sở thích.`,
        'Google: chạy quảng cáo bằng chính ngôn ngữ đó, và bật cả từ khoá tiếng Anh có tên khu vực — cộng đồng này tìm bằng cả hai.',
        'Nội dung viết bằng ngôn ngữ của họ, không phải bản dịch máy của quảng cáo tiếng Anh.',
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
      label: `Phụ nữ 25–54 quanh ${where}`,
      size: womenCore,
      basis: `${n(womenCore)} phụ nữ 25–54 tuổi trong các ZIP quanh tiệm — Cục Thống kê Mỹ, bảng B01001.`,
      why: 'Nhóm chi đều đặn nhất cho dịch vụ làm đẹp định kỳ, và là nhóm có lịch cố định nên dễ thành khách quen hơn nhóm trẻ hơn.',
      targeting: [
        `Meta: Nữ, 25–54, bán kính ${radius} dặm quanh địa chỉ tiệm, chế độ "người đang sống trong khu vực này".`,
        'Google: không đặt giới tính — người gõ "tiệm nail gần đây" đã tự khai nhu cầu rồi, lọc thêm chỉ làm hẹp vô ích và đắt hơn.',
      ],
    });
  }
  if (industry === 'RESTAURANT' && adultsWide >= MIN_SEGMENT) {
    segments.push({
      key: 'adults-wide',
      label: `Người lớn 25–64 quanh ${where}`,
      size: adultsWide,
      basis: `${n(adultsWide)} người 25–64 tuổi trong các ZIP quanh tiệm — bảng B01001.`,
      why: 'Quán ăn bán cho cả hộ gia đình lẫn người đi làm; thu hẹp theo giới tính ở đây chỉ cắt mất một nửa nhu cầu.',
      targeting: [
        `Meta: mọi giới tính, 25–64, bán kính ${radius} dặm.`,
        'Google: từ khoá theo món và theo khu vực, giờ chạy trùng khung đặt bàn.',
      ],
    });
  }
  if (industry === 'REAL_ESTATE' && adultsIn(a, ['35-44', '45-54', '55-64'], 'all') >= MIN_SEGMENT) {
    const size = adultsIn(a, ['35-44', '45-54', '55-64'], 'all');
    segments.push({
      key: 'adults-3564',
      label: `Người lớn 35–64 quanh ${where}`,
      size,
      basis: `${n(size)} người 35–64 tuổi — bảng B01001.`,
      why: 'Độ tuổi có khả năng vay và có nhu cầu đổi nhà cao nhất.',
      targeting: [
        `Meta: 35–64, bán kính rộng hơn (${radius * 3} dặm) — người mua nhà đi xa hơn người đi làm móng.`,
        'Google: từ khoá theo tên khu dân cư cụ thể, không phải theo thành phố.',
      ],
    });
  }
  if (!segments.length && adultsCore >= MIN_SEGMENT) {
    segments.push({
      key: 'adults-core',
      label: `Người lớn 25–54 quanh ${where}`,
      size: adultsCore,
      basis: `${n(adultsCore)} người 25–54 tuổi — bảng B01001.`,
      why: 'Chưa có căn cứ để thu hẹp hơn: doanh nghiệp chưa mô tả tệp phục vụ và ngành nghề chưa đủ đặc thù để suy ra.',
      targeting: [
        `Meta: 25–54, bán kính ${radius} dặm quanh tiệm.`,
        'Mô tả rõ "tệp khách phục vụ" trong hồ sơ tiệm để hệ thống thu hẹp được tệp này — tệp càng hẹp, mỗi đồng càng đi xa.',
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
      label: `Phụ nữ 25–64 trong hộ thu nhập trên $${n(line)}`,
      size: Math.round(womenWide * (affordable.pct / 100)),
      basis: `${n(womenWide)} phụ nữ 25–64 × ${affordable.pct}% hộ gia đình có thu nhập từ $${n(line)}/năm (bảng B19001). Đây là PHÉP NHÂN hai tỷ lệ, không phải một con số đếm được — coi là ước lượng quy mô, không phải danh sách người.`,
      why: 'Tệp hẹp hơn và chịu giá tốt hơn. Chỉ đáng chạy khi tiệm có dịch vụ cao cấp thật để bán cho họ; nếu menu chỉ có dịch vụ cơ bản thì thu hẹp kiểu này chỉ làm giá thầu đắt lên mà không bán được gì hơn.',
      targeting: [
        `Meta: Nữ 25–64, bán kính ${radius} dặm, chồng thêm tiêu chí thu nhập hộ gia đình nếu nền tảng còn cho phép ở khu vực này.`,
        'Nếu không chồng được thu nhập: nhắm theo mã ZIP có thu nhập cao nhất trong danh sách thay vì theo cả vùng.',
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
  const reasoning: string[] = [];
  reasoning.push(`Quanh ${where} có ${n(adults)} người trưởng thành trong các ZIP của tiệm.`);
  if (primary) {
    reasoning.push(`Tệp mục tiêu: ${primary.label} — ${n(primary.size)} người. ${primary.basis}`);
  }
  if (affordable) {
    reasoning.push(
      `${affordable.pct}% hộ gia đình ở đây có thu nhập từ $${n(affordable.usd)}/năm trở lên (${n(affordable.households)} hộ). `
      + (i.firstVisitTicketCents
        ? `Hoá đơn lần đầu của tiệm là ${i.money(i.firstVisitTicketCents)} — ${affordable.pct >= 50
          ? 'thấp so với sức chi của vùng, nên dư địa nằm ở bán thêm dịch vụ cao cấp chứ không phải ở giảm giá.'
          : 'phù hợp với sức chi của vùng; giữ giá và cạnh tranh bằng chỗ trống đúng giờ khách cần.'}`
        : 'Chưa đủ lịch hẹn để biết hoá đơn lần đầu của tiệm, nên chưa đối chiếu được giá với sức chi của vùng.'),
    );
  }
  if (capacity !== null && primary && penetrationPct !== null) {
    const v = penetrationVerdict;
    reasoning.push(
      `Tiệm còn chỗ cho ${capacity} lượt khách mới trong ${i.campaignDays} ngày. Lấp hết chỗ đó cần ${penetrationPct}% của tệp mục tiêu. `
      + (v === 'easy'
        ? 'Dưới nửa phần trăm — thị trường thừa sức nuôi số chỗ trống này, nút thắt là ở chỗ tiếp cận chứ không phải ở quy mô thị trường.'
        : v === 'realistic'
          ? 'Trong tầm với của một chiến dịch địa phương chạy đều.'
          : v === 'stretch'
            ? 'Cao. Đạt được nhưng cần nội dung tốt và giá thầu cạnh tranh; đừng kỳ vọng lấp hết trong hai tuần đầu.'
            : 'Quá cao để mua bằng quảng cáo. Chỗ trống nhiều hơn thứ tệp này nuôi nổi — mở rộng bán kính, thêm dịch vụ, hoặc lấp bằng khách cũ trước khi chi tiền cho người lạ.'),
    );
  }
  if (maxSpendCents && i.cpaCeilingCents) {
    reasoning.push(
      `Trần chi cho ${i.campaignDays} ngày: ${i.money(maxSpendCents)} — bằng ${capacity} chỗ trống × ${i.money(i.cpaCeilingCents)} lãi gộp mỗi khách mới. `
      + 'Chi hơn mức đó không thể hoàn vốn dù mọi đồng đều ra khách, vì không còn ghế để ngồi. Đây là TRẦN, không phải mức đề xuất: bắt đầu nhỏ để đo giá mỗi booking thật, rồi tăng dần về phía trần khi con số đó nằm dưới ngưỡng.',
    );
  } else if (!i.cpaCeilingCents) {
    reasoning.push('Chưa có biên lãi nên chưa tính được trần chi. Thị trường nói được nhắm vào ai; chỉ số liệu của chính tiệm mới nói được trả bao nhiêu là còn lãi.');
  }

  return {
    adults, segments, primary, affordable, capacity,
    penetrationPct, penetrationVerdict, maxSpendCents, reasoning, limits,
  };
}
