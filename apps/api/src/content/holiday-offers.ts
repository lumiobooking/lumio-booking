import { bi, enOf, viOf, type Txt } from './i18n';
import type { DatedEvent } from './region-events';
import type { OfferKind, OfferSlot } from './week-offer';

/**
 * One programme per holiday, for the shop to pick from.
 *
 * WHAT THE SHOP SEES
 *
 * The calendar the team already reads — Thanksgiving in 40 days, prom season
 * in May — with, under each date, one concrete programme: what is offered,
 * to whom, for which days, until when. Not a lecture on promotions; a card
 * the owner can say yes to. Saying yes hands the programme to the team as a
 * request; the team checks the arithmetic and runs it.
 *
 * WHAT DECIDES THE NUMBER
 *
 * The discount is the shop's own safe ceiling from promo-playbook when the
 * margin is known (never above it, rounded down to a 5), and a modest 10%
 * when it is not. A gift beats a percentage on the days people come to buy a
 * gift — Mother's Day, Valentine's — because a "free nail art on two nails"
 * is remembered and a "10% off" is not, and it costs the shop less.
 *
 * Nothing here says why a day is quiet or how the team chooses posting
 * times. It is a calendar and an arithmetic, both of which the shop could
 * do itself with a pen.
 */

export interface HolidayOffer {
  kind: OfferKind;
  value: number;
  services: string;
  gift: string;
  /** Local weekdays the programme runs on; [] = every day of the window. */
  days: number[];
  slot: OfferSlot;
  /** Last valid day, 'YYYY-MM-DD'. */
  expires: string;
  terms: string;
}

export interface HolidayIdea {
  /** Stable per event and date — what the shop's pick refers to. */
  key: string;
  name: Txt;
  date: string;
  daysAway: number;
  spanDays: number;
  /** The programme in one sentence, the way a poster would say it. */
  idea: Txt;
  /** "Từ 20/11 đến 26/11" — the window the programme runs. */
  window: Txt;
  offer: HolidayOffer;
}

const GIFT_DAYS = /valentine|mother|father|women|love|anniversary|christmas|giáng sinh|noel|tết|lunar new year|ngày của mẹ|ngày của cha/i;
const BUSY_DAYS = /prom|graduation|wedding|homecoming|back to school|tựu trường|tốt nghiệp|lễ hội/i;

/** What a small gift is in this trade — the add-on a shop can give for pennies. */
function giftFor(industry?: string | null): Txt {
  const code = String(industry ?? 'SALON').toUpperCase();
  if (code === 'HAIR') return bi('tặng hấp dầu dưỡng', 'a free deep-conditioning treatment');
  if (code === 'LASH' || code === 'BROW') return bi('tặng chỉnh dáng chân mày', 'a free brow shaping');
  if (code === 'SPA' || code === 'MASSAGE') return bi('tặng thêm 10 phút', 'an extra 10 minutes free');
  if (code === 'RESTAURANT') return bi('tặng món tráng miệng', 'a free dessert');
  if (code === 'PMU') return bi('tặng dặm lại lần đầu', 'a free first touch-up');
  if (code === 'REAL_ESTATE' || code === 'SERVICE') return bi('tặng buổi tư vấn', 'a free consultation');
  return bi('tặng vẽ nghệ thuật 2 móng', 'free nail art on two nails');
}

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(iso: string, n: number): Date { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d; }
function dmy(iso: string, en: boolean): string {
  const [, m, d] = iso.split('-');
  return en ? `${m}/${d}` : `${d}/${m}`;
}

/** 5 → 5, 12 → 10, 23 → 20; never above the ceiling, never below 5. */
export function roundedDiscount(ceiling: number | null): number {
  if (ceiling === null || !Number.isFinite(ceiling)) return 10;
  return Math.max(5, Math.min(30, Math.floor(ceiling / 5) * 5));
}

/**
 * The window a programme runs: the four days up to a single-day holiday
 * (people book ahead of the day, not on it), or the season itself for a
 * window like prom.
 */
function windowOf(e: DatedEvent): { from: string; to: string } {
  if (e.spanDays > 0) return { from: e.date, to: ymd(addDays(e.date, Math.min(e.spanDays, 30))) };
  return { from: ymd(addDays(e.date, -4)), to: e.date };
}

export function holidayIdeas(events: DatedEvent[], opts: { industry?: string | null; ceilingPct: number | null; horizonDays?: number }): HolidayIdea[] {
  const horizon = opts.horizonDays ?? 60;
  const pct = roundedDiscount(opts.ceilingPct);
  const gift = giftFor(opts.industry);
  return events
    .filter((e) => e.daysAway >= 0 && e.daysAway <= horizon)
    .slice(0, 8)
    .map((e) => {
      const name = e.name;
      const en = enOf(name); const vi = viOf(name);
      const w = windowOf(e);
      const isGift = GIFT_DAYS.test(`${en} ${vi}`);
      const isBusy = BUSY_DAYS.test(`${en} ${vi}`);
      const key = `${e.date}-${en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)}`;
      const window = bi(`Từ ${dmy(w.from, false)} đến ${dmy(w.to, false)}`, `${dmy(w.from, true)} – ${dmy(w.to, true)}`);
      let offer: HolidayOffer;
      let idea: Txt;
      if (isGift) {
        offer = { kind: 'gift', value: 0, services: '', gift: viOf(gift), days: [], slot: 'all', expires: w.to, terms: 'Áp dụng khi đặt lịch trước' };
        idea = bi(`${vi}: ${viOf(gift)} cho khách đặt lịch trước ngày lễ`, `${en}: ${enOf(gift)} for anyone who books ahead of the day`);
      } else if (isBusy) {
        // A busy season does not need a discount to fill the book; it needs
        // the early bookings. A small, early-only offer does that.
        const early = Math.max(5, pct - 5);
        offer = { kind: 'percent', value: early, services: '', gift: '', days: [], slot: 'morning', expires: w.to, terms: 'Chỉ khung giờ sáng, đặt trước 1 tuần' };
        idea = bi(`${vi}: giảm ${early}% khung giờ sáng cho khách đặt trước 1 tuần`, `${en}: ${early}% off morning slots for bookings made a week ahead`);
      } else {
        offer = { kind: 'percent', value: pct, services: '', gift: '', days: [], slot: 'all', expires: w.to, terms: 'Áp dụng khi đặt lịch trước' };
        idea = bi(`${vi}: giảm ${pct}% cho khách đặt lịch trước ngày lễ`, `${en}: ${pct}% off for anyone who books ahead of the day`);
      }
      return { key, name, date: e.date, daysAway: e.daysAway, spanDays: e.spanDays, idea, window, offer };
    });
}

/** The line the team reads when the shop says yes — everything needed to fill the offer form. */
export function ideaAsRequest(i: HolidayIdea): string {
  const o = i.offer;
  const what = o.kind === 'gift' ? `Tặng: ${o.gift}` : `Giảm ${o.value}${o.kind === 'percent' ? '%' : ''}${o.services ? ` cho ${o.services}` : ''}`;
  const slot = o.slot === 'all' ? '' : ` · ${{ morning: 'buổi sáng', afternoon: 'buổi chiều', evening: 'buổi tối' }[o.slot]}`;
  return `Tiệm muốn chạy ưu đãi ${viOf(i.name)} (${i.date}) — ${what}${slot} · ${viOf(i.window)} · hết hạn ${o.expires}${o.terms ? ` · ${o.terms}` : ''}`;
}
