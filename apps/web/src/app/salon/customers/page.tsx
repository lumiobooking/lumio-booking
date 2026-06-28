'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { useLiveRefresh } from '../../../lib/useLiveRefresh';
import { DateRangeBar, useDateRange, sortNewest, usePaged, Pager } from '../../../components/ListFilter';

interface Customer {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
  loyaltyPoints?: number;
  noShowCount?: number;
  _count: { appointments: number };
}

export default function CustomersPage() {
  return (
    <SalonShell>
      <Inner />
    </SalonShell>
  );
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const range = useDateRange('all');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setCustomers(await apiFetch<Customer[]>('/customers', { token }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load);

  async function remove(c: Customer) {
    const name = `${c.firstName} ${c.lastName ?? ''}`;
    const extra = c._count.appointments > 0 ? t('cu.confirmExtra').replace('{n}', String(c._count.appointments)) : '';
    if (!confirm(t('cu.confirmDelete').replace('{name}', name) + extra + t('cu.cannotUndo'))) return;
    try {
      await apiFetch(`/customers/${c.id}`, { method: 'DELETE', token });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  // Filter by join date + search text, then newest first.
  const filtered = sortNewest(
    customers.filter((c) => {
      if (!range.inRange(c.createdAt)) return false;
      const s = `${c.firstName} ${c.lastName ?? ''} ${c.email ?? ''} ${c.phone ?? ''}`.toLowerCase();
      return s.includes(q.toLowerCase());
    }),
    (c) => c.createdAt,
  );
  const pg = usePaged(filtered, 20);

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, margin: 0 }}>{t('cu.title')}</h1>
          <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: 14 }}>{filtered.length} {t('cu.of')} {customers.length}</p>
        </div>
        <input
          placeholder={t('cu.searchPh')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ ...ui.input, maxWidth: 280 }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <DateRangeBar range={range} />
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      {loading && customers.length === 0 ? (
        <p style={{ color: '#94a3b8' }}>{t('cu.loading')}</p>
      ) : (
        <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#1e293b' }}>
                <th style={ui.th}>{t('cu.colName')}</th>
                <th style={ui.th}>{t('cu.colEmail')}</th>
                <th style={ui.th}>{t('cu.colPhone')}</th>
                <th style={ui.th}>{t('cu.colBookings')}</th>
                <th style={ui.th}>{t('cu.colNoShows')}</th>
                <th style={ui.th}>{t('cu.colPoints')}</th>
                <th style={ui.th}>{t('cu.colSince')}</th>
                <th style={ui.th}>{t('cu.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td style={ui.td} colSpan={8}>{t('cu.empty')}</td></tr>
              )}
              {pg.paged.map((c) => (
                <tr key={c.id} style={{ borderTop: '1px solid #334155' }}>
                  <td style={ui.td}><a href={`/salon/customers/${c.id}`} style={{ color: '#818cf8', textDecoration: 'none', fontWeight: 600 }}>{c.firstName} {c.lastName ?? ''}</a></td>
                  <td style={{ ...ui.td, color: '#94a3b8' }}>{c.email ?? '—'}</td>
                  <td style={{ ...ui.td, color: '#94a3b8' }}>{c.phone ?? '—'}</td>
                  <td style={ui.td}>{c._count.appointments}</td>
                  <td style={ui.td}>
                    {(c.noShowCount ?? 0) === 0 ? <span style={{ color: '#94a3b8' }}>0</span>
                      : (c.noShowCount ?? 0) >= 2
                        ? <span title={t('cu.repeatNoShow')} style={{ background: '#7f1d1d', color: '#fecaca', borderRadius: 6, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>⚠ {c.noShowCount}</span>
                        : <span style={{ color: '#f97316', fontWeight: 600 }}>{c.noShowCount}</span>}
                  </td>
                  <td style={ui.td}>{c.loyaltyPoints ? <span style={{ color: '#eab308', fontWeight: 600 }}>{c.loyaltyPoints} {t('cu.pts')}</span> : '—'}</td>
                  <td style={{ ...ui.td, color: '#94a3b8' }}>{new Date(c.createdAt).toLocaleDateString()}</td>
                  <td style={ui.td}><button onClick={() => remove(c)} style={ui.dangerBtn}>{t('cu.delete')}</button></td>
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
