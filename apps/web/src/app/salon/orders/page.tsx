'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fmtInTz } from '../../../lib/datetime';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth, useCan } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';
import { useLiveRefresh } from '../../../lib/useLiveRefresh';
import { useLiveTopics } from '../../../lib/useLiveEvents';
import { useIsMobile, CARD_LIST_MAX } from '../../../lib/responsive';
import { MList, MCard, MHead, MRow } from '../../../components/MobileCard';
import { SearchBox, matchesQuery, sortNewest, usePaged, Pager } from '../../../components/ListFilter';
import { PeriodFilter, usePeriod, Delta } from '../../../components/PeriodFilter';
import { rangeText } from '../../../lib/period';
import { uiLocale } from '../../../lib/datetime';
import { payLabel } from '../../../lib/payment-methods';
import { csvLine } from '../../../lib/walkin-day';
import { fromMinorUnits } from '../../../lib/money';
import { SalesImport } from '../../../components/SalesImport';
import { OrderDrawer, StateChip, orderState, type StaffLite } from '../../../components/orders/OrderDrawer';

/**
 * ORDERS › Bills — the till's book of sales (the sổ cái).
 *
 * Every bill of the period with who it was for, what was done, by whom, how
 * it was paid and where it stands; the totals of what is on screen above it.
 * A row opens the bill (OrderDrawer): reprint, change the technician, refund
 * or void with a reason. A paid bill is never deleted — it stays here,
 * marked, so the numbers never have a hole in them.
 */

interface OrderItem {
  id: string; kind: 'SERVICE' | 'PRODUCT'; name: string; quantity: number;
  unitPriceCents: number; discountCents: number; tipCents: number; lineTotalCents: number; staffMemberId: string | null;
}
interface Order {
  id: string; orderNumber: number; status: 'OPEN' | 'PAID' | 'VOID' | 'REFUNDED';
  subtotalCents: number; discountCents: number; taxCents: number; tipCents: number;
  totalCents: number; paidCents: number; changeCents: number; currency: string;
  createdAt: string; paidAt: string | null; appointmentId: string | null;
  items: OrderItem[]; tenders: { method: string; amountCents: number }[];
  customer: { id: string; firstName: string; lastName: string | null; phone: string | null } | null;
  refundedCents: number;
}

export default function OrdersPage() {
  return (
    <SalonShell>
      <Inner />
    </SalonShell>
  );
}

function Inner() {
  const { token, user } = useAuth();
  const can = useCan();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const L = (v: string, e: string) => (vi ? v : e);
  const cardList = useIsMobile(CARD_LIST_MAX);
  // The front desk lives in today; ‹ › walks back a day at a time.
  const range = usePeriod('sales', 'today');
  const [orders, setOrders] = useState<Order[]>([]);
  // The same bills for the period compared against (KPI arrows).
  const [prevOrders, setPrevOrders] = useState<Order[] | null>(null);
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [state, setState] = useState('');
  const [tech, setTech] = useState('');
  const [method, setMethod] = useState('');
  const [q, setQ] = useState('');
  // Arrived from the header search (?q=…) or a link to one bill (?id=…).
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const v = sp.get('q'); if (v) setQ(v);
    const id = sp.get('id'); if (id) setOpenId(id);
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    const cmp = range.cmp;
    try {
      const [o, st, po] = await Promise.all([
        apiFetch<Order[]>(`/pos/orders?from=${range.from}&to=${range.to}`, { token }),
        apiFetch<StaffLite[]>('/staff', { token }).catch(() => [] as StaffLite[]),
        cmp ? apiFetch<Order[]>(`/pos/orders?from=${cmp.from}&to=${cmp.to}`, { token }).catch(() => null) : Promise.resolve(null),
      ]);
      setOrders(Array.isArray(o) ? o : []);
      setPrevOrders(Array.isArray(po) ? po : null);
      setStaff(Array.isArray(st) ? st : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders');
    } finally { setLoading(false); }
  }, [token, range.from, range.to, range.cmp?.from, range.cmp?.to]);
  useEffect(() => { setLoading(true); void load(); }, [load]);
  useLiveRefresh(load);
  useLiveTopics(['orders', 'payments'], token, load);

  const staffName = useCallback((id: string | null) => {
    if (!id) return '';
    const s = staff.find((x) => x.id === id);
    return s ? `${s.firstName} ${s.lastName ?? ''}`.trim() : '';
  }, [staff]);
  const custName = (o: Order) => (o.customer ? `${o.customer.firstName} ${o.customer.lastName ?? ''}`.trim() : '');
  const techsOf = (o: Order) => [...new Set(o.items.map((l) => staffName(l.staffMemberId)).filter(Boolean))];
  const methodsOf = (o: Order) => [...new Set(o.tenders.map((t) => t.method))];
  const methodsSeen = useMemo(() => [...new Set(orders.flatMap((o) => o.tenders.map((t) => t.method)))], [orders]);

  // The filters other than the period, applied the same way to the period compared against.
  const passes = (o: Order) => (!state || orderState(o) === state)
    && (!tech || o.items.some((l) => l.staffMemberId === tech))
    && (!method || o.tenders.some((t) => t.method === method))
    && matchesQuery(`#${o.orderNumber} ${o.orderNumber} ${custName(o)} ${o.customer?.phone ?? ''} ${o.items.map((i) => i.name).join(' ')} ${techsOf(o).join(' ')}`, q);
  const visible = sortNewest(orders.filter(passes), (o) => o.paidAt ?? o.createdAt);
  const filtered = !!(state || tech || method || q.trim());
  const cur = orders[0]?.currency;
  const money = (c: number) => formatPrice(c, cur);

  // The strip — the same lines as Reports › Revenue, for the bills on screen.
  const k = useMemo(() => kpisOf(visible), [visible]);
  const pk = useMemo(() => (prevOrders ? kpisOf(prevOrders.filter(passes)) : null), [prevOrders, state, tech, method, q, staff]); // eslint-disable-line react-hooks/exhaustive-deps
  const cmpText = range.cmp ? rangeText(range.cmp.from, range.cmp.to, uiLocale()) : '';

  const pg = usePaged(visible, 25);

  function exportCsv() {
    const rows = [csvLine([L('Ngày giờ', 'Date'), L('Số bill', 'Bill'), L('Khách', 'Client'), L('SĐT', 'Phone'), L('Dịch vụ', 'Items'), L('Thợ', 'Technicians'),
      L('Cách trả', 'Paid by'), L('Tạm tính', 'Subtotal'), L('Giảm giá', 'Discount'), L('Thuế', 'Tax'), 'Tip', L('Tổng', 'Total'), L('Đã hoàn', 'Refunded'), L('Trạng thái', 'Status')])];
    for (const o of visible) {
      rows.push(csvLine([
        fmtInTz(o.paidAt ?? o.createdAt, { dateStyle: 'short', timeStyle: 'short' }), o.orderNumber, custName(o), o.customer?.phone ?? '',
        o.items.map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.name}` : i.name)).join(' + '), techsOf(o).join(', '),
        methodsOf(o).map((m) => payLabel(m, vi ? 'vi' : 'en')).join(' + '),
        fromMinorUnits(o.subtotalCents, o.currency), fromMinorUnits(o.discountCents, o.currency), fromMinorUnits(o.taxCents, o.currency),
        fromMinorUnits(o.tipCents, o.currency), fromMinorUnits(o.totalCents, o.currency), fromMinorUnits(o.refundedCents, o.currency), orderState(o),
      ]));
    }
    const blob = new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bills-${range.from || 'all'}-${range.to || 'today'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const isOwner = user?.role === 'SALON_ADMIN' || user?.role === 'SUPER_ADMIN';
  const sel = { ...ui.input, width: 'auto', marginBottom: 0, padding: '7px 10px', fontSize: 13 };
  const kpi = (label: string, value: string, sub: React.ReactNode, tone?: string) => (
    <div style={{ background: 'var(--c111827)', border: '1px solid var(--c334155)', borderRadius: 12, padding: '10px 13px', minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', color: 'var(--c94a3b8)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 800, color: tone ?? 'var(--cf8fafc)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>
    </div>
  );
  const vs = (cur: number, prev: number | undefined, invert = false) => (pk ? <><Delta cur={cur} prev={prev} vi={vi} invert={invert} /> {L('so với', 'vs')} {cmpText}</> : null);
  const lineText = (o: Order) => o.items.map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.name}` : i.name)).join(' · ') || '—';

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>{L('Bill bán hàng', 'Sales')}</h1>
          <p style={{ color: 'var(--c94a3b8)', margin: '4px 0 0', fontSize: 13.5 }}>{L('Bấm một bill để xem chi tiết, in lại, hoàn tiền hoặc huỷ.', 'Open a bill to see it all, reprint, refund or void it.')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {user?.role === 'SALON_ADMIN' && <button type="button" onClick={() => setImportOpen(true)} style={ghost}>⇪ {L('Nhập doanh thu cũ', 'Import past sales')}</button>}
          <button type="button" onClick={exportCsv} disabled={!visible.length} style={ghost}>⬇ CSV</button>
          <a href="/salon/pos" style={{ ...ui.primaryBtn, textDecoration: 'none' }}>+ {L('Bill mới', 'New sale')}</a>
        </div>
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      <div style={{ marginBottom: 10 }}><PeriodFilter state={range} vi={vi} showCompare /></div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <select value={tech} onChange={(e) => setTech(e.target.value)} style={sel} aria-label={L('Thợ', 'Technician')}>
          <option value="">{L('Mọi thợ', 'All technicians')}</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{`${s.firstName} ${s.lastName ?? ''}`.trim()}</option>)}
        </select>
        <select value={method} onChange={(e) => setMethod(e.target.value)} style={sel} aria-label={L('Cách trả', 'Paid by')}>
          <option value="">{L('Mọi cách trả', 'Any payment')}</option>
          {methodsSeen.map((m) => <option key={m} value={m}>{payLabel(m, vi ? 'vi' : 'en')}</option>)}
        </select>
        <select value={state} onChange={(e) => setState(e.target.value)} style={sel} aria-label={L('Trạng thái', 'Status')}>
          <option value="">{L('Mọi trạng thái', 'All statuses')}</option>
          <option value="paid">{L('Đã thu', 'Paid')}</option>
          <option value="part">{L('Hoàn 1 phần', 'Part refunded')}</option>
          <option value="refunded">{L('Đã hoàn tiền', 'Refunded')}</option>
          <option value="void">{L('Đã huỷ', 'Voided')}</option>
          <option value="open">{L('Đang mở', 'Open')}</option>
        </select>
        {filtered && (
          <button type="button" onClick={() => { setState(''); setTech(''); setMethod(''); setQ(''); }} style={{ ...ghost, height: 34, borderStyle: 'dashed' }}>
            ✕ {L('Bỏ lọc', 'Clear filters')}
          </button>
        )}
        <span style={{ flex: 1 }} />
        <SearchBox value={q} onChange={setQ} placeholder={L('Số bill, tên, SĐT, dịch vụ…', 'Bill no., name, phone, service…')} />
      </div>

      {filtered && <div style={{ fontSize: 12, color: 'var(--ink-warn)', marginBottom: 6 }}>{L('Số liệu dưới đây chỉ tính các bill đang lọc.', 'The figures below count the filtered bills only.')}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: 10, marginBottom: 14 }}>
        {kpi(L('Doanh thu thuần', 'Net sales'), money(k.net), vs(k.net, pk?.net) ?? L('gộp − giảm giá − hoàn', 'gross − discounts − refunds'), 'var(--ink-good)')}
        {kpi(L('Bill đã thu', 'Paid bills'), String(k.bills), vs(k.bills, pk?.bills) ?? `${k.voided} ${L('huỷ', 'voided')} · ${k.open} ${L('đang mở', 'open')}`)}
        {kpi(L('TB / bill', 'Avg / bill'), money(k.bills ? Math.round(k.net / k.bills) : 0), vs(k.bills ? k.net / k.bills : 0, pk ? (pk.bills ? pk.net / pk.bills : 0) : undefined) ?? L('doanh thu thuần ÷ bill', 'net ÷ bills'))}
        {kpi('Tip', money(k.tips), vs(k.tips, pk?.tips) ?? L('của thợ', 'for the techs'))}
        {kpi(L('Giảm giá · hoàn', 'Discounts · refunds'), `−${money(k.discount + k.back)}`, `${L('giảm', 'disc.')} ${money(k.discount)} · ${L('hoàn', 'ref.')} ${money(k.back)}`, k.back ? 'var(--ink-warn)' : undefined)}
        {kpi(L('Tổng thu', 'Total'), money(k.total), L('thuần + thuế + tip', 'net + tax + tips'))}
      </div>

      {loading && orders.length === 0 ? <p style={{ color: 'var(--c94a3b8)' }}>{L('Đang tải…', 'Loading…')}</p> : cardList ? (
        <>
          <MList>
            {visible.length === 0 && <p style={{ color: 'var(--c64748b)', fontSize: 13 }}>{L('Không có bill trong kỳ này.', 'No bills in this range.')}</p>}
            {pg.paged.map((o) => (
              <div key={o.id} onClick={() => setOpenId(o.id)} style={{ cursor: 'pointer' }}>
                <MCard>
                  <MHead right={<StateChip o={o} vi={vi} />}>
                    #{o.orderNumber} · <span style={{ textDecoration: o.status === 'VOID' ? 'line-through' : 'none' }}>{formatPrice(o.totalCents, o.currency)}</span>
                  </MHead>
                  <MRow label={L('Khách', 'Client')}>{custName(o) || L('Khách lẻ', 'Walk-in')}{o.customer?.phone ? ` · ${o.customer.phone}` : ''}</MRow>
                  <MRow label={L('Dịch vụ', 'Items')}>{lineText(o)}</MRow>
                  <MRow label={L('Thợ', 'Tech')}>{techsOf(o).join(', ') || '—'}</MRow>
                  <MRow label={L('Lúc', 'When')}>{fmtInTz(o.paidAt ?? o.createdAt, { dateStyle: 'short', timeStyle: 'short' })} · {methodsOf(o).map((m) => payLabel(m, vi ? 'vi' : 'en')).join(' + ') || '—'}</MRow>
                </MCard>
              </div>
            ))}
          </MList>
          <Pager paged={pg} />
        </>
      ) : (
        <div style={{ border: '1px solid var(--c334155)', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead><tr style={{ background: 'var(--c1e293b)' }}>
              <th style={ui.th}>{L('Số bill', 'Bill')}</th><th style={ui.th}>{L('Lúc', 'When')}</th><th style={ui.th}>{L('Khách', 'Client')}</th>
              <th style={ui.th}>{L('Dịch vụ', 'Items')}</th><th style={ui.th}>{L('Thợ', 'Tech')}</th><th style={ui.th}>{L('Cách trả', 'Paid by')}</th>
              <th style={{ ...ui.th, textAlign: 'right' }}>{L('Tổng', 'Total')}</th><th style={{ ...ui.th, textAlign: 'right' }}>Tip</th><th style={ui.th}>{L('Trạng thái', 'Status')}</th>
            </tr></thead>
            <tbody>
              {visible.length === 0 && <tr><td style={ui.td} colSpan={9}>{L('Không có bill trong kỳ này.', 'No bills in this range.')}</td></tr>}
              {pg.paged.map((o) => (
                <tr key={o.id} onClick={() => setOpenId(o.id)} style={{ borderTop: '1px solid var(--c334155)', cursor: 'pointer', background: openId === o.id ? 'var(--c1e1b4b)' : undefined }}>
                  <td style={{ ...ui.td, fontWeight: 700, color: 'var(--ink-link)' }}>#{o.orderNumber}</td>
                  <td style={{ ...ui.td, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{fmtInTz(o.paidAt ?? o.createdAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                  <td style={{ ...ui.td, maxWidth: 190 }}>
                    <div style={{ fontWeight: 600, color: 'var(--ce2e8f0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{custName(o) || L('Khách lẻ', 'Walk-in')}</div>
                    {o.customer?.phone && <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{o.customer.phone}</div>}
                  </td>
                  <td style={{ ...ui.td, color: 'var(--ccbd5e1)', maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={lineText(o)}>{lineText(o)}</td>
                  <td style={{ ...ui.td, color: 'var(--ccbd5e1)', maxWidth: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{techsOf(o).join(', ') || '—'}</td>
                  <td style={{ ...ui.td, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{methodsOf(o).map((m) => payLabel(m, vi ? 'vi' : 'en')).join(' + ') || '—'}</td>
                  <td style={{ ...ui.td, textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', textDecoration: o.status === 'VOID' ? 'line-through' : 'none', color: o.status === 'VOID' ? 'var(--c94a3b8)' : 'var(--ce2e8f0)' }}>{formatPrice(o.totalCents, o.currency)}</td>
                  <td style={{ ...ui.td, textAlign: 'right', color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{o.tipCents ? formatPrice(o.tipCents, o.currency) : '—'}</td>
                  <td style={ui.td}><StateChip o={o} vi={vi} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '0 14px 12px' }}><Pager paged={pg} /></div>
        </div>
      )}

      <p style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 12 }}>
        {L('Bill đã thu tiền không xoá được: huỷ hoặc hoàn tiền (có lý do) và bill vẫn ở lại danh sách. Số liệu chính thức theo ngày / tháng ở Báo cáo.',
          'A paid bill cannot be deleted: void or refund it (with a reason) and it stays in this list. Official figures by day and month are in Reports.')}
      </p>

      {openId && (
        <OrderDrawer id={openId} token={token} vi={vi} canMoveMoney={can('pos.void')} isOwner={isOwner} canEditClient={can('customers')} staff={staff}
          onClose={() => setOpenId(null)} onChanged={() => void load()} />
      )}
      {importOpen && <SalesImport vi={vi} onClose={() => setImportOpen(false)} onDone={() => void load()} />}
    </section>
  );
}

/** Same arithmetic as GET /pos/sales-summary: gross (list × qty) − discounts − refunds = net; + tax + tips = total. */
function kpisOf(rows: Order[]) {
  let bills = 0, voided = 0, open = 0, gross = 0, discount = 0, back = 0, tax = 0, tips = 0;
  for (const o of rows) {
    if (o.status === 'VOID') { voided++; continue; }
    if (o.status === 'OPEN') { open++; continue; }
    const g = o.items.reduce((n, l) => n + l.unitPriceCents * (l.quantity || 1), 0);
    const d = o.items.reduce((n, l) => n + (l.discountCents ?? 0), 0) + (o.discountCents ?? 0);
    gross += g; discount += d;
    if (o.status === 'REFUNDED') { back += Math.max(0, g - d); continue; }
    bills++; back += o.refundedCents ?? 0; tax += o.taxCents; tips += o.tipCents;
  }
  const net = gross - discount - back;
  return { bills, voided, open, gross, discount, back, net, tax, tips, total: net + tax + tips };
}

const ghost: React.CSSProperties = {
  height: 38, padding: '0 13px', borderRadius: 10, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};
