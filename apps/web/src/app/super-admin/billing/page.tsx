'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';

interface Status {
  stripe: { hasKey: boolean; hasWebhook: boolean; live: boolean };
  paypal: { hasClient: boolean; hasWebhook: boolean; env: string };
  webhookStripeUrl: string;
  webhookPaypalUrl: string;
}

export default function GatewaysPage() {
  const { token, user, ready } = useAuth();
  const router = useRouter();
  const [st, setSt] = useState<Status | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Stripe inputs
  const [stripeKey, setStripeKey] = useState('');
  const [stripeHook, setStripeHook] = useState('');
  // PayPal inputs
  const [ppId, setPpId] = useState('');
  const [ppSecret, setPpSecret] = useState('');
  const [ppHook, setPpHook] = useState('');
  const [ppEnv, setPpEnv] = useState('live');

  useEffect(() => {
    if (!ready) return;
    if (!token) router.replace('/login');
    else if (user && user.role !== 'SUPER_ADMIN') router.replace('/');
  }, [ready, token, user, router]);

  const load = useCallback(async () => {
    if (!token) return;
    try { const s = await apiFetch<Status>('/billing/config', { token }); setSt(s); setPpEnv(s.paypal.env || 'live'); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load'); }
  }, [token]);
  useEffect(() => { if (ready && token && user?.role === 'SUPER_ADMIN') load(); }, [ready, token, user, load]);

  async function testNow() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch<{ stripe: string; paypal: string }>('/billing/config/test', { token });
      const fmt = (v: string) => v === 'ok' ? '✓ working' : v === 'not configured' ? 'not set' : `✗ ${v}`;
      setMsg(`Test — Stripe: ${fmt(r.stripe)}  ·  PayPal: ${fmt(r.paypal)}`);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Test failed'); }
    finally { setBusy(false); }
  }

  async function save(body: Record<string, string>) {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const s = await apiFetch<Status>('/billing/config', { method: 'POST', token, body });
      setSt(s);
      setMsg('✓ Saved. Connection status updated below.');
      setStripeKey(''); setStripeHook(''); setPpId(''); setPpSecret(''); setPpHook('');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  }

  if (!ready || !token || user?.role !== 'SUPER_ADMIN') {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#94a3b8' }}>Loading…</div>;
  }

  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => { setMsg('✓ Webhook URL copied'); }).catch(() => {});
  const dot = (on: boolean) => <span style={{ color: on ? '#22c55e' : '#ef4444', fontWeight: 700 }}>● {on ? 'Connected' : 'Not set'}</span>;

  return (
    <main style={{ maxWidth: 820, margin: '0 auto', padding: '32px 24px', color: '#e2e8f0' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, margin: 0 }}>Payment gateways</h1>
          <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: 14 }}>Connect Stripe / PayPal so salons can pay you. Money goes to the account these keys belong to.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={testNow} disabled={busy} style={ghost}>Test connection</button>
          <a href="/super-admin/tenants" style={ghost}>← Salons</a>
        </div>
      </header>

      {err && <Banner color="#fecaca" bg="#7f1d1d">{err}</Banner>}
      {msg && <Banner color="#bbf7d0" bg="#14532d">{msg}</Banner>}

      {/* Stripe */}
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>💳 Stripe (cards)</h2>
          <span style={{ fontSize: 13 }}>{st ? dot(st.stripe.hasKey && st.stripe.hasWebhook) : '…'}{st?.stripe.live ? ' · LIVE' : st?.stripe.hasKey ? ' · TEST' : ''}</span>
        </div>
        <p style={{ color: '#94a3b8', fontSize: 13, margin: '8px 0 12px' }}>From Stripe → Developers → API keys (Secret key) and Webhooks (signing secret).</p>
        <label style={lbl}>Secret key {st?.stripe.hasKey && <span style={savedTag}>saved</span>}</label>
        <input style={inp} type="password" value={stripeKey} onChange={(e) => setStripeKey(e.target.value)} placeholder={st?.stripe.hasKey ? '•••••••• (leave blank to keep)' : 'sk_live_… or sk_test_…'} />
        <label style={lbl}>Webhook signing secret {st?.stripe.hasWebhook && <span style={savedTag}>saved</span>}</label>
        <input style={inp} type="password" value={stripeHook} onChange={(e) => setStripeHook(e.target.value)} placeholder={st?.stripe.hasWebhook ? '•••••••• (leave blank to keep)' : 'whsec_…'} />
        <button onClick={() => save({ stripeSecretKey: stripeKey, stripeWebhookSecret: stripeHook })} disabled={busy} style={primaryBtn}>Save Stripe</button>

        <div style={hintBox}>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Add this webhook URL in Stripe (events: checkout.session.completed, customer.subscription.updated/deleted, invoice.payment_failed):</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={codeBox}>{st?.webhookStripeUrl}</code>
            <button onClick={() => st && copy(st.webhookStripeUrl)} style={ghost}>Copy</button>
          </div>
        </div>
      </section>

      {/* PayPal */}
      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>PayPal</h2>
          <span style={{ fontSize: 13 }}>{st ? dot(st.paypal.hasClient && st.paypal.hasWebhook) : '…'}{st ? ` · ${(st.paypal.env || 'live').toUpperCase()}` : ''}</span>
        </div>
        <p style={{ color: '#94a3b8', fontSize: 13, margin: '8px 0 12px' }}>From developer.paypal.com → your REST app (Client ID + Secret) and Webhooks (Webhook ID).</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><label style={lbl}>Client ID {st?.paypal.hasClient && <span style={savedTag}>saved</span>}</label>
            <input style={inp} value={ppId} onChange={(e) => setPpId(e.target.value)} placeholder={st?.paypal.hasClient ? '•••• (keep)' : 'AY…'} /></div>
          <div><label style={lbl}>Secret</label>
            <input style={inp} type="password" value={ppSecret} onChange={(e) => setPpSecret(e.target.value)} placeholder={st?.paypal.hasClient ? '•••• (keep)' : 'EL…'} /></div>
          <div><label style={lbl}>Webhook ID {st?.paypal.hasWebhook && <span style={savedTag}>saved</span>}</label>
            <input style={inp} value={ppHook} onChange={(e) => setPpHook(e.target.value)} placeholder="2W9…" /></div>
          <div><label style={lbl}>Environment</label>
            <select style={inp} value={ppEnv} onChange={(e) => setPpEnv(e.target.value)}><option value="live">Live</option><option value="sandbox">Sandbox (test)</option></select></div>
        </div>
        <button onClick={() => save({ paypalClientId: ppId, paypalSecret: ppSecret, paypalWebhookId: ppHook, paypalEnv: ppEnv })} disabled={busy} style={{ ...primaryBtn, marginTop: 12 }}>Save PayPal</button>

        <div style={hintBox}>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Add this webhook URL in PayPal (subscription + payment events):</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={codeBox}>{st?.webhookPaypalUrl}</code>
            <button onClick={() => st && copy(st.webhookPaypalUrl)} style={ghost}>Copy</button>
          </div>
        </div>
      </section>

      <p style={{ color: '#64748b', fontSize: 12 }}>Tip: start with Stripe TEST keys + the test card 4242 4242 4242 4242 to verify, then switch to LIVE keys to receive real money. Renewals are automatic.</p>
    </main>
  );
}

function Banner({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
  return <div style={{ background: bg, color, padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>{children}</div>;
}

const card: React.CSSProperties = { background: '#1e293b', border: '1px solid #334155', borderRadius: 14, padding: 20, marginBottom: 18 };
const inp: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 8, border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: 14, colorScheme: 'dark', marginBottom: 10 };
const lbl: React.CSSProperties = { display: 'block', fontSize: 13, color: '#cbd5e1', marginBottom: 4 };
const primaryBtn: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: 'none', background: '#6366f1', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' };
const ghost: React.CSSProperties = { padding: '7px 12px', borderRadius: 8, border: '1px solid #475569', background: 'transparent', color: '#e2e8f0', fontSize: 13, cursor: 'pointer', textDecoration: 'none' };
const hintBox: React.CSSProperties = { marginTop: 14, paddingTop: 12, borderTop: '1px solid #334155' };
const codeBox: React.CSSProperties = { flex: 1, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: '#cbd5e1', overflowX: 'auto', whiteSpace: 'nowrap' };
const savedTag: React.CSSProperties = { marginLeft: 6, fontSize: 11, color: '#22c55e', border: '1px solid #22c55e', borderRadius: 999, padding: '0 6px' };
