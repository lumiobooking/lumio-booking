'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';

interface BranchRow { tenantId: string; name: string; revenueCents: number; payments: number; bookings: number; newCustomers: number }
interface Report { range: { from: string; to: string }; totalCents: number; totalBookings: number; branches: BranchRow[] }

export default function ChainPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setErr(null);
    try {
      const q = new URLSearchParams();
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      const qs = q.toString();
      const r = await apiFetch<Report>(`/branches/report${qs ? `?${qs}` : ''}`, { token });
      setData(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [token, from, to]);
  useEffect(() => { load(); }, [load]);

  const currency = 'USD';
  const max = data && data.branches.length ? Math.max(1, ...data.branches.map((b) => b.revenueCents)) : 1;

  return (
    <section style={{ maxWidth: 900 }}>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{t('cr.title')}</h1>
      <p style={{ color: '#94a3b8', margin: '0 0 16px', fontSize: 14 }}>{t('cr.subtitle')}</p>

      <div style={{ ...ui.card, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
        <label><span style={ui.label}>{t('cr.from')}</span><input lang="en-US" type="date" style={ui.input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label><span style={ui.label}>{t('cr.to')}</span><input lang="en-US" type="date" style={ui.input} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button onClick={load} style={ui.primaryBtn}>{t('cr.apply')}</button>
        {data && <span style={{ color: '#64748b', fontSize: 12, marginLeft: 'auto' }}>{data.range.from} → {data.range.to}</span>}
      </div>

      {err && <div style={ui.banner}>{err}</div>}

      {loading ? (
        <p style={{ color: '#94a3b8' }}>{t('cr.loading')}</p>
      ) : data && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <Kpi label={t('cr.totalRevenue')} value={formatPrice(data.totalCents, currency)} accent="#22c55e" />
            <Kpi label={t('cr.totalBookings')} value={String(data.totalBookings)} accent="#6366f1" />
            <Kpi label={t('cr.branchCount')} value={String(data.branches.length)} accent="#7c3aed" />
          </div>

          <div style={ui.card}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 0.7fr 0.7fr', gap: 8, fontSize: 12, color: '#94a3b8', fontWeight: 700, padding: '0 0 10px', borderBottom: '1px solid #334155' }}>
              <span>{t('cr.branch')}</span>
              <span style={{ textAlign: 'right' }}>{t('cr.revenue')}</span>
              <span style={{ textAlign: 'right' }}>{t('cr.bookings')}</span>
              <span style={{ textAlign: 'right' }}>{t('cr.newCust')}</span>
            </div>
            {data.branches.map((b) => (
              <div key={b.tenantId} style={{ padding: '10px 0', borderBottom: '1px solid #1e293b' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 0.7fr 0.7fr', gap: 8, alignItems: 'center', fontSize: 14 }}>
                  <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{b.name}</span>
                  <span style={{ textAlign: 'right', color: '#22c55e', fontWeight: 600 }}>{formatPrice(b.revenueCents, currency)}</span>
                  <span style={{ textAlign: 'right', color: '#cbd5e1' }}>{b.bookings}</span>
                  <span style={{ textAlign: 'right', color: '#cbd5e1' }}>{b.newCustomers}</span>
                </div>
                <div style={{ height: 6, background: '#1e293b', borderRadius: 3, marginTop: 6, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.round((b.revenueCents / max) * 100)}%`, background: 'linear-gradient(90deg,#6366f1,#7c3aed)', borderRadius: 3 }} />
                </div>
              </div>
            ))}
            {data.branches.length === 0 && <p style={{ color: '#64748b', fontSize: 14, padding: '12px 0' }}>{t('cr.empty')}</p>}
          </div>
        </>
      )}
    </section>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ ...ui.card, flex: '1 1 160px', minWidth: 150 }}>
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: accent }}>{value}</div>
    </div>
  );
}
