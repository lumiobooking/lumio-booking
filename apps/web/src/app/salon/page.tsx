'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SalonShell } from '../../components/SalonShell';
import { useAuth } from '../../lib/auth';
import { apiFetch } from '../../lib/api';
import { ui, formatPrice } from '../../lib/ui';
import { useLang, tr } from '../../lib/i18n';
import { useLiveRefresh } from '../../lib/useLiveRefresh';

interface SeriesPoint { date: string; bookings: number; revenueCents: number }
interface Ranked { name: string; bookings: number; revenueCents: number }
interface Upcoming {
  id: string;
  status: string;
  startTime: string;
  customer: { firstName: string; lastName: string | null } | null;
  service: { name: string } | null;
  assignedStaff: { firstName: string; lastName: string | null } | null;
}
interface Dashboard {
  range: { from: string; to: string };
  kpis: {
    totalBookings: number;
    revenueCents: number;
    newCustomers: number;
    completed: number;
    noShow: number;
    cancelled: number;
    avgBookingValueCents: number;
    noShowRate: number;
    completionRate: number;
  };
  statusBreakdown: Record<string, number>;
  paymentMethods: { cash: number; card: number; transfer: number; online: number; onsite: number };
  series: SeriesPoint[];
  topStaff: Ranked[];
  topServices: Ranked[];
  upcoming: Upcoming[];
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#eab308', ASSIGNED: '#3b82f6', ACCEPTED: '#22c55e', CONFIRMED: '#22c55e',
  REJECTED: '#ef4444', CANCELLED: '#94a3b8', COMPLETED: '#a855f7', NO_SHOW: '#f97316',
};

const PRESETS: { label: string; days: number }[] = [
  { label: '7D', days: 7 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
];

function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function DashboardPage() {
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
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setData(await apiFetch<Dashboard>(`/overview/dashboard?from=${from}&to=${to}`, { token }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [token, from, to]);

  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, 30000);

  const applyPreset = (days: number) => {
    setFrom(isoDay(new Date(Date.now() - (days - 1) * 86400000)));
    setTo(isoDay(today));
  };
  const applyThisMonth = () => {
    const d = new Date();
    setFrom(isoDay(new Date(d.getFullYear(), d.getMonth(), 1)));
    setTo(isoDay(d));
  };

  const name = (p: { firstName?: string; lastName?: string | null } | null) =>
    p ? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() : '—';

  return (
    <section>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{t('db.title')}</h1>
          <p style={{ color: '#94a3b8', marginTop: 0, fontSize: 14 }}>
            {t('db.subtitle')}
          </p>
        </div>

        {/* Date range controls */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: 3 }}>
            {PRESETS.map((p) => (
              <button key={p.label} onClick={() => applyPreset(p.days)} style={presetBtn}>{p.label}</button>
            ))}
            <button onClick={applyThisMonth} style={presetBtn}>{t('db.month')}</button>
          </div>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={dateInput} />
          <span style={{ color: '#64748b' }}>→</span>
          <input type="date" value={to} min={from} max={isoDay(today)} onChange={(e) => setTo(e.target.value)} style={dateInput} />
        </div>
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      {!data ? (
        <p style={{ color: '#94a3b8', marginTop: 24 }}>{t('db.loading')}</p>
      ) : (
        <>
          {/* KPI tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14, margin: '20px 0' }}>
            <Kpi label={t('db.revenue')} value={formatPrice(data.kpis.revenueCents)} accent="#22c55e" hint={t('db.avgPerBooking').replace('{v}', formatPrice(data.kpis.avgBookingValueCents))} />
            <Kpi label={t('db.bookings')} value={data.kpis.totalBookings} accent="#3b82f6" hint={`${data.kpis.completed} ${t('db.completed')}`} />
            <Kpi label={t('db.newCustomers')} value={data.kpis.newCustomers} accent="#a855f7" />
            <Kpi label={t('db.completionRate')} value={pct(data.kpis.completionRate)} accent="#06b6d4" />
            <Kpi label={t('db.noShowRate')} value={pct(data.kpis.noShowRate)} accent="#f97316" hint={`${data.kpis.noShow} ${t('db.noShows')}`} />
            <Kpi label={t('db.cancelled')} value={data.kpis.cancelled} accent="#ef4444" />
          </div>

          {/* Trend chart */}
          <Card title={t('db.revAndBookings')}>
            <TrendChart series={data.series} />
          </Card>

          {/* Status breakdown + Payment methods side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginTop: 16 }}>
            <Card title={t('db.bookingStatus')}>
              <StatusBreakdown breakdown={data.statusBreakdown} total={data.kpis.totalBookings} />
            </Card>
            <Card title={t('db.revByMethod')}>
              <PaymentMethods pm={data.paymentMethods} />
            </Card>
          </div>

          {/* Top services */}
          <div style={{ marginTop: 16 }}>
            <Card title={t('db.topServices')}>
              <RankedTable rows={data.topServices} firstCol={t('db.colService')} empty={t('db.noBookingsRange')} />
            </Card>
          </div>

          {/* Top staff + Upcoming */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginTop: 16 }}>
            <Card title={t('db.staffRevenue')}>
              <RankedTable rows={data.topStaff} firstCol={t('db.colStaff')} empty={t('db.noStaff')} />
            </Card>
            <Card title={t('db.upcoming')}>
              {data.upcoming.length === 0 ? (
                <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>{t('db.noUpcoming')}</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.upcoming.map((b) => (
                    <div key={b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: '1px solid #1f2937' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {name(b.customer)}
                        </div>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>
                          {b.service?.name ?? '—'} · {name(b.assignedStaff)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ fontSize: 13 }}>{new Date(b.startTime).toLocaleDateString()}</div>
                        <div style={{ fontSize: 12, color: '#94a3b8' }}>
                          {new Date(b.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </section>
  );
}

/* ---------- small presentational pieces ---------- */

function pct(v: number) {
  return `${Math.round(v * 100)}%`;
}

function Kpi({ label, value, accent, hint }: { label: string; value: number | string; accent: string; hint?: string }) {
  return (
    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 12, padding: 16, borderLeft: `3px solid ${accent}` }}>
      <div style={{ fontSize: 12, color: '#94a3b8' }}>{label}</div>
      <div style={{ fontSize: 25, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ ...ui.card, padding: 18 }}>
      <h2 style={{ fontSize: 14, margin: '0 0 14px', color: '#cbd5e1', fontWeight: 600 }}>{title}</h2>
      {children}
    </div>
  );
}

function RankedTable({ rows, firstCol, empty }: { rows: Ranked[]; firstCol: string; empty: string }) {
  if (rows.length === 0) return <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>{empty}</p>;
  const max = Math.max(...rows.map((r) => r.revenueCents), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.map((r, i) => (
        <div key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '60%' }}>
              {r.name}
            </span>
            <span style={{ color: '#94a3b8' }}>
              {r.bookings} · <span style={{ color: '#22c55e' }}>{formatPrice(r.revenueCents)}</span>
            </span>
          </div>
          <div style={{ height: 6, background: '#0f172a', borderRadius: 999 }}>
            <div style={{ height: '100%', width: `${Math.max(4, (r.revenueCents / max) * 100)}%`, background: '#6366f1', borderRadius: 999 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PaymentMethods({ pm }: { pm: { cash: number; card: number; transfer: number; online: number; onsite: number } }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const rows: { label: string; value: number; color: string }[] = [
    { label: t('db.pmCash'), value: pm.cash, color: '#22c55e' },
    { label: t('db.pmCard'), value: pm.card, color: '#3b82f6' },
    { label: t('db.pmTransfer'), value: pm.transfer, color: '#06b6d4' },
    { label: t('db.pmOnline'), value: pm.online, color: '#a855f7' },
    { label: t('db.pmOnsite'), value: pm.onsite, color: '#eab308' },
  ];
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (total === 0) return <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>{t('db.noPayments')}</p>;
  return (
    <>
      <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', marginBottom: 14 }}>
        {rows.filter((r) => r.value > 0).map((r) => (
          <div key={r.label} title={`${r.label}: ${formatPrice(r.value)}`} style={{ width: `${(r.value / total) * 100}%`, background: r.color }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: r.color }} />
            <span style={{ color: '#cbd5e1' }}>{r.label}</span>
            <span style={{ marginLeft: 'auto', color: '#e2e8f0', fontWeight: 600 }}>{formatPrice(r.value)}</span>
            <span style={{ color: '#64748b', width: 42, textAlign: 'right' }}>{Math.round((r.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </>
  );
}

function StatusBreakdown({ breakdown, total }: { breakdown: Record<string, number>; total: number }) {
  const { lang } = useLang();
  const entries = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  if (total === 0) return <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>{tr('db.noBookingsRange', lang)}</p>;
  return (
    <>
      <div style={{ display: 'flex', height: 12, borderRadius: 999, overflow: 'hidden', marginBottom: 14 }}>
        {entries.map(([s, n]) => (
          <div key={s} title={`${s}: ${n}`} style={{ width: `${(n / total) * 100}%`, background: STATUS_COLORS[s] ?? '#64748b' }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
        {entries.map(([s, n]) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: STATUS_COLORS[s] ?? '#64748b' }} />
            <span style={{ color: '#cbd5e1' }}>{s}</span>
            <span style={{ marginLeft: 'auto', color: '#94a3b8' }}>{n}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/** Inline SVG chart: revenue bars + bookings line. No external libraries. */
function TrendChart({ series }: { series: SeriesPoint[] }) {
  const { lang } = useLang();
  const W = 760;
  const H = 200;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = series.length;

  if (n === 0) return <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>{tr('db.noData', lang)}</p>;

  const maxRev = Math.max(...series.map((s) => s.revenueCents), 1);
  const maxBook = Math.max(...series.map((s) => s.bookings), 1);
  const slot = innerW / n;
  const barW = Math.max(2, Math.min(22, slot * 0.6));

  const linePts = series.map((s, i) => {
    const x = padL + slot * i + slot / 2;
    const y = padT + innerH - (s.bookings / maxBook) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  // sparse x labels (about 6)
  const step = Math.max(1, Math.round(n / 6));

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
        {/* revenue bars */}
        {series.map((s, i) => {
          const h = (s.revenueCents / maxRev) * innerH;
          const x = padL + slot * i + (slot - barW) / 2;
          const y = padT + innerH - h;
          return <rect key={i} x={x} y={y} width={barW} height={Math.max(0, h)} rx={2} fill="#22c55e" opacity={0.55} />;
        })}
        {/* bookings line */}
        <polyline points={linePts.join(' ')} fill="none" stroke="#6366f1" strokeWidth={2} />
        {series.map((s, i) => {
          const x = padL + slot * i + slot / 2;
          const y = padT + innerH - (s.bookings / maxBook) * innerH;
          return <circle key={i} cx={x} cy={y} r={2.2} fill="#818cf8" />;
        })}
        {/* x labels */}
        {series.map((s, i) =>
          i % step === 0 ? (
            <text key={i} x={padL + slot * i + slot / 2} y={H - 6} fontSize={9} fill="#64748b" textAnchor="middle">
              {s.date.slice(5)}
            </text>
          ) : null,
        )}
      </svg>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: '#22c55e', opacity: 0.6 }} /> Revenue
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 2, background: '#6366f1' }} /> Bookings
        </span>
      </div>
    </div>
  );
}

const presetBtn: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: '#cbd5e1',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const dateInput: React.CSSProperties = {
  padding: '7px 9px',
  borderRadius: 8,
  border: '1px solid #475569',
  background: '#0f172a',
  color: '#e2e8f0',
  fontSize: 13,
  colorScheme: 'dark',
};
