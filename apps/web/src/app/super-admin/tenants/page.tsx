'use client';

import { Fragment, useCallback, useEffect, useState, FormEvent } from 'react';
import MarketBadge from '../../../components/MarketBadge';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { MARKET_OPTIONS, marketOption, marketTag } from '../../../lib/markets';
import { apiFetch } from '../../../lib/api';
import { DateRangeBar, SearchBox, matchesQuery, useDateRange, sortNewest, usePaged, Pager } from '../../../components/ListFilter';
import { TimezonePicker } from '../../../components/TimezonePicker';
import { uiLocale } from '../../../lib/datetime';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  timezone: string;
  contactEmail: string | null;
  businessType?: string;
  market?: string; // US | CA | VN — absent on older rows, which means US
  // Null until someone fills it in; the content engine then falls back to the
  // Settings address, and finally to admitting it does not know.
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  // Gross margin ≈ 100 − commissionPct. Without it the promo engine refuses to
  // name a discount rather than assume a margin.
  commissionPct?: number | null;
  nearbyZips?: string | null;
  planId: string | null;
  subscriptionStatus: string;
  createdAt: string;
  _count?: { users: number; staffMembers: number };
  users?: { email: string }[]; // first SALON_ADMIN — the login email
  billingExempt?: boolean;
  accessUntil?: string | null;
  featureOverrides?: Record<string, boolean>;
  plan?: { name: string; posEnabled: boolean; onlinePaymentEnabled: boolean; multiLocationEnabled: boolean; whiteLabelEnabled: boolean } | null;
  voiceLine?: { lumioNumber: string | null; enabled: boolean } | null; // AI hotline number
}

const OVERRIDE_FEATURES: { key: 'posEnabled' | 'onlinePaymentEnabled' | 'multiLocationEnabled' | 'whiteLabelEnabled'; label: string }[] = [
  { key: 'posEnabled', label: 'POS · Products · Sales report' },
  { key: 'onlinePaymentEnabled', label: 'Online payments' },
  { key: 'multiLocationEnabled', label: 'Multi-location' },
  { key: 'whiteLabelEnabled', label: 'White-label branding' },
];

interface Plan {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
}

interface VoiceUsage {
  tenantId: string; aiCalls: number; aiMinutes: number; smsSent: number;
  monthlyCents: number;
  includedMinutes: number; includedSms: number;
  overageCentsPerMin: number; overageCentsPerSms: number;
  overageMinutes: number; overageSms: number; overageCents: number; hardCap: boolean;
}

export default function TenantsPage() {
  const { token, user, ready, logout } = useAuth();
  const router = useRouter();
  const range = useDateRange('all');
  const [q, setQ] = useState('');
  // '' = every market. This is the "don't show me the other market" control:
  // with dozens of US salons, finding the Vietnamese ones by scrolling is not
  // a workflow, and auditing one market means seeing only that market.
  const [marketFilter, setMarketFilter] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [showAccount, setShowAccount] = useState(false);

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [voiceUsage, setVoiceUsage] = useState<VoiceUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  // Redirect unauthenticated / non-super-admin users.
  useEffect(() => {
    if (!ready) return;
    if (!token) {
      router.replace('/login');
    } else if (user && user.role !== 'SUPER_ADMIN') {
      router.replace('/');
    }
  }, [ready, token, user, router]);

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [tenantList, planList, usageList] = await Promise.all([
        apiFetch<Tenant[]>('/tenants', { token }),
        apiFetch<Plan[]>('/tenants/plans', { token }),
        apiFetch<VoiceUsage[]>('/admin/voice/usage', { token }).catch(() => [] as VoiceUsage[]),
      ]);
      setTenants(tenantList);
      setPlans(planList);
      setVoiceUsage(usageList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tenants');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (ready && token && user?.role === 'SUPER_ADMIN') {
      loadData();
    }
  }, [ready, token, user, loadData]);

  async function changeBiz(id: string, businessType: string) {
    try {
      await apiFetch(`/tenants/${id}`, { method: 'PATCH', token, body: { businessType } });
      await loadData();
    } catch { /* ignore */ }
  }

  async function changePlan(id: string, planId: string) {
    try {
      await apiFetch(`/tenants/${id}`, { method: 'PATCH', token, body: { planId: planId || null } });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change plan');
    }
  }

  async function setStatus(id: string, action: 'suspend' | 'reactivate') {
    try {
      await apiFetch(`/tenants/${id}/${action}`, { method: 'POST', token });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  }

  async function removeTenant(t: Tenant) {
    if (!confirm(`Delete salon "${t.name}"?\n\nIt will be removed from the list and the salon can no longer log in. (Data is archived, not hard-erased.) This cannot be undone from here.`)) return;
    try {
      await apiFetch(`/tenants/${t.id}`, { method: 'DELETE', token });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  // Filter by signup date + search, then newest first. (Computed before the
  // early returns below so the pagination hook runs on every render.)
  const visible = sortNewest(
    tenants.filter(
      (t) =>
        range.inRange(t.createdAt) &&
        // Absent means US: rows created before the column existed.
        (!marketFilter || marketOption(t.market).code === marketFilter) &&
        matchesQuery(`${t.name} ${t.slug} ${t.contactEmail ?? ''} ${t.status} ${marketOption(t.market).label}`, q),
    ),
    (t) => t.createdAt,
  );
  const pg = usePaged(visible, 20);

  if (!ready || (token && user?.role === 'SUPER_ADMIN' && loading)) {
    return <Centered>Loading...</Centered>;
  }
  if (!token || user?.role !== 'SUPER_ADMIN') {
    return <Centered>Redirecting...</Centered>;
  }

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 24px' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><h1 style={{ fontSize: 24, margin: 0 }}>Salons (Tenants)</h1><MarketBadge /><AiDiagButton /></div>
          <p style={{ color: 'var(--c94a3b8)', margin: '4px 0 0', fontSize: 14 }}>
            Super Admin · {user.email}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowAccount((s) => !s)} style={ghostBtn}>
            {showAccount ? 'Close' : 'My account'}
          </button>
          <a href="/super-admin/content" style={{ ...ghostBtn, textDecoration: 'none', display: 'inline-block' }}>
            Nội dung &amp; xu hướng
          </a>
          <a href="/super-admin/plans" style={{ ...ghostBtn, textDecoration: 'none', display: 'inline-block' }}>
            Manage plans
          </a>
          {/* Named for its contents, not for two of its five sections.
              Called "Payment gateways", it also holds platform email, reply
              detection and the image storage every uploaded photo depends on —
              and nobody goes looking for a storage setting under a payments
              button. This one was found by somebody failing to find it. */}
          <a href="/super-admin/billing" style={{ ...ghostBtn, textDecoration: 'none', display: 'inline-block' }}>
            Cài đặt hệ thống
          </a>
          <a href="/super-admin/chains" style={{ ...ghostBtn, textDecoration: 'none', display: 'inline-block' }}>
            Chains
          </a>
          <a href="/super-admin/invoices" style={{ ...ghostBtn, textDecoration: 'none', display: 'inline-block' }}>
            Invoices
          </a>
          <a href="/super-admin/support-accounts" style={{ ...ghostBtn, textDecoration: 'none', display: 'inline-block' }}>
            🛠 Support staff
          </a>
          <a href="/super-admin/email" style={{ ...ghostBtn, textDecoration: 'none', display: 'inline-block' }}>
            Email marketing
          </a>
          <button onClick={() => setShowForm((s) => !s)} style={primaryBtn}>
            {showForm ? 'Close' : '+ New salon'}
          </button>
          <button onClick={logout} style={ghostBtn}>
            Log out
          </button>
        </div>
      </header>

      {error && <Banner>{error}</Banner>}

      {showAccount && <AccountPanel token={token} currentEmail={user.email} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search salon name, slug, email…" />
        <select
          value={marketFilter}
          onChange={(e) => setMarketFilter(e.target.value)}
          style={{ ...inp, width: 'auto', minWidth: 150 }}
          title="Show only salons in one market"
        >
          <option value="">All markets</option>
          {MARKET_OPTIONS.map((m) => (
            <option key={m.code} value={m.code}>{m.label}</option>
          ))}
        </select>
        <span style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>{visible.length} salon{visible.length === 1 ? '' : 's'}</span>
        <DateRangeBar range={range} />
      </div>

      {showForm && (
        <CreateTenantForm
          plans={plans}
          token={token}
          onCreated={async () => {
            setShowForm(false);
            await loadData();
          }}
        />
      )}

      <div style={{ overflowX: 'auto', border: '1px solid var(--c334155)', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: 'var(--c1e293b)', textAlign: 'left' }}>
              <th style={th}>Name</th>
              <th style={th}>Status</th>
              <th style={th}>Plan</th>
              <th style={th}>Users</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td style={td} colSpan={5}>
                  No salons in this range.
                </td>
              </tr>
            )}
            {pg.paged.map((t) => (
              <Fragment key={t.id}>
              <tr style={{ borderTop: '1px solid var(--c334155)' }}>
                <td style={td}>
                  <div style={{ fontWeight: 600, color: 'var(--ce2e8f0)', whiteSpace: 'normal', minWidth: 140 }}>{t.name}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 3, fontSize: 12, color: 'var(--c64748b)' }}>
                    <span title={marketOption(t.market).label}>{marketTag(t.market)}</span>
                    <span>{t.slug}</span>
                    <span>· {new Date(t.createdAt).toLocaleDateString(uiLocale())}</span>
                  </div>
                </td>
                <td style={td}>
                  <StatusBadge status={t.status} />
                </td>
                <td style={td}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <select
                      value={t.planId ?? ''}
                      onChange={(e) => changePlan(t.id, e.target.value)}
                      style={{ ...inp, padding: '5px 8px', width: 'auto', minWidth: 96 }}
                    >
                      <option value="">— No plan —</option>
                      {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <select
                      value={t.businessType ?? 'SALON'}
                      onChange={(e) => changeBiz(t.id, e.target.value)}
                      style={{ ...inp, padding: '5px 8px', width: 'auto', minWidth: 96 }}
                      title="Business type"
                    >
                      <option value="SALON">Salon</option>
                      <option value="RESTAURANT">Restaurant</option>
                      <option value="REAL_ESTATE">Real estate</option>
                      <option value="SERVICE">Other services</option>
                    </select>
                  </div>
                </td>
                <td style={td}>{t._count?.users ?? '-'}</td>
                <td style={td}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap' }}>
                    <button onClick={() => setEditId(editId === t.id ? null : t.id)} style={{ ...primaryBtn, padding: '6px 12px', fontSize: 12, background: editId === t.id ? 'var(--c475569)' : '#6366f1' }}>
                      {editId === t.id ? 'Close' : 'Edit'}
                    </button>
                    {t.status === 'ACTIVE' ? (
                      <button onClick={() => setStatus(t.id, 'suspend')} style={warnBtn}>Suspend</button>
                    ) : (
                      <button onClick={() => setStatus(t.id, 'reactivate')} style={okBtn}>Reactivate</button>
                    )}
                    <button onClick={() => removeTenant(t)} style={dangerBtn}>Delete</button>
                  </div>
                </td>
              </tr>
              {editId === t.id && (
                <tr>
                  <td colSpan={5} style={{ padding: 16, background: 'var(--c0f172a)' }}>
                    <TenantEditPanel token={token} tenant={t} usage={voiceUsage.find((u) => u.tenantId === t.id)} onSaved={loadData} />
                    <ChatPlanPanel token={token} tenantId={t.id} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
        <div style={{ padding: '0 14px 12px' }}><Pager paged={pg} /></div>
      </div>

      <a href="https://lumioagency.com/" target="_blank" rel="noopener noreferrer"
        style={{ display: 'block', textAlign: 'center', marginTop: 28, fontSize: 11, color: 'var(--c64748b)', textDecoration: 'none' }}>
        Powered by <span style={{ color: 'var(--c818cf8)', fontWeight: 600 }}>Lumio Booking</span>
      </a>
    </main>
  );
}

function AccountPanel({ token, currentEmail }: { token: string; currentEmail: string }) {
  const { logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newEmail, setNewEmail] = useState(currentEmail);
  const [newPassword, setNewPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setErr(null); setMsg(null);
    if (!currentPassword) { setErr('Enter your current password to confirm the change.'); return; }
    setBusy(true);
    try {
      const r = await apiFetch<{ ok: boolean; email: string; passwordChanged?: boolean }>('/me/account', {
        method: 'PATCH', token,
        body: { currentPassword, newEmail: newEmail !== currentEmail ? newEmail : undefined, newPassword: newPassword || undefined },
      });
      setCurrentPassword(''); setNewPassword('');
      if (r.passwordChanged) { setMsg('✓ Password changed. Signing you out — please log in again.'); setTimeout(() => logout(), 1400); return; }
      setMsg(`✓ Saved. Login email: ${r.email}.${newPassword ? ' Use your new password next time you log in.' : ''}`);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Update failed'); } finally { setBusy(false); }
  }

  return (
    <div style={{ background: 'var(--c1e293b)', border: '1px solid var(--c334155)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>My account</h2>
      <p style={{ color: 'var(--c94a3b8)', fontSize: 13, marginTop: 0 }}>Change your own Super Admin login email and/or password.</p>
      {err && <Banner>{err}</Banner>}
      {msg && <div style={{ background: 'var(--c14532d)', color: 'var(--cbbf7d0)', padding: '8px 12px', borderRadius: 8, fontSize: 13, margin: '8px 0' }}>{msg}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Login email"><input style={inp} type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} /></Field>
        <Field label="New password (leave blank to keep)"><input style={inp} type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="min 8 chars" /></Field>
        <Field label="Current password (required to confirm)"><input style={inp} type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></Field>
      </div>
      <button onClick={save} disabled={busy} style={{ ...primaryBtn, marginTop: 14 }}>{busy ? 'Saving…' : 'Save account'}</button>
    </div>
  );
}

function TenantEditPanel({ token, tenant, usage, onSaved }: { token: string; tenant: Tenant; usage?: VoiceUsage; onSaved: () => void }) {
  const currentLoginEmail = tenant.users?.[0]?.email ?? '';
  const [form, setForm] = useState({
    name: tenant.name, contactEmail: tenant.contactEmail ?? '', timezone: tenant.timezone,
    market: marketOption(tenant.market).code,
    city: tenant.city ?? '', region: tenant.region ?? '', postalCode: tenant.postalCode ?? '',
    commissionPct: tenant.commissionPct != null ? String(tenant.commissionPct) : '', nearbyZips: tenant.nearbyZips ?? '',
  });
  const [loginEmail, setLoginEmail] = useState(currentLoginEmail);
  const [pw, setPw] = useState('');
  const [exempt, setExempt] = useState(tenant.billingExempt ?? false);
  const [accessUntil, setAccessUntil] = useState(tenant.accessUntil ? tenant.accessUntil.slice(0, 10) : '');
  const [slug, setSlug] = useState(tenant.slug);
  const [ovr, setOvr] = useState<Record<string, 'default' | 'on' | 'off'>>(() => {
    const o = (tenant.featureOverrides ?? {}) as Record<string, unknown>;
    const at = (k: string): 'default' | 'on' | 'off' => (o[k] === true ? 'on' : o[k] === false ? 'off' : 'default');
    return { posEnabled: at('posEnabled'), onlinePaymentEnabled: at('onlinePaymentEnabled'), multiLocationEnabled: at('multiLocationEnabled'), whiteLabelEnabled: at('whiteLabelEnabled') };
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [voiceNum, setVoiceNum] = useState(tenant.voiceLine?.lumioNumber ?? '');
  const [fp, setFp] = useState<{ key: string; label: string; mode: string; unavailable?: boolean }[]>([]);
  const [lim, setLim] = useState({ monthlyCents: 0, includedMinutes: 0, includedSms: 0, overageCentsPerMin: 0, overageCentsPerSms: 0, hardCap: false });

  useEffect(() => {
    apiFetch<{ policy: Record<string, string>; defs: { key: string; label: string; unavailable?: boolean }[] }>(`/admin/feature-policy/${tenant.id}`, { token })
      .then((r) => setFp((r.defs || []).map((d) => ({ key: d.key, label: d.label, mode: r.policy?.[d.key] || 'salon', unavailable: d.unavailable }))))
      .catch(() => {});
  }, [tenant.id, token]);

  useEffect(() => {
    if (usage) setLim({ monthlyCents: usage.monthlyCents, includedMinutes: usage.includedMinutes, includedSms: usage.includedSms, overageCentsPerMin: usage.overageCentsPerMin, overageCentsPerSms: usage.overageCentsPerSms, hardCap: usage.hardCap });
  }, [usage]);

  async function saveLimits() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      await apiFetch('/admin/voice/limits', { method: 'POST', token, body: { tenantId: tenant.id, ...lim } });
      setMsg('✓ AI plan limits saved.');
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save limits'); } finally { setBusy(false); }
  }

  async function saveVoice() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch<{ lumioNumber: string }>('/admin/voice/provision', { method: 'POST', token, body: { tenantId: tenant.id, lumioNumber: voiceNum.trim() } });
      setMsg(`✓ AI Hotline number assigned: ${r.lumioNumber}. The salon can now enable it and forward their line to it.`);
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not assign number'); } finally { setBusy(false); }
  }

  async function saveFeaturePolicy() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const policy: Record<string, string> = {};
      for (const f of fp) policy[f.key] = f.mode;
      await apiFetch('/admin/feature-policy', { method: 'POST', token, body: { tenantId: tenant.id, policy } });
      setMsg('✓ Feature access updated.');
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not update feature access'); } finally { setBusy(false); }
  }

  async function saveAccess() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch<{ status: string }>(`/tenants/${tenant.id}/access`, { method: 'POST', token, body: { billingExempt: exempt, accessUntil: accessUntil || null } });
      setMsg(`✓ Access updated — salon is now ${r.status}.`);
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not update access'); } finally { setBusy(false); }
  }

  async function saveOverrides() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const overrides: Record<string, boolean | null> = {};
      for (const k of Object.keys(ovr)) overrides[k] = ovr[k] === 'default' ? null : ovr[k] === 'on';
      await apiFetch(`/tenants/${tenant.id}/feature-overrides`, { method: 'POST', token, body: { overrides } });
      setMsg('✓ Feature overrides saved. The salon sees the change on next load.');
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not save overrides'); } finally { setBusy(false); }
  }

  async function saveSlug() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch<{ slug: string }>(`/tenants/${tenant.id}`, { method: 'PATCH', token, body: { slug } });
      setMsg(`✓ Booking URL is now /book/${r.slug}. Update the WordPress embed and any shared links to match.`);
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not change the booking URL'); } finally { setBusy(false); }
  }

  async function saveInfo() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      await apiFetch(`/tenants/${tenant.id}`, { method: 'PATCH', token, body: {
        name: form.name, contactEmail: form.contactEmail || undefined, timezone: form.timezone, market: form.market,
        // Sent even when blank: clearing a wrong city has to be possible.
        city: form.city, region: form.region, postalCode: form.postalCode,
        commissionPct: form.commissionPct, nearbyZips: form.nearbyZips,
      } });
      setMsg('✓ Salon info saved');
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed'); } finally { setBusy(false); }
  }
  async function saveLoginEmail() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch<{ email: string }>(`/tenants/${tenant.id}/admin-email`, { method: 'POST', token, body: { email: loginEmail } });
      setMsg(`✓ Login email changed to ${r.email}. The salon now signs in with this email.`);
      onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not change login email'); } finally { setBusy(false); }
  }
  async function resetPw() {
    if (pw.length < 8) { setErr('Password must be at least 8 characters'); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch<{ email: string }>(`/tenants/${tenant.id}/reset-admin-password`, { method: 'POST', token, body: { password: pw } });
      setMsg(`✓ Password reset for ${r.email}. Share the new password with the salon.`);
      setPw('');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Reset failed'); } finally { setBusy(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontWeight: 600, color: 'var(--ccbd5e1)' }}>Edit {tenant.name}</div>
      {err && <Banner>{err}</Banner>}
      {msg && <div style={{ background: 'var(--c14532d)', color: 'var(--cbbf7d0)', padding: '8px 12px', borderRadius: 8, fontSize: 13 }}>{msg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Field label="Salon name"><input style={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Contact email"><input style={inp} value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></Field>
        <Field label="Timezone"><TimezonePicker value={form.timezone} onChange={(tz) => setForm({ ...form, timezone: tz })} selectStyle={inp} /></Field>
      </div>
      <Field label="Market">
        <select
          style={{ ...inp, maxWidth: 260 }}
          value={form.market}
          onChange={(e) => setForm((f) => ({ ...f, market: e.target.value }))}
        >
          {MARKET_OPTIONS.map((m) => (
            <option key={m.code} value={m.code}>{m.label}</option>
          ))}
        </select>
      </Field>
      <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '2px 0 8px', maxWidth: 520, lineHeight: 1.5 }}>
        Changes the label and which features are offered. It deliberately does{' '}
        <strong>not</strong> rewrite currency, prices or timezone — this salon already
        has priced services and booked appointments, and rewriting its currency
        would change what real customers are charged. Adjust money under the
        salon&apos;s own Settings if it needs to follow.
      </p>
      <div style={{ borderTop: '1px solid var(--c334155)', paddingTop: 14 }}>
        <div style={{ fontWeight: 600, color: 'var(--ccbd5e1)', marginBottom: 4 }}>Location — drives the content calendar</div>
        <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '0 0 8px', maxWidth: 560, lineHeight: 1.5 }}>
          School start weeks, prom season and local holidays differ by state, so the daily
          content engine needs to know where this salon is. Leave blank and it reads the
          address from the salon&apos;s Settings; if that cannot be read either, it says
          &quot;chưa rõ khu vực&quot; on screen rather than guessing a place.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
          <Field label="City"><input style={inp} value={form.city} placeholder="Garden Grove" onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
          <Field label="State / province code"><input style={inp} value={form.region} placeholder="CA" maxLength={8} onChange={(e) => setForm({ ...form, region: e.target.value.toUpperCase() })} /></Field>
          <Field label="ZIP / postal code"><input style={inp} value={form.postalCode} placeholder="92840" onChange={(e) => setForm({ ...form, postalCode: e.target.value })} /></Field>
          {/* The nearby-ZIP list feeds one thing: US Census demographics. There
              are none for Vietnam, so on a VN tenant this field asks for work
              that produces nothing. The ZIP itself stays — a Vietnamese salon
              still has a postal code, and the address is worth having. */}
          {form.market !== 'VN' && (
            <Field label="Nearby ZIPs (comma separated)"><input style={inp} value={form.nearbyZips} placeholder="92841, 92843, 92683" onChange={(e) => setForm({ ...form, nearbyZips: e.target.value })} /></Field>
          )}
        </div>
        {form.market !== 'VN' && (
        <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '8px 0 0', maxWidth: 560, lineHeight: 1.5 }}>
          Area demographics are fetched per ZIP from the US Census. Nothing here draws a
          five-mile circle &mdash; ZIP boundaries follow postal routes, not radii &mdash; so add the
          neighbouring ZIPs by hand and the screen will say &quot;các ZIP quanh tiệm&quot; rather than
          claim a radius it did not measure.
        </p>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--c334155)', paddingTop: 14 }}>
        <div style={{ fontWeight: 600, color: 'var(--ccbd5e1)', marginBottom: 4 }}>Technician commission &mdash; decides every discount</div>
        <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '0 0 8px', maxWidth: 560, lineHeight: 1.5 }}>
          Share of service revenue paid to the tech, so gross margin is roughly 100 minus
          this. At a 40% margin a 20% discount needs the salon to <strong>double</strong> its
          customers just to break even, and a 40% discount can never break even at all.
          Leave this blank and the engine refuses to propose any discount &mdash; an assumed
          margin produces a break-even that looks like arithmetic and is not.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', maxWidth: 260 }}>
          <input
            style={inp}
            value={form.commissionPct}
            placeholder="60"
            inputMode="numeric"
            onChange={(e) => setForm({ ...form, commissionPct: e.target.value.replace(/[^0-9]/g, '') })}
          />
          <span style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>% &rarr; margin {(() => {
            const n = Number(form.commissionPct);
            return Number.isFinite(n) && n > 0 && n < 100 ? `${100 - Math.round(n)}%` : '—';
          })()}</span>
        </div>
      </div>

      <div><button onClick={saveInfo} disabled={busy} style={primaryBtn}>Save salon info</button></div>

      <div style={{ borderTop: '1px solid var(--c334155)', paddingTop: 14 }}>
        <div style={{ fontWeight: 600, color: 'var(--ccbd5e1)', marginBottom: 4 }}>Login email (how the salon signs in)</div>
        <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '0 0 8px' }}>
          This is the salon admin&apos;s sign-in email — different from the contact email above. Current: <strong style={{ color: 'var(--ccbd5e1)' }}>{currentLoginEmail || '—'}</strong>
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input style={{ ...inp, maxWidth: 320 }} type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="new-login@email.com" />
          <button onClick={saveLoginEmail} disabled={busy || !loginEmail || loginEmail === currentLoginEmail} style={primaryBtn}>Change login email</button>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--c334155)', paddingTop: 14 }}>
        <div style={{ fontWeight: 600, color: 'var(--ccbd5e1)', marginBottom: 4 }}>Booking URL (slug)</div>
        <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '0 0 8px' }}>
          Public booking address: <strong style={{ color: 'var(--ccbd5e1)' }}>lumiobooking.com/book/{tenant.slug}</strong>. Changing it moves the page — you must also update the WordPress embed and any shared / printed links, or the old ones will 404.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--c64748b)', fontSize: 13 }}>/book/</span>
          <input style={{ ...inp, maxWidth: 300 }} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="aura-nail-lab" />
          <button onClick={saveSlug} disabled={busy || slug.length < 2 || slug === tenant.slug} style={primaryBtn}>Save URL</button>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--c334155)', paddingTop: 14 }}>
        <div style={{ fontWeight: 600, color: 'var(--ccbd5e1)', marginBottom: 4 }}>Access control</div>
        <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '0 0 8px' }}>
          Grant free access, or set a date after which the salon is locked until you renew. Overrides billing.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 10 }}>
          <input type="checkbox" checked={exempt} onChange={(e) => setExempt(e.target.checked)} />
          <span><strong>Free access</strong> — no payment required, always open</span>
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>Locked after:</label>
          <input type="date" value={accessUntil} disabled={exempt} onChange={(e) => setAccessUntil(e.target.value)} style={{ ...inp, width: 'auto', opacity: exempt ? 0.5 : 1 }} />
          {accessUntil && !exempt && <button onClick={() => setAccessUntil('')} style={ghostBtn}>Clear</button>}
          <button onClick={saveAccess} disabled={busy} style={primaryBtn}>Save access</button>
        </div>
        <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '6px 0 0' }}>
          Current: {tenant.billingExempt ? 'Free access' : tenant.accessUntil ? `locks after ${new Date(tenant.accessUntil).toLocaleDateString(uiLocale())}` : 'billing-controlled'} · status {tenant.status}
        </p>
      </div>

      <div style={{ borderTop: '1px solid var(--c334155)', paddingTop: 14 }}>
        <div style={{ fontWeight: 600, color: 'var(--ccbd5e1)', marginBottom: 4 }}>Plan feature overrides</div>
        <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '0 0 10px' }}>
          Grant or remove a feature for THIS salon only. “Default” follows the {tenant.plan?.name ?? 'current'} plan; “On/Off” overrides it — e.g. give a Starter salon POS as an add-on.
        </p>
        <div style={{ display: 'grid', gap: 8 }}>
          {OVERRIDE_FEATURES.map((ft) => {
            const planOn = tenant.plan ? !!tenant.plan[ft.key] : true;
            const sel = ovr[ft.key] ?? 'default';
            const effOn = sel === 'on' ? true : sel === 'off' ? false : planOn;
            return (
              <div key={ft.key} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ minWidth: 190, fontSize: 13.5, color: 'var(--ce2e8f0)' }}>{ft.label}</span>
                <span style={{ fontSize: 11.5, color: 'var(--c64748b)', minWidth: 66 }}>plan: {planOn ? 'On' : 'Off'}</span>
                <select value={sel} onChange={(e) => setOvr({ ...ovr, [ft.key]: e.target.value as 'default' | 'on' | 'off' })} style={{ ...inp, width: 'auto' }}>
                  <option value="default">Default (follow plan)</option>
                  <option value="on">Force ON</option>
                  <option value="off">Force OFF</option>
                </select>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: effOn ? 'var(--c4ade80)' : 'var(--cf87171)' }}>{effOn ? 'ENABLED' : 'OFF'}</span>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 10 }}><button onClick={saveOverrides} disabled={busy} style={primaryBtn}>Save feature overrides</button></div>
      </div>

      <div style={{ borderTop: '1px solid var(--c334155)', paddingTop: 14 }}>
        <div style={{ fontWeight: 600, color: 'var(--ccbd5e1)', marginBottom: 4 }}>📞 AI Hotline number</div>
        <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '0 0 8px' }}>
          Assign a Lumio voice number (E.164). The salon forwards its own line to this number and the AI answers.{' '}
          {tenant.voiceLine?.lumioNumber
            ? <>Current: <strong style={{ color: 'var(--ca5b4fc)' }}>{tenant.voiceLine.lumioNumber}</strong> · {tenant.voiceLine.enabled ? 'enabled' : 'off'}</>
            : 'Not assigned yet.'}
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input style={{ ...inp, maxWidth: 260 }} value={voiceNum} onChange={(e) => setVoiceNum(e.target.value)} placeholder="+14085551234" />
          <button onClick={saveVoice} disabled={busy || !voiceNum.trim()} style={primaryBtn}>Assign number</button>
        </div>
        {usage && (
          <p style={{ color: 'var(--c94a3b8)', fontSize: 12.5, margin: '10px 0 0' }}>
            This month: <strong style={{ color: 'var(--ce2e8f0)' }}>{usage.aiCalls}</strong> calls · <strong style={{ color: 'var(--ce2e8f0)' }}>{usage.aiMinutes}</strong> AI min · <strong style={{ color: 'var(--ce2e8f0)' }}>{usage.smsSent}</strong> SMS
            {usage.overageCents > 0 && <span style={{ color: 'var(--cfca5a5)' }}> · overage ~${(usage.overageCents / 100).toFixed(2)}</span>}
          </p>
        )}

        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--c818cf8)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>AI plan limits (0 = unlimited)</div>
        <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
          <label style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>AI Hotline fee $ / mo
            <input type="number" min={0} step={1} value={(lim.monthlyCents / 100) || 0} onChange={(e) => setLim({ ...lim, monthlyCents: Math.round((Number(e.target.value) || 0) * 100) })} style={{ ...inp, marginTop: 4 }} />
          </label>
          <label style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>Included minutes / mo
            <input type="number" min={0} value={lim.includedMinutes} onChange={(e) => setLim({ ...lim, includedMinutes: Number(e.target.value) || 0 })} style={{ ...inp, marginTop: 4 }} />
          </label>
          <label style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>Included SMS / mo
            <input type="number" min={0} value={lim.includedSms} onChange={(e) => setLim({ ...lim, includedSms: Number(e.target.value) || 0 })} style={{ ...inp, marginTop: 4 }} />
          </label>
          <label style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>Overage ¢ / min
            <input type="number" min={0} value={lim.overageCentsPerMin} onChange={(e) => setLim({ ...lim, overageCentsPerMin: Number(e.target.value) || 0 })} style={{ ...inp, marginTop: 4 }} />
          </label>
          <label style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>Overage ¢ / SMS
            <input type="number" min={0} value={lim.overageCentsPerSms} onChange={(e) => setLim({ ...lim, overageCentsPerSms: Number(e.target.value) || 0 })} style={{ ...inp, marginTop: 4 }} />
          </label>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '10px 0' }}>
          <input type="checkbox" checked={lim.hardCap} onChange={(e) => setLim({ ...lim, hardCap: e.target.checked })} />
          <span><strong>Hard cap</strong> — block new AI calls once over included minutes</span>
        </label>
        <button onClick={saveLimits} disabled={busy} style={primaryBtn}>Save plan limits</button>
      </div>

      <div style={{ borderTop: '1px solid var(--c334155)', paddingTop: 14 }}>
        <div style={{ fontWeight: 600, color: 'var(--ccbd5e1)', marginBottom: 4 }}>Reset salon admin password</div>
        <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '0 0 8px' }}>Sets a new login password for this salon’s admin account. Give it to the salon owner.</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input style={{ ...inp, maxWidth: 260 }} type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (min 8 chars)" />
          <button onClick={resetPw} disabled={busy} style={warnBtn}>Reset password</button>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--c334155)', paddingTop: 14 }}>
        <div style={{ fontWeight: 600, color: 'var(--ccbd5e1)', marginBottom: 4 }}>🔒 Feature access</div>
        <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '0 0 8px' }}>
          Uncheck to make a feature <strong>platform-managed</strong> — it disappears from this salon&apos;s dashboard and salon edits are blocked at the API. Checked = the salon self-manages it.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {fp.map((f, i) => (
            <label
              key={f.key}
              title={f.unavailable ? 'Not available in this salon\u2019s market' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, opacity: f.unavailable ? 0.45 : 1 }}
            >
              {/* Disabled rather than hidden: seeing that a feature exists but
                  is not sold here is more useful than wondering where it went,
                  and it stops someone selling a Hanoi salon a US card terminal. */}
              <input type="checkbox" checked={f.mode === 'salon' && !f.unavailable} disabled={f.unavailable}
                onChange={(e) => setFp((rows) => rows.map((r, idx) => (idx === i ? { ...r, mode: e.target.checked ? 'salon' : 'platform' } : r)))} />
              <span>{f.label} — {f.unavailable
                ? <span style={{ color: 'var(--c64748b)', fontWeight: 600 }}>Not available in this market</span>
                : <span style={{ color: f.mode === 'salon' ? 'var(--ink-good)' : 'var(--ink-warn)', fontWeight: 600 }}>{f.mode === 'salon' ? 'Salon can manage' : 'Platform-managed (hidden)'}</span>}</span>
            </label>
          ))}
        </div>
        <button onClick={saveFeaturePolicy} disabled={busy || fp.length === 0} style={primaryBtn}>Save feature access</button>
      </div>
    </div>
  );
}

function CreateTenantForm({
  plans,
  token,
  onCreated,
}: {
  plans: Plan[];
  token: string;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    name: '',
    adminEmail: '',
    adminPassword: '',
    market: 'US',
    timezone: 'America/New_York',
    planId: '',
  });

  // Picking a market moves the timezone with it, visibly, so the operator sees
  // what they are getting and can still override it before submitting. The
  // currency, decimals, country and tipping default are applied server-side —
  // one source of truth for what a market means.
  function pickMarket(code: string) {
    setForm((f) => ({ ...f, market: code, timezone: marketOption(code).timezone }));
  }
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch('/tenants', {
        method: 'POST',
        token,
        body: {
          name: form.name,
          adminEmail: form.adminEmail,
          adminPassword: form.adminPassword,
          market: form.market,
          timezone: form.timezone,
          planId: form.planId || undefined,
        },
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{
        background: 'var(--c1e293b)',
        border: '1px solid var(--c334155)',
        borderRadius: 12,
        padding: 20,
        marginBottom: 20,
      }}
    >
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Create a new salon</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Salon name">
          <input style={inp} value={form.name} onChange={(e) => update('name', e.target.value)} required />
        </Field>
        <Field label="Market — sets currency, timezone, language and tipping">
          <select style={inp} value={form.market} onChange={(e) => pickMarket(e.target.value)}>
            {MARKET_OPTIONS.map((m) => (
              <option key={m.code} value={m.code}>{m.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Timezone">
          <TimezonePicker value={form.timezone} onChange={(tz) => update('timezone', tz)} selectStyle={inp} />
        </Field>
        <Field label="Salon admin email">
          <input
            style={inp}
            type="email"
            value={form.adminEmail}
            onChange={(e) => update('adminEmail', e.target.value)}
            required
          />
        </Field>
        <Field label="Salon admin password (min 8)">
          <input
            style={inp}
            type="password"
            value={form.adminPassword}
            onChange={(e) => update('adminPassword', e.target.value)}
            required
            minLength={8}
          />
        </Field>
        <Field label="Plan (optional)">
          <select style={inp} value={form.planId} onChange={(e) => update('planId', e.target.value)}>
            <option value="">— No plan —</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (${(p.priceCents / 100).toFixed(0)}/mo)
              </option>
            ))}
          </select>
        </Field>
      </div>
      {error && <Banner>{error}</Banner>}
      <button type="submit" disabled={submitting} style={{ ...primaryBtn, marginTop: 14 }}>
        {submitting ? 'Creating...' : 'Create salon'}
      </button>
    </form>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE: '#22c55e',
    SUSPENDED: '#eab308',
    CANCELLED: '#ef4444',
  };
  return (
    <span
      style={{
        color: map[status] ?? 'var(--c94a3b8)',
        border: `1px solid ${map[status] ?? 'var(--c94a3b8)'}`,
        borderRadius: 999,
        padding: '2px 10px',
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        display: 'inline-block',
      }}
    >
      {status}
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNodeLike }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 12, color: 'var(--ccbd5e1)', marginBottom: 6 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Banner({ children }: { children: ReactNodeLike }) {
  return (
    <div
      style={{
        background: 'var(--c7f1d1d)',
        color: 'var(--cfecaca)',
        padding: '8px 12px',
        borderRadius: 8,
        fontSize: 13,
        margin: '12px 0',
      }}
    >
      {children}
    </div>
  );
}

function Centered({ children }: { children: ReactNodeLike }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--c94a3b8)',
      }}
    >
      {children}
    </div>
  );
}

type ReactNodeLike = React.ReactNode;

/**
 * "Is the platform's AI brain alive?" — one click, one honest answer.
 * Every tenant shares ONE Anthropic key; when it dies (expired, out of
 * credit), every hotline and messenger bot degrades at once and each salon
 * looks individually broken. This button ends the guessing.
 */
function AiDiagButton() {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  async function run() {
    setBusy(true); setRes(null);
    try {
      const r = await apiFetch<{ keyPresent: boolean; model: string; ok: boolean; status: number | null; error: string | null }>('/admin/voice/ai-diag', { token });
      setOk(r.ok);
      setRes(r.ok
        ? `✓ AI hoạt động bình thường (${r.model})`
        : !r.keyPresent
          ? '✗ ANTHROPIC_API_KEY chưa được cài trên service này — thêm vào Render env.'
          : `✗ AI CHẾT — Anthropic trả ${r.status ?? 'lỗi mạng'}: ${r.error ?? ''}`.slice(0, 220));
    } catch (e) { setOk(false); setRes(`✗ ${e instanceof Error ? e.message : 'error'}`); }
    finally { setBusy(false); }
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <button onClick={run} disabled={busy} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 12.5, cursor: busy ? 'wait' : 'pointer' }}>
        {busy ? 'Đang kiểm tra…' : '🧠 Kiểm tra não AI'}
      </button>
      {res && <span style={{ fontSize: 12.5, fontWeight: 700, color: ok ? 'var(--ink-good)' : 'var(--cfca5a5)', maxWidth: 520 }}>{res}</span>}
    </span>
  );
}

// ---- the AI chatbot plan ----------------------------------------------------

interface ChatTierRow {
  id: string; vi: string; en: string; currency: string;
  monthlyCents: number; includedReplies: number; overageCentsPerReply: number;
}
interface ChatPlanView {
  tenantId: string; market: string; currency: string; costPerReply: number;
  plan: { monthlyCents: number; includedReplies: number; overageCentsPerReply: number; hardCap: boolean; active: boolean };
  tierId: string | null;
  tiers: ChatTierRow[];
  repliesThisMonth: number;
  bill: { totalCents: number; overageReplies: number; overageCents: number };
  margin: number;
}

/**
 * Sell the chatbot to one salon.
 *
 * WHY THE MARGIN IS SHOWN AT THE SALON'S OWN VOLUME
 *
 * A price list says what a tier earns at its allowance. That is not the
 * question being answered here. This screen is open because somebody is about
 * to quote THIS salon, whose inbox is already running at some real number of
 * replies a month, and the only figure that matters is what the deal earns at
 * that number. A tier that looks comfortable on paper can be thin at three
 * times its allowance, and nothing on a price list would say so.
 *
 * The cost per reply is deliberately the pessimistic one — the measured cost
 * rounded well up — so the margin printed here is a floor rather than a hope.
 */
function ChatPlanPanel({ token, tenantId }: { token: string; tenantId: string }) {
  const [v, setV] = useState<ChatPlanView | null>(null);
  const [form, setForm] = useState({ monthlyCents: 0, includedReplies: 0, overageCentsPerReply: 0, hardCap: false, active: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<ChatPlanView>(`/billing/chat-plan/${tenantId}`, { token });
      setV(r);
      setForm({ ...r.plan });
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not load the chat plan'); }
  }, [token, tenantId]);
  useEffect(() => { void load(); }, [load]);

  if (err && !v) return <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--cfca5a5)' }}>{err}</div>;
  if (!v) return <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--c64748b)' }}>Loading chat plan…</div>;

  const cur = v.currency;
  const nf = new Intl.NumberFormat(uiLocale(), { style: 'currency', currency: cur });
  const digits = nf.resolvedOptions().maximumFractionDigits ?? 2;
  // The đồng has no subunit, so the stored number IS the amount. Dividing it
  // is the bug that printed a 2,690,000₫ plan as 26,900₫.
  const money = (n: number) => nf.format(digits === 0 ? Math.round(n || 0) : (n || 0) / 10 ** digits);
  const unit = digits === 0 ? '₫' : '¢';

  // What THIS salon would pay on the numbers currently in the form, at the
  // volume it is actually running — recomputed locally so the answer moves as
  // the fields are typed, rather than only after a save.
  const used = v.repliesThisMonth;
  const over = form.includedReplies > 0 ? Math.max(0, used - form.includedReplies) : used;
  const overCents = form.hardCap ? 0 : over * form.overageCentsPerReply;
  const totalCents = form.active ? form.monthlyCents + overCents : 0;
  const costCents = used * v.costPerReply;
  const margin = totalCents > 0 ? (totalCents - costCents) / totalCents : 0;
  const marginColor = margin >= 0.5 ? 'var(--ink-good)' : margin >= 0.25 ? 'var(--ink-warn)' : 'var(--ink-bad)';
  const belowCost = form.active && form.overageCentsPerReply > 0 && form.overageCentsPerReply <= v.costPerReply;

  async function save() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await apiFetch<ChatPlanView>(`/billing/chat-plan/${tenantId}`, { method: 'POST', token, body: form });
      setV(r); setForm({ ...r.plan });
      setMsg('Saved. The salon sees this on its own Billing → Usage screen.');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  }

  const num = (label: string, key: 'monthlyCents' | 'includedReplies' | 'overageCentsPerReply', hint: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 140 }}>
      <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>{label}</span>
      <input type="number" min={0} value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: Math.max(0, parseInt(e.target.value, 10) || 0) })}
        style={{ ...inp, padding: '6px 8px', fontSize: 13 }} />
      <span style={{ fontSize: 10.5, color: 'var(--c64748b)' }}>{hint}</span>
    </label>
  );

  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--c334155)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ce2e8f0)' }}>AI Messenger — gói &amp; tính tiền</span>
        <span style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>
          {v.market} · {cur} · {used.toLocaleString()} tin bot trả lời tháng này · vốn {money(v.costPerReply)}/tin
        </span>
      </div>

      {/* The ladder. One press fills the three fields; nothing is saved until
          Save, so a mis-click is not a billing change. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {v.tiers.map((t) => {
          const on = form.monthlyCents === t.monthlyCents && form.includedReplies === t.includedReplies && form.overageCentsPerReply === t.overageCentsPerReply;
          return (
            <button key={t.id}
              onClick={() => setForm({ ...form, monthlyCents: t.monthlyCents, includedReplies: t.includedReplies, overageCentsPerReply: t.overageCentsPerReply, active: true })}
              style={{
                textAlign: 'left', cursor: 'pointer', borderRadius: 10, padding: '8px 11px',
                border: `1px solid ${on ? '#6366f1' : 'var(--c334155)'}`,
                background: on ? 'rgba(99,102,241,0.14)' : 'transparent', color: 'var(--ce2e8f0)',
              }}>
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{t.vi}</div>
              <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>
                {money(t.monthlyCents)} · {t.includedReplies.toLocaleString()} tin · vượt {money(t.overageCentsPerReply)}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start', marginBottom: 10 }}>
        {num('Phí cứng / tháng', 'monthlyCents', `tính bằng ${digits === 0 ? 'đồng' : 'cent'}`)}
        {num('Tin kèm trong gói', 'includedReplies', '0 = tính tiền mọi tin')}
        {num(`Giá vượt / tin (${unit})`, 'overageCentsPerReply', `vốn ${money(v.costPerReply)}`)}
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ccbd5e1)' }}>
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Bật tính tiền cho tiệm này
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ccbd5e1)' }} title="Hết hạn mức thì KHÔNG tính tiền vượt — tiệm dùng tiếp miễn phí, phần chênh anh chịu.">
          <input type="checkbox" checked={form.hardCap} onChange={(e) => setForm({ ...form, hardCap: e.target.checked })} />
          Không tính tiền phần vượt
        </label>
      </div>

      {/* What the deal earns at this salon's real volume. */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', padding: '9px 12px', borderRadius: 10, background: 'var(--c1e293b)', marginBottom: 10 }}>
        <Fig label="Tiệm trả tháng này" value={money(totalCents)} />
        <Fig label="Vượt" value={`${over.toLocaleString()} tin · ${money(overCents)}`} />
        <Fig label="Vốn API" value={money(costCents)} />
        <Fig label="Biên lợi nhuận" value={`${Math.round(margin * 100)}%`} color={totalCents > 0 ? marginColor : 'var(--c64748b)'} />
      </div>

      {belowCost && (
        <div style={{ fontSize: 12, color: 'var(--ink-bad)', marginBottom: 8, lineHeight: 1.5 }}>
          ⚠ Giá vượt {money(form.overageCentsPerReply)} thấp hơn hoặc bằng giá vốn {money(v.costPerReply)}/tin — mỗi tin vượt là một tin lỗ.
        </div>
      )}
      {form.hardCap && form.active && (
        <div style={{ fontSize: 12, color: 'var(--ink-warn)', marginBottom: 8, lineHeight: 1.5 }}>
          Lưu ý: bot KHÔNG ngưng trả lời khi hết hạn mức — nó chạy tiếp và phần vượt không tính tiền, tức anh bao phần đó.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={save} disabled={busy} style={{ ...primaryBtn, padding: '8px 16px', fontSize: 13, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Đang lưu…' : 'Lưu gói'}
        </button>
        <button onClick={() => setForm({ ...v.plan })} style={{ ...ghostBtn, padding: '8px 14px', fontSize: 13 }}>Huỷ sửa</button>
        {msg && <span style={{ fontSize: 12, color: 'var(--ink-good)' }}>{msg}</span>}
        {err && <span style={{ fontSize: 12, color: 'var(--cfca5a5)' }}>{err}</span>}
      </div>
    </div>
  );
}

function Fig({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: 'var(--c64748b)', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: color ?? 'var(--ce2e8f0)' }}>{value}</div>
    </div>
  );
}

const th: React.CSSProperties = { padding: '10px 12px', fontWeight: 600, color: 'var(--ccbd5e1)', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '10px 12px', whiteSpace: 'nowrap', verticalAlign: 'middle' };
const inp: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '9px 11px',
  borderRadius: 8,
  border: '1px solid var(--c475569)',
  background: 'var(--c0f172a)',
  color: 'var(--ce2e8f0)',
  fontSize: 14,
};
const primaryBtn: React.CSSProperties = {
  whiteSpace: 'nowrap',
  flexShrink: 0,
  padding: '9px 14px',
  borderRadius: 8,
  border: 'none',
  background: '#6366f1',
  color: 'white',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  whiteSpace: 'nowrap',
  flexShrink: 0,
  padding: '9px 14px',
  borderRadius: 8,
  border: '1px solid var(--c475569)',
  background: 'transparent',
  color: 'var(--ce2e8f0)',
  fontSize: 13,
  cursor: 'pointer',
};
const warnBtn: React.CSSProperties = {
  whiteSpace: 'nowrap',
  flexShrink: 0,
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid #eab308',
  background: 'transparent',
  color: 'var(--ceab308)',
  fontSize: 13,
  cursor: 'pointer',
};
const dangerBtn: React.CSSProperties = {
  whiteSpace: 'nowrap',
  flexShrink: 0,
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid #ef4444',
  background: 'transparent',
  color: 'var(--ink-bad)',
  fontSize: 13,
  cursor: 'pointer',
};
const okBtn: React.CSSProperties = {
  whiteSpace: 'nowrap',
  flexShrink: 0,
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid #22c55e',
  background: 'transparent',
  color: 'var(--ink-good)',
  fontSize: 13,
  cursor: 'pointer',
};
