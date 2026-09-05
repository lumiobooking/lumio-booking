'use client';

// ===========================================================================
// Hosted online booking at /book/<slug>.
//
// Layout (rebuilt to the pattern every modern booking site converges on —
// Fresha / Booksy / Vagaro / atledpos):
//
//   Desktop:  [ left: pick services · tech · time · details ] [ right: sticky cart ]
//   Mobile:   one column + a floating action bar that is never hidden.
//
// Flow: Services (multi-select) -> Technician -> Date & time -> Confirm.
// Picking the service FIRST is what lets us show only the technicians who can
// do it, and only the times when they are actually free.
// ===========================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams } from 'next/navigation';
import { RestaurantReserve } from './RestaurantReserve';
import { useIsMobile } from '../../../lib/responsive';
import { InstallAppButton } from '../../../components/InstallAppButton';
import { uiLocale } from '../../../lib/datetime';
import { todayInZone } from '../../../lib/salon-clock';
import { planOpeningBar } from '../../../lib/opening-bar';
import { bookLangForCountry, setBookLang, bt, btf, bookLocale } from '../../../lib/i18n-book';
import { gbpAttribution, gbpSearch, isGbpPath } from '../../../lib/gbp-source';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';
const INK = '#0f2a52';        // ink for text (headings, rows)
const SOFT = '#f4f6fb';

/** The salon's brand colour, softened — used for selected rows, chips, tints.
 *  Every accent in this page comes from the tenant's own branding, never a
 *  hard-coded palette, so a white-label salon keeps its identity. */
function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return `rgba(99,102,241,${alpha})`;
  return `rgba(${r},${g},${b},${alpha})`;
}
/** A darker shade of the accent for the header gradient. */
function shade(hex: string, amount = 0.28): string {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const f = (i: number) => {
    const v = parseInt(n.slice(i, i + 2), 16);
    return Number.isNaN(v) ? 0 : Math.max(0, Math.round(v * (1 - amount)));
  };
  return `rgb(${f(0)}, ${f(2)}, ${f(4)})`;
}

/**
 * Optional festive accent for the customer-facing booking page. The salon opts in
 * from Settings → Branding; 'off' (the default) keeps their own brand colour, so a
 * white-label tenant is never overridden without asking. 'auto' rotates by the US/CA
 * calendar; a fixed key pins one season. Admin screens are untouched.
 */
const SEASON_HUES: Record<string, string> = {
  holiday: '#c81e3a',   // late-year holidays (red/green season)
  valentine: '#e8467f', // February
  spring: '#0ea371',    // spring / Easter
  fall: '#e07b1a',      // autumn / Halloween
  winter: '#2563eb',    // deep winter
};
function seasonalAccent(theme: string | undefined | null, base: string): string {
  if (!theme || theme === 'off') return base;
  if (theme !== 'auto') return SEASON_HUES[theme] || base;
  const d = new Date(); const m = d.getMonth() + 1; const day = d.getDate();
  if (m === 12 || (m === 1 && day <= 6)) return SEASON_HUES.holiday;
  if (m === 2) return SEASON_HUES.valentine;
  if (m >= 3 && m <= 5) return SEASON_HUES.spring;
  if (m >= 9 && m <= 11) return SEASON_HUES.fall;
  return base;
}

interface DayHours { closed: boolean; openMinutes: number; closeMinutes: number; intervals?: { open: number; close: number }[] }
interface BookingRules {
  slotStepMinutes: number; minLeadHours: number; maxAdvanceDays: number;
  allowCustomerChooseStaff: boolean; currency: string; currencySymbol: string;
  symbolPosition: 'before' | 'after'; priceDecimals: number; defaultPaymentMethod: 'online' | 'onsite';
  onlinePaymentEnabled: boolean; payLaterEnabled: boolean;
  businessHours: DayHours[]; daysOff: string[];
  groupPolicy?: 'strict' | 'flexible'; // salon's choice: refuse or serve-in-turns when the party outnumbers the team
  /** What the badge at the top may claim — see lib/opening-bar.ts. */
  soonestBar?: 'hours' | 'soonest' | 'off';
}
const OPEN: DayHours = { closed: false, openMinutes: 540, closeMinutes: 1080 };
const DEFAULT_RULES: BookingRules = {
  slotStepMinutes: 30, minLeadHours: 1, maxAdvanceDays: 60,
  allowCustomerChooseStaff: true, currency: 'USD', currencySymbol: '', symbolPosition: 'before',
  priceDecimals: 2, defaultPaymentMethod: 'onsite', onlinePaymentEnabled: true, payLaterEnabled: true, groupPolicy: 'strict',
  businessHours: [{ closed: true, openMinutes: 540, closeMinutes: 1080 }, OPEN, OPEN, OPEN, OPEN, OPEN, OPEN],
  daysOff: [],
};
const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', CAD: '$', AUD: '$', VND: '₫', JPY: '¥', SGD: '$' };
/**
 * Amounts arrive in the currency's smallest unit. Dollars have cents so 12345
 * is $123.45; the đồng has no sub-unit, so 250000 IS 250,000₫ and dividing it
 * would quote the customer a hundredth of the price on the page they book from.
 * Zero decimals therefore means no division, and a thousands separator, because
 * 250000₫ is unreadable without one.
 */
function fmtMoney(minorUnits: number, r: BookingRules): string {
  const s = r.currencySymbol || SYMBOLS[r.currency] || r.currency + ' ';
  const dec = r.priceDecimals ?? 2;
  const n = dec === 0
    ? Math.round(minorUnits).toLocaleString(bookLocale())
    : (minorUnits / 10 ** dec).toFixed(dec);
  return r.symbolPosition === 'after' ? `${n}${s}` : `${s}${n}`;
}

interface WdRule { day: number; categoryId: string | null; percent: number }
interface WeekdayDiscounts { enabled: boolean; message: string; rules: WdRule[] }
interface DateRule { startDate: string; endDate: string | null; categoryId: string | null; percent: number; label?: string }
interface DateDiscounts { enabled: boolean; rules: DateRule[] }
interface DepositPolicy { enabled: boolean; type: 'percent' | 'fixed'; percent: number; fixedCents: number; scope: 'all' | 'new' | 'repeat_noshow'; noShowThreshold: number }
interface Salon {
  name: string; slug: string; businessType?: string; timezone: string; address?: string | null; contactPhone?: string | null;
  branding?: { accentColor: string; logoUrl: string; logoScale?: number; seasonalTheme?: string }; booking?: BookingRules;
  weekdayDiscounts?: WeekdayDiscounts; dateDiscounts?: DateDiscounts; deposit?: DepositPolicy; cardFee?: { enabled: boolean; percent: number };
  firstVisit?: { enabled: boolean; percent: number; message: string; rules?: { visit: number; percent: number }[] };
  groupDiscount?: { enabled: boolean; message: string; tiers: { minSize: number; percent: number }[] };
  rating?: { value: number; count: number } | null;
  /** ISO country of the salon; decides the language this page speaks. */
  country?: string;
}
interface Addon { id: string; name: string; durationMinutes: number; priceCents: number }
interface Service { id: string; name: string; description?: string | null; durationMinutes: number; priceCents: number; discountPercent?: number; categoryId?: string | null; isFeatured?: boolean; priceFrom?: boolean; imageUrl?: string | null; addons: Addon[] }
interface Category { id: string; name: string; icon?: string | null }
interface Staff {
  id: string; firstName: string; lastName: string | null; avatarUrl: string | null;
  /** Services this tech is linked to (their skills). Empty/absent = not restricted. */
  staffServices?: { serviceId: string }[];
  /** Days this tech works (0=Sun..6=Sat). Empty/absent = no schedule configured. */
  workingHours?: { dayOfWeek: number }[];
}
interface ServiceAvail {
  eligibleStaffIds: string[];
  staffBusy: Record<string, { start: string; end: string }[]>;
  noStaff?: boolean;
  /** Salon has techs, but none lists this service — bookable via "Any" only. */
  unstaffed?: boolean;
}
interface Availability {
  eligibleStaffIds: string[];   // union across services (for the specific-tech path)
  staffBusy: Record<string, { start: string; end: string }[]>; // merged per tech
  /** The salon has no technician on file at all — every open slot is bookable and the
   *  shop assigns someone afterwards. */
  noStaff?: boolean;
  /** One entry per picked service. This is what makes a specialist salon work: with
   *  "Any tech", a time is offered when EACH service has at least one free specialist
   *  — not necessarily the same person. The front desk assigns the right tech to each
   *  service line at check-in (the POS/walk-in board already supports per-line techs). */
  perService: ServiceAvail[];
  /** Same entries keyed by serviceId — used by the group matching. */
  perServiceById?: Record<string, ServiceAvail>;
}
type Slot = { start: Date; end: Date };
type Step = 1 | 2 | 3 | 4 | 5; // 1 services · 2 tech · 3 time · 4 confirm · 5 done

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function weekdayPctFor(wd: WeekdayDiscounts | undefined, date: Date | null, categoryId: string | null | undefined): number {
  if (!wd?.enabled || !date || !Array.isArray(wd.rules)) return 0;
  const day = date.getDay();
  let best = 0;
  for (const r of wd.rules) {
    if (r.day !== day) continue;
    if (r.categoryId && r.categoryId !== categoryId) continue;
    if (r.percent > best) best = r.percent;
  }
  return Math.min(90, Math.max(0, best));
}
function datePctFor(dd: DateDiscounts | undefined, date: Date | null, categoryId: string | null | undefined): number {
  if (!dd?.enabled || !date || !Array.isArray(dd.rules)) return 0;
  const s = ymd(date);
  let best = 0;
  for (const r of dd.rules) {
    if (!r?.startDate) continue;
    if (categoryId && r.categoryId && r.categoryId !== categoryId) continue;
    const end = r.endDate || r.startDate;
    if (r.startDate <= s && s <= end && r.percent > best) best = r.percent;
  }
  return Math.min(90, Math.max(0, best));
}
function promoPctFor(salon: Salon | null | undefined, date: Date | null, categoryId: string | null | undefined): number {
  return Math.max(weekdayPctFor(salon?.weekdayDiscounts, date, categoryId), datePctFor(salon?.dateDiscounts, date, categoryId));
}
function svcDiscount(s: Service | null): number { return s ? Math.min(90, Math.max(0, s.discountPercent ?? 0)) : 0; }
function svcNetCents(s: Service | null): number { return s ? Math.round((s.priceCents * (100 - svcDiscount(s))) / 100) : 0; }

/**
 * Treats the wall-clock digits of `local` as a time IN `timeZone` (the salon's
 * zone) and returns the matching UTC instant — so 3:00 PM means 3 PM at the salon
 * no matter what timezone the customer's phone is set to.
 */
function wallTimeToISO(local: Date, timeZone: string): string {
  const y = local.getFullYear(), mo = local.getMonth(), d = local.getDate(), h = local.getHours(), mi = local.getMinutes();
  const naiveUTC = Date.UTC(y, mo, d, h, mi);
  const dtf = new Intl.DateTimeFormat(uiLocale(), { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const parts = dtf.formatToParts(new Date(naiveUTC));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let hh = g('hour'); if (hh === 24) hh = 0;
  const asTz = Date.UTC(g('year'), g('month') - 1, g('day'), hh, g('minute'), g('second'));
  const offset = asTz - naiveUTC;
  return new Date(naiveUTC - offset).toISOString();
}

/**
 * Fire the ONE conversion the salon's ads care about — exactly once per booking,
 * through exactly one pipe. The layout loads a single tracking method per salon
 * (GTM or GA4, never both), and this mirrors that at event level:
 *   GTM present  -> dataLayer 'booking_completed' only (the container maps it);
 *   GA4 present  -> gtag 'purchase' only;
 *   neither      -> nothing locally.
 * A postMessage always goes to the parent page so an EMBEDDED form can be
 * measured in the salon website's own tag setup/session. No customer PII is
 * ever included — only booking id, value, currency and service names.
 */
const firedBookings = new Set<string>();
function fireConversion(data: { id: string; valueCents: number; currency: string; slug: string; items: { id?: string; name: string; priceCents: number }[] }) {
  if (typeof window === 'undefined') return;
  if (!data.id) return; // transaction_id must be the backend booking id — never empty
  if (firedBookings.has(data.id)) return; // idempotent: never double-fire one booking
  firedBookings.add(data.id);
  const value = Math.round(data.valueCents) / 100;
  const items = data.items.map((it) => ({ ...(it.id ? { item_id: it.id } : {}), item_name: it.name, price: Math.round(it.priceCents) / 100, quantity: 1 }));
  const payload = { transaction_id: data.id, value, currency: (data.currency || 'USD').toUpperCase(), items };
  // EMBEDDED (iframe on the salon's website): the parent page owns measurement —
  // hand the conversion up and fire nothing locally, so it lands exactly once,
  // inside the website's own ad session. TOP WINDOW (direct / Google Maps / ads
  // to the booking link): measure right here through the one loaded method.
  let inFrame = false;
  try { inFrame = window.self !== window.top; } catch { inFrame = true; }
  if (!inFrame) {
    try {
      const w = window as unknown as { dataLayer?: Record<string, unknown>[]; gtag?: (...a: unknown[]) => void; google_tag_manager?: unknown };
      if (w.google_tag_manager) {
        w.dataLayer = w.dataLayer || [];
        w.dataLayer.push({ event: 'booking_completed', ...payload });
      } else if (typeof w.gtag === 'function') {
        w.gtag('event', 'purchase', payload);
      }
    } catch { /* ignore */ }
  }
  // Embedded only: hand the conversion to the PARENT site — to a verified
  // origin, never '*'. The plugin passes its own origin in ?po=; if absent we
  // fall back to the referrer's origin (the page that framed us). No valid
  // target -> nothing is sent.
  if (inFrame) {
    try {
      const q = new URLSearchParams(window.location.search);
      const po = q.get('po') || '';
      let target = '';
      if (/^https?:\/\/[^/]+$/i.test(po)) target = po;
      else if (document.referrer) { try { target = new URL(document.referrer).origin; } catch { /* ignore */ } }
      if (target) {
        window.parent.postMessage({ type: 'lumio:booking_completed', schema_version: 1, salon_slug: data.slug, ...payload }, target);
      }
    } catch { /* ignore */ }
  }
}

export default function PublicBookingPage() {
  const params = useParams();
  const slug = String(params?.slug ?? '');
  const base = `${API_URL}/public/salons/${encodeURIComponent(slug)}`;
  const isMobile = useIsMobile();
  const embedded = useEmbedded();

  const [salon, setSalon] = useState<Salon | null>(null);
  // The page speaks the salon's language, not the visitor's. A Vietnamese shop
  // serves Vietnamese customers on any browser; a US shop keeps its English.
  setBookLang(bookLangForCountry(salon?.country));
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * Offer code the visitor arrived with (campaign email/SMS link → ?offer=CODE).
   *
   * Remembered for 7 days, because the link is not always the last thing that
   * happens: an installed PWA can re-launch on its start_url (no query string),
   * a customer can bounce to their calendar and come back, or share the page
   * with the params trimmed. Losing the code there would quietly cost the
   * customer their offer and cost us the attribution.
   */
  /**
   * Put the campaign on the URL of a /gbp visit.
   *
   * This is for the analytics tags, not for the booking — the booking now reads
   * the path directly and cannot be broken by a URL that fails to change. The
   * layout used to do this with an inline <script> that never executed, so a
   * page_view from Google Maps was reported with no campaign for months.
   *
   * An effect runs late, after hydration, so a tag that already fired keeps its
   * uncredited page_view. That is strictly better than today, where nothing
   * fires it at all, and it is the earliest point that is guaranteed to run.
   */
  useEffect(() => {
    if (typeof window === 'undefined' || !isGbpPath(window.location.pathname)) return;
    const next = gbpSearch(window.location.search);
    if (next) window.history.replaceState(null, '', window.location.pathname + next + window.location.hash);
  }, []);

  const [offerCode] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    const KEY = 'lumio_offer';
    const TTL = 7 * 24 * 60 * 60 * 1000;
    const fromUrl = (new URLSearchParams(window.location.search).get('offer') || '').toUpperCase().slice(0, 16);
    try {
      if (fromUrl) {
        window.localStorage.setItem(KEY, JSON.stringify({ code: fromUrl, at: Date.now() }));
        return fromUrl;
      }
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return '';
      const saved = JSON.parse(raw) as { code?: string; at?: number };
      if (!saved?.code || !saved.at || Date.now() - saved.at > TTL) { window.localStorage.removeItem(KEY); return ''; }
      return saved.code.toUpperCase().slice(0, 16);
    } catch { return fromUrl; }
  });
  const [step, setStep] = useState<Step>(1);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [serviceId, setServiceId] = useState('');
  const [extraServiceIds, setExtraServiceIds] = useState<string[]>([]);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [staffId, setStaffId] = useState('');
  const [slot, setSlot] = useState<Slot | null>(null);
  const [avail, setAvail] = useState<Availability | null>(null);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', birthDate: '', partySize: '1' });
  const [paymentType, setPaymentType] = useState<'PAY_ONLINE' | 'PAY_LATER'>('PAY_LATER');
  const [smsConsent, setSmsConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ paymentStatus: string | null } | null>(null);
  // The visit cart. A customer who wants two different times books TWO visits:
  // finish one, press "add another", pick again. Saved visits sit here as chips
  // until one final Book creates them all. Contact details are shared.
  interface CartVisit {
    serviceId: string; extraServiceIds: string[]; addonIds: string[];
    staffId: string; slot: Slot; totalCents: number; label: string;
  }
  const [visitCart, setVisitCart] = useState<CartVisit[]>([]);
  // Group booking: friends who come along. The booker keeps the existing
  // selection states; each extra guest carries only a name and their services.
  // Everyone shares ONE time slot — that is what "coming together" means.
  interface ExtraGuest { name: string; serviceIds: string[] }
  const [extraGuests, setExtraGuests] = useState<ExtraGuest[]>([]);
  const [activeGuest, setActiveGuest] = useState(0); // 0 = the booker
  const isGroup = extraGuests.length > 0;
  const MAX_GUESTS = 4; // booker + 3 — parallel-capacity maths stays sane
  // What actually got created, for the confirmation screen.
  const [bookedVisits, setBookedVisits] = useState<string[]>([]);

  const rules = salon?.booking ?? DEFAULT_RULES;
  const baseAccent = salon?.branding?.accentColor || '#6366f1';
  // Effective accent = the salon's colour, unless they turned on a seasonal theme.
  const accent = seasonalAccent(salon?.branding?.seasonalTheme, baseAccent);
  const service = services.find((s) => s.id === serviceId) ?? null;
  const employee = staff.find((s) => s.id === staffId) ?? null;
  // The "choose your tech" step only earns its place when there are at least two
  // people to pick between AND the salon allows choosing. A solo shop — or one with
  // no team on file — skips it entirely: one less tap, and nothing to decide.
  const chooseStaff = rules.allowCustomerChooseStaff && staff.length >= 2;
  useEffect(() => {
    // When the step is skipped, keep the (hidden) tech sensible: a one-person shop
    // books that person by name; an empty team leaves it to the shop ("Any").
    if (staff.length === 1) setStaffId((prev) => prev || staff[0].id);
    else if (staff.length === 0) setStaffId('');
  }, [staff]);
  const serviceAddons = service?.addons ?? [];
  const selectedAddons = serviceAddons.filter((a) => addonIds.includes(a.id));
  const fmt = useCallback((c: number) => fmtMoney(c, rules), [rules]);

  // ---- cart -----------------------------------------------------------------
  // The first service picked stays the "primary" one under the hood (add-ons and
  // staff eligibility hang off it); the visitor only ever sees one flat cart.
  const pickedServiceIds = serviceId ? [serviceId, ...extraServiceIds.filter((x) => x !== serviceId)] : [];
  const toggleService = (id: string) => {
    setStaffId(''); setSlot(null);
    if (id === serviceId) {
      const rest = extraServiceIds.filter((x) => x !== id);
      setServiceId(rest[0] ?? ''); setExtraServiceIds(rest.slice(1)); setAddonIds([]);
      return;
    }
    if (extraServiceIds.includes(id)) { setExtraServiceIds((p) => p.filter((x) => x !== id)); return; }
    if (!serviceId) { setServiceId(id); setAddonIds([]); return; }
    setExtraServiceIds((p) => [...p, id]);
  };

  // Group tier the customer already qualifies for (party size is known
  // client-side). Mirrors the server rule exactly: ONE best % per line —
  // max(weekday/date promo, group tier) — never stacked.
  const partyN = parseInt(form.partySize, 10) || 1;
  const groupPct = salon?.groupDiscount?.enabled && partyN >= 2
    ? salon.groupDiscount.tiers.reduce((b, ti) => (ti.minSize <= partyN && ti.percent > b ? ti.percent : b), 0)
    : 0;

  // Prices: each service keeps its own discount + the best promo for its line.
  const lineFor = (s: Service) => {
    const net = svcNetCents(s);
    const promo = Math.max(promoPctFor(salon, selectedDate, s.categoryId ?? null), groupPct);
    return { id: s.id, name: s.name, durationMinutes: s.durationMinutes, fullCents: s.priceCents, priceCents: Math.round((net * (100 - promo)) / 100), imageUrl: s.imageUrl ?? null };
  };
  const cartLines = pickedServiceIds
    .map((id) => services.find((s) => s.id === id))
    .filter((s): s is Service => !!s)
    .map(lineFor);
  const addonLines = selectedAddons.map((a) => ({ id: a.id, name: a.name, durationMinutes: a.durationMinutes, fullCents: a.priceCents, priceCents: a.priceCents, addon: true }));
  const allLines = [...cartLines, ...addonLines];
  const totalCents = allLines.reduce((s, l) => s + l.priceCents, 0);
  const fullCents = allLines.reduce((s, l) => s + l.fullCents, 0);
  const totalDuration = allLines.reduce((s, l) => s + l.durationMinutes, 0);
  const savingsCents = Math.max(0, fullCents - totalCents);
  const anyDiscount = savingsCents > 0;

  const dep = salon?.deposit;
  const depositCents = dep?.enabled && dep.scope === 'all' && service && totalCents > 0
    ? Math.min(totalCents, dep.type === 'fixed' ? dep.fixedCents : Math.round((totalCents * dep.percent) / 100))
    : 0;

  const removeLine = (id: string) => {
    if (addonIds.includes(id)) { setAddonIds((p) => p.filter((x) => x !== id)); return; }
    toggleService(id);
  };

  // ---- data -----------------------------------------------------------------
  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      // ONE round-trip for everything the page needs (was 4 parallel requests,
      // each re-resolving the slug + its own DB hit). Falls back to the 4-call
      // path only if an older backend has no /bootstrap yet.
      const bRes = await fetch(`${base}/bootstrap`);
      if (bRes.ok) {
        const boot = await bRes.json();
        setSalon(boot.salon); setServices(boot.services ?? []); setStaff(boot.staff ?? []); setCategories(boot.categories ?? []);
      } else if (bRes.status === 404) {
        // Distinguish "no salon" from "old backend without /bootstrap".
        const sRes = await fetch(base);
        if (!sRes.ok) { setLoadError(bt(sRes.status === 404 ? 'This booking page was not found.' : 'Could not load the salon.')); return; }
        const [salonData, servicesData, staffData, catData] = await Promise.all([
          sRes.json(),
          fetch(`${base}/services`).then((r) => r.json()).catch(() => []),
          fetch(`${base}/staff`).then((r) => r.json()).catch(() => []),
          fetch(`${base}/categories`).then((r) => r.json()).catch(() => []),
        ]);
        setSalon(salonData); setServices(servicesData ?? []); setStaff(staffData ?? []); setCategories(catData ?? []);
      } else { setLoadError(bt('Could not load the salon.')); return; }
    } catch { setLoadError(bt('Could not reach the booking service. Please try again later.')); }
    finally { setLoading(false); }
  }, [base]);
  useEffect(() => { if (slug) load(); }, [slug, load]);

  useEffect(() => {
    if (!salon) return;
    const r = salon.booking ?? DEFAULT_RULES;
    setPaymentType(r.defaultPaymentMethod === 'online' && r.onlinePaymentEnabled ? 'PAY_ONLINE' : 'PAY_LATER');
  }, [salon]);

  // Availability for the chosen date. With several services a technician must be
  // able to do ALL of them, so intersect eligibility and merge busy times.
  useEffect(() => {
    if (!selectedDate || !serviceId) { setAvail(null); return; }
    const d = ymd(selectedDate);
    const guestServiceIds = extraGuests.flatMap((g) => g.serviceIds);
    const ids = [...new Set([serviceId, ...extraServiceIds.filter((x) => x !== serviceId), ...guestServiceIds])];
    Promise.all(ids.map((sid) =>
      fetch(`${base}/availability?serviceId=${encodeURIComponent(sid)}&date=${d}`).then((r) => r.json()).catch(() => null),
    )).then((results) => {
      const valid = results.filter(Boolean) as ServiceAvail[];
      if (valid.length === 0) { setAvail(null); return; }
      // Union of everyone who can do at least one of the services, plus each tech's
      // merged busy times (their calendar is the same across services).
      const unionIds = new Set<string>();
      const staffBusy: Record<string, { start: string; end: string }[]> = {};
      for (const r of valid) {
        for (const id of r.eligibleStaffIds) unionIds.add(id);
        for (const [id, arr] of Object.entries(r.staffBusy)) (staffBusy[id] ||= []).push(...arr);
      }
      const byId: Record<string, ServiceAvail> = {};
      valid.forEach((r, i) => { if (ids[i]) byId[ids[i]] = r; });
      setAvail({
        eligibleStaffIds: [...unionIds],
        staffBusy,
        noStaff: valid.every((r) => r.noStaff),
        // The booker's own services drive the single-visit logic…
        perService: ids
          .map((sid, i) => ({ sid, r: valid[i] }))
          .filter((x) => x.r && (x.sid === serviceId || extraServiceIds.includes(x.sid)))
          .map((x) => x.r),
        // …while the by-id map serves the group matching.
        perServiceById: byId,
      });
    }).catch(() => setAvail(null));
  }, [base, selectedDate, serviceId, extraServiceIds, extraGuests]);

  // ---- Online deposit (hosted provider modal) ----
  // Only runs when the salon has connected a real online provider AND a deposit
  // is due. The browser NEVER decides the outcome: after the modal closes we ask
  // our own server, which verifies the payment directly with the provider.
  function loadHelcimPay(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined') return resolve();
      if ((window as any).appendHelcimPayIframe) return resolve();
      const el = document.createElement('script');
      el.src = 'https://secure.helcim.app/helcim-pay/services/start.js';
      el.onload = () => resolve();
      el.onerror = () => reject(new Error('helcimpay-load-failed'));
      document.head.appendChild(el);
    });
  }

  // Providers that return a HOSTED PAGE URL (Square Payment Links): open it in
  // a new tab, then poll our server which verifies the payment with the
  // provider. Poll every 6s (public confirm endpoint is rate-limited 12/min).
  async function payDepositViaUrl(bookingId: string, url: string) {
    window.open(url, '_blank', 'noopener');
    for (let i = 0; i < 100; i++) {
      await new Promise((s2) => setTimeout(s2, 6000));
      try {
        const c = await fetch(`${base}/bookings/${bookingId}/online-confirm`, { method: 'POST' });
        const cj = await c.json().catch(() => null);
        if (cj?.ok) { setResult({ paymentStatus: 'PAID' }); return; }
      } catch { /* transient network error — keep polling */ }
    }
  }

  async function payDepositOnline(bookingId: string) {
    try {
      const r = await fetch(`${base}/bookings/${bookingId}/online-checkout`, { method: 'POST' });
      const j = await r.json().catch(() => null);
      if (!r.ok) return;
      if (j?.url && !j?.checkoutToken) { await payDepositViaUrl(bookingId, String(j.url)); return; }
      if (!j?.checkoutToken) return;

      await loadHelcimPay();
      const w = window as any;
      if (typeof w.appendHelcimPayIframe !== 'function') return;

      // Wait for the modal to finish (success or cancel), with a safety timeout.
      await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; window.removeEventListener('message', onMsg); resolve(); } };
        const onMsg = (ev: MessageEvent) => {
          const d: any = ev.data;
          if (d && typeof d === 'object' && String(d.eventName || '').includes(String(j.checkoutToken))) finish();
        };
        window.addEventListener('message', onMsg);
        w.appendHelcimPayIframe(j.checkoutToken);
        setTimeout(finish, 5 * 60_000);
      });

      // Server-side verification (settlement can lag a moment, so retry briefly).
      for (let i = 0; i < 5; i++) {
        const c = await fetch(`${base}/bookings/${bookingId}/online-confirm`, { method: 'POST' });
        const cj = await c.json().catch(() => null);
        if (cj?.ok) { setResult({ paymentStatus: 'PAID' }); return; }
        await new Promise((s2) => setTimeout(s2, 2000));
      }
    } catch {
      /* deposit not collected — the booking still stands, payable at the salon */
    }
  }

  async function submit() {
    if (!slot) return;
    setSubmitting(true); setError(null);

    // Multi-visit: create the saved visits first, one by one. Each is its own
    // appointment (own reminder, own cancel link). If one fails we stop and say
    // exactly which — the ones already created stand.
    const done: string[] = [];
    for (let i = 0; i < visitCart.length; i++) {
      const v = visitCart[i];
      try {
        const r = await fetch(`${base}/bookings`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serviceId: v.serviceId,
            serviceIds: [v.serviceId, ...v.extraServiceIds.filter((x) => x !== v.serviceId)],
            addonIds: v.addonIds, preferredStaffId: v.staffId || undefined,
            startTime: salon?.timezone ? wallTimeToISO(v.slot.start, salon.timezone) : v.slot.start.toISOString(),
            customerFirstName: form.firstName, customerLastName: form.lastName || undefined,
            customerEmail: form.email || undefined, customerPhone: form.phone || undefined,
            customerBirthDate: form.birthDate || undefined,
            partySize: parseInt(form.partySize, 10) || 1,
            smsConsent,
            paymentType: 'PAY_LATER',
          }),
        });
        const b = await r.json().catch(() => null);
        if (!r.ok) {
          setError(`Visit ${i + 1} (${v.label}) could not be booked: ${(b && b.message) || r.status}. ${done.length ? bt('Your earlier visits WERE booked.') : ''}`);
          setVisitCart((c) => c.slice(i)); // keep only the not-yet-created ones
          setBookedVisits(done); setSubmitting(false);
          return;
        }
        done.push(v.label);
        if (b?.booking?.id) {
          fireConversion({ id: String(b.booking.id), valueCents: typeof b?.booking?.priceCents === 'number' ? b.booking.priceCents : v.totalCents, currency: rules.currency, slug, items: [] });
        }
      } catch {
        setError(`Network error while booking visit ${i + 1}. ${done.length ? bt('Your earlier visits WERE booked.') : bt('Please try again.')}`);
        setVisitCart((c) => c.slice(i));
        setBookedVisits(done); setSubmitting(false);
        return;
      }
    }

    try {
      const res = await fetch(`${base}/bookings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId,
          serviceIds: [serviceId, ...extraServiceIds.filter((x) => x !== serviceId)],
          addonIds, preferredStaffId: staffId || undefined,
          startTime: salon?.timezone ? wallTimeToISO(slot.start, salon.timezone) : slot.start.toISOString(),
          customerFirstName: form.firstName, customerLastName: form.lastName || undefined,
          customerEmail: form.email || undefined, customerPhone: form.phone || undefined,
          customerBirthDate: form.birthDate || undefined,
          partySize: isGroup ? extraGuests.length + 1 : (parseInt(form.partySize, 10) || 1),
          ...(isGroup ? { notes: `Group booking (${extraGuests.length + 1} people)` } : {}),
          smsConsent,
          referralCode: (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('ref') : null) || undefined,
          // Campaign attribution: capture UTM from THIS page's URL. For plugin
          // embeds the plugin forwards the parent page's UTM into the iframe src,
          // so window.location.search has them in both flows.
          ...(() => {
            if (typeof window === 'undefined') return {};
            const q = new URLSearchParams(window.location.search);
            const g = (k: string) => q.get(k) || undefined;
            // Landing snapshot: the plugin forwards the WEBSITE's stored
            // first-party attribution as lumio_lu / lumio_rf / lumio_at; on the
            // hosted page this window IS the landing context.
            return {
              // Promo code from a campaign link — travels with the booking so the
              // till applies it without the customer reciting anything. Falls back
              // to the remembered code when the PWA re-launched without params.
              offerCode: offerCode || undefined,
              // The /gbp route names its own campaign, from the PATH.
              //
              // It used to name it from the URL, stamped by an inline script in
              // the layout that was in the page and never executed — React
              // inserts nested-layout markup, and an inserted <script> does not
              // run. So every customer arriving from Google Maps carried no utm
              // and was filed as an untagged hosted link. A path cannot be
              // stripped by a redirect or lost in a PWA relaunch; a query string
              // can, and was.
              ...gbpAttribution(window.location.pathname, {
                utmSource: g('utm_source'), utmMedium: g('utm_medium'),
                utmCampaign: g('utm_campaign'), utmContent: g('utm_content'),
              }),
              utmTerm: g('utm_term'), gclid: g('gclid'), gbraid: g('gbraid'), wbraid: g('wbraid'),
              attrLandingUrl: (g('lumio_lu') || window.location.href).slice(0, 900),
              attrReferrer: (g('lumio_rf') || document.referrer || '').slice(0, 900) || undefined,
              attrCapturedAt: g('lumio_at') || new Date().toISOString(),
            };
          })(),
          paymentType: (visitCart.length > 0 || isGroup) ? 'PAY_LATER' : paymentType,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setError((body && body.message) || `Booking failed (${res.status})`); return; }
      setResult({ paymentStatus: body?.payment?.status ?? null });
      const when = `${slot.start.toLocaleDateString(bookLocale(), { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtTime(slot.start)}`;
      const booked = [...done, `${when} · ${allLines.map((l) => l.name).join(', ')}${isGroup ? ` — ${form.firstName || 'You'}` : ''}`];

      // Group guests: one appointment each, SAME start time. Only a name is
      // sent (no phone/email), so the CRM never merges a friend into the
      // booker's record and contact velocity limits don't trip.
      for (let gi = 0; gi < extraGuests.length; gi++) {
        const g = extraGuests[gi];
        const gName = g.name.trim() || `Guest ${gi + 2}`;
        try {
          const gr = await fetch(`${base}/bookings`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              serviceId: g.serviceIds[0],
              serviceIds: g.serviceIds,
              preferredStaffId: undefined,
              startTime: salon?.timezone ? wallTimeToISO(slot.start, salon.timezone) : slot.start.toISOString(),
              customerFirstName: gName,
              partySize: extraGuests.length + 1,
              notes: `Group booking with ${form.firstName || 'the main guest'} (${extraGuests.length + 1} people)`,
              smsConsent: false,
              paymentType: 'PAY_LATER',
            }),
          });
          const gb = await gr.json().catch(() => null);
          if (!gr.ok) {
            setError(`${gName}'s booking could not be created: ${(gb && gb.message) || gr.status}. Your own booking IS confirmed — please call the salon to add them.`);
          } else {
            const names = g.serviceIds.map((sid) => services.find((sv) => sv.id === sid)?.name).filter(Boolean).join(', ');
            booked.push(`${when} · ${names} — ${gName}`);
            if (gb?.booking?.id) {
              fireConversion({ id: String(gb.booking.id), valueCents: typeof gb?.booking?.priceCents === 'number' ? gb.booking.priceCents : 0, currency: rules.currency, slug, items: [] });
            }
          }
        } catch {
          setError(`Network error while adding ${gName}. Your own booking IS confirmed — please call the salon to add them.`);
        }
      }

      setBookedVisits(booked);
      setVisitCart([]);
      if (body?.booking?.id) {
        fireConversion({
          id: String(body.booking.id),
          // Trust the server's figure for the booked value; the client total is
          // only a fallback for older API responses.
          valueCents: typeof body?.booking?.priceCents === 'number' ? body.booking.priceCents : totalCents,
          currency: rules.currency,
          slug,
          items: allLines.map((l) => ({ id: l.id, name: l.name, priceCents: l.priceCents })),
        });
      }
      setStep(5);
      // Salon has a real online provider + a deposit is due -> collect it now.
      if (body?.onlineProvider && (body?.depositCents ?? 0) > 0 && body?.booking?.id) {
        void payDepositOnline(String(body.booking.id));
      }
    } catch { setError(bt('Network error. Please try again.')); }
    finally { setSubmitting(false); }
  }

  /** Freeze the on-screen selection into the cart and start a fresh visit. */
  function addAnotherVisit() {
    if (!slot) return;
    const names = allLines.map((l) => l.name).join(', ');
    const when = `${slot.start.toLocaleDateString(bookLocale(), { weekday: 'short', month: 'short', day: 'numeric' })} · ${fmtTime(slot.start)}`;
    setVisitCart((c) => [...c, {
      serviceId, extraServiceIds, addonIds, staffId, slot,
      totalCents, label: `${when} · ${names}`,
    }]);
    // Clear only the visit itself — the customer's details carry over.
    setServiceId(''); setExtraServiceIds([]); setAddonIds([]); setStaffId('');
    setSlot(null); setAvail(null); setSelectedDate(null); setError(null);
    setStep(1);
    // Online deposit flows redirect to a payment page, which can only settle
    // ONE booking — multi-visit is therefore pay-at-salon.
    setPaymentType('PAY_LATER');
  }

  function removeCartVisit(i: number) {
    setVisitCart((c) => c.filter((_, k) => k !== i));
  }

  function reset() {
    setStep(1); setSelectedDate(null); setServiceId(''); setExtraServiceIds([]); setAddonIds([]); setStaffId(''); setSlot(null);
    setAvail(null); setForm({ firstName: '', lastName: '', email: '', phone: '', birthDate: '', partySize: '1' });
    setPaymentType('PAY_LATER'); setResult(null); setError(null);
    setVisitCart([]); setBookedVisits([]);
    setExtraGuests([]); setActiveGuest(0);
  }

  // Embedded: bring the widget back into view when the step changes.
  const prevStep = useRef(step);
  useEffect(() => {
    const changed = prevStep.current !== step;
    prevStep.current = step;
    if (!changed || !embedded) return;
    try { window.parent.postMessage({ type: 'lumio-embed-scroll-into-view' }, '*'); } catch { /* ignore */ }
    window.scrollTo({ top: 0 });
  }, [step, embedded]);
  useEffect(() => { if (!embedded) window.scrollTo({ top: 0, behavior: 'smooth' }); }, [step, embedded]);

  // ---- embed on a phone: a launcher card that opens the form full-screen -------
  // Inside a content-sized iframe there is no viewport, so sticky headers and fixed
  // action bars can only ever be faked — and on a phone the fake always loses: the
  // page fights the scroll and the Continue button hides at the end of the menu.
  // So on a phone the embed shows a card; tapping it makes the frame take over the
  // screen (still on the salon's site) and from that moment the form has a real
  // viewport and behaves exactly like the hosted booking page.
  const [expanded, setExpanded] = useState(false);
  const launcher = embedded && isMobile && !expanded;
  const fullscreen = embedded && isMobile && expanded;
  /** true when the form owns a real viewport: hosted page, or a full-screen embed. */
  const asPage = !embedded || fullscreen;

  const openFull = () => {
    try { window.parent.postMessage({ type: 'lumio-embed-expand' }, '*'); } catch { /* ignore */ }
    setExpanded(true);
  };
  const closeFull = () => {
    try { window.parent.postMessage({ type: 'lumio-embed-collapse' }, '*'); } catch { /* ignore */ }
    setExpanded(false);
  };
  useEffect(() => {
    if (!fullscreen) return;
    document.documentElement.style.height = 'auto';
    document.body.style.height = 'auto';
    document.body.style.overflow = 'auto';
    window.scrollTo(0, 0);
  }, [fullscreen]);

  // ---- where we are on the visitor's screen (desktop embed only) ---------------
  const { subscribe, enabled: pinning } = useHostViewport(embedded && !isMobile);
  // Desktop embed: the frame has no viewport of its own, so `sticky` does nothing.
  // We pin the header and the summary to the visitor's screen with a transform,
  // bounded by the block each of them belongs to.
  // The header is NOT pinned in an embed on purpose: it carries no controls the
  // visitor needs while scrolling a menu (the salon's own site header is right
  // above it anyway), and one more transformed layer per frame is one more thing
  // for the phone to composite. It scrolls away like any other block.
  const cartPin = usePin(subscribe, pinning, 'top', 14);

    // ---- validation -----------------------------------------------------------
  const phoneOk = isValidPhone(form.phone);
  const emailOk = !form.email.trim() || isValidEmail(form.email);
  const infoOk = form.firstName.trim().length > 0 && phoneOk && emailOk;

  if (loading) return <Shell accent="#6366f1" fullscreen={false}><BookingSkeleton /></Shell>;
  if (loadError) return <Shell accent="#6366f1" fullscreen={false}><Center>{loadError}</Center></Shell>;
  if (salon && salon.businessType === 'RESTAURANT') return <RestaurantReserve slug={slug} salon={salon} />;

  const canContinue =
    step === 1 ? (pickedServiceIds.length > 0 && extraGuests.every((g) => g.serviceIds.length > 0)) :
    step === 2 ? true :
    step === 3 ? !!slot :
    step === 4 ? infoOk && !submitting : false;

  // What the customer will actually pay across EVERYTHING being booked today —
  // every visit in the cart plus the one on screen, or every guest in a group.
  // Without this the panel says "$33.30" while the salon will charge for three
  // visits. Guest services use catalog prices (any extra discount the salon
  // applies can only make the real bill smaller, never bigger).
  const cartCents = visitCart.reduce((s, v) => s + v.totalCents, 0);
  const guestCents = extraGuests.reduce(
    (s, g) => s + g.serviceIds.reduce((x, sid) => x + (services.find((sv) => sv.id === sid)?.priceCents ?? 0), 0),
    0,
  );
  const grand =
    visitCart.length > 0 ? { count: visitCart.length + 1, cents: cartCents + totalCents, kind: 'visits' as const } :
    isGroup ? { count: extraGuests.length + 1, cents: guestCents + totalCents, kind: 'guests' as const } :
    null;

  const ctaLabel =
    step === 4 ? (submitting ? bt("Booking\u2026") : isGroup ? btf('Book for {n}', { n: extraGuests.length + 1 }) : visitCart.length > 0 ? btf('Book {n} visits', { n: visitCart.length + 1 }) : bt("Book")) :
    step === 1 ? (pickedServiceIds.length > 0 ? bt('Book for Me') : bt("Select a service")) : bt("Continue");

  const goNext = () => {
    // A group shares one time slot, so a single named tech makes no sense —
    // the tech step is skipped and every seat is assigned by the salon.
    if (step === 1 && pickedServiceIds.length) setStep(isGroup ? 3 : (chooseStaff ? 2 : 3));
    else if (step === 2) setStep(3);
    else if (step === 3 && slot) setStep(4);
    else if (step === 4) submit();
  };
  const goBack = () => {
    if (step === 2) setStep(1);
    else if (step === 3) setStep(isGroup ? 1 : (chooseStaff ? 2 : 1));
    else if (step === 4) setStep(3);
  };

  const stepTitle =
    step === 1 ? bt("Services") :
    step === 2 ? bt('Choose your nail tech') :
    step === 3 ? bt('Select time') :
    step === 4 ? bt('Confirm booking') : '';

  const stepHint =
    step === 1 ? bt('Tap ＋ to add a service. You can pick more than one.') :
    step === 2 ? bt('Go with the person you know, or let us give you the first one free.') :
    step === 3 ? `Every time below is really free${totalDuration ? ` for ${fmtDur(totalDuration)}` : ''}${employee ? ` with ${employee.firstName}` : ''}.` :
    '';

  const barTitle =
    step === 1 ? bt('BOOKING ONLINE') :
    step === 2 ? bt('Select Professional') :
    step === 3 ? bt('Select Time') : bt('Confirm Booking');

  const summary = (
    <CartPanel
      fill={!isMobile && !embedded}
      salon={salon} lines={allLines} fmt={fmt} totalCents={totalCents} fullCents={fullCents}
      anyDiscount={anyDiscount} totalDuration={totalDuration} employee={employee} slot={slot} selectedDate={selectedDate}
      onRemove={removeLine} canContinue={canContinue} ctaLabel={ctaLabel} onContinue={goNext} step={step} accent={accent} grand={grand}
    />
  );

  // The phone embed, before it is opened: one tap, and the real thing appears.
  if (launcher) {
    return (
      <Shell accent={accent} fullscreen={false}>
        <Launcher salon={salon} accent={accent} onOpen={openFull} rules={rules} services={services} />
      </Shell>
    );
  }

  return (
    <Shell accent={accent} fullscreen={fullscreen}>
      <div className="lumio-book" style={{ width: '100%', maxWidth: 1120, margin: '0 auto', ['--accent' as string]: accent } as React.CSSProperties}>
        {/* Top bar — salon name (step 1) or the step name with a back arrow.
            Sticky only where a real viewport exists (hosted page / full-screen). */}
        <div style={{ position: asPage ? 'sticky' : 'static', top: 0, zIndex: 30, flexShrink: 0,
          background: `linear-gradient(120deg, ${accent} 0%, ${shade(accent, 0.18)} 55%, ${shade(accent, 0.42)} 100%)`,
          color: '#fff',
          borderRadius: fullscreen ? 0 : '18px 18px 0 0', padding: isMobile ? '12px 14px' : '16px 20px',
          display: 'flex', alignItems: 'center', gap: 13, marginBottom: 0,
          boxShadow: `0 14px 34px -18px ${tint(accent, 0.95)}, inset 0 1px 0 rgba(255,255,255,0.22)` }}>
          {step > 1 && step < 5 && (
            <button onClick={goBack} aria-label="Back" style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 16, cursor: 'pointer', flexShrink: 0 }}>←</button>
          )}
          {step === 1 && <Logo url={salon?.branding?.logoUrl} scale={salon?.branding?.logoScale} size={38} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: isMobile ? 16 : 19, letterSpacing: -0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {step === 1 ? (salon?.name ?? barTitle) : barTitle}
            </div>
            {step === 1 && (
              <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--c4ade80)', boxShadow: '0 0 0 3px rgba(74,222,128,.25)' }} className="lumio-dot" />
                {bt('Book online · confirmed in seconds')}
              </div>
            )}
          </div>
          {step === 1 && salon?.rating && (
            <span title={`${salon.rating.value} out of 5 · ${salon.rating.count} reviews`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 999, background: 'rgba(255,255,255,0.16)', color: '#fff', fontSize: 13, fontWeight: 800, flexShrink: 0, whiteSpace: 'nowrap' }}>
              <span style={{ color: '#fde047' }}>★</span>{salon.rating.value}
              <span style={{ opacity: 0.75, fontWeight: 700 }}>· {salon.rating.count}</span>
            </span>
          )}
          {step === 3 && chooseStaff && (
            <button onClick={() => setStep(2)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px 6px 6px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
              <Avatar name={employee ? `${employee.firstName} ${employee.lastName ?? ''}` : 'Any'} url={employee?.avatarUrl ?? null} size={26} accent={accent} />
              {employee ? employee.firstName : bt('Any nail tech')} ▾
            </button>
          )}
          {step === 1 && !embedded && !isMobile && <InstallAppButton label={bt("Get the app")} />}
          {fullscreen && (
            <button onClick={closeFull} aria-label={bt("Close")} style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 17, cursor: 'pointer', flexShrink: 0 }}>✕</button>
          )}
        </div>

        {step === 5 ? (
          <div style={{ background: '#fff', borderRadius: embedded ? 12 : '0 0 14px 14px', padding: 32, marginTop: embedded ? 0 : 0 }}>
            <div style={{ textAlign: 'center', maxWidth: 380, margin: '0 auto' }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#dcfce7', color: '#16a34a', fontSize: 34, display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}>✓</div>
              <h2 style={{ color: '#16a34a', margin: '4px 0' }}>{bookedVisits.length > 1 ? btf('{n} bookings received', { n: bookedVisits.length }) : bt('Booking received')}</h2>
              {bookedVisits.length > 1 ? (
                <div style={{ textAlign: 'left', margin: '10px 0 6px', border: '1px solid #e9edf4', borderRadius: 12, overflow: 'hidden' }}>
                  {bookedVisits.map((label, i) => (
                    <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '10px 13px', borderTop: i ? '1px solid #eef1f6' : 'none', fontSize: 13.5, color: 'var(--c334155)' }}>
                      <span style={{ color: '#16a34a', fontWeight: 800 }}>✓</span>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: 'var(--c475569)', lineHeight: 1.6 }}>
                  Thanks {form.firstName}! Your booking for <strong>{service?.name}</strong>
                  {slot && <> on <strong>{slot.start.toLocaleDateString(bookLocale())} at {fmtTime(slot.start)}</strong></>} is received.
                </p>
              )}
              {bookedVisits.length > 1 && (
                <p style={{ color: 'var(--c64748b)', fontSize: 13, lineHeight: 1.6 }}>
                  {bt('Each visit has its own confirmation and its own cancel link, so you can change one without touching the others.')}
                </p>
              )}
              <p style={{ color: 'var(--c475569)' }}>{bt("Payment: ")}<strong>{result?.paymentStatus === 'PAID' ? bt('Paid online ✓') : bt('Pay at the salon')}</strong></p>
              <button onClick={reset} style={{ ...primaryBtn, marginTop: 8 }}>{bt("Book another")}</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 360px', gap: isMobile ? 0 : 18, alignItems: 'start' }}>
            {/* -------- left: the actual picking (this is the scroller in an embed) -------- */}
            <div ref={(node) => { cartPin.boxRef.current = node; }} style={{
              background: '#fff',
              borderRadius: '0 0 18px 18px',
              padding: isMobile ? '14px 14px 18px' : '18px 24px 24px',
              minWidth: 0, boxShadow: '0 24px 60px -40px rgba(15,42,82,.45)',
            }}>
              {visitCart.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  {visitCart.map((v, i) => (
                    <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: tint(accent, 0.07), border: `1.4px solid ${tint(accent, 0.5)}`, color: INK, borderRadius: 999, padding: '7px 13px', fontSize: 12.5, fontWeight: 700, maxWidth: '100%' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📅 {v.label}</span>
                      <span style={{ color: accent, fontWeight: 800, flexShrink: 0 }}>{fmt(v.totalCents)}</span>
                      <button type="button" onClick={() => removeCartVisit(i)} aria-label={bt("Remove visit")}
                        style={{ background: 'none', border: 'none', color: 'var(--c94a3b8)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>✕</button>
                    </span>
                  ))}
                  <span style={{ alignSelf: 'center', fontSize: 12, color: '#8fa0bb', fontWeight: 600 }}>+ this visit ↓</span>
                </div>
              )}
              <Progress step={step} accent={accent} allowStaff={chooseStaff} />
              <h1 key={step} className="lumio-step" style={{ fontSize: isMobile ? 22 : 27, fontWeight: 800, color: INK, margin: '10px 0 4px' }}>{stepTitle}</h1>
              {stepHint && <p style={{ margin: '0 0 14px', fontSize: 13.5, color: '#8fa0bb', lineHeight: 1.5 }}>{stepHint}</p>}

              {step === 1 && (
                <>
                  <DealsBanner wd={salon?.weekdayDiscounts} dd={salon?.dateDiscounts} categories={categories} />
                  {offerCode && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#ecfdf5', border: '1px solid var(--c6ee7b7)', borderRadius: 12, padding: '11px 14px', marginBottom: 12 }}>
                      <span style={{ fontSize: 18 }}>🎁</span>
                      <span style={{ fontSize: 13.5, color: '#065f46', lineHeight: 1.5 }}>
                        Your offer <b style={{ fontFamily: 'ui-monospace, Menlo, monospace', letterSpacing: 1 }}>{offerCode}</b> is attached to this booking — the salon applies it when you pay. Nothing to remember.
                      </span>
                    </div>
                  )}
                  <ProgramBanner fv={salon?.firstVisit} gr={salon?.groupDiscount} />
                  {/* A day picker used to sit here. It was removed on purpose: date and time
                      belong together (nobody thinks "the 15th" — they think "tomorrow at 2"),
                      and step 3 already asks for both. Two pickers for one answer made people
                      wonder what they had missed. What the visitor actually needs at this
                      point is a single fact — "is there room soon?" — so we state it. */}
                  <SoonestBar rules={rules} services={services} accent={accent} timezone={salon?.timezone} />

                  {/* Group tabs. They only exist once the booker adds a friend —
                      the solo flow never shows them. Every guest picks their own
                      services; the whole party shares one time slot. */}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '2px 0 12px' }}>
                    {isGroup && [{ name: 'You', serviceIds: pickedServiceIds }, ...extraGuests].map((g, i) => {
                      const on = activeGuest === i;
                      return (
                        <button key={i} type="button" onClick={() => setActiveGuest(i)}
                          style={{ borderRadius: 12, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 700,
                            border: `1.6px solid ${on ? accent : '#e9edf4'}`,
                            background: on ? tint(accent, 0.07) : '#fff', color: on ? accent : '#7d8ba4' }}>
                          {i === 0 ? '👤 You' : `👥 ${extraGuests[i - 1].name || `Guest ${i + 1}`}`}
                          <span style={{ marginLeft: 6, fontWeight: 500 }}>· {g.serviceIds.length || 0}</span>
                          {i > 0 && on && (
                            <span onClick={(e) => { e.stopPropagation(); setExtraGuests((gs) => gs.filter((_, k) => k !== i - 1)); setActiveGuest(0); setSlot(null); }}
                              style={{ marginLeft: 8, color: 'var(--c94a3b8)' }}>✕</span>
                          )}
                        </button>
                      );
                    })}
                    {/* Cart and group are mutually exclusive (a cart books several
                        times, a group shares ONE time) — so once the cart holds a
                        visit this entry point disappears, same as "Add another
                        visit" disappears for groups. */}
                    {visitCart.length === 0 && extraGuests.length < MAX_GUESTS - 1 && (
                      <button type="button"
                        onClick={() => { setExtraGuests((gs) => [...gs, { name: '', serviceIds: [] }]); setActiveGuest(extraGuests.length + 1); setStaffId(''); setSlot(null); }}
                        style={{ borderRadius: 12, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 700,
                          border: `1.6px dashed ${tint(accent, 0.6)}`, background: tint(accent, 0.03), color: accent }}>
                        ＋ {isGroup ? bt("Add guest") : bt("Bringing friends?")}
                      </button>
                    )}
                  </div>
                  {isGroup && activeGuest > 0 && (
                    <input
                      value={extraGuests[activeGuest - 1]?.name ?? ''}
                      onChange={(e) => setExtraGuests((gs) => gs.map((g, k) => k === activeGuest - 1 ? { ...g, name: e.target.value } : g))}
                      placeholder={`Guest ${activeGuest + 1} name (optional)`}
                      style={{ ...inputStyle, marginBottom: 12, maxWidth: 320 }}
                    />
                  )}

                  <ServicePicker
                    services={services} categories={categories}
                    selectedIds={activeGuest === 0 ? pickedServiceIds : (extraGuests[activeGuest - 1]?.serviceIds ?? [])}
                    onToggle={activeGuest === 0 ? toggleService : (id) => {
                      setExtraGuests((gs) => gs.map((g, k) => k === activeGuest - 1
                        ? { ...g, serviceIds: g.serviceIds.includes(id) ? g.serviceIds.filter((x) => x !== id) : [...g.serviceIds, id] }
                        : g));
                      setSlot(null);
                    }}
                    fmt={fmt} accent={accent} cardFee={salon?.cardFee}
                    subscribe={subscribe} pinning={pinning} stickyTop={fullscreen ? 58 : 64}
                  />
                  {activeGuest === 0 && serviceAddons.length > 0 && (
                    <div style={{ marginTop: 22 }}>
                      <SectionLabel accent={accent}>Add-ons for {service?.name}</SectionLabel>
                      <div style={{ display: 'grid', gap: 10, alignContent: 'start', alignItems: 'start', gridAutoRows: 'min-content' }}>
                        {serviceAddons.map((a) => {
                          const on = addonIds.includes(a.id);
                          return (
                            <button key={a.id} type="button" className="lumio-row"
                              onClick={() => { setAddonIds((p) => p.includes(a.id) ? p.filter((x) => x !== a.id) : [...p, a.id]); setSlot(null); }}
                              style={{ ...rowCard, borderColor: on ? accent : '#e6eaf2', background: on ? '#fffaf0' : '#fff' }}>
                              <span style={{ flex: 1, textAlign: 'left' }}>
                                <span style={rowTitle}>{a.name}</span>
                                <span style={rowMeta}>{a.durationMinutes > 0 && <>⏳ {a.durationMinutes} min <span style={{ color: 'var(--ccbd5e1)' }}>|</span> </>}<b style={{ color: accent }}>+{salon?.cardFee?.enabled && salon.cardFee.percent > 0 ? <>💵 </> : null}{fmt(a.priceCents)}</b>{salon?.cardFee?.enabled && salon.cardFee.percent > 0 && <span style={{ color: '#8fa0bb', fontWeight: 700 }}> · 💳 +{fmt(Math.round(a.priceCents * (1 + salon.cardFee.percent / 100)))}</span>}</span>
                              </span>
                              <PlusCheck on={on} accent={accent} />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              {step === 2 && (
                <TechPicker
                  staff={staff} staffId={staffId} accent={accent}
                  serviceIds={pickedServiceIds} services={services}
                  onPick={(id) => { setStaffId(id); setSlot(null); setStep(3); }}
                />
              )}

              {step === 3 && (
                <TimePicker
                  rules={rules} salon={salon} selectedDate={selectedDate} slot={slot} avail={avail}
                  staffId={staffId} durationMinutes={totalDuration} accent={accent}
                  cartBusy={visitCart
                    .filter((v) => staffId && v.staffId === staffId)
                    .map((v) => ({ start: v.slot.start.toISOString(), end: v.slot.end.toISOString() }))}
                  groupNeeds={isGroup ? [
                    { serviceIds: pickedServiceIds, extraMin: addonLines.reduce((sum, l) => sum + 0, 0) },
                    ...extraGuests.map((g) => ({ serviceIds: g.serviceIds, extraMin: 0 })),
                  ].map((gg) => {
                    const svcOf = (sid: string) => services.find((sv) => sv.id === sid);
                    const durationMin = gg.serviceIds.reduce((sum, sid) => sum + (svcOf(sid)?.durationMinutes ?? 0), 0) || 30;
                    // Intersect the pools of every service this person picked;
                    // services nobody lists don't constrain (desk assigns them).
                    let elig: 'ANY' | string[] = 'ANY';
                    for (const sid of gg.serviceIds) {
                      const ps = avail?.perServiceById?.[sid];
                      if (!ps || ps.noStaff || ps.unstaffed) continue;
                      elig = elig === 'ANY' ? [...ps.eligibleStaffIds] : elig.filter((id) => ps.eligibleStaffIds.includes(id));
                    }
                    return { elig, durationMin };
                  }) : []}
                  onPickDate={(d) => { setSelectedDate(d); setSlot(null); }}
                  onPickSlot={setSlot}
                  waitlist={<WaitlistCta base={base} preferredDate={selectedDate} serviceId={serviceId || undefined} fmtAccent={accent} />}
                />
              )}

              {step === 4 && slot && (
                <>
                <ConfirmStep
                  salon={salon} slot={slot} employee={employee} lines={allLines} fmt={fmt} totalCents={totalCents}
                  depositCents={depositCents} cardFee={salon?.cardFee} rules={rules} paymentType={paymentType} setPaymentType={setPaymentType}
                  form={form} setForm={setForm} smsConsent={smsConsent} setSmsConsent={setSmsConsent}
                  accent={accent} error={error} infoOk={infoOk} isMobile={isMobile}
                />
                {/* The escape hatch for "I also want another day/time" — offered
                    AFTER a visit is fully specified, never asked up front. Groups
                    book one shared time, so the two modes don't combine. */}
                {!isGroup && <button type="button" onClick={addAnotherVisit}
                  style={{ width: '100%', marginTop: 10, padding: '13px 16px', borderRadius: 999, cursor: 'pointer',
                    border: `1.6px dashed ${tint(accent, 0.65)}`, background: tint(accent, 0.04),
                    color: accent, fontWeight: 700, fontSize: 13.5 }}>
                  {bt('＋ Add another visit (different day or time)')}
                </button>}
                {visitCart.length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 12.5, color: '#8fa0bb', textAlign: 'center' }}>
                    {btf('Booking {n} visits · total', { n: visitCart.length + 1 })} <b style={{ color: INK }}>{fmt(cartCents + totalCents)}</b> · {bt('paid at the salon')}
                  </div>
                )}
                </>
              )}
            </div>

            {/* -------- right: the cart, always in view -------- */}
            {!isMobile && (
              embedded ? (
                <div ref={cartPin.elRef} style={{ marginTop: 14, display: 'flex' }}>
                  {summary}
                </div>
              ) : (
                <div style={{ position: 'sticky', top: 92, height: 'calc(100vh - 124px)', minHeight: 420, marginTop: 16 }}>
                  {summary}
                </div>
              )
            )}
          </div>
        )}

        {/* Mobile — and any embed — get the action bar so the Continue button is never
            hidden below a tall cart / the fold. Hosted desktop keeps its sticky cart. */}
        {(isMobile || embedded) && step < 5 && (
          <MobileBar
            embedded={!asPage} count={cartLines.length} totalCents={grand ? grand.cents : totalCents} fmt={fmt}
            grandLabel={grand ? (grand.kind === 'visits' ? `${grand.count} visits` : `group of ${grand.count}`) : undefined}
            durationMinutes={totalDuration} canContinue={canContinue} label={ctaLabel} onContinue={goNext} accent={accent}
          />
        )}

        {asPage && (
          <a href="https://lumioagency.com/" target="_blank" rel="noopener noreferrer"
            style={{ display: 'block', textAlign: 'center', padding: isMobile ? '14px 0 calc(104px + env(safe-area-inset-bottom, 0px))' : '16px 0 8px', fontSize: 11.5, color: 'var(--c94a3b8)', textDecoration: 'none' }}>
            {bt('Powered by')} <span style={{ color: accent, fontWeight: 700 }}>Lumio Booking</span>
          </a>
        )}
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Right column: the cart. Shop card on top, one row per pick, total, CTA.
// ---------------------------------------------------------------------------
type Line = { id: string; name: string; durationMinutes: number; priceCents: number; fullCents: number; addon?: boolean; imageUrl?: string | null };

/**
 * A money figure that rolls from its old value to the new one over ~380ms. It keeps
 * its own state so only this tiny span re-renders per frame — the cart list beside it
 * does not. Respects prefers-reduced-motion by snapping instantly.
 */
function AnimatedMoney({ cents, fmt, style }: { cents: number; fmt: (c: number) => string; style?: React.CSSProperties }) {
  const [disp, setDisp] = useState(cents);
  const ref = useRef(cents);
  useEffect(() => {
    const from = ref.current, to = cents;
    if (from === to) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { ref.current = to; setDisp(to); return; }
    const t0 = performance.now(); let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 380);
      const v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      setDisp(v);
      if (k < 1) raf = requestAnimationFrame(step); else ref.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [cents]);
  return <span style={style}>{fmt(disp)}</span>;
}

function CartPanel({ salon, lines, fmt, totalCents, fullCents, anyDiscount, totalDuration, employee, slot, selectedDate, onRemove, canContinue, ctaLabel, onContinue, step, accent, fill, grand }: {
  salon: Salon | null; lines: Line[]; fmt: (c: number) => string; totalCents: number; fullCents: number; anyDiscount: boolean;
  totalDuration: number; employee: Staff | null; slot: Slot | null; selectedDate: Date | null;
  onRemove: (id: string) => void; canContinue: boolean; ctaLabel: string; onContinue: () => void; step: Step; accent: string; fill?: boolean;
  /** Multi-visit cart or group booking: the number the customer pays in total. */
  grand?: { count: number; cents: number; kind: 'visits' | 'guests' } | null;
}) {
  // On a desktop screen we show a small QR of this very page, so a visitor who found
  // the salon on their laptop can scan and finish on their phone (where they'll get the
  // SMS). Same QR service the tip/review screens already use.
  const [pageUrl, setPageUrl] = useState('');
  const [wide, setWide] = useState(false);
  useEffect(() => {
    try { setPageUrl(window.location.href); } catch { /* ignore */ }
    const mq = window.matchMedia('(min-width: 821px)');
    const on = () => setWide(mq.matches); on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  const qrSrc = pageUrl ? `https://api.qrserver.com/v1/create-qr-code/?size=120x120&margin=0&data=${encodeURIComponent(pageUrl)}` : '';
  return (
    <aside style={{ background: '#fff', borderRadius: 18, overflow: 'hidden',
      boxShadow: `0 30px 60px -34px rgba(15,42,82,.45), 0 0 0 1px ${tint(accent, 0.10)}`,
      height: fill ? '100%' : 'auto', maxHeight: fill ? '100%' : '88vh', width: '100%',
      display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: `linear-gradient(120deg, ${accent} 0%, ${shade(accent, 0.18)} 55%, ${shade(accent, 0.42)} 100%)`, color: '#fff', padding: '16px 18px', display: 'flex', gap: 13, alignItems: 'center', flexShrink: 0, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22)' }}>
        <Logo url={salon?.branding?.logoUrl} scale={salon?.branding?.logoScale} size={46} />
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: -0.2, lineHeight: 1.2 }}>{salon?.name}</div>
          {salon?.address && <div style={{ fontSize: 11.5, opacity: 0.78, lineHeight: 1.45 }}>{salon.address}</div>}
          {salon?.contactPhone && <div style={{ fontSize: 11.5, opacity: 0.78, letterSpacing: 0.2 }}>{salon.contactPhone}</div>}
        </div>
      </div>
      {/* boarding-pass tear line: this is the "ticket stub" cue that sets the cart apart */}
      <div className="lumio-perf" style={{ flexShrink: 0 }}><span className="lumio-tear" /></div>

      {/* The list takes whatever room is left, so the panel fills the page instead of
          ending in a big white void — and the total + button stay pinned at the bottom. */}
      <div className="lumio-scroll" style={{ padding: '6px 16px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {lines.length === 0 ? (
          <EmptyCart accent={accent} salon={salon} />
        ) : lines.map((l) => (
          <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', borderBottom: '1px solid #eef1f6' }}>
            <CartThumb url={l.imageUrl} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, lineHeight: 1.35 }}>{l.name}</div>
              <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 3 }}>
                {l.durationMinutes > 0 ? btf('{n} min', { n: l.durationMinutes }) : ''}{employee && step >= 3 ? <>{l.durationMinutes > 0 ? ' · ' : ''}<b style={{ color: accent }}>{employee.firstName}</b></> : null}
              </div>
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: accent, whiteSpace: 'nowrap' }}>{fmt(l.priceCents)}</div>
            <button onClick={() => onRemove(l.id)} aria-label={bt("Remove")} style={{ width: 22, height: 22, borderRadius: '50%', border: 'none', background: '#e8edf6', color: INK, fontSize: 12, cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}>✕</button>
          </div>
        ))}
      </div>

      <div style={{ padding: '12px 16px 16px', borderTop: '1px solid #eef1f6', flexShrink: 0, background: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontWeight: 800, color: INK, fontSize: 15 }}>{grand ? bt(grand.kind === 'visits' ? 'This visit' : 'Your services') : bt("Total")}</span>
          <span>
            {anyDiscount && <span style={{ textDecoration: 'line-through', color: '#b6bfcd', fontSize: 13, marginRight: 8 }}>{fmt(fullCents)}</span>}
            <AnimatedMoney cents={totalCents} fmt={fmt} style={{ fontWeight: 800, color: INK, fontSize: 17 }} />
          </span>
        </div>
        {grand && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8, padding: '9px 12px', borderRadius: 10, background: tint(accent, 0.08), border: `1.4px solid ${tint(accent, 0.4)}` }}>
            <span style={{ fontWeight: 800, color: INK, fontSize: 13.5 }}>
              {grand.kind === 'visits' ? `🧾 Total · ${grand.count} visits` : `👥 Total · group of ${grand.count}`}
            </span>
            <AnimatedMoney cents={grand.cents} fmt={fmt} style={{ fontWeight: 800, color: accent, fontSize: 18 }} />
          </div>
        )}
        {totalDuration > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12.5, color: 'var(--c94a3b8)' }}>
            <span>🕐 Duration</span><span>{fmtDur(totalDuration)}</span>
          </div>
        )}
        {anyDiscount && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, padding: '7px 10px', borderRadius: 10, background: '#ecfdf5', color: '#065f46', fontSize: 12.5, fontWeight: 800 }}>
            <span>🎉 You save</span><span>{fmt(fullCents - totalCents)}</span>
          </div>
        )}
        {slot && selectedDate && (
          <div style={{ marginTop: 12, background: tint(accent, 0.08), borderRadius: 10, padding: '10px 12px', fontSize: 13, color: INK, lineHeight: 1.6 }}>
            <div>📅 <b>{selectedDate.toLocaleDateString(bookLocale(), { weekday: 'long', month: 'long', day: 'numeric' })}</b></div>
            <div>🕐 {fmtTime(slot.start)}{totalDuration > 0 ? ` – ${fmtTime(slot.end)} (${fmtDur(totalDuration)})` : ''}</div>
          </div>
        )}
        {wide && qrSrc && lines.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, background: SOFT, borderRadius: 12, padding: '8px 10px' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc} width={44} height={44} alt="" style={{ borderRadius: 6, flexShrink: 0, background: '#fff' }} />
            <div style={{ fontSize: 11.5, color: '#8a97b4', lineHeight: 1.4 }}>{bt('Scan to keep booking')}<br />{bt('on your phone')}</div>
          </div>
        )}
        <button onClick={onContinue} disabled={!canContinue} className="lumio-cta"
          style={{ ...ctaBtn, marginTop: 14, opacity: canContinue ? 1 : 0.45, cursor: canContinue ? 'pointer' : 'not-allowed' }}>
          {step === 1 && canContinue ? '👤 ' : ''}{ctaLabel}
        </button>
      </div>
    </aside>
  );
}

/**
 * The phone embed, closed. A card the visitor actually wants to tap: shop name,
 * the next free slot, what they get — and one big button that opens the real form
 * over the whole screen, still on the salon's own website.
 */
function Launcher({ salon, accent, onOpen, rules, services }: {
  salon: Salon | null; accent: string; onOpen: () => void; rules: BookingRules; services: Service[];
}) {
  const soon = useMemo(() => {
    const shortest = Math.max(15, Math.min(...(services.length ? services.map((s) => s.durationMinutes) : [30])));
    // The salon's date, not the reader's — see lib/salon-clock.ts.
    const today = todayInZone(salon?.timezone);
    for (let i = 0; i <= Math.min(rules.maxAdvanceDays, 21); i++) {
      const d = new Date(today.getTime() + i * 86400000);
      const first = generateSlots(d, shortest, rules, salon?.timezone)[0];
      if (first) return btf('{when} at {time}', { when: i === 0 ? bt('today') : i === 1 ? bt('tomorrow') : bt(WEEKDAY_NAMES[d.getDay()]), time: fmtTime(first.start) });
    }
    return null;
  }, [rules, services, salon?.timezone]);

  const from = services.length ? Math.min(...services.map((s) => svcNetCents(s))) : 0;

  return (
    <div className="lumio-book" style={{ ['--accent' as string]: accent } as React.CSSProperties}>
      <div style={{ background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: `0 26px 60px -34px rgba(15,42,82,.5), 0 0 0 1px ${tint(accent, 0.10)}` }}>
        <div style={{ background: `linear-gradient(120deg, ${accent} 0%, ${shade(accent, 0.18)} 55%, ${shade(accent, 0.42)} 100%)`, color: '#fff', padding: '16px 16px 18px', display: 'flex', gap: 12, alignItems: 'center' }}>
          <Logo url={salon?.branding?.logoUrl} scale={salon?.branding?.logoScale} size={44} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: -0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{salon?.name}</div>
            <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--c4ade80)' }} className="lumio-dot" />
              {bt('Book online · confirmed in seconds')}
            </div>
          </div>
        </div>

        <div style={{ padding: '16px 16px 18px' }}>
          {soon && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, background: '#ecfdf5', border: '1px solid var(--cbbf7d0)', color: 'var(--c166534)', fontSize: 12.5, fontWeight: 800, marginBottom: 12 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e' }} className="lumio-dot" />
              {btf('Next opening {when}', { when: soon })}
            </div>
          )}
          <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
            {[['🗓️', bt('Pick your service, tech and time')], ['⚡', bt('Instant confirmation by text')], ['💳', bt('Pay online or at the shop')]].map(([i, t]) => (
              <div key={t} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13.5, color: INK, fontWeight: 600 }}>
                <span style={{ width: 30, height: 30, borderRadius: 9, background: tint(accent, 0.10), display: 'grid', placeItems: 'center', fontSize: 14, flexShrink: 0 }}>{i}</span>
                {t}
              </div>
            ))}
          </div>
          <button onClick={onOpen} className="lumio-cta" style={{ ...ctaBtn, fontSize: 16, padding: '16px 18px' }}>
            Book now{from > 0 ? '' : ''} →
          </button>
          {salon?.contactPhone && (
            <a href={`tel:${salon.contactPhone.replace(/[^0-9+]/g, '')}`}
              style={{ display: 'block', textAlign: 'center', marginTop: 10, padding: '11px', borderRadius: 999, border: `1px solid ${tint(accent, 0.30)}`, color: accent, fontWeight: 700, fontSize: 13.5, textDecoration: 'none' }}>
              📞 Call {salon.contactPhone}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/** An empty cart used to be a tall white nothing. Now it explains what happens
 *  next and why booking here is safe — the space works for the salon. */
function EmptyCart({ accent, salon }: { accent: string; salon: Salon | null }) {
  const perks: [string, string, string][] = [
    ['🕐', bt("Book any time"), bt("Open 24/7 online \u2014 even when the shop is closed.")],
    ['✅', bt("Instant confirmation"), bt("You get a text the moment your spot is held.")],
    ['💇', bt("Pick your tech"), bt("Choose the person you always go to, or let us match you.")],
    ['💳', bt("Pay how you like"), bt("Online now, or at the shop when you arrive.")],
  ];
  return (
    <div style={{ padding: '16px 2px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ textAlign: 'center', padding: '10px 0 16px' }}>
        <div style={{ width: 54, height: 54, borderRadius: '50%', background: tint(accent, 0.10), color: accent, display: 'grid', placeItems: 'center', fontSize: 24, margin: '0 auto 10px' }}>🛍️</div>
        <div style={{ fontSize: 14.5, fontWeight: 800, color: INK }}>{bt("Pick a service to start")}</div>
        <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 4, lineHeight: 1.5 }}>
          Tap <b style={{ color: accent }}>＋</b> on any service. You can add more than one.
        </div>
      </div>
      <div style={{ display: 'grid', gap: 10, marginTop: 4 }}>
        {perks.map(([icon, title, sub]) => (
          <div key={title} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 12, background: SOFT }}>
            <span style={{ fontSize: 16, lineHeight: 1.2 }}>{icon}</span>
            <span>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: INK }}>{title}</span>
              <span style={{ display: 'block', fontSize: 12, color: '#8fa0bb', marginTop: 2, lineHeight: 1.45 }}>{sub}</span>
            </span>
          </div>
        ))}
      </div>
      {salon?.contactPhone && (
        <a href={`tel:${salon.contactPhone.replace(/[^0-9+]/g, '')}`}
          style={{ marginTop: 12, display: 'block', textAlign: 'center', padding: '11px 12px', borderRadius: 12, border: `1px solid ${tint(accent, 0.35)}`, color: accent, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
          📞 Rather talk to us? {salon.contactPhone}
        </a>
      )}
    </div>
  );
}

/** Mobile: floating action bar. Always on screen, never behind the content. */
function MobileBar({ embedded, count, totalCents, fmt, durationMinutes, canContinue, label, onContinue, accent, pinRef, grandLabel }: {
  embedded: boolean; count: number; totalCents: number; fmt: (c: number) => string; durationMinutes: number;
  canContinue: boolean; label: string; onContinue: () => void; accent: string;
  /** When set, totalCents is the ALL-visits/group figure and this names it ("3 visits"). */
  grandLabel?: string;
  /** Embed only: keeps the bar floating above the fold while the form is on screen. */
  pinRef?: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // In an iframe a fixed bar would pin itself to the bottom of the iframe box, so
  // inside an embed we let it flow right after the content and ask the host page to
  // scroll it into view instead (the WordPress embed listens for this).
  const ref = useRef<HTMLDivElement | null>(null);
  const wasOn = useRef(canContinue);
  useEffect(() => {
    const on = canContinue; const was = wasOn.current; wasOn.current = on;
    if (!embedded || !on || was || !ref.current) return;
    const y = Math.round(ref.current.getBoundingClientRect().top + (window.scrollY || 0));
    try { window.parent.postMessage({ type: 'lumio-embed-reveal', y, h: ref.current.offsetHeight }, '*'); } catch { /* ignore */ }
  }, [canContinue, embedded]);

  const bar = (
    <div ref={(node) => { ref.current = node; if (pinRef) pinRef.current = node; }} className="lumio-bar" style={{
      padding: '11px 12px', display: 'flex', alignItems: 'center', gap: 12,
      ...(embedded
        ? {
            // No `position: fixed` here — inside an iframe that would pin the bar to the
            // bottom of the FRAME (which is taller than the screen), i.e. the end of the
            // form. We translate it instead, using the host's viewport position, so it
            // floats above the fold exactly like the fixed bar on the hosted page.
            position: 'relative', zIndex: 40, marginTop: 12, borderRadius: 18,
            background: '#fff',
            boxShadow: `0 20px 44px -14px rgba(15,42,82,0.38), 0 0 0 1px ${tint(accent, 0.10)}`,
            ['--accent' as string]: accent,
            ['--accent-dark' as string]: shade(accent, 0.28),
            ['--accent-glow' as string]: tint(accent, 0.55),
          }
        : {
            background: 'rgba(255,255,255,.94)',
            position: 'fixed', left: 10, right: 10, bottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
            zIndex: 2147483000, borderRadius: 20,
            boxShadow: `0 20px 44px -14px rgba(15,42,82,0.38), 0 0 0 1px ${tint(accent, 0.10)}`,
            backdropFilter: 'saturate(1.5) blur(10px)', WebkitBackdropFilter: 'saturate(1.5) blur(10px)',
            ['--accent' as string]: accent,
            ['--accent-dark' as string]: shade(accent, 0.28),
            ['--accent-glow' as string]: tint(accent, 0.55),
          }),
    } as React.CSSProperties}>
      <span style={{ position: 'relative', width: 42, height: 42, borderRadius: 13, background: tint(accent, 0.10), display: 'grid', placeItems: 'center', fontSize: 18, flexShrink: 0 }}>
        🛍️
        {count > 0 && (
          <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 19, height: 19, padding: '0 5px', borderRadius: 999,
            background: accent, color: '#fff', fontSize: 11, fontWeight: 800, display: 'grid', placeItems: 'center',
            boxShadow: `0 4px 10px -4px ${tint(accent, 0.95)}` }}>{count}</span>
        )}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: '#8fa0bb', fontWeight: 600 }}>
          {count === 0 ? bt('No service yet') : btf(count === 1 ? '{n} service' : '{n} services', { n: count })}{durationMinutes > 0 && <> · 🕐 {fmtDur(durationMinutes)}</>}{grandLabel && <> · <b style={{ color: INK }}>{btf('total for {label}', { label: grandLabel })}</b></>}
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: INK, letterSpacing: -0.3 }}>{fmt(totalCents)}</div>
      </div>
      <button onClick={onContinue} disabled={!canContinue} className="lumio-cta"
        style={{ ...ctaBtn, width: 'auto', padding: '13px 20px', fontSize: 14.5, whiteSpace: 'nowrap',
          opacity: canContinue ? 1 : 0.42, cursor: canContinue ? 'pointer' : 'not-allowed' }}>
        {label} →
      </button>
    </div>
  );

  // Fixed bars must live on <body>: any ancestor with a transform/filter/animation
  // (a card fading in, a sticky header) turns itself into the containing block and
  // the bar silently drops to the bottom of the CARD instead of the screen.
  if (embedded || !mounted) return bar;
  return createPortal(bar, document.body);
}

/**
 * One line, no interaction: the soonest free time and today's hours. It answers
 * the only scheduling question a visitor has while reading a menu ("can I even
 * get in?") without asking them to pick anything twice.
 */
function SoonestBar({ rules, services, accent, timezone }: { rules: BookingRules; services: Service[]; accent: string; timezone?: string | null }) {
  // What this badge is allowed to claim — see lib/opening-bar.ts. Default is
  // 'hours', which states the times the owner typed in rather than promising a
  // free slot the page has no appointments to verify.
  const plan = useMemo(() => {
    const today = todayInZone(timezone);
    return planOpeningBar({
      mode: (rules as unknown as { soonestBar?: string }).soonestBar,
      day: rules.businessHours[today.getDay()],
      isDayOff: rules.daysOff.includes(ymd(today)),
    });
  }, [rules, timezone]);

  const info = useMemo(() => {
    const shortest = Math.max(15, Math.min(...(services.length ? services.map((s) => s.durationMinutes) : [30])));
    // Both halves of this line were reading the VISITOR's clock, and each one
    // was wrong on its own. `new Date()` picked the reader's calendar date, so
    // someone a day ahead of the salon was shown the wrong row of business
    // hours entirely. And generateSlots was called without the salon timezone —
    // the date picker below passes it, this bar did not — so the salon's
    // morning was filtered against the reader's "now" and the first surviving
    // slot slid by however many hours apart the two of them were. That is why
    // the same salon advertised 11:00 AM in one region and 2:00 PM in another,
    // and neither matched what the owner had typed in.
    const today = todayInZone(timezone);
    for (let i = 0; i <= Math.min(rules.maxAdvanceDays, 21); i++) {
      const d = new Date(today.getTime() + i * 86400000);
      const first = generateSlots(d, shortest, rules, timezone)[0];
      if (first) {
        const when = i === 0 ? bt('today') : i === 1 ? bt('tomorrow') : bt(WEEKDAY_NAMES[d.getDay()]);
        const h = rules.businessHours[d.getDay()];
        const close = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(h.closeMinutes / 60), h.closeMinutes % 60);
        return { when, time: fmtTime(first.start), close: fmtTime(close), sameDay: i === 0 };
      }
    }
    return null;
  }, [rules, services, timezone]);

  if (plan.kind === 'off') return null;

  const pill = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999, background: '#fff', fontSize: 12.5, fontWeight: 700 } as React.CSSProperties;
  const minsToClock = (m: number) => fmtTime(new Date(2000, 0, 1, Math.floor(m / 60), m % 60));

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 16,
      padding: '10px 12px', borderRadius: 14,
      background: `linear-gradient(120deg, ${tint(accent, 0.10)}, rgba(255,255,255,0))`,
      border: `1px solid ${tint(accent, 0.18)}`,
    }}>
      {plan.kind === 'hours' ? (
        // Times the owner typed in. Nothing here can be contradicted by the
        // booking screen, and it says nothing about how busy the shop is.
        plan.windows.map((w, i) => (
          <span key={i} style={{ ...pill, border: '1px solid #e9edf4', color: 'var(--c166534)', fontWeight: 800 }}>
            🕐 {btf('Open today {from} – {to}', { from: minsToClock(w.open), to: minsToClock(w.close) })}
          </span>
        ))
      ) : plan.kind === 'closed' ? (
        <span style={{ ...pill, border: '1px solid #e9edf4', color: '#5b6b85' }}>
          {bt('Closed today — pick another date below')}
        </span>
      ) : info ? (
        <>
          <span style={{ ...pill, border: '1px solid #dcfce7', color: 'var(--c166534)', fontWeight: 800, boxShadow: '0 2px 8px -5px rgba(15,42,82,.4)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e' }} className="lumio-dot" />
            {btf('Next opening {when} at {time}', { when: info.when, time: info.time })}
          </span>
          {info.sameDay && (
            <span style={{ ...pill, border: '1px solid #e9edf4', color: '#5b6b85' }}>
              🕐 {btf('Open until {time}', { time: info.close })}
            </span>
          )}
        </>
      ) : (
        <span style={{ fontSize: 12.5, color: '#5b6b85', fontWeight: 700 }}>{bt('Pick a service — we’ll show you every free time.')}</span>
      )}
      <span style={{ marginLeft: 'auto', fontSize: 12, color: '#8fa0bb' }}>{bt("Choose the time after your service \u2728")}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 · Services: sticky category tabs + one section per category.
// Scrolling moves the tabs (scroll-spy); tapping a tab scrolls to the section.
// ---------------------------------------------------------------------------
function ServicePicker({ services, categories, selectedIds, onToggle, fmt, accent, cardFee, subscribe, pinning, stickyTop }: {
  services: Service[]; categories: Category[]; selectedIds: string[];
  onToggle: (id: string) => void; fmt: (c: number) => string; accent: string;
  /** Dual pricing (US nail-salon "cash discount" model): when the salon passes
   *  card fees on, the menu shows BOTH prices up-front so customers can choose. */
  cardFee?: { enabled: boolean; percent: number };
  /** Embed only: the host page's viewport feed. The tabs follow the scroll and stay
   *  pinned with it, even though the iframe itself never scrolls. */
  subscribe: (fn: HostSub) => () => void;
  pinning: boolean;
  stickyTop: number;
}) {
  const groups = useMemo(() => {
    // Featured services still sort to the top of their own category…
    const feat = (arr: Service[]) => [...arr].sort((a, b) => (b.isFeatured ? 1 : 0) - (a.isFeatured ? 1 : 0));
    const named = categories
      .map((c) => ({ id: c.id, name: c.name, items: feat(services.filter((s) => s.categoryId === c.id)) }))
      .filter((g) => g.items.length > 0);
    const loose = feat(services.filter((s) => !s.categoryId || !categories.some((c) => c.id === s.categoryId)));
    const base = loose.length ? [...named, { id: 'other', name: bt('Other services'), items: loose }] : named;
    // …and a "Popular" group is pinned at the very top of the whole list, gathering
    // every featured service (they also remain under their own category below — the
    // way food-ordering apps surface popular items).
    const popular = services.filter((s) => s.isFeatured);
    return popular.length ? [{ id: '__popular', name: '⭐ Popular', items: popular }, ...base] : base;
  }, [services, categories]);

  const [active, setActive] = useState<string>(groups[0]?.id ?? '');
  const [q, setQ] = useState('');
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const tabsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { if (groups.length && !groups.some((g) => g.id === active)) setActive(groups[0].id); }, [groups, active]);

  // Scroll-spy — hosted page: read the window scroll.
  useEffect(() => {
    if (q.trim() || pinning) return;
    const onScroll = () => {
      let current = groups[0]?.id ?? '';
      for (const g of groups) {
        const el = sectionRefs.current[g.id];
        if (el && el.getBoundingClientRect().top - 170 <= 0) current = g.id;
      }
      setActive((prev) => (prev === current ? prev : current));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [groups, q, pinning]);

  // Scroll-spy — embed: the iframe never scrolls, so read the host's viewport feed.
  // setActive only fires when the category actually changes, so this costs nothing.
  useEffect(() => {
    if (q.trim() || !pinning) return;
    return subscribe((v) => {
      let current = groups[0]?.id ?? '';
      for (const g of groups) {
        const el = sectionRefs.current[g.id];
        if (el && v.top + el.offsetTop - 150 <= 0) current = g.id;
      }
      setActive((prev) => (prev === current ? prev : current));
    });
  }, [groups, q, pinning, subscribe]);

  // Pin the tab strip: sticky on the hosted page, transform inside an embed.
  const pin = usePin(subscribe, pinning, 'top', 8);

  // Keep the active tab visible in the horizontal strip.
  useEffect(() => {
    const strip = tabsRef.current;
    const btn = strip?.querySelector<HTMLElement>(`[data-tab="${active}"]`);
    if (!strip || !btn) return;
    strip.scrollTo({ left: Math.max(0, btn.offsetLeft - strip.offsetLeft - 12), behavior: 'smooth' });
  }, [active]);

  const goTo = (id: string) => {
    setActive(id);
    const el = sectionRefs.current[id];
    if (!el) return;
    if (pinning) {
      // The host page owns the scroll — ask it to come to this section.
      try { window.parent.postMessage({ type: 'lumio-embed-scroll-to', y: Math.max(0, el.offsetTop - 70) }, '*'); } catch { /* ignore */ }
      return;
    }
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 128, behavior: 'smooth' });
  };

  const search = q.trim().toLowerCase();
  const shown = search
    ? [{ id: 'search', name: `Results for “${q.trim()}”`, items: services.filter((s) => s.name.toLowerCase().includes(search)) }]
    : groups;

  // Dual pricing: card price = cash price + surcharge % (rounded to the cent),
  // exactly how the salon's printed menu is built ($55 -> $56.65 at 3%).
  const dualPct = cardFee?.enabled && cardFee.percent > 0 ? cardFee.percent : 0;
  const toCard = (cents: number) => Math.round(cents * (1 + dualPct / 100));

  return (
    <div ref={pin.boxRef}>
      <div ref={(node) => { tabsRef.current = node; pin.elRef.current = node; }} className="lumio-tabs" style={{
        position: pinning ? 'relative' : 'sticky', top: pinning ? undefined : stickyTop, zIndex: 6, background: '#fff',
        display: 'flex', gap: 8, overflowX: 'auto', padding: '10px 0 12px',
        boxShadow: '0 10px 10px -10px rgba(15,42,82,0.08)',
        willChange: pinning ? 'transform' : undefined,
      }}>
        {groups.map((g) => {
          const on = active === g.id && !search;
          return (
            <button key={g.id} data-tab={g.id} type="button" onClick={() => goTo(g.id)}
              style={{ padding: '10px 17px', borderRadius: 999, whiteSpace: 'nowrap', cursor: 'pointer', fontSize: 13.5, fontWeight: 700,
                border: `1px solid ${on ? 'transparent' : '#e9edf4'}`,
                background: on ? `linear-gradient(120deg, ${accent}, ${shade(accent, 0.25)})` : '#fff',
                color: on ? '#fff' : '#5b6b85',
                boxShadow: on ? `0 10px 22px -12px ${tint(accent, 0.95)}` : '0 2px 6px -4px rgba(15,42,82,.16)' }}>
              {g.name}
            </button>
          );
        })}
      </div>

      {services.length > 8 && (
        <div style={{ position: 'relative', marginBottom: 16 }}>
          <span style={{ position: 'absolute', left: 15, top: '50%', transform: 'translateY(-50%)', fontSize: 17, opacity: 0.75, pointerEvents: 'none' }}>🔍</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={bt("Search a service…")}
            style={{ ...inputStyle, padding: '14px 14px 14px 44px', fontSize: 15, borderRadius: 12,
              border: `1.6px solid ${tint(accent, 0.55)}`, background: tint(accent, 0.05),
              boxShadow: `0 6px 18px -10px ${tint(accent, 0.7)}` }} />
        </div>
      )}

      {dualPct > 0 && (
        <div style={{ margin: '2px 0 14px', fontSize: 12.5, color: '#5b6b85', fontWeight: 700, background: '#f7f9fc', border: '1px solid #e9edf4', borderRadius: 10, padding: '8px 13px', display: 'inline-block' }}>
          {btf('💵 Cash price · 💳 Card price (+{percent}%)', { percent: dualPct })}
        </div>
      )}
      {shown.map((g) => (
        <div key={g.id} ref={(el) => { sectionRefs.current[g.id] = el; }} style={{ marginBottom: 22, scrollMarginTop: 130 }}>
          <SectionLabel accent={accent}>{g.name}</SectionLabel>
          <div style={{ display: 'grid', gap: 10, alignContent: 'start', alignItems: 'start', gridAutoRows: 'min-content' }}>
            {g.items.map((s) => {
              const on = selectedIds.includes(s.id);
              const disc = svcDiscount(s);
              return (
                // A div rather than a button, because "Show more" lives inside it
                // and HTML does not allow a button inside a button — Firefox
                // drops the inner one's clicks outright. Role, tabIndex and the
                // key handler keep it exactly as operable as the button it was.
                <div key={s.id} role="button" tabIndex={0} className="lumio-row"
                  onClick={() => onToggle(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(s.id); }
                  }}
                  style={{ ...rowCard, borderColor: on ? accent : '#e9edf4', background: on ? tint(accent, 0.06) : '#fff',
                    boxShadow: on ? `0 10px 26px -16px ${tint(accent, 0.9)}, 0 0 0 3px ${tint(accent, 0.12)}` : rowCard.boxShadow }}>
                  <ServiceThumb url={s.imageUrl} />
                  <span style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                    <span style={rowTitle}>
                      {s.name}
                      {s.isFeatured && <span style={{ marginLeft: 8, background: '#dcfce7', color: 'var(--c166534)', borderRadius: 999, padding: '2px 8px', fontSize: 10.5, fontWeight: 800, letterSpacing: 0.3 }}>{bt('POPULAR')}</span>}
                      {disc > 0 && <span style={{ marginLeft: 8, background: '#fee2e2', color: '#b91c1c', borderRadius: 999, padding: '2px 8px', fontSize: 10.5, fontWeight: 800 }}>-{disc}%</span>}
                    </span>
                    {/* The salon's own words about the service. Two clamped
                        lines: enough to say what's included ("massage, hot
                        towel and polish"), never enough to bury the price. */}
                    {s.description?.trim() ? <ServiceDescription text={s.description.trim()} /> : null}
                    <span style={rowMeta}>
                      {s.durationMinutes > 0 && <>⏳ {s.durationMinutes} min <span style={{ color: 'var(--ccbd5e1)' }}>|</span>{' '}</>}
                      {disc > 0 && <span style={{ textDecoration: 'line-through', color: '#b6bfcd', marginRight: 6 }}>{fmt(s.priceCents)}</span>}
                      {dualPct > 0 ? (
                        <>
                          <b style={{ color: accent }}>{s.priceFrom ? 'from ' : ''}💵 {fmt(svcNetCents(s))}</b>
                          <span style={{ color: '#8fa0bb', fontWeight: 700 }}> · 💳 {fmt(toCard(svcNetCents(s)))}</span>
                        </>
                      ) : (
                        <b style={{ color: accent }}>{s.priceFrom ? 'from ' : ''}{fmt(svcNetCents(s))}</b>
                      )}
                    </span>
                  </span>
                  <PlusCheck on={on} accent={accent} />
                </div>
              );
            })}
            {g.items.length === 0 && <div style={{ color: 'var(--c94a3b8)', fontSize: 13.5, padding: '8px 2px' }}>{bt("Nothing found.")}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 · Technician
// ---------------------------------------------------------------------------
function TechPicker({ staff, staffId, onPick, accent, serviceIds, services }: {
  staff: Staff[]; staffId: string; onPick: (id: string) => void; accent: string;
  serviceIds: string[]; services: Service[];
}) {
  // Skills are read PER TECHNICIAN, same rule as the server: a tech who
  // registered a skill list only takes services on it; a tech with no list
  // configured takes anything.
  const svcName = (sid: string) => (services.find((sv) => sv.id === sid)?.name ?? '').trim();
  /** The picked services THIS tech does not offer (empty = can take the visit). */
  const missingFor = (t: Staff): string[] => {
    const skills = t.staffServices ?? [];
    if (skills.length === 0) return []; // never configured -> unrestricted
    return serviceIds.filter((sid) => !skills.some((l) => l.serviceId === sid)).map(svcName).filter(Boolean);
  };
  const canDo = (t: Staff) => missingFor(t).length === 0;
  // The whole team stays VISIBLE. Hiding people made salons think staff had
  // vanished; a dimmed row with a reason explains itself.
  const eligible = staff.filter(canDo);
  // When nobody clears the whole visit, say WHY precisely: a service no tech
  // lists at all is a setup gap; services that several techs cover are not the
  // problem and must not be blamed in the banner.
  const nobodyLists = serviceIds
    .filter((sid) => !staff.some((t) => {
      const sk = t.staffServices ?? [];
      return sk.length === 0 || sk.some((l) => l.serviceId === sid);
    }))
    .map(svcName).filter(Boolean);
  const rows = [{ id: '', firstName: 'Any', lastName: 'nail tech', avatarUrl: null } as Staff, ...staff];

  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const daysHint = (t: Staff) => {
    const days = [...new Set((t.workingHours ?? []).map((h) => h.dayOfWeek))].sort();
    if (days.length === 0 || days.length === 7) return '';
    return days.map((d) => DAY[d]).join(' · ');
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {eligible.length === 0 && staff.length > 0 && (
        <div style={{ fontSize: 12.5, color: '#7d8ba4', background: '#f7f9fc', border: '1px solid #e9edf4', borderRadius: 10, padding: '8px 13px' }}>
          {nobodyLists.length > 0
            ? <>{bt("No technician lists ")}<b>{nobodyLists.join(', ')}</b> yet — pick “Any” and the salon will assign the right person.</>
            : <>No single technician does all of your services — pick “Any” and the salon will pair you with the right techs for each one.</>}
        </div>
      )}
      {rows.map((s) => {
        const label = `${s.firstName} ${s.lastName ?? ''}`.trim();
        const on = staffId === s.id;
        const missing = s.id ? missingFor(s) : [];
        const ok = !s.id || missing.length === 0;
        const hint = s.id ? daysHint(s) : '';
        return (
          <button key={s.id || 'any'} type="button" className="lumio-row"
            onClick={ok ? () => onPick(s.id) : undefined}
            disabled={!ok}
            aria-disabled={!ok}
            style={{ ...rowCard, padding: '15px 16px',
              borderColor: on ? accent : '#e9edf4',
              background: on ? tint(accent, 0.06) : '#fff',
              // Dimmed, not gone: the customer sees the full team and WHY this
              // person can't take the job.
              opacity: ok ? 1 : 0.45,
              cursor: ok ? 'pointer' : 'not-allowed',
              boxShadow: on ? `0 10px 26px -16px ${tint(accent, 0.9)}, 0 0 0 3px ${tint(accent, 0.12)}` : rowCard.boxShadow }}>
            <Avatar name={label} url={s.avatarUrl} size={46} accent={accent} />
            <span style={{ flex: 1, textAlign: 'left', fontSize: 15, fontWeight: 700, color: INK, marginLeft: 12, minWidth: 0 }}>
              {s.id ? label : bt('Any nail tech')}
              {!s.id && <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--c94a3b8)', marginTop: 2 }}>{bt("First one free at your time")}</span>}
              {s.id && !ok && <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#b0532f', marginTop: 2 }}>{btf('Doesn’t offer {what}', { what: missing.join(', ') || bt('this service') })}</span>}
              {s.id && ok && hint && <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--c94a3b8)', marginTop: 2 }}>{btf('Works {hint}', { hint })}</span>}
            </span>
            {on
              ? <span style={{ width: 30, height: 30, borderRadius: '50%', background: accent, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 15, flexShrink: 0 }}>✓</span>
              : <span style={{ padding: '8px 18px', borderRadius: 999, border: `1px solid ${ok ? accent : '#e2e8f2'}`, color: ok ? accent : '#b6bfcd', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{ok ? bt('Select') : '—'}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 · Date & time — a 7-day strip plus Morning / Afternoon / Evening slots.
// Times that are taken stay visible but struck through, so the page never
// looks empty and the visitor can see how busy the day is.
// ---------------------------------------------------------------------------
function TimePicker({ rules, salon, selectedDate, slot, avail, staffId, durationMinutes, onPickDate, onPickSlot, waitlist, accent, cartBusy = [], groupNeeds = [] }: {
  rules: BookingRules; salon: Salon | null; selectedDate: Date | null; slot: Slot | null; avail: Availability | null;
  staffId: string; durationMinutes: number; onPickDate: (d: Date) => void; onPickSlot: (s: Slot) => void;
  waitlist?: React.ReactNode; accent: string;
  /** Times already reserved by earlier visits in this session's cart. */
  cartBusy?: { start: string; end: string }[];
  /** Group mode: one entry per person — who may serve them and for how long.
   *  elig === 'ANY' means any tech (unconfigured services). */
  groupNeeds?: { elig: 'ANY' | string[]; durationMin: number }[];
}) {
  // The day strip already passed the salon's timezone INTO generateSlots, but
  // started counting from the visitor's own date — so for a reader a day ahead
  // of the salon the whole strip was offset by one, and "today" was missing
  // from it. Half a fix reads as a working feature, which is why it survived.
  const today = useMemo(() => todayInZone(salon?.timezone), [salon?.timezone]);
  const maxDate = useMemo(() => new Date(today.getTime() + rules.maxAdvanceDays * 86400000), [today, rules.maxAdvanceDays]);

  // The strip starts at the first bookable day and slides a week at a time.
  const firstOpen = useMemo(() => {
    for (let i = 0; i <= rules.maxAdvanceDays; i++) {
      const d = new Date(today.getTime() + i * 86400000);
      if (!isClosedDay(d, rules) && generateSlots(d, Math.max(durationMinutes, 15), rules, salon?.timezone).length > 0) return d;
    }
    return today;
  }, [today, rules, durationMinutes, salon?.timezone]);

  const [stripStart, setStripStart] = useState<Date>(firstOpen);
  useEffect(() => { setStripStart(firstOpen); }, [firstOpen]);
  useEffect(() => { if (!selectedDate) onPickDate(firstOpen); }, [firstOpen, selectedDate, onPickDate]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(stripStart.getTime() + i * 86400000)), [stripStart]);
  const shift = (weeks: number) => {
    const next = new Date(stripStart.getTime() + weeks * 7 * 86400000);
    if (next < today) { setStripStart(today); return; }
    if (next > maxDate) return;
    setStripStart(next);
  };

  const slots = useMemo(
    () => (selectedDate ? generateSlots(selectedDate, Math.max(durationMinutes, 15), rules, salon?.timezone) : []),
    [selectedDate, durationMinutes, rules, salon?.timezone],
  );

  // Structural check for groups, busy times IGNORED: can the salon's current
  // skill lists seat this many people at once at all? When they can't, every
  // single day is empty and the empty state must explain the real reason.
  const groupShortage = useMemo(() => {
    if (groupNeeds.length <= 1 || !avail || avail.noStaff) return false;
    const allTechs = avail.eligibleStaffIds;
    const need = groupNeeds
      .filter((g) => g.elig !== 'ANY' || allTechs.length > 0)
      .map((g) => (g.elig === 'ANY' ? allTechs : g.elig));
    const assign = (i: number, used: Set<string>): boolean => {
      if (i >= need.length) return true;
      for (const tech of need[i]) {
        if (used.has(tech)) continue;
        used.add(tech);
        if (assign(i + 1, used)) return true;
        used.delete(tech);
      }
      return false;
    };
    return !assign(0, new Set());
  }, [groupNeeds, avail]);

  // A slot is bookable when the chosen tech is free — or, with "Any", when at
  // least one technician who can do every picked service is free.
  const isFree = useCallback((s: Slot) => {
    if (!avail) return true;
    if (avail.noStaff) return true;                 // no team on file — shop assigns later

    // Group: every person starts together, so the salon needs enough DIFFERENT
    // technicians free at once. Guests are few (≤4), so try every assignment.
    if (groupNeeds.length > 1) {
      const allTechs = avail.eligibleStaffIds;
      // (structural shortage is reported separately below — see groupShortage)
      const freeFor = (tech: string, mins: number) => {
        const end = new Date(s.start.getTime() + mins * 60000);
        return !overlapsTz({ start: s.start, end }, avail.staffBusy[tech] ?? [], salon?.timezone);
      };
      const options = groupNeeds.map((g) =>
        (g.elig === 'ANY' ? allTechs : g.elig).filter((tech) => freeFor(tech, g.durationMin)),
      );
      // A guest whose services nobody lists is seated by the desk — they don't
      // consume a matched tech here.
      const need = options.filter((_, i) => groupNeeds[i].elig !== 'ANY' || allTechs.length > 0);
      const assign = (i: number, used: Set<string>): boolean => {
        if (i >= need.length) return true;
        for (const tech of need[i]) {
          if (used.has(tech)) continue;
          used.add(tech);
          if (assign(i + 1, used)) return true;
          used.delete(tech);
        }
        return false;
      };
      if (assign(0, new Set())) return true;
      // Turns mode — only if the SALON opted into it (Settings → Rules).
      // A 2-tech salon that wants a party of 4 seats them in waves: the slot
      // stays bookable as the group's ARRIVAL time, each guest's services just
      // need someone eligible free (the same tech may serve several guests in
      // turns; nobody's calendar is locked — the desk assigns). Strict salons
      // simply do not offer the time.
      if (groupShortage && rules.groupPolicy === 'flexible') return need.every((opts) => opts.length > 0);
      return false;
    }
    // A specific tech was chosen → that one person must be free for the whole
    // block. A tech who is NOT in the eligible pool (can't do a picked service)
    // gets no slots at all — before this check, an unknown id fell through to
    // an empty busy list and the whole day looked open.
    if (staffId) {
      if (!avail.eligibleStaffIds.includes(staffId)) return false;
      // Visits already in the cart are not on the server yet — block the same
      // tech from being picked twice for overlapping times in this session.
      // Server busy blocks are UTC instants (tz-anchored); the cart's own
      // pending visits are wall-time like the slot itself — compare each in kind.
      return !overlapsTz(s, avail.staffBusy[staffId] ?? [], salon?.timezone) && !overlaps(s, cartBusy);
    }
    // "Any tech": bookable when EACH service has at least one eligible tech free — they
    // may be different people (specialist salons). A service with no team of its own is
    // treated as free (the shop assigns it afterwards).
    return avail.perService.every((ps) =>
      // noStaff: brand-new salon, nobody on file. unstaffed: nobody LISTS this
      // service — the desk assigns it by hand, so it must not block the visit.
      ps.noStaff || ps.unstaffed || ps.eligibleStaffIds.some((id) => !overlapsTz(s, ps.staffBusy[id] ?? [], salon?.timezone)),
    );
  }, [avail, staffId, cartBusy, groupNeeds, groupShortage, rules.groupPolicy, salon?.timezone]);

  // `key` stays English so the icon lookup keeps working in any language.
  const groups: { key: string; label: string; items: Slot[] }[] = useMemo(() => {
    const g = { Morning: [] as Slot[], Afternoon: [] as Slot[], Evening: [] as Slot[] };
    for (const s of slots) {
      const h = s.start.getHours();
      if (h < 12) g.Morning.push(s); else if (h < 17) g.Afternoon.push(s); else g.Evening.push(s);
    }
    return [
      { key: 'Morning', label: bt('Morning'), items: g.Morning },
      { key: 'Afternoon', label: bt('Afternoon'), items: g.Afternoon },
      { key: 'Evening', label: bt('Evening'), items: g.Evening },
    ].filter((x) => x.items.length > 0);
  }, [slots]);

  const anyFree = slots.some(isFree);
  const promo = promoPctFor(salon, selectedDate, null);

  return (
    <div>
      {/* month + jump-to-date */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontWeight: 800, color: INK, fontSize: 15 }}>
          {selectedDate && <span style={{ color: accent, marginRight: 8 }}>📅 {selectedDate.toLocaleDateString(bookLocale(), { weekday: 'long', month: 'long', day: 'numeric' })}</span>}
          <span style={{ color: 'var(--c64748b)', fontWeight: 600 }}>{bt(MONTH_NAMES[stripStart.getMonth()])} {stripStart.getFullYear()}</span>
        </div>
        <label style={{ width: 38, height: 38, borderRadius: '50%', border: '1px solid #e6eaf2', display: 'grid', placeItems: 'center', cursor: 'pointer', color: INK }}>
          🗓
          <input type="date" value={selectedDate ? ymd(selectedDate) : ''} min={ymd(today)} max={ymd(maxDate)}
            onChange={(e) => {
              const [y, m, d] = e.target.value.split('-').map(Number);
              if (!y) return;
              const picked = new Date(y, m - 1, d);
              onPickDate(picked); setStripStart(picked);
            }}
            style={{ position: 'absolute', width: 38, height: 38, opacity: 0, cursor: 'pointer' }} />
        </label>
      </div>

      {/* 7-day strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 18 }}>
        <button onClick={() => shift(-1)} disabled={stripStart <= today} style={{ ...arrowBtn, opacity: stripStart <= today ? 0.35 : 1 }}>‹</button>
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {days.map((d) => {
            const closed = isClosedDay(d, rules) || d > maxDate;
            const on = !!selectedDate && sameDay(d, selectedDate);
            const deal = promoPctFor(salon, d, null);
            return (
              <button key={d.toISOString()} type="button" disabled={closed} onClick={() => onPickDate(d)}
                style={{ display: 'grid', justifyItems: 'center', gap: 2, padding: '8px 2px', borderRadius: 12, border: 'none', cursor: closed ? 'not-allowed' : 'pointer',
                  background: on ? `linear-gradient(140deg, ${accent}, ${shade(accent, 0.28)})` : 'transparent',
                  boxShadow: on ? `0 10px 22px -12px ${tint(accent, 0.95)}` : 'none',
                  color: on ? '#fff' : closed ? 'var(--ccbd5e1)' : INK, position: 'relative' }}>
                <span style={{ fontSize: 17, fontWeight: 800, textDecoration: closed ? 'line-through' : 'none' }}>{d.getDate()}</span>
                <span style={{ fontSize: 11, opacity: on ? 0.95 : 0.6 }}>{bt(DOW_SHORT[d.getDay()])}</span>
                {!on && deal > 0 && !closed && <span style={{ position: 'absolute', top: 2, right: 6, fontSize: 9, fontWeight: 800, color: '#16a34a' }}>-{deal}%</span>}
              </button>
            );
          })}
        </div>
        <button onClick={() => shift(1)} disabled={new Date(stripStart.getTime() + 7 * 86400000) > maxDate} style={arrowBtn}>›</button>
      </div>

      {promo > 0 && (
        <div style={{ marginBottom: 14, padding: '9px 12px', borderRadius: 10, background: '#ecfdf5', border: '1px solid var(--c6ee7b7)', color: '#065f46', fontSize: 13, fontWeight: 700 }}>
          🎉 −{promo}% off on this day — applied automatically.
        </div>
      )}

      {/* A service nobody lists no longer blocks the day — the booking goes in
          and the front desk assigns someone. A quiet note keeps it honest. */}
      {avail && !avail.noStaff && avail.perService.some((ps) => ps.unstaffed) && (
        <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 12, background: '#fffbeb', border: '1px solid var(--cfde68a)', color: 'var(--c92400e)', fontSize: 12.5, fontWeight: 600 }}>
          🛠️ Part of your visit isn&apos;t linked to a technician yet — the salon will assign the right person after you book.
        </div>
      )}
      {/* More guests than technicians for these services: bookable, in waves.
          Said BEFORE the times so nobody expects four chairs at once. */}
      {groupNeeds.length > 1 && groupShortage && rules.groupPolicy === 'flexible' && (
        <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 12, background: '#fffbeb', border: '1px solid var(--cfde68a)', color: 'var(--c92400e)', fontSize: 12.5, fontWeight: 600, lineHeight: 1.6 }}>
          👥 Your group is bigger than the number of technicians who do these services — the salon will serve you in turns, so some guests may wait a little between starts. The times below are your group&apos;s arrival time.
        </div>
      )}
      {groups.length === 0 || !anyFree ? (
        groupNeeds.length > 1 && groupShortage && rules.groupPolicy !== 'flexible' ? (
          /* Strict salon: the staffing maths can never seat this group at once,
             so no date will help — say the real reason, not "try tomorrow". */
          <div style={{ padding: '22px 0', textAlign: 'center' }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>👥</div>
            <div style={{ textAlign: 'left', fontSize: 13.5, color: 'var(--c92400e)', background: '#fffbeb', border: '1px solid var(--cfde68a)', borderRadius: 12, padding: '12px 16px', lineHeight: 1.65 }}>
              A group of <b>{groupNeeds.length}</b> needs <b>{groupNeeds.length} different technicians</b> free at the same time — more than currently offer the services you picked, so no day will show times. Try different services, book one person at a time, or call the salon to arrange your group.
            </div>
            {waitlist}
          </div>
        ) : (
        <div style={{ padding: '26px 0', textAlign: 'center', color: 'var(--c94a3b8)' }}>
          <div style={{ fontSize: 30, marginBottom: 6 }}>😔</div>
          <div style={{ fontSize: 14 }}>{bt("No times left on this day. Try the next one.")}</div>
          {waitlist}
        </div>
        )
      ) : (
        <>
          {groups.map((g) => (
            <div key={g.label} style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ flex: 1, height: 1, background: '#eef1f6' }} />
                <span style={{ fontWeight: 800, color: INK, fontSize: 12.5, letterSpacing: 0.4 }}>
                  {g.key === 'Morning' ? '🌤 ' : g.key === 'Afternoon' ? '☀️ ' : '🌙 '}{g.label.toUpperCase()}
                </span>
                <span style={{ flex: 1, height: 1, background: '#eef1f6' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {g.items.map((s) => {
                  const free = isFree(s);
                  const on = !!slot && slot.start.getTime() === s.start.getTime();
                  return (
                    <button key={s.start.toISOString()} type="button" disabled={!free} onClick={() => onPickSlot(s)}
                      className={free ? 'lumio-slot' : undefined}
                      style={{ padding: '13px 6px', borderRadius: 12, fontSize: 14, fontWeight: 700, cursor: free ? 'pointer' : 'not-allowed',
                        border: `1px solid ${on ? accent : '#e9edf4'}`, background: on ? tint(accent, 0.10) : free ? '#fff' : '#f6f8fb',
                        boxShadow: on ? `0 10px 24px -16px ${tint(accent, 0.95)}, 0 0 0 3px ${tint(accent, 0.12)}` : '0 2px 6px -4px rgba(15,42,82,.16)',
                        color: !free ? '#c3cbd8' : on ? accent : INK, textDecoration: free ? 'none' : 'line-through' }}>
                      {fmtTime(s.start)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {waitlist}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 · Confirm — appointment card, services, your details, payment.
// ---------------------------------------------------------------------------
function ConfirmStep({ salon, slot, employee, lines, fmt, totalCents, depositCents, cardFee, rules, paymentType, setPaymentType, form, setForm, smsConsent, setSmsConsent, accent, error, infoOk, isMobile }: {
  salon: Salon | null; slot: Slot; employee: Staff | null; lines: Line[]; fmt: (c: number) => string; totalCents: number;
  depositCents: number; cardFee?: { enabled: boolean; percent: number }; rules: BookingRules; paymentType: 'PAY_ONLINE' | 'PAY_LATER'; setPaymentType: (v: 'PAY_ONLINE' | 'PAY_LATER') => void;
  form: { firstName: string; lastName: string; email: string; phone: string; birthDate: string; partySize: string };
  setForm: (f: { firstName: string; lastName: string; email: string; phone: string; birthDate: string; partySize: string }) => void;
  smsConsent: boolean; setSmsConsent: (v: boolean) => void; accent: string; error: string | null; infoOk: boolean; isMobile: boolean;
}) {
  const showPhoneError = form.phone.trim().length > 0 && !isValidPhone(form.phone);
  const showEmailError = form.email.trim().length > 0 && !isValidEmail(form.email);
  return (
    <div>
      <p style={{ color: 'var(--c64748b)', fontSize: 14, margin: '-6px 0 16px' }}>{bt('Review your details and complete your appointment.')}</p>

      <Card title={bt("APPOINTMENT")}>
        <InfoRow icon="🏪" label={bt("Location")} value={salon?.name ?? ''} sub={salon?.address ?? undefined} />
        <InfoRow icon="📅" label={bt("Date")} value={slot.start.toLocaleDateString(bookLocale())} />
        <InfoRow icon="🕐" label={bt("Time")} value={slot.end.getTime() > slot.start.getTime() ? `${fmtTime(slot.start)} – ${fmtTime(slot.end)}` : fmtTime(slot.start)} />
        <InfoRow icon="👤" label={bt("Technician")} value={employee ? `${employee.firstName} ${employee.lastName ?? ''}`.trim() : bt('Any available')} last />
      </Card>

      <Card title={bt("SERVICES")}>
        {lines.map((l) => (
          <div key={l.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid #eef1f6' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <CartThumb url={l.imageUrl} />
              <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>{l.name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 2 }}>{l.durationMinutes > 0 ? `${l.durationMinutes} min` : ''}{employee && <>{l.durationMinutes > 0 ? ' · ' : ''}👤 <b style={{ color: accent }}>{employee.firstName}</b></>}</div>
              </div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: INK, whiteSpace: 'nowrap' }}>{fmt(l.priceCents)}</div>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 12, fontWeight: 800, color: INK, fontSize: 15 }}>
          <span>{bt("Total")}</span><span>{fmt(totalCents)}</span>
        </div>
        {salon?.firstVisit?.enabled && (salon.firstVisit.rules?.length ?? 0) > 0 && (
          <div style={{ fontSize: 12, color: 'var(--c7c5c22)', background: '#fdf7ee', border: '1px solid #f0e2cc', borderRadius: 8, padding: '7px 11px', marginTop: 8, lineHeight: 1.5 }}>
            🎁 Visit reward: we check your visit count automatically (by phone/email) and the matching discount is applied to your booking price.
          </div>
        )}
        {depositCents > 0 && (() => {
          const feePct = cardFee?.enabled ? cardFee.percent : 0;
          const fee = feePct > 0 ? Math.round((depositCents * feePct) / 100) : 0;
          return (
            <div style={{ marginTop: 8, fontSize: 13, color: accent, fontWeight: 700 }}>
              {bt('Deposit due today: ')}{fmt(depositCents + fee)}
              {fee > 0 && <span style={{ display: 'block', fontWeight: 500, color: 'var(--c64748b)', fontSize: 12, marginTop: 2 }}>{btf('Paid online by card — includes {percent}% card fee ({amount}). Pay at the salon in cash to avoid it.', { percent: feePct, amount: fmt(fee) })}</span>}
            </div>
          );
        })()}
      </Card>

      <Card title={bt("YOUR DETAILS")}>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
          <Field label={bt("First name")} required><input style={inputStyle} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
          <Field label={bt("Last name")}><input style={inputStyle} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
          <Field label={bt("Phone")} required>
            <input style={{ ...inputStyle, borderColor: showPhoneError ? '#ef4444' : '#dbe2ee' }} value={form.phone} inputMode="tel" placeholder={bt("e.g. (201) 555-0123")}
              onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            {showPhoneError && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{bt("Enter a valid phone number (8\u201315 digits).")}</div>}
          </Field>
          <Field label={bt("Email (optional)")}>
            <input style={{ ...inputStyle, borderColor: showEmailError ? '#ef4444' : '#dbe2ee' }} type="email" value={form.email} placeholder="you@email.com"
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
            {showEmailError
              ? <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>{bt("Enter a valid email address.")}</div>
              : <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)', marginTop: 4 }}>{bt('We’ll email your receipt 💌')}</div>}
          </Field>
          <Field label={bt("People")}><input style={inputStyle} type="number" min={1} max={20} value={form.partySize} onChange={(e) => setForm({ ...form, partySize: e.target.value })} /></Field>
          <Field label={bt("🎂 Birthday (optional)")}><BirthdayInput value={form.birthDate} onChange={(iso) => setForm({ ...form, birthDate: iso })} /></Field>
        </div>

        <div style={{ marginTop: 8, padding: '12px 14px', background: SOFT, border: '1px solid #e6eaf2', borderRadius: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: INK, marginBottom: 4 }}>{bt('📱 Appointment text updates')}</div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: 'var(--c64748b)' }}>
            {btf('We’ll text you confirmations & reminders for this appointment from {salon}. Up to ~6 msgs/month. Msg & data rates may apply. Reply STOP to opt out, HELP for help.', { salon: salon?.name || bt('the salon') })}
          </p>
          <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={smsConsent} onChange={(e) => setSmsConsent(e.target.checked)} style={{ marginTop: 2, width: 16, height: 16, accentColor: accent, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: 'var(--c475569)', lineHeight: 1.5 }}>{bt('Also send me special offers & promotions by text')} <span style={{ color: 'var(--c94a3b8)' }}>{bt('(optional)')}</span></span>
          </label>
          <div style={{ fontSize: 11, color: 'var(--c94a3b8)', marginTop: 9 }}>
            <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: accent, textDecoration: 'none', fontWeight: 600 }}>{bt("Privacy")}</a>
            <span style={{ margin: '0 6px' }}>·</span>
            <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: accent, textDecoration: 'none', fontWeight: 600 }}>{bt("Messaging Terms")}</a>
          </div>
        </div>
      </Card>

      {(rules.onlinePaymentEnabled || rules.payLaterEnabled) && (
        <Card title={bt("PAYMENT")}>
          <div style={{ display: 'grid', gap: 10 }}>
            {rules.onlinePaymentEnabled && (
              <PayOption selected={paymentType === 'PAY_ONLINE'} onClick={() => setPaymentType('PAY_ONLINE')}
                title={depositCents > 0 ? btf('Pay deposit now · {amount}', { amount: fmt(depositCents) }) : bt('Pay online now')}
                desc={bt("Secure card payment. Your spot is held instantly.")} accent={accent} />
            )}
            {rules.payLaterEnabled && (
              <PayOption selected={paymentType === 'PAY_LATER'} onClick={() => setPaymentType('PAY_LATER')}
                title={bt("Pay at the salon")} desc={bt("Cash or card when you arrive.")} accent={accent} />
            )}
          </div>
        </Card>
      )}

      {error && <div style={{ background: '#fef2f2', border: '1px solid var(--cfecaca)', color: '#b91c1c', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, marginBottom: 12 }}>{error}</div>}
      {!infoOk && <div style={{ color: 'var(--c94a3b8)', fontSize: 12.5, marginBottom: 8 }}>{bt('Enter your first name and phone number to confirm. Email is optional.')}</div>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid #e6eaf2', borderRadius: 14, padding: '14px 16px', marginBottom: 14, background: '#fff' }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.8, color: '#8fa0bb', marginBottom: 10 }}>{title}</div>
      {children}
    </section>
  );
}
function InfoRow({ icon, label, value, sub, last }: { icon: string; label: string; value: string; sub?: string; last?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '9px 0', borderBottom: last ? 'none' : '1px solid #eef1f6' }}>
      <span style={{ width: 34, height: 34, borderRadius: 9, background: SOFT, display: 'grid', placeItems: 'center', fontSize: 15, flexShrink: 0 }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: '#8fa0bb' }}>{label}</div>
        <div style={{ fontSize: 14.5, fontWeight: 700, color: INK }}>{value}</div>
        {sub && <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}
function PayOption({ selected, onClick, title, desc, accent }: { selected: boolean; onClick: () => void; title: string; desc: string; accent: string }) {
  return (
    <button type="button" onClick={onClick} className="lumio-row"
      style={{ ...rowCard, alignItems: 'flex-start', borderColor: selected ? accent : '#e6eaf2', background: selected ? '#f6f7ff' : '#fff' }}>
      <span style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${selected ? accent : 'var(--ccbd5e1)'}`, display: 'grid', placeItems: 'center', marginTop: 2, flexShrink: 0 }}>
        {selected && <span style={{ width: 10, height: 10, borderRadius: '50%', background: accent }} />}
      </span>
      <span style={{ textAlign: 'left', marginLeft: 12 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: INK }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 2 }}>{desc}</span>
      </span>
    </button>
  );
}
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 12.5, color: '#5b6b85', marginBottom: 6, fontWeight: 600 }}>
        {required && <span style={{ color: '#ef4444' }}>* </span>}{label}
      </span>
      {children}
    </label>
  );
}
/** The salon's own logo (Settings -> Branding -> Logo URL). Falls back to a
 *  neutral shop mark so the header never looks broken while a salon has not
 *  uploaded one yet. */
function Logo({ url, size, scale }: { url?: string | null; size: number; scale?: number }) {
  const clean = (url ?? '').trim();
  const zoom = Math.min(200, Math.max(50, scale ?? 100)) / 100;
  if (clean.startsWith('https://') || clean.startsWith('data:image/')) {
    // White frame by default (so transparent logos always show); the salon's
    // zoom setting lets a logo with its own background bleed edge-to-edge.
    return (
      <span style={{ width: size, height: size, borderRadius: 10, background: '#fff', display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0, boxShadow: '0 2px 8px rgba(15,42,82,0.18)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={clean} alt="" width={size} height={size} style={{ width: '100%', height: '100%', objectFit: 'contain', transform: `scale(${zoom})`, transformOrigin: 'center' }} />
      </span>
    );
  }
  return (
    <span style={{ width: size, height: size, borderRadius: 10, background: 'rgba(255,255,255,0.18)', display: 'grid', placeItems: 'center', fontSize: size * 0.45, flexShrink: 0 }}>🏪</span>
  );
}

function Avatar({ name, url, size, accent }: { name: string; url: string | null; size: number; accent: string }) {
  const initials = (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('');
  // eslint-disable-next-line @next/next/no-img-element
  if (url) return <img src={url} alt={name} width={size} height={size} style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', background: accent, color: '#fff', display: 'grid', placeItems: 'center', fontSize: size * 0.36, fontWeight: 800, flexShrink: 0 }}>
      {initials || '?'}
    </span>
  );
}
/**
 * A small service photo on the booking menu. It appears only when the salon set a
 * valid https image AND it actually loads; otherwise it renders nothing, so rows
 * without a photo stay tight and the list never shows a broken image. 56px keeps
 * it appetising without pushing the price and the ＋ button off a phone screen.
 */
/** 40px thumbnail for the cart / confirm list. Hidden when there is no photo. */
function CartThumb({ url }: { url?: string | null }) {
  const clean = (url ?? '').trim();
  const [ok, setOk] = useState(clean.startsWith('https://') || clean.startsWith('data:image/'));
  useEffect(() => { setOk(clean.startsWith('https://') || clean.startsWith('data:image/')); }, [clean]);
  if (!ok) return null;
  return (
    <span style={{ width: 40, height: 40, borderRadius: 9, overflow: 'hidden', flexShrink: 0, background: 'var(--cf1f5f9)', display: 'block' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={clean} alt="" loading="lazy" onError={() => setOk(false)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </span>
  );
}

/**
 * The salon's own words about a service: two lines, or all of it on request.
 *
 * THE CONFLICT THIS SETTLES
 *
 * The shop writes a full description because the full description is what sells
 * a $110 package over a $63 one — it is the only place the difference between
 * them is written down. The list needs two lines or it stops being a list. Both
 * are right, so neither is asked to give way: two lines by default, the whole
 * thing one tap away.
 *
 * THREE THINGS THAT MAKE IT BEHAVE
 *
 * 1. "Show more" appears ONLY when there is more. A control that reveals
 *    nothing teaches people not to press the one that does, so the element is
 *    measured and the button is rendered only when the text actually overflows.
 *    Measuring is skipped while open — an unclamped element never overflows, so
 *    measuring then would read zero and delete the button mid-use.
 * 2. An expanded card tidies itself away once it scrolls off screen. Collapsing
 *    on ANY scroll was the request, and it is the wrong rule: a person reading
 *    nine steps scrolls a little to read them, and the text would snap shut
 *    under their eyes. Leaving the viewport is the honest signal that they are
 *    done with it.
 * 3. Pressing it must not add the service to the basket. The row is one big
 *    control, so both the click and the Enter key are stopped here — otherwise
 *    "Show more" quietly books a $110 package, and the person who finds that
 *    bug is a customer.
 */
function ServiceDescription({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    if (open) return; // see note 1
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight - el.clientHeight > 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    // Rotating a phone re-wraps the text, and a description that fitted in
    // landscape may not fit in portrait.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);

  useEffect(() => {
    if (!open || typeof IntersectionObserver === 'undefined') return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries.some((e) => !e.isIntersecting)) setOpen(false); },
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [open]);

  return (
    <>
      <span ref={ref} style={open ? rowDescOpen : rowDesc}>{text}</span>
      {overflows && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          onKeyDown={(e) => e.stopPropagation()}
          aria-expanded={open}
          style={moreBtn}
        >{open ? bt('Show less') : bt('Show more')}</button>
      )}
    </>
  );
}

function ServiceThumb({ url }: { url?: string | null }) {
  const clean = (url ?? '').trim();
  const [ok, setOk] = useState(clean.startsWith('https://') || clean.startsWith('data:image/'));
  useEffect(() => { setOk(clean.startsWith('https://') || clean.startsWith('data:image/')); }, [clean]);
  if (!ok) return null;
  return (
    <span style={{ width: 56, height: 56, borderRadius: 12, overflow: 'hidden', flexShrink: 0, background: 'var(--cf1f5f9)', display: 'block' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={clean} alt="" loading="lazy" onError={() => setOk(false)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </span>
  );
}

function PlusCheck({ on, accent }: { on: boolean; accent: string }) {
  return on
    ? <span className="lumio-added" style={{ width: 34, height: 34, borderRadius: '50%', background: accent, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 16, flexShrink: 0, boxShadow: `0 6px 16px -6px ${tint(accent, 0.95)}` }}><span className="lumio-tick" style={{ lineHeight: 1 }}>✓</span></span>
    : <span style={{ width: 34, height: 34, borderRadius: '50%', border: `1.5px solid ${accent}`, color: accent, display: 'grid', placeItems: 'center', fontSize: 18, flexShrink: 0, background: '#fff' }}>+</span>;
}
function SectionLabel({ children, accent }: { children: React.ReactNode; accent: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 10px' }}>
      <span style={{ width: 4, height: 16, borderRadius: 2, background: accent }} />
      <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: 0.6, color: accent, textTransform: 'uppercase' }}>{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Birthday, waitlist, deals — unchanged behaviour, restyled.
// ---------------------------------------------------------------------------
function BirthdayInput({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const init = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-') : ['', '', ''];
  const [yy, setYy] = useState(init[0]);
  const [mm, setMm] = useState(init[1] ? String(parseInt(init[1], 10)) : '');
  const [dd, setDd] = useState(init[2] ? String(parseInt(init[2], 10)) : '');
  const daysInMonth = (m: string, y: string) => {
    const mi = parseInt(m, 10);
    if (!mi) return 31;
    return new Date(parseInt(y, 10) || 2000, mi, 0).getDate();
  };
  const emit = (m: string, d: string, y: string) => {
    if (m && d && y) {
      const dNum = Math.min(parseInt(d, 10), daysInMonth(m, y));
      onChange(`${y}-${m.padStart(2, '0')}-${String(dNum).padStart(2, '0')}`);
    } else onChange('');
  };
  const clampDay = (m: string, y: string, d: string) => {
    if (d && parseInt(d, 10) > daysInMonth(m, y)) { const nd = String(daysInMonth(m, y)); setDd(nd); return nd; }
    return d;
  };
  const now = new Date().getFullYear();
  const years: number[] = []; for (let y = now; y >= 1920; y--) years.push(y);
  const days: number[] = []; for (let d = 1; d <= daysInMonth(mm, yy); d++) days.push(d);
  const sel: React.CSSProperties = { ...inputStyle, appearance: 'auto', cursor: 'pointer' };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1.1fr', gap: 8 }}>
      <select style={sel} value={mm} onChange={(e) => { setMm(e.target.value); emit(e.target.value, clampDay(e.target.value, yy, dd), yy); }} aria-label={bt("Birth month")}>
        <option value="">{bt('Month')}</option>
        {MONTH_NAMES.map((name, i) => <option key={i} value={String(i + 1)}>{bt(name)}</option>)}
      </select>
      <select style={sel} value={dd} onChange={(e) => { setDd(e.target.value); emit(mm, e.target.value, yy); }} aria-label={bt("Birth day")}>
        <option value="">{bt('Day')}</option>
        {days.map((d) => <option key={d} value={String(d)}>{d}</option>)}
      </select>
      <select style={sel} value={yy} onChange={(e) => { setYy(e.target.value); emit(mm, clampDay(mm, e.target.value, dd), e.target.value); }} aria-label={bt("Birth year")}>
        <option value="">{bt('Year')}</option>
        {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
      </select>
    </div>
  );
}

function WaitlistCta({ base, preferredDate, serviceId, fmtAccent }: { base: string; preferredDate: Date | null; serviceId?: string; fmtAccent: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ customerName: '', phone: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!f.customerName.trim()) { setErr(bt('Please enter your name.')); return; }
    if (!isValidPhone(f.phone) && !isValidEmail(f.email)) { setErr(bt('Please enter a valid phone or email so we can reach you.')); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${base}/waitlist`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName: f.customerName, phone: f.phone || undefined, email: f.email || undefined, preferredDate: preferredDate ? ymd(preferredDate) : undefined, serviceId: serviceId || undefined }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || bt('Could not join')); }
      setDone(true);
    } catch (e) { setErr(e instanceof Error ? e.message : bt('Could not join')); }
    finally { setBusy(false); }
  }

  if (done) return (
    <div style={{ marginTop: 12, background: '#ecfdf5', border: '1px solid var(--c6ee7b7)', borderRadius: 12, padding: '12px 14px', color: '#065f46', fontSize: 14, textAlign: 'center' }}>
      {bt('✓ You’re on the waitlist! We’ll reach out if a spot opens up.')}
    </div>
  );
  return (
    <div style={{ marginTop: 12, border: '1px solid #e6eaf2', borderRadius: 12, padding: '12px 14px' }}>
      {!open ? (
        <button onClick={() => setOpen(true)} style={{ background: 'none', border: 'none', color: fmtAccent, fontSize: 14, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
          {bt('Can’t find a time? Join the waitlist →')}
        </button>
      ) : (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 10 }}>
            <div style={{ fontWeight: 800, color: INK }}>{bt("Join the waitlist")}</div>
            <button onClick={() => { setOpen(false); setErr(null); }} aria-label={bt("Close")} style={{ background: 'none', border: 'none', color: 'var(--c94a3b8)', fontSize: 22, lineHeight: 1, cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <input placeholder={bt("Your name")} value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} style={inputStyle} />
            <input placeholder={bt("Phone")} value={f.phone} inputMode="tel" onChange={(e) => setF({ ...f, phone: e.target.value })} style={inputStyle} />
            <input placeholder={bt("Email (optional)")} value={f.email} type="email" onChange={(e) => setF({ ...f, email: e.target.value })} style={inputStyle} />
          </div>
          {err && <p style={{ color: '#dc2626', fontSize: 13, margin: '8px 0 0' }}>{err}</p>}
          <button onClick={submit} disabled={busy} style={{ ...ctaBtn, marginTop: 10 }}>{busy ? bt('Joining…') : bt('Join waitlist')}</button>
        </div>
      )}
    </div>
  );
}

// Always-on program promos (first visit / bring friends). Display only — the
// actual % is applied server-side at booking time (can't be spoofed).
function ProgramBanner({ fv, gr }: {
  fv?: { enabled: boolean; percent: number; message: string; rules?: { visit: number; percent: number }[] };
  gr?: { enabled: boolean; message: string; tiers: { minSize: number; percent: number }[] };
}) {
  const lines: string[] = [];
  const ord = (n: number) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);
  const fvRules = fv?.enabled ? (fv.rules?.length ? fv.rules : (fv.percent > 0 ? [{ visit: 1, percent: fv.percent }] : [])) : [];
  if (fvRules.length) {
    const tiers = fvRules.map((r) => btf('{n} visit: {percent}% off', { n: ord(r.visit), percent: r.percent })).join(' · ');
    lines.push(`🎁 ${fv!.message || bt('Visit rewards')} — ${tiers} ${bt('(applied automatically)')}`);
  }
  if (gr?.enabled && gr.tiers.length > 0) {
    const tiers = gr.tiers.map((t) => btf('{size}+ people: {percent}% off', { size: t.minSize, percent: t.percent })).join(' · ');
    lines.push(`👯 ${gr.message || bt('Bring your friends and save!')} — ${tiers}`);
  }
  if (lines.length === 0) return null;
  return (
    <div style={{ background: '#fdf7ee', border: '1px solid #f0e2cc', borderRadius: 12, padding: '10px 14px', margin: '10px 0 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {lines.map((l, i) => (
        <div key={i} style={{ fontSize: 12.5, color: 'var(--c7c5c22)', fontWeight: 600, lineHeight: 1.5 }}>{l}</div>
      ))}
    </div>
  );
}

function DealsBanner({ wd, dd, categories }: { wd?: WeekdayDiscounts; dd?: DateDiscounts; categories: { id: string; name: string }[] }) {
  const wdOn = !!(wd?.enabled && wd.rules?.length);
  const ddOn = !!(dd?.enabled && dd.rules?.length);
  if (!wdOn && !ddOn) return null;
  const catName = (id: string | null) => (id ? (categories.find((c) => c.id === id)?.name ?? bt('select services')) : bt('everything'));
  const wdSorted = wdOn ? [...wd!.rules].sort((a, b) => a.day - b.day || b.percent - a.percent) : [];
  const ddSorted = ddOn ? [...dd!.rules].filter((r) => r.startDate).sort((a, b) => a.startDate.localeCompare(b.startDate) || b.percent - a.percent) : [];
  const fmtOne = (s: string) => { try { return new Date(s + 'T00:00:00').toLocaleDateString(bookLocale(), { month: 'short', day: 'numeric' }); } catch { return s; } };
  const fmtRange = (r: DateRule) => (r.endDate && r.endDate !== r.startDate ? `${fmtOne(r.startDate)}–${fmtOne(r.endDate)}` : fmtOne(r.startDate));
  const chip: React.CSSProperties = { background: '#fff', border: '1px solid var(--c6ee7b7)', borderRadius: 999, padding: '4px 12px', fontSize: 12.5, color: '#065f46', fontWeight: 700 };
  return (
    <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 12, background: 'linear-gradient(90deg,#ecfdf5,var(--cd1fae5))', border: '1px solid var(--c6ee7b7)' }}>
      <div style={{ fontWeight: 800, color: '#065f46', marginBottom: 8, fontSize: 14.5 }}>💸 {(wdOn && wd!.message) || bt('Save on select days!')}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {wdSorted.map((r, i) => <span key={`w${i}`} style={chip}>{btf('{day}: −{percent}% off {what}', { day: bt(WEEKDAY_NAMES[r.day]), percent: r.percent, what: catName(r.categoryId) })}</span>)}
        {ddSorted.map((r, i) => <span key={`d${i}`} style={chip}>{r.label ? `${r.label} · ` : ''}{btf('{when}: −{percent}% off {what}', { when: fmtRange(r), percent: r.percent, what: catName(r.categoryId) })}</span>)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell + helpers + styles
// ---------------------------------------------------------------------------
const FONT = "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
// A characterful display face for headings only — this is the single biggest
// "this isn't the same template as the salon down the street" signal. Body text
// stays on Plus Jakarta Sans for legibility on cheap phones.
const DISPLAY = "'Nunito', system-ui, -apple-system, 'Segoe UI', sans-serif";

/**
 * The look. Everything here is GPU-cheap on purpose: only `opacity` and
 * `transform` animate, shadows are static, no filters on scrolling elements —
 * so the page still feels instant on the $150 Android phones half of these
 * customers are holding.
 */
const BOOK_CSS = `
/* opacity only — a transform on this element would make it the containing block
   for position:fixed children on iOS, and the floating action bar would drop to
   the bottom of the card instead of sticking to the bottom of the screen. */
@keyframes lumioIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes lumioPop { from { opacity: 0; transform: translateY(6px) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes lumioShine { 0% { transform: translateX(-120%); } 60%, 100% { transform: translateX(220%); } }
@keyframes lumioPulse { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
@keyframes lumioSkeleton { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
@keyframes lumioTick { 0% { transform: scale(.2); opacity: 0; } 55% { transform: scale(1.35); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
@keyframes lumioRing { 0% { transform: scale(.9); } 45% { transform: scale(1.12); } 100% { transform: scale(1); } }
@keyframes lumioBump { 0% { transform: translateY(0); } 40% { transform: translateY(-3px) scale(1.02); } 100% { transform: translateY(0); } }

.lumio-book, .lumio-book button, .lumio-book input, .lumio-book select, .lumio-book textarea, .lumio-book a,
.lumio-shell, .lumio-shell button, .lumio-shell input {
  font-family: ${FONT};
  -webkit-font-smoothing: antialiased;
}
.lumio-book h1, .lumio-book h2 { font-family: ${DISPLAY}; letter-spacing: -0.2px; }
.lumio-book { animation: lumioIn .45s cubic-bezier(.2,.75,.25,1) both; }
.lumio-step { animation: lumioPop .32s cubic-bezier(.2,.75,.25,1) both; }

.lumio-book button, .lumio-book a { transition: transform .14s cubic-bezier(.2,.75,.25,1), box-shadow .2s ease, border-color .16s ease, background .16s ease, color .16s ease; }
.lumio-book button:active:not(:disabled) { transform: translateY(1px) scale(.99); }

/* service / tech / payment rows */
.lumio-row { position: relative; }
.lumio-row:hover:not(:disabled) { transform: translateY(-2px); border-color: var(--accent, #6366f1) !important; box-shadow: 0 10px 24px -12px rgba(15,42,82,.35); }
.lumio-row:focus-visible { outline: 2px solid var(--accent, #6366f1); outline-offset: 2px; }

/* time pills */
.lumio-slot:hover:not(:disabled) { transform: translateY(-2px); border-color: var(--accent, #6366f1) !important; box-shadow: 0 8px 18px -10px rgba(15,42,82,.4); }

/* the main call to action: a soft light sweeps across it, once, when it turns on */
.lumio-cta { position: relative; overflow: hidden; }
.lumio-cta:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 14px 30px -12px var(--accent-glow, rgba(99,102,241,.75)); }
.lumio-bar .lumio-cta::after { animation-duration: 4.5s; }
.lumio-cta:not(:disabled)::after {
  content: ''; position: absolute; top: 0; bottom: 0; width: 38%;
  background: linear-gradient(100deg, transparent, rgba(255,255,255,.42), transparent);
  animation: lumioShine 2.6s ease-in-out .4s infinite;
}
.lumio-tabs::-webkit-scrollbar { height: 0; }
.lumio-scroll::-webkit-scrollbar { width: 6px; }
.lumio-scroll::-webkit-scrollbar-thumb { background: #dfe5ef; border-radius: 99px; }

.lumio-skel {
  border-radius: 14px;
  background: linear-gradient(90deg, #eef1f6 25%, #f7f9fc 37%, #eef1f6 63%);
  background-size: 200% 100%;
  animation: lumioSkeleton 1.2s ease-in-out infinite;
}
.lumio-dot { animation: lumioPulse 1.6s ease-in-out infinite; }

@media (prefers-reduced-motion: reduce) {
  .lumio-book, .lumio-step, .lumio-cta::after, .lumio-skel, .lumio-dot { animation: none !important; }
  .lumio-book button:hover, .lumio-row:hover, .lumio-slot:hover, .lumio-cta:hover { transform: none !important; }
}

/* the tick that springs in when a service is added to the pass */
.lumio-tick { animation: lumioTick .34s cubic-bezier(.2,1.3,.4,1) both; }
.lumio-added { animation: lumioRing .34s cubic-bezier(.2,1,.3,1); }
.lumio-bump { animation: lumioBump .4s cubic-bezier(.2,.8,.3,1); }
/* boarding-pass perforation: two half-circle notches biting into the ticket edge,
   plus a dashed tear line, in the page background colour so it reads as a real stub */
.lumio-perf { position: relative; height: 20px; }
.lumio-perf::before, .lumio-perf::after { content: ''; position: absolute; top: -10px; width: 20px; height: 20px; border-radius: 50%; background: var(--stage, #eef2f8); box-shadow: inset 0 -1px 2px rgba(15,42,82,.06); }
.lumio-perf::before { left: -10px; } .lumio-perf::after { right: -10px; }
.lumio-tear { position: absolute; top: 9px; left: 12px; right: 12px; border-top: 2px dashed rgba(15,42,82,.14); }
@media (prefers-reduced-motion: reduce) { .lumio-tick, .lumio-added, .lumio-bump { animation: none !important; } }
`;

type HostView = { top: number; height: number };
type HostSub = (v: HostView) => void;

/**
 * The host page tells us, on every scroll frame, where the frame sits on the
 * visitor's screen. We deliberately DO NOT put that in React state: it arrives ~60
 * times a second, and re-rendering the whole booking form at 60fps is exactly what
 * made the pinned bar stutter. Subscribers get the raw value and write to the DOM
 * themselves — one style write per frame, no reconciliation, no jank.
 */
function useHostViewport(embedded: boolean) {
  const subs = useRef<Set<HostSub>>(new Set());
  const last = useRef<HostView | null>(null);

  useEffect(() => {
    if (!embedded) return;
    let frame = 0;
    let pending: HostView | null = null;
    const flush = () => {
      frame = 0;
      const v = pending;
      pending = null;
      if (!v) return;
      last.current = v;
      subs.current.forEach((fn) => fn(v));
    };
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; top?: number; height?: number } | null;
      if (!d || d.type !== 'lumio-host-viewport' || typeof d.top !== 'number') return;
      pending = { top: d.top, height: d.height || 0 };
      if (!frame) frame = window.requestAnimationFrame(flush);   // one write per frame
    };
    window.addEventListener('message', onMsg);
    return () => { window.removeEventListener('message', onMsg); if (frame) cancelAnimationFrame(frame); };
  }, [embedded]);

  const subscribe = useCallback((fn: HostSub) => {
    if (!embedded) return () => {};
    subs.current.add(fn);
    if (last.current) fn(last.current);
    const set = subs.current;
    return () => { set.delete(fn); };
  }, [embedded]);

  return { subscribe, enabled: embedded, last };
}

/**
 * `position: sticky` cannot work inside a content-sized iframe (nothing scrolls in
 * there). So we pin honestly: translate the element as the host page scrolls, never
 * past the block it belongs to. Written straight to the node — no state, no re-render.
 *
 *   mode 'top'    — tabs, summary card: follow the top of the screen.
 *   mode 'bottom' — the action bar: float just above the fold.
 */
function usePin(
  subscribe: (fn: HostSub) => () => void,
  enabled: boolean,
  mode: 'top' | 'bottom',
  gap: number,
) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const off = useRef(0);

  useEffect(() => {
    if (!enabled) {
      const el = elRef.current;
      if (el) { el.style.transform = ''; off.current = 0; }
      return;
    }
    const el0 = elRef.current;
    if (el0) {
      // Promote once, and let a very short transition absorb any frame the host
      // could not deliver — the difference between "stepping" and "gliding".
      el0.style.willChange = 'transform';
      el0.style.backfaceVisibility = 'hidden';
      el0.style.transition = 'transform .1s cubic-bezier(.22,.61,.36,1)';
    }
    return subscribe((v) => {
      const el = elRef.current;
      if (!el) return;
      const h = el.offsetHeight;
      const base = el.getBoundingClientRect().top - off.current;   // its real place in the form
      let want: number;
      if (mode === 'top') {
        const box = boxRef.current;
        const room = box ? box.getBoundingClientRect().bottom - h - base : 0;
        want = Math.min(Math.max(0, -v.top + gap - base), Math.max(0, room));
      } else {
        want = v.height ? Math.min(0, (-v.top + v.height - h - gap) - base) : 0;
      }
      if (Math.abs(want - off.current) < 0.25) return;
      off.current = want;
      el.style.transform = `translate3d(0, ${want}px, 0)`;
    });
  }, [subscribe, enabled, mode, gap]);

  return { elRef, boxRef };
}

/** A progress rail the reference doesn't have: the visitor always knows how many
 *  steps are left, which is the single cheapest way to lift completion rate. */
function Progress({ step, accent, allowStaff }: { step: Step; accent: string; allowStaff: boolean }) {
  const steps = allowStaff
    ? [bt("Services"), bt("Nail tech"), bt("Time"), bt("Confirm")]
    : [bt("Services"), bt("Time"), bt("Confirm")];
  const idx = allowStaff ? step - 1 : (step === 1 ? 0 : step - 2);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 4px 2px' }}>
      {steps.map((label, i) => {
        const done = i < idx, on = i === idx;
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: i === steps.length - 1 ? '0 0 auto' : 1, minWidth: 0 }}>
            <span style={{
              display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0,
              fontSize: 12.5, fontWeight: 700, color: on ? accent : done ? '#16a34a' : '#a9b4c6',
            }}>
              <span style={{
                width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800,
                background: done ? '#16a34a' : on ? accent : '#e6eaf2', color: done || on ? '#fff' : 'var(--c94a3b8)',
                boxShadow: on ? `0 0 0 4px ${tint(accent, 0.15)}` : 'none',
              }} className={on ? 'lumio-dot' : undefined}>{done ? '✓' : i + 1}</span>
              <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
            </span>
            {i < steps.length - 1 && (
              <span style={{ flex: 1, height: 2, borderRadius: 2, background: done ? '#16a34a' : '#e6eaf2', minWidth: 12 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Skeleton instead of the word "Loading…": the page feels ~40% faster because
 *  the shape of the answer arrives before the answer does. */
function BookingSkeleton() {
  return (
    <div style={{ width: '100%', maxWidth: 1120, margin: '0 auto' }}>
      <div className="lumio-skel" style={{ height: 66, borderRadius: '16px 16px 0 0' }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 18, marginTop: 2 }}>
        <div style={{ background: '#fff', borderRadius: '0 0 16px 16px', padding: 22, display: 'grid', gap: 12 }}>
          <div className="lumio-skel" style={{ height: 86 }} />
          <div className="lumio-skel" style={{ height: 40, width: '60%' }} />
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="lumio-skel" style={{ height: 66 }} />)}
        </div>
        <div className="lumio-skel" style={{ height: 420, borderRadius: 16, marginTop: 16 }} />
      </div>
    </div>
  );
}
function Shell({ children, accent, fullscreen }: { children: React.ReactNode; accent: string; fullscreen: boolean }) {
  const [embedded, setEmbedded] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let emb = false;
    try { emb = window.self !== window.top; } catch { emb = true; }
    setEmbedded(emb);
    // Full-screen: the frame is the screen now. Stop reporting a height (the host
    // ignores it anyway) and let the document scroll like any normal page.
    if (!emb || fullscreen) return;
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.margin = '0';
    // NO viewport lock here, on purpose.
    //
    // We tried it: `height: 100vh` + an inner scroller made the widget a sealed box —
    // the iframe never grew, the host page could not be reached from inside it, and
    // scrolling felt trapped. The form must stay as tall as its content so the SITE
    // scrolls it, exactly like any other block on the page. Everything that needs to
    // stay on screen (tabs, action bar, summary) is pinned with a transform instead,
    // using the viewport position the host reports to us.
    const post = () => {
      const el = rootRef.current;
      if (!el) return;
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h < 120) return;
      try { window.parent.postMessage({ type: 'lumio-embed-height', height: h }, '*'); } catch { /* ignore */ }
    };
    post();
    // A single post is not enough: this is an SPA, every step changes the height.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(post) : null;
    if (ro && rootRef.current) ro.observe(rootRef.current);
    const iv = window.setInterval(post, 400);
    window.addEventListener('resize', post);
    return () => { if (ro) ro.disconnect(); window.clearInterval(iv); window.removeEventListener('resize', post); };
  }, [fullscreen]);

  return (
    <>
      <style>{BOOK_CSS}</style>
      <div ref={rootRef} className="lumio-shell" style={{
        minHeight: embedded && !fullscreen ? 0 : '100vh',
        // The same stage in both places: a page that glows a little around the edges,
        // in the salon's own colour. The embed used to be transparent and flat, which
        // is why it felt like a widget bolted onto the site instead of the booking page.
        // A soft gradient-mesh in the salon's own colour — three overlapping blobs
        // instead of one flat wash, so the page has depth the flat-white competitors
        // don't. Still just CSS gradients: zero paint cost while scrolling.
        background: `radial-gradient(1200px 560px at 8% -10%, ${tint(accent, 0.20)}, transparent 58%),
             radial-gradient(1000px 520px at 108% 4%, ${tint(accent, 0.13)}, transparent 55%),
             radial-gradient(820px 620px at 78% 118%, ${tint(shade(accent, 0.32), 0.12)}, transparent 60%),
             linear-gradient(180deg, #f8fafe 0%, #eef2f8 100%)`,
        padding: fullscreen ? 0 : embedded ? 12 : 16,
        fontFamily: FONT,
        ['--accent' as string]: accent,
        ['--accent-glow' as string]: tint(accent, 0.55),
        ['--accent-dark' as string]: shade(accent, 0.28),
        ['--stage' as string]: '#eef2f8',
      } as React.CSSProperties}>
        {children}
      </div>
    </>
  );
}
function useEmbedded(): boolean {
  const [emb, setEmb] = useState(false);
  useEffect(() => {
    try {
      // `?full=1` means the host site opened us inside a FULL-SCREEN overlay, so we
      // already own a real viewport. Behave exactly like the hosted page: no
      // launcher card, no faked sticky bars — the customer sees the form on the
      // very first tap instead of having to tap a teaser card first.
      const full = new URLSearchParams(window.location.search).get('full') === '1';
      setEmb(!full && window.self !== window.top);
    } catch {
      setEmb(true);
    }
  }, []);
  return emb;
}
function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', placeItems: 'center', minHeight: 240, color: 'var(--c475569)', padding: 24 }}>{children}</div>;
}

// No hour12 flag: the locale decides. American English still reads 05:30 PM,
// Vietnamese reads 17:30 rather than the borrowed "05:30 CH".
function fmtTime(d: Date) { return d.toLocaleTimeString(bookLocale(), { hour: '2-digit', minute: '2-digit' }); }
function fmtDur(min: number) {
  if (min <= 0) return bt('0min');
  const h = Math.floor(min / 60), m = min % 60;
  return `${h ? `${btf('{h}h', { h })} ` : ''}${m ? btf('{m}min', { m }) : ''}`.trim();
}
function isValidPhone(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  const digits = s.replace(/\D/g, '');
  return /^\+?[0-9\s().-]+$/.test(s) && digits.length >= 8 && digits.length <= 15;
}
function isValidEmail(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function isClosedDay(date: Date, rules: BookingRules): boolean {
  if (rules.daysOff.includes(ymd(date))) return true;
  const h = rules.businessHours[date.getDay()];
  return !h || h.closed;
}
function generateSlots(date: Date, durationMin: number, rules: BookingRules, tz?: string | null): Slot[] {
  const out: Slot[] = [];
  if (isClosedDay(date, rules)) return out;
  const h = rules.businessHours[date.getDay()];
  // Split shifts: iterate each open window (falls back to a single open/close).
  const windows = h.intervals && h.intervals.length ? h.intervals : [{ open: h.openMinutes, close: h.closeMinutes }];
  const earliest = Date.now() + rules.minLeadHours * 3_600_000;
  const step = Math.max(5, rules.slotStepMinutes);
  for (const w of windows) {
    for (let mins = w.open; mins + durationMin <= w.close; mins += step) {
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(mins / 60), mins % 60);
      // "Too soon to book" must be judged at the SALON's clock, not the viewer's.
      const instant = tz ? Date.parse(wallTimeToISO(start, tz)) : start.getTime();
      if (instant < earliest) continue;
      out.push({ start, end: new Date(start.getTime() + durationMin * 60_000) });
    }
  }
  return out;
}
function overlaps(slot: Slot, intervals: { start: string; end: string }[]): boolean {
  const s = slot.start.getTime(), e = slot.end.getTime();
  return intervals.some((iv) => Date.parse(iv.start) < e && s < Date.parse(iv.end));
}
/**
 * Same check against SERVER intervals (true UTC instants). The slot grid is
 * built with the viewer's clock but its digits mean SALON wall time, so the
 * slot must be re-anchored to the salon's timezone before comparing — exactly
 * how submit already stores it. Without this, a viewer in another timezone
 * sees the technician's shift shifted by the timezone gap.
 */
function overlapsTz(slot: Slot, intervals: { start: string; end: string }[], tz?: string | null): boolean {
  if (!tz) return overlaps(slot, intervals);
  const s = Date.parse(wallTimeToISO(slot.start, tz));
  const e = s + (slot.end.getTime() - slot.start.getTime());
  return intervals.some((iv) => Date.parse(iv.start) < e && s < Date.parse(iv.end));
}

const rowCard: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 15px', borderRadius: 16,
  border: '1px solid #e9edf4', background: '#fff', cursor: 'pointer', boxShadow: '0 2px 6px -3px rgba(15,42,82,0.10)',
};
const rowTitle: React.CSSProperties = { display: 'block', fontSize: 14.5, fontWeight: 800, color: INK, letterSpacing: 0.2, lineHeight: 1.35 };
const rowMeta: React.CSSProperties = { display: 'block', fontSize: 12.5, color: '#7d8ba4', marginTop: 5 };
// Service description: quiet, two lines max, then an ellipsis. It must read as
// supporting text — lighter than the name, calmer than the price.
const rowDesc: React.CSSProperties = {
  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
  overflow: 'hidden', fontSize: 12.5, color: '#8b99b3', lineHeight: 1.45, marginTop: 3,
};
// Opened. `pre-line` honours the line breaks the shop typed: a package written
// as one step per line was being flattened into a paragraph, which is how a
// nine-step treatment came to read as a run-on sentence.
const rowDescOpen: React.CSSProperties = {
  display: 'block', fontSize: 12.5, color: '#8b99b3', lineHeight: 1.45,
  marginTop: 3, whiteSpace: 'pre-line',
};
// Quiet on purpose. It sits between the description and the price, and it is
// not competing with either — it is a door, not a call to action.
const moreBtn: React.CSSProperties = {
  display: 'inline-block', marginTop: 4, padding: 0, border: 'none', background: 'none',
  font: 'inherit', fontSize: 12.5, fontWeight: 700, color: 'var(--accent, #6366f1)',
  cursor: 'pointer', textAlign: 'left',
};
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 10, border: '1px solid #dbe2ee', background: '#fff', color: INK, fontSize: 14 };
const ctaBtn: React.CSSProperties = {
  width: '100%', padding: '15px 18px', borderRadius: 999, border: 'none', color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer',
  background: 'linear-gradient(120deg, var(--accent, #6366f1), var(--accent-dark, #4f46e5))',
  boxShadow: '0 16px 32px -16px var(--accent-glow, rgba(99,102,241,.8))',
};
const primaryBtn: React.CSSProperties = { padding: '12px 22px', borderRadius: 999, border: 'none', background: 'var(--accent, #6366f1)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer' };
const arrowBtn: React.CSSProperties = { width: 34, height: 34, borderRadius: '50%', border: '1px solid #e6eaf2', background: '#fff', color: INK, fontSize: 18, cursor: 'pointer', flexShrink: 0 };
