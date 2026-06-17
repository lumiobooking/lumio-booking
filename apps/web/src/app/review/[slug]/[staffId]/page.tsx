'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';

interface Ctx {
  salonName: string;
  branding?: { accentColor?: string; logoUrl?: string };
  staff: { id: string; name: string; avatarUrl: string | null } | null;
  enabled: boolean;
  customerPoints: number;
  minRatingForGoogle: number;
  hasGoogle: boolean;
}

type Phase = 'rate' | 'comment' | 'done';

export default function ReviewPage() {
  const params = useParams();
  const slug = String(params?.slug ?? '');
  const staffId = String(params?.staffId ?? '');

  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('rate');
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [phone, setPhone] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ points: number; googleUrl: string | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/public/review/${encodeURIComponent(slug)}/${encodeURIComponent(staffId)}`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(setCtx)
      .catch(() => setLoadErr('This review link is not available.'));
  }, [slug, staffId]);

  const accent = ctx?.branding?.accentColor || '#6366f1';

  const submit = useCallback(async (stars: number, text: string) => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${API_URL}/public/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, staffId, rating: stars, comment: text || undefined, phone: phone.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not submit');
      setResult({ points: data.customerPointsAwarded ?? 0, googleUrl: data.googleReviewUrl ?? null });
      setPhase('done');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not submit'); setBusy(false);
    }
  }, [slug, staffId, phone]);

  function tapStar(r: number) {
    if (busy) return;
    setRating(r);
    // High rating → submit instantly. Low rating → ask what went wrong first.
    if (ctx && r >= ctx.minRatingForGoogle) submit(r, '');
    else setPhase('comment');
  }

  if (loadErr) return <Center accent="#6366f1"><p style={{ color: '#64748b' }}>{loadErr}</p></Center>;
  if (!ctx) return <Center accent="#6366f1"><p style={{ color: '#94a3b8' }}>Loading…</p></Center>;
  if (!ctx.enabled) return <Center accent={accent}><p style={{ color: '#64748b' }}>Thank you for visiting {ctx.salonName}!</p></Center>;

  return (
    <Center accent={accent}>
      <div style={card}>
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          {ctx.branding?.logoUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={ctx.branding.logoUrl} alt={ctx.salonName} style={{ height: 40, objectFit: 'contain', marginBottom: 8 }} />
            : <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{ctx.salonName}</div>}
        </div>

        {phase !== 'done' && (
          <>
            <div style={{ textAlign: 'center', marginTop: 18 }}>
              {ctx.staff?.avatarUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={ctx.staff.avatarUrl} alt={ctx.staff.name} width={76} height={76} style={{ borderRadius: '50%', objectFit: 'cover', border: `3px solid ${accent}22` }} />
                : <div style={{ width: 76, height: 76, borderRadius: '50%', background: `${accent}1a`, color: accent, display: 'grid', placeItems: 'center', fontSize: 30, fontWeight: 800, margin: '0 auto' }}>{(ctx.staff?.name || ctx.salonName).charAt(0).toUpperCase()}</div>}
              <h1 style={{ fontSize: 22, margin: '14px 0 4px', color: '#0f172a', lineHeight: 1.25 }}>
                How was your visit{ctx.staff ? <> with <span style={{ color: accent }}>{ctx.staff.name}</span></> : ''}?
              </h1>
              <p style={{ color: '#64748b', fontSize: 14, margin: 0 }}>Tap to rate — it takes a second.</p>
            </div>

            {/* Stars */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, margin: '22px 0 6px' }}>
              {[1, 2, 3, 4, 5].map((n) => {
                const active = (hover || rating) >= n;
                return (
                  <button key={n} type="button" aria-label={`${n} star`} disabled={busy}
                    onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)} onClick={() => tapStar(n)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 44, lineHeight: 1, padding: 2, color: active ? '#f59e0b' : '#e2e8f0', transition: 'transform .1s', transform: active ? 'scale(1.05)' : 'none' }}>
                    ★
                  </button>
                );
              })}
            </div>

            {/* Optional phone for points */}
            {ctx.customerPoints > 0 && (
              <div style={{ marginTop: 14, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 13, color: '#15803d', fontWeight: 600, marginBottom: 6 }}>🎁 Enter your phone to earn {ctx.customerPoints} reward points</div>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Your phone (optional)"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 16 }} />
              </div>
            )}

            {phase === 'comment' && (
              <div style={{ marginTop: 14 }}>
                <p style={{ fontSize: 14, color: '#0f172a', fontWeight: 600, margin: '0 0 6px' }}>Sorry it wasn&apos;t perfect — how can we do better?</p>
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} placeholder="Your feedback goes privately to the salon"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 16, resize: 'vertical', fontFamily: 'inherit' }} />
                <button onClick={() => submit(rating, comment)} disabled={busy}
                  style={{ ...bigBtn, background: accent, marginTop: 12 }}>{busy ? 'Sending…' : 'Send feedback'}</button>
              </div>
            )}

            {err && <p style={{ color: '#dc2626', fontSize: 13, textAlign: 'center', marginTop: 10 }}>{err}</p>}
          </>
        )}

        {phase === 'done' && result && (
          <div style={{ textAlign: 'center', marginTop: 18 }}>
            <div style={{ fontSize: 52 }}>🎉</div>
            <h1 style={{ fontSize: 22, margin: '6px 0 4px', color: '#0f172a' }}>Thank you!</h1>
            {result.points > 0 && <p style={{ color: '#15803d', fontWeight: 600, margin: '0 0 4px' }}>You earned {result.points} reward points 🎁</p>}
            <p style={{ color: '#64748b', fontSize: 14, margin: '0 0 18px' }}>We appreciate your feedback.</p>

            {result.googleUrl ? (
              <>
                <p style={{ fontSize: 14, color: '#0f172a', margin: '0 0 10px' }}>Loved your visit? It would mean the world if you shared it on Google 💛</p>
                <a href={result.googleUrl} target="_blank" rel="noopener noreferrer" style={{ ...bigBtn, background: accent, textDecoration: 'none', display: 'block' }}>
                  ⭐ Review us on Google
                </a>
              </>
            ) : (
              <p style={{ color: '#94a3b8', fontSize: 13 }}>The salon will follow up with you shortly.</p>
            )}
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 22, fontSize: 11, color: '#cbd5e1' }}>Powered by Lumio Booking</div>
      </div>
    </Center>
  );
}

function Center({ children, accent }: { children: React.ReactNode; accent: string }) {
  return (
    <div style={{ minHeight: '100vh', background: `linear-gradient(160deg, ${accent}14, #f8fafc 55%)`, display: 'grid', placeItems: 'center', padding: 16, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
      {children}
    </div>
  );
}

const card: React.CSSProperties = { width: '100%', maxWidth: 380, background: '#fff', borderRadius: 22, padding: '26px 22px', boxShadow: '0 12px 40px rgba(15,23,42,0.12)' };
const bigBtn: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '15px', borderRadius: 12, border: 'none', color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' };
