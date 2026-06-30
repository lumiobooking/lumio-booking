'use client';

// ---------------------------------------------------------------------------
// Customer-facing checkout display.
//
// Open this on a SECOND monitor that faces the customer. It mirrors the cashier's
// register in real time using the browser's BroadcastChannel — same PC, same
// browser, no internet and no server needed. The register (/salon/pos) posts the
// live cart + totals; this page only renders what it receives (no auth, no data
// fetch), so it is safe to leave open.
//
// Customer-facing → English only (matches the booking page & printed receipts).
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';

type Line = { name: string; qty: number; lineCents: number; staff?: string };
type DisplayState = {
  status: 'idle' | 'active' | 'paid';
  currency: string;
  salonName?: string;
  salonLogo?: string;
  salonAccent?: string;
  lines: Line[];
  subtotalCents: number;
  savingsCents: number;
  tipCents: number;
  taxCents: number;
  giftCents: number;
  dueCents: number;
  paidCents?: number;
  changeCents?: number;
  tippable?: boolean;
  tipBaseCents?: number;
};

const TIP_PERCENTS = [15, 18, 20];

const EMPTY: DisplayState = {
  status: 'idle', currency: 'USD', lines: [],
  subtotalCents: 0, savingsCents: 0, tipCents: 0, taxCents: 0, giftCents: 0, dueCents: 0,
};

function money(cents: number, currency: string) {
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format((cents || 0) / 100); }
  catch { return `$${((cents || 0) / 100).toFixed(2)}`; }
}

export default function PosDisplayPage() {
  const [s, setS] = useState<DisplayState>(EMPTY);
  const [keypad, setKeypad] = useState(false);
  const [pad, setPad] = useState(''); // custom-tip dollars being typed
  const chRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return;
    const ch = new BroadcastChannel('lumio-pos-display');
    chRef.current = ch;
    let holdUntil = 0; // keep the "Thank you" screen up briefly after a sale
    ch.onmessage = (e) => {
      const d = e.data;
      if (!d || d.type !== 'state' || !d.state) return;
      if (d.state.status === 'paid') { holdUntil = Date.now() + 5000; setKeypad(false); setS({ ...EMPTY, ...d.state }); return; }
      if (Date.now() < holdUntil) return; // still showing the thank-you
      setS({ ...EMPTY, ...d.state });
    };
    // Ask the register to replay its current state (it may already be running).
    ch.postMessage({ type: 'request' });
    return () => { ch.close(); chRef.current = null; };
  }, []);

  // Send the customer's chosen tip back to the register (it applies + rebroadcasts).
  const sendTip = (amountCents: number) => { chRef.current?.postMessage({ type: 'tip', amountCents: Math.max(0, Math.round(amountCents)) }); setKeypad(false); setPad(''); };

  const cur = s.currency;
  const accent = s.salonAccent || '#6366f1';
  const brand = (s.salonName || s.salonLogo) ? (
    <div style={brandBar}>
      {s.salonLogo
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={s.salonLogo} alt="" style={{ height: 'clamp(36px, 5.5vh, 58px)', width: 'auto', objectFit: 'contain', borderRadius: 8 }} />
        : null}
      {s.salonName ? <div style={{ fontSize: 'clamp(18px, 2.6vw, 28px)', fontWeight: 800, color: '#1e293b' }}>{s.salonName}</div> : null}
    </div>
  ) : null;

  return (
    <div style={page}>
      {brand}
      <div style={contentArea}>
      {s.status === 'idle' || (s.status === 'active' && s.lines.length === 0) ? (
        <div style={centerBox}>
          <div style={{ fontSize: 72, marginBottom: 10 }}>💅</div>
          <div style={{ fontSize: 'clamp(34px, 6vw, 60px)', fontWeight: 800, color: '#1e293b' }}>Welcome</div>
          <div style={{ fontSize: 'clamp(16px, 2.4vw, 24px)', color: '#64748b', marginTop: 12 }}>Sit back and relax — we&rsquo;ll take care of you.</div>
        </div>
      ) : s.status === 'paid' ? (
        <div style={centerBox}>
          <div style={{ width: 120, height: 120, borderRadius: '50%', background: '#dcfce7', color: '#16a34a', fontSize: 70, display: 'grid', placeItems: 'center', margin: '0 auto 18px' }}>✓</div>
          <div style={{ fontSize: 'clamp(34px, 6vw, 58px)', fontWeight: 800, color: '#16a34a' }}>Thank you!</div>
          <div style={{ fontSize: 'clamp(20px, 3vw, 30px)', color: '#1e293b', marginTop: 14 }}>Paid <strong>{money(s.paidCents ?? s.dueCents, cur)}</strong></div>
          {(s.changeCents ?? 0) > 0 && (
            <div style={{ fontSize: 'clamp(16px, 2.2vw, 22px)', color: '#64748b', marginTop: 6 }}>Change {money(s.changeCents!, cur)}</div>
          )}
          <div style={{ fontSize: 'clamp(15px, 2vw, 20px)', color: '#94a3b8', marginTop: 18 }}>See you again soon 💕</div>
        </div>
      ) : (
        <div style={twoCol}>
          {/* Itemised list */}
          <div style={itemsPanel}>
            <div style={{ fontSize: 'clamp(22px, 3vw, 32px)', fontWeight: 800, color: '#1e293b', marginBottom: 18 }}>Your order</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {s.lines.map((l, i) => (
                <div key={i} style={lineRow}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 'clamp(17px, 2.1vw, 23px)', fontWeight: 600, color: '#1e293b' }}>
                      <span style={{ color: accent, fontWeight: 800 }}>{l.qty}×</span> {l.name}
                    </div>
                    {l.staff && <div style={{ fontSize: 'clamp(12px, 1.5vw, 15px)', color: '#94a3b8', marginTop: 2 }}>with {l.staff}</div>}
                  </div>
                  <div style={{ fontSize: 'clamp(17px, 2.1vw, 23px)', fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', marginLeft: 16 }}>{money(l.lineCents, cur)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Totals card */}
          <div style={{ ...totalsPanel, background: `linear-gradient(160deg, ${accent} 0%, ${accent} 100%)`, boxShadow: `0 20px 60px ${accent}59` }}>
            <Row k="Subtotal" v={money(s.subtotalCents, cur)} />
            {s.savingsCents > 0 && <Row k="You saved" v={`− ${money(s.savingsCents, cur)}`} color="#bbf7d0" />}
            {s.tipCents > 0 && <Row k="Tip" v={money(s.tipCents, cur)} />}
            {s.taxCents > 0 && <Row k="Tax" v={money(s.taxCents, cur)} />}
            {s.giftCents > 0 && <Row k="Gift card" v={`− ${money(s.giftCents, cur)}`} color="#bbf7d0" />}

            {/* Customer-tap tip — % of the service subtotal. Tap sends it back to the register. */}
            {s.tippable && (s.tipBaseCents ?? 0) > 0 && (
              <div style={{ margin: '16px 0 4px' }}>
                <div style={{ fontSize: 'clamp(14px, 1.9vw, 19px)', fontWeight: 700, color: 'white', marginBottom: 10, textAlign: 'center' }}>Add a tip for your tech 💕</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {TIP_PERCENTS.map((pct) => {
                    const amt = Math.round((s.tipBaseCents! * pct) / 100);
                    const sel = (s.tipCents || 0) > 0 && Math.abs((s.tipCents || 0) - amt) <= 1;
                    return (
                      <button key={pct} onClick={() => sendTip(amt)} style={tipBtn(sel)}>
                        <span style={{ fontSize: 'clamp(16px, 2.2vw, 22px)', fontWeight: 800 }}>{pct}%</span>
                        <span style={{ fontSize: 'clamp(11px, 1.4vw, 14px)', opacity: 0.85 }}>{money(amt, cur)}</span>
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                  <button onClick={() => { setPad(''); setKeypad(true); }} style={tipBtn(false)}>Custom</button>
                  <button onClick={() => sendTip(0)} style={tipBtn((s.tipCents || 0) === 0)}>No tip</button>
                </div>
              </div>
            )}

            <div style={{ height: 1, background: 'rgba(255,255,255,0.25)', margin: '18px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
              <span style={{ fontSize: 'clamp(18px, 2.4vw, 26px)', fontWeight: 700, color: 'rgba(255,255,255,0.92)' }}>Amount due</span>
              <span style={{ fontSize: 'clamp(36px, 6vw, 64px)', fontWeight: 900, color: 'white', letterSpacing: '-0.02em', lineHeight: 1 }}>{money(s.dueCents, cur)}</span>
            </div>
          </div>
        </div>
      )}
      </div>

      {keypad && (
        <div style={keypadOverlay} onClick={() => { setKeypad(false); setPad(''); }}>
          <div style={keypadCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 'clamp(17px, 2.4vw, 24px)', fontWeight: 800, color: '#1e293b', textAlign: 'center' }}>Enter tip amount</div>
            <div style={{ fontSize: 'clamp(34px, 6vw, 52px)', fontWeight: 900, color: accent, textAlign: 'center', margin: '8px 0 16px' }}>{money(Math.round((parseFloat(pad) || 0) * 100), cur)}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '←'].map((k) => (
                <button key={k} onClick={() => setPad((p) => padPress(p, k))} style={keypadKey}>{k}</button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
              <button onClick={() => { setKeypad(false); setPad(''); }} style={{ ...keypadKey, background: '#f1f5f9', color: '#475569', fontWeight: 700 }}>Cancel</button>
              <button onClick={() => { const v = Math.round((parseFloat(pad) || 0) * 100); if (v > 0) sendTip(v); }} style={{ ...keypadKey, background: accent, color: 'white', fontWeight: 800 }}>Add tip</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function tipBtn(sel: boolean): React.CSSProperties {
  return {
    border: sel ? '2px solid white' : '2px solid rgba(255,255,255,0.45)',
    background: sel ? 'white' : 'rgba(255,255,255,0.12)',
    color: sel ? '#1e293b' : 'white',
    borderRadius: 14, padding: 'clamp(9px, 1.4vw, 15px)', cursor: 'pointer',
    fontSize: 'clamp(14px, 1.8vw, 18px)', fontWeight: 700, lineHeight: 1.15,
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
  };
}

// Build up a dollar string from keypad taps: one dot, max 2 decimals, capped length.
function padPress(p: string, k: string): string {
  if (k === '←') return p.slice(0, -1);
  if (k === '.') return p.includes('.') ? p : (p === '' ? '0.' : p + '.');
  if (p.includes('.') && p.split('.')[1].length >= 2) return p;
  if (p.replace('.', '').length >= 6) return p;
  return p + k;
}

function Row({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0' }}>
      <span style={{ fontSize: 'clamp(15px, 2vw, 21px)', color: 'rgba(255,255,255,0.85)' }}>{k}</span>
      <span style={{ fontSize: 'clamp(15px, 2vw, 21px)', fontWeight: 700, color: color || 'white', whiteSpace: 'nowrap' }}>{v}</span>
    </div>
  );
}

const page: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%)',
  display: 'flex', flexDirection: 'column', padding: '2.5vw',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', overflow: 'hidden',
};
const contentArea: React.CSSProperties = { flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' };
const brandBar: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '2px 0 14px', flexShrink: 0 };
const centerBox: React.CSSProperties = { textAlign: 'center', maxWidth: 720 };
const twoCol: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: '3vw', width: '100%', maxWidth: 1280,
  alignItems: 'stretch', justifyContent: 'center',
};
const itemsPanel: React.CSSProperties = {
  flex: '2 1 440px', background: 'white', borderRadius: 24, padding: 'clamp(20px, 3vw, 40px)',
  boxShadow: '0 20px 60px rgba(15,23,42,0.10)', maxHeight: '88vh', overflowY: 'auto',
};
const totalsPanel: React.CSSProperties = {
  flex: '1 1 340px', background: 'linear-gradient(160deg, #6366f1 0%, #4f46e5 100%)', borderRadius: 24,
  padding: 'clamp(22px, 3vw, 40px)', boxShadow: '0 20px 60px rgba(79,70,229,0.35)',
  display: 'flex', flexDirection: 'column', justifyContent: 'center',
};
const lineRow: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  padding: 'clamp(11px, 1.6vw, 18px) 0', borderBottom: '1px solid #f1f5f9',
};
const keypadOverlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 100,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vw',
};
const keypadCard: React.CSSProperties = {
  background: 'white', borderRadius: 24, padding: 'clamp(18px, 3vw, 32px)',
  width: 'min(92vw, 420px)', boxShadow: '0 30px 80px rgba(0,0,0,0.40)',
};
const keypadKey: React.CSSProperties = {
  padding: 'clamp(12px, 2vw, 20px)', fontSize: 'clamp(20px, 3vw, 28px)', fontWeight: 700,
  borderRadius: 14, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#1e293b', cursor: 'pointer',
};
