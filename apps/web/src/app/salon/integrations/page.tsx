'use client';

import { useCallback, useEffect, useState, FormEvent } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';

interface ApiKey {
  id: string;
  name: string | null;
  keyPrefix: string;
  lastFour: string;
  status: 'ACTIVE' | 'REVOKED';
  lastUsedAt: string | null;
  createdAt: string;
}

export default function IntegrationsPage() {
  return (
    <SalonShell>
      <Inner />
    </SalonShell>
  );
}

function Inner() {
  const { token } = useAuth();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [slug, setSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null); // shown once
  const [name, setName] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [keyList, tenant] = await Promise.all([
        apiFetch<ApiKey[]>('/api-keys', { token }),
        apiFetch<{ slug: string }>('/me/tenant', { token }),
      ]);
      setKeys(keyList);
      setSlug(tenant?.slug ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load integrations');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const bookingLink =
    slug && typeof window !== 'undefined' ? `${window.location.origin}/book/${slug}` : null;

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setNewKey(null);
    try {
      const res = await apiFetch<{ plaintextKey: string }>('/api-keys', {
        method: 'POST',
        token,
        body: { name: name || undefined, siteUrl: siteUrl || undefined },
      });
      setNewKey(res.plaintextKey);
      setName('');
      setSiteUrl('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this key? Any WordPress site using it will stop working.')) return;
    try {
      await apiFetch(`/api-keys/${id}`, { method: 'DELETE', token });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed');
    }
  }

  return (
    <section>
      {error && <div style={ui.banner}>{error}</div>}

      {/* Option 1: hosted online booking link (no WordPress needed) */}
      <div style={{ ...ui.card, marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>Your online booking link</h2>
        <p style={{ color: '#94a3b8', marginTop: 0, fontSize: 14 }}>
          Share this link anywhere (Instagram bio, Google profile, SMS). Customers book directly —
          no WordPress required.
        </p>
        {bookingLink ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <code
              style={{
                flex: 1,
                minWidth: 240,
                padding: '10px 12px',
                background: '#0f172a',
                borderRadius: 8,
                wordBreak: 'break-all',
                fontSize: 14,
              }}
            >
              {bookingLink}
            </code>
            <button onClick={() => navigator.clipboard?.writeText(bookingLink)} style={ui.primaryBtn}>
              Copy
            </button>
            <a href={bookingLink} target="_blank" rel="noreferrer" style={{ ...ui.primaryBtn, textDecoration: 'none', background: 'transparent', border: '1px solid #475569', color: '#e2e8f0' }}>
              Open
            </a>
          </div>
        ) : (
          <p style={{ color: '#64748b', fontSize: 13 }}>Loading…</p>
        )}
      </div>

      {/* Option 2: WordPress plugin via API key */}
      <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>WordPress plugin (API key)</h2>
      <p style={{ color: '#94a3b8', marginTop: 0, fontSize: 14 }}>
        Prefer to embed booking inside your own WordPress site? Create an API key and paste it into
        the Lumio Booking plugin settings (Settings &rarr; Lumio Booking).
      </p>

      {newKey && (
        <div
          style={{
            ...ui.card,
            border: '1px solid #22c55e',
            marginBottom: 16,
          }}
        >
          <strong style={{ color: '#22c55e' }}>Copy your new API key now</strong>
          <p style={{ color: '#cbd5e1', fontSize: 13, margin: '6px 0' }}>
            This is the only time it will be shown. Store it somewhere safe.
          </p>
          <code
            style={{
              display: 'block',
              padding: '10px 12px',
              background: '#0f172a',
              borderRadius: 8,
              wordBreak: 'break-all',
              fontSize: 14,
            }}
          >
            {newKey}
          </code>
          <button
            onClick={() => navigator.clipboard?.writeText(newKey)}
            style={{ ...ui.primaryBtn, marginTop: 10 }}
          >
            Copy to clipboard
          </button>
        </div>
      )}

      <form onSubmit={create} style={{ ...ui.card, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label>
            <span style={ui.label}>Key name (optional)</span>
            <input style={ui.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Main website" />
          </label>
          <label>
            <span style={ui.label}>WordPress site URL (optional)</span>
            <input style={ui.input} value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://mysalon.com" />
          </label>
        </div>
        <button type="submit" disabled={creating} style={{ ...ui.primaryBtn, marginTop: 14 }}>
          {creating ? 'Generating...' : '+ Generate API key'}
        </button>
      </form>

      {loading ? (
        <p style={{ color: '#94a3b8' }}>Loading...</p>
      ) : (
        <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#1e293b' }}>
                <th style={ui.th}>Name</th>
                <th style={ui.th}>Key</th>
                <th style={ui.th}>Status</th>
                <th style={ui.th}>Last used</th>
                <th style={ui.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.length === 0 && (
                <tr>
                  <td style={ui.td} colSpan={5}>
                    No API keys yet.
                  </td>
                </tr>
              )}
              {keys.map((k) => (
                <tr key={k.id} style={{ borderTop: '1px solid #334155' }}>
                  <td style={ui.td}>{k.name ?? '—'}</td>
                  <td style={{ ...ui.td, color: '#94a3b8', fontFamily: 'monospace' }}>
                    {k.keyPrefix}…{k.lastFour}
                  </td>
                  <td style={ui.td}>
                    <span style={{ color: k.status === 'ACTIVE' ? '#22c55e' : '#ef4444' }}>
                      {k.status}
                    </span>
                  </td>
                  <td style={{ ...ui.td, color: '#94a3b8' }}>
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'never'}
                  </td>
                  <td style={ui.td}>
                    {k.status === 'ACTIVE' && (
                      <button onClick={() => revoke(k.id)} style={ui.dangerBtn}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
