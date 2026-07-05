'use client';

// Super Admin: assign a Lumio-owned voice number to a salon (tenant). The salon
// then forwards its own public number (on no-answer/busy) to this number, and
// the AI hotline answers. Provisioning steps in Twilio are shown below.

import { useCallback, useEffect, useState, CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';

interface Tenant { id: string; name: string; slug: string }

export default function SuperAdminVoicePage() {
  const { token, user, ready } = useAuth();
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [number, setNumber] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const API = (process.env.NEXT_PUBLIC_API_URL || 'https://lumio-api-uqm6.onrender.com').replace(/\/$/, '');
  const webhook = `${API}/api/voice/incoming`;

  useEffect(() => {
    if (!ready) return;
    if (!token) { router.replace('/login'); return; }
    if (user && user.role !== 'SUPER_ADMIN') router.replace('/');
  }, [ready, token, user, router]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const list = await apiFetch<Tenant[]>('/tenants', { token });
      setTenants(list);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load salons'); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { if (ready && token && user?.role === 'SUPER_ADMIN') load(); }, [ready, token, user, load]);

  async function provision() {
    if (!tenantId || !number.trim()) { setError('Pick a salon and enter the Lumio number.'); return; }
    setBusy(true); setError(null); setMsg(null);
    try {
      const r = await apiFetch<{ lumioNumber: string }>('/admin/voice/provision', { method: 'POST', token, body: { tenantId, lumioNumber: number.trim() } });
      const name = tenants.find((t) => t.id === tenantId)?.name || 'salon';
      setMsg(`Assigned ${r.lumioNumber} to ${name}. Now set that number's Voice webhook in Twilio (below).`);
      setNumber('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Provision failed'); }
    finally { setBusy(false); }
  }

  if (!ready || loading) return <main style={wrap}><p style={{ color: '#94a3b8' }}>Loading…</p></main>;

  return (
    <main style={wrap}>
      <h1 style={{ fontSize: 24, margin: '0 0 4px', color: '#e2e8f0' }}>AI Hotline — number provisioning</h1>
      <p style={{ color: '#94a3b8', margin: '0 0 18px', fontSize: 14 }}>
        Assign a Lumio-owned voice number to a salon. The salon forwards its own public number to it (on no-answer/busy) and the AI answers.
      </p>
      {error && <div style={ui.banner}>{error}</div>}
      {msg && <div style={{ ...ui.card, marginBottom: 16, borderColor: '#22c55e', color: '#bbf7d0', fontSize: 13.5 }}>{msg}</div>}

      <div style={{ ...ui.card, marginBottom: 18, maxWidth: 560 }}>
        <label style={ui.label}>Salon</label>
        <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} style={{ ...ui.input, marginBottom: 12 }}>
          <option value="">— select a salon —</option>
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.slug})</option>)}
        </select>
        <label style={ui.label}>Lumio voice number (E.164)</label>
        <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="+14085551234" style={{ ...ui.input, marginBottom: 14 }} />
        <button onClick={provision} disabled={busy} style={{ ...ui.primaryBtn, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Assigning…' : 'Assign number'}
        </button>
      </div>

      <div style={{ ...ui.card, maxWidth: 560, fontSize: 13.5, color: '#cbd5e1', lineHeight: 1.6 }}>
        <div style={{ fontWeight: 700, color: '#e2e8f0', marginBottom: 8 }}>Twilio setup for each number</div>
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          <li>In the Twilio Console, buy a local voice-capable number.</li>
          <li>Open the number → <b>Voice Configuration</b> → “A call comes in” = <b>Webhook</b>, <b>HTTP POST</b>.</li>
          <li>Paste this URL:</li>
        </ol>
        <code style={{ display: 'block', marginTop: 8, padding: '8px 10px', background: '#0f172a', borderRadius: 8, border: '1px solid #334155', color: '#a5b4fc', wordBreak: 'break-all' }}>{webhook}</code>
        <div style={{ marginTop: 10 }}>
          Then assign that same number here. The salon enables the hotline and forwards their line to it from their own AI Hotline page.
        </div>
      </div>
    </main>
  );
}

const wrap: CSSProperties = { minHeight: '100vh', background: '#0b1120', padding: '28px 24px' };
