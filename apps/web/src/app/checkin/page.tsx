'use client';

// ---------------------------------------------------------------------------
// Self check-in kiosk — the iPad the customer touches at the door.
//
// Runs beside the front desk, not instead of it: whatever the customer taps
// lands in the same WAITING queue the receptionist types into, so either side
// can do the work and neither blocks the other. Nothing here can assign a tech
// or take money — the desk stays in control of the floor.
//
// Pairs once with the salon's 6-character display code (the same code the
// customer display uses), then talks to the backend with that token only.
//
// Designed for fingers on glass: 64px targets, no hover states, no tiny text,
// one decision per screen.
//
// LIGHT, ON PURPOSE. This is the one page a salon's CUSTOMER sees on their own
// phone, and it used to wear the dashboard's dark theme — a black form with
// green prices, which reads as "back office", not "welcome". It now has its
// own daylight palette (below), fixed, independent of the owner's theme
// toggle: white cards, the salon's accent, ink text. No `var(--c…)` tokens
// here — the customer never switches themes and the page must look the same
// on every phone.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState, CSSProperties } from 'react';
import { apiFetch } from '../../lib/api';
import { useHorizontalScroll } from '../../lib/useHorizontalScroll';

const TOKEN_KEY = 'lumio_checkin_token';
const IDLE_RESET_MS = 90_000; // abandoned half-filled form clears itself

interface Service {
  id: string;
  name: string;
  /** List price. */
  priceCents: number;
  /** The service's own discount, 0–90. Absent on an older server. */
  discountPercent?: number;
  /** Today's promotion for its category, 0–90. Absent on an older server. */
  promoPercent?: number;
  /** What the customer pays today — the SAME number the ticket will carry.
   *  Absent on an older server, in which case the list price stands. */
  netCents?: number;
  isFeatured?: boolean;
  durationMinutes: number;
  category: { id: string; name: string } | null;
}
interface Menu {
  salonName: string;
  logoUrl: string | null;
  accentColor: string;
  services: Service[];
  /** Today's best offer, for the band at the top. Null when none runs. */
  promo?: { percent: number; label: string | null; scope: 'all' | string } | null;
}
/** The two synthetic chips in front of the real categories. */
const SALE = '__sale';
const POPULAR = '__popular';
const payCents = (s: Service) => (typeof s.netCents === 'number' ? s.netCents : s.priceCents);
const offPct = (s: Service) => Math.min(90, Math.max(0, s.discountPercent ?? 0));
const dealPct = (s: Service) => Math.min(90, Math.max(0, s.promoPercent ?? 0));
const onSale = (s: Service) => payCents(s) < s.priceCents;

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** The customer page's own daylight palette. */
const C = {
  page: '#faf9f7',   // warm off-white: paper, not a spreadsheet
  card: '#ffffff',
  line: '#e7e3dd',
  ink: '#1c1917',
  ink2: '#44403c',
  muted: '#6f6a64',
  faint: '#a39d96',
  field: '#ffffff',
  price: '#15803d',
  bad: '#b91c1c',
  ok: '#16a34a',
};

export default function CheckInKiosk() {
  const [token, setToken] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [pairInput, setPairInput] = useState('');
  const [pairErr, setPairErr] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', email: '', birthDate: '', partySize: 1, note: '' });
  const [picked, setPicked] = useState<string[]>([]);
  const [cat, setCat] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Restore a previous pairing so the iPad comes back up ready after a reboot.
  // A phone arriving from the salon's QR carries ?c=CODE and pairs itself — the
  // customer never sees a code screen. Nothing is stored on a phone: one visit,
  // one session (the URL param is enough to get going).
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(TOKEN_KEY); } catch { /* private mode */ }
    const code = new URLSearchParams(window.location.search).get('c');
    if (code) {
      apiFetch<{ token: string }>('/display/pair', { method: 'POST', body: { pairCode: code.toUpperCase() } })
        .then((r) => setToken(r.token))
        .catch(() => setToken(saved));
      return;
    }
    setToken(saved);
  }, []);

  const loadMenu = useCallback(async (tk: string) => {
    try {
      setMenu(await apiFetch<Menu>(`/display/checkin-menu/${tk}`));
    } catch {
      // The salon rotated its code — drop the stale token and ask to pair again.
      try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
      setToken(null);
    }
  }, []);

  useEffect(() => { if (token) loadMenu(token); }, [token, loadMenu]);

  const reset = useCallback(() => {
    setForm({ firstName: '', lastName: '', phone: '', email: '', birthDate: '', partySize: 1, note: '' });
    setPicked([]); setCat(null); setErr(null); setStep(1);
  }, []);

  // Someone walks away mid-form; the next customer should meet a clean screen.
  useEffect(() => {
    if (step === 1 && !form.firstName) return;
    const id = window.setTimeout(() => { if (step !== 4) reset(); }, IDLE_RESET_MS);
    return () => window.clearTimeout(id);
  }, [step, form, picked, reset]);

  const accent = menu?.accentColor || '#6366f1';
  const cats = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of menu?.services ?? []) if (s.category) seen.set(s.category.id, s.category.name);
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [menu]);
  const hasSale = useMemo(() => (menu?.services ?? []).some(onSale), [menu]);
  const hasPopular = useMemo(() => (menu?.services ?? []).some((s) => s.isFeatured), [menu]);
  const shown = useMemo(
    () => (menu?.services ?? []).filter((s) =>
      !cat ? true
        : cat === SALE ? onSale(s)
          : cat === POPULAR ? !!s.isFeatured
            : s.category?.id === cat),
    [menu, cat],
  );
  // The chip row: wheel scrolls it, arrows appear on a computer when it overflows.
  const chips = useHorizontalScroll<HTMLDivElement>();
  const pickedList = useMemo(
    () => picked.map((id) => (menu?.services ?? []).find((s) => s.id === id)).filter(Boolean) as Service[],
    [picked, menu],
  );
  // What she pays and what she would have paid: the difference is the line
  // that makes the offer real to her, and it is the number the ticket carries.
  const totalCents = pickedList.reduce((sum, s) => sum + payCents(s), 0);
  const fullCents = pickedList.reduce((sum, s) => sum + s.priceCents, 0);
  const savedCents = Math.max(0, fullCents - totalCents);
  const totalMins = pickedList.reduce((sum, s) => sum + s.durationMinutes, 0);

  async function pair() {
    const code = pairInput.trim().toUpperCase();
    if (code.length < 4) return;
    setPairErr(null);
    try {
      const r = await apiFetch<{ token: string }>('/display/pair', { method: 'POST', body: { pairCode: code } });
      try { localStorage.setItem(TOKEN_KEY, r.token); } catch { /* ignore */ }
      setToken(r.token); setPairInput('');
    } catch {
      setPairErr('That code did not work. Ask the front desk for a new one.');
    }
  }

  async function submit() {
    if (!token || busy) return;
    setBusy(true); setErr(null);
    try {
      await apiFetch(`/display/checkin/${token}`, {
        method: 'POST',
        body: {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim() || undefined,
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          birthDate: form.birthDate || undefined,
          partySize: form.partySize,
          note: form.note.trim() || undefined,
          serviceIds: picked,
        },
      });
      setStep(4);
      window.setTimeout(reset, 7000); // thank-you screen, then ready for the next person
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong. Please ask the front desk.');
    } finally {
      setBusy(false);
    }
  }

  // ---- Pairing ------------------------------------------------------------
  if (!token) {
    return (
      <main style={{ ...screen, ...accentVar(accent) }}>
        <style>{baseCss}</style>
        <div style={{ ...panel, maxWidth: 520, textAlign: 'center', padding: 'clamp(28px, 6vw, 44px)' }}>
          <Monogram accent={accent} size={72} />
          <h1 style={{ ...serifTitle, fontSize: 32, margin: '18px 0 8px' }}>Connect this iPad</h1>
          <p style={{ color: C.muted, fontSize: 17, lineHeight: 1.55, margin: '0 0 26px' }}>
            Enter the 6-character shop code from the salon dashboard. You only do this once.
          </p>
          <input
            value={pairInput}
            onChange={(e) => setPairInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') pair(); }}
            placeholder="ABC123"
            autoCapitalize="characters"
            autoCorrect="off"
            style={{ ...bigInput, textAlign: 'center', letterSpacing: 10, fontSize: 34, fontWeight: 700, minHeight: 72 }}
          />
          {pairErr && <div style={{ color: C.bad, fontSize: 15, marginTop: 12 }}>{pairErr}</div>}
          <button onClick={pair} disabled={pairInput.trim().length < 4} style={{ ...primary(accent), marginTop: 18, width: '100%', opacity: pairInput.trim().length < 4 ? 0.5 : 1 }}>
            Connect
          </button>
        </div>
      </main>
    );
  }

  if (!menu) {
    return <main style={screen}><div style={{ color: C.muted, fontSize: 20 }}>Loading…</div></main>;
  }

  // ---- Thank you ----------------------------------------------------------
  if (step === 4) {
    return (
      <main style={{ ...screen, ...accentVar(accent), background: accent, backgroundImage: wash(accent), color: '#fff' }}>
        <style>{baseCss}</style>
        <div style={{ ...panel, maxWidth: 640, textAlign: 'center', padding: 'clamp(32px, 7vw, 56px) clamp(24px, 6vw, 48px)', border: 'none' }}>
          <div style={{ width: 96, height: 96, borderRadius: '50%', background: accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', boxShadow: `0 18px 40px ${accent}55` }}>
            <svg width={46} height={46} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
          </div>
          <div style={eyebrow}>You&rsquo;re checked in</div>
          <h1 style={{ ...serifTitle, fontSize: 'clamp(30px, 7vw, 42px)', margin: '8px 0 12px' }}>Thank you, {form.firstName}.</h1>
          <p style={{ color: C.ink2, fontSize: 'clamp(17px, 4.6vw, 20px)', lineHeight: 1.55, margin: 0 }}>
            Please have a seat — we&rsquo;ll be with you shortly.
          </p>
          <button onClick={reset} style={{ ...ghostBtn, marginTop: 32 }}>Check in someone else</button>
        </div>
      </main>
    );
  }

  const canNext = step === 1 ? form.firstName.trim().length > 0 : true;
  const STEPS = ['Your details', 'Services', 'Confirm'];

  return (
    <main className="ck-page" style={{ ...screen, ...accentVar(accent), alignItems: 'stretch', padding: 0, display: 'block' }}>
      <style>{baseCss + layoutCss}</style>
      <div className="ck-shell">
        {/* The welcome panel — the salon's name said properly, in its own colour,
            and the three steps in words. On a phone it folds into a band. */}
        <aside className="ck-side" style={{ background: accent, backgroundImage: wash(accent), color: '#fff' }}>
          <div>
            {menu.logoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={menu.logoUrl} alt="" style={{ height: 64, width: 'auto', maxWidth: 200, borderRadius: 12, background: 'rgba(255,255,255,0.92)', padding: 6 }} />
              : <Monogram accent={accent} size={64} inverted />}
            <div style={{ ...eyebrow, color: 'rgba(255,255,255,0.72)', marginTop: 28 }}>Welcome to</div>
            <div style={{ ...serifTitle, color: '#fff', fontSize: 'clamp(30px, 3.2vw, 40px)', lineHeight: 1.12, marginTop: 6 }}>{menu.salonName}</div>
            <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 16.5, lineHeight: 1.55, margin: '14px 0 0', maxWidth: 300 }}>
              Check in here and we&rsquo;ll call you when your technician is ready.
            </p>
          </div>

          <ol style={{ listStyle: 'none', padding: 0, margin: '36px 0', display: 'flex', flexDirection: 'column', gap: 18 }}>
            {STEPS.map((name, i) => {
              const n = (i + 1) as 1 | 2 | 3;
              const done = n < step; const now = n === step;
              return (
                <li key={name} style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: done || now ? 1 : 0.55 }}>
                  <span style={{
                    width: 36, height: 36, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 15, fontWeight: 700, background: now ? '#fff' : 'rgba(255,255,255,0.18)', color: now ? accent : '#fff',
                    border: `1.5px solid ${now ? '#fff' : 'rgba(255,255,255,0.45)'}`,
                  }}>{done ? '✓' : n}</span>
                  <span style={{ fontSize: 17, fontWeight: now ? 700 : 500 }}>{name}</span>
                </li>
              );
            })}
          </ol>

          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {menu.promo && menu.promo.percent > 0 && (
              <div style={{ background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.28)', borderRadius: 18, padding: '14px 16px', backdropFilter: 'blur(6px)' }}>
                <div style={{ ...eyebrow, color: 'rgba(255,255,255,0.72)' }}>Today&rsquo;s offer</div>
                <div style={{ fontSize: 19, fontWeight: 700, marginTop: 4 }}>
                  {menu.promo.percent}% off {menu.promo.scope === 'all' ? 'every service' : menu.promo.scope.toLowerCase()}{menu.promo.label ? ` · ${menu.promo.label}` : ''}
                </div>
                <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.78)', marginTop: 3 }}>Applied automatically when you check in.</div>
              </div>
            )}
            <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.7)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <LockIcon /> Your details are seen only by the salon.
            </div>
          </div>
        </aside>

        <section className="ck-main">
          {/* Phone band: the same identity and progress, folded to one strip. */}
          <header className="ck-top" style={{ background: accent, backgroundImage: wash(accent), color: '#fff' }}>
            {menu.logoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={menu.logoUrl} alt="" style={{ height: 40, width: 'auto', borderRadius: 10, background: 'rgba(255,255,255,0.92)', padding: 3 }} />
              : <Monogram accent={accent} size={40} inverted />}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ ...serifTitle, color: '#fff', fontSize: 20, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{menu.salonName}</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.78)' }}>Step {step} of 3 · {STEPS[step - 1]}</div>
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
              {[1, 2, 3].map((n) => (
                <span key={n} style={{ width: n === step ? 22 : 8, height: 8, borderRadius: 4, background: n <= step ? '#fff' : 'rgba(255,255,255,0.35)', transition: 'width .2s ease' }} />
              ))}
            </div>
          </header>

          <div className="ck-body">
            {/* ---- Step 1: who ---- */}
            {step === 1 && (
              <>
                <div className="ck-eyebrow" style={eyebrow}>Step 1 of 3</div>
                <h2 style={stepTitle}>Tell us who you are</h2>
                <p style={stepHint}>Only your first name is required. A mobile number lets us text you when it&rsquo;s your turn.</p>
                <div className="ck-grid">
                  <Field label="First name" required>
                    <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} placeholder="Anna" style={bigInput} autoCapitalize="words" autoComplete="given-name" enterKeyHint="next" />
                  </Field>
                  <Field label="Last name">
                    <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} placeholder="Nguyen" style={bigInput} autoCapitalize="words" autoComplete="family-name" enterKeyHint="next" />
                  </Field>
                  <Field label="Mobile number">
                    <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 512 886 8189" style={bigInput} inputMode="tel" type="tel" autoComplete="tel" enterKeyHint="next" />
                  </Field>
                  <Field label="Email" hint="optional">
                    <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="anna@email.com" style={bigInput} inputMode="email" type="email" autoComplete="email" autoCapitalize="off" autoCorrect="off" enterKeyHint="next" />
                  </Field>
                  <Field label="Birthday" hint="for a birthday treat">
                    <input type="date" max={new Date().toISOString().slice(0, 10)} value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} style={bigInput} autoComplete="bday" />
                  </Field>
                  <Field label="How many of you?">
                    <div style={{ display: 'flex', background: C.card, border: `1.5px solid ${C.line}`, borderRadius: 16, padding: 4, gap: 4 }}>
                      {[1, 2, 3, 4, 5].map((n) => {
                        const on = form.partySize === n;
                        return (
                          <button key={n} onClick={() => setForm({ ...form, partySize: n })}
                            style={{ flex: 1, minHeight: 50, borderRadius: 12, border: 'none', cursor: 'pointer', fontSize: 17, fontWeight: 700, background: on ? accent : 'transparent', color: on ? '#fff' : C.ink2, boxShadow: on ? `0 6px 14px ${accent}44` : 'none' }}>
                            {n}{n === 5 ? '+' : ''}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                </div>
              </>
            )}

            {/* ---- Step 2: what ---- */}
            {step === 2 && (
              <>
                <div className="ck-eyebrow" style={eyebrow}>Step 2 of 3</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                  <h2 style={stepTitle}>What would you like today?</h2>
                  {picked.length > 0 && (
                    <span style={{ fontSize: 14, fontWeight: 700, borderRadius: 999, padding: '5px 12px', background: accent, color: '#fff' }}>{picked.length} selected</span>
                  )}
                </div>
                <p style={stepHint}>Tap everything you&rsquo;d like — you can still change it at the chair.</p>
                {menu.promo && menu.promo.percent > 0 && (
                  // On a phone the welcome panel is folded away, so the offer is said here.
                  <div className="ck-promo-m" style={{ display: 'flex', alignItems: 'center', gap: 10, background: `${accent}10`, border: `1px solid ${accent}40`, borderRadius: 14, padding: '10px 13px', marginBottom: 14 }}>
                    <TagIcon color={accent} size={20} />
                    <div style={{ fontSize: 14.5, color: C.ink2, lineHeight: 1.4 }}><b style={{ color: accent }}>{menu.promo.percent}% off today</b> — applied automatically; prices below already show it.</div>
                  </div>
                )}
                {pickedList.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                    {pickedList.map((s) => (
                      <button key={s.id} onClick={() => setPicked((v) => v.filter((x) => x !== s.id))}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: `${accent}14`, border: `1px solid ${accent}`, color: accent, borderRadius: 999, padding: '8px 13px', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' }}>
                        {s.name}<span style={{ fontSize: 16 }}>✕</span>
                      </button>
                    ))}
                  </div>
                )}
                {(cats.length > 0 || hasSale || hasPopular) && (
                  // One row that scrolls sideways; arrows appear on a computer.
                  <div style={{ position: 'relative', marginLeft: -16, marginRight: -16, marginBottom: 4 }}>
                    {chips.canLeft && <ChipArrow dir={-1} onClick={() => chips.nudge(-1)} />}
                    <div ref={chips.ref} className="ck-chips" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 12, paddingLeft: 16, paddingRight: 16, scrollbarWidth: 'none' }}>
                      <button onClick={() => setCat(null)} style={{ ...chip, ...(cat === null ? { background: accent, borderColor: accent, color: '#fff' } : null) }}>All</button>
                      {hasSale && (
                        <button onClick={() => setCat(SALE)} style={{ ...chip, display: 'inline-flex', alignItems: 'center', gap: 6, ...(cat === SALE ? { background: accent, borderColor: accent, color: '#fff' } : { borderColor: `${accent}66`, color: accent }) }}>
                          <TagIcon color="currentColor" size={16} />On sale
                        </button>
                      )}
                      {hasPopular && (
                        <button onClick={() => setCat(POPULAR)} style={{ ...chip, display: 'inline-flex', alignItems: 'center', gap: 6, ...(cat === POPULAR ? { background: accent, borderColor: accent, color: '#fff' } : null) }}>
                          <StarIcon size={16} />Popular
                        </button>
                      )}
                      {cats.map((c) => (
                        <button key={c.id} onClick={() => setCat(c.id)} style={{ ...chip, ...(cat === c.id ? { background: accent, borderColor: accent, color: '#fff' } : null) }}>{c.name}</button>
                      ))}
                    </div>
                    {chips.canRight && <ChipArrow dir={1} onClick={() => chips.nudge(1)} />}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(46%, 230px), 1fr))', gap: 'clamp(10px, 2.5vw, 14px)' }}>
                  {shown.map((s) => {
                    const on = picked.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() => setPicked((v) => (on ? v.filter((x) => x !== s.id) : [...v, s.id]))}
                        style={{
                          position: 'relative', textAlign: 'left', borderRadius: 20,
                          padding: 'clamp(14px, 3.4vw, 18px) clamp(14px, 3.6vw, 20px)', cursor: 'pointer',
                          background: on ? `${accent}0f` : C.card,
                          border: `1.5px solid ${on ? accent : C.line}`,
                          boxShadow: on ? `0 10px 24px ${accent}2e` : '0 1px 3px rgba(23,20,18,0.05)',
                          color: C.ink, minHeight: 112, display: 'flex', flexDirection: 'column', gap: 8,
                          transition: 'box-shadow .15s ease, border-color .15s ease',
                        }}
                      >
                        <span style={{
                          position: 'absolute', top: 12, right: 12, width: 26, height: 26, borderRadius: '50%',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: on ? accent : 'transparent', color: '#fff', border: `1.5px solid ${on ? accent : C.line}`,
                        }}>{on && <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>}</span>
                        {offPct(s) > 0 ? (
                          <span style={{ ...badge, background: `${accent}14`, color: accent }}>−{offPct(s)}% for you</span>
                        ) : dealPct(s) > 0 ? (
                          <span style={{ ...badge, background: `${accent}14`, color: accent }}>Today −{dealPct(s)}%</span>
                        ) : s.isFeatured ? (
                          <span style={{ ...badge, background: '#fdf3e0', color: '#8a5a12' }}>★ Popular</span>
                        ) : <span style={{ height: 20 }} />}
                        <span style={{ fontSize: 'clamp(16px, 4vw, 18.5px)', fontWeight: 600, lineHeight: 1.25, paddingRight: 28 }}>{s.name}</span>
                        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 'clamp(17px, 4.2vw, 20px)', fontWeight: 700, color: C.ink }}>{money(payCents(s))}</span>
                          {onSale(s) && <span style={{ fontSize: 13.5, color: C.faint, textDecoration: 'line-through' }}>{money(s.priceCents)}</span>}
                          <span style={{ fontSize: 13.5, color: C.muted }}>· {s.durationMinutes} min</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* ---- Step 3: confirm ---- */}
            {step === 3 && (
              <>
                <div className="ck-eyebrow" style={eyebrow}>Step 3 of 3</div>
                <h2 style={stepTitle}>Does everything look right?</h2>
                <p style={stepHint}>Prices are a guide — your technician confirms the final price before starting.</p>
                <div className="ck-grid" style={{ alignItems: 'start' }}>
                  <div style={{ ...panel, padding: 0 }}>
                    <div style={cardHead}>Your details</div>
                    <Row k="Name" v={`${form.firstName} ${form.lastName}`.trim()} />
                    {form.phone && <Row k="Mobile" v={form.phone} />}
                    {form.email && <Row k="Email" v={form.email} />}
                    <Row k="People" v={String(form.partySize)} last />
                  </div>
                  <div style={{ ...panel, padding: 0 }}>
                    <div style={cardHead}>Your services</div>
                    {pickedList.length === 0 ? (
                      <div style={{ padding: 20, color: C.muted, fontSize: 17 }}>No services picked — that&rsquo;s fine, we&rsquo;ll ask at the chair.</div>
                    ) : (
                      <>
                        {pickedList.map((s) => (
                          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 20px', borderBottom: `1px solid ${C.line}` }}>
                            <span style={{ flex: 1, fontSize: 17, fontWeight: 600, color: C.ink }}>{s.name}<span style={{ display: 'block', fontSize: 13.5, fontWeight: 500, color: C.muted }}>{s.durationMinutes} min</span></span>
                            {/* The line shows what she pays today — the same number the
                                estimate adds up, so the sheet never disagrees with itself. */}
                            {onSale(s) && <span style={{ fontSize: 14, color: C.faint, textDecoration: 'line-through' }}>{money(s.priceCents)}</span>}
                            <span style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{money(payCents(s))}</span>
                          </div>
                        ))}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', background: C.page }}>
                          <span style={{ flex: 1 }}>
                            <span style={{ display: 'block', fontSize: 15, fontWeight: 600, color: C.muted }}>Estimate · {totalMins} min</span>
                            {savedCents > 0 && <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: C.price }}>You save {money(savedCents)} today</span>}
                          </span>
                          <span style={{ ...serifTitle, fontSize: 30, color: C.ink }}>{money(totalCents)}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                {err && <div style={{ color: C.bad, fontSize: 16, marginTop: 14 }}>{err}</div>}
              </>
            )}
          </div>

          {/* Sticky action bar: thumbs live at the bottom of a tablet */}
          <footer className="ck-foot">
            {step > 1
              ? <button onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)} style={ghostBtn}>Back</button>
              : <span className="ck-lock" style={{ fontSize: 14, color: C.muted, display: 'flex', alignItems: 'center', gap: 7 }}><LockIcon /> Seen only by the salon</span>}
            {step === 2 && picked.length > 0 && (
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: 16, color: C.ink2, fontWeight: 600 }}>
                <span>
                  {picked.length} selected ·{' '}
                  {savedCents > 0 && <span style={{ color: C.faint, textDecoration: 'line-through', fontWeight: 500, marginRight: 6 }}>{money(fullCents)}</span>}
                  <span style={{ color: C.ink }}>{money(totalCents)}</span>
                </span>
                {savedCents > 0 && <span style={{ fontSize: 13, color: C.price, fontWeight: 600 }}>You save {money(savedCents)} today</span>}
              </span>
            )}
            <span style={{ flex: 1 }} />
            {step < 3 ? (
              <button onClick={() => setStep((s) => (s + 1) as 2 | 3)} disabled={!canNext} style={{ ...primary(accent), flex: '1 1 180px', maxWidth: 320, opacity: canNext ? 1 : 0.45 }}>
                Continue →
              </button>
            ) : (
              <button onClick={submit} disabled={busy} style={{ ...primary(accent), flex: '1 1 180px', maxWidth: 320, opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Checking you in…' : 'Check in'}
              </button>
            )}
          </footer>
        </section>
      </div>
    </main>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 14.5, color: C.ink2, marginBottom: 8, fontWeight: 600 }}>
        {label}
        {required && <span style={{ color: C.bad }}>*</span>}
        {hint && <span style={{ fontWeight: 500, color: C.faint, fontSize: 13 }}>· {hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Row({ k, v, last }: { k: string; v: string; last?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '14px 20px', borderBottom: last ? 'none' : `1px solid ${C.line}` }}>
      <span style={{ color: C.muted, fontSize: 15, width: 90, flexShrink: 0 }}>{k}</span>
      <span style={{ fontSize: 16.5, fontWeight: 600, color: C.ink, minWidth: 0, overflowWrap: 'anywhere' }}>{v}</span>
    </div>
  );
}

/** The salon's mark when it has no logo: its initial in its own colour. */
function Monogram({ accent, size, inverted }: { accent: string; size: number; inverted?: boolean }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: inverted ? 'rgba(255,255,255,0.16)' : `${accent}14`, border: `1.5px solid ${inverted ? 'rgba(255,255,255,0.4)' : `${accent}55`}`,
      color: inverted ? '#fff' : accent, fontSize: size * 0.42,
    }}>✦</span>
  );
}

function LockIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

// ---- styles ------------------------------------------------------------------

/** The salon's accent as a CSS variable, so the stylesheet can use it for focus rings. */
const accentVar = (accent: string): CSSProperties => ({ '--ck-accent': accent } as unknown as CSSProperties);
/** A quiet depth on the accent: a highlight top-left, a shade bottom-right. */
const wash = (accent: string) => `radial-gradient(120% 90% at 10% 0%, rgba(255,255,255,0.22), rgba(255,255,255,0) 55%), linear-gradient(165deg, ${accent} 0%, ${accent} 45%, rgba(20,12,24,0.28) 140%)`;

const SERIF = '"Baskerville", "Libre Baskerville", "Didot", "Iowan Old Style", Georgia, "Times New Roman", serif';

const baseCss = `html,body{background:${C.page}}
.ck-page input::placeholder{color:#a8a29e}
.ck-page input:focus{outline:none;border-color:var(--ck-accent)!important;box-shadow:0 0 0 4px color-mix(in srgb, var(--ck-accent) 18%, transparent)}
.ck-page input[type=date]{-webkit-appearance:none;min-height:60px}
.ck-page button{font-family:inherit}`;
const layoutCss = `
.ck-chips::-webkit-scrollbar{display:none}
.ck-arrow{display:none} @media (hover:hover) and (pointer:fine){.ck-arrow{display:flex}}
.ck-shell{display:flex;min-height:100dvh;width:100%}
.ck-side{display:none}
.ck-main{flex:1;min-width:0;display:flex;flex-direction:column;min-height:100dvh}
.ck-top{display:flex;align-items:center;gap:12px;padding:calc(12px + env(safe-area-inset-top,0px)) 16px 12px;position:sticky;top:0;z-index:5}
.ck-body{flex:1;padding:clamp(18px,4vw,28px) clamp(16px,4vw,40px) 24px;max-width:980px;width:100%;box-sizing:border-box}
.ck-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px 18px}
.ck-foot{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 16px;padding-bottom:max(14px,env(safe-area-inset-bottom));border-top:1px solid ${C.line};background:rgba(250,249,247,0.92);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);position:sticky;bottom:0;z-index:5}
@media (min-width: 900px){
  .ck-side{display:flex;flex-direction:column;width:36%;max-width:400px;padding:44px 40px 32px;box-sizing:border-box;position:sticky;top:0;height:100dvh;flex-shrink:0}
  .ck-top{display:none}
  .ck-body{padding:44px 48px 32px}
  .ck-foot{padding:16px 48px;padding-bottom:max(16px,env(safe-area-inset-bottom))}
}
@media (min-width: 900px){ .ck-lock{display:none!important} .ck-promo-m{display:none!important} }
@media (max-width: 899px){ .ck-eyebrow{display:none} }`;

// No fixed height: on a phone the on-screen keyboard shrinks the viewport, and a
// locked 100dvh traps the focused field behind it. Let the page flow and keep the
// action bar sticky instead — that behaves on iOS, Android and a 27" monitor.
const screen: CSSProperties = {
  minHeight: '100dvh', background: C.page, color: C.ink,
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 'clamp(14px, 4vw, 24px)',
  WebkitTapHighlightColor: 'transparent', colorScheme: 'light',
};
const panel: CSSProperties = {
  background: C.card, border: `1px solid ${C.line}`, borderRadius: 22, padding: 28, width: '100%',
  boxShadow: '0 10px 40px rgba(23,20,18,0.07)', overflow: 'hidden', boxSizing: 'border-box',
};
const cardHead: CSSProperties = { padding: '14px 20px 10px', fontSize: 12.5, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted, borderBottom: `1px solid ${C.line}` };
// 16px is the floor: anything smaller makes iOS Safari zoom the page on focus.
const bigInput: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '0 18px', borderRadius: 16,
  border: `1.5px solid ${C.line}`, background: C.field, color: C.ink,
  fontSize: 'clamp(17px, 4.4vw, 19px)', minHeight: 60, fontFamily: 'inherit',
};
const pill: CSSProperties = {
  border: `1.5px solid ${C.line}`, background: C.card, color: C.ink2,
  borderRadius: 999, padding: '14px 22px', fontSize: 17, fontWeight: 600, cursor: 'pointer', minHeight: 54,
};
const badge: CSSProperties = { alignSelf: 'flex-start', borderRadius: 999, padding: '3px 9px', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.02em' };
function TagIcon({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" /><circle cx="7.5" cy="7.5" r="1.5" />
    </svg>
  );
}
function StarIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#e0a526" stroke="#e0a526" strokeWidth={1.5} strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden>
      <path d="m12 2 3 6.6 7.2.8-5.3 5 1.4 7.1L12 18l-6.3 3.5 1.4-7.1-5.3-5 7.2-.8Z" />
    </svg>
  );
}
/** The desktop-only nudge at either end of the chip row. Hidden on a phone,
 *  where the row is swiped and a floating button would sit over the last chip. */
function ChipArrow({ dir, onClick }: { dir: -1 | 1; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ck-arrow" aria-label={dir < 0 ? 'Scroll categories left' : 'Scroll categories right'}
      style={{
        position: 'absolute', top: 2, [dir < 0 ? 'left' : 'right']: 6, zIndex: 2,
        // `display` deliberately NOT set here: the stylesheet decides it, so
        // an inline value cannot out-rank the hover-capable media query
        // that hides these on a phone.
        width: 40, height: 40, borderRadius: '50%', border: `1.5px solid ${C.line}`, background: C.card, color: C.ink2,
        alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(23,20,18,0.12)',
      }}>
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={dir < 0 ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
      </svg>
    </button>
  );
}

/** A category chip: one line, never squeezed, never wrapped. */
const chip: CSSProperties = {
  ...pill, padding: '10px 18px', minHeight: 44, fontSize: 15.5, whiteSpace: 'nowrap', flexShrink: 0,
};
const ghostBtn: CSSProperties = {
  border: `1.5px solid ${C.line}`, background: C.card, color: C.ink,
  borderRadius: 999, padding: '16px 28px', fontSize: 17, fontWeight: 600, cursor: 'pointer', minHeight: 58,
};
const primary = (accent: string): CSSProperties => ({
  border: 'none', background: accent, color: '#fff', borderRadius: 999,
  padding: '16px 36px', fontSize: 18.5, fontWeight: 700, cursor: 'pointer', minHeight: 60, letterSpacing: '0.01em',
  boxShadow: `0 10px 24px ${accent}40`,
});
const serifTitle: CSSProperties = { fontFamily: SERIF, fontWeight: 600, color: C.ink, letterSpacing: '-0.01em', lineHeight: 1.15 };
const eyebrow: CSSProperties = { fontSize: 12.5, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.faint };
const stepTitle: CSSProperties = { ...serifTitle, fontSize: 'clamp(26px, 5.6vw, 36px)', margin: '6px 0 8px' };
const stepHint: CSSProperties = { fontSize: 'clamp(15px, 3.8vw, 17px)', color: C.muted, margin: '0 0 22px', lineHeight: 1.5 };
