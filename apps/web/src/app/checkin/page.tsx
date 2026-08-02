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
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState, CSSProperties } from 'react';
import { apiFetch } from '../../lib/api';

const TOKEN_KEY = 'lumio_checkin_token';
const IDLE_RESET_MS = 90_000; // abandoned half-filled form clears itself

interface Service {
  id: string;
  name: string;
  priceCents: number;
  durationMinutes: number;
  category: { id: string; name: string } | null;
}
interface Menu {
  salonName: string;
  logoUrl: string | null;
  accentColor: string;
  services: Service[];
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

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
  const shown = useMemo(
    () => (menu?.services ?? []).filter((s) => !cat || s.category?.id === cat),
    [menu, cat],
  );
  const pickedList = useMemo(
    () => picked.map((id) => (menu?.services ?? []).find((s) => s.id === id)).filter(Boolean) as Service[],
    [picked, menu],
  );
  const totalCents = pickedList.reduce((sum, s) => sum + s.priceCents, 0);
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
      <main style={screen}>
        <div style={{ ...panel, maxWidth: 520, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📱</div>
          <h1 style={{ fontSize: 28, margin: '0 0 8px' }}>Connect this iPad</h1>
          <p style={{ color: '#94a3b8', fontSize: 17, lineHeight: 1.5, margin: '0 0 24px' }}>
            Enter the 6-character code from the salon dashboard.
          </p>
          <input
            value={pairInput}
            onChange={(e) => setPairInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') pair(); }}
            placeholder="ABC123"
            autoCapitalize="characters"
            autoCorrect="off"
            style={{ ...bigInput, textAlign: 'center', letterSpacing: 8, fontSize: 34, fontWeight: 800 }}
          />
          {pairErr && <div style={{ color: '#f87171', fontSize: 15, marginTop: 12 }}>{pairErr}</div>}
          <button onClick={pair} disabled={pairInput.trim().length < 4} style={{ ...primary(accent), marginTop: 18, width: '100%', opacity: pairInput.trim().length < 4 ? 0.5 : 1 }}>
            Connect
          </button>
        </div>
      </main>
    );
  }

  if (!menu) {
    return <main style={screen}><div style={{ color: '#94a3b8', fontSize: 20 }}>Loading…</div></main>;
  }

  // ---- Thank you ----------------------------------------------------------
  if (step === 4) {
    return (
      <main style={screen}>
        <div style={{ ...panel, maxWidth: 620, textAlign: 'center' }}>
          <div style={{ width: 108, height: 108, borderRadius: '50%', background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 56, margin: '0 auto 22px' }}>✓</div>
          <h1 style={{ fontSize: 38, margin: '0 0 10px' }}>You&rsquo;re checked in</h1>
          <p style={{ color: '#cbd5e1', fontSize: 20, lineHeight: 1.55, margin: 0 }}>
            Thank you, {form.firstName}. Please take a seat — we&rsquo;ll call you shortly.
          </p>
          <button onClick={reset} style={{ ...ghostBtn, marginTop: 30 }}>Check in someone else</button>
        </div>
      </main>
    );
  }

  const canNext = step === 1 ? form.firstName.trim().length > 0 : true;

  return (
    <main style={{ ...screen, alignItems: 'stretch', padding: 0, display: 'block' }}>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh', width: '100%' }}>
        {/* Header: who they are checking in with + how far along they are */}
        <header style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: 'clamp(12px, 3.5vw, 18px) clamp(14px, 4vw, 24px)',
          borderBottom: '1px solid #1e293b', flexShrink: 0,
          position: 'sticky', top: 0, background: '#0b1120', zIndex: 5,
          paddingTop: 'max(clamp(12px, 3.5vw, 18px), env(safe-area-inset-top))',
        }}>
          {menu.logoUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={menu.logoUrl} alt="" style={{ height: 40, width: 'auto', borderRadius: 8 }} />
            : <span style={{ width: 40, height: 40, borderRadius: 12, background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>✦</span>}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{menu.salonName}</div>
            <div style={{ fontSize: 14, color: '#94a3b8' }}>Welcome — check in below</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[1, 2, 3].map((n) => (
              <span key={n} style={{ width: 44, height: 6, borderRadius: 3, background: n <= step ? accent : '#1e293b' }} />
            ))}
          </div>
        </header>

        <div style={{ flex: 1, padding: 'clamp(16px, 4vw, 22px) clamp(14px, 4vw, 24px)' }}>
          {/* ---- Step 1: who ---- */}
          {step === 1 && (
            <>
              <h2 style={stepTitle}>Your details</h2>
              <p style={stepHint}>Only your first name is required. The rest lets us text your reminders and birthday treats.</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 14 }}>
                <Field label="First name" required>
                  <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} placeholder="Anna" style={bigInput} autoCapitalize="words" autoComplete="given-name" enterKeyHint="next" />
                </Field>
                <Field label="Last name">
                  <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} placeholder="Nguyen" style={bigInput} autoCapitalize="words" autoComplete="family-name" enterKeyHint="next" />
                </Field>
                <Field label="Mobile number">
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1 512 886 8189" style={bigInput} inputMode="tel" type="tel" autoComplete="tel" enterKeyHint="next" />
                </Field>
                <Field label="Email">
                  <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="anna@email.com" style={bigInput} inputMode="email" type="email" autoComplete="email" autoCapitalize="off" autoCorrect="off" enterKeyHint="next" />
                </Field>
                <Field label="Birthday">
                  <input type="date" max={new Date().toISOString().slice(0, 10)} value={form.birthDate} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} style={bigInput} autoComplete="bday" />
                </Field>
                <Field label="How many of you?">
                  <div style={{ display: 'flex', gap: 10 }}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} onClick={() => setForm({ ...form, partySize: n })}
                        style={{ ...pill, flex: 1, ...(form.partySize === n ? { background: accent, borderColor: accent, color: '#fff' } : null) }}>
                        {n}{n === 5 ? '+' : ''}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            </>
          )}

          {/* ---- Step 2: what ---- */}
          {step === 2 && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                <h2 style={{ ...stepTitle, margin: 0 }}>What would you like today?</h2>
                <span style={{
                  fontSize: 14.5, fontWeight: 800, borderRadius: 999, padding: '5px 12px',
                  background: picked.length ? accent : '#1e293b', color: picked.length ? '#fff' : '#94a3b8',
                }}>{picked.length} selected</span>
              </div>
              <p style={stepHint}>Tap everything you want — you can change it with us at the chair.</p>
              {pickedList.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                  {pickedList.map((s) => (
                    <button key={s.id} onClick={() => setPicked((v) => v.filter((x) => x !== s.id))}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(99,102,241,0.16)', border: `1px solid ${accent}`, color: '#c7d2fe', borderRadius: 999, padding: '8px 13px', fontSize: 14.5, fontWeight: 700, cursor: 'pointer' }}>
                      {s.name}<span style={{ fontSize: 16 }}>✕</span>
                    </button>
                  ))}
                </div>
              )}
              {cats.length > 0 && (
                <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 12, marginBottom: 4 }}>
                  <button onClick={() => setCat(null)} style={{ ...pill, ...(cat === null ? { background: accent, borderColor: accent, color: '#fff' } : null) }}>All</button>
                  {cats.map((c) => (
                    <button key={c.id} onClick={() => setCat(c.id)} style={{ ...pill, whiteSpace: 'nowrap', ...(cat === c.id ? { background: accent, borderColor: accent, color: '#fff' } : null) }}>{c.name}</button>
                  ))}
                </div>
              )}
              {/* Two columns on a phone, more as the screen grows — never a single
                  endless list the customer has to scroll past. */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(46%, 220px), 1fr))', gap: 'clamp(8px, 2.5vw, 14px)' }}>
                {shown.map((s) => {
                  const on = picked.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => setPicked((v) => (on ? v.filter((x) => x !== s.id) : [...v, s.id]))}
                      style={{
                        position: 'relative', textAlign: 'left', borderRadius: 16,
                        padding: 'clamp(12px, 3.4vw, 16px) clamp(13px, 3.6vw, 18px)', cursor: 'pointer',
                        background: on ? accent : '#111827',
                        border: `2px solid ${on ? accent : '#1e293b'}`,
                        boxShadow: on ? '0 8px 20px rgba(79,70,229,0.3)' : 'none',
                        color: '#e2e8f0', minHeight: 96, display: 'flex', flexDirection: 'column', gap: 7,
                      }}
                    >
                      {on && (
                        <span style={{
                          position: 'absolute', top: -10, right: -8, width: 30, height: 30, borderRadius: '50%',
                          background: '#22c55e', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 17, fontWeight: 900, border: '3px solid #0b1120',
                        }}>✓</span>
                      )}
                      <span style={{ fontSize: 'clamp(15px, 4vw, 18px)', fontWeight: 700, lineHeight: 1.25 }}>{s.name}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 'auto', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 'clamp(16px, 4.2vw, 19px)', fontWeight: 800, color: on ? '#fff' : '#22c55e' }}>{money(s.priceCents)}</span>
                        <span style={{ fontSize: 13.5, color: on ? 'rgba(255,255,255,0.78)' : '#94a3b8' }}>{s.durationMinutes} min</span>
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
              <h2 style={stepTitle}>Everything look right?</h2>
              <div style={{ ...panel, padding: 0, maxWidth: 640, margin: '0 0 18px' }}>
                <Row k="Name" v={`${form.firstName} ${form.lastName}`.trim()} />
                {form.phone && <Row k="Mobile" v={form.phone} />}
                {form.email && <Row k="Email" v={form.email} />}
                <Row k="People" v={String(form.partySize)} />
              </div>
              <div style={{ ...panel, padding: 0, maxWidth: 640 }}>
                {pickedList.length === 0 ? (
                  <div style={{ padding: 20, color: '#94a3b8', fontSize: 17 }}>No services picked — that&rsquo;s fine, we&rsquo;ll ask at the chair.</div>
                ) : (
                  <>
                    {pickedList.map((s) => (
                      <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', borderBottom: '1px solid #1e293b' }}>
                        <span style={{ flex: 1, fontSize: 18, fontWeight: 600 }}>{s.name}</span>
                        <span style={{ fontSize: 15, color: '#94a3b8' }}>{s.durationMinutes} min</span>
                        <span style={{ fontSize: 18, fontWeight: 700 }}>{money(s.priceCents)}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', background: '#0f172a' }}>
                      <span style={{ flex: 1, fontSize: 17, fontWeight: 700, color: '#94a3b8' }}>Estimate</span>
                      <span style={{ fontSize: 15, color: '#94a3b8' }}>{totalMins} min</span>
                      <span style={{ fontSize: 24, fontWeight: 800, color: '#22c55e' }}>{money(totalCents)}</span>
                    </div>
                  </>
                )}
              </div>
              <p style={{ color: '#64748b', fontSize: 14.5, marginTop: 14, maxWidth: 640 }}>
                Prices are a guide — your technician confirms the final price before starting.
              </p>
              {err && <div style={{ color: '#f87171', fontSize: 16, marginTop: 14 }}>{err}</div>}
            </>
          )}
        </div>

        {/* Sticky action bar: thumbs live at the bottom of a tablet */}
        <footer style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: 'clamp(12px, 3.5vw, 16px) clamp(14px, 4vw, 24px)',
          paddingBottom: 'max(clamp(12px, 3.5vw, 16px), env(safe-area-inset-bottom))',
          borderTop: '1px solid #1e293b', background: '#0f172a',
          position: 'sticky', bottom: 0, zIndex: 5,
        }}>
          {step > 1
            ? <button onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)} style={ghostBtn}>Back</button>
            : <span style={{ fontSize: 15, color: '#64748b' }}>Step {step} of 3</span>}
          {step === 2 && picked.length > 0 && (
            <span style={{ fontSize: 16, color: '#cbd5e1', fontWeight: 600 }}>
              {picked.length} selected · <span style={{ color: '#22c55e' }}>{money(totalCents)}</span>
            </span>
          )}
          <span style={{ flex: 1 }} />
          {step < 3 ? (
            <button onClick={() => setStep((s) => (s + 1) as 2 | 3)} disabled={!canNext} style={{ ...primary(accent), flex: '1 1 160px', opacity: canNext ? 1 : 0.45 }}>
              Continue
            </button>
          ) : (
            <button onClick={submit} disabled={busy} style={{ ...primary(accent), flex: '1 1 160px', opacity: busy ? 0.6 : 1 }}>
              {busy ? 'Checking you in…' : 'Check in'}
            </button>
          )}
        </footer>
      </div>
    </main>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, color: '#cbd5e1', marginBottom: 8, fontWeight: 600 }}>
        {label}
        {required && <span style={{ color: '#f87171' }}>*</span>}
      </span>
      {children}
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '14px 20px', borderBottom: '1px solid #1e293b' }}>
      <span style={{ color: '#94a3b8', fontSize: 16, width: 110 }}>{k}</span>
      <span style={{ fontSize: 17, fontWeight: 600 }}>{v}</span>
    </div>
  );
}

// No fixed height: on a phone the on-screen keyboard shrinks the viewport, and a
// locked 100dvh traps the focused field behind it. Let the page flow and keep the
// action bar sticky instead — that behaves on iOS, Android and a 27" monitor.
const screen: CSSProperties = {
  minHeight: '100dvh', background: '#0b1120', color: '#e2e8f0',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 'clamp(14px, 4vw, 24px)',
  WebkitTapHighlightColor: 'transparent',
};
const panel: CSSProperties = {
  background: '#111827', border: '1px solid #1e293b', borderRadius: 18, padding: 28, width: '100%',
};
// 16px is the floor: anything smaller makes iOS Safari zoom the page on focus.
const bigInput: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: 'clamp(14px, 4vw, 18px)', borderRadius: 14,
  border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0',
  fontSize: 'clamp(17px, 4.4vw, 20px)', colorScheme: 'dark', minHeight: 58,
};
const pill: CSSProperties = {
  border: '2px solid #1e293b', background: '#111827', color: '#cbd5e1',
  borderRadius: 999, padding: '14px 22px', fontSize: 17, fontWeight: 600, cursor: 'pointer', minHeight: 56,
};
const ghostBtn: CSSProperties = {
  border: '1px solid #334155', background: 'transparent', color: '#e2e8f0',
  borderRadius: 14, padding: '16px 26px', fontSize: 18, fontWeight: 600, cursor: 'pointer', minHeight: 60,
};
const primary = (accent: string): CSSProperties => ({
  border: 'none', background: accent, color: '#fff', borderRadius: 14,
  padding: '16px 34px', fontSize: 19, fontWeight: 700, cursor: 'pointer', minHeight: 60,
});
const stepTitle: CSSProperties = { fontSize: 'clamp(21px, 5.6vw, 28px)', fontWeight: 800, margin: '0 0 6px' };
const stepHint: CSSProperties = { fontSize: 'clamp(14.5px, 3.8vw, 16.5px)', color: '#94a3b8', margin: '0 0 18px', lineHeight: 1.5 };
