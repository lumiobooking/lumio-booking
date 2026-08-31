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
import { money0, share, type PlainStep } from './plain';

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
  /** The argument, in order: what it is, what to do, and why if asked. */
  steps: PlainStep[];
  /** Flattened one-liners, for the prompt and for anything that wants text. */
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
      steps: [{
        key: 'market', icon: '📍',
        title: 'Chưa có số liệu khu vực',
        line: 'Hệ thống đang lấy dân số quanh tiệm, chạy nền mỗi giờ.',
        action: null,
        why: a.notes.join(' ') || 'Chưa lấy được dữ liệu từ Cục Thống kê Mỹ.',
      }],
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
  //
  // Three layers per block, and the order is the point: what it IS, then what
  // to DO, then — only if asked — how it was worked out. The old version put
  // the derivation in the same sentence as the finding, so every line carried
  // its own methodology and an owner had to read a paragraph to learn one
  // thing. They are not marketing people; they have a shop to run.
  const steps: PlainStep[] = [];

  steps.push({
    key: 'market', icon: '📍',
    title: 'Khu vực quanh tiệm',
    line: `${n(adults)} người trưởng thành sống trong các mã ZIP của tiệm.`,
    action: null,
    why: `Đếm từ điều tra dân số Mỹ (ACS 5 năm${a.year ? ` ${a.year}` : ''}), bảng B01001, cộng theo các ZIP của tiệm. Đây là số người thật đang sống ở đó, không phải số khách của tiệm.`,
  });

  if (primary) {
    steps.push({
      key: 'target', icon: '🎯',
      title: 'Nên nhắm vào ai',
      line: `${primary.label} — ${n(primary.size)} người.`,
      action: `Đặt đúng tệp này trong trình quản lý quảng cáo: ${primary.targeting[0]}`,
      why: `${primary.basis} ${primary.why}`,
    });
  }

  if (affordable) {
    const rich = affordable.pct >= 50;
    steps.push({
      key: 'price', icon: '💵',
      title: 'Giá của tiệm so với vùng',
      line: i.firstVisitTicketCents
        ? `${affordable.pct}% hộ ở đây thu nhập trên $${n(affordable.usd)}/năm. Khách mới của tiệm trả trung bình ${money0(i.firstVisitTicketCents, i.money)}.`
        : `${affordable.pct}% hộ ở đây thu nhập trên $${n(affordable.usd)}/năm.`,
      action: !i.firstVisitTicketCents
        ? null
        : rich
          ? 'Đừng giảm giá. Thêm một dịch vụ cao cấp vào menu và mời khách nâng cấp — vùng này trả nổi.'
          : 'Giữ nguyên giá. Cạnh tranh bằng việc có chỗ trống đúng giờ khách cần, không bằng giá rẻ hơn.',
      why: `Số hộ theo mức thu nhập lấy từ bảng B19001 của điều tra dân số (${n(affordable.households)} hộ). `
        + (i.firstVisitTicketCents
          ? 'Hoá đơn khách mới lấy từ lần đầu tiên của mỗi khách trong sổ của tiệm. Vùng chi mạnh mà giá tiệm thấp nghĩa là dư địa nằm ở bán thêm, không phải ở giảm giá.'
          : 'Chưa đủ lịch hẹn để biết khách mới trả bao nhiêu, nên chưa so được với sức chi của vùng.'),
    });
  }

  if (capacity !== null && primary) {
    const v = penetrationVerdict;
    steps.push({
      key: 'capacity', icon: '🪑',
      title: 'Tiệm nhận thêm được bao nhiêu khách',
      line: `Còn chỗ cho ${capacity} khách mới trong ${i.campaignDays} ngày — cần ${share(capacity, primary.size)}.`,
      action: v === 'impossible'
        ? 'Chưa chạy quảng cáo. Mời khách cũ quay lại trước — rẻ hơn nhiều và lấp được chỗ trống này.'
        : v === 'stretch'
          ? 'Chạy được, nhưng đừng kỳ vọng lấp hết trong hai tuần đầu.'
          : 'Con số này nằm trong tầm với — vấn đề là tiếp cận đúng người, không phải thiếu người.',
      why: v === 'impossible'
        ? 'Số chỗ trống nhiều hơn thứ tệp này nuôi nổi. Muốn lấp hết thì phải mở rộng bán kính hoặc thêm dịch vụ, chứ không phải chi thêm tiền.'
        : 'Chỗ trống đếm từ các khung giờ vắng nhất của tiệm trong 4 tuần qua, quy đổi theo thời lượng dịch vụ trung bình và tính cho đúng 2 tuần chiến dịch.',
    });
  }

  if (maxSpendCents && i.cpaCeilingCents) {
    steps.push({
      key: 'budget', icon: '💰',
      title: `Tối đa nên chi trong ${i.campaignDays} ngày`,
      line: `${money0(maxSpendCents, i.money)} — và chỉ khi mỗi khách mới tốn dưới ${money0(i.cpaCeilingCents, i.money)}.`,
      action: `Bắt đầu nhỏ. Sau 3 ngày, lấy tiền đã chi chia cho số khách mới: dưới ${money0(i.cpaCeilingCents, i.money)} thì tăng dần, trên thì tắt.`,
      why: `${capacity} chỗ trống × ${money0(i.cpaCeilingCents, i.money)} tiền lãi mỗi khách mới = ${money0(maxSpendCents, i.money)}. `
        + 'Chi hơn mức đó thì dù mọi đồng đều ra khách vẫn không hoàn vốn, vì không còn ghế trống để ngồi. '
        + 'Tiền lãi mỗi khách = hoá đơn lần đầu trừ phần trả cho thợ.',
    });
  } else if (!i.cpaCeilingCents) {
    steps.push({
      key: 'budget', icon: '💰',
      title: 'Chưa tính được nên chi bao nhiêu',
      line: 'Còn thiếu tỷ lệ ăn chia với thợ.',
      action: 'Điền tỷ lệ ăn chia trong hồ sơ từng thợ (Nhân sự → sửa thợ). Xong là có ngay con số nên chi.',
      why: 'Dân số nói được nhắm vào ai, nhưng không nói được tiệm trả bao nhiêu một khách thì còn lãi. Chỉ số liệu của chính tiệm mới trả lời được, và tỷ lệ ăn chia là mảnh còn thiếu.',
    });
  }

  const reasoning = steps.map((st) => `${st.line}${st.action ? ` → ${st.action}` : ''}`);

  return {
    adults, segments, primary, affordable, capacity,
    penetrationPct, penetrationVerdict, maxSpendCents, steps, reasoning, limits,
  };
}
