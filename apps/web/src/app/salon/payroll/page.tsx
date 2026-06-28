'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { DateRangeBar, useDateRange } from '../../../components/ListFilter';
import { useLang, tr } from '../../../lib/i18n';

interface Row {
  staffId: string; name: string; commissionPercent: number; serviceCount: number;
  serviceRevenueCents: number; productRevenueCents: number; tipsCents: number; commissionCents: number; totalPayCents: number;
}
interface Report {
  totals: { revenueCents: number; tipsCents: number; commissionCents: number; payCents: number; orders: number };
  staff: Row[];
}

export default function PayrollPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const range = useDateRange('7d');
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
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally { setLoading(false); }
  }, [token, range.from, range.to]);
  useEffect(() => { load(); }, [load]);

  const techs = (data?.staff ?? []).filter((r) => r.staffId !== 'unassigned' || r.totalPayCents > 0 || r.tipsCents > 0);

  // Export the period's payroll to an Excel/accounting-friendly CSV (plain decimal
  // amounts, no currency symbol). Built from the already-loaded report — no extra fetch.
  function exportCsv() {
    if (!data) return;
    const dollars = (c: number) => (c / 100).toFixed(2);
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const header = ['Technician', '# Services', 'Service Revenue', 'Commission %', 'Commission', 'Tips', 'Total Pay'];
    const body = techs.map((r) => [r.name, String(r.serviceCount), dollars(r.serviceRevenueCents), String(r.commissionPercent), dollars(r.commissionCents), dollars(r.tipsCents), dollars(r.totalPayCents)]);
    const totals = [t('pr.csvTotal'), '', dollars(data.totals.revenueCents), '', dollars(data.totals.commissionCents), dollars(data.totals.tipsCents), dollars(data.totals.payCents)];
    const period = `${t('pr.csvPeriod')}: ${range.from || 'all'} → ${range.to || 'today'}`;
    const lines = [[period], [], header, ...body, totals].map((cols) => cols.map((c) => esc(String(c))).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + lines], { type: 'text/csv;charset=utf-8' }); // BOM so Excel reads UTF-8
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll_${range.from || 'all'}_${range.to || 'today'}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>{t('pr.title')}</h1>
          <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: 14 }}>{t('pr.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <DateRangeBar range={range} />
          <button onClick={exportCsv} disabled={!data} style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid #475569' }}>⬇ {t('pr.exportCsv')}</button>
          <button onClick={() => window.print()} style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid #475569' }}>🖨 {t('pr.print')}</button>
        </div>
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      {loading || !data ? <p style={{ color: '#94a3b8' }}>Loading…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, marginBottom: 18 }}>
            <Kpi label={t('pr.kTotal')} value={formatPrice(data.totals.payCents)} accent="#22c55e" big />
            <Kpi label={t('pr.kCommission')} value={formatPrice(data.totals.commissionCents)} accent="#06b6d4" />
            <Kpi label={t('pr.kTips')} value={formatPrice(data.totals.tipsCents)} accent="#a855f7" />
            <Kpi label={t('pr.kRevenue')} value={formatPrice(data.totals.revenueCents)} accent="#3b82f6" />
          </div>

          <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead><tr style={{ background: '#1e293b' }}>
                <th style={ui.th}>{t('pr.cTech')}</th>
                <th style={ui.th}>{t('pr.cCount')}</th>
                <th style={ui.th}>{t('pr.cRevenue')}</th>
                <th style={ui.th}>{t('pr.cCommission')}</th>
                <th style={ui.th}>{t('pr.cTips')}</th>
                <th style={{ ...ui.th, color: '#22c55e' }}>{t('pr.cTotal')}</th>
              </tr></thead>
              <tbody>
                {techs.length === 0 && <tr><td style={ui.td} colSpan={6}>{t('pr.empty')}</td></tr>}
                {techs.map((r) => (
                  <tr key={r.staffId} style={{ borderTop: '1px solid #334155' }}>
                    <td style={ui.td}>{r.name}</td>
                    <td style={ui.td}>{r.serviceCount}</td>
                    <td style={ui.td}>{formatPrice(r.serviceRevenueCents)}</td>
                    <td style={{ ...ui.td, color: '#06b6d4' }}>{formatPrice(r.commissionCents)} <span style={{ color: '#64748b', fontSize: 12 }}>({r.commissionPercent}%)</span></td>
                    <td style={{ ...ui.td, color: '#a855f7' }}>{formatPrice(r.tipsCents)}</td>
                    <td style={{ ...ui.td, fontWeight: 800, color: '#22c55e', fontSize: 15 }}>{formatPrice(r.totalPayCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ color: '#64748b', fontSize: 12, marginTop: 10 }}>{t('pr.note')}</p>
        </>
      )}
    </section>
  );
}

function Kpi({ label, value, accent, big }: { label: string; value: string; accent: string; big?: boolean }) {
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16, borderLeft: `3px solid ${accent}` }}>
      <div style={{ fontSize: 12, color: '#94a3b8' }}>{label}</div>
      <div style={{ fontSize: big ? 30 : 24, fontWeight: 800, marginTop: 4, color: big ? '#22c55e' : '#fff' }}>{value}</div>
    </div>
  );
}
