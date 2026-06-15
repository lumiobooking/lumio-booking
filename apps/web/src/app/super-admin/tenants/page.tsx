'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  timezone: string;
  contactEmail: string | null;
  planId: string | null;
  subscriptionStatus: string;
  createdAt: string;
  _count?: { users: number; staffMembers: number };
}

interface Plan {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
}

export default function TenantsPage() {
  const { token, user, ready, logout } = useAuth();
  const router = useRouter();

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
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
      const [tenantList, planList] = await Promise.all([
        apiFetch<Tenant[]>('/tenants', { token }),
        apiFetch<Plan[]>('/tenants/plans', { token }),
      ]);
      setTenants(tenantList);
      setPlans(planList);
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

  async function setStatus(id: string, action: 'suspend' | 'reactivate') {
    try {
      await apiFetch(`/tenants/${id}/${action}`, { method: 'POST', token });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  }

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
          <h1 style={{ fontSize: 24, margin: 0 }}>Salons (Tenants)</h1>
          <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: 14 }}>
            Super Admin · {user.email}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowForm((s) => !s)} style={primaryBtn}>
            {showForm ? 'Close' : '+ New salon'}
          </button>
          <button onClick={logout} style={ghostBtn}>
            Log out
          </button>
        </div>
      </header>

      {error && <Banner>{error}</Banner>}

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

      <div style={{ overflowX: 'auto', border: '1px solid #334155', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ background: '#1e293b', textAlign: 'left' }}>
              <th style={th}>Name</th>
              <th style={th}>Slug</th>
              <th style={th}>Status</th>
              <th style={th}>Users</th>
              <th style={th}>Created</th>
              <th style={th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {tenants.length === 0 && (
              <tr>
                <td style={td} colSpan={6}>
                  No salons yet. Click “+ New salon”.
                </td>
              </tr>
            )}
            {tenants.map((t) => (
              <tr key={t.id} style={{ borderTop: '1px solid #334155' }}>
                <td style={td}>{t.name}</td>
                <td style={{ ...td, color: '#94a3b8' }}>{t.slug}</td>
                <td style={td}>
                  <StatusBadge status={t.status} />
                </td>
                <td style={td}>{t._count?.users ?? '-'}</td>
                <td style={{ ...td, color: '#94a3b8' }}>
                  {new Date(t.createdAt).toLocaleDateString()}
                </td>
                <td style={td}>
                  {t.status === 'ACTIVE' ? (
                    <button onClick={() => setStatus(t.id, 'suspend')} style={warnBtn}>
                      Suspend
                    </button>
                  ) : (
                    <button onClick={() => setStatus(t.id, 'reactivate')} style={okBtn}>
                      Reactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <a href="https://lumioagency.com/" target="_blank" rel="noopener noreferrer"
        style={{ display: 'block', textAlign: 'center', marginTop: 28, fontSize: 11, color: '#64748b', textDecoration: 'none' }}>
        Powered by <span style={{ color: '#818cf8', fontWeight: 600 }}>Lumio Booking</span>
      </a>
    </main>
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
    timezone: 'America/New_York',
    planId: '',
  });
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
        background: '#1e293b',
        border: '1px solid #334155',
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
        <Field label="Timezone">
          <input
            style={inp}
            value={form.timezone}
            onChange={(e) => update('timezone', e.target.value)}
          />
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
        color: map[status] ?? '#94a3b8',
        border: `1px solid ${map[status] ?? '#94a3b8'}`,
        borderRadius: 999,
        padding: '2px 10px',
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {status}
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNodeLike }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 12, color: '#cbd5e1', marginBottom: 6 }}>
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
        background: '#7f1d1d',
        color: '#fecaca',
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
        color: '#94a3b8',
      }}
    >
      {children}
    </div>
  );
}

type ReactNodeLike = React.ReactNode;

const th: React.CSSProperties = { padding: '12px 14px', fontWeight: 600, color: '#cbd5e1' };
const td: React.CSSProperties = { padding: '12px 14px' };
const inp: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '9px 11px',
  borderRadius: 8,
  border: '1px solid #475569',
  background: '#0f172a',
  color: '#e2e8f0',
  fontSize: 14,
};
const primaryBtn: React.CSSProperties = {
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
  padding: '9px 14px',
  borderRadius: 8,
  border: '1px solid #475569',
  background: 'transparent',
  color: '#e2e8f0',
  fontSize: 13,
  cursor: 'pointer',
};
const warnBtn: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid #eab308',
  background: 'transparent',
  color: '#eab308',
  fontSize: 13,
  cursor: 'pointer',
};
const okBtn: React.CSSProperties = {
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid #22c55e',
  background: 'transparent',
  color: '#22c55e',
  fontSize: 13,
  cursor: 'pointer',
};
