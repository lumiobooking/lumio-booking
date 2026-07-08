'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface Deposit { enabled: boolean; type: 'percent' | 'fixed'; percent: number; fixedCents: number }
interface Salon { name: string; slug: string; timezone: string; contactPhone?: string | null; areas?: string[]; branding?: { accentColor?: string; logoUrl?: string }; deposit?: Deposit }
interface Svc { id: string; durationMinutes: number }
interface Avail { tableCount: number; durationMinutes: number; busy: { start: string; end: string }[] }
interface Dish { name: string; category: string | null; priceCents: number; description: string | null }

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';
const pad = (n: number) => String(n).padStart(2, '0');
const SERIF = 'Georgia, "Times New Roman", serif';
const OCCASIONS = ['Birthday', 'Anniversary', 'Date Night', 'Business', 'None'];
const REQUESTS = ['High chair', 'Booth', 'Quiet area', 'Near window'];

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
  const areas = (salon.areas && salon.areas.length ? salon.areas : []);
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

  useEffect(() => { fetch(`${base}/services`).then((r) => r.json()).then((s: Svc[]) => setSvcId(Array.isArray(s) && s[0] ? s[0].id : '')).catch(() => {}); }, [base]);
  useEffect(() => { if (showMenu && !menu) fetch(`${base}/menu`).then((r) => r.json()).then(setMenu).catch(() => setMenu([])); }, [showMenu, menu, base]);

  const loadAvail = useCallback(async () => {
    setSlot(null); setLoadingAvail(true);
    const a = seating && seating !== 'No Preference' ? `&area=${encodeURIComponent(seating)}` : '';
    try { const r = await fetch(`${base}/table-availability?date=${date}&partySize=${party}${a}`); setAvail(await r.json()); }
    catch { setAvail(null); } finally { setLoadingAvail(false); }
  }, [base, date, party, seating]);
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

  const fmtSlot = (hm: string) => { const [h, m] = hm.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
  const dateCards = useMemo(() => Array.from({ length: 5 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i); return d; }), []);
  const prettyDate = () => dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const dep = salon.deposit;
  const depLabel = dep?.enabled ? (dep.type === 'percent' ? `${dep.percent}% deposit` : `$${(dep.fixedCents / 100).toFixed(2)} deposit`) : null;
  const initial = (salon.name || 'R').trim().charAt(0).toUpperCase();
  const goto = (n: number) => { setError(null); setStep(n); if (typeof window !== 'undefined') window.scrollTo(0, 0); };
  const toggleReq = (r: string) => setRequests((xs) => xs.includes(r) ? xs.filter((x) => x !== r) : [...xs, r]);

  async function submit() {
    if (!slot || !svcId) { setError('Online reservations are not available yet.'); return; }
    if (!form.name.trim() || !form.phone.trim()) { setError('Please enter your name and phone.'); goto(2); return; }
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
        body: JSON.stringify({ serviceId: svcId, startTime: startISO, partySize: party, area: seating !== 'No Preference' ? seating : undefined, customerFirstName: first, customerLastName: rest.join(' ') || undefined, customerPhone: form.phone.trim(), customerEmail: form.email.trim() || undefined, notes: parts.join(' · ') || undefined, paymentType: dep?.enabled ? 'PAY_ONLINE' : 'PAY_LATER' }),
      });
      const b = await res.json().catch(() => null);
      if (!res.ok) { setError((b && b.message) || `Reservation failed (${res.status})`); return; }
      setDone(true); if (typeof window !== 'undefined') window.scrollTo(0, 0);
    } catch { setError('Network error. Please try again.'); }
    finally { setSubmitting(false); }
  }

  const page: React.CSSProperties = { minHeight: '100vh', background: '#f7f5f3', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '0 0 60px', fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' };
  const shell: React.CSSProperties = { maxWidth: 460, width: '100%', background: '#fff', minHeight: '100vh' };
  const lbl: React.CSSProperties = { fontSize: 15, fontWeight: 700, color: '#1c1917', margin: '20px 0 10px' };
  const inp: React.CSSProperties = { width: '100%', padding: '13px 14px', borderRadius: 11, border: '1px solid #e7e5e4', fontSize: 15, boxSizing: 'border-box', background: '#fff', color: '#1c1917' };
  const cta = (dis: boolean): React.CSSProperties => ({ width: '100%', marginTop: 20, padding: '15px', borderRadius: 12, border: 'none', background: dis ? '#d6d3d1' : accent, color: '#fff', fontSize: 16, fontWeight: 700, cursor: dis ? 'not-allowed' : 'pointer' });
  const pill = (on: boolean): React.CSSProperties => ({ padding: '10px 6px', borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', textAlign: 'center', border: `1px solid ${on ? accent : '#e7e5e4'}`, background: on ? '#fef2f2' : '#fff', color: on ? accent : '#44403c' });

  const Head = (title: string) => (
    <div style={{ position: 'relative', textAlign: 'center', padding: '16px 50px 10px' }}>
      {step > 1 && step < 4 && <button onClick={() => goto(step - 1)} aria-label="Back" style={{ position: 'absolute', left: 16, top: 15, background: 'none', border: 'none', cursor: 'pointer', color: '#44403c' }}><Icon d="M15 18l-6-6 6-6" size={22} /></button>}
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: accent }}>STEP {Math.min(step, 3)} OF 3</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: '#1c1917', marginTop: 2 }}>{title}</div>
    </div>
  );

  if (done) return (
    <div style={page}><div style={{ ...shell, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', padding: 30, textAlign: 'center' }}>
      <div style={{ width: 66, height: 66, borderRadius: '50%', background: '#e7f6ed', color: '#15803d', display: 'grid', placeItems: 'center', marginBottom: 16 }}><Icon d="M20 6L9 17l-5-5" size={34} /></div>
      <h2 style={{ fontFamily: SERIF, fontSize: 26, margin: '0 0 6px', color: '#1c1917' }}>You&rsquo;re booked!</h2>
      <p style={{ color: '#78716c', fontSize: 14.5, margin: '0 0 20px' }}>A confirmation text is on its way.</p>
      <div style={{ textAlign: 'left', background: '#f7f5f3', border: '1px solid #eee', borderRadius: 14, padding: '16px 18px', width: '100%', maxWidth: 360 }}>
        <div style={{ fontFamily: SERIF, fontSize: 19, color: '#1c1917', marginBottom: 8 }}>{salon.name}</div>
        {[['Date', prettyDate()], ['Time', slot ? fmtSlot(slot) : ''], ['Party', `${party} ${party === 1 ? 'guest' : 'guests'}`], ...(seating !== 'No Preference' ? [['Seating', seating]] : [])].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 14.5 }}><span style={{ color: '#a8a29e' }}>{k}</span><span style={{ color: '#292524', fontWeight: 600 }}>{v}</span></div>
        ))}
      </div>
      {depLabel && <p style={{ color: '#b45309', fontSize: 13, marginTop: 14 }}>A {depLabel} may apply to hold your table.</p>}
    </div></div>
  );

  return (
    <div style={page}>
      <div style={shell}>
        {Head(step === 1 ? 'Choose Your Table' : step === 2 ? 'Your Information' : 'Review & Confirm')}
        <div style={{ padding: '4px 20px 24px' }}>
          {error && <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '10px 13px', borderRadius: 11, fontSize: 14, marginBottom: 14 }}>{error}</div>}

          {step === 1 && (
            <div>
              <div style={{ height: 128, borderRadius: 14, background: salon.branding?.logoUrl ? `#000 url(${salon.branding.logoUrl}) center/cover` : accent, position: 'relative' }} />
              <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 14, padding: 14, marginTop: -46, position: 'relative', boxShadow: '0 6px 20px rgba(0,0,0,0.08)' }}>
                <div style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
                  <div style={{ width: 46, height: 46, borderRadius: 10, background: accent, color: '#fff', display: 'grid', placeItems: 'center', fontFamily: SERIF, fontSize: 22, flexShrink: 0 }}>{initial}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: '#1c1917' }}>{salon.name}</div>
                    {salon.contactPhone && <div style={{ fontSize: 13, color: '#78716c' }}>{salon.contactPhone}</div>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button onClick={() => setShowMenu(true)} style={{ flex: 1, padding: '8px 0', borderRadius: 9, border: '1px solid #e7e5e4', background: '#fff', color: '#44403c', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}><Icon d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20|M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" size={15} />View Menu</button>
                  {salon.contactPhone && <a href={`tel:${salon.contactPhone}`} style={{ flex: 1, padding: '8px 0', borderRadius: 9, border: '1px solid #e7e5e4', background: '#fff', color: '#44403c', fontSize: 12.5, fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}><Icon d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2z" size={15} />Call</a>}
                  <a href={`https://maps.google.com/?q=${encodeURIComponent(salon.name)}`} target="_blank" rel="noreferrer" style={{ flex: 1, padding: '8px 0', borderRadius: 9, border: '1px solid #e7e5e4', background: '#fff', color: '#44403c', fontSize: 12.5, fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}><Icon d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z|M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" size={15} />Map</a>
                </div>
              </div>

              <div style={lbl}>Party Size</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 7 }}>
                {[1, 2, 3, 4, 5, 6].map((n) => <button key={n} onClick={() => setParty(n)} style={pill(party === n)}>{n}</button>)}
                <button onClick={() => setParty((p) => (p < 7 ? 7 : p))} style={pill(party >= 7)}>7+</button>
              </div>
              {party >= 7 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 8, border: '1px solid #e7e5e4', borderRadius: 10, padding: 6 }}>
                  <button onClick={() => setParty((p) => Math.max(7, p - 1))} style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid #e7e5e4', background: '#fff', color: accent, fontSize: 20, cursor: 'pointer' }}>−</button>
                  <span style={{ fontWeight: 700, fontSize: 16 }}>{party} guests</span>
                  <button onClick={() => setParty((p) => Math.min(20, p + 1))} style={{ width: 34, height: 34, borderRadius: 8, border: '1px solid #e7e5e4', background: '#fff', color: accent, fontSize: 20, cursor: 'pointer' }}>+</button>
                </div>
              )}

              <div style={lbl}>Select Date</div>
              <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 2 }}>
                {dateCards.map((d, i) => {
                  const sel = d.getTime() === dateObj.getTime();
                  return <button key={i} onClick={() => setDateObj(d)} style={{ flexShrink: 0, width: 62, padding: '8px 0', borderRadius: 10, border: `1px solid ${sel ? accent : '#e7e5e4'}`, background: sel ? '#fef2f2' : '#fff', cursor: 'pointer', textAlign: 'center' }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: sel ? accent : '#a8a29e' }}>{i === 0 ? 'Today' : i === 1 ? 'Tmrw' : d.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                    <div style={{ fontSize: 10.5, color: '#a8a29e' }}>{d.toLocaleDateString('en-US', { month: 'short' })}</div>
                    <div style={{ fontSize: 17, fontWeight: 700, color: sel ? accent : '#1c1917' }}>{d.getDate()}</div>
                  </button>;
                })}
                <label style={{ flexShrink: 0, width: 50, borderRadius: 10, border: '1px solid #e7e5e4', display: 'grid', placeItems: 'center', cursor: 'pointer', color: '#78716c' }}>
                  <Icon d="M8 2v4|M16 2v4|M3 10h18|M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" size={18} />
                  <input type="date" min={dateCards[0] ? `${dateCards[0].getFullYear()}-${pad(dateCards[0].getMonth() + 1)}-${pad(dateCards[0].getDate())}` : undefined} onChange={(e) => { if (e.target.value) { const [Y, M, D] = e.target.value.split('-').map(Number); setDateObj(new Date(Y, M - 1, D)); } }} style={{ position: 'absolute', opacity: 0, width: 50, height: 50, cursor: 'pointer' }} />
                </label>
              </div>

              <div style={lbl}>Select Time</div>
              {loadingAvail ? <p style={{ color: '#a8a29e', fontSize: 14 }}>Finding available times…</p>
                : !anyOpen ? <div style={{ background: '#f7f5f3', border: '1px solid #eee', borderRadius: 12, padding: 16, textAlign: 'center', color: '#78716c', fontSize: 14 }}>No tables for {party} guests{seating !== 'No Preference' ? ` in ${seating}` : ''} on this date.</div>
                : groups.map(([label, arr]) => (
                  <div key={label} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 12.5, color: '#a8a29e', fontWeight: 600, marginBottom: 6 }}>{label}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 7 }}>
                      {arr.map((s) => { const on = slot === s.hm; return (
                        <button key={s.hm} disabled={!s.open} onClick={() => setSlot(s.hm)} style={{ ...pill(on), background: on ? accent : s.open ? '#fff' : '#f5f5f4', color: on ? '#fff' : s.open ? '#44403c' : '#d6d3d1', borderColor: on ? accent : '#e7e5e4', cursor: s.open ? 'pointer' : 'not-allowed', textDecoration: s.open ? 'none' : 'line-through', padding: '7px 2px' }}>
                          <div>{fmtSlot(s.hm)}</div>{s.open && s.free <= 2 && <div style={{ fontSize: 9.5, color: on ? '#fff' : accent, fontWeight: 700 }}>Few left</div>}
                        </button>); })}
                    </div>
                  </div>
                ))}

              {seatingOpts.length > 1 && (<>
                <div style={lbl}>Seating Preference</div>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>{seatingOpts.map((s) => <button key={s} onClick={() => setSeating(s)} style={{ ...pill(seating === s), flex: '1 1 90px' }}>{s}</button>)}</div>
              </>)}

              <button onClick={() => (slot ? goto(2) : setError('Please select a time.'))} style={cta(false)}>Continue</button>
              <p style={{ textAlign: 'center', color: '#a8a29e', fontSize: 12, marginTop: 10 }}>You&rsquo;ll review your details in the next step</p>
            </div>
          )}

          {step === 2 && (
            <div>
              <div style={lbl}>Contact Details</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                <input style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name *" />
                <input style={inp} type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone number *" />
                <input style={inp} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email (optional)" />
              </div>
              <div style={lbl}>Special Occasion <span style={{ fontWeight: 400, color: '#a8a29e', fontSize: 13 }}>(optional)</span></div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>{OCCASIONS.map((o) => <button key={o} onClick={() => setOccasion(occasion === o ? '' : o)} style={{ ...pill(occasion === o), flex: '1 1 80px' }}>{o}</button>)}</div>
              <div style={lbl}>Additional Requests</div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>{REQUESTS.map((r) => <button key={r} onClick={() => toggleReq(r)} style={{ ...pill(requests.includes(r)), flex: '1 1 100px' }}>{r}</button>)}</div>
              <textarea value={note} maxLength={250} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Add a note for the restaurant (optional)" style={{ ...inp, marginTop: 12, resize: 'vertical', fontFamily: 'inherit' }} />
              <div style={{ textAlign: 'right', fontSize: 11, color: '#a8a29e' }}>{note.length}/250</div>
              <div style={{ display: 'flex', gap: 10, background: '#fef2f2', borderRadius: 12, padding: 13, marginTop: 8 }}>
                <span style={{ color: accent, flexShrink: 0 }}><Icon d="M12 6v6l4 2|M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z" /></span>
                <div style={{ fontSize: 13, color: '#44403c' }}><b>Table will be held for 15 minutes.</b> Please arrive on time — contact the restaurant if you&rsquo;re running late.</div>
              </div>
              <button onClick={() => { if (!form.name.trim() || !form.phone.trim()) { setError('Please enter your name and phone.'); return; } goto(3); }} style={cta(false)}>Review Reservation</button>
            </div>
          )}

          {step === 3 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1c1917' }}>Your Reservation</div>
                <button onClick={() => goto(1)} style={{ background: 'none', border: 'none', color: accent, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Edit</button>
              </div>
              <div style={{ border: '1px solid #eee', borderRadius: 14, padding: '6px 16px', marginTop: 10 }}>
                {([['Restaurant', salon.name + (salon.contactPhone ? ' · ' + salon.contactPhone : '')], ['Date', prettyDate()], ['Time', slot ? fmtSlot(slot) : ''], ['Party size', `${party} ${party === 1 ? 'person' : 'people'}`], ['Seating', seating], ...(occasion && occasion !== 'None' ? [['Occasion', occasion]] : []), ...(requests.length ? [['Requests', requests.join(', ')]] : []), ['Contact', `${form.name} · ${form.phone}`]] as [string, string][]).map(([k, v], i) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '11px 0', fontSize: 14, borderTop: i ? '1px solid #f0ece7' : 'none' }}><span style={{ color: '#a8a29e', flexShrink: 0 }}>{k}</span><span style={{ color: '#292524', fontWeight: 600, textAlign: 'right' }}>{v}</span></div>
                ))}
              </div>
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: 13, marginTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e' }}>Cancellation policy</div>
                <div style={{ fontSize: 12.5, color: '#92400e', marginTop: 2 }}>You can cancel or modify up to 2 hours in advance.{depLabel ? ` A ${depLabel} may be applied to hold your table.` : ''}</div>
              </div>
              <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginTop: 14, fontSize: 13.5, color: '#44403c', cursor: 'pointer' }}>
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 2 }} />
                <span>I agree to the cancellation policy and terms.</span>
              </label>
              <button onClick={submit} disabled={submitting || !agreed} style={cta(submitting || !agreed)}>{submitting ? 'Reserving…' : 'Confirm Reservation'}</button>
              <p style={{ textAlign: 'center', color: '#a8a29e', fontSize: 12, marginTop: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}><Icon d="M19 11H5V21H19V11z|M7 11V7a5 5 0 0 1 10 0v4" size={13} />Your reservation is secure</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 16, borderTop: '1px solid #f0ece7', paddingTop: 14 }}>
                {[['M20 6L9 17l-5-5', 'Instant Confirmation'], ['M20.6 13.4 12 22l-9-9V3h10z|M7 7h.01', 'No Booking Fees'], ['M19 11H5V21H19V11z|M7 11V7a5 5 0 0 1 10 0v4', 'Secure Payment'], ['M12 2l3 6.5 7 .6-5.3 4.7 1.6 7L12 17l-6.9 3.8 1.6-7L1.4 9.1l7-.6z', 'Top-Rated']].map(([d, t]) => (
                  <div key={t} style={{ textAlign: 'center', color: '#78716c' }}><div style={{ color: accent }}><Icon d={d} size={18} /></div><div style={{ fontSize: 10.5, marginTop: 3, lineHeight: 1.2 }}>{t}</div></div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {showMenu && (
        <div onClick={() => setShowMenu(false)} style={{ position: 'relative', minHeight: '100vh', width: '100%', display: 'flex' }}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '18px 18px 0 0', maxWidth: 460, width: '100%', maxHeight: '82vh', overflowY: 'auto', padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontFamily: SERIF, fontSize: 22, color: '#1c1917' }}>Menu</div>
                <button onClick={() => setShowMenu(false)} style={{ background: 'none', border: 'none', fontSize: 24, color: '#78716c', cursor: 'pointer' }}>×</button>
              </div>
              {!menu ? <p style={{ color: '#a8a29e' }}>Loading…</p> : menu.length === 0 ? <p style={{ color: '#a8a29e' }}>Menu coming soon.</p> :
                Object.entries(menu.reduce((acc: Record<string, Dish[]>, d) => { const k = d.category || 'Other'; (acc[k] ||= []).push(d); return acc; }, {})).map(([cat, dishes]) => (
                  <div key={cat} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>{cat}</div>
                    {dishes.map((d) => (
                      <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid #f5f5f4' }}>
                        <div><div style={{ fontSize: 14.5, fontWeight: 600, color: '#1c1917' }}>{d.name}</div>{d.description && <div style={{ fontSize: 12.5, color: '#a8a29e' }}>{d.description}</div>}</div>
                        <div style={{ fontSize: 14.5, fontWeight: 700, color: accent, whiteSpace: 'nowrap' }}>${(d.priceCents / 100).toFixed(0)}</div>
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
