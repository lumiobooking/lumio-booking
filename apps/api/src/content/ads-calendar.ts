import { bi, viOf, enOf, type Txt } from './i18n';
import type { DatedEvent } from './region-events';

/**
 * The fourth rhythm of an ad budget: the one that runs over a year.
 *
 * THE THREE THAT ALREADY EXISTED, AND THE GAP
 *
 * ads-plan sizes the spend per customer (the CPA ceiling), per day (enough to
 * measure), and per weekday (run when people book the empty block, pause when
 * it fills anyway). All three look inside one fortnight. Nothing looked at the
 * year, so a salon spent the same on the second week of January — when nobody
 * is booking anything — as on the ten days before Mother's Day, which is the
 * single most valuable stretch of its year. Flat spending is not neutral. It
 * is a decision to overpay in the quiet weeks and to run out of money in the
 * week that would have paid for the quarter.
 *
 * WHAT THIS DOES INSTEAD, AND WHAT IT WILL NOT CLAIM
 *
 * It moves the SAME money. Each month's total is normalised back to what a
 * flat budget would have cost, so the plan is a reallocation and not an
 * upsell — an agency that answers "spend more" to every question is an agency
 * whose advice cannot be checked. Where the money goes is decided by two
 * facts, both of them the salon's own:
 *
 *   - WHEN TO PUSH. A run opens before a date people book for, and it opens
 *     `leadDays + 3` before it, because that is when this shop's customers
 *     actually pick up the phone (leadTime measures it from the book). Ads
 *     that go live on Valentine's Day are ads for appointments that were
 *     taken last week.
 *   - WHEN TO CUT. The days straight AFTER a spike. The people who wanted
 *     nails for the occasion have just had them done; paying to reach them
 *     now is buying customers you already served. This is the one cut that
 *     is defensible without a year of this salon's own history, which is why
 *     it is the only one here.
 *
 * There is deliberately no "January is dead" table. That is true of American
 * nail salons in general and unknown for THIS salon, and a plan that quietly
 * halves a shop's budget on a stereotype is a plan nobody can argue with.
 */

export type PeriodKind = 'push' | 'base' | 'cut';

export interface BudgetPeriod {
  /** Inclusive, 'YYYY-MM-DD'. */
  from: string;
  to: string;
  kind: PeriodKind;
  days: number;
  dailyCents: number;
  totalCents: number;
  /** The occasion this period is about, when there is one. */
  label: Txt | null;
  /** Why the money moves here, in the words a person would use out loud. */
  why: Txt;
}

export interface AdsMonth {
  /** 'YYYY-MM'. */
  month: string;
  totalCents: number;
  /** What a flat budget would have cost that month — the comparison. */
  flatCents: number;
  days: number;
}

export interface AdsCalendar {
  baseDailyCents: number;
  periods: BudgetPeriod[];
  months: AdsMonth[];
  /** The push windows, as the one-line diary entries a person acts on. */
  diary: { on: string; label: Txt; line: Txt }[];
  plain: Txt;
}

const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const parse = (iso: string) => new Date(`${iso}T00:00:00Z`);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const money = (cents: number) => `$${Math.round(cents / 100)}`;

/** How much louder a push is. A gift date beats a season: the date cannot move. */
const PUSH_DATED = 1.9;
const PUSH_SEASON = 1.45;
/** The quiet days straight after a spike. */
const CUT = 0.45;
const CUT_DAYS = 5;

/** How early a push opens: this shop's own booking lead, plus room to learn. */
export function pushLead(leadDays: number | null): number {
  const base = leadDays && leadDays > 0 ? leadDays + 3 : 7;
  return Math.max(5, Math.min(14, base));
}

interface Window { from: number; to: number; kind: PeriodKind; label: Txt | null; why: Txt; mult: number }

export function adsCalendar(input: {
  baseDailyCents: number;
  events: DatedEvent[];
  leadDays: number | null;
  today?: Date;
  horizonDays?: number;
}): AdsCalendar {
  const base = Math.max(0, Math.round(input.baseDailyCents || 0));
  const today = input.today ?? new Date();
  const start = parse(ymd(today));
  const horizon = input.horizonDays ?? 90;
  const lead = pushLead(input.leadDays);

  if (!base) {
    return {
      baseDailyCents: 0, periods: [], months: [], diary: [],
      plain: bi(
        'Chưa có ngân sách nền nên chưa xếp được lịch chi. Ngưỡng chi cho mỗi khách phải có trước.',
        'There is no base budget yet, so there is nothing to schedule. The limit per customer has to come first.'),
    };
  }

  // Day 0 is today. Every window is a pair of offsets into the horizon.
  const windows: Window[] = [];
  for (const e of input.events ?? []) {
    const evStart = Math.round((parse(e.date).getTime() - start.getTime()) / DAY);
    const evEnd = evStart + Math.max(0, Math.min(e.spanDays ?? 0, 45));
    if (evEnd < 0 || evStart > horizon) continue;
    const season = (e.spanDays ?? 0) > 0;
    windows.push({
      from: Math.max(0, evStart - lead),
      to: Math.min(horizon, evEnd),
      kind: 'push',
      label: e.name,
      mult: season ? PUSH_SEASON : PUSH_DATED,
      why: season
        ? bi(
          `Mùa ${viOf(e.name)} kéo dài — chạy đều suốt mùa, mở trước ${lead} ngày cho kịp nhịp đặt lịch của tiệm.`,
          `${enOf(e.name)} runs for weeks — hold a steady spend across it, opening ${lead} days early to match how far ahead your customers book.`)
        : bi(
          `Mở trước ${lead} ngày: khách của tiệm đặt lịch trước chừng đó, nên quảng cáo lên đúng ngày lễ là quảng cáo cho những chỗ đã kín.`,
          `Open ${lead} days early: that is how far ahead your customers book, so an ad that goes live on the day itself is an ad for slots already taken.`),
    });
    // The days after. People who wanted it for the occasion have just been in.
    if (!season && evEnd + 1 <= horizon) {
      windows.push({
        from: evEnd + 1,
        to: Math.min(horizon, evEnd + CUT_DAYS),
        kind: 'cut',
        label: e.name,
        mult: CUT,
        why: bi(
          `Vừa qua ${viOf(e.name)} — người muốn làm móng cho dịp này vừa làm xong. Tiền tiêu mấy ngày này là mua lại khách mình đã phục vụ.`,
          `${enOf(e.name)} has just passed — everyone who wanted nails for it has just had them. Money spent now buys customers you already served.`),
      });
    }
  }

  // One multiplier per day: the loudest window covering it wins, and a cut
  // never overrides a push (the run-up to the next date beats the lull after
  // the last one — which is exactly the case in a busy spring).
  const mult: number[] = new Array(horizon + 1).fill(1);
  const owner: (Window | null)[] = new Array(horizon + 1).fill(null);
  for (const w of windows) {
    for (let d = Math.max(0, w.from); d <= Math.min(horizon, w.to); d += 1) {
      const cur = owner[d];
      const better = !cur
        || (w.kind === 'push' && cur.kind === 'cut')
        || (w.kind === cur.kind && w.mult > cur.mult);
      if (better) { owner[d] = w; mult[d] = w.mult; }
    }
  }

  // Same money, moved: normalise each calendar month back to flat.
  const monthOf = (d: number) => ymd(addDays(start, d)).slice(0, 7);
  const perMonth = new Map<string, { sum: number; days: number }>();
  for (let d = 0; d <= horizon; d += 1) {
    const k = monthOf(d);
    const m = perMonth.get(k) ?? { sum: 0, days: 0 };
    m.sum += mult[d]; m.days += 1;
    perMonth.set(k, m);
  }
  const daily: number[] = [];
  for (let d = 0; d <= horizon; d += 1) {
    const m = perMonth.get(monthOf(d))!;
    // scale so the month's multipliers average 1 — the plan reallocates.
    daily[d] = Math.round((base * mult[d] * m.days) / m.sum);
  }

  // Runs of equal (kind, daily) become one period a person can read.
  const periods: BudgetPeriod[] = [];
  for (let d = 0; d <= horizon; d += 1) {
    const kind: PeriodKind = owner[d]?.kind ?? 'base';
    const last = periods[periods.length - 1];
    const sameRun = last && last.kind === kind && last.dailyCents === daily[d]
      && (owner[d]?.label ?? null) === (last.label ?? null);
    if (sameRun) {
      last.to = ymd(addDays(start, d));
      last.days += 1;
      last.totalCents += daily[d];
      continue;
    }
    periods.push({
      from: ymd(addDays(start, d)),
      to: ymd(addDays(start, d)),
      kind,
      days: 1,
      dailyCents: daily[d],
      totalCents: daily[d],
      label: owner[d]?.label ?? null,
      why: owner[d]?.why ?? bi(
        'Nhịp nền: giữ đều để luôn có mặt khi người ta tìm, và để nền tảng không phải học lại từ đầu mỗi lần bật.',
        'The steady rhythm: enough to be there when somebody searches, and enough that the platform is not learning from scratch every time it comes back on.'),
    });
  }

  // Month totals come from the day array, never from the periods: a period
  // that straddles the first of the month belongs to both, and splitting it
  // by its start date is how a budget report quietly stops adding up.
  const monthTotal = new Map<string, number>();
  for (let d = 0; d <= horizon; d += 1) {
    const k = monthOf(d);
    monthTotal.set(k, (monthTotal.get(k) ?? 0) + daily[d]);
  }
  const months: AdsMonth[] = [...perMonth.entries()].map(([month, m]) => ({
    month,
    totalCents: monthTotal.get(month) ?? 0,
    flatCents: base * m.days,
    days: m.days,
  }));

  const diary = periods
    .filter((p) => p.kind === 'push' && p.label)
    .map((p) => ({
      on: p.from,
      label: p.label!,
      line: bi(
        `Nâng lên ${money(p.dailyCents)}/ngày cho ${viOf(p.label!)} — chạy tới ${p.to}.`,
        `Raise to ${money(p.dailyCents)}/day for ${enOf(p.label!)} — through ${p.to}.`),
    }));

  const pushes = periods.filter((p) => p.kind === 'push').length;
  return {
    baseDailyCents: base,
    periods,
    months,
    diary,
    plain: pushes
      ? bi(
        `Cùng số tiền, đặt đúng chỗ: nền ${money(base)}/ngày, dồn lên trước mỗi dịp và hạ xuống ngay sau đó. Mỗi tháng vẫn tiêu đúng bằng mức chia đều — chỉ khác chỗ tiêu.`,
        `The same money, better placed: ${money(base)}/day as the floor, more in the run-up to each occasion and less straight after it. The month still costs what a flat budget cost — only the placement changes.`)
      : bi(
        `Không có dịp nào trong 90 ngày tới, nên giữ đều ${money(base)}/ngày. Đừng dồn tiền vào một tuần khi không có lý do gì để dồn.`,
        `Nothing is coming in the next 90 days, so hold ${money(base)}/day steady. There is no reason to bunch the money and no occasion to bunch it around.`),
  };
}
