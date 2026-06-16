'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';

interface Service { id: string; name: string; priceCents: number; discountPercent?: number; durationMinutes: number; isActive: boolean }
interface Product { id: string; name: string; priceCents: number; isActive: boolean; trackStock: boolean; stockQty: number }
interface Staff { id: string; firstName: string; lastName: string | null; isActive: boolean }

interface Line {
  uid: string;
  kind: 'SERVICE' | 'PRODUCT';
  refId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  tipCents: number;
  staffMemberId: string;
}

let uidSeq = 1;

export default function PosPage() {
  return (
    <SalonShell>
      <Register />
    </SalonShell>
  );
}

function Register() {
  const { token } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [taxRate, setTaxRate] = useState(0);
  const [currency, setCurrency] = useState('USD');
  const [tab, setTab] = useState<'SERVICE' | 'PRODUCT'>('SERVICE');
  const [cart, setCart] = useState<Line[]>([]);
  const [orderDiscount, setOrderDiscount] = useState('');
  const [payMethod, setPayMethod] = useState<'CASH' | 'CARD'>('CASH');
  const [tendered, setTendered] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [s, p, st, settings] = await Promise.all([
        apiFetch<Service[]>('/services', { token }),
        apiFetch<Product[]>('/pos/products', { token }),
        apiFetch<Staff[]>('/staff', { token }),
        apiFetch<{ pos?: { taxRatePercent?: number }; booking?: { currency?: string } }>('/settings', { token }),
      ]);
      setServices(s.filter((x) => x.isActive));
      setProducts(p.filter((x) => x.isActive));
      setStaff(st.filter((x) => x.isActive));
      setTaxRate(settings.pos?.taxRatePercent ?? 0);
      setCurrency(settings.booking?.currency ?? 'USD');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load POS data');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const svcNet = (s: Service) =>
    s.discountPercent && s.discountPercent > 0
      ? Math.round((s.priceCents * (100 - s.discountPercent)) / 100)
      : s.priceCents;

  function addService(s: Service) {
    setCart((c) => [...c, { uid: `u${uidSeq++}`, kind: 'SERVICE', refId: s.id, name: s.name, unitPriceCents: svcNet(s), quantity: 1, tipCents: 0, staffMemberId: '' }]);
  }
  function addProduct(p: Product) {
    setCart((c) => {
      const existing = c.find((l) => l.kind === 'PRODUCT' && l.refId === p.id);
      if (existing) return c.map((l) => (l.uid === existing.uid ? { ...l, quantity: l.quantity + 1 } : l));
      return [...c, { uid: `u${uidSeq++}`, kind: 'PRODUCT', refId: p.id, name: p.name, unitPriceCents: p.priceCents, quantity: 1, tipCents: 0, staffMemberId: '' }];
    });
  }
  function updateLine(uid: string, patch: Partial<Line>) {
    setCart((c) => c.map((l) => (l.uid === uid ? { ...l, ...patch } : l)));
  }
  function removeLine(uid: string) {
    setCart((c) => c.filter((l) => l.uid !== uid));
  }
  function clearCart() {
    setCart([]); setOrderDiscount(''); setTendered(''); setError(null);
  }

  const money = useMemo(() => {
    const subtotal = cart.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
    const productBase = cart.filter((l) => l.kind === 'PRODUCT').reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
    const discount = Math.min(Math.round((parseFloat(orderDiscount) || 0) * 100), subtotal);
    const tax = Math.round((productBase * taxRate) / 100);
    const tip = cart.reduce((s, l) => s + l.tipCents, 0);
    const total = Math.max(0, subtotal - discount + tax + tip);
    const tenderedCents = Math.round((parseFloat(tendered) || 0) * 100);
    const change = payMethod === 'CASH' ? Math.max(0, tenderedCents - total) : 0;
    return { subtotal, discount, tax, tip, total, tenderedCents, change };
  }, [cart, orderDiscount, taxRate, tendered, payMethod]);

  const staffName = (id: string) => {
    const s = staff.find((x) => x.id === id);
    return s ? `${s.firstName} ${s.lastName ?? ''}`.trim() : 'Unassigned';
  };

  async function pay() {
    if (cart.length === 0) { setError('Add at least one item.'); return; }
    const tenderCents = payMethod === 'CASH' ? money.tenderedCents : money.total;
    if (tenderCents < money.total) { setError('Tendered amount is less than the total due.'); return; }
    setSubmitting(true); setError(null);
    try {
      const order = await apiFetch<{ orderNumber: number }>('/pos/orders', {
        method: 'POST', token,
        body: {
          discountCents: money.discount,
          items: cart.map((l) => ({
            kind: l.kind,
            serviceId: l.kind === 'SERVICE' ? l.refId : undefined,
            productId: l.kind === 'PRODUCT' ? l.refId : undefined,
            name: l.name,
            unitPriceCents: l.unitPriceCents,
            quantity: l.quantity,
            tipCents: l.tipCents,
            staffMemberId: l.staffMemberId || undefined,
          })),
          tenders: [{ method: payMethod, amountCents: tenderCents }],
        },
      });
      printReceipt(order.orderNumber);
      clearCart();
      load(); // refresh stock
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setSubmitting(false);
    }
  }

  function printReceipt(orderNumber: number) {
    const rows = cart
      .map((l) => {
        const lt = formatPrice(l.unitPriceCents * l.quantity, currency);
        const tech = l.staffMemberId ? `<div style="font-size:11px;color:#555">${staffName(l.staffMemberId)}</div>` : '';
        const tip = l.tipCents ? `<div style="font-size:11px;color:#555">Tip: ${formatPrice(l.tipCents, currency)}</div>` : '';
        return `<tr><td>${l.quantity}× ${escapeHtml(l.name)}${tech}${tip}</td><td style="text-align:right">${lt}</td></tr>`;
      })
      .join('');
    const line = (label: string, val: string, bold = false) =>
      `<tr><td style="${bold ? 'font-weight:700' : ''}">${label}</td><td style="text-align:right;${bold ? 'font-weight:700' : ''}">${val}</td></tr>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Receipt #${orderNumber}</title>
      <style>body{font-family:ui-monospace,Menlo,monospace;width:300px;margin:0 auto;padding:12px;color:#000}
      h2{text-align:center;margin:4px 0}table{width:100%;border-collapse:collapse;font-size:13px}
      td{padding:2px 0;vertical-align:top}hr{border:none;border-top:1px dashed #999;margin:8px 0}
      .center{text-align:center;font-size:12px;color:#333}</style></head><body>
      <h2>Receipt</h2>
      <div class="center">Order #${orderNumber} · ${new Date().toLocaleString()}</div><hr>
      <table>${rows}</table><hr>
      <table>
        ${line('Subtotal', formatPrice(money.subtotal, currency))}
        ${money.discount ? line('Discount', '-' + formatPrice(money.discount, currency)) : ''}
        ${money.tax ? line('Tax', formatPrice(money.tax, currency)) : ''}
        ${money.tip ? line('Tip', formatPrice(money.tip, currency)) : ''}
        ${line('TOTAL', formatPrice(money.total, currency), true)}
        ${line('Paid (' + payMethod + ')', formatPrice(money.tenderedCents || money.total, currency))}
        ${money.change ? line('Change', formatPrice(money.change, currency)) : ''}
      </table><hr>
      <div class="center">Thank you!</div>
      <script>window.onload=function(){window.print();}</script>
      </body></html>`;
    const w = window.open('', '_blank', 'width=360,height=640');
    if (w) { w.document.write(html); w.document.close(); }
  }

  if (loading) return <p style={{ color: '#94a3b8' }}>Loading register…</p>;

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Point of Sale</h1>
        <a href="/salon/products" style={{ ...ghost, textDecoration: 'none' }}>Manage products</a>
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        {/* Catalog */}
        <div style={{ ...ui.card }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            <button onClick={() => setTab('SERVICE')} style={tabBtn(tab === 'SERVICE')}>Services</button>
            <button onClick={() => setTab('PRODUCT')} style={tabBtn(tab === 'PRODUCT')}>Products</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
            {tab === 'SERVICE' && services.map((s) => (
              <button key={s.id} onClick={() => addService(s)} style={catBtn}>
                <span style={{ fontWeight: 600 }}>{s.name}</span>
                <span style={{ color: '#22c55e' }}>{formatPrice(svcNet(s), currency)}</span>
              </button>
            ))}
            {tab === 'SERVICE' && services.length === 0 && <p style={{ color: '#94a3b8', fontSize: 13 }}>No active services.</p>}
            {tab === 'PRODUCT' && products.map((p) => (
              <button key={p.id} onClick={() => addProduct(p)} style={catBtn}>
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                <span style={{ color: '#22c55e' }}>{formatPrice(p.priceCents, currency)}</span>
                {p.trackStock && <span style={{ fontSize: 11, color: p.stockQty > 0 ? '#94a3b8' : '#ef4444' }}>Stock: {p.stockQty}</span>}
              </button>
            ))}
            {tab === 'PRODUCT' && products.length === 0 && <p style={{ color: '#94a3b8', fontSize: 13 }}>No products yet. <a href="/salon/products" style={{ color: '#818cf8' }}>Add some →</a></p>}
          </div>
        </div>

        {/* Ticket */}
        <div style={{ ...ui.card, position: 'sticky', top: 12 }}>
          <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>Current ticket</h2>
          {cart.length === 0 ? (
            <p style={{ color: '#94a3b8', fontSize: 14 }}>Tap a service or product to add it.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
              {cart.map((l) => (
                <div key={l.uid} style={{ borderBottom: '1px solid #334155', paddingBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{l.name}</div>
                    <button onClick={() => removeLine(l.uid)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16 }}>×</button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button onClick={() => updateLine(l.uid, { quantity: Math.max(1, l.quantity - 1) })} style={qtyBtn}>−</button>
                      <span style={{ minWidth: 20, textAlign: 'center' }}>{l.quantity}</span>
                      <button onClick={() => updateLine(l.uid, { quantity: l.quantity + 1 })} style={qtyBtn}>+</button>
                    </div>
                    <span style={{ marginLeft: 'auto', color: '#cbd5e1' }}>{formatPrice(l.unitPriceCents * l.quantity, currency)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    <select value={l.staffMemberId} onChange={(e) => updateLine(l.uid, { staffMemberId: e.target.value })} style={{ ...ui.input, padding: '5px 8px', fontSize: 13, flex: 1, minWidth: 120 }}>
                      <option value="">Technician…</option>
                      {staff.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName ?? ''}</option>)}
                    </select>
                    <input
                      type="number" min={0} step="0.01" placeholder="Tip $"
                      value={l.tipCents ? (l.tipCents / 100).toString() : ''}
                      onChange={(e) => updateLine(l.uid, { tipCents: Math.max(0, Math.round((parseFloat(e.target.value) || 0) * 100)) })}
                      style={{ ...ui.input, padding: '5px 8px', fontSize: 13, width: 80 }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Totals */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, marginBottom: 12 }}>
            <Row label="Subtotal" value={formatPrice(money.subtotal, currency)} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#94a3b8' }}>Discount $</span>
              <input type="number" min={0} step="0.01" value={orderDiscount} onChange={(e) => setOrderDiscount(e.target.value)} style={{ ...ui.input, width: 100, padding: '5px 8px', textAlign: 'right' }} />
            </div>
            {money.tax > 0 && <Row label={`Tax (${taxRate}% retail)`} value={formatPrice(money.tax, currency)} />}
            {money.tip > 0 && <Row label="Tips" value={formatPrice(money.tip, currency)} />}
            <div style={{ borderTop: '1px solid #334155', paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 700 }}>
              <span>Total</span><span style={{ color: '#22c55e' }}>{formatPrice(money.total, currency)}</span>
            </div>
          </div>

          {/* Payment */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button onClick={() => setPayMethod('CASH')} style={tabBtn(payMethod === 'CASH')}>Cash</button>
            <button onClick={() => setPayMethod('CARD')} style={tabBtn(payMethod === 'CARD')}>Card</button>
          </div>
          {payMethod === 'CASH' && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: '#94a3b8' }}>Cash received $</span>
              <input type="number" min={0} step="0.01" value={tendered} onChange={(e) => setTendered(e.target.value)} style={{ ...ui.input, width: 120, padding: '6px 8px', textAlign: 'right' }} />
            </div>
          )}
          {payMethod === 'CASH' && money.tenderedCents > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontWeight: 600 }}>
              <span>Change</span><span>{formatPrice(money.change, currency)}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={clearCart} disabled={cart.length === 0} style={{ ...ghost, flex: 1 }}>Clear</button>
            <button onClick={pay} disabled={submitting || cart.length === 0} style={{ ...ui.primaryBtn, flex: 2, padding: '12px', fontSize: 15 }}>
              {submitting ? 'Processing…' : `Pay & Print · ${formatPrice(money.total, currency)}`}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: '#94a3b8' }}>{label}</span><span>{value}</span>
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

const tabBtn = (active: boolean): React.CSSProperties => ({
  flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid ' + (active ? '#6366f1' : '#334155'),
  background: active ? '#6366f1' : 'transparent', color: active ? '#fff' : '#cbd5e1', fontSize: 14, fontWeight: 600, cursor: 'pointer',
});
const catBtn: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start', textAlign: 'left',
  padding: '12px', borderRadius: 10, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', cursor: 'pointer', fontSize: 13,
};
const qtyBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6, border: '1px solid #475569', background: 'transparent', color: '#e2e8f0', cursor: 'pointer', fontSize: 16,
};
const ghost: React.CSSProperties = {
  padding: '10px 14px', borderRadius: 8, border: '1px solid #475569', background: 'transparent', color: '#e2e8f0', fontSize: 14, cursor: 'pointer',
};
