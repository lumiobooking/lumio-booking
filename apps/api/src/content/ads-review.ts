import { bi, viOf, enOf, type Txt } from './i18n';

/**
 * THE WEEKLY REVIEW — the one promise on the ads card that nothing kept.
 *
 * The card tells a salon owner, in her own language and above the button she
 * presses to say yes:
 *
 *   "Ngày thứ 7 và ngày thứ 14: bên em soi lại và báo tiệm bằng con số."
 *   "Một tin nhắn ngắn có ba con số đó, kèm một dòng bên em đã đổi gì và vì sao."
 *
 * Nothing generated that. No job appeared on day seven, no message existed to
 * send, and nobody on the team was told a salon was due. The weekly review IS
 * the service a remote agency sells — the client cannot watch the campaign
 * herself, that is the entire reason she is paying — and it was the one part
 * of the plan with no machinery behind it. A promise printed above a button is
 * worse than no promise: it is the thing she remembers in week three.
 *
 * WHAT THIS MODULE IS, AND IS NOT
 *
 * It is arithmetic and words. It holds no database, schedules nothing, and
 * sends nothing. Given a campaign that has started and the numbers it has
 * produced so far, it answers three questions:
 *
 *   1. Is a review due today, and how late is it?
 *   2. What do the three numbers say — and is there even enough to read?
 *   3. What exactly gets sent to the shop?
 *
 * The third one matters most. A staff member covering a dozen salons does not
 * write twelve honest little reports on a Tuesday; she writes none. The message
 * arrives already written, in the shop's language, with the shop's figures in
 * it, and one blank the person actually has to fill: what was changed.
 */

export interface Campaign {
  /** 'YYYY-MM-DD' the campaign went live. Null = agreed but not started. */
  startedAt: string | null;
  /** Length in days, as agreed. */
  days: number;
  dailyCents: number;
  /** Cost per new customer above which the campaign is losing money. */
  ceilingCents: number | null;
  /** Reviews already sent, keyed by day number: { '7': { at, by } }. */
  done?: Record<string, { at?: string | null; by?: string | null } | undefined>;
}

/**
 * Below this many attributed bookings, a cost-per-customer is noise.
 *
 * The same number the card's own day-7 condition names ("Google đã về 8
 * booking trở lên"), so the review cannot contradict the promise that sold it.
 */
export const READABLE_BOOKINGS = 8;

/**
 * The days a review lands on — the same two the card prints, from the same
 * formula, because a card that says day 7 and a queue that says day 8 is how a
 * client learns the promise was decoration.
 */
export function reviewDays(days: number): number[] {
  const total = Math.max(1, Math.round(days));
  const mid = Math.max(3, Math.round(total / 2));
  return mid >= total ? [total] : [mid, total];
}

const DAY_MS = 86_400_000;
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The date a given review day falls on. Day 7 is 6 days after day 1. */
export function reviewDate(startedAt: string, dayNumber: number): string {
  const start = Date.parse(`${startedAt}T00:00:00Z`);
  if (Number.isNaN(start)) return startedAt;
  return dayKey(start + (Math.max(1, dayNumber) - 1) * DAY_MS);
}

export interface ReviewDue {
  dayNumber: number;
  dueDate: string;
  /** 0 = due today, positive = overdue by this many days, negative = ahead. */
  lateDays: number;
  done: boolean;
  doneAt?: string | null;
}

/**
 * Which reviews this campaign owes, in the order they should be worked.
 *
 * Reviews still in the future are returned too — the team's screen needs to
 * say "ngày thứ 7 là thứ Ba tuần này", not only shout on the day. What it must
 * never do is stay silent until somebody remembers.
 */
export function dueReviews(c: Campaign, today: string): ReviewDue[] {
  if (!c?.startedAt) return [];
  const now = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(now)) return [];
  return reviewDays(c.days).map((dayNumber) => {
    const dueDate = reviewDate(c.startedAt as string, dayNumber);
    const hit = c.done?.[String(dayNumber)];
    return {
      dayNumber,
      dueDate,
      lateDays: Math.round((now - Date.parse(`${dueDate}T00:00:00Z`)) / DAY_MS),
      done: Boolean(hit),
      doneAt: hit?.at ?? null,
    };
  }).sort((a, b) => a.dayNumber - b.dayNumber);
}

/** The next review that still has to happen, if any. */
export function nextReview(c: Campaign, today: string): ReviewDue | null {
  return dueReviews(c, today).find((r) => !r.done) ?? null;
}

export type ReviewVerdict = 'too-early' | 'winning' | 'tight' | 'losing' | 'no-ceiling';

export interface ReviewNumbers {
  /** Spent so far on this campaign, in cents. */
  spentCents: number;
  /**
   * True when that figure is the AGREED daily budget × days run, because
   * nobody has typed the platform's real number in yet.
   *
   * MarketingSpend is stored per calendar month, so a fortnight's campaign
   * cannot be sliced out of it. Rather than quietly present a projection as a
   * measurement — the exact move that makes a client stop believing the rest of
   * the report — the figure says which one it is, in the message the shop
   * reads.
   */
  spendEstimated?: boolean;
  /** New customers whose FIRST booking came through a paid channel. */
  fromAds: number;
  ceilingCents: number | null;
}

const fmt = (c: number) => `$${Math.round(c / 100)}`;

export function reviewVerdict(n: ReviewNumbers): ReviewVerdict {
  if (n.fromAds < READABLE_BOOKINGS) return 'too-early';
  if (n.ceilingCents === null || n.ceilingCents <= 0) return 'no-ceiling';
  const per = n.spentCents / n.fromAds;
  if (per <= n.ceilingCents * 0.85) return 'winning';
  if (per <= n.ceilingCents) return 'tight';
  return 'losing';
}

export interface ReviewReport {
  dayNumber: number;
  verdict: ReviewVerdict;
  perCustomerCents: number | null;
  /** The three figures, already in money, for a screen that shows them big. */
  figures: { value: string; label: Txt }[];
  /** The message to send the shop — already written, one blank to fill. */
  message: Txt;
  /** What the team should actually do about it, before sending. */
  doNext: Txt;
}

/**
 * THE MESSAGE, WRITTEN.
 *
 * Three numbers, one verdict, one blank. The blank is deliberate and it is the
 * only one: "bên em đã đổi ___". A report with nothing changed in it is a
 * report that says we watched, and watching is not what the shop is paying
 * for — so the sentence cannot be generated, and the person has to have done
 * something to fill it.
 */
export function reviewReport(input: ReviewNumbers & {
  dayNumber: number;
  days: number;
  /** What the ad is selling, so the owner recognises her own campaign. */
  service?: Txt | null;
}): ReviewReport {
  const verdict = reviewVerdict(input);
  const per = input.fromAds > 0 ? Math.round(input.spentCents / input.fromAds) : null;
  const ceil = input.ceilingCents && input.ceilingCents > 0 ? input.ceilingCents : null;

  const figures = [
    { value: fmt(input.spentCents), label: bi('đã chi', 'spent') },
    { value: String(input.fromAds), label: bi('khách mới từ quảng cáo', 'new customers from ads') },
    { value: per === null ? '—' : fmt(per), label: bi('mỗi khách', 'each') },
  ];

  const head = bi(
    `Báo tiệm — ngày thứ ${input.dayNumber}/${input.days} của đợt quảng cáo`,
    `Day ${input.dayNumber} of ${input.days} — your ad report`);

  const est = input.spendEstimated ? ' (theo ngân sách đã duyệt — chưa nhập số thật từ nền tảng)' : '';
  const estEn = input.spendEstimated ? ' (the approved budget — the platform figure has not been entered yet)' : '';
  const threeVi = `Đã chi ${fmt(input.spentCents)}${est} · ${input.fromAds} khách mới từ quảng cáo · ${per === null ? 'chưa tính được mỗi khách' : `${fmt(per)} mỗi khách`}${ceil ? ` (ngưỡng ${fmt(ceil)})` : ''}.`;
  const threeEn = `${fmt(input.spentCents)} spent${estEn} · ${input.fromAds} new customers from the ads · ${per === null ? 'not enough to price one yet' : `${fmt(per)} each`}${ceil ? ` (the line is ${fmt(ceil)})` : ''}.`;

  const saysVi = verdict === 'too-early'
    ? `Mới ${input.fromAds} khách nên chưa đọc được gì chắc chắn — dưới ${READABLE_BOOKINGS} khách thì con số nào rút ra cũng là nhiễu. Bên em giữ nguyên và đọc lại ở lần soi sau.`
    : verdict === 'winning'
      ? `Đang rẻ hơn ngưỡng — quảng cáo có lãi ngay từ lần khách đầu tiên tới.`
      : verdict === 'tight'
        ? `Đang sát ngưỡng: có lãi nhưng mỏng. Bên em siết lại cho chắc chứ không tăng tiền lúc này.`
        : verdict === 'losing'
          ? `Đang vượt ngưỡng ${ceil ? fmt(ceil) : ''} — mỗi khách đang tốn hơn số tiền họ để lại. Bên em sửa ngay trong hôm nay.`
          : `Chưa có ngưỡng để so vì tiệm chưa nhập tỷ lệ ăn chia thợ — bên em cần con số đó để nói quảng cáo lãi hay lỗ.`;
  const saysEn = verdict === 'too-early'
    ? `Only ${input.fromAds} so far, so nothing can be read yet — under ${READABLE_BOOKINGS} customers any figure pulled out is noise. We leave it alone and read it again at the next review.`
    : verdict === 'winning'
      ? `Under the line — the ads are profitable on the customer's very first visit.`
      : verdict === 'tight'
        ? `Right on the line: profitable, but thin. We tighten it rather than spend more right now.`
        : verdict === 'losing'
          ? `Over the line${ceil ? ` of ${fmt(ceil)}` : ''} — each customer is costing more than they leave behind. We are fixing it today.`
          : `There is no line to compare against yet because the tech pay split has not been entered — we need that to say whether the ads make money.`;

  const doNext = verdict === 'too-early'
    ? bi('Chưa đổi gì. Ghi rõ trong tin nhắn là đang chờ đủ số để đọc.',
      'Change nothing. Say in the message that you are waiting for enough data to read.')
    : verdict === 'winning'
      ? bi('Dồn thêm tiền vào khung giờ và dịch vụ đang ra khách, rồi ghi lại đã đổi gì.',
        'Put more behind the hours and services that are producing, then write down what you changed.')
      : verdict === 'tight'
        ? bi('Thu hẹp khu vực hoặc tắt khung giờ kém nhất. Không tăng ngân sách.',
          'Tighten the radius or switch off the weakest hours. Do not raise the budget.')
        : verdict === 'losing'
          ? bi('Sửa NGAY hôm nay: đổi dịch vụ quảng cáo, thu hẹp khu vực, hoặc tắt khung giờ không ra khách. Rồi mới gửi tin.',
            'Fix it TODAY: change the advertised service, tighten the radius, or switch off the hours that bring nobody. Then send the message.')
          : bi('Xin tiệm tỷ lệ ăn chia thợ rồi nhập vào, nếu không mọi con số bên dưới đều không kết luận được.',
            'Ask the shop for the tech pay split and enter it, or none of these numbers can conclude anything.');

  const svcVi = input.service ? ` Quảng cáo đang bán: ${viOf(input.service)}.` : '';
  const svcEn = input.service ? ` The ad is selling: ${enOf(input.service)}.` : '';

  return {
    dayNumber: input.dayNumber,
    verdict,
    perCustomerCents: per,
    figures,
    doNext,
    // The blank is the point. See the comment above this function.
    message: bi(
      `${viOf(head)}\n${threeVi}\n${saysVi}${svcVi}\nTuần này bên em đã đổi: ___`,
      `${enOf(head)}\n${threeEn}\n${saysEn}${svcEn}\nWhat we changed this week: ___`),
  };
}

/** The job as it reads in the team's queue. */
export function reviewJobText(dayNumber: number, salon: string): Txt {
  return bi(
    `Soi quảng cáo ${salon} — ngày thứ ${dayNumber}, rồi báo tiệm ba con số`,
    `Review ${salon}'s ads — day ${dayNumber}, then report the three numbers`);
}
