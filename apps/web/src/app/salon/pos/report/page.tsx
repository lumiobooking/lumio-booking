'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../../components/SalonShell';
import { useAuth } from '../../../../lib/auth';
import { apiFetch } from '../../../../lib/api';
import { ui, formatPrice } from '../../../../lib/ui';
import { DateRangeBar, useDateRange } from '../../../../components/ListFilter';
import { useLang, tr } from '../../../../lib/i18n';

interface StaffRow {
  staffId: string; name: string;
  serviceRevenueCents: number; productRevenueCents: number; tipsCents: number; commissionCents: number;
}
interface Report {
  totals: { revenueCents: number; tipsCents: number; commissionCents: number; orders: number };
  staff: StaffRow[];
}

export default function PosReportPage() {
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
  const range = useDateRange('30d');
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const q = new URLSearchParams();
      if (range.from) q.set('from', range.from);
      if (range.to) q.set('to', range.to);
      setData(await apiFetch<Report>(`/pos/report?${q.toString()}`, { token }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sr.loadFail'));
    } finally { setLoading(false); }
  }, [token, range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>{t('sr.title')}</h1>
          <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: 14 }}>{t('sr.subtitle')}</p>
        </div>
        <DateRangeBar range={range} />
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      {loading || !data ? <p style={{ color: '#94a3b8' }}>{t('sr.loading')}</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 18 }}>
            <Kpi label={t('sr.kpiSales')} value={formatPrice(data.totals.revenueCents)} accent="#22c55e" />
            <Kpi label={t('sr.kpiTips')} value={formatPrice(data.totals.tipsCents)} accent="#a855f7" />
            <Kpi label={t('sr.kpiCommission')} value={formatPrice(data.totals.commissionCents)} accent="#06b6d4" />
            <Kpi label={t('sr.kpiOrders')} value={String(data.totals.orders)} accent="#3b82f6" />
          </div>

          <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead><tr style={{ background: '#1e293b' }}>
                <th style={ui.th}>{t('sr.colTech')}</th>
                <th style={ui.th}>{t('sr.colService')}</th>
                <th style={ui.th}>{t('sr.colProduct')}</th>
                <th style={ui.th}>{t('sr.colTips')}</th>
                <th style={ui.th}>{t('sr.colCommission')}</th>
              </tr></thead>
              <tbody>
                {data.staff.length === 0 && <tr><td style={ui.td} colSpan={5}>{t('sr.empty')}</td></tr>}
                {data.staff.map((r) => (
                  <tr key={r.staffId} style={{ borderTop: '1px solid #334155' }}>
                    <td style={ui.td}>{r.name}</td>
                    <td style={ui.td}>{formatPrice(r.serviceRevenueCents)}</td>
                    <td style={ui.td}>{formatPrice(r.productRevenueCents)}</td>
                    <td style={{ ...ui.td, color: '#a855f7' }}>{formatPrice(r.tipsCents)}</td>
                    <td style={{ ...ui.td, color: '#06b6d4' }}>{formatPrice(r.commissionCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ color: '#64748b', fontSize: 12, marginTop: 10 }}>
            {t('sr.footnote')}
          </p>
        </>
      )}
    </section>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16, borderLeft: `3px solid ${accent}` }}>
      <div style={{ fontSize: 12, color: '#94a3b8' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}
