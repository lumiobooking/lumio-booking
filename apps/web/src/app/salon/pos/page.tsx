'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';

interface Service { id: string; name: string; priceCents: number; discountPercent?: number; durationMinutes: number; isActive: boolean }
interface Product { id: string; name: string; priceCents: number; discountPercent?: number; isActive: boolean; trackStock: boolean; stockQty: number }
interface Addon { id: string; name: string; priceCents: number; durationMinutes: number; serviceId: string; service: { name: string } | null }
interface Staff { id: string; firstName: string; lastName: string | null; isActive: boolean }

interface Line {
  uid: string;
  kind: 'SERVICE' | 'PRODUCT';
  refId: string;
  isAddon?: boolean; // a service extra (kind SERVICE, but not a standalone service row)
  name: string;
  origUnitPriceCents: number; // list price before any discount
  unitPriceCents: number; // net price actually charged
  discountPercent: number; // promo % off (0 = none)
  quantity: number;
  tipCents: number;
  staffMemberId: string;
}

let uidSeq = 1;

export default function PosPage() {
  return (
    <SalonShell>
      <Suspense fallback={<p style={{ color: '#94a3b8' }}>Loading register…</p>}>
        <Register />
      </Suspense>
    </SalonShell>
  );
}

function Register() {
  const { token } = useAuth();
  const params = useSearchParams();
  // When opened from a booking's "Checkout" button these are pre-filled.
  const [appointmentId] = useState<string | null>(() => params.get('appointmentId'));
  const [customerId] = useState<string | null>(() => params.get('customerId'));
  const [bookingCustomer] = useState<string | null>(() => params.get('customer'));
  const [prefilled, setPrefilled] = useState(false);
  const [services, setServices] = useState<Service[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [taxRate, setTaxRate] = useState(0);
  const [currency, setCurrency] = useState('USD');
  const [transferInfo, setTransferInfo] = useState('');
  const [transferQr, setTransferQr] = useState('');
  const [tab, setTab] = useState<'SERVICE' | 'ADDON' | 'PRODUCT'>('SERVICE');
  const [cart, setCart] = useState<Line[]>([]);
  const [orderDiscount, setOrderDiscount] = useState('');
  const [payMethod, setPayMethod] = useState<'CASH' | 'CARD' | 'TRANSFER'>('CASH');
  const [tendered, setTendered] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [s, p, a, st, settings] = await Promise.all([
        apiFetch<Service[]>('/services', { token }),
        apiFetch<Product[]>('/pos/products', { token }),
        apiFetch<Addon[]>('/services/addons/all', { token }),
        apiFetch<Staff[]>('/staff', { token }),
        apiFetch<{ pos?: { taxRatePercent?: number; transferInstructions?: string; transferQrUrl?: string }; booking?: { currency?: string } }>('/settings', { token }),
      ]);
      setServices(s.filter((x) => x.isActive));
      setProducts(p.filter((x) => x.isActive));
      setAddons(a);
      setStaff(st.filter((x) => x.isActive));
      setTaxRate(settings.pos?.taxRatePercent ?? 0);
      setTransferInfo(settings.pos?.transferInstructions ?? '');
      setTransferQr(settings.pos?.transferQrUrl ?? '');
      setCurrency(settings.booking?.currency ?? 'USD');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load POS data');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Pre-fill the ticket from a booking checkout (?serviceId=&staffId=).
  useEffect(() => {
    if (prefilled || services.length === 0) return;
    const sid = params.get('serviceId');
    const stid = params.get('staffId') || '';
    if (sid) {
      const s = services.find((x) => x.id === sid);
      if (s) {
        const d = s.discountPercent ?? 0;
        const unit = d > 0 ? Math.round((s.priceCents * (100 - d)) / 100) : s.priceCents;
        setCart((c) =>
          c.length === 0
            ? [{ uid: `u${uidSeq++}`, kind: 'SERVICE', refId: s.id, name: s.name, origUnitPriceCents: s.priceCents, unitPriceCents: unit, discountPercent: d, quantity: 1, tipCents: 0, staffMemberId: stid }]
            : c,
        );
      }
    }
    setPrefilled(true);
  }, [services, prefilled, params]);

  const net = (priceCents: number, discountPercent?: number) =>
    discountPercent && discountPercent > 0
      ? Math.round((priceCents * (100 - discountPercent)) / 100)
      : priceCents;

  function addService(s: Service) {
    const d = s.discountPercent ?? 0;
    setCart((c) => [...c, { uid: `u${uidSeq++}`, kind: 'SERVICE', refId: s.id, name: s.name, origUnitPriceCents: s.priceCents, unitPriceCents: net(s.priceCents, d), discountPercent: d, quantity: 1, tipCents: 0, staffMemberId: '' }]);
  }
  function addAddon(a: Addon) {
    setCart((c) => [...c, { uid: `u${uidSeq++}`, kind: 'SERVICE', refId: a.id, isAddon: true, name: a.name, origUnitPriceCents: a.priceCents, unitPriceCents: a.priceCents, discountPercent: 0, quantity: 1, tipCents: 0, staffMemberId: '' }]);
  }
  function addProduct(p: Product) {
    const d = p.discountPercent ?? 0;
    setCart((c) => {
      const existing = c.find((l) => l.kind === 'PRODUCT' && l.refId === p.id);
      if (existing) return c.map((l) => (l.uid === existing.uid ? { ...l, quantity: l.quantity + 1 } : l));
      return [...c, { uid: `u${uidSeq++}`, kind: 'PRODUCT', refId: p.id, name: p.name, origUnitPriceCents: p.priceCents, unitPriceCents: net(p.priceCents, d), discountPercent: d, quantity: 1, tipCents: 0, staffMemberId: '' }];
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
    // Savings from per-item promo discounts (list price vs net price).
    const itemSavings = cart.reduce((s, l) => s + (l.origUnitPriceCents - l.unitPriceCents) * l.quantity, 0);
    const productBase = cart.filter((l) => l.kind === 'PRODUCT').reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
    const discount = Math.min(Math.round((parseFloat(orderDiscount) || 0) * 100), subtotal);
    const tax = Math.round((productBase * taxRate) / 100);
    const tip = cart.reduce((s, l) => s + l.tipCents, 0);
    const total = Math.max(0, subtotal - discount + tax + tip);
    const savings = itemSavings + discount;
    const tenderedCents = Math.round((parseFloat(tendered) || 0) * 100);
    const change = payMethod === 'CASH' ? Math.max(0, tenderedCents - total) : 0;
    return { subtotal, itemSavings, discount, tax, tip, total, savings, tenderedCents, change };
  }, [cart, orderDiscount, taxRate, tendered, payMethod]);

  const staffName = (id: string) => {
    const s = staff.find((x) => x.id === id);
    return s ? `${s.firstName} ${s.lastName ?? ''}`.trim() : 'Unassigned';
  };

  async function pay() {
    if (cart.length === 0) { setError('Add at least one item.'); return; }
    // Cash needs the amount received; Card & Transfer are paid in full at the terminal/bank.
    const tenderCents = payMethod === 'CASH' ? money.tenderedCents : money.total;
    if (payMethod === 'CASH' && tenderCents < money.total) {
      setError('Cash received is less than the total due. Enter the amount the customer handed over (or tap “Exact”).');
      return;
    }
    const apiMethod = payMethod === 'CASH' ? 'CASH' : payMethod === 'CARD' ? 'CARD' : 'OTHER';
    setSubmitting(true); setError(null); setOkMsg(null);
    try {
      const order = await apiFetch<{ orderNumber: number }>('/pos/orders', {
        method: 'POST', token,
        body: {
          appointmentId: appointmentId || undefined,
          customerId: customerId || undefined,
          discountCents: money.discount,
          items: cart.map((l) => ({
            kind: l.kind,
            serviceId: l.kind === 'SERVICE' && !l.isAddon ? l.refId : undefined,
            productId: l.kind === 'PRODUCT' ? l.refId : undefined,
            name: l.name,
            unitPriceCents: l.unitPriceCents,
            quantity: l.quantity,
            tipCents: l.tipCents,
            staffMemberId: l.staffMemberId || undefined,
          })),
          tenders: [{ method: apiMethod, amountCents: tenderCents }],
        },
      });
      printReceipt(order.orderNumber);
      setOkMsg(`Paid ✓ Order #${order.orderNumber} — receipt sent to printer.`);
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
        const disc = l.discountPercent > 0
          ? `<div style="font-size:11px;color:#777"><s>${formatPrice(l.origUnitPriceCents * l.quantity, currency)}</s> &nbsp;-${l.discountPercent}%</div>`
          : '';
        const addon = l.isAddon ? `<span style="font-size:10px;color:#777"> (add-on)</span>` : '';
        return `<tr><td>${l.quantity}× ${escapeHtml(l.name)}${addon}${disc}${tech}${tip}</td><td style="text-align:right;vertical-align:top">${lt}</td></tr>`;
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
        ${money.discount ? line('Order discount', '-' + formatPrice(money.discount, currency)) : ''}
        ${money.tax ? line('Tax', formatPrice(money.tax, currency)) : ''}
        ${money.tip ? line('Tip', formatPrice(money.tip, currency)) : ''}
        ${money.savings ? line('You saved', '-' + formatPrice(money.savings, currency)) : ''}
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

      {appointmentId && (
        <div style={{ background: '#1e293b', border: '1px solid #4f46e5', color: '#c7d2fe', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>
          🧾 Checking out a booking{bookingCustomer ? ` for ${bookingCustomer}` : ''} — the booking will be marked Completed after payment.
        </div>
      )}
      {!appointmentId && customerId && bookingCustomer && (
        <div style={{ background: '#1e293b', border: '1px solid #4f46e5', color: '#c7d2fe', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>
          🛒 New sale for <strong>{bookingCustomer}</strong> — this sale will be linked to their profile.
        </div>
      )}
      {error && <div style={ui.banner}>{error}</div>}
      {okMsg && <div style={{ background: '#14532d', color: '#bbf7d0', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>{okMsg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        {/* Catalog */}
        <div style={{ ...ui.card }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            <button onClick={() => setTab('SERVICE')} style={tabBtn(tab === 'SERVICE')}>Services</button>
            <button onClick={() => setTab('ADDON')} style={tabBtn(tab === 'ADDON')}>Add-ons</button>
            <button onClick={() => setTab('PRODUCT')} style={tabBtn(tab === 'PRODUCT')}>Products</button>
          </div>

          {/* Services */}
          {tab === 'SERVICE' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
              {services.map((s) => (
                <button key={s.id} onClick={() => addService(s)} style={catBtn}>
                  <span style={{ fontWeight: 600 }}>{s.name}</span>
                  <CatPrice priceCents={s.priceCents} discountPercent={s.discountPercent} currency={currency} />
                </button>
              ))}
              {services.length === 0 && <p style={{ color: '#94a3b8', fontSize: 13 }}>No active services.</p>}
            </div>
          )}

          {/* Add-ons, grouped by parent service */}
          {tab === 'ADDON' && (
            addons.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: 13 }}>No add-ons yet. Create them under a service in <a href="/salon/services" style={{ color: '#818cf8' }}>Services</a>.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {groupAddons(addons).map((grp) => (
                  <div key={grp.service}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 }}>
                      {grp.service}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
                      {grp.items.map((a) => (
                        <button key={a.id} onClick={() => addAddon(a)} style={{ ...catBtn, borderStyle: 'dashed' }}>
                          <span style={{ fontWeight: 600 }}>+ {a.name}</span>
                          <span style={{ color: '#22c55e' }}>{formatPrice(a.priceCents, currency)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* Products */}
          {tab === 'PRODUCT' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
              {products.map((p) => (
                <button key={p.id} onClick={() => addProduct(p)} style={catBtn}>
                  <span style={{ fontWeight: 600 }}>{p.name}</span>
                  <CatPrice priceCents={p.priceCents} discountPercent={p.discountPercent} currency={currency} />
                  {p.trackStock && <span style={{ fontSize: 11, color: p.stockQty > 0 ? '#94a3b8' : '#ef4444' }}>Stock: {p.stockQty}</span>}
                </button>
              ))}
              {products.length === 0 && <p style={{ color: '#94a3b8', fontSize: 13 }}>No products yet. <a href="/salon/products" style={{ color: '#818cf8' }}>Add some →</a></p>}
            </div>
          )}
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
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {l.isAddon && <span style={{ fontSize: 10, fontWeight: 700, color: '#818cf8', border: '1px solid #4f46e5', borderRadius: 5, padding: '1px 5px', marginRight: 6 }}>ADD-ON</span>}
                      {l.name}
                    </div>
                    <button onClick={() => removeLine(l.uid)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16 }}>×</button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button onClick={() => updateLine(l.uid, { quantity: Math.max(1, l.quantity - 1) })} style={qtyBtn}>−</button>
                      <span style={{ minWidth: 20, textAlign: 'center' }}>{l.quantity}</span>
                      <button onClick={() => updateLine(l.uid, { quantity: l.quantity + 1 })} style={qtyBtn}>+</button>
                    </div>
                    <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                      {l.discountPercent > 0 ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
                          <span style={{ textDecoration: 'line-through', color: '#64748b', fontSize: 12 }}>{formatPrice(l.origUnitPriceCents * l.quantity, currency)}</span>
                          <span style={{ background: '#ef4444', color: '#fff', borderRadius: 5, padding: '0 5px', fontSize: 10, fontWeight: 700 }}>-{l.discountPercent}%</span>
                          <span style={{ color: '#22c55e', fontWeight: 600 }}>{formatPrice(l.unitPriceCents * l.quantity, currency)}</span>
                        </div>
                      ) : (
                        <span style={{ color: '#cbd5e1' }}>{formatPrice(l.unitPriceCents * l.quantity, currency)}</span>
                      )}
                    </div>
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
            {money.savings > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#22c55e', fontWeight: 600 }}>
                <span>You saved</span><span>−{formatPrice(money.savings, currency)}</span>
              </div>
            )}
            <div style={{ borderTop: '1px solid #334155', paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 700 }}>
              <span>Total</span><span style={{ color: '#22c55e' }}>{formatPrice(money.total, currency)}</span>
            </div>
          </div>

          {/* Payment method */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button onClick={() => setPayMethod('CASH')} style={tabBtn(payMethod === 'CASH')}>💵 Cash</button>
            <button onClick={() => setPayMethod('CARD')} style={tabBtn(payMethod === 'CARD')}>💳 Card</button>
            <button onClick={() => setPayMethod('TRANSFER')} style={tabBtn(payMethod === 'TRANSFER')}>🏦 Transfer</button>
          </div>

          {payMethod === 'CASH' && (
            <>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                <button onClick={() => setTendered((money.total / 100).toFixed(2))} style={chip}>Exact</button>
                {quickCash(money.total).map((amt) => (
                  <button key={amt} onClick={() => setTendered((amt / 100).toFixed(2))} style={chip}>{formatPrice(amt, currency)}</button>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ color: '#94a3b8' }}>Cash received $</span>
                <input type="number" min={0} step="0.01" value={tendered} onChange={(e) => setTendered(e.target.value)} style={{ ...ui.input, width: 120, padding: '6px 8px', textAlign: 'right' }} />
              </div>
              {money.tenderedCents > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontWeight: 600 }}>
                  <span>Change</span><span style={{ color: money.change >= 0 ? '#22c55e' : '#ef4444' }}>{formatPrice(money.change, currency)}</span>
                </div>
              )}
            </>
          )}
          {payMethod === 'CARD' && (
            <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 10 }}>Charge {formatPrice(money.total, currency)} on the card reader, then press Pay &amp; Print to record &amp; print.</p>
          )}
          {payMethod === 'TRANSFER' && (
            <div style={{ marginBottom: 10 }}>
              {transferInfo || transferQr ? (
                <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Show this to the customer to transfer {formatPrice(money.total, currency)}:</div>
                  {transferInfo && <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, color: '#e2e8f0', margin: 0 }}>{transferInfo}</pre>}
                  {transferQr && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={transferQr} alt="Transfer QR" style={{ width: 140, height: 140, objectFit: 'contain', marginTop: 10, background: '#fff', borderRadius: 8, padding: 4 }} />
                  )}
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>After the money arrives, press Pay &amp; Print.</div>
                </div>
              ) : (
                <p style={{ color: '#94a3b8', fontSize: 13 }}>
                  No transfer details set. Add them in <a href="/salon/settings" style={{ color: '#818cf8' }}>Settings → Payments → Bank transfer</a>. Confirm receipt then press Pay &amp; Print.
                </p>
              )}
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

function CatPrice({ priceCents, discountPercent, currency }: { priceCents: number; discountPercent?: number; currency: string }) {
  const d = discountPercent ?? 0;
  if (d <= 0) return <span style={{ color: '#22c55e' }}>{formatPrice(priceCents, currency)}</span>;
  const netP = Math.round((priceCents * (100 - d)) / 100);
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
      <span style={{ textDecoration: 'line-through', color: '#64748b', fontSize: 11 }}>{formatPrice(priceCents, currency)}</span>
      <span style={{ color: '#22c55e', fontWeight: 600 }}>{formatPrice(netP, currency)}</span>
      <span style={{ background: '#ef4444', color: '#fff', borderRadius: 4, padding: '0 4px', fontSize: 10, fontWeight: 700 }}>-{d}%</span>
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: '#94a3b8' }}>{label}</span><span>{value}</span>
    </div>
  );
}

// Suggested cash denominations >= total (next round $5/$10/$20/$50/$100).
function quickCash(totalCents: number): number[] {
  if (totalCents <= 0) return [];
  const steps = [500, 1000, 2000, 5000, 10000];
  const out: number[] = [];
  for (const s of steps) {
    const up = Math.ceil(totalCents / s) * s;
    if (up > totalCents && !out.includes(up)) out.push(up);
    if (out.length >= 3) break;
  }
  return out;
}

function groupAddons(addons: Addon[]): { service: string; items: Addon[] }[] {
  const map = new Map<string, Addon[]>();
  for (const a of addons) {
    const key = a.service?.name ?? 'Other';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(a);
  }
  return [...map.entries()].map(([service, items]) => ({ service, items }));
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
const chip: React.CSSProperties = {
  padding: '5px 10px', borderRadius: 999, border: '1px solid #475569', background: '#0f172a', color: '#cbd5e1', fontSize: 12, cursor: 'pointer',
};
const ghost: React.CSSProperties = {
  padding: '10px 14px', borderRadius: 8, border: '1px solid #475569', background: 'transparent', color: '#e2e8f0', fontSize: 14, cursor: 'pointer',
};
