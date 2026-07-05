'use client';

// ---------------------------------------------------------------------------
// Customer-facing checkout display — SECOND monitor (same PC as the register).
//
// Mirrors the cashier's register in real time via BroadcastChannel — same PC,
// same browser, no internet and no server. The register (/salon/pos) posts the
// live cart + totals; this page only renders what it receives.
//
// Customer-facing → English only. Every step carries a warm, prominent Google
// review call-to-action; the paid screen makes it the hero.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, CSSProperties } from 'react';

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
  tipTechs?: { name: string; qr?: string; handle?: string }[];
  reviewUrl?: string;
};

const TIP_PERCENTS = [15, 18, 20];
const GOLD = '#f59e0b';
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
  const [pad, setPad] = useState('');
  const [tipped, setTipped] = useState(false);
  const [revealTip, setRevealTip] = useState(false);
  const [chosenTip, setChosenTip] = useState<number | null>(null);
  const [portrait, setPortrait] = useState(false);
  // 'tall' = clearly portrait (height > 1.1× width). Square/landscape → false, so
  // the review card splits 50/50; portrait → stacks (QR on top, text below).
  const [tall, setTall] = useState(false);
  const [menu, setMenu] = useState(false); // staff exit menu
  const chRef = useRef<BroadcastChannel | null>(null);
  const tipPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (revealTip && tipPanelRef.current) tipPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [revealTip]);

  useEffect(() => {
    const check = () => { setPortrait(window.innerHeight >= window.innerWidth); setTall(window.innerHeight > window.innerWidth * 1.1); };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => { window.removeEventListener('resize', check); window.removeEventListener('orientationchange', check); };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return;
    const ch = new BroadcastChannel('lumio-pos-display');
    chRef.current = ch;
    let mode: 'mirror' | 'paid' = 'mirror';
    ch.onmessage = (e) => {
      const d = e.data;
      if (!d || d.type !== 'state' || !d.state) return;
      const stt = d.state.status;
      if (stt === 'active' && (d.state.lines?.length ?? 0) > 0) {
        mode = 'mirror'; setTipped(false); setRevealTip(false); setChosenTip(null); setKeypad(false);
        setS({ ...EMPTY, ...d.state }); return;
      }
      if (stt === 'paid') {
        if (mode !== 'paid') { mode = 'paid'; setTipped(false); setRevealTip(false); setChosenTip(null); setKeypad(false); }
        setS({ ...EMPTY, ...d.state }); return;
      }
      if (mode === 'paid') return;
      setS({ ...EMPTY, ...d.state });
    };
    ch.postMessage({ type: 'request' });
    return () => { ch.close(); chRef.current = null; };
  }, []);

  const sendTipDirect = (amountCents: number) => { chRef.current?.postMessage({ type: 'tipDirect', amountCents: Math.max(0, Math.round(amountCents)) }); setTipped(true); setKeypad(false); setPad(''); };

  const cur = s.currency;
  const accent = s.salonAccent || '#6366f1';
  const hasTip = (s.tipTechs?.length ?? 0) > 0;
  const brand = (s.salonName || s.salonLogo) ? (
    <div style={brandBar}>
      {s.salonLogo
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={s.salonLogo} alt="" style={{ height: 'clamp(34px, 5.2vh, 54px)', width: 'auto', objectFit: 'contain', borderRadius: 8 }} />
        : null}
      {s.salonName ? <div style={{ fontSize: 'clamp(18px, 2.6vw, 28px)', fontWeight: 800, color: '#1e293b' }}>{s.salonName}</div> : null}
    </div>
  ) : null;

  return (
    <div style={page}>
      <style>{`
        @keyframes lumioFade{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
        @keyframes lumioPop{0%{opacity:0;transform:scale(.6)}60%{opacity:1;transform:scale(1.08)}100%{transform:scale(1)}}
        @keyframes lumioStar{0%{opacity:0;transform:scale(.2) rotate(-25deg)}70%{opacity:1;transform:scale(1.25)}100%{transform:scale(1) rotate(0)}}
        @keyframes lumioPulse{0%,100%{transform:scale(1);opacity:.55}50%{transform:scale(1.05);opacity:.12}}
      `}</style>
      {brand}
      <div style={contentArea}>
        <div style={{ ...scrollInner, justifyContent: (s.status === 'active' && s.lines.length > 0) ? 'flex-start' : 'center' }}>

          {s.status === 'idle' || (s.status === 'active' && s.lines.length === 0) ? (
            <div style={centerBox}>
              <div style={{ fontSize: 'clamp(54px, 9vh, 82px)', marginBottom: 4 }}>💅</div>
              <div style={{ fontSize: 'clamp(34px, 6vw, 60px)', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.02em' }}>Welcome</div>
              <div style={{ fontSize: 'clamp(16px, 2.4vw, 24px)', color: '#64748b', marginTop: 10 }}>Sit back and relax — we&rsquo;ll take care of you.</div>
              {s.reviewUrl && <ReviewCard url={s.reviewUrl} accent={accent} stack={tall} />}
            </div>

          ) : s.status === 'paid' ? (
            <div style={centerBox}>
              {s.reviewUrl ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 2, animation: 'lumioFade .5s ease both' }}>
                  <div style={checkCircle(true)}>✓</div>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontSize: 'clamp(26px, 4.6vw, 44px)', fontWeight: 900, color: '#16a34a', lineHeight: 1.05 }}>Thank you!</div>
                    <div style={{ fontSize: 'clamp(14px, 2.1vw, 20px)', color: '#475569', marginTop: 3 }}>
                      Paid <strong>{money(s.paidCents ?? s.dueCents, cur)}</strong>{(s.changeCents ?? 0) > 0 ? ` · change ${money(s.changeCents!, cur)}` : ''}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div style={checkCircle(false)}>✓</div>
                  <div style={{ fontSize: 'clamp(32px, 6vw, 54px)', fontWeight: 900, color: '#16a34a' }}>Thank you!</div>
                  <div style={{ fontSize: 'clamp(18px, 2.8vw, 28px)', color: '#1e293b', marginTop: 12 }}>Paid <strong>{money(s.paidCents ?? s.dueCents, cur)}</strong></div>
                  {(s.changeCents ?? 0) > 0 && <div style={{ fontSize: 'clamp(15px, 2.2vw, 22px)', color: '#64748b', marginTop: 6 }}>Change {money(s.changeCents!, cur)}</div>}
                </>
              )}

              {s.reviewUrl && <ReviewCard url={s.reviewUrl} accent={accent} stack={tall} big />}

              {tipped ? (
                <div style={{ marginTop: 18, fontSize: 'clamp(16px, 2.2vw, 22px)', color: '#16a34a', fontWeight: 700 }}>You&rsquo;re so kind — thank you! 💛</div>
              ) : hasTip && revealTip ? (
                <div ref={tipPanelRef} style={{ marginTop: 10 }}>
                  <AfterTip s={s} cur={cur} accent={accent} chosen={chosenTip}
                    onChoose={setChosenTip}
                    onCustom={() => { setPad(''); setKeypad(true); }}
                    onConfirm={() => { if (chosenTip != null) sendTipDirect(chosenTip); }}
                    onSkip={() => { setRevealTip(false); setChosenTip(null); }} />
                </div>
              ) : hasTip ? (
                <button type="button" onPointerDown={() => setRevealTip(true)} onClick={() => setRevealTip(true)} style={{ ...softTipLink(accent), marginTop: 20 }}>
                  💝 Tip {s.tipTechs!.length === 1 ? s.tipTechs![0].name : 'your tech'}? <span style={{ opacity: 0.6, fontWeight: 500 }}>· optional</span>
                </button>
              ) : (
                <div style={{ marginTop: 16, fontSize: 'clamp(15px, 2vw, 20px)', color: '#94a3b8' }}>See you again soon 💕</div>
              )}
            </div>

          ) : (
            <div style={{ width: '100%', maxWidth: 1220, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'clamp(14px, 2.2vh, 24px)', animation: 'lumioFade .4s ease both' }}>
              <div style={{ display: 'flex', flexDirection: portrait ? 'column' : 'row', gap: portrait ? 'clamp(14px, 2vh, 20px)' : '2.4vw', alignItems: 'stretch' }}>
                <div style={{ ...itemsPanel, flex: portrait ? '0 0 auto' : '2 1 440px' }}>
                  <div style={{ fontSize: 'clamp(20px, 2.8vw, 30px)', fontWeight: 800, color: '#0f172a', marginBottom: 14 }}>Your services</div>
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
                <div style={{ ...totalsPanel(accent), flex: portrait ? '0 0 auto' : '1 1 330px' }}>
                  <Row k="Subtotal" v={money(s.subtotalCents, cur)} />
                  {s.savingsCents > 0 && <Row k="You saved" v={`− ${money(s.savingsCents, cur)}`} color="#bbf7d0" />}
                  {s.tipCents > 0 && <Row k="Tip" v={money(s.tipCents, cur)} />}
                  {s.taxCents > 0 && <Row k="Tax" v={money(s.taxCents, cur)} />}
                  {s.giftCents > 0 && <Row k="Gift card" v={`− ${money(s.giftCents, cur)}`} color="#bbf7d0" />}
                  <div style={{ height: 1, background: 'rgba(255,255,255,0.25)', margin: '16px 0' }} />
                  <div style={{ fontSize: 'clamp(14px, 2vw, 22px)', fontWeight: 600, color: 'rgba(255,255,255,0.9)', marginBottom: 4 }}>Amount due</div>
                  <div style={{ fontSize: 'clamp(30px, 6.5vw, 56px)', fontWeight: 900, color: 'white', whiteSpace: 'nowrap', letterSpacing: '-0.01em', lineHeight: 1.05 }}>{money(s.dueCents, cur)}</div>
                </div>
              </div>
              {s.reviewUrl && <ReviewCard url={s.reviewUrl} accent={accent} stack={tall} />}
            </div>
          )}

        </div>
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

      {/* Discreet staff exit — a faint gear (top-left) opens the exit menu. */}
      <button onClick={() => setMenu(true)} aria-label="Staff menu"
        style={{ position: 'fixed', top: 8, left: 8, width: 40, height: 40, borderRadius: 10, border: 'none', background: 'rgba(148,163,184,0.12)', color: 'rgba(100,116,139,0.5)', fontSize: 20, cursor: 'pointer', zIndex: 90, display: 'grid', placeItems: 'center' }}>⚙</button>
      {menu && (
        <div style={keypadOverlay} onClick={() => setMenu(false)}>
          <div style={{ ...keypadCard, width: 'min(90vw, 360px)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 19, fontWeight: 800, color: '#1e293b', textAlign: 'center' }}>Staff menu</div>
            <div style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', margin: '4px 0 18px' }}>For salon staff only</div>
            <button onClick={() => { window.location.href = '/login'; }} style={{ ...menuBtn, background: '#4f46e5', color: '#fff' }}>Sign in / Admin</button>
            <button onClick={() => { window.location.href = '/salon/pos'; }} style={{ ...menuBtn, background: '#f8fafc', color: '#334155', border: '1px solid #e2e8f0' }}>Back to register</button>
            <button onClick={() => setMenu(false)} style={{ ...menuBtn, background: '#f1f5f9', color: '#64748b' }}>Cancel</button>
          </div>
        </div>
      )}
      <div style={{ position: 'fixed', bottom: 6, right: 10, fontSize: 10, color: '#cbd5e1', pointerEvents: 'none', userSelect: 'none' }}>pos-display v4</div>
    </div>
  );
}

// --- After-payment tip (QR to the tech) -------------------------------------
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

const skipBtn: CSSProperties = { background: 'none', border: 'none', color: '#94a3b8', fontSize: 'clamp(13px, 1.5vw, 15px)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 };

// --- Google review invite ---------------------------------------------------
function GoogleWord({ size }: { size: number }) {
  const letters: [string, string][] = [['G', '#4285F4'], ['o', '#EA4335'], ['o', '#FBBC05'], ['g', '#4285F4'], ['l', '#34A853'], ['e', '#EA4335']];
  return (
    <span style={{ fontWeight: 800, fontSize: size, letterSpacing: '-0.01em' }}>
      {letters.map(([ch, c], i) => <span key={i} style={{ color: c }}>{ch}</span>)}
    </span>
  );
}
function Stars({ size, align = 'center' }: { size: number | string; align?: string }) {
  return (
    <div style={{ display: 'flex', gap: 5, justifyContent: align }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} style={{ fontSize: size, color: GOLD, animation: `lumioStar .5s ${0.06 * i}s both`, filter: 'drop-shadow(0 2px 4px rgba(245,158,11,0.35))' }}>★</span>
      ))}
    </div>
  );
}
// Google review invite. Portrait (stack) → QR on top, text below, centered.
// Landscape / square → a 50/50 split: QR fills one half, invitation the other.
function ReviewCard({ url, accent, stack, big }: { url: string; accent: string; stack?: boolean; big?: boolean }) {
  const qr = (px: number) => `https://api.qrserver.com/v1/create-qr-code/?size=${px}x${px}&margin=1&data=${encodeURIComponent(url)}`;
  const qrW = big
    ? (stack ? 'clamp(210px, 56vw, 340px)' : 'clamp(200px, 26vw, 340px)')
    : (stack ? 'clamp(170px, 50vw, 260px)' : 'clamp(160px, 20vw, 240px)');
  return (
    <div style={{
      display: 'flex', flexDirection: stack ? 'column' : 'row', alignItems: 'center',
      gap: stack ? 'clamp(14px, 3vh, 26px)' : 'clamp(22px, 4vw, 56px)',
      width: stack ? 'min(94vw, 520px)' : 'min(96vw, 940px)', margin: '20px auto 0',
      background: 'linear-gradient(160deg, #ffffff, #fffdf5)', border: `1px solid ${GOLD}33`,
      borderRadius: 26, padding: 'clamp(20px, 3vw, 40px)',
      boxShadow: big ? `0 22px 60px rgba(15,23,42,0.14), 0 0 0 6px ${accent}0d` : '0 14px 44px rgba(15,23,42,0.10)',
      animation: 'lumioFade .55s ease both', boxSizing: 'border-box',
    }}>
      <div style={{ flex: stack ? 'none' : '1 1 0%', display: 'flex', justifyContent: stack ? 'center' : 'flex-end' }}>
        <div style={{ position: 'relative' }}>
          {big && <div style={{ position: 'absolute', inset: -9, borderRadius: 26, border: `3px solid ${accent}`, animation: 'lumioPulse 2s ease-in-out infinite' }} />}
          <div style={{ position: 'relative', background: '#fff', borderRadius: 20, padding: 14, boxShadow: '0 12px 34px rgba(15,23,42,0.13)', border: '1px solid #eef2f7' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr(big ? 460 : 360)} alt="Google review QR" style={{ width: qrW, height: 'auto', display: 'block' }} />
          </div>
        </div>
      </div>
      <div style={{ flex: stack ? 'none' : '1 1 0%', textAlign: stack ? 'center' : 'left', maxWidth: stack ? 480 : 440 }}>
        <div style={{ marginBottom: 10 }}><Stars size={big ? 'clamp(28px, 4.5vw, 46px)' : 'clamp(22px, 3vw, 34px)'} align={stack ? 'center' : 'flex-start'} /></div>
        <div style={{ fontSize: big ? 'clamp(26px, 3.6vw, 44px)' : 'clamp(20px, 2.6vw, 30px)', fontWeight: 900, color: '#0f172a', letterSpacing: '-0.015em' }}>
          {big ? 'Loved your visit?' : 'Enjoying your visit?'}
        </div>
        <div style={{ fontSize: big ? 'clamp(15px, 1.9vw, 21px)' : 'clamp(14px, 1.7vw, 18px)', color: '#475569', margin: '8px 0 16px', lineHeight: 1.5 }}>
          Leave us a quick <strong>5-star Google review</strong> — it truly makes our day 💛
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', borderRadius: 999, padding: '8px 15px', border: '1px solid #eef2f7', boxShadow: '0 4px 14px rgba(15,23,42,0.06)' }}>
          <span style={{ fontSize: 15 }}>📱</span>
          <span style={{ fontSize: 'clamp(12.5px, 1.5vw, 15px)', color: '#334155', fontWeight: 600 }}>Point your camera to review on</span>
          <GoogleWord size={16} />
        </div>
      </div>
    </div>
  );
}

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

function checkCircle(small: boolean): CSSProperties {
  const d = small ? 'clamp(52px, 8vh, 72px)' : 'clamp(84px, 13vh, 116px)';
  return {
    width: d, height: d, borderRadius: '50%', background: '#dcfce7', color: '#16a34a',
    fontSize: small ? 'clamp(28px, 5vh, 42px)' : 'clamp(46px, 8vh, 66px)',
    display: 'grid', placeItems: 'center', margin: small ? 0 : '0 auto 16px',
    animation: 'lumioPop .55s cubic-bezier(.2,.8,.3,1.2) both', flexShrink: 0,
    boxShadow: '0 12px 34px rgba(22,163,74,0.28), 0 0 0 10px rgba(34,197,94,0.08)',
  };
}

const page: CSSProperties = {
  position: 'fixed', inset: 0, background: 'radial-gradient(1100px 550px at 12% -8%, #e0e7ff 0%, rgba(224,231,255,0) 55%), radial-gradient(900px 480px at 108% 6%, #ede9fe 0%, rgba(237,233,254,0) 52%), linear-gradient(160deg, #f8fafc 0%, #eef2ff 100%)',
  display: 'flex', flexDirection: 'column', padding: '2.5vw',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', overflow: 'hidden',
};
const contentArea: CSSProperties = { flex: 1, minHeight: 0, width: '100%', overflowY: 'auto' };
const scrollInner: CSSProperties = { minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0.5rem 0', boxSizing: 'border-box' };
const brandBar: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '2px 0 12px', flexShrink: 0 };
const centerBox: CSSProperties = { textAlign: 'center', maxWidth: 760, margin: '0 auto', animation: 'lumioFade .5s ease both' };
const itemsPanel: CSSProperties = {
  background: 'white', borderRadius: 24, padding: 'clamp(20px, 3vw, 38px)',
  boxShadow: '0 20px 60px rgba(15,23,42,0.10)',
};
function totalsPanel(accent: string): CSSProperties {
  return {
    background: `linear-gradient(160deg, ${accent} 0%, ${accent} 100%)`, borderRadius: 24,
    padding: 'clamp(22px, 3vw, 38px)', boxShadow: `0 20px 60px ${accent}59`,
    display: 'flex', flexDirection: 'column', justifyContent: 'center',
  };
}
const lineRow: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
  padding: 'clamp(11px, 1.6vw, 18px) 0', borderBottom: '1px solid #f1f5f9',
};
function softTipLink(accent: string): CSSProperties {
  return {
    border: `1.5px solid ${accent}55`, background: `${accent}0d`, color: accent,
    borderRadius: 999, padding: 'clamp(12px, 1.6vw, 16px) clamp(22px, 3vw, 32px)',
    fontSize: 'clamp(14px, 1.8vw, 19px)', fontWeight: 700, cursor: 'pointer',
    touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', userSelect: 'none',
  };
}
function quietChip(accent: string): CSSProperties {
  return {
    border: `1.5px solid ${accent}55`, background: '#fff', color: accent, borderRadius: 999,
    padding: 'clamp(8px, 1.2vw, 12px) clamp(14px, 2vw, 20px)', cursor: 'pointer',
    fontSize: 'clamp(14px, 1.7vw, 18px)', fontWeight: 700, touchAction: 'manipulation',
  };
}
const afterTipCard: CSSProperties = {
  margin: '20px auto 0', width: 'min(94vw, 500px)', background: '#fff', borderRadius: 20,
  padding: 'clamp(18px, 3vw, 28px)', border: '1px solid #eef2f7',
  boxShadow: '0 12px 40px rgba(15,23,42,0.08)', textAlign: 'center',
};
const keypadOverlay: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 100,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4vw',
};
const keypadCard: CSSProperties = {
  background: 'white', borderRadius: 24, padding: 'clamp(18px, 3vw, 32px)',
  width: 'min(92vw, 420px)', boxShadow: '0 30px 80px rgba(0,0,0,0.40)',
};
const keypadKey: CSSProperties = {
  padding: 'clamp(12px, 2vw, 20px)', fontSize: 'clamp(20px, 3vw, 28px)', fontWeight: 700,
  borderRadius: 14, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#1e293b', cursor: 'pointer', touchAction: 'manipulation',
};
const menuBtn: CSSProperties = {
  display: 'block', width: '100%', boxSizing: 'border-box', marginBottom: 10,
  padding: '13px 14px', borderRadius: 12, border: 'none',
  fontSize: 15, fontWeight: 700, cursor: 'pointer',
};
