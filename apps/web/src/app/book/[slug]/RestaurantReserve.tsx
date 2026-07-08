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

const STEP_LABELS = ['Guests', 'Date & time', 'Your details', 'Review'];

export function RestaurantReserve({ slug, salon }: { slug: string; salon: Salon }) {
  const base = `${API_URL}/public/salons/${encodeURIComponent(slug)}`;
  const accent = salon.branding?.accentColor || '#1f2937';
  const tz = salon.timezone || 'UTC';
  const todayStr = useMemo(() => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }, []);

  const [step, setStep] = useState(1); // 1 guests · 2 date/time · 3 details · 4 review · 5 done
  const [party, setParty] = useState(2);
  const [date, setDate] = useState(todayStr);
  const [avail, setAvail] = useState<Avail | null>(null);
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [svcId, setSvcId] = useState('');
  const [slot, setSlot] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const [submitting, setSubmitting] = useState(false);
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
  useEffect(() => { if (step >= 2) loadAvail(); }, [loadAvail, step]);

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
    const lunch = slots.filter((s) => s.hour < 15), dinner = slots.filter((s) => s.hour >= 15);
    return ([['Lunch', lunch], ['Dinner', dinner]] as [string, typeof slots][]).filter(([, a]) => a.length > 0);
  }, [slots]);
  const anyOpen = slots.some((s) => s.open);

  const fmtSlot = (hm: string) => { const [h, m] = hm.split(':').map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };
  const prettyDate = (ds: string) => new Date(ds + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const dep = salon.deposit;
  const depLabel = dep?.enabled ? (dep.type === 'percent' ? `${dep.percent}% deposit` : `$${(dep.fixedCents / 100).toFixed(2)} deposit`) : null;
  const initial = (salon.name || 'R').trim().charAt(0).toUpperCase();
  const goto = (n: number) => { setError(null); setStep(n); if (typeof window !== 'undefined') window.scrollTo(0, 0); };

  async function submit() {
    if (!slot || !svcId) { setError('Online reservations are not available yet.'); return; }
    if (!form.name.trim() || !form.phone.trim()) { setError('Please enter your name and phone number.'); goto(3); return; }
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
      goto(5);
    } catch { setError('Network error. Please try again.'); }
    finally { setSubmitting(false); }
  }

  const page: React.CSSProperties = { minHeight: '100vh', background: '#faf8f5', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '28px 16px 60px', fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif' };
  const shell: React.CSSProperties = { maxWidth: 460, width: '100%', boxShadow: '0 10px 40px rgba(28,25,23,0.10)', borderRadius: 18, overflow: 'hidden', border: '1px solid #f0ece7' };
  const body: React.CSSProperties = { background: '#fff', padding: 26 };
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#a8a29e', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6, display: 'block' };
  const inp: React.CSSProperties = { width: '100%', padding: '13px 14px', borderRadius: 11, border: '1px solid #e7e5e4', fontSize: 15, boxSizing: 'border-box', background: '#fdfcfb', color: '#1c1917' };
  const backBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#78716c', fontSize: 14, cursor: 'pointer', padding: '6px 0', marginTop: 12 };
  const cta = (dis: boolean): React.CSSProperties => ({ width: '100%', marginTop: 18, padding: '15px', borderRadius: 12, border: 'none', background: dis ? '#d6d3d1' : accent, color: '#fff', fontSize: 16, fontWeight: 700, cursor: dis ? 'not-allowed' : 'pointer', letterSpacing: 0.3 });

  const Header = () => (
    <div style={{ background: accent, color: '#fff', padding: '20px 24px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.16)', display: 'grid', placeItems: 'center', fontFamily: SERIF, fontSize: 19, flexShrink: 0 }}>{initial}</div>
        <div>
          <div style={{ fontFamily: SERIF, fontSize: 21, lineHeight: 1.1 }}>{salon.name}</div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2, opacity: 0.85 }}>RESERVE A TABLE</div>
        </div>
      </div>
      {step <= 4 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', gap: 5 }}>
            {[1, 2, 3, 4].map((n) => <div key={n} style={{ flex: 1, height: 5, borderRadius: 999, background: step >= n ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.28)' }} />)}
          </div>
          <div style={{ fontSize: 12, marginTop: 7, opacity: 0.9 }}>Step {step} of 4 · {STEP_LABELS[step - 1]}</div>
        </div>
      )}
    </div>
  );

  if (step === 5) return (
    <div style={page}><div style={shell}><Header /><div style={{ ...body, textAlign: 'center' }}>
      <div style={{ width: 60, height: 60, borderRadius: '50%', background: '#e7f6ed', color: '#15803d', display: 'grid', placeItems: 'center', margin: '4px auto 14px', fontSize: 29 }}>✓</div>
      <h2 style={{ fontFamily: SERIF, fontSize: 23, margin: '0 0 4px', color: '#1c1917' }}>You&rsquo;re booked!</h2>
      <p style={{ color: '#78716c', fontSize: 14, margin: '0 0 18px' }}>A confirmation text is on its way.</p>
      <div style={{ textAlign: 'left', background: '#faf8f5', border: '1px solid #f0ece7', borderRadius: 14, padding: '14px 18px' }}>
        {[['Date', prettyDate(date)], ['Time', slot ? fmtSlot(slot) : ''], ['Party', `${party} ${party === 1 ? 'guest' : 'guests'}`]].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 14.5 }}><span style={{ color: '#a8a29e' }}>{k}</span><span style={{ color: '#292524', fontWeight: 600 }}>{v}</span></div>
        ))}
      </div>
      {depLabel && <p style={{ color: '#b45309', fontSize: 13, marginTop: 14 }}>A {depLabel} may be applied to hold your table.</p>}
    </div></div></div>
  );

  return (
    <div style={page}>
      <div style={shell}>
        <Header />
        <div style={body}>
          {error && <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '10px 13px', borderRadius: 11, fontSize: 14, marginBottom: 16 }}>{error}</div>}

          {step === 1 && (
            <div>
              <div style={{ fontFamily: SERIF, fontSize: 20, color: '#1c1917', marginBottom: 4 }}>How many guests?</div>
              <p style={{ color: '#78716c', fontSize: 13.5, margin: '0 0 16px' }}>Tap a number, or use − / + for a larger party.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 9, marginBottom: 16 }}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                  <button key={n} onClick={() => { setParty(n); goto(2); }}
                    style={{ padding: '16px 0', borderRadius: 12, fontSize: 17, fontWeight: 700, cursor: 'pointer', border: `1px solid ${party === n ? accent : '#e7e5e4'}`, background: party === n ? accent : '#fff', color: party === n ? '#fff' : '#1c1917' }}>{n}</button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, border: '1px solid #e7e5e4', borderRadius: 12, padding: '10px', background: '#fdfcfb', justifyContent: 'center' }}>
                <button aria-label="Fewer" onClick={() => setParty((p) => Math.max(1, p - 1))} style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid #e7e5e4', background: '#fff', color: accent, fontSize: 22, cursor: 'pointer' }}>−</button>
                <div style={{ textAlign: 'center', minWidth: 70 }}><div style={{ fontSize: 22, fontWeight: 700, color: '#1c1917' }}>{party}</div><div style={{ fontSize: 11, color: '#a8a29e' }}>{party === 1 ? 'guest' : 'guests'}</div></div>
                <button aria-label="More" onClick={() => setParty((p) => Math.min(20, p + 1))} style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid #e7e5e4', background: '#fff', color: accent, fontSize: 22, cursor: 'pointer' }}>+</button>
              </div>
              <button onClick={() => goto(2)} style={cta(false)}>Continue</button>
            </div>
          )}

          {step === 2 && (
            <div>
              <span style={lbl}>Date</span>
              <input style={{ ...inp, marginBottom: 18 }} type="date" min={todayStr} value={date} onChange={(e) => setDate(e.target.value)} />
              <span style={lbl}>Select a time · {party} {party === 1 ? 'guest' : 'guests'}</span>
              {loadingAvail ? (
                <p style={{ color: '#a8a29e', fontSize: 14 }}>Finding available times…</p>
              ) : !anyOpen ? (
                <div style={{ background: '#faf8f5', border: '1px solid #f0ece7', borderRadius: 12, padding: 16, textAlign: 'center', color: '#78716c', fontSize: 14 }}>No tables for {party} {party === 1 ? 'guest' : 'guests'} on this date. Try another date or party size.</div>
              ) : groups.map(([label, arr]) => (
                <div key={label} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 12, color: '#a8a29e', fontWeight: 600, marginBottom: 7 }}>{label}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(74px, 1fr))', gap: 8 }}>
                    {arr.map((s) => {
                      const seld = slot === s.hm;
                      return <button key={s.hm} disabled={!s.open} onClick={() => { setSlot(s.hm); goto(3); }}
                        style={{ padding: '10px 4px', borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: s.open ? 'pointer' : 'not-allowed', border: `1px solid ${seld ? accent : s.open ? '#e7e5e4' : '#f0ece7'}`, background: seld ? accent : s.open ? '#fff' : '#f7f5f2', color: seld ? '#fff' : s.open ? '#1c1917' : '#d6d3d1', textDecoration: s.open ? 'none' : 'line-through' }}>{fmtSlot(s.hm)}</button>;
                    })}
                  </div>
                </div>
              ))}
              <button onClick={() => goto(1)} style={backBtn}>← Back</button>
            </div>
          )}

          {step === 3 && (
            <div>
              <div style={{ fontFamily: SERIF, fontSize: 16, color: '#1c1917', marginBottom: 14 }}>{prettyDate(date)} · {slot ? fmtSlot(slot) : ''} · {party} {party === 1 ? 'guest' : 'guests'}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div><span style={lbl}>Full name</span><input style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Smith" /></div>
                <div><span style={lbl}>Phone</span><input style={inp} type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="(415) 555-0100" /></div>
                <div><span style={lbl}>Email (optional)</span><input style={inp} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@email.com" /></div>
              </div>
              {depLabel && <p style={{ color: '#b45309', fontSize: 13, margin: '12px 0 0' }}>A {depLabel} is required to hold your table.</p>}
              <button onClick={() => { if (!form.name.trim() || !form.phone.trim()) { setError('Please enter your name and phone number.'); return; } goto(4); }} style={cta(false)}>Review reservation</button>
              <button onClick={() => goto(2)} style={backBtn}>← Back</button>
            </div>
          )}

          {step === 4 && (
            <div>
              <div style={{ fontFamily: SERIF, fontSize: 20, color: '#1c1917', marginBottom: 14 }}>Review your reservation</div>
              <div style={{ background: '#faf8f5', border: '1px solid #f0ece7', borderRadius: 14, padding: '6px 18px' }}>
                {[['Date', prettyDate(date)], ['Time', slot ? fmtSlot(slot) : ''], ['Party', `${party} ${party === 1 ? 'guest' : 'guests'}`], ['Name', form.name], ['Phone', form.phone]].map(([k, v], i) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', fontSize: 14.5, borderTop: i ? '1px solid #f0ece7' : 'none' }}><span style={{ color: '#a8a29e' }}>{k}</span><span style={{ color: '#292524', fontWeight: 600, textAlign: 'right' }}>{v}</span></div>
                ))}
              </div>
              {depLabel && <p style={{ color: '#b45309', fontSize: 13, margin: '12px 0 0' }}>A {depLabel} is required to hold your table.</p>}
              <button onClick={submit} disabled={submitting} style={cta(submitting)}>{submitting ? 'Reserving…' : 'Confirm reservation'}</button>
              <button onClick={() => goto(3)} style={backBtn}>← Back</button>
              <p style={{ textAlign: 'center', color: '#a8a29e', fontSize: 12, marginTop: 12 }}>Instant confirmation by text · No account needed</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
