'use client';

// Recycle bin. Deleting in Lumio is no longer final: the row is snapshotted,
// held for a grace period, and can be put back from here. After that the daily
// sweep removes it permanently.

import { useCallback, useEffect, useState } from 'react';
import { fmtInTz } from '../../../lib/datetime';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { uiLocale } from '../../../lib/datetime';

interface TrashRow {
  id: string;
  entity: string;
  entityId: string;
  label: string;
  deletedAt: string;
  expiresAt: string;
  daysLeft: number;
}

const ENTITY_LABEL: Record<string, string> = {
  appointment: '🗓 Booking',
  customer: '☺ Customer',
  order: '🧾 Order',
  service: '✦ Service',
};

export default function TrashPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [rows, setRows] = useState<TrashRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try { setRows(await apiFetch<TrashRow[]>('/trash', { token })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load'); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function restore(id: string) {
    setBusy(id); setError(null); setMsg(null);
    try {
      await apiFetch(`/trash/${id}/restore`, { method: 'POST', token, body: {} });
      setMsg(t('tr.restored'));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Restore failed'); }
    finally { setBusy(null); }
  }

  return (
    <section>
      <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>{t('tr.title')}</h1>
      <p style={{ color: 'var(--c94a3b8)', fontSize: 14, margin: '0 0 16px' }}>{t('tr.subtitle')}</p>

      {error && <div style={ui.banner}>{error}</div>}
      {msg && <div style={{ background: 'var(--c14532d)', color: 'var(--cbbf7d0)', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>{msg}</div>}

      {loading && rows.length === 0 ? (
        <div style={{ ...ui.card, color: 'var(--c94a3b8)' }}>…</div>
      ) : rows.length === 0 ? (
        <div style={{ ...ui.card, color: 'var(--c64748b)' }}>{t('tr.empty')}</div>
      ) : (
        <div style={{ border: '1px solid var(--c334155)', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead><tr style={{ background: 'var(--c1e293b)' }}>
              <th style={ui.th}>{t('tr.what')}</th>
              <th style={ui.th}>{t('tr.item')}</th>
              <th style={ui.th}>{t('tr.deleted')}</th>
              <th style={ui.th}>{t('tr.left')}</th>
              <th style={ui.th} />
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--c334155)' }}>
                  <td style={ui.td}>{ENTITY_LABEL[r.entity] ?? r.entity}</td>
                  <td style={ui.td}>{r.label}</td>
                  <td style={ui.td}>{fmtInTz(r.deletedAt, { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td style={ui.td}>
                    {/* Under two days is when someone needs to notice. */}
                    <span style={{ fontWeight: 700, color: r.daysLeft <= 2 ? '#f97316' : 'var(--c94a3b8)' }}>
                      {r.daysLeft} {t('tr.days')}
                    </span>
                  </td>
                  <td style={{ ...ui.td, textAlign: 'right' }}>
                    <button
                      onClick={() => restore(r.id)}
                      disabled={busy === r.id}
                      style={{ ...ui.primaryBtn, padding: '7px 14px', fontSize: 13, opacity: busy === r.id ? 0.5 : 1 }}
                    >{busy === r.id ? '…' : t('tr.restore')}</button>
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
