'use client';

// ===========================================================================
// Hosted online booking wizard at /book/<slug>.
// Flow: Date & time -> Service (+add-ons) -> Technician -> Your info -> Payment.
// The customer picks the date AND time first; once a service is chosen, the
// technician step only offers technicians who are FREE at that exact time
// (busy ones are greyed out) so the same tech can't be double-booked.
// ===========================================================================

import { useCallback, useEffect, useMemo, useState, FormEvent } from 'react';
import { useParams } from 'next/navigation';
import { useIsMobile } from '../../../lib/responsive';

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

interface Salon { name: string; slug: string; timezone: string; branding?: { accentColor: string; logoUrl: string }; booking?: BookingRules }
interface Addon { id: string; name: string; durationMinutes: number; priceCents: number }
interface Service { id: string; name: string; durationMinutes: number; priceCents: number; discountPercent?: number; addons: Addon[] }
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
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>(1);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [serviceId, setServiceId] = useState('');
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
  const totalCents = serviceNetCents + selectedAddons.reduce((s, a) => s + a.priceCents, 0);
  const savingsCents = (service?.priceCents ?? 0) - serviceNetCents;
  const totalDuration = (service?.durationMinutes ?? 0) + selectedAddons.reduce((s, a) => s + a.durationMinutes, 0);
  const fmt = (c: number) => fmtMoney(c, rules);

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const sRes = await fetch(base);
      if (!sRes.ok) { setLoadError(sRes.status === 404 ? 'This salon booking page was not found.' : 'Could not load the salon.'); return; }
      const [salonData, servicesData, staffData] = await Promise.all([
        sRes.json(),
        fetch(`${base}/services`).then((r) => r.json()),
        fetch(`${base}/staff`).then((r) => r.json()),
      ]);
      setSalon(salonData); setServices(servicesData ?? []); setStaff(staffData ?? []);
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
  useEffect(() => {
    if (!selectedDate || !serviceId) { setAvail(null); return; }
    const d = ymd(selectedDate);
    fetch(`${base}/availability?serviceId=${encodeURIComponent(serviceId)}&date=${d}`)
      .then((r) => r.json()).then(setAvail).catch(() => setAvail(null));
  }, [base, selectedDate, serviceId]);

  async function submit() {
    if (!slot) return;
    setSubmitting(true); setError(null);
    try {
      const res = await fetch(`${base}/bookings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId, addonIds, preferredStaffId: staffId || undefined,
          startTime: slot.start.toISOString(),
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
            <div style={{ fontSize: 12, opacity: 0.95, marginTop: 8 }}>
              {step > 5 ? 'Done' : `Step ${Math.min(step, 5)} of 5 · ${currentLabel}`}
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
            <a href="https://lumioagency.com/" target="_blank" rel="noopener noreferrer" style={{ marginTop: 'auto', fontSize: 12, opacity: 0.85, paddingTop: 24, color: 'white', textDecoration: 'none' }}>
              Powered by <span style={{ fontWeight: 700 }}>Lumio Booking</span>
            </a>
          </aside>
        )}

        <section style={isMobile ? contentMobile : content}>
          {step === 1 && (
            <StepDateTime rules={rules} selectedDate={selectedDate} slot={slot}
              onPickDate={(d) => { setSelectedDate(d); setSlot(null); }}
              onPickSlot={setSlot}
              onContinue={() => slot && setStep(2)} />
          )}

          {step === 2 && (
            <StepFrame title="Choose a service" canContinue={!!serviceId} onContinue={() => service && setStep(3)} onBack={() => setStep(1)}>
              <Field label="Service" required>
                <select style={field} value={serviceId} onChange={(e) => { setServiceId(e.target.value); setAddonIds([]); setStaffId(''); }}>
                  <option value="">Select a service…</option>
                  {services.map((s) => {
                    const d = svcDiscount(s); const net = svcNetCents(s);
                    return <option key={s.id} value={s.id}>{s.name} — {s.durationMinutes} min — {fmt(net)}{d > 0 ? ` (was ${fmt(s.priceCents)}, -${d}%)` : ''}</option>;
                  })}
                </select>
              </Field>
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
              {service && serviceDiscount > 0 && (
                <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 10, background: 'linear-gradient(90deg,#fee2e2,#fef3c7)', border: '1px solid #fca5a5', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ background: '#ef4444', color: '#fff', borderRadius: 8, padding: '3px 9px', fontSize: 14, fontWeight: 800 }}>-{serviceDiscount}%</span>
                  <span style={{ color: '#9a3412', fontSize: 13, fontWeight: 600 }}>
                    Special offer! You save {fmt(savingsCents)} on {service.name} 🎉
                  </span>
                </div>
              )}
              {service && (
                <div style={{ marginTop: 12, padding: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14 }}>
                  <span style={{ color: '#64748b' }}>Total ({totalDuration} min)</span>
                  <span>
                    {serviceDiscount > 0 && <span style={{ textDecoration: 'line-through', color: '#94a3b8', marginRight: 8 }}>{fmt(service.priceCents + selectedAddons.reduce((s, a) => s + a.priceCents, 0))}</span>}
                    <strong style={{ color: serviceDiscount > 0 ? '#dc2626' : '#1e293b', fontSize: 16 }}>{fmt(totalCents)}</strong>
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
            <StepPayment service={service} employee={employee} slot={slot} addons={selectedAddons} totalCents={totalCents}
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
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 13, color: '#475569', marginBottom: 8, fontWeight: 600 }}>
            {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} — choose a time
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
  const eligible = avail ? staff.filter((s) => avail.eligibleStaffIds.includes(s.id)) : [];
  const isBusy = (id: string) => overlaps(checkSlot, avail?.staffBusy[id] ?? []);
  const anyFree = avail ? avail.eligibleStaffIds.some((id) => !isBusy(id)) : false;

  const selectedBusy = !!staffId && isBusy(staffId);
  const canContinue = !loading && !overflow && (allowChoose
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
