'use client';

// ---------------------------------------------------------------------------
// Wireless customer display (independent device — e.g. an iPad on a stand).
//
// Unlike /pos-display (same-PC second monitor over BroadcastChannel), this page
// talks to the BACKEND: it pairs once with a short code, then POLLS the salon's
// live state (~1s) and posts after-payment QR tips. So it works on any device on
// any network — no cables, no Sidecar.
//
// Customer-facing → English only (matches the booking page & printed receipts).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch, ApiError } from '../../lib/api';

const TOKEN_KEY = 'lumio_display_token';

type Line = { name: string; qty: number; lineCents: number; staff?: string };
type DisplayState = {
  status: 'idle' | 'active' | 'paid';
  currency: string;
  salonName?: string;
  salonLogo?: string;
  salonAccent?: string;
  saleRef?: string;
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

export default function DisplayPage() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const pairWith = useCallback(async (code: string): Promise<boolean> => {
    try {
      const r = await apiFetch<{ token: string }>('/display/pair', { method: 'POST', body: { pairCode: code.trim().toUpperCase() } });
      try { localStorage.setItem(TOKEN_KEY, r.token); } catch { /* ignore */ }
      try { window.history.replaceState({}, '', '/display'); } catch { /* ignore */ }
      setToken(r.token);
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(TOKEN_KEY); } catch { /* ignore */ }
    if (saved) { setToken(saved); setReady(true); return; }
    const c = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('c') : null;
    if (c) { pairWith(c).finally(() => setReady(true)); }
    else setReady(true);
  }, [pairWith]);

  if (!ready) return <div style={fullCenter}><div style={{ color: '#94a3b8' }}>Loading…</div></div>;
  if (!token) return <PairScreen onPair={pairWith} />;
  return <LiveDisplay token={token} onUnlink={() => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } setToken(null); }} />;
}

// --- One-time pairing -------------------------------------------------------
function PairScreen({ onPair }: { onPair: (code: string) => Promise<boolean> }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const submit = async () => {
    if (!code.trim()) return;
    setBusy(true); setErr(false);
    const ok = await onPair(code);
    if (!ok) { setErr(true); setBusy(false); }
  };
  return (
    <div style={fullCenter}>
      <div style={{ textAlign: 'center', maxWidth: 420, width: '90%' }}>
        <div style={{ fontSize: 56, marginBottom: 8 }}>📱</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: '#1e293b' }}>Link this screen</div>
        <p style={{ color: '#64748b', fontSize: 15, margin: '10px 0 22px', lineHeight: 1.5 }}>
          On the salon register, open <strong>iPad</strong> and enter the code shown there.
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="CODE"
          autoCapitalize="characters"
          autoCorrect="off"
          style={{ width: '100%', boxSizing: 'border-box', textAlign: 'center', fontSize: 30, fontWeight: 800, letterSpacing: 8, fontFamily: 'monospace', padding: '14px 12px', borderRadius: 14, border: '1px solid #cbd5e1', color: '#0f172a', textTransform: 'uppercase' }}
        />
        {err && <div style={{ color: '#dc2626', fontSize: 14, marginTop: 10 }}>That code didn&rsquo;t work. Check the register and try again.</div>}
        <button onClick={submit} disabled={busy} style={{ marginTop: 16, width: '100%', padding: '14px', borderRadius: 14, border: 'none', background: '#4f46e5', color: '#fff', fontSize: 17, fontWeight: 800, cursor: 'pointer', opacity: busy ? 0.7 : 1 }}>
          {busy ? 'Linking…' : 'Link screen'}
        </button>
      </div>
    </div>
  );
}

// --- Live mirror + tip ------------------------------------------------------
function LiveDisplay({ token, onUnlink }: { token: string; onUnlink: () => void }) {
  const [s, setS] = useState<DisplayState>(EMPTY);
  const [notLinked, setNotLinked] = useState(false);
  const [tipped, setTipped] = useState(false);
  const [revealTip, setRevealTip] = useState(false);
  const [chosenTip, setChosenTip] = useState<number | null>(null);
  const [keypad, setKeypad] = useState(false);
  const [pad, setPad] = useState('');
  const [portrait, setPortrait] = useState(true); // adapt the order screen to orientation
  const prevSaleRef = useRef<string>('__init__');
  const tipPanelRef = useRef<HTMLDivElement | null>(null);

  // Poll the salon's current state ~1s. A new paid sale (saleRef change) — or any
  // move away from the paid screen — resets the optional tip UI.
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await apiFetch<{ state: DisplayState | null }>(`/display/state/${token}`);
        if (!alive) return;
        setNotLinked(false);
        const st = r.state ? { ...EMPTY, ...r.state } : EMPTY;
        const saleKey = st.status === 'paid' ? (st.saleRef || 'paid') : `_${st.status}`;
        if (saleKey !== prevSaleRef.current) {
          prevSaleRef.current = saleKey;
          setTipped(false); setRevealTip(false); setChosenTip(null); setKeypad(false);
        }
        setS(st);
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 404) setNotLinked(true);
      }
    };
    poll();
    const id = setInterval(poll, 1000);
    return () => { alive = false; clearInterval(id); };
  }, [token]);

  useEffect(() => {
    if (revealTip && tipPanelRef.current) tipPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [revealTip]);
  // Track orientation so the order screen can lay out cleanly in portrait AND
  // landscape (side-by-side when wide, stacked with the total pinned when tall).
  useEffect(() => {
    const check = () => setPortrait(window.innerHeight >= window.innerWidth);
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => { window.removeEventListener('resize', check); window.removeEventListener('orientationchange', check); };
  }, []);

  const sendTip = useCallback((amountCents: number) => {
    apiFetch(`/display/tip/${token}`, { method: 'POST', body: { amountCents: Math.max(0, Math.round(amountCents)) } }).catch(() => { /* best-effort log */ });
    setTipped(true); setKeypad(false); setPad('');
  }, [token]);

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

  const isActive = s.status === 'active' && s.lines.length > 0;

  if (notLinked) {
    return (
      <div style={fullCenter}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 46, marginBottom: 8 }}>🔌</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#1e293b' }}>This screen was unlinked</div>
          <button onClick={onUnlink} style={{ marginTop: 16, padding: '12px 20px', borderRadius: 12, border: 'none', background: '#4f46e5', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>Pair again</button>
        </div>
      </div>
    );
  }

  return (
    <div style={page}>
      {brand}
      <div style={contentArea}>
        <div style={{ ...scrollInner, justifyContent: isActive ? 'flex-start' : 'center' }}>
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
                <div ref={tipPanelRef}>
                  <AfterTip s={s} cur={cur} accent={accent} chosen={chosenTip}
                    onChoose={setChosenTip}
                    onCustom={() => { setPad(''); setKeypad(true); }}
                    onConfirm={() => { if (chosenTip != null) sendTip(chosenTip); }}
                    onSkip={() => { setRevealTip(false); setChosenTip(null); }} />
                </div>
              ) : (
                <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                  <div style={{ fontSize: 'clamp(15px, 2vw, 20px)', color: '#94a3b8' }}>See you again soon 💕</div>
                  {(s.tipTechs?.length ?? 0) > 0 && (
                    <button type="button" onPointerDown={() => setRevealTip(true)} onClick={() => setRevealTip(true)} style={softTipLink(accent)}>
                      Tip {s.tipTechs!.length === 1 ? s.tipTechs![0].name : 'your tech'}? <span style={{ opacity: 0.6, fontWeight: 500 }}>· optional</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={activeWrap(portrait)}>
              <div style={{ ...itemsPanel, flex: portrait ? '1 1 0%' : '2 1 440px', minHeight: 0, maxHeight: 'none' }}>
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
              <div style={{ ...totalsPanel, flex: portrait ? '0 0 auto' : '1 1 340px', background: `linear-gradient(160deg, ${accent} 0%, ${accent} 100%)`, boxShadow: `0 20px 60px ${accent}59` }}>
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
      <div style={{ position: 'fixed', bottom: 6, right: 10, fontSize: 10, color: '#cbd5e1', pointerEvents: 'none', userSelect: 'none' }}>ipad v2</div>
    </div>
  );
}

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
          <button type="button" onPointerDown={onConfirm} onClick={onConfirm} style={{ width: '100%', maxWidth: 320, boxSizing: 'border-box', padding: 'clamp(11px, 1.6vw, 15px)', borderRadius: 12, border: 'none', background: accent, color: '#fff', fontSize: 'clamp(15px, 1.8vw, 19px)', fontWeight: 800, cursor: 'pointer', touchAction: 'manipulation' }}>✓ I&rsquo;ve sent it</button>
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
function softTipLink(accent: string): React.CSSProperties {
  return {
    border: `1.5px solid ${accent}55`, background: `${accent}0d`, color: accent,
    borderRadius: 999, padding: 'clamp(13px, 1.8vw, 18px) clamp(24px, 3.2vw, 36px)',
    fontSize: 'clamp(15px, 1.9vw, 20px)', fontWeight: 700, cursor: 'pointer',
    touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', userSelect: 'none',
  };
}
function quietChip(accent: string): React.CSSProperties {
  return {
    border: `1.5px solid ${accent}55`, background: '#fff', color: accent, borderRadius: 999,
    padding: 'clamp(8px, 1.2vw, 12px) clamp(14px, 2vw, 20px)', cursor: 'pointer',
    fontSize: 'clamp(14px, 1.7vw, 18px)', fontWeight: 700, touchAction: 'manipulation',
  };
}
const afterTipCard: React.CSSProperties = {
  margin: '22px auto 0', width: 'min(94vw, 500px)', background: '#fff', borderRadius: 20,
  padding: 'clamp(18px, 3vw, 28px)', border: '1px solid #eef2f7',
  boxShadow: '0 12px 40px rgba(15,23,42,0.08)', textAlign: 'center',
};

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

const fullCenter: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', padding: '4vw',
};
const page: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'linear-gradient(135deg, #f8fafc 0%, #eef2ff 100%)',
  display: 'flex', flexDirection: 'column', padding: '2.5vw',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', overflow: 'hidden',
};
const contentArea: React.CSSProperties = { flex: 1, minHeight: 0, width: '100%', overflowY: 'auto' };
const scrollInner: React.CSSProperties = { minHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0.5rem 0', boxSizing: 'border-box' };
const brandBar: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '2px 0 14px', flexShrink: 0 };
const centerBox: React.CSSProperties = { textAlign: 'center', maxWidth: 720, margin: '0 auto' };
// Order screen wrapper that fills the viewport height. Landscape → items and totals
// side by side; portrait → stacked with the item list taking the remaining space
// (scrolls internally) and the totals card pinned below, always fully visible.
function activeWrap(portrait: boolean): React.CSSProperties {
  return {
    display: 'flex', flexDirection: portrait ? 'column' : 'row',
    gap: portrait ? 'clamp(12px, 2vh, 22px)' : '3vw',
    width: '100%', maxWidth: 1280, alignSelf: 'center',
    flex: 1, minHeight: 0, boxSizing: 'border-box',
  };
}
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
  borderRadius: 14, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#1e293b', cursor: 'pointer', touchAction: 'manipulation',
};
