'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';

interface Plan { planName: string | null }

export default function BillingPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try { setPlan(await apiFetch<Plan>('/me/plan', { token })); } catch { /* ignore */ }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function manage() {
    setBusy(true); setError(null);
    try {
      const r = await apiFetch<{ url: string }>('/billing/portal', { method: 'POST', token });
      window.location.href = r.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open billing portal');
      setBusy(false);
    }
  }

  return (
    <section style={{ maxWidth: 560 }}>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>Billing &amp; plan</h1>
      <p style={{ color: '#94a3b8', margin: '0 0 18px', fontSize: 14 }}>Manage your subscription, upgrade or downgrade your plan, update your card, or cancel.</p>

      {error && <div style={ui.banner}>{error}</div>}

      <div style={ui.card}>
        <div style={{ fontSize: 13, color: '#94a3b8' }}>Current plan</div>
        <div style={{ fontSize: 22, fontWeight: 700, margin: '4px 0 16px' }}>{plan?.planName ?? '—'}</div>

        <button onClick={manage} disabled={busy} style={{ ...ui.primaryBtn }}>
          {busy ? 'Opening…' : 'Manage billing & plan'}
        </button>
        <p style={{ color: '#64748b', fontSize: 12, margin: '12px 0 0' }}>
          Opens a secure billing portal where you can switch between plans (changes are prorated automatically), change monthly/yearly, update your payment card, or cancel anytime.
        </p>
      </div>
    </section>
  );
}
