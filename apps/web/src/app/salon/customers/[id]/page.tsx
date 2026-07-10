'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { SalonShell } from '../../../../components/SalonShell';
import { useAuth } from '../../../../lib/auth';
import { apiFetch } from '../../../../lib/api';
import { ui, formatPrice } from '../../../../lib/ui';
import { usePaged, Pager } from '../../../../components/ListFilter';
import { useLang, tr } from '../../../../lib/i18n';

interface Pay { id: string; amountCents: number; currency: string; status: string; type: string; createdAt: string }
interface Appt {
  id: string; status: string; startTime: string;
  service: { name: string } | null;
  assignedStaff: { firstName: string; lastName: string | null } | null;
  payments: Pay[];
}
interface LoyaltyTxn { id: string; points: number; balanceAfter: number; reason: string; createdAt: string }
interface CustomerDetail {
  id: string; firstName: string; lastName: string | null; email: string | null; phone: string | null;
  notes: string | null; birthDate: string | null; createdAt: string;
  loyaltyPoints?: number;
  loyaltyTransactions?: LoyaltyTxn[];
  appointments: Appt[];
  stats: { bookings: number; completed: number; noShows?: number; totalSpentCents: number; lastVisit: string | null };
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#eab308', ASSIGNED: '#3b82f6', ACCEPTED: '#22c55e', CONFIRMED: '#22c55e',
  REJECTED: '#ef4444', CANCELLED: '#94a3b8', COMPLETED: '#a855f7', NO_SHOW: '#f97316',
};
const PAY_COLORS: Record<string, string> = { PAID: '#22c55e', PENDING: '#eab308', FAILED: '#ef4444', REFUNDED: '#94a3b8' };

export default function CustomerDetailPage() {
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
  const params = useParams();
  const id = String(params?.id ?? '');
  const [c, setC] = useState<CustomerDetail | null>(null);
  const pgAppts = usePaged(c?.appointments ?? [], 15);
  const pgLoyalty = usePaged(c?.loyaltyTransactions ?? [], 15);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bday, setBday] = useState('');
  const [bdaySaved, setBdaySaved] = useState(false);
  const [refLink, setRefLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!token || !id) return;
    setLoading(true); setError(null);
    try {
      const data = await apiFetch<CustomerDetail>(`/customers/${id}`, { token });
      setC(data);
      setBday(data.birthDate ? data.birthDate.slice(0, 10) : '');
      apiFetch<{ code: string; link: string }>(`/referral/customer/${id}`, { token })
        .then((r) => setRefLink(r.link))
        .catch(() => setRefLink(null));
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load customer'); }
    finally { setLoading(false); }
  }, [token, id]);

  useEffect(() => { load(); }, [load]);

  async function saveBirthday() {
    try {
      await apiFetch(`/customers/${id}`, { method: 'PATCH', token, body: { birthDate: bday || null } });
      setBdaySaved(true); setTimeout(() => setBdaySaved(false), 2500);
    } catch (err) { setError(err instanceof Error ? err.message : 'Save failed'); }
  }

  async function markPaid(paymentId: string) {
    try { await apiFetch(`/payments/${paymentId}/mark-paid`, { method: 'POST', token }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Action failed'); }
  }

  if (loading) return <p style={{ color: '#94a3b8' }}>{t('cu.loading')}</p>;
  if (error) return <div style={ui.banner}>{error}</div>;
  if (!c) return <p style={{ color: '#94a3b8' }}>{t('cu.notFound')}</p>;

  const currency = c.appointments.flatMap((a) => a.payments)[0]?.currency ?? 'USD';

  return (
    <section>
      <a href="/salon/customers" style={{ color: '#818cf8', fontSize: 13, textDecoration: 'none' }}>{t('cu.back')}</a>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '12px 0 18px' }}>
        <span style={{ width: 52, height: 52, borderRadius: '50%', background: '#334155', color: '#e2e8f0', display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 700 }}>
          {(c.firstName || '?').charAt(0).toUpperCase()}
        </span>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 24, margin: 0 }}>{c.firstName} {c.lastName ?? ''}</h1>
          <div style={{ color: '#94a3b8', fontSize: 14 }}>
            {c.email ?? t('cu.noEmail')} · {c.phone ?? t('cu.noPhone')} · {t('cu.since')} {new Date(c.createdAt).toLocaleDateString('en-US')}
          </div>
        </div>
        <a
          href={`/salon/pos?customerId=${c.id}&customer=${encodeURIComponent(`${c.firstName} ${c.lastName ?? ''}`.trim())}`}
          style={{ ...ui.primaryBtn, textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          {t('cu.newSale')}
        </a>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 18 }}>
        <Kpi label={t('cu.kSpent')} value={formatPrice(c.stats.totalSpentCents, currency)} accent="#22c55e" />
        <Kpi label={t('cu.kPoints')} value={`${c.loyaltyPoints ?? 0} ${t('cu.pts')}`} accent="#eab308" />
        <Kpi label={t('cu.kBookings')} value={String(c.stats.bookings)} accent="#3b82f6" />
        <Kpi label={t('cu.kCompleted')} value={String(c.stats.completed)} accent="#a855f7" />
        <Kpi label={t('cu.kNoShows')} value={String(c.stats.noShows ?? 0)} accent={(c.stats.noShows ?? 0) >= 2 ? '#ef4444' : '#64748b'} />
        <Kpi label={t('cu.kLastVisit')} value={c.stats.lastVisit ? new Date(c.stats.lastVisit).toLocaleDateString('en-US') : '—'} accent="#06b6d4" />
      </div>

      <div style={{ ...ui.card, marginBottom: 18, display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <label>
          <span style={ui.label}>🎂 {t('cu.birthday')}</span>
          <input lang="en-US" type="date" value={bday} onChange={(e) => setBday(e.target.value)} style={{ ...ui.input, width: 190, colorScheme: 'dark' }} />
        </label>
        <button onClick={saveBirthday} style={ui.primaryBtn}>{t('cu.bdSave')}</button>
        {bdaySaved && <span style={{ color: '#22c55e', fontSize: 13, paddingBottom: 8 }}>{t('cu.bdSaved')}</span>}
        <span style={{ color: '#64748b', fontSize: 12, paddingBottom: 8 }}>{t('cu.birthdayHint')}</span>
      </div>

      {refLink && (
        <div style={{ ...ui.card, marginBottom: 18 }}>
          <div style={{ fontSize: 14, color: '#cbd5e1', fontWeight: 600, marginBottom: 8 }}>🎁 {t('rf.linkTitle')}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <code style={{ flex: 1, minWidth: 220, padding: '10px 12px', background: '#0f172a', borderRadius: 8, wordBreak: 'break-all', fontSize: 13 }}>{refLink}</code>
            <button onClick={() => { navigator.clipboard?.writeText(refLink); setCopied(true); setTimeout(() => setCopied(false), 2000); }} style={ui.primaryBtn}>{copied ? t('rf.copied') : t('rf.copy')}</button>
          </div>
          <p style={{ color: '#64748b', fontSize: 12, margin: '8px 0 0' }}>{t('rf.linkHint')}</p>
        </div>
      )}

      {c.loyaltyTransactions && c.loyaltyTransactions.length > 0 && (
        <div style={{ ...ui.card, marginBottom: 18 }}>
          <div style={{ fontSize: 14, color: '#cbd5e1', fontWeight: 600, marginBottom: 8 }}>{t('cu.loyaltyHistory')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pgLoyalty.paged.map((tx) => (
              <div key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, borderBottom: '1px solid #1f2937', paddingBottom: 4 }}>
                <span style={{ color: '#cbd5e1' }}>{new Date(tx.createdAt).toLocaleDateString('en-US')} · {tx.reason}</span>
                <span style={{ color: tx.points >= 0 ? '#22c55e' : '#f97316', fontWeight: 600 }}>{tx.points >= 0 ? '+' : ''}{tx.points} {t('cu.pts')} <span style={{ color: '#64748b', fontWeight: 400 }}>({t('cu.bal')} {tx.balanceAfter})</span></span>
              </div>
            ))}
            <Pager paged={pgLoyalty} />
          </div>
        </div>
      )}

      {c.notes && (
        <div style={{ ...ui.card, marginBottom: 18 }}>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 4 }}>{t('cu.notesLabel')}</div>
          <div style={{ fontSize: 14 }}>{c.notes}</div>
        </div>
      )}

      <h2 style={{ fontSize: 16, margin: '0 0 10px' }}>{t('cu.bookingHistory')}</h2>
      <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr style={{ background: '#1e293b' }}>
            <th style={ui.th}>{t('cu.bhWhen')}</th><th style={ui.th}>{t('cu.bhService')}</th><th style={ui.th}>{t('cu.bhStaff')}</th><th style={ui.th}>{t('cu.bhStatus')}</th><th style={ui.th}>{t('cu.bhPayment')}</th>
          </tr></thead>
          <tbody>
            {c.appointments.length === 0 && <tr><td style={ui.td} colSpan={5}>{t('cu.noBookingsYet')}</td></tr>}
            {pgAppts.paged.map((a) => {
              const pay = a.payments[0];
              return (
                <tr key={a.id} style={{ borderTop: '1px solid #334155' }}>
                  <td style={ui.td}>{new Date(a.startTime).toLocaleString('en-US')}</td>
                  <td style={ui.td}>{a.service?.name ?? '—'}</td>
                  <td style={ui.td}>{a.assignedStaff ? `${a.assignedStaff.firstName} ${a.assignedStaff.lastName ?? ''}`.trim() : '—'}</td>
                  <td style={ui.td}><span style={{ color: STATUS_COLORS[a.status] ?? '#94a3b8', fontWeight: 600 }}>{a.status}</span></td>
                  <td style={ui.td}>
                    {pay ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: PAY_COLORS[pay.status] ?? '#94a3b8' }}>{formatPrice(pay.amountCents, pay.currency)} · {pay.status}</span>
                        {pay.status === 'PENDING' && (
                          <button onClick={() => markPaid(pay.id)} style={{ padding: '3px 9px', borderRadius: 6, border: '1px solid #22c55e', background: 'transparent', color: '#22c55e', fontSize: 12, cursor: 'pointer' }}>{t('cu.markPaid')}</button>
                        )}
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager paged={pgAppts} />
    </section>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16, borderLeft: `3px solid ${accent}` }}>
      <div style={{ fontSize: 12, color: '#94a3b8' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}
