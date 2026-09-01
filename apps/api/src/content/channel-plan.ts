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
import { bi, viOf, enOf, type Txt } from './i18n';

/**
 * The English half of the channel and platform names.
 *
 * It lives here rather than beside CHANNEL_VI because common/booking-channel.ts
 * is shared with the parts of the API that have no screen at all — the door a
 * booking came through is a key, and only this file turns those keys into
 * something a person reads.
 */
const CHANNEL_EN: Record<BookingChannel, string> = {
  gmap: 'Google Maps / Search',
  facebook: 'Facebook',
  instagram: 'Instagram',
  messenger: 'Messenger',
  zalo: 'Zalo',
  hotline: 'Phone calls',
  website: 'Shop website',
  lumiolink: 'Lumio booking link',
  walkin: 'Walk-ins',
  staff: 'Booked by staff in the shop',
  online: 'Booked online (source unknown)',
};

const PLATFORM_EN: Record<AdPlatform, string> = {
  google: 'Google (Search + Maps)',
  meta: 'Meta (Facebook + Instagram)',
  zalo: 'Zalo',
  owned: "The shop's own channels (website, booking link)",
  offline: 'Offline (walk-ins, phone, front desk)',
};

const channelLabel = (c: BookingChannel): Txt => bi(CHANNEL_VI[c], CHANNEL_EN[c]);
const platformLabel = (p: AdPlatform): Txt => bi(PLATFORM_VI[p], PLATFORM_EN[p]);

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
  label: Txt;
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
  says: Txt;
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
  caveat: Txt | null;
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
      channel, label: channelLabel(channel), platform: PLATFORM_OF[channel],
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

  const caveat: Txt | null = coverage.total === 0
    ? bi(
      'Chưa có lịch hẹn nào để đọc nguồn khách.',
      'There are no appointments yet to read a customer source from.')
    : coverage.pct < 60
      ? bi(
        `${coverage.unknown}/${coverage.total} booking (${100 - coverage.pct}%) không ghi nhận được nguồn. Tỷ lệ bên dưới chỉ đúng trên phần đo được — đừng đọc như bức tranh toàn bộ. Cách sửa: gắn UTM vào mọi link đặt lịch chia sẻ trên Facebook/Google, và hỏi khách vãng lai "anh/chị biết tiệm từ đâu" rồi chọn nguồn khi tạo lịch.`,
        `${coverage.unknown} of ${coverage.total} bookings (${100 - coverage.pct}%) carry no source at all. The rates below hold only for the part that could be measured — do not read them as the whole picture. The fix: put UTMs on every booking link you share on Facebook or Google, and ask a walk-in "how did you hear about us" and pick the source when you write the appointment.`)
      : null;

  return { reports, coverage, caveat };
}

function saysFor(i: {
  channel: BookingChannel; list: number; acq: number; acqRate: number;
  repeatPct: number | null; baseRepeat: number | null;
  trend: ChannelReport['trend']; verdict: ChannelVerdict; last90: number; prior90: number;
}): Txt {
  const nameVi = CHANNEL_VI[i.channel];
  const nameEn = CHANNEL_EN[i.channel];
  if (i.verdict === 'unproven') {
    return bi(
      `${i.list} booking — chưa đủ để kết luận. Dưới ${READABLE} booking thì mọi tỷ lệ rút ra đều là nhiễu.`,
      `${i.list} bookings — not enough to call it. Under ${READABLE} bookings every rate you pull out of them is noise.`);
  }
  // Counts and percentages in one clause, so the lead-in is built separately in
  // each language rather than translated word for word.
  const acqVi = `${i.acq}/${i.list} booking là khách LẦN ĐẦU (${i.acqRate}%)`;
  const acqEn = `${i.acq} of ${i.list} bookings were FIRST-TIME customers (${i.acqRate}%)`;
  const repVi = i.repeatPct !== null
    ? `, ${i.repeatPct}% trong số đó quay lại${i.baseRepeat !== null ? ` (trung bình cả tiệm ${i.baseRepeat}%)` : ''}`
    : '';
  const repEn = i.repeatPct !== null
    ? `, and ${i.repeatPct}% of them came back${i.baseRepeat !== null ? ` (${i.baseRepeat}% across the whole shop)` : ''}`
    : '';
  switch (i.verdict) {
    case 'builds':
      return bi(
        `${acqVi}${repVi}. ${nameVi} đang MANG KHÁCH MỚI về và giữ được họ — đây là kênh đáng bỏ tiền vào.`,
        `${acqEn}${repEn}. ${nameEn} is BRINGING NEW CUSTOMERS in and keeping them — this is the one worth putting money behind.`);
    case 'convenience':
      return bi(
        `${acqVi}${repVi}. Phần lớn là khách CŨ đặt lại: ${nameVi} đang là chỗ đặt lịch tiện tay chứ không phải nơi tìm ra tiệm. Chạy quảng cáo ở đây phần nhiều là trả tiền cho người vốn đã tới.`,
        `${acqEn}${repEn}. Most of it is EXISTING customers rebooking: ${nameEn} is a handy place to book, not the place people find you. Advertising here is mostly paying for people who were coming in anyway.`);
    case 'fading':
      return bi(
        `Giảm rõ: ${i.prior90} booking ở 90 ngày trước, còn ${i.last90} ở 90 ngày gần đây. Tìm nguyên nhân trước khi bỏ tiền — quảng cáo đổ vào một kênh đang tụt thường chỉ che chỗ hỏng.`,
        `Clearly down: ${i.prior90} bookings in the 90 days before, ${i.last90} in the last 90. Find out why before you spend — ads poured into a channel that is sliding usually just cover the hole.`);
    case 'weak':
      return bi(
        `${acqVi}${repVi}. Khách từ ${nameVi} quay lại ÍT hơn mặt bằng của tiệm, nên mỗi khách ở đây đáng giá thấp hơn — nếu chạy thì ngưỡng chi phải thấp hơn.`,
        `${acqEn}${repEn}. Customers from ${nameEn} come back LESS than the shop average, so each one here is worth less — if you run ads on it, the spending limit has to be lower.`);
    default:
      return bi(`${i.list} booking.`, `${i.list} bookings.`);
  }
}

// ---- from measurement to a plan, per platform -------------------------------

export interface PlatformPlan {
  platform: AdPlatform;
  label: Txt;
  /** Rank: 1 is where to start. */
  rank: number;
  status: 'spend' | 'later' | 'hold' | 'unproven';
  /** The measured evidence this rests on. */
  evidence: Txt;
  /** Most a booking may cost HERE, from this platform's own ticket. */
  ceilingCents: number | null;
  dailyCents: number | null;
  days: number;
  totalCents: number | null;
  bookingsToBreakEven: number | null;
  /** Concrete setup, in this platform's own controls. */
  how: Txt[];
  /** The stop rule, in numbers. */
  watch: Txt;
}

export interface PlanContext {
  grossMarginPct: number | null;
  /** What a genuinely new customer pays on the first visit. */
  firstVisitTicketCents: number | null;
  /** Appointments that would fit in the quiet blocks over the window. */
  openSlots: number | null;
  // Day names and slot names are printed inside these sentences, so they arrive
  // bilingual from ads-plan/revenue-signals rather than flattened to Vietnamese
  // at the call site.
  runDayLabels: Txt[];
  pauseDayLabels: Txt[];
  quietLabels: Txt[];
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
  target: number | null; dailyCents: number | null; totalCents: number | null; days: number; note: Txt;
} {
  if (!ceilingCents || ceilingCents <= 0) {
    return {
      target: null, dailyCents: null, totalCents: null, days: WINDOW_DAYS,
      note: bi(
        'Chưa có ngưỡng chi cho mỗi khách nên chưa tính được ngân sách. Không phải "chi ít cho chắc" — mà là chưa có cách nào biết ít hay nhiều.',
        'Without a spending limit per customer there is no budget to work out. This is not "start small to be safe" — it is that there is no way yet to tell small from large.'),
    };
  }
  const room = openSlots === null ? MEASURABLE_CONVERSIONS : Math.min(MEASURABLE_CONVERSIONS, openSlots);
  if (room < 3) {
    return {
      target: room, dailyCents: null, totalCents: null, days: WINDOW_DAYS,
      note: bi(
        `Khung giờ trống chỉ chứa thêm ${openSlots} lượt trong 2 tuần. Một chiến dịch không đủ chỗ để tạo ra ${MEASURABLE_CONVERSIONS} booking thì cũng không đo được chi phí mỗi booking — mở thêm giờ hoặc lấp chỗ trống bằng khách cũ trước, đừng bật quảng cáo.`,
        `The quiet blocks only hold ${openSlots} more appointments over two weeks. A campaign with nowhere to put ${MEASURABLE_CONVERSIONS} bookings cannot measure what a booking costs either — open more hours, or fill the gaps with past customers first, and leave the ads off.`),
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
      ? bi(
        `Ngân sách đặt bằng ${room} booking × ngưỡng chi mỗi booking — giới hạn bởi số chỗ trống chứ không phải bởi túi tiền.`,
        `The budget is ${room} bookings × the limit per booking — held down by the empty chairs, not by what you can afford.`)
      : bi(
        `Ngân sách đặt bằng ${MEASURABLE_CONVERSIONS} booking × ngưỡng chi mỗi booking. ${MEASURABLE_CONVERSIONS} là số lượt tối thiểu để con số "mỗi booking tốn bao nhiêu" đọc được; ít hơn thì sai số lớn hơn cả điều cần biết.`,
        `The budget is ${MEASURABLE_CONVERSIONS} bookings × the limit per booking. ${MEASURABLE_CONVERSIONS} is the fewest you can read a cost per booking from; below that the error is bigger than the thing you are trying to learn.`),
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
      label: platformLabel(s.platform),
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
        ? bi(
          `Ngày thứ 3 và ngày thứ 7: lấy tiền đã chi chia cho số booking mà quảng cáo mang về. Dưới ${ctx.money(s.ceiling)}/booking là đang lãi — tăng dần. Trên ${ctx.money(s.ceiling)} là đang lỗ — tắt, đừng chờ hết chiến dịch. ${viOf(size.note)}`,
          `On day 3 and on day 7: take what you have spent and divide it by the bookings the ads brought in. Under ${ctx.money(s.ceiling)} a booking you are making money — raise it gradually. Over ${ctx.money(s.ceiling)} you are losing it — switch off, do not wait out the campaign. ${enOf(size.note)}`)
        : size.note,
    };
  });
}

function evidenceFor(
  s: { platform: AdPlatform; mine: ChannelReport[]; bookings: number; acquired: number; platTicket: number | null },
  ctx: PlanContext,
): Txt {
  if (!s.mine.length || s.bookings === 0) {
    // The reason search goes first with no history at all. Someone typing
    // "nail salon near me" wants one now; someone scrolling a feed did not ask.
    // Intent is the cheapest thing a local business can buy, and it is also the
    // cleanest to measure — which is what a first campaign is for.
    const whyVi = s.platform === 'google'
      ? ' Chưa có lịch sử thì bắt đầu ở tìm kiếm: người gõ "tiệm nail gần đây" đang cần làm ngay, còn người lướt bảng tin thì chưa hỏi gì cả. Ý định là thứ rẻ nhất một tiệm địa phương mua được, và cũng là thứ đo sạch nhất.'
      : '';
    const whyEn = s.platform === 'google'
      ? ' With no history at all, start at search: somebody typing "nail salon near me" wants one now, and somebody scrolling a feed never asked. Intent is the cheapest thing a local business can buy, and the cleanest thing to measure.'
      : '';
    return bi(
      `Chưa có booking nào ghi nhận từ ${PLATFORM_VI[s.platform]}. Chưa có bằng chứng kênh này chạy được ở tiệm — nếu chạy thì chạy như một PHÉP THỬ: ngân sách nhỏ, đọc kết quả rồi mới tăng.${whyVi}`,
      `No bookings have been recorded from ${PLATFORM_EN[s.platform]}. There is no evidence yet that this one works for your shop — if you run it, run it as a TEST: small budget, read the result, then raise it.${whyEn}`);
  }
  const ticketVi = s.platTicket ? ` Hoá đơn trung bình đến từ kênh này: ${ctx.money(s.platTicket)}.` : '';
  const ticketEn = s.platTicket ? ` The average ticket coming from here: ${ctx.money(s.platTicket)}.` : '';
  return bi(
    `${s.mine.map((r) => `${viOf(r.label)}: ${r.bookings} booking, ${r.acquired} khách lần đầu`).join(' · ')}.${ticketVi}`,
    `${s.mine.map((r) => `${enOf(r.label)}: ${r.bookings} bookings, ${r.acquired} first-timers`).join(' · ')}.${ticketEn}`);
}

function waitReason(status: PlatformPlan['status'], rank: number, platform: AdPlatform): Txt {
  if (status === 'hold') {
    return bi(
      `Chưa chạy ở ${PLATFORM_VI[platform]}: số liệu cho thấy kênh này chủ yếu phục vụ khách cũ đặt lại, hoặc đang đi xuống. Trả tiền để tiếp cận người vốn đã quay lại là mua lại chính khách của mình — và những booking đó vẫn hiện trong báo cáo chiến dịch, làm nó trông hiệu quả.`,
      `Not on ${PLATFORM_EN[platform]} yet: the numbers say this one mostly serves existing customers rebooking, or that it is sliding. Paying to reach someone who was coming back anyway is buying your own customers twice — and those bookings still land in the campaign report and make it look like the ad worked.`);
  }
  if (rank > 0) {
    return bi(
      'Chưa chạy song song. Bật hai kênh cùng lúc ở lần đầu thì khi kết quả tốt (hoặc xấu) sẽ không biết kênh nào tạo ra nó — chờ có con số chi phí mỗi booking ở kênh thứ nhất rồi mới mở kênh này.',
      'Not in parallel. Switch two channels on at once the first time and, good result or bad, you will not know which one made it — wait until the first channel has given you a cost per booking, then open this one.');
  }
  return bi(
    'Chưa đủ dữ liệu để nói kênh này chạy được hay không ở tiệm.',
    'There is not enough data yet to say whether this one works for your shop.');
}

function howFor(platform: AdPlatform, ctx: PlanContext): Txt[] {
  // The town is the salon's own data and reads the same in both; only the "we
  // were not told where" fallback has two languages.
  const whereVi = ctx.city && ctx.region ? `${ctx.city}, ${ctx.region}` : ctx.region || 'quanh tiệm';
  const whereEn = ctx.city && ctx.region ? `${ctx.city}, ${ctx.region}` : ctx.region || 'the shop';
  const svc = ctx.topServiceName;
  const runVi = ctx.runDayLabels.length ? ctx.runDayLabels.map(viOf).join(', ') : null;
  const runEn = ctx.runDayLabels.length ? ctx.runDayLabels.map(enOf).join(', ') : null;
  const pauseVi = ctx.pauseDayLabels.length ? ctx.pauseDayLabels.map(viOf).join(', ') : null;
  const pauseEn = ctx.pauseDayLabels.length ? ctx.pauseDayLabels.map(enOf).join(', ') : null;
  const quiet = ctx.quietLabels[0] ?? null;
  const lead = ctx.leadDays;

  const timing: Txt = runVi
    ? bi(
      `Lịch chạy: BẬT ${runVi}${pauseVi ? `, TẮT ${pauseVi}` : ''}.${lead !== null ? ` Khách của tiệm đặt trước trung bình ${lead} ngày, nên quảng cáo phải ra trước khung trống đúng ${lead} ngày — chạy đúng hôm đó là muộn.` : ''}`,
      `Schedule: ON ${runEn}${pauseEn ? `, OFF ${pauseEn}` : ''}.${lead !== null ? ` Your customers book ${lead} days ahead on average, so the ads have to be out ${lead} days before the empty block — running them on the day itself is already late.` : ''}`)
    : bi(
      'Lịch chạy: chưa đủ lịch hẹn để biết khách đặt trước bao nhiêu ngày — chạy đều 7 ngày ở tuần đầu rồi cắt theo kết quả.',
      'Schedule: there are not enough appointments yet to know how far ahead people book — run all 7 days the first week, then cut back on what the results show.');

  const exclude: Txt | '' = ctx.customerCount > 0
    ? bi(
      'Loại trừ (Exclude) danh sách khách quen ở mọi chiến dịch. Không làm bước này thì tiền sẽ chảy vào những người tuần sau vẫn tới.',
      'Put the regulars list in the Exclude box on every campaign. Skip that step and the money runs to people who are coming in next week anyway.')
    : '';

  if (platform === 'google') {
    return [
      ctx.reviewCount !== null && ctx.reviewCount !== undefined && ctx.reviewCount < 20
        ? bi(
          `Trước khi trả tiền: hồ sơ Google Business mới có ${ctx.reviewCount} đánh giá. Quảng cáo đưa người tới xem hồ sơ đó — đổ tiền vào một hồ sơ mỏng là đổ qua lỗ thủng. Xin đánh giá cho đủ 20+ trước.`,
          `Before you pay: your Google Business profile has only ${ctx.reviewCount} reviews. The ad sends people to look at that profile — money poured into a thin one runs straight through the hole. Get to 20+ reviews first.`)
        : bi(
          'Trước khi trả tiền: hồ sơ Google Business phải đủ ảnh, giờ mở cửa, bảng giá và trả lời đánh giá — quảng cáo chỉ đưa người tới đó, phần chốt là hồ sơ.',
          'Before you pay: the Google Business profile needs photos, hours, prices and answered reviews — the ad only brings people there, the profile is what closes them.'),
      bi(
        'Loại chiến dịch: Search + hiển thị trên Maps. KHÔNG bật Display, KHÔNG bật Performance Max ở lần đầu — cả hai đều tiêu tiền ở chỗ không đọc được.',
        'Campaign type: Search, showing on Maps. Do NOT switch on Display, do NOT switch on Performance Max the first time — both spend money in places you cannot read.'),
      svc
        ? bi(
          `Từ khoá: bắt đầu từ chính dịch vụ bán chạy nhất — "${svc}" kèm tên khu vực. Từ chung chung đắt hơn và mang về người ở xa.`,
          `Keywords: start from your best seller — "${svc}" with the town name on it. Broad words cost more and bring in people who live too far out.`)
        : bi(
          'Từ khoá: tên dịch vụ + tên khu vực. Từ chung chung đắt hơn và mang về người ở xa.',
          'Keywords: the service name plus the town name. Broad words cost more and bring in people who live too far out.'),
      bi(
        `Khu vực: bán kính 3-5 dặm quanh ${whereVi}, đặt ở chế độ "người đang ở trong khu vực này" chứ không phải "người quan tâm tới khu vực này".`,
        `Location: a 3 to 5 mile radius around ${whereEn}, set to "people in this location" and not "people interested in this location".`),
      quiet
        ? bi(
          `Đặt giá thầu cao hơn vào đúng khung đang trống (${viOf(quiet)}) và thấp hơn ở khung đã đông.`,
          `Bid higher on the block that is sitting empty (${enOf(quiet)}) and lower on the one that is already busy.`)
        : bi(
          'Đặt giá thầu cao hơn ở khung giờ đang trống.',
          'Bid higher on the hours that are sitting empty.'),
      timing,
      exclude,
    ].filter(Boolean) as Txt[];
  }

  if (platform === 'meta') {
    return [
      ctx.lapsedCount >= 20
        ? bi(
          `Tệp đầu tiên, rẻ nhất: ${ctx.lapsedCount} khách cũ lâu chưa quay lại — tải danh sách lên làm Custom Audience. Họ biết tiệm, biết đường, đã từng trả tiền.`,
          `First audience, and the cheapest: ${ctx.lapsedCount} past customers who have not been back in a while — upload the list as a Custom Audience. They know the shop, they know the drive, they have paid you before.`)
        : bi(
          'Tệp đầu tiên: người đã nhắn tin hoặc xem trang mà chưa đặt lịch (retarget 30 ngày). Rẻ hơn nhiều so với người lạ.',
          'First audience: people who messaged you or opened the page and never booked (a 30-day retarget). Far cheaper than strangers.'),
      bi(
        'Mục tiêu chiến dịch: tin nhắn (Messages) hoặc lượt đặt lịch — KHÔNG chọn "tương tác" hay "lượt xem video". Lượt thích không đặt lịch.',
        'Campaign objective: Messages or bookings — do NOT pick "engagement" or "video views". Likes do not book appointments.'),
      bi(
        'Nội dung quảng cáo: dùng chính clip/ảnh đang có lượt xem cao nhất trên trang, đừng dựng cái mới. Thứ đã được người thật xem hết là thứ đã qua kiểm chứng.',
        'The ad itself: use whichever clip or photo already has the most views on your page, do not shoot something new. What real people watched to the end is already proven.'),
      bi(
        `Khu vực: bán kính 3-5 dặm quanh ${whereVi}. Bán kính rộng chỉ tốn tiền cho người sẽ không bao giờ lái xe tới.`,
        `Location: a 3 to 5 mile radius around ${whereEn}. A wider radius only spends money on people who are never going to make the drive.`),
      timing,
      exclude,
    ].filter(Boolean) as Txt[];
  }

  if (platform === 'zalo') {
    return [
      bi(
        'Zalo OA: đẩy bài tới người theo dõi trước khi mua quảng cáo — tệp có sẵn luôn rẻ hơn.',
        'Zalo OA: push the post to your followers before you buy any ads — an audience you have always costs less.'),
      bi(`Khu vực: giới hạn quanh ${whereVi}.`, `Location: keep it around ${whereEn}.`),
      timing,
      exclude,
    ].filter(Boolean) as Txt[];
  }

  return [timing];
}
