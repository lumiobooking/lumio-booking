'use client';

import { useCallback, useEffect, useState, CSSProperties, ReactNode } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';

/* ---------------------------------------------------------------- types --- */
type Src = 'website' | 'lumiolink' | 'online' | 'hotline' | 'messenger' | 'walkin' | 'staff';
type Counts = Record<Src, number>;
type Dev = 'mobile' | 'web' | 'unknown';
type DevCounts = Record<Dev, number>;
interface SrcReport {
  from: string; to: string;
  totals: { visits: Counts; visitsTotal: number; revenueCents: Counts; revenueTotalCents: number };
  deviceTotals?: DevCounts;
}
interface Ranked { name: string; bookings: number; revenueCents: number }
interface Dash {
  range: { from: string; to: string };
  kpis: {
    totalBookings: number; revenueCents: number; newCustomers: number;
    completed: number; noShow: number; cancelled: number;
    avgBookingValueCents: number; noShowRate: number; completionRate: number;
  };
  statusBreakdown: Record<string, number>;
  paymentMethods: { cash: number; card: number; transfer: number; online: number; onsite: number };
  byHour: number[];
  byWeekday: number[];
  series: { date: string; bookings: number; revenueCents: number }[];
  topStaff: Ranked[];
  topServices: Ranked[];
}

/* --------------------------------------------------------------- labels --- */
const SRC_ORDER: Src[] = ['website', 'lumiolink', 'online', 'hotline', 'messenger', 'walkin', 'staff'];
const SRC_COLOR: Record<Src, string> = { website: '#6366f1', lumiolink: '#0ea5e9', online: '#64748b', hotline: '#22c55e', messenger: '#3b82f6', walkin: '#f59e0b', staff: '#a78bfa' };
const SRC_LABEL = (s: Src, vi: boolean): string => ({
  website: vi ? 'Website tiệm' : 'Website', lumiolink: vi ? 'Link Lumio' : 'Lumio link',
  online: vi ? 'Online (chưa rõ)' : 'Online (unattributed)', hotline: 'Hotline', messenger: 'Messenger',
  walkin: vi ? 'Khách vãng lai' : 'Walk-in', staff: vi ? 'Nhân viên nhập' : 'Staff',
}[s]);
const DEV_ORDER: Dev[] = ['mobile', 'web', 'unknown'];
const DEV_COLOR: Record<Dev, string> = { mobile: '#8b5cf6', web: '#0ea5e9', unknown: '#475569' };
const DEV_LABEL = (d: Dev, vi: boolean) => ({ mobile: vi ? 'Điện thoại' : 'Phone', web: vi ? 'Máy tính' : 'Computer', unknown: vi ? 'Không rõ' : 'Unknown' }[d]);
const PAY_LABEL = (k: string, vi: boolean) => ({ cash: vi ? 'Tiền mặt' : 'Cash', card: vi ? 'Thẻ' : 'Card', transfer: vi ? 'Chuyển khoản' : 'Transfer', online: vi ? 'Online' : 'Online', onsite: vi ? 'Tại tiệm (khác)' : 'On-site (other)' }[k] ?? k);
const PAY_COLOR: Record<string, string> = { cash: '#22c55e', card: '#6366f1', transfer: '#0ea5e9', online: '#a78bfa', onsite: '#64748b' };

const isoToday = () => new Date().toISOString().slice(0, 10);

export default function ReportsPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const T = (v: string, e: string) => (vi ? v : e);

  // Default: this month.
  const now = new Date();
  const [from, setFrom] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(isoToday());
  const [src, setSrc] = useState<SrcReport | null>(null);
  const [dash, setDash] = useState<Dash | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const q = `from=${from}&to=${to}`;
      const [s, d, settings] = await Promise.all([
        apiFetch<SrcReport>(`/stats/sources?bucket=day&${q}`, { token }),
        apiFetch<Dash>(`/overview/dashboard?${q}`, { token }),
        apiFetch<{ booking?: { currency?: string } }>('/settings', { token }).catch(() => ({} as { booking?: { currency?: string } })),
      ]);
      setSrc(s); setDash(d);
      if (settings?.booking?.currency) setCurrency(settings.booking.currency);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token, from, to]);
  useEffect(() => { load(); }, [load]);

  function preset(kind: 'thisMonth' | 'lastMonth' | 'thisYear' | 'last7') {
    const n = new Date(); const y = n.getFullYear(); const m = n.getMonth();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    if (kind === 'thisMonth') { setFrom(iso(new Date(y, m, 1))); setTo(isoToday()); }
    else if (kind === 'lastMonth') { setFrom(iso(new Date(y, m - 1, 1))); setTo(iso(new Date(y, m, 0))); }
    else if (kind === 'thisYear') { setFrom(iso(new Date(y, 0, 1))); setTo(isoToday()); }
    else { setFrom(iso(new Date(Date.now() - 6 * 86400000))); setTo(isoToday()); }
  }

  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
  const money = (c: number) => formatPrice(c, currency);
  const [metric, setMetric] = useState<'revenue' | 'bookings'>('revenue');

  // Which preset (if any) the current range matches, so the button can light up.
  const activePreset = (() => {
    const n = new Date(); const y = n.getFullYear(); const m = n.getMonth();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    if (from === iso(new Date(Date.now() - 6 * 86400000)) && to === isoToday()) return 'last7';
    if (from === iso(new Date(y, m, 1)) && to === isoToday()) return 'thisMonth';
    if (from === iso(new Date(y, m - 1, 1)) && to === iso(new Date(y, m, 0))) return 'lastMonth';
    if (from === iso(new Date(y, 0, 1)) && to === isoToday()) return 'thisYear';
    return 'custom';
  })();

  if (loading && !dash) return <section><h2 style={{ fontSize: 18 }}>{T('Báo cáo', 'Reports')}</h2><p style={{ color: '#94a3b8' }}>Loading…</p></section>;

  const k = dash?.kpis;
  const visitsTotal = src?.totals.visitsTotal ?? 0;
  const walkin = src?.totals.visits.walkin ?? 0;
  const booked = Math.max(0, visitsTotal - walkin);
  const dt = src?.deviceTotals;
  const devKnown = dt ? dt.mobile + dt.web : 0;

  function exportCsv() {
    const rows: string[][] = [];
    rows.push([T('Báo cáo', 'Report'), `${from} → ${to}`]);
    rows.push([]);
    rows.push([T('Chỉ số', 'Metric'), T('Giá trị', 'Value')]);
    if (k) {
      rows.push([T('Doanh thu', 'Revenue'), (k.revenueCents / 100).toFixed(2)]);
      rows.push([T('Giá trị TB/lượt', 'Avg ticket'), (k.avgBookingValueCents / 100).toFixed(2)]);
      rows.push([T('Tổng lịch', 'Total bookings'), String(k.totalBookings)]);
      rows.push([T('Hoàn tất', 'Completed'), String(k.completed)]);
      rows.push([T('No-show', 'No-show'), String(k.noShow)]);
      rows.push([T('Huỷ', 'Cancelled'), String(k.cancelled)]);
      rows.push([T('Tỷ lệ no-show %', 'No-show rate %'), String(Math.round(k.noShowRate * 100))]);
      rows.push([T('Tỷ lệ hoàn tất %', 'Completion rate %'), String(Math.round(k.completionRate * 100))]);
      rows.push([T('Khách mới', 'New customers'), String(k.newCustomers)]);
    }
    rows.push([]); rows.push([T('Nguồn khách', 'Customer source'), T('Lượt', 'Visits')]);
    for (const s of SRC_ORDER) { const n = src?.totals.visits[s] ?? 0; if (n > 0) rows.push([SRC_LABEL(s, vi), String(n)]); }
    rows.push([]); rows.push([T('Thiết bị', 'Device'), T('Lượt', 'Visits')]);
    for (const d of DEV_ORDER) { const n = dt ? dt[d] : 0; if (n > 0) rows.push([DEV_LABEL(d, vi), String(n)]); }
    rows.push([]); rows.push([T('Dịch vụ', 'Service'), T('Lượt', 'Bookings'), T('Doanh thu', 'Revenue')]);
    for (const s of dash?.topServices ?? []) rows.push([s.name, String(s.bookings), (s.revenueCents / 100).toFixed(2)]);
    rows.push([]); rows.push([T('Thợ', 'Staff'), T('Lượt', 'Bookings'), T('Doanh thu', 'Revenue')]);
    for (const s of dash?.topStaff ?? []) rows.push([s.name, String(s.bookings), (s.revenueCents / 100).toFixed(2)]);
    rows.push([]); rows.push([T('Phương thức', 'Method'), T('Số tiền', 'Amount')]);
    if (dash) for (const [key, val] of Object.entries(dash.paymentMethods)) if (val > 0) rows.push([PAY_LABEL(key, vi), (val / 100).toFixed(2)]);

    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `lumio-report-${from}_${to}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  return (
    <section>
      {/* Header + range + actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>{T('Báo cáo vận hành', 'Business report')}</h2>
        <div className="rp-actions" style={{ display: 'flex', gap: 8 }}>
          <button onClick={exportCsv} style={btn}>{T('Xuất CSV', 'Export CSV')}</button>
          <button onClick={() => window.print()} style={btn}>{T('In', 'Print')}</button>
        </div>
      </div>
      <div className="rp-controls" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{T('Từ', 'From')}</span>
        <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={dateInput} />
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{T('đến', 'to')}</span>
        <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={dateInput} />
        <span style={{ width: 1, height: 20, background: '#334155', margin: '0 2px' }} />
        <button onClick={() => preset('last7')} style={chip(activePreset === 'last7')}>{T('7 ngày', 'Last 7d')}</button>
        <button onClick={() => preset('thisMonth')} style={chip(activePreset === 'thisMonth')}>{T('Tháng này', 'This month')}</button>
        <button onClick={() => preset('lastMonth')} style={chip(activePreset === 'lastMonth')}>{T('Tháng trước', 'Last month')}</button>
        <button onClick={() => preset('thisYear')} style={chip(activePreset === 'thisYear')}>{T('Năm nay', 'This year')}</button>
        {activePreset === 'custom' && <span style={{ fontSize: 12, color: '#818cf8', fontWeight: 600 }}>{T('Khoảng tự chọn', 'Custom range')}</span>}
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
        <Kpi label={T('Doanh thu', 'Revenue')} value={money(k?.revenueCents ?? 0)} hint={`${T('TB/lượt', 'Avg')} ${money(k?.avgBookingValueCents ?? 0)}`} />
        <Kpi label={T('Lượt khách', 'Visits')} value={String(visitsTotal)} hint={`${T('đặt', 'booked')} ${booked} · ${T('vãng lai', 'walk-in')} ${walkin}`} />
        <Kpi label={T('Tỷ lệ no-show', 'No-show rate')} value={`${Math.round((k?.noShowRate ?? 0) * 100)}%`} hint={`${k?.noShow ?? 0} ${T('vắng', 'no-shows')}`} accent="#f59e0b" />
        <Kpi label={T('Hoàn tất', 'Completion')} value={`${Math.round((k?.completionRate ?? 0) * 100)}%`} hint={`${k?.completed ?? 0} ${T('xong', 'done')}`} accent="#22c55e" />
        <Kpi label={T('Khách mới', 'New customers')} value={String(k?.newCustomers ?? 0)} hint={`${pct(k?.newCustomers ?? 0, k?.totalBookings ?? 0)}% ${T('tổng', 'of total')}`} />
      </div>

      {/* Trend + Outcomes */}
      <div className="rp-2col" style={grid2}>
        <Card title={metric === 'revenue' ? T('Doanh thu theo ngày', 'Revenue by day') : T('Lượt đặt theo ngày', 'Bookings by day')}
          right={(
            <div style={{ display: 'inline-flex', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 2 }}>
              <button onClick={() => setMetric('revenue')} style={miniSeg(metric === 'revenue')}>{T('Doanh thu', 'Revenue')}</button>
              <button onClick={() => setMetric('bookings')} style={miniSeg(metric === 'bookings')}>{T('Lượt đặt', 'Bookings')}</button>
            </div>
          )}>
          <TrendChart series={dash?.series ?? []} money={money} metric={metric} vi={vi} />
        </Card>
        <Card title={T('Kết quả lịch hẹn', 'Booking outcomes')}>
          <Outcomes k={k} vi={vi} />
        </Card>
      </div>

      {/* Sources + Devices */}
      <div className="rp-2col" style={grid2}>
        <Card title={T('Nguồn khách', 'Customer source')}>
          {visitsTotal === 0 ? <Empty vi={vi} /> : SRC_ORDER.filter((s) => (src?.totals.visits[s] ?? 0) > 0).map((s) => (
            <Bar key={s} color={SRC_COLOR[s]} label={SRC_LABEL(s, vi)} n={src?.totals.visits[s] ?? 0} total={visitsTotal} />
          ))}
        </Card>
        <Card title={T('Khách đặt bằng thiết bị gì', 'Bookings by device')}>
          {devKnown === 0 ? (
            <p style={hint}>{vi
              ? 'Lịch cũ chưa ghi thiết bị. Lịch mới đặt qua website / link Lumio sẽ tự ghi Điện thoại / Máy tính.'
              : 'Legacy bookings have no device. New website / Lumio-link bookings record Phone / Computer automatically.'}</p>
          ) : DEV_ORDER.filter((d) => (dt ? dt[d] : 0) > 0).map((d) => (
            <Bar key={d} color={DEV_COLOR[d]} label={DEV_LABEL(d, vi)} n={dt ? dt[d] : 0} total={devKnown + (dt?.unknown ?? 0)} />
          ))}
        </Card>
      </div>

      {/* Top services + Top staff */}
      <div className="rp-2col" style={grid2}>
        <Card title={T('Dịch vụ bán chạy', 'Top services')}>
          <RankedList rows={dash?.topServices ?? []} money={money} vi={vi} />
        </Card>
        <Card title={T('Hiệu suất thợ', 'Staff performance')}>
          <RankedList rows={dash?.topStaff ?? []} money={money} vi={vi} />
        </Card>
      </div>

      {/* Peak hours + Weekday */}
      <div className="rp-2col" style={grid2}>
        <Card title={T('Giờ cao điểm', 'Peak hours')}>
          <Hours byHour={dash?.byHour ?? []} vi={vi} />
        </Card>
        <Card title={T('Theo thứ trong tuần', 'By weekday')}>
          <Weekdays byWeekday={dash?.byWeekday ?? []} vi={vi} />
        </Card>
      </div>

      {/* Payment methods */}
      <Card title={T('Phương thức thanh toán (POS)', 'Payment methods (POS)')}>
        {(() => {
          const pm = dash?.paymentMethods; const tot = pm ? pm.cash + pm.card + pm.transfer + pm.online + pm.onsite : 0;
          return tot === 0 ? <Empty vi={vi} /> : (['cash', 'card', 'transfer', 'online', 'onsite'] as const).filter((key) => (pm?.[key] ?? 0) > 0).map((key) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ width: 130, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#cbd5e1' }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: PAY_COLOR[key] }} />{PAY_LABEL(key, vi)}
              </div>
              <div style={track}><div style={{ width: `${pct(pm?.[key] ?? 0, tot)}%`, height: '100%', background: PAY_COLOR[key], borderRadius: 6 }} /></div>
              <div style={{ width: 100, textAlign: 'right', fontSize: 13, color: '#e2e8f0', flexShrink: 0 }}>{money(pm?.[key] ?? 0)}</div>
            </div>
          ));
        })()}
      </Card>

      <p style={{ color: '#64748b', fontSize: 12, marginTop: 14 }}>
        {T('Số liệu chỉ tính lịch không huỷ / không no-show cho doanh thu. Chọn khoảng ngày ở trên để đo bất kỳ kỳ nào.',
           'Revenue counts only non-cancelled / non-no-show bookings. Pick a date range above to measure any period.')}
      </p>

      <style>{`
        @media (max-width: 720px) { .rp-2col { grid-template-columns: 1fr !important; } }
        @media print {
          .rp-controls, .rp-actions { display: none !important; }
          section { color: #000 !important; }
        }
      `}</style>
    </section>
  );
}

/* ------------------------------------------------------------ components --- */
function Kpi({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent ?? '#fff' }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function Card({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ ...ui.card, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1' }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Bar({ color, label, n, total }: { color: string; label: string; n: number; total: number }) {
  const p = total > 0 ? Math.round((n / total) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <div style={{ width: 130, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#cbd5e1' }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} />{label}
      </div>
      <div style={track}><div style={{ width: `${p}%`, height: '100%', background: color, borderRadius: 6 }} /></div>
      <div style={{ width: 90, textAlign: 'right', fontSize: 13, color: '#e2e8f0', flexShrink: 0 }}><strong>{n}</strong> <span style={{ color: '#64748b' }}>· {p}%</span></div>
    </div>
  );
}

function Outcomes({ k, vi }: { k: Dash['kpis'] | undefined; vi: boolean }) {
  if (!k || k.totalBookings === 0) return <Empty vi={vi} />;
  const rows: { label: string; n: number; color: string }[] = [
    { label: vi ? 'Hoàn tất' : 'Completed', n: k.completed, color: '#22c55e' },
    { label: 'No-show', n: k.noShow, color: '#f59e0b' },
    { label: vi ? 'Huỷ' : 'Cancelled', n: k.cancelled, color: '#64748b' },
  ];
  const other = Math.max(0, k.totalBookings - k.completed - k.noShow - k.cancelled);
  if (other > 0) rows.push({ label: vi ? 'Đang chờ / khác' : 'Pending / other', n: other, color: '#3b82f6' });
  return <>{rows.map((r) => <Bar key={r.label} color={r.color} label={r.label} n={r.n} total={k.totalBookings} />)}</>;
}

function RankedList({ rows, money, vi }: { rows: Ranked[]; money: (c: number) => string; vi: boolean }) {
  const shown = rows.filter((r) => r.bookings > 0 || r.revenueCents > 0).slice(0, 8);
  if (shown.length === 0) return <Empty vi={vi} />;
  const max = Math.max(1, ...shown.map((r) => r.revenueCents));
  return (
    <>{shown.map((r, i) => (
      <div key={i} style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
          <span style={{ color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '62%' }}>{r.name}</span>
          <span style={{ color: '#94a3b8', flexShrink: 0 }}>{r.bookings} · <span style={{ color: '#22c55e' }}>{money(r.revenueCents)}</span></span>
        </div>
        <div style={{ height: 6, background: '#0f172a', borderRadius: 999 }}><div style={{ height: '100%', width: `${Math.max(3, (r.revenueCents / max) * 100)}%`, background: '#6366f1', borderRadius: 999 }} /></div>
      </div>
    ))}</>
  );
}

function TrendChart({ series, money, metric, vi }: { series: Dash['series']; money: (c: number) => string; metric: 'revenue' | 'bookings'; vi: boolean }) {
  if (!series.length) return <p style={hint}>—</p>;
  const val = (s: Dash['series'][number]) => (metric === 'revenue' ? s.revenueCents : s.bookings);
  const max = Math.max(1, ...series.map(val));
  const totalRev = series.reduce((a, s) => a + s.revenueCents, 0);
  const totalBk = series.reduce((a, s) => a + s.bookings, 0);
  const peakIdx = series.reduce((best, s, i) => (val(s) > val(series[best]) ? i : best), 0);
  const color = metric === 'revenue' ? '#6366f1' : '#22c55e';
  const fmt = (s: Dash['series'][number]) => (metric === 'revenue' ? money(s.revenueCents) : `${s.bookings} ${vi ? 'lượt' : 'bkgs'}`);
  const gap = series.length > 40 ? 1 : series.length > 20 ? 2 : 4;
  return (
    <div>
      {/* max-value guide so bar heights have a clear meaning */}
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{vi ? 'Cao nhất' : 'Peak'}: {metric === 'revenue' ? money(max) : `${max} ${vi ? 'lượt' : 'bookings'}`} · {series[peakIdx]?.date.slice(5)}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap, height: 140 }}>
        {series.map((s, i) => (
          <div key={s.date} title={`${s.date}\n${fmt(s)}`} style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
            <div style={{ width: '100%', height: `${(val(s) / max) * 100}%`, minHeight: val(s) ? 3 : 0, background: i === peakIdx ? '#f59e0b' : color, borderRadius: 3 }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: '#64748b' }}>
        <span>{series[0]?.date.slice(5)}</span>
        <span>{vi ? 'Tổng kỳ' : 'Period total'}: {metric === 'revenue' ? money(totalRev) : `${totalBk} ${vi ? 'lượt' : 'bookings'}`}</span>
        <span>{series[series.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}

function Hours({ byHour, vi }: { byHour: number[]; vi: boolean }) {
  if (!byHour.length || byHour.every((x) => x === 0)) return <Empty vi={vi} />;
  const max = Math.max(1, ...byHour);
  const peak = byHour.indexOf(max);
  const hr = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 96 }}>
        {byHour.map((n, h) => (
          <div key={h} title={`${hr(h)} · ${n}`} style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end' }}>
            <div style={{ width: '100%', height: `${(n / max) * 100}%`, minHeight: n ? 2 : 0, background: h === peak ? '#f59e0b' : '#6366f1', borderRadius: 2 }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: '#64748b' }}>
        {[0, 6, 12, 18, 23].map((h) => <span key={h}>{hr(h)}</span>)}
      </div>
      <p style={{ ...hint, marginTop: 8 }}>{vi ? 'Giờ đông nhất' : 'Busiest'}: <strong style={{ color: '#f59e0b' }}>{hr(peak)}</strong> ({max})</p>
    </div>
  );
}

function Weekdays({ byWeekday, vi }: { byWeekday: number[]; vi: boolean }) {
  if (!byWeekday.length || byWeekday.every((x) => x === 0)) return <Empty vi={vi} />;
  const names = vi ? ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const max = Math.max(1, ...byWeekday);
  const peak = byWeekday.indexOf(max);
  return (
    <>{byWeekday.map((n, i) => (
      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ width: 40, flexShrink: 0, fontSize: 12, color: i === peak ? '#f59e0b' : '#cbd5e1', fontWeight: i === peak ? 700 : 400 }}>{names[i]}</div>
        <div style={track}><div style={{ width: `${(n / max) * 100}%`, height: '100%', background: i === peak ? '#f59e0b' : '#6366f1', borderRadius: 6 }} /></div>
        <div style={{ width: 34, textAlign: 'right', fontSize: 13, color: '#e2e8f0', flexShrink: 0 }}>{n}</div>
      </div>
    ))}</>
  );
}

function Empty({ vi }: { vi: boolean }) {
  return <p style={hint}>{vi ? 'Chưa có dữ liệu trong kỳ này.' : 'No data in this period.'}</p>;
}

/* ---------------------------------------------------------------- styles --- */
const grid2: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 };
const track: CSSProperties = { flex: 1, height: 18, background: '#0f172a', borderRadius: 6, overflow: 'hidden' };
const hint: CSSProperties = { color: '#64748b', fontSize: 13, lineHeight: 1.6, margin: 0 };
const btn: CSSProperties = { padding: '7px 14px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e2e8f0', fontSize: 13, cursor: 'pointer' };
const chip = (on: boolean): CSSProperties => ({ padding: '6px 12px', borderRadius: 8, border: `1px solid ${on ? '#6366f1' : '#334155'}`, background: on ? '#6366f1' : 'transparent', color: on ? '#fff' : '#cbd5e1', fontSize: 12, fontWeight: on ? 700 : 400, cursor: 'pointer' });
const miniSeg = (on: boolean): CSSProperties => ({ padding: '4px 10px', borderRadius: 6, border: 'none', background: on ? '#6366f1' : 'transparent', color: on ? '#fff' : '#94a3b8', fontSize: 12, fontWeight: on ? 700 : 400, cursor: 'pointer' });
const dateInput: CSSProperties = { background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 8, padding: '6px 10px', fontSize: 13 };
