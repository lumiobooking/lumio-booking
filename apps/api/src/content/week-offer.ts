import { bi, viOf, enOf, type Txt } from './i18n';
import { WEEKDAY_VI } from './revenue-signals';
import { offerSheet, type BriefContext, type JobBrief } from './job-brief';

/**
 * The week's offer, as a person decides it.
 *
 * WHY A FORM AND NOT A LINE OF TEXT
 *
 * The system proposes an offer from the book — "12% off Saturday morning only"
 * — and it is usually right about the slot and roughly right about the number.
 * But the number, the services it applies to, the deadline and the small print
 * are the shop's call, and a staff member typing over the plan's sentence
 * changed one place while the caption, the countdown story and the Google post
 * kept promising the old figure.
 *
 * So the offer is one small record, and every line that mentions it is built
 * from that record: the job on the plan, its sheet, the caption. Change the
 * number once, and the week agrees with itself.
 *
 *   mode 'auto'   — the system's proposal stands (the default)
 *   mode 'custom' — this record replaces it
 *   mode 'off'    — no offer this week, and the plan says why not
 */
export type OfferMode = 'auto' | 'custom' | 'off';
export type OfferKind = 'percent' | 'amount' | 'gift';
export type OfferSlot = 'morning' | 'afternoon' | 'evening' | 'all';

export interface WeekOffer {
  mode: OfferMode;
  kind: OfferKind;
  /** 12 for 12%; 10 for $10 off; ignored for 'gift'. */
  value: number;
  /** Free text: "Gel manicure, pedicure" or "" for everything. */
  services: string;
  /** Free text for kind 'gift': "free nail art on 2 nails". */
  gift: string;
  /** Local weekdays 0-6 the offer is valid on. Empty = every day. */
  days: number[];
  slot: OfferSlot;
  /** 'YYYY-MM-DD' or ''. */
  expires: string;
  /** Small print, one line. */
  terms: string;
  /** Local weekday to publish on; null = 2 days before the first valid day. */
  postDay: number | null;
  /** Clock time to publish ('19:00'). */
  postAt: string;
  updatedAt?: string;
  updatedBy?: string | null;
}

export const DEFAULT_OFFER: WeekOffer = {
  mode: 'auto', kind: 'percent', value: 10, services: '', gift: '',
  days: [], slot: 'all', expires: '', terms: '', postDay: null, postAt: '19:00',
};

const clean = (v: unknown, cap: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, cap);

/** Whatever the browser posted, made into a WeekOffer or refused. */
export function parseOffer(raw: unknown): WeekOffer {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const mode: OfferMode = r.mode === 'custom' || r.mode === 'off' ? r.mode : 'auto';
  const kind: OfferKind = r.kind === 'amount' || r.kind === 'gift' ? r.kind : 'percent';
  const value = Math.max(0, Math.min(kind === 'percent' ? 90 : 100000, Math.round(Number(r.value) || 0)));
  const days = Array.isArray(r.days)
    ? Array.from(new Set(r.days.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))).sort()
    : [];
  const slot: OfferSlot = r.slot === 'morning' || r.slot === 'afternoon' || r.slot === 'evening' ? r.slot : 'all';
  const expires = /^\d{4}-\d{2}-\d{2}$/.test(String(r.expires ?? '')) ? String(r.expires) : '';
  const postDay = Number.isInteger(Number(r.postDay)) && Number(r.postDay) >= 0 && Number(r.postDay) <= 6 && r.postDay !== null && r.postDay !== ''
    ? Number(r.postDay) : null;
  const postAt = /^\d{1,2}:\d{2}$/.test(String(r.postAt ?? '')) ? String(r.postAt) : '19:00';
  return {
    mode, kind, value, days, slot, expires, postDay, postAt,
    services: clean(r.services, 120),
    gift: clean(r.gift, 120),
    terms: clean(r.terms, 200),
  };
}

const BLOCK_VI: Record<OfferSlot, string> = { morning: 'buổi sáng', afternoon: 'buổi chiều', evening: 'buổi tối', all: 'cả ngày' };
const BLOCK_EN: Record<OfferSlot, string> = { morning: 'morning', afternoon: 'afternoon', evening: 'evening', all: 'all day' };
const WD_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Thứ 7 buổi sáng" / "Saturday morning"; several days become "Thứ 3, Thứ 4". */
export function offerWhen(o: WeekOffer): Txt {
  const vi = o.days.length ? o.days.map((d) => WEEKDAY_VI[d]).join(', ') : 'mọi ngày';
  const en = o.days.length ? o.days.map((d) => WD_EN[d]).join(', ') : 'every day';
  return o.slot === 'all' ? bi(vi, en) : bi(`${vi} ${BLOCK_VI[o.slot]}`, `${en} ${BLOCK_EN[o.slot]}`);
}

/** "12%" / "$10" / "tặng vẽ 2 ngón". Money is a bare number — the salon's currency sign is on the screen. */
export function offerAmount(o: WeekOffer, currency = '$'): Txt {
  if (o.kind === 'gift') return bi(`tặng ${o.gift || 'quà'}`, `free ${o.gift || 'gift'}`);
  if (o.kind === 'amount') {
    // The dong goes after the number with thousands dots; everything else in front.
    const money = currency === '₫' ? `${o.value.toLocaleString('vi-VN')}₫` : `${currency}${o.value}`;
    return bi(`giảm ${money}`, `${money} off`);
  }
  return bi(`giảm ${o.value}%`, `${o.value}% off`);
}

/** The one-line headline the job, the caption and the story all quote. */
export function offerHeadline(o: WeekOffer, currency = '$'): Txt {
  const a = offerAmount(o, currency); const w = offerWhen(o);
  const svcVi = o.services ? ` cho ${o.services}` : '';
  const svcEn = o.services ? ` on ${o.services}` : '';
  return bi(
    `${viOf(a)}${svcVi} — CHỈ ${viOf(w)}`,
    `${enOf(a)}${svcEn} — ${enOf(w)} ONLY`);
}

/** The conditions line: services, days, small print — spelled out, never implied. */
export function offerRules(o: WeekOffer): Txt {
  const parts: Txt[] = [];
  parts.push(bi(`Áp dụng ${viOf(offerWhen(o))}`, `Valid ${enOf(offerWhen(o))}`));
  if (o.services) parts.push(bi(`cho ${o.services}`, `on ${o.services}`));
  if (o.terms) parts.push(bi(o.terms, o.terms));
  parts.push(bi('không gộp với ưu đãi khác', 'not combined with other offers'));
  return bi(parts.map(viOf).join(' · '), parts.map(enOf).join(' · '));
}

/** Two days before the first valid day, or the day the person picked. */
export function offerPostDay(o: WeekOffer, fallback: number): number {
  if (o.postDay !== null) return o.postDay;
  if (!o.days.length) return fallback;
  return ((o.days[0] - 2) % 7 + 7) % 7;
}

/** The job line + its sheet for a custom offer. */
export function customOfferJob(o: WeekOffer, ctx: BriefContext & { currency?: string }): {
  text: Txt; why: Txt; when: string; brief: JobBrief;
} {
  const cur = ctx.currency ?? '$';
  const head = offerHeadline(o, cur);
  const when = offerWhen(o);
  return {
    text: bi(`Đăng ưu đãi: ${viOf(head)}`, `Post the offer: ${enOf(head)}`),
    why: bi(
      `Ưu đãi do team đặt cho tuần này. Đăng trước ${o.days.length ? '2 ngày' : 'giờ ghi'} để khách kịp sắp lịch${o.expires ? ` — hết hạn ${o.expires}` : ''}. Chỉ giảm đúng ${viOf(when)}, giữ giá các khung khác`,
      `The offer the team set for this week. Post it ${o.days.length ? '2 days ahead' : 'at the time shown'} so customers can plan${o.expires ? ` — ends ${o.expires}` : ''}. Discount ${enOf(when)} only, full price everywhere else`),
    when: o.postAt,
    brief: offerSheet({ headline: head, rules: offerRules(o), expires: o.expires || null }, ctx),
  };
}
