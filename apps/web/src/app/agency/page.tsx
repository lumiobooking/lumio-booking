'use client';

// ---------------------------------------------------------------------------
// Lumio setup staff home. One SUPPORT login sees ONLY this: a searchable list
// of salon names. Picking one mints an 8-hour salon-scoped session (audited
// server-side) and drops the employee into that salon's dashboard with the
// platform-managed setup screens unlocked. "Leave salon" on the banner brings
// them back here.
//
// The support account's own token is parked in localStorage while the salon
// session is active, and restored on leave — so leaving never needs a re-login.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { apiFetch } from '../../lib/api';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
}

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: '#22c55e',
  PENDING: '#eab308',
  SUSPENDED: '#ef4444',
};

export default function AgencyPage() {
  const { token, user, ready, logout } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!user || (user.role !== 'SUPPORT' && user.role !== 'SUPER_ADMIN')) {
      router.replace('/login');
      return;
    }
    if (!token) return;
    apiFetch<TenantRow[]>('/support/tenants', { token })
      .then((r) => setRows(r))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load salons'))
      .finally(() => setLoading(false));
  }, [ready, user, token, router]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => `${r.name} ${r.slug}`.toLowerCase().includes(needle));
  }, [rows, q]);

  async function enter(t: TenantRow) {
    if (!token || busy) return;
    setBusy(t.id); setError(null);
    try {
      const r = await apiFetch<{
        accessToken: string;
        tenant: { id: string; name: string; slug: string };
        level?: string;
        capabilities?: string[];
      }>(
        `/support/enter/${t.id}`, { method: 'POST', token, body: {} },
      );
      // Park the support login, activate the salon session. The session user
      // borrows SALON_ADMIN so the salon dashboard works untouched; the
      // supportSession flag drives the banner and unlocks hidden screens.
      //
      // The capability list is the employee's LEVEL, resolved by the server.
      // It goes on the session because the menu has to draw the right shape on
      // the first paint — but it is only a drawing instruction: the same level
      // is inside the token, and every request is checked against that copy,
      // so editing this one in a browser console buys nothing.
      const session = {
        accessToken: r.accessToken,
        user: {
          id: user!.id,
          email: user!.email,
          role: 'SALON_ADMIN' as const,
          tenantId: r.tenant.id,
          firstName: user!.firstName || 'Lumio',
          lastName: 'Support',
          supportSession: true,
          tenantName: r.tenant.name,
          supportLevel: r.level,
          capabilities: r.capabilities,
        },
      };
      try {
        const home = localStorage.getItem('lumio_auth');
        if (home) localStorage.setItem('lumio_agency_home', home);
        localStorage.setItem('lumio_auth', JSON.stringify(session));
        localStorage.removeItem('lumio_active_branch');
      } catch { /* private mode: fall through, the assign below will 401 → login */ }
      window.location.assign('/salon');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not enter this salon');
      setBusy(null);
    }
  }

  if (!ready || loading) {
    return <main style={screen}><div style={{ color: 'var(--c94a3b8)' }}>Loading…</div></main>;
  }

  return (
    <main style={{ minHeight: '100vh', background: 'var(--c0b1120)', color: 'var(--ce2e8f0)', padding: '28px 16px' }}>
      <div style={{ maxWidth: 780, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>🛠 Lumio Support</h1>
          <button onClick={() => { logout(); router.replace('/login'); }}
            style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid var(--c334155)', color: 'var(--c94a3b8)', borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}>
            Sign out
          </button>
        </div>
        <p style={{ color: 'var(--c94a3b8)', fontSize: 14, margin: '0 0 18px' }}>
          Pick a salon to set it up. Each visit opens an 8-hour working session and is logged.
        </p>

        {error && <div style={{ background: 'var(--c7f1d1d)', color: 'var(--cfecaca)', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>{error}</div>}

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search salon by name…"
          autoFocus
          style={{ width: '100%', boxSizing: 'border-box', background: 'var(--c0f172a)', border: '1px solid var(--c334155)', color: 'var(--ce2e8f0)', borderRadius: 10, padding: '12px 14px', fontSize: 15, marginBottom: 14 }}
        />

        <div style={{ border: '1px solid var(--c1f2937)', borderRadius: 12, overflow: 'hidden' }}>
          {shown.length === 0 && (
            <div style={{ padding: 18, color: 'var(--c64748b)', fontSize: 14 }}>No salons match.</div>
          )}
          {shown.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderBottom: '1px solid var(--c1f2937)', background: 'var(--c111827)' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                <div style={{ fontSize: 12.5, color: 'var(--c64748b)' }}>/{t.slug}</div>
              </div>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: STATUS_COLOR[t.status] || 'var(--c94a3b8)', border: `1px solid ${STATUS_COLOR[t.status] || 'var(--c334155)'}`, borderRadius: 999, padding: '3px 10px' }}>
                {t.status}
              </span>
              <button
                onClick={() => enter(t)}
                disabled={busy === t.id || t.status === 'SUSPENDED'}
                title={t.status === 'SUSPENDED' ? 'Suspended — reactivate first (Super Admin)' : 'Open an 8-hour setup session'}
                style={{ background: '#6366f1', border: 'none', color: 'white', borderRadius: 8, padding: '8px 16px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', opacity: busy === t.id || t.status === 'SUSPENDED' ? 0.5 : 1, whiteSpace: 'nowrap' }}
              >{busy === t.id ? '…' : 'Vào setup'}</button>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

const screen: React.CSSProperties = { minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--c0b1120)' };
