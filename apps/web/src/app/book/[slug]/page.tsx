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

  // ---- validation -----------------------------------------------------------
  const phoneOk = isValidPhone(form.phone);
  const emailOk = !form.email.trim() || isValidEmail(form.email);
  const infoOk = form.firstName.trim().length > 0 && phoneOk && emailOk;

  if (loading) return <Shell accent="#6366f1"><Center>Loading…</Center></Shell>;
  if (loadError) return <Shell accent="#6366f1"><Center>{loadError}</Center></Shell>;
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

  const barTitle =
    step === 1 ? 'BOOKING ONLINE' :
    step === 2 ? 'Select Professional' :
    step === 3 ? 'Select Time' : 'Confirm Booking';

  const summary = (
    <CartPanel
      fill={!embedded && !isMobile}
      salon={salon} lines={allLines} fmt={fmt} totalCents={totalCents} fullCents={fullCents}
      anyDiscount={anyDiscount} totalDuration={totalDuration} employee={employee} slot={slot} selectedDate={selectedDate}
      onRemove={removeLine} canContinue={canContinue} ctaLabel={ctaLabel} onContinue={goNext} step={step} accent={accent}
    />
  );

  return (
    <Shell accent={accent}>
      <div className="lumio-book" style={{ width: '100%', maxWidth: 1120, margin: '0 auto', ['--accent' as string]: accent } as React.CSSProperties}>
        {/* Top bar — salon name (step 1) or the step name with a back arrow */}
        {/* Header stays put while the menu scrolls under it. */}
        <div style={{ position: embedded ? 'static' : 'sticky', top: 0, zIndex: 30,
          background: `linear-gradient(135deg, ${accent}, ${shade(accent)})`, color: '#fff',
          borderRadius: embedded ? 12 : '14px 14px 0 0', padding: isMobile ? '12px 14px' : '15px 18px',
          display: 'flex', alignItems: 'center', gap: 12, marginBottom: embedded ? 12 : 0,
          boxShadow: '0 6px 20px rgba(15,42,82,0.16)' }}>
          {step > 1 && step < 5 && (
            <button onClick={goBack} aria-label="Back" style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 16, cursor: 'pointer', flexShrink: 0 }}>←</button>
          )}
          {step === 1 && <Logo url={salon?.branding?.logoUrl} size={38} />}
          <div style={{ fontWeight: 800, fontSize: isMobile ? 16 : 18, letterSpacing: 0.2, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {step === 1 ? (salon?.name ?? barTitle) : barTitle}
          </div>
          {step === 3 && rules.allowCustomerChooseStaff && (
            <button onClick={() => setStep(2)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px 6px 6px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
              <Avatar name={employee ? `${employee.firstName} ${employee.lastName ?? ''}` : 'Any'} url={employee?.avatarUrl ?? null} size={26} accent={accent} />
              {employee ? employee.firstName : 'Any nail tech'} ▾
            </button>
          )}
          {step === 1 && !embedded && !isMobile && <InstallAppButton label="Get the app" />}
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
            {/* -------- left: the actual picking -------- */}
            <div style={{ background: '#fff', borderRadius: embedded ? 12 : (isMobile ? '0 0 14px 14px' : '0 0 14px 0'), padding: isMobile ? '16px 14px' : '22px 24px', marginTop: embedded && !isMobile ? 0 : 0, minWidth: 0 }}>
              <h1 style={{ fontSize: isMobile ? 22 : 27, fontWeight: 800, color: INK, margin: '2px 0 14px' }}>{stepTitle}</h1>

              {step === 1 && (
                <>
                  <DealsBanner wd={salon?.weekdayDiscounts} dd={salon?.dateDiscounts} categories={categories} />
                  {/* Services come first — the duration and the technician depend on them, so
                      every time we offer later is a time that can really be booked. But the
                      visitor still wants to know "is there room this week?" before reading a
                      menu, so the day strip lives here too. Picking a day here only pre-fills
                      step 3; it never locks in a slot. */}
                  <WhenStrip
                    rules={rules} salon={salon} services={services} accent={accent}
                    selectedDate={selectedDate} onPickDate={(d) => { setSelectedDate(d); setSlot(null); }}
                  />
                  <ServicePicker
                    services={services} categories={categories} selectedIds={pickedServiceIds}
                    onToggle={toggleService} fmt={fmt} accent={accent} spy={!embedded}
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
              <div style={{ position: 'sticky', top: embedded ? 0 : 92, height: embedded ? 'auto' : 'calc(100vh - 124px)', minHeight: 420, marginTop: 16 }}>
                {summary}
              </div>
            )}
          </div>
        )}

        {/* Mobile: the action bar floats above everything and is never hidden. */}
        {isMobile && step < 5 && (
          <MobileBar
            embedded={embedded} count={cartLines.length} totalCents={totalCents} fmt={fmt}
            durationMinutes={totalDuration} canContinue={canContinue} label={ctaLabel} onContinue={goNext} accent={accent}
          />
        )}

        {!embedded && (
          <a href="https://lumioagency.com/" target="_blank" rel="noopener noreferrer"
            style={{ display: 'block', textAlign: 'center', padding: isMobile ? '14px 0 96px' : '16px 0 8px', fontSize: 11.5, color: '#94a3b8', textDecoration: 'none' }}>
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
    <aside style={{ background: '#fff', borderRadius: 14, overflow: 'hidden', boxShadow: '0 8px 30px rgba(15,42,82,0.10)',
      height: fill ? '100%' : 'auto', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: `linear-gradient(135deg, ${accent}, ${shade(accent)})`, color: '#fff', padding: '15px 16px', display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
        <Logo url={salon?.branding?.logoUrl} size={44} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15.5 }}>{salon?.name}</div>
          {salon?.address && <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 3, lineHeight: 1.45 }}>{salon.address}</div>}
          {salon?.contactPhone && <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 3 }}>📞 {salon.contactPhone}</div>}
        </div>
      </div>

      {/* The list takes whatever room is left, so the panel fills the page instead of
          ending in a big white void — and the total + button stay pinned at the bottom. */}
      <div style={{ padding: '6px 16px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
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
    <div style={{ padding: '18px 2px', display: 'flex', flexDirection: 'column', height: '100%' }}>
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
          style={{ marginTop: 'auto', display: 'block', textAlign: 'center', padding: '11px 12px', borderRadius: 12, border: `1px solid ${tint(accent, 0.35)}`, color: accent, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
          📞 Rather talk to us? {salon.contactPhone}
        </a>
      )}
    </div>
  );
}

/** Mobile: floating action bar. Always on screen, never behind the content. */
function MobileBar({ embedded, count, totalCents, fmt, durationMinutes, canContinue, label, onContinue, accent }: {
  embedded: boolean; count: number; totalCents: number; fmt: (c: number) => string; durationMinutes: number;
  canContinue: boolean; label: string; onContinue: () => void; accent: string;
}) {
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

  const boxed: React.CSSProperties = embedded
    ? { marginTop: 12, borderRadius: 12, border: '1px solid #e6eaf2' }
    : { position: 'fixed', left: 10, right: 10, bottom: 'calc(10px + env(safe-area-inset-bottom, 0px))', zIndex: 60, borderRadius: 14, boxShadow: '0 10px 30px rgba(15,42,82,0.22)' };

  return (
    <div ref={ref} style={{ background: '#fff', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 12, ...boxed }}>
      <span style={{ width: 38, height: 38, borderRadius: 10, background: '#eef2fb', display: 'grid', placeItems: 'center', fontSize: 17, flexShrink: 0 }}>🛍️</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: '#64748b' }}>
          {count} service{count === 1 ? '' : 's'}{durationMinutes > 0 && <> · 🕐 {fmtDur(durationMinutes)}</>}
        </div>
        <div style={{ fontSize: 17, fontWeight: 800, color: accent }}>{fmt(totalCents)}</div>
      </div>
      <button onClick={onContinue} disabled={!canContinue} className="lumio-cta"
        style={{ ...ctaBtn, width: 'auto', padding: '12px 20px', opacity: canContinue ? 1 : 0.45, cursor: canContinue ? 'pointer' : 'not-allowed' }}>
        {label} →
      </button>
    </div>
  );
}

/** "When do you want to come in?" — a 7-day strip shown above the menu, with the
 *  first free time of the chosen day. Answers the visitor's real first question
 *  (is there room?) without forcing them to pick a time before a service. */
function WhenStrip({ rules, salon, services, selectedDate, onPickDate, accent }: {
  rules: BookingRules; salon: Salon | null; services: Service[]; selectedDate: Date | null;
  onPickDate: (d: Date) => void; accent: string;
}) {
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const shortest = useMemo(() => Math.max(15, Math.min(...(services.length ? services.map((s) => s.durationMinutes) : [30]))), [services]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(today.getTime() + i * 86400000)), [today]);
  const active = selectedDate ?? null;
  const first = active ? generateSlots(active, shortest, rules)[0] : null;

  return (
    <div style={{ border: '1px solid #e6eaf2', borderRadius: 14, padding: '12px 14px', marginBottom: 16, background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: INK }}>📅 When would you like to come in?</span>
        {active && (
          <span style={{ fontSize: 12.5, color: first ? '#16a34a' : '#94a3b8', fontWeight: 700 }}>
            {first ? `Earliest ${fmtTime(first.start)}` : 'Closed'}
          </span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {days.map((d) => {
          const closed = isClosedDay(d, rules);
          const on = !!active && sameDay(d, active);
          const deal = promoPctFor(salon, d, null);
          return (
            <button key={d.toISOString()} type="button" disabled={closed} onClick={() => onPickDate(d)}
              style={{ display: 'grid', justifyItems: 'center', gap: 2, padding: '7px 2px', borderRadius: 10, border: 'none', position: 'relative',
                cursor: closed ? 'not-allowed' : 'pointer', background: on ? accent : 'transparent',
                color: on ? '#fff' : closed ? '#cbd5e1' : INK }}>
              <span style={{ fontSize: 15.5, fontWeight: 800, textDecoration: closed ? 'line-through' : 'none' }}>{d.getDate()}</span>
              <span style={{ fontSize: 10.5, opacity: on ? 0.95 : 0.6 }}>{DOW_SHORT[d.getDay()]}</span>
              {!on && deal > 0 && !closed && <span style={{ position: 'absolute', top: 1, right: 5, fontSize: 9, fontWeight: 800, color: '#16a34a' }}>-{deal}%</span>}
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 8 }}>
        Pick the day now if you like — you&apos;ll choose the exact time after the service, so every time we show you is really free.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 · Services: sticky category tabs + one section per category.
// Scrolling moves the tabs (scroll-spy); tapping a tab scrolls to the section.
// ---------------------------------------------------------------------------
function ServicePicker({ services, categories, selectedIds, onToggle, fmt, accent, spy }: {
  services: Service[]; categories: Category[]; selectedIds: string[];
  onToggle: (id: string) => void; fmt: (c: number) => string; accent: string; spy: boolean;
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

  // Scroll-spy: the tab follows the section the visitor is actually reading.
  useEffect(() => {
    if (!spy || q.trim()) return;
    const onScroll = () => {
      let current = groups[0]?.id ?? '';
      for (const g of groups) {
        const el = sectionRefs.current[g.id];
        if (!el) continue;
        if (el.getBoundingClientRect().top - 170 <= 0) current = g.id;
      }
      setActive((prev) => (prev === current ? prev : current));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [groups, spy, q]);

  // Keep the active tab visible in the horizontal strip.
  useEffect(() => {
    const strip = tabsRef.current;
    const btn = strip?.querySelector<HTMLElement>(`[data-tab="${active}"]`);
    if (!strip || !btn) return;
    const left = btn.offsetLeft - strip.offsetLeft - 12;
    strip.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [active]);

  const goTo = (id: string) => {
    setActive(id);
    if (!spy) return; // embedded: tabs filter instead (see below)
    const el = sectionRefs.current[id];
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 128, behavior: 'smooth' });
  };

  const search = q.trim().toLowerCase();
  const shown = search
    ? [{ id: 'search', name: `Results for “${q.trim()}”`, items: services.filter((s) => s.name.toLowerCase().includes(search)) }]
    : spy ? groups : groups.filter((g) => g.id === active);

  return (
    <div>
      <div ref={tabsRef} className="lumio-tabs" style={{ position: spy ? 'sticky' : 'static', top: 64, zIndex: 5, background: '#fff', display: 'flex', gap: 8, overflowX: 'auto', padding: '10px 0 12px', boxShadow: '0 10px 10px -10px rgba(15,42,82,0.08)' }}>
        {groups.map((g) => {
          const on = active === g.id && !search;
          return (
            <button key={g.id} data-tab={g.id} type="button" onClick={() => goTo(g.id)}
              style={{ padding: '9px 16px', borderRadius: 999, whiteSpace: 'nowrap', cursor: 'pointer', fontSize: 13.5, fontWeight: 700,
                border: `1px solid ${on ? accent : '#e6eaf2'}`, background: on ? accent : '#fff', color: on ? '#fff' : '#5b6b85' }}>
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
                  style={{ ...rowCard, borderColor: on ? accent : '#e6eaf2', background: on ? tint(accent, 0.07) : '#fff' }}>
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
            style={{ ...rowCard, padding: '14px 16px', borderColor: on ? accent : '#e6eaf2', background: on ? tint(accent, 0.07) : '#fff' }}>
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
                  background: on ? accent : 'transparent', color: on ? '#fff' : closed ? '#cbd5e1' : INK, position: 'relative' }}>
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
              <div style={{ textAlign: 'center', fontWeight: 800, color: INK, fontSize: 13.5, marginBottom: 10 }}>{g.label}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {g.items.map((s) => {
                  const free = isFree(s);
                  const on = !!slot && slot.start.getTime() === s.start.getTime();
                  return (
                    <button key={s.start.toISOString()} type="button" disabled={!free} onClick={() => onPickSlot(s)}
                      className={free ? 'lumio-row' : undefined}
                      style={{ padding: '12px 6px', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: free ? 'pointer' : 'not-allowed',
                        border: `1px solid ${on ? accent : '#e6eaf2'}`, background: on ? tint(accent, 0.10) : free ? '#fff' : '#f6f8fb',
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
const BOOK_CSS = `
@keyframes lumioIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.lumio-book, .lumio-book button, .lumio-book input, .lumio-book select, .lumio-book textarea, .lumio-book a {
  font-family: ${FONT};
  -webkit-font-smoothing: antialiased;
}
.lumio-book h1, .lumio-book h2 { letter-spacing: -0.4px; }
.lumio-book { animation: lumioIn .4s cubic-bezier(.2,.75,.25,1) both; }
.lumio-book button { transition: transform .12s ease, box-shadow .2s ease, border-color .15s ease, background .15s ease; }
.lumio-row:hover:not(:disabled) { border-color: var(--accent, #6366f1) !important; box-shadow: 0 6px 18px rgba(15,42,82,0.08); }
.lumio-cta:hover:not(:disabled) { filter: brightness(1.05); }
.lumio-tabs::-webkit-scrollbar { height: 0; }
@media (prefers-reduced-motion: reduce) { .lumio-book { animation: none !important; } }
`;
function Shell({ children, accent }: { children: React.ReactNode; accent: string }) {
  const [embedded, setEmbedded] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let emb = false;
    try { emb = window.self !== window.top; } catch { emb = true; }
    setEmbedded(emb);
    if (!emb) return;
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.margin = '0';
    // Measure the widget itself, never the document: once the host sets the iframe
    // height, <html>/<body> stretch to fill it and can only grow.
    const post = () => {
      const el = rootRef.current;
      if (!el) return;
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h < 120) return;
      try { window.parent.postMessage({ type: 'lumio-embed-height', height: h }, '*'); } catch { /* ignore */ }
    };
    post();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(post) : null;
    if (ro && rootRef.current) ro.observe(rootRef.current);
    const iv = window.setInterval(post, 800);
    window.addEventListener('resize', post);
    return () => { if (ro) ro.disconnect(); window.clearInterval(iv); window.removeEventListener('resize', post); };
  }, []);
  return (
    <>
      <style>{BOOK_CSS}</style>
      <div ref={rootRef} className="lumio-shell" style={{ minHeight: embedded ? 0 : '100vh', background: embedded ? 'transparent' : SOFT, padding: embedded ? 0 : 16, fontFamily: FONT, ['--accent' as string]: accent } as React.CSSProperties}>
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
  display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '13px 14px', borderRadius: 12,
  border: '1px solid #e6eaf2', background: '#fff', cursor: 'pointer', boxShadow: '0 1px 2px rgba(15,42,82,0.04)',
};
const rowTitle: React.CSSProperties = { display: 'block', fontSize: 14.5, fontWeight: 800, color: INK, letterSpacing: 0.2, lineHeight: 1.35 };
const rowMeta: React.CSSProperties = { display: 'block', fontSize: 12.5, color: '#7d8ba4', marginTop: 5 };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 10, border: '1px solid #dbe2ee', background: '#fff', color: INK, fontSize: 14 };
const ctaBtn: React.CSSProperties = { width: '100%', padding: '14px 18px', borderRadius: 999, border: 'none', background: 'var(--accent, #6366f1)', color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer' };
const primaryBtn: React.CSSProperties = { padding: '12px 22px', borderRadius: 999, border: 'none', background: 'var(--accent, #6366f1)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer' };
const arrowBtn: React.CSSProperties = { width: 34, height: 34, borderRadius: '50%', border: '1px solid #e6eaf2', background: '#fff', color: INK, fontSize: 18, cursor: 'pointer', flexShrink: 0 };
