'use client';

import { Fragment, useCallback, useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';

interface Plan {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  maxStaff: number | null;
  maxBookingsPerMonth: number | null;
  posEnabled: boolean;
  onlinePaymentEnabled: boolean;
  multiLocationEnabled: boolean;
  whiteLabelEnabled: boolean;
  isActive: boolean;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  trialDays: number;
  tagline: string | null;
  featuresJson: unknown;
  publicVisible: boolean;
  highlighted: boolean;
  sortOrder: number;
  stripePriceMonthlyId: string | null;
  stripePriceYearlyId: string | null;
  paypalPlanMonthlyId: string | null;
  paypalPlanYearlyId: string | null;
}

export default function PlansPage() {
  const { token, user, ready, logout } = useAuth();
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!token) router.replace('/login');
    else if (user && user.role !== 'SUPER_ADMIN') router.replace('/');
  }, [ready, token, user, router]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try { setPlans(await apiFetch<Plan[]>('/tenants/plans', { token })); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load plans'); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { if (ready && token && user?.role === 'SUPER_ADMIN') load(); }, [ready, token, user, load]);

  async function seedDefaults() {
    if (!token) return;
    setSeeding(true); setError(null);
    const defaults = [
      { name: 'Starter', tagline: 'For a single salon getting started', priceMonthlyCents: 2900, priceYearlyCents: 29000, trialDays: 14, maxStaff: 3, maxBookingsPerMonth: null, posEnabled: false, onlinePaymentEnabled: false, multiLocationEnabled: false, whiteLabelEnabled: false, isActive: true, publicVisible: true, highlighted: false, sortOrder: 1, features: ['Online booking 24/7', 'SMS & email reminders', 'Up to 3 staff', 'AI hotline'] },
      { name: 'Pro', tagline: 'For a busy salon that wants it all', priceMonthlyCents: 5900, priceYearlyCents: 59000, trialDays: 14, maxStaff: 10, maxBookingsPerMonth: null, posEnabled: true, onlinePaymentEnabled: true, multiLocationEnabled: false, whiteLabelEnabled: false, isActive: true, publicVisible: true, highlighted: true, sortOrder: 2, features: ['Everything in Starter', 'POS / checkout suite', 'Online payments', 'Up to 10 staff'] },
      { name: 'Business', tagline: 'For multi-location owners', priceMonthlyCents: 9900, priceYearlyCents: 99000, trialDays: 14, maxStaff: null, maxBookingsPerMonth: null, posEnabled: true, onlinePaymentEnabled: true, multiLocationEnabled: true, whiteLabelEnabled: true, isActive: true, publicVisible: true, highlighted: false, sortOrder: 3, features: ['Everything in Pro', 'Multi-location', 'White-label branding', 'Unlimited staff'] },
    ];
    try {
      for (const plan of defaults) {
        await apiFetch('/tenants/plans', { method: 'POST', token, body: plan });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create starter plans');
    } finally {
      setSeeding(false);
    }
  }

  if (!ready || !token || user?.role !== 'SUPER_ADMIN') {
    return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#94a3b8' }}>Loading…</div>;
  }

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 24px', color: '#e2e8f0' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, margin: 0 }}>Plans</h1>
          <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: 14 }}>Define what each subscription package unlocks.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/super-admin/tenants" style={ghost}>← Salons</a>
          {plans.length === 0 && <button onClick={seedDefaults} disabled={seeding} style={ghost}>{seeding ? 'Creating…' : '✨ Starter plans'}</button>}
          <button onClick={() => { setShowForm((s) => !s); setEditId(null); }} style={primary}>{showForm ? 'Close' : '+ New plan'}</button>
          <button onClick={logout} style={ghost}>Log out</button>
        </div>
      </header>

      {error && <Banner>{error}</Banner>}

      {showForm && <PlanForm token={token} onDone={async () => { setShowForm(false); await load(); }} />}

      {loading ? <p style={{ color: '#94a3b8' }}>Loading…</p> : (
        <div style={{ overflowX: 'auto', border: '1px solid #334155', borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead><tr style={{ background: '#1e293b', textAlign: 'left' }}>
              <th style={th}>Plan</th><th style={th}>Price</th><th style={th}>Includes</th><th style={th}>Status</th><th style={th}>Actions</th>
            </tr></thead>
            <tbody>
              {plans.length === 0 && <tr><td style={td} colSpan={5}>No plans yet. Click “+ New plan”.</td></tr>}
              {plans.map((p) => (
                <Fragment key={p.id}>
                  <tr style={{ borderTop: '1px solid #334155' }}>
                    <td style={td}><strong>{p.name}</strong>{p.description ? <div style={{ color: '#94a3b8', fontSize: 12 }}>{p.description}</div> : null}</td>
                    <td style={td}>
                      ${((p.priceMonthlyCents || p.priceCents) / 100).toFixed(0)}/mo
                      {p.priceYearlyCents ? <div style={{ color: '#94a3b8', fontSize: 12 }}>${(p.priceYearlyCents / 100).toFixed(0)}/yr</div> : null}
                    </td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <Tag on={p.publicVisible}>On website</Tag>
                        <Tag on={p.posEnabled}>POS suite</Tag>
                        <Tag on={p.onlinePaymentEnabled}>Online pay</Tag>
                        <Tag on={p.multiLocationEnabled}>Multi-location</Tag>
                        <Tag on={p.whiteLabelEnabled}>White-label</Tag>
                      </div>
                    </td>
                    <td style={td}><span style={{ color: p.isActive ? '#22c55e' : '#94a3b8' }}>{p.isActive ? 'Active' : 'Inactive'}</span></td>
                    <td style={td}><button onClick={() => setEditId(editId === p.id ? null : p.id)} style={{ ...primary, padding: '6px 12px', fontSize: 12, background: editId === p.id ? '#475569' : '#6366f1' }}>{editId === p.id ? 'Close' : 'Edit'}</button></td>
                  </tr>
                  {editId === p.id && (
                    <tr><td colSpan={5} style={{ padding: 16, background: '#0f172a' }}>
                      <PlanForm token={token} plan={p} onDone={async () => { setEditId(null); await load(); }} />
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function PlanForm({ token, plan, onDone }: { token: string; plan?: Plan; onDone: () => void }) {
  const [form, setForm] = useState({
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    price: plan ? ((plan.priceMonthlyCents || plan.priceCents) / 100).toString() : '',
    priceYearly: plan && plan.priceYearlyCents ? (plan.priceYearlyCents / 100).toString() : '',
    trialDays: plan?.trialDays != null ? String(plan.trialDays) : '14',
    maxStaff: plan?.maxStaff != null ? String(plan.maxStaff) : '',
    maxBookingsPerMonth: plan?.maxBookingsPerMonth != null ? String(plan.maxBookingsPerMonth) : '',
    posEnabled: plan?.posEnabled ?? false,
    onlinePaymentEnabled: plan?.onlinePaymentEnabled ?? false,
    multiLocationEnabled: plan?.multiLocationEnabled ?? false,
    whiteLabelEnabled: plan?.whiteLabelEnabled ?? false,
    isActive: plan?.isActive ?? true,
    tagline: plan?.tagline ?? '',
    features: Array.isArray(plan?.featuresJson) ? (plan!.featuresJson as string[]).join('\n') : '',
    publicVisible: plan?.publicVisible ?? false,
    highlighted: plan?.highlighted ?? false,
    sortOrder: plan?.sortOrder != null ? String(plan.sortOrder) : '0',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const body = {
        name: form.name,
        description: form.description || undefined,
        priceMonthlyCents: Math.round((parseFloat(form.price) || 0) * 100),
        priceYearlyCents: Math.round((parseFloat(form.priceYearly) || 0) * 100),
        trialDays: parseInt(form.trialDays, 10) || 0,
        maxStaff: form.maxStaff === '' ? null : parseInt(form.maxStaff, 10),
        maxBookingsPerMonth: form.maxBookingsPerMonth === '' ? null : parseInt(form.maxBookingsPerMonth, 10),
        posEnabled: form.posEnabled,
        onlinePaymentEnabled: form.onlinePaymentEnabled,
        multiLocationEnabled: form.multiLocationEnabled,
        whiteLabelEnabled: form.whiteLabelEnabled,
        isActive: form.isActive,
        tagline: form.tagline || null,
        features: form.features.split('\n').map((s) => s.trim()).filter(Boolean),
        publicVisible: form.publicVisible,
        highlighted: form.highlighted,
        sortOrder: parseInt(form.sortOrder, 10) || 0,
      };
      if (plan) await apiFetch(`/tenants/plans/${plan.id}`, { method: 'PATCH', token, body });
      else await apiFetch('/tenants/plans', { method: 'POST', token, body });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally { setSaving(false); }
  }

  const chk = (k: keyof typeof form) => (
    <input type="checkbox" checked={form[k] as boolean} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} />
  );

  return (
    <form onSubmit={submit} style={plan ? {} : { background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 20, marginBottom: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <Field label="Plan name"><input style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Starter / Pro" /></Field>
        <Field label="Price $/month"><input style={inp} type="number" min={0} step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
        <Field label="Price $/year"><input style={inp} type="number" min={0} step="0.01" value={form.priceYearly} onChange={(e) => setForm({ ...form, priceYearly: e.target.value })} /></Field>
        <Field label="Free trial (days)"><input style={inp} type="number" min={0} value={form.trialDays} onChange={(e) => setForm({ ...form, trialDays: e.target.value })} /></Field>
        <Field label="Max staff (blank = unlimited)"><input style={inp} type="number" min={0} value={form.maxStaff} onChange={(e) => setForm({ ...form, maxStaff: e.target.value })} /></Field>
        <Field label="Max bookings/mo (blank = unlimited)"><input style={inp} type="number" min={0} value={form.maxBookingsPerMonth} onChange={(e) => setForm({ ...form, maxBookingsPerMonth: e.target.value })} /></Field>
        <Field label="Sort order (low = first)"><input style={inp} type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} /></Field>
      </div>
      <Field label="Description (internal)"><input style={inp} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Short internal summary" /></Field>

      <div style={{ marginTop: 16, fontWeight: 600, fontSize: 14, color: '#cbd5e1' }}>Public marketing (landing page)</div>
      <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0 10px' }}>Shown on the homepage pricing section when “Show on website” is on.</p>
      <Field label="Tagline"><input style={inp} value={form.tagline} onChange={(e) => setForm({ ...form, tagline: e.target.value })} placeholder="e.g. For a single salon getting started" /></Field>
      <Field label="Selling points (one per line)"><textarea style={{ ...inp, minHeight: 90, resize: 'vertical', fontFamily: 'inherit' }} value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} placeholder={'Online booking 24/7\nEmail reminders\nUp to 3 staff'} /></Field>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
        <label style={chkRow}>{chk('publicVisible')} <span><strong>Show on website</strong> — list this plan on the public pricing page</span></label>
        <label style={chkRow}>{chk('highlighted')} <span><strong>Highlight</strong> — show a “Most popular” badge</span></label>
      </div>

      <p style={{ color: '#64748b', fontSize: 12, margin: '12px 0 0' }}>💳 No payment IDs needed — Stripe charges this amount directly and PayPal plans are created automatically. Just set the prices above and configure your Stripe/PayPal keys once in the server settings.</p>

      <div style={{ marginTop: 14, fontWeight: 600, fontSize: 14, color: '#cbd5e1' }}>Features unlocked</div>
      <p style={{ color: '#64748b', fontSize: 12, margin: '2px 0 10px' }}>Booking is always included. Tick what this plan adds on top.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={chkRow}>{chk('posEnabled')} <span><strong>POS suite</strong> — Checkout, Products, Orders &amp; Sales report</span></label>
        <label style={chkRow}>{chk('onlinePaymentEnabled')} <span><strong>Online payments</strong> — card gateways at booking</span></label>
        <label style={chkRow}>{chk('multiLocationEnabled')} <span><strong>Multi-location</strong></span></label>
        <label style={chkRow}>{chk('whiteLabelEnabled')} <span><strong>White-label branding</strong></span></label>
        <label style={chkRow}>{chk('isActive')} <span><strong>Active</strong> — selectable for new salons</span></label>
      </div>

      {error && <Banner>{error}</Banner>}
      <button type="submit" disabled={saving} style={{ ...primary, marginTop: 16 }}>{saving ? 'Saving…' : plan ? 'Save plan' : 'Create plan'}</button>
    </form>
  );
}

function Tag({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, border: `1px solid ${on ? '#22c55e' : '#334155'}`, color: on ? '#22c55e' : '#64748b' }}>
      {on ? '✓ ' : '✕ '}{children}
    </span>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><span style={{ display: 'block', fontSize: 12, color: '#cbd5e1', marginBottom: 6, marginTop: 6 }}>{label}</span>{children}</label>;
}
function Banner({ children }: { children: React.ReactNode }) {
  return <div style={{ background: '#7f1d1d', color: '#fecaca', padding: '8px 12px', borderRadius: 8, fontSize: 13, margin: '12px 0' }}>{children}</div>;
}

const th: React.CSSProperties = { padding: '12px 14px', fontWeight: 600, color: '#cbd5e1' };
const td: React.CSSProperties = { padding: '12px 14px' };
const inp: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 8, border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: 14, colorScheme: 'dark' };
const primary: React.CSSProperties = { padding: '9px 14px', borderRadius: 8, border: 'none', background: '#6366f1', color: 'white', fontWeight: 600, fontSize: 13, cursor: 'pointer', textDecoration: 'none', display: 'inline-block' };
const ghost: React.CSSProperties = { padding: '9px 14px', borderRadius: 8, border: '1px solid #475569', background: 'transparent', color: '#e2e8f0', fontSize: 13, cursor: 'pointer', textDecoration: 'none', display: 'inline-block' };
const chkRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 };
