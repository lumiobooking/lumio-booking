'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { useIsMobile } from '../../../lib/responsive';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch, ApiError } from '../../../lib/api';
import { cacheCatalog, readCachedCatalog, genClientRef, queueOrder, queueCount, syncQueue } from '../../../lib/offlinePos';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { BarcodeScanner } from '../../../components/BarcodeScanner';

interface Service { id: string; name: string; priceCents: number; discountPercent?: number; durationMinutes: number; isActive: boolean; category?: { id: string; name: string } | null }
interface Product { id: string; name: string; priceCents: number; discountPercent?: number; isActive: boolean; trackStock: boolean; stockQty: number; barcode?: string | null }
interface Addon { id: string; name: string; priceCents: number; durationMinutes: number; serviceId: string; service: { name: string } | null }
interface Staff { id: string; firstName: string; lastName: string | null; isActive: boolean; tipQrUrl?: string | null; tipHandle?: string | null }
interface CustomerHit { id: string; firstName: string; lastName?: string | null; phone?: string | null; loyaltyPoints?: number }
interface CatalogCache {
  services: Service[]; products: Product[]; addons: Addon[]; staff: Staff[];
  taxRate: number; transferInfo: string; transferQr: string; currency: string;
  loyalty: { enabled: boolean; redeemCentsPerPoint: number; minRedeemPoints: number };
  salonName?: string; salonLogo?: string; salonAccent?: string;
}

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
  const isMobile = useIsMobile();
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
  const [salonName, setSalonName] = useState('');
  const [salonLogo, setSalonLogo] = useState('');
  const [salonAccent, setSalonAccent] = useState('#6366f1');
  const [reviewUrl, setReviewUrl] = useState<string | null>(null); // salon Google-review link for the customer display
  const [transferInfo, setTransferInfo] = useState('');
  const [transferQr, setTransferQr] = useState('');
  const [tab, setTab] = useState<'SERVICE' | 'ADDON' | 'PRODUCT'>('SERVICE');
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState<string | null>(null); // service category id, null = all
  const [cart, setCart] = useState<Line[]>([]);
  const [heldBills, setHeldBills] = useState<{ id: string; label: string | null; totalCents: number; payload: unknown; createdAt: string }[]>([]);
  const [showHeld, setShowHeld] = useState(false);
  const [orderDiscount, setOrderDiscount] = useState('');
  const [payMethod, setPayMethod] = useState<'CASH' | 'CARD' | 'TRANSFER'>('CASH');
  const [tendered, setTendered] = useState('');
  // Split payment: one bill settled with several methods (e.g. part cash, part card).
  // Off by default — the common one-method flow above stays untouched.
  const [split, setSplit] = useState(false);
  const [parts, setParts] = useState<{ method: 'CASH' | 'CARD' | 'TRANSFER'; amount: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loyalty, setLoyalty] = useState({ enabled: false, redeemCentsPerPoint: 5, minRedeemPoints: 100 });
  const [customerPoints, setCustomerPoints] = useState(0);
  const [redeemInput, setRedeemInput] = useState('');
  // Per-device: route receipts to the reception printer (via the print agent).
  const [printToReception, setPrintToReception] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem('lumio_print_to_reception') === '1'; } catch { return false; }
  });
  const toggleReception = (v: boolean) => {
    setPrintToReception(v);
    try { localStorage.setItem('lumio_print_to_reception', v ? '1' : '0'); } catch { /* ignore */ }
  };
  // Offline support: `online` = we believe we can reach the server; `pendingSync`
  // = how many offline sales are waiting to upload.
  const [online, setOnline] = useState(true);
  const [pendingSync, setPendingSync] = useState(0);
  // Mobile only: which half of the register is showing (one long scroll is hard
  // to use, so we split into a "pick items" view and a "ticket / pay" view).
  const [mobileView, setMobileView] = useState<'catalog' | 'ticket'>('catalog');
  // Barcode scanning: a USB scanner types into scanInput; the camera button opens
  // a live scanner. Both resolve a product by its barcode and add it to the cart.
  const [scanInput, setScanInput] = useState('');
  const [scanMsg, setScanMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  // Gift card redeemed toward this ticket (online-only — needs a live balance check).
  const [giftCard, setGiftCard] = useState<{ code: string; balanceCents: number } | null>(null);
  const [giftInput, setGiftInput] = useState('');
  // Direct-tip logging: the customer tipped the tech directly (QR/cash) — we only
  // record the amount so payroll shows it. The salon never holds this money.
  const [tipLogInput, setTipLogInput] = useState<Record<string, string>>({});
  const [tipLogged, setTipLogged] = useState<Record<string, number>>({});
  const [tipBusy, setTipBusy] = useState<string | null>(null);
  // Post-payment QR tip (Channel 3): after the bill is paid, the customer's
  // Thank-you screen offers a tip. We remember the just-paid ticket's tech(s)
  // (with their service value as the split weight) so a tapped tip is logged to
  // the right person(s). A token ref keeps the async log working from the
  // (mount-time) BroadcastChannel handler.
  const tokenRef = useRef(token); tokenRef.current = token;
  const paidTipRef = useRef<{ techs: { id: string; name: string; qr?: string; handle?: string; weightCents: number }[]; baseCents: number }>({ techs: [], baseCents: 0 });

  // ---- Wireless iPad customer display (server relay) --------------------------
  // A paired iPad polls the backend for the same payload we broadcast to a local
  // 2nd monitor. To avoid needless traffic, we only push once the salon has opened
  // the iPad panel at least once (remembered in localStorage).
  const [displaySession, setDisplaySession] = useState<{ pairCode: string; pairUrl: string; displayUrl: string } | null>(null);
  const [ipadPanel, setIpadPanel] = useState(false);
  const ipadEnabledRef = useRef(false);
  const lastPushRef = useRef<string>('');
  const holdPaidRef = useRef(false);
  useEffect(() => { try { ipadEnabledRef.current = localStorage.getItem('lumio_ipad_display') === '1'; } catch { /* ignore */ } }, []);
  const enableIpad = () => { ipadEnabledRef.current = true; try { localStorage.setItem('lumio_ipad_display', '1'); } catch { /* ignore */ } };
  const pushDisplayState = useCallback((state: Record<string, unknown>, payTicket?: Record<string, unknown> | null) => {
    if (!ipadEnabledRef.current || !tokenRef.current) return;
    const key = JSON.stringify({ s: state, p: payTicket ?? null });
    if (key === lastPushRef.current) return; // skip identical re-renders
    lastPushRef.current = key;
    apiFetch('/display/push', { method: 'POST', token: tokenRef.current, body: { state, ...(payTicket ? { payTicket } : {}) } }).catch(() => { /* best-effort mirror */ });
  }, []);
  const rotateDisplay = useCallback(async () => {
    if (!tokenRef.current) return;
    try {
      const s = await apiFetch<{ pairCode: string; pairUrl: string; displayUrl: string }>('/display/session/rotate', { method: 'POST', token: tokenRef.current });
      setDisplaySession(s);
    } catch { /* ignore */ }
  }, []);

  const applyCatalog = (c: CatalogCache) => {
    setServices(c.services); setProducts(c.products); setAddons(c.addons); setStaff(c.staff);
    setTaxRate(c.taxRate); setTransferInfo(c.transferInfo); setTransferQr(c.transferQr); setCurrency(c.currency);
    setLoyalty(c.loyalty);
    setSalonName(c.salonName ?? ''); setSalonLogo(c.salonLogo ?? ''); setSalonAccent(c.salonAccent ?? '#6366f1');
  };

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [s, p, a, st, settings] = await Promise.all([
        apiFetch<Service[]>('/services', { token }),
        apiFetch<Product[]>('/pos/products', { token }),
        apiFetch<Addon[]>('/services/addons/all', { token }),
        apiFetch<Staff[]>('/staff', { token }),
        apiFetch<{ pos?: { taxRatePercent?: number; transferInstructions?: string; transferQrUrl?: string }; booking?: { currency?: string }; loyalty?: { enabled: boolean; redeemCentsPerPoint: number; minRedeemPoints: number }; company?: { name?: string; slug?: string }; branding?: { logoUrl?: string; accentColor?: string } }>('/settings', { token }),
      ]);
      const cat: CatalogCache = {
        services: s.filter((x) => x.isActive),
        products: p.filter((x) => x.isActive),
        addons: a,
        staff: st.filter((x) => x.isActive),
        taxRate: settings.pos?.taxRatePercent ?? 0,
        transferInfo: settings.pos?.transferInstructions ?? '',
        transferQr: settings.pos?.transferQrUrl ?? '',
        currency: settings.booking?.currency ?? 'USD',
        loyalty: settings.loyalty
          ? { enabled: settings.loyalty.enabled, redeemCentsPerPoint: settings.loyalty.redeemCentsPerPoint, minRedeemPoints: settings.loyalty.minRedeemPoints }
          : { enabled: false, redeemCentsPerPoint: 5, minRedeemPoints: 100 },
        salonName: settings.company?.name ?? '',
        salonLogo: settings.branding?.logoUrl ?? '',
        salonAccent: settings.branding?.accentColor ?? '#6366f1',
      };
      applyCatalog(cat);
      cacheCatalog(cat);
      // Salon-level Google-review link for the customer display — only when the
      // program is on AND a Google target is configured (best-effort).
      const rvSlug = settings.company?.slug;
      if (rvSlug) {
        try {
          const rv = await apiFetch<{ enabled?: boolean; hasGoogle?: boolean }>(`/public/review/${encodeURIComponent(rvSlug)}/salon`, { token });
          const origin = typeof window !== 'undefined' ? window.location.origin : '';
          setReviewUrl(rv?.enabled && rv?.hasGoogle ? `${origin}/review/${rvSlug}/salon` : null);
        } catch { /* review invite is optional */ }
      }
      setOnline(true);
      setError(null);
    } catch (err) {
      // Offline (or server unreachable): fall back to the cached catalog so staff
      // can keep checking out. Only show a hard error if there's no cache yet.
      const cached = readCachedCatalog<CatalogCache>();
      if (cached?.data) {
        applyCatalog(cached.data);
        setOnline(false);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : t('po.loadFail'));
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Upload any sales taken offline. Idempotent: re-sending an already-synced sale
  // is a no-op (the clientRef returns the existing order — never a duplicate).
  const syncPending = useCallback(async () => {
    if (!token) return;
    const post = async (payload: unknown): Promise<{ ok: boolean; permanent?: boolean }> => {
      try { await apiFetch('/pos/orders', { method: 'POST', token, body: payload }); return { ok: true }; }
      catch (e) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) return { ok: false, permanent: true };
        throw e; // network / server-down → keep, retry later
      }
    };
    await syncQueue(post);
    setPendingSync(queueCount());
  }, [token]);

  // On mount: show the queued count and, if online, drain the queue.
  useEffect(() => {
    setPendingSync(queueCount());
    if (typeof navigator === 'undefined' || navigator.onLine) syncPending();
    else setOnline(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When connectivity returns, refresh the catalog + upload queued sales.
  useEffect(() => {
    const goOnline = () => { setOnline(true); load(); syncPending(); };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, [load, syncPending]);

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

  // Pre-fill the ticket from a checkout link. A walk-in carries its full running
  // ticket — every service done this visit, each with the technician who did it —
  // so the cashier never re-keys anything or asks the tech/customer. A booking
  // carries a single service + tech.
  useEffect(() => {
    if (prefilled || !token) return;
    let alive = true;
    (async () => {
      if (walkInId) {
        try {
          const w = await apiFetch<{ items?: { serviceId: string; name: string; priceCents: number; staffId: string | null }[] }>(`/walkins/${walkInId}`, { token });
          const items = Array.isArray(w.items) ? w.items : [];
          if (alive && items.length > 0) {
            setCart((c) => (c.length > 0 ? c : items.map((it) => ({
              uid: `u${uidSeq++}`, kind: 'SERVICE' as const, refId: it.serviceId, name: it.name,
              origUnitPriceCents: it.priceCents, unitPriceCents: it.priceCents, discountPercent: 0,
              quantity: 1, tipCents: 0, staffMemberId: it.staffId ?? '',
            }))));
            setPrefilled(true);
            return;
          }
        } catch { /* fall through to the single-service prefill below */ }
      }
      if (!alive) return;
      // Booking checkout (or a walk-in with nothing logged yet): one service + tech.
      if (services.length === 0) return; // catalog not ready — effect re-runs on load
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
    })();
    return () => { alive = false; };
  }, [services, prefilled, params, token, walkInId]);

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
    setCart([]); setOrderDiscount(''); setTendered(''); setRedeemInput(''); setError(null); setSplit(false); setParts([]);
    setGiftCard(null); setGiftInput(''); setScanInput(''); setScanMsg(null);
    setTipLogInput({}); setTipLogged({});
    setMobileView('catalog');
  }

  // ---- Held bills ("bill chờ"): park a cart to serve someone else, recall later ----
  const loadHeld = useCallback(async () => {
    if (!token) return;
    try { setHeldBills(await apiFetch('/pos/held', { token })); } catch { /* ignore */ }
  }, [token]);
  useEffect(() => { loadHeld(); }, [loadHeld]);
  async function park() {
    if (cart.length === 0) return;
    try {
      await apiFetch('/pos/held', { method: 'POST', token, body: {
        label: customerLabel || bookingCustomer || 'Walk-in',
        totalCents: money.total,
        payload: { cart, customerId, customerLabel, orderDiscount },
      } });
      clearCart();
      await loadHeld();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not hold this ticket'); }
  }
  function recall(h: { id: string; payload: unknown }) {
    if (cart.length > 0 && !window.confirm(lang === 'vi' ? 'Thay giỏ hàng hiện tại bằng bill này?' : 'Replace the current cart with this bill?')) return;
    const pp = (h.payload || {}) as { cart?: Line[]; customerId?: string | null; customerLabel?: string | null; orderDiscount?: string };
    setCart(Array.isArray(pp.cart) ? pp.cart.map((l) => ({ ...l, uid: `u${uidSeq++}` })) : []);
    setCustomerId(pp.customerId ?? null);
    setCustomerLabel(pp.customerLabel ?? null);
    setOrderDiscount(pp.orderDiscount ?? '');
    setShowHeld(false);
    apiFetch(`/pos/held/${h.id}`, { method: 'DELETE', token }).then(loadHeld).catch(() => {});
  }
  async function deleteHeld(id: string) {
    try { await apiFetch(`/pos/held/${id}`, { method: 'DELETE', token }); await loadHeld(); } catch { /* ignore */ }
  }

  // Resolve a scanned/typed barcode to a product and add it. Matches the full
  // product list (any tab) and works offline against the cached catalog.
  function scanLookup(raw: string) {
    const code = raw.trim();
    setScanInput('');
    if (!code) return;
    const hit = products.find((p) => (p.barcode ?? '').trim().toLowerCase() === code.toLowerCase());
    if (hit) { addProduct(hit); setScanMsg({ ok: true, text: t('po.scanAdded').replace('{name}', hit.name) }); }
    else setScanMsg({ ok: false, text: t('po.scanNotFound').replace('{code}', code) });
    setTimeout(() => setScanMsg(null), 2500);
  }

  // Look up a gift card by code and apply its balance toward the ticket (online).
  async function applyGift() {
    const code = giftInput.trim();
    if (!code) return;
    try {
      const card = await apiFetch<{ code: string; balanceCents: number; status: string }>(
        `/gift-cards/lookup/${encodeURIComponent(code)}`, { token },
      );
      if (card.status !== 'ACTIVE' || card.balanceCents <= 0) { setError(t('po.gcEmpty')); return; }
      setGiftCard({ code: card.code, balanceCents: card.balanceCents });
      setGiftInput(''); setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? t('po.gcNotFound') : e instanceof Error ? e.message : t('po.gcNotFound'));
    }
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
    // Redeeming points needs a live balance check, so it's only available online.
    const wantPts = loyalty.enabled && customerId && online ? Math.min(parseInt(redeemInput, 10) || 0, customerPoints) : 0;
    const redeemValid = wantPts > 0 && wantPts >= loyalty.minRedeemPoints;
    const redeemDiscount = redeemValid ? Math.min(wantPts * loyalty.redeemCentsPerPoint, Math.max(0, subtotal - discount + tax)) : 0;
    const redeemPts = redeemDiscount > 0 ? wantPts : 0;
    const total = Math.max(0, subtotal - discount + tax + tip - redeemDiscount);
    const savings = itemSavings + discount + redeemDiscount;
    // Gift card applied toward the ticket (online-only). Reduces the amount due,
    // never below 0; the order total still reflects full value.
    const giftApplied = giftCard && online ? Math.min(giftCard.balanceCents, total) : 0;
    const due = Math.max(0, total - giftApplied);
    const tenderedCents = Math.round((parseFloat(tendered) || 0) * 100);
    // Split mode: sum the parts; any overpay is cash change (someone rounds a cash part up).
    const splitCents = parts.reduce((sum, p) => sum + Math.round((parseFloat(p.amount) || 0) * 100), 0);
    const change = split ? Math.max(0, splitCents - due) : (payMethod === 'CASH' ? Math.max(0, tenderedCents - due) : 0);
    const splitRemaining = due - splitCents; // >0 = still owed, <0 = change
    return { subtotal, itemSavings, discount, tax, tip, total, savings, giftApplied, due, tenderedCents, change, redeemDiscount, redeemPts, splitCents, splitRemaining };
  }, [cart, orderDiscount, taxRate, tendered, payMethod, loyalty, customerId, customerPoints, redeemInput, online, giftCard, split, parts]);

  // ---- Customer-facing display (2nd monitor). Mirrors the live cart to the
  // /pos-display page via BroadcastChannel — same browser, no server, no internet. ----
  const displayPayload = useMemo(() => ({
    type: 'state' as const,
    state: {
      status: (cart.length ? 'active' : 'idle') as 'active' | 'idle',
      currency,
      salonName, salonLogo, salonAccent,
      lines: cart.map((l) => {
        const st = l.staffMemberId ? staff.find((x) => x.id === l.staffMemberId) : null;
        return { name: l.name, qty: l.quantity, lineCents: l.unitPriceCents * l.quantity, staff: st ? `${st.firstName} ${st.lastName ?? ''}`.trim() : undefined };
      }),
      subtotalCents: money.subtotal,
      savingsCents: money.savings,
      tipCents: money.tip,
      taxCents: money.tax,
      giftCents: money.giftApplied,
      dueCents: money.due,
      // Tip prompt for the customer screen: tippable only when there's a service
      // line, and the % is computed off the service subtotal.
      tippable: cart.some((l) => l.kind === 'SERVICE'),
      tipBaseCents: cart.filter((l) => l.kind === 'SERVICE').reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0),
      reviewUrl: reviewUrl ?? undefined,
    },
  }), [cart, currency, money, staff, salonName, salonLogo, salonAccent, reviewUrl]);
  const displayChRef = useRef<BroadcastChannel | null>(null);
  const displayPayloadRef = useRef(displayPayload);
  displayPayloadRef.current = displayPayload;
  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return;
    const ch = new BroadcastChannel('lumio-pos-display');
    displayChRef.current = ch;
    ch.onmessage = (e) => {
      const d = e.data;
      // A freshly-opened display asks the register to replay the current ticket.
      if (d?.type === 'request') ch.postMessage(displayPayloadRef.current);
      // Channel 1 — customer tapped a tip ON THE BILL during checkout.
      else if (d?.type === 'tip' && typeof d.amountCents === 'number') applyCustomerTip(d.amountCents);
      // Channel 3 — customer tapped a tip on the AFTER-PAYMENT screen (scans the
      // tech's QR to pay directly). We log it against the just-paid ticket's techs.
      else if (d?.type === 'tipDirect' && typeof d.amountCents === 'number') logPaidTip(Math.max(0, Math.round(d.amountCents)));
    };
    return () => { ch.close(); displayChRef.current = null; };
  }, []);
  // Distribute a customer-chosen tip across the service lines (by value), so each
  // technician gets their share and the existing per-line tip plumbing carries it
  // through to checkout, receipt and payroll. Products never receive a tip.
  function applyCustomerTip(totalTipCents: number) {
    const amt = Math.max(0, Math.round(totalTipCents));
    setCart((c) => {
      const svc = c.filter((l) => l.kind === 'SERVICE');
      if (svc.length === 0) return c.map((l, i) => ({ ...l, tipCents: i === 0 ? amt : 0 }));
      const base = svc.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
      const lastUid = svc[svc.length - 1].uid;
      let assigned = 0;
      return c.map((l) => {
        if (l.kind !== 'SERVICE') return { ...l, tipCents: 0 };
        if (l.uid === lastUid) return { ...l, tipCents: Math.max(0, amt - assigned) };
        const share = base > 0 ? Math.round((amt * (l.unitPriceCents * l.quantity)) / base) : 0;
        assigned += share;
        return { ...l, tipCents: share };
      });
    });
  }
  useEffect(() => { displayChRef.current?.postMessage(displayPayload); }, [displayPayload]);
  // Mirror the same live payload to the backend so a paired wireless iPad sees it.
  // After a sale is paid we HOLD the server on the thank-you state (skip the trailing
  // 'idle') until a new ticket starts — otherwise the iPad's tip window would vanish.
  useEffect(() => {
    const st = displayPayload.state as unknown as Record<string, unknown>;
    if (holdPaidRef.current) {
      if (st.status === 'idle') return;
      holdPaidRef.current = false;
    }
    pushDisplayState(st);
  }, [displayPayload, pushDisplayState]);
  // Fetch this salon's pairing code the first time the iPad panel is opened.
  useEffect(() => {
    if (!ipadPanel || displaySession || !token) return;
    apiFetch<{ pairCode: string; pairUrl: string; displayUrl: string }>('/display/session', { token })
      .then(setDisplaySession)
      .catch(() => { /* ignore */ });
  }, [ipadPanel, displaySession, token]);
  // Log a tip the customer chose on the AFTER-PAYMENT screen (Channel 3). It goes
  // straight to the tech (they scan the QR) — the salon never holds it — so we only
  // RECORD it (method 'QR') for payroll visibility, split across the paid ticket's
  // techs by their service value. Never throws (a failed log must not break checkout).
  async function logPaidTip(amountCents: number) {
    const techs = paidTipRef.current.techs.filter((t) => t.id);
    if (amountCents <= 0 || techs.length === 0) return;
    const totalW = techs.reduce((s, t) => s + Math.max(0, t.weightCents), 0);
    let assigned = 0;
    for (let i = 0; i < techs.length; i++) {
      const last = i === techs.length - 1;
      const share = last
        ? Math.max(0, amountCents - assigned)
        : totalW > 0 ? Math.round((amountCents * Math.max(0, techs[i].weightCents)) / totalW) : Math.round(amountCents / techs.length);
      assigned += share;
      if (share > 0) {
        try { await apiFetch('/pos/tips', { method: 'POST', token: tokenRef.current, body: { staffMemberId: techs[i].id, amountCents: share, method: 'QR' } }); }
        catch { /* visibility log only — ignore failures */ }
      }
    }
  }
  function broadcastPaid(ticketRef: string) {
    const tt = paidTipRef.current;
    const paidState = {
      status: 'paid', currency, salonName, salonLogo, salonAccent, lines: [] as unknown[],
      saleRef: ticketRef, // lets an independent iPad detect a NEW sale and reset its tip UI
      subtotalCents: 0, savingsCents: 0, tipCents: 0, taxCents: 0, giftCents: 0,
      dueCents: money.due, paidCents: money.tenderedCents || money.due, changeCents: money.change,
      // Channel 3 — offer a QR tip on the Thank-you screen for the tech(s) on this ticket.
      tippable: tt.techs.length > 0,
      tipBaseCents: tt.baseCents,
      tipTechs: tt.techs.map((t) => ({ name: t.name, qr: t.qr, handle: t.handle })),
      reviewUrl: reviewUrl ?? undefined,
    };
    displayChRef.current?.postMessage({ type: 'state', state: paidState });
    // Relay to a paired iPad, carrying the server-only tech split so a tapped tip is
    // logged to the right person(s). Hold this paid state on the server until a new sale.
    const idTechs = tt.techs.filter((t) => t.id);
    const payTicket = idTechs.length
      ? { ref: ticketRef, baseCents: tt.baseCents, techs: idTechs.map((t) => ({ staffMemberId: t.id, weightCents: t.weightCents })) }
      : null;
    holdPaidRef.current = true;
    lastPushRef.current = ''; // force the paid push through even if the prior state matched
    pushDisplayState(paidState as unknown as Record<string, unknown>, payTicket);
  }
  function openCustomerScreen() {
    if (typeof window !== 'undefined') window.open('/pos-display', 'lumioCustomerDisplay', 'width=1100,height=760');
  }

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
  // Technicians on this ticket who set up a tip QR/handle — shown at checkout so
  // the customer can scan and tip them directly (money goes straight to the tech).
  const tipTechs = staff.filter((s) => (s.tipQrUrl || s.tipHandle) && cart.some((l) => l.staffMemberId === s.id));

  async function logDirectTip(staffId: string) {
    const raw = (tipLogInput[staffId] || '').trim();
    const dollars = Number(raw);
    if (!raw || !Number.isFinite(dollars) || dollars <= 0) { setError(t('po.tipLogInvalid')); return; }
    const amountCents = Math.round(dollars * 100);
    setTipBusy(staffId); setError(null);
    try {
      await apiFetch('/pos/tips', { method: 'POST', token, body: { staffMemberId: staffId, amountCents, method: 'DIRECT' } });
      setTipLogged((m) => ({ ...m, [staffId]: (m[staffId] || 0) + amountCents }));
      setTipLogInput((m) => ({ ...m, [staffId]: '' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('po.tipLogFail'));
    } finally {
      setTipBusy(null);
    }
  }

  async function pay() {
    if (cart.length === 0) { setError(t('po.addItem')); return; }
    // Remember this ticket's tip-tech(s) + their service value BEFORE we clear the
    // cart, so the customer's after-payment QR tip (Channel 3) logs to the right person.
    {
      const svcByTech = new Map<string, number>();
      for (const l of cart) if (l.kind === 'SERVICE' && l.staffMemberId) svcByTech.set(l.staffMemberId, (svcByTech.get(l.staffMemberId) || 0) + l.unitPriceCents * l.quantity);
      paidTipRef.current = {
        techs: tipTechs.map((s) => ({ id: s.id, name: `${s.firstName} ${s.lastName ?? ''}`.trim(), qr: s.tipQrUrl ?? undefined, handle: s.tipHandle ?? undefined, weightCents: svcByTech.get(s.id) || 0 })),
        baseCents: cart.filter((l) => l.kind === 'SERVICE').reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0),
      };
    }
    // The gift card (if any) covers part/all of the ticket; tenders cover the rest.
    const dueCents = money.due;
    const apiOf = (m: 'CASH' | 'CARD' | 'TRANSFER') => (m === 'CASH' ? 'CASH' : m === 'CARD' ? 'CARD' : 'OTHER');
    // Cash needs the amount received; Card & Transfer pay the due in full at the terminal/bank.
    const tenderCents = payMethod === 'CASH' ? money.tenderedCents : dueCents;
    // Build the tender list. Split mode = one tender per part; else a single tender.
    let tenderList: { method: string; amountCents: number }[] = [];
    if (dueCents > 0) {
      if (split) {
        tenderList = parts
          .map((p) => ({ method: apiOf(p.method), amountCents: Math.round((parseFloat(p.amount) || 0) * 100) }))
          .filter((tn) => tn.amountCents > 0);
        const sum = tenderList.reduce((a, tn) => a + tn.amountCents, 0);
        if (tenderList.length < 2) { setError(t('po.splitNeedTwo')); return; }
        if (sum < dueCents) { setError(t('po.splitShort')); return; }
      } else {
        if (payMethod === 'CASH' && tenderCents < dueCents) { setError(t('po.cashShort')); return; }
        tenderList = [{ method: apiOf(payMethod), amountCents: tenderCents }];
      }
    }
    const clientRef = genClientRef();
    const payload = {
      clientRef,
      appointmentId: appointmentId || undefined,
      walkInId: walkInId || undefined,
      customerId: customerId || undefined,
      discountCents: money.discount,
      redeemPoints: money.redeemPts || undefined,
      giftCardCode: giftCard?.code || undefined,
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
      tenders: tenderList,
    };
    setSubmitting(true); setError(null); setOkMsg(null);

    // Save the sale on this device + print, leaving it queued to upload later.
    // Used when offline or if the network drops mid-checkout — the sale is never
    // lost, and the clientRef means re-syncing can't duplicate it. Redeemed points
    // are dropped offline (can't verify the balance) so a queued order is never
    // rejected at sync time.
    const saveOffline = () => {
      queueOrder({ clientRef, payload: { ...payload, redeemPoints: undefined }, at: Date.now(), totalCents: money.total });
      setPendingSync(queueCount());
      printReceipt(`OFF-${clientRef.slice(0, 5).toUpperCase()}`);
      setOkMsg(t('po.savedOffline'));
      broadcastPaid(clientRef);
      clearCart();
      setOnline(false);
    };

    try {
      // Already offline → queue immediately. Gift-card sales need a live balance
      // check, so they can't be queued — ask the cashier to retry when back online.
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        if (giftCard) { setError(t('po.gcOffline')); return; }
        saveOffline(); return;
      }
      try {
        const order = await apiFetch<{ orderNumber: number }>('/pos/orders', { method: 'POST', token, body: payload });
        printReceipt(order.orderNumber);
        setOkMsg(t('po.paidOk').replace('{n}', String(order.orderNumber)));
        broadcastPaid(clientRef);
        clearCart();
        setOnline(true);
        setPendingSync(queueCount());
        load(); // refresh stock
      } catch (err) {
        // A real server rejection (bad data / auth) → show it. A network failure
        // (no response) → save the sale offline so nothing is lost.
        if (err instanceof ApiError) { setError(err.message || t('po.payFail')); return; }
        if (giftCard) { setError(t('po.gcOffline')); return; }
        saveOffline();
      }
    } finally {
      setSubmitting(false);
    }
  }

  function printReceipt(orderNumber: number | string) {
    // Route to the reception-desk printer (via the print agent) when enabled on
    // this device; otherwise print locally on the phone. If sending to reception
    // fails (offline / agent down), fall back to local print so the receipt is
    // never lost.
    if (printToReception) {
      const text = buildReceiptText(orderNumber);
      apiFetch('/print-jobs', { method: 'POST', token, body: { title: `Receipt #${orderNumber}`, text } })
        .then(() => setOkMsg(t('po.sentToReception').replace('{n}', String(orderNumber))))
        .catch(() => localPrint(orderNumber));
      return;
    }
    localPrint(orderNumber);
  }

  /** Plain-text receipt (≈32 cols) for the reception thermal printer. */
  function buildReceiptText(orderNumber: number | string): string {
    const W = 32;
    const row = (l: string, r: string) => {
      const left = l.length > W - r.length - 1 ? l.slice(0, W - r.length - 1) : l;
      return left + ' '.repeat(Math.max(1, W - left.length - r.length)) + r;
    };
    const center = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s;
    const sep = '-'.repeat(W);
    const items = cart
      .map((l) => {
        let s = row(`${l.quantity}x ${l.name}`, formatPrice(l.unitPriceCents * l.quantity, currency));
        if (l.staffMemberId) s += `\n  ${staffName(l.staffMemberId)}`;
        if (l.tipCents) s += `\n  Tip: ${formatPrice(l.tipCents, currency)}`;
        return s;
      })
      .join('\n');
    let o = center('RECEIPT') + '\n' + center(`Order #${orderNumber}`) + '\n' + center(new Date().toLocaleString('en-US')) + '\n' + sep + '\n';
    o += items + '\n' + sep + '\n';
    o += row('Subtotal', formatPrice(money.subtotal, currency)) + '\n';
    if (money.discount) o += row('Discount', '-' + formatPrice(money.discount, currency)) + '\n';
    if (money.tax) o += row('Tax', formatPrice(money.tax, currency)) + '\n';
    if (money.tip) o += row('Tip', formatPrice(money.tip, currency)) + '\n';
    o += row('TOTAL', formatPrice(money.total, currency)) + '\n';
    o += row(`Paid (${payMethod})`, formatPrice(money.tenderedCents || money.total, currency)) + '\n';
    if (money.change) o += row('Change', formatPrice(money.change, currency)) + '\n';
    o += sep + '\n' + center('Thank you!') + '\n';
    return o;
  }

  function localPrint(orderNumber: number | string) {
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
      </body></html>`;
    // Print via a hidden same-page iframe. Reliable on iOS Safari + Android Chrome
    // (window.open popups are blocked on mobile) and uses the phone's built-in
    // print (AirPrint / Android Print) — staff can print or save/share a PDF.
    const prev = document.getElementById('lumio-print-frame');
    if (prev) prev.remove();
    const iframe = document.createElement('iframe');
    iframe.id = 'lumio-print-frame';
    Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', opacity: '0' });
    document.body.appendChild(iframe);
    const win = iframe.contentWindow;
    const doc = win?.document;
    if (!win || !doc) return;
    doc.open(); doc.write(html); doc.close();
    let printed = false;
    const fire = () => { if (printed) return; printed = true; try { win.focus(); win.print(); } catch { /* ignore */ } };
    iframe.onload = () => setTimeout(fire, 60);
    setTimeout(fire, 400); // fallback if onload doesn't fire (some mobile browsers)
    setTimeout(() => iframe.remove(), 60000);
  }

  if (loading) return <p style={{ color: '#94a3b8' }}>{t('po.loadingReg')}</p>;

  return (
    <section style={{ paddingBottom: isMobile ? (mobileView === 'catalog' ? 96 : 24) : undefined }}>
      <style>{`
        .pos-card { transition: border-color .12s ease, background .12s ease, transform .06s ease; }
        .pos-card:hover { border-color: #6366f1 !important; background: #1e293b !important; }
        .pos-card:active { transform: scale(.97); }
      `}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>{t('po.title')}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#cbd5e1', cursor: 'pointer' }}>
            <input type="checkbox" checked={printToReception} onChange={(e) => toggleReception(e.target.checked)} style={{ width: 16, height: 16 }} />
            🖨️ {t('po.printReception')}
          </label>
          <button onClick={park} disabled={cart.length === 0} title={lang === 'vi' ? 'Giữ bill hiện tại để phục vụ khách khác' : 'Hold the current ticket to serve someone else'} style={{ ...ghost, opacity: cart.length ? 1 : 0.5, cursor: cart.length ? 'pointer' : 'default' }}>⏸️ {lang === 'vi' ? 'Giữ bill' : 'Hold'}</button>
          <button onClick={() => { loadHeld(); setShowHeld(true); }} style={{ ...ghost }}>🧾 {lang === 'vi' ? 'Bill chờ' : 'Held'}{heldBills.length ? ` (${heldBills.length})` : ''}</button>
          <a href="/salon/products" style={{ ...ghost, textDecoration: 'none' }}>{t('po.manageProducts')}</a>
        </div>
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
      {!online && (
        <div style={{ background: '#78350f', color: '#fde68a', padding: '10px 14px', borderRadius: 8, fontSize: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>📴</span> {t('po.offlineMode')}
        </div>
      )}
      {pendingSync > 0 && (
        <div style={{ background: '#1e293b', border: '1px solid #475569', color: '#cbd5e1', padding: '8px 14px', borderRadius: 8, fontSize: 13, marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span>⏳ {t('po.pendingSync').replace('{n}', String(pendingSync))}</span>
          {online && <button onClick={syncPending} style={{ ...ghost, padding: '6px 12px', fontSize: 13 }}>{t('po.syncNow')}</button>}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: isMobile ? 12 : 16, alignItems: 'start' }}>
        {/* Catalog */}
        {(!isMobile || mobileView === 'catalog') && (
        <div style={{ ...ui.card, display: 'flex', flexDirection: 'column', maxHeight: isMobile ? 'none' : 'calc(100vh - 130px)' }}>
          {/* Tabs with counts */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <button onClick={() => setTab('SERVICE')} style={tabBtn(tab === 'SERVICE')}>{t('po.tabServices')}<TabCount n={services.length} active={tab === 'SERVICE'} /></button>
            <button onClick={() => setTab('ADDON')} style={tabBtn(tab === 'ADDON')}>{t('po.tabAddons')}<TabCount n={addons.length} active={tab === 'ADDON'} /></button>
            <button onClick={() => setTab('PRODUCT')} style={tabBtn(tab === 'PRODUCT')}>{t('po.tabProducts')}<TabCount n={products.length} active={tab === 'PRODUCT'} /></button>
          </div>

          {/* Barcode scan: a USB scanner types the code + Enter; the camera button
              opens a live scanner. Both match a product by barcode and add it. */}
          <div style={{ display: 'flex', gap: 6, marginBottom: scanMsg ? 6 : 12 }}>
            <input
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); scanLookup(scanInput); } }}
              placeholder={t('po.scanPlaceholder')}
              style={{ ...ui.input, flex: 1, padding: '8px 10px' }}
            />
            <button type="button" onClick={() => setShowScanner(true)} style={{ ...ghost, padding: '8px 12px', whiteSpace: 'nowrap' }}>📷 {t('po.scanCamera')}</button>
          </div>
          {scanMsg && (
            <div style={{ fontSize: 12, color: scanMsg.ok ? '#22c55e' : '#f59e0b', marginBottom: 10 }}>{scanMsg.text}</div>
          )}

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
        )}

        {/* Ticket */}
        {(!isMobile || mobileView === 'ticket') && (
        <div style={{ ...ui.card, position: isMobile ? 'static' : 'sticky', top: 12 }}>
          {isMobile && (
            <button onClick={() => setMobileView('catalog')} style={{ ...ghost, marginBottom: 12, padding: '8px 12px', fontSize: 14 }}>← {t('po.backToCatalog')}</button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, margin: '0 0 12px' }}>
            <h2 style={{ fontSize: 15, margin: 0 }}>{t('po.ticket')}</h2>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => { enableIpad(); setIpadPanel(true); }} title={t('po.ipadHint')} style={{ ...ghost, padding: '5px 10px', fontSize: 12, whiteSpace: 'nowrap' }}>📱 {t('po.ipad')}</button>
              <button onClick={openCustomerScreen} title={t('po.custScreenHint')} style={{ ...ghost, padding: '5px 10px', fontSize: 12, whiteSpace: 'nowrap' }}>🖥️ {t('po.custScreen')}</button>
            </div>
          </div>
          {ipadPanel && <IpadPairPanel session={displaySession} onRotate={rotateDisplay} onClose={() => setIpadPanel(false)} t={t} />}

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
            {loyalty.enabled && customerId && online && (
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

          {/* Gift card redemption (online only — needs a live balance check) */}
          {online && (
            <div style={{ marginBottom: 10 }}>
              {giftCard ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#0f172a', border: '1px solid #155e75', borderRadius: 8, padding: '8px 10px' }}>
                  <span style={{ fontSize: 13, color: '#a5f3fc' }}>🎁 {giftCard.code} · {formatPrice(money.giftApplied, currency)}</span>
                  <button onClick={() => setGiftCard(null)} style={{ ...ghost, padding: '4px 10px', fontSize: 12 }}>{t('po.gcRemove')}</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={giftInput}
                    onChange={(e) => setGiftInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyGift(); } }}
                    placeholder={t('po.gcPlaceholder')}
                    style={{ ...ui.input, flex: 1, padding: '7px 9px' }}
                  />
                  <button type="button" onClick={applyGift} style={{ ...ghost, padding: '7px 12px', fontSize: 13, whiteSpace: 'nowrap' }}>🎁 {t('po.gcApply')}</button>
                </div>
              )}
            </div>
          )}
          {giftCard && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, fontSize: 16, fontWeight: 700 }}>
              <span>{t('po.gcDue')}</span><span style={{ color: '#22c55e' }}>{formatPrice(money.due, currency)}</span>
            </div>
          )}

          {/* Direct tip to the tech(s) on this ticket — scan their QR. */}
          {tipTechs.length > 0 && (
            <div style={{ marginBottom: 12, border: '1px solid #155e75', borderRadius: 10, padding: 10, background: '#0f172a' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#a5f3fc', marginBottom: 4 }}>💸 {t('po.tipTitle')}</div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>{t('po.tipQrAfterNote')}</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>
                {t('po.tipSuggest')}: 15% {formatPrice(Math.round(money.subtotal * 0.15), currency)} · 18% {formatPrice(Math.round(money.subtotal * 0.18), currency)} · 20% {formatPrice(Math.round(money.subtotal * 0.2), currency)}
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {tipTechs.map((s) => (
                  <div key={s.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 3, width: 150 }}>
                    <span style={{ fontSize: 13, color: '#e2e8f0', textAlign: 'center', fontWeight: 600 }}>{s.firstName} {s.lastName ?? ''}</span>
                    {s.tipHandle && <span style={{ fontSize: 11, color: '#64748b', textAlign: 'center' }}>{s.tipHandle}</span>}
                    <div style={{ display: 'flex', gap: 4, marginTop: 4, width: '100%' }}>
                      <input
                        type="number" min={0} step="0.01" placeholder="$"
                        value={tipLogInput[s.id] || ''}
                        onChange={(e) => setTipLogInput((m) => ({ ...m, [s.id]: e.target.value }))}
                        style={{ ...ui.input, width: 60, padding: '4px 6px', fontSize: 12, textAlign: 'right' }}
                      />
                      <button onClick={() => logDirectTip(s.id)} disabled={tipBusy === s.id} style={{ flex: 1, padding: '4px 6px', fontSize: 11, borderRadius: 6, border: '1px solid #0e7490', background: '#155e75', color: '#e0f2fe', cursor: 'pointer', fontWeight: 600 }}>
                        {tipBusy === s.id ? '…' : t('po.tipLogBtn')}
                      </button>
                    </div>
                    {tipLogged[s.id] > 0 && (
                      <span style={{ fontSize: 11, color: '#34d399', fontWeight: 600 }}>✓ {formatPrice(tipLogged[s.id], currency)}</span>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>{t('po.tipLogHint')}</div>
            </div>
          )}

          {/* Payment method + split toggle */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
            {!split && <>
              <button onClick={() => setPayMethod('CASH')} style={tabBtn(payMethod === 'CASH')}>{t('po.cash')}</button>
              <button onClick={() => setPayMethod('CARD')} style={tabBtn(payMethod === 'CARD')}>{t('po.card')}</button>
              <button onClick={() => setPayMethod('TRANSFER')} style={tabBtn(payMethod === 'TRANSFER')}>{t('po.transfer')}</button>
            </>}
            {split && <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: '#c7d2fe' }}>➗ {t('po.splitTitle')}</span>}
            <button
              onClick={() => {
                if (split) { setSplit(false); setParts([]); }
                else {
                  setSplit(true);
                  // Seed two parts: the whole due on cash, 0 on card — the cashier edits.
                  setParts([{ method: 'CASH', amount: (money.due / 100).toFixed(2) }, { method: 'CARD', amount: '' }]);
                }
              }}
              style={{ ...chip, borderColor: split ? '#6366f1' : '#334155', color: split ? '#c7d2fe' : '#94a3b8', whiteSpace: 'nowrap' }}>
              {split ? t('po.splitOff') : `➗ ${t('po.splitOn')}`}
            </button>
          </div>

          {split && (
            <div style={{ border: '1px solid #334155', borderRadius: 10, padding: 10, marginBottom: 10 }}>
              {parts.map((p, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <select value={p.method} onChange={(e) => setParts((ps) => ps.map((x, j) => j === i ? { ...x, method: e.target.value as 'CASH' | 'CARD' | 'TRANSFER' } : x))}
                    style={{ ...ui.input, width: 130, padding: '7px 8px' }}>
                    <option value="CASH">{t('po.cash')}</option>
                    <option value="CARD">{t('po.card')}</option>
                    <option value="TRANSFER">{t('po.transfer')}</option>
                  </select>
                  <input type="number" min={0} step="0.01" value={p.amount} placeholder="0.00"
                    onChange={(e) => setParts((ps) => ps.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))}
                    style={{ ...ui.input, flex: 1, padding: '7px 8px', textAlign: 'right' }} />
                  {/* Fill this part with whatever is still owed */}
                  <button onClick={() => {
                    const others = parts.reduce((a, x, j) => a + (j === i ? 0 : Math.round((parseFloat(x.amount) || 0) * 100)), 0);
                    const rest = Math.max(0, money.due - others);
                    setParts((ps) => ps.map((x, j) => j === i ? { ...x, amount: (rest / 100).toFixed(2) } : x));
                  }} style={{ ...chip, whiteSpace: 'nowrap' }}>{t('po.splitRest')}</button>
                  {parts.length > 2 && <button onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))} style={{ ...chip, color: '#f87171', borderColor: '#7f1d1d' }}>✕</button>}
                </div>
              ))}
              {parts.length < 4 && (
                <button onClick={() => setParts((ps) => [...ps, { method: 'CARD', amount: '' }])} style={{ ...chip, marginBottom: 8 }}>+ {t('po.splitAdd')}</button>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, borderTop: '1px solid #334155', paddingTop: 8 }}>
                <span style={{ color: '#94a3b8' }}>{money.splitRemaining > 0 ? t('po.splitRemaining') : t('po.change')}</span>
                <span style={{ color: money.splitRemaining > 0 ? '#f59e0b' : '#22c55e' }}>
                  {formatPrice(Math.abs(money.splitRemaining), currency)}
                </span>
              </div>
            </div>
          )}

          {!split && (<>

          {payMethod === 'CASH' && (
            <>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                <button onClick={() => setTendered((money.due / 100).toFixed(2))} style={chip}>{t('po.exact')}</button>
                {quickCash(money.due).map((amt) => (
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
            <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 10 }}>{t('po.cardHint').replace('{x}', formatPrice(money.due, currency))}</p>
          )}
          {payMethod === 'TRANSFER' && (
            <div style={{ marginBottom: 10 }}>
              {transferInfo || transferQr ? (
                <div style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>{t('po.transferShow').replace('{x}', formatPrice(money.due, currency))}</div>
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

          </>)}

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={clearCart} disabled={cart.length === 0} style={{ ...ghost, flex: 1 }}>{t('po.clear')}</button>
            <button onClick={pay} disabled={submitting || cart.length === 0} style={{ ...ui.primaryBtn, flex: 2, padding: '12px', fontSize: 15 }}>
              {submitting ? t('po.processing') : t('po.payPrint').replace('{x}', formatPrice(money.due, currency))}
            </button>
          </div>
        </div>
        )}
      </div>

      {/* Mobile: sticky total + go-to-ticket bar so checkout is one tap away. */}
      {isMobile && mobileView === 'catalog' && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))', zIndex: 45, background: '#111827', borderTop: '1px solid #334155', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 -4px 16px rgba(0,0,0,0.4)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>{cart.length} {t('po.itemsWord')}</div>
            <div style={{ fontSize: 19, fontWeight: 800, color: '#22c55e' }}>{formatPrice(money.total, currency)}</div>
          </div>
          <button onClick={() => setMobileView('ticket')} style={{ ...ui.primaryBtn, padding: '12px 20px', fontSize: 15, whiteSpace: 'nowrap' }}>{t('po.viewTicket')} →</button>
        </div>
      )}

      {showScanner && (
        <BarcodeScanner
          title={t('po.scanTitle')}
          hint={t('po.scanHint')}
          errorText={t('po.scanError')}
          onDetect={(code) => { setShowScanner(false); scanLookup(code); }}
          onClose={() => setShowScanner(false)}
        />
      )}

      {showHeld && typeof document !== 'undefined' && createPortal(
        <div onClick={() => setShowHeld(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.7)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...ui.card, width: 'min(460px, 96vw)', maxHeight: '85vh', overflowY: 'auto', padding: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid #1e293b' }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0' }}>{lang === 'vi' ? 'Bill đang giữ' : 'Held bills'} {heldBills.length ? `(${heldBills.length})` : ''}</div>
              <button onClick={() => setShowHeld(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ padding: 12 }}>
              {heldBills.length === 0 ? <div style={{ color: '#64748b', fontSize: 13, padding: 8 }}>{lang === 'vi' ? 'Chưa có bill nào được giữ.' : 'No held bills.'}</div>
                : heldBills.map((h) => (
                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 8px', borderBottom: '1px solid #1e293b' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.label || 'Walk-in'}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{formatPrice(h.totalCents, currency)} · {new Date(h.createdAt).toLocaleTimeString(lang === 'vi' ? 'vi-VN' : 'en-US', { hour: 'numeric', minute: '2-digit' })}</div>
                    </div>
                    <button onClick={() => recall(h)} style={{ ...ui.primaryBtn, padding: '7px 14px' }}>{lang === 'vi' ? 'Mở lại' : 'Recall'}</button>
                    <button onClick={() => deleteHeld(h.id)} aria-label="delete" style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 18, cursor: 'pointer' }}>×</button>
                  </div>
                ))}
            </div>
          </div>
        </div>, document.body)}
    </section>
  );
}

// Pairing panel: link a wireless iPad as the customer screen. Scan the QR (or open
// the short link and type the code) ONCE on the iPad — it then mirrors this register
// over the network and takes after-payment QR tips.
function IpadPairPanel({ session, onRotate, onClose, t }: {
  session: { pairCode: string; pairUrl: string; displayUrl: string } | null;
  onRotate: () => void; onClose: () => void; t: (k: string) => string;
}) {
  const [qrFailed, setQrFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const code = session?.pairCode ?? '••••••';
  const displayUrl = session?.displayUrl ?? 'lumiobooking.com/display';
  const pairUrl = session?.pairUrl ?? '';
  const qrSrc = pairUrl ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(pairUrl)}` : '';
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 16, padding: 22, width: 'min(94vw, 430px)', color: '#e2e8f0', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>📱 {t('po.ipadTitle')}</h3>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>{t('po.ipadStep')}</p>
        {qrSrc && !qrFailed && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc} alt="Pairing QR" onError={() => setQrFailed(true)} style={{ width: 200, height: 200, borderRadius: 12, background: '#fff', padding: 8 }} />
          </div>
        )}
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>{t('po.ipadOpenOn')} <strong style={{ color: '#e2e8f0' }}>{displayUrl}</strong></div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>{t('po.ipadCodeLabel')}</div>
          <div style={{ fontSize: 34, fontWeight: 900, letterSpacing: 6, color: '#a5f3fc', fontFamily: 'monospace' }}>{code}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button onClick={() => { if (pairUrl) { navigator.clipboard?.writeText(pairUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } }} style={{ ...ghost, padding: '8px 14px', fontSize: 13 }}>{copied ? '✓' : t('po.ipadCopyLink')}</button>
          <button onClick={onRotate} style={{ ...ghost, padding: '8px 14px', fontSize: 13 }}>{t('po.ipadNewCode')}</button>
        </div>
        <p style={{ margin: '14px 0 0', fontSize: 11.5, color: '#64748b', lineHeight: 1.5 }}>{t('po.ipadNote')}</p>
      </div>
    </div>
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
  const [nf, setNf] = useState({ firstName: '', phone: '', email: '', birthDate: '' });
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
      const c = await apiFetch<CustomerHit>('/customers', { method: 'POST', token, body: { firstName: nf.firstName.trim() || undefined, phone: nf.phone.trim(), email: nf.email.trim() || undefined, birthDate: nf.birthDate || undefined } });
      onPick(c.id, hitLabel(c), c.loyaltyPoints ?? 0);
      setAdding(false); setNf({ firstName: '', phone: '', email: '', birthDate: '' }); setQ('');
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>🎂 {t('po.custBirthday')}</span>
          <input lang="en-US" type="date" value={nf.birthDate} onChange={(e) => setNf({ ...nf, birthDate: e.target.value })} style={{ ...ui.input, flex: 1, padding: '6px 9px', fontSize: 13 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>✉️ {t('po.custEmail')}</span>
          <input type="email" value={nf.email} onChange={(e) => setNf({ ...nf, email: e.target.value })} placeholder="name@email.com" style={{ ...ui.input, flex: 1, padding: '6px 9px', fontSize: 13 }} />
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
          {t('po.custNone')} <button type="button" onClick={() => { setAdding(true); setNf({ firstName: '', phone: q.replace(/[^\d+]/g, ''), email: '', birthDate: '' }); }} style={{ background: 'none', border: 'none', color: '#818cf8', cursor: 'pointer', fontSize: 12, padding: 0 }}>＋ {t('po.custAdd')}</button>
        </div>
      )}
    </div>
  );
}
