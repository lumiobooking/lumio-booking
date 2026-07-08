'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface Deposit { enabled: boolean; type: 'percent' | 'fixed'; percent: number; fixedCents: number }
interface Salon { name: string; slug: string; timezone: string; branding?: { accentColor?: string; logoUrl?: string }; deposit?: Deposit }
interface Svc { id: string; durationMinutes: number }
interface Avail { tableCount: number; durationMinutes: number; busy: { start: string; end: string }[] }

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';
const pad = (n: number) => String(n).padStart(2, '0');

// Convert a wall-clock time AT THE SALON into the correct UTC instant.
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

// Self-contained public reservation page for RESTAURANT tenants: pick date +
// party + an open time, leave contact details, done. Reuses the same public
// booking endpoint, which auto-seats a fitting free table and applies the
// salon's deposit policy.
export function RestaurantReserve({ slug, salon }: { slug: string; salon: Salon }) {
  const base = `${API_URL}/public/salons/${encodeURIComponent(slug)}`;
  const accent = salon.branding?.accentColor || '#6366f1';
  const tz = salon.timezone || 'UTC';
  const todayStr = useMemo(() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }, []);

  const [date, setDate] = useState(todayStr);
  const [party, setParty] = useState(2);
  const [avail, setAvail] = useState<Avail | null>(null);
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
    setSlot(null);
    try { const r = await fetch(`${base}/table-availability?date=${date}&partySize=${party}`); setAvail(await r.json()); }
    catch { setAvail(null); }
  }, [base, date, party]);
  useEffect(() => { loadAvail(); }, [loadAvail]);

  const slots = useMemo(() => {
    if (!avail) return [] as { hm: string; open: boolean }[];
    const dur = avail.durationMinutes || 90;
    const [Y, M, D] = date.split('-').map(Number);
    const out: { hm: string; open: boolean }[] = [];
    for (let mins = 11 * 60; mins <= 21 * 60 + 30; mins += 30) {
      const hh = Math.floor(mins / 60), mm = mins % 60;
      const sUtc = new Date(wallTimeToISO(new Date(Y, M - 1, D, hh, mm), tz)).getTime();
      const eUtc = sUtc + dur * 60000;
      const overlaps = avail.busy.filter((b) => new Date(b.start).getTime() < eUtc && new Date(b.end).getTime() > sUtc).length;
      out.push({ hm: `${pad(hh)}:${pad(mm)}`, open: overlaps < avail.tableCount });
    }
    return out;
  }, [avail, date, tz]);

  const fmtSlot = (hm: string) => { const [h, m] = hm.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
  const dep = salon.deposit;
  const depLabel = dep?.enabled ? (dep.type === 'percent' ? `${dep.percent}% deposit` : `$${(dep.fixedCents / 100).toFixed(2)} deposit`) : null;

  async function submit() {
    if (!slot || !svcId) { setError(svcId ? 'Please choose a time.' : 'This restaurant is not accepting online reservations yet.'); return; }
    if (!form.name.trim() || !form.phone.trim()) { setError('Please enter your name and phone.'); return; }
    setSubmitting(true); setError(null);
    const [Y, M, D] = date.split('-').map(Number);
    const [h, m] = slot.split(':').map(Number);
    const startISO = wallTimeToISO(new Date(Y, M - 1, D, h, m), tz);
    const [first, ...rest] = form.name.trim().split(' ');
    try {
      const res = await fetch(`${base}/bookings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: svcId, startTime: startISO, partySize: party,
          customerFirstName: first, customerLastName: rest.join(' ') || undefined,
          customerPhone: form.phone.trim(), customerEmail: form.email.trim() || undefined,
          paymentType: dep?.enabled ? 'PAY_ONLINE' : 'PAY_LATER',
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setError((body && body.message) || `Reservation failed (${res.status})`); return; }
      setDone(true);
    } catch { setError('Network error. Please try again.'); }
    finally { setSubmitting(false); }
  }

  const card: React.CSSProperties = { background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', maxWidth: 460, width: '100%', boxSizing: 'border-box' };
  const inp: React.CSSProperties = { width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 15, boxSizing: 'border-box' };
  const lbl: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 5 };

  if (done) return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div style={{ ...card, textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#dcfce7', color: '#15803d', display: 'grid', placeItems: 'center', margin: '0 auto 14px', fontSize: 28 }}>✓</div>
        <h2 style={{ margin: '0 0 6px', fontSize: 20 }}>Reservation received!</h2>
        <p style={{ color: '#475569', fontSize: 15, margin: '0 0 4px' }}>{salon.name} · {new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · {slot && fmtSlot(slot)}</p>
        <p style={{ color: '#475569', fontSize: 15, margin: 0 }}>Party of {party}. A confirmation text is on its way.</p>
        {depLabel && <p style={{ color: '#b45309', fontSize: 14, marginTop: 10 }}>A {depLabel} may be required to hold your table.</p>}
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div style={card}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <h1 style={{ margin: '0 0 2px', fontSize: 22 }}>{salon.name}</h1>
          <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>Reserve a table</p>
        </div>
        {error && <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '10px 12px', borderRadius: 8, fontSize: 14, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <label style={{ flex: 2 }}><span style={lbl}>Date</span>
            <input style={inp} type="date" min={todayStr} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label style={{ flex: 1 }}><span style={lbl}>Guests</span>
            <input style={inp} type="number" min={1} max={20} value={party} onChange={(e) => setParty(parseInt(e.target.value, 10) || 1)} /></label>
        </div>

        <span style={lbl}>Choose a time</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(78px, 1fr))', gap: 8, marginBottom: 16 }}>
          {slots.length === 0 && <p style={{ color: '#94a3b8', fontSize: 14, gridColumn: '1/-1', margin: 0 }}>Loading times…</p>}
          {slots.map((s) => (
            <button key={s.hm} disabled={!s.open} onClick={() => setSlot(s.hm)}
              style={{ padding: '9px 4px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: s.open ? 'pointer' : 'not-allowed',
                border: `1px solid ${slot === s.hm ? accent : '#cbd5e1'}`, background: slot === s.hm ? accent : s.open ? '#fff' : '#f1f5f9',
                color: slot === s.hm ? '#fff' : s.open ? '#0f172a' : '#cbd5e1', textDecoration: s.open ? 'none' : 'line-through' }}>
              {fmtSlot(s.hm)}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          <label><span style={lbl}>Name</span><input style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label><span style={lbl}>Phone</span><input style={inp} type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
          <label><span style={lbl}>Email (optional)</span><input style={inp} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        </div>

        {depLabel && <p style={{ color: '#b45309', fontSize: 13, marginBottom: 12 }}>Note: a {depLabel} is required to hold your table.</p>}

        <button onClick={submit} disabled={submitting || !slot} style={{ width: '100%', padding: '13px', borderRadius: 10, border: 'none', background: slot ? accent : '#cbd5e1', color: '#fff', fontSize: 16, fontWeight: 700, cursor: slot ? 'pointer' : 'not-allowed' }}>
          {submitting ? 'Reserving…' : 'Reserve table'}
        </button>
      </div>
    </div>
  );
}
