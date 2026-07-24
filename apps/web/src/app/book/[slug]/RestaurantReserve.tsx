'use client';

// ===========================================================================
// Hosted online table reservation at /book/<slug> for RESTAURANT tenants.
//
// Same look-and-feel as the salon booking page (Shell mesh background, gradient
// sticky header, two-column layout with a sticky reservation summary on desktop,
// a floating action bar on mobile, the progress stepper and the boarding-pass
// summary card) — only the STEPS and DATA are tuned to a restaurant:
//
//   Reserve (party · date · time · seating) -> Details -> Confirm.
//
// The backend calls are unchanged (table-availability + the shared /bookings
// endpoint with partySize/area), so nothing on the server has to change.
// ===========================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useIsMobile } from '../../../lib/responsive';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';
const INK = '#0f2a52';
const SOFT = '#f4f6fb';
const FONT = "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const DISPLAY = "'Nunito', system-ui, -apple-system, 'Segoe UI', sans-serif";
const pad = (n: number) => String(n).padStart(2, '0');
const OCCASIONS = ['Birthday', 'Anniversary', 'Date Night', 'Business', 'None'];
const REQUESTS = ['High chair', 'Booth', 'Quiet area', 'Near window', 'Wheelchair access'];

/** Tenant brand colour, softened for tints. */
function tint(hex: string, alpha: number): string {
  const h = (hex || '').replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return `rgba(220,38,38,${alpha})`;
  return `rgba(${r},${g},${b},${alpha})`;
}
/** A darker shade for the header gradient. */
function shade(hex: string, amount = 0.28): string {
  const h = (hex || '').replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const f = (i: number) => { const v = parseInt(n.slice(i, i + 2), 16); return Number.isNaN(v) ? 0 : Math.max(0, Math.round(v * (1 - amount))); };
  return `rgb(${f(0)}, ${f(2)}, ${f(4)})`;
}

interface Deposit { enabled: boolean; type: 'percent' | 'fixed'; percent: number; fixedCents: number }
interface Salon {
  name: string; slug: string; timezone: string; address?: string | null; contactPhone?: string | null;
  areas?: string[]; branding?: { accentColor?: string; logoUrl?: string; logoScale?: number };
  deposit?: Deposit; rating?: { value: number; count: number } | null;
}
interface Svc { id: string; durationMinutes: number }
interface Avail { tableCount: number; durationMinutes: number; busy: { start: string; end: string }[] }
interface Dish { name: string; category: string | null; priceCents: number; description: string | null }

function wallTimeToISO(local: Date, timeZone: string): string {
  const y = local.getFullYear(), mo = local.getMonth(), d = local.getDate(), h = local.getHours(), mi = local.getMinutes();
  const naiveUTC = Date.UTC(y, mo, d, h, mi);
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const parts = dtf.formatToParts(new Date(naiveUTC));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let hh = g('hour'); if (hh === 24) hh = 0;
  const asTz = Date.UTC(g('year'), g('month') - 1, g('day'), hh, g('minute'), g('second'));
  return new Date(naiveUTC - (asTz - naiveUTC)).toISOString();
}

const Icon = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{d.split('|').map((p, i) => <path key={i} d={p} />)}</svg>
);

export function RestaurantReserve({ slug, salon }: { slug: string; salon: Salon }) {
  const base = `${API_URL}/public/salons/${encodeURIComponent(slug)}`;
  const accent = salon.branding?.accentColor || '#dc2626';
  const tz = salon.timezone || 'UTC';
  const isMobile = useIsMobile(820);
  const embedded = useEmbedded();
  const areas = salon.areas && salon.areas.length ? salon.areas : [];
  const seatingOpts = [...areas, 'No Preference'];

  const [step, setStep] = useState(1);
  const [party, setParty] = useState(2);
  const [dateObj, setDateObj] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; });
  const date = useMemo(() => `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}`, [dateObj]);
  const [seating, setSeating] = useState('No Preference');
  const [avail, setAvail] = useState<Avail | null>(null);
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [svcId, setSvcId] = useState('');
  const [slot, setSlot] = useState<string | null>(null);
  const [occasion, setOccasion] = useState('');
  const [requests, setRequests] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const [agreed, setAgreed] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [menu, setMenu] = useState<Dish[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hp, setHp] = useState('');

  useEffect(() => { fetch(`${base}/services`).then((r) => r.json()).then((s: Svc[]) => setSvcId(Array.isArray(s) && s[0] ? s[0].id : '')).catch(() => {}); }, [base]);
  useEffect(() => { if (showMenu && !menu) fetch(`${base}/menu`).then((r) => r.json()).then(setMenu).catch(() => setMenu([])); }, [showMenu, menu, base]);

  const loadAvail = useCallback(async () => {
    setLoadingAvail(true);
    try { const r = await fetch(`${base}/table-availability?date=${date}&partySize=${party}`); setAvail(await r.json()); }
    catch { setAvail(null); } finally { setLoadingAvail(false); }
  }, [base, date, party]);
  useEffect(() => { loadAvail(); }, [loadAvail]);

  const slots = useMemo(() => {
    if (!avail) return [] as { hm: string; hour: number; open: boolean; free: number }[];
    const dur = avail.durationMinutes || 90;
    const [Y, M, D] = date.split('-').map(Number);
    const out: { hm: string; hour: number; open: boolean; free: number }[] = [];
    for (let mins = 11 * 60; mins <= 21 * 60 + 30; mins += 30) {
      const hh = Math.floor(mins / 60), mm = mins % 60;
      const sUtc = new Date(wallTimeToISO(new Date(Y, M - 1, D, hh, mm), tz)).getTime();
      const eUtc = sUtc + dur * 60000;
      const overlaps = avail.busy.filter((b) => new Date(b.start).getTime() < eUtc && new Date(b.end).getTime() > sUtc).length;
      out.push({ hm: `${pad(hh)}:${pad(mm)}`, hour: hh, open: overlaps < avail.tableCount, free: avail.tableCount - overlaps });
    }
    return out;
  }, [avail, date, tz]);
  const groups = useMemo(() => {
    const lunch = slots.filter((s) => s.hour < 15), dinner = slots.filter((s) => s.hour >= 15);
    return ([['Lunch', lunch], ['Dinner', dinner]] as [string, typeof slots][]).filter(([, a]) => a.length > 0);
  }, [slots]);
  const anyOpen = slots.some((s) => s.open);
  useEffect(() => { if (slot && slots.length && !slots.some((s) => s.hm === slot && s.open)) setSlot(null); }, [slots, slot]);

  const fmtSlot = (hm: string) => { const [h, m] = hm.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
  const dateCards = useMemo(() => Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d; }), []);
  const prettyDate = () => dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const dep = salon.deposit;
  const depLabel = dep?.enabled ? (dep.type === 'percent' ? `${dep.percent}% deposit` : `$${(dep.fixedCents / 100).toFixed(2)} deposit`) : null;
  const infoOk = !!form.name.trim() && !!form.phone.trim();

  const goto = (n: number) => { setError(null); setStep(n); if (typeof window !== 'undefined') window.scrollTo(0, 0); };

  const canContinue = step === 1 ? !!slot : step === 2 ? infoOk : step === 3 ? (agreed && !submitting) : false;
  const ctaLabel = step === 3 ? (submitting ? 'Reserving…' : 'Confirm Reservation') : step === 1 ? (slot ? 'Continue' : 'Select a time') : 'Continue';
  const goNext = () => {
    if (step === 1) { if (!slot) { setError('Please select a time.'); return; } goto(2); }
    else if (step === 2) { if (!infoOk) { setError('Please enter your name and phone.'); return; } goto(3); }
    else if (step === 3) submit();
  };
  const goBack = () => { if (step > 1) goto(step - 1); };
  const toggleReq = (r: string) => setRequests((xs) => xs.includes(r) ? xs.filter((x) => x !== r) : [...xs, r]);

  const stepTitle = step === 1 ? 'Reserve a table' : step === 2 ? 'Your details' : 'Review & confirm';
  const stepHint = step === 1 ? 'Choose your party size, then a date and time that suits you.'
    : step === 2 ? 'Tell us who the table is for — and anything that makes the night special.'
    : 'One last look before we hold your table.';
  const barTitle = step === 1 ? (salon.name || 'Reserve online') : step === 2 ? 'Your details' : 'Confirm reservation';

  async function submit() {
    if (!slot || !svcId) { setError('Online reservations are not available yet.'); return; }
    if (!infoOk) { setError('Please enter your name and phone.'); goto(2); return; }
    setSubmitting(true); setError(null);
    const [Y, M, D] = date.split('-').map(Number); const [h, m] = slot.split(':').map(Number);
    const startISO = wallTimeToISO(new Date(Y, M - 1, D, h, m), tz);
    const [first, ...rest] = form.name.trim().split(' ');
    const parts: string[] = [];
    if (seating && seating !== 'No Preference') parts.push('Seating: ' + seating);
    if (occasion && occasion !== 'None') parts.push('Occasion: ' + occasion);
    if (requests.length) parts.push('Requests: ' + requests.join(', '));
    if (note.trim()) parts.push('Note: ' + note.trim());
    try {
      const res = await fetch(`${base}/bookings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ website: hp, serviceId: svcId, startTime: startISO, partySize: party, area: seating !== 'No Preference' ? seating : undefined, customerFirstName: first, customerLastName: rest.join(' ') || undefined, customerPhone: form.phone.trim(), customerEmail: form.email.trim() || undefined, notes: parts.join(' · ') || undefined, paymentType: dep?.enabled ? 'PAY_ONLINE' : 'PAY_LATER' }),
      });
      const b = await res.json().catch(() => null);
      if (!res.ok) { setError((b && b.message) || `Reservation failed (${res.status})`); return; }
      setDone(true); if (typeof window !== 'undefined') window.scrollTo(0, 0);
    } catch { setError('Network error. Please try again.'); }
    finally { setSubmitting(false); }
  }

  // rows shown in the summary + review
  const resRows: [string, string][] = [
    ['Party size', `${party} ${party === 1 ? 'guest' : 'guests'}`],
    ['Date', slot ? prettyDate() : (step === 1 ? '—' : prettyDate())],
    ['Time', slot ? fmtSlot(slot) : '—'],
    ...(seating !== 'No Preference' ? ([['Seating', seating]] as [string, string][]) : []),
    ...(occasion && occasion !== 'None' ? ([['Occasion', occasion]] as [string, string][]) : []),
    ...(requests.length ? ([['Requests', requests.join(', ')]] as [string, string][]) : []),
    ...(infoOk ? ([['Contact', `${form.name} · ${form.phone}`]] as [string, string][]) : []),
  ];

  const summary = (
    <ReservationSummary
      salon={salon} accent={accent} rows={resRows} hasSlot={!!slot}
      dateLine={slot ? prettyDate() : null} timeLine={slot ? fmtSlot(slot) : null}
      party={party} depLabel={depLabel} canContinue={canContinue} ctaLabel={ctaLabel}
      onContinue={goNext} onViewMenu={() => setShowMenu(true)} step={step}
    />
  );

  if (done) return (
    <Shell accent={accent}>
      <div className="lumio-book" style={{ width: '100%', maxWidth: 560, margin: '0 auto', ['--accent' as string]: accent } as React.CSSProperties}>
        <div style={{ background: '#fff', borderRadius: 18, boxShadow: '0 24px 60px -40px rgba(15,42,82,.45)', padding: 30, textAlign: 'center' }}>
          <div style={{ width: 66, height: 66, borderRadius: '50%', background: '#dcfce7', color: '#16a34a', display: 'grid', placeItems: 'center', margin: '0 auto 14px' }} className="lumio-added"><Icon d="M20 6L9 17l-5-5" size={34} /></div>
          <h2 style={{ fontFamily: DISPLAY, fontSize: 26, margin: '0 0 6px', color: INK }}>Your table is reserved</h2>
          <p style={{ color: '#64748b', fontSize: 14.5, margin: '0 0 20px' }}>A confirmation text is on its way{form.name ? `, ${form.name.split(' ')[0]}` : ''}.</p>
          <div style={{ textAlign: 'left', background: SOFT, border: '1px solid #eef1f6', borderRadius: 14, padding: '16px 18px', maxWidth: 380, margin: '0 auto' }}>
            <div style={{ fontFamily: DISPLAY, fontSize: 19, color: INK, marginBottom: 8 }}>{salon.name}</div>
            {resRows.filter(([k]) => k !== 'Contact').map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 14.5 }}><span style={{ color: '#94a3b8' }}>{k}</span><span style={{ color: INK, fontWeight: 700 }}>{v}</span></div>
            ))}
          </div>
          {depLabel && <p style={{ color: '#b45309', fontSize: 13, marginTop: 14 }}>A {depLabel} may apply to hold your table.</p>}
          <button onClick={() => { setDone(false); setStep(1); setSlot(null); setAgreed(false); }} style={{ ...primaryBtn, marginTop: 18 }}>Make another reservation</button>
        </div>
      </div>
    </Shell>
  );

  return (
    <Shell accent={accent}>
      <div className="lumio-book" style={{ width: '100%', maxWidth: 1120, margin: '0 auto', ['--accent' as string]: accent } as React.CSSProperties}>
        {/* Header — gradient, sticky on a real viewport. */}
        <div style={{ position: 'sticky', top: 0, zIndex: 30,
          background: `linear-gradient(120deg, ${accent} 0%, ${shade(accent, 0.18)} 55%, ${shade(accent, 0.42)} 100%)`,
          color: '#fff', borderRadius: '18px 18px 0 0', padding: isMobile ? '12px 14px' : '16px 20px',
          display: 'flex', alignItems: 'center', gap: 13,
          boxShadow: `0 14px 34px -18px ${tint(accent, 0.95)}, inset 0 1px 0 rgba(255,255,255,0.22)` }}>
          {step > 1 && <button onClick={goBack} aria-label="Back" style={{ width: 34, height: 34, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 16, cursor: 'pointer', flexShrink: 0 }}>←</button>}
          {step === 1 && <Logo url={salon.branding?.logoUrl} scale={salon.branding?.logoScale} size={38} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: isMobile ? 16 : 19, letterSpacing: -0.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{barTitle}</div>
            {step === 1 && (
              <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 0 3px rgba(74,222,128,.25)' }} className="lumio-dot" />
                Reserve online · confirmed in seconds
              </div>
            )}
          </div>
          {step === 1 && salon.rating && (
            <span title={`${salon.rating.value} out of 5 · ${salon.rating.count} reviews`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 999, background: 'rgba(255,255,255,0.16)', color: '#fff', fontSize: 13, fontWeight: 800, flexShrink: 0, whiteSpace: 'nowrap' }}>
              <span style={{ color: '#fde047' }}>★</span>{salon.rating.value}<span style={{ opacity: 0.75, fontWeight: 700 }}>· {salon.rating.count}</span>
            </span>
          )}
          {step === 1 && (
            <button onClick={() => setShowMenu(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>
              <Icon d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20|M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" size={15} />Menu
            </button>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 360px', gap: isMobile ? 0 : 18, alignItems: 'start' }}>
          {/* left: the picking */}
          <div style={{ background: '#fff', borderRadius: '0 0 18px 18px', padding: isMobile ? '14px 14px 18px' : '18px 24px 24px', minWidth: 0, boxShadow: '0 24px 60px -40px rgba(15,42,82,.45)' }}>
            <Progress step={step} accent={accent} />
            <h1 key={step} className="lumio-step" style={{ fontSize: isMobile ? 22 : 27, fontWeight: 800, color: INK, margin: '10px 0 4px' }}>{stepTitle}</h1>
            <p style={{ margin: '0 0 14px', fontSize: 13.5, color: '#8fa0bb', lineHeight: 1.5 }}>{stepHint}</p>

            {error && <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '10px 13px', borderRadius: 11, fontSize: 14, marginBottom: 14 }}>{error}</div>}
            <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={hp} onChange={(e) => setHp(e.target.value)} style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />

            {step === 1 && (
              <div>
                <SectionLabel accent={accent}>Party size</SectionLabel>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 7 }}>
                  {[1, 2, 3, 4, 5, 6].map((n) => <button key={n} className="lumio-row" onClick={() => setParty(n)} style={pill(party === n, accent)}>{n}</button>)}
                  <button className="lumio-row" onClick={() => setParty((p) => (p < 7 ? 7 : p))} style={pill(party >= 7, accent)}>7+</button>
                </div>
                {party >= 7 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 8, border: '1px solid #e6eaf2', borderRadius: 12, padding: 6 }}>
                    <button onClick={() => setParty((p) => Math.max(7, p - 1))} style={stepperBtn(accent)}>−</button>
                    <span style={{ fontWeight: 800, fontSize: 16, color: INK }}>{party} guests</span>
                    <button onClick={() => setParty((p) => Math.min(30, p + 1))} style={stepperBtn(accent)}>+</button>
                  </div>
                )}

                <SectionLabel accent={accent}>Select date</SectionLabel>
                <div className="lumio-tabs" style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 2 }}>
                  {dateCards.map((d, i) => {
                    const sel = d.getTime() === dateObj.getTime();
                    return <button key={i} className="lumio-row" onClick={() => { setDateObj(d); setSlot(null); }} style={{ flexShrink: 0, width: 64, padding: '9px 0', borderRadius: 12, border: `1px solid ${sel ? accent : '#e6eaf2'}`, background: sel ? tint(accent, 0.08) : '#fff', cursor: 'pointer', textAlign: 'center' }}>
                      <div style={{ fontSize: 10.5, fontWeight: 800, color: sel ? accent : '#94a3b8' }}>{i === 0 ? 'Today' : i === 1 ? 'Tmrw' : d.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                      <div style={{ fontSize: 10.5, color: '#94a3b8' }}>{d.toLocaleDateString('en-US', { month: 'short' })}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: sel ? accent : INK }}>{d.getDate()}</div>
                    </button>;
                  })}
                  <label style={{ position: 'relative', flexShrink: 0, width: 52, borderRadius: 12, border: '1px solid #e6eaf2', display: 'grid', placeItems: 'center', cursor: 'pointer', color: '#64748b' }}>
                    <Icon d="M8 2v4|M16 2v4|M3 10h18|M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" size={18} />
                    <input type="date" min={dateCards[0] ? `${dateCards[0].getFullYear()}-${pad(dateCards[0].getMonth() + 1)}-${pad(dateCards[0].getDate())}` : undefined} onChange={(e) => { if (e.target.value) { const [Y, M, D] = e.target.value.split('-').map(Number); setDateObj(new Date(Y, M - 1, D)); setSlot(null); } }} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
                  </label>
                </div>

                <SectionLabel accent={accent}>Select time</SectionLabel>
                {loadingAvail && !avail ? <p style={{ color: '#94a3b8', fontSize: 14 }}>Finding available times…</p>
                  : !anyOpen ? <div style={{ background: SOFT, border: '1px solid #eef1f6', borderRadius: 12, padding: 16, textAlign: 'center', color: '#64748b', fontSize: 14 }}>No tables for {party} guests on this date. Try another time or date.</div>
                  : groups.map(([label, arr]) => (
                    <div key={label} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 12.5, color: '#94a3b8', fontWeight: 700, margin: '2px 0 6px' }}>{label}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 7 }}>
                        {arr.map((s) => { const on = slot === s.hm; return (
                          <button key={s.hm} disabled={!s.open} className="lumio-slot" onClick={() => setSlot(s.hm)} style={{ ...pill(on, accent), padding: '8px 2px', background: on ? accent : s.open ? '#fff' : '#f4f6fb', color: on ? '#fff' : s.open ? INK : '#c2cbd9', borderColor: on ? accent : '#e6eaf2', cursor: s.open ? 'pointer' : 'not-allowed', textDecoration: s.open ? 'none' : 'line-through' }}>
                            <div>{fmtSlot(s.hm)}</div>{s.open && s.free <= 2 && <div style={{ fontSize: 9.5, color: on ? '#fff' : accent, fontWeight: 800 }}>Few left</div>}
                          </button>); })}
                      </div>
                    </div>
                  ))}

                {seatingOpts.length > 1 && (<>
                  <SectionLabel accent={accent}>Seating preference</SectionLabel>
                  <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>{seatingOpts.map((s) => <button key={s} className="lumio-row" onClick={() => setSeating(s)} style={{ ...pill(seating === s, accent), flex: '1 1 100px' }}>{s}</button>)}</div>
                </>)}
              </div>
            )}

            {step === 2 && (
              <div>
                <SectionLabel accent={accent}>Contact details</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name *" />
                  <input style={inputStyle} type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone number *" />
                  <input style={inputStyle} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email (optional)" />
                </div>
                <SectionLabel accent={accent}>Special occasion <span style={{ fontWeight: 500, color: '#94a3b8', fontSize: 13 }}>(optional)</span></SectionLabel>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>{OCCASIONS.map((o) => <button key={o} className="lumio-row" onClick={() => setOccasion(occasion === o ? '' : o)} style={{ ...pill(occasion === o, accent), flex: '1 1 90px' }}>{o}</button>)}</div>
                <SectionLabel accent={accent}>Additional requests</SectionLabel>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>{REQUESTS.map((r) => <button key={r} className="lumio-row" onClick={() => toggleReq(r)} style={{ ...pill(requests.includes(r), accent), flex: '1 1 120px' }}>{r}</button>)}</div>
                <textarea value={note} maxLength={250} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Add a note for the restaurant (optional)" style={{ ...inputStyle, marginTop: 12, resize: 'vertical', fontFamily: 'inherit' }} />
                <div style={{ textAlign: 'right', fontSize: 11, color: '#94a3b8' }}>{note.length}/250</div>
                <div style={{ display: 'flex', gap: 10, background: tint(accent, 0.07), borderRadius: 12, padding: 13, marginTop: 8 }}>
                  <span style={{ color: accent, flexShrink: 0 }}><Icon d="M12 6v6l4 2|M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" /></span>
                  <div style={{ fontSize: 13, color: '#44506a' }}><b style={{ color: INK }}>Your table is held for 15 minutes.</b> Please arrive on time — call the restaurant if you&rsquo;re running late.</div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div>
                <div style={{ border: '1px solid #eef1f6', borderRadius: 14, padding: '6px 16px' }}>
                  {([['Restaurant', salon.name + (salon.contactPhone ? ' · ' + salon.contactPhone : '')], ...resRows] as [string, string][]).map(([k, v], i) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '11px 0', fontSize: 14, borderTop: i ? '1px solid #f1f4f9' : 'none' }}><span style={{ color: '#94a3b8', flexShrink: 0 }}>{k}</span><span style={{ color: INK, fontWeight: 700, textAlign: 'right' }}>{v}</span></div>
                  ))}
                </div>
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: 13, marginTop: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#92400e' }}>Cancellation policy</div>
                  <div style={{ fontSize: 12.5, color: '#92400e', marginTop: 2 }}>You can cancel or modify up to 2 hours in advance.{depLabel ? ` A ${depLabel} may be applied to hold your table.` : ''}</div>
                </div>
                <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 14, fontSize: 13.5, color: '#44506a', cursor: 'pointer' }}>
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 2 }} />
                  <span>I agree to the cancellation policy and terms.</span>
                </label>
                {!isMobile && (
                  <button onClick={submit} disabled={submitting || !agreed} className="lumio-cta" style={{ ...ctaBtn, marginTop: 16, opacity: submitting || !agreed ? 0.45 : 1, cursor: submitting || !agreed ? 'not-allowed' : 'pointer' }}>{submitting ? 'Reserving…' : 'Confirm Reservation'}</button>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 16, borderTop: '1px solid #f1f4f9', paddingTop: 14 }}>
                  {[['M20 6L9 17l-5-5', 'Instant confirmation'], ['M20.6 13.4 12 22l-9-9V3h10z|M7 7h.01', 'No booking fees'], ['M19 11H5V21H19V11z|M7 11V7a5 5 0 0 1 10 0v4', 'Secure & private'], ['M12 2l3 6.5 7 .6-5.3 4.7 1.6 7L12 17l-6.9 3.8 1.6-7L1.4 9.1l7-.6z', 'Top-rated']].map(([d, t]) => (
                    <div key={t} style={{ textAlign: 'center', color: '#64748b' }}><div style={{ color: accent }}><Icon d={d} size={18} /></div><div style={{ fontSize: 10.5, marginTop: 3, lineHeight: 1.2 }}>{t}</div></div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* right: reservation summary, always in view (desktop) */}
          {!isMobile && (
            <div style={{ position: 'sticky', top: 92, height: 'calc(100vh - 124px)', minHeight: 420, marginTop: 16 }}>{summary}</div>
          )}
        </div>

        {isMobile && <MobileBar accent={accent} party={party} timeLine={slot ? fmtSlot(slot) : null} canContinue={canContinue} label={ctaLabel} onContinue={goNext} embedded={embedded} />}

        <a href="https://lumioagency.com/" target="_blank" rel="noopener noreferrer" style={{ display: 'block', textAlign: 'center', padding: isMobile ? '14px 0 calc(96px + env(safe-area-inset-bottom, 0px))' : '16px 0 8px', fontSize: 11.5, color: '#94a3b8', textDecoration: 'none' }}>
          Powered by <span style={{ color: accent, fontWeight: 700 }}>Lumio Booking</span>
        </a>
      </div>

      {showMenu && <MenuSheet base={base} accent={accent} menu={menu} onClose={() => setShowMenu(false)} />}
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Reusable pieces (mirrors of the salon booking page's design system)
// ---------------------------------------------------------------------------

function Progress({ step, accent }: { step: number; accent: string }) {
  const steps = ['Reserve', 'Details', 'Confirm'];
  const idx = step - 1;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 4px 2px' }}>
      {steps.map((label, i) => {
        const done = i < idx, on = i === idx;
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: i === steps.length - 1 ? '0 0 auto' : 1, minWidth: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0, fontSize: 12.5, fontWeight: 700, color: on ? accent : done ? '#16a34a' : '#a9b4c6' }}>
              <span className={on ? 'lumio-dot' : undefined} style={{ width: 20, height: 20, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800, background: done ? '#16a34a' : on ? accent : '#e6eaf2', color: done || on ? '#fff' : '#94a3b8', boxShadow: on ? `0 0 0 4px ${tint(accent, 0.15)}` : 'none' }}>{done ? '✓' : i + 1}</span>
              <span style={{ whiteSpace: 'nowrap' }}>{label}</span>
            </span>
            {i < steps.length - 1 && <span style={{ flex: 1, height: 2, borderRadius: 2, background: done ? '#16a34a' : '#e6eaf2', minWidth: 12 }} />}
          </div>
        );
      })}
    </div>
  );
}

function ReservationSummary({ salon, accent, rows, hasSlot, dateLine, timeLine, party, depLabel, canContinue, ctaLabel, onContinue, onViewMenu, step }: {
  salon: Salon; accent: string; rows: [string, string][]; hasSlot: boolean; dateLine: string | null; timeLine: string | null;
  party: number; depLabel: string | null; canContinue: boolean; ctaLabel: string; onContinue: () => void; onViewMenu: () => void; step: number;
}) {
  const perks: [string, string][] = [
    ['🕐', 'Reserve any time — 24/7 online, even when we’re closed.'],
    ['✅', 'Instant confirmation by text the moment your table is held.'],
    ['🪑', 'Your table is held for 15 minutes after your time.'],
    ['🍽️', 'Browse the menu before you arrive.'],
  ];
  return (
    <aside style={{ background: '#fff', borderRadius: 18, overflow: 'hidden', boxShadow: `0 30px 60px -34px rgba(15,42,82,.45), 0 0 0 1px ${tint(accent, 0.10)}`, height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: `linear-gradient(120deg, ${accent} 0%, ${shade(accent, 0.18)} 55%, ${shade(accent, 0.42)} 100%)`, color: '#fff', padding: '16px 18px', display: 'flex', gap: 13, alignItems: 'center', flexShrink: 0, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22)' }}>
        <Logo url={salon.branding?.logoUrl} scale={salon.branding?.logoScale} size={46} />
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: -0.2, lineHeight: 1.2 }}>{salon.name}</div>
          {salon.address && <div style={{ fontSize: 11.5, opacity: 0.78, lineHeight: 1.45 }}>{salon.address}</div>}
          {salon.contactPhone && <div style={{ fontSize: 11.5, opacity: 0.78, letterSpacing: 0.2 }}>{salon.contactPhone}</div>}
        </div>
      </div>
      <div className="lumio-perf" style={{ flexShrink: 0 }}><span className="lumio-tear" /></div>

      <div className="lumio-scroll" style={{ padding: '6px 16px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {!hasSlot && step === 1 ? (
          <div style={{ padding: '10px 2px' }}>
            <div style={{ textAlign: 'center', padding: '8px 0 14px' }}>
              <div style={{ width: 54, height: 54, borderRadius: '50%', background: tint(accent, 0.10), color: accent, display: 'grid', placeItems: 'center', fontSize: 24, margin: '0 auto 10px' }}>🍽️</div>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: INK }}>Choose your table</div>
              <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 4, lineHeight: 1.5 }}>Pick a party size, date and time to hold your table.</div>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {perks.map(([icon, text]) => (
                <div key={text} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 12, background: SOFT }}>
                  <span style={{ fontSize: 16, lineHeight: 1.2 }}>{icon}</span>
                  <span style={{ fontSize: 12.5, color: '#44506a', lineHeight: 1.45 }}>{text}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ padding: '4px 0' }}>
            {rows.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '11px 0', borderBottom: '1px solid #eef1f6', fontSize: 13.5 }}>
                <span style={{ color: '#94a3b8', flexShrink: 0 }}>{k}</span><span style={{ color: INK, fontWeight: 700, textAlign: 'right' }}>{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '12px 16px 16px', borderTop: '1px solid #eef1f6', flexShrink: 0, background: '#fff' }}>
        {hasSlot && dateLine && (
          <div style={{ marginBottom: 12, background: tint(accent, 0.08), borderRadius: 10, padding: '10px 12px', fontSize: 13, color: INK, lineHeight: 1.6 }}>
            <div>📅 <b>{dateLine}</b></div>
            <div>🕐 {timeLine} · {party} {party === 1 ? 'guest' : 'guests'}</div>
          </div>
        )}
        {depLabel && <div style={{ fontSize: 12, color: '#b45309', marginBottom: 8 }}>A {depLabel} may apply to hold your table.</div>}
        <button onClick={onViewMenu} style={{ width: '100%', padding: '10px', borderRadius: 12, border: `1px solid ${tint(accent, 0.30)}`, background: '#fff', color: accent, fontWeight: 700, fontSize: 13, cursor: 'pointer', marginBottom: 10 }}>View menu</button>
        <button onClick={onContinue} disabled={!canContinue} className="lumio-cta" style={{ ...ctaBtn, opacity: canContinue ? 1 : 0.45, cursor: canContinue ? 'pointer' : 'not-allowed' }}>{ctaLabel}</button>
      </div>
    </aside>
  );
}

/** Mobile floating action bar — always on screen. */
function MobileBar({ accent, party, timeLine, canContinue, label, onContinue, embedded }: {
  accent: string; party: number; timeLine: string | null; canContinue: boolean; label: string; onContinue: () => void; embedded: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const bar = (
    <div className="lumio-bar" style={{
      padding: '11px 12px', display: 'flex', alignItems: 'center', gap: 12,
      ...(embedded
        ? { position: 'relative', zIndex: 40, marginTop: 12, borderRadius: 18, background: '#fff', boxShadow: `0 20px 44px -14px rgba(15,42,82,0.38), 0 0 0 1px ${tint(accent, 0.10)}` }
        : { position: 'fixed', left: 10, right: 10, bottom: 'calc(10px + env(safe-area-inset-bottom, 0px))', zIndex: 2147483000, borderRadius: 20, background: 'rgba(255,255,255,.94)', boxShadow: `0 20px 44px -14px rgba(15,42,82,0.38), 0 0 0 1px ${tint(accent, 0.10)}`, backdropFilter: 'saturate(1.5) blur(10px)', WebkitBackdropFilter: 'saturate(1.5) blur(10px)' }),
      ['--accent' as string]: accent, ['--accent-dark' as string]: shade(accent, 0.28), ['--accent-glow' as string]: tint(accent, 0.55),
    } as React.CSSProperties}>
      <span style={{ width: 42, height: 42, borderRadius: 13, background: tint(accent, 0.10), display: 'grid', placeItems: 'center', fontSize: 18, flexShrink: 0 }}>🍽️</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: '#8fa0bb', fontWeight: 600 }}>{party} {party === 1 ? 'guest' : 'guests'}{timeLine ? ` · 🕐 ${timeLine}` : ''}</div>
        <div style={{ fontSize: 15, fontWeight: 800, color: INK, letterSpacing: -0.3 }}>{timeLine ? 'Table ready to hold' : 'Pick a time'}</div>
      </div>
      <button onClick={onContinue} disabled={!canContinue} className="lumio-cta" style={{ ...ctaBtn, width: 'auto', padding: '13px 20px', fontSize: 14.5, whiteSpace: 'nowrap', opacity: canContinue ? 1 : 0.42, cursor: canContinue ? 'pointer' : 'not-allowed' }}>{label} →</button>
    </div>
  );
  if (embedded || !mounted) return bar;
  return createPortal(bar, document.body);
}

function MenuSheet({ base, accent, menu, onClose }: { base: string; accent: string; menu: Dish[] | null; onClose: () => void }) {
  const grouped = useMemo(() => menu ? Object.entries(menu.reduce((acc: Record<string, Dish[]>, d) => { const k = d.category || 'Other'; (acc[k] ||= []).push(d); return acc; }, {})) : [], [menu]);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,42,82,0.5)', zIndex: 2147483600, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '18px 18px 0 0', maxWidth: 520, width: '100%', maxHeight: '82vh', overflowY: 'auto', padding: 20 }} className="lumio-scroll">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 22, color: INK }}>Menu</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 24, color: '#64748b', cursor: 'pointer' }}>×</button>
        </div>
        {!menu ? <p style={{ color: '#94a3b8' }}>Loading…</p> : menu.length === 0 ? <p style={{ color: '#94a3b8' }}>Menu coming soon.</p> :
          grouped.map(([cat, dishes]) => (
            <div key={cat} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: accent, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{cat}</div>
              {dishes.map((d) => (
                <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid #f1f4f9' }}>
                  <div><div style={{ fontSize: 14.5, fontWeight: 700, color: INK }}>{d.name}</div>{d.description && <div style={{ fontSize: 12.5, color: '#94a3b8' }}>{d.description}</div>}</div>
                  <div style={{ fontSize: 14.5, fontWeight: 800, color: accent, whiteSpace: 'nowrap' }}>${(d.priceCents / 100).toFixed(0)}</div>
                </div>
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}

function Logo({ url, size, scale }: { url?: string | null; size: number; scale?: number }) {
  const clean = (url ?? '').trim();
  const zoom = Math.min(200, Math.max(50, scale ?? 100)) / 100;
  if (clean.startsWith('https://') || clean.startsWith('data:image/')) {
    return (
      <span style={{ width: size, height: size, borderRadius: 10, background: '#fff', display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0, boxShadow: '0 2px 8px rgba(15,42,82,0.18)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={clean} alt="" width={size} height={size} style={{ width: '100%', height: '100%', objectFit: 'contain', transform: `scale(${zoom})`, transformOrigin: 'center' }} />
      </span>
    );
  }
  return <span style={{ width: size, height: size, borderRadius: 10, background: 'rgba(255,255,255,0.18)', display: 'grid', placeItems: 'center', fontSize: size * 0.5, flexShrink: 0 }}>🍽️</span>;
}

function SectionLabel({ children, accent }: { children: React.ReactNode; accent: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '20px 0 10px' }}>
      <span style={{ width: 4, height: 15, borderRadius: 2, background: accent, flexShrink: 0 }} />
      <span style={{ fontSize: 15, fontWeight: 800, color: INK }}>{children}</span>
    </div>
  );
}

function useEmbedded(): boolean {
  const [emb, setEmb] = useState(false);
  useEffect(() => { try { setEmb(window.self !== window.top); } catch { setEmb(true); } }, []);
  return emb;
}

/** Same stage as the salon page: a soft colour-mesh background, the brand CSS,
 *  and (in an iframe) reporting the content height so the embed grows to fit. */
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
    const post = () => {
      const el = rootRef.current; if (!el) return;
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h < 120) return;
      try { window.parent.postMessage({ type: 'lumio-embed-height', height: h }, '*'); } catch { /* ignore */ }
    };
    post();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(post) : null;
    if (ro && rootRef.current) ro.observe(rootRef.current);
    const iv = window.setInterval(post, 400);
    window.addEventListener('resize', post);
    return () => { if (ro) ro.disconnect(); window.clearInterval(iv); window.removeEventListener('resize', post); };
  }, []);
  return (
    <>
      <style>{BOOK_CSS}</style>
      <div ref={rootRef} className="lumio-shell" style={{
        minHeight: embedded ? 0 : '100vh',
        background: `radial-gradient(1200px 560px at 8% -10%, ${tint(accent, 0.20)}, transparent 58%),
             radial-gradient(1000px 520px at 108% 4%, ${tint(accent, 0.13)}, transparent 55%),
             radial-gradient(820px 620px at 78% 118%, ${tint(shade(accent, 0.32), 0.12)}, transparent 60%),
             linear-gradient(180deg, #f8fafe 0%, #eef2f8 100%)`,
        padding: embedded ? 12 : 16, fontFamily: FONT,
        ['--accent' as string]: accent, ['--accent-glow' as string]: tint(accent, 0.55), ['--accent-dark' as string]: shade(accent, 0.28), ['--stage' as string]: '#eef2f8',
      } as React.CSSProperties}>
        {children}
      </div>
    </>
  );
}

// ---- shared style tokens (mirrors the salon page) ----
const pill = (on: boolean, accent: string): React.CSSProperties => ({ padding: '11px 6px', borderRadius: 12, fontSize: 13.5, fontWeight: 700, cursor: 'pointer', textAlign: 'center', border: `1px solid ${on ? accent : '#e6eaf2'}`, background: on ? tint(accent, 0.08) : '#fff', color: on ? accent : '#44506a' });
const stepperBtn = (accent: string): React.CSSProperties => ({ width: 36, height: 36, borderRadius: 9, border: '1px solid #e6eaf2', background: '#fff', color: accent, fontSize: 20, cursor: 'pointer' });
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '13px 14px', borderRadius: 11, border: '1px solid #dbe2ee', background: '#fff', color: INK, fontSize: 15 };
const ctaBtn: React.CSSProperties = { width: '100%', padding: '14px', borderRadius: 14, border: 'none', background: 'var(--accent, #dc2626)', color: '#fff', fontWeight: 800, fontSize: 15.5, cursor: 'pointer' };
const primaryBtn: React.CSSProperties = { padding: '12px 22px', borderRadius: 999, border: 'none', background: 'var(--accent, #dc2626)', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer' };

const BOOK_CSS = `
@keyframes lumioIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes lumioPop { from { opacity: 0; transform: translateY(6px) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes lumioShine { 0% { transform: translateX(-120%); } 60%, 100% { transform: translateX(220%); } }
@keyframes lumioPulse { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
@keyframes lumioRing { 0% { transform: scale(.9); } 45% { transform: scale(1.12); } 100% { transform: scale(1); } }
.lumio-book, .lumio-book button, .lumio-book input, .lumio-book select, .lumio-book textarea, .lumio-book a,
.lumio-shell, .lumio-shell button, .lumio-shell input { font-family: ${FONT}; -webkit-font-smoothing: antialiased; }
.lumio-book h1, .lumio-book h2 { font-family: ${DISPLAY}; letter-spacing: -0.2px; }
.lumio-book { animation: lumioIn .45s cubic-bezier(.2,.75,.25,1) both; }
.lumio-step { animation: lumioPop .32s cubic-bezier(.2,.75,.25,1) both; }
.lumio-book button, .lumio-book a { transition: transform .14s cubic-bezier(.2,.75,.25,1), box-shadow .2s ease, border-color .16s ease, background .16s ease, color .16s ease; }
.lumio-book button:active:not(:disabled) { transform: translateY(1px) scale(.99); }
.lumio-row:hover:not(:disabled) { transform: translateY(-2px); border-color: var(--accent, #dc2626) !important; box-shadow: 0 10px 24px -12px rgba(15,42,82,.35); }
.lumio-row:focus-visible { outline: 2px solid var(--accent, #dc2626); outline-offset: 2px; }
.lumio-slot:hover:not(:disabled) { transform: translateY(-2px); border-color: var(--accent, #dc2626) !important; box-shadow: 0 8px 18px -10px rgba(15,42,82,.4); }
.lumio-cta { position: relative; overflow: hidden; }
.lumio-cta:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 14px 30px -12px var(--accent-glow, rgba(220,38,38,.75)); }
.lumio-cta:not(:disabled)::after { content: ''; position: absolute; top: 0; bottom: 0; width: 38%; background: linear-gradient(100deg, transparent, rgba(255,255,255,.42), transparent); animation: lumioShine 2.6s ease-in-out .4s infinite; }
.lumio-tabs::-webkit-scrollbar { height: 0; }
.lumio-scroll::-webkit-scrollbar { width: 6px; }
.lumio-scroll::-webkit-scrollbar-thumb { background: #dfe5ef; border-radius: 99px; }
.lumio-dot { animation: lumioPulse 1.6s ease-in-out infinite; }
.lumio-added { animation: lumioRing .34s cubic-bezier(.2,1,.3,1); }
.lumio-perf { position: relative; height: 20px; }
.lumio-perf::before, .lumio-perf::after { content: ''; position: absolute; top: -10px; width: 20px; height: 20px; border-radius: 50%; background: var(--stage, #eef2f8); box-shadow: inset 0 -1px 2px rgba(15,42,82,.06); }
.lumio-perf::before { left: -10px; } .lumio-perf::after { right: -10px; }
.lumio-tear { position: absolute; top: 9px; left: 12px; right: 12px; border-top: 2px dashed rgba(15,42,82,.14); }
@media (prefers-reduced-motion: reduce) { .lumio-book, .lumio-step, .lumio-cta::after, .lumio-dot, .lumio-added { animation: none !important; } .lumio-book button:hover, .lumio-row:hover, .lumio-slot:hover, .lumio-cta:hover { transform: none !important; } }
`;
