/**
 * WHAT THE CHAT BOT MAY SAY ABOUT DISCOUNTS.
 *
 * The salon's promotions (Services → Promotions: special dates, weekdays,
 * first visit, groups) are what a booking made through the bot is actually
 * charged — create_booking applies them, the single best % that fits. The bot
 * used to be told none of them: it saw only the per-service sale price and
 * the salon's free-text notes, so it quoted whatever an old note said ("new
 * management special, 15% off") while the booking it made charged the
 * Halloween 10%. This turns the promotions that apply to THIS channel into
 * plain lines for the prompt.
 *
 * Pure: no database, no clock (tested in promo-knowledge.spec.ts).
 */
import { dateRulesFor, programFor, type SaleChannel } from '../settings/promo-channel';

type Id = string | null;
export interface PromoInputs {
  weekday?: { enabled?: boolean; rules?: { day: number; categoryId: Id; percent: number }[] | null; startDate?: string | null; endDate?: string | null; appliesTo?: unknown } | null;
  dates?: { enabled?: boolean; rules?: { startDate: string; endDate: string | null; categoryId: Id; percent: number; label?: string; appliesTo?: unknown }[] | null } | null;
  firstVisit?: { enabled?: boolean; percent?: number; rules?: { visit?: number; percent?: number }[] | null; startDate?: string | null; endDate?: string | null; appliesTo?: unknown } | null;
  group?: { enabled?: boolean; tiers?: { minSize?: number; percent?: number }[] | null; startDate?: string | null; endDate?: string | null; appliesTo?: unknown } | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** "2026-10-31" → "Oct 31" (the bot translates it into the customer's language). */
export function shortDay(ymd: string): string {
  if (!isYmd(ymd)) return ymd;
  return `${MONTHS[Number(ymd.slice(5, 7)) - 1] ?? ymd.slice(5, 7)} ${Number(ymd.slice(8, 10))}`;
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** " (from Oct 20)", " (until Oct 31)", " (Oct 20–Oct 31)" or "" for an open-ended programme. */
function windowText(w: { startDate?: string | null; endDate?: string | null }, today: string): string {
  const from = isYmd(w.startDate) && w.startDate > today ? w.startDate : null;
  const to = isYmd(w.endDate) ? w.endDate : null;
  if (from && to) return ` (${shortDay(from)}–${shortDay(to)} only)`;
  if (from) return ` (starts ${shortDay(from)})`;
  if (to) return ` (until ${shortDay(to)})`;
  return '';
}

/** Is a programme with these run dates over, or more than `horizon` days away? */
function outOfReach(w: { startDate?: string | null; endDate?: string | null }, today: string, horizon: string): boolean {
  return (isYmd(w.endDate) && w.endDate < today) || (isYmd(w.startDate) && w.startDate > horizon);
}

const ordinal = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? `${n}th` : `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`);

/**
 * One line per promotion that applies on `where` and runs today or within
 * `horizonDays`. Category ids become names; a rule for a category the menu no
 * longer has is still listed (as "one category"), never silently widened to
 * "all services".
 */
export function promoKnowledge(
  p: PromoInputs,
  opts: { today: string; categoryName: (id: string) => string | null | undefined; horizonDays?: number },
  where: SaleChannel = 'online',
): string[] {
  const today = opts.today;
  const horizon = addDays(today, opts.horizonDays ?? 30);
  const what = (id: Id) => (id ? `${opts.categoryName(id) || 'one category of'} services` : 'all services');
  const lines: string[] = [];

  const d = dateRulesFor(p.dates ?? null, where);
  if (d?.enabled) {
    for (const r of d.rules ?? []) {
      if (!r || !isYmd(r.startDate) || !(Number(r.percent) > 0)) continue;
      const end = isYmd(r.endDate) ? r.endDate : r.startDate;
      if (end < today || r.startDate > horizon) continue;
      const when = r.startDate === end ? `on ${shortDay(end)}` : `${shortDay(r.startDate)}–${shortDay(end)}`;
      const state = r.startDate <= today ? 'running today' : 'not started yet — only for visits on those dates';
      lines.push(`- ${r.label?.trim() ? `${r.label.trim()}: ` : ''}${r.percent}% off ${what(r.categoryId)}, ${when} (${state})`);
    }
  }

  const w = programFor(p.weekday ?? null, where);
  if (w?.enabled && Array.isArray(w.rules) && !outOfReach(w, today, horizon)) {
    const win = windowText(w, today);
    for (const r of [...w.rules].sort((a, b) => a.day - b.day)) {
      if (!(Number(r?.percent) > 0) || !DAYS[r.day]) continue;
      lines.push(`- Every ${DAYS[r.day]}: ${r.percent}% off ${what(r.categoryId)} (for visits on that day)${win}`);
    }
  }

  const f = programFor(p.firstVisit ?? null, where);
  if (f?.enabled && !outOfReach(f, today, horizon)) {
    const rules = Array.isArray(f.rules) && f.rules.length ? f.rules : ((f.percent ?? 0) > 0 ? [{ visit: 1, percent: f.percent }] : []);
    const win = windowText(f, today);
    for (const r of rules) {
      const n = Math.round(Number(r?.visit) || 0);
      if (n < 1 || !(Number(r?.percent) > 0)) continue;
      lines.push(n === 1
        ? `- First visit: ${r.percent}% off for a brand-new customer (checked automatically from the phone number when you book)${win}`
        : `- ${ordinal(n)} visit: ${r.percent}% off as a thank-you (checked automatically from the phone number)${win}`);
    }
  }

  const g = programFor(p.group ?? null, where);
  if (g?.enabled && Array.isArray(g.tiers) && !outOfReach(g, today, horizon)) {
    const win = windowText(g, today);
    for (const t of [...g.tiers].sort((a, b) => Number(a?.minSize) - Number(b?.minSize))) {
      const n = Math.round(Number(t?.minSize) || 0);
      if (n < 2 || !(Number(t?.percent) > 0)) continue;
      lines.push(`- Groups of ${n} or more booked together: ${t.percent}% off for each person${win}`);
    }
  }
  return lines;
}

/**
 * The prompt block about discounts. `promoLines` from promoKnowledge,
 * `saleNames` the services on sale on the menu itself ("Gel-X −15%").
 * When the salon has set promotions, they are the ONLY discounts the bot may
 * quote — an older note that says otherwise loses. With nothing set, the
 * salon's notes stay the only source, as before.
 */
export function discountRules(promoLines: string[], saleNames: string[]): string[] {
  const out: string[] = [];
  if (promoLines.length) {
    out.push(`SALON PROMOTIONS — set in the salon's own promotion settings; the booking you make applies them by itself. A customer gets the ONE best percent that fits each service, never two added together:\n${promoLines.join('\n')}`);
  }
  if (saleNames.length) out.push(`ON-SALE SERVICES: ${saleNames.join(', ')} (the sale price is already in the menu above).`);
  if (promoLines.length || saleNames.length) {
    out.push('DISCOUNTS — the promotions and sale prices above are the ONLY discounts you may quote, with their exact percent and dates. If the salon\'s notes or facts mention a different discount or percent (an older "special", another number), they are out of date: do NOT quote it and never use it in a price or a total. If the customer asks about it, say the salon will confirm any other offer at the visit.');
  } else {
    out.push('No promotion is set in the salon\'s system and no service is on sale. Do not invent a discount — only mention an offer if the salon\'s own notes above state one, and only within its dates; never work it into a total, because the booking will not apply it.');
  }
  return out;
}
