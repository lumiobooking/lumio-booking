/**
 * How each channel is actually performing, and what to do about it per platform.
 *
 * WHAT WAS MISSING
 *
 * The engine picked ONE platform and sized ONE budget. That answers "where do I
 * start" and nothing else. The questions an owner actually has are per channel:
 * is Google working for me? is Facebook worth anything? how much on each, run
 * it how, and how will I know it worked? None of that was on the screen.
 *
 * THE MEASUREMENT THAT MATTERS, AND IT IS NOT BOOKING COUNT
 *
 * A channel's booking count says how busy it is, not whether it is worth money.
 * Two channels with forty bookings each can be opposite things:
 *
 *   - forty bookings from thirty-one people who had never been here before,
 *     eighteen of whom came back → this channel BUILDS the customer base;
 *   - forty bookings from nine regulars rebooking → this channel is a
 *     convenience for people the salon already had. Advertising on it buys
 *     customers who were coming anyway, and those bookings will appear in the
 *     campaign report and make it look like a triumph.
 *
 * Both facts are computable from the salon's own book: whether a booking was a
 * customer's first ever visit, and how many times that customer has been since.
 * So every channel here is judged on ACQUISITION and RETENTION, with the raw
 * counts printed next to the verdict.
 *
 * WHAT THIS STILL REFUSES TO DO
 *
 * No channel here has a cost attached, because the salon is not running ads yet
 * — so there is no return-on-ad-spend to compute and none is shown. What
 * replaces it is the per-platform ceiling: at the ticket THIS channel actually
 * produces and the salon's margin, the most a booking may cost there. That is
 * checkable on day three of a live campaign, which a forecast never is.
 */

import {
  type BookingChannel, type AdPlatform,
  CHANNEL_VI, PLATFORM_VI, PLATFORM_OF, channelCoverage,
} from '../common/booking-channel';

/** One booking, reduced to the facts a channel verdict rests on. */
export interface ChannelBooking {
  channel: BookingChannel;
  /** Appointment start, epoch ms. */
  at: number;
  priceCents: number;
  customerId: string | null;
  /** True when this was that customer's first ever visit here. */
  isFirstVisit: boolean;
  /** Total visits that customer has made, ever. */
  customerVisits: number;
}

export type ChannelVerdict = 'builds' | 'convenience' | 'fading' | 'weak' | 'unproven';

export interface ChannelReport {
  channel: BookingChannel;
  label: string;
  platform: AdPlatform;
  bookings: number;
  sharePct: number;
  revenueCents: number;
  avgTicketCents: number;
  /** Customers whose FIRST ever visit arrived through this channel. */
  acquired: number;
  /** Of those, the share who came back at least once. Null when too few. */
  repeatPct: number | null;
  /** Average lifetime visits of the customers it acquired. Null when too few. */
  visitsPerAcquired: number | null;
  /** What one acquired customer has been worth so far, at this channel's ticket. */
  valuePerAcquiredCents: number | null;
  last90: number;
  prior90: number;
  trend: 'up' | 'flat' | 'down' | 'unknown';
  verdict: ChannelVerdict;
  /** The verdict in the salon's language, with its numbers in it. */
  says: string;
}

/** Below this a channel gets no verdict — the numbers would be noise. */
const READABLE = 5;
/** Below this an acquisition/retention rate is not worth a percentage. */
const RATE_FLOOR = 5;

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export function channelReports(bookings: ChannelBooking[], now: number): {
  reports: ChannelReport[];
  coverage: { total: number; attributed: number; pct: number; unknown: number };
  /** Said out loud whenever attribution is thin enough to mislead. */
  caveat: string | null;
} {
  const rows = bookings ?? [];
  const coverage = channelCoverage(rows.map((r) => r.channel));
  const total = rows.length;
  const cut90 = now - 90 * 86_400_000;
  const cut180 = now - 180 * 86_400_000;

  const byChannel = new Map<BookingChannel, ChannelBooking[]>();
  for (const r of rows) byChannel.set(r.channel, [...(byChannel.get(r.channel) ?? []), r]);

  // The salon's own baseline: the share of ALL its customers who ever came back.
  // A channel is only "below average" against the business it is part of —
  // comparing a nail salon's retention to an industry figure would be comparing
  // it to a number from somewhere else.
  const acquiredAll = rows.filter((r) => r.isFirstVisit);
  const baseRepeat = acquiredAll.length >= RATE_FLOOR
    ? pct(acquiredAll.filter((r) => r.customerVisits >= 2).length, acquiredAll.length)
    : null;

  const reports: ChannelReport[] = [];
  for (const [channel, list] of byChannel) {
    const revenue = list.reduce((s, r) => s + (r.priceCents || 0), 0);
    const avgTicket = list.length ? Math.round(revenue / list.length) : 0;
    const acq = list.filter((r) => r.isFirstVisit);
    const repeatPct = acq.length >= RATE_FLOOR
      ? pct(acq.filter((r) => r.customerVisits >= 2).length, acq.length)
      : null;
    const visitsPer = acq.length >= RATE_FLOOR
      ? Math.round((acq.reduce((s, r) => s + Math.max(1, r.customerVisits), 0) / acq.length) * 10) / 10
      : null;
    const last90 = list.filter((r) => r.at >= cut90).length;
    const prior90 = list.filter((r) => r.at >= cut180 && r.at < cut90).length;

    // A trend needs something to compare against. Two bookings becoming one is
    // not a decline, it is two bookings.
    const trend: ChannelReport['trend'] = last90 + prior90 < 8 ? 'unknown'
      : last90 > prior90 * 1.25 ? 'up'
        : last90 < prior90 * 0.75 ? 'down' : 'flat';

    const acqRate = pct(acq.length, list.length);
    let verdict: ChannelVerdict = 'unproven';
    if (list.length >= READABLE) {
      if (trend === 'down') verdict = 'fading';
      else if (acqRate >= 40 && (repeatPct === null || baseRepeat === null || repeatPct >= baseRepeat)) verdict = 'builds';
      else if (acqRate < 20) verdict = 'convenience';
      else if (repeatPct !== null && baseRepeat !== null && repeatPct < baseRepeat) verdict = 'weak';
      else verdict = 'builds';
    }

    reports.push({
      channel, label: CHANNEL_VI[channel], platform: PLATFORM_OF[channel],
      bookings: list.length, sharePct: pct(list.length, total),
      revenueCents: revenue, avgTicketCents: avgTicket,
      acquired: acq.length, repeatPct, visitsPerAcquired: visitsPer,
      valuePerAcquiredCents: visitsPer ? Math.round(avgTicket * visitsPer) : null,
      last90, prior90, trend,
      verdict,
      says: saysFor({ channel, list: list.length, acq: acq.length, acqRate, repeatPct, baseRepeat, trend, verdict, last90, prior90 }),
    });
  }

  reports.sort((a, b) => b.bookings - a.bookings);

  const caveat = coverage.total === 0
    ? 'Chưa có lịch hẹn nào để đọc nguồn khách.'
    : coverage.pct < 60
      ? `${coverage.unknown}/${coverage.total} booking (${100 - coverage.pct}%) không ghi nhận được nguồn. Tỷ lệ bên dưới chỉ đúng trên phần đo được — đừng đọc như bức tranh toàn bộ. Cách sửa: gắn UTM vào mọi link đặt lịch chia sẻ trên Facebook/Google, và hỏi khách vãng lai "anh/chị biết tiệm từ đâu" rồi chọn nguồn khi tạo lịch.`
      : null;

  return { reports, coverage, caveat };
}

function saysFor(i: {
  channel: BookingChannel; list: number; acq: number; acqRate: number;
  repeatPct: number | null; baseRepeat: number | null;
  trend: ChannelReport['trend']; verdict: ChannelVerdict; last90: number; prior90: number;
}): string {
  const name = CHANNEL_VI[i.channel];
  if (i.verdict === 'unproven') {
    return `${i.list} booking — chưa đủ để kết luận. Dưới ${READABLE} booking thì mọi tỷ lệ rút ra đều là nhiễu.`;
  }
  const acqLine = `${i.acq}/${i.list} booking là khách LẦN ĐẦU (${i.acqRate}%)`;
  const repLine = i.repeatPct !== null
    ? `, ${i.repeatPct}% trong số đó quay lại${i.baseRepeat !== null ? ` (trung bình cả tiệm ${i.baseRepeat}%)` : ''}`
    : '';
  switch (i.verdict) {
    case 'builds':
      return `${acqLine}${repLine}. ${name} đang MANG KHÁCH MỚI về và giữ được họ — đây là kênh đáng bỏ tiền vào.`;
    case 'convenience':
      return `${acqLine}${repLine}. Phần lớn là khách CŨ đặt lại: ${name} đang là chỗ đặt lịch tiện tay chứ không phải nơi tìm ra tiệm. Chạy quảng cáo ở đây phần nhiều là trả tiền cho người vốn đã tới.`;
    case 'fading':
      return `Giảm rõ: ${i.prior90} booking ở 90 ngày trước, còn ${i.last90} ở 90 ngày gần đây. Tìm nguyên nhân trước khi bỏ tiền — quảng cáo đổ vào một kênh đang tụt thường chỉ che chỗ hỏng.`;
    case 'weak':
      return `${acqLine}${repLine}. Khách từ ${name} quay lại ÍT hơn mặt bằng của tiệm, nên mỗi khách ở đây đáng giá thấp hơn — nếu chạy thì ngưỡng chi phải thấp hơn.`;
    default:
      return `${i.list} booking.`;
  }
}

// ---- from measurement to a plan, per platform -------------------------------

export interface PlatformPlan {
  platform: AdPlatform;
  label: string;
  /** Rank: 1 is where to start. */
  rank: number;
  status: 'spend' | 'later' | 'hold' | 'unproven';
  /** The measured evidence this rests on. */
  evidence: string;
  /** Most a booking may cost HERE, from this platform's own ticket. */
  ceilingCents: number | null;
  dailyCents: number | null;
  days: number;
  totalCents: number | null;
  bookingsToBreakEven: number | null;
  /** Concrete setup, in this platform's own controls. */
  how: string[];
  /** The stop rule, in numbers. */
  watch: string;
}

export interface PlanContext {
  grossMarginPct: number | null;
  /** What a genuinely new customer pays on the first visit. */
  firstVisitTicketCents: number | null;
  /** Appointments that would fit in the quiet blocks over the window. */
  openSlots: number | null;
  runDayLabels: string[];
  pauseDayLabels: string[];
  quietLabels: string[];
  leadDays: number | null;
  topServiceName: string | null;
  city: string | null;
  region: string | null;
  lapsedCount: number;
  customerCount: number;
  /** Google reviews on file — a paid click lands on this. */
  reviewCount?: number | null;
  market?: string | null;
  money: (cents: number) => string;
}

/**
 * The smallest number of conversions a cost-per-booking can be read from.
 *
 * With n conversions the relative error on the measured CPA is roughly 1/√n:
 * eight gives about ±35%, which is loose but enough to separate "well under the
 * ceiling" from "well over it" — the only question the first campaign has to
 * answer. Fewer than that and the number swings so far that acting on it is
 * acting on chance. This is a statistics fact, not a figure about this salon,
 * and it is the reason the budget is what it is rather than a round number
 * someone liked.
 */
export const MEASURABLE_CONVERSIONS = 8;
/** How long a first campaign runs. Exported so the capacity check uses the
 *  same window the budget does — comparing a fortnight of spend against a
 *  month of empty chairs is how "feasible" stops meaning anything. */
export const CAMPAIGN_DAYS = 14;
const WINDOW_DAYS = CAMPAIGN_DAYS;

/**
 * Size a platform's first campaign from the ceiling, not from a habit.
 *
 * The old code used $15/day for every business on the platform. For a nail
 * salon that happens to look about right, which is why nobody noticed; for a
 * business with a $500 ticket it is a rounding error that can never buy enough
 * conversions to measure anything, and for a $12 ticket it is too much.
 */
export function sizeCampaign(ceilingCents: number | null, openSlots: number | null): {
  target: number | null; dailyCents: number | null; totalCents: number | null; days: number; note: string;
} {
  if (!ceilingCents || ceilingCents <= 0) {
    return {
      target: null, dailyCents: null, totalCents: null, days: WINDOW_DAYS,
      note: 'Chưa có ngưỡng chi cho mỗi khách nên chưa tính được ngân sách. Không phải "chi ít cho chắc" — mà là chưa có cách nào biết ít hay nhiều.',
    };
  }
  const room = openSlots === null ? MEASURABLE_CONVERSIONS : Math.min(MEASURABLE_CONVERSIONS, openSlots);
  if (room < 3) {
    return {
      target: room, dailyCents: null, totalCents: null, days: WINDOW_DAYS,
      note: `Khung giờ trống chỉ chứa thêm ${openSlots} lượt trong 2 tuần. Một chiến dịch không đủ chỗ để tạo ra ${MEASURABLE_CONVERSIONS} booking thì cũng không đo được chi phí mỗi booking — mở thêm giờ hoặc lấp chỗ trống bằng khách cũ trước, đừng bật quảng cáo.`,
    };
  }
  const total = ceilingCents * room;
  // Rounded DOWN, so the campaign total never exceeds room × ceiling. Rounding
  // up puts the spend a few cents above the break-even target and turns the
  // headline "8 bookings to break even" into 9 — a number nobody can trace.
  const daily = Math.max(1, Math.floor(total / WINDOW_DAYS));
  return {
    target: room, dailyCents: daily, totalCents: daily * WINDOW_DAYS, days: WINDOW_DAYS,
    note: room < MEASURABLE_CONVERSIONS
      ? `Ngân sách đặt bằng ${room} booking × ngưỡng chi mỗi booking — giới hạn bởi số chỗ trống chứ không phải bởi túi tiền.`
      : `Ngân sách đặt bằng ${MEASURABLE_CONVERSIONS} booking × ngưỡng chi mỗi booking. ${MEASURABLE_CONVERSIONS} là số lượt tối thiểu để con số "mỗi booking tốn bao nhiêu" đọc được; ít hơn thì sai số lớn hơn cả điều cần biết.`,
  };
}

export function platformPlans(reports: ChannelReport[], ctx: PlanContext): PlatformPlan[] {
  const m = ctx.grossMarginPct && ctx.grossMarginPct > 0 && ctx.grossMarginPct < 100 ? ctx.grossMarginPct : null;
  const buyable: AdPlatform[] = ctx.market === 'VN' ? ['meta', 'zalo', 'google'] : ['google', 'meta'];

  const scored = buyable.map((platform) => {
    const mine = reports.filter((r) => r.platform === platform);
    const bookings = mine.reduce((s, r) => s + r.bookings, 0);
    const acquired = mine.reduce((s, r) => s + r.acquired, 0);
    const revenue = mine.reduce((s, r) => s + r.revenueCents, 0);

    // The ticket THIS platform produces, when it has produced enough to say.
    // Falling back to the salon-wide first-visit ticket is right: a platform
    // with no history is not a platform with a $0 ticket.
    const platTicket = bookings >= READABLE && revenue > 0 ? Math.round(revenue / bookings) : null;
    const ticket = platTicket ?? ctx.firstVisitTicketCents;
    const ceiling = m && ticket ? Math.round((ticket * m) / 100) : null;

    const builds = mine.some((r) => r.verdict === 'builds');
    const fading = mine.some((r) => r.verdict === 'fading');
    const convenience = mine.length > 0 && mine.every((r) => r.verdict === 'convenience');

    const status: PlatformPlan['status'] = bookings < READABLE ? 'unproven'
      : builds ? 'spend' : convenience ? 'hold' : fading ? 'hold' : 'later';

    // Ranked by what the book shows, not by what the platforms advertise:
    // a channel proven to bring new customers first, an unproven one before one
    // proven to bring back the customers we already had.
    const rankScore = status === 'spend' ? 0 + (1000 - acquired) / 10_000
      : status === 'later' ? 1
        : status === 'unproven' ? 2 : 3;

    return { platform, mine, bookings, acquired, ticket, platTicket, ceiling, status, rankScore };
  });

  scored.sort((a, b) => a.rankScore - b.rankScore);

  return scored.map((s, i) => {
    const size = sizeCampaign(s.ceiling, ctx.openSlots);
    const spendNow = i === 0 && s.status !== 'hold';
    return {
      platform: s.platform,
      label: PLATFORM_VI[s.platform],
      rank: i + 1,
      status: s.status,
      evidence: evidenceFor(s, ctx),
      ceilingCents: s.ceiling,
      dailyCents: spendNow ? size.dailyCents : null,
      days: size.days,
      totalCents: spendNow ? size.totalCents : null,
      bookingsToBreakEven: spendNow ? size.target : null,
      how: spendNow ? howFor(s.platform, ctx) : [waitReason(s.status, i, s.platform)],
      watch: s.ceiling
        ? `Ngày thứ 3 và ngày thứ 7: lấy tiền đã chi chia cho số booking mà quảng cáo mang về. Dưới ${ctx.money(s.ceiling)}/booking là đang lãi — tăng dần. Trên ${ctx.money(s.ceiling)} là đang lỗ — tắt, đừng chờ hết chiến dịch. ${size.note}`
        : size.note,
    };
  });
}

function evidenceFor(
  s: { platform: AdPlatform; mine: ChannelReport[]; bookings: number; acquired: number; platTicket: number | null },
  ctx: PlanContext,
): string {
  if (!s.mine.length || s.bookings === 0) {
    // The reason search goes first with no history at all. Someone typing
    // "nail salon near me" wants one now; someone scrolling a feed did not ask.
    // Intent is the cheapest thing a local business can buy, and it is also the
    // cleanest to measure — which is what a first campaign is for.
    const why = s.platform === 'google'
      ? ' Chưa có lịch sử thì bắt đầu ở tìm kiếm: người gõ "tiệm nail gần đây" đang cần làm ngay, còn người lướt bảng tin thì chưa hỏi gì cả. Ý định là thứ rẻ nhất một tiệm địa phương mua được, và cũng là thứ đo sạch nhất.'
      : '';
    return `Chưa có booking nào ghi nhận từ ${PLATFORM_VI[s.platform]}. Chưa có bằng chứng kênh này chạy được ở tiệm — nếu chạy thì chạy như một PHÉP THỬ: ngân sách nhỏ, đọc kết quả rồi mới tăng.${why}`;
  }
  const parts = s.mine.map((r) => `${r.label}: ${r.bookings} booking, ${r.acquired} khách lần đầu`);
  const ticket = s.platTicket ? ` Hoá đơn trung bình đến từ kênh này: ${ctx.money(s.platTicket)}.` : '';
  return `${parts.join(' · ')}.${ticket}`;
}

function waitReason(status: PlatformPlan['status'], rank: number, platform: AdPlatform): string {
  if (status === 'hold') {
    return `Chưa chạy ở ${PLATFORM_VI[platform]}: số liệu cho thấy kênh này chủ yếu phục vụ khách cũ đặt lại, hoặc đang đi xuống. Trả tiền để tiếp cận người vốn đã quay lại là mua lại chính khách của mình — và những booking đó vẫn hiện trong báo cáo chiến dịch, làm nó trông hiệu quả.`;
  }
  if (rank > 0) {
    return 'Chưa chạy song song. Bật hai kênh cùng lúc ở lần đầu thì khi kết quả tốt (hoặc xấu) sẽ không biết kênh nào tạo ra nó — chờ có con số chi phí mỗi booking ở kênh thứ nhất rồi mới mở kênh này.';
  }
  return 'Chưa đủ dữ liệu để nói kênh này chạy được hay không ở tiệm.';
}

function howFor(platform: AdPlatform, ctx: PlanContext): string[] {
  const where = ctx.city && ctx.region ? `${ctx.city}, ${ctx.region}` : ctx.region || 'quanh tiệm';
  const svc = ctx.topServiceName;
  const run = ctx.runDayLabels.length ? ctx.runDayLabels.join(', ') : null;
  const pause = ctx.pauseDayLabels.length ? ctx.pauseDayLabels.join(', ') : null;
  const quiet = ctx.quietLabels[0] ?? null;
  const lead = ctx.leadDays;

  const timing = run
    ? `Lịch chạy: BẬT ${run}${pause ? `, TẮT ${pause}` : ''}.${lead !== null ? ` Khách của tiệm đặt trước trung bình ${lead} ngày, nên quảng cáo phải ra trước khung trống đúng ${lead} ngày — chạy đúng hôm đó là muộn.` : ''}`
    : 'Lịch chạy: chưa đủ lịch hẹn để biết khách đặt trước bao nhiêu ngày — chạy đều 7 ngày ở tuần đầu rồi cắt theo kết quả.';

  const exclude = ctx.customerCount > 0
    ? 'Loại trừ (Exclude) danh sách khách quen ở mọi chiến dịch. Không làm bước này thì tiền sẽ chảy vào những người tuần sau vẫn tới.'
    : '';

  if (platform === 'google') {
    return [
      ctx.reviewCount !== null && ctx.reviewCount !== undefined && ctx.reviewCount < 20
        ? `Trước khi trả tiền: hồ sơ Google Business mới có ${ctx.reviewCount} đánh giá. Quảng cáo đưa người tới xem hồ sơ đó — đổ tiền vào một hồ sơ mỏng là đổ qua lỗ thủng. Xin đánh giá cho đủ 20+ trước.`
        : 'Trước khi trả tiền: hồ sơ Google Business phải đủ ảnh, giờ mở cửa, bảng giá và trả lời đánh giá — quảng cáo chỉ đưa người tới đó, phần chốt là hồ sơ.',
      `Loại chiến dịch: Search + hiển thị trên Maps. KHÔNG bật Display, KHÔNG bật Performance Max ở lần đầu — cả hai đều tiêu tiền ở chỗ không đọc được.`,
      svc ? `Từ khoá: bắt đầu từ chính dịch vụ bán chạy nhất — "${svc}" kèm tên khu vực. Từ chung chung đắt hơn và mang về người ở xa.`
        : 'Từ khoá: tên dịch vụ + tên khu vực. Từ chung chung đắt hơn và mang về người ở xa.',
      `Khu vực: bán kính 3-5 dặm quanh ${where}, đặt ở chế độ "người đang ở trong khu vực này" chứ không phải "người quan tâm tới khu vực này".`,
      quiet ? `Đặt giá thầu cao hơn vào đúng khung đang trống (${quiet}) và thấp hơn ở khung đã đông.` : 'Đặt giá thầu cao hơn ở khung giờ đang trống.',
      timing,
      exclude,
    ].filter(Boolean);
  }

  if (platform === 'meta') {
    return [
      ctx.lapsedCount >= 20
        ? `Tệp đầu tiên, rẻ nhất: ${ctx.lapsedCount} khách cũ lâu chưa quay lại — tải danh sách lên làm Custom Audience. Họ biết tiệm, biết đường, đã từng trả tiền.`
        : 'Tệp đầu tiên: người đã nhắn tin hoặc xem trang mà chưa đặt lịch (retarget 30 ngày). Rẻ hơn nhiều so với người lạ.',
      'Mục tiêu chiến dịch: tin nhắn (Messages) hoặc lượt đặt lịch — KHÔNG chọn "tương tác" hay "lượt xem video". Lượt thích không đặt lịch.',
      'Nội dung quảng cáo: dùng chính clip/ảnh đang có lượt xem cao nhất trên trang, đừng dựng cái mới. Thứ đã được người thật xem hết là thứ đã qua kiểm chứng.',
      `Khu vực: bán kính 3-5 dặm quanh ${where}. Bán kính rộng chỉ tốn tiền cho người sẽ không bao giờ lái xe tới.`,
      timing,
      exclude,
    ].filter(Boolean);
  }

  if (platform === 'zalo') {
    return [
      'Zalo OA: đẩy bài tới người theo dõi trước khi mua quảng cáo — tệp có sẵn luôn rẻ hơn.',
      `Khu vực: giới hạn quanh ${where}.`,
      timing,
      exclude,
    ].filter(Boolean);
  }

  return [timing];
}
