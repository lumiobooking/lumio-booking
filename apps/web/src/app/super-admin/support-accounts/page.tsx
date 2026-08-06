'use client';

// Super Admin: manage Lumio SUPPORT staff accounts. One email per employee —
// audit logs name the person, and switching one account off revokes their
// access to every salon at once.

import { useCallback, useEffect, useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';

interface Account {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export default function SupportAccountsPage() {
  const { token, user, ready } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', password: '', firstName: '', lastName: '' });

  const load = useCallback(async () => {
    if (!token) return;
    try { setRows(await apiFetch<Account[]>('/support/accounts', { token })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => {
    if (!ready) return;
    if (!user || user.role !== 'SUPER_ADMIN') { router.replace('/login'); return; }
    load();
  }, [ready, user, router, load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy('new'); setError(null); setMsg(null);
    try {
      await apiFetch('/support/accounts', { method: 'POST', token, body: form });
      setMsg(`Created ${form.email}. Send them the password yourself — it is not shown again.`);
      setForm({ email: '', password: '', firstName: '', lastName: '' });
      await load();
    } catch (e2) { setError(e2 instanceof Error ? e2.message : 'Create failed'); }
    finally { setBusy(null); }
  }

  async function toggle(a: Account) {
    if (!token) return;
    setBusy(a.id); setError(null);
    try {
      await apiFetch(`/support/accounts/${a.id}/active`, { method: 'POST', token, body: { isActive: !a.isActive } });
      await load();
    } catch (e2) { setError(e2 instanceof Error ? e2.message : 'Update failed'); }
    finally { setBusy(null); }
  }

  if (!ready || loading) return <main style={screen}><div style={{ color: '#94a3b8' }}>Loading…</div></main>;

  return (
    <main style={{ minHeight: '100vh', background: '#0b1120', color: '#e2e8f0', padding: '28px 16px' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>Support accounts</h1>
          <a href="/super-admin/tenants" style={{ marginLeft: 'auto', color: '#818cf8', fontSize: 13.5, textDecoration: 'none' }}>← Tenants</a>
        </div>
        <p style={{ color: '#94a3b8', fontSize: 14, margin: '0 0 18px' }}>
          Setup staff log in with these and enter salons from the <b>/agency</b> page. They cannot touch plans, billing or tenant management.
        </p>

        {error && <div style={{ background: '#7f1d1d', color: '#fecaca', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 12 }}>{error}</div>}
        {msg && <div style={{ background: '#14532d', color: '#bbf7d0', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 12 }}>{msg}</div>}

        <form onSubmit={create} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, background: '#111827', border: '1px solid #1f2937', borderRadius: 12, padding: 14, marginBottom: 18 }}>
          <input required type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={input} />
          <input required type="text" placeholder="Password (min 8)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={input} />
          <input placeholder="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} style={input} />
          <input placeholder="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} style={input} />
          <button type="submit" disabled={busy === 'new'} style={{ background: '#6366f1', border: 'none', color: 'white', borderRadius: 8, padding: '10px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: busy === 'new' ? 0.5 : 1 }}>
            {busy === 'new' ? '…' : '+ Create'}
          </button>
        </form>

        <div style={{ border: '1px solid #1f2937', borderRadius: 12, overflow: 'hidden' }}>
          {rows.length === 0 && <div style={{ padding: 18, color: '#64748b', fontSize: 14 }}>No support accounts yet.</div>}
          {rows.map((a) => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid #1f2937', background: '#111827' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14.5 }}>{`${a.firstName ?? ''} ${a.lastName ?? ''}`.trim() || a.email}</div>
                <div style={{ fontSize: 12.5, color: '#64748b' }}>
                  {a.email}{a.lastLoginAt ? ` · last login ${new Date(a.lastLoginAt).toLocaleDateString('en-US')}` : ' · never logged in'}
                </div>
              </div>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: a.isActive ? '#22c55e' : '#ef4444' }}>
                {a.isActive ? 'ACTIVE' : 'DISABLED'}
              </span>
              <button onClick={() => toggle(a)} disabled={busy === a.id}
                style={{ background: 'transparent', border: '1px solid #334155', color: a.isActive ? '#f87171' : '#4ade80', borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: 'pointer', opacity: busy === a.id ? 0.5 : 1 }}>
                {busy === a.id ? '…' : a.isActive ? 'Disable' : 'Enable'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

const input: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 8, padding: '10px 12px', fontSize: 14 };
const screen: React.CSSProperties = { minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0b1120' };
