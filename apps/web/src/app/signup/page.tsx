'use client';

import { useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import { useIsMobile } from '../../lib/responsive';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';
const INK = '#0f172a';
const INDIGO = '#6366f1';

interface PublicPlan {
  id: string; name: string; tagline: string | null; currency: string;
  priceMonthlyCents: number; priceYearlyCents: number; trialDays: number;
  features: string[]; highlighted: boolean;
  providers: { stripe: boolean; paypal: boolean };
}

const money = (cents: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);

function detectTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
}

export default function SignupPage() {
  const mobile = useIsMobile();
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [planId, setPlanId] = useState('');
  const [interval, setInterval] = useState<'month' | 'year'>('month');
  const [provider, setProvider] = useState<'stripe' | 'paypal'>('stripe');
  const [form, setForm] = useState({ salonName: '', firstName: '', lastName: '', email: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canceled, setCanceled] = useState(false);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('interval') === 'year') setInterval('year');
    if (p.get('canceled')) setCanceled(true);
    const wantPlan = p.get('plan');
    fetch(`${API_URL}/public/plans`).then((r) => r.json()).then((d: PublicPlan[]) => {
      if (!Array.isArray(d)) return;
      setPlans(d);
      const chosen = d.find((x) => x.id === wantPlan) ?? d[0];
      if (chosen) {
        setPlanId(chosen.id);
        setProvider(chosen.providers.stripe ? 'stripe' : 'paypal');
      }
    }).catch(() => setError('Could not load plans. Please try again.'));
  }, []);

  const plan = plans.find((p) => p.id === planId) ?? null;
  const cents = plan ? (interval === 'year' ? plan.priceYearlyCents : plan.priceMonthlyCents) : 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!plan) return;
    setSubmitting(true); setError(null);
    try {
      const res = await fetch(`${API_URL}/public/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, planId: plan.id, interval, provider, timezone: detectTz() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Sign up failed');
      window.location.href = data.checkoutUrl; // off to Stripe / PayPal
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
      setSubmitting(false);
    }
  }

  const upd = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg,#eef2ff,#fff 40%)', color: INK, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
      <div style={{ maxWidth: 980, margin: '0 auto', padding: '28px 24px' }}>
        <Link href="/" style={{ fontSize: 20, fontWeight: 800, color: INK, textDecoration: 'none' }}>Lumio<span style={{ color: INDIGO }}>Booking</span></Link>
      </div>

      <div style={{ maxWidth: 980, margin: '0 auto', padding: mobile ? '0 16px 48px' : '0 24px 64px', display: 'grid', gridTemplateColumns: mobile ? '1fr' : 'minmax(0,1fr) 360px', gap: mobile ? 18 : 28, alignItems: 'start' }}>
        {/* Form */}
        <form onSubmit={submit} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 20, padding: mobile ? 20 : 32, boxShadow: '0 6px 24px rgba(15,23,42,0.06)', order: mobile ? 2 : 1 }}>
          <h1 style={{ fontSize: 26, margin: 0, letterSpacing: -0.5 }}>Create your salon account</h1>
          <p style={{ color: '#64748b', margin: '6px 0 22px', fontSize: 15 }}>Start your {plan?.trialDays ?? 14}-day free trial. No charge today.</p>

          {canceled && <Banner color="#92400e" bg="#fef3c7">Checkout was canceled — you can try again below.</Banner>}
          {error && <Banner color="#b91c1c" bg="#fee2e2">{error}</Banner>}

          <Field label="Salon name"><input required style={input} value={form.salonName} onChange={upd('salonName')} placeholder="e.g. Lumio Nails &amp; Spa" /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="First name"><input required style={input} value={form.firstName} onChange={upd('firstName')} /></Field>
            <Field label="Last name"><input style={input} value={form.lastName} onChange={upd('lastName')} /></Field>
          </div>
          <Field label="Email (your login)"><input required type="email" style={input} value={form.email} onChange={upd('email')} placeholder="owner@yoursalon.com" /></Field>
          <Field label="Password"><input required type="password" minLength={8} style={input} value={form.password} onChange={upd('password')} placeholder="At least 8 characters" /></Field>

          {plan && (
            <div style={{ marginTop: 8 }}>
              <span style={label}>Payment method</span>
              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                {plan.providers.stripe && <ProviderBtn active={provider === 'stripe'} onClick={() => setProvider('stripe')} label="💳 Card" />}
                {plan.providers.paypal && <ProviderBtn active={provider === 'paypal'} onClick={() => setProvider('paypal')} label="PayPal" />}
                {!plan.providers.stripe && !plan.providers.paypal && <span style={{ color: '#b91c1c', fontSize: 13 }}>No payment method configured yet for this plan.</span>}
              </div>
            </div>
          )}

          <button type="submit" disabled={submitting || !plan || (!plan?.providers.stripe && !plan?.providers.paypal)} style={{ ...primaryBtn, width: '100%', padding: 14, fontSize: 16, marginTop: 22, opacity: submitting ? 0.7 : 1 }}>
            {submitting ? 'Redirecting to secure checkout…' : 'Continue to secure checkout →'}
          </button>
          <p style={{ color: '#94a3b8', fontSize: 12.5, marginTop: 12, textAlign: 'center' }}>
            You'll be redirected to {provider === 'paypal' ? 'PayPal' : 'Stripe'} to finish securely. Already have an account? <Link href="/login" style={{ color: INDIGO }}>Sign in</Link>
          </p>
        </form>

        {/* Order summary */}
        <aside style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 20, padding: mobile ? 20 : 26, position: mobile ? 'static' : 'sticky', top: 24, order: mobile ? 1 : 2 }}>
          <h2 style={{ fontSize: 16, margin: '0 0 14px', color: '#334155' }}>Order summary</h2>
          {!plan ? <p style={{ color: '#94a3b8', fontSize: 14 }}>Loading plans…</p> : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong style={{ fontSize: 18 }}>{plan.name}</strong>
                <span style={{ fontWeight: 800, fontSize: 20 }}>{money(cents, plan.currency)}<span style={{ color: '#64748b', fontSize: 13, fontWeight: 400 }}>/{interval === 'year' ? 'yr' : 'mo'}</span></span>
              </div>
              {plan.tagline && <p style={{ color: '#64748b', fontSize: 13, margin: '6px 0 0' }}>{plan.tagline}</p>}

              <div style={{ display: 'inline-flex', background: '#f1f5f9', borderRadius: 999, padding: 3, marginTop: 16 }}>
                <button type="button" onClick={() => setInterval('month')} style={miniToggle(interval === 'month')}>Monthly</button>
                <button type="button" onClick={() => setInterval('year')} style={miniToggle(interval === 'year')}>Yearly</button>
              </div>

              {plans.length > 1 && (
                <div style={{ marginTop: 16 }}>
                  <span style={label}>Plan</span>
                  <select value={planId} onChange={(e) => setPlanId(e.target.value)} style={{ ...input, marginTop: 4 }}>
                    {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}

              <div style={{ borderTop: '1px solid #eef2f7', margin: '18px 0', paddingTop: 14, color: '#16a34a', fontSize: 14, fontWeight: 600 }}>
                {plan.trialDays}-day free trial · then {money(cents, plan.currency)}/{interval === 'year' ? 'year' : 'month'}
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {plan.features.slice(0, 6).map((f) => (
                  <li key={f} style={{ display: 'flex', gap: 8, fontSize: 13.5, color: '#334155' }}><span style={{ color: '#16a34a', fontWeight: 800 }}>✓</span> {f}</li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function Field({ label: l, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block', marginBottom: 12 }}><span style={label}>{l}</span>{children}</label>;
}
function Banner({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
  return <div style={{ background: bg, color, padding: '10px 14px', borderRadius: 10, fontSize: 14, marginBottom: 16 }}>{children}</div>;
}
function ProviderBtn({ active, onClick, label: l }: { active: boolean; onClick: () => void; label: string }) {
  return <button type="button" onClick={onClick} style={{ flex: 1, padding: '11px', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 14, border: `1.5px solid ${active ? INDIGO : '#cbd5e1'}`, background: active ? '#eef2ff' : '#fff', color: active ? '#4338ca' : '#334155' }}>{l}</button>;
}

const label: React.CSSProperties = { display: 'block', fontSize: 13, color: '#475569', fontWeight: 600, marginBottom: 4 };
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 15, color: INK, background: '#fff' };
const primaryBtn: React.CSSProperties = { background: INDIGO, color: '#fff', fontWeight: 700, border: 'none', borderRadius: 12, cursor: 'pointer' };
function miniToggle(active: boolean): React.CSSProperties {
  return { border: 'none', cursor: 'pointer', padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, background: active ? INDIGO : 'transparent', color: active ? '#fff' : '#475569' };
}
