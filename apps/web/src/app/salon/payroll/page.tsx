'use client';

import { useCallback, useEffect, useState } from 'react';
import { fmtInTz } from '../../../lib/datetime';
import { dayKeyInTz, wallToInstantISO } from '../../../lib/datetime';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { DateRangeBar, useDateRange } from '../../../components/ListFilter';
import { useLang, tr } from '../../../lib/i18n';
import { useIsMobile, CARD_LIST_MAX } from '../../../lib/responsive';
import { MList, MCard, MHead, MRow } from '../../../components/MobileCard';
import { PayrollRun } from './PayrollRun';
import { NavIcon } from '../../../components/NavIcon';
import { uiLocale } from '../../../lib/datetime';

interface Row {
  staffId: string; name: string; commissionPercent: number; serviceCount: number;
  serviceRevenueCents: number; productRevenueCents: number; tipsCents: number; commissionCents: number; baseCents: number; totalPayCents: number;
  directTipsCents?: number;
}
interface Report {
  totals: { revenueCents: number; tipsCents: number; commissionCents: number; baseCents: number; payCents: number; orders: number; directTipsCents?: number };
  byMethod?: { cashCents: number; cardCents: number; otherCents: number; giftCardCents: number };
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
  // The tab is remembered per device: an owner who runs payroll every Monday
  // lands on it, one who checks performance lands there.
  const [tab, setTabState] = useState<'performance' | 'payroll'>('payroll');
  useEffect(() => {
    try { const v = window.localStorage.getItem('lumio_pay_tab'); if (v === 'performance' || v === 'payroll') setTabState(v); } catch { /* ignore */ }
  }, []);
  const setTab = (v: 'performance' | 'payroll') => { setTabState(v); try { window.localStorage.setItem('lumio_pay_tab', v); } catch { /* ignore */ } };
  const tabBtn = (id: 'performance' | 'payroll', label: string, icon: string) => (
    <button role="tab" aria-selected={tab === id} onClick={() => setTab(id)} style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '9px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600,
      background: tab === id ? '#4f46e5' : 'transparent', color: tab === id ? '#fff' : 'var(--ccbd5e1)',
    }}><NavIcon name={icon} size={16} />{label}</button>
  );
  return (
    <section>
      <h1 style={{ fontSize: 24, margin: '0 0 4px' }}>{t('pf.hubTitle')}</h1>
      <p style={{ color: 'var(--c94a3b8)', margin: '0 0 16px', fontSize: 14 }}>{t('pf.hubSub')}</p>
      <div role="tablist" style={{ display: 'inline-flex', gap: 4, padding: 4, marginBottom: 18, borderRadius: 12, background: 'var(--c111827)', border: '1px solid var(--line)' }}>
        {tabBtn('payroll', t('pf.tabPayroll'), 'banknote')}
        {tabBtn('performance', t('pf.tabPerformance'), 'chart')}
      </div>
      {tab === 'performance' ? <Performance /> : <PayrollRun vi={lang === 'vi'} />}
    </section>
  );
}

// The number is drawn in the theme's strongest ink: white was invisible on the
// light-mode card (the owner's screenshot: "0" and "$0.00" you could not read).
function Kpi({ label, value, accent, big }: { label: string; value: string; accent: string; big?: boolean }) {
  return (
    <div style={{ background: 'var(--c111827)', border: '1px solid var(--line)', borderRadius: 14, padding: '14px 16px', boxShadow: `inset 3px 0 0 ${accent}` }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c94a3b8)' }}>{label}</div>
      <div style={{ fontSize: big ? 28 : 22, fontWeight: 800, marginTop: 4, color: big ? 'var(--ink-good)' : 'var(--cf1f5f9)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
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
  // Pay-period edges are the SALON's month edges. Browser edges pushed a US
  // salon's last-evening appointments into next month's payroll when viewed
  // from another timezone — money owed to a named technician, filed wrong.
  const today = dayKeyInTz(new Date());
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const pad = (n: number) => String(n).padStart(2, '0');
  const from = wallToInstantISO(`${y}-${pad(m)}-01T00:00`);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const nextStart = wallToInstantISO(`${nextY}-${pad(nextM)}-01T00:00`);
  return { from, to: new Date(Date.parse(nextStart) - 1).toISOString() };
}

function Performance() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  // Cards up to tablet width — an iPad gets every field, not a squeezed table.
  const cardList = useIsMobile(CARD_LIST_MAX);
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
      padding: '6px 13px', borderRadius: 999, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
      border: `1px solid ${sortKey === k ? '#6366f1' : 'var(--c334155)'}`,
      background: sortKey === k ? 'rgba(99,102,241,0.15)' : 'transparent', color: sortKey === k ? 'var(--cc7d2fe)' : 'var(--c94a3b8)',
    }}>{label}</button>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', alignSelf: 'center' }}>{t('pf.sortBy')}</span>
          {sortChip('revenue', t('pf.sRevenue'))}
          {sortChip('completed', t('pf.sVisits'))}
          {sortChip('tips', t('pf.sTips'))}
          {sortChip('rating', t('pf.sRating'))}
          {sortChip('points', t('pf.sPoints'))}
        </div>
        <DateRangeBar range={range} />
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      {loading || !data ? <p style={{ color: 'var(--c94a3b8)' }}>Loading…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 18 }}>
            <Kpi label={t('pf.kRevenue')} value={formatPrice(data.totals.collectedCents || data.totals.serviceRevenueCents)} accent="#22c55e" big />
            <Kpi label={t('pf.kVisits')} value={String(data.totals.completed)} accent="#3b82f6" />
            <Kpi label={t('pf.kTips')} value={formatPrice(data.totals.tipsCents)} accent="#a855f7" />
            <Kpi label={t('pf.kReviews')} value={String(data.totals.reviewCount)} accent="#f59e0b" />
          </div>

          {rows.length === 0 ? <p style={{ color: 'var(--c64748b)', fontSize: 13 }}>{t('pf.empty')}</p> : cardList ? (
            <MList>
              {rows.map((r, i) => (
                <MCard key={r.staffId}>
                  <MHead right={<span style={{ color: 'var(--ink-good)', fontWeight: 700 }}>{formatPrice(money(r))}</span>}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{medal(i)}<Ava r={r} />{r.name}</span>
                  </MHead>
                  <MRow label={t('pf.cVisits')}>{r.completed}</MRow>
                  <MRow label={t('pf.cTips')}>{formatPrice(r.tipsCents)}</MRow>
                  <MRow label={t('pf.cRating')}>{r.reviewCount ? <>⭐ {r.rating} <span style={{ color: 'var(--c64748b)' }}>({r.reviewCount})</span></> : '—'}</MRow>
                  <MRow label={t('pf.cPoints')}>{r.points ? <span style={{ color: 'var(--ceab308)' }}>{r.points}</span> : '—'}</MRow>
                  <MRow label={t('pf.cTop')}>{r.topService ? `${r.topService.name} ×${r.topService.count}` : '—'}</MRow>
                  {r.recent.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <button onClick={() => setOpen(open === r.staffId ? null : r.staffId)} style={{ background: 'none', border: 'none', color: 'var(--c818cf8)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                        {open === r.staffId ? t('pf.hideCustomers') : `${t('pf.showCustomers')} (${r.recent.length})`}
                      </button>
                      {open === r.staffId && <RecentList recent={r.recent} />}
                    </div>
                  )}
                </MCard>
              ))}
            </MList>
          ) : (
            <div style={{ border: '1px solid var(--c334155)', borderRadius: 12, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead><tr style={{ background: 'var(--c1e293b)' }}>
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
                      <tr key={r.staffId} style={{ borderTop: '1px solid var(--c334155)', opacity: r.isActive ? 1 : 0.55 }}>
                        <td style={{ ...ui.td, color: 'var(--c64748b)' }}>{medal(i) || i + 1}</td>
                        <td style={ui.td}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 9 }}><Ava r={r} /><b>{r.name}</b>{!r.isActive && <span style={{ fontSize: 11, color: 'var(--c64748b)' }}>({t('pf.inactive')})</span>}</span></td>
                        <td style={ui.td}>{r.completed}</td>
                        <td style={{ ...ui.td, fontWeight: 700, color: money(r) === best.revenue && best.revenue > 0 ? 'var(--ink-good)' : 'var(--ce2e8f0)' }}>{formatPrice(money(r))}</td>
                        <td style={{ ...ui.td, color: r.tipsCents === best.tips && best.tips > 0 ? '#a855f7' : 'var(--ccbd5e1)', fontWeight: r.tipsCents === best.tips && best.tips > 0 ? 700 : 400 }}>{formatPrice(r.tipsCents)}</td>
                        <td style={ui.td}>{r.reviewCount ? <span style={{ color: r.reviewCount === best.reviews && best.reviews > 0 ? 'var(--ink-warn)' : 'var(--ce2e8f0)', fontWeight: 600 }}>⭐ {r.rating} <span style={{ color: 'var(--c64748b)', fontSize: 12 }}>({r.reviewCount})</span></span> : <span style={{ color: 'var(--ink-faint)' }}>—</span>}</td>
                        <td style={{ ...ui.td, color: r.points === best.points && best.points > 0 ? '#eab308' : 'var(--ccbd5e1)', fontWeight: r.points === best.points && best.points > 0 ? 700 : 400 }}>{r.points || '—'}</td>
                        <td style={{ ...ui.td, color: 'var(--ccbd5e1)' }}>{r.topService ? <>{r.topService.name} <span style={{ color: 'var(--c64748b)' }}>×{r.topService.count}</span></> : '—'}</td>
                        <td style={ui.td}>
                          {r.recent.length > 0
                            ? <button onClick={() => setOpen(open === r.staffId ? null : r.staffId)} style={{ background: 'none', border: '1px solid var(--c334155)', color: 'var(--c818cf8)', fontSize: 12, fontWeight: 600, cursor: 'pointer', borderRadius: 8, padding: '4px 10px' }}>{open === r.staffId ? t('pf.hide') : `${r.recent.length} ▾`}</button>
                            : <span style={{ color: 'var(--ink-faint)' }}>—</span>}
                        </td>
                      </tr>
                      {open === r.staffId && (
                        <tr key={`${r.staffId}-x`} style={{ background: 'var(--c0f172a)' }}>
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
          <p style={{ color: 'var(--c64748b)', fontSize: 12, marginTop: 12 }}>{t('pf.note')}</p>
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
  return <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--c334155)', color: 'var(--cc7d2fe)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600 }}>{initials || '?'}</span>;
}
function medal(i: number): string { return i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : ''; }

function RecentList({ recent }: { recent: { name: string; date: string; service: string }[] }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  return (
    <div>
      <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)', marginBottom: 6, fontWeight: 600 }}>{t('pf.recentTitle')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {recent.map((x, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, borderBottom: '1px solid var(--line)', paddingBottom: 5 }}>
            <span style={{ color: 'var(--ce2e8f0)', fontWeight: 600 }}>{x.name}</span>
            <span style={{ color: 'var(--c94a3b8)' }}>{x.service}</span>
            <span style={{ color: 'var(--c64748b)', whiteSpace: 'nowrap' }}>{fmtInTz(x.date, { month: 'short', day: 'numeric' })}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
