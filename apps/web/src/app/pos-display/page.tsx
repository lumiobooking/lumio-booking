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
  // Channel 3 — tech(s) whose QR is offered on the AFTER-PAYMENT screen.
  tipTechs?: { name: string; qr?: string; handle?: string }[];
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
  const [tipped, setTipped] = useState(false); // customer recorded an after-payment tip
  const [revealTip, setRevealTip] = useState(false); // customer opted in to see the (optional) tip panel
  const [chosenTip, setChosenTip] = useState<number | null>(null); // amount selected but NOT yet confirmed as sent
  const chRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return;
    const ch = new BroadcastChannel('lumio-pos-display');
    chRef.current = ch;
    let holdUntil = 0; // keep the "Thank you" screen up briefly after a sale
    ch.onmessage = (e) => {
      const d = e.data;
      if (!d || d.type !== 'state' || !d.state) return;
      // A new ticket (active with items) always takes over — even during a paid hold.
      if (d.state.status === 'active' && (d.state.lines?.length ?? 0) > 0) { holdUntil = 0; setTipped(false); setRevealTip(false); setChosenTip(null); setKeypad(false); setS({ ...EMPTY, ...d.state }); return; }
      if (d.state.status === 'paid') {
        // Hold the thank-you 5s normally; much longer when we're inviting an
        // after-payment tip so the customer has time to scan the QR.
        holdUntil = Date.now() + (((d.state.tipTechs?.length ?? 0) > 0) ? 5 * 60 * 1000 : 5000);
        setTipped(false); setRevealTip(false); setChosenTip(null); setKeypad(false); setS({ ...EMPTY, ...d.state }); return;
      }
      if (Date.now() < holdUntil) return; // still showing the thank-you
      setS({ ...EMPTY, ...d.state });
    };
    // Ask the register to replay its current state (it may already be running).
    ch.postMessage({ type: 'request' });
    return () => { ch.close(); chRef.current = null; };
  }, []);

  // Optional tip AFTER payment: record the amount, then the customer scans the
  // tech's QR to pay them directly (the bill is already settled to the salon).
  // There is deliberately NO tip prompt during checkout — asking before paying
  // feels pushy and hurts repeat visits; a gentle, opt-in thank-you comes after.
  const sendTipDirect = (amountCents: number) => { chRef.current?.postMessage({ type: 'tipDirect', amountCents: Math.max(0, Math.round(amountCents)) }); setTipped(true); setKeypad(false); setPad(''); };

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
          <div style={{ width: 'clamp(84px, 13vh, 116px)', height: 'clamp(84px, 13vh, 116px)', borderRadius: '50%', background: '#dcfce7', color: '#16a34a', fontSize: 'clamp(46px, 8vh, 66px)', display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}>✓</div>
          <div style={{ fontSize: 'clamp(32px, 6vw, 54px)', fontWeight: 800, color: '#16a34a' }}>Thank you!</div>
          <div style={{ fontSize: 'clamp(18px, 2.8vw, 28px)', color: '#1e293b', marginTop: 12 }}>Paid <strong>{money(s.paidCents ?? s.dueCents, cur)}</strong></div>
          {(s.changeCents ?? 0) > 0 && (
            <div style={{ fontSize: 'clamp(15px, 2.2vw, 22px)', color: '#64748b', marginTop: 6 }}>Change {money(s.changeCents!, cur)}</div>
          )}
          {tipped ? (
            <div style={{ marginTop: 20, fontSize: 'clamp(16px, 2.2vw, 22px)', color: '#16a34a', fontWeight: 700 }}>You&rsquo;re so kind — thank you! 💛</div>
          ) : (s.tipTechs?.length ?? 0) > 0 && revealTip ? (
            <AfterTip s={s} cur={cur} accent={accent} chosen={chosenTip}
              onChoose={setChosenTip}
              onCustom={() => { setPad(''); setKeypad(true); }}
              onConfirm={() => { if (chosenTip != null) sendTipDirect(chosenTip); }}
              onSkip={() => { setRevealTip(false); setChosenTip(null); }} />
          ) : (
            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <div style={{ fontSize: 'clamp(15px, 2vw, 20px)', color: '#94a3b8' }}>See you again soon 💕</div>
              {(s.tipTechs?.length ?? 0) > 0 && (
                <button onClick={() => setRevealTip(true)} style={softTipLink(accent)}>
                  Tip {s.tipTechs!.length === 1 ? s.tipTechs![0].name : 'your tech'}? <span style={{ opacity: 0.6, fontWeight: 500 }}>· optional</span>
                </button>
              )}
            </div>
          )}
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

            <div style={{ height: 1, background: 'rgba(255,255,255,0.25)', margin: '18px 0' }} />
            <div>
              <div style={{ fontSize: 'clamp(15px, 2vw, 22px)', fontWeight: 600, color: 'rgba(255,255,255,0.9)', marginBottom: 4 }}>Amount due</div>
              <div style={{ fontSize: 'clamp(30px, 6.5vw, 56px)', fontWeight: 900, color: 'white', whiteSpace: 'nowrap', letterSpacing: '-0.01em', lineHeight: 1.05 }}>{money(s.dueCents, cur)}</div>
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
              <button onClick={() => { const v = Math.round((parseFloat(pad) || 0) * 100); if (v > 0) { setChosenTip(v); setKeypad(false); setPad(''); } }} style={{ ...keypadKey, background: accent, color: 'white', fontWeight: 800 }}>Use this amount</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Gentle, OPT-IN tip panel shown only after the bill is paid, and only once the
 * customer chooses to see it. The bill is already settled to the salon; this is a
 * calm, entirely-optional thank-you that goes STRAIGHT to the tech via their QR.
 * Design goal: never make a customer feel pressured — soft visuals, easy to skip.
 */
function AfterTip({ s, cur, accent, chosen, onChoose, onCustom, onConfirm, onSkip }: {
  s: DisplayState; cur: string; accent: string; chosen: number | null;
  onChoose: (cents: number | null) => void; onCustom: () => void; onConfirm: () => void; onSkip: () => void;
}) {
  const base = s.tipBaseCents ?? 0;
  const techName = s.tipTechs && s.tipTechs.length === 1 ? s.tipTechs[0].name : 'your tech';
  return (
    <div style={afterTipCard}>
      <div style={{ fontSize: 'clamp(16px, 2.1vw, 21px)', fontWeight: 700, color: '#334155' }}>A little thank-you for your tech</div>
      <div style={{ fontSize: 'clamp(12.5px, 1.5vw, 15px)', color: '#94a3b8', margin: '4px 0 14px' }}>Totally optional 💛 100% goes straight to them.</div>

      {/* The QR stays visible the whole time — this is how the customer actually pays. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, justifyContent: 'center' }}>
        {s.tipTechs!.map((t, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
            {t.qr
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={t.qr} alt={`${t.name} tip QR`} style={{ width: 'clamp(120px, 20vw, 168px)', height: 'auto', borderRadius: 12, background: '#fff', padding: 7, border: chosen != null ? `2px solid ${accent}` : '1px solid #eef2f7' }} />
              : <div style={{ fontSize: 'clamp(12px, 1.5vw, 15px)', color: '#94a3b8', padding: '18px 8px' }}>Ask {t.name} for their tip QR</div>}
            <div style={{ fontSize: 'clamp(13px, 1.6vw, 16px)', fontWeight: 600, color: '#475569' }}>{t.name}</div>
            {t.handle && <div style={{ fontSize: 'clamp(11px, 1.4vw, 14px)', color: '#94a3b8' }}>{t.handle}</div>}
          </div>
        ))}
      </div>

      {chosen == null ? (
        <>
          {base > 0 && <div style={{ fontSize: 'clamp(12.5px, 1.5vw, 15px)', color: '#64748b', margin: '14px 0 8px' }}>Scan the QR to tip any amount — or pick one:</div>}
          {base > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
              {TIP_PERCENTS.map((pct) => (
                <button key={pct} onClick={() => onChoose(Math.round((base * pct) / 100))} style={quietChip(accent)}>{money(Math.round((base * pct) / 100), cur)}</button>
              ))}
              <button onClick={onCustom} style={quietChip(accent)}>Other</button>
            </div>
          )}
          <button onClick={onSkip} style={{ ...skipBtn, marginTop: 14 }}>No thanks</button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 'clamp(15px, 1.9vw, 20px)', color: '#334155', margin: '14px 0 3px' }}>Scan to send <strong style={{ color: accent }}>{money(chosen, cur)}</strong> to {techName}</div>
          <div style={{ fontSize: 'clamp(12.5px, 1.5vw, 15px)', color: '#94a3b8', marginBottom: 14 }}>Open your camera or payment app, scan &amp; send — <strong>then</strong> tap below.</div>
          <button onClick={onConfirm} style={{ width: '100%', maxWidth: 320, boxSizing: 'border-box', padding: 'clamp(11px, 1.6vw, 15px)', borderRadius: 12, border: 'none', background: accent, color: '#fff', fontSize: 'clamp(15px, 1.8vw, 19px)', fontWeight: 800, cursor: 'pointer' }}>✓ I&rsquo;ve sent it</button>
          <div style={{ display: 'flex', gap: 20, justifyContent: 'center', marginTop: 14 }}>
            <button onClick={() => onChoose(null)} style={skipBtn}>Change amount</button>
            <button onClick={onSkip} style={skipBtn}>No thanks</button>
          </div>
        </>
      )}
    </div>
  );
}

const skipBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#94a3b8', fontSize: 'clamp(13px, 1.5vw, 15px)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 };

// A small, understated tip link on the paid screen (opt-in — never forced).
function softTipLink(accent: string): React.CSSProperties {
  return {
    border: `1.5px solid ${accent}44`, background: `${accent}0d`, color: accent,
    borderRadius: 999, padding: 'clamp(8px, 1.2vw, 12px) clamp(16px, 2.4vw, 24px)',
    fontSize: 'clamp(14px, 1.7vw, 18px)', fontWeight: 700, cursor: 'pointer',
  };
}

// A calm outline chip for the (optional) suggested tip amounts.
function quietChip(accent: string): React.CSSProperties {
  return {
    border: `1.5px solid ${accent}55`, background: '#fff', color: accent, borderRadius: 999,
    padding: 'clamp(8px, 1.2vw, 12px) clamp(14px, 2vw, 20px)', cursor: 'pointer',
    fontSize: 'clamp(14px, 1.7vw, 18px)', fontWeight: 700,
  };
}

const afterTipCard: React.CSSProperties = {
  marginTop: 22, width: 'min(94vw, 500px)', background: '#fff', borderRadius: 20,
  padding: 'clamp(18px, 3vw, 28px)', border: '1px solid #eef2f7',
  boxShadow: '0 12px 40px rgba(15,23,42,0.08)', textAlign: 'center',
};

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
const contentArea: React.CSSProperties = { flex: 1, minHeight: 0, width: '100%', overflowY: 'auto', display: 'flex', flexDirection: 'column', padding: '0.5rem 0' };
const brandBar: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '2px 0 14px', flexShrink: 0 };
const centerBox: React.CSSProperties = { textAlign: 'center', maxWidth: 720, margin: 'auto' };
const twoCol: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: '3vw', width: '100%', maxWidth: 1280,
  alignItems: 'stretch', justifyContent: 'center', margin: 'auto',
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
