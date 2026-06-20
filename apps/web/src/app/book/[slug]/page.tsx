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
interface Salon { name: string; slug: string; timezone: string; branding?: { accentColor: string; logoUrl: string }; booking?: BookingRules; weekdayDiscounts?: WeekdayDiscounts }

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

/** Prominent banner listing the salon's quiet-day deals (shown while picking a date). */
function DealsBanner({ wd, categories }: { wd?: WeekdayDiscounts; categories: { id: string; name: string }[] }) {
  if (!wd?.enabled || !wd.rules?.length) return null;
  const catName = (id: string | null) => (id ? (categories.find((c) => c.id === id)?.name ?? 'select services') : 'everything');
  const sorted = [...wd.rules].sort((a, b) => a.day - b.day || b.percent - a.percent);
  return (
    <div style={{ marginBottom: 16, padding: '14px 16px', borderRadius: 12, background: 'linear-gradient(90deg,#ecfdf5,#d1fae5)', border: '1px solid #6ee7b7' }}>
      <div style={{ fontWeight: 800, color: '#065f46', marginBottom: 8, fontSize: 15 }}>💸 {wd.message || 'Save on quieter days!'}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {sorted.map((r, i) => (
          <span key={i} style={{ background: '#fff', border: '1px solid #6ee7b7', borderRadius: 999, padding: '4px 12px', fontSize: 13, color: '#065f46', fontWeight: 600 }}>
            {WEEKDAY_NAMES[r.day]}: −{r.percent}% off {catName(r.categoryId)}
          </span>
        ))}
      </div>
      <div style={{ color: '#047857', fontSize: 12, marginTop: 8 }}>Pick a highlighted day below and the discount applies automatically.</div>
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
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [paymentType, setPaymentType] = useState<'PAY_ONLINE' | 'PAY_LATER'>('PAY_LATER');
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
  const weekdayPct = weekdayPctFor(salon?.weekdayDiscounts, selectedDate, service?.categoryId ?? null);
  const serviceFinalCents = Math.round((serviceNetCents * (100 - weekdayPct)) / 100);
  const addonsCents = selectedAddons.reduce((s, a) => s + a.priceCents, 0);

  // Extra services chosen for the SAME visit. Each gets its own discount + the
  // weekday promo for its own category. (Excludes the primary service.)
  const extraServices = services.filter((s) => s.id !== serviceId && extraServiceIds.includes(s.id));
  const extraLines = extraServices.map((s) => {
    const net = svcNetCents(s);
    const wd = weekdayPctFor(salon?.weekdayDiscounts, selectedDate, s.categoryId ?? null);
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

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const sRes = await fetch(base);
      if (!sRes.ok) { setLoadError(sRes.status === 404 ? 'This salon booking page was not found.' : 'Could not load the salon.'); return; }
      const [salonData, servicesData, staffData, catData] = await Promise.all([
        sRes.json(),
        fetch(`${base}/services`).then((r) => r.json()),
        fetch(`${base}/staff`).then((r) => r.json()),
        fetch(`${base}/categories`).then((r) => r.json()).catch(() => []),
      ]);
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
          paymentType,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setError((body && body.message) || `Booking failed (${res.status})`); return; }
      setResult({ paymentStatus: body?.payment?.status ?? null });
      setStep(6);
    } catch { setError('Network error. Please try again.'); }
    finally { setSubmitting(false); }
  }

  function reset() {
    setStep(1); setSelectedDate(null); setServiceId(''); setAddonIds([]); setStaffId(''); setSlot(null);
    setAvail(null); setForm({ firstName: '', lastName: '', email: '', phone: '' });
    setPaymentType('PAY_LATER'); setResult(null); setError(null);
  }

  if (loading) return <Shell><Center>Loading…</Center></Shell>;
  if (loadError) return <Shell><Center>{loadError}</Center></Shell>;

  const steps = [
    { n: 1, label: 'Date & time', summary: slot ? `${selectedDate?.toLocaleDateString()} · ${fmtTime(slot.start)}` : selectedDate ? selectedDate.toLocaleDateString() : '' },
    { n: 2, label: 'Service', summary: service ? service.name : '' },
    { n: 3, label: 'Technician', summary: step > 3 ? (employee ? `${employee.firstName} ${employee.lastName ?? ''}`.trim() : 'Any available') : '' },
    { n: 4, label: 'Your information', summary: form.firstName || '' },
    { n: 5, label: 'Payment', summary: step > 5 ? (paymentType === 'PAY_ONLINE' ? 'Online' : 'At salon') : '' },
  ];

  const currentLabel = steps.find((s) => s.n === Math.min(step, 5))?.label ?? '';

  return (
    <Shell>
      <div style={{ ...(isMobile ? wrapMobile : wrap), ['--accent' as string]: accent } as React.CSSProperties}>
        {isMobile ? (
          /* Compact mobile header: salon name + progress bar + current step */
          <div style={{ background: ACCENT, color: 'white', padding: '16px 18px' }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{salon?.name}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
              {steps.map((s) => (
                <div key={s.n} style={{ flex: 1, height: 6, borderRadius: 999, background: step >= s.n ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.30)' }} />
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <div style={{ fontSize: 12, opacity: 0.95 }}>
                {step > 5 ? 'Done' : `Step ${Math.min(step, 5)} of 5 · ${currentLabel}`}
              </div>
              <InstallAppButton label="Get the app" />
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
              <InstallAppButton label="Install this booking app" />
            </div>
            <a href="https://lumioagency.com/" target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, opacity: 0.85, paddingTop: 16, color: 'white', textDecoration: 'none' }}>
              Powered by <span style={{ fontWeight: 700 }}>Lumio Booking</span>
            </a>
          </aside>
        )}

        <section style={isMobile ? contentMobile : content}>
          {step === 1 && (
            <>
              <DealsBanner wd={salon?.weekdayDiscounts} categories={categories} />
              <StepDateTime rules={rules} selectedDate={selectedDate} slot={slot}
                onPickDate={(d) => { setSelectedDate(d); setSlot(null); }}
                onPickSlot={setSlot}
                onContinue={() => slot && setStep(2)} />
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
                <details style={{ marginBottom: 16, border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px' }}>
                  <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
                    ➕ Add more services{extraServices.length > 0 ? ` (${extraServices.length} added)` : ' (optional)'}
                  </summary>
                  <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                    {services.filter((s) => s.id !== serviceId).map((s) => {
                      const on = extraServiceIds.includes(s.id);
                      return (
                        <button key={s.id} type="button" onClick={() => { setExtraServiceIds((p) => p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]); setStaffId(''); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left', border: `1px solid ${on ? ACCENT : '#e2e8f0'}`, background: on ? '#eef2ff' : 'white' }}>
                          <span style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${on ? ACCENT : '#cbd5e1'}`, background: on ? ACCENT : 'white', color: 'white', display: 'grid', placeItems: 'center', fontSize: 12 }}>{on ? '✓' : ''}</span>
                          <span style={{ flex: 1, color: '#1e293b', fontSize: 14 }}>{s.name}</span>
                          <span style={{ color: '#64748b', fontSize: 13 }}>{s.durationMinutes}m</span>
                          <span style={{ color: '#16a34a', fontSize: 14, fontWeight: 600 }}>{s.priceFrom ? 'from ' : ''}{fmt(svcNetCents(s))}</span>
                        </button>
                      );
                    })}
                  </div>
                </details>
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

          {step === 4 && (() => {
            const phoneValid = isValidPhone(form.phone);
            const showPhoneError = form.phone.trim().length > 0 && !phoneValid;
            const infoOk = form.firstName.trim().length > 0 && phoneValid;
            return (
              <StepFrame title="Your information" canContinue={infoOk} onContinue={() => setStep(5)} onBack={() => setStep(3)}>
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
                  <Field label="First name" required><input style={field} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
                  <Field label="Last name"><input style={field} value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
                  <Field label="Email"><input style={field} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@email.com" /></Field>
                  <Field label="Phone" required>
                    <input
                      style={{ ...field, borderColor: showPhoneError ? '#ef4444' : '#cbd5e1' }}
                      value={form.phone} inputMode="tel" placeholder="e.g. (201) 555-0123"
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    />
                    {showPhoneError && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 4 }}>Please enter a valid phone number (8–15 digits).</div>}
                  </Field>
                </div>
                {!infoOk && <p style={{ color: '#94a3b8', fontSize: 12, marginTop: 10 }}>First name and a valid phone number are required to continue.</p>}
              </StepFrame>
            );
          })()}

          {step === 5 && service && slot && (
            <StepPayment service={service} employee={employee} slot={slot} addons={paymentItems} totalCents={totalCents}
              fmt={fmt} onlineEnabled={rules.onlinePaymentEnabled} payLaterEnabled={rules.payLaterEnabled}
              paymentType={paymentType} setPaymentType={setPaymentType} error={error} submitting={submitting}
              onBack={() => setStep(4)} onConfirm={submit} />
          )}

          {step === 6 && (
            <Center>
              <div style={{ textAlign: 'center', maxWidth: 360 }}>
                <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#dcfce7', color: '#16a34a', fontSize: 34, display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}>✓</div>
                <h2 style={{ color: '#16a34a', margin: '4px 0' }}>Booking received</h2>
                <p style={{ color: '#475569', lineHeight: 1.6 }}>
                  Thanks {form.firstName}! Your booking for <strong>{service?.name}</strong> on{' '}
                  <strong>{slot && `${slot.start.toLocaleDateString()} at ${fmtTime(slot.start)}`}</strong> is received.
                </p>
                <p style={{ color: '#475569' }}>Payment: <strong>{result?.paymentStatus === 'PAID' ? 'Paid online ✓' : 'Pay at the salon'}</strong></p>
                <button onClick={reset} style={primaryBtn}>Book another</button>
              </div>
            </Center>
          )}
        </section>
        {isMobile && (
          <a href="https://lumioagency.com/" target="_blank" rel="noopener noreferrer"
            style={{ textAlign: 'center', padding: '12px 0', fontSize: 11, color: '#94a3b8', textDecoration: 'none', borderTop: '1px solid #eef1f6', background: 'white' }}>
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
function StepDateTime({ rules, selectedDate, slot, onPickDate, onPickSlot, onContinue }: {
  rules: BookingRules; selectedDate: Date | null; slot: Slot | null;
  onPickDate: (d: Date) => void; onPickSlot: (s: Slot) => void; onContinue: () => void;
}) {
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
          return (
            <button key={i} disabled={disabled} onClick={() => onPickDate(d)}
              style={{ padding: '10px 0', borderRadius: 8, fontSize: 14, cursor: disabled ? 'not-allowed' : 'pointer',
                border: sel ? `2px solid ${ACCENT}` : '1px solid #e2e8f0', background: sel ? '#eef2ff' : disabled ? '#f8fafc' : 'white',
                color: disabled ? '#cbd5e1' : '#1e293b', fontWeight: sel ? 700 : 400 }}>
              {d.getDate()}
            </button>
          );
        })}
      </div>

      {!selectedDate && (
        <p style={{ color: '#64748b', fontSize: 12, marginTop: 12 }}>Pick a date — greyed-out days are closed or outside the booking window.</p>
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
                  <button key={i} onClick={() => onPickSlot(s)}
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
function StepPayment({ service, employee, slot, addons, totalCents, fmt, onlineEnabled, payLaterEnabled, paymentType, setPaymentType, error, submitting, onBack, onConfirm }: {
  service: Service; employee: Staff | null; slot: Slot; addons: Addon[]; totalCents: number; fmt: (c: number) => string;
  onlineEnabled: boolean; payLaterEnabled: boolean; paymentType: 'PAY_ONLINE' | 'PAY_LATER'; setPaymentType: (t: 'PAY_ONLINE' | 'PAY_LATER') => void;
  error: string | null; submitting: boolean; onBack: () => void; onConfirm: () => void;
}) {
  useEffect(() => {
    if (!onlineEnabled && paymentType === 'PAY_ONLINE' && payLaterEnabled) setPaymentType('PAY_LATER');
    else if (!payLaterEnabled && paymentType === 'PAY_LATER' && onlineEnabled) setPaymentType('PAY_ONLINE');
  }, [onlineEnabled, payLaterEnabled]);

  return (
    <div style={frameRoot}>
      <h2 style={stepTitle}>Payment</h2>
      <div style={scrollArea}>
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 18 }}>
          <Row k="Service" v={`${service.name} (${fmt(svcNetCents(service))})`} />
          {svcDiscount(service) > 0 && <Row k={`Discount −${svcDiscount(service)}%`} v={`− ${fmt(service.priceCents - svcNetCents(service))}`} />}
          {addons.map((a) => <Row key={a.id} k={`+ ${a.name}`} v={fmt(a.priceCents)} />)}
          <Row k="Technician" v={employee ? `${employee.firstName} ${employee.lastName ?? ''}` : 'Any available'} />
          <Row k="When" v={`${slot.start.toLocaleDateString()} · ${fmtTime(slot.start)} – ${fmtTime(slot.end)}`} />
          <div style={{ borderTop: '1px solid #e2e8f0', margin: '10px 0' }} />
          <Row k="Total" v={fmt(totalCents)} bold />
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#334155', marginBottom: 8 }}>Choose payment</div>
        <div style={{ display: 'grid', gap: 10 }}>
          {onlineEnabled && <PayOption selected={paymentType === 'PAY_ONLINE'} onClick={() => setPaymentType('PAY_ONLINE')} title="Pay online now" desc="Pay securely now (demo: mock payment)." />}
          {payLaterEnabled && <PayOption selected={paymentType === 'PAY_LATER'} onClick={() => setPaymentType('PAY_LATER')} title="Pay at the salon" desc="Reserve now, pay when you arrive." />}
        </div>
        {error && <div style={{ background: '#fee2e2', color: '#b91c1c', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginTop: 14 }}>{error}</div>}
      </div>
      <div style={footer}>
        <button onClick={onBack} style={ghostBtn}>Back</button>
        <button onClick={onConfirm} disabled={submitting} style={primaryBtn}>{submitting ? 'Booking…' : paymentType === 'PAY_ONLINE' ? 'Pay & book' : 'Confirm booking'}</button>
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
  return (
    <div style={frameRoot}>
      <h2 style={stepTitle}>{title}</h2>
      <div style={scrollArea}>{children}</div>
      <div style={footer}>
        {onBack ? <button onClick={onBack} style={ghostBtn}>Back</button> : <span />}
        <button onClick={onContinue} disabled={!canContinue} style={{ ...primaryBtn, opacity: canContinue ? 1 : 0.5, cursor: canContinue ? 'pointer' : 'not-allowed' }}>Continue</button>
      </div>
    </div>
  );
}
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label style={{ display: 'block', marginBottom: 16 }}><span style={fieldLabel}>{required && <span style={{ color: '#ef4444' }}>* </span>}{label}:</span>{children}</label>;
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

  const chip = (key: string, label: string) => (
    <button key={key} type="button" onClick={() => setActiveCat(key)}
      style={{ whiteSpace: 'nowrap', fontSize: 13, padding: '7px 14px', borderRadius: 999, cursor: 'pointer',
        border: activeCat === key ? `1px solid ${ACCENT}` : '1px solid #e2e8f0',
        background: activeCat === key ? ACCENT : 'white', color: activeCat === key ? 'white' : '#475569', fontWeight: 600 }}>
      {label}
    </button>
  );

  const card = (s: Service) => {
    const d = svcDiscount(s); const net = svcNetCents(s); const on = s.id === selectedId;
    return (
      <button key={s.id} type="button" onClick={() => onSelect(s.id)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, cursor: 'pointer', textAlign: 'left', marginBottom: 8,
          border: on ? `2px solid ${ACCENT}` : '1px solid #e2e8f0', background: on ? '#eef2ff' : 'white' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>
            {s.name}
            {s.isFeatured && <span style={{ marginLeft: 6, background: '#fef3c7', color: '#92400e', borderRadius: 6, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>POPULAR</span>}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>{s.durationMinutes} min</div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {d > 0 && <div style={{ fontSize: 12, color: '#94a3b8', textDecoration: 'line-through' }}>{fmt(s.priceCents)}</div>}
          <div style={{ fontSize: 14, fontWeight: 700, color: d > 0 ? '#dc2626' : '#1e293b' }}>{s.priceFrom ? 'from ' : ''}{fmt(net)}</div>
        </div>
        <span style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, border: `2px solid ${on ? ACCENT : '#cbd5e1'}`, background: on ? ACCENT : 'white', color: 'white', display: 'grid', placeItems: 'center', fontSize: 13 }}>{on ? '✓' : ''}</span>
      </button>
    );
  };

  const section = (title: string, list: Service[]) => {
    const items = list.filter(matches);
    if (items.length === 0) return null;
    return (
      <div key={title} style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, margin: '4px 0 8px' }}>{title}</div>
        {items.map(card)}
      </div>
    );
  };

  let body: React.ReactNode;
  if (q) {
    const all = services.filter(matches);
    body = all.length ? all.map(card) : <p style={{ color: '#94a3b8', fontSize: 14 }}>No services match “{search}”.</p>;
  } else if (activeCat === 'popular') {
    body = section('Popular', featured);
  } else if (activeCat === 'none') {
    body = section('Other', uncategorised);
  } else if (activeCat !== 'all') {
    const c = categories.find((x) => x.id === activeCat);
    body = section(c?.name ?? 'Services', inCat(activeCat));
  } else {
    body = (
      <>
        {featured.length > 0 && section('⭐ Popular', featured)}
        {categories.map((c) => section(c.name, inCat(c.id)))}
        {section('Other', uncategorised)}
      </>
    );
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ position: 'relative', marginBottom: 12 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search services…"
          style={{ ...field, paddingLeft: 36 }} />
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}>⌕</span>
      </div>
      {(categories.length > 0 || featured.length > 0) && (
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 8 }}>
          {chip('all', 'All')}
          {featured.length > 0 && chip('popular', 'Popular')}
          {categories.map((c) => chip(c.id, c.name))}
          {uncategorised.length > 0 && chip('none', 'Other')}
        </div>
      )}
      <div>{body}</div>
    </div>
  );
}
function TechCard({ selected, onClick, label, avatar, subtitle, disabled }: { selected: boolean; onClick: () => void; label: string; avatar: string | null; subtitle?: string; disabled?: boolean }) {
  const initial = (label || '?').trim().charAt(0).toUpperCase();
  const subColor = disabled ? '#ef4444' : subtitle === 'Available' ? '#16a34a' : '#64748b';
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={disabled ? 'Already booked at this time' : undefined}
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
function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: '100vh', background: '#eef1f6', display: 'grid', placeItems: 'center', padding: 16 }}>{children}</div>;
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
const primaryBtn: React.CSSProperties = { padding: '11px 22px', borderRadius: 8, border: 'none', background: ACCENT, color: 'white', fontWeight: 600, fontSize: 14, cursor: 'pointer' };
const ghostBtn: React.CSSProperties = { padding: '11px 18px', borderRadius: 8, border: '1px solid #cbd5e1', background: 'white', color: '#475569', fontSize: 14, cursor: 'pointer' };
const navBtn: React.CSSProperties = { width: 32, height: 32, borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', color: ACCENT, fontSize: 16, cursor: 'pointer' };
