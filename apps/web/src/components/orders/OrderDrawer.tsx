'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../lib/api';
import { ui } from '../../lib/ui';
import { formatPrice, fromMinorUnits, toMinorUnits, priceInputStep } from '../../lib/money';
import { fmtInTz } from '../../lib/datetime';
import { payLabel } from '../../lib/payment-methods';
import { buildReceiptHtml, printHtml, withDefaults, type ReceiptProfile } from '../../lib/receipt';
import { useIsMobile } from '../../lib/responsive';
import { CustomerEditForm, type EditableCustomer } from '../CustomerEditForm';

/**
 * One bill, everything about it — the right-hand panel of Orders.
 *
 * Who it was for, each line with its technician, the money in and the money
 * back, the booking it settled and what happened to it since (who rang it
 * up, who refunded or voided it and why). Money only moves forward from
 * here: refund (part or all, with a reason) or void (a bill that was wrong
 * from the start). Deleting exists only for a draft nobody paid on.
 */

export interface OrderLine {
  id: string; kind: string; name: string; quantity: number;
  unitPriceCents: number; discountCents: number; tipCents: number; lineTotalCents: number; staffMemberId: string | null;
}
export interface OrderDetail {
  id: string; orderNumber: number; status: 'OPEN' | 'PAID' | 'VOID' | 'REFUNDED';
  subtotalCents: number; discountCents: number; taxCents: number; tipCents: number;
  totalCents: number; paidCents: number; changeCents: number; currency: string;
  createdAt: string; paidAt: string | null; note: string | null;
  giftCardAppliedCents?: number;
  items: OrderLine[]; tenders: { method: string; amountCents: number }[];
  customer: (EditableCustomer & { visits: number; spentCents: number }) | null;
  staffNames: Record<string, string>;
  appointments: { id: string; startTime: string }[];
  cashierName: string | null;
  refunds: { amountCents: number; provider: string; at: string }[];
  refundedCents: number; collectedCents: number;
  history: { action: string; at: string; by: string | null; meta: Record<string, unknown> }[];
  canRefund: boolean; canVoid: boolean; canDelete: boolean;
  /** Why this person may not void it (shift closed / day over) — refund instead. */
  voidLock?: string | null;
}
export interface StaffLite { id: string; firstName: string; lastName: string | null; isActive?: boolean }

const REFUND_REASONS = [
  { k: 'unhappy', vi: 'Khách không hài lòng', en: 'Client not happy' },
  { k: 'mistake', vi: 'Thu nhầm / nhập sai', en: 'Charged by mistake' },
  { k: 'duplicate', vi: 'Trùng bill', en: 'Duplicate bill' },
  { k: 'other', vi: 'Khác', en: 'Other' },
];
const VOID_REASONS = [
  { k: 'duplicate', vi: 'Trùng bill', en: 'Duplicate bill' },
  { k: 'wrong', vi: 'Bấm nhầm khách / dịch vụ', en: 'Wrong client or service' },
  { k: 'changed', vi: 'Khách đổi ý trước khi làm', en: 'Client changed their mind before the service' },
  { k: 'other', vi: 'Khác', en: 'Other' },
];
const PROVIDER_METHOD: Record<string, string> = { 'pos-cash': 'CASH', 'pos-card': 'CARD', 'pos-transfer': 'TRANSFER', 'pos-wallet': 'MOMO' };

export function orderState(o: { status: string; refundedCents?: number }): 'open' | 'paid' | 'part' | 'refunded' | 'void' {
  if (o.status === 'VOID') return 'void';
  if (o.status === 'REFUNDED') return 'refunded';
  if (o.status === 'OPEN') return 'open';
  return (o.refundedCents ?? 0) > 0 ? 'part' : 'paid';
}

export function StateChip({ o, vi }: { o: { status: string; refundedCents?: number; currency: string }; vi: boolean }) {
  const s = orderState(o);
  const look: Record<string, { bg: string; ink: string; label: string }> = {
    paid: { bg: 'rgba(34,197,94,.13)', ink: 'var(--ink-good)', label: vi ? 'Đã thu' : 'Paid' },
    part: { bg: 'rgba(249,115,22,.14)', ink: 'var(--ink-warn)', label: `${vi ? 'Hoàn 1 phần' : 'Part refunded'} −${formatPrice(o.refundedCents ?? 0, o.currency)}` },
    refunded: { bg: 'rgba(249,115,22,.14)', ink: 'var(--ink-warn)', label: vi ? 'Đã hoàn tiền' : 'Refunded' },
    void: { bg: 'rgba(148,163,184,.16)', ink: 'var(--c94a3b8)', label: vi ? 'Đã huỷ' : 'Voided' },
    open: { bg: 'rgba(99,102,241,.15)', ink: 'var(--ink-link)', label: vi ? 'Đang mở' : 'Open' },
  };
  const l = look[s];
  return <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 999, background: l.bg, color: l.ink, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{l.label}</span>;
}

export function OrderDrawer({ id, token, vi, canMoveMoney, isOwner, canEditClient, staff, onClose, onChanged }: {
  id: string; token: string | null; vi: boolean;
  /** pos.void — refund, void, delete a draft. */
  canMoveMoney: boolean;
  /** Changing a paid line's technician is the owner's (server: SALON_ADMIN). */
  isOwner: boolean;
  canEditClient: boolean;
  staff: StaffLite[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  const phone = useIsMobile();
  const [d, setD] = useState<OrderDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'refund' | 'void' | null>(null);
  const [editClient, setEditClient] = useState(false);
  const [techEdit, setTechEdit] = useState<Record<string, string> | null>(null);
  // The tip of each line while re-splitting (typed in the salon's money).
  const [tipEdit, setTipEdit] = useState<Record<string, string>>({});
  const receiptRef = useRef<ReceiptProfile | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setErr(null);
    try { setD(await apiFetch<OrderDetail>(`/pos/orders/${id}/detail`, { token })); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [id, token]);
  useEffect(() => { setD(null); setDialog(null); setEditClient(false); setTechEdit(null); void load(); }, [load]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !dialog) onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, dialog]);

  const money = (c: number) => formatPrice(c, d?.currency);
  const when = (iso: string) => fmtInTz(iso, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const techName = (sid: string | null) => (sid ? d?.staffNames[sid] ?? staff.find((s) => s.id === sid)?.firstName ?? '—' : L('Chưa giao thợ', 'No technician'));

  // Per technician: what their lines brought in and their tips.
  const byTech = useMemo(() => {
    const m = new Map<string, { sales: number; tips: number }>();
    for (const l of d?.items ?? []) {
      const k = l.staffMemberId ?? '';
      const v = m.get(k) ?? { sales: 0, tips: 0 };
      v.sales += l.lineTotalCents; v.tips += l.tipCents ?? 0;
      m.set(k, v);
    }
    return [...m.entries()];
  }, [d]);

  async function reprint() {
    if (!d) return;
    if (!receiptRef.current) receiptRef.current = await apiFetch<ReceiptProfile>('/pos/receipt-profile', { token }).catch(() => null);
    const p = receiptRef.current;
    const shop = p?.shop ?? { name: '', address: '', phone: '', website: '', logoUrl: '' };
    printHtml(buildReceiptHtml({
      orderNumber: d.orderNumber,
      when: fmtInTz(d.paidAt ?? d.createdAt, { dateStyle: 'short', timeStyle: 'short' }),
      voided: d.status === 'VOID' || d.status === 'REFUNDED',
      lines: d.items.map((l) => ({ qty: l.quantity, name: l.name, amountCents: l.lineTotalCents, tech: l.staffMemberId ? techName(l.staffMemberId) : null, tipCents: l.tipCents })),
      subtotal: d.subtotalCents, discount: d.discountCents, tax: d.taxCents, tip: d.tipCents, total: d.totalCents,
      paid: d.tenders.map((t) => ({ method: t.method === 'OTHER' ? 'TRANSFER' : t.method, cents: t.amountCents })),
      change: d.changeCents,
      bookingUrl: p?.shop.bookingSlug ? `${window.location.origin}/book/${p.shop.bookingSlug}` : null,
    }, shop, withDefaults(p?.design), (c: number) => formatPrice(c, d.currency)));
  }

  const tipTotal = d ? d.items.reduce((n, l) => n + (l.tipCents ?? 0), 0) : 0;
  const newTip = (l: OrderLine) => (tipEdit[l.id] === undefined ? l.tipCents ?? 0 : (tipEdit[l.id].trim() ? toMinorUnits(tipEdit[l.id], d?.currency) : 0));
  const tipNow = d ? d.items.reduce((n, l) => n + newTip(l), 0) : 0;
  const startEdit = () => {
    if (!d) return;
    setTechEdit(Object.fromEntries(d.items.map((l) => [l.id, l.staffMemberId ?? ''])));
    setTipEdit(Object.fromEntries(d.items.map((l) => [l.id, fromMinorUnits(l.tipCents ?? 0, d.currency)])));
  };

  async function saveTechs() {
    if (!d || !techEdit) return;
    const items = d.items.filter((l) => (techEdit[l.id] ?? '') !== (l.staffMemberId ?? '')).map((l) => ({ itemId: l.id, staffMemberId: techEdit[l.id] || null }));
    const tips = d.items.filter((l) => newTip(l) !== (l.tipCents ?? 0)).map((l) => ({ itemId: l.id, tipCents: newTip(l) }));
    if (tips.length && tipNow !== tipTotal) { setErr(L(`Tổng tip phải giữ nguyên ${money(tipTotal)}.`, `The tips must still add up to ${money(tipTotal)}.`)); return; }
    if (!items.length && !tips.length) { setTechEdit(null); return; }
    setBusy(true); setErr(null);
    try {
      if (items.length) await apiFetch(`/pos/orders/${d.id}/staff`, { method: 'PATCH', token, body: { items } });
      if (tips.length) await apiFetch(`/pos/orders/${d.id}/tips`, { method: 'PATCH', token, body: { items: tips } });
      setTechEdit(null); await load(); onChanged();
    }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function removeDraft() {
    if (!d || !confirm(L(`Xoá bill nháp #${d.orderNumber}? Bill này chưa thu đồng nào.`, `Delete draft #${d.orderNumber}? Nothing was paid on it.`))) return;
    setBusy(true);
    try { await apiFetch(`/pos/orders/${d.id}`, { method: 'DELETE', token }); onChanged(); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  const histLabel = (h: OrderDetail['history'][number]): ReactNode => {
    const m = h.meta ?? {};
    const why = [m.reason, m.note ? `“${m.note}”` : null].filter(Boolean).join(' · ');
    if (h.action === 'order.voided') return <>{L('Huỷ bill', 'Voided')}{why ? <> · {why}</> : null}</>;
    if (h.action === 'order.refunded') {
      return <>{L('Hoàn', 'Refunded')} {money(Number(m.amountCents) || 0)} {m.method ? `(${payLabel(String(m.method), vi ? 'vi' : 'en')})` : ''}{m.full ? ` · ${L('toàn bộ', 'in full')}` : ''}{why ? <> · {why}</> : null}</>;
    }
    if (h.action === 'pos.order_staff_changed') return L('Đổi thợ trên bill', 'Changed the technician');
    if (h.action === 'order.created') return L('Tạo bill', 'Bill created');
    return h.action;
  };

  const panel: CSSProperties = phone
    ? { position: 'fixed', inset: 0, zIndex: 81, background: 'var(--c111827)', overflowY: 'auto', padding: '16px 16px calc(24px + env(safe-area-inset-bottom, 0px))' }
    : { position: 'fixed', top: 0, right: 0, bottom: 0, width: 620, maxWidth: '96vw', zIndex: 81, background: 'var(--c111827)', borderLeft: '1px solid var(--c1f2937)', boxShadow: '-12px 0 32px rgba(0,0,0,.35)', overflowY: 'auto', padding: 22 };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(15,23,42,.35)' }} />
      <aside role="dialog" aria-modal="true" aria-label={d ? `${L('Bill', 'Bill')} #${d.orderNumber}` : L('Bill', 'Bill')} style={panel}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 21, fontWeight: 800, color: 'var(--cf8fafc)' }}>{L('Bill', 'Bill')} #{d?.orderNumber ?? '…'}</span>
              {d && <StateChip o={d} vi={vi} />}
            </div>
            {d && (
              <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 2 }}>
                {when(d.paidAt ?? d.createdAt)}
                {d.cashierName ? ` · ${L('Thu ngân', 'Cashier')}: ${d.cashierName}` : ''}
                {d.appointments.length > 0 && ` · ${L('Từ lịch hẹn', 'From booking')} ${d.appointments.map((a) => fmtInTz(a.startTime, { hour: 'numeric', minute: '2-digit' })).join(', ')}`}
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label={L('Đóng', 'Close')} style={{ ...ghost, width: 34, padding: 0, fontSize: 16 }}>✕</button>
        </div>

        {err && <div style={{ ...ui.banner, marginTop: 12 }}>{err}</div>}
        {!d ? <p style={{ color: 'var(--c94a3b8)' }}>{L('Đang tải…', 'Loading…')}</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
            {/* ---- the client */}
            {d.customer ? (
              editClient ? (
                <CustomerEditForm token={token} vi={vi} customer={d.customer}
                  onCancel={() => setEditClient(false)}
                  onSaved={() => { setEditClient(false); void load(); onChanged(); }} />
              ) : (
                <div style={box}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, color: 'var(--cf8fafc)' }}>{`${d.customer.firstName} ${d.customer.lastName ?? ''}`.trim()}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>
                        {[d.customer.phone, d.customer.email].filter(Boolean).join(' · ')}
                        {d.customer.visits > 0 ? ` · ${d.customer.visits} ${L('bill', 'bills')} · ${L('đã chi', 'spent')} ${money(d.customer.spentCents)}` : ''}
                      </div>
                    </div>
                    {canEditClient && <button type="button" onClick={() => setEditClient(true)} style={ghost}>✎ {L('Sửa', 'Edit')}</button>}
                    <Link href={`/salon/customers/${d.customer.id}`} style={{ ...ghost, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>{L('Hồ sơ', 'Profile')} ↗</Link>
                  </div>
                </div>
              )
            ) : (
              <div style={{ ...box, fontSize: 13, color: 'var(--c94a3b8)' }}>{L('Khách lẻ — bill không gắn hồ sơ khách.', 'Walk-in — no client profile on this bill.')}</div>
            )}

            {/* ---- the lines */}
            <div>
              <div style={{ ...sec, display: 'flex', alignItems: 'center' }}>
                <span style={{ flex: 1 }}>{L('DỊCH VỤ & SẢN PHẨM', 'SERVICES & PRODUCTS')}</span>
                {isOwner && d.status === 'PAID' && !techEdit && d.items.some((l) => l.kind === 'SERVICE') && (
                  <button type="button" onClick={startEdit} style={{ ...ghost, height: 26, fontSize: 12 }}>👤 {L('Đổi thợ · chia tip', 'Change tech · split tip')}</button>
                )}
              </div>
              <div style={{ border: '1px solid var(--c334155)', borderRadius: 12, overflow: 'hidden' }}>
                {d.items.map((l, i) => (
                  <div key={l.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 12px', borderTop: i ? '1px solid var(--c1f2937)' : 'none', fontSize: 13.5 }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ color: 'var(--ce2e8f0)', fontWeight: 600 }}>{l.quantity > 1 ? `${l.quantity}× ` : ''}{l.name}</span>
                      {l.tipCents > 0 && <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}> · tip {money(l.tipCents)}</span>}
                    </span>
                    {l.kind === 'SERVICE' && (techEdit ? (
                      <select value={techEdit[l.id] ?? ''} onChange={(e) => setTechEdit({ ...techEdit, [l.id]: e.target.value })} style={{ ...ui.input, width: 150, padding: '5px 8px', fontSize: 12.5, marginBottom: 0 }}>
                        <option value="">{L('— Chưa giao thợ —', '— No technician —')}</option>
                        {staff.filter((s) => s.isActive !== false || s.id === l.staffMemberId).map((s) => <option key={s.id} value={s.id}>{`${s.firstName} ${s.lastName ?? ''}`.trim()}</option>)}
                      </select>
                    ) : <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>👤 {techName(l.staffMemberId)}</span>)}
                    {techEdit && (
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--c94a3b8)' }}>tip
                        <input type="number" inputMode="decimal" min={0} step={priceInputStep(d.currency)} value={tipEdit[l.id] ?? ''} onChange={(e) => setTipEdit({ ...tipEdit, [l.id]: e.target.value })}
                          style={{ ...ui.input, width: 78, padding: '5px 8px', fontSize: 12.5, marginBottom: 0 }} />
                      </label>
                    )}
                    <b style={{ minWidth: 76, textAlign: 'right', color: 'var(--ce2e8f0)', textDecoration: d.status === 'VOID' ? 'line-through' : 'none' }}>{money(l.lineTotalCents)}</b>
                  </div>
                ))}
              </div>
              {techEdit && (
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                  <span style={{ flex: 1, fontSize: 12, color: tipNow !== tipTotal ? 'var(--ink-bad)' : 'var(--c94a3b8)' }}>
                    {L('Tiền khách trả không đổi — chỉ đổi người được tính doanh số & tip.', 'The money does not change — only who is credited with the sale and tip.')}
                    {' '}{L('Tổng tip', 'Tips')}: {money(tipNow)} / {money(tipTotal)}
                  </span>
                  <button type="button" onClick={() => setTechEdit(null)} style={ghost}>{L('Thôi', 'Cancel')}</button>
                  <button type="button" disabled={busy} onClick={() => void saveTechs()} style={{ ...ui.primaryBtn, padding: '6px 14px' }}>{L('Lưu', 'Save')}</button>
                </div>
              )}
            </div>

            {/* ---- money */}
            <div style={{ display: 'grid', gridTemplateColumns: phone ? '1fr' : '1fr 1fr', gap: 12 }}>
              <div style={box}>
                <div style={sec}>{L('TIỀN', 'MONEY')}</div>
                <Row l={L('Tạm tính', 'Subtotal')} r={money(d.subtotalCents)} />
                {d.discountCents > 0 && <Row l={L('Giảm giá', 'Discount')} r={`−${money(d.discountCents)}`} />}
                {d.taxCents > 0 && <Row l={L('Thuế', 'Tax')} r={money(d.taxCents)} />}
                {d.tipCents > 0 && <Row l="Tip" r={money(d.tipCents)} />}
                <div style={{ borderTop: '1px solid var(--c1f2937)', margin: '4px 0' }} />
                <Row l={L('Tổng bill', 'Total')} r={money(d.totalCents)} strong />
                {(d.giftCardAppliedCents ?? 0) > 0 && <Row l={L('Trả bằng gift card', 'Paid by gift card')} r={money(d.giftCardAppliedCents ?? 0)} />}
                {d.refundedCents > 0 && <Row l={L('Đã hoàn', 'Refunded')} r={`−${money(d.refundedCents)}`} tone="var(--ink-warn)" />}
                {d.status === 'PAID' && <Row l={L('Thực thu', 'Kept')} r={money(d.collectedCents)} strong tone="var(--ink-good)" />}
              </div>
              <div style={box}>
                <div style={sec}>{L('THANH TOÁN', 'PAYMENTS')}</div>
                {d.tenders.length === 0 && <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L('Chưa thu', 'Nothing paid yet')}</div>}
                {d.tenders.map((t, i) => <Row key={i} l={payLabel(t.method, vi ? 'vi' : 'en')} r={money(t.amountCents)} />)}
                {d.changeCents > 0 && <Row l={L('Tiền thối', 'Change')} r={`−${money(d.changeCents)}`} />}
                {d.refunds.map((r, i) => <Row key={`r${i}`} l={`↩ ${payLabel(PROVIDER_METHOD[r.provider] ?? 'OTHER', vi ? 'vi' : 'en')} · ${fmtInTz(r.at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`} r={`−${money(r.amountCents)}`} tone="var(--ink-warn)" />)}
                {byTech.length > 0 && <>
                  <div style={{ borderTop: '1px solid var(--c1f2937)', margin: '6px 0' }} />
                  <div style={sec}>{L('CHIA CHO THỢ', 'BY TECHNICIAN')}</div>
                  {byTech.map(([sid, v]) => <Row key={sid || 'none'} l={`${techName(sid || null)}${v.tips ? ` · tip ${money(v.tips)}` : ''}`} r={money(v.sales)} />)}
                </>}
              </div>
            </div>

            {d.note && <div style={{ ...box, fontSize: 13, color: 'var(--ccbd5e1)' }}>📝 {d.note}</div>}

            {/* ---- what happened to it */}
            <div style={box}>
              <div style={sec}>{L('LỊCH SỬ', 'HISTORY')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {[
                  { at: d.createdAt, by: d.cashierName, text: L('Mở bill', 'Bill opened') as ReactNode },
                  ...(d.paidAt ? [{ at: d.paidAt, by: d.cashierName, text: <>{L('Thu', 'Paid')} {money(d.tenders.reduce((n, t) => n + t.amountCents, 0))} · {d.tenders.map((t) => payLabel(t.method, vi ? 'vi' : 'en')).join(' + ')}</> }] : []),
                  ...d.history.filter((h) => h.action !== 'order.created').map((h) => ({ at: h.at, by: h.by, text: histLabel(h) })),
                ].sort((a, b) => a.at.localeCompare(b.at)).map((h, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12.5 }}>
                    <span style={{ flex: '0 0 auto', color: 'var(--c94a3b8)', minWidth: 92 }}>{fmtInTz(h.at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    <span style={{ color: 'var(--ccbd5e1)' }}>{h.by ? <b style={{ color: 'var(--ce2e8f0)' }}>{h.by} · </b> : null}{h.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ---- what can be done */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, borderTop: '1px solid var(--c1f2937)', paddingTop: 14 }}>
              <button type="button" onClick={() => void reprint()} style={ghost}>🖨 {L('In lại', 'Reprint')}</button>
              <span style={{ flex: 1 }} />
              {d.canRefund && <button type="button" onClick={() => setDialog('refund')} style={{ ...ghost, borderColor: '#f97316', color: 'var(--ink-warn)' }}>↩ {L('Hoàn tiền', 'Refund')}</button>}
              {d.status === 'PAID' && <button type="button" disabled={!d.canVoid} title={d.canVoid ? undefined : d.voidLock || L('Bill đã có hoàn tiền — hoàn tiếp phần còn lại.', 'Part of it was refunded — refund the rest instead.')} onClick={() => setDialog('void')} style={{ ...ghost, borderColor: '#ef4444', color: 'var(--ink-bad)', opacity: d.canVoid ? 1 : 0.45 }}>{L('Huỷ bill', 'Void')}</button>}
              {canMoveMoney && d.canDelete && <button type="button" disabled={busy} onClick={() => void removeDraft()} style={{ ...ghost, borderColor: '#ef4444', color: 'var(--ink-bad)' }}>{L('Xoá bill nháp', 'Delete draft')}</button>}
            </div>
            {d.status === 'PAID' && d.voidLock && d.refundedCents === 0 && <div style={{ fontSize: 12, color: 'var(--ink-warn)', marginTop: -6 }}>{d.voidLock}</div>}
            {!canMoveMoney && d.status === 'PAID' && <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: -6 }}>{L('Hoàn tiền / huỷ bill: cần chủ tiệm hoặc quản lý nhập PIN của họ.', 'Refunds and voids: the owner or a manager types their PIN.')}</div>}
          </div>
        )}
      </aside>
      {d && dialog === 'refund' && <RefundDialog d={d} token={token} vi={vi} needPin={!canMoveMoney} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void load(); onChanged(); }} />}
      {d && dialog === 'void' && <VoidDialog d={d} token={token} vi={vi} needPin={!canMoveMoney} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void load(); onChanged(); }} />}
    </>
  );
}

function Row({ l, r, strong, tone }: { l: ReactNode; r: ReactNode; strong?: boolean; tone?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '2px 0', fontWeight: strong ? 800 : 500, color: tone ?? (strong ? 'var(--cf8fafc)' : 'var(--ccbd5e1)') }}>
      <span style={{ minWidth: 0 }}>{l}</span><span style={{ whiteSpace: 'nowrap' }}>{r}</span>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(15,23,42,.5)' }} />
      <div role="dialog" aria-modal="true" style={{ position: 'fixed', zIndex: 91, left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 480, maxWidth: 'calc(100vw - 24px)', maxHeight: 'calc(100dvh - 24px)', overflowY: 'auto', background: 'var(--c111827)', border: '1px solid var(--c334155)', borderRadius: 16, boxShadow: '0 24px 60px rgba(0,0,0,.4)', padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <b style={{ flex: 1, fontSize: 17, color: 'var(--cf8fafc)' }}>{title}</b>
          <button type="button" onClick={onClose} style={{ ...ghost, width: 32, padding: 0 }}>✕</button>
        </div>
        {children}
      </div>
    </>
  );
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 10, border: `1px solid ${on ? '#6366f1' : 'var(--c334155)'}`, background: on ? 'var(--c1e1b4b)' : 'transparent', color: 'var(--ce2e8f0)', fontSize: 13, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}>
      <span style={{ flex: '0 0 14px', height: 14, borderRadius: '50%', border: `2px solid ${on ? '#6366f1' : 'var(--c475569)'}`, boxSizing: 'border-box', boxShadow: on ? 'inset 0 0 0 3px var(--c111827)' : 'none', background: on ? '#6366f1' : 'transparent' }} />
      <span style={{ minWidth: 0 }}>{children}</span>
    </button>
  );
}

/** The approver's PIN, when the person at the till may not refund / void alone. */
function PinField({ value, onChange, vi }: { value: string; onChange: (v: string) => void; vi: boolean }) {
  return (
    <label style={{ display: 'block', padding: '10px 12px', borderRadius: 10, background: 'var(--wash-amber)' }}>
      <span style={{ ...ui.label, color: 'var(--ink-warn)', fontWeight: 700 }}>🔒 {vi ? 'PIN của chủ tiệm / quản lý' : 'Owner / manager PIN'}</span>
      <input type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        placeholder="••••" style={{ ...ui.input, letterSpacing: 6, fontSize: 18, marginBottom: 0 }} />
    </label>
  );
}

function RefundDialog({ d, token, vi, needPin, onClose, onDone }: { d: OrderDetail; token: string | null; vi: boolean; needPin: boolean; onClose: () => void; onDone: () => void }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const cur = d.currency;
  const [lines, setLines] = useState<string[]>([]);
  const [withTip, setWithTip] = useState(false);
  const [amount, setAmount] = useState('');
  const methods = useMemo(() => [...new Set([...d.tenders.map((t) => t.method), 'CASH'])], [d]);
  const [method, setMethod] = useState(d.tenders[0]?.method ?? 'CASH');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const max = d.collectedCents;

  // Ticking lines fills in their amount (the cashier can still type another).
  useEffect(() => {
    if (!lines.length) return;
    const sum = d.items.filter((l) => lines.includes(l.id)).reduce((n, l) => n + l.lineTotalCents + (withTip ? l.tipCents ?? 0 : 0), 0);
    setAmount(fromMinorUnits(Math.min(sum, max), cur));
  }, [lines, withTip, d, max, cur]);

  const cents = amount.trim() ? toMinorUnits(amount, cur) : 0;
  const full = cents === max && d.refundedCents === 0;
  const ok = cents > 0 && cents <= max && !!reason && (!needPin || pin.length >= 4);

  async function submit() {
    if (!ok) return;
    setBusy(true); setErr(null);
    try {
      await apiFetch(`/pos/orders/${d.id}/refund`, { method: 'POST', token, body: { amountCents: cents, method, reason: REFUND_REASONS.find((r) => r.k === reason)?.vi ?? reason, note, itemIds: lines, ...(needPin ? { approvalPin: pin } : {}) } });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return (
    <Modal title={<>↩ {L('Hoàn tiền', 'Refund')} · {L('Bill', 'Bill')} #{d.orderNumber}</>} onClose={onClose}>
      <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>
        {L('Hoàn tiền là một khoản riêng gắn vào bill này, ghi vào doanh thu ngày hoàn. Bill không bị xoá.', 'A refund is its own entry on this bill, counted on the day it goes back. The bill is not deleted.')}
      </div>
      <div style={sec}>{L('CHỌN DÒNG CẦN HOÀN (TUỲ CHỌN)', 'LINES TO REFUND (OPTIONAL)')}</div>
      {d.items.map((l) => {
        const on = lines.includes(l.id);
        return (
          <label key={l.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 11px', borderRadius: 10, border: `1px solid ${on ? '#6366f1' : 'var(--c334155)'}`, fontSize: 13, color: 'var(--ce2e8f0)', cursor: 'pointer' }}>
            <input type="checkbox" checked={on} onChange={() => setLines(on ? lines.filter((x) => x !== l.id) : [...lines, l.id])} />
            <span style={{ flex: 1 }}>{l.name}</span><b>{formatPrice(l.lineTotalCents, cur)}</b>
          </label>
        );
      })}
      {lines.length > 0 && d.items.some((l) => lines.includes(l.id) && l.tipCents > 0) && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: 'var(--ccbd5e1)' }}>
          <input type="checkbox" checked={withTip} onChange={(e) => setWithTip(e.target.checked)} /> {L('Hoàn cả tip của các dòng này', 'Refund the tips on these lines too')}
        </label>
      )}
      <label style={{ display: 'block' }}>
        <span style={ui.label}>{L('Số tiền hoàn', 'Amount')} · {L('tối đa', 'up to')} {formatPrice(max, cur)}</span>
        <input type="number" inputMode="decimal" min={0} step={priceInputStep(cur)} value={amount} onChange={(e) => { setLines([]); setAmount(e.target.value); }} style={ui.input} />
      </label>
      <div style={sec}>{L('HOÀN VỀ', 'REFUND TO')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {methods.map((m) => <Choice key={m} on={method === m} onClick={() => setMethod(m)}>{payLabel(m, vi ? 'vi' : 'en')}</Choice>)}
      </div>
      <div style={sec}>{L('LÝ DO (BẮT BUỘC)', 'REASON (REQUIRED)')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {REFUND_REASONS.map((r) => <Choice key={r.k} on={reason === r.k} onClick={() => setReason(r.k)}>{vi ? r.vi : r.en}</Choice>)}
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={L('Ghi chú (vd: phần vẽ bị lem)', 'Note (e.g. the art smudged)')} style={ui.input} />
      {full && <div style={{ fontSize: 12.5, padding: '8px 10px', borderRadius: 10, background: 'var(--wash-amber)', color: 'var(--ink-warn)' }}>{L('Hoàn toàn bộ: bill chuyển sang "Đã hoàn tiền", doanh số & tip của thợ trên bill này không còn tính.', 'Full refund: the bill becomes "Refunded" and its technicians’ sales and tips stop counting.')}</div>}
      {!full && cents > 0 && <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{lines.length
        ? L('Doanh số & tip của thợ trên các dòng đã chọn bị trừ theo số tiền hoàn, vào ngày hoàn.', 'The technicians on the chosen lines lose the refunded sale and tip, on the day of the refund.')
        : L('Không chọn dòng: số tiền hoàn được chia theo tỉ lệ các dòng, trừ vào doanh số thợ ngày hoàn.', 'No line chosen: the refund is split over the lines and comes off the technicians’ sales on the day of the refund.')}</div>}
      {needPin && <PinField value={pin} onChange={setPin} vi={vi} />}
      {method === 'CASH' && <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{L('Tiền mặt lấy từ két được ghi vào ca thu ngân đang mở (chi ra).', 'Cash from the drawer is written into the open cashier shift as cash out.')}</div>}
      {err && <div style={ui.banner}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <button type="button" onClick={onClose} style={ghost}>{L('Thôi', 'Cancel')}</button>
        <button type="button" disabled={!ok || busy} onClick={() => void submit()} style={{ ...ui.primaryBtn, background: '#ea580c', opacity: ok ? 1 : 0.5 }}>
          {busy ? '…' : `${L('Hoàn', 'Refund')} ${cents > 0 ? formatPrice(cents, cur) : ''}`}
        </button>
      </div>
    </Modal>
  );
}

function VoidDialog({ d, token, vi, needPin, onClose, onDone }: { d: OrderDetail; token: string | null; vi: boolean; needPin: boolean; onClose: () => void; onDone: () => void }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    if (!reason || (needPin && pin.length < 4)) return;
    setBusy(true); setErr(null);
    try {
      await apiFetch(`/pos/orders/${d.id}/void`, { method: 'POST', token, body: { reason: VOID_REASONS.find((r) => r.k === reason)?.vi ?? reason, note, ...(needPin ? { approvalPin: pin } : {}) } });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }
  return (
    <Modal title={<span style={{ color: 'var(--ink-bad)' }}>{L('Huỷ bill', 'Void bill')} #{d.orderNumber}</span>} onClose={onClose}>
      <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L('Dùng khi bill sai từ đầu (bấm nhầm, trùng). Đã làm dịch vụ và khách lấy lại tiền → dùng Hoàn tiền.', 'For a bill that was wrong from the start (mistake, duplicate). Service done and money given back → use Refund.')}</div>
      <div style={{ ...box, fontSize: 13, color: 'var(--ce2e8f0)', display: 'flex', justifyContent: 'space-between' }}>
        <span>{d.items.map((l) => l.name).join(', ')}</span><b>{formatPrice(d.totalCents, d.currency)}</b>
      </div>
      <div style={sec}>{L('LÝ DO (BẮT BUỘC)', 'REASON (REQUIRED)')}</div>
      {VOID_REASONS.map((r) => <Choice key={r.k} on={reason === r.k} onClick={() => setReason(r.k)}>{vi ? r.vi : r.en}</Choice>)}
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={L('Ghi chú', 'Note')} style={ui.input} />
      {needPin && <PinField value={pin} onChange={setPin} vi={vi} />}
      <div style={{ fontSize: 12.5, padding: '8px 10px', borderRadius: 10, background: 'var(--wash-red)', color: 'var(--ink-bad)' }}>
        {L('Bill không bị xoá: vẫn ở danh sách với nhãn "Đã huỷ", không tính doanh thu, tip, hoa hồng. Lịch hẹn gốc mở lại để thu lại đúng.', 'The bill is not deleted: it stays in the list as "Voided" and stops counting for revenue, tips and commission. Its booking reopens so it can be charged correctly.')}
      </div>
      {err && <div style={ui.banner}>{err}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" onClick={onClose} style={ghost}>{L('Thôi', 'Cancel')}</button>
        <button type="button" disabled={!reason || busy || (needPin && pin.length < 4)} onClick={() => void submit()} style={{ ...ui.dangerBtn, opacity: reason && (!needPin || pin.length >= 4) ? 1 : 0.5 }}>{busy ? '…' : L('Huỷ bill', 'Void bill')}</button>
      </div>
    </Modal>
  );
}

const ghost: CSSProperties = { height: 32, padding: '0 12px', borderRadius: 9, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
const box: CSSProperties = { border: '1px solid var(--c334155)', borderRadius: 12, padding: '11px 13px' };
const sec: CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: '.07em', color: 'var(--c94a3b8)', marginBottom: 6 };
