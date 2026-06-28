'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';

interface Service { id: string; name: string; priceCents: number; discountPercent?: number; durationMinutes: number; isActive: boolean; category?: { id: string; name: string } | null }
interface Product { id: string; name: string; priceCents: number; discountPercent?: number; isActive: boolean; trackStock: boolean; stockQty: number }
interface Addon { id: string; name: string; priceCents: number; durationMinutes: number; serviceId: string; service: { name: string } | null }
interface Staff { id: string; firstName: string; lastName: string | null; isActive: boolean }
interface CustomerHit { id: string; firstName: string; lastName?: string | null; phone?: string | null; loyaltyPoints?: number }

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
  const { lang } = useLang();
  return (
    <SalonShell>
      <Suspense fallback={<p style={{ color: '#94a3b8' }}>{tr('po.loadingReg', lang)}</p>}>
        <Register />
      </Suspense>
    </SalonShell>
  );
}

function Register() {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const params = useSearchParams();
  // When opened from a booking's "Checkout" button these are pre-filled.
  const [appointmentId] = useState<string | null>(() => params.get('appointmentId'));
  const [walkInId] = useState<string | null>(() => params.get('walkInId'));
  // Attached CRM customer: pre-filled from a booking/walk-in checkout, or picked
  // on the register via the customer box. Drives loyalty earn + redeem.
  const [customerId, setCustomerId] = useState<string | null>(() => params.get('customerId') || null);
  const [customerLabel, setCustomerLabel] = useState<string | null>(() => params.get('customer') || null);
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
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState<string | null>(null); // service category id, null = all
  const [cart, setCart] = useState<Line[]>([]);
  const [orderDiscount, setOrderDiscount] = useState('');
  const [payMethod, setPayMethod] = useState<'CASH' | 'CARD' | 'TRANSFER'>('CASH');
  const [tendered, setTendered] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loyalty, setLoyalty] = useState({ enabled: false, redeemCentsPerPoint: 5, minRedeemPoints: 100 });
  const [customerPoints, setCustomerPoints] = useState(0);
  const [redeemInput, setRedeemInput] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [s, p, a, st, settings] = await Promise.all([
        apiFetch<Service[]>('/services', { token }),
        apiFetch<Product[]>('/pos/products', { token }),
        apiFetch<Addon[]>('/services/addons/all', { token }),
        apiFetch<Staff[]>('/staff', { token }),
        apiFetch<{ pos?: { taxRatePercent?: number; transferInstructions?: string; transferQrUrl?: string }; booking?: { currency?: string }; loyalty?: { enabled: boolean; redeemCentsPerPoint: number; minRedeemPoints: number } }>('/settings', { token }),
      ]);
      setServices(s.filter((x) => x.isActive));
      setProducts(p.filter((x) => x.isActive));
      setAddons(a);
      setStaff(st.filter((x) => x.isActive));
      setTaxRate(settings.pos?.taxRatePercent ?? 0);
      setTransferInfo(settings.pos?.transferInstructions ?? '');
      setTransferQr(settings.pos?.transferQrUrl ?? '');
      setCurrency(settings.booking?.currency ?? 'USD');
      if (settings.loyalty) setLoyalty({ enabled: settings.loyalty.enabled, redeemCentsPerPoint: settings.loyalty.redeemCentsPerPoint, minRedeemPoints: settings.loyalty.minRedeemPoints });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('po.loadFail'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Refresh the attached customer's loyalty balance whenever it changes (URL
  // prefill from a booking/walk-in, or picked on the register) — without
  // re-fetching the whole catalog.
  useEffect(() => {
    if (!token || !customerId) return;
    let alive = true;
    apiFetch<{ loyaltyPoints?: number }>(`/customers/${customerId}`, { token })
      .then((c) => { if (alive) setCustomerPoints(c?.loyaltyPoints ?? 0); })
      .catch(() => {});
    return () => { alive = false; };
  }, [token, customerId]);

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
    setCart([]); setOrderDiscount(''); setTendered(''); setRedeemInput(''); setError(null);
  }

  const money = useMemo(() => {
    const subtotal = cart.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
    // Savings from per-item promo discounts (list price vs net price).
    const itemSavings = cart.reduce((s, l) => s + (l.origUnitPriceCents - l.unitPriceCents) * l.quantity, 0);
    const productBase = cart.filter((l) => l.kind === 'PRODUCT').reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
    const discount = Math.min(Math.round((parseFloat(orderDiscount) || 0) * 100), subtotal);
    const tax = Math.round((productBase * taxRate) / 100);
    const tip = cart.reduce((s, l) => s + l.tipCents, 0);
    // Loyalty redemption (only when enabled, a customer is attached, and >= min).
    const wantPts = loyalty.enabled && customerId ? Math.min(parseInt(redeemInput, 10) || 0, customerPoints) : 0;
    const redeemValid = wantPts > 0 && wantPts >= loyalty.minRedeemPoints;
    const redeemDiscount = redeemValid ? Math.min(wantPts * loyalty.redeemCentsPerPoint, Math.max(0, subtotal - discount + tax)) : 0;
    const redeemPts = redeemDiscount > 0 ? wantPts : 0;
    const total = Math.max(0, subtotal - discount + tax + tip - redeemDiscount);
    const savings = itemSavings + discount + redeemDiscount;
    const tenderedCents = Math.round((parseFloat(tendered) || 0) * 100);
    const change = payMethod === 'CASH' ? Math.max(0, tenderedCents - total) : 0;
    return { subtotal, itemSavings, discount, tax, tip, total, savings, tenderedCents, change, redeemDiscount, redeemPts };
  }, [cart, orderDiscount, taxRate, tendered, payMethod, loyalty, customerId, customerPoints, redeemInput]);

  // ---- Catalog search + grouping ------------------------------------------
  const q = query.trim().toLowerCase();
  const otherLabel = t('po.other');

  // Unique service categories for the quick-filter chips (first-seen order).
  const serviceCats = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of services) if (s.category) seen.set(s.category.id, s.category.name);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [services]);

  // Services after search + chip filter, grouped by category.
  const serviceGroups = useMemo(() => {
    const filtered = services.filter(
      (s) => (!q || s.name.toLowerCase().includes(q)) && (!catFilter || s.category?.id === catFilter),
    );
    const map = new Map<string, { id: string | null; name: string; items: Service[] }>();
    for (const s of filtered) {
      const key = s.category?.id ?? '__none__';
      if (!map.has(key)) map.set(key, { id: s.category?.id ?? null, name: s.category?.name ?? otherLabel, items: [] });
      map.get(key)!.items.push(s);
    }
    return [...map.values()];
  }, [services, q, catFilter, otherLabel]);

  const addonGroups = useMemo(() => groupAddons(addons.filter((a) => !q || a.name.toLowerCase().includes(q))), [addons, q]);
  const productsF = useMemo(() => products.filter((p) => !q || p.name.toLowerCase().includes(q)), [products, q]);

  const staffName = (id: string) => {
    const s = staff.find((x) => x.id === id);
    return s ? `${s.firstName} ${s.lastName ?? ''}`.trim() : t('po.unassigned');
  };

  async function pay() {
    if (cart.length === 0) { setError(t('po.addItem')); return; }
    // Cash needs the amount received; Card & Transfer are paid in full at the terminal/bank.
    const tenderCents = payMethod === 'CASH' ? money.tenderedCents : money.total;
    if (payMethod === 'CASH' && tenderCents < money.total) {
      setError(t('po.cashShort'));
      return;
    }
    const apiMethod = payMethod === 'CASH' ? 'CASH' : payMethod === 'CARD' ? 'CARD' : 'OTHER';
    setSubmitting(true); setError(null); setOkMsg(null);
    try {
      const order = await apiFetch<{ orderNumber: number }>('/pos/orders', {
        method: 'POST', token,
        body: {
          appointmentId: appointmentId || undefined,
          walkInId: walkInId || undefined,
          customerId: customerId || undefined,
          discountCents: money.discount,
          redeemPoints: money.redeemPts || undefined,
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
      setOkMsg(t('po.paidOk').replace('{n}', String(order.orderNumber)));
      clearCart();
      load(); // refresh stock
    } catch (err) {
      setError(err instanceof Error ? err.message : t('po.payFail'));
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
      <div class="center">Order #${orderNumber} · ${new Date().toLocaleString('en-US')}</div><hr>
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

  if (loading) return <p style={{ color: '#94a3b8' }}>{t('po.loadingReg')}</p>;

  return (
    <section>
      <style>{`
        .pos-card { transition: border-color .12s ease, background .12s ease, transform .06s ease; }
        .pos-card:hover { border-color: #6366f1 !important; background: #1e293b !important; }
        .pos-card:active { transform: scale(.97); }
      `}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{t('po.title')}</h1>
        <a href="/salon/products" style={{ ...ghost, textDecoration: 'none' }}>{t('po.manageProducts')}</a>
      </div>

      {appointmentId && (
        <div style={{ background: '#1e293b', border: '1px solid #4f46e5', color: '#c7d2fe', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>
          {t('po.checkoutBanner').replace('{for}', bookingCustomer ? t('po.checkoutFor').replace('{name}', bookingCustomer) : '')}
        </div>
      )}
      {!appointmentId && customerId && bookingCustomer && (
        <div style={{ background: '#1e293b', border: '1px solid #4f46e5', color: '#c7d2fe', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>
          {t('po.newSaleA')}<strong>{bookingCustomer}</strong>{t('po.newSaleB')}
        </div>
      )}
      {error && <div style={ui.banner}>{error}</div>}
      {okMsg && <div style={{ background: '#14532d', color: '#bbf7d0', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14 }}>{okMsg}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        {/* Catalog */}
        <div style={{ ...ui.card, display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 130px)' }}>
          {/* Tabs with counts */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <button onClick={() => setTab('SERVICE')} style={tabBtn(tab === 'SERVICE')}>{t('po.tabServices')}<TabCount n={services.length} active={tab === 'SERVICE'} /></button>
            <button onClick={() => setTab('ADDON')} style={tabBtn(tab === 'ADDON')}>{t('po.tabAddons')}<TabCount n={addons.length} active={tab === 'ADDON'} /></button>
            <button onClick={() => setTab('PRODUCT')} style={tabBtn(tab === 'PRODUCT')}>{t('po.tabProducts')}<TabCount n={products.length} active={tab === 'PRODUCT'} /></button>
          </div>

          {/* Search */}
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: '#64748b', pointerEvents: 'none' }}>🔍</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('po.searchPh')}
              style={{ ...ui.input, width: '100%', padding: '10px 34px', fontSize: 14, boxSizing: 'border-box' }}
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="clear" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
            )}
          </div>

          {/* Category quick-filter chips (services tab) */}
          {tab === 'SERVICE' && serviceCats.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              <button onClick={() => setCatFilter(null)} style={chipSel(catFilter === null)}>{t('po.allCats')}</button>
              {serviceCats.map((c) => (
                <button key={c.id} onClick={() => setCatFilter(catFilter === c.id ? null : c.id)} style={chipSel(catFilter === c.id)}>{c.name}</button>
              ))}
            </div>
          )}

          {/* Scrollable results */}
          <div style={{ overflowY: 'auto', flex: 1, minHeight: 220, paddingRight: 4 }}>
            {/* Services, grouped by category */}
            {tab === 'SERVICE' && (
              serviceGroups.length === 0 ? (
                <EmptyState text={services.length === 0 ? t('po.noServices') : `${t('po.noMatch')} "${query}"`} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {serviceGroups.map((grp) => (
                    <div key={grp.id ?? '__none__'}>
                      {(serviceCats.length > 0) && <GroupHeader label={grp.name} count={grp.items.length} />}
                      <div style={catGrid}>
                        {grp.items.map((s) => (
                          <button key={s.id} onClick={() => addService(s)} className="pos-card" style={catBtn}>
                            <span style={cardTitle}>{s.name}</span>
                            <CatPrice priceCents={s.priceCents} discountPercent={s.discountPercent} currency={currency} />
                            {s.durationMinutes > 0 && <span style={cardMeta}>⏱ {s.durationMinutes} {t('po.min')}</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {/* Add-ons, grouped by parent service */}
            {tab === 'ADDON' && (
              addons.length === 0 ? (
                <p style={mutedP}>{t('po.noAddonsA')}<a href="/salon/services" style={{ color: '#818cf8' }}>{t('po.servicesLink')}</a>.</p>
              ) : addonGroups.length === 0 ? (
                <EmptyState text={`${t('po.noMatch')} "${query}"`} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {addonGroups.map((grp) => (
                    <div key={grp.service}>
                      <GroupHeader label={grp.service} count={grp.items.length} />
                      <div style={catGrid}>
                        {grp.items.map((a) => (
                          <button key={a.id} onClick={() => addAddon(a)} className="pos-card" style={{ ...catBtn, borderStyle: 'dashed' }}>
                            <span style={cardTitle}>+ {a.name}</span>
                            <span style={{ color: '#22c55e', fontWeight: 600 }}>{formatPrice(a.priceCents, currency)}</span>
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
              products.length === 0 ? (
                <p style={mutedP}>{t('po.noProductsA')}<a href="/salon/products" style={{ color: '#818cf8' }}>{t('po.addSome')}</a></p>
              ) : productsF.length === 0 ? (
                <EmptyState text={`${t('po.noMatch')} "${query}"`} />
              ) : (
                <div style={catGrid}>
                  {productsF.map((p) => (
                    <button key={p.id} onClick={() => addProduct(p)} className="pos-card" style={catBtn}>
                      <span style={cardTitle}>{p.name}</span>
                      <CatPrice priceCents={p.priceCents} discountPercent={p.discountPercent} currency={currency} />
                      {p.trackStock && <span style={{ fontSize: 11, fontWeight: 600, color: p.stockQty > 0 ? '#94a3b8' : '#ef4444' }}>{t('po.stock')}: {p.stockQty}</span>}
                    </button>
                  ))}
                </div>
              )
            )}
          </div>
        </div>

        {/* Ticket */}
        <div style={{ ...ui.card, position: 'sticky', top: 12 }}>
          <h2 style={{ fontSize: 15, margin: '0 0 12px' }}>{t('po.ticket')}</h2>

          <CustomerBox
            token={token} t={t}
            customerId={customerId} customerLabel={customerLabel} customerPoints={customerPoints}
            onPick={(id, label, points) => { setCustomerId(id); setCustomerLabel(label); setCustomerPoints(points); }}
            onClear={() => { setCustomerId(null); setCustomerLabel(null); setCustomerPoints(0); setRedeemInput(''); }}
          />

          {cart.length === 0 ? (
            <p style={{ color: '#94a3b8', fontSize: 14 }}>{t('po.tapToAdd')}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
              {cart.map((l) => (
                <div key={l.uid} style={{ borderBottom: '1px solid #334155', paddingBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {l.isAddon && <span style={{ fontSize: 10, fontWeight: 700, color: '#818cf8', border: '1px solid #4f46e5', borderRadius: 5, padding: '1px 5px', marginRight: 6 }}>{t('po.addonBadge')}</span>}
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
                      <option value="">{t('po.technician')}</option>
                      {staff.map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName ?? ''}</option>)}
                    </select>
                    <input
                      type="number" min={0} step="0.01" placeholder={t('po.tipPh')}
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
            <Row label={t('po.subtotal')} value={formatPrice(money.subtotal, currency)} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#94a3b8' }}>{t('po.discountD')}</span>
              <input type="number" min={0} step="0.01" value={orderDiscount} onChange={(e) => setOrderDiscount(e.target.value)} style={{ ...ui.input, width: 100, padding: '5px 8px', textAlign: 'right' }} />
            </div>
            {money.tax > 0 && <Row label={t('po.tax').replace('{r}', String(taxRate))} value={formatPrice(money.tax, currency)} />}
            {money.tip > 0 && <Row label={t('po.tips')} value={formatPrice(money.tip, currency)} />}
            {loyalty.enabled && customerId && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#eab308' }}>{t('po.redeemPoints').replace('{n}', String(customerPoints))}</span>
                <input
                  type="number" min={0} value={redeemInput} onChange={(e) => setRedeemInput(e.target.value)}
                  placeholder={t('po.minPts').replace('{n}', String(loyalty.minRedeemPoints))}
                  style={{ ...ui.input, width: 110, padding: '5px 8px', textAlign: 'right' }}
                />
              </div>
            )}
            {money.redeemDiscount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#eab308' }}>
                <span>{t('po.pointsDiscount').replace('{n}', String(money.redeemPts))}</span><span>−{formatPrice(money.redeemDiscount, currency)}</span>
              </div>
            )}
            {money.savings > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#22c55e', fontWeight: 600 }}>
                <span>{t('po.youSaved')}</span><span>−{formatPrice(money.savings, currency)}</span>
              </div>
            )}
            <div style={{ borderTop: '1px solid #334155', paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 700 }}>
              <span>{t('po.total')}</span><span style={{ color: '#22c55e' }}>{formatPrice(money.total, currency)}</span>
            </div>
          </div>

          {/* Payment method */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button onClick={() => setPayMethod('CASH')} style={tabBtn(payMethod === 'CASH')}>{t('po.cash')}</button>
            <button onClick={() => setPayMethod('CARD')} style={tabBtn(payMethod === 'CARD')}>{t('po.card')}</button>
            <button onClick={() => setPayMethod('TRANSFER')} style={tabBtn(payMethod === 'TRANSFER')}>{t('po.transfer')}</button>
          </div>

          {payMethod === 'CASH' && (
            <>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                <button onClick={() => setTendered((money.total / 100).toFixed(2))} style={chip}>{t('po.exact')}</button>
                {quickCash(money.total).map((amt) => (
                  <button key={amt} onClick={() => setTendered((amt / 100).toFixed(2))} style={chip}>{formatPrice(amt, currency)}</button>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ color: '#94a3b8' }}>{t('po.cashReceived')}</span>
                <input type="number" min={0} step="0.01" value={tendered} onChange={(e) => setTendered(e.target.value)} style={{ ...ui.input, width: 120, padding: '6px 8px', textAlign: 'right' }} />
              </div>
              {money.tenderedCents > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontWeight: 600 }}>
                  <span>{t('po.change')}</span><span style={{ color: money.change >= 0 ? '#22c55e' : '#ef4444' }}>{formatPrice(money.change, currency)}</span>
                </div>
              )}
            </>
          )}
          {payMethod === 'CARD' && (
            <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 10 }}>{t('po.cardHint').replace('{x}', formatPrice(money.total, currency))}</p>
          )}
          {payMethod === 'TRANSFER' && (
            <div style={{ marginBottom: 10 }}>
              {transferInfo || transferQr ? (
                <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>{t('po.transferShow').replace('{x}', formatPrice(money.total, currency))}</div>
                  {transferInfo && <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, color: '#e2e8f0', margin: 0 }}>{transferInfo}</pre>}
                  {transferQr && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={transferQr} alt="Transfer QR" style={{ width: 140, height: 140, objectFit: 'contain', marginTop: 10, background: '#fff', borderRadius: 8, padding: 4 }} />
                  )}
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>{t('po.transferAfter')}</div>
                </div>
              ) : (
                <p style={{ color: '#94a3b8', fontSize: 13 }}>
                  {t('po.transferNoneA')}<a href="/salon/settings" style={{ color: '#818cf8' }}>{t('po.transferSettingsLink')}</a>{t('po.transferNoneB')}
                </p>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={clearCart} disabled={cart.length === 0} style={{ ...ghost, flex: 1 }}>{t('po.clear')}</button>
            <button onClick={pay} disabled={submitting || cart.length === 0} style={{ ...ui.primaryBtn, flex: 2, padding: '12px', fontSize: 15 }}>
              {submitting ? t('po.processing') : t('po.payPrint').replace('{x}', formatPrice(money.total, currency))}
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
  display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-start', textAlign: 'left', justifyContent: 'space-between',
  minHeight: 74, padding: '12px', borderRadius: 10, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', cursor: 'pointer', fontSize: 13,
};
const catGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(142px, 1fr))', gap: 10 };
const cardTitle: React.CSSProperties = { fontWeight: 600, fontSize: 13, lineHeight: 1.3, color: '#f1f5f9' };
const cardMeta: React.CSSProperties = { fontSize: 11, color: '#64748b' };
const mutedP: React.CSSProperties = { color: '#94a3b8', fontSize: 13 };
const chipSel = (active: boolean): React.CSSProperties => ({
  padding: '5px 12px', borderRadius: 999, border: '1px solid ' + (active ? '#6366f1' : '#334155'),
  background: active ? '#6366f1' : 'transparent', color: active ? '#fff' : '#cbd5e1', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
});

function TabCount({ n, active }: { n: number; active: boolean }) {
  return <span style={{ fontSize: 11, fontWeight: 700, marginLeft: 6, padding: '1px 6px', borderRadius: 999, background: active ? 'rgba(255,255,255,0.22)' : '#1e293b', color: active ? '#fff' : '#94a3b8' }}>{n}</span>;
}
function GroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: 11, color: '#64748b' }}>· {count}</span>
      <div style={{ flex: 1, height: 1, background: '#1e293b' }} />
    </div>
  );
}
function EmptyState({ text }: { text: string }) {
  return <div style={{ color: '#64748b', fontSize: 14, textAlign: 'center', padding: '36px 12px' }}>{text}</div>;
}
const qtyBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6, border: '1px solid #475569', background: 'transparent', color: '#e2e8f0', cursor: 'pointer', fontSize: 16,
};
const chip: React.CSSProperties = {
  padding: '5px 10px', borderRadius: 999, border: '1px solid #475569', background: '#0f172a', color: '#cbd5e1', fontSize: 12, cursor: 'pointer',
};
const ghost: React.CSSProperties = {
  padding: '10px 14px', borderRadius: 8, border: '1px solid #475569', background: 'transparent', color: '#e2e8f0', fontSize: 14, cursor: 'pointer',
};

function hitLabel(c: CustomerHit): string {
  const name = `${c.firstName}${c.lastName ? ' ' + c.lastName : ''}`.trim();
  return c.phone ? `${name} · ${c.phone}` : name;
}

/**
 * Attach a CRM customer to the sale so it earns loyalty + becomes remarketable.
 * Search the salon's customers by name/phone, or quick-add a new one by phone.
 */
function CustomerBox({ token, t, customerId, customerLabel, customerPoints, onPick, onClear }: {
  token: string | null; t: (k: string) => string;
  customerId: string | null; customerLabel: string | null; customerPoints: number;
  onPick: (id: string, label: string, points: number) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CustomerHit[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [nf, setNf] = useState({ firstName: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (customerId) return; // already attached — no searching
    const term = q.trim();
    if (term.length < 2) { setResults(null); return; }
    let alive = true;
    const h = setTimeout(async () => {
      try {
        const r = await apiFetch<CustomerHit[]>(`/customers/search?q=${encodeURIComponent(term)}`, { token });
        if (alive) setResults(r);
      } catch { if (alive) setResults([]); }
    }, 250);
    return () => { alive = false; clearTimeout(h); };
  }, [q, token, customerId]);

  async function quickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!nf.phone.trim()) { setErr(t('po.custPhoneReq')); return; }
    setBusy(true); setErr(null);
    try {
      const c = await apiFetch<CustomerHit>('/customers', { method: 'POST', token, body: { firstName: nf.firstName.trim() || undefined, phone: nf.phone.trim() } });
      onPick(c.id, hitLabel(c), c.loyaltyPoints ?? 0);
      setAdding(false); setNf({ firstName: '', phone: '' }); setQ('');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  // Attached state — show who's on the ticket + points + clear.
  if (customerId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#0f172a', border: '1px solid #4f46e5', borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>
        <span style={{ fontSize: 15 }}>👤</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customerLabel || t('po.custAttached')}</div>
          <div style={{ fontSize: 11, color: '#eab308' }}>⭐ {t('po.custPoints').replace('{n}', String(customerPoints))}</div>
        </div>
        <button onClick={onClear} title={t('po.custRemove')} style={{ background: 'none', border: '1px solid #475569', borderRadius: 6, color: '#94a3b8', cursor: 'pointer', fontSize: 13, padding: '3px 8px' }}>✕</button>
      </div>
    );
  }

  // Quick-add form.
  if (adding) {
    return (
      <form onSubmit={quickAdd} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1', marginBottom: 8 }}>{t('po.custNew')}</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input value={nf.firstName} onChange={(e) => setNf({ ...nf, firstName: e.target.value })} placeholder={t('po.custName')} style={{ ...ui.input, flex: 1, padding: '7px 9px', fontSize: 13 }} />
          <input value={nf.phone} onChange={(e) => setNf({ ...nf, phone: e.target.value })} placeholder={t('po.custPhone')} inputMode="tel" autoFocus style={{ ...ui.input, flex: 1, padding: '7px 9px', fontSize: 13 }} />
        </div>
        {err && <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 6 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="submit" disabled={busy} style={{ ...ui.primaryBtn, padding: '7px 12px', fontSize: 13 }}>{busy ? t('po.custSaving') : t('po.custSave')}</button>
          <button type="button" onClick={() => { setAdding(false); setErr(null); }} style={{ ...ghost, padding: '7px 12px', fontSize: 13 }}>{t('po.custCancel')}</button>
        </div>
      </form>
    );
  }

  // Search state.
  return (
    <div style={{ position: 'relative', marginBottom: 12 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('po.custSearch')} style={{ ...ui.input, flex: 1, padding: '8px 10px', fontSize: 13 }} />
        <button type="button" onClick={() => { setAdding(true); setErr(null); }} style={{ ...ghost, padding: '8px 12px', fontSize: 13, whiteSpace: 'nowrap' }}>＋ {t('po.custAdd')}</button>
      </div>
      {results && results.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4, background: '#1e293b', border: '1px solid #475569', borderRadius: 8, maxHeight: 220, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
          {results.map((c) => (
            <button key={c.id} type="button" onClick={() => { onPick(c.id, hitLabel(c), c.loyaltyPoints ?? 0); setResults(null); setQ(''); }}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 10px', background: 'none', border: 'none', borderBottom: '1px solid #334155', color: '#e2e8f0', cursor: 'pointer', fontSize: 13 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hitLabel(c)}</span>
              <span style={{ color: '#eab308', fontSize: 11, whiteSpace: 'nowrap' }}>⭐ {c.loyaltyPoints ?? 0}</span>
            </button>
          ))}
        </div>
      )}
      {results && results.length === 0 && q.trim().length >= 2 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4, background: '#1e293b', border: '1px solid #475569', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: '#94a3b8' }}>
          {t('po.custNone')} <button type="button" onClick={() => { setAdding(true); setNf({ firstName: '', phone: q.replace(/[^\d+]/g, '') }); }} style={{ background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', fontSize: 12, padding: 0 }}>＋ {t('po.custAdd')}</button>
        </div>
      )}
    </div>
  );
}
