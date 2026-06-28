'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { useLiveRefresh } from '../../../lib/useLiveRefresh';
import { DateRangeBar, SearchBox, matchesQuery, useDateRange, sortNewest, usePaged, Pager } from '../../../components/ListFilter';

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

const STATUS_COLORS: Record<string, string> = { PAID: '#22c55e', OPEN: '#eab308', VOID: '#94a3b8', REFUNDED: '#f97316' };
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
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const ML: Record<string, string> = { CASH: t('or.mCash'), CARD: t('or.mCard'), OTHER: t('or.mTransfer') };
  const range = useDateRange('all');
  const [orders, setOrders] = useState<Order[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

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

  function reprint(o: Order) {
    const line = (label: string, val: string, bold = false) =>
      `<tr><td style="${bold ? 'font-weight:700' : ''}">${label}</td><td style="text-align:right;${bold ? 'font-weight:700' : ''}">${val}</td></tr>`;
    const rows = o.items.map((l) => {
      const tech = l.staffMemberId ? `<div style="font-size:11px;color:#555">${esc(staffName(l.staffMemberId))}</div>` : '';
      const tip = l.tipCents ? `<div style="font-size:11px;color:#555">Tip: ${formatPrice(l.tipCents, o.currency)}</div>` : '';
      return `<tr><td>${l.quantity}× ${esc(l.name)}${tech}${tip}</td><td style="text-align:right;vertical-align:top">${formatPrice(l.lineTotalCents, o.currency)}</td></tr>`;
    }).join('');
    const tenders = o.tenders.map((t) => line(METHOD_LABEL[t.method] ?? t.method, formatPrice(t.amountCents, o.currency))).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Receipt #${o.orderNumber}</title>
      <style>body{font-family:ui-monospace,Menlo,monospace;width:300px;margin:0 auto;padding:12px;color:#000}
      h2{text-align:center;margin:4px 0}table{width:100%;border-collapse:collapse;font-size:13px}td{padding:2px 0;vertical-align:top}
      hr{border:none;border-top:1px dashed #999;margin:8px 0}.center{text-align:center;font-size:12px;color:#333}</style></head><body>
      <h2>Receipt</h2><div class="center">Order #${o.orderNumber} · ${new Date(o.paidAt ?? o.createdAt).toLocaleString('en-US')}${o.status === 'VOID' ? ' · VOID' : ''}</div><hr>
      <table>${rows}</table><hr><table>
      ${line('Subtotal', formatPrice(o.subtotalCents, o.currency))}
      ${o.discountCents ? line('Discount', '-' + formatPrice(o.discountCents, o.currency)) : ''}
      ${o.taxCents ? line('Tax', formatPrice(o.taxCents, o.currency)) : ''}
      ${o.tipCents ? line('Tip', formatPrice(o.tipCents, o.currency)) : ''}
      ${line('TOTAL', formatPrice(o.totalCents, o.currency), true)}
      ${tenders}
      ${o.changeCents ? line('Change', formatPrice(o.changeCents, o.currency)) : ''}
      </table><hr><div class="center">Thank you!</div>
      <script>window.onload=function(){window.print();}</script></body></html>`;
    const w = window.open('', '_blank', 'width=360,height=640');
    if (w) { w.document.write(html); w.document.close(); }
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

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>{t('or.title')}</h1>
          <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: 14 }}>{visible.length} {t('or.ordersWord')} · {formatPrice(paidTotal, 'USD')} {t('or.collected')}</p>
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

      {loading && orders.length === 0 ? <p style={{ color: '#94a3b8' }}>{t('or.loading')}</p> : (
        <div style={{ border: '1px solid #334155', borderRadius: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead><tr style={{ background: '#1e293b' }}>
              <th style={ui.th}>#</th><th style={ui.th}>{t('or.colDate')}</th><th style={ui.th}>{t('or.colItems')}</th>
              <th style={ui.th}>{t('or.colTotal')}</th><th style={ui.th}>{t('or.colMethod')}</th><th style={ui.th}>{t('or.colStatus')}</th><th style={ui.th}>{t('or.colActions')}</th>
            </tr></thead>
            <tbody>
              {visible.length === 0 && <tr><td style={ui.td} colSpan={7}>{t('or.empty')}</td></tr>}
              {pg.paged.map((o) => (
                <Fragment key={o.id}>
                  <tr style={{ borderTop: '1px solid #334155', cursor: 'pointer' }} onClick={() => setOpenId(openId === o.id ? null : o.id)}>
                    <td style={ui.td}>#{o.orderNumber}</td>
                    <td style={{ ...ui.td, color: '#94a3b8' }}>{new Date(o.createdAt).toLocaleString('en-US')}</td>
                    <td style={{ ...ui.td, color: '#cbd5e1' }}>{o.items.length} {t('or.itemsWord')}{o.appointmentId ? <span style={{ marginLeft: 6, fontSize: 11, color: '#818cf8' }}>{t('or.fromBooking')}</span> : null}</td>
                    <td style={ui.td}>{formatPrice(o.totalCents, o.currency)}</td>
                    <td style={{ ...ui.td, color: '#94a3b8' }}>{o.tenders.map((tn) => ML[tn.method] ?? tn.method).join(', ') || '—'}</td>
                    <td style={ui.td}><span style={{ color: STATUS_COLORS[o.status], border: `1px solid ${STATUS_COLORS[o.status]}`, borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>{o.status}</span></td>
                    <td style={ui.td}>
                      <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => reprint(o)} style={tiny}>{t('or.reprint')}</button>
                        {o.status === 'PAID' && <button onClick={() => voidOrder(o.id)} style={ui.dangerBtn}>{t('or.void')}</button>}
                        <button onClick={() => removeOrder(o)} style={{ ...ui.dangerBtn, opacity: 0.75 }} title={t('or.deleteTitle')}>{t('or.delete')}</button>
                      </div>
                    </td>
                  </tr>
                  {openId === o.id && (
                    <tr><td colSpan={7} style={{ padding: 16, background: '#0f172a' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 520 }}>
                        {o.items.map((l) => (
                          <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, borderBottom: '1px solid #1f2937', paddingBottom: 4 }}>
                            <span>{l.quantity}× {l.name}<span style={{ color: '#64748b' }}> · {staffName(l.staffMemberId)}</span>{l.tipCents ? <span style={{ color: '#a855f7' }}> · {t('or.tip')} {formatPrice(l.tipCents, o.currency)}</span> : null}</span>
                            <span>{formatPrice(l.lineTotalCents, o.currency)}</span>
                          </div>
                        ))}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#94a3b8' }}><span>{t('or.subtotal')}</span><span>{formatPrice(o.subtotalCents, o.currency)}</span></div>
                        {o.discountCents > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#94a3b8' }}><span>{t('or.discount')}</span><span>-{formatPrice(o.discountCents, o.currency)}</span></div>}
                        {o.taxCents > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#94a3b8' }}><span>{t('or.tax')}</span><span>{formatPrice(o.taxCents, o.currency)}</span></div>}
                        {o.tipCents > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#94a3b8' }}><span>{t('or.tips')}</span><span>{formatPrice(o.tipCents, o.currency)}</span></div>}
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}><span>{t('or.total')}</span><span style={{ color: '#22c55e' }}>{formatPrice(o.totalCents, o.currency)}</span></div>
                        {o.changeCents > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#94a3b8' }}><span>{t('or.change')}</span><span>{formatPrice(o.changeCents, o.currency)}</span></div>}
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <div style={{ padding: '0 14px 12px' }}><Pager paged={pg} /></div>
        </div>
      )}
    </section>
  );
}

function esc(s: string) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)); }

const tiny: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 8, border: '1px solid #475569', background: 'transparent', color: '#cbd5e1', fontSize: 13, cursor: 'pointer',
};
