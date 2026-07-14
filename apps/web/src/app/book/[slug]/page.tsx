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

interface DayHours { closed: boolean; openMinutes: number; closeMinutes: number }
interface BookingRules {
  slotStepMinutes: number; minLeadHours: number; maxAdvanceDays: number;
  allowCustomerChooseStaff: boolean; currency: string; currencySymbol: string;
  symbolPosition: 'before' | 'after'; priceDecimals: number; defaultPaymentMethod: 'online' | 'onsite';
  onlinePaymentEnabled: boolean; payLaterEnabled: boolean;
  businessHours: DayHours[]; daysOff: string[];
}
const OPEN: DayHours = { closed: false, openMinutes: 540, closeMinutes: 1080 };
const DEFAULT_RULES: BookingRules = {
  slotStepMinutes: 30, minLeadHours: 1, maxAdvanceDays: 60,
  allowCustomerChooseStaff: true, currency: 'USD', currencySymbol: '', symbolPosition: 'before',
  priceDecimals: 2, defaultPaymentMethod: 'onsite', onlinePaymentEnabled: true, payLaterEnabled: true,
  businessHours: [{ closed: true, openMinutes: 540, closeMinutes: 1080 }, OPEN, OPEN, OPEN, OPEN, OPEN, OPEN],
  daysOff: [],
};
const SYMBOLS: Record<string, string> = { USD: '$', EUR: '€', GBP: '£', CAD: '$', AUD: '$', VND: '₫', JPY: '¥', SGD: '$' };
function fmtMoney(cents: number, r: BookingRules): string {
  const s = r.currencySymbol || SYMBOLS[r.currency] || r.currency + ' ';
  const n = (cents / 100).toFixed(r.priceDecimals ?? 2);
  return r.symbolPosition === 'after' ? `${n}${s}` : `${s}${n}`;
}

interface WdRule { day: number; categoryId: string | null; percent: number }
interface WeekdayDiscounts { enabled: boolean; message: string; rules: WdRule[] }
interface DateRule { startDate: string; endDate: string | null; categoryId: string | null; percent: number; label?: string }
interface DateDiscounts { enabled: boolean; rules: DateRule[] }
interface DepositPolicy { enabled: boolean; type: 'percent' | 'fixed'; percent: number; fixedCents: number; scope: 'all' | 'new' | 'repeat_noshow'; noShowThreshold: number }
interface Salon {
  name: string; slug: string; businessType?: string; timezone: string; address?: string | null; contactPhone?: string | null;
  branding?: { accentColor: string; logoUrl: string }; booking?: BookingRules;
  weekdayDiscounts?: WeekdayDiscounts; dateDiscounts?: DateDiscounts; deposit?: DepositPolicy;
}
interface Addon { id: string; name: string; durationMinutes: number; priceCents: number }
interface Service { id: string; name: string; description?: string | null; durationMinutes: number; priceCents: number; discountPercent?: number; categoryId?: string | null; isFeatured?: boolean; priceFrom?: boolean; addons: Addon[] }
interface Category { id: string; name: string; icon?: string | null }
interface Staff { id: string; firstName: string; lastName: string | null; avatarUrl: string | null }
interface Availability { eligibleStaffIds: string[]; staffBusy: Record<string, { start: string; end: string }[]> }
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
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const parts = dtf.formatToParts(new Date(naiveUTC));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let hh = g('hour'); if (hh === 24) hh = 0;
  const asTz = Date.UTC(g('year'), g('month') - 1, g('day'), hh, g('minute'), g('second'));
  const offset = asTz - naiveUTC;
  return new Date(naiveUTC - offset).toISOString();
}

export default function PublicBookingPage() {
  const params = useParams();
  const slug = String(params?.slug ?? '');
  const base = `${API_URL}/public/salons/${encodeURIComponent(slug)}`;
  const isMobile = useIsMobile();
  const embedded = useEmbedded();

  const [salon, setSalon] = useState<Salon | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  const rules = salon?.booking ?? DEFAULT_RULES;
  const accent = salon?.branding?.accentColor || '#6366f1';
  const service = services.find((s) => s.id === serviceId) ?? null;
  const employee = staff.find((s) => s.id === staffId) ?? null;
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

  // Prices: each service keeps its own discount + the promo for its own category.
  const lineFor = (s: Service) => {
    const net = svcNetCents(s);
    const promo = promoPctFor(salon, selectedDate, s.categoryId ?? null);
    return { id: s.id, name: s.name, durationMinutes: s.durationMinutes, fullCents: s.priceCents, priceCents: Math.round((net * (100 - promo)) / 100) };
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
      const [sRes, servicesData, staffData, catData] = await Promise.all([
        fetch(base),
        fetch(`${base}/services`).then((r) => r.json()).catch(() => []),
        fetch(`${base}/staff`).then((r) => r.json()).catch(() => []),
        fetch(`${base}/categories`).then((r) => r.json()).catch(() => []),
      ]);
      if (!sRes.ok) { setLoadError(sRes.status === 404 ? 'This booking page was not found.' : 'Could not load the salon.'); return; }
      const salonData = await sRes.json();
      setSalon(salonData); setServices(servicesData ?? []); setStaff(staffData ?? []); setCategories(catData ?? []);
    } catch { setLoadError('Could not reach the booking service. Please try again later.'); }
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
    const ids = [serviceId, ...extraServiceIds.filter((x) => x !== serviceId)];
    Promise.all(ids.map((sid) =>
      fetch(`${base}/availability?serviceId=${encodeURIComponent(sid)}&date=${d}`).then((r) => r.json()).catch(() => null),
    )).then((results) => {
      const valid = results.filter(Boolean) as Availability[];
      if (valid.length === 0) { setAvail(null); return; }
      let eligible = valid[0].eligibleStaffIds;
      for (const r of valid.slice(1)) eligible = eligible.filter((id) => r.eligibleStaffIds.includes(id));
      const staffBusy: Record<string, { start: string; end: string }[]> = {};
      for (const r of valid) for (const [id, arr] of Object.entries(r.staffBusy)) (staffBusy[id] ||= []).push(...arr);
      setAvail({ eligibleStaffIds: eligible, staffBusy });
    }).catch(() => setAvail(null));
  }, [base, selectedDate, serviceId, extraServiceIds]);

  async function submit() {
    if (!slot) return;
    setSubmitting(true); setError(null);
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
          partySize: parseInt(form.partySize, 10) || 1,
          smsConsent,
          referralCode: (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('ref') : null) || undefined,
          paymentType,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setError((body && body.message) || `Booking failed (${res.status})`); return; }
      setResult({ paymentStatus: body?.payment?.status ?? null });
      setStep(5);
    } catch { setError('Network error. Please try again.'); }
    finally { setSubmitting(false); }
  }

  function reset() {
    setStep(1); setSelectedDate(null); setServiceId(''); setExtraServiceIds([]); setAddonIds([]); setStaffId(''); setSlot(null);
    setAvail(null); setForm({ firstName: '', lastName: '', email: '', phone: '', birthDate: '', partySize: '1' });
    setPaymentType('PAY_LATER'); setResult(null); setError(null);
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
  const leftRef = useRef<HTMLDivElement | null>(null);
  const cartPin = usePin(subscribe, pinning && !isMobile, 'top', 14);
  const barPin = usePin(subscribe, pinning && isMobile, 'bottom', 10);
  // the summary travels down the column that holds the menu, and stops at its end
  useEffect(() => { cartPin.boxRef.current = leftRef.current; }, [cartPin.boxRef, step]);

    // ---- validation -----------------------------------------------------------
  const phoneOk = isValidPhone(form.phone);
  const emailOk = !form.email.trim() || isValidEmail(form.email);
  const infoOk = form.firstName.trim().length > 0 && phoneOk && emailOk;

  if (loading) return <Shell accent="#6366f1" fullscreen={false}><BookingSkeleton /></Shell>;
  if (loadError) return <Shell accent="#6366f1" fullscreen={false}><Center>{loadError}</Center></Shell>;
  if (salon && salon.businessType === 'RESTAURANT') return <RestaurantReserve slug={slug} salon={salon} />;

  const canContinue =
    step === 1 ? pickedServiceIds.length > 0 :
    step === 2 ? true :
    step === 3 ? !!slot :
    step === 4 ? infoOk && !submitting : false;

  const ctaLabel =
    step === 4 ? (submitting ? 'Booking…' : 'Book') :
    step === 1 ? (pickedServiceIds.length > 0 ? 'Book for Me' : 'Select a service') : 'Continue';

  const goNext = () => {
    if (step === 1 && pickedServiceIds.length) setStep(rules.allowCustomerChooseStaff ? 2 : 3);
    else if (step === 2) setStep(3);
    else if (step === 3 && slot) setStep(4);
    else if (step === 4) submit();
  };
  const goBack = () => {
    if (step === 2) setStep(1);
    else if (step === 3) setStep(rules.allowCustomerChooseStaff ? 2 : 1);
    else if (step === 4) setStep(3);
  };

  const stepTitle =
    step === 1 ? 'Services' :
    step === 2 ? 'Choose your nail tech' :
    step === 3 ? 'Select time' :
    step === 4 ? 'Confirm booking' : '';

  const stepHint =
    step === 1 ? 'Tap ＋ to add a service. You can pick more than one.' :
    step === 2 ? 'Go with the person you know, or let us give you the first one free.' :
    step === 3 ? `Every time below is really free${totalDuration ? ` for ${fmtDur(totalDuration)}` : ''}${employee ? ` with ${employee.firstName}` : ''}.` :
    '';

  const barTitle =
    step === 1 ? 'BOOKING ONLINE' :
    step === 2 ? 'Select Professional' :
    step === 3 ? 'Select Time' : 'Confirm Booking';

  const summary = (
    <CartPanel
      fill={!isMobile && !embedded}
      salon={salon} lines={allLines} fmt={fmt} totalCents={totalCents} fullCents={fullCents}
      anyDiscount={anyDiscount} totalDuration={totalDuration} employee={employee} slot={slot} selectedDate={selectedDate}
      onRemove={removeLine} canContinue={canContinue} ctaLabel={ctaLabel} onContinue={goNext} step={step} accent={accent}
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
        {/* Top bar — salon name (step 1) or the step name with a back arrow */}
        {/* Header stays put while the menu scrolls under it. */}
        <div style={{ position: asPage ? 'sticky' : 'static', top: 0, zIndex: 30, flexShrink: 0,
          background: `linear-gradient(120deg, ${accent} 0%, ${shade(accent, 0.18)} 55%, ${shade(accent, 0.42)} 100%)`,
          color: '#fff',
          borderRadius: fullscreen ? 0 : '18px 18px 0 0', padding: isMobile ? '12px 14px' : '16px 20px',
          display: 'flex', alignItems: 'center', gap: 13, marginBottom: 0,
          boxShadow: `0 14px 34px -18px ${tint(accent, 0.95)}, inset 0 1px 0 rgba(255,255,255,0.22)` }}>
          {step > 1 && step < 5 && (
            <button onClick={goBack} aria-label="Back" style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 16, cursor: 'pointer', flexShrink: 0 }}>←</button>
          )}
          {step === 1 && <Logo url={salon?.branding?.logoUrl} size={38} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: isMobile ? 16 : 19, letterSpacing: -0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {step === 1 ? (salon?.name ?? barTitle) : barTitle}
            </div>
            {step === 1 && (
              <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 0 3px rgba(74,222,128,.25)' }} className="lumio-dot" />
                Book online · confirmed in seconds
              </div>
            )}
          </div>
          {step === 3 && rules.allowCustomerChooseStaff && (
            <button onClick={() => setStep(2)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px 6px 6px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
              <Avatar name={employee ? `${employee.firstName} ${employee.lastName ?? ''}` : 'Any'} url={employee?.avatarUrl ?? null} size={26} accent={accent} />
              {employee ? employee.firstName : 'Any nail tech'} ▾
            </button>
          )}
          {step === 1 && !embedded && !isMobile && <InstallAppButton label="Get the app" />}
          {fullscreen && (
            <button onClick={closeFull} aria-label="Close" style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 17, cursor: 'pointer', flexShrink: 0 }}>✕</button>
          )}
        </div>

        {step === 5 ? (
          <div style={{ background: '#fff', borderRadius: embedded ? 12 : '0 0 14px 14px', padding: 32, marginTop: embedded ? 0 : 0 }}>
            <div style={{ textAlign: 'center', maxWidth: 380, margin: '0 auto' }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#dcfce7', color: '#16a34a', fontSize: 34, display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}>✓</div>
              <h2 style={{ color: '#16a34a', margin: '4px 0' }}>Booking received</h2>
              <p style={{ color: '#475569', lineHeight: 1.6 }}>
                Thanks {form.firstName}! Your booking for <strong>{service?.name}</strong>
                {slot && <> on <strong>{slot.start.toLocaleDateString('en-US')} at {fmtTime(slot.start)}</strong></>} is received.
              </p>
              <p style={{ color: '#475569' }}>Payment: <strong>{result?.paymentStatus === 'PAID' ? 'Paid online ✓' : 'Pay at the salon'}</strong></p>
              <button onClick={reset} style={{ ...primaryBtn, marginTop: 8 }}>Book another</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 360px', gap: isMobile ? 0 : 18, alignItems: 'start' }}>
            {/* -------- left: the actual picking (this is the scroller in an embed) -------- */}
            <div ref={leftRef} style={{
              background: '#fff',
              borderRadius: '0 0 18px 18px',
              padding: isMobile ? '14px 14px 18px' : '18px 24px 24px',
              minWidth: 0, boxShadow: '0 24px 60px -40px rgba(15,42,82,.45)',
            }}>
              <Progress step={step} accent={accent} allowStaff={rules.allowCustomerChooseStaff} />
              <h1 key={step} className="lumio-step" style={{ fontSize: isMobile ? 22 : 27, fontWeight: 800, color: INK, margin: '10px 0 4px' }}>{stepTitle}</h1>
              {stepHint && <p style={{ margin: '0 0 14px', fontSize: 13.5, color: '#8fa0bb', lineHeight: 1.5 }}>{stepHint}</p>}

              {step === 1 && (
                <>
                  <DealsBanner wd={salon?.weekdayDiscounts} dd={salon?.dateDiscounts} categories={categories} />
                  {/* A day picker used to sit here. It was removed on purpose: date and time
                      belong together (nobody thinks "the 15th" — they think "tomorrow at 2"),
                      and step 3 already asks for both. Two pickers for one answer made people
                      wonder what they had missed. What the visitor actually needs at this
                      point is a single fact — "is there room soon?" — so we state it. */}
                  <SoonestBar rules={rules} services={services} accent={accent} />
                  <ServicePicker
                    services={services} categories={categories} selectedIds={pickedServiceIds}
                    onToggle={toggleService} fmt={fmt} accent={accent}
                    subscribe={subscribe} pinning={pinning} stickyTop={fullscreen ? 58 : 64}
                  />
                  {serviceAddons.length > 0 && (
                    <div style={{ marginTop: 22 }}>
                      <SectionLabel accent={accent}>Add-ons for {service?.name}</SectionLabel>
                      <div style={{ display: 'grid', gap: 10 }}>
                        {serviceAddons.map((a) => {
                          const on = addonIds.includes(a.id);
                          return (
                            <button key={a.id} type="button" className="lumio-row"
                              onClick={() => { setAddonIds((p) => p.includes(a.id) ? p.filter((x) => x !== a.id) : [...p, a.id]); setSlot(null); }}
                              style={{ ...rowCard, borderColor: on ? accent : '#e6eaf2', background: on ? '#fffaf0' : '#fff' }}>
                              <span style={{ flex: 1, textAlign: 'left' }}>
                                <span style={rowTitle}>{a.name}</span>
                                <span style={rowMeta}>⏳ {a.durationMinutes} min <span style={{ color: '#cbd5e1' }}>|</span> <b style={{ color: accent }}>+{fmt(a.priceCents)}</b></span>
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
                  onPick={(id) => { setStaffId(id); setSlot(null); setStep(3); }}
                />
              )}

              {step === 3 && (
                <TimePicker
                  rules={rules} salon={salon} selectedDate={selectedDate} slot={slot} avail={avail}
                  staffId={staffId} durationMinutes={totalDuration} accent={accent}
                  onPickDate={(d) => { setSelectedDate(d); setSlot(null); }}
                  onPickSlot={setSlot}
                  waitlist={<WaitlistCta base={base} preferredDate={selectedDate} serviceId={serviceId || undefined} fmtAccent={accent} />}
                />
              )}

              {step === 4 && slot && (
                <ConfirmStep
                  salon={salon} slot={slot} employee={employee} lines={allLines} fmt={fmt} totalCents={totalCents}
                  depositCents={depositCents} rules={rules} paymentType={paymentType} setPaymentType={setPaymentType}
                  form={form} setForm={setForm} smsConsent={smsConsent} setSmsConsent={setSmsConsent}
                  accent={accent} error={error} infoOk={infoOk} isMobile={isMobile}
                />
              )}
            </div>

            {/* -------- right: the cart, always in view -------- */}
            {!isMobile && (
              embedded ? (
                <div ref={cartPin.elRef} style={{ marginTop: 14, willChange: 'transform', display: 'flex', maxHeight: '86vh' }}>
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

        {/* Mobile: the action bar floats above everything and is never hidden. */}
        {isMobile && step < 5 && (
          <MobileBar
            embedded={!asPage} count={cartLines.length} totalCents={totalCents} fmt={fmt}
            durationMinutes={totalDuration} canContinue={canContinue} label={ctaLabel} onContinue={goNext} accent={accent}
            pinRef={barPin.elRef}
          />
        )}

        {asPage && (
          <a href="https://lumioagency.com/" target="_blank" rel="noopener noreferrer"
            style={{ display: 'block', textAlign: 'center', padding: isMobile ? '14px 0 calc(104px + env(safe-area-inset-bottom, 0px))' : '16px 0 8px', fontSize: 11.5, color: '#94a3b8', textDecoration: 'none' }}>
            Powered by <span style={{ color: accent, fontWeight: 700 }}>Lumio Booking</span>
          </a>
        )}
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Right column: the cart. Shop card on top, one row per pick, total, CTA.
// ---------------------------------------------------------------------------
type Line = { id: string; name: string; durationMinutes: number; priceCents: number; fullCents: number; addon?: boolean };

function CartPanel({ salon, lines, fmt, totalCents, fullCents, anyDiscount, totalDuration, employee, slot, selectedDate, onRemove, canContinue, ctaLabel, onContinue, step, accent, fill }: {
  salon: Salon | null; lines: Line[]; fmt: (c: number) => string; totalCents: number; fullCents: number; anyDiscount: boolean;
  totalDuration: number; employee: Staff | null; slot: Slot | null; selectedDate: Date | null;
  onRemove: (id: string) => void; canContinue: boolean; ctaLabel: string; onContinue: () => void; step: Step; accent: string; fill?: boolean;
}) {
  return (
    <aside style={{ background: '#fff', borderRadius: 18, overflow: 'hidden',
      boxShadow: `0 30px 60px -34px rgba(15,42,82,.45), 0 0 0 1px ${tint(accent, 0.10)}`,
      height: fill ? '100%' : 'auto', maxHeight: '100%', width: '100%',
      display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: `linear-gradient(120deg, ${accent} 0%, ${shade(accent, 0.18)} 55%, ${shade(accent, 0.42)} 100%)`, color: '#fff', padding: '15px 16px', display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22)' }}>
        <Logo url={salon?.branding?.logoUrl} size={44} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15.5 }}>{salon?.name}</div>
          {salon?.address && <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 3, lineHeight: 1.45 }}>{salon.address}</div>}
          {salon?.contactPhone && <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 3 }}>📞 {salon.contactPhone}</div>}
        </div>
      </div>

      {/* The list takes whatever room is left, so the panel fills the page instead of
          ending in a big white void — and the total + button stay pinned at the bottom. */}
      <div className="lumio-scroll" style={{ padding: '6px 16px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {lines.length === 0 ? (
          <EmptyCart accent={accent} salon={salon} />
        ) : lines.map((l) => (
          <div key={l.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 0', borderBottom: '1px solid #eef1f6' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: INK, lineHeight: 1.35 }}>{l.name}</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>
                {l.durationMinutes} min{employee && step >= 3 ? <> · <b style={{ color: accent }}>{employee.firstName}</b></> : null}
              </div>
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: accent, whiteSpace: 'nowrap' }}>{fmt(l.priceCents)}</div>
            <button onClick={() => onRemove(l.id)} aria-label="Remove" style={{ width: 22, height: 22, borderRadius: '50%', border: 'none', background: '#e8edf6', color: INK, fontSize: 12, cursor: 'pointer', flexShrink: 0, lineHeight: 1 }}>✕</button>
          </div>
        ))}
      </div>

      <div style={{ padding: '12px 16px 16px', borderTop: '1px solid #eef1f6', flexShrink: 0, background: '#fff' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontWeight: 800, color: INK, fontSize: 15 }}>Total</span>
          <span>
            {anyDiscount && <span style={{ textDecoration: 'line-through', color: '#b6bfcd', fontSize: 13, marginRight: 8 }}>{fmt(fullCents)}</span>}
            <span style={{ fontWeight: 800, color: INK, fontSize: 17 }}>{fmt(totalCents)}</span>
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12.5, color: '#94a3b8' }}>
          <span>🕐 Duration</span><span>{fmtDur(totalDuration)}</span>
        </div>
        {anyDiscount && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, padding: '7px 10px', borderRadius: 10, background: '#ecfdf5', color: '#065f46', fontSize: 12.5, fontWeight: 800 }}>
            <span>🎉 You save</span><span>{fmt(fullCents - totalCents)}</span>
          </div>
        )}
        {slot && selectedDate && (
          <div style={{ marginTop: 12, background: tint(accent, 0.08), borderRadius: 10, padding: '10px 12px', fontSize: 13, color: INK, lineHeight: 1.6 }}>
            <div>📅 <b>{selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</b></div>
            <div>🕐 {fmtTime(slot.start)} – {fmtTime(slot.end)} ({fmtDur(totalDuration)})</div>
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
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 0; i <= Math.min(rules.maxAdvanceDays, 21); i++) {
      const d = new Date(today.getTime() + i * 86400000);
      const first = generateSlots(d, shortest, rules)[0];
      if (first) return `${i === 0 ? 'today' : i === 1 ? 'tomorrow' : d.toLocaleDateString('en-US', { weekday: 'long' })} at ${fmtTime(first.start)}`;
    }
    return null;
  }, [rules, services]);

  const from = services.length ? Math.min(...services.map((s) => svcNetCents(s))) : 0;

  return (
    <div className="lumio-book" style={{ ['--accent' as string]: accent } as React.CSSProperties}>
      <div style={{ background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: `0 26px 60px -34px rgba(15,42,82,.5), 0 0 0 1px ${tint(accent, 0.10)}` }}>
        <div style={{ background: `linear-gradient(120deg, ${accent} 0%, ${shade(accent, 0.18)} 55%, ${shade(accent, 0.42)} 100%)`, color: '#fff', padding: '16px 16px 18px', display: 'flex', gap: 12, alignItems: 'center' }}>
          <Logo url={salon?.branding?.logoUrl} size={44} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: -0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{salon?.name}</div>
            <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80' }} className="lumio-dot" />
              Book online · confirmed in seconds
            </div>
          </div>
        </div>

        <div style={{ padding: '16px 16px 18px' }}>
          {soon && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, background: '#ecfdf5', border: '1px solid #bbf7d0', color: '#166534', fontSize: 12.5, fontWeight: 800, marginBottom: 12 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e' }} className="lumio-dot" />
              Next opening {soon}
            </div>
          )}
          <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
            {[['🗓️', 'Pick your service, tech and time'], ['⚡', 'Instant confirmation by text'], ['💳', 'Pay online or at the shop']].map(([i, t]) => (
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
    ['🕐', 'Book any time', 'Open 24/7 online — even when the shop is closed.'],
    ['✅', 'Instant confirmation', 'You get a text the moment your spot is held.'],
    ['💇', 'Pick your tech', 'Choose the person you always go to, or let us match you.'],
    ['💳', 'Pay how you like', 'Online now, or at the shop when you arrive.'],
  ];
  return (
    <div style={{ padding: '16px 2px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ textAlign: 'center', padding: '10px 0 16px' }}>
        <div style={{ width: 54, height: 54, borderRadius: '50%', background: tint(accent, 0.10), color: accent, display: 'grid', placeItems: 'center', fontSize: 24, margin: '0 auto 10px' }}>🛍️</div>
        <div style={{ fontSize: 14.5, fontWeight: 800, color: INK }}>Pick a service to start</div>
        <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 4, lineHeight: 1.5 }}>
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
function MobileBar({ embedded, count, totalCents, fmt, durationMinutes, canContinue, label, onContinue, accent, pinRef }: {
  embedded: boolean; count: number; totalCents: number; fmt: (c: number) => string; durationMinutes: number;
  canContinue: boolean; label: string; onContinue: () => void; accent: string;
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
          {count === 0 ? 'No service yet' : `${count} service${count === 1 ? '' : 's'}`}{durationMinutes > 0 && <> · 🕐 {fmtDur(durationMinutes)}</>}
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
function SoonestBar({ rules, services, accent }: { rules: BookingRules; services: Service[]; accent: string }) {
  const info = useMemo(() => {
    const shortest = Math.max(15, Math.min(...(services.length ? services.map((s) => s.durationMinutes) : [30])));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 0; i <= Math.min(rules.maxAdvanceDays, 21); i++) {
      const d = new Date(today.getTime() + i * 86400000);
      const first = generateSlots(d, shortest, rules)[0];
      if (first) {
        const when = i === 0 ? 'today' : i === 1 ? 'tomorrow' : d.toLocaleDateString('en-US', { weekday: 'long' });
        const h = rules.businessHours[d.getDay()];
        const close = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(h.closeMinutes / 60), h.closeMinutes % 60);
        return { when, time: fmtTime(first.start), close: fmtTime(close), sameDay: i === 0 };
      }
    }
    return null;
  }, [rules, services]);

  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 16,
      padding: '10px 12px', borderRadius: 14,
      background: `linear-gradient(120deg, ${tint(accent, 0.10)}, rgba(255,255,255,0))`,
      border: `1px solid ${tint(accent, 0.18)}`,
    }}>
      {info ? (
        <>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999, background: '#fff', border: '1px solid #dcfce7', color: '#166534', fontSize: 12.5, fontWeight: 800, boxShadow: '0 2px 8px -5px rgba(15,42,82,.4)' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e' }} className="lumio-dot" />
            Next opening {info.when} at {info.time}
          </span>
          {info.sameDay && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999, background: '#fff', border: '1px solid #e9edf4', color: '#5b6b85', fontSize: 12.5, fontWeight: 700 }}>
              🕐 Open until {info.close}
            </span>
          )}
        </>
      ) : (
        <span style={{ fontSize: 12.5, color: '#5b6b85', fontWeight: 700 }}>Pick a service — we&apos;ll show you every free time.</span>
      )}
      <span style={{ marginLeft: 'auto', fontSize: 12, color: '#8fa0bb' }}>Choose the time after your service ✨</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 · Services: sticky category tabs + one section per category.
// Scrolling moves the tabs (scroll-spy); tapping a tab scrolls to the section.
// ---------------------------------------------------------------------------
function ServicePicker({ services, categories, selectedIds, onToggle, fmt, accent, subscribe, pinning, stickyTop }: {
  services: Service[]; categories: Category[]; selectedIds: string[];
  onToggle: (id: string) => void; fmt: (c: number) => string; accent: string;
  /** Embed only: the host page's viewport feed. The tabs follow the scroll and stay
   *  pinned with it, even though the iframe itself never scrolls. */
  subscribe: (fn: HostSub) => () => void;
  pinning: boolean;
  stickyTop: number;
}) {
  const groups = useMemo(() => {
    const named = categories
      .map((c) => ({ id: c.id, name: c.name, items: services.filter((s) => s.categoryId === c.id) }))
      .filter((g) => g.items.length > 0);
    const loose = services.filter((s) => !s.categoryId || !categories.some((c) => c.id === s.categoryId));
    return loose.length ? [...named, { id: 'other', name: 'Other services', items: loose }] : named;
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
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a service…"
          style={{ ...inputStyle, marginBottom: 14 }} />
      )}

      {shown.map((g) => (
        <div key={g.id} ref={(el) => { sectionRefs.current[g.id] = el; }} style={{ marginBottom: 22, scrollMarginTop: 130 }}>
          <SectionLabel accent={accent}>{g.name}</SectionLabel>
          <div style={{ display: 'grid', gap: 10 }}>
            {g.items.map((s) => {
              const on = selectedIds.includes(s.id);
              const disc = svcDiscount(s);
              return (
                <button key={s.id} type="button" className="lumio-row" onClick={() => onToggle(s.id)}
                  style={{ ...rowCard, borderColor: on ? accent : '#e9edf4', background: on ? tint(accent, 0.06) : '#fff',
                    boxShadow: on ? `0 10px 26px -16px ${tint(accent, 0.9)}, 0 0 0 3px ${tint(accent, 0.12)}` : rowCard.boxShadow }}>
                  <span style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                    <span style={rowTitle}>
                      {s.name}
                      {s.isFeatured && <span style={{ marginLeft: 8, background: '#dcfce7', color: '#166534', borderRadius: 999, padding: '2px 8px', fontSize: 10.5, fontWeight: 800, letterSpacing: 0.3 }}>POPULAR</span>}
                      {disc > 0 && <span style={{ marginLeft: 8, background: '#fee2e2', color: '#b91c1c', borderRadius: 999, padding: '2px 8px', fontSize: 10.5, fontWeight: 800 }}>-{disc}%</span>}
                    </span>
                    <span style={rowMeta}>
                      ⏳ {s.durationMinutes} min <span style={{ color: '#cbd5e1' }}>|</span>{' '}
                      {disc > 0 && <span style={{ textDecoration: 'line-through', color: '#b6bfcd', marginRight: 6 }}>{fmt(s.priceCents)}</span>}
                      <b style={{ color: accent }}>{s.priceFrom ? 'from ' : ''}{fmt(svcNetCents(s))}</b>
                    </span>
                  </span>
                  <PlusCheck on={on} accent={accent} />
                </button>
              );
            })}
            {g.items.length === 0 && <div style={{ color: '#94a3b8', fontSize: 13.5, padding: '8px 2px' }}>Nothing found.</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 · Technician
// ---------------------------------------------------------------------------
function TechPicker({ staff, staffId, onPick, accent }: { staff: Staff[]; staffId: string; onPick: (id: string) => void; accent: string }) {
  const rows = [{ id: '', firstName: 'Any', lastName: 'nail tech', avatarUrl: null } as Staff, ...staff];
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {rows.map((s) => {
        const label = `${s.firstName} ${s.lastName ?? ''}`.trim();
        const on = staffId === s.id;
        return (
          <button key={s.id || 'any'} type="button" className="lumio-row" onClick={() => onPick(s.id)}
            style={{ ...rowCard, padding: '15px 16px', borderColor: on ? accent : '#e9edf4', background: on ? tint(accent, 0.06) : '#fff',
              boxShadow: on ? `0 10px 26px -16px ${tint(accent, 0.9)}, 0 0 0 3px ${tint(accent, 0.12)}` : rowCard.boxShadow }}>
            <Avatar name={label} url={s.avatarUrl} size={46} accent={accent} />
            <span style={{ flex: 1, textAlign: 'left', fontSize: 15, fontWeight: 700, color: INK, marginLeft: 12 }}>
              {s.id ? label : 'Any nail tech'}
              {!s.id && <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: '#94a3b8', marginTop: 2 }}>First one free at your time</span>}
            </span>
            {on
              ? <span style={{ width: 30, height: 30, borderRadius: '50%', background: accent, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 15, flexShrink: 0 }}>✓</span>
              : <span style={{ padding: '8px 18px', borderRadius: 999, border: `1px solid ${accent}`, color: accent, fontSize: 13, fontWeight: 700, flexShrink: 0 }}>Select</span>}
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
function TimePicker({ rules, salon, selectedDate, slot, avail, staffId, durationMinutes, onPickDate, onPickSlot, waitlist, accent }: {
  rules: BookingRules; salon: Salon | null; selectedDate: Date | null; slot: Slot | null; avail: Availability | null;
  staffId: string; durationMinutes: number; onPickDate: (d: Date) => void; onPickSlot: (s: Slot) => void;
  waitlist?: React.ReactNode; accent: string;
}) {
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const maxDate = useMemo(() => new Date(today.getTime() + rules.maxAdvanceDays * 86400000), [today, rules.maxAdvanceDays]);

  // The strip starts at the first bookable day and slides a week at a time.
  const firstOpen = useMemo(() => {
    for (let i = 0; i <= rules.maxAdvanceDays; i++) {
      const d = new Date(today.getTime() + i * 86400000);
      if (!isClosedDay(d, rules) && generateSlots(d, Math.max(durationMinutes, 15), rules).length > 0) return d;
    }
    return today;
  }, [today, rules, durationMinutes]);

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
    () => (selectedDate ? generateSlots(selectedDate, Math.max(durationMinutes, 15), rules) : []),
    [selectedDate, durationMinutes, rules],
  );

  // A slot is bookable when the chosen tech is free — or, with "Any", when at
  // least one technician who can do every picked service is free.
  const isFree = useCallback((s: Slot) => {
    if (!avail) return true;
    if (staffId) return !overlaps(s, avail.staffBusy[staffId] ?? []);
    return avail.eligibleStaffIds.some((id) => !overlaps(s, avail.staffBusy[id] ?? []));
  }, [avail, staffId]);

  const groups: { label: string; items: Slot[] }[] = useMemo(() => {
    const g = { Morning: [] as Slot[], Afternoon: [] as Slot[], Evening: [] as Slot[] };
    for (const s of slots) {
      const h = s.start.getHours();
      if (h < 12) g.Morning.push(s); else if (h < 17) g.Afternoon.push(s); else g.Evening.push(s);
    }
    return [
      { label: 'Morning', items: g.Morning },
      { label: 'Afternoon', items: g.Afternoon },
      { label: 'Evening', items: g.Evening },
    ].filter((x) => x.items.length > 0);
  }, [slots]);

  const anyFree = slots.some(isFree);
  const promo = promoPctFor(salon, selectedDate, null);

  return (
    <div>
      {/* month + jump-to-date */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontWeight: 800, color: INK, fontSize: 15 }}>
          {selectedDate && <span style={{ color: accent, marginRight: 8 }}>📅 {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>}
          <span style={{ color: '#64748b', fontWeight: 600 }}>{MONTH_NAMES[stripStart.getMonth()]} {stripStart.getFullYear()}</span>
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
                  color: on ? '#fff' : closed ? '#cbd5e1' : INK, position: 'relative' }}>
                <span style={{ fontSize: 17, fontWeight: 800, textDecoration: closed ? 'line-through' : 'none' }}>{d.getDate()}</span>
                <span style={{ fontSize: 11, opacity: on ? 0.95 : 0.6 }}>{DOW_SHORT[d.getDay()]}</span>
                {!on && deal > 0 && !closed && <span style={{ position: 'absolute', top: 2, right: 6, fontSize: 9, fontWeight: 800, color: '#16a34a' }}>-{deal}%</span>}
              </button>
            );
          })}
        </div>
        <button onClick={() => shift(1)} disabled={new Date(stripStart.getTime() + 7 * 86400000) > maxDate} style={arrowBtn}>›</button>
      </div>

      {promo > 0 && (
        <div style={{ marginBottom: 14, padding: '9px 12px', borderRadius: 10, background: '#ecfdf5', border: '1px solid #6ee7b7', color: '#065f46', fontSize: 13, fontWeight: 700 }}>
          🎉 −{promo}% off on this day — applied automatically.
        </div>
      )}

      {groups.length === 0 || !anyFree ? (
        <div style={{ padding: '26px 0', textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ fontSize: 30, marginBottom: 6 }}>😔</div>
          <div style={{ fontSize: 14 }}>No times left on this day. Try the next one.</div>
          {waitlist}
        </div>
      ) : (
        <>
          {groups.map((g) => (
            <div key={g.label} style={{ marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <span style={{ flex: 1, height: 1, background: '#eef1f6' }} />
                <span style={{ fontWeight: 800, color: INK, fontSize: 12.5, letterSpacing: 0.4 }}>
                  {g.label === 'Morning' ? '🌤 ' : g.label === 'Afternoon' ? '☀️ ' : '🌙 '}{g.label.toUpperCase()}
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
function ConfirmStep({ salon, slot, employee, lines, fmt, totalCents, depositCents, rules, paymentType, setPaymentType, form, setForm, smsConsent, setSmsConsent, accent, error, infoOk, isMobile }: {
  salon: Salon | null; slot: Slot; employee: Staff | null; lines: Line[]; fmt: (c: number) => string; totalCents: number;
  depositCents: number; rules: BookingRules; paymentType: 'PAY_ONLINE' | 'PAY_LATER'; setPaymentType: (v: 'PAY_ONLINE' | 'PAY_LATER') => void;
  form: { firstName: string; lastName: string; email: string; phone: string; birthDate: string; partySize: string };
  setForm: (f: { firstName: string; lastName: string; email: string; phone: string; birthDate: string; partySize: string }) => void;
  smsConsent: boolean; setSmsConsent: (v: boolean) => void; accent: string; error: string | null; infoOk: boolean; isMobile: boolean;
}) {
  const showPhoneError = form.phone.trim().length > 0 && !isValidPhone(form.phone);
  const showEmailError = form.email.trim().length > 0 && !isValidEmail(form.email);
  return (
    <div>
      <p style={{ color: '#64748b', fontSize: 14, margin: '-6px 0 16px' }}>Review your details and complete your appointment.</p>

      <Card title="APPOINTMENT">
        <InfoRow icon="🏪" label="Location" value={salon?.name ?? ''} sub={salon?.address ?? undefined} />
        <InfoRow icon="📅" label="Date" value={slot.start.toLocaleDateString('en-US')} />
        <InfoRow icon="🕐" label="Time" value={`${fmtTime(slot.start)} – ${fmtTime(slot.end)}`} />
        <InfoRow icon="👤" label="Technician" value={employee ? `${employee.firstName} ${employee.lastName ?? ''}`.trim() : 'Any available'} last />
      </Card>

      <Card title="SERVICES">
        {lines.map((l) => (
          <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: '1px solid #eef1f6' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>{l.name}</div>
              <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>{l.durationMinutes} min{employee && <> · 👤 <b style={{ color: accent }}>{employee.firstName}</b></>}</div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: INK, whiteSpace: 'nowrap' }}>{fmt(l.priceCents)}</div>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 12, fontWeight: 800, color: INK, fontSize: 15 }}>
          <span>Total</span><span>{fmt(totalCents)}</span>
        </div>
        {depositCents > 0 && (
          <div style={{ marginTop: 8, fontSize: 13, color: accent, fontWeight: 700 }}>Deposit due today: {fmt(depositCents)}</div>
        )}
      </Card>

      <Card title="YOUR DETAILS">
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
          <Field label="First name" required><input style={inputStyle} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
          <Field label="Last name"><input style={inputStyle} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
          <Field label="Phone" required>
            <input style={{ ...inputStyle, borderColor: showPhoneError ? '#ef4444' : '#dbe2ee' }} value={form.phone} inputMode="tel" placeholder="e.g. (201) 555-0123"
              onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            {showPhoneError && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>Enter a valid phone number (8–15 digits).</div>}
          </Field>
          <Field label="Email (optional)">
            <input style={{ ...inputStyle, borderColor: showEmailError ? '#ef4444' : '#dbe2ee' }} type="email" value={form.email} placeholder="you@email.com"
              onChange={(e) => setForm({ ...form, email: e.target.value })} />
            {showEmailError
              ? <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>Enter a valid email address.</div>
              : <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 4 }}>We&rsquo;ll email your receipt 💌</div>}
          </Field>
          <Field label="People"><input style={inputStyle} type="number" min={1} max={20} value={form.partySize} onChange={(e) => setForm({ ...form, partySize: e.target.value })} /></Field>
          <Field label="🎂 Birthday (optional)"><BirthdayInput value={form.birthDate} onChange={(iso) => setForm({ ...form, birthDate: iso })} /></Field>
        </div>

        <div style={{ marginTop: 8, padding: '12px 14px', background: SOFT, border: '1px solid #e6eaf2', borderRadius: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: INK, marginBottom: 4 }}>📱 Appointment text updates</div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: '#64748b' }}>
            We&rsquo;ll text you confirmations &amp; reminders for this appointment from {salon?.name || 'the salon'}. Up to ~6 msgs/month.
            Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help.
          </p>
          <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={smsConsent} onChange={(e) => setSmsConsent(e.target.checked)} style={{ marginTop: 2, width: 16, height: 16, accentColor: accent, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: '#475569', lineHeight: 1.5 }}>Also send me special offers &amp; promotions by text <span style={{ color: '#94a3b8' }}>(optional)</span></span>
          </label>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 9 }}>
            <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: accent, textDecoration: 'none', fontWeight: 600 }}>Privacy</a>
            <span style={{ margin: '0 6px' }}>·</span>
            <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: accent, textDecoration: 'none', fontWeight: 600 }}>Messaging Terms</a>
          </div>
        </div>
      </Card>

      {(rules.onlinePaymentEnabled || rules.payLaterEnabled) && (
        <Card title="PAYMENT">
          <div style={{ display: 'grid', gap: 10 }}>
            {rules.onlinePaymentEnabled && (
              <PayOption selected={paymentType === 'PAY_ONLINE'} onClick={() => setPaymentType('PAY_ONLINE')}
                title={depositCents > 0 ? `Pay deposit now · ${fmt(depositCents)}` : 'Pay online now'}
                desc="Secure card payment. Your spot is held instantly." accent={accent} />
            )}
            {rules.payLaterEnabled && (
              <PayOption selected={paymentType === 'PAY_LATER'} onClick={() => setPaymentType('PAY_LATER')}
                title="Pay at the salon" desc="Cash or card when you arrive." accent={accent} />
            )}
          </div>
        </Card>
      )}

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, marginBottom: 12 }}>{error}</div>}
      {!infoOk && <div style={{ color: '#94a3b8', fontSize: 12.5, marginBottom: 8 }}>Enter your first name and phone number to confirm. Email is optional.</div>}
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
        {sub && <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}
function PayOption({ selected, onClick, title, desc, accent }: { selected: boolean; onClick: () => void; title: string; desc: string; accent: string }) {
  return (
    <button type="button" onClick={onClick} className="lumio-row"
      style={{ ...rowCard, alignItems: 'flex-start', borderColor: selected ? accent : '#e6eaf2', background: selected ? '#f6f7ff' : '#fff' }}>
      <span style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${selected ? accent : '#cbd5e1'}`, display: 'grid', placeItems: 'center', marginTop: 2, flexShrink: 0 }}>
        {selected && <span style={{ width: 10, height: 10, borderRadius: '50%', background: accent }} />}
      </span>
      <span style={{ textAlign: 'left', marginLeft: 12 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: INK }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>{desc}</span>
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
function Logo({ url, size }: { url?: string | null; size: number }) {
  const clean = (url ?? '').trim();
  if (clean.startsWith('https://')) {
    return (
      <span style={{ width: size, height: size, borderRadius: 10, background: '#fff', display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0, boxShadow: '0 2px 8px rgba(15,42,82,0.18)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={clean} alt="" width={size} height={size} style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 3 }} />
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
function PlusCheck({ on, accent }: { on: boolean; accent: string }) {
  return on
    ? <span style={{ width: 34, height: 34, borderRadius: '50%', background: accent, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 16, flexShrink: 0 }}>✓</span>
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
      <select style={sel} value={mm} onChange={(e) => { setMm(e.target.value); emit(e.target.value, clampDay(e.target.value, yy, dd), yy); }} aria-label="Birth month">
        <option value="">Month</option>
        {MONTH_NAMES.map((name, i) => <option key={i} value={String(i + 1)}>{name}</option>)}
      </select>
      <select style={sel} value={dd} onChange={(e) => { setDd(e.target.value); emit(mm, e.target.value, yy); }} aria-label="Birth day">
        <option value="">Day</option>
        {days.map((d) => <option key={d} value={String(d)}>{d}</option>)}
      </select>
      <select style={sel} value={yy} onChange={(e) => { setYy(e.target.value); emit(mm, clampDay(mm, e.target.value, dd), e.target.value); }} aria-label="Birth year">
        <option value="">Year</option>
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
    if (!f.customerName.trim()) { setErr('Please enter your name.'); return; }
    if (!isValidPhone(f.phone) && !isValidEmail(f.email)) { setErr('Please enter a valid phone or email so we can reach you.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${base}/waitlist`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName: f.customerName, phone: f.phone || undefined, email: f.email || undefined, preferredDate: preferredDate ? ymd(preferredDate) : undefined, serviceId: serviceId || undefined }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.message || 'Could not join'); }
      setDone(true);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not join'); }
    finally { setBusy(false); }
  }

  if (done) return (
    <div style={{ marginTop: 12, background: '#ecfdf5', border: '1px solid #6ee7b7', borderRadius: 12, padding: '12px 14px', color: '#065f46', fontSize: 14, textAlign: 'center' }}>
      ✓ You&apos;re on the waitlist! We&apos;ll reach out if a spot opens up.
    </div>
  );
  return (
    <div style={{ marginTop: 12, border: '1px solid #e6eaf2', borderRadius: 12, padding: '12px 14px' }}>
      {!open ? (
        <button onClick={() => setOpen(true)} style={{ background: 'none', border: 'none', color: fmtAccent, fontSize: 14, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
          Can&apos;t find a time? Join the waitlist →
        </button>
      ) : (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 10 }}>
            <div style={{ fontWeight: 800, color: INK }}>Join the waitlist</div>
            <button onClick={() => { setOpen(false); setErr(null); }} aria-label="Close" style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, lineHeight: 1, cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <input placeholder="Your name" value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} style={inputStyle} />
            <input placeholder="Phone" value={f.phone} inputMode="tel" onChange={(e) => setF({ ...f, phone: e.target.value })} style={inputStyle} />
            <input placeholder="Email (optional)" value={f.email} type="email" onChange={(e) => setF({ ...f, email: e.target.value })} style={inputStyle} />
          </div>
          {err && <p style={{ color: '#dc2626', fontSize: 13, margin: '8px 0 0' }}>{err}</p>}
          <button onClick={submit} disabled={busy} style={{ ...ctaBtn, marginTop: 10 }}>{busy ? 'Joining…' : 'Join waitlist'}</button>
        </div>
      )}
    </div>
  );
}

function DealsBanner({ wd, dd, categories }: { wd?: WeekdayDiscounts; dd?: DateDiscounts; categories: { id: string; name: string }[] }) {
  const wdOn = !!(wd?.enabled && wd.rules?.length);
  const ddOn = !!(dd?.enabled && dd.rules?.length);
  if (!wdOn && !ddOn) return null;
  const catName = (id: string | null) => (id ? (categories.find((c) => c.id === id)?.name ?? 'select services') : 'everything');
  const wdSorted = wdOn ? [...wd!.rules].sort((a, b) => a.day - b.day || b.percent - a.percent) : [];
  const ddSorted = ddOn ? [...dd!.rules].filter((r) => r.startDate).sort((a, b) => a.startDate.localeCompare(b.startDate) || b.percent - a.percent) : [];
  const fmtOne = (s: string) => { try { return new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return s; } };
  const fmtRange = (r: DateRule) => (r.endDate && r.endDate !== r.startDate ? `${fmtOne(r.startDate)}–${fmtOne(r.endDate)}` : fmtOne(r.startDate));
  const chip: React.CSSProperties = { background: '#fff', border: '1px solid #6ee7b7', borderRadius: 999, padding: '4px 12px', fontSize: 12.5, color: '#065f46', fontWeight: 700 };
  return (
    <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 12, background: 'linear-gradient(90deg,#ecfdf5,#d1fae5)', border: '1px solid #6ee7b7' }}>
      <div style={{ fontWeight: 800, color: '#065f46', marginBottom: 8, fontSize: 14.5 }}>💸 {(wdOn && wd!.message) || 'Save on select days!'}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {wdSorted.map((r, i) => <span key={`w${i}`} style={chip}>{WEEKDAY_NAMES[r.day]}: −{r.percent}% off {catName(r.categoryId)}</span>)}
        {ddSorted.map((r, i) => <span key={`d${i}`} style={chip}>{r.label ? `${r.label} · ` : ''}{fmtRange(r)}: −{r.percent}% off {catName(r.categoryId)}</span>)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell + helpers + styles
// ---------------------------------------------------------------------------
const FONT = "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

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

.lumio-book, .lumio-book button, .lumio-book input, .lumio-book select, .lumio-book textarea, .lumio-book a,
.lumio-shell, .lumio-shell button, .lumio-shell input {
  font-family: ${FONT};
  -webkit-font-smoothing: antialiased;
}
.lumio-book h1, .lumio-book h2 { letter-spacing: -0.5px; }
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
    ? ['Services', 'Nail tech', 'Time', 'Confirm']
    : ['Services', 'Time', 'Confirm'];
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
                background: done ? '#16a34a' : on ? accent : '#e6eaf2', color: done || on ? '#fff' : '#94a3b8',
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
        background: `radial-gradient(1100px 520px at 12% -8%, ${tint(accent, 0.16)}, transparent 60%),
             radial-gradient(900px 500px at 105% 8%, ${tint(accent, 0.10)}, transparent 55%),
             linear-gradient(180deg, #f7f9fd 0%, #eef2f8 100%)`,
        padding: fullscreen ? 0 : embedded ? 12 : 16,
        fontFamily: FONT,
        ['--accent' as string]: accent,
        ['--accent-glow' as string]: tint(accent, 0.55),
        ['--accent-dark' as string]: shade(accent, 0.28),
      } as React.CSSProperties}>
        {children}
      </div>
    </>
  );
}
function useEmbedded(): boolean {
  const [emb, setEmb] = useState(false);
  useEffect(() => { try { setEmb(window.self !== window.top); } catch { setEmb(true); } }, []);
  return emb;
}
function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', placeItems: 'center', minHeight: 240, color: '#475569', padding: 24 }}>{children}</div>;
}

function fmtTime(d: Date) { return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }); }
function fmtDur(min: number) {
  if (min <= 0) return '0min';
  const h = Math.floor(min / 60), m = min % 60;
  return `${h ? `${h}h ` : ''}${m ? `${m}min` : ''}`.trim();
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
function generateSlots(date: Date, durationMin: number, rules: BookingRules): Slot[] {
  const out: Slot[] = [];
  if (isClosedDay(date, rules)) return out;
  const h = rules.businessHours[date.getDay()];
  const earliest = Date.now() + rules.minLeadHours * 3_600_000;
  const step = Math.max(5, rules.slotStepMinutes);
  for (let mins = h.openMinutes; mins + durationMin <= h.closeMinutes; mins += step) {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(mins / 60), mins % 60);
    if (start.getTime() < earliest) continue;
    out.push({ start, end: new Date(start.getTime() + durationMin * 60_000) });
  }
  return out;
}
function overlaps(slot: Slot, intervals: { start: string; end: string }[]): boolean {
  const s = slot.start.getTime(), e = slot.end.getTime();
  return intervals.some((iv) => Date.parse(iv.start) < e && s < Date.parse(iv.end));
}

const rowCard: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px 15px', borderRadius: 16,
  border: '1px solid #e9edf4', background: '#fff', cursor: 'pointer', boxShadow: '0 2px 6px -3px rgba(15,42,82,0.10)',
};
const rowTitle: React.CSSProperties = { display: 'block', fontSize: 14.5, fontWeight: 800, color: INK, letterSpacing: 0.2, lineHeight: 1.35 };
const rowMeta: React.CSSProperties = { display: 'block', fontSize: 12.5, color: '#7d8ba4', marginTop: 5 };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 10, border: '1px solid #dbe2ee', background: '#fff', color: INK, fontSize: 14 };
const ctaBtn: React.CSSProperties = {
  width: '100%', padding: '15px 18px', borderRadius: 999, border: 'none', color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer',
  background: 'linear-gradient(120deg, var(--accent, #6366f1), var(--accent-dark, #4f46e5))',
  boxShadow: '0 16px 32px -16px var(--accent-glow, rgba(99,102,241,.8))',
};
const primaryBtn: React.CSSProperties = { padding: '12px 22px', borderRadius: 999, border: 'none', background: 'var(--accent, #6366f1)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer' };
const arrowBtn: React.CSSProperties = { width: 34, height: 34, borderRadius: '50%', border: '1px solid #e6eaf2', background: '#fff', color: INK, fontSize: 18, cursor: 'pointer', flexShrink: 0 };
