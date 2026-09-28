/**
 * A promotion plan for ONE salon — not a list of promotions for every salon.
 *
 * WHAT WAS WRONG BEFORE
 *
 * The Customers & offers tab printed the same eight plays, in the same order,
 * with the same example numbers, for a $25 walk-in shop in Ohio, a $70 nail
 * studio in Manhattan, a brand-new salon in Sydney and a busy tiệm in Sài Gòn.
 * An owner reading it learnt nothing about her own shop, and the team had to
 * redo the thinking by hand every time a client asked "nên chạy khuyến mãi gì?".
 *
 * WHAT THIS DOES INSTEAD
 *
 *   1. Reads the shop: its own price for its main service against the local
 *      going rate, how full its book is, how many customers come back, how
 *      many have drifted away, how big it is, how crowded the street is, and
 *      what gift occasion is coming.
 *   2. Works out what ONE visit actually leaves the owner after the tech's
 *      share, supplies and card fees — the number every offer is checked
 *      against.
 *   3. Scores each programme against that picture and keeps the best three,
 *      each with a concrete offer in the shop's own currency and the money
 *      said plainly: "each customer who uses this still leaves you $9
 *      (normally $14)".
 *
 * THE RULE THAT CANNOT BE BROKEN: NO PROGRAMME LOSES MONEY ON THE VISIT
 *
 * Every figure assumes the OWNER absorbs the whole concession and still pays
 * the tech's share on the full menu price — the least favourable split there
 * is. If the tech shares the discount (commission on the price actually
 * charged, which is common) the real result is only better. Any programme that
 * would leave a visit at or below zero under that assumption is dropped, not
 * warned about. The spec checks this for every market and every salon shape.
 *
 * WHERE THE BENCHMARKS COME FROM (kept deliberately conservative)
 *
 *   - Tech share: 40-60% in US nail salons, 45-50% the common anchor; VN shops
 *     typically split 60/40. Used only when the shop has not entered its own.
 *   - Supplies: a gel manicure uses roughly $1-3 of product on a $35-50
 *     service, so 7% of price; add-ons run at 85-95% margin, so 12%.
 *   - Deal customers: in the Rice University daily-deal study only ~20% came
 *     back at full price — so a first-visit offer must pay for itself on the
 *     first visit, never "on the next one".
 *   - Gift cards: 10-19% of US gift card value is never redeemed, and people
 *     who do redeem tend to spend over the card.
 *   - Referrals: referred customers were ~18% less likely to leave and ~16%
 *     more valuable (Schmitt, Skiera & Van den Bulte, Journal of Marketing).
 */

import { bi, enOf, viOf, type Txt } from './i18n';
import type { SlotLoad } from './revenue-signals';

// ---- benchmarks -----------------------------------------------------------

type MarketCode = 'US' | 'CA' | 'AU' | 'VN';

interface MarketEcon {
  /** Tech share assumed when the shop has not entered one, percent. */
  assumedCommission: number;
  /** Card processing, as a share of what the customer pays. */
  cardFee: number;
  /** A typical price for a main nail service here, in MAJOR units. */
  coreRef: number;
  /** A gift card face value customers recognise, MAJOR units. */
  giftCard: number;
  /** Round every figure a customer sees to this many MAJOR units. */
  step: number;
}

const ECON: Record<MarketCode, MarketEcon> = {
  // Conservative on purpose: a higher assumed share makes every offer look
  // more expensive, never cheaper.
  US: { assumedCommission: 55, cardFee: 0.03, coreRef: 40, giftCard: 100, step: 1 },
  CA: { assumedCommission: 55, cardFee: 0.025, coreRef: 45, giftCard: 100, step: 1 },
  AU: { assumedCommission: 50, cardFee: 0.018, coreRef: 55, giftCard: 100, step: 1 },
  VN: { assumedCommission: 45, cardFee: 0.005, coreRef: 180_000, giftCard: 1_000_000, step: 10_000 },
};

/** Supplies used by a main service, as a share of its price. */
export const SUPPLY_SHARE = 0.07;
/** Supplies used by a small add-on, as a share of its price. */
export const ADDON_SUPPLY_SHARE = 0.12;
/** US median household income (ACS 2019-2023), for the local price level. */
const US_MEDIAN_INCOME = 78_500;
/**
 * The most a discount may take off one visit's profit.
 *
 * Keeping at least ~71% of it is the same rule the break-even card has always
 * used (no discount that needs more than 40% extra visits to pay for itself),
 * now applied to the profit AFTER supplies and card fees rather than before.
 */
const KEEP_AFTER_DISCOUNT = 1 / 1.4;

const BEAUTY = new Set(['SALON', 'NAIL', 'HAIR', 'LASH', 'BROW', 'SPA', 'MASSAGE', 'PMU', 'SERVICE']);

/** Is this a trade the strategy speaks for? Food and real estate keep their own plays. */
export function strategyApplies(industry?: string | null): boolean {
  return BEAUTY.has(String(industry || 'SALON').toUpperCase());
}

function marketOf(m?: string | null): MarketCode {
  const c = String(m || 'US').toUpperCase();
  return (c === 'CA' || c === 'AU' || c === 'VN') ? c : 'US';
}

// ---- input / output -------------------------------------------------------

export interface StrategyInput {
  market?: string | null;
  /** Minor units per major unit: 100 for dollars, 1 for đồng. */
  unit: number;
  money: (minor: number) => string;
  industry?: string | null;
  /** The tech share the shop has on file, and where it came from. */
  commission: { pct: number | null; source: 'entered' | 'staff' | 'assumed' | 'unknown' };
  menu: { name: string; priceCents: number; durationMinutes: number }[];
  /** Bookings per service over the last month. */
  popular?: { name: string; count: number }[];
  /** A year of visits, one row per appointment with a known customer. */
  visits?: { customerId: string; at: number; priceCents: number }[];
  now: number;
  loads?: SlotLoad[];
  /** Minutes booked and appointments over the last four weeks. */
  bookedMinutes4w?: number;
  bookings4w?: number;
  chairs?: number | null;
  openMinutesPerWeek?: number | null;
  /** US only: weighted median household income around the shop. */
  areaMedianIncomeUsd?: number | null;
  /** Shops in the same trade nearby, from the monthly Google scan. */
  rivals?: number | null;
  events?: { name: Txt; note?: Txt; daysAway: number }[];
  /** Days since the salon started on the platform (or its first booking). */
  salonAgeDays?: number | null;
  /** Share of bookings that walked in (0-1), when known. */
  walkInShare?: number | null;
}

export type ProgramKey =
  | 'quiet' | 'gift' | 'first' | 'rebook' | 'referral' | 'winback' | 'prepaid' | 'combo' | 'raise';

export interface StrategyProgram {
  key: ProgramKey;
  /** 'main' is the one to start with; 'support' runs beside it. */
  role: 'main' | 'support';
  title: Txt;
  /** The line a customer reads — ready to post. */
  offer: Txt;
  /** Why THIS shop, in its own numbers. */
  why: Txt;
  /** The money, in one or two plain sentences. */
  money: Txt;
  /** The fences that keep it profitable. */
  rules: Txt[];
  /** When to stop. */
  stopIf: Txt;
  /** Profit left on one visit that uses the offer, vs a normal visit (minor units). */
  profitPerUse: number;
  normalProfit: number;
  discountPct: number;
  score: number;
}

export interface StrategyFact {
  key: 'price' | 'area' | 'book' | 'customers' | 'profit' | 'season' | 'model';
  label: Txt;
  value: Txt;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
}

export interface PromoStrategy {
  headline: Txt;
  facts: StrategyFact[];
  programs: StrategyProgram[];
  avoid: Txt[];
  /** The deepest % off this shop's main service that still keeps ~71% of the visit's profit. */
  maxSafePct: number;
  /** What one normal visit of the main service leaves the owner. */
  profitPerVisit: number;
  corePriceCents: number;
  coreName: string | null;
  /** How the numbers were worked out, in one line. */
  basis: Txt;
  /** What is missing, and what filling it in would change. */
  missing: Txt[];
}

// ---- small helpers ----------------------------------------------------------

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const HAND = /mani|gel\b|gel |shellac|acrylic|dip|builder|biab|full set|fill|nail|tay|móng tay|sơn gel|úp|đắp/i;
const FOOT = /pedi|foot|feet|chân|móng chân/i;
const ADDON = /art|design|french|chrome|cat ?eye|ombre|gem|stone|charm|sticker|paraffin|massage|scrub|mask|callus|polish change|vẽ|đính|trang trí|ẩn xà cừ|mắt mèo|tráng gương|dưỡng|paraffin|tẩy|mặt nạ|massage|ngâm/i;

function median(ns: number[]): number | null {
  if (!ns.length) return null;
  const s = [...ns].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export interface Econ {
  /** Tech share, 0-1. */
  c: number;
  /** Card fee, 0-1. */
  f: number;
  /** Supplies, 0-1. */
  s: number;
}

/**
 * What one visit leaves the owner, at a discount d (0-1).
 *
 * Owner absorbs the whole discount; the tech is still paid on the menu price.
 * Supplies are used whatever the customer paid; the card fee is charged on
 * what they paid.
 */
export function visitProfit(price: number, e: Econ, d = 0): number {
  return price * (1 - d) * (1 - e.f) - price * e.c - price * e.s;
}

/** Deepest discount in 5% steps that keeps at least `keep` of a visit's profit. */
export function maxSafeDiscount(price: number, e: Econ, keep = KEEP_AFTER_DISCOUNT): number {
  const base = visitProfit(price, e);
  if (base <= 0) return 0;
  for (const d of [30, 25, 20, 15, 10, 5]) {
    if (visitProfit(price, e, d / 100) >= base * keep) return d;
  }
  return 0;
}

// ---- reading the shop ---------------------------------------------------------

type Busy = 'unknown' | 'low' | 'mid' | 'high' | 'full';
type PriceTier = 'budget' | 'mid' | 'premium';
type Stage = 'new' | 'growing' | 'established';

interface Picture {
  mk: MarketCode;
  econ: MarketEcon;
  e: Econ;
  commissionPct: number;
  commissionSource: StrategyInput['commission']['source'];
  core: number;
  coreName: string | null;
  C0: number;
  maxSafe: number;
  tier: PriceTier;
  refPrice: number;
  incomeRatio: number | null;
  busy: Busy;
  util: number | null;
  quiet: SlotLoad[];
  busyBlocks: SlotLoad[];
  stage: Stage;
  customers: number;
  repeatRate: number | null;
  lapsed: number;
  gapDays: number | null;
  avgTicket: number;
  addon: { name: string; price: number; real: boolean } | null;
  hand: { name: string; price: number } | null;
  foot: { name: string; price: number } | null;
  giftEvent: { name: Txt; daysAway: number } | null;
  rivals: number | null;
  chairs: number | null;
  walkIn: boolean;
  round: (minor: number, dir?: 'down' | 'up' | 'near') => number;
}

function read(input: StrategyInput): Picture {
  const mk = marketOf(input.market);
  const econ = ECON[mk];
  const unit = Math.max(1, input.unit || 100);
  const stepMinor = econ.step * unit;
  const round = (minor: number, dir: 'down' | 'up' | 'near' = 'down') => {
    const q = minor / stepMinor;
    const r = dir === 'up' ? Math.ceil(q) : dir === 'near' ? Math.round(q) : Math.floor(q);
    return Math.max(0, r) * stepMinor;
  };

  const known = input.commission.source === 'entered' || input.commission.source === 'staff';
  const commissionPct = known && input.commission.pct ? clamp(input.commission.pct, 1, 95) : econ.assumedCommission;
  const e: Econ = { c: commissionPct / 100, f: econ.cardFee, s: SUPPLY_SHARE };

  // ---- the main service: what most customers actually buy ----
  const menu = (input.menu ?? []).filter((m) => m && m.priceCents > 0);
  const byName = new Map(menu.map((m) => [m.name.trim().toLowerCase(), m]));
  const popular = [...(input.popular ?? [])].sort((a, b) => b.count - a.count);
  let coreItem = popular.map((p) => byName.get(p.name.trim().toLowerCase())).find((m) => m && m.durationMinutes >= 20) ?? null;
  if (!coreItem) {
    const mains = menu.filter((m) => m.durationMinutes >= 25 && !ADDON.test(m.name));
    const pool = mains.length ? mains : menu;
    const med = median(pool.map((m) => m.priceCents));
    coreItem = med === null ? null : [...pool].sort((a, b) => Math.abs(a.priceCents - med) - Math.abs(b.priceCents - med))[0];
  }

  // ---- the book ----
  const visits = (input.visits ?? []).filter((v) => v && v.customerId);
  const recentPaid = visits.filter((v) => v.priceCents > 0 && input.now - v.at <= 90 * 86_400_000);
  const avgFromBook = recentPaid.length >= 10
    ? Math.round(recentPaid.reduce((a, v) => a + v.priceCents, 0) / recentPaid.length)
    : null;
  const core = coreItem?.priceCents ?? avgFromBook ?? econ.coreRef * unit;
  const avgTicket = avgFromBook ?? core;

  const C0 = visitProfit(core, e);
  const maxSafe = maxSafeDiscount(core, e);

  // ---- price level against the local going rate ----
  const income = typeof input.areaMedianIncomeUsd === 'number' && input.areaMedianIncomeUsd > 0 ? input.areaMedianIncomeUsd : null;
  const incomeRatio = mk === 'US' && income ? income / US_MEDIAN_INCOME : null;
  const refPrice = econ.coreRef * unit * (incomeRatio ? clamp(incomeRatio, 0.8, 1.4) : 1);
  const ratio = core / refPrice;
  const tier: PriceTier = ratio < 0.82 ? 'budget' : ratio > 1.25 ? 'premium' : 'mid';

  // ---- how full the book is ----
  const loads = input.loads ?? [];
  const chairs = input.chairs && input.chairs > 0 ? input.chairs : null;
  const open = input.openMinutesPerWeek && input.openMinutesPerWeek > 0 ? input.openMinutesPerWeek : null;
  const enough = (input.bookings4w ?? 0) >= 30;
  const util = enough && chairs && open ? clamp((input.bookedMinutes4w ?? 0) / (chairs * open * 4), 0, 1.5) : null;
  const busy: Busy = util === null ? 'unknown' : util < 0.35 ? 'low' : util < 0.65 ? 'mid' : util < 0.85 ? 'high' : 'full';
  const quiet = loads.length >= 4 ? loads.filter((l) => l.fillIndex <= 40).slice(0, 2) : [];
  const busyBlocks = loads.length >= 4 ? [...loads].reverse().filter((l) => l.fillIndex >= 75).slice(0, 2) : [];

  // ---- the customers ----
  const first = new Map<string, number>();
  const last = new Map<string, number>();
  const count = new Map<string, number>();
  const times = new Map<string, number[]>();
  for (const v of visits) {
    first.set(v.customerId, Math.min(first.get(v.customerId) ?? v.at, v.at));
    last.set(v.customerId, Math.max(last.get(v.customerId) ?? 0, v.at));
    count.set(v.customerId, (count.get(v.customerId) ?? 0) + 1);
    const t = times.get(v.customerId) ?? []; t.push(v.at); times.set(v.customerId, t);
  }
  const customers = first.size;
  const seasoned = Array.from(first.entries()).filter(([, at]) => input.now - at >= 60 * 86_400_000);
  const repeatRate = seasoned.length >= 15
    ? seasoned.filter(([id]) => (count.get(id) ?? 0) >= 2).length / seasoned.length
    : null;
  const gaps: number[] = [];
  for (const t of times.values()) {
    if (t.length < 2) continue;
    t.sort((a, b) => a - b);
    for (let i = 1; i < t.length; i++) gaps.push((t[i] - t[i - 1]) / 86_400_000);
  }
  const gapDays = gaps.length >= 10 ? Math.round(median(gaps) as number) : null;
  const lapseAfter = Math.max(45, (gapDays ?? 28) * 2);
  const lapsed = Array.from(last.values()).filter((at) => {
    const d = (input.now - at) / 86_400_000;
    return d > lapseAfter && d <= 365;
  }).length;

  const age = input.salonAgeDays ?? null;
  const stage: Stage = (age !== null && age < 120) || customers < 30 ? 'new' : customers < 150 ? 'growing' : 'established';

  // ---- what the menu can give away ----
  const addons = menu
    .filter((m) => m.priceCents <= core * 0.4 && (m.durationMinutes <= 20 || ADDON.test(m.name)) && m.priceCents >= core * 0.08)
    .sort((a, b) => b.priceCents - a.priceCents);
  const pickAddon = addons.find((a) => a.priceCents <= core * 0.3) ?? addons[addons.length - 1] ?? null;
  const addon = pickAddon
    ? { name: pickAddon.name, price: pickAddon.priceCents, real: true }
    : { name: '', price: round(core * 0.12, 'near') || econ.step * unit, real: false };
  const hands = menu.filter((m) => HAND.test(m.name) && !FOOT.test(m.name) && m.durationMinutes >= 20);
  const feet = menu.filter((m) => FOOT.test(m.name) && m.durationMinutes >= 20);
  const pickNear = (list: typeof menu) => {
    if (!list.length) return null;
    const med = median(list.map((m) => m.priceCents)) as number;
    const it = [...list].sort((a, b) => Math.abs(a.priceCents - med) - Math.abs(b.priceCents - med))[0];
    return { name: it.name, price: it.priceCents };
  };

  const giftRe = /gift card|valentine|mother|christmas|black friday|lunar new year|tết|women|phụ nữ|20\/10|8\/3|nhà giáo/i;
  const giftEvent = (input.events ?? [])
    .filter((ev) => ev.daysAway >= 0 && ev.daysAway <= 45 && giftRe.test(`${enOf(ev.name)} ${viOf(ev.name)} ${enOf(ev.note)} ${viOf(ev.note)}`))
    .sort((a, b) => a.daysAway - b.daysAway)[0] ?? null;

  return {
    mk, econ, e, commissionPct, commissionSource: input.commission.source,
    core, coreName: coreItem?.name ?? null, C0, maxSafe, tier, refPrice, incomeRatio,
    busy, util, quiet, busyBlocks, stage, customers, repeatRate, lapsed, gapDays, avgTicket,
    addon, hand: pickNear(hands), foot: pickNear(feet),
    giftEvent: giftEvent ? { name: giftEvent.name, daysAway: giftEvent.daysAway } : null,
    rivals: typeof input.rivals === 'number' ? input.rivals : null,
    chairs, walkIn: (input.walkInShare ?? 0) >= 0.5, round,
  };
}

// ---- the programmes -----------------------------------------------------------

type Draft = Omit<StrategyProgram, 'role'>;

const pct = (n: number) => `${Math.round(n)}%`;
const cap = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

function blocksLabel(p: Picture): Txt {
  if (p.quiet.length) {
    return bi(p.quiet.map((q) => viOf(q.label)).join(' và '), p.quiet.map((q) => enOf(q.label)).join(' and '));
  }
  return bi('Thứ 2 – Thứ 4, trước 1 giờ chiều', 'Monday to Wednesday before 1pm');
}

function quietProgram(p: Picture, m: StrategyInput['money']): Draft | null {
  if (p.busy === 'full' || p.maxSafe < 10 || p.C0 <= 0) return null;
  const d = p.maxSafe;
  const now = visitProfit(p.core, p.e, d / 100);
  if (now <= 0) return null;
  const lost = p.C0 - now;
  const cover = Math.max(1, Math.ceil(lost / now));
  const blocks = blocksLabel(p);
  const real = p.quiet.length > 0;
  let score = p.busy === 'mid' || p.busy === 'high' ? 78 : p.busy === 'low' ? 50 : 38;
  if (real) score += 6;
  if ((p.chairs ?? 0) >= 8) score += 5;
  const sale = p.round(p.core * (1 - d / 100), 'up');
  const coreName = p.coreName ?? 'dịch vụ chính';
  const coreNameEn = p.coreName ?? 'the main service';
  return {
    key: 'quiet', score, discountPct: d, profitPerUse: Math.round(now), normalProfit: Math.round(p.C0),
    title: bi(`Giờ vắng: giảm ${d}% chỉ ${viOf(blocks)}`, `Quiet hours: ${d}% off, ${enOf(blocks)} only`),
    offer: bi(
      `Giảm ${d}% khi đặt ${viOf(blocks)} — ví dụ ${coreName} ${m(p.core)} còn ${m(sale)}.`,
      `${d}% off when you book ${enOf(blocks)} — e.g. ${coreNameEn} ${m(p.core)}, now ${m(sale)}.`),
    why: real
      ? bi(
        `${viOf(blocks)} chỉ đạt ${p.quiet.map((q) => pct(q.fillIndex)).join(' / ')} so với giờ đông nhất của tiệm. Ghế đang trống, thợ vẫn phải có mặt.`,
        `${enOf(blocks)} run at ${p.quiet.map((q) => pct(q.fillIndex)).join(' / ')} of your busiest hours. The chairs sit empty while the techs are there anyway.`)
      : bi(
        'Chưa đủ lịch trên hệ thống để biết giờ nào vắng, nên bắt đầu với đầu tuần buổi sáng — khung vắng nhất ở phần lớn tiệm nail. Sau 4 tuần hệ thống sẽ tự đổi sang giờ vắng thật của tiệm.',
        'There is not enough booking history yet to see your quiet hours, so start with weekday mornings early in the week — the quietest stretch at most nail salons. After four weeks the system switches to your real quiet hours.'),
    money: bi(
      `Mỗi khách dùng ưu đãi tiệm vẫn lời ~${m(now)} (bình thường ${m(p.C0)}). Khách mới lấp ghế trống là lời thêm trọn ${m(now)}. Chỉ thiệt khi khách quen dời từ giờ đông sang: mỗi người như vậy cần ${cover} khách mới để bù.`,
      `Each customer who uses it still leaves you about ${m(now)} (normally ${m(p.C0)}). A new customer in an empty chair is ${m(now)} you would not have had. The only loss is a regular moving over from a busy hour: each one takes ${cover} new customer${cover > 1 ? 's' : ''} to cover.`),
    rules: [
      bi(`Chỉ áp ${viOf(blocks)}. Ghi rõ giờ trên bài đăng và tin nhắn tự động.`, `${enOf(blocks)} only. Put the hours in every post and in the auto-reply.`),
      ...(p.busyBlocks.length
        ? [bi(`Không bao giờ áp cho ${p.busyBlocks.map((b) => viOf(b.label)).join(', ')} — giờ đó đã đông.`, `Never on ${p.busyBlocks.map((b) => enOf(b.label)).join(', ')} — those hours already sell.`)]
        : []),
      bi(`Không cộng dồn với ưu đãi khác; tối đa ${d}%.`, `Not stackable with other offers; ${d}% is the cap.`),
    ],
    stopIf: bi(
      'Chạy 3 tuần. Nếu khung giờ đó không thêm được ít nhất 3 khách mỗi tuần → dừng, đổi sang "tặng dịch vụ nhỏ" cho cùng khung giờ.',
      'Run it for 3 weeks. If those hours do not gain at least 3 customers a week, stop and switch to "a small free add-on" for the same hours.'),
  };
}

function giftProgram(p: Picture, m: StrategyInput['money']): Draft | null {
  if (!p.addon || p.C0 <= 0) return null;
  const A = p.addon.price;
  const cost = A * (p.e.c + ADDON_SUPPLY_SHARE);
  const keep = p.C0 - cost;
  if (keep <= p.C0 * 0.35) return null;
  let score = p.tier === 'premium' ? 74 : p.tier === 'mid' ? 64 : 46;
  if (p.stage === 'new') score += 6;
  if (p.busy === 'full') score = 12;
  if (p.busy === 'low' || p.busy === 'unknown') score += 3;
  const name = p.addon.real ? p.addon.name : 'vẽ nghệ thuật 2 móng';
  const nameEn = p.addon.real ? p.addon.name : 'art on two nails';
  const coreName = p.coreName ?? 'dịch vụ chính';
  const coreNameEn = p.coreName ?? 'any main service';
  const straight = A * (1 - p.e.f);
  return {
    key: 'gift', score, discountPct: 0, profitPerUse: Math.round(keep), normalProfit: Math.round(p.C0),
    title: bi(`Tặng ${name} thay vì giảm giá`, `A free ${nameEn} instead of a discount`),
    offer: bi(
      `Làm ${coreName} được tặng ${name} (trị giá ${m(A)}) — trong 2 tuần.`,
      `Book ${coreNameEn} and get ${nameEn} free (worth ${m(A)}) — for two weeks.`),
    why: p.tier === 'premium'
      ? bi(
        `Giá của tiệm cao hơn mặt bằng khu vực (~${m(p.refPrice)}). Giảm giá làm khách nghĩ tiệm "hạ cấp"; quà tặng giữ nguyên giá trị thương hiệu.`,
        `Your prices sit above the local going rate (~${m(p.refPrice)}). A discount makes a premium shop look cheaper; a gift keeps the price where it is.`)
      : bi(
        'Khách nhớ một món quà lâu hơn một con số % — và tiệm không phải hạ giá niêm yết.',
        'People remember a gift longer than a percentage — and the menu price never moves.'),
    money: bi(
      `Khách thấy được tặng ${m(A)}, tiệm chỉ tốn ~${m(cost)} (vật tư + % thợ) → vẫn lời ~${m(keep)} mỗi khách. Nếu giảm thẳng ${m(A)} thì tiệm mất ~${m(straight)}.`,
      `The customer sees ${m(A)} free; it costs you about ${m(cost)} (supplies + the tech's share), so you still keep about ${m(keep)} a visit. Taking ${m(A)} off the price would cost about ${m(straight)}.`),
    rules: [
      bi('Chỉ tặng kèm dịch vụ chính, không đổi thành tiền, không cộng dồn.', 'Only with a main service, no cash value, not stackable.'),
      bi('Có ngày kết thúc rõ ràng (2 tuần) để khách không chờ đợt sau.', 'A clear end date (two weeks) so nobody learns to wait for the next one.'),
      ...(p.addon.real ? [] : [bi('Thêm món nhỏ này vào menu trên hệ thống để giá trị và chi phí được tính đúng.', 'Add this small service to your menu in the system so its value and cost are exact.')]),
    ],
    stopIf: bi(
      'Nếu sau 2 tuần số lượt không tăng so với 2 tuần trước → dừng; đừng kéo dài thành "tặng mãi mãi".',
      'If visits are no higher than the two weeks before, stop — do not let it turn into a permanent freebie.'),
  };
}

function firstProgram(p: Picture, m: StrategyInput['money']): Draft | null {
  if (p.C0 <= 0 || p.busy === 'full') return null;
  let score = p.stage === 'new' ? 80 : p.stage === 'growing' ? 56 : 30;
  if (p.repeatRate !== null && p.repeatRate < 0.3) score -= 25;
  if ((p.chairs ?? 0) >= 8) score += 5;
  if (p.chairs !== null && p.chairs <= 2) score -= 5;
  if (p.rivals !== null && p.rivals >= 12) score += 4;
  // A premium shop gives a gift; everyone else a round amount off. Either
  // way the FIRST visit must still make money — only ~1 in 5 deal customers
  // ever comes back at full price.
  const giftIt = p.tier === 'premium' && p.addon;
  const F = giftIt ? 0 : p.round(Math.min(p.C0 * 0.45, p.core * 0.2), 'down');
  const cost = giftIt ? (p.addon as { price: number }).price * (p.e.c + ADDON_SUPPLY_SHARE) : F * (1 - p.e.f);
  if (!giftIt && F <= 0) return null;
  const keep = p.C0 - cost;
  if (keep <= 0) return null;
  const addonName = p.addon?.real ? p.addon.name : 'vẽ nghệ thuật 2 móng';
  const addonNameEn = p.addon?.real ? p.addon.name : 'art on two nails';
  return {
    key: 'first', score, discountPct: giftIt ? 0 : Math.round((F / p.core) * 100), profitPerUse: Math.round(keep), normalProfit: Math.round(p.C0),
    title: giftIt
      ? bi(`Khách mới: tặng ${addonName} lần đầu`, `New customers: a free ${addonNameEn} on the first visit`)
      : bi(`Khách mới: giảm ${m(F)} lần đầu`, `New customers: ${m(F)} off the first visit`),
    offer: giftIt
      ? bi(`Lần đầu đến tiệm, đặt lịch trước: tặng ${addonName}.`, `First visit, booked ahead: ${addonNameEn} on us.`)
      : bi(`Lần đầu đến tiệm, đặt lịch trước: giảm ${m(F)}.`, `First visit, booked ahead: ${m(F)} off.`),
    why: p.stage === 'new'
      ? bi(
        `Tiệm còn mới (${p.customers} khách trên hệ thống) — việc số 1 là có khách thử lần đầu.`,
        `The shop is still new (${p.customers} customers in the system) — job one is getting people through the door once.`)
      : bi(
        `Tiệm cần thêm khách mới${p.rivals !== null ? ` trong khu vực có ${p.rivals} tiệm cùng ngành` : ''}. Ưu đãi lần đầu cho khách lý do chọn tiệm mình.`,
        `The shop needs new faces${p.rivals !== null ? ` in an area with ${p.rivals} competing shops` : ''}. A first-visit offer gives them a reason to pick you.`),
    money: bi(
      `Ngay lần đầu tiệm vẫn lời ~${m(keep)} (bình thường ${m(p.C0)}) — không lỗ dù khách không quay lại. Nghiên cứu cho thấy chỉ ~1/5 khách đến vì ưu đãi quay lại trả giá gốc, nên ưu đãi phải có lời ngay lần đầu.`,
      `You still keep about ${m(keep)} on that first visit (normally ${m(p.C0)}) — no loss even if they never return. Research shows only about 1 in 5 deal customers comes back at full price, so the offer has to pay on visit one.`),
    rules: [
      bi('Chỉ 1 lần/khách, phải đặt lịch trước (online hoặc nhắn tin) để có tên và số điện thoại.', 'Once per customer, booked ahead (online or by message) so you get a name and a number.'),
      bi('Trước khi khách về: mời đặt luôn lần sau (xem chương trình giữ khách).', 'Before they leave: invite them to book the next visit (see the keep-them programme).'),
    ],
    stopIf: bi(
      'Sau 1 tháng, nếu dưới 1/4 khách mới quay lại lần 2 → ngừng quảng bá ưu đãi này, dồn sức vào giữ khách.',
      'After a month, if fewer than 1 in 4 new customers has come back, stop promoting it and put the effort into keeping them.'),
  };
}

function rebookProgram(p: Picture, m: StrategyInput['money']): Draft | null {
  if (p.C0 <= 0) return null;
  let score = p.repeatRate !== null
    ? (p.repeatRate < 0.4 ? 76 : p.repeatRate < 0.6 ? 58 : 32)
    : (p.customers >= 20 ? 60 : 55);
  if (p.chairs !== null && p.chairs <= 2) score += 8;
  if (p.rivals !== null && p.rivals >= 12) score += 4;
  // At least one rounding step ($1 / 10.000₫): a reward of nothing is not a reward.
  const reward = Math.max(p.round(Math.min(p.core * 0.08, p.C0 * 0.25), 'down'), p.round(1, 'up'));
  const cost = reward * (1 - p.e.f);
  const keep = p.C0 - cost;
  if (reward <= 0 || keep <= 0) return null;
  const perYear = Math.round(365 / (p.gapDays ?? 35));
  return {
    key: 'rebook', score, discountPct: Math.round((reward / p.core) * 100), profitPerUse: Math.round(keep), normalProfit: Math.round(p.C0),
    title: bi('Giữ khách: hẹn lần sau ngay tại quầy', 'Keep them: book the next visit at the counter'),
    offer: bi(
      `Đặt lịch lần sau trước khi về (trong 4 tuần) → giảm ${m(reward)} cho lần đó.`,
      `Book your next visit before you leave (within 4 weeks) → ${m(reward)} off that visit.`),
    why: p.repeatRate !== null
      ? bi(
        `Chỉ ${pct(p.repeatRate * 100)} khách của tiệm quay lại lần 2 (tiệm tốt thường 60–70%). Giữ khách cũ rẻ hơn nhiều so với tìm khách mới.`,
        `Only ${pct(p.repeatRate * 100)} of your customers come back a second time (good shops keep 60–70%). Keeping a customer costs far less than finding one.`)
      : bi(
        'Chưa đủ dữ liệu để đo tỷ lệ quay lại, nhưng thói quen hẹn lần sau tại quầy là cách rẻ nhất để giữ khách ngay từ đầu.',
        'Not enough history yet to measure how many come back, but booking the next visit at the counter is the cheapest way to keep them from the start.'),
    money: bi(
      `Mỗi khách đặt lại tốn ${m(reward)}, lần sau tiệm vẫn lời ~${m(keep)}. Khách làm móng quay lại khoảng ${perYear} lần/năm — giữ được 1 khách ≈ ${m(p.C0 * perYear)} lời mỗi năm.`,
      `Each rebooking costs ${m(reward)} and that next visit still leaves about ${m(keep)}. A nail regular comes about ${perYear} times a year — one kept customer is roughly ${m(p.C0 * perYear)} of profit a year.`),
    rules: [
      bi('Thợ/lễ tân hỏi MỌI khách trước khi thanh toán: "Em đặt luôn lịch 3 tuần nữa cho chị nhé?"', 'Front desk or tech asks EVERY customer before paying: "Shall we book you in for three weeks from now?"'),
      bi('Hệ thống tự nhắn nhắc lịch 1 ngày trước.', 'The system sends the reminder a day before.'),
    ],
    stopIf: bi(
      'Không cần dừng — đây là chương trình nền. Mỗi tháng xem tỷ lệ khách quay lại; nếu không tăng, đổi phần quà.',
      'No need to stop — this is a standing habit. Check the come-back rate monthly; if it does not move, change the reward.'),
  };
}

function referralProgram(p: Picture, m: StrategyInput['money']): Draft | null {
  if (p.C0 <= 0) return null;
  let score = p.customers >= 30 ? (p.repeatRate !== null && p.repeatRate >= 0.4 ? 70 : 58) : 46;
  if (p.mk === 'VN') score += 6;
  if (p.rivals !== null && p.rivals >= 12) score += 5;
  if (p.chairs !== null && p.chairs <= 2) score += 5;
  if (p.busy === 'full') score -= 20;
  let R = p.round(Math.min(p.core * 0.1, p.C0 * 0.3), 'down');
  if (R <= 0) R = p.round(p.C0 * 0.3, 'near');
  const cost = 2 * R * (1 - p.e.f);
  const keep = p.C0 - cost;
  if (R <= 0 || keep <= 0) return null;
  return {
    key: 'referral', score, discountPct: 0, profitPerUse: Math.round(keep), normalProfit: Math.round(p.C0),
    title: bi('Khách giới thiệu bạn: cả hai cùng được quà', 'Bring a friend: you both get something'),
    offer: bi(
      `Giới thiệu bạn tới làm lần đầu: bạn được giảm ${m(R)}, chị cũng được ${m(R)} cho lần sau.`,
      `Send a friend for their first visit: they get ${m(R)} off, and so do you on your next one.`),
    why: p.customers >= 30
      ? bi(
        `Tiệm đã có ${p.customers} khách — mỗi người là một kênh quảng cáo miễn phí. Khách do người quen giới thiệu ở lại lâu hơn khách đến vì giảm giá.`,
        `You already have ${p.customers} customers — each one is free advertising. People sent by a friend stay longer than people who came for a sale.`)
      : bi(
        'Ít khách nên từng người càng quý: bắt đầu từ người thân, bạn bè của thợ và những khách hài lòng đầu tiên.',
        'With few customers, each one counts: start with the techs\' friends and family and the first happy customers.'),
    money: bi(
      `Chỉ tốn tiền khi có khách mới thật: 2 phần quà = ${m(2 * R)}, lần đầu khách mới đã mang về ~${m(p.C0)} lời → còn ~${m(keep)}. Khách được giới thiệu ít bỏ đi hơn ~18% (nghiên cứu Journal of Marketing).`,
      `You only pay when a new customer actually walks in: two rewards = ${m(2 * R)}, and that first visit leaves about ${m(p.C0)}, so ~${m(keep)} is still yours. Referred customers are about 18% less likely to leave (Journal of Marketing study).`),
    rules: [
      bi('Quà là tiền trừ vào lần làm sau, không trả tiền mặt.', 'Rewards come off a future visit, never paid in cash.'),
      bi('Thợ nhắc khách lúc làm xong — không ai tự nhớ chương trình này.', 'Techs mention it as they finish — nobody remembers it on their own.'),
    ],
    stopIf: bi(
      'Không cần dừng. Nếu sau 1 tháng chưa có ai giới thiệu → thợ chưa nhắc, không phải chương trình dở.',
      'No need to stop. If nobody has referred in a month, the techs are not asking — the programme is not the problem.'),
  };
}

function winbackProgram(p: Picture, m: StrategyInput['money']): Draft | null {
  if (p.lapsed < 8 || p.C0 <= 0) return null;
  const score = 60 + Math.min(25, Math.round(p.lapsed / 4));
  const A = p.addon?.real ? p.addon.price : 0;
  const cost = A ? A * (p.e.c + ADDON_SUPPLY_SHARE) : 0;
  const back = Math.max(1, Math.round(p.lapsed * 0.1));
  const keep = p.C0 - cost;
  return {
    key: 'winback', score, discountPct: 0, profitPerUse: Math.round(keep), normalProfit: Math.round(p.C0),
    title: bi(`Mời lại ${p.lapsed} khách lâu chưa quay lại`, `Invite back ${p.lapsed} customers who have drifted away`),
    offer: A
      ? bi(`Tin nhắn riêng: "Lâu rồi chưa gặp chị! Tuần này ghé tiệm tặng chị ${p.addon?.name}."`, `A personal text: "We miss you! Come in this week and ${p.addon?.name} is on us."`)
      : bi('Tin nhắn riêng hỏi thăm, mời quay lại — không cần giảm giá.', 'A personal check-in message inviting them back — no discount needed.'),
    why: bi(
      `${p.lapsed} khách đã quá thời gian quay lại bình thường của họ. Họ đã biết tiệm, phần lớn không bỏ đi vì giá — chỉ là quên.`,
      `${p.lapsed} customers are past their usual return time. They already know you, and most did not leave over price — they just forgot.`),
    money: bi(
      `Nếu chỉ 1/10 quay lại: +${back} lượt, ~${m(back * keep)} lời. Gần như không tốn gì ngoài tin nhắn${A ? ` và món quà ~${m(cost)}/người quay lại` : ''}.`,
      `If only 1 in 10 comes back: +${back} visits, about ${m(back * keep)} of profit. It costs almost nothing beyond the messages${A ? ` and a gift of about ${m(cost)} per returning customer` : ''}.`),
    rules: [
      bi('Nhắn từng người, gọi tên, không gửi hàng loạt kiểu quảng cáo.', 'One person at a time, by name — not a blast that reads like an ad.'),
      bi('Hạn 2 tuần để tạo lý do quay lại ngay.', 'Good for two weeks, so there is a reason to come now.'),
    ],
    stopIf: bi('Làm 1 lần mỗi tháng cho nhóm mới quá hạn; không nhắn cùng một người quá 2 lần.', 'Once a month for whoever newly drifted; never message the same person more than twice.'),
  };
}

function prepaidProgram(p: Picture, m: StrategyInput['money'], unit: number): Draft | null {
  if (p.C0 <= 0) return null;
  let bonus = 0;
  for (const b of [15, 10, 5]) {
    const d = b / (100 + b);
    if (visitProfit(p.core, p.e, d) >= p.C0 * KEEP_AFTER_DISCOUNT) { bonus = b; break; }
  }
  if (!bonus) return null;
  let score = p.giftEvent ? 82 : p.stage === 'established' && (p.repeatRate ?? 0) >= 0.5 ? 55 : 34;
  if (p.busy === 'full') score -= 20;
  if (p.stage === 'new') score -= 12;
  const G = p.econ.giftCard * unit;
  const value = G + p.round(G * bonus / 100, 'down');
  const now = visitProfit(p.core, p.e, bonus / (100 + bonus));
  const ev = p.giftEvent;
  return {
    key: 'prepaid', score, discountPct: bonus, profitPerUse: Math.round(now), normalProfit: Math.round(p.C0),
    title: ev
      ? bi(`Thẻ quà tặng cho ${viOf(ev.name)}: mua ${m(G)} dùng ${m(value)}`, `Gift cards for ${enOf(ev.name)}: pay ${m(G)}, get ${m(value)}`)
      : bi(`Thẻ trả trước: mua ${m(G)} dùng ${m(value)}`, `Prepaid card: pay ${m(G)}, get ${m(value)}`),
    offer: bi(
      `Mua thẻ ${m(G)} được dùng ${m(value)} dịch vụ${ev ? ` — món quà cho ${viOf(ev.name)}` : ''}.`,
      `Buy a ${m(G)} card and get ${m(value)} of services${ev ? ` — a present for ${enOf(ev.name)}` : ''}.`),
    why: ev
      ? bi(
        `${viOf(ev.name)} còn ${ev.daysAway} ngày — dịp người ta tìm quà. Thẻ quà là thứ dễ bán nhất lúc này.`,
        `${enOf(ev.name)} is ${ev.daysAway} days away — people are shopping for presents, and a gift card is the easiest thing to sell right now.`)
      : bi(
        'Tiệm có nhiều khách quen: thẻ trả trước giữ họ gắn với tiệm và đưa tiền về trước.',
        'You have plenty of regulars: a prepaid card ties them to you and brings the cash in first.'),
    money: bi(
      `Tiền về ngay ${m(G)}. Khi thẻ được dùng hết, mỗi lượt ${p.coreName ?? 'dịch vụ'} tiệm vẫn lời ~${m(now)} (bình thường ${m(p.C0)}). Thường ~1/10 giá trị thẻ không bao giờ được dùng, và người dùng thẻ hay mua thêm.`,
      `${m(G)} in the till today. As the card is spent, each ${p.coreName ?? 'visit'} still leaves about ${m(now)} (normally ${m(p.C0)}). Around 1 in 10 dollars on gift cards is never redeemed, and people who redeem tend to spend over.`),
    rules: [
      bi(`Phần tặng thêm tối đa ${bonus}%.`, `Bonus capped at ${bonus}%.`),
      bi('Dùng dần, không đổi thành tiền mặt; ghi rõ điều kiện trên thẻ.', 'Spent over time, no cash back; print the terms on the card.'),
      ...(ev ? [bi(`Bán từ hôm nay tới hết ${viOf(ev.name)}.`, `Sell from today until ${enOf(ev.name)} is over.`)] : []),
    ],
    stopIf: bi(
      'Dừng bán khi lịch 4 tuần tới đã kín hơn 85% — bán dịch vụ trước mà không có thợ làm là tạo nợ.',
      'Stop selling once the next four weeks are more than 85% booked — selling work nobody can do is just debt.'),
  };
}

function comboProgram(p: Picture, m: StrategyInput['money']): Draft | null {
  if (!p.hand || !p.foot || p.busy === 'full') return null;
  const sum = p.hand.price + p.foot.price;
  const handOnly = visitProfit(p.hand.price, p.e);
  const footOnly = visitProfit(p.foot.price, p.e);
  let chosen = 0;
  for (const d of [10, 5]) {
    if (d > p.maxSafe) continue;
    const pb = visitProfit(sum, p.e, d / 100);
    if (pb - handOnly >= footOnly * 0.6 && pb > 0) { chosen = d; break; }
  }
  if (!chosen) return null;
  const price = p.round(sum * (1 - chosen / 100), 'up');
  const pb = visitProfit(sum, p.e, 1 - price / sum);
  if (pb <= handOnly) return null;
  let score = p.tier === 'budget' ? 58 : p.tier === 'mid' ? 52 : 40;
  if (p.avgTicket < p.core * 1.25) score += 8;
  return {
    key: 'combo', score, discountPct: Math.round((1 - price / sum) * 100), profitPerUse: Math.round(pb), normalProfit: Math.round(handOnly),
    title: bi(`Combo tay + chân ${m(price)}`, `Hands + feet combo ${m(price)}`),
    offer: bi(
      `${p.hand.name} + ${p.foot.name} chỉ ${m(price)} (làm riêng ${m(sum)}).`,
      `${p.hand.name} + ${p.foot.name} for ${m(price)} (${m(sum)} separately).`),
    why: bi(
      `Khách của tiệm chi trung bình ~${m(p.avgTicket)}/lần. Combo tăng giá trị mỗi lượt thay vì hạ giá — cùng một lần đón khách, doanh thu cao hơn.`,
      `Your customers spend about ${m(p.avgTicket)} a visit. A combo raises what each visit is worth instead of cutting the price — same customer, same trip, more revenue.`),
    money: bi(
      `Mỗi combo tiệm lời ~${m(pb)}; nếu khách chỉ làm tay thì chỉ lời ~${m(handOnly)} → mỗi combo bán thêm được ~${m(pb - handOnly)}.`,
      `Each combo leaves about ${m(pb)}; a hands-only visit leaves about ${m(handOnly)} — so every combo sold is ~${m(pb - handOnly)} extra.`),
    rules: [
      bi('Hai dịch vụ trong cùng một lần hẹn.', 'Both services in the same appointment.'),
      ...(p.busyBlocks.length
        ? [bi(`Không nhận combo vào ${p.busyBlocks.map((b) => viOf(b.label)).join(', ')} nếu lịch đã kín.`, `No combos on ${p.busyBlocks.map((b) => enOf(b.label)).join(', ')} when the book is full.`)]
        : []),
    ],
    stopIf: bi(
      'Nếu phần lớn khách mua combo vốn đã làm cả tay lẫn chân → tiệm đang cho không phần giảm; tăng giá combo hoặc dừng.',
      'If most combo buyers were already getting both done, you are giving the discount away — raise the combo price or stop.'),
  };
}

function raiseProgram(p: Picture, m: StrategyInput['money']): Draft | null {
  const incomeHigh = p.incomeRatio !== null && p.incomeRatio >= 1.1;
  let score = 0;
  if (p.busy === 'full') score = 92;
  else if (p.busy === 'high') score = p.tier === 'budget' ? 76 : 56;
  else if (p.tier === 'budget' && incomeHigh && p.busy !== 'low') score = 50;
  if (!score) return null;
  const delta = Math.max(p.round(p.core * 0.07, 'near'), p.round(1, 'up'));
  const gain = delta * (1 - p.e.c - p.e.f);
  if (gain <= 0 || p.C0 + gain <= 0) return null;
  const lossShare = gain / (Math.max(p.C0, 0) + gain);
  const oneIn = Math.max(2, Math.floor(1 / lossShare));
  return {
    key: 'raise', score, discountPct: 0, profitPerUse: Math.round(p.C0 + gain), normalProfit: Math.round(p.C0),
    title: bi(`Không giảm giá — tăng ${p.coreName ?? 'dịch vụ chính'} thêm ${m(delta)}`, `No discount — raise ${p.coreName ?? 'your main service'} by ${m(delta)}`),
    offer: bi(
      `Giá mới ${m(p.core + delta)} (từ ${m(p.core)}), áp dụng từ đầu tháng tới, báo trước cho khách quen.`,
      `New price ${m(p.core + delta)} (from ${m(p.core)}), from the start of next month, with notice to regulars.`),
    why: p.busy === 'full' || p.busy === 'high'
      ? bi(
        `Lịch của tiệm đã kín ~${pct((p.util ?? 0) * 100)} giờ mở cửa. Giảm giá lúc này là tự bớt lãi trên ghế vốn đã có khách.`,
        `Your book is already ~${pct((p.util ?? 0) * 100)} full. A discount now just takes profit off chairs that were selling anyway.`)
      : bi(
        `Giá của tiệm (${m(p.core)}) thấp hơn mặt bằng khu vực (~${m(p.refPrice)}), trong khi thu nhập quanh tiệm cao hơn trung bình.`,
        `Your price (${m(p.core)}) sits under the local going rate (~${m(p.refPrice)}) while incomes around you are above average.`),
    money: bi(
      `Mỗi lượt lời thêm ~${m(gain)} (sau % thợ). Dù mất ${pct(lossShare * 100)} khách — khoảng 1 trong ${oneIn} người — tiệm vẫn lời bằng hiện tại; tăng ${m(delta)} hiếm khi làm mất nhiều khách như vậy.`,
      `Each visit earns about ${m(gain)} more (after the tech's share). You could lose ${pct(lossShare * 100)} of customers — about 1 in ${oneIn} — and still earn what you do today; a ${m(delta)} rise rarely costs anything like that.`),
    rules: [
      bi('Báo trước 2–3 tuần trên tin nhắn và tại quầy.', 'Give two to three weeks\' notice by message and at the desk.'),
      bi('Tăng dịch vụ bán chạy nhất trước, giữ giá dịch vụ nhỏ.', 'Raise the best seller first; leave the small services alone.'),
    ],
    stopIf: bi(
      'Nếu 6 tuần sau số lượt giảm hơn mức hoà vốn ở trên → giữ giá mới nhưng chạy chương trình giữ khách.',
      'If visits fall by more than the break-even share within six weeks, keep the new price but run the keep-them programme.'),
  };
}

// ---- assembling the plan --------------------------------------------------------

const DISCOUNTY: ProgramKey[] = ['quiet', 'first', 'combo'];

export function buildPromoStrategy(input: StrategyInput): PromoStrategy {
  const p = read(input);
  const m = input.money;
  const unit = Math.max(1, input.unit || 100);

  const drafts = [
    quietProgram(p, m), giftProgram(p, m), firstProgram(p, m), rebookProgram(p, m),
    referralProgram(p, m), winbackProgram(p, m), prepaidProgram(p, m, unit), comboProgram(p, m), raiseProgram(p, m),
  ].filter((d): d is Draft => Boolean(d))
    // The rule that cannot be broken, enforced in one place as well as in each
    // programme: nothing that leaves a visit at or below zero reaches a screen.
    .filter((d) => d.profitPerUse > 0 && d.score > 0)
    .sort((a, b) => b.score - a.score);

  const picked: Draft[] = [];
  for (const d of drafts) {
    if (picked.length >= 3) break;
    if (p.busy === 'full' && DISCOUNTY.includes(d.key)) continue;
    if (DISCOUNTY.includes(d.key) && picked.filter((x) => DISCOUNTY.includes(x.key)).length >= 1) continue;
    picked.push(d);
  }
  const programs: StrategyProgram[] = picked.map((d, i) => ({ ...d, role: i === 0 ? 'main' : 'support' }));

  // ---- the facts, one line each ----
  const facts: StrategyFact[] = [];
  const tierVi = { budget: 'giá bình dân', mid: 'giá tầm trung', premium: 'giá cao cấp' }[p.tier];
  const tierEn = { budget: 'budget prices', mid: 'mid-range prices', premium: 'premium prices' }[p.tier];
  facts.push({
    key: 'price', label: bi('Mức giá', 'Price level'),
    value: bi(
      `${tierVi[0].toUpperCase()}${tierVi.slice(1)} — ${p.coreName ?? 'dịch vụ chính'} ${m(p.core)} (mặt bằng khu vực ~${m(p.refPrice)})`,
      `${tierEn[0].toUpperCase()}${tierEn.slice(1)} — ${p.coreName ?? 'main service'} ${m(p.core)} (local going rate ~${m(p.refPrice)})`),
    tone: 'neutral',
  });
  if (p.incomeRatio !== null || p.rivals !== null) {
    const parts: { vi: string; en: string }[] = [];
    if (p.incomeRatio !== null) {
      const diff = Math.round((p.incomeRatio - 1) * 100);
      parts.push(diff >= 0
        ? { vi: `thu nhập quanh tiệm cao hơn trung bình Mỹ ${diff}%`, en: `local incomes ${diff}% above the US average` }
        : { vi: `thu nhập quanh tiệm thấp hơn trung bình Mỹ ${-diff}%`, en: `local incomes ${-diff}% below the US average` });
    }
    if (p.rivals !== null) parts.push({ vi: `${p.rivals} tiệm cùng ngành quanh đây`, en: `${p.rivals} competing shops nearby` });
    facts.push({
      key: 'area', label: bi('Khu vực', 'Area'),
      value: bi(cap(parts.map((x) => x.vi).join(' · ')), cap(parts.map((x) => x.en).join(' · '))),
      tone: p.rivals !== null && p.rivals >= 12 ? 'warn' : 'neutral',
    });
  }
  facts.push({
    key: 'book', label: bi('Độ kín lịch', 'How full'),
    value: p.util === null
      ? bi('Chưa đủ lịch trên hệ thống để đo (cần ~30 lượt/4 tuần, số thợ và giờ mở cửa).', 'Not enough bookings in the system to measure yet (needs ~30 in 4 weeks, plus staff and opening hours).')
      : bi(
        `~${pct(p.util * 100)} giờ mở cửa đã có khách (4 tuần qua, theo lịch trên hệ thống)${p.quiet.length ? ` · vắng nhất: ${p.quiet.map((q) => viOf(q.label)).join(', ')}` : ''}`,
        `~${pct(p.util * 100)} of open hours booked (last 4 weeks, per the system)${p.quiet.length ? ` · quietest: ${p.quiet.map((q) => enOf(q.label)).join(', ')}` : ''}`),
    tone: p.busy === 'full' ? 'good' : p.busy === 'low' ? 'warn' : 'neutral',
  });
  facts.push({
    key: 'customers', label: bi('Khách', 'Customers'),
    value: p.customers < 5
      ? bi('Tiệm mới trên hệ thống — chưa có dữ liệu khách.', 'New to the system — no customer history yet.')
      : bi(
        `${p.customers} khách${p.repeatRate !== null ? ` · ${pct(p.repeatRate * 100)} quay lại lần 2` : ''}${p.lapsed ? ` · ${p.lapsed} khách lâu chưa quay lại` : ''}`,
        `${p.customers} customers${p.repeatRate !== null ? ` · ${pct(p.repeatRate * 100)} come back` : ''}${p.lapsed ? ` · ${p.lapsed} overdue` : ''}`),
    tone: p.repeatRate !== null && p.repeatRate < 0.4 ? 'warn' : 'neutral',
  });
  const srcVi = p.commissionSource === 'entered' || p.commissionSource === 'staff' ? '' : ' (ước tính)';
  const srcEn = p.commissionSource === 'entered' || p.commissionSource === 'staff' ? '' : ' (estimate)';
  facts.push({
    key: 'profit', label: bi('Mỗi lượt tiệm lời', 'Each visit leaves you'),
    value: bi(
      `~${m(p.C0)} trên ${m(p.core)} — sau ${p.commissionPct}% thợ${srcVi}, vật tư ~7%, phí thẻ ${(p.e.f * 100).toFixed(1).replace(/\.0$/, '')}%. Giảm tối đa ${p.maxSafe}% là an toàn.`,
      `~${m(p.C0)} of ${m(p.core)} — after ${p.commissionPct}% to the tech${srcEn}, ~7% supplies, ${(p.e.f * 100).toFixed(1).replace(/\.0$/, '')}% card fees. ${p.maxSafe}% off is the safe limit.`),
    tone: p.C0 <= 0 ? 'bad' : 'neutral',
  });
  if (p.giftEvent) {
    facts.push({
      key: 'season', label: bi('Dịp sắp tới', 'Coming up'),
      value: bi(`${viOf(p.giftEvent.name)} — còn ${p.giftEvent.daysAway} ngày`, `${enOf(p.giftEvent.name)} — in ${p.giftEvent.daysAway} days`),
      tone: 'good',
    });
  }

  // ---- what not to do, with this shop's numbers ----
  const avoid: Txt[] = [];
  const deep = Math.min(50, p.maxSafe + 15);
  const deepProfit = visitProfit(p.core, p.e, deep / 100);
  avoid.push(deepProfit <= 0
    ? bi(
      `Giảm ${deep}% trở lên: mỗi khách tiệm LỖ ~${m(-deepProfit)} — càng đông càng lỗ.`,
      `${deep}% off or more: you LOSE about ${m(-deepProfit)} on every customer — the busier it gets, the more you lose.`)
    : bi(
      `Giảm ${deep}%: mỗi khách chỉ còn lời ~${m(deepProfit)} thay vì ${m(p.C0)} — phải đông gấp ${(p.C0 / deepProfit).toFixed(1)} lần mới bằng.`,
      `${deep}% off: each customer leaves only ~${m(deepProfit)} instead of ${m(p.C0)} — you would need ${(p.C0 / deepProfit).toFixed(1)}× the customers just to stand still.`));
  avoid.push(bi(
    'Giảm % toàn menu, mọi giờ: mất lãi trên cả khách vốn trả đủ, và khách quen học cách chờ đợt giảm.',
    'A percentage off everything, every hour: you give margin to people who would have paid full price, and regulars learn to wait for the sale.'));
  if (p.busyBlocks.length) {
    avoid.push(bi(
      `Giảm giá vào ${p.busyBlocks.map((b) => viOf(b.label)).join(', ')}: giờ đó đã đông, giảm là cho không.`,
      `Discounts on ${p.busyBlocks.map((b) => enOf(b.label)).join(', ')}: those hours already sell — a discount there is money handed back.`));
  } else if (p.stage === 'new' || p.tier === 'budget') {
    avoid.push(bi(
      'Deal kiểu Groupon giảm sâu: chỉ ~1/5 khách mua deal quay lại trả giá gốc.',
      'Deep Groupon-style deals: only about 1 in 5 deal buyers comes back at full price.'));
  }

  // ---- what is missing ----
  const missing: Txt[] = [];
  if (!(p.commissionSource === 'entered' || p.commissionSource === 'staff')) {
    missing.push(bi(
      `Chưa có % ăn chia của thợ — đang tạm tính ${p.commissionPct}%. Điền trong Nhân sự → sửa thợ để mọi con số là của tiệm.`,
      `No tech commission on file — using ${p.commissionPct}% for now. Fill it in under Staff → edit a tech and every figure becomes yours.`));
  }
  if (!(input.menu ?? []).some((x) => x.priceCents > 0)) {
    missing.push(bi('Menu chưa có giá — đang dùng giá tham khảo của khu vực.', 'The menu has no prices — using the local going rate for now.'));
  }
  if (p.util === null) {
    missing.push(bi(
      'Chưa đo được độ kín lịch: cần số thợ, giờ mở cửa và vài tuần đặt lịch qua hệ thống.',
      'How full the book is cannot be measured yet: it needs the staff list, opening hours and a few weeks of bookings in the system.'));
  }

  const main = programs[0];
  const busyVi = { unknown: 'chưa đo được độ kín lịch', low: 'lịch còn trống nhiều', mid: 'lịch kín khoảng một nửa', high: 'lịch khá kín', full: 'lịch gần kín' }[p.busy];
  const busyEn = { unknown: 'no read on how full the book is yet', low: 'plenty of empty hours', mid: 'about half booked', high: 'a fairly full book', full: 'an almost full book' }[p.busy];
  const stageVi = { new: 'tiệm mới', growing: 'đang xây tệp khách', established: 'đã có tệp khách quen' }[p.stage];
  const stageEn = { new: 'a new shop', growing: 'building a customer base', established: 'an established regular base' }[p.stage];
  const headline = main
    ? bi(
      `Tiệm ${tierVi}, ${stageVi}, ${busyVi} → bắt đầu với: ${viOf(main.title)}.`,
      `${tierEn[0].toUpperCase()}${tierEn.slice(1)}, ${stageEn}, ${busyEn} → start with: ${enOf(main.title)}.`)
    : bi(
      'Với chi phí hiện tại, mỗi lượt khách gần như không còn lãi — việc cần làm trước là xem lại giá, không phải khuyến mãi.',
      'At today\'s costs a visit leaves almost nothing — the first job is the price list, not a promotion.');

  return {
    headline, facts, programs, avoid: avoid.slice(0, 3),
    maxSafePct: p.maxSafe,
    profitPerVisit: Math.round(p.C0),
    corePriceCents: p.core,
    coreName: p.coreName,
    basis: bi(
      'Mọi con số tính theo trường hợp an toàn nhất: tiệm chịu toàn bộ phần giảm, thợ vẫn ăn % trên giá gốc. Nếu thợ ăn % trên giá sau giảm, tiệm còn lời hơn.',
      'Every figure assumes the safest case: the shop absorbs the whole discount and the tech is still paid on the full price. If your techs are paid on the discounted price, you keep more.'),
    missing,
  };
}

/** For the prompt: the plan the AI must write to, in Vietnamese. */
export function strategyToPrompt(s: PromoStrategy | null, money: (c: number) => string): string {
  if (!s) return '';
  const L = ['CHIẾN LƯỢC KHUYẾN MÃI RIÊNG CỦA TIỆM (đã tính lãi/lỗ — BÁM THEO, không tự nghĩ chương trình khác):'];
  L.push(`- Mỗi lượt ${s.coreName ?? 'dịch vụ chính'} (${money(s.corePriceCents)}) tiệm lời ~${money(s.profitPerVisit)}. Không bao giờ giảm quá ${s.maxSafePct}%.`);
  for (const p of s.programs) {
    L.push(`- ${p.role === 'main' ? 'CHÍNH' : 'PHỤ'}: ${viOf(p.title)} — "${viOf(p.offer)}"`);
    for (const r of p.rules) L.push(`    · ${viOf(r)}`);
  }
  if (s.avoid.length) L.push(`- TRÁNH: ${s.avoid.map(viOf).join(' | ')}`);
  return L.join('\n');
}
