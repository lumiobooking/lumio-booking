'use client';

import { useCallback, useEffect, useState, CSSProperties } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';

type Src = 'online' | 'hotline' | 'messenger' | 'walkin' | 'staff';
type Counts = Record<Src, number>;
interface Bkt { key: string; visits: Counts; visitsTotal: number; revenueCents: Counts; revenueTotalCents: number }
interface Report { bucket: 'day' | 'month' | 'year'; from: string; to: string; sources: Src[]; buckets: Bkt[]; totals: { visits: Counts; visitsTotal: number; revenueCents: Counts; revenueTotalCents: number } }

const ORDER: Src[] = ['online', 'hotline', 'messenger', 'walkin', 'staff'];
const COLOR: Record<Src, string> = { online: '#6366f1', hotline: '#22c55e', messenger: '#3b82f6', walkin: '#f59e0b', staff: '#a78bfa' };
const LABEL = (s: Src, vi: boolean): string => ({
  online: vi ? 'Online (web)' : 'Online',
  hotline: vi ? 'Hotline (gọi)' : 'Hotline',
  messenger: 'Messenger',
  walkin: vi ? 'Khách vãng lai' : 'Walk-in',
  staff: vi ? 'Nhân viên nhập' : 'Staff',
}[s]);

function fmtKey(key: string, bucket: string): string {
  const p = key.split('-');
  if (bucket === 'year') return p[0];
  if (bucket === 'month') return `${p[1]}/${p[0].slice(2)}`;
  return `${p[2]}/${p[1]}`;
}

export default function ReportsPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const [bucket, setBucket] = useState<'day' | 'month' | 'year'>('day');
  const [data, setData] = useState<Report | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [rep, settings] = await Promise.all([
        apiFetch<Report>(`/stats/sources?bucket=${bucket}`, { token }),
        apiFetch<{ booking?: { currency?: string } }>('/settings', { token }).catch(() => ({} as { booking?: { currency?: string } })),
      ]);
      setData(rep);
      if (settings?.booking?.currency) setCurrency(settings.booking.currency);
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token, bucket]);
  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <section><h2 style={{ fontSize: 18 }}>{vi ? 'Thống kê' : 'Reports'}</h2><p style={{ color: '#94a3b8' }}>Loading…</p></section>;

  const t = data?.totals;
  const totalVisits = t?.visitsTotal ?? 0;
  const maxBucket = Math.max(1, ...(data?.buckets ?? []).map((b) => b.visitsTotal));
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>{vi ? 'Thống kê nguồn khách' : 'Customer source report'}</h2>
        <div style={{ display: 'inline-flex', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: 3 }}>
          {(['day', 'month', 'year'] as const).map((b) => (
            <button key={b} onClick={() => setBucket(b)} style={seg(bucket === b)}>
              {b === 'day' ? (vi ? 'Ngày' : 'Day') : b === 'month' ? (vi ? 'Tháng' : 'Month') : (vi ? 'Năm' : 'Year')}
            </button>
          ))}
        </div>
      </div>
      <p style={{ color: '#94a3b8', margin: '0 0 16px', fontSize: 13 }}>
        {vi ? 'Đếm cả khách đặt lịch (Online/Hotline/Messenger/Nhân viên) và khách vãng lai — phân biệt rõ nguồn.' : 'Counts both booked customers (Online/Hotline/Messenger/Staff) and walk-ins, split by source.'}
      </p>

      {error && <div style={ui.banner}>{error}</div>}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 }}>
        <div style={kpi}><div style={kpiLabel}>{vi ? 'Tổng lượt khách' : 'Total customers'}</div><div style={kpiNum}>{totalVisits}</div></div>
        <div style={kpi}><div style={kpiLabel}>{vi ? 'Doanh thu (POS)' : 'Revenue (POS)'}</div><div style={kpiNum}>{formatPrice(t?.revenueTotalCents ?? 0, currency)}</div></div>
        {(['walkin', 'online'] as Src[]).map((s) => (
          <div key={s} style={kpi}><div style={kpiLabel}>{LABEL(s, vi)}</div>
            <div style={kpiNum}>{t?.visits[s] ?? 0} <span style={{ fontSize: 14, color: '#64748b' }}>· {pct(t?.visits[s] ?? 0, totalVisits)}%</span></div></div>
        ))}
      </div>

      {/* Customers by source */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={cardTitle}>{vi ? 'Khách theo nguồn' : 'Customers by source'}</div>
        {totalVisits === 0 ? <div style={{ color: '#64748b', fontSize: 13 }}>{vi ? 'Chưa có dữ liệu trong kỳ này.' : 'No data in this period.'}</div>
          : ORDER.map((s) => {
            const n = t?.visits[s] ?? 0;
            return (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ width: 130, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#cbd5e1' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: COLOR[s], flexShrink: 0 }} />{LABEL(s, vi)}
                </div>
                <div style={{ flex: 1, height: 18, background: '#0f172a', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ width: `${pct(n, totalVisits)}%`, height: '100%', background: COLOR[s], borderRadius: 6 }} />
                </div>
                <div style={{ width: 90, textAlign: 'right', fontSize: 13, color: '#e2e8f0', flexShrink: 0 }}><strong>{n}</strong> <span style={{ color: '#64748b' }}>· {pct(n, totalVisits)}%</span></div>
              </div>
            );
          })}
      </div>

      {/* Trend over time (stacked bars) */}
      <div style={{ ...ui.card, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <div style={cardTitle}>{vi ? 'Xu hướng theo thời gian' : 'Trend over time'}</div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {ORDER.map((s) => (
              <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#94a3b8' }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: COLOR[s] }} />{LABEL(s, vi)}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 200 }}>
          {(data?.buckets ?? []).map((b) => (
            <div key={b.key} style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
              title={`${fmtKey(b.key, bucket)} · ${b.visitsTotal}\n${ORDER.map((s) => `${LABEL(s, vi)}: ${b.visits[s]}`).join('\n')}`}>
              <div style={{ height: `${(b.visitsTotal / maxBucket) * 100}%`, display: 'flex', flexDirection: 'column-reverse', borderRadius: 4, overflow: 'hidden', minHeight: b.visitsTotal ? 3 : 0 }}>
                {ORDER.map((s) => b.visits[s] > 0 && (
                  <div key={s} style={{ height: `${(b.visits[s] / b.visitsTotal) * 100}%`, background: COLOR[s] }} />
                ))}
              </div>
              <div style={{ fontSize: 10, color: '#64748b', textAlign: 'center', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden' }}>{fmtKey(b.key, bucket)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Revenue by source */}
      <div style={ui.card}>
        <div style={cardTitle}>{vi ? 'Doanh thu theo nguồn (POS)' : 'Revenue by source (POS)'}</div>
        {(() => {
          const maxRev = Math.max(1, ...ORDER.map((s) => t?.revenueCents[s] ?? 0));
          return (t?.revenueTotalCents ?? 0) === 0 ? <div style={{ color: '#64748b', fontSize: 13 }}>{vi ? 'Chưa có doanh thu POS trong kỳ này.' : 'No POS revenue in this period.'}</div>
            : ORDER.map((s) => {
              const c = t?.revenueCents[s] ?? 0;
              return (
                <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 130, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#cbd5e1' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 3, background: COLOR[s], flexShrink: 0 }} />{LABEL(s, vi)}
                  </div>
                  <div style={{ flex: 1, height: 18, background: '#0f172a', borderRadius: 6, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.round((c / maxRev) * 100)}%`, height: '100%', background: COLOR[s], borderRadius: 6 }} />
                  </div>
                  <div style={{ width: 90, textAlign: 'right', fontSize: 13, color: '#e2e8f0', flexShrink: 0 }}>{formatPrice(c, currency)}</div>
                </div>
              );
            });
        })()}
      </div>
    </section>
  );
}

const seg = (on: boolean): CSSProperties => ({ padding: '7px 16px', borderRadius: 6, border: 'none', background: on ? '#6366f1' : 'transparent', color: on ? '#fff' : '#94a3b8', fontSize: 13, fontWeight: 600, cursor: 'pointer' });
const kpi: CSSProperties = { background: '#111827', border: '1px solid #1e293b', borderRadius: 12, padding: '12px 14px' };
const kpiLabel: CSSProperties = { fontSize: 12, color: '#94a3b8', marginBottom: 4 };
const kpiNum: CSSProperties = { fontSize: 24, fontWeight: 800, color: '#fff' };
const cardTitle: CSSProperties = { fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginBottom: 12 };
