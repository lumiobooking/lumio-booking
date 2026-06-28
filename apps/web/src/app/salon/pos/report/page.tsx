'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../../components/SalonShell';
import { useAuth } from '../../../../lib/auth';
import { apiFetch } from '../../../../lib/api';
import { ui, formatPrice } from '../../../../lib/ui';
import { DateRangeBar, useDateRange } from '../../../../components/ListFilter';

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
      setError(err instanceof Error ? err.message : 'Failed to load report');
    } finally { setLoading(false); }
  }, [token, range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>POS sales report</h1>
          <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: 14 }}>Revenue, tips &amp; commission per technician.</p>
        </div>
        <DateRangeBar range={range} />
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      {loading || !data ? <p style={{ color: '#94a3b8' }}>Loading…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 18 }}>
            <Kpi label="Sales (paid)" value={formatPrice(data.totals.revenueCents)} accent="#22c55e" />
            <Kpi label="Tips" value={formatPrice(data.totals.tipsCents)} accent="#a855f7" />
            <Kpi label="Commission" value={formatPrice(data.totals.commissionCents)} accent="#06b6d4" />
            <Kpi label="Orders" value={String(data.totals.orders)} accent="#3b82f6" />
          </div>

          <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead><tr style={{ background: '#1e293b' }}>
                <th style={ui.th}>Technician</th>
                <th style={ui.th}>Service revenue</th>
                <th style={ui.th}>Product revenue</th>
                <th style={ui.th}>Tips</th>
                <th style={ui.th}>Commission</th>
              </tr></thead>
              <tbody>
                {data.staff.length === 0 && <tr><td style={ui.td} colSpan={5}>No paid POS sales or completed bookings in this range.</td></tr>}
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
            Revenue & commission include paid POS sales and completed bookings. Commission = each technician’s service revenue × their commission % (set per technician in Staff → Edit). Tips come from POS checkout only.
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
