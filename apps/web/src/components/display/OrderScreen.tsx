'use client';

/**
 * The customer screen while a ticket is being rung up — shared by the wireless
 * iPad (/display) and the second monitor (/pos-display).
 *
 * THE RULE THIS FILE EXISTS FOR: the screen never grows past the glass. The
 * ticket list scrolls INSIDE its own card, the totals card is always on screen,
 * and the review QR keeps its column. Eight services used to push "Amount due"
 * off the bottom of the monitor and drag the QR card down with it.
 *
 * Layouts:
 *   - landscape + review QR → [QR card] | [services ↕ / totals]
 *   - landscape, no QR      → [services ↕] | [totals]
 *   - portrait              → services ↕ / totals / slim QR strip
 * Colours are literal: these cards are white in every theme (the customer
 * screen does not follow the staff app's light/dark switch).
 * A short ticket sits in the middle of the glass; a long one fills it and scrolls.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';

export type OrderLine = { name: string; qty: number; lineCents: number; staff?: string };
export type TotalRow = { k: string; v: string; color?: string };

const GOLD = '#f5c542';
const CSS = `
.os-list{scrollbar-width:thin;scrollbar-color:rgba(100,116,139,.35) transparent}
.os-list::-webkit-scrollbar{width:6px}
.os-list::-webkit-scrollbar-thumb{background:rgba(100,116,139,.35);border-radius:3px}
@keyframes osIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
`;

export function OrderScreen({ lines, rows, due, accent, money, reviewUrl, tall }: {
  lines: OrderLine[];
  rows: TotalRow[];
  due: string;
  accent: string;
  money: (cents: number) => string;
  reviewUrl?: string;      // landscape: its own column; portrait: a slim strip, so the ticket keeps the room
  tall: boolean;           // clearly portrait
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [fadeTop, setFadeTop] = useState(false);
  const [fadeBottom, setFadeBottom] = useState(false);
  const count = lines.reduce((a, l) => a + (l.qty || 1), 0);
  const dense = lines.length > 5;

  const measure = () => {
    const el = listRef.current;
    if (!el) return;
    setFadeTop(el.scrollTop > 4);
    setFadeBottom(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
  };

  // A new line was rung up: show it. The customer is watching the bottom of
  // the ticket, not the first service they chose ten minutes ago.
  const prevLen = useRef(lines.length);
  useEffect(() => {
    const el = listRef.current;
    if (el && lines.length > prevLen.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    prevLen.current = lines.length;
    const t = setTimeout(measure, 350);
    return () => clearTimeout(t);
  }, [lines.length]);
  useEffect(() => {
    measure();
    if (typeof ResizeObserver === 'undefined' || !listRef.current) return;
    const ro = new ResizeObserver(measure);
    ro.observe(listRef.current);
    return () => ro.disconnect();
  }, []);

  const mask = fadeTop && fadeBottom
    ? 'linear-gradient(to bottom, transparent 0, #000 28px, #000 calc(100% - 36px), transparent 100%)'
    : fadeBottom ? 'linear-gradient(to bottom, #000 calc(100% - 36px), transparent 100%)'
    : fadeTop ? 'linear-gradient(to bottom, transparent 0, #000 28px)' : 'none';

  const items = (
    <div style={{ ...panel, flex: '0 1 auto', minHeight: 'min(190px, 34vh)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 'clamp(4px, 1vh, 10px)', flexShrink: 0 }}>
        <div style={{ fontSize: 'clamp(19px, 2.4vw, 28px)', fontWeight: 700, color: '#0f172a' }}>Your services</div>
        <span style={{ fontSize: 'clamp(12px, 1.4vw, 15px)', fontWeight: 700, color: accent, background: `${accent}14`, borderRadius: 999, padding: '4px 11px', whiteSpace: 'nowrap' }}>
          {count} {count === 1 ? 'item' : 'items'}
        </span>
      </div>
      <div ref={listRef} className="os-list" onScroll={measure}
        style={{ flex: '0 1 auto', minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', margin: '0 -6px', padding: '0 6px', WebkitMaskImage: mask, maskImage: mask }}>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, padding: dense ? 'clamp(9px, 1.3vh, 13px) 0' : 'clamp(12px, 1.8vh, 18px) 0', borderBottom: i === lines.length - 1 ? 'none' : '1px solid #f1f5f9', animation: i === lines.length - 1 ? 'osIn .35s ease both' : undefined }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: dense ? 'clamp(16px, 1.8vw, 20px)' : 'clamp(17px, 2.1vw, 23px)', fontWeight: 600, color: '#1e293b', lineHeight: 1.3 }}>
                <span style={{ color: accent, fontWeight: 700 }}>{l.qty}×</span> {l.name}
              </div>
              {l.staff && <div style={{ fontSize: 'clamp(12px, 1.4vw, 15px)', color: '#64748b', marginTop: 2 }}>with {l.staff}</div>}
            </div>
            <div style={{ fontSize: dense ? 'clamp(16px, 1.8vw, 20px)' : 'clamp(17px, 2.1vw, 23px)', fontWeight: 600, color: '#1e293b', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{money(l.lineCents)}</div>
          </div>
        ))}
      </div>
      {fadeBottom && (
        <div style={{ flexShrink: 0, textAlign: 'center', fontSize: 'clamp(11.5px, 1.3vw, 13.5px)', color: '#64748b', paddingTop: 6 }}>↓ more below</div>
      )}
    </div>
  );

  const totals = (side: boolean) => (
    <div style={{
      background: accent, borderRadius: 24, boxShadow: `0 18px 50px ${accent}59`, flexShrink: 0, boxSizing: 'border-box',
      padding: side ? 'clamp(22px, 3vw, 38px)' : 'clamp(16px, 2.4vh, 26px) clamp(20px, 2.6vw, 32px)',
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      ...(side ? { flex: '1 1 330px', maxWidth: 520 } : null),
    }}>
      {rows.map((r) => (
        <div key={r.k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: side ? '7px 0' : '3px 0' }}>
          <span style={{ fontSize: 'clamp(14px, 1.8vw, 19px)', color: 'rgba(255,255,255,0.85)' }}>{r.k}</span>
          <span style={{ fontSize: 'clamp(14px, 1.8vw, 19px)', fontWeight: 600, color: r.color ?? 'white', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{r.v}</span>
        </div>
      ))}
      <div style={{ height: 1, background: 'rgba(255,255,255,0.25)', margin: side ? '16px 0' : 'clamp(8px, 1.4vh, 14px) 0' }} />
      <div style={{ display: 'flex', flexDirection: side ? 'column' : 'row', alignItems: side ? 'flex-start' : 'baseline', justifyContent: 'space-between', gap: side ? 4 : 12 }}>
        <span style={{ fontSize: 'clamp(14px, 1.9vw, 21px)', fontWeight: 600, color: 'rgba(255,255,255,0.92)' }}>Amount due</span>
        <span style={{ fontSize: side ? 'clamp(32px, 5.5vw, 56px)' : 'clamp(28px, 4.6vw, 46px)', fontWeight: 700, color: 'white', whiteSpace: 'nowrap', letterSpacing: '-0.01em', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>{due}</span>
      </div>
    </div>
  );

  const shell: CSSProperties = { width: '100%', maxWidth: 1320, height: '100%', minHeight: 0, margin: '0 auto', display: 'flex', boxSizing: 'border-box', animation: 'lumioFade .4s ease both' };
  const column: CSSProperties = { minWidth: 0, minHeight: 0, maxHeight: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 'clamp(12px, 1.8vh, 20px)' };

  if (tall) {
    return (
      <div style={{ ...shell, ...column }}>
        <style>{CSS}</style>
        {items}
        {totals(false)}
        {reviewUrl && <ReviewStrip url={reviewUrl} accent={accent} />}
      </div>
    );
  }
  if (reviewUrl) {
    return (
      <div style={{ ...shell, flexDirection: 'row', alignItems: 'center', gap: 'clamp(18px, 2.6vw, 36px)' }}>
        <style>{CSS}</style>
        <div style={{ flex: '1 1 0%', minWidth: 0, maxHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ReviewColumn url={reviewUrl} accent={accent} />
        </div>
        <div style={{ ...column, flex: '1 1 0%', height: '100%' }}>
          {items}
          {totals(false)}
        </div>
      </div>
    );
  }
  return (
    <div style={{ ...shell, flexDirection: 'row', alignItems: 'center', gap: 'clamp(16px, 2.4vw, 32px)' }}>
      <style>{CSS}</style>
      <div style={{ ...column, flex: '2 1 440px', height: '100%' }}>{items}</div>
      {totals(true)}
    </div>
  );
}

const qrSrc = (url: string, px: number) => `https://api.qrserver.com/v1/create-qr-code/?size=${px}x${px}&margin=1&data=${encodeURIComponent(url)}`;

/** Landscape: the Google review card, sized by the screen's HEIGHT so it never runs off a short monitor. */
function ReviewColumn({ url, accent }: { url: string; accent: string }) {
  return (
    <div style={{ width: '100%', maxWidth: 460, maxHeight: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 'clamp(6px, 1.4vh, 16px)', background: 'linear-gradient(160deg, #ffffff, #fffdf5)', border: `1px solid ${GOLD}33`, borderRadius: 26, padding: 'clamp(14px, 2.6vh, 30px) clamp(16px, 2vw, 28px)', boxShadow: `0 22px 60px rgba(15,23,42,0.14), inset 0 0 0 2px ${GOLD}44` }}>
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', inset: -8, borderRadius: 24, border: `3px solid ${accent}`, animation: 'lumioPulse 2s ease-in-out infinite', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', background: '#fff', borderRadius: 18, padding: 'clamp(8px, 1.4vh, 14px)', boxShadow: '0 12px 34px rgba(15,23,42,0.13)', border: '1px solid #eef2f7' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrSrc(url, 460)} alt="Google review QR" style={{ width: 'min(34vh, 24vw, 300px)', height: 'auto', display: 'block' }} />
        </div>
      </div>
      <div style={{ color: '#f5a623', fontSize: 'clamp(22px, 4.4vh, 40px)', letterSpacing: 4, lineHeight: 1 }}>★★★★★</div>
      <div style={{ fontFamily: 'Playfair Display, Georgia, serif', fontWeight: 600, fontSize: 'clamp(24px, 5.2vh, 46px)', color: '#0f172a', lineHeight: 1.1 }}>Loved your visit?</div>
      <div style={{ fontSize: 'clamp(14px, 2.2vh, 19px)', color: '#475569', lineHeight: 1.45, maxWidth: 380 }}>
        Leave us a quick <strong>5-star Google review</strong> — it truly makes our day 💛
      </div>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', borderRadius: 999, padding: '7px 14px', border: '1px solid #eef2f7', boxShadow: '0 4px 14px rgba(15,23,42,0.06)', fontSize: 'clamp(12px, 1.8vh, 15px)', color: '#334155', fontWeight: 600, whiteSpace: 'nowrap' }}>
        📱 Point your camera to review on <span style={{ fontWeight: 700 }}><span style={{ color: '#4285F4' }}>G</span><span style={{ color: '#EA4335' }}>o</span><span style={{ color: '#FBBC05' }}>o</span><span style={{ color: '#4285F4' }}>g</span><span style={{ color: '#34A853' }}>l</span><span style={{ color: '#EA4335' }}>e</span></span>
      </div>
    </div>
  );
}

/** Portrait: the review QR as one slim strip under the totals. */
function ReviewStrip({ url, accent }: { url: string; accent: string }) {
  return (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 'clamp(12px, 3vw, 24px)', background: 'linear-gradient(160deg, #ffffff, #fffdf5)', border: `1px solid ${GOLD}33`, borderRadius: 22, padding: 'clamp(10px, 1.6vh, 16px) clamp(12px, 2.6vw, 22px)', boxShadow: '0 12px 36px rgba(15,23,42,0.08)', boxSizing: 'border-box' }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 8, boxShadow: `0 8px 22px rgba(15,23,42,0.10), 0 0 0 2px ${accent}33`, flexShrink: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrSrc(url, 300)} alt="Google review QR" style={{ width: 'min(22vw, 13vh, 150px)', height: 'auto', display: 'block' }} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: '#f5a623', fontSize: 'clamp(15px, 2.4vw, 22px)', letterSpacing: 2 }}>★★★★★</div>
        <div style={{ fontFamily: 'Playfair Display, Georgia, serif', fontWeight: 600, fontSize: 'clamp(18px, 3.4vw, 30px)', color: '#0f172a', lineHeight: 1.15, margin: '2px 0 4px' }}>Enjoying your visit?</div>
        <div style={{ fontSize: 'clamp(12.5px, 2vw, 17px)', color: '#475569', lineHeight: 1.4 }}>Scan to leave a quick <strong>Google review</strong> 💛</div>
      </div>
    </div>
  );
}

const panel: CSSProperties = {
  background: 'white', borderRadius: 24, padding: 'clamp(18px, 2.6vw, 34px)', boxSizing: 'border-box',
  boxShadow: '0 20px 60px rgba(15,23,42,0.10)', width: '100%',
};
