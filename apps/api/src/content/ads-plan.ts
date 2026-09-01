/**
 * Whether to advertise, where, when, and at what price it stops being worth it.
 *
 * THE THING THIS FILE REFUSES TO DO
 *
 * It will not forecast bookings from a budget. "Chi $300 sẽ ra khoảng 12 khách"
 * requires a click-through rate, a cost per click and a conversion rate for THIS
 * salon in THIS town this month — three numbers nobody has until the campaign
 * has run. A forecast built on three borrowed assumptions is a guess wearing a
 * spreadsheet, and the owner who acts on it has no way to know it was a guess.
 *
 * So the arithmetic runs the other way. Instead of "spend this, get that", it
 * answers: at your ticket and your margin, what is the MOST a booking may cost
 * before the campaign destroys money? That number — the break-even CPA — is
 * computed entirely from the salon's own figures, it is checkable, and it turns
 * an unanswerable forecasting question into a decision rule you can hold a live
 * campaign against on day three:
 *
 *     spend so far ÷ bookings so far  >  ceiling   →  stop.
 *
 * A first campaign is a measurement, not an investment. Its job is to discover
 * this salon's real cost per booking. This file sizes the smallest spend that
 * can produce a trustworthy answer, and says plainly that the answer is what is
 * being bought.
 *
 * THE OTHER HALF: TIMING
 *
 * Ads for a Saturday-morning gap must run on the days people BOOK Saturday
 * morning, and that is not Saturday. The gap between booking and appointment is
 * measurable from the salon's own book, so the run days are derived from it
 * rather than assumed. And the days to switch OFF matter as much: paying to
 * reach people on the day your busiest block fills anyway is buying customers
 * you already had.
 */

import { sizeCampaign } from './channel-plan';
import { bi, viOf, enOf, type Txt } from './i18n';

export interface LeadTime {
  /** Median days between booking and appointment. Null when too few to tell. */
  medianDays: number | null;
  sample: number;
  basis: Txt;
}

/**
 * How far ahead this salon's customers book.
 *
 * Median, not mean: one person booking a wedding six months out would drag a
 * mean into nonsense and move every ad day with it.
 */
export function leadTime(rows: { createdAt: number; startTime: number }[]): LeadTime {
  const days = (rows ?? [])
    .map((r) => Math.round((r.startTime - r.createdAt) / 86_400_000))
    .filter((d) => d >= 0 && d <= 120);
  if (days.length < 10) {
    return {
      medianDays: null,
      sample: days.length,
      basis: bi(
        `Chỉ có ${days.length} lịch hẹn đo được khoảng cách đặt-đến-làm. Dưới 10 thì chưa nói lên nhịp của tiệm.`,
        `Only ${days.length} appointments show the gap between booking and visit. Under ten of those, it says nothing about how this shop runs.`),
    };
  }
  const s = [...days].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const median = s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  return {
    medianDays: median,
    sample: days.length,
    basis: bi(
      `${days.length} lịch hẹn: khách thường đặt trước ${median} ngày.`,
      `${days.length} appointments: customers usually book ${median} days ahead.`),
  };
}

// ---- the ceiling ------------------------------------------------------------

export interface CpaCeiling {
  /** Most a single booking may cost, counting only that one visit. */
  strictCents: number | null;
  /** Counting a year of repeat visits at this salon's own return rhythm. */
  withRepeatCents: number | null;
  /** Visits per year implied by the median gap — the assumption, stated. */
  visitsPerYear: number | null;
  plain: Txt;
}

/**
 * The most a booking may cost before the campaign is burning money.
 *
 * Two numbers on purpose, and the strict one leads. A salon that only ever
 * looks at lifetime value talks itself into paying $40 for a customer worth $38
 * this visit, on the strength of return visits that may not happen. The strict
 * ceiling is what survives if the customer never comes back; the repeat ceiling
 * is the upper bound worth chasing once retention is proven.
 */
export function cpaCeiling(input: {
  avgTicketCents: number | null;
  grossMarginPct: number | null;
  /** Median days between visits for returning customers. */
  medianGapDays?: number | null;
}): CpaCeiling {
  const t = input.avgTicketCents && input.avgTicketCents > 0 ? input.avgTicketCents : null;
  const m = input.grossMarginPct && input.grossMarginPct > 0 && input.grossMarginPct < 100 ? input.grossMarginPct : null;
  if (t === null || m === null) {
    return {
      strictCents: null, withRepeatCents: null, visitsPerYear: null,
      plain: t === null
        ? bi(
          'Chưa đủ lịch hẹn để biết hoá đơn trung bình, nên chưa tính được một khách đáng giá bao nhiêu.',
          'There are not enough appointments yet to know the average ticket, so there is no way to say what one customer is worth.')
        : bi(
          'Chưa nhập tỷ lệ ăn chia thợ nên chưa biết biên lãi — không tính được ngưỡng chi cho mỗi khách.',
          'The tech pay split has not been entered, so the margin is unknown — and without a margin there is no spending limit per customer.'),
    };
  }
  const strict = Math.round((t * m) / 100);
  const gap = input.medianGapDays && input.medianGapDays > 0 ? input.medianGapDays : null;
  // Capped at 6 visits: projecting a year of loyalty from a first-time click is
  // the assumption that ruins ad budgets, so the optimistic number stays modest.
  const visits = gap ? Math.max(1, Math.min(6, Math.round(365 / gap))) : null;
  const withRepeat = visits ? strict * visits : null;
  return {
    strictCents: strict, withRepeatCents: withRepeat, visitsPerYear: visits,
    // Two numbers in one sentence, so it is written out whole in each language
    // rather than stitched from pieces: the clause order is not the same twice.
    plain: withRepeat && visits && visits > 1
      ? bi(
        `Một lượt khách mới để lại khoảng ${fmt(strict)} lãi ngay lần đầu. Nếu họ quay lại theo nhịp hiện tại (~${visits} lần/năm) thì tối đa ${fmt(withRepeat)}. Lấy con số ĐẦU làm ngưỡng cho chiến dịch đầu tiên — con số sau chỉ dùng khi tiệm đã chứng minh giữ được khách.`,
        `A new customer leaves you about ${fmt(strict)} in profit on that first visit. If they come back at the pace your customers do now (~${visits} times a year), the most they are worth is ${fmt(withRepeat)}. Use the FIRST number as the limit on your first campaign — the second one only counts once you have proven you keep customers.`)
      : bi(
        `Một lượt khách mới để lại khoảng ${fmt(strict)} lãi. Chi hơn mức đó cho mỗi booking là lỗ.`,
        `A new customer leaves you about ${fmt(strict)} in profit. Pay more than that per booking and you lose money on every one.`),
  };
}

const fmt = (cents: number) => `$${(cents / 100).toFixed(0)}`;

// ---- budget, framed as a test ----------------------------------------------

export interface BudgetPlan {
  dailyCents: number;
  days: number;
  totalCents: number;
  /** Bookings this spend must produce to break even. */
  bookingsToBreakEven: number | null;
  /** Free capacity in the quiet blocks — is the target even physically possible? */
  openSlots: number | null;
  feasible: 'yes' | 'tight' | 'no' | 'unknown';
  plain: Txt;
}

/**
 * Size the first campaign as a measurement, not a bet.
 *
 * Two weeks, because the deliverable of campaign one is a number — this salon's
 * real cost per booking — and a longer first run buys the same number for more
 * money. The check that matters is whether the bookings needed to break even
 * can physically fit in the empty chairs: a plan that requires more customers
 * than the salon has room for is not ambitious, it is arithmetically
 * impossible, and better caught here than in week three.
 *
 * The daily figure used to default to $15 for every business on this platform.
 * It looked plausible for a nail salon, which is how it survived; for a trade
 * with a $500 ticket it is a rounding error that can never buy enough
 * conversions to measure anything. It now comes from the salon's own ceiling
 * via sizeCampaign, which is the same derivation the per-platform cards use —
 * so the two numbers on the screen cannot disagree.
 */
export function budgetPlan(input: {
  ceiling: CpaCeiling;
  /** Empty appointment slots in the quiet blocks over the campaign window. */
  openSlots?: number | null;
  dailyCents?: number;
  days?: number;
}): BudgetPlan {
  const sized = sizeCampaign(input.ceiling.strictCents, input.openSlots ?? null);
  const days = input.days ?? sized.days;
  const daily = input.dailyCents ?? sized.dailyCents ?? 1500;
  const total = daily * days;
  const ceiling = input.ceiling.strictCents;
  if (!ceiling) {
    return {
      dailyCents: daily, days, totalCents: total,
      bookingsToBreakEven: null, openSlots: input.openSlots ?? null, feasible: 'unknown',
      // The ceiling's own sentence leads, so each language is composed from its
      // own half rather than from a translated fragment.
      plain: bi(
        `${viOf(input.ceiling.plain)} Chưa có ngưỡng thì chưa nên bật quảng cáo — sẽ không có cách nào biết nó lãi hay lỗ.`,
        `${enOf(input.ceiling.plain)} Without that limit, do not switch ads on yet — there would be no way to tell whether they made money or lost it.`),
    };
  }
  const need = Math.ceil(total / ceiling);
  const open = input.openSlots ?? null;
  const feasible = open === null ? 'unknown' : need <= open * 0.5 ? 'yes' : need <= open ? 'tight' : 'no';
  const plain: Txt = feasible === 'no'
    ? bi(
      `${fmt(total)} trong ${days} ngày cần ${need} booking mới hoà vốn, nhưng khung giờ trống chỉ chứa được ${open}. Ngân sách này không thể hoà vốn — hạ xuống hoặc mở thêm giờ trước đã.`,
      `${fmt(total)} over ${days} days needs ${need} bookings just to break even, and the empty slots only hold ${open}. This budget cannot break even — cut it back, or open more hours first.`)
    : feasible === 'tight'
      ? bi(
        `${fmt(total)} trong ${days} ngày cần ${need} booking để hoà vốn, và tiệm chỉ trống ${open} chỗ. Sát quá — nên bắt đầu ở mức thấp hơn.`,
        `${fmt(total)} over ${days} days needs ${need} bookings to break even, and you only have ${open} slots open. That is too close for comfort — start smaller.`)
      : bi(
        `${fmt(total)} trong ${days} ngày cần ${need} booking để hoà vốn${open ? `, trong khi khung trống chứa được ${open}` : ''}. Đây là một PHÉP ĐO chứ không phải một khoản đầu tư: thứ mua được là con số "mỗi booking tốn bao nhiêu" của chính tiệm.`,
        `${fmt(total)} over ${days} days needs ${need} bookings to break even${open ? `, and there is room for ${open}` : ''}. This is a MEASUREMENT, not an investment: what the money buys is your own shop's number for what a booking costs.`);
  return { dailyCents: daily, days, totalCents: total, bookingsToBreakEven: need, openSlots: open, feasible, plain };
}

// ---- when to run, when to stop ---------------------------------------------

const WEEKDAY_VI = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

/**
 * The English half of a day label, in the short form an owner writes on a
 * calendar — and the same shorthand revenue-signals.ts uses for its slot
 * labels, so one screen does not say "Wed" on one card and "Wednesday" on the
 * next.
 */
const WEEKDAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const dayLabel = (weekday: number): Txt => bi(WEEKDAY_VI[weekday], WEEKDAY_EN[weekday]);

export interface RunWindow {
  /** Weekdays to have ads live, 0 = Sunday. */
  runDays: number[];
  /** Weekdays to switch off. */
  pauseDays: number[];
  labels: { run: Txt[]; pause: Txt[] };
  why: Txt;
}

/**
 * Which days the ads should be live.
 *
 * Derived, not chosen: take the weekday of the emptiest block, subtract how far
 * ahead this salon's customers actually book, and advertise in that window.
 * Advertising ON the quiet day itself reaches people deciding for next week —
 * by which time the gap it was meant to fill has already passed unsold.
 *
 * The pause list is the more valuable half. Days feeding an already-full block
 * are days when the ad pays for customers who were coming anyway, and no report
 * ever shows that as waste: those bookings appear in the campaign's results and
 * make it look successful.
 */
export function runWindow(input: {
  quietWeekdays: number[];
  busyWeekdays: number[];
  leadDays: number | null;
}): RunWindow {
  const lead = input.leadDays ?? 3;
  const shift = (wd: number, by: number) => ((wd - by) % 7 + 7) % 7;
  const run = new Set<number>();
  for (const wd of input.quietWeekdays.slice(0, 3)) {
    run.add(shift(wd, lead));
    run.add(shift(wd, lead + 1)); // a day either side, because the median is a middle
    run.add(shift(wd, Math.max(0, lead - 1)));
  }
  const pause = new Set<number>();
  for (const wd of input.busyWeekdays.slice(0, 2)) {
    const d = shift(wd, lead);
    if (!run.has(d)) pause.add(d);
  }
  const runDays = Array.from(run).sort();
  const pauseDays = Array.from(pause).sort();
  return {
    runDays, pauseDays,
    labels: { run: runDays.map(dayLabel), pause: pauseDays.map(dayLabel) },
    why: input.leadDays === null
      ? bi(
        `Chưa đo được khách đặt trước bao nhiêu ngày, nên tạm tính ${lead} ngày. Sửa lại khi tiệm có đủ lịch hẹn.`,
        `How far ahead your customers book has not been measured yet, so this assumes ${lead} days. It gets corrected once there are enough appointments.`)
      : bi(
        `Khách của tiệm đặt trước trung bình ${lead} ngày, nên quảng cáo phải chạy trước khung trống đúng ${lead} ngày — chạy đúng hôm đó là muộn.`,
        `Your customers book ${lead} days ahead on average, so the ads have to run ${lead} days before the empty block — running them on the day itself is already too late.`),
  };
}

// ---- which platform ----------------------------------------------------------
//
// REMOVED: platformPick().
//
// It ranked the platforms from raw arrival counts and shipped its verdict to
// the same screen that now shows channel-plan.ts's ranking, which is built from
// acquisition and retention. Two rankers on one screen is not redundancy, it is
// a contradiction waiting for the week they disagree — and the owner would have
// had no way to tell which card to believe.
//
// The one thing worth keeping from it, the argument for starting with search
// when there is no history at all, moved into channel-plan's evidenceFor().

// ---- who to aim at ----------------------------------------------------------

export interface AdAudience {
  name: Txt;
  who: Txt;
  why: Txt;
  /** Concrete targeting, in the words of the ad platform. */
  how: Txt;
  /** Ranked cheapest-first. */
  order: number;
  /** Blocked when the platform needs more people than the salon has. */
  blockedBy?: Txt;
}

/**
 * Who to point the money at, cheapest audience first.
 *
 * The ordering is the whole point. Every platform's default is "people like
 * your customers", which is the most expensive audience on the list, and the
 * two cheaper ones above it are made of people who already know this salon.
 * A lookalike also has a floor: the platforms need a few thousand matched
 * people to build one, and a salon with 200 customers uploading its list gets
 * an audience built from noise. That floor is stated rather than discovered.
 */
export function adAudiences(input: {
  lapsedCount?: number;
  customerCount?: number;
  city?: string | null;
  region?: string | null;
  regularCount?: number;
}): AdAudience[] {
  const out: AdAudience[] = [];
  // The town's name is the salon's own data and is never translated; only the
  // "we were not told where" fallback has two languages.
  const whereVi = input.city && input.region ? `${input.city}, ${input.region}` : input.region || 'quanh tiệm';
  const whereEn = input.city && input.region ? `${input.city}, ${input.region}` : input.region || 'around the shop';

  if ((input.lapsedCount ?? 0) >= 20) {
    out.push({
      name: bi('Khách cũ lâu chưa quay lại', 'Past customers who stopped coming'),
      who: bi(
        `${input.lapsedCount} người từng trả tiền ở tiệm và đã lâu không tới`,
        `${input.lapsedCount} people who have paid you before and have not been in for a while`),
      why: bi(
        'Rẻ nhất trong mọi tệp: họ biết tiệm, biết đường, đã từng chọn tiệm này. Không phải thuyết phục từ đầu.',
        'The cheapest audience there is: they know the shop, they know the drive, they picked you once already. Nothing to sell from scratch.'),
      how: bi(
        'Tải danh sách khách lên làm Custom Audience, loại trừ những người đã đặt lịch trong 30 ngày qua.',
        'Upload your customer list as a Custom Audience and exclude anyone who has booked in the last 30 days.'),
      order: 1,
    });
  } else if (input.lapsedCount) {
    out.push({
      name: bi('Khách cũ lâu chưa quay lại', 'Past customers who stopped coming'),
      who: bi(`${input.lapsedCount} người`, `${input.lapsedCount} people`),
      why: bi(
        'Vẫn là tệp đáng nhất, nhưng quá ít để làm quảng cáo.',
        'Still the audience worth the most, but too few of them to put an ad behind.'),
      how: bi(
        'Nhắn tay từng người. Rẻ hơn và tỷ lệ trả lời cao hơn quảng cáo ở quy mô này.',
        'Text them one at a time. At this size it costs less and gets more replies than an ad would.'),
      order: 1,
      blockedBy: bi(
        'Dưới 20 người thì quảng cáo không chạy nổi — nhắn tay hiệu quả hơn.',
        'Under 20 people an ad cannot get off the ground — reaching out by hand works better.'),
    });
  }

  out.push({
    name: bi('Người đã ghé mà chưa đặt', 'People who came by but never booked'),
    who: bi(
      'Người xem trang đặt lịch, nhắn tin, hoặc xem hết clip mà chưa đặt',
      'People who opened the booking page, sent a message, or watched a clip all the way through and still did not book'),
    why: bi(
      'Đã tự tìm tới nhưng dừng lại giữa chừng. Đây là nhóm gần với việc đặt lịch nhất mà chưa tốn tiền thuyết phục.',
      'They found you on their own and stopped halfway. Nobody is closer to booking, and you have not spent a dollar convincing them.'),
    how: bi(
      'Retarget 30 ngày: người truy cập trang đặt lịch + người tương tác trang. Loại trừ người đã đặt.',
      'Retarget a 30-day window: booking-page visitors plus anyone who engaged with the page. Exclude the ones who already booked.'),
    order: 2,
  });

  out.push({
    name: bi(`Người sống quanh tiệm — ${whereVi}`, `People who live near the shop — ${whereEn}`),
    who: bi('Bán kính 3-5 dặm quanh tiệm', 'A 3 to 5 mile radius around the shop'),
    why: bi(
      'Với tiệm địa phương, khoảng cách quyết định nhiều hơn mọi tiêu chí khác. Người cách 15 dặm hiếm khi lái xe qua ba tiệm cùng loại.',
      'For a local shop, distance decides more than any other setting. Someone 15 miles out almost never drives past three places just like yours.'),
    how: bi(
      'Giới hạn bán kính quanh địa chỉ tiệm. Đừng nhắm cả thành phố — mỗi dặm thừa là tiền trả cho người sẽ không bao giờ tới.',
      'Set the radius around your shop address. Do not target the whole city — every extra mile is money spent on people who are never going to drive in.'),
    order: 3,
  });

  const canLookalike = (input.customerCount ?? 0) >= 1000;
  out.push({
    name: bi('Tệp tương tự khách hiện tại (lookalike)', 'A lookalike of your current customers'),
    who: bi(
      'Người có hành vi giống khách đang có của tiệm',
      'People whose behaviour matches the customers you already have'),
    why: bi(
      'Đây là tệp ĐẮT NHẤT trong danh sách và là tệp mọi nền tảng gợi ý đầu tiên. Chỉ nên tới đây sau khi ba tệp trên đã hết chỗ.',
      'This is the MOST EXPENSIVE audience on the list, and the one every platform pushes at you first. Only come here once the three above have run out of room.'),
    how: canLookalike
      ? bi(
        'Tạo Lookalike 1% từ danh sách khách, giới hạn trong bán kính quanh tiệm.',
        'Build a 1% Lookalike off your customer list and hold it inside the radius around the shop.')
      : bi('Chưa làm được.', 'Not possible yet.'),
    order: 4,
    ...(canLookalike ? {} : {
      blockedBy: bi(
        `Cần khoảng 1.000 khách trong danh sách để nền tảng dựng được tệp tương tự; tiệm đang có ${input.customerCount ?? 0}. Dựng từ danh sách nhỏ hơn chỉ ra một tệp làm từ nhiễu.`,
        `The platforms need roughly 1,000 customers on the list before they can build a lookalike; you have ${input.customerCount ?? 0}. Built off anything smaller, the audience is made of noise.`),
    }),
  });

  if ((input.regularCount ?? 0) > 0) {
    out.push({
      name: bi(`LOẠI TRỪ: ${input.regularCount} khách quen`, `EXCLUDE: ${input.regularCount} regulars`),
      who: bi('Những người vẫn đang đi đều', 'The people already coming in on schedule'),
      why: bi(
        'Trả tiền để tiếp cận người tuần sau vẫn tới là mua lại chính khách của mình. Tệ hơn: những booking đó hiện lên trong báo cáo chiến dịch và làm nó trông hiệu quả.',
        'Paying to reach someone who is coming back next week anyway is buying your own customers a second time. Worse: those bookings land in the campaign report and make it look like the ad worked.'),
      how: bi(
        'Thêm danh sách khách quen vào ô Exclude ở mọi chiến dịch.',
        'Add your regulars list to the Exclude box on every campaign.'),
      order: 0,
    });
  }

  return out.sort((a, b) => a.order - b.order);
}
