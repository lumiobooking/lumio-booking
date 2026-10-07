'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { SalonShell } from '../../../../components/SalonShell';
import { useAuth } from '../../../../lib/auth';
import { apiFetch } from '../../../../lib/api';
import { ui, formatPrice } from '../../../../lib/ui';
import { usePaged, Pager } from '../../../../components/ListFilter';
import { useLang, tr } from '../../../../lib/i18n';
import { ind } from '../../../../lib/ui-industry';
import { IndustryRecordCard } from '../../../../components/IndustryRecordCard';
import { PastHistoryCard, type Past } from '../../../../components/PastHistoryCard';
import { uiLocale } from '../../../../lib/datetime';

interface Pay { id: string; amountCents: number; currency: string; status: string; type: string; createdAt: string }
interface Appt {
  id: string; status: string; startTime: string;
  service: { name: string } | null;
  assignedStaff: { firstName: string; lastName: string | null } | null;
  payments: Pay[];
}
interface LoyaltyTxn { id: string; points: number; balanceAfter: number; reason: string; createdAt: string }
/** A till sale. Walk-ins and retail have no appointment, so they only show here. */
interface OrderItemRow { id: string; name: string; quantity: number; lineTotalCents: number }
interface OrderRow {
  id: string; orderNumber: number; createdAt: string; currency: string;
  totalCents: number; tipCents: number; appointmentId: string | null; items: OrderItemRow[];
}
interface CustomerDetail {
  id: string; firstName: string; lastName: string | null; email: string | null; phone: string | null;
  notes: string | null; birthDate: string | null; createdAt: string;
  loyaltyPoints?: number;
  loyaltyTransactions?: LoyaltyTxn[];
  appointments: Appt[];
  orders?: OrderRow[];
  stats: { bookings: number; completed: number; noShows?: number; visits?: number; walkInSales?: number; totalSpentCents: number; lastVisit: string | null };
  /** The line-of-business record (api common/industry-fields). */
  industryFields?: Record<string, string | number>;
  /** History from the salon's previous system (import or typed by the owner). */
  past?: Past;
  smsConsent?: boolean;
  /** Her habits from finished visits (api common/customer-profile). */
  profile?: { visits: number; favourites: { name: string; count: number }[]; preferredStaff: { name: string; count: number } | null; usualWeekday: number | null; usualPart: 'morning' | 'afternoon' | 'evening' | null; avgSpendCents: number | null; lastServices: string[]; lastStaff: string | null };
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#eab308', ASSIGNED: '#3b82f6', ACCEPTED: '#22c55e', CONFIRMED: '#22c55e',
  REJECTED: '#ef4444', CANCELLED: 'var(--c94a3b8)', COMPLETED: '#a855f7', NO_SHOW: '#f97316',
};
const PAY_COLORS: Record<string, string> = { PAID: '#22c55e', PENDING: '#eab308', FAILED: '#ef4444', REFUNDED: 'var(--c94a3b8)' };

export default function CustomerDetailPage() {
  return (
    <SalonShell>
      <Inner />
    </SalonShell>
  );
}

function Inner() {
  const { token, user } = useAuth();
  const isOwner = user?.role === 'SALON_ADMIN' || user?.role === 'SUPER_ADMIN';
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const params = useParams();
  const id = String(params?.id ?? '');
  const [c, setC] = useState<CustomerDetail | null>(null);
  // Same rule as the calendar: every date on this page reads on the salon's
  // clock, so a visit never appears on the wrong day to a viewer abroad.
  const [salonTz, setSalonTz] = useState('');
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
      apiFetch<{ company?: { timezone?: string } }>('/settings', { token })
        .then((st) => { if (st?.company?.timezone) setSalonTz(st.company.timezone); })
        .catch(() => undefined);
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

  if (loading) return <p style={{ color: 'var(--c94a3b8)' }}>{t('cu.loading')}</p>;
  if (error) return <div style={ui.banner}>{error}</div>;
  if (!c) return <p style={{ color: 'var(--c94a3b8)' }}>{t('cu.notFound')}</p>;

  const currency = c.appointments.flatMap((a) => a.payments)[0]?.currency ?? 'USD';

  return (
    <section>
      <a href="/salon/customers" style={{ color: 'var(--c818cf8)', fontSize: 13, textDecoration: 'none' }}>{t('cu.back')}</a>

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '12px 0 18px' }}>
        <span style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--c334155)', color: 'var(--ce2e8f0)', display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 600 }}>
          {(c.firstName || '?').charAt(0).toUpperCase()}
        </span>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 24, margin: 0 }}>{c.firstName} {c.lastName ?? ''}</h1>
          <div style={{ color: 'var(--c94a3b8)', fontSize: 14 }}>
            {c.email ?? t('cu.noEmail')} · {c.phone ?? t('cu.noPhone')} · {t('cu.since')} {fmtDate(c.createdAt, salonTz)}
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
        <Kpi label={t('cu.kVisits')} value={String(c.stats.visits ?? c.stats.completed)} accent="#3b82f6" />
        <Kpi label={t('cu.kBookings')} value={String(c.stats.bookings)} accent="#3b82f6" />
        <Kpi label={t('cu.kCompleted')} value={String(c.stats.completed)} accent="#a855f7" />
        <Kpi label={t('cu.kNoShows')} value={String(c.stats.noShows ?? 0)} accent={(c.stats.noShows ?? 0) >= 2 ? '#ef4444' : 'var(--c64748b)'} />
        <Kpi label={t('cu.kLastVisit')} value={c.stats.lastVisit ? fmtDate(c.stats.lastVisit, salonTz) : '—'} accent="#06b6d4" />
      </div>

      {/* The record this line of business keeps: patient record, lead, guest notes, lash map… */}
      <IndustryRecordCard token={token} customerId={c.id} values={c.industryFields} vi={lang === 'vi'} onSaved={load} />
      <PastHistoryCard token={token} customerId={c.id} past={c.past} smsConsent={c.smsConsent} currency={currency} vi={lang === 'vi'} isOwner={isOwner} onSaved={load} />

      {/* Her habits — the same profile the chat bot reads to offer "same as last time?". */}
      {c.profile && c.profile.visits >= 2 && (() => {
        const p = c.profile;
        const vi = lang === 'vi';
        const days = vi ? ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'] : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const part = p.usualPart ? (vi ? { morning: 'buổi sáng', afternoon: 'buổi chiều', evening: 'buổi tối' }[p.usualPart] : `${p.usualPart}s`) : '';
        const chip = (label: string, value: string) => (
          <div style={{ background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 10, padding: '8px 12px', minWidth: 0 }}>
            <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>{label}</div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ce2e8f0)' }}>{value}</div>
          </div>
        );
        return (
          <div style={{ ...ui.card, marginBottom: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--cf1f5f9)', marginBottom: 8 }}>✨ {ind(vi ? 'Thói quen của khách' : 'Her habits')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
              {p.favourites.length > 0 && chip(ind(vi ? 'Hay làm' : 'Usually books'), p.favourites.map((f) => `${f.name} ×${f.count}`).join(', '))}
              {p.preferredStaff && chip(ind(vi ? 'Thợ quen' : 'Usual technician'), `${p.preferredStaff.name} (${p.preferredStaff.count}/${p.visits})`)}
              {(p.usualWeekday != null || part) && chip(vi ? 'Hay đến' : 'Usually comes', [p.usualWeekday != null ? days[p.usualWeekday] : '', part].filter(Boolean).join(' '))}
              {p.avgSpendCents != null && chip(vi ? 'Chi trung bình / lần' : 'Average per visit', formatPrice(p.avgSpendCents, currency))}
              {p.lastServices.length > 0 && chip(vi ? 'Lần trước' : 'Last time', `${p.lastServices.join(' + ')}${p.lastStaff ? ` · ${p.lastStaff}` : ''}`)}
            </div>
          </div>
        );
      })()}

      <div style={{ ...ui.card, marginBottom: 18, display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <label>
          <span style={ui.label}>🎂 {t('cu.birthday')}</span>
          <input lang="en-US" type="date" value={bday} onChange={(e) => setBday(e.target.value)} style={{ ...ui.input, width: 190}} />
        </label>
        <button onClick={saveBirthday} style={ui.primaryBtn}>{t('cu.bdSave')}</button>
        {bdaySaved && <span style={{ color: 'var(--ink-good)', fontSize: 13, paddingBottom: 8 }}>{t('cu.bdSaved')}</span>}
        <span style={{ color: 'var(--c64748b)', fontSize: 12, paddingBottom: 8 }}>{t('cu.birthdayHint')}</span>
      </div>

      {refLink && (
        <div style={{ ...ui.card, marginBottom: 18 }}>
          <div style={{ fontSize: 14, color: 'var(--ccbd5e1)', fontWeight: 600, marginBottom: 8 }}>🎁 {t('rf.linkTitle')}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <code style={{ flex: 1, minWidth: 220, padding: '10px 12px', background: 'var(--c0f172a)', borderRadius: 8, wordBreak: 'break-all', fontSize: 13 }}>{refLink}</code>
            <button onClick={() => { navigator.clipboard?.writeText(refLink); setCopied(true); setTimeout(() => setCopied(false), 2000); }} style={ui.primaryBtn}>{copied ? t('rf.copied') : t('rf.copy')}</button>
          </div>
          <p style={{ color: 'var(--c64748b)', fontSize: 12, margin: '8px 0 0' }}>{t('rf.linkHint')}</p>
        </div>
      )}

      {c.loyaltyTransactions && c.loyaltyTransactions.length > 0 && (
        <div style={{ ...ui.card, marginBottom: 18 }}>
          <div style={{ fontSize: 14, color: 'var(--ccbd5e1)', fontWeight: 600, marginBottom: 8 }}>{t('cu.loyaltyHistory')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pgLoyalty.paged.map((tx) => (
              <div key={tx.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, borderBottom: '1px solid var(--c1f2937)', paddingBottom: 4 }}>
                <span style={{ color: 'var(--ccbd5e1)' }}>{fmtDate(tx.createdAt, salonTz)} · {tx.reason}</span>
                <span style={{ color: tx.points >= 0 ? 'var(--ink-good)' : '#f97316', fontWeight: 600 }}>{tx.points >= 0 ? '+' : ''}{tx.points} {t('cu.pts')} <span style={{ color: 'var(--c64748b)', fontWeight: 400 }}>({t('cu.bal')} {tx.balanceAfter})</span></span>
              </div>
            ))}
            <Pager paged={pgLoyalty} />
          </div>
        </div>
      )}

      {c.notes && (
        <div style={{ ...ui.card, marginBottom: 18 }}>
          <div style={{ fontSize: 13, color: 'var(--c94a3b8)', marginBottom: 4 }}>{t('cu.notesLabel')}</div>
          <div style={{ fontSize: 14 }}>{c.notes}</div>
        </div>
      )}

      {/* Till sales: a walk-in never creates a booking, so without this section a
          regular customer looked like they had never been in. */}
      <h2 style={{ fontSize: 16, margin: '0 0 10px' }}>{t('cu.salesHistory')}</h2>
      <div style={{ border: '1px solid var(--c334155)', borderRadius: 12, overflowX: 'auto', marginBottom: 22 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr style={{ background: 'var(--c1e293b)' }}>
            <th style={ui.th}>{t('cu.bhWhen')}</th><th style={ui.th}>{t('cu.shOrder')}</th>
            <th style={ui.th}>{t('cu.shItems')}</th><th style={{ ...ui.th, textAlign: 'right' }}>{t('cu.shTotal')}</th>
          </tr></thead>
          <tbody>
            {(c.orders ?? []).length === 0 && <tr><td style={ui.td} colSpan={4}>{t('cu.noSales')}</td></tr>}
            {(c.orders ?? []).map((o) => (
              <tr key={o.id} style={{ borderTop: '1px solid var(--c334155)' }}>
                <td style={ui.td}>{fmtDateTime(o.createdAt, salonTz)}</td>
                <td style={ui.td}>#{o.orderNumber}</td>
                <td style={ui.td}>
                  {o.items.length === 0 ? '—' : o.items.map((it) => `${it.name}${it.quantity > 1 ? ` ×${it.quantity}` : ''}`).join(' · ')}
                </td>
                <td style={{ ...ui.td, textAlign: 'right', fontWeight: 600, color: 'var(--ink-good)' }}>{formatPrice(o.totalCents, o.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 16, margin: '0 0 10px' }}>{t('cu.bookingHistory')}</h2>
      <div style={{ border: '1px solid var(--c334155)', borderRadius: 12, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr style={{ background: 'var(--c1e293b)' }}>
            <th style={ui.th}>{t('cu.bhWhen')}</th><th style={ui.th}>{t('cu.bhService')}</th><th style={ui.th}>{t('cu.bhStaff')}</th><th style={ui.th}>{t('cu.bhStatus')}</th><th style={ui.th}>{t('cu.bhPayment')}</th>
          </tr></thead>
          <tbody>
            {c.appointments.length === 0 && <tr><td style={ui.td} colSpan={5}>{t('cu.noBookingsYet')}</td></tr>}
            {pgAppts.paged.map((a) => {
              const pay = a.payments[0];
              return (
                <tr key={a.id} style={{ borderTop: '1px solid var(--c334155)' }}>
                  <td style={ui.td}>{fmtDateTime(a.startTime, salonTz)}</td>
                  <td style={ui.td}>{a.service?.name ?? '—'}</td>
                  <td style={ui.td}>{a.assignedStaff ? `${a.assignedStaff.firstName} ${a.assignedStaff.lastName ?? ''}`.trim() : '—'}</td>
                  <td style={ui.td}><span style={{ color: STATUS_COLORS[a.status] ?? 'var(--c94a3b8)', fontWeight: 600 }}>{a.status}</span></td>
                  <td style={ui.td}>
                    {pay ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: PAY_COLORS[pay.status] ?? 'var(--c94a3b8)' }}>{formatPrice(pay.amountCents, pay.currency)} · {pay.status}</span>
                        {pay.status === 'PENDING' && (
                          <button onClick={() => markPaid(pay.id)} style={{ padding: '3px 9px', borderRadius: 6, border: '1px solid #22c55e', background: 'transparent', color: 'var(--ink-good)', fontSize: 12, cursor: 'pointer' }}>{t('cu.markPaid')}</button>
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
    <div style={{ background: 'var(--c1e293b)', border: '1px solid var(--c334155)', borderRadius: 12, padding: 16, borderLeft: `3px solid ${accent}` }}>
      <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}

/** Dates on the salon's own clock — never the viewer's. */
function fmtDate(iso: string, tz: string): string {
  const d = new Date(iso);
  try { return d.toLocaleDateString(uiLocale(), tz ? { timeZone: tz } : undefined); }
  catch { return d.toLocaleDateString(uiLocale()); }
}
function fmtDateTime(iso: string, tz: string): string {
  const d = new Date(iso);
  try { return d.toLocaleString(uiLocale(), tz ? { timeZone: tz } : undefined); }
  catch { return d.toLocaleString(uiLocale()); }
}
