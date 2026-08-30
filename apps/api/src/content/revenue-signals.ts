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

export interface SlotLoad {
  weekday: number;
  block: Block;
  minutes: number;
  revenueCents: number;
  /** 0-100, relative to this salon's own busiest block. */
  fillIndex: number;
  label: string;
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
        label: `${WEEKDAY_VI[weekday]} ${BLOCK_VI[block as Block]}`,
      };
    })
    .sort((a, b) => a.fillIndex - b.fillIndex);
}

export interface OfferAdvice {
  /** 'fill-slot' | 'win-back' | 'raise-price' | 'hold' */
  kind: 'fill-slot' | 'win-back' | 'raise-price' | 'hold';
  headline: string;
  detail: string;
  /** Suggested discount, 0 when the advice is not to discount. */
  discountPct: number;
  /** Blocks the salon must NOT discount — they are already selling. */
  protect: string[];
  basis: string;
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
      headline: 'Chưa đủ dữ liệu đặt lịch để tư vấn khuyến mãi',
      detail: 'Cần thêm vài tuần đặt lịch qua hệ thống thì mới biết khung giờ nào thật sự trống. Trong lúc đó tập trung vào nội dung và xin đánh giá Google.',
      discountPct: 0,
      protect: [],
      basis: `mới có ${loads.length} khung giờ có dữ liệu`,
    };
  }

  const quiet = loads.filter((l) => l.fillIndex <= 40);
  const busy = loads.filter((l) => l.fillIndex >= 75).map((l) => l.label);

  if (!quiet.length) {
    return {
      kind: 'raise-price',
      headline: 'Tiệm đang kín đều — đừng giảm giá',
      detail: 'Không có khung giờ nào dưới 40% so với khung đông nhất. Giảm giá lúc này là tự bớt lãi trên ghế vốn đã có khách. Thay vào đó: cân nhắc tăng giá dịch vụ chủ lực 5–10%, hoặc đẩy dịch vụ cộng thêm (nail art, chăm da tay) để tăng giá trị mỗi lượt.',
      discountPct: 0,
      protect: busy,
      basis: 'khung thấp nhất vẫn ≥ 40% so với khung đông nhất',
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
      headline: `Kéo lại ${lapsed} khách cũ thay vì giảm giá đại trà`,
      detail: `Lịch chỉ trống lác đác (${quiet.map((q) => q.label).join(', ')}), nhưng có ${lapsed} khách đã lâu không quay lại. Gửi tin nhắn riêng kèm ưu đãi ${depth}% cho lần tới, hạn 2 tuần — rẻ hơn nhiều so với giảm giá cho cả khách đang đều đặn.`,
      discountPct: depth,
      protect: busy,
      basis: `${lapsed} khách quá hạn quay lại`,
    };
  }

  return {
    kind: 'fill-slot',
    headline: `Ưu đãi giờ vàng: ${target.label}, giảm ${depth}%`,
    detail: `${target.label} chỉ chạy ở mức ${target.fillIndex}% so với khung đông nhất của tiệm. Ưu đãi CHỈ áp cho khung này, đăng story sáng hôm đó và ghim vào tin nhắn tự động.${busy.length ? ` Tuyệt đối không giảm ${busy.slice(0, 2).join(' và ')} — đang gần kín, giảm là mất lãi.` : ''}`,
    discountPct: depth,
    protect: busy,
    basis: `${target.label} ở mức ${target.fillIndex}% công suất tương đối`,
  };
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

/** The revenue picture as prompt text — every figure real, none invented. */
export function revenueToPrompt(p: RevenueProfile, money: (cents: number) => string): string {
  const L: string[] = [];
  if (p.loads.length) {
    const quiet = p.loads.slice(0, 3);
    const busy = [...p.loads].reverse().slice(0, 3);
    L.push('CÔNG SUẤT THEO KHUNG GIỜ (so với khung đông nhất của chính tiệm, 4 tuần gần nhất):');
    L.push(`- Trống nhất: ${quiet.map((q) => `${q.label} ${q.fillIndex}%`).join(' · ')}`);
    L.push(`- Đông nhất: ${busy.map((q) => `${q.label} ${q.fillIndex}%`).join(' · ')}`);
  }
  L.push(`KHUYẾN NGHỊ KHUYẾN MÃI (đã tính sẵn, BÁM THEO, không tự nghĩ mức giảm khác): ${p.advice.headline}`);
  L.push(`- Chi tiết: ${p.advice.detail}`);
  L.push(`- Căn cứ: ${p.advice.basis}`);
  if (p.advice.protect.length) L.push(`- KHÔNG được đề xuất giảm giá cho: ${p.advice.protect.join(', ')}`);
  if (p.lapsed.count) {
    L.push(`KHÁCH LÂU CHƯA QUAY LẠI: ${p.lapsed.count} người, trung vị ${p.lapsed.medianDaysAway} ngày. Nếu 10% quay lại một lần, ước tính thu về ${money(p.lapsed.winBackValueCents)}.`);
  }
  if (p.yields.length) {
    L.push('DỊCH VỤ SINH LỜI CAO NHẤT TRÊN MỖI GIỜ GHẾ (đẩy cái này khi cần lấp khung trống):');
    for (const y of p.yields) L.push(`- ${y.name}: ${money(y.priceCents)} / ${y.minutes} phút = ${money(y.perHourCents)}/giờ`);
  }
  return L.join('\n');
}
