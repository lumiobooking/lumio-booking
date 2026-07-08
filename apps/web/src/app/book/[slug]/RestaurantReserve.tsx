'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface Deposit { enabled: boolean; type: 'percent' | 'fixed'; percent: number; fixedCents: number }
interface Salon { name: string; slug: string; timezone: string; branding?: { accentColor?: string; logoUrl?: string }; deposit?: Deposit }
interface Svc { id: string; durationMinutes: number }
interface Avail { tableCount: number; durationMinutes: number; busy: { start: string; end: string }[] }

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';
const pad = (n: number) => String(n).padStart(2, '0');
const SERIF = 'Georgia, "Times New Roman", serif';

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

export function RestaurantReserve({ slug, salon }: { slug: string; salon: Salon }) {
  const base = `${API_URL}/public/salons/${encodeURIComponent(slug)}`;
  const accent = salon.branding?.accentColor || '#1f2937';
  const tz = salon.timezone || 'UTC';
  const todayStr = useMemo(() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }, []);

  const [date, setDate] = useState(todayStr);
  const [party, setParty] = useState(2);
  const [avail, setAvail] = useState<Avail | null>(null);
  const [loadingAvail, setLoadingAvail] = useState(true);
  const [svcId, setSvcId] = useState('');
  const [slot, setSlot] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${base}/services`).then((r) => r.json()).then((s: Svc[]) => setSvcId(Array.isArray(s) && s[0] ? s[0].id : '')).catch(() => {});
  }, [base]);

  const loadAvail = useCallback(async () => {
    setSlot(null); setLoadingAvail(true);
    try { const r = await fetch(`${base}/table-availability?date=${date}&partySize=${party}`); setAvail(await r.json()); }
    catch { setAvail(null); }
    finally { setLoadingAvail(false); }
  }, [base, date, party]);
  useEffect(() => { loadAvail(); }, [loadAvail]);

  const slots = useMemo(() => {
    if (!avail) return [] as { hm: string; hour: number; open: boolean }[];
    const dur = avail.durationMinutes || 90;
    const [Y, M, D] = date.split('-').map(Number);
    const out: { hm: string; hour: number; open: boolean }[] = [];
    for (let mins = 11 * 60; mins <= 21 * 60 + 30; mins += 30) {
      const hh = Math.floor(mins / 60), mm = mins % 60;
      const sUtc = new Date(wallTimeToISO(new Date(Y, M - 1, D, hh, mm), tz)).getTime();
      const eUtc = sUtc + dur * 60000;
      const overlaps = avail.busy.filter((b) => new Date(b.start).getTime() < eUtc && new Date(b.end).getTime() > sUtc).length;
      out.push({ hm: `${pad(hh)}:${pad(mm)}`, hour: hh, open: overlaps < avail.tableCount });
    }
    return out;
  }, [avail, date, tz]);

  const groups = useMemo(() => {
    const lunch = slots.filter((s) => s.hour < 15);
    const dinner = slots.filter((s) => s.hour >= 15);
    return ([['Lunch', lunch], ['Dinner', dinner]] as [string, typeof slots][]).filter(([, arr]) => arr.length > 0);
  }, [slots]);
  const anyOpen = slots.some((s) => s.open);

  const fmtSlot = (hm: string) => { const [h, m] = hm.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
  const prettyDate = (ds: string) => new Date(ds + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const dep = salon.deposit;
  const depLabel = dep?.enabled ? (dep.type === 'percent' ? `${dep.percent}% deposit` : `$${(dep.fixedCents / 100).toFixed(2)} deposit`) : null;
  const initial = (salon.name || 'R').trim().charAt(0).toUpperCase();

  async function submit() {
    if (!slot || !svcId) { setError(svcId ? 'Please choose a time.' : 'Online reservations are not available yet.'); return; }
    if (!form.name.trim() || !form.phone.trim()) { setError('Please enter your name and phone number.'); return; }
    setSubmitting(true); setError(null);
    const [Y, M, D] = date.split('-').map(Number);
    const [h, m] = slot.split(':').map(Number);
    const startISO = wallTimeToISO(new Date(Y, M - 1, D, h, m), tz);
    const [first, ...rest] = form.name.trim().split(' ');
    try {
      const res = await fetch(`${base}/bookings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: svcId, startTime: startISO, partySize: party, customerFirstName: first, customerLastName: rest.join(' ') || undefined, customerPhone: form.phone.trim(), customerEmail: form.email.trim() || undefined, paymentType: dep?.enabled ? 'PAY_ONLINE' : 'PAY_LATER' }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setError((body && body.message) || `Reservation failed (${res.status})`); return; }
      setDone(true); if (typeof window !== 'undefined') window.scrollTo(0, 0);
    } catch { setError('Network error. Please try again.'); }
    finally { setSubmitting(false); }
  }

  const page: React.CSSProperties = { minHeight: '100vh', background: '#faf8f5', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '32px 16px 60px', fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' };
  const card: React.CSSProperties = { background: '#fff', borderRadius: 20, padding: 30, maxWidth: 460, width: '100%', boxSizing: 'border-box', boxShadow: '0 10px 40px rgba(28,25,23,0.10)', border: '1px solid #f0ece7' };
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#a8a29e', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6, display: 'block' };
  const inp: React.CSSProperties = { width: '100%', padding: '12px 14px', borderRadius: 11, border: '1px solid #e7e5e4', fontSize: 15, boxSizing: 'border-box', background: '#fdfcfb', color: '#1c1917' };

  if (done) return (
    <div style={page}>
      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{ width: 62, height: 62, borderRadius: '50%', background: '#e7f6ed', color: '#15803d', display: 'grid', placeItems: 'center', margin: '4px auto 16px', fontSize: 30 }}>✓</div>
        <h2 style={{ fontFamily: SERIF, fontSize: 24, margin: '0 0 4px', color: '#1c1917' }}>You&rsquo;re booked!</h2>
        <p style={{ color: '#78716c', fontSize: 14, margin: '0 0 18px' }}>A confirmation text is on its way.</p>
        <div style={{ textAlign: 'left', background: '#faf8f5', border: '1px solid #f0ece7', borderRadius: 14, padding: '16px 18px' }}>
          <div style={{ fontFamily: SERIF, fontSize: 19, color: '#1c1917', marginBottom: 10 }}>{salon.name}</div>
          {[['Date', prettyDate(date)], ['Time', slot ? fmtSlot(slot) : ''], ['Party', `${party} ${party === 1 ? 'guest' : 'guests'}`]].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 14.5, borderTop: '1px solid #f0ece7' }}>
              <span style={{ color: '#a8a29e' }}>{k}</span><span style={{ color: '#292524', fontWeight: 600 }}>{v}</span>
            </div>
          ))}
        </div>
        {depLabel && <p style={{ color: '#b45309', fontSize: 13, marginTop: 14 }}>A {depLabel} may be applied to hold your table.</p>}
      </div>
    </div>
  );

  return (
    <div style={page}>
      <div style={card}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: accent, color: '#fff', display: 'grid', placeItems: 'center', margin: '0 auto 12px', fontFamily: SERIF, fontSize: 24 }}>{initial}</div>
          <h1 style={{ fontFamily: SERIF, fontSize: 27, margin: '0 0 3px', color: '#1c1917', lineHeight: 1.15 }}>{salon.name}</h1>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#a8a29e', letterSpacing: 1.5, textTransform: 'uppercase' }}>Reserve a table</div>
        </div>

        {error && <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '10px 13px', borderRadius: 11, fontSize: 14, marginBottom: 16 }}>{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          <div>
            <span style={lbl}>Party size</span>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid #e7e5e4', borderRadius: 11, padding: '4px 6px', background: '#fdfcfb', height: 46, boxSizing: 'border-box' }}>
              <button aria-label="Fewer guests" onClick={() => setParty((p) => Math.max(1, p - 1))} style={stepBtn(accent, party <= 1)}>−</button>
              <span style={{ fontSize: 17, fontWeight: 700, color: '#1c1917' }}>{party}</span>
              <button aria-label="More guests" onClick={() => setParty((p) => Math.min(20, p + 1))} style={stepBtn(accent, party >= 20)}>+</button>
            </div>
          </div>
          <div>
            <span style={lbl}>Date</span>
            <input style={{ ...inp, height: 46 }} type="date" min={todayStr} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <span style={lbl}>Select a time</span>
        {loadingAvail ? (
          <p style={{ color: '#a8a29e', fontSize: 14, margin: '4px 0 8px' }}>Finding available times…</p>
        ) : !anyOpen ? (
          <div style={{ background: '#faf8f5', border: '1px solid #f0ece7', borderRadius: 12, padding: '16px', textAlign: 'center', color: '#78716c', fontSize: 14 }}>
            No tables for {party} {party === 1 ? 'guest' : 'guests'} on this date.<br />Try a different date or party size.
          </div>
        ) : (
          <div style={{ marginBottom: 6 }}>
            {groups.map(([label, arr]) => (
              <div key={label} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: '#a8a29e', fontWeight: 600, marginBottom: 7 }}>{label}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(74px, 1fr))', gap: 8 }}>
                  {arr.map((s) => {
                    const sel = slot === s.hm;
                    return (
                      <button key={s.hm} disabled={!s.open} onClick={() => setSlot(s.hm)}
                        style={{ padding: '10px 4px', borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: s.open ? 'pointer' : 'not-allowed', transition: 'all .12s',
                          border: `1px solid ${sel ? accent : s.open ? '#e7e5e4' : '#f0ece7'}`,
                          background: sel ? accent : s.open ? '#fff' : '#f7f5f2',
                          color: sel ? '#fff' : s.open ? '#1c1917' : '#d6d3d1',
                          textDecoration: s.open ? 'none' : 'line-through' }}>
                        {fmtSlot(s.hm)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {slot && (
          <div style={{ marginTop: 14, borderTop: '1px solid #f0ece7', paddingTop: 18 }}>
            <div style={{ fontFamily: SERIF, fontSize: 16, color: '#1c1917', marginBottom: 12 }}>{prettyDate(date)} · {fmtSlot(slot)} · {party} {party === 1 ? 'guest' : 'guests'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div><span style={lbl}>Full name</span><input style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Smith" /></div>
              <div><span style={lbl}>Phone</span><input style={inp} type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(415) 555-0100" /></div>
              <div><span style={lbl}>Email (optional)</span><input style={inp} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@email.com" /></div>
            </div>
            {depLabel && <p style={{ color: '#b45309', fontSize: 13, margin: '12px 0 0' }}>A {depLabel} is required to hold your table.</p>}
            <button onClick={submit} disabled={submitting} style={{ width: '100%', marginTop: 16, padding: '15px', borderRadius: 12, border: 'none', background: accent, color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.3 }}>
              {submitting ? 'Reserving…' : 'Complete reservation'}
            </button>
            <p style={{ textAlign: 'center', color: '#a8a29e', fontSize: 12, marginTop: 10 }}>Instant confirmation by text · No account needed</p>
          </div>
        )}
      </div>
    </div>
  );
}

function stepBtn(accent: string, disabled: boolean): React.CSSProperties {
  return { width: 34, height: 34, borderRadius: 9, border: '1px solid #e7e5e4', background: disabled ? '#f7f5f2' : '#fff', color: disabled ? '#d6d3d1' : accent, fontSize: 20, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' };
}
