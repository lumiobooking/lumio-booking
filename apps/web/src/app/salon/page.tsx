'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dayKeyInTz, fmtInTz, presetRangeInTz, salonTz } from '../../lib/datetime';
import { SalonShell, useNavAccess } from '../../components/SalonShell';
import { NavIcon } from '../../components/NavIcon';
import { useAuth } from '../../lib/auth';
import { apiFetch } from '../../lib/api';
import { sourceCounts } from '../../lib/booking-sources';
import { SourceChip } from '../../components/SourceChip';
import { ui, formatPrice } from '../../lib/ui';
import { useLang, tr } from '../../lib/i18n';
import { useLiveRefresh } from '../../lib/useLiveRefresh';
import { useIsMobile } from '../../lib/responsive';
import { uiCurrency } from '../../lib/ui-currency';

/* =============================================================================
 * THE OWNER'S HOME SCREEN — as drawn in the approved mockup ("Lumio Dashboard
 * Redesign"), three layouts, one look:
 *
 *   wide  (≥1024px): greeting + period picker; ONE hero number and three
 *         supporting ones; "Happening now" beside "Needs attention"; the
 *         30-day revenue chart beside who and what is selling.
 *   iPad  (700–1023px): the same, slightly tighter.
 *   phone (<700px): the hero, three small numbers, needs-attention, now.
 *
 * Every number says what it is compared to (the previous period of the same
 * length). Strong colour is kept for meaning: green = better, amber = needs a
 * look, red = a count of things waiting on the owner. Everything else is one
 * accent.
 * ========================================================================== */

interface SeriesPoint { date: string; bookings: number; revenueCents: number }
interface Ranked { name: string; bookings: number; revenueCents: number }
interface Slot { kind: 'walkin' | 'appointment'; id: string; customer: string; service: string; startTime: string; endTime: string | null; awaitingPayment: boolean; status: string }
interface NowRow { staffId: string; name: string; current: Slot | null; next: { id: string; customer: string; service: string; startTime: string } | null }
interface Kpis { totalBookings: number; revenueCents: number; newCustomers: number; completed: number; noShow: number; cancelled: number; avgBookingValueCents: number; noShowRate: number; completionRate: number }
interface Home {
  range: { from: string; to: string };
  sourceRows?: { source: string | null; utmSource: string | null; attrReferrer?: string | null; attrLandingUrl?: string | null }[];
  kpis: Kpis;
  statusBreakdown: Record<string, number>;
  paymentMethods: { cash: number; card: number; transfer: number; online: number; onsite: number };
  series: SeriesPoint[];
  topStaff: Ranked[];
  topServices: Ranked[];
  tipsCents: number;
  previous: { range: { from: string; to: string }; kpis: { totalBookings: number; revenueCents: number; newCustomers: number; completed: number; paidCount: number; avgBookingValueCents: number }; tipsCents: number };
  now: NowRow[];
  today: { bookings: number; completed: number; inProgress: number; upcoming: number; noShow: number };
  chairs: { total: number; busy: number; staff: number };
  attention: { awaitingPayment: number; pendingBookings: number; waitlist: number; reviews: number; lowStock: { name: string; qty: number }[] };
  /** The strip across the top. Optional: an API one deploy behind leaves it out. */
  floor?: { inService: number; waiting: number; nextHour: number; freeTechs: number; longestWait: { id: string; name: string; minutes: number } | null };
}
interface Trend { series: SeriesPoint[]; topStaff: Ranked[]; topServices: Ranked[]; kpis: Kpis; previous?: { kpis: { revenueCents: number } } }

type Period = 'today' | 'week' | 'month' | 'custom';

const STAFF_COLORS = ['#be185d', '#0e7490', '#7c3aed', '#c2410c', '#15803d', '#1d4ed8', '#a16207', '#0f766e'];
/** An initial on its technician's colour: every hue above is dark enough for white ink in both themes. */
const onHue = (bg: string): React.CSSProperties => ({ background: bg, color: '#fff' });

export default function DashboardPage() {
  return (
    <SalonShell>
      <Inner />
    </SalonShell>
  );
}

function Inner() {
  const { token, user } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const L = (v: string, e: string) => (vi ? v : e);
  const t = (k: string) => tr(k, lang);
  const canOpen = useNavAccess();
  // The layout follows the room the page actually has, not the window: the
  // classic sidebar, the new rail + area menu and the iPad flyout all leave
  // different widths at the same screen size. Until the first measurement the
  // window decides, as before.
  const vPhone = useIsMobile(767);
  const vNarrow = useIsMobile(1023);
  const vTablet = useIsMobile(1279);
  const [cw, setCw] = useState<number | null>(null);
  const ro = useRef<ResizeObserver | null>(null);
  const measure = useCallback((el: HTMLElement | null) => {
    ro.current?.disconnect(); ro.current = null;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver((es) => { const w = Math.round(es[0]?.contentRect.width ?? 0); if (w > 0) setCw((p) => (p === w ? p : w)); });
    obs.observe(el); ro.current = obs;
  }, []);
  useEffect(() => () => ro.current?.disconnect(), []);
  const phone = cw !== null ? cw < 600 : vPhone;      // one column, small numbers
  const narrow = cw !== null ? cw < 760 : vNarrow;    // iPad upright: one column of cards
  const tablet = cw !== null ? cw < 1040 : vTablet;   // tighter rows, no progress bars

  const todayKey = dayKeyInTz(new Date());
  const [period, setPeriod] = useState<Period>('today');
  const [from, setFrom] = useState(todayKey);
  const [to, setTo] = useState(todayKey);
  const [home, setHome] = useState<Home | null>(null);
  const [trend, setTrend] = useState<Trend | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The clock in "Happening now" and the greeting follow the salon's timezone,
  // which the shell stores a moment after first paint; one re-render picks it up.
  const [, setTick] = useState(0);
  useEffect(() => { const id = window.setTimeout(() => setTick(1), 4000); return () => window.clearTimeout(id); }, []);

  const pick = (p: Period) => {
    setPeriod(p);
    const now = new Date();
    if (p === 'today') { setFrom(todayKey); setTo(todayKey); }
    else if (p === 'week') {
      // Monday to today, in the salon's calendar.
      const wd = new Date(`${todayKey}T12:00:00Z`).getUTCDay(); // 0 = Sunday
      const back = (wd + 6) % 7;
      setFrom(dayKeyInTz(new Date(now.getTime() - back * 86400000))); setTo(todayKey);
    } else if (p === 'month') { const r = presetRangeInTz('thisMonth'); setFrom(r.from); setTo(r.to); }
  };

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [h, tr30] = await Promise.all([
        apiFetch<Home>(`/overview/home?from=${from}&to=${to}`, { token }),
        apiFetch<Trend>(`/overview/home?from=${dayKeyInTz(new Date(Date.now() - 29 * 86400000))}&to=${dayKeyInTz(new Date())}`, { token }),
      ]);
      setHome(h); setTrend(tr30); setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    }
  }, [token, from, to]);

  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, 30000);

  /* ------------------------------------------------------------ helpers */
  const money = (c: number) => formatPrice(c);
  const moneyShort = (c: number) => money(c).replace(/[.,]00(?=\D*$)/, '');
  const hour = Number(fmtInTz(new Date(), { hour: 'numeric', hour12: false }).replace(/\D/g, '')) || 12;
  const greeting = hour < 12 ? L('Chào buổi sáng', 'Good morning') : hour < 18 ? L('Chào buổi chiều', 'Good afternoon') : L('Chào buổi tối', 'Good evening');
  const who = user?.firstName ? `, ${user.firstName}` : '';
  const dateLine = fmtInTz(new Date(), { weekday: 'long', day: 'numeric', month: 'long' });
  const periodLabel = period === 'today' ? L('hôm nay', 'today') : period === 'week' ? L('tuần này', 'this week') : period === 'month' ? L('tháng này', 'this month') : L('kỳ này', 'this period');
  const prevLabel = period === 'today' ? L('Hôm qua', 'Yesterday') : period === 'week' ? L('Tuần trước', 'Last week') : period === 'month' ? L('Tháng trước', 'Last month') : L('Kỳ trước', 'Previous period');
  const hue = (i: number) => STAFF_COLORS[i % STAFF_COLORS.length];
  const initial = (n: string) => (n.trim()[0] || '?').toUpperCase();
  const minsLeft = (end: string | null) => (end ? Math.round((new Date(end).getTime() - Date.now()) / 60000) : null);
  const clock = (iso: string) => fmtInTz(iso, { hour: 'numeric', minute: '2-digit' });

  /** "+12%" against the previous period; null when there is nothing to compare with. */
  const delta = (cur: number, prev: number): number | null => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
  const deltaPill = (d: number | null, goodWhenUp = true) => {
    if (d === null || Number.isNaN(d)) return null;
    const good = d === 0 ? true : goodWhenUp ? d > 0 : d < 0;
    return (
      <span style={{ marginLeft: 'auto', height: 22, padding: '0 8px', borderRadius: 999, background: good ? 'var(--c052e16)' : 'rgba(245,158,11,.14)', color: good ? 'var(--ink-good)' : 'var(--ink-warn)', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">{d >= 0 ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M5 12l7 7 7-7" />}</svg>{Math.abs(d)}%
      </span>
    );
  };

  const card: React.CSSProperties = { boxSizing: 'border-box', padding: phone ? '14px 16px' : tablet ? '14px 16px' : '18px 20px', borderRadius: 16, background: 'var(--c0f172a)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', minWidth: 0 };
  const label: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--c94a3b8)' };
  const h2: React.CSSProperties = { fontSize: 15.5, fontWeight: 700, color: 'var(--cf1f5f9)', margin: 0 };
  const sub: React.CSSProperties = { fontSize: 12.5, color: 'var(--c94a3b8)' };
  const link: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--ink-link)', textDecoration: 'none', whiteSpace: 'nowrap' };

  if (error && !home) return <section><div style={ui.banner}>{error}</div></section>;
  if (!home) return <section><p style={{ color: 'var(--c94a3b8)', marginTop: 24 }}>{t('db.loading')}</p></section>;

  const k = home.kpis; const pk = home.previous.kpis;
  const last7 = (trend?.series ?? home.series).slice(-7);
  const maxRev7 = Math.max(1, ...last7.map((s) => s.revenueCents));
  const paidCount = k.avgBookingValueCents > 0 ? Math.round(k.revenueCents / k.avgBookingValueCents) : 0;
  const occupancy = home.chairs.total > 0 ? Math.round((home.chairs.busy / home.chairs.total) * 100) : null;
  const attentionRows = [
    { key: 'pay', n: home.attention.awaitingPayment, title: L(`${home.attention.awaitingPayment} khách xong, chưa thu tiền`, `${home.attention.awaitingPayment} finished, not yet paid`), detail: home.now.filter((r) => r.current?.awaitingPayment).map((r) => `${r.name} · ${r.current?.customer}`).join(' · '), href: '/salon/walkins', tone: 'warn' },
    { key: 'pending', n: home.attention.pendingBookings, title: L(`${home.attention.pendingBookings} lịch đặt online chờ xác nhận`, `${home.attention.pendingBookings} online bookings to confirm`), detail: L('Xác nhận và chọn thợ', 'Confirm and assign a technician'), href: '/salon/bookings?status=PENDING', tone: 'accent' },
    { key: 'wait', n: home.attention.waitlist, title: L(`${home.attention.waitlist} khách trong danh sách chờ`, `${home.attention.waitlist} on the waitlist`), detail: home.now.find((r) => !r.current) ? L(`${home.now.find((r) => !r.current)?.name} đang trống — gán ngay`, `${home.now.find((r) => !r.current)?.name} is free — assign now`) : L('Chưa có ghế trống', 'No chair free yet'), href: '/salon/waitlist', tone: 'accent' },
    { key: 'reviews', n: home.attention.reviews, title: L(`${home.attention.reviews} đánh giá Google chưa trả lời`, `${home.attention.reviews} Google reviews to answer`), detail: L('Trả lời trong ngày giữ điểm tốt trên Google', 'Answer today to keep your Google rating'), href: '/salon/reviews-replies', tone: 'star' },
    { key: 'stock', n: home.attention.lowStock.length, title: L(`${home.attention.lowStock.length} sản phẩm sắp hết hàng`, `${home.attention.lowStock.length} products running low`), detail: home.attention.lowStock.slice(0, 3).map((p) => `${p.name} ${L('còn', 'left')} ${p.qty}`).join(' · '), href: '/salon/products', tone: 'muted' },
  ].filter((r) => r.n > 0) as { key: string; n: number; title: string; detail: string; href: string; tone: 'warn' | 'accent' | 'star' | 'muted' }[];

  /* ------------------------------------------------------------- pieces */
  const periodPicker = (
    <div style={{ height: phone ? 38 : 40, boxSizing: 'border-box', padding: 4, borderRadius: 10, background: 'var(--c0f172a)', border: '1px solid var(--line)', display: 'flex', gap: 2, flexShrink: 0 }}>
      {([['today', L('Hôm nay', 'Today')], ['week', L('Tuần này', 'This week')], ['month', L('Tháng này', 'This month')], ['custom', L('Chọn ngày', 'Pick dates')]] as [Period, string][]).map(([p, lbl]) => (
        <button key={p} type="button" onClick={() => pick(p)} style={p === period
          ? { height: '100%', flex: phone ? 1 : undefined, padding: phone ? 0 : '0 14px', borderRadius: 7, border: 'none', background: '#4f46e5', color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }
          : { height: '100%', flex: phone ? 1 : undefined, padding: phone ? 0 : '0 14px', borderRadius: 7, border: 'none', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>{lbl}</button>
      ))}
    </div>
  );
  const customDates = period === 'custom' && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input lang="en-US" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} style={dateInput} />
      <span style={{ color: 'var(--c64748b)' }}>→</span>
      <input lang="en-US" type="date" value={to} min={from} max={todayKey} onChange={(e) => setTo(e.target.value)} style={dateInput} />
    </div>
  );

  const hero = (
    <div style={{ ...card, gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={label}>{L('Doanh thu', 'Revenue')} {periodLabel}</span>
        {deltaPill(delta(k.revenueCents, pk.revenueCents))}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
        <span style={{ fontSize: phone ? 36 : tablet ? 32 : 40, fontWeight: 700, letterSpacing: -1, lineHeight: 1.05, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap' }}>{moneyShort(k.revenueCents)}</span>
        <div aria-hidden="true" style={{ flex: 1, minWidth: 60, maxWidth: 150, marginLeft: 'auto', height: phone ? 38 : 44, display: 'flex', alignItems: 'flex-end', gap: 4, paddingBottom: 4 }}>
          {last7.map((s, i) => <span key={s.date} title={`${s.date}: ${money(s.revenueCents)}`} style={{ flex: 1, height: `${Math.max(6, (s.revenueCents / maxRev7) * 100)}%`, borderRadius: 3, background: '#4f46e5', opacity: i === last7.length - 1 ? 1 : 0.35 }} />)}
        </div>
      </div>
      <span style={sub}>
        {prevLabel} {money(pk.revenueCents)}
        {home.paymentMethods.cash > 0 && <> · {L('Tiền mặt', 'Cash')} {money(home.paymentMethods.cash)}</>}
        {home.paymentMethods.card > 0 && <> · {L('Thẻ', 'Card')} {money(home.paymentMethods.card)}</>}
        {home.tipsCents > 0 && <> · {L('trong đó tip của thợ', 'incl. tips')} {money(home.tipsCents)}</>}
      </span>
    </div>
  );

  const bookingsCard = (
    <div style={{ ...card, gap: 6 }}>
      <span style={label}>{L('Lịch hẹn', 'Bookings')} {periodLabel}</span>
      <span style={{ fontSize: phone ? 22 : 32, fontWeight: 700, letterSpacing: -0.5, lineHeight: 1.1, color: 'var(--cf1f5f9)' }}>{period === 'today' ? home.today.bookings : k.totalBookings}</span>
      {period === 'today' ? (
        <>
          <div style={{ display: 'flex', gap: 3, height: 6, borderRadius: 999, overflow: 'hidden' }}>
            <span style={{ flex: Math.max(home.today.completed, 0.0001), background: '#4f46e5' }} /><span style={{ flex: Math.max(home.today.inProgress, 0.0001), background: '#4f46e5', opacity: 0.45 }} /><span style={{ flex: Math.max(home.today.upcoming, 0.0001), background: 'var(--line)' }} />
          </div>
          <span style={sub}>{home.today.completed} {L('xong', 'done')} · {home.today.inProgress} {L('đang làm', 'in progress')} · {home.today.upcoming} {L('sắp tới', 'to come')}</span>
        </>
      ) : (
        <span style={sub}>{k.completed} {L('xong', 'done')} · {k.noShow} {L('không đến', 'no-show')} · {k.cancelled} {L('huỷ', 'cancelled')}</span>
      )}
    </div>
  );

  const avgCard = (
    <div style={{ ...card, gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}><span style={label}>{L('Giá trị trung bình / bill', 'Average per ticket')}</span>{!phone && deltaPill(delta(k.avgBookingValueCents, pk.avgBookingValueCents))}</div>
      <span style={{ fontSize: phone ? 22 : 32, fontWeight: 700, letterSpacing: -0.5, lineHeight: 1.1, color: 'var(--cf1f5f9)' }}>{moneyShort(k.avgBookingValueCents)}</span>
      <span style={sub}>{prevLabel} {moneyShort(pk.avgBookingValueCents)} · {paidCount} {L('bill đã thu', 'tickets paid')}</span>
    </div>
  );

  const chairsCard = (
    <div style={{ ...card, gap: 6 }}>
      <span style={label}>{L('Ghế đang bận', 'Chairs in use')}</span>
      <span style={{ fontSize: phone ? 22 : 32, fontWeight: 700, letterSpacing: -0.5, lineHeight: 1.1, color: 'var(--cf1f5f9)' }}>{home.chairs.busy}<span style={{ fontSize: phone ? 13 : 18, color: 'var(--c94a3b8)', fontWeight: 600 }}> / {home.chairs.total || home.chairs.staff}</span></span>
      <span style={sub}>{occupancy !== null ? L(`Lấp đầy ${occupancy}% lúc này`, `${occupancy}% occupied right now`) : L(`${home.chairs.staff} thợ đang làm`, `${home.chairs.staff} technicians on`)} · {k.newCustomers} {L('khách mới', 'new clients')}</span>
    </div>
  );

  /* The floor in four numbers, and the one client who has waited too long. */
  const fl = home.floor;
  const liveStat = (n: number, text: string, href: string, tone?: 'warn' | 'good') => (
    <a href={href} style={{ display: 'flex', flexDirection: phone ? 'column' : 'row', alignItems: phone ? 'flex-start' : 'baseline', gap: phone ? 0 : 6, textDecoration: 'none', minWidth: 0 }}>
      <span style={{ fontSize: phone ? 20 : 20, fontWeight: 700, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums', color: tone === 'warn' && n > 0 ? 'var(--ink-warn)' : tone === 'good' && n > 0 ? 'var(--ink-good)' : 'var(--cf1f5f9)' }}>{n}</span>
      <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', whiteSpace: phone ? 'normal' : 'nowrap', lineHeight: 1.25 }}>{text}</span>
    </a>
  );
  const liveStrip = fl ? (
    <div style={{ ...card, flexDirection: narrow ? 'column' : 'row', alignItems: narrow ? 'stretch' : 'center', gap: narrow ? 10 : tablet ? 18 : 26, padding: phone ? '12px 14px' : '12px 18px' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap', flexShrink: 0 }}>
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 0 4px rgba(34,197,94,.18)' }} />
        {L('Lúc này', 'Right now')}
        {narrow && <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 500, color: 'var(--c94a3b8)' }}>{fmtInTz(new Date(), { hour: 'numeric', minute: '2-digit' })}</span>}
      </span>
      <div style={narrow ? { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 } : { display: 'flex', alignItems: 'baseline', gap: tablet ? 18 : 26, minWidth: 0, flexWrap: 'wrap' }}>
        {liveStat(fl.inService, L('đang làm', 'in service'), '/salon/walkins')}
        {liveStat(fl.waiting, L('đang chờ', 'waiting'), '/salon/walkins', 'warn')}
        {liveStat(fl.nextHour, phone ? L('hẹn trong 1 giờ', 'next hour') : L('hẹn trong 1 giờ tới', 'booked next hour'), '/salon/calendar')}
        {liveStat(fl.freeTechs, L('thợ rảnh', 'techs free'), '/salon/walkins', 'good')}
      </div>
      {fl.longestWait && (
        <a href={`/salon/walkins?focus=${encodeURIComponent(fl.longestWait.id)}`}
          style={{ marginLeft: narrow ? 0 : 'auto', display: 'flex', alignItems: 'center', justifyContent: narrow ? 'center' : undefined, gap: 6, minHeight: 32, padding: '4px 12px', borderRadius: 999, background: 'rgba(245,158,11,.14)', border: '1px solid rgba(245,158,11,.4)', color: 'var(--ink-warn)', fontSize: 13, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
          ⚠ {L(`${fl.longestWait.name} chờ ${fl.longestWait.minutes}′ · giao thợ`, `${fl.longestWait.name} waiting ${fl.longestWait.minutes}′ · assign`)}
        </a>
      )}
    </div>
  ) : null;

  /* The four things the front desk starts from here; only the ones this person may open. */
  const quick = [
    { key: 'walkin', href: '/salon/walkins?new=1', page: '/salon/walkins', icon: 'walk', title: L('Khách vãng lai', 'Walk-in'), sub: L('Thêm vào hàng chờ', 'Add to the queue') },
    { key: 'book', href: '/salon/bookings?new=1', page: '/salon/bookings', icon: 'calendarCheck', title: L('Lịch hẹn mới', 'New booking'), sub: L('Chọn thợ và giờ', 'Pick a tech and a time') },
    { key: 'pos', href: '/salon/pos', page: '/salon/pos', icon: 'receipt', title: L('Thu tiền', 'Check out'), sub: L('Mở quầy thu ngân', 'Open the till') },
    { key: 'cal', href: '/salon/calendar', page: '/salon/calendar', icon: 'calendar', title: L('Lịch hôm nay', "Today's calendar"), sub: L(`${home.today.upcoming} lịch sắp tới`, `${home.today.upcoming} still to come`) },
  ].filter((q) => canOpen(q.page));
  const quickActions = quick.length > 0 ? (
    <nav aria-label={L('Thao tác nhanh', 'Quick actions')} style={{ display: 'grid', gridTemplateColumns: narrow && !phone ? 'repeat(2, minmax(0, 1fr))' : `repeat(${quick.length}, minmax(0, 1fr))`, gap: phone ? 8 : 12 }}>
      {quick.map((q) => (
        <a key={q.key} href={q.href} style={{ boxSizing: 'border-box', display: 'flex', flexDirection: phone ? 'column' : 'row', alignItems: 'center', gap: phone ? 6 : 10, minWidth: 0, minHeight: phone ? 76 : 58, padding: phone ? '10px 4px' : '10px 14px', borderRadius: 14, background: 'var(--c0f172a)', border: '1px solid var(--line)', textDecoration: 'none', textAlign: phone ? 'center' : 'left' }}>
          <span aria-hidden="true" style={{ width: phone ? 32 : 36, height: phone ? 32 : 36, flexShrink: 0, borderRadius: 10, display: 'grid', placeItems: 'center', background: '#4f46e5', color: '#fff' }}><NavIcon name={q.icon} size={phone ? 16 : 18} /></span>
          <span style={{ minWidth: 0, flex: phone ? undefined : 1, display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
            <span style={phone ? { fontSize: 12.5, fontWeight: 700, color: 'var(--cf1f5f9)' } : { fontSize: 14, fontWeight: 700, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.title}</span>
            {!phone && <span style={{ fontSize: 12, color: 'var(--c94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.sub}</span>}
          </span>
          {!phone && !tablet && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--c94a3b8)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>}
        </a>
      ))}
    </nav>
  ) : null;

  const nowRow = (r: NowRow, i: number) => {
    const c = r.current;
    const left = c ? minsLeft(c.endTime) : null;
    const status = c
      ? c.awaitingPayment
        ? { text: L('Đã xong · chờ thanh toán', 'Done · waiting to pay'), color: 'var(--ink-warn)', bar: 100, barColor: '#f59e0b' }
        : { text: `${clock(c.startTime)}${c.endTime ? ` – ${clock(c.endTime)}` : ''}${left !== null ? ` · ${left > 0 ? L(`còn ${left} phút`, `${left} min left`) : L('sắp xong', 'finishing')}` : ''}`, color: 'var(--c94a3b8)', bar: c.endTime ? Math.min(100, Math.max(4, 100 - ((new Date(c.endTime).getTime() - Date.now()) / (new Date(c.endTime).getTime() - new Date(c.startTime).getTime())) * 100)) : 30, barColor: '#4f46e5' }
      : { text: r.next ? L(`Có thể nhận khách vãng lai đến ${clock(r.next.startTime)}`, `Free for walk-ins until ${clock(r.next.startTime)}`) : L('Trống cả ngày', 'Free all day'), color: 'var(--c94a3b8)', bar: 0, barColor: 'transparent' };
    const main = c ? `${c.customer} · ${c.service}` : r.next ? L(`Trống · lịch tiếp ${clock(r.next.startTime)} ${r.next.customer} (${r.next.service})`, `Free · next ${clock(r.next.startTime)} ${r.next.customer} (${r.next.service})`) : L('Trống', 'Free');
    const action = c?.awaitingPayment
      ? <a href={c.kind === 'walkin' ? `/salon/pos?walkInId=${c.id}` : `/salon/pos?appointmentId=${c.id}`} style={{ height: 32, padding: '0 12px', borderRadius: 8, background: '#4f46e5', color: '#fff', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none', whiteSpace: 'nowrap' }}>{L('Thu tiền', 'Charge')}</a>
      : c
        ? <a href={c.kind === 'walkin' ? '/salon/walkins' : '/salon/calendar'} style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--c0f172a)', color: 'var(--ccbd5e1)', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none', whiteSpace: 'nowrap' }}>{L('Chi tiết', 'Details')}</a>
        : home.attention.waitlist > 0
          ? <a href="/salon/waitlist" style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--c0f172a)', color: 'var(--ccbd5e1)', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none', whiteSpace: 'nowrap' }}>{L('Gán khách chờ', 'Assign waitlist')}</a>
          : null;
    return (
      <div key={r.staffId} style={{ display: 'flex', alignItems: 'center', gap: phone ? 10 : 12, padding: '9px 0', borderTop: '1px solid var(--line)' }}>
        <span style={{ ...(c ? onHue(hue(i)) : { background: 'var(--c1e293b)', color: 'var(--ccbd5e1)' }), width: phone ? 32 : 34, height: phone ? 32 : 34, flexShrink: 0, borderRadius: '50%', fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initial(r.name)}</span>
        {!phone && <span style={{ width: tablet ? 72 : 96, flexShrink: 0, fontSize: 14, fontWeight: 600, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name.split(' ')[0]}</span>}
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
          <span style={{ fontSize: phone ? 13.5 : 14, fontWeight: 600, color: c ? 'var(--cf1f5f9)' : 'var(--c94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{phone ? `${r.name.split(' ')[0]} · ${main}` : main}</span>
          <span style={{ fontSize: 12.5, color: status.color, fontWeight: c?.awaitingPayment ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{status.text}</span>
        </span>
        {!tablet && <span style={{ width: 120, flexShrink: 0, height: 6, borderRadius: 999, background: 'var(--c1e293b)', overflow: 'hidden', display: 'flex' }}><span style={{ width: `${status.bar}%`, background: status.barColor }} /></span>}
        {(!phone || c?.awaitingPayment) && action}
      </div>
    );
  };

  const nowCard = (
    <div style={{ ...card, gap: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, paddingBottom: 8 }}>
        <h2 style={h2}>{L('Đang diễn ra', 'Happening now')} · {fmtInTz(new Date(), { hour: 'numeric', minute: '2-digit' })}</h2>
        {!phone && <span style={sub}>{L('Cập nhật mỗi 30 giây', 'Refreshes every 30 s')}</span>}
        <a href="/salon/calendar" style={{ ...link, marginLeft: 'auto' }}>{L('Mở lịch →', 'Open calendar →')}</a>
      </div>
      {home.now.length === 0
        ? <p style={{ ...sub, margin: '8px 0 0' }}>{L('Chưa có thợ nào đang làm. Thêm nhân viên ở mục Nhân viên.', 'No technicians yet. Add them under Staff.')}</p>
        : (phone ? home.now.slice(0, 5) : home.now).map(nowRow)}
    </div>
  );

  const attentionCard = (
    <div style={{ ...card, gap: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 6 }}>
        <h2 style={h2}>{L('Cần xử lý', 'Needs attention')}</h2>
        {attentionRows.length > 0 && <span style={{ height: 22, padding: '0 8px', borderRadius: 999, background: 'rgba(239,68,68,.12)', color: 'var(--ink-bad)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center' }}>{attentionRows.length}</span>}
      </div>
      {attentionRows.length === 0
        ? <div style={{ padding: '10px 0', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--c052e16)', color: 'var(--ink-good)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></span><span style={{ fontSize: 14, color: 'var(--ccbd5e1)' }}>{L('Không có gì đang chờ. Tiệm đang chạy trơn tru.', 'Nothing waiting on you. The salon is running smoothly.')}</span></div>
        : attentionRows.map((r) => (
          <a key={r.key} href={r.href} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--line)', textDecoration: 'none', color: 'var(--cf1f5f9)' }}>
            <span style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: r.tone === 'warn' ? 'rgba(245,158,11,.14)' : r.tone === 'accent' ? 'var(--c1e1b4b)' : r.tone === 'star' ? 'rgba(234,179,8,.16)' : 'var(--c1e293b)',
              color: r.tone === 'warn' ? 'var(--ink-warn)' : r.tone === 'accent' ? 'var(--ink-link)' : r.tone === 'star' ? 'var(--ink-warn)' : 'var(--ccbd5e1)' }}>
              {r.key === 'pay' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></svg>}
              {r.key === 'pending' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>}
              {r.key === 'wait' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>}
              {r.key === 'reviews' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></svg>}
              {r.key === 'stock' && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 7h12l1 14H5zM9 7V5a3 3 0 0 1 6 0v2" /></svg>}
            </span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{r.title}</span>
              {r.detail && <span style={{ ...sub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.detail}</span>}
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--c94a3b8)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
          </a>
        ))}
    </div>
  );

  const series30 = trend?.series ?? [];
  const total30 = series30.reduce((a, s) => a + s.revenueCents, 0);
  const prev30 = trend?.previous?.kpis.revenueCents ?? 0;
  const prevAvgDay = prev30 / Math.max(1, series30.length);
  const maxBar = Math.max(1, ...series30.map((s) => s.revenueCents), prevAvgDay);
  const niceMax = niceCeil(maxBar);
  const ticks = [1, 2 / 3, 1 / 3, 0].map((f) => Math.round(niceMax * f));
  const chartCard = (
    <div style={{ ...card, gap: 10, minHeight: phone ? 260 : 300 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={h2}>{L('Doanh thu 30 ngày', 'Revenue, 30 days')}</h2>
        <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{moneyShort(total30)}</span>
        {(() => { const d = delta(total30, prev30); return d === null ? null : <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--c94a3b8)' }}>{deltaPill(d)}{!phone && L('so với 30 ngày trước', 'vs the 30 days before')}</span>; })()}
        {!phone && <span style={{ marginLeft: 'auto', ...sub, display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: '#4f46e5' }} />{L('Ngày này', 'This day')}{prevAvgDay > 0 && <><span style={{ width: 18, borderTop: '2px dashed var(--c94a3b8)', marginLeft: 8 }} />{L('TB 30 ngày trước', 'Avg, 30 days before')} {moneyShort(Math.round(prevAvgDay))}/{L('ngày', 'day')}</>}</span>}
      </div>
      {series30.length === 0 ? <p style={{ ...sub, margin: 0 }}>{t('db.noData')}</p> : (
        <div style={{ flex: 1, minHeight: phone ? 180 : 220, position: 'relative' }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 22, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            {ticks.map((v, i) => <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--c64748b)' }}><span style={{ width: 44, whiteSpace: 'nowrap', overflow: 'hidden' }}>{compactMoney(v, money)}</span><span style={{ flex: 1, borderTop: `1px solid ${i === ticks.length - 1 ? 'var(--c334155)' : 'var(--line)'}` }} /></span>)}
          </div>
          {prevAvgDay > 0 && <div style={{ position: 'absolute', left: 52, right: 0, bottom: `calc(22px + ${(prevAvgDay / niceMax) * 100}%)`, borderTop: '2px dashed var(--c94a3b8)', opacity: 0.8 }} />}
          <div style={{ position: 'absolute', left: 52, right: 0, top: 0, bottom: 22, display: 'flex', alignItems: 'flex-end', gap: phone ? 2 : 5 }}>
            {series30.map((s, i) => <span key={s.date} title={`${s.date}: ${money(s.revenueCents)} · ${s.bookings} ${L('lịch', 'bookings')}`} style={{ flex: 1, height: `${(s.revenueCents / niceMax) * 100}%`, minHeight: s.revenueCents > 0 ? 2 : 0, borderRadius: '3px 3px 0 0', background: '#4f46e5', opacity: i === series30.length - 1 ? 1 : 0.55 }} />)}
          </div>
          <div style={{ position: 'absolute', left: 52, right: 0, bottom: 0, display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--c94a3b8)' }}>
            {[0, 7, 14, 21].map((i) => series30[i] ? <span key={i}>{shortDate(series30[i].date)}</span> : null)}
            <span>{L('Hôm nay', 'Today')}</span>
          </div>
        </div>
      )}
    </div>
  );

  const rank = (rows: Ranked[], by: 'revenue' | 'bookings', withAvatar: boolean) => {
    const top = rows.filter((r) => (by === 'revenue' ? r.revenueCents : r.bookings) > 0).slice(0, 3);
    if (!top.length) return <p style={{ ...sub, margin: 0 }}>{t('db.noBookingsRange')}</p>;
    const max = Math.max(1, ...top.map((r) => (by === 'revenue' ? r.revenueCents : r.bookings)));
    return top.map((r, i) => (
      <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {withAvatar && <span style={{ ...onHue(hue(i)), width: 26, height: 26, flexShrink: 0, borderRadius: '50%', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initial(r.name)}</span>}
        <span style={{ flexBasis: withAvatar ? 70 : 150, flexShrink: 0, fontSize: 13.5, fontWeight: 600, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{withAvatar ? r.name.split(' ')[0] : r.name}</span>
        <span style={{ flex: 1, height: 8, borderRadius: 999, background: 'var(--c1e293b)', overflow: 'hidden', display: 'flex' }}><span style={{ width: `${((by === 'revenue' ? r.revenueCents : r.bookings) / max) * 100}%`, background: '#4f46e5', opacity: withAvatar ? 1 : 0.55 }} /></span>
        <span style={{ width: 64, flexShrink: 0, textAlign: 'right', fontSize: 13.5, fontWeight: 600, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap' }}>{by === 'revenue' ? moneyShort(r.revenueCents) : `${r.bookings} ${L('lần', 'x')}`}</span>
      </div>
    ));
  };
  const topCard = (
    <div style={{ ...card, gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><h2 style={h2}>{L('Ai và dịch vụ nào đang bán chạy', 'Who and what is selling')}</h2><span style={{ marginLeft: 'auto', ...sub, whiteSpace: 'nowrap' }}>{L('30 ngày', '30 days')}</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>{rank(trend?.topStaff ?? [], 'revenue', true)}</div>
      <span style={{ borderTop: '1px solid var(--line)' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>{rank(trend?.topServices ?? [], 'bookings', false)}</div>
      <a href="/salon/reports" style={{ ...link, marginTop: 'auto', paddingTop: 6 }}>{L('Xem báo cáo đầy đủ →', 'Full report →')}</a>
    </div>
  );

  const morePanels = (
    <details style={{ marginTop: 4 }}>
      <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600, color: 'var(--ccbd5e1)', padding: '6px 0' }}>{L('Phân tích thêm cho kỳ này', 'More on this period')} — {t('db.sources')} · {t('db.revByMethod')} · {t('db.bookingStatus')}</summary>
      <div style={{ display: 'grid', gridTemplateColumns: phone || narrow ? '1fr' : tablet ? '1fr 1fr' : '1.2fr 1fr 1fr', gap: 14, marginTop: 12 }}>
        <div style={{ ...card, gap: 8 }}><h2 style={h2}>{t('db.sources')}</h2><SourcesPanel rows={home.sourceRows ?? []} vi={vi} hint={t('db.sourcesHint')} /></div>
        <div style={{ ...card, gap: 8 }}><h2 style={h2}>{t('db.revByMethod')}</h2><PaymentMethods pm={home.paymentMethods} /></div>
        <div style={{ ...card, gap: 8 }}><h2 style={h2}>{t('db.bookingStatus')}</h2><StatusBreakdown breakdown={home.statusBreakdown} total={k.totalBookings} /></div>
      </div>
    </details>
  );

  /* -------------------------------------------------------------- layout */
  const gap = phone ? 12 : 14;
  return (
    <section ref={measure} style={{ display: 'flex', flexDirection: 'column', gap: phone ? 12 : 18, maxWidth: 1400 }}>
      {error && <div style={ui.banner}>{error}</div>}

      <div style={{ display: 'flex', alignItems: phone || narrow ? 'stretch' : 'flex-end', flexDirection: phone || narrow ? 'column' : 'row', gap: phone ? 12 : 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <h1 style={{ fontSize: phone ? 20 : 24, fontWeight: 700, letterSpacing: -0.3, margin: 0, color: 'var(--cf1f5f9)' }}>{greeting}{who}</h1>
          <span style={{ fontSize: 14, color: 'var(--c94a3b8)' }}>{dateLine} · {home.chairs.staff} {L('thợ đang làm', 'technicians on today')}{home.today.bookings > 0 && <> · {home.today.bookings} {L('lịch hôm nay', 'bookings today')}</>}</span>
        </div>
        {!phone && !narrow && <div style={{ flex: 1 }} />}
        {customDates}
        {periodPicker}
      </div>

      {liveStrip}

      {phone ? (
        <>
          {hero}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>{bookingsCard}{avgCard}{chairsCard}</div>
          {quickActions}
          {attentionCard}
          {nowCard}
          {chartCard}
          {topCard}
        </>
      ) : (
        <>
          {narrow ? (
            <>
              {hero}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap }}>{bookingsCard}{avgCard}{chairsCard}</div>
            </>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: tablet ? '1.5fr 1fr 1fr 1fr' : '1.6fr 1fr 1fr 1fr', gap }}>{hero}{bookingsCard}{avgCard}{chairsCard}</div>
          )}
          {quickActions}
          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : tablet ? '1.5fr 1fr' : '1.6fr 1fr', gap, alignItems: 'start' }}>{nowCard}{attentionCard}</div>
          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1.6fr 1fr', gap, alignItems: 'stretch' }}>{chartCard}{topCard}</div>
        </>
      )}
      {morePanels}
    </section>
  );
}

/* ---------- small presentational pieces ---------- */

/** A pleasant axis top: 1,240 → 1,500; 8,900 → 10,000. */
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  const n = f <= 1 ? 1 : f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 3 ? 3 : f <= 5 ? 5 : f <= 7.5 ? 7.5 : 10;
  return n * p;
}
/** "$1.5K" on an axis, in the salon's own currency. */
function compactMoney(minor: number, money: (c: number) => string): string {
  const cur = uiCurrency();
  try {
    const digits = new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).resolvedOptions().maximumFractionDigits ?? 2;
    const units = digits === 0 ? minor : minor / 10 ** digits;
    if (units < 10000) return money(minor).replace(/[.,]00(?=\D*$)/, '');
    return new Intl.NumberFormat(cur === 'VND' ? 'vi-VN' : 'en-US', { style: 'currency', currency: cur, notation: 'compact', maximumFractionDigits: 1 }).format(units);
  } catch {
    return money(minor);
  }
}
function shortDate(key: string): string {
  return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
}

/** Where the range's bookings came from: brand chip + count + share bar. */
function SourcesPanel({ rows, vi, hint }: { rows: { source: string | null; utmSource: string | null; attrReferrer?: string | null; attrLandingUrl?: string | null }[]; vi: boolean; hint: string }) {
  const counts = sourceCounts(rows);
  const total = rows.length || 1;
  if (!counts.length) return <p style={{ color: 'var(--c94a3b8)', fontSize: 14, margin: 0 }}>{vi ? 'Chưa có lịch hẹn trong khoảng này.' : 'No bookings in this range.'}</p>;
  return (
    <div>
      <p style={{ color: 'var(--c64748b)', fontSize: 12.5, margin: '0 0 10px' }}>{hint}</p>
      {counts.map(({ meta, count }) => {
        const pct = Math.round((count / total) * 100);
        return (
          <div key={meta.key} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '7px 0' }}>
            <div style={{ flex: '0 0 168px', minWidth: 0 }}>
              <SourceChip meta={meta} vi={vi} count={count} />
            </div>
            <div style={{ flex: 1, height: 8, background: 'var(--c1e293b)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: meta.color, borderRadius: 4 }} />
            </div>
            <span style={{ flex: '0 0 44px', textAlign: 'right', fontSize: 12.5, color: 'var(--c94a3b8)' }}>{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

function PaymentMethods({ pm }: { pm: { cash: number; card: number; transfer: number; online: number; onsite: number } }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const rows: { label: string; value: number; color: string }[] = [
    { label: t('db.pmCash'), value: pm.cash, color: 'var(--ink-good)' },
    { label: t('db.pmCard'), value: pm.card, color: '#3b82f6' },
    { label: t('db.pmTransfer'), value: pm.transfer, color: '#06b6d4' },
    { label: t('db.pmOnline'), value: pm.online, color: '#a855f7' },
    { label: t('db.pmOnsite'), value: pm.onsite, color: '#eab308' },
  ];
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (total === 0) return <p style={{ color: 'var(--c94a3b8)', fontSize: 14, margin: 0 }}>{t('db.noPayments')}</p>;
  return (
    <>
      <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', marginBottom: 12 }}>
        {rows.filter((r) => r.value > 0).map((r) => (
          <div key={r.label} title={`${r.label}: ${formatPrice(r.value)}`} style={{ width: `${(r.value / total) * 100}%`, background: r.color }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: r.color }} />
            <span style={{ color: 'var(--ccbd5e1)' }}>{r.label}</span>
            <span style={{ marginLeft: 'auto', color: 'var(--ce2e8f0)', fontWeight: 600 }}>{formatPrice(r.value)}</span>
            <span style={{ color: 'var(--c64748b)', width: 42, textAlign: 'right' }}>{Math.round((r.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </>
  );
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#eab308', ASSIGNED: '#3b82f6', ACCEPTED: '#22c55e', CONFIRMED: '#22c55e', ARRIVED: '#0ea5e9',
  REJECTED: '#ef4444', CANCELLED: 'var(--c94a3b8)', COMPLETED: '#a855f7', NO_SHOW: '#f97316',
};

function StatusBreakdown({ breakdown, total }: { breakdown: Record<string, number>; total: number }) {
  const { lang } = useLang();
  const entries = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  if (total === 0) return <p style={{ color: 'var(--c94a3b8)', fontSize: 14, margin: 0 }}>{tr('db.noBookingsRange', lang)}</p>;
  return (
    <>
      <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', marginBottom: 12 }}>
        {entries.map(([s, n]) => (
          <div key={s} title={`${s}: ${n}`} style={{ width: `${(n / total) * 100}%`, background: STATUS_COLORS[s] ?? 'var(--c64748b)' }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
        {entries.map(([s, n]) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: STATUS_COLORS[s] ?? 'var(--c64748b)' }} />
            <span style={{ color: 'var(--ccbd5e1)' }}>{s}</span>
            <span style={{ marginLeft: 'auto', color: 'var(--c94a3b8)' }}>{n}</span>
          </div>
        ))}
      </div>
    </>
  );
}

const dateInput: React.CSSProperties = {
  height: 40,
  padding: '0 10px',
  borderRadius: 10,
  border: '1px solid var(--line)',
  background: 'var(--c0f172a)',
  color: 'var(--ce2e8f0)',
  fontSize: 13.5,
};
