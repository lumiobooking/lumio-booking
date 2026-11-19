'use client';

/**
 * THE RESTAURANT OWNER'S HOME (18/11/2026), as approved in the mockup
 * "Tổng quan nhà hàng — thiết kế lại".
 *
 * The salon home showed a restaurant "chairs busy", "technicians free" and a
 * "today" that ended at midnight — so at 15:42 last night's after-midnight
 * bills read as "today, down 72%". Here: tonight from the restaurant's own
 * hour, last night closed and compared with the night before, what is on the
 * tables now, and the few things the owner must look at (a till never
 * closed, bills taken back after payment, dishes taken back after the
 * kitchen had them, no transfers at all).
 *
 * Reads only this restaurant's own data, through the same endpoints the till
 * and the reports use.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../../lib/auth';
import { apiFetch } from '../../lib/api';
import { formatPrice } from '../../lib/ui';
import { uiCurrency } from '../../lib/ui-currency';
import { dayKeyInTz, fmtInTz } from '../../lib/datetime';
import { useLang } from '../../lib/i18n';
import { useLiveRefresh } from '../../lib/useLiveRefresh';
import { DEFAULT_DAY_START, nightLabel, addDaysKey, bizDayKey, bizWindow, changePct, nightStats, nightsOpen, type BizOrder } from '../../lib/restaurant-day';
import { C, Card, Delta, Dot, H2, Row, num, one } from './rk';

interface Floor { checks?: { subtotalCents?: number; status?: string }[] }
interface Kitchen { tickets?: unknown[] }
interface Shift { shift: { status: string; openedAt: string; openingCents: number } | null }
interface Voids { totals: { items: number; amountCents: number }; checks: unknown[] }
interface HomeLite { today?: { bookings: number }; chairs?: { staff: number } }

export function RestaurantHome() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const L = (v: string, e: string) => (vi ? v : e);
  const [startHour, setStartHour] = useState<number | null>(null);
  const [orders, setOrders] = useState<BizOrder[] | null>(null);
  const [floor, setFloor] = useState<Floor | null>(null);
  const [kitchen, setKitchen] = useState<Kitchen | null>(null);
  const [shift, setShift] = useState<Shift | null>(null);
  const [voids, setVoids] = useState<Voids | null>(null);
  const [lite, setLite] = useState<HomeLite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const s = await apiFetch<{ dayStartHour?: number }>('/restaurant/settings', { token }).catch(() => ({} as { dayStartHour?: number }));
      const h = typeof s.dayStartHour === 'number' ? s.dayStartHour : DEFAULT_DAY_START;
      setStartHour(h);
      const at = new Date();
      setNow(at);
      const today = bizDayKey(at, h);
      const from = bizWindow(addDaysKey(today, -3), h).from;
      const to = bizWindow(today, h).to;
      const last = bizWindow(addDaysKey(today, -1), h);
      const [o, f, k, sh, v, hl] = await Promise.all([
        apiFetch<BizOrder[]>(`/pos/orders?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { token }),
        apiFetch<Floor>('/restaurant/floor', { token }).catch(() => null),
        apiFetch<Kitchen>('/restaurant/kitchen', { token }).catch(() => null),
        apiFetch<Shift>('/pos/shifts/current', { token }).catch(() => null),
        apiFetch<Voids>(`/restaurant/voids?from=${encodeURIComponent(last.from)}&to=${encodeURIComponent(last.to)}`, { token }).catch(() => null),
        apiFetch<HomeLite>(`/overview/home?from=${today}&to=${today}`, { token }).catch(() => null),
      ]);
      setOrders(Array.isArray(o) ? o : []); setFloor(f); setKitchen(k); setShift(sh); setVoids(v); setLite(hl); setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(load, 60000);

  if (error) return <div style={{ padding: 16, color: C.bad }}>{error}</div>;
  if (startHour === null || orders === null) return <div style={{ padding: 24, color: C.muted }}>{L('Đang tải…', 'Loading…')}</div>;

  const today = bizDayKey(now, startHour);
  const lastKey = addDaysKey(today, -1);
  const t = nightStats(orders, today, startHour);
  const y = nightStats(orders, lastKey, startHour);
  const yy = nightStats(orders, addDaysKey(today, -2), startHour);
  const nights = [3, 2, 1].map((n) => { const k = addDaysKey(today, -n); return { key: k, s: nightStats(orders, k, startHour) }; });
  const maxNight = Math.max(1, ...nights.map((n) => n.s.netCents));
  const hh = `${String(startHour).padStart(2, '0')}:00`;
  const dayLabel = (k: string, long = false) => nightLabel(k, vi, long);
  const money = (c: number) => formatPrice(c);
  // A tile is narrow: millions of đồng as "14,9 tr", everything else in full.
  const short = (c: number) => (uiCurrency() === 'VND' && Math.abs(c) >= 1_000_000 ? `${(c / 1_000_000).toFixed(1).replace('.', ',')} tr` : money(c));

  const open = (floor?.checks ?? []).filter((c) => c.status !== 'PAID' && c.status !== 'VOID');
  const onTables = open.reduce((s, c) => s + (c.subtotalCents ?? 0), 0);
  const openShift = shift?.shift && shift.shift.status === 'OPEN' ? shift.shift : null;
  const shiftNights = openShift ? nightsOpen(openShift.openedAt, now, startHour) : 0;

  const attention: { key: string; tone: 'bad' | 'warn'; label: string; value: string; href: string }[] = [];
  if (openShift && shiftNights >= 1) attention.push({ key: 'shift', tone: 'bad', label: L('Ca chưa chốt', 'Till not closed'), value: L(`${shiftNights} đêm`, `${shiftNights} nights`), href: '/salon/pos/shifts' });
  if (y.voided.length) attention.push({ key: 'void', tone: 'bad', label: L(`${y.voided.length} bill huỷ đêm qua`, `${y.voided.length} bills taken back`), value: money(y.voidedCents), href: `/salon/pos/report?day=${lastKey}` });
  if (voids && voids.totals.items > 0) attention.push({ key: 'items', tone: voids.totals.amountCents > y.netCents * 0.03 ? 'bad' : 'warn', label: L(`${voids.totals.items} món bị huỷ`, `${voids.totals.items} dishes taken back`), value: money(voids.totals.amountCents), href: `/salon/pos/report?day=${lastKey}` });
  if (y.bills >= 5 && y.transferBills === 0) attention.push({ key: 'transfer', tone: 'warn', label: L('Bill chuyển khoản', 'Transfer bills'), value: `0 / ${y.bills}`, href: `/salon/pos/report?day=${lastKey}` });
  if (y.bigDiscounts.length) attention.push({ key: 'disc', tone: 'warn', label: L('Bill giảm từ 30%', 'Bills 30%+ off'), value: String(y.bigDiscounts.length), href: `/salon/pos/report?day=${lastKey}` });

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '12px 16px 32px', display: 'flex', flexDirection: 'column', gap: 14, color: C.ink, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, ...one }}>{L('Tổng quan', 'Overview')}</h1>
        <span style={{ fontSize: 14, color: C.muted, ...num }}>{nightLabel(dayKeyInTz(now), vi, true)} · {fmtInTz(now, { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
      </div>

      <Card>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.ink2, ...one }}>{L(`Hôm nay · tính từ ${hh}`, `Today · from ${hh}`)}</div>
        <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1, marginTop: 4, ...num }}>{money(t.netCents)}</div>
        <div style={{ fontSize: 15, color: C.ink2, ...one }}>{t.bills ? L(`${t.bills} bill đã thu`, `${t.bills} bills paid`) : L('Chưa có bill nào', 'No bills yet')}</div>
        <div style={{ height: 1, background: C.line, margin: '14px 0 2px' }} />
        <Row first label={L(`Đêm qua (${dayLabel(lastKey)})`, `Last night (${dayLabel(lastKey)})`)} value={money(y.netCents)} />
        <Row label={L('Số bill', 'Bills')} value={String(y.bills)} />
        <Row label={L(`So với ${dayLabel(addDaysKey(today, -2))}`, `vs ${dayLabel(addDaysKey(today, -2))}`)} value={<Delta pct={changePct(y.netCents, yy.netCents)} />} />
        <Link href={`/salon/pos/report?day=${lastKey}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 48, marginTop: 10, borderRadius: 14, background: 'rgba(99,102,241,.14)', color: C.link, fontSize: 15, fontWeight: 700, textDecoration: 'none', ...one }}>
          {L('Xem báo cáo đêm qua', 'Last night’s report')}
        </Link>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        {[
          { label: L('Bàn có khách', 'Tables seated'), value: String(open.length) },
          { label: L('Tiền trên bàn', 'On open bills'), value: short(onTables) },
          { label: L('Phiếu chờ bếp', 'Kitchen tickets'), value: kitchen ? String((kitchen.tickets ?? []).length) : '—' },
          { label: L('Đặt bàn hôm nay', 'Bookings today'), value: lite?.today ? String(lite.today.bookings) : '—' },
        ].map((x) => (
          <div key={x.label} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, padding: '14px 16px', minWidth: 0 }}>
            <div style={{ fontSize: 14, color: C.ink2, ...one }}>{x.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2, ...num, ...one }}>{x.value}</div>
          </div>
        ))}
      </div>

      <Card tone={attention.length ? 'warn' : undefined}>
        <H2 right={attention.length ? <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', background: '#dc2626', minWidth: 24, height: 24, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px' }}>{attention.length}</span> : undefined}>
          {L('Cần anh/chị xem', 'Needs a look')}
        </H2>
        {attention.length === 0 && <div style={{ fontSize: 15, color: C.ink2, padding: '8px 0' }}>{L('Không có gì bất thường đêm qua.', 'Nothing unusual last night.')}</div>}
        {attention.map((a, i) => (
          <Row key={a.key} first={i === 0} href={a.href} tone={a.tone} value={a.value}
            label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0 }}><Dot tone={a.tone} /><span style={{ color: C.ink, ...one }}>{a.label}</span></span>} />
        ))}
        {openShift && shiftNights >= 1 && (
          <Link href="/salon/pos/shifts" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 48, marginTop: 10, borderRadius: 14, background: C.accent, color: '#fff', fontSize: 15, fontWeight: 700, textDecoration: 'none', ...one }}>
            {L('Chốt ca và đếm két', 'Close the till and count')}
          </Link>
        )}
        <Row href="/salon/pos/log" value="" label={<span style={{ color: C.ink, ...one }}>{L('Nhật ký đêm nay · ai làm gì', 'Tonight’s log · who did what')}</span>} />
      </Card>

      <Card>
        <H2>{L('3 đêm gần nhất', 'Last 3 nights')}</H2>
        {nights.map((n) => (
          <div key={n.key} style={{ display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr) auto', alignItems: 'center', gap: 10, height: 40 }}>
            <span style={{ fontSize: 14, color: C.ink2, ...num }}>{dayLabel(n.key)}</span>
            <div style={{ height: 12, borderRadius: 6, background: 'rgba(148,163,184,.18)' }}>
              <div style={{ width: `${Math.round((n.s.netCents / maxNight) * 100)}%`, height: 12, borderRadius: 6, background: n.key === lastKey ? C.accent : 'rgba(99,102,241,.45)' }} />
            </div>
            <span style={{ fontSize: 15, fontWeight: 600, textAlign: 'right', ...num }}>{money(n.s.netCents)}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
