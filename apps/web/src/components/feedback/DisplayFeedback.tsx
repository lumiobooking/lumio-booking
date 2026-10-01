'use client';

import { useEffect, useState } from 'react';
import { FeedbackFlow, type FeedbackCtx } from './FeedbackFlow';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';

/**
 * The customer screen's "How was your visit today?", laid over the Paid
 * screen right after the till takes payment. Shared by the wireless iPad
 * (/display) and the second monitor (/pos-display), so both ask the same way.
 *
 * Shows nothing when the visit was already answered (on the phone, say) or the
 * link cannot be read — the Paid screen underneath is always a fine fallback.
 */
export function DisplayFeedback({ token, salonName, salonLogo, paidLine, tipFooter, onDone }: {
  token: string;
  salonName?: string;
  salonLogo?: string;
  paidLine: React.ReactNode;
  tipFooter?: React.ReactNode;
  onDone: () => void;
}) {
  const [ctx, setCtx] = useState<FeedbackCtx | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API_URL}/public/feedback/${encodeURIComponent(token)}`)
      .then(async (r) => { if (!r.ok) throw new Error(); const d = (await r.json()) as FeedbackCtx; if (alive) { if (d.answered || d.expired) onDone(); else setCtx(d); } })
      .catch(() => { if (alive) onDone(); });
    return () => { alive = false; };
  }, [token, onDone]);

  if (!ctx) return null;
  const accent = ctx.accentColor || '#6366f1';
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: '#faf9f7', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', color: '#1c1917' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '20px 34px 20px 68px', borderBottom: '1px solid #e7e3dd', background: '#fff', flexShrink: 0 }}>
        {salonLogo || ctx.logoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={(salonLogo || ctx.logoUrl)!} alt="" style={{ height: 46, width: 'auto', maxWidth: 160, objectFit: 'contain', borderRadius: 8 }} />
          : <span style={{ width: 46, height: 46, borderRadius: '50%', background: `${accent}1a`, border: `1.5px solid ${accent}59`, color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>✦</span>}
        <div>
          <div style={{ fontFamily: 'Baskerville, "Libre Baskerville", Georgia, serif', fontWeight: 600, fontSize: 22 }}>{salonName || ctx.salonName}</div>
          <div style={{ fontSize: 14, color: '#6f6a64' }}>{ctx.lang === 'vi' ? 'Cảm ơn bạn đã ghé tiệm' : 'Thank you for visiting'}</div>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch', justifyContent: 'center', overflowY: 'auto' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '24px 0' }}>
          <FeedbackFlow token={token} ctx={ctx} variant="ipad" onDone={onDone} header={paidLine} footer={tipFooter} />
        </div>
      </div>
    </div>
  );
}
