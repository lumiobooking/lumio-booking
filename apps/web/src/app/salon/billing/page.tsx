'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';

interface PlanFlags { planName: string | null }
interface PublicPlan {
  id: string; name: string; tagline: string | null; currency: string;
  priceMonthlyCents: number; priceYearlyCents: number; features: string[]; highlighted: boolean;
  providers: { stripe: boolean; paypal: boolean };
}

const money = (c: number, cur = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(c / 100);

export default function BillingPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const [current, setCurrent] = useState<PlanFlags | null>(null);
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [yearly, setYearly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [p, list] = await Promise.all([
        apiFetch<PlanFlags>('/me/plan', { token }),
        apiFetch<PublicPlan[]>('/billing/plans', { token }).catch(() => [] as PublicPlan[]),
      ]);
      setCurrent(p);
      setPlans(Array.isArray(list) ? list : []);
    } catch { /* ignore */ }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('upgraded')) {
      setMsg('✓ Payment received — your plan is being activated. It updates within a few seconds.');
    }
  }, []);

  async function choose(planId: string, provider: 'stripe' | 'paypal') {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch<{ checkoutUrl: string }>('/billing/subscribe', { method: 'POST', token, body: { planId, interval: yearly ? 'year' : 'month', provider } });
      window.location.href = r.checkoutUrl;
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not start checkout'); setBusy(false); }
  }

  async function portal() {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch<{ url: string }>('/billing/portal', { method: 'POST', token });
      window.location.href = r.url;
    } catch { setMsg('You don’t have a card subscription yet — pick a plan below to get started.'); setBusy(false); }
  }

  const currentName = (current?.planName ?? '').toLowerCase();

  return (
    <section style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Billing &amp; plan</h1>
      <p style={{ color: '#94a3b8', margin: '0 0 16px', fontSize: 14 }}>Upgrade your plan, or manage your card &amp; subscription.</p>

      {msg && <div style={{ background: '#064e3b', color: '#a7f3d0', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>{msg}</div>}
      {error && <div style={ui.banner}>{error}</div>}

      <div style={{ ...ui.card, marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, color: '#94a3b8' }}>Current plan</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{current?.planName ?? '—'}</div>
        </div>
        <button onClick={portal} disabled={busy} style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid #475569' }}>Manage card &amp; cancel</button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
        <div style={{ display: 'inline-flex', background: '#1e293b', border: '1px solid #334155', borderRadius: 999, padding: 4 }}>
          <button onClick={() => setYearly(false)} style={toggle(!yearly)}>Monthly</button>
          <button onClick={() => setYearly(true)} style={toggle(yearly)}>Yearly</button>
        </div>
      </div>

      {plans.length === 0 ? (
        <p style={{ color: '#94a3b8', fontSize: 14 }}>No plans available to choose yet.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          {plans.map((p) => {
            const isCurrent = p.name.toLowerCase() === currentName;
            const cents = yearly ? p.priceYearlyCents : p.priceMonthlyCents;
            const provider: 'stripe' | 'paypal' = p.providers.stripe ? 'stripe' : 'paypal';
            const canPay = p.providers.stripe || p.providers.paypal;
            return (
              <div key={p.id} style={{ ...ui.card, border: p.highlighted ? '2px solid #6366f1' : '1px solid #334155' }}>
                {p.highlighted && <div style={{ display: 'inline-block', background: '#312e81', color: '#c7d2fe', fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 999, marginBottom: 8 }}>MOST POPULAR</div>}
                <div style={{ fontSize: 18, fontWeight: 700 }}>{p.name}</div>
                {p.tagline && <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 2 }}>{p.tagline}</div>}
                <div style={{ margin: '12px 0' }}>
                  <span style={{ fontSize: 30, fontWeight: 800 }}>{money(cents, p.currency)}</span>
                  <span style={{ color: '#94a3b8', fontSize: 14 }}>/{yearly ? 'yr' : 'mo'}</span>
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {p.features.slice(0, 6).map((f) => (
                    <li key={f} style={{ fontSize: 13, color: '#cbd5e1', display: 'flex', gap: 8 }}><span style={{ color: '#22c55e' }}>✓</span>{f}</li>
                  ))}
                </ul>
                {isCurrent ? (
                  <button disabled style={{ ...ui.primaryBtn, width: '100%', background: '#334155', cursor: 'default' }}>Current plan</button>
                ) : (
                  <button onClick={() => choose(p.id, provider)} disabled={busy || !canPay} style={{ ...ui.primaryBtn, width: '100%' }}>
                    {!canPay ? 'Not available' : busy ? 'Opening…' : `Upgrade to ${p.name}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p style={{ color: '#64748b', fontSize: 12, marginTop: 16 }}>
        Choosing a plan opens secure checkout (Stripe/PayPal). If you already pay by card, use "Manage card &amp; cancel" to switch plans with automatic proration.
      </p>
    </section>
  );
}

function toggle(active: boolean): React.CSSProperties {
  return { border: 'none', cursor: 'pointer', padding: '7px 18px', borderRadius: 999, fontSize: 14, fontWeight: 600, background: active ? '#6366f1' : 'transparent', color: active ? '#fff' : '#94a3b8' };
}
