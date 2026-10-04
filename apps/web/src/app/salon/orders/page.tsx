'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { fmtInTz } from '../../../lib/datetime';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth, useCan } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { useLiveRefresh } from '../../../lib/useLiveRefresh';
import { useIsMobile, CARD_LIST_MAX } from '../../../lib/responsive';
import { MList, MCard, MHead, MRow, MActions } from '../../../components/MobileCard';
import { DateRangeBar, SearchBox, matchesQuery, useDateRange, sortNewest, usePaged, Pager } from '../../../components/ListFilter';
import { useBulkSelect, BulkBar, BulkAllBox, BulkRowBox, runBulkDelete } from '../../../components/BulkDelete';
import { uiLocale } from '../../../lib/datetime';
import { buildReceiptHtml, printHtml, withDefaults, type ReceiptProfile } from '../../../lib/receipt';

interface OrderItem {
  id: string; kind: 'SERVICE' | 'PRODUCT'; name: string; quantity: number;
  unitPriceCents: number; discountCents: number; tipCents: number; lineTotalCents: number; staffMemberId: string | null;
}
interface Tender { method: string; amountCents: number }
interface Order {
  id: string; orderNumber: number; status: 'OPEN' | 'PAID' | 'VOID' | 'REFUNDED';
  subtotalCents: number; discountCents: number; taxCents: number; tipCents: number;
  totalCents: number; paidCents: number; changeCents: number; currency: string;
  createdAt: string; paidAt: string | null; appointmentId: string | null;
  items: OrderItem[]; tenders: Tender[];
}
interface Staff { id: string; firstName: string; lastName: string | null }

const STATUS_COLORS: Record<string, string> = { PAID: '#22c55e', OPEN: '#eab308', VOID: 'var(--c94a3b8)', REFUNDED: '#f97316' };
const METHOD_LABEL: Record<string, string> = { CASH: 'Cash', CARD: 'Card', OTHER: 'Transfer' };

export default function OrdersPage() {
  return (
    <SalonShell>
      <Inner />
    </SalonShell>
  );
}

function Inner() {
  const { token } = useAuth();
  const can = useCan();
  const canVoid = can('pos.void');
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const ML: Record<string, string> = { CASH: t('or.mCash'), CARD: t('or.mCard'), OTHER: t('or.mTransfer') };
  // Cards up to tablet width — an iPad gets every field, not a squeezed table.
  const cardList = useIsMobile(CARD_LIST_MAX);
  const range = useDateRange('all');
  const [orders, setOrders] = useState<Order[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');
  // Arrived from the header search (?q=…): start with that search filled in.
  useEffect(() => { const v = new URLSearchParams(window.location.search).get('q'); if (v) setQ(v); }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // The bill's header + the owner's design, fetched on the first reprint.
  const receiptRef = useRef<ReceiptProfile | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try {
      const [o, st] = await Promise.all([
        apiFetch<Order[]>('/pos/orders', { token }),
        apiFetch<Staff[]>('/staff', { token }),
      ]);
      setOrders(o);
      setStaff(st);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders');
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load);

  const staffName = (id: string | null) => {
    if (!id) return '—';
    const s = staff.find((x) => x.id === id);
    return s ? `${s.firstName} ${s.lastName ?? ''}`.trim() : '—';
  };

  async function voidOrder(id: string) {
    if (!confirm(t('or.confirmVoid'))) return;
    try { await apiFetch(`/pos/orders/${id}/void`, { method: 'POST', token }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Void failed'); }
  }

  async function removeOrder(o: Order) {
    if (!confirm(t('or.delConfirmA').replace('{n}', String(o.orderNumber)) + (o.status === 'PAID' ? t('or.delStock') : '') + t('or.delConfirmB'))) return;
    try { await apiFetch(`/pos/orders/${o.id}`, { method: 'DELETE', token }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Delete failed'); }
  }

  /** Print an old bill again — the same paper the till prints, in today's design. */
  async function reprint(o: Order) {
    if (!receiptRef.current) receiptRef.current = await apiFetch<ReceiptProfile>('/pos/receipt-profile', { token }).catch(() => null);
    const p = receiptRef.current;
    const shop = p?.shop ?? { name: '', address: '', phone: '', website: '', logoUrl: '' };
    const money = (c: number) => formatPrice(c, o.currency);
    printHtml(buildReceiptHtml({
      orderNumber: o.orderNumber,
      when: fmtInTz(o.paidAt ?? o.createdAt, { dateStyle: 'short', timeStyle: 'short' }),
      voided: o.status === 'VOID',
      lines: o.items.map((l) => ({
        qty: l.quantity, name: l.name, amountCents: l.lineTotalCents,
        tech: l.staffMemberId ? staffName(l.staffMemberId) : null, tipCents: l.tipCents,
      })),
      subtotal: o.subtotalCents, discount: o.discountCents, tax: o.taxCents, tip: o.tipCents, total: o.totalCents,
      // This screen has always called the till's OTHER tender a transfer.
      paid: o.tenders.map((t) => ({ method: t.method === 'OTHER' ? 'TRANSFER' : t.method, cents: t.amountCents })),
      change: o.changeCents,
      bookingUrl: p?.shop.bookingSlug ? `${window.location.origin}/book/${p.shop.bookingSlug}` : null,
    }, shop, withDefaults(p?.design), money));
  }

  const visible = sortNewest(
    orders.filter(
      (o) =>
        range.inRange(o.createdAt) &&
        (!statusFilter || o.status === statusFilter) &&
        matchesQuery(
          `#${o.orderNumber} ${o.status} ${o.items.map((i) => i.name).join(' ')} ${o.tenders.map((t) => METHOD_LABEL[t.method] ?? t.method).join(' ')}`,
          q,
        ),
    ),
    (o) => o.createdAt,
  );
  const paidTotal = visible.filter((o) => o.status === 'PAID').reduce((s, o) => s + o.totalCents, 0);
  const pg = usePaged(visible, 20);
  const bulk = useBulkSelect(pg.paged.map((r) => r.id));

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>{t('or.title')}</h1>
          <p style={{ color: 'var(--c94a3b8)', margin: '4px 0 0', fontSize: 14 }}>{visible.length} {t('or.ordersWord')} · {formatPrice(paidTotal, 'USD')} {t('or.collected')}</p>
        </div>
        <a href="/salon/pos" style={{ ...ui.primaryBtn, textDecoration: 'none' }}>{t('or.newSale')}</a>
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <SearchBox value={q} onChange={setQ} placeholder={t('or.searchPh')} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...ui.input, width: 'auto' }}>
          <option value="">{t('or.allStatuses')}</option>
          <option value="PAID">{t('or.paid')}</option>
          <option value="OPEN">{t('or.open')}</option>
          <option value="VOID">{t('or.void')}</option>
          <option value="REFUNDED">{t('or.refunded')}</option>
        </select>
        <DateRangeBar range={range} />
      </div>

      {loading && orders.length === 0 ? <p style={{ color: 'var(--c94a3b8)' }}>{t('or.loading')}</p> : cardList ? (
        <>
          <MList>
            {visible.length === 0 && <p style={{ color: 'var(--c64748b)', fontSize: 13 }}>{t('or.empty')}</p>}
            {pg.paged.map((o) => (
              <MCard key={o.id}>
                <MHead right={<span style={{ color: STATUS_COLORS[o.status], border: `1px solid ${STATUS_COLORS[o.status]}`, borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>{o.status}</span>}>
                  #{o.orderNumber} · {formatPrice(o.totalCents, o.currency)}
                </MHead>
                <MRow label={t('or.colDate')}>{fmtInTz(o.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</MRow>
                <MRow label={t('or.colItems')}>{o.items.length} {t('or.itemsWord')}{o.appointmentId ? ' · ' + t('or.fromBooking') : ''}</MRow>
                <MRow label={t('or.colMethod')}>{o.tenders.map((tn) => ML[tn.method] ?? tn.method).join(', ') || '—'}</MRow>
                <MActions>
                  <button onClick={() => reprint(o)} style={tiny}>{t('or.reprint')}</button>
                  {canVoid && o.status === 'PAID' && <button onClick={() => voidOrder(o.id)} style={ui.dangerBtn}>{t('or.void')}</button>}
                  {canVoid && <button onClick={() => removeOrder(o)} style={{ ...ui.dangerBtn, opacity: 0.75 }}>{t('or.delete')}</button>}
                </MActions>
              </MCard>
            ))}
          </MList>
          <Pager paged={pg} />
        </>
      ) : (
        <div>
          {canVoid && <BulkBar count={bulk.count} ids={bulk.sel} onClear={bulk.clear} onDelete={(ids) => runBulkDelete(ids, (id) => apiFetch(`/pos/orders/${id}`, { method: 'DELETE', token }), load)} />}
          <div style={{ border: '1px solid var(--c334155)', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead><tr style={{ background: 'var(--c1e293b)' }}>
              <th style={{ ...ui.th, width: 34 }}><BulkAllBox on={bulk.allOn} onChange={bulk.toggleAll} /></th>
              <th style={ui.th}>#</th><th style={ui.th}>{t('or.colDate')}</th><th style={ui.th}>{t('or.colItems')}</th>
              <th style={ui.th}>{t('or.colTotal')}</th><th style={ui.th}>{t('or.colMethod')}</th><th style={ui.th}>{t('or.colStatus')}</th><th style={ui.th}>{t('or.colActions')}</th>
            </tr></thead>
            <tbody>
              {visible.length === 0 && <tr><td style={ui.td} colSpan={8}>{t('or.empty')}</td></tr>}
              {pg.paged.map((o) => (
                <Fragment key={o.id}>
                  <tr style={{ borderTop: '1px solid var(--c334155)', cursor: 'pointer', background: bulk.has(o.id) ? 'var(--c1e1b4b)' : undefined }} onClick={() => setOpenId(openId === o.id ? null : o.id)}>
                    <td style={{ ...ui.td, width: 34 }} onClick={(e) => e.stopPropagation()}><BulkRowBox on={bulk.has(o.id)} onChange={() => bulk.toggle(o.id)} /></td>
                    <td style={ui.td}>#{o.orderNumber}</td>
                    <td style={{ ...ui.td, color: 'var(--c94a3b8)' }}>{fmtInTz(o.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</td>
                    <td style={{ ...ui.td, color: 'var(--ccbd5e1)' }}>{o.items.length} {t('or.itemsWord')}{o.appointmentId ? <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--c818cf8)' }}>{t('or.fromBooking')}</span> : null}</td>
                    <td style={ui.td}>{formatPrice(o.totalCents, o.currency)}</td>
                    <td style={{ ...ui.td, color: 'var(--c94a3b8)' }}>{o.tenders.map((tn) => ML[tn.method] ?? tn.method).join(', ') || '—'}</td>
                    <td style={ui.td}><span style={{ color: STATUS_COLORS[o.status], border: `1px solid ${STATUS_COLORS[o.status]}`, borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>{o.status}</span></td>
                    <td style={ui.td}>
                      <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => reprint(o)} style={tiny}>{t('or.reprint')}</button>
                        {canVoid && o.status === 'PAID' && <button onClick={() => voidOrder(o.id)} style={ui.dangerBtn}>{t('or.void')}</button>}
                        {canVoid && <button onClick={() => removeOrder(o)} style={{ ...ui.dangerBtn, opacity: 0.75 }} title={t('or.deleteTitle')}>{t('or.delete')}</button>}
                      </div>
                    </td>
                  </tr>
                  {openId === o.id && (
                    <tr><td colSpan={8} style={{ padding: 16, background: 'var(--c0f172a)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 520 }}>
                        {o.items.map((l) => (
                          <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, borderBottom: '1px solid var(--c1f2937)', paddingBottom: 4 }}>
                            <span>{l.quantity}× {l.name}<span style={{ color: 'var(--c64748b)' }}> · {staffName(l.staffMemberId)}</span>{l.tipCents ? <span style={{ color: '#a855f7' }}> · {t('or.tip')} {formatPrice(l.tipCents, o.currency)}</span> : null}</span>
                            <span>{formatPrice(l.lineTotalCents, o.currency)}</span>
                          </div>
                        ))}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--c94a3b8)' }}><span>{t('or.subtotal')}</span><span>{formatPrice(o.subtotalCents, o.currency)}</span></div>
                        {o.discountCents > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--c94a3b8)' }}><span>{t('or.discount')}</span><span>-{formatPrice(o.discountCents, o.currency)}</span></div>}
                        {o.taxCents > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--c94a3b8)' }}><span>{t('or.tax')}</span><span>{formatPrice(o.taxCents, o.currency)}</span></div>}
                        {o.tipCents > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--c94a3b8)' }}><span>{t('or.tips')}</span><span>{formatPrice(o.tipCents, o.currency)}</span></div>}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}><span>{t('or.total')}</span><span style={{ color: 'var(--ink-good)' }}>{formatPrice(o.totalCents, o.currency)}</span></div>
                        {o.changeCents > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--c94a3b8)' }}><span>{t('or.change')}</span><span>{formatPrice(o.changeCents, o.currency)}</span></div>}
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '0 14px 12px' }}><Pager paged={pg} /></div>
          </div>
        </div>
      )}
    </section>
  );
}

const tiny: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 8, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 13, cursor: 'pointer',
};
