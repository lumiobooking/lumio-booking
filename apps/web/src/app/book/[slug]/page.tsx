'use client';

// ===========================================================================
// Hosted online booking wizard at /book/<slug>.
// Flow: Date & time -> Service (+add-ons) -> Technician -> Your info -> Payment.
// The customer picks the date AND time first; once a service is chosen, the
// technician step only offers technicians who are FREE at that exact time
// (busy ones are greyed out) so the same tech can't be double-booked.
// ===========================================================================

import { useCallback, useEffect, useMemo, useRef, useState, FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { RestaurantReserve } from './RestaurantReserve';
import { useIsMobile } from '../../../lib/responsive';
import { InstallAppButton } from '../../../components/InstallAppButton';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';
const ACCENT = 'var(--accent, #6366f1)';

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
interface Salon { name: string; slug: string; businessType?: string; timezone: string; branding?: { accentColor: string; logoUrl: string }; booking?: BookingRules; weekdayDiscounts?: WeekdayDiscounts; dateDiscounts?: DateDiscounts; deposit?: DepositPolicy }

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Highest weekday-discount % that applies to a (date, category). 0 if none. */
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


/** Highest specific-date discount % for a (date, category). Pass categoryId=null
 *  to get the best across ALL categories (used to highlight the calendar). */
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

/** Best promo % for a date — the higher of the weekday rule and the specific-date
 *  rule (matches the backend "take the higher" behaviour). */
function promoPctFor(salon: Salon | null | undefined, date: Date | null, categoryId: string | null | undefined): number {
  return Math.max(weekdayPctFor(salon?.weekdayDiscounts, date, categoryId), datePctFor(salon?.dateDiscounts, date, categoryId));
}

/** "Can't find a time? Join the waitlist" — captures contact so the salon can
 *  invite the customer when a slot frees up. */
function WaitlistCta({ base, preferredDate, serviceId, fmtAccent }: { base: string; preferredDate: Date | null; serviceId?: string; fmtAccent: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ customerName: '', phone: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!f.customerName.trim()) { setErr('Please enter your name.'); return; }
    if (f.phone.trim() && !isValidPhone(f.phone)) { setErr('Please enter a valid phone number (8–15 digits).'); return; }
    if (f.email.trim() && !isValidEmail(f.email)) { setErr('Please enter a valid email address.'); return; }
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
    <div style={{ marginTop: 12, border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 14px' }}>
      {!open ? (
        <button onClick={() => setOpen(true)} style={{ background: 'none', border: 'none', color: fmtAccent, fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
          Can&apos;t find a time? Join the waitlist →
        </button>
      ) : (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 10 }}>
            <div style={{ fontWeight: 700, color: '#0f172a' }}>Join the waitlist</div>
            <button onClick={() => { setOpen(false); setErr(null); }} aria-label="Close" style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, lineHeight: 1, cursor: 'pointer', padding: '0 4px', flexShrink: 0 }}>×</button>
          </div>
          <p style={{ color: '#64748b', fontSize: 13, margin: '0 0 10px' }}>Leave your contact and we&apos;ll let you know the moment a spot opens{preferredDate ? ` around ${preferredDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}.</p>
          <div style={{ display: 'grid', gap: 8 }}>
            <input placeholder="Your name" value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} style={wlInput} />
            <input placeholder="Phone" value={f.phone} inputMode="tel" onChange={(e) => setF({ ...f, phone: e.target.value })} style={wlInput} />
            <input placeholder="Email (optional)" value={f.email} type="email" onChange={(e) => setF({ ...f, email: e.target.value })} style={wlInput} />
          </div>
          {err && <p style={{ color: '#dc2626', fontSize: 13, margin: '8px 0 0' }}>{err}</p>}
          <button onClick={submit} disabled={busy} style={{ marginTop: 10, width: '100%', padding: '11px', borderRadius: 10, border: 'none', background: fmtAccent, color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            {busy ? 'Joining…' : 'Join waitlist'}
          </button>
        </div>
      )}
    </div>
  );
}
const wlInput: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', background: 'white', color: '#1e293b', fontSize: 14 };

/** Prominent banner listing the salon's deals (weekday + specific dates). */
function DealsBanner({ wd, dd, categories }: { wd?: WeekdayDiscounts; dd?: DateDiscounts; categories: { id: string; name: string }[] }) {
  const wdOn = !!(wd?.enabled && wd.rules?.length);
  const ddOn = !!(dd?.enabled && dd.rules?.length);
  if (!wdOn && !ddOn) return null;
  const catName = (id: string | null) => (id ? (categories.find((c) => c.id === id)?.name ?? 'select services') : 'everything');
  const wdSorted = wdOn ? [...wd!.rules].sort((a, b) => a.day - b.day || b.percent - a.percent) : [];
  const ddSorted = ddOn ? [...dd!.rules].filter((r) => r.startDate).sort((a, b) => a.startDate.localeCompare(b.startDate) || b.percent - a.percent) : [];
  const fmtOne = (s: string) => { try { return new Date(s + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return s; } };
  const fmtRange = (r: DateRule) => (r.endDate && r.endDate !== r.startDate ? `${fmtOne(r.startDate)}–${fmtOne(r.endDate)}` : fmtOne(r.startDate));
  const chip: React.CSSProperties = { background: '#fff', border: '1px solid #6ee7b7', borderRadius: 999, padding: '4px 12px', fontSize: 13, color: '#065f46', fontWeight: 600 };
  return (
    <div style={{ marginBottom: 16, padding: '14px 16px', borderRadius: 12, background: 'linear-gradient(90deg,#ecfdf5,#d1fae5)', border: '1px solid #6ee7b7' }}>
      <div style={{ fontWeight: 800, color: '#065f46', marginBottom: 8, fontSize: 15 }}>💸 {(wdOn && wd!.message) || 'Save on select days!'}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {wdSorted.map((r, i) => (
          <span key={`w${i}`} style={chip}>{WEEKDAY_NAMES[r.day]}: −{r.percent}% off {catName(r.categoryId)}</span>
        ))}
        {ddSorted.map((r, i) => (
          <span key={`d${i}`} style={chip}>{r.label ? `${r.label} · ` : ''}{fmtRange(r)}: −{r.percent}% off {catName(r.categoryId)}</span>
        ))}
      </div>
      <div style={{ color: '#047857', fontSize: 12, marginTop: 8 }}>Highlighted days below get the discount automatically.</div>
    </div>
  );
}

/**
 * Treats the wall-clock digits of `local` (year/month/day/hour/minute) as a time
 * IN `timeZone` (the salon's zone) and returns the matching UTC ISO instant.
 * So "3:00 PM" picked for a salon in America/New_York is stored as 3 PM ET,
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
  const offset = asTz - naiveUTC; // ms the salon zone is ahead of UTC
  return new Date(naiveUTC - offset).toISOString();
}
interface Addon { id: string; name: string; durationMinutes: number; priceCents: number }
interface Service { id: string; name: string; description?: string | null; durationMinutes: number; priceCents: number; discountPercent?: number; categoryId?: string | null; isFeatured?: boolean; priceFrom?: boolean; addons: Addon[] }
interface Category { id: string; name: string; icon?: string | null }
/** Clamped service discount % and the net (after-discount) price in cents. */
function svcDiscount(s: Service | null): number { return s ? Math.min(90, Math.max(0, s.discountPercent ?? 0)) : 0; }
function svcNetCents(s: Service | null): number { return s ? Math.round((s.priceCents * (100 - svcDiscount(s))) / 100) : 0; }
interface Staff { id: string; firstName: string; lastName: string | null; avatarUrl: string | null }
interface Availability { eligibleStaffIds: string[]; staffBusy: Record<string, { start: string; end: string }[]> }
type Slot = { start: Date; end: Date };
type Step = 1 | 2 | 3 | 4 | 5 | 6; // 6 = done

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
  const [svcSearch, setSvcSearch] = useState('');
  const [activeCat, setActiveCat] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>(1);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [serviceId, setServiceId] = useState('');
  const [extraServiceIds, setExtraServiceIds] = useState<string[]>([]); // additional services in the same visit
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [staffId, setStaffId] = useState('');
  const [slot, setSlot] = useState<Slot | null>(null);
  const [avail, setAvail] = useState<Availability | null>(null);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', birthDate: '', partySize: '1' });
  const [paymentType, setPaymentType] = useState<'PAY_ONLINE' | 'PAY_LATER'>('PAY_LATER');
  // Optional marketing SMS opt-in (A2P 10DLC): off by default, never required to book.
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
  const serviceNetCents = svcNetCents(service);
  const serviceDiscount = svcDiscount(service);
  // Quiet-day discount applies on top of any service discount, once a date is picked.
  const weekdayPct = promoPctFor(salon, selectedDate, service?.categoryId ?? null);
  const serviceFinalCents = Math.round((serviceNetCents * (100 - weekdayPct)) / 100);
  const addonsCents = selectedAddons.reduce((s, a) => s + a.priceCents, 0);

  // Extra services chosen for the SAME visit. Each gets its own discount + the
  // weekday promo for its own category. (Excludes the primary service.)
  const extraServices = services.filter((s) => s.id !== serviceId && extraServiceIds.includes(s.id));
  const extraLines = extraServices.map((s) => {
    const net = svcNetCents(s);
    const wd = promoPctFor(salon, selectedDate, s.categoryId ?? null);
    return { id: s.id, name: s.name, priceCents: Math.round((net * (100 - wd)) / 100), durationMinutes: s.durationMinutes, fullCents: s.priceCents };
  });
  const extrasCents = extraLines.reduce((a, x) => a + x.priceCents, 0);
  const extrasDuration = extraLines.reduce((a, x) => a + x.durationMinutes, 0);
  const extrasFull = extraLines.reduce((a, x) => a + x.fullCents, 0);
  // Line items passed to the payment summary so every service shows.
  const paymentItems: Addon[] = [...extraLines.map((x) => ({ id: x.id, name: x.name, priceCents: x.priceCents, durationMinutes: x.durationMinutes })), ...selectedAddons];

  const totalCents = serviceFinalCents + addonsCents + extrasCents;
  const savingsCents = (service?.priceCents ?? 0) + addonsCents + extrasFull - totalCents;
  const anyDiscount = serviceDiscount > 0 || weekdayPct > 0 || extrasFull > extrasCents;
  const totalDuration = (service?.durationMinutes ?? 0) + selectedAddons.reduce((s, a) => s + a.durationMinutes, 0) + extrasDuration;
  const fmt = (c: number) => fmtMoney(c, rules);

  // Deposit shown on the payment step (display only; the server computes & takes
  // the authoritative deposit, including for new/repeat-no-show scopes it can't know here).
  const dep = salon?.deposit;
  const depositCents = dep?.enabled && dep.scope === 'all' && service && totalCents > 0
    ? Math.min(totalCents, dep.type === 'fixed' ? dep.fixedCents : Math.round((totalCents * dep.percent) / 100))
    : 0;

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      // Fire all four requests in parallel (was a waterfall: salon first, then
      // the rest) — one round-trip instead of two, noticeably faster to load.
      const [sRes, servicesData, staffData, catData] = await Promise.all([
        fetch(base),
        fetch(`${base}/services`).then((r) => r.json()).catch(() => []),
        fetch(`${base}/staff`).then((r) => r.json()).catch(() => []),
        fetch(`${base}/categories`).then((r) => r.json()).catch(() => []),
      ]);
      if (!sRes.ok) { setLoadError(sRes.status === 404 ? 'This salon booking page was not found.' : 'Could not load the salon.'); return; }
      const salonData = await sRes.json();
      setSalon(salonData); setServices(servicesData ?? []); setStaff(staffData ?? []); setCategories(catData ?? []);
    } catch { setLoadError('Could not reach the booking service. Please try again later.'); }
    finally { setLoading(false); }
  }, [base]);

  useEffect(() => { if (slug) load(); }, [slug, load]);

  // Pre-select the salon's default payment method once settings load.
  useEffect(() => {
    if (!salon) return;
    const r = salon.booking ?? DEFAULT_RULES;
    setPaymentType(r.defaultPaymentMethod === 'online' && r.onlinePaymentEnabled ? 'PAY_ONLINE' : 'PAY_LATER');
  }, [salon]);

  // Load real availability when we know the date + service (for greying slots).
  // With multiple services, a technician must be able to do ALL of them, so we
  // intersect the eligible staff across each service and merge their busy times.
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
          // All services for this visit (primary first). Backend prices each.
          serviceIds: [serviceId, ...extraServiceIds.filter((x) => x !== serviceId)],
          addonIds, preferredStaffId: staffId || undefined,
          // The picked time means "this wall-clock time AT THE SALON". Convert it
          // to the correct UTC instant using the salon's timezone, so the time
          // stored (and shown in admin emails) matches what the customer chose,
          // regardless of the customer's own device timezone.
          startTime: salon?.timezone ? wallTimeToISO(slot.start, salon.timezone) : slot.start.toISOString(),
          customerFirstName: form.firstName, customerLastName: form.lastName || undefined,
          customerEmail: form.email || undefined, customerPhone: form.phone || undefined,
          customerBirthDate: form.birthDate || undefined,
          partySize: parseInt(form.partySize, 10) || 1,
          smsConsent,
          // Referral attribution: forward the ?ref= code from the share link, if any.
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
    setStep(1); setSelectedDate(null); setServiceId(''); setAddonIds([]); setStaffId(''); setSlot(null);
    setAvail(null); setForm({ firstName: '', lastName: '', email: '', phone: '', birthDate: '', partySize: '1' });
    setPaymentType('PAY_LATER'); setResult(null); setError(null);
  }

  // Embedded: when the step changes, bring the widget back to the top of the screen
  // so the new step starts in view (the host page does the scrolling).
  const prevStep = useRef(step);
  useEffect(() => {
    const changed = prevStep.current !== step;
    prevStep.current = step;
    if (!changed || !embedded) return;
    try { window.parent.postMessage({ type: 'lumio-embed-scroll-into-view' }, '*'); } catch { /* ignore */ }
  }, [step, embedded]);

  if (loading) return <Shell><Center>Loading…</Center></Shell>;
  if (loadError) return <Shell><Center>{loadError}</Center></Shell>;
  if (salon && salon.businessType === 'RESTAURANT') return <RestaurantReserve slug={slug} salon={salon} />;

  const steps = [
    { n: 1, label: 'Date & time', summary: slot ? `${selectedDate?.toLocaleDateString('en-US')} · ${fmtTime(slot.start)}` : selectedDate ? selectedDate.toLocaleDateString('en-US') : '' },
    { n: 2, label: 'Service', summary: service ? service.name : '' },
    { n: 3, label: 'Technician', summary: step > 3 ? (employee ? `${employee.firstName} ${employee.lastName ?? ''}`.trim() : 'Any available') : '' },
    { n: 4, label: 'Your details & payment', summary: step > 4 ? (paymentType === 'PAY_ONLINE' ? 'Online' : 'At salon') : (form.firstName || '') },
  ];

  const currentLabel = steps.find((s) => s.n === Math.min(step, 4))?.label ?? '';

  return (
    <Shell>
      <div className="lumio-book" style={{ ...(isMobile ? wrapMobile : wrap), ...(embedded ? { boxShadow: 'none' } : {}), ['--accent' as string]: accent } as React.CSSProperties}>
        {isMobile ? (
          /* Compact mobile header: salon name + progress bar + current step */
          <div style={{ background: ACCENT, color: 'white', padding: embedded ? '12px 14px' : '16px 18px' }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{salon?.name}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: embedded ? 9 : 12 }}>
              {steps.map((s) => (
                <div key={s.n} style={{ flex: 1, height: 6, borderRadius: 999, background: step >= s.n ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.30)' }} />
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <div style={{ fontSize: 12, opacity: 0.95 }}>
                {step > 4 ? 'Done' : `Step ${Math.min(step, 4)} of 4 · ${currentLabel}`}
              </div>
              {!embedded && <InstallAppButton label="Get the app" />}
            </div>
          </div>
        ) : (
          <aside style={sidebar}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>{salon?.name}</div>
            {steps.map((s) => {
              const active = step === s.n; const done = step > s.n;
              return (
                <div key={s.n} style={{ ...sideStep, background: active ? 'rgba(255,255,255,0.20)' : 'transparent' }}>
                  <div style={{ ...stepBadge, background: done ? '#22c55e' : 'rgba(255,255,255,0.25)' }}>{done ? '✓' : s.n}</div>
                  <div><div style={{ fontWeight: 600, fontSize: 14 }}>{s.label}</div>{s.summary && <div style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>{s.summary}</div>}</div>
                </div>
              );
            })}
            <div style={{ marginTop: 'auto', paddingTop: 24 }}>
              {!embedded && <InstallAppButton label="Install this booking app" />}
            </div>
            <a href="https://lumioagency.com/" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, opacity: 0.85, paddingTop: 16, color: 'white', textDecoration: 'none' }}>
              Powered by <span style={{ fontWeight: 700 }}>Lumio Booking</span>
            </a>
            <div style={{ fontSize: 11, opacity: 0.8, marginTop: 8, display: 'flex', gap: 12 }}>
              <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'white', textDecoration: 'none' }}>Privacy</a>
              <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'white', textDecoration: 'none' }}>Messaging Terms</a>
            </div>
          </aside>
        )}

        <section key={step} className="lumio-step" style={isMobile ? contentMobile : content}>
          {step === 1 && (
            <>
              <DealsBanner wd={salon?.weekdayDiscounts} dd={salon?.dateDiscounts} categories={categories} />
              <StepDateTime rules={rules} deals={salon?.weekdayDiscounts} dateDeals={salon?.dateDiscounts} selectedDate={selectedDate} slot={slot}
                onPickDate={(d) => { setSelectedDate(d); setSlot(null); }}
                onPickSlot={setSlot}
                onContinue={() => slot && setStep(2)}
                waitlist={<WaitlistCta base={base} preferredDate={selectedDate} serviceId={serviceId || undefined} fmtAccent={accent} />} />
            </>
          )}

          {step === 2 && (
            <StepFrame title="Choose a service" canContinue={!!serviceId} onContinue={() => service && setStep(3)} onBack={() => setStep(1)}>
              <ServiceMenu
                services={services} categories={categories}
                search={svcSearch} setSearch={setSvcSearch}
                activeCat={activeCat} setActiveCat={setActiveCat}
                selectedId={serviceId}
                onSelect={(id) => { setServiceId(id); setAddonIds([]); setStaffId(''); }}
                fmt={fmt}
              />
              {serviceAddons.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <span style={fieldLabel}>Add-ons (optional)</span>
                  <div style={{ display: 'grid', gap: 8 }}>
                    {serviceAddons.map((a) => {
                      const on = addonIds.includes(a.id);
                      return (
                        <button key={a.id} type="button" onClick={() => { setAddonIds((p) => p.includes(a.id) ? p.filter((x) => x !== a.id) : [...p, a.id]); setStaffId(''); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left', border: `1px solid ${on ? ACCENT : '#e2e8f0'}`, background: on ? '#eef2ff' : 'white' }}>
                          <span style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${on ? ACCENT : '#cbd5e1'}`, background: on ? ACCENT : 'white', color: 'white', display: 'grid', placeItems: 'center', fontSize: 12 }}>{on ? '✓' : ''}</span>
                          <span style={{ flex: 1, color: '#1e293b', fontSize: 14 }}>{a.name}</span>
                          <span style={{ color: '#64748b', fontSize: 13 }}>+{a.durationMinutes}m</span>
                          <span style={{ color: '#16a34a', fontSize: 14, fontWeight: 600 }}>+{fmt(a.priceCents)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {service && services.filter((s) => s.id !== serviceId).length > 0 && (
                <AddMoreServices
                  services={services.filter((s) => s.id !== serviceId)}
                  selectedIds={extraServiceIds}
                  onToggle={(id) => { setExtraServiceIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]); setStaffId(''); }}
                  fmt={fmt}
                />
              )}
              {service && serviceDiscount > 0 && (
                <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, background: 'linear-gradient(90deg,#fee2e2,#fef3c7)', border: '1px solid #fca5a5', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ background: '#ef4444', color: '#fff', borderRadius: 8, padding: '3px 9px', fontSize: 14, fontWeight: 800 }}>-{serviceDiscount}%</span>
                  <span style={{ color: '#9a3412', fontSize: 13, fontWeight: 600 }}>Special offer on {service.name} 🎉</span>
                </div>
              )}
              {service && weekdayPct > 0 && selectedDate && (
                <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, background: 'linear-gradient(90deg,#dcfce7,#d1fae5)', border: '1px solid #6ee7b7', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ background: '#16a34a', color: '#fff', borderRadius: 8, padding: '3px 9px', fontSize: 14, fontWeight: 800 }}>-{weekdayPct}%</span>
                  <span style={{ color: '#065f46', fontSize: 13, fontWeight: 600 }}>{WEEKDAY_NAMES[selectedDate.getDay()]} deal applied — you save {fmt(savingsCents)} 🎉</span>
                </div>
              )}
              {service && (
                <div style={{ marginTop: 12, padding: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14 }}>
                  <span style={{ color: '#64748b' }}>Total ({totalDuration} min){extraServices.length > 0 ? ` · ${1 + extraServices.length} services` : ''}</span>
                  <span>
                    {anyDiscount && <span style={{ textDecoration: 'line-through', color: '#94a3b8', marginRight: 8 }}>{fmt(service.priceCents + addonsCents + extrasFull)}</span>}
                    <strong style={{ color: anyDiscount ? '#dc2626' : '#1e293b', fontSize: 16 }}>{fmt(totalCents)}</strong>
                  </span>
                </div>
              )}
            </StepFrame>
          )}

          {step === 3 && service && slot && (
            <StepTechnician
              rules={rules} staff={staff} avail={avail} slot={slot}
              durationMinutes={totalDuration} staffId={staffId}
              allowChoose={rules.allowCustomerChooseStaff}
              onStaff={setStaffId}
              onBack={() => setStep(2)} onContinue={() => setStep(4)} />
          )}

          {step === 4 && service && slot && (() => {
            const hasPhone = form.phone.trim().length > 0;
            const hasEmail = form.email.trim().length > 0;
            const phoneValid = isValidPhone(form.phone);
            const emailValid = isValidEmail(form.email);
            const showPhoneError = hasPhone && !phoneValid;
            const showEmailError = hasEmail && !emailValid;
            // Phone is the REQUIRED contact (reliable reach + cuts spam bookings).
            // Email is optional. Receiving MARKETING texts is never required — that
            // opt-in stays a separate, unchecked checkbox below, so we remain clear of
            // "SMS marketing consent as a condition of service".
            const emailOk = !hasEmail || emailValid; // optional: ok if empty or valid
            const phoneOk = hasPhone && phoneValid; // required
            const infoOk = form.firstName.trim().length > 0 && phoneOk && emailOk;
            // Customer details + birthday are collected HERE on the final step so the
            // booking flow is shorter (no separate "Your information" step). This block
            // renders at the top of the payment step.
            const infoForm = (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#334155', marginBottom: 12 }}>Your details</div>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
                  <Field label="First name" required><input style={field} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
                  <Field label="Last name"><input style={field} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
                  <Field label="People"><input style={field} type="number" min={1} max={20} value={form.partySize} onChange={(e) => setForm({ ...form, partySize: e.target.value })} /></Field>
                  <Field label="Email (optional)">
                    <input
                      style={{ ...field, borderColor: showEmailError ? '#ef4444' : '#cbd5e1' }}
                      type="email" value={form.email} placeholder="you@email.com"
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                    />
                    {showEmailError
                      ? <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>Please enter a valid email address.</div>
                      : <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 4 }}>We&rsquo;ll email your receipt &amp; members-only offers 💌</div>}
                  </Field>
                  <Field label="Phone" required>
                    <input
                      style={{ ...field, borderColor: showPhoneError ? '#ef4444' : '#cbd5e1' }}
                      value={form.phone} inputMode="tel" placeholder="e.g. (201) 555-0123"
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    />
                    {showPhoneError && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>Please enter a valid phone number (8–15 digits).</div>}
                  </Field>
                </div>
                <div style={{ marginTop: 10, fontSize: 12.5, fontWeight: 500, color: !phoneOk ? '#ef4444' : '#64748b' }}>
                  We&rsquo;ll text &amp; call you about this appointment. Add an email too for your receipt <span style={{ color: '#94a3b8' }}>(optional)</span>.
                </div>
                <div style={{ marginTop: 14, maxWidth: isMobile ? '100%' : 300 }}>
                  <Field label="🎂 Birthday (optional)">
                    <BirthdayInput value={form.birthDate} onChange={(iso) => setForm({ ...form, birthDate: iso })} />
                  </Field>
                  <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 4 }}>Share it and we&rsquo;ll send you a birthday treat 🎁</div>
                </div>
                {/* SMS consent — transactional disclosure + optional marketing opt-in (A2P 10DLC). */}
                <div style={{ marginTop: 18, padding: '14px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span aria-hidden style={{ fontSize: 15 }}>📱</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>Appointment text updates</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: '#64748b' }}>
                    We&rsquo;ll text you confirmations &amp; reminders for this appointment from {salon?.name || 'the salon'}. Up to ~6 msgs/month.
                    Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help.
                  </p>
                  <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 10, cursor: 'pointer' }}>
                    <input type="checkbox" checked={smsConsent} onChange={(e) => setSmsConsent(e.target.checked)} style={{ marginTop: 2, width: 16, height: 16, accentColor: accent, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, color: '#475569', lineHeight: 1.5 }}>
                      Also send me special offers &amp; promotions by text <span style={{ color: '#94a3b8' }}>(optional)</span>
                    </span>
                  </label>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 9 }}>
                    <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: accent, textDecoration: 'none', fontWeight: 600 }}>Privacy</a>
                    <span style={{ margin: '0 6px' }}>·</span>
                    <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: accent, textDecoration: 'none', fontWeight: 600 }}>Messaging Terms</a>
                    <span> · Opt-in data never shared.</span>
                  </div>
                </div>
                {!infoOk && <p style={{ color: '#94a3b8', fontSize: 12, marginTop: 10 }}>Enter your first name and phone number to confirm. Email is optional.</p>}
                <div style={{ borderTop: '1px solid #e2e8f0', marginTop: 20 }} />
              </div>
            );
            return (
              <StepPayment service={service} employee={employee} slot={slot} addons={paymentItems} totalCents={totalCents} depositCents={depositCents}
                fmt={fmt} onlineEnabled={rules.onlinePaymentEnabled} payLaterEnabled={rules.payLaterEnabled}
                paymentType={paymentType} setPaymentType={setPaymentType} error={error} submitting={submitting}
                header={infoForm} canConfirm={infoOk}
                onBack={() => setStep(3)} onConfirm={submit} />
            );
          })()}

          {step === 5 && (
            <Center>
              <div style={{ textAlign: 'center', maxWidth: 360 }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#dcfce7', color: '#16a34a', fontSize: 34, display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}>✓</div>
                <h2 style={{ color: '#16a34a', margin: '4px 0' }}>Booking received</h2>
                <p style={{ color: '#475569', lineHeight: 1.6 }}>
                  Thanks {form.firstName}! Your booking for <strong>{service?.name}</strong> on{' '}
                  <strong>{slot && `${slot.start.toLocaleDateString('en-US')} at ${fmtTime(slot.start)}`}</strong> is received.
                </p>
                <p style={{ color: '#475569' }}>Payment: <strong>{result?.paymentStatus === 'PAID' ? 'Paid online ✓' : 'Pay at the salon'}</strong></p>
                <button onClick={reset} style={primaryBtn}>Book another</button>
              </div>
            </Center>
          )}
        </section>
        {isMobile && (
          <a href="https://lumioagency.com/" target="_blank" rel="noopener noreferrer"
            style={{ textAlign: 'center', padding: '12px 0 calc(82px + env(safe-area-inset-bottom, 0px))', fontSize: 11, color: '#94a3b8', textDecoration: 'none', borderTop: '1px solid #eef1f6', background: 'white' }}>
            Powered by <span style={{ color: ACCENT, fontWeight: 700 }}>Lumio Booking</span>
          </a>
        )}
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Date & time (the customer locks in a date AND a time slot first)
// ---------------------------------------------------------------------------
function StepDateTime({ rules, deals, dateDeals, selectedDate, slot, onPickDate, onPickSlot, onContinue, waitlist }: {
  rules: BookingRules; deals?: WeekdayDiscounts; dateDeals?: DateDiscounts; selectedDate: Date | null; slot: Slot | null;
  onPickDate: (d: Date) => void; onPickSlot: (s: Slot) => void; onContinue: () => void; waitlist?: React.ReactNode;
}) {
  // Highest discount % per weekday (0=Sun..6=Sat) so we can make deal days pop in
  // the calendar. Uses the best rule across categories to entice the customer.
  const dealByWeekday = useMemo(() => {
    const m: Record<number, number> = {};
    if (deals?.enabled && Array.isArray(deals.rules)) {
      for (const r of deals.rules) {
        if (r.percent > 0) m[r.day] = Math.max(m[r.day] || 0, Math.min(90, r.percent));
      }
    }
    return m;
  }, [deals]);
  const hasDeals = Object.keys(dealByWeekday).length > 0 || !!(dateDeals?.enabled && Array.isArray(dateDeals.rules) && dateDeals.rules.length > 0);
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const maxDate = useMemo(() => { const d = new Date(today); d.setDate(d.getDate() + rules.maxAdvanceDays); return d; }, [today, rules.maxAdvanceDays]);
  const [view, setView] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const days = useMemo(() => buildMonth(view), [view]);
  const monthLabel = view.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  // Candidate start times for the day, spaced by the salon's slot step. The
  // real service duration is applied later (technician step + backend).
  const times = useMemo(
    () => (selectedDate ? generateSlots(selectedDate, rules.slotStepMinutes, rules) : []),
    [selectedDate, rules],
  );

  // Next few open days (today onward, within the booking window, not closed) so a
  // customer can jump straight to the soonest date without scanning the grid.
  const earliestOpen = useMemo(() => {
    const out: Date[] = [];
    const cur = new Date(today);
    for (let i = 0; i < 120 && out.length < 4; i++) {
      if (cur >= today && cur <= maxDate && !isClosedDay(cur, rules)) out.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, maxDate, rules]);

  // After a date is chosen, scroll the time list into view so customers don't
  // miss it (the time picker sits below the calendar fold).
  const slotsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!selectedDate || !slotsRef.current) return;
    const t = setTimeout(() => slotsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 90);
    return () => clearTimeout(t);
  }, [selectedDate]);

  return (
    <StepFrame title="Pick a date & time" canContinue={!!slot} onContinue={onContinue}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <strong style={{ color: '#1e293b' }}>{monthLabel}</strong>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={navBtn} onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}>‹</button>
          <button style={navBtn} onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}>›</button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 5 }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8', padding: '2px 0', fontWeight: 600 }}>{d}</div>)}
        {days.map((d, i) => {
          if (!d) return <div key={i} />;
          const disabled = d < today || d > maxDate || isClosedDay(d, rules);
          const sel = selectedDate && sameDay(d, selectedDate);
          const pct = disabled ? 0 : Math.max(dealByWeekday[d.getDay()] || 0, datePctFor(dateDeals, d, null));
          const deal = pct > 0;
          return (
            <button key={i} disabled={disabled} onClick={() => onPickDate(d)}
              title={deal ? `Save ${pct}% on this day` : undefined}
              style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
                minHeight: 46, borderRadius: 9, fontSize: 14, cursor: disabled ? 'not-allowed' : 'pointer',
                border: sel ? `2px solid ${ACCENT}` : deal ? '1px solid #e8f4ee' : '1px solid #e2e8f0',
                background: sel ? '#eef2ff' : disabled ? '#f8fafc' : deal ? '#f9fdfb' : 'white',
                color: disabled ? '#cbd5e1' : '#1e293b',
                fontWeight: sel ? 700 : 400 }}>
              {d.getDate()}
              {deal && <span style={{ position: 'absolute', top: 0, right: 0, width: 0, height: 0, borderTop: '14px solid #34d399', borderLeft: '14px solid transparent' }} />}
            </button>
          );
        })}
      </div>

      {hasDeals && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 14, fontSize: 12.5, color: '#64748b', fontWeight: 400 }}>
          <span style={{ width: 0, height: 0, borderTop: '11px solid #34d399', borderLeft: '11px solid transparent', flexShrink: 0 }} />
          Days with a corner tag have a discount — applied automatically.
        </div>
      )}
      {!selectedDate && (
        <div style={{ marginTop: 18, textAlign: 'center', padding: '22px 16px 24px', border: '1px dashed #dbe4ee', borderRadius: 16, background: '#fbfdff' }}>
          <span style={{ display: 'inline-grid', placeItems: 'center', width: 46, height: 46, borderRadius: 14, background: '#eef2ff', color: ACCENT }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M8 2v4M16 2v4M3 10h18M8 15h.01M12 15h.01M16 15h.01" /></svg>
          </span>
          <div style={{ fontSize: 15.5, fontWeight: 700, color: '#334155', marginTop: 10 }}>Pick a day to see open times</div>
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 4, lineHeight: 1.5 }}>Tap a date above. Greyed-out days are closed or outside the booking window.</div>
          {earliestOpen.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 11.5, color: '#64748b', fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 9 }}>Soonest available</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                {earliestOpen.map((d, i) => {
                  const pct = Math.max(dealByWeekday[d.getDay()] || 0, datePctFor(dateDeals, d, null));
                  return (
                    <button key={i} onClick={() => onPickDate(d)}
                      style={{ padding: '9px 13px', borderRadius: 999, border: `1.5px solid ${ACCENT}`, background: 'white', color: ACCENT, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      {pct > 0 && <span style={{ fontSize: 10, fontWeight: 800, color: '#059669', background: '#d1fae5', borderRadius: 6, padding: '1px 5px' }}>-{pct}%</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {selectedDate && (
        <div ref={slotsRef} style={{ marginTop: 18, scrollMarginTop: 16 }}>
          <div style={{ fontSize: 13, color: '#475569', marginBottom: 8, fontWeight: 600 }}>
            {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} — choose a time ↓
          </div>
          {times.length === 0 ? (
            <p style={{ color: '#94a3b8', fontSize: 14 }}>No available times on this day.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(86px, 1fr))', gap: 8 }}>
              {times.map((s, i) => {
                const sel = slot && s.start.getTime() === slot.start.getTime();
                return (
                  <button key={i} className="lumio-opt" onClick={() => onPickSlot(s)}
                    style={{ padding: '10px 6px', borderRadius: 8, fontSize: 13, cursor: 'pointer', fontWeight: sel ? 700 : 400,
                      border: `1px solid ${sel ? ACCENT : '#e2e8f0'}`, background: sel ? ACCENT : 'white', color: sel ? 'white' : '#1e293b' }}>
                    {fmtTime(s.start)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {waitlist}
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Technician — only technicians free at the already-chosen time are
// selectable. Busy ones are greyed out so the same tech can't be double-booked.
// ---------------------------------------------------------------------------
function StepTechnician({ rules, staff, avail, slot, durationMinutes, staffId, allowChoose, onStaff, onBack, onContinue }: {
  rules: BookingRules; staff: Staff[]; avail: Availability | null; slot: Slot; durationMinutes: number;
  staffId: string; allowChoose: boolean;
  onStaff: (id: string) => void; onBack: () => void; onContinue: () => void;
}) {
  // The real interval this booking will occupy = chosen start + service duration.
  const checkSlot: Slot = useMemo(
    () => ({ start: slot.start, end: new Date(slot.start.getTime() + durationMinutes * 60_000) }),
    [slot.start, durationMinutes],
  );

  // Does the service still fit inside business hours from the chosen start?
  const close = rules.businessHours[slot.start.getDay()]?.closeMinutes ?? 1440;
  const endMins = slot.start.getHours() * 60 + slot.start.getMinutes() + durationMinutes;
  const overflow = endMins > close;

  const loading = avail === null;
  const noStaff = staff.length === 0; // salon hasn't added any technicians yet
  const eligible = avail ? staff.filter((s) => avail.eligibleStaffIds.includes(s.id)) : [];
  const isBusy = (id: string) => overlaps(checkSlot, avail?.staffBusy[id] ?? []);
  const anyFree = avail ? avail.eligibleStaffIds.some((id) => !isBusy(id)) : false;

  const selectedBusy = !!staffId && isBusy(staffId);
  // With no technicians configured, the salon assigns later — let the customer through.
  const canContinue = !loading && !overflow && (noStaff
    ? true
    : allowChoose
      ? (staffId ? !selectedBusy : anyFree)
      : anyFree);

  return (
    <StepFrame title="Choose a technician" canContinue={canContinue} onContinue={onContinue} onBack={onBack}>
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', marginBottom: 16, fontSize: 13, color: '#475569' }}>
        Selected time: <strong style={{ color: '#1e293b' }}>{slot.start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {fmtTime(checkSlot.start)} – {fmtTime(checkSlot.end)}</strong>
      </div>

      {overflow && (
        <div style={{ background: '#fef3c7', color: '#92400e', padding: '10px 12px', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>
          This service ({durationMinutes} min) doesn’t finish before closing time. Please go back and pick an earlier time.
        </div>
      )}

      {loading ? (
        <p style={{ color: '#94a3b8', fontSize: 14 }}>Checking availability…</p>
      ) : noStaff ? (
        <div style={{ fontSize: 14, color: '#334155', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px 14px' }}>
          The salon will assign a technician for your appointment. Just tap <strong>Continue</strong>.
        </div>
      ) : eligible.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: 14 }}>No technician offers this service yet.</p>
      ) : !allowChoose ? (
        <div style={{ fontSize: 14, color: '#334155' }}>
          {anyFree
            ? 'A technician will be automatically assigned for your selected time.'
            : 'All technicians are booked at this time. Please go back and choose another time.'}
        </div>
      ) : (
        <>
          <span style={fieldLabel}>Technician</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
            <TechCard selected={!staffId} disabled={!anyFree} onClick={() => anyFree && onStaff('')} label="Any" avatar={null}
              subtitle={anyFree ? 'Auto' : 'Full'} />
            {eligible.map((m) => {
              const busy = isBusy(m.id);
              return (
                <TechCard key={m.id} selected={staffId === m.id} disabled={busy}
                  onClick={() => !busy && onStaff(m.id)}
                  label={`${m.firstName} ${m.lastName ?? ''}`.trim()} avatar={m.avatarUrl}
                  subtitle={busy ? 'Booked' : 'Available'} />
              );
            })}
          </div>
          <p style={{ color: '#64748b', fontSize: 12, marginTop: 12 }}>
            Technicians marked <strong>Booked</strong> already have an appointment at this time and can’t be selected.
          </p>
        </>
      )}
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// Step 5: Payment
// ---------------------------------------------------------------------------
function StepPayment({ service, employee, slot, addons, totalCents, depositCents, fmt, onlineEnabled, payLaterEnabled, paymentType, setPaymentType, error, submitting, onBack, onConfirm, header, canConfirm = true }: {
  service: Service; employee: Staff | null; slot: Slot; addons: Addon[]; totalCents: number; depositCents: number; fmt: (c: number) => string;
  onlineEnabled: boolean; payLaterEnabled: boolean; paymentType: 'PAY_ONLINE' | 'PAY_LATER'; setPaymentType: (t: 'PAY_ONLINE' | 'PAY_LATER') => void;
  error: string | null; submitting: boolean; onBack: () => void; onConfirm: () => void;
  header?: React.ReactNode; canConfirm?: boolean;
}) {
  useEffect(() => {
    if (!onlineEnabled && paymentType === 'PAY_ONLINE' && payLaterEnabled) setPaymentType('PAY_LATER');
    else if (!payLaterEnabled && paymentType === 'PAY_LATER' && onlineEnabled) setPaymentType('PAY_ONLINE');
  }, [onlineEnabled, payLaterEnabled]);

  // Pay-at-salon is the only path and nothing is due now → no choice to make.
  const onlyPayAtSalon = payLaterEnabled && !onlineEnabled && depositCents === 0;

  return (
    <div style={frameRoot}>
      <h2 style={stepTitle}>{header ? 'Your details & payment' : 'Payment'}</h2>
      <div style={scrollArea}>
        {header}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 18 }}>
          <Row k="Service" v={`${service.name} (${fmt(svcNetCents(service))})`} />
          {svcDiscount(service) > 0 && <Row k={`Discount −${svcDiscount(service)}%`} v={`− ${fmt(service.priceCents - svcNetCents(service))}`} />}
          {addons.map((a) => <Row key={a.id} k={`+ ${a.name}`} v={fmt(a.priceCents)} />)}
          <Row k="Technician" v={employee ? `${employee.firstName} ${employee.lastName ?? ''}` : 'Any available'} />
          <Row k="When" v={`${slot.start.toLocaleDateString('en-US')} · ${fmtTime(slot.start)} – ${fmtTime(slot.end)}`} />
          <div style={{ borderTop: '1px solid #e2e8f0', margin: '10px 0' }} />
          <Row k="Total" v={fmt(totalCents)} bold />
          {depositCents > 0 && (
            <div style={{ marginTop: 10, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#1e3a8a' }}>
              💳 Deposit to hold your spot: <strong>{fmt(depositCents)}</strong> now · the rest ({fmt(totalCents - depositCents)}) at the salon.
            </div>
          )}
        </div>
        {onlyPayAtSalon ? (
          // Only one way to pay and nothing due now — skip the choice entirely so
          // the customer isn't asked to "pick" from a single option.
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 14px', fontSize: 14, color: '#166534' }}>
            💵 Nothing to pay now — just reserve your spot and pay at the salon after your appointment.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 8 }}>Choose payment</div>
            <div style={{ display: 'grid', gap: 10 }}>
              {onlineEnabled && <PayOption selected={paymentType === 'PAY_ONLINE'} onClick={() => setPaymentType('PAY_ONLINE')} title="Pay online now" desc="Pay securely now (demo: mock payment)." />}
              {payLaterEnabled && <PayOption selected={paymentType === 'PAY_LATER'} onClick={() => setPaymentType('PAY_LATER')} title="Pay at the salon" desc="Reserve now, pay when you arrive." />}
            </div>
          </>
        )}
        {error && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginTop: 14 }}>{error}</div>}
      </div>
      <div style={footer}>
        <button onClick={onBack} style={ghostBtn}>Back</button>
        <button onClick={onConfirm} disabled={submitting || !canConfirm} style={{ ...primaryBtn, opacity: submitting || !canConfirm ? 0.5 : 1, cursor: submitting || !canConfirm ? 'not-allowed' : 'pointer' }}>{submitting ? 'Booking…' : paymentType === 'PAY_ONLINE' ? 'Pay & book' : 'Confirm booking'}</button>
      </div>
    </div>
  );
}

function PayOption({ selected, onClick, title, desc }: { selected: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button onClick={onClick} style={{ textAlign: 'left', padding: 14, borderRadius: 10, cursor: 'pointer', border: `2px solid ${selected ? ACCENT : '#e2e8f0'}`, background: selected ? '#eef2ff' : 'white' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${selected ? ACCENT : '#cbd5e1'}`, display: 'grid', placeItems: 'center' }}>{selected && <span style={{ width: 9, height: 9, borderRadius: '50%', background: ACCENT }} />}</span>
        <strong style={{ color: '#1e293b', fontSize: 14 }}>{title}</strong>
      </div>
      <div style={{ color: '#64748b', fontSize: 13, marginTop: 4, marginLeft: 28 }}>{desc}</div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Shared frame + small components
// ---------------------------------------------------------------------------
function StepFrame({ title, children, canContinue, onContinue, onBack }: { title: string; children: React.ReactNode; canContinue: boolean; onContinue: () => void; onBack?: () => void }) {
  const isMobile = useIsMobile();
  const embedded = useEmbedded();
  // Inside a host site's iframe, flow naturally: a fixed action bar would get
  // pinned to the bottom of a tall iframe, leaving a big empty gap. Static footer
  // + content height lets the iframe shrink to fit the form.
  const wide = isMobile || embedded;
  // Embedded: the moment a choice enables Continue, ask the host page to scroll the
  // action bar into view, so the visitor never has to hunt for it at the end of a
  // long service list.
  const footerRef = useRef<HTMLDivElement | null>(null);
  const prevCan = useRef(canContinue);
  useEffect(() => {
    const was = prevCan.current;
    prevCan.current = canContinue;
    if (!embedded || !canContinue || was) return;
    const el = footerRef.current;
    if (!el) return;
    const y = Math.round(el.getBoundingClientRect().top + (window.scrollY || 0));
    try { window.parent.postMessage({ type: 'lumio-embed-reveal', y, h: el.offsetHeight }, '*'); } catch { /* ignore */ }
  }, [canContinue, embedded]);
  // Inside an iframe, a touch scroll that reaches the end of this inner list does NOT
  // chain out to the host page (iOS especially), so the site feels "stuck" until you
  // find a spot outside the form. Forward the overscroll to the parent, which then
  // scrolls the website for us (the WordPress embed listens for this).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastY = useRef(0);
  const onTouchStart = (e: React.TouchEvent) => { lastY.current = e.touches[0]?.clientY ?? 0; };
  const onTouchMove = (e: React.TouchEvent) => {
    const el = scrollRef.current;
    if (!embedded || !el) return;
    if (el.scrollHeight <= el.clientHeight + 1) return; // no inner scroller -> let the page scroll natively
    const y = e.touches[0]?.clientY ?? 0;
    const dy = lastY.current - y; // > 0 = swiping up (content scrolls down)
    lastY.current = y;
    if (!dy) return;
    const atTop = el.scrollTop <= 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    if ((dy > 0 && atBottom) || (dy < 0 && atTop)) {
      try { window.parent.postMessage({ type: 'lumio-embed-scroll', dy }, '*'); } catch { /* ignore */ }
    }
  };
  return (
    <div style={isMobile ? frameRootEmbed : frameRoot}>
      <h2 style={stepTitle}>{title}</h2>
      <div ref={scrollRef} onTouchStart={onTouchStart} onTouchMove={onTouchMove}
        style={{ ...(isMobile ? scrollAreaEmbed : scrollArea), ...(embedded && !isMobile ? { overscrollBehavior: 'contain' as const } : {}) }}>{children}</div>
      <div ref={footerRef} style={embedded ? footerEmbed : (isMobile ? footerMobile : footer)}>
        {onBack ? <button onClick={onBack} style={{ ...ghostBtn, ...(wide ? { flexShrink: 0 } : {}) }}>Back</button> : (isMobile && !embedded ? null : <span />)}
        <button onClick={onContinue} disabled={!canContinue} className="lumio-cta"
          style={{ ...primaryBtn, ...(wide ? { flex: 1, padding: '13px 22px', fontSize: 15 } : {}), opacity: canContinue ? 1 : 0.5, cursor: canContinue ? 'pointer' : 'not-allowed' }}>
          Continue
        </button>
      </div>
    </div>
  );
}
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label style={{ display: 'block', marginBottom: 16 }}><span style={fieldLabel}>{required && <span style={{ color: '#ef4444' }}>* </span>}{label}:</span>{children}</label>;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Birthday entry as three dropdowns (Month name / Day / Year), always English and
 * in M/D/Y order — independent of the browser's locale (the native <input type=date>
 * calendar followed the OS language). Value in/out is ISO 'YYYY-MM-DD' so nothing
 * downstream changes. Day list adapts to the chosen month/year.
 */
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
    } else {
      onChange('');
    }
  };
  const clampDay = (m: string, y: string, d: string) => {
    if (d && parseInt(d, 10) > daysInMonth(m, y)) { const nd = String(daysInMonth(m, y)); setDd(nd); return nd; }
    return d;
  };
  const onMonth = (m: string) => { setMm(m); emit(m, clampDay(m, yy, dd), yy); };
  const onDay = (d: string) => { setDd(d); emit(mm, d, yy); };
  const onYear = (y: string) => { setYy(y); emit(mm, clampDay(mm, y, dd), y); };

  const now = new Date().getFullYear();
  const years: number[] = [];
  for (let y = now; y >= 1920; y--) years.push(y);
  const maxDay = daysInMonth(mm, yy);
  const days: number[] = [];
  for (let d = 1; d <= maxDay; d++) days.push(d);
  const sel: React.CSSProperties = { ...field, appearance: 'auto', cursor: 'pointer' };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1.1fr', gap: 8 }}>
      <select style={sel} value={mm} onChange={(e) => onMonth(e.target.value)} aria-label="Birth month">
        <option value="">Month</option>
        {MONTH_NAMES.map((name, i) => <option key={i} value={String(i + 1)}>{name}</option>)}
      </select>
      <select style={sel} value={dd} onChange={(e) => onDay(e.target.value)} aria-label="Birth day">
        <option value="">Day</option>
        {days.map((d) => <option key={d} value={String(d)}>{d}</option>)}
      </select>
      <select style={sel} value={yy} onChange={(e) => onYear(e.target.value)} aria-label="Birth year">
        <option value="">Year</option>
        {years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
      </select>
    </div>
  );
}
function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 14 }}><span style={{ color: '#64748b' }}>{k}</span><span style={{ color: '#1e293b', fontWeight: bold ? 700 : 500 }}>{v}</span></div>;
}

function ServiceMenu({ services, categories, search, setSearch, activeCat, setActiveCat, selectedId, onSelect, fmt }: {
  services: Service[]; categories: Category[]; search: string; setSearch: (v: string) => void;
  activeCat: string; setActiveCat: (v: string) => void; selectedId: string; onSelect: (id: string) => void; fmt: (c: number) => string;
}) {
  const featured = services.filter((s) => s.isFeatured);
  const uncategorised = services.filter((s) => !s.categoryId);
  const q = search.trim().toLowerCase();
  const matches = (s: Service) => !q || `${s.name} ${s.description ?? ''}`.toLowerCase().includes(q);
  const inCat = (catId: string) => services.filter((s) => s.categoryId === catId);
  const chosen = services.find((s) => s.id === selectedId) || null;

  // How the big booking apps (Fresha, Booksy, Square) show a menu on a phone:
  // never dump the whole price list. Category TABS on top, ONE short list below,
  // and the moment a service is picked the list collapses to a single line — so the
  // total and the Continue button are always right under the visitor's thumb.
  const tabs: { key: string; label: string }[] = [
    ...(featured.length > 0 ? [{ key: 'popular', label: '⭐ Popular' }] : []),
    ...categories.filter((c) => inCat(c.id).length > 0).map((c) => ({ key: c.id, label: c.name })),
    ...(uncategorised.length > 0 ? [{ key: 'none', label: 'Other' }] : []),
  ];
  const active = tabs.some((t) => t.key === activeCat) ? activeCat : (tabs[0]?.key ?? 'all');

  const [picking, setPicking] = useState(!selectedId);
  useEffect(() => { if (!selectedId) setPicking(true); }, [selectedId]);

  // Never show more than a screenful at once — even a category with 20 services
  // stays 6 rows tall, with a "Show more" button underneath. Keeps the Continue
  // button in view no matter how big the salon's menu is.
  const PAGE = 6;
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { setLimit(PAGE); }, [activeCat, search]);

  const listFor = (key: string): Service[] => {
    if (key === 'popular') return featured;
    if (key === 'none') return uncategorised;
    const inc = inCat(key);
    return inc.length ? inc : services;
  };
  const visible = q ? services.filter(matches) : listFor(active);

  // ---- Picked: one tidy line + Change ----------------------------------------
  if (chosen && !picking) {
    const d = svcDiscount(chosen); const net = svcNetCents(chosen);
    return (
      <div style={{ marginBottom: 16 }}>
        <span style={fieldLabel}>Your service:</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, border: `2px solid ${ACCENT}`, background: 'rgba(99,102,241,0.05)' }}>
          <span style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, background: ACCENT, color: 'white', display: 'grid', placeItems: 'center', fontSize: 14, fontWeight: 700 }}>✓</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: '#1e293b' }}>{chosen.name}</span>
            <span style={{ display: 'block', fontSize: 13, color: '#64748b', marginTop: 2 }}>
              {chosen.durationMinutes} min ·{' '}
              {d > 0 && <span style={{ textDecoration: 'line-through', color: '#94a3b8', marginRight: 4 }}>{fmt(chosen.priceCents)}</span>}
              <b style={{ color: d > 0 ? '#dc2626' : '#1e293b' }}>{chosen.priceFrom ? 'from ' : ''}{fmt(net)}</b>
            </span>
          </span>
          <button type="button" onClick={() => { setSearch(''); setPicking(true); }}
            style={{ flexShrink: 0, fontSize: 13, fontWeight: 700, color: ACCENT, background: 'white', border: `1px solid ${ACCENT}`, borderRadius: 999, padding: '7px 14px', cursor: 'pointer' }}>
            Change
          </button>
        </div>
      </div>
    );
  }

  // ---- Picking: tabs + one short list ----------------------------------------
  return (
    <div style={{ marginBottom: 16 }}>
      {tabs.length > 1 && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 8, marginBottom: 10 }}>
          {tabs.map((t) => {
            const on = !q && active === t.key;
            return (
              <button key={t.key} type="button" onClick={() => { setSearch(''); setActiveCat(t.key); }}
                style={{ whiteSpace: 'nowrap', fontSize: 13, padding: '8px 14px', borderRadius: 999, cursor: 'pointer',
                  border: on ? `1px solid ${ACCENT}` : '1px solid #e2e8f0',
                  background: on ? ACCENT : 'white', color: on ? 'white' : '#475569', fontWeight: 600 }}>
                {t.label}
              </button>
            );
          })}
        </div>
      )}
      <div style={{ position: 'relative', marginBottom: 10 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search services…" style={{ ...field, paddingLeft: 36 }} />
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>⌕</span>
      </div>
      {visible.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: 14, margin: '8px 0' }}>No services match “{search}”.</p>
      ) : visible.slice(0, limit).map((s) => {
        const d = svcDiscount(s); const net = svcNetCents(s); const on = s.id === selectedId;
        return (
          <button key={s.id} type="button" className="lumio-opt"
            onClick={() => { onSelect(s.id); setSearch(''); setPicking(false); }}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', marginBottom: 6,
              border: on ? `2px solid ${ACCENT}` : '1px solid #e2e8f0', background: on ? 'rgba(99,102,241,0.06)' : 'white' }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
                {s.name}
                {s.isFeatured && <span style={{ marginLeft: 6, background: '#fef3c7', color: '#92400e', borderRadius: 6, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>POPULAR</span>}
              </span>
              <span style={{ display: 'block', fontSize: 12, color: '#64748b', marginTop: 2 }}>{s.durationMinutes} min</span>
            </span>
            <span style={{ textAlign: 'right', flexShrink: 0 }}>
              {d > 0 && <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', textDecoration: 'line-through' }}>{fmt(s.priceCents)}</span>}
              <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: d > 0 ? '#dc2626' : '#1e293b' }}>{s.priceFrom ? 'from ' : ''}{fmt(net)}</span>
            </span>
            <span style={{ flexShrink: 0, color: '#cbd5e1', fontSize: 15 }}>›</span>
          </button>
        );
      })}

      {visible.length > PAGE && (
        limit < visible.length ? (
          <button type="button" onClick={() => setLimit((v) => v + PAGE)}
            style={{ width: '100%', marginTop: 4, padding: '11px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700,
              color: ACCENT, background: 'white', border: `1px dashed ${ACCENT}` }}>
            Show more ({visible.length - limit})
          </button>
        ) : (
          <button type="button" onClick={() => setLimit(PAGE)}
            style={{ width: '100%', marginTop: 4, padding: '11px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600,
              color: '#64748b', background: 'white', border: '1px solid #e2e8f0' }}>
            Show less
          </button>
        )
      )}
    </div>
  );
}
/**
 * "Add more services" — same rules as the main menu: collapsed by default, a search
 * box, and never more than 6 rows on screen (Show more / Show less). A salon with a
 * 40-service menu must not push the Continue button off the visitor's screen.
 * Anything already ticked floats to the top so it can never hide behind "Show more".
 */
function AddMoreServices({ services, selectedIds, onToggle, fmt }: {
  services: Service[]; selectedIds: string[]; onToggle: (id: string) => void; fmt: (c: number) => string;
}) {
  const PAGE = 6;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => { setLimit(PAGE); }, [q]);

  const needle = q.trim().toLowerCase();
  const hit = (s: Service) => !needle || `${s.name} ${s.description ?? ''}`.toLowerCase().includes(needle);
  const list = services.filter(hit);
  // Ticked first, so a chosen extra is always visible.
  const ordered = [...list.filter((s) => selectedIds.includes(s.id)), ...list.filter((s) => !selectedIds.includes(s.id))];
  const n = selectedIds.length;

  return (
    <div style={{ marginBottom: 16, border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
      <button type="button" onClick={() => setOpen((v) => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '13px 14px', background: 'white', border: 0, cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ color: ACCENT, fontSize: 16, fontWeight: 800 }}>+</span>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
          Add more services{n > 0 ? '' : ' (optional)'}
        </span>
        {n > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: 'white', background: ACCENT, borderRadius: 999, padding: '2px 9px' }}>{n} added</span>}
        <span style={{ color: '#94a3b8', fontSize: 11, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease' }}>▶</span>
      </button>

      {open && (
        <div style={{ padding: '0 12px 12px' }}>
          <div style={{ position: 'relative', margin: '2px 0 10px' }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search services…" style={{ ...field, paddingLeft: 36 }} />
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>⌕</span>
          </div>

          {ordered.length === 0 ? (
            <p style={{ color: '#94a3b8', fontSize: 14, margin: '8px 0' }}>No services match “{q}”.</p>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {ordered.slice(0, limit).map((s) => {
                const on = selectedIds.includes(s.id);
                const d = svcDiscount(s);
                return (
                  <button key={s.id} type="button" onClick={() => onToggle(s.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                      border: `1px solid ${on ? ACCENT : '#e2e8f0'}`, background: on ? 'rgba(99,102,241,0.06)' : 'white' }}>
                    <span style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, border: `2px solid ${on ? ACCENT : '#cbd5e1'}`, background: on ? ACCENT : 'white', color: 'white', display: 'grid', placeItems: 'center', fontSize: 12 }}>{on ? '✓' : ''}</span>
                    <span style={{ flex: 1, minWidth: 0, color: '#1e293b', fontSize: 14, fontWeight: 500 }}>{s.name}</span>
                    <span style={{ flexShrink: 0, color: '#64748b', fontSize: 12 }}>{s.durationMinutes}m</span>
                    <span style={{ flexShrink: 0, color: d > 0 ? '#dc2626' : '#16a34a', fontSize: 14, fontWeight: 700 }}>{s.priceFrom ? 'from ' : ''}{fmt(svcNetCents(s))}</span>
                  </button>
                );
              })}
            </div>
          )}

          {ordered.length > PAGE && (
            limit < ordered.length ? (
              <button type="button" onClick={() => setLimit((v) => v + PAGE)}
                style={{ width: '100%', marginTop: 8, padding: '10px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, color: ACCENT, background: 'white', border: `1px dashed ${ACCENT}` }}>
                Show more ({ordered.length - limit})
              </button>
            ) : (
              <button type="button" onClick={() => setLimit(PAGE)}
                style={{ width: '100%', marginTop: 8, padding: '10px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#64748b', background: 'white', border: '1px solid #e2e8f0' }}>
                Show less
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

function TechCard({ selected, onClick, label, avatar, subtitle, disabled }: { selected: boolean; onClick: () => void; label: string; avatar: string | null; subtitle?: string; disabled?: boolean }) {
  const initial = (label || '?').trim().charAt(0).toUpperCase();
  const subColor = disabled ? '#ef4444' : subtitle === 'Available' ? '#16a34a' : '#64748b';
  return (
    <button type="button" className="lumio-opt" onClick={onClick} disabled={disabled} title={disabled ? 'Already booked at this time' : undefined}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px 8px', borderRadius: 10,
        cursor: disabled ? 'not-allowed' : 'pointer', border: `2px solid ${selected ? ACCENT : '#e2e8f0'}`,
        background: disabled ? '#f1f5f9' : selected ? '#eef2ff' : 'white', opacity: disabled ? 0.65 : 1 }}>
      {avatar
        ? <img src={avatar} alt={label} width={44} height={44} style={{ borderRadius: '50%', objectFit: 'cover', filter: disabled ? 'grayscale(1)' : 'none' }} />
        : <span style={{ width: 44, height: 44, borderRadius: '50%', background: disabled ? '#e2e8f0' : '#e0e7ff', color: disabled ? '#94a3b8' : ACCENT, display: 'grid', placeItems: 'center', fontSize: 17, fontWeight: 700 }}>{initial}</span>}
      <span style={{ fontSize: 12, fontWeight: 600, color: disabled ? '#94a3b8' : '#1e293b', textAlign: 'center', lineHeight: 1.2, textDecoration: disabled ? 'line-through' : 'none' }}>{label}</span>
      {subtitle && <span style={{ fontSize: 11, color: subColor, fontWeight: 600 }}>{subtitle}</span>}
    </button>
  );
}
const BOOK_CSS = `
@keyframes lumioIn { from { opacity: 0; transform: translateY(12px) scale(.99); } to { opacity: 1; transform: none; } }
@keyframes lumioStep { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.lumio-book { animation: lumioIn .5s cubic-bezier(.2,.75,.25,1) both; }
.lumio-book button { transition: transform .12s ease, box-shadow .2s ease, filter .18s ease, border-color .15s ease, background .15s ease; }
.lumio-book button:active:not(:disabled) { transform: translateY(1px) scale(.985); }
.lumio-step { animation: lumioStep .34s ease both; }
.lumio-opt:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(15,23,42,0.10); border-color: var(--accent, #6366f1) !important; }
.lumio-cta:hover:not(:disabled) { filter: brightness(1.05); box-shadow: 0 10px 24px rgba(0,0,0,0.18); }
@media (prefers-reduced-motion: reduce) { .lumio-book, .lumio-step { animation: none !important; } }
`;
function Shell({ children }: { children: React.ReactNode }) {
  // When shown inside an iframe (the WordPress plugin embed), drop the page
  // background + padding so the form blends into the host site instead of
  // showing a light panel around it. Standalone /book/:slug keeps the backdrop.
  const [embedded, setEmbedded] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    let emb = false;
    try { emb = window.self !== window.top; } catch { emb = true; }
    setEmbedded(emb);
    if (!emb) return;
    // Transparent so the embed adapts to ANY host site's background.
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    // Tell the host page how tall we are so its iframe can shrink to fit the
    // form (no empty space below). The WordPress embed listens for this message.
    document.body.style.margin = '0';
    // Measure the FORM element, never the document. Once the host page sets the
    // iframe height, <html>/<body> stretch to fill it — so document heights can
    // only ever grow, and the iframe stayed tall after a step got shorter
    // (that was the big empty white area under the form).
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
  return <><style>{BOOK_CSS}</style><div ref={rootRef} style={{ minHeight: embedded ? 0 : '100vh', background: embedded ? 'transparent' : '#eef1f6', display: 'grid', placeItems: 'center', padding: embedded ? 0 : 16 }}>{children}</div></>;
}
function useEmbedded(): boolean {
  const [emb, setEmb] = useState(false);
  useEffect(() => { try { setEmb(window.self !== window.top); } catch { setEmb(true); } }, []);
  return emb;
}
function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: '#475569', padding: 24 }}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtTime(d: Date) { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
/** Phone must be present and look like a real number: 8–15 digits, optional + and separators. */
function isValidPhone(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  const digits = s.replace(/\D/g, '');
  return /^\+?[0-9\s().-]+$/.test(s) && digits.length >= 8 && digits.length <= 15;
}
function isValidEmail(v: string): boolean {
  const s = v.trim();
  if (!s) return false;
  // name@domain.tld — no spaces, a dot in the domain, 2+ char TLD.
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}
function sameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function buildMonth(view: Date): (Date | null)[] {
  const year = view.getFullYear(), month = view.getMonth();
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
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

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const wrap: React.CSSProperties = { width: '100%', maxWidth: 900, height: 620, display: 'grid', gridTemplateColumns: '280px 1fr', background: 'white', borderRadius: 16, overflow: 'hidden', boxShadow: '0 12px 48px rgba(15,23,42,0.18)' };
// Mobile: single column, natural height, narrower card.
const wrapMobile: React.CSSProperties = { width: '100%', maxWidth: 560, display: 'flex', flexDirection: 'column', background: 'white', borderRadius: 14, overflow: 'hidden', boxShadow: '0 10px 36px rgba(15,23,42,0.16)' };
const contentMobile: React.CSSProperties = { minHeight: 0, display: 'flex', flexDirection: 'column' };
const sidebar: React.CSSProperties = { background: ACCENT, color: 'white', padding: 24, display: 'flex', flexDirection: 'column' };
const sideStep: React.CSSProperties = { display: 'flex', gap: 12, alignItems: 'center', padding: 12, borderRadius: 10, marginBottom: 6 };
const stepBadge: React.CSSProperties = { width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 };
const content: React.CSSProperties = { minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' };
const frameRoot: React.CSSProperties = { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', padding: 28 };
const scrollArea: React.CSSProperties = { flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 4 };
const stepTitle: React.CSSProperties = { fontSize: 20, margin: '0 0 16px', color: '#1e293b', borderBottom: '1px solid #e2e8f0', paddingBottom: 14 };
const fieldLabel: React.CSSProperties = { display: 'block', fontSize: 14, color: '#334155', marginBottom: 6, fontWeight: 500 };
const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 8, border: '1px solid #cbd5e1', background: 'white', color: '#1e293b', fontSize: 14 };
const footer: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #e2e8f0', paddingTop: 16, marginTop: 12 };
// Mobile: a fixed bottom action bar so Continue is always reachable without
// scrolling to the end of a long service list.
const footerMobile: React.CSSProperties = { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, display: 'flex', alignItems: 'center', gap: 12, background: 'white', borderTop: '1px solid #e2e8f0', padding: '12px 16px calc(12px + env(safe-area-inset-bottom, 0px))', boxShadow: '0 -4px 16px rgba(15,23,42,0.08)' };
// Embedded (iframe) footer: static, flows right after the content.
const footerEmbed: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, borderTop: '1px solid #e2e8f0', paddingTop: 16, marginTop: 16 };
const scrollAreaEmbed: React.CSSProperties = { flex: 'none', minHeight: 0, overflow: 'visible', paddingRight: 4 };
const frameRootEmbed: React.CSSProperties = { minHeight: 0, display: 'flex', flexDirection: 'column', padding: 20 };
const primaryBtn: React.CSSProperties = { padding: '11px 22px', borderRadius: 8, border: 'none', background: ACCENT, color: 'white', fontWeight: 600, fontSize: 14, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { padding: '11px 18px', borderRadius: 8, border: '1px solid #cbd5e1', background: 'white', color: '#475569', fontSize: 14, cursor: 'pointer' };
const navBtn: React.CSSProperties = { width: 32, height: 32, borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', color: ACCENT, fontSize: 16, cursor: 'pointer' };
