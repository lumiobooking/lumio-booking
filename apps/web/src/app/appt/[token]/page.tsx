'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';

interface Summary {
  salon: string; slug: string; service: string; customer: string;
  date: string; time: string; status: string; confirmed: boolean; canAct: boolean;
}

export default function ApptPage() {
  const params = useParams();
  const token = String(params?.token ?? '');
  const [s, setS] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'confirmed' | 'cancelled' | null>(null);

  const load = useCallback(() => {
    fetch(`${API_URL}/public/appt/${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setS)
      .catch(() => setErr('This link has expired or is invalid.'));
  }, [token]);
  useEffect(() => { if (token) load(); }, [token, load]);

  async function act(kind: 'confirm' | 'cancel') {
    if (kind === 'cancel' && !confirm('Cancel this appointment? This cannot be undone.')) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`${API_URL}/public/appt/${encodeURIComponent(token)}/${kind}`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.message || 'Something went wrong');
      setDone(kind === 'confirm' ? 'confirmed' : 'cancelled');
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong'); }
    finally { setBusy(false); }
  }

  return (
    <div style={wrap}>
      <div style={card}>
        {err && !s ? (
          <p style={{ color: '#64748b', textAlign: 'center' }}>{err}</p>
        ) : !s ? (
          <p style={{ color: '#94a3b8', textAlign: 'center' }}>Loading…</p>
        ) : (
          <>
            <div style={{ textAlign: 'center', fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{s.salon}</div>

            {done === 'confirmed' ? (
              <Banner emoji="✅" title="See you then!" text="Your appointment is confirmed. Thank you." />
            ) : done === 'cancelled' ? (
              <Banner emoji="🗓️" title="Appointment cancelled" text="Thanks for letting us know. Book again anytime." />
            ) : (
              <p style={{ color: '#64748b', fontSize: 14, textAlign: 'center', margin: '6px 0 18px' }}>Hi {s.customer}, here are your appointment details:</p>
            )}

            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, margin: '8px 0 18px' }}>
              <Row label="Service" value={s.service} />
              <Row label="Date" value={s.date} />
              <Row label="Time" value={s.time} />
              <Row label="Status" value={s.confirmed ? 'Confirmed' : s.status} />
            </div>

            {!done && s.canAct && (
              <>
                <button onClick={() => act('confirm')} disabled={busy} style={{ ...btn, background: '#16a34a', color: '#fff' }}>
                  {busy ? 'Please wait…' : '✓ Confirm my appointment'}
                </button>
                <a href={`/book/${encodeURIComponent(s.slug)}`} style={{ ...btn, background: '#eef2ff', color: '#4338ca', textDecoration: 'none', display: 'block', textAlign: 'center' }}>
                  Reschedule (book a new time)
                </a>
                <button onClick={() => act('cancel')} disabled={busy} style={{ ...btn, background: '#fff', color: '#dc2626', border: '1px solid #fca5a5' }}>
                  Cancel appointment
                </button>
              </>
            )}
            {!done && !s.canAct && (
              <p style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>This appointment can no longer be changed online. Please call the salon.</p>
            )}
            {err && <p style={{ color: '#dc2626', fontSize: 13, textAlign: 'center', marginTop: 10 }}>{err}</p>}
          </>
        )}
        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 11, color: '#cbd5e1' }}>Powered by Lumio Booking</div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 14 }}>
      <span style={{ color: '#64748b' }}>{label}</span>
      <span style={{ color: '#0f172a', fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function Banner({ emoji, title, text }: { emoji: string; title: string; text: string }) {
  return (
    <div style={{ textAlign: 'center', margin: '14px 0' }}>
      <div style={{ fontSize: 44 }}>{emoji}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginTop: 4 }}>{title}</div>
      <div style={{ color: '#64748b', fontSize: 14, marginTop: 2 }}>{text}</div>
    </div>
  );
}

const wrap: React.CSSProperties = { minHeight: '100vh', background: 'linear-gradient(160deg,#eef2ff,#f8fafc 55%)', display: 'grid', placeItems: 'center', padding: 16, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' };
const card: React.CSSProperties = { width: '100%', maxWidth: 380, background: '#fff', borderRadius: 22, padding: '26px 22px', boxShadow: '0 12px 40px rgba(15,23,42,0.12)' };
const btn: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '13px', borderRadius: 12, border: 'none', fontSize: 15, fontWeight: 700, cursor: 'pointer', marginBottom: 10 };
