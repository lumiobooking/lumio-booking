'use client';

// ---------------------------------------------------------------------------
// Counter customer screen for walk-in check-in (second monitor at reception).
//
// Unlike /checkin (a wireless iPad that pairs with a code), this window lives in
// the SAME browser as the front desk and talks over BroadcastChannel — so it is
// always connected, needs no login, no pairing, no network. The receptionist
// opens it once onto the second monitor and leaves it there.
//
// It never talks to the API. The desk window owns the session and does the
// saving; this screen only shows what is being typed and sends back what the
// customer touches. Both screens stay in step, either side can lead.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState, CSSProperties } from 'react';

const CHANNEL = 'lumio-checkin-display';

interface Service { id: string; name: string; priceCents: number; durationMinutes: number; category: { id: string; name: string } | null }
interface Form { firstName: string; lastName: string; phone: string; email: string; birthDate: string; partySize: number }
type Mode = 'idle' | 'form' | 'thanks';

interface DeskState {
  mode: Mode;
  salonName: string;
  accent: string;
  services: Service[];
  form: Form;
  picked: string[];
}

const BLANK: Form = { firstName: '', lastName: '', phone: '', email: '', birthDate: '', partySize: 1 };
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export default function CheckInDisplay() {
  const [st, setSt] = useState<DeskState>({ mode: 'idle', salonName: '', accent: '#6366f1', services: [], form: BLANK, picked: [] });
  const [cat, setCat] = useState<string | null>(null);
  const chRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return;
    const ch = new BroadcastChannel(CHANNEL);
    chRef.current = ch;
    ch.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type: string; state?: DeskState };
      if (msg?.type === 'state' && msg.state) {
        setSt(msg.state);
        if (msg.state.mode !== 'form') setCat(null);
      }
    };
    // Announce ourselves so the desk pushes the current state immediately.
    ch.postMessage({ type: 'hello' });
    return () => { ch.close(); chRef.current = null; };
  }, []);

  const send = useCallback((type: string, payload?: unknown) => {
    chRef.current?.postMessage({ type, payload });
  }, []);

  const patch = (p: Partial<Form>) => {
    setSt((s) => ({ ...s, form: { ...s.form, ...p } }));
    send('form', p);
  };
  const toggle = (id: string) => {
    setSt((s) => ({ ...s, picked: s.picked.includes(id) ? s.picked.filter((x) => x !== id) : [...s.picked, id] }));
    send('toggleService', id);
  };

  const accent = st.accent || '#6366f1';
  const cats = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of st.services) if (s.category) seen.set(s.category.id, s.category.name);
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [st.services]);
  const shown = useMemo(() => st.services.filter((s) => !cat || s.category?.id === cat), [st.services, cat]);
  const pickedList = useMemo(
    () => st.picked.map((id) => st.services.find((s) => s.id === id)).filter(Boolean) as Service[],
    [st.picked, st.services],
  );
  const total = pickedList.reduce((s, x) => s + x.priceCents, 0);
  const mins = pickedList.reduce((s, x) => s + x.durationMinutes, 0);

  // ---- Waiting for the desk ------------------------------------------------
  if (st.mode === 'idle') {
    return (
      <main style={screen}>
        <div style={{ textAlign: 'center', maxWidth: 640 }}>
          <div style={{ width: 96, height: 96, borderRadius: 28, background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 46, margin: '0 auto 26px' }}>✦</div>
          <h1 style={{ fontSize: 42, margin: '0 0 12px', fontWeight: 800 }}>{st.salonName || 'Welcome'}</h1>
          <p style={{ fontSize: 21, color: '#94a3b8', lineHeight: 1.55, margin: 0 }}>
            Please see the front desk to get started.
          </p>
        </div>
      </main>
    );
  }

  // ---- Done ---------------------------------------------------------------
  if (st.mode === 'thanks') {
    return (
      <main style={screen}>
        <div style={{ textAlign: 'center', maxWidth: 640 }}>
          <div style={{ width: 112, height: 112, borderRadius: '50%', background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 58, margin: '0 auto 24px' }}>✓</div>
          <h1 style={{ fontSize: 40, margin: '0 0 12px', fontWeight: 800 }}>You&rsquo;re checked in</h1>
          <p style={{ fontSize: 21, color: '#cbd5e1', margin: 0 }}>
            {st.form.firstName ? `Thank you, ${st.form.firstName}. ` : ''}Please take a seat — we&rsquo;ll call you shortly.
          </p>
        </div>
      </main>
    );
  }

  // ---- Live form ----------------------------------------------------------
  return (
    <main style={{ ...screen, alignItems: 'stretch', padding: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 28px', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
          <span style={{ width: 42, height: 42, borderRadius: 13, background: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 21 }}>✦</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 21, fontWeight: 800 }}>{st.salonName || 'Welcome'}</div>
            <div style={{ fontSize: 15, color: '#94a3b8' }}>Tap to fill in your details — or let us do it for you</div>
          </div>
        </header>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '22px 28px', WebkitOverflowScrolling: 'touch' }}>
          <h2 style={h2}>Your details</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 30 }}>
            <Field label="First name" required>
              <input value={st.form.firstName} onChange={(e) => patch({ firstName: e.target.value })} placeholder="Anna" style={bigInput} autoCapitalize="words" />
            </Field>
            <Field label="Last name">
              <input value={st.form.lastName} onChange={(e) => patch({ lastName: e.target.value })} placeholder="Nguyen" style={bigInput} autoCapitalize="words" />
            </Field>
            <Field label="Mobile number">
              <input value={st.form.phone} onChange={(e) => patch({ phone: e.target.value })} placeholder="+1 512 886 8189" style={bigInput} inputMode="tel" />
            </Field>
            <Field label="Email">
              <input value={st.form.email} onChange={(e) => patch({ email: e.target.value })} placeholder="anna@email.com" style={bigInput} inputMode="email" autoCapitalize="off" />
            </Field>
            <Field label="Birthday">
              <input type="date" max={new Date().toISOString().slice(0, 10)} value={st.form.birthDate} onChange={(e) => patch({ birthDate: e.target.value })} style={bigInput} />
            </Field>
            <Field label="How many of you?">
              <div style={{ display: 'flex', gap: 10 }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} onClick={() => patch({ partySize: n })}
                    style={{ ...pill, flex: 1, ...(st.form.partySize === n ? { background: accent, borderColor: accent, color: '#fff' } : null) }}>
                    {n}{n === 5 ? '+' : ''}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          <h2 style={h2}>What would you like today?</h2>
          {cats.length > 0 && (
            <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 12 }}>
              <button onClick={() => setCat(null)} style={{ ...pill, ...(cat === null ? { background: accent, borderColor: accent, color: '#fff' } : null) }}>All</button>
              {cats.map((c) => (
                <button key={c.id} onClick={() => setCat(c.id)} style={{ ...pill, whiteSpace: 'nowrap', ...(cat === c.id ? { background: accent, borderColor: accent, color: '#fff' } : null) }}>{c.name}</button>
              ))}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14, marginTop: 8 }}>
            {shown.map((s) => {
              const on = st.picked.includes(s.id);
              return (
                <button key={s.id} onClick={() => toggle(s.id)}
                  style={{
                    textAlign: 'left', borderRadius: 16, padding: '16px 18px', cursor: 'pointer',
                    background: on ? 'rgba(99,102,241,0.14)' : '#111827',
                    border: `2px solid ${on ? accent : '#1e293b'}`, color: '#e2e8f0',
                    minHeight: 104, display: 'flex', flexDirection: 'column', gap: 8,
                  }}>
                  <span style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.25 }}>{s.name}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 'auto' }}>
                    <span style={{ fontSize: 19, fontWeight: 800, color: on ? '#fff' : '#22c55e' }}>{money(s.priceCents)}</span>
                    <span style={{ fontSize: 14, color: '#94a3b8' }}>{s.durationMinutes} min</span>
                    {on && <span style={{ marginLeft: 'auto', fontSize: 20, color: accent }}>✓</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <footer style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '16px 28px', borderTop: '1px solid #1e293b', background: '#0f172a', flexShrink: 0 }}>
          <span style={{ fontSize: 16.5, color: '#cbd5e1' }}>
            {pickedList.length > 0
              ? <>{pickedList.length} selected · <strong style={{ color: '#22c55e' }}>{money(total)}</strong> · {mins} min</>
              : 'Pick anything you like — or let us know at the chair'}
          </span>
          <span style={{ flex: 1 }} />
          <button
            onClick={() => send('submit')}
            disabled={!st.form.firstName.trim()}
            style={{ border: 'none', background: accent, color: '#fff', borderRadius: 14, padding: '16px 38px', fontSize: 19, fontWeight: 700, cursor: 'pointer', minHeight: 62, opacity: st.form.firstName.trim() ? 1 : 0.45 }}
          >
            I&rsquo;m done
          </button>
        </footer>
      </div>
    </main>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, color: '#cbd5e1', marginBottom: 8, fontWeight: 600 }}>
        {label}{required && <span style={{ color: '#f87171' }}>*</span>}
      </span>
      {children}
    </label>
  );
}

const screen: CSSProperties = {
  minHeight: '100dvh', height: '100dvh', background: '#0b1120', color: '#e2e8f0',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28,
  WebkitTapHighlightColor: 'transparent',
};
const bigInput: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '18px', borderRadius: 14,
  border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0',
  fontSize: 20, colorScheme: 'dark', minHeight: 64,
};
const pill: CSSProperties = {
  border: '2px solid #1e293b', background: '#111827', color: '#cbd5e1',
  borderRadius: 999, padding: '14px 22px', fontSize: 17, fontWeight: 600, cursor: 'pointer', minHeight: 56,
};
const h2: CSSProperties = { fontSize: 26, fontWeight: 800, margin: '0 0 16px' };
