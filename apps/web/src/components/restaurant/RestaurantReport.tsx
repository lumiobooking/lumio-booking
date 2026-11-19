'use client';

/**
 * THE RESTAURANT'S NIGHT REPORT (18/11/2026), as approved in the mockup
 * "Tổng quan nhà hàng — thiết kế lại". Replaces, for restaurants, the
 * technicians' commission report that the Reports tab used to open.
 *
 * One business night (from the restaurant's own hour to the same hour next
 * morning): what came in, compared with the night before; then everything
 * through which money can leave without passing the till — bills taken back
 * after payment (beside the bill charged again on that table), dishes taken
 * back after the kitchen had them (who, who approved, why), tables closed
 * without a bill, deep discounts, a till never closed — then how the money
 * came in, by hour, and every bill. Read-only; this restaurant's data only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { apiFetch } from '../../lib/api';
import { formatPrice } from '../../lib/ui';
import { fmtInTz } from '../../lib/datetime';
import { useLang } from '../../lib/i18n';
import { DEFAULT_DAY_START, nightLabel, addDaysKey, bizDayKey, bizWindow, changePct, checkNoOf, nightStats, nightsOpen, tableOf, type BizOrder } from '../../lib/restaurant-day';
import { C, Card, Delta, Dot, H2, HourBars, Row, num, one } from './rk';

interface VoidLine { at: string; name: string; quantity: number; amountCents: number; reason: string | null; by: string | null; approvedBy: string | null; table: string; checkNumber: number; wholeCheck: boolean }
interface Voids {
  truncated: boolean;
  totals: { items: number; amountCents: number; lines: number };
  byReason: { key: string; items: number; amountCents: number }[];
  byUser: { key: string; items: number; amountCents: number }[];
  lines: VoidLine[];
  checks: { number: number; table: string; openedAt: string; closedAt: string | null; reason: string | null }[];
}
interface Shift { shift: { status: string; openedAt: string; openingCents: number } | null }
interface Detail { history?: { action: string; at?: string; by?: string | null; meta?: { reason?: string | null; note?: string | null } | null }[] }

type Open = 'items' | 'checks' | 'disc' | 'bills' | null;

export function RestaurantReport() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const L = (v: string, e: string) => (vi ? v : e);
  const params = useSearchParams();
  const [startHour, setStartHour] = useState<number | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [orders, setOrders] = useState<BizOrder[] | null>(null);
  const [voids, setVoids] = useState<Voids | null>(null);
  const [voidsErr, setVoidsErr] = useState(false);
  const [shift, setShift] = useState<Shift | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);

  // The restaurant's hour, then the night to show: ?day=, else tonight if it has bills, else last night.
  useEffect(() => {
    if (!token) return;
    void (async () => {
      const s = await apiFetch<{ dayStartHour?: number }>('/restaurant/settings', { token }).catch(() => ({} as { dayStartHour?: number }));
      const h = typeof s.dayStartHour === 'number' ? s.dayStartHour : DEFAULT_DAY_START;
      setStartHour(h);
      const asked = params?.get('day');
      if (asked && /^\d{4}-\d{2}-\d{2}$/.test(asked)) { setDay(asked); return; }
      const today = bizDayKey(new Date(), h);
      const w = bizWindow(today, h);
      const tonight = await apiFetch<BizOrder[]>(`/pos/orders?from=${encodeURIComponent(w.from)}&to=${encodeURIComponent(w.to)}`, { token }).catch(() => []);
      setDay(Array.isArray(tonight) && tonight.length ? today : addDaysKey(today, -1));
    })();
  }, [token, params]);

  const load = useCallback(async () => {
    if (!token || startHour === null || !day) return;
    setOrders(null); setOpen(null);
    try {
      const w = bizWindow(day, startHour);
      const from = bizWindow(addDaysKey(day, -1), startHour).from;
      const [o, v, sh] = await Promise.all([
        apiFetch<BizOrder[]>(`/pos/orders?from=${encodeURIComponent(from)}&to=${encodeURIComponent(w.to)}`, { token }),
        apiFetch<Voids>(`/restaurant/voids?from=${encodeURIComponent(w.from)}&to=${encodeURIComponent(w.to)}`, { token }).then((x) => { setVoidsErr(false); return x; }).catch(() => { setVoidsErr(true); return null; }),
        apiFetch<Shift>('/pos/shifts/current', { token }).catch(() => null),
      ]);
      const list = Array.isArray(o) ? o : [];
      setOrders(list); setVoids(v); setShift(sh); setError(null);
      // Why each bill was taken back: on its own page's history (a handful a night at most).
      const gone = list.filter((x) => x.status === 'VOID' && bizDayKey(x.paidAt || x.createdAt, startHour) === day).slice(0, 20);
      const got = await Promise.all(gone.map((x) => apiFetch<Detail>(`/pos/orders/${x.id}/detail`, { token }).then((d) => {
        const h = (d.history ?? []).find((e) => e.action === 'order.voided');
        const r = [h?.meta?.reason, h?.meta?.note].filter(Boolean).join(' · ');
        return [x.id, r || L('không ghi lý do', 'no reason given')] as const;
      }).catch(() => [x.id, ''] as const)));
      setReasons(Object.fromEntries(got));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [token, startHour, day]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);

  const s = useMemo(() => (orders && day && startHour !== null ? nightStats(orders, day, startHour) : null), [orders, day, startHour]);
  const prev = useMemo(() => (orders && day && startHour !== null ? nightStats(orders, addDaysKey(day, -1), startHour) : null), [orders, day, startHour]);

  if (error) return <div style={{ padding: 16, color: C.bad }}>{error}</div>;
  if (startHour === null || !day) return <div style={{ padding: 24, color: C.muted }}>{L('Đang tải…', 'Loading…')}</div>;

  const hh = `${String(startHour).padStart(2, '0')}:00`;
  const money = (c: number) => formatPrice(c);
  const dayLabel = (k: string, long = false) => nightLabel(k, vi, long);
  const clock = (iso: string) => fmtInTz(iso, { hour: '2-digit', minute: '2-digit', hour12: false });
  const today = bizDayKey(new Date(), startHour);
  const openShift = shift?.shift && shift.shift.status === 'OPEN' ? shift.shift : null;
  const shiftNights = openShift ? nightsOpen(openShift.openedAt, new Date(), startHour) : 0;
  const toggle = (k: Exclude<Open, null>) => setOpen((o) => (o === k ? null : k));

  const exportCsv = () => {
    if (!s) return;
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['Loại', 'Số', 'Bàn', 'Giờ', 'Trạng thái', 'Tạm tính', 'Giảm giá', 'Thành tiền', 'Cách trả', 'Món', 'SL', 'Lý do', 'Người huỷ', 'Người duyệt'],
      ...s.list.map((o) => ['Bill', o.orderNumber, tableOf(o), clock(o.paidAt || o.createdAt), o.status === 'VOID' ? 'Đã huỷ' : 'Đã thu', o.subtotalCents, o.discountCents, o.totalCents, (o.tenders ?? []).map((x) => x.method).join('+'), '', '', reasons[o.id] ?? '', '', '']),
      ...(voids?.lines ?? []).map((l) => ['Món huỷ', l.checkNumber, l.table, clock(l.at), l.wholeCheck ? 'Huỷ cả bàn' : 'Huỷ món', '', '', l.amountCents, '', l.name, l.quantity, l.reason ?? '', l.by ?? '', l.approvedBy ?? '']),
    ];
    const blob = new Blob(['﻿' + rows.map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `bao-cao-${day}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '12px 16px 40px', display: 'flex', flexDirection: 'column', gap: 14, color: C.ink, boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, flex: '1 1 auto', ...one }}>{L('Báo cáo', 'Report')}</h1>
        <button type="button" onClick={exportCsv} disabled={!s} style={{ height: 44, padding: '0 14px', borderRadius: 12, border: `1px solid ${C.line}`, background: C.card, color: C.ink, font: 'inherit', fontSize: 14, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', ...num }}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
          {L('Xuất Excel', 'Export')}
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" aria-label={L('Đêm trước', 'Previous night')} onClick={() => setDay(addDaysKey(day, -1))} style={navBtn}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <label style={{ position: 'relative', flex: '1 1 auto', minWidth: 0, height: 54, borderRadius: 12, background: C.card, border: `1px solid ${C.line}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <span style={{ fontSize: 16, fontWeight: 700, ...one }}>{day === today ? L('Hôm nay', 'Tonight') : day === addDaysKey(today, -1) ? L('Đêm qua', 'Last night') : dayLabel(day, true)} · {dayLabel(day)}</span>
          <span style={{ fontSize: 13, color: C.muted, ...num }}>{hh} → {hh} {L('sáng hôm sau', 'next morning')}</span>
          <input type="date" value={day} max={today} aria-label={L('Chọn ngày', 'Pick a day')} onChange={(e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) setDay(e.target.value); }}
            style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
        </label>
        <button type="button" aria-label={L('Đêm sau', 'Next night')} disabled={day >= today} onClick={() => setDay(addDaysKey(day, 1))} style={{ ...navBtn, opacity: day >= today ? 0.4 : 1 }}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </div>

      {!s || !prev ? <div style={{ padding: 24, color: C.muted }}>{L('Đang tải…', 'Loading…')}</div> : (
        <>
          <Card>
            <div style={{ fontSize: 14, fontWeight: 600, color: C.ink2 }}>{L('Thực thu', 'Taken')}</div>
            <div style={{ fontSize: 38, fontWeight: 700, letterSpacing: -1, marginTop: 2, ...num }}>{money(s.netCents)}</div>
            <div style={{ fontSize: 15, ...one }}><Delta pct={changePct(s.netCents, prev.netCents)} /><span style={{ color: C.muted }}> {L('so với', 'vs')} {dayLabel(addDaysKey(day, -1))}</span></div>
            <div style={{ height: 1, background: C.line, margin: '14px 0 2px' }} />
            <Row first label={L(`Đêm trước (${dayLabel(addDaysKey(day, -1))})`, `Night before (${dayLabel(addDaysKey(day, -1))})`)} value={money(prev.netCents)} />
            <Row label={L('Bill đã thu', 'Bills paid')} value={String(s.bills)} sub={<Delta pct={changePct(s.bills, prev.bills)} />} />
            <Row label={L('TB / bill', 'Per bill')} value={money(s.avgCents)} sub={<Delta pct={changePct(s.avgCents, prev.avgCents)} />} />
            <Row label={L('Giảm giá', 'Discounts')} value={money(s.discountCents)} sub={`${s.discountedBills} bill`} />
            <Row label={L('Bill huỷ', 'Bills taken back')} value={money(s.voidedCents)} tone={s.voided.length ? 'bad' : undefined} sub={`${s.voided.length} bill`} />
          </Card>

          <Card tone="warn">
            <H2>{L('Kiểm soát tiền', 'Money checks')}</H2>
            {s.voided.map(({ order: v, replacement: r }) => (
              <div key={v.id} style={{ border: '1px solid rgba(239,68,68,.45)', background: 'rgba(239,68,68,.06)', borderRadius: 14, padding: '2px 14px', margin: '8px 0' }}>
                <Row first label={L(`Bill huỷ #${v.orderNumber}`, `Voided #${v.orderNumber}`)} value={<s style={{ color: C.bad }}>{money(v.totalCents)}</s>} />
                <Row label={r ? L(`Thu lại #${r.orderNumber}`, `Re-charged #${r.orderNumber}`) : L('Không có bill thu lại', 'Not charged again')} value={r ? money(r.totalCents) : '—'} />
                <Row label={<b style={{ color: C.bad }}>{L('Chênh lệch', 'Difference')}</b>} value={money(v.totalCents - (r?.totalCents ?? 0))} tone="bad" />
                <Row label={L('Lý do huỷ', 'Reason')} value={<span style={{ fontSize: 14, fontWeight: 600 }}>{reasons[v.id] ?? '…'}</span>} />
                <div style={{ fontSize: 13, color: C.muted, padding: '0 0 10px', ...one }}>{tableOf(v)} · {clock(v.paidAt || v.createdAt)}{r ? ` → ${tableOf(r)} · ${clock(r.paidAt || r.createdAt)}` : ''}</div>
              </div>
            ))}

            <Row first={!s.voided.length} onClick={() => toggle('items')} tone={voids && voids.totals.items ? 'bad' : undefined}
              label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}><Dot tone={voids && voids.totals.items ? 'bad' : 'ok'} />{voids ? L(`${voids.totals.items} món bị huỷ`, `${voids.totals.items} dishes taken back`) : L('Món bị huỷ', 'Dishes taken back')}</span>}
              value={voidsErr ? L('cần quyền', 'no access') : voids ? money(voids.totals.amountCents) : '…'} />
            {open === 'items' && voids && (
              <div style={{ padding: '4px 0 10px' }}>
                {voids.byReason.slice(0, 6).map((r) => <Row key={r.key} label={`“${r.key}”`} value={money(r.amountCents)} sub={`${r.items} ${L('món', 'items')}`} />)}
                {voids.byUser.length > 0 && <div style={{ fontSize: 13, color: C.muted, margin: '10px 0 2px' }}>{L('Ai huỷ', 'Who')}</div>}
                {voids.byUser.slice(0, 6).map((r) => <Row key={r.key} label={r.key} value={money(r.amountCents)} sub={`${r.items} ${L('món', 'items')}`} />)}
                <div style={{ fontSize: 13, color: C.muted, margin: '10px 0 2px' }}>{L('Từng món', 'Each dish')}</div>
                {voids.lines.slice(0, 60).map((l, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: `1px solid ${C.line}` }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600, ...one }}>{l.quantity} × {l.name}</div>
                      <div style={{ fontSize: 13, color: C.muted, ...one }}>{clock(l.at)} · {l.table} · {l.by ?? '—'}{l.approvedBy ? ` → ${l.approvedBy} ${L('duyệt', 'approved')}` : ''} · “{l.reason ?? ''}”</div>
                    </div>
                    <span style={{ fontSize: 15, fontWeight: 700, ...num }}>{money(l.amountCents)}</span>
                  </div>
                ))}
                {voids.lines.length > 60 && <div style={{ fontSize: 13, color: C.muted, paddingTop: 8 }}>{L(`Còn ${voids.lines.length - 60} dòng — bấm Xuất Excel để xem hết.`, `${voids.lines.length - 60} more — export to see all.`)}</div>}
              </div>
            )}

            <Row onClick={() => toggle('checks')} value={voids ? `${voids.checks.length} ${L('bàn', 'tables')}` : '…'}
              label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}><Dot tone={voids && voids.checks.length ? 'warn' : 'ok'} />{L('Bàn huỷ không bill', 'Tables, no bill')}</span>} />
            {open === 'checks' && voids && voids.checks.map((c) => (
              <Row key={c.number} label={`#${c.number} · ${c.table} · ${clock(c.openedAt)}${c.closedAt ? `–${clock(c.closedAt)}` : ''}`} value={<span style={{ fontSize: 14, fontWeight: 600 }}>“{c.reason ?? ''}”</span>} />
            ))}

            <Row onClick={() => toggle('disc')} value={`${s.bigDiscounts.length} bill`}
              label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}><Dot tone={s.bigDiscounts.length ? 'warn' : 'ok'} />{L('Bill giảm từ 30%', 'Bills 30%+ off')}</span>} />
            {open === 'disc' && s.bigDiscounts.map((o) => (
              <Row key={o.id} label={`#${o.orderNumber} · ${tableOf(o)} · ${clock(o.paidAt || o.createdAt)}`} value={`−${money(o.discountCents)}`} sub={`${Math.round((o.discountCents / o.subtotalCents) * 100)}%`} />
            ))}

            <Row href="/salon/pos/shifts" tone={openShift && shiftNights >= 1 ? 'bad' : undefined}
              value={openShift ? (shiftNights >= 1 ? L(`Chưa chốt · ${shiftNights} đêm`, `Open ${shiftNights} nights`) : L('Đang mở', 'Open')) : L('Đã chốt', 'Closed')}
              label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}><Dot tone={openShift && shiftNights >= 1 ? 'bad' : 'ok'} />{L('Chốt ca', 'Till')}</span>} />
          </Card>

          <Card>
            <H2>{L('Tiền vào theo cách trả', 'How it was paid')}</H2>
            <Row first label={L('Tiền mặt', 'Cash')} value={money(s.byMethod.cash)} />
            <Row label={L('Chuyển khoản / QR', 'Transfer / QR')} value={money(s.byMethod.transfer)} sub={`${s.transferBills} bill`} tone={s.bills >= 5 && !s.transferBills ? 'warn' : undefined} />
            <Row label={L('Thẻ', 'Card')} value={money(s.byMethod.card)} />
            {s.byMethod.other > 0 && <Row label={L('Khác', 'Other')} value={money(s.byMethod.other)} />}
            {s.bills >= 5 && !s.transferBills && (
              <div style={{ fontSize: 13, color: C.warn, paddingTop: 8 }}>{L('Không bill nào bấm chuyển khoản. Nếu khách có quét mã, thu ngân đang bấm nhầm “tiền mặt” — số két sẽ không khớp.', 'No bill was marked as a transfer. If guests paid by QR, the cashier is pressing “cash” and the till will not match.')}</div>
            )}
          </Card>

          {s.byHour.length > 0 && (
            <Card>
              <H2>{L('Theo giờ', 'By hour')}</H2>
              {(() => { const p = s.byHour.reduce((a, r) => (r.cents > a.cents ? r : a), s.byHour[0]); return <div style={{ fontSize: 14, color: C.muted, ...num }}>{L('Đông nhất', 'Busiest')} {p.hour}h · {money(p.cents)}</div>; })()}
              <HourBars rows={s.byHour} label={(h) => `${h}h`} />
            </Card>
          )}

          <Card>
            <H2 right={<Link href="/salon/orders" style={{ fontSize: 14, fontWeight: 600, color: C.link, textDecoration: 'none', padding: '10px 0', ...num }}>{L('Mở trang Đơn', 'Orders')}</Link>}>
              {L(`Bill trong đêm (${s.list.length})`, `Bills (${s.list.length})`)}
            </H2>
            {(open === 'bills' ? s.list : s.list.slice(-8)).map((o) => {
              const voided = o.status === 'VOID';
              const ck = checkNoOf(o);
              return (
                <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, minHeight: 58, borderTop: `1px solid ${C.line}` }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: voided ? C.bad : C.ink, ...one }}>#{o.orderNumber} · {tableOf(o)}</div>
                    <div style={{ fontSize: 13, color: voided ? C.bad : C.muted, ...one }}>
                      {clock(o.paidAt || o.createdAt)}{ck ? ` · ${L('phiếu', 'ticket')} ${ck}` : ''}{voided ? ` · ${L('đã huỷ', 'voided')}` : o.discountCents ? ` · −${Math.round((o.discountCents / Math.max(1, o.subtotalCents)) * 100)}%` : ''}
                    </div>
                  </div>
                  <span style={{ fontSize: 16, fontWeight: 700, color: voided ? C.bad : C.ink, textDecoration: voided ? 'line-through' : 'none', ...num }}>{money(o.totalCents)}</span>
                </div>
              );
            })}
            {s.list.length > 8 && (
              <button type="button" onClick={() => toggle('bills')} style={{ width: '100%', height: 44, marginTop: 6, borderRadius: 12, border: `1px solid ${C.line}`, background: 'none', color: C.link, font: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                {open === 'bills' ? L('Thu gọn', 'Show less') : L(`Xem cả ${s.list.length} bill`, `Show all ${s.list.length}`)}
              </button>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

const navBtn = { width: 48, height: 54, borderRadius: 12, border: '1px solid var(--c334155)', background: 'var(--c1e293b)', color: 'var(--cf1f5f9)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 } as const;
