'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { DateRangeBar, SearchBox, matchesQuery, useDateRange, sortNewest, usePaged, Pager } from '../../../components/ListFilter';

interface Payment {
  id: string;
  amountCents: number;
  currency: string;
  type: string;
  status: string;
  provider: string;
  paidAt: string | null;
  createdAt: string;
}

const COLORS: Record<string, string> = { PAID: '#22c55e', PENDING: '#eab308', FAILED: '#ef4444', REFUNDED: '#94a3b8' };

export default function PaymentsPage() {
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
  const [q, setQ] = useState('');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setPayments(await apiFetch<Payment[]>('/payments', { token }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function removePayment(p: Payment) {
    if (!confirm(t('pm.confirmDelete').replace('{amt}', formatPrice(p.amountCents, p.currency)))) return;
    try { await apiFetch(`/payments/${p.id}`, { method: 'DELETE', token }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Delete failed'); }
  }

  // Filter by payment date + search, then newest first.
  const visible = sortNewest(
    payments.filter((p) => range.inRange(p.createdAt) && matchesQuery(`${p.status} ${p.type} ${p.provider}`, q)),
    (p) => p.createdAt,
  );
  const totalPaid = visible.filter((p) => p.status === 'PAID').reduce((s, p) => s + p.amountCents, 0);
  const pg = usePaged(visible, 20);

  return (
    <section>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{t('pm.title')}</h1>
      <p style={{ color: '#94a3b8', marginTop: 0, fontSize: 14 }}>
        {visible.length} {t('pm.paymentsWord')} · {formatPrice(totalPaid)} {t('pm.collected')}
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
        <SearchBox value={q} onChange={setQ} placeholder={t('pm.searchPh')} />
        <DateRangeBar range={range} />
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      {loading ? (
        <p style={{ color: '#94a3b8' }}>{t('pm.loading')}</p>
      ) : (
        <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto', marginTop: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#1e293b' }}>
                <th style={ui.th}>{t('pm.colDate')}</th>
                <th style={ui.th}>{t('pm.colAmount')}</th>
                <th style={ui.th}>{t('pm.colType')}</th>
                <th style={ui.th}>{t('pm.colStatus')}</th>
                <th style={ui.th}>{t('pm.colProvider')}</th>
                <th style={ui.th}>{t('pm.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td style={ui.td} colSpan={6}>{t('pm.empty')}</td></tr>
              )}
              {pg.paged.map((p) => (
                <tr key={p.id} style={{ borderTop: '1px solid #334155' }}>
                  <td style={{ ...ui.td, color: '#94a3b8' }}>{new Date(p.createdAt).toLocaleString('en-US')}</td>
                  <td style={ui.td}>{formatPrice(p.amountCents, p.currency)}</td>
                  <td style={ui.td}>{p.type === 'PAY_ONLINE' ? t('pm.online') : t('pm.atSalon')}</td>
                  <td style={ui.td}>
                    <span style={{ color: COLORS[p.status] ?? '#94a3b8', fontWeight: 600 }}>{p.status}</span>
                  </td>
                  <td style={{ ...ui.td, color: '#94a3b8' }}>{p.provider}</td>
                  <td style={ui.td}><button onClick={() => removePayment(p)} style={ui.dangerBtn}>{t('pm.delete')}</button></td>
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
