'use client';

import { useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { DateRangeBar, useDateRange } from '../../../components/ListFilter';
import { useLang, tr } from '../../../lib/i18n';
import { useIsMobile } from '../../../lib/responsive';
import { MList, MCard, MHead, MRow } from '../../../components/MobileCard';
import { useState as useTabState } from 'react';

interface Row {
  staffId: string; name: string; commissionPercent: number; serviceCount: number;
  serviceRevenueCents: number; productRevenueCents: number; tipsCents: number; commissionCents: number; baseCents: number; totalPayCents: number;
  directTipsCents?: number;
}
interface Report {
  totals: { revenueCents: number; tipsCents: number; commissionCents: number; baseCents: number; payCents: number; orders: number; directTipsCents?: number };
  staff: Row[];
}

export default function PayrollPage() {
  return <SalonShell><Hub /></SalonShell>;
}

/** One place for everything about the team: how each tech is performing, and the
 *  payroll that follows from it. Two tabs so the owner isn't hunting across pages. */
function Hub() {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [tab, setTab] = useTabState<'performance' | 'payroll'>('performance');
  const tabBtn = (id: 'performance' | 'payroll', label: string, icon: string) => (
    <button onClick={() => setTab(id)} style={{
      padding: '10px 18px', borderRadius: 999, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 700,
      background: tab === id ? '#6366f1' : '#1e293b', color: tab === id ? '#fff' : '#94a3b8',
    }}>{icon} {label}</button>
  );
  return (
    <section>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{t('pf.hubTitle')}</h1>
      <p style={{ color: '#94a3b8', margin: '0 0 16px', fontSize: 14 }}>{t('pf.hubSub')}</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {tabBtn('performance', t('pf.tabPerformance'), '📊')}
        {tabBtn('payroll', t('pf.tabPayroll'), '💵')}
      </div>
      {tab === 'performance' ? <Performance /> : <Inner />}
    </section>
  );
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const isMobile = useIsMobile();
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
    const header = ['Technician', '# Services', 'Service Revenue', 'Commission %', 'Commission', 'Base Pay', 'Tips', 'Direct Tips', 'Total Pay'];
    const body = techs.map((r) => [r.name, String(r.serviceCount), dollars(r.serviceRevenueCents), String(r.commissionPercent), dollars(r.commissionCents), dollars(r.baseCents), dollars(r.tipsCents), dollars(r.directTipsCents ?? 0), dollars(r.totalPayCents)]);
    const totals = [t('pr.csvTotal'), '', dollars(data.totals.revenueCents), '', dollars(data.totals.commissionCents), dollars(data.totals.baseCents), dollars(data.totals.tipsCents), dollars(data.totals.directTipsCents ?? 0), dollars(data.totals.payCents)];
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
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
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
            {(data.totals.directTipsCents ?? 0) > 0 && <Kpi label={t('pr.kDirectTips')} value={formatPrice(data.totals.directTipsCents!)} accent="#34d399" />}
            <Kpi label={t('pr.kRevenue')} value={formatPrice(data.totals.revenueCents)} accent="#3b82f6" />
          </div>

          {isMobile ? (
            <MList>
              {techs.length === 0 && <p style={{ color: '#64748b', fontSize: 13 }}>{t('pr.empty')}</p>}
              {techs.map((r) => (
                <MCard key={r.staffId}>
                  <MHead right={<span style={{ color: '#22c55e', fontWeight: 800, fontSize: 16 }}>{formatPrice(r.totalPayCents)}</span>}>
                    {r.name}
                  </MHead>
                  <MRow label={t('pr.cCount')}>{r.serviceCount}</MRow>
                  <MRow label={t('pr.cRevenue')}>{formatPrice(r.serviceRevenueCents)}</MRow>
                  <MRow label={t('pr.cCommission')}>{formatPrice(r.commissionCents)} <span style={{ color: '#64748b', fontSize: 12 }}>({r.commissionPercent}%)</span></MRow>
                  <MRow label={t('pr.cBase')}>{r.baseCents > 0 ? formatPrice(r.baseCents) : '—'}</MRow>
                  <MRow label={t('pr.cTips')}>{formatPrice(r.tipsCents)}</MRow>
                  {(r.directTipsCents ?? 0) > 0 && <MRow label={t('pr.cDirectTips')}>{formatPrice(r.directTipsCents!)}</MRow>}
                </MCard>
              ))}
            </MList>
          ) : (
            <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead><tr style={{ background: '#1e293b' }}>
                <th style={ui.th}>{t('pr.cTech')}</th>
                <th style={ui.th}>{t('pr.cCount')}</th>
                <th style={ui.th}>{t('pr.cRevenue')}</th>
                <th style={ui.th}>{t('pr.cCommission')}</th>
                <th style={ui.th}>{t('pr.cBase')}</th>
                <th style={ui.th}>{t('pr.cTips')}</th>
                <th style={{ ...ui.th, color: '#34d399' }}>{t('pr.cDirectTips')}</th>
                <th style={{ ...ui.th, color: '#22c55e' }}>{t('pr.cTotal')}</th>
              </tr></thead>
              <tbody>
                {techs.length === 0 && <tr><td style={ui.td} colSpan={8}>{t('pr.empty')}</td></tr>}
                {techs.map((r) => (
                  <tr key={r.staffId} style={{ borderTop: '1px solid #334155' }}>
                    <td style={ui.td}>{r.name}</td>
                    <td style={ui.td}>{r.serviceCount}</td>
                    <td style={ui.td}>{formatPrice(r.serviceRevenueCents)}</td>
                    <td style={{ ...ui.td, color: '#06b6d4' }}>{formatPrice(r.commissionCents)} <span style={{ color: '#64748b', fontSize: 12 }}>({r.commissionPercent}%)</span></td>
                    <td style={{ ...ui.td, color: '#cbd5e1' }}>{r.baseCents > 0 ? formatPrice(r.baseCents) : '—'}</td>
                    <td style={{ ...ui.td, color: '#a855f7' }}>{formatPrice(r.tipsCents)}</td>
                    <td style={{ ...ui.td, color: '#34d399' }}>{(r.directTipsCents ?? 0) > 0 ? formatPrice(r.directTipsCents!) : '—'}</td>
                    <td style={{ ...ui.td, fontWeight: 800, color: '#22c55e', fontSize: 15 }}>{formatPrice(r.totalPayCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
          <p style={{ color: '#64748b', fontSize: 12, marginTop: 10 }}>{t('pr.note')}</p>
          {(data.totals.directTipsCents ?? 0) > 0 && <p style={{ color: '#34d399', fontSize: 12, marginTop: 4 }}>{t('pr.directNote')}</p>}
        </>
      )}
    </div>
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

// ===========================================================================
// Staff performance — who did what, how much they earned, their reviews, their
// points, their #1 service, and their recent customers. Default: this month.
// ===========================================================================
interface PerfRow {
  staffId: string; name: string; avatarUrl: string | null; isActive: boolean;
  completed: number; serviceRevenueCents: number; collectedCents: number; tipsCents: number;
  rating: number; reviewCount: number; points: number;
  topService: { name: string; count: number } | null;
  recent: { name: string; date: string; service: string }[];
}
interface Perf {
  range: { from: string; to: string };
  rows: PerfRow[];
  totals: { completed: number; serviceRevenueCents: number; collectedCents: number; tipsCents: number; reviewCount: number };
}

function monthRange(): { from: string; to: string } {
  const n = new Date();
  const from = new Date(n.getFullYear(), n.getMonth(), 1);
  const to = new Date(n.getFullYear(), n.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from: from.toISOString(), to: to.toISOString() };
}

function Performance() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const isMobile = useIsMobile();
  const range = useDateRange('month');
  const [data, setData] = useState<Perf | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<'revenue' | 'completed' | 'tips' | 'rating' | 'points'>('revenue');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const q = new URLSearchParams();
      const r = range.from || range.to ? { from: range.from ?? '', to: range.to ?? '' } : monthRange();
      if (r.from) q.set('from', r.from);
      if (r.to) q.set('to', r.to);
      setData(await apiFetch<Perf>(`/staff/performance?${q.toString()}`, { token }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally { setLoading(false); }
  }, [token, range.from, range.to]);
  useEffect(() => { load(); }, [load]);

  const rows = [...(data?.rows ?? [])].sort((a, b) => {
    switch (sortKey) {
      case 'completed': return b.completed - a.completed;
      case 'tips': return b.tipsCents - a.tipsCents;
      case 'rating': return b.rating - a.rating || b.reviewCount - a.reviewCount;
      case 'points': return b.points - a.points;
      default: return (b.collectedCents + b.serviceRevenueCents) - (a.collectedCents + a.serviceRevenueCents);
    }
  });
  // Highlight the leaders so the eye lands on them instantly.
  const best = {
    revenue: rows.reduce((m, r) => Math.max(m, r.collectedCents + r.serviceRevenueCents), 0),
    tips: rows.reduce((m, r) => Math.max(m, r.tipsCents), 0),
    reviews: rows.reduce((m, r) => Math.max(m, r.reviewCount), 0),
    points: rows.reduce((m, r) => Math.max(m, r.points), 0),
  };

  const money = (r: PerfRow) => r.collectedCents > 0 ? r.collectedCents : r.serviceRevenueCents;

  const sortChip = (k: typeof sortKey, label: string) => (
    <button onClick={() => setSortKey(k)} style={{
      padding: '6px 13px', borderRadius: 999, cursor: 'pointer', fontSize: 12.5, fontWeight: 700,
      border: `1px solid ${sortKey === k ? '#6366f1' : '#334155'}`,
      background: sortKey === k ? 'rgba(99,102,241,0.15)' : 'transparent', color: sortKey === k ? '#c7d2fe' : '#94a3b8',
    }}>{label}</button>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: '#94a3b8', alignSelf: 'center' }}>{t('pf.sortBy')}</span>
          {sortChip('revenue', t('pf.sRevenue'))}
          {sortChip('completed', t('pf.sVisits'))}
          {sortChip('tips', t('pf.sTips'))}
          {sortChip('rating', t('pf.sRating'))}
          {sortChip('points', t('pf.sPoints'))}
        </div>
        <DateRangeBar range={range} />
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      {loading || !data ? <p style={{ color: '#94a3b8' }}>Loading…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 18 }}>
            <Kpi label={t('pf.kRevenue')} value={formatPrice(data.totals.collectedCents || data.totals.serviceRevenueCents)} accent="#22c55e" big />
            <Kpi label={t('pf.kVisits')} value={String(data.totals.completed)} accent="#3b82f6" />
            <Kpi label={t('pf.kTips')} value={formatPrice(data.totals.tipsCents)} accent="#a855f7" />
            <Kpi label={t('pf.kReviews')} value={String(data.totals.reviewCount)} accent="#f59e0b" />
          </div>

          {rows.length === 0 ? <p style={{ color: '#64748b', fontSize: 13 }}>{t('pf.empty')}</p> : isMobile ? (
            <MList>
              {rows.map((r, i) => (
                <MCard key={r.staffId}>
                  <MHead right={<span style={{ color: '#22c55e', fontWeight: 800 }}>{formatPrice(money(r))}</span>}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{medal(i)}<Ava r={r} />{r.name}</span>
                  </MHead>
                  <MRow label={t('pf.cVisits')}>{r.completed}</MRow>
                  <MRow label={t('pf.cTips')}>{formatPrice(r.tipsCents)}</MRow>
                  <MRow label={t('pf.cRating')}>{r.reviewCount ? <>⭐ {r.rating} <span style={{ color: '#64748b' }}>({r.reviewCount})</span></> : '—'}</MRow>
                  <MRow label={t('pf.cPoints')}>{r.points ? <span style={{ color: '#eab308' }}>{r.points}</span> : '—'}</MRow>
                  <MRow label={t('pf.cTop')}>{r.topService ? `${r.topService.name} ×${r.topService.count}` : '—'}</MRow>
                  {r.recent.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <button onClick={() => setOpen(open === r.staffId ? null : r.staffId)} style={{ background: 'none', border: 'none', color: '#818cf8', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', padding: 0 }}>
                        {open === r.staffId ? t('pf.hideCustomers') : `${t('pf.showCustomers')} (${r.recent.length})`}
                      </button>
                      {open === r.staffId && <RecentList recent={r.recent} />}
                    </div>
                  )}
                </MCard>
              ))}
            </MList>
          ) : (
            <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead><tr style={{ background: '#1e293b' }}>
                  <th style={ui.th}>#</th>
                  <th style={ui.th}>{t('pf.cTech')}</th>
                  <th style={ui.th}>{t('pf.cVisits')}</th>
                  <th style={ui.th}>{t('pf.cRevenue')}</th>
                  <th style={ui.th}>{t('pf.cTips')}</th>
                  <th style={ui.th}>{t('pf.cRating')}</th>
                  <th style={ui.th}>{t('pf.cPoints')}</th>
                  <th style={ui.th}>{t('pf.cTop')}</th>
                  <th style={ui.th}>{t('pf.cCustomers')}</th>
                </tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <>
                      <tr key={r.staffId} style={{ borderTop: '1px solid #334155', opacity: r.isActive ? 1 : 0.55 }}>
                        <td style={{ ...ui.td, color: '#64748b' }}>{medal(i) || i + 1}</td>
                        <td style={ui.td}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}><Ava r={r} /><b>{r.name}</b>{!r.isActive && <span style={{ fontSize: 11, color: '#64748b' }}>({t('pf.inactive')})</span>}</span></td>
                        <td style={ui.td}>{r.completed}</td>
                        <td style={{ ...ui.td, fontWeight: 800, color: money(r) === best.revenue && best.revenue > 0 ? '#22c55e' : '#e2e8f0' }}>{formatPrice(money(r))}</td>
                        <td style={{ ...ui.td, color: r.tipsCents === best.tips && best.tips > 0 ? '#a855f7' : '#cbd5e1', fontWeight: r.tipsCents === best.tips && best.tips > 0 ? 700 : 400 }}>{formatPrice(r.tipsCents)}</td>
                        <td style={ui.td}>{r.reviewCount ? <span style={{ color: r.reviewCount === best.reviews && best.reviews > 0 ? '#f59e0b' : '#e2e8f0', fontWeight: 600 }}>⭐ {r.rating} <span style={{ color: '#64748b', fontSize: 12 }}>({r.reviewCount})</span></span> : <span style={{ color: '#475569' }}>—</span>}</td>
                        <td style={{ ...ui.td, color: r.points === best.points && best.points > 0 ? '#eab308' : '#cbd5e1', fontWeight: r.points === best.points && best.points > 0 ? 700 : 400 }}>{r.points || '—'}</td>
                        <td style={{ ...ui.td, color: '#cbd5e1' }}>{r.topService ? <>{r.topService.name} <span style={{ color: '#64748b' }}>×{r.topService.count}</span></> : '—'}</td>
                        <td style={ui.td}>
                          {r.recent.length > 0
                            ? <button onClick={() => setOpen(open === r.staffId ? null : r.staffId)} style={{ background: 'none', border: '1px solid #334155', color: '#818cf8', fontSize: 12, fontWeight: 700, cursor: 'pointer', borderRadius: 8, padding: '4px 10px' }}>{open === r.staffId ? t('pf.hide') : `${r.recent.length} ▾`}</button>
                            : <span style={{ color: '#475569' }}>—</span>}
                        </td>
                      </tr>
                      {open === r.staffId && (
                        <tr key={`${r.staffId}-x`} style={{ background: '#0f172a' }}>
                          <td></td>
                          <td colSpan={8} style={{ padding: '10px 14px' }}><RecentList recent={r.recent} /></td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ color: '#64748b', fontSize: 12, marginTop: 12 }}>{t('pf.note')}</p>
        </>
      )}
    </div>
  );
}

function Ava({ r }: { r: PerfRow }) {
  const initials = r.name.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('');
  if (r.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={r.avatarUrl} alt="" width={26} height={26} style={{ borderRadius: '50%', objectFit: 'cover' }} />;
  }
  return <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#334155', color: '#c7d2fe', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700 }}>{initials || '?'}</span>;
}
function medal(i: number): string { return i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : ''; }

function RecentList({ recent }: { recent: { name: string; date: string; service: string }[] }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  return (
    <div>
      <div style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 6, fontWeight: 700 }}>{t('pf.recentTitle')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {recent.map((x, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, borderBottom: '1px solid #1e293b', paddingBottom: 5 }}>
            <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{x.name}</span>
            <span style={{ color: '#94a3b8' }}>{x.service}</span>
            <span style={{ color: '#64748b', whiteSpace: 'nowrap' }}>{new Date(x.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
