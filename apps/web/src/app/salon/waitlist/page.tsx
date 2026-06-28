'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { useLiveRefresh } from '../../../lib/useLiveRefresh';
import { usePaged, Pager } from '../../../components/ListFilter';

interface Entry {
  id: string; customerName: string; phone: string | null; email: string | null;
  preferredDate: string | null; note: string | null; status: string;
  createdAt: string; notifiedAt: string | null; service: { name: string } | null;
}

const STATUS_COLORS: Record<string, string> = { WAITING: '#eab308', NOTIFIED: '#3b82f6', CONVERTED: '#22c55e', CANCELLED: '#94a3b8' };

export default function WaitlistPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [rows, setRows] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try { setRows(await apiFetch<Entry[]>('/waitlist', { token })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load);

  async function notify(e: Entry) {
    if (!e.phone && !e.email) { setError(t('wl.noContact')); return; }
    setMsg(null); setError(null);
    try { await apiFetch(`/waitlist/${e.id}/notify`, { method: 'POST', token }); setMsg(t('wl.notified').replace('{name}', e.customerName)); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  }
  async function setStatus(e: Entry, status: string) {
    try { await apiFetch(`/waitlist/${e.id}`, { method: 'PATCH', token, body: { status } }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  }
  async function remove(e: Entry) {
    if (!confirm(t('wl.confirmRemove').replace('{name}', e.customerName))) return;
    try { await apiFetch(`/waitlist/${e.id}`, { method: 'DELETE', token }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed'); }
  }

  const pg = usePaged(rows, 20);

  return (
    <section>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{t('wl.title')}</h1>
      <p style={{ color: '#94a3b8', margin: '0 0 16px', fontSize: 14 }}>{t('wl.subA')}<strong>{t('wl.notifyWord')}</strong>{t('wl.subB')}</p>

      {error && <div style={ui.banner}>{error}</div>}
      {msg && <div style={{ background: '#064e3b', color: '#a7f3d0', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>{msg}</div>}

      {loading && rows.length === 0 ? <p style={{ color: '#94a3b8' }}>{t('wl.loading')}</p> : (
        <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead><tr style={{ background: '#1e293b' }}>
              <th style={ui.th}>{t('wl.colAdded')}</th><th style={ui.th}>{t('wl.colCustomer')}</th><th style={ui.th}>{t('wl.colContact')}</th>
              <th style={ui.th}>{t('wl.colService')}</th><th style={ui.th}>{t('wl.colWants')}</th><th style={ui.th}>{t('wl.colStatus')}</th><th style={ui.th}>{t('wl.colActions')}</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td style={ui.td} colSpan={7}>{t('wl.empty')}</td></tr>}
              {pg.paged.map((e) => (
                <tr key={e.id} style={{ borderTop: '1px solid #334155' }}>
                  <td style={{ ...ui.td, color: '#94a3b8', whiteSpace: 'nowrap' }}>{new Date(e.createdAt).toLocaleDateString()}</td>
                  <td style={ui.td}>{e.customerName}{e.note ? <div style={{ color: '#64748b', fontSize: 12 }}>{e.note}</div> : null}</td>
                  <td style={{ ...ui.td, color: '#cbd5e1' }}>{e.phone || e.email || '—'}</td>
                  <td style={{ ...ui.td, color: '#cbd5e1' }}>{e.service?.name || t('wl.any')}</td>
                  <td style={{ ...ui.td, color: '#cbd5e1' }}>{e.preferredDate || t('wl.anyDay')}</td>
                  <td style={ui.td}><span style={{ color: STATUS_COLORS[e.status] ?? '#94a3b8', border: `1px solid ${STATUS_COLORS[e.status] ?? '#94a3b8'}`, borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>{e.status}</span></td>
                  <td style={ui.td}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={() => notify(e)} style={mini('#22c55e')} title={t('wl.notifyTitle')}>{t('wl.notify')}</button>
                      {e.status !== 'CONVERTED' && <button onClick={() => setStatus(e, 'CONVERTED')} style={mini('#6366f1')} title={t('wl.bookedTitle')}>{t('wl.booked')}</button>}
                      <button onClick={() => remove(e)} style={mini('#ef4444')}>{t('wl.remove')}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '0 14px 12px' }}><Pager paged={pg} /></div>
        </div>
      )}
    </section>
  );
}

function mini(color: string): React.CSSProperties {
  return { padding: '5px 11px', borderRadius: 8, border: `1px solid ${color}`, background: 'transparent', color, fontSize: 12, fontWeight: 600, cursor: 'pointer' };
}
