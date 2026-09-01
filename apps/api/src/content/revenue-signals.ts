/**
 * Where this salon's money is actually leaking — read from its own booking book.
 *
 * Content advice is table stakes; every AI tool writes captions. What none of
 * them can do is open the salon's appointment book and say "Tuesday afternoon
 * is 22% full and Saturday is 88% — discount the Tuesday, never the Saturday."
 * That sentence is worth more than a month of reels, and it is only possible
 * because the same platform that markets the salon also takes its bookings.
 *
 * The governing principle here is MARGIN FIRST. A discount on a slot that was
 * going to sell anyway is not marketing, it is a refund the salon volunteered.
 * So every function below is built to say "don't" as readily as "do":
 *   - a busy block is explicitly protected from discounting
 *   - discount depth is capped, because deep cuts teach customers to wait
 *   - a salon that is full everywhere is told to RAISE prices, not run offers
 */

import { bi, viOf, enOf, type Txt } from './i18n';

export interface BookingRow {
  /** Local weekday 0=Sunday … 6=Saturday, as seen in the salon's timezone. */
  weekday: number;
  /** Local hour, 0-23. */
  hour: number;
  minutes: number;
  revenueCents: number;
}

export type Block = 'morning' | 'afternoon' | 'evening';

export function blockOf(hour: number): Block {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

export const WEEKDAY_VI = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
export const BLOCK_VI: Record<Block, string> = { morning: 'buổi sáng', afternoon: 'buổi chiều', evening: 'buổi tối' };

/**
 * The English half of a slot label — written the way an owner says it, not
 * translated word for word: "Sat morning", never "Day Seven morning".
 *
 * `WEEKDAY_VI` above stays exported and unchanged: the prompt text and the
 * weekly plan build Vietnamese sentences out of it, and those must stay one
 * language. Only the labels that reach a SCREEN carry both.
 */
const WEEKDAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const BLOCK_EN: Record<Block, string> = { morning: 'morning', afternoon: 'afternoon', evening: 'evening' };

const slotLabel = (weekday: number, block: Block): Txt =>
  bi(`${WEEKDAY_VI[weekday]} ${BLOCK_VI[block]}`, `${WEEKDAY_EN[weekday]} ${BLOCK_EN[block]}`);

export interface SlotLoad {
  weekday: number;
  block: Block;
  minutes: number;
  revenueCents: number;
  /** 0-100, relative to this salon's own busiest block. */
  fillIndex: number;
  /** Shown on screen ("Thứ 3 buổi chiều" / "Tue afternoon"), so it is bilingual. */
  label: Txt;
}

/**
 * How full each weekday-block is, measured against the salon's OWN best block.
 *
 * Deliberately relative. Absolute utilisation would need a reliable chair and
 * staff count per hour, which no salon keeps accurate — and a wrong denominator
 * produces confident nonsense. "Tuesday afternoon runs at a fifth of your
 * Saturday" needs no such assumption and is just as actionable.
 */
export function slotLoads(rows: BookingRow[] | null | undefined): SlotLoad[] {
  const acc = new Map<string, { minutes: number; revenueCents: number }>();
  for (const r of rows ?? []) {
    if (!r || r.weekday < 0 || r.weekday > 6) continue;
    const key = `${r.weekday}|${blockOf(r.hour)}`;
    const cur = acc.get(key) ?? { minutes: 0, revenueCents: 0 };
    cur.minutes += Math.max(0, Number(r.minutes) || 0);
    cur.revenueCents += Math.max(0, Number(r.revenueCents) || 0);
    acc.set(key, cur);
  }
  if (!acc.size) return [];
  const peak = Math.max(...Array.from(acc.values(), (v) => v.minutes), 1);
  return Array.from(acc.entries())
    .map(([key, v]) => {
      const [wd, block] = key.split('|');
      const weekday = Number(wd);
      return {
        weekday,
        block: block as Block,
        minutes: v.minutes,
        revenueCents: v.revenueCents,
        fillIndex: Math.round((v.minutes / peak) * 100),
        label: slotLabel(weekday, block as Block),
      };
    })
    .sort((a, b) => a.fillIndex - b.fillIndex);
}

export interface OfferAdvice {
  /** 'fill-slot' | 'win-back' | 'raise-price' | 'hold' */
  kind: 'fill-slot' | 'win-back' | 'raise-price' | 'hold';
  headline: Txt;
  detail: Txt;
  /** Suggested discount, 0 when the advice is not to discount. */
  discountPct: number;
  /** Blocks the salon must NOT discount — they are already selling. */
  protect: Txt[];
  basis: Txt;
}

/**
 * The discount decision.
 *
 * Four honest outcomes, and three of them are not "run a sale":
 *   raise-price — everything is full; a discount here is pure margin donated
 *   hold        — too little history to advise; say so rather than guess
 *   fill-slot   — there is a genuinely quiet block worth filling
 *   win-back    — the gap is not the calendar, it is customers who stopped coming
 */
export function offerAdvice(input: {
  loads: SlotLoad[];
  lapsedCount?: number;
  minSlotsForAdvice?: number;
}): OfferAdvice {
  const loads = input.loads ?? [];
  const minSlots = input.minSlotsForAdvice ?? 4;
  const lapsed = input.lapsedCount ?? 0;

  if (loads.length < minSlots) {
    return {
      kind: 'hold',
      headline: bi(
        'Chưa đủ dữ liệu đặt lịch để tư vấn khuyến mãi',
        'Not enough booking history yet to advise on an offer'),
      detail: bi(
        'Cần thêm vài tuần đặt lịch qua hệ thống thì mới biết khung giờ nào thật sự trống. Trong lúc đó tập trung vào nội dung và xin đánh giá Google.',
        'It takes a few more weeks of bookings through the system to see which hours are genuinely empty. Until then, put the effort into content and into asking for Google reviews.'),
      discountPct: 0,
      protect: [],
      basis: bi(
        `mới có ${loads.length} khung giờ có dữ liệu`,
        `only ${loads.length} time blocks have any data yet`),
    };
  }

  const quiet = loads.filter((l) => l.fillIndex <= 40);
  const busy = loads.filter((l) => l.fillIndex >= 75).map((l) => l.label);

  if (!quiet.length) {
    return {
      kind: 'raise-price',
      headline: bi(
        'Tiệm đang kín đều — đừng giảm giá',
        'You are busy across the board — do not discount'),
      detail: bi(
        'Không có khung giờ nào dưới 40% so với khung đông nhất. Giảm giá lúc này là tự bớt lãi trên ghế vốn đã có khách. Thay vào đó: cân nhắc tăng giá dịch vụ chủ lực 5–10%, hoặc đẩy dịch vụ cộng thêm (nail art, chăm da tay) để tăng giá trị mỗi lượt.',
        'No time block is running below 40% of your busiest one. A discount right now just takes profit off chairs that were already selling. Do this instead: raise your main service 5–10%, or push add-ons (nail art, hand treatments) so each visit is worth more.'),
      discountPct: 0,
      protect: busy,
      basis: bi(
        'khung thấp nhất vẫn ≥ 40% so với khung đông nhất',
        'even the quietest block runs at 40% or more of the busiest one'),
    };
  }

  // Deepest cut goes to the emptiest block, but never past 20%: a bigger
  // discount does not fill a chair twice, it just teaches regulars to wait
  // for the next sale.
  const target = quiet[0];
  const depth = target.fillIndex <= 15 ? 20 : target.fillIndex <= 25 ? 15 : 10;

  if (lapsed >= 20 && quiet.length <= 2) {
    return {
      kind: 'win-back',
      // A sentence with a number in it is written out whole in each language:
      // the word order around the count is not the same in the two.
      headline: bi(
        `Kéo lại ${lapsed} khách cũ thay vì giảm giá đại trà`,
        `Win back ${lapsed} past customers instead of discounting for everyone`),
      detail: bi(
        `Lịch chỉ trống lác đác (${quiet.map((q) => viOf(q.label)).join(', ')}), nhưng có ${lapsed} khách đã lâu không quay lại. Gửi tin nhắn riêng kèm ưu đãi ${depth}% cho lần tới, hạn 2 tuần — rẻ hơn nhiều so với giảm giá cho cả khách đang đều đặn.`,
        `Only a few gaps on the book (${quiet.map((q) => enOf(q.label)).join(', ')}), but ${lapsed} customers have not been in for a long time. Text them one at a time with ${depth}% off their next visit, good for 2 weeks — far cheaper than cutting the price for the regulars who are already coming in.`),
      discountPct: depth,
      protect: busy,
      basis: bi(
        `${lapsed} khách quá hạn quay lại`,
        `${lapsed} customers overdue for a visit`),
    };
  }

  return {
    kind: 'fill-slot',
    headline: bi(
      `Ưu đãi giờ vàng: ${viOf(target.label)}, giảm ${depth}%`,
      `Off-peak offer: ${depth}% off ${enOf(target.label)}`),
    detail: bi(
      `${viOf(target.label)} chỉ chạy ở mức ${target.fillIndex}% so với khung đông nhất của tiệm. Ưu đãi CHỈ áp cho khung này, đăng story sáng hôm đó và ghim vào tin nhắn tự động.${busy.length ? ` Tuyệt đối không giảm ${busy.slice(0, 2).map(viOf).join(' và ')} — đang gần kín, giảm là mất lãi.` : ''}`,
      `${enOf(target.label)} is running at just ${target.fillIndex}% of your busiest block. Put the offer on that block ONLY, post a story the morning of, and pin it in the auto-reply.${busy.length ? ` Do not discount ${busy.slice(0, 2).map(enOf).join(' or ')} — nearly full already, and cutting there comes straight out of profit.` : ''}`),
    discountPct: depth,
    protect: busy,
    basis: bi(
      `${viOf(target.label)} ở mức ${target.fillIndex}% công suất tương đối`,
      `${enOf(target.label)} sits at ${target.fillIndex}% of relative capacity`),
  };
}

/** Same edit on both languages — for a change that is digits, not words. */
const mapTxt = (t: Txt, f: (s: string) => string): Txt =>
  typeof t === 'string' ? f(t) : bi(f(t.vi), f(t.en));

/**
 * Fold the margin cap back onto a bilingual advice.
 *
 * `capAdvice` in promo-playbook owns the decision and the arithmetic — how deep
 * a cut this salon's margin can actually pay for — and it corrects the advice by
 * MUTATING it, deliberately, so only one copy of the number is ever in
 * circulation. It was written against plain strings, and this advice now speaks
 * two languages, so the caller caps a Vietnamese VIEW of it and hands the result
 * here.
 *
 * What comes back is applied to both sides: the capped figure, the percentage
 * inside the headline (the same digits in either language), and the sentence
 * capAdvice appended — taken verbatim on the Vietnamese side rather than
 * re-derived, because a Vietnamese sentence glued to the end of an English
 * detail line is the whole bug this file is fixing.
 *
 * capAdvice now hands its sentence back in both languages, so pass it through
 * as `view.appended` and the English side carries the same arithmetic the
 * Vietnamese one does. Without it the fallback sentences below still apply —
 * true English, one figure short.
 */
export function applyCapToOffer(
  advice: OfferAdvice,
  view: { discountPct: number; detail: string; appended?: Txt | null },
  grossMarginPct: number | null,
): void {
  const was = advice.discountPct;
  const now = view.discountPct;
  const viBase = viOf(advice.detail);
  const appended = view.detail.length > viBase.length ? view.detail.slice(viBase.length) : '';
  const enTail = enOf(view.appended);

  if (now !== was) {
    advice.discountPct = now;
    advice.headline = mapTxt(advice.headline, (t) => t.replace(`${was}%`, `${now}%`));
    advice.detail = bi(
      viBase + appended,
      enOf(advice.detail) + (enTail
        || ` The discount was brought down from ${was}% to ${now}%: at a gross margin of about ${grossMarginPct}%, a ${was}% cut needs more extra customers than it can realistically bring in.`),
    );
    return;
  }
  // No cap to apply, but the margin was unknown and capAdvice said so.
  if (appended) {
    advice.detail = bi(
      viBase + appended,
      enOf(advice.detail) + (enTail
        || ' No staff commission split has been entered, so there is no way to check whether this discount still leaves a profit.'),
    );
  }
}

// ---- customers who stopped coming ------------------------------------------

export interface LapsedSignal {
  count: number;
  /** Median days since their last visit — how cold the list is. */
  medianDaysAway: number | null;
  /** Rough value if a tenth of them come back once. */
  winBackValueCents: number;
}

/**
 * Customers past their own rhythm.
 *
 * `cycleDays` defaults to 45 — a fill for gel or dipping powder lands around
 * 3–4 weeks, so someone unseen for six weeks has either moved on or forgotten.
 * The value estimate assumes a 10% response, deliberately pessimistic: an
 * owner who is promised more than they get stops believing the next number.
 */
export function lapsedSignal(
  rows: { daysSinceLastVisit: number; avgTicketCents: number }[] | null | undefined,
  opts: { cycleDays?: number; responseRate?: number } = {},
): LapsedSignal {
  const cycle = opts.cycleDays ?? 45;
  const rate = opts.responseRate ?? 0.1;
  const lapsed = (rows ?? []).filter((r) => r && Number(r.daysSinceLastVisit) > cycle);
  if (!lapsed.length) return { count: 0, medianDaysAway: null, winBackValueCents: 0 };
  const days = lapsed.map((r) => Number(r.daysSinceLastVisit)).sort((a, b) => a - b);
  const mid = Math.floor(days.length / 2);
  const median = days.length % 2 ? days[mid] : Math.round((days[mid - 1] + days[mid]) / 2);
  const avgTicket = Math.round(lapsed.reduce((a, r) => a + (Number(r.avgTicketCents) || 0), 0) / lapsed.length);
  return {
    count: lapsed.length,
    medianDaysAway: median,
    winBackValueCents: Math.round(lapsed.length * rate * avgTicket),
  };
}

// ---- which service to push --------------------------------------------------

export interface ServiceYield { name: string; priceCents: number; minutes: number; perHourCents: number }

/**
 * Revenue per chair-hour, not per ticket.
 *
 * A $60 service that takes 90 minutes earns less per chair than a $45 one that
 * takes 40. When the goal is filling a quiet block, the second is the better
 * thing to advertise — and salons almost always promote the first because the
 * sticker price looks bigger.
 */
export function serviceYields(
  services: { name: string; priceCents: number; durationMinutes: number }[] | null | undefined,
  limit = 5,
): ServiceYield[] {
  return (services ?? [])
    .filter((s) => s && Number(s.priceCents) > 0 && Number(s.durationMinutes) > 0)
    .map((s) => ({
      name: s.name,
      priceCents: s.priceCents,
      minutes: s.durationMinutes,
      perHourCents: Math.round((s.priceCents / s.durationMinutes) * 60),
    }))
    .sort((a, b) => b.perHourCents - a.perHourCents)
    .slice(0, limit);
}

// ---- the revenue half of the weekly playbook -------------------------------

export interface RevenueProfile {
  loads: SlotLoad[];
  advice: OfferAdvice;
  lapsed: LapsedSignal;
  yields: ServiceYield[];
}

export function buildRevenueProfile(input: {
  bookings?: BookingRow[] | null;
  customers?: { daysSinceLastVisit: number; avgTicketCents: number }[] | null;
  services?: { name: string; priceCents: number; durationMinutes: number }[] | null;
}): RevenueProfile {
  const loads = slotLoads(input.bookings);
  const lapsed = lapsedSignal(input.customers);
  return {
    loads,
    lapsed,
    advice: offerAdvice({ loads, lapsedCount: lapsed.count }),
    yields: serviceYields(input.services),
  };
}

/**
 * The revenue picture as prompt text — every figure real, none invented.
 *
 * The prompt library is Vietnamese on purpose, so every bilingual phrase is
 * unwrapped with `viOf` on the way in. A `{vi, en}` pair dropped into a template
 * literal prints `[object Object]`, and the model would read exactly that.
 */
export function revenueToPrompt(p: RevenueProfile, money: (cents: number) => string): string {
  const L: string[] = [];
  if (p.loads.length) {
    const quiet = p.loads.slice(0, 3);
    const busy = [...p.loads].reverse().slice(0, 3);
    L.push('CÔNG SUẤT THEO KHUNG GIỜ (so với khung đông nhất của chính tiệm, 4 tuần gần nhất):');
    L.push(`- Trống nhất: ${quiet.map((q) => `${viOf(q.label)} ${q.fillIndex}%`).join(' · ')}`);
    L.push(`- Đông nhất: ${busy.map((q) => `${viOf(q.label)} ${q.fillIndex}%`).join(' · ')}`);
  }
  L.push(`KHUYẾN NGHỊ KHUYẾN MÃI (đã tính sẵn, BÁM THEO, không tự nghĩ mức giảm khác): ${viOf(p.advice.headline)}`);
  L.push(`- Chi tiết: ${viOf(p.advice.detail)}`);
  L.push(`- Căn cứ: ${viOf(p.advice.basis)}`);
  if (p.advice.protect.length) L.push(`- KHÔNG được đề xuất giảm giá cho: ${p.advice.protect.map(viOf).join(', ')}`);
  if (p.lapsed.count) {
    L.push(`KHÁCH LÂU CHƯA QUAY LẠI: ${p.lapsed.count} người, trung vị ${p.lapsed.medianDaysAway} ngày. Nếu 10% quay lại một lần, ước tính thu về ${money(p.lapsed.winBackValueCents)}.`);
  }
  if (p.yields.length) {
    L.push('DỊCH VỤ SINH LỜI CAO NHẤT TRÊN MỖI GIỜ GHẾ (đẩy cái này khi cần lấp khung trống):');
    for (const y of p.yields) L.push(`- ${y.name}: ${money(y.priceCents)} / ${y.minutes} phút = ${money(y.perHourCents)}/giờ`);
  }
  return L.join('\n');
}
