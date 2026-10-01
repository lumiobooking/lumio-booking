'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtInTz } from '../../../lib/datetime';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { useIsMobile } from '../../../lib/responsive';
import { payLabel, tillMethodsFrom, type PayMethod } from '../../../lib/payment-methods';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch, ApiError } from '../../../lib/api';
import { cacheCatalog, readCachedCatalog, genClientRef, queueOrder, queueCount, syncQueue } from '../../../lib/offlinePos';
import { ui, formatPrice, toMinorUnits, fromMinorUnits } from '../../../lib/ui';
import { useHorizontalScroll } from '../../../lib/useHorizontalScroll';
import { currencySymbolFor } from '../../../lib/money';
import { setUiCurrency, uiCurrencySymbol } from '../../../lib/ui-currency';
import { useLang, tr, setUiCurrencySymbol } from '../../../lib/i18n';
import { BarcodeScanner } from '../../../components/BarcodeScanner';
import { CashShiftPanel, useShiftState } from '../../../components/CashShiftPanel';
import { RebookSheet, type RebookResult } from '../../../components/RebookSheet';
import { FeedbackStatus } from '../../../components/feedback/FeedbackStatus';
import { uiLocale } from '../../../lib/datetime';

interface Service { id: string; name: string; priceCents: number; discountPercent?: number; durationMinutes: number; isActive: boolean; priceFrom?: boolean; imageUrl?: string | null; category?: { id: string; name: string } | null }
interface Product { id: string; name: string; priceCents: number; discountPercent?: number; isActive: boolean; trackStock: boolean; stockQty: number; barcode?: string | null; imageUrl?: string | null }
interface Addon { id: string; name: string; priceCents: number; durationMinutes: number; serviceId: string; service: { name: string } | null }
interface Staff { id: string; firstName: string; lastName: string | null; isActive: boolean; tipQrUrl?: string | null; tipHandle?: string | null }
interface CustomerHit { id: string; firstName: string; lastName?: string | null; phone?: string | null; loyaltyPoints?: number }
interface CatalogCache {
  services: Service[]; products: Product[]; addons: Addon[]; staff: Staff[];
  taxRate: number; cardSurchargePct: number; cardSurchargeOn: boolean; transferInfo: string; transferQr: string; currency: string;
  payDetails?: Record<string, { instructions?: string; qrUrl?: string }>;
  tipsOn?: boolean;
  tillMethods?: PayMethod[];
  loyalty: { enabled: boolean; redeemCentsPerPoint: number; minRedeemPoints: number };
  salonName?: string; salonLogo?: string; salonAccent?: string; salonWelcome?: string;
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
  // On a group ticket, whose appointment this line came from — so the till can
  // write each person's total back to their own booking.
  apptId?: string;
}

let uidSeq = 1;

/**
 * Money on the till, written the way the salon's OWN currency is written.
 *
 * The dashboard formats money by the UI language, so a US salon whose owner
 * reads the app in Vietnamese saw "44,00 US$" on every tile, total and
 * receipt. Nobody in that salon writes a dollar that way — the till and the
 * receipt the client takes home say "$44.00". A Vietnamese salon still gets
 * "200.000 ₫". Only the register uses this; the rest of the app is unchanged.
 */
const MONEY_LOCALE: Record<string, string> = { USD: 'en-US', CAD: 'en-CA', AUD: 'en-AU', NZD: 'en-NZ', GBP: 'en-GB', VND: 'vi-VN', EUR: 'de-DE', SGD: 'en-SG' };
function posMoney(minorUnits: number, currency?: string): string {
  if (!currency) return formatPrice(minorUnits);
  try {
    const nf = new Intl.NumberFormat(MONEY_LOCALE[currency] ?? 'en-US', { style: 'currency', currency });
    const digits = nf.resolvedOptions().maximumFractionDigits ?? 2;
    return nf.format(digits === 0 ? minorUnits : minorUnits / 10 ** digits);
  } catch {
    return formatPrice(minorUnits, currency);
  }
}

/** "GEL – POLISH PEDICURE" reads as shouting on a chip; show it as "Gel – Polish Pedicure". Mixed-case names are left exactly as typed. */
function niceName(n: string): string {
  if (n.length < 4 || n !== n.toUpperCase() || n === n.toLowerCase()) return n;
  return n.toLowerCase().replace(/(^|[\s\-–/(&+])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
}

// Full-screen register layout ("wide"). Live for every salon. A cashier can
// still force either layout for their own browser with ?ui=v2 / ?ui=v1 — kept
// as an escape hatch on an odd screen, not as a rollout switch.
const POS_V2_ALL = true;
const POS_V2_PILOT: string[] = [];

export default function PosPage() {
  const { lang } = useLang();
  return (
    <SalonShell>
      <Suspense fallback={<p style={{ color: 'var(--c94a3b8)' }}>{tr('po.loadingReg', lang)}</p>}>
        <Register />
      </Suspense>
    </SalonShell>
  );
}

function Register() {
  const { token, user } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  /**
   * A PHONE AND A TABLET SHARE ONE REGISTER.
   *
   * Two panes on an iPad were tried twice. The second attempt was the layout
   * the big registers use, and it still lost: with a 230px menu, a toolbar,
   * a header row and a money block, the one thing a ticket exists to show —
   * the line items — had ~130px left on a landscape iPad and none in
   * portrait. The owner asked for the phone flow instead, and the phone flow
   * is the better trade on this screen size: the catalog gets the whole
   * width (five tiles across, not two), and the ticket gets the whole
   * height. One tap moves between them; the running total is always on the
   * bar at the bottom.
   *
   *   phone    — a real phone (≤768px): also has the app's bottom tab bar.
   *   tablet   — 769–1180px: same two-view flow, no tab bar to clear.
   *   isMobile — either; this is the layout flag the rest of the file reads.
   */
  const phone = useIsMobile();
  const tablet = useIsMobile(1180);
  const isMobile = phone || tablet;
  const params = useSearchParams();
  const [uiPref, setUiPref] = useState<'v1' | 'v2' | null>(null);
  // Real browser full screen (same as the calendar): the register fills the
  // monitor so the customer can follow the bill from across the counter.
  const [fullscreen, setFullscreen] = useState(false);
  const toggleFull = useCallback(() => {
    setFullscreen((f) => {
      const next = !f;
      try {
        if (next) { document.documentElement.requestFullscreen?.().catch(() => undefined); }
        else if (document.fullscreenElement) { document.exitFullscreen?.().catch(() => undefined); }
      } catch { /* not supported */ }
      return next;
    });
  }, []);
  useEffect(() => {
    // Esc leaves browser full screen without telling React — listen for it.
    const onFs = () => { if (!document.fullscreenElement) setFullscreen(false); };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  useEffect(() => {
    const q = params.get('ui');
    if (q === 'v1' || q === 'v2') { try { localStorage.setItem('lumio_pos_ui', q); } catch { /* private mode */ } setUiPref(q); return; }
    try { const saved = localStorage.getItem('lumio_pos_ui'); if (saved === 'v1' || saved === 'v2') setUiPref(saved); } catch { /* private mode */ }
  }, [params]);
  // The wide layout only applies to desktop; phones keep the two-view flow.
  const pilot = POS_V2_ALL
    || POS_V2_PILOT.includes((user?.email ?? '').toLowerCase())
    || POS_V2_PILOT.includes(user?.tenantId ?? '\u0000');
  // Tablets are `isMobile` now (see the flags at the top), so `wide` is a
  // desktop-only question: the pilot's two-pane register, or the older one.
  const wide = !isMobile && (uiPref ? uiPref === 'v2' : pilot);
  /**
   * WHAT THE BIG REGISTERS AGREE ON, AND WHAT THIS SCREEN KEEPS FROM THEM.
   *
   * Square, Toast, Clover, Lightspeed and the salon ones (Fresha, Mangomint,
   * Boulevard) converge on the same checkout: a catalog that is one row of
   * categories, one search and big tiles; a ticket that is customer → line
   * items → totals → one pay button; discounts, promo codes and gift cards a
   * tap away, never permanently on screen; and an empty cart that looks
   * empty. Those rules apply on every screen size here. What differs by size
   * is only whether the catalog and the ticket share the screen (desktop) or
   * take turns (phone and tablet — `compact`), and whether payment is inline
   * (desktop) or a sheet (compact).
   */
  const compact = isMobile;
  /** The adjustments drawer (promo / discount / gift card) on a compact ticket. */
  const [adjOpen, setAdjOpen] = useState(false);
  /** The payment sheet on a compact screen — see the note where it opens. */
  const [payOpen, setPayOpen] = useState(false);
  // When opened from a booking's "Checkout" button these are pre-filled.
  const [appointmentId, setAppointmentId] = useState<string | null>(() => params.get('appointmentId'));
  // A party's bill: read from the URL once, cleared when the till starts a new bill.
  const [groupId, setGroupId] = useState<string | null>(() => params.get('groupId'));
  // Settling a whole party on one bill: every appointment in the group.
  const [groupApptIds, setGroupApptIds] = useState<string[]>([]);
  const [walkInId, setWalkInId] = useState<string | null>(() => params.get('walkInId'));
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
  const [cardSurchargePct, setCardSurchargePct] = useState(0);
  const [cardSurchargeOn, setCardSurchargeOn] = useState(false);
  // Whether this salon asks for a tip at all. True everywhere it always was;
  // a salon in a country with no tipping culture turns it off in Settings and
  // the whole prompt disappears rather than showing a 0% option.
  const [tipsOn, setTipsOn] = useState(true);
  // Which payment buttons this till shows, resolved server-side from the
  // salon's own choice or its market. Seeded with the three every till has
  // always had so a slow settings call never leaves the cashier without a
  // button while a customer is standing there.
  const [tillMethods, setTillMethods] = useState<PayMethod[]>(['CASH', 'CARD', 'TRANSFER']);
  const [currency, setCurrency] = useState('USD');
  const [salonName, setSalonName] = useState('');
  const [salonLogo, setSalonLogo] = useState('');
  const [salonAccent, setSalonAccent] = useState('#6366f1');
  const [salonWelcome, setSalonWelcome] = useState('');
  const [reviewUrl, setReviewUrl] = useState<string | null>(null); // salon Google-review link for the customer display
  const [transferInfo, setTransferInfo] = useState('');
  const [transferQr, setTransferQr] = useState('');
  // Per-method bank details / QR. VietQR, MoMo and ZaloPay are three different
  // images, so one shared field showed the cashier the wrong code — or none.
  const [payDetails, setPayDetails] = useState<Record<string, { instructions?: string; qrUrl?: string }>>({});
  const [tab, setTab] = useState<'SERVICE' | 'ADDON' | 'PRODUCT'>('SERVICE');
  // A phone does not draw an empty tab (see the tab row), so a tab that
  // emptied out from under the cashier falls back to services rather than
  // leaving them on a screen with no button to get off it.
  useEffect(() => {
    if ((tab === 'ADDON' && addons.length === 0) || (tab === 'PRODUCT' && products.length === 0)) setTab('SERVICE');
  }, [tab, addons.length, products.length]);
  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState<string | null>(null); // service category id, null = all
  const [cart, setCart] = useState<Line[]>([]);
  // A sale that went through empties the cart; the compact payment sheet has
  // nothing left to take and closes itself, so the next customer starts on
  // the catalog. (payOpen is declared above, with the layout flags.)
  useEffect(() => { if (cart.length === 0) setPayOpen(false); }, [cart.length]);
  const [heldBills, setHeldBills] = useState<{ id: string; label: string | null; totalCents: number; payload: unknown; createdAt: string }[]>([]);
  const [showHeld, setShowHeld] = useState(false);
  // Cashier shift: the drawer this till is selling into. The badge in the
  // header says whose shift is open; a salon that requires one cannot ring up
  // a live sale until somebody has opened the till.
  const [showShift, setShowShift] = useState(false);
  const shiftCtl = useShiftState(token);
  const [orderDiscount, setOrderDiscount] = useState('');
  const [discountMode, setDiscountMode] = useState<'AMOUNT' | 'PERCENT'>('AMOUNT');
  // Promo code from a marketing campaign (win-back / reactivation / birthday).
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState<{ code: string; label: string; kind: string; value: number; appliesDiscount: boolean } | null>(null);
  const [promoErr, setPromoErr] = useState<string | null>(null);
  // Code the booking arrived with. Kept in its own state so the lookup below is
  // not cancelled when the prefill effect re-runs.
  const [bookedOffer, setBookedOffer] = useState<string | null>(null);
  // Cash-tip logging is an occasional correction, not part of taking payment.
  const [tipOpen, setTipOpen] = useState(false);
  const [promoBusy, setPromoBusy] = useState(false);
  const [payMethod, setPayMethod] = useState<PayMethod>('CASH');
  const [tendered, setTendered] = useState('');
  // Split payment: one bill settled with several methods (e.g. part cash, part card).
  // Off by default — the common one-method flow above stays untouched.
  const [split, setSplit] = useState(false);
  const [parts, setParts] = useState<{ method: PayMethod; amount: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // Card terminal (Payment Hub) — optional. When a reader is connected, paying by
  // CARD collects on the physical reader before the sale is recorded.
  const [hubConn, setHubConn] = useState<{ provider: string } | null>(null);
  const [hubReaders, setHubReaders] = useState<{ id: string; externalReaderId: string; label?: string | null; status: string }[]>([]);
  const [hubReader, setHubReader] = useState<string>('');
  const [charging, setCharging] = useState(false);
  // Set when the terminal neither approved nor declined in time. The sale is
  // blocked in this state on purpose: the card may already have been charged,
  // so the cashier must resolve it instead of retrying.
  const [cardStuck, setCardStuck] = useState<{ intentId: string; note: string } | null>(null);
  const [cardWait, setCardWait] = useState(0);
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
  // Per-device: print a receipt at all when a sale completes. On by default —
  // it is what the till always did — and switchable on the payment screen.
  const [printOn, setPrintOn] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try { return localStorage.getItem('lumio_pos_print') !== '0'; } catch { return true; }
  });
  const togglePrint = (v: boolean) => {
    setPrintOn(v);
    try { localStorage.setItem('lumio_pos_print', v ? '1' : '0'); } catch { /* ignore */ }
  };
  /** The sale that just went through — drives the "Hoàn tất" screen. */
  const [done, setDone] = useState<null | { label: string; offline: boolean; paidCents: number; changeCents: number; method: string; customer: string | null; printed: boolean }>(null);
  // "Same again in two weeks?" — the next visit, booked from the Paid screen.
  const [showRebook, setShowRebook] = useState(false);
  /** The "how was your visit?" for the sale just taken — the Paid screen shows a neutral status. */
  const [fbReq, setFbReq] = useState<{ orderId: string; status: string; onScreen: boolean } | null>(null);
  /** The lines of the bill that just went through — the till clears the cart on payment, the rebook sheet still needs them. */
  const paidLinesRef = useRef<Line[]>([]);
  const [nextVisit, setNextVisit] = useState<RebookResult | null>(null);
  /** The last receipt, kept whole so "In lại" prints the same paper after the bill is cleared. */
  const lastReceiptRef = useRef<{ orderNumber: number | string; text: string; html: string } | null>(null);
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

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const st = await apiFetch<{ enabled: boolean }>('/payments-hub/status', { token });
        if (!st?.enabled) return;
        const cons = await apiFetch<{ provider: string; status: string }[]>('/payments-hub/connections', { token });
        const active = cons.find((c) => c.status === 'ACTIVE');
        if (!active) return;
        setHubConn({ provider: active.provider });
        const rs = await apiFetch<{ id: string; externalReaderId: string; label?: string | null; status: string }[]>(`/payments-hub/readers/${active.provider}`, { token }).catch(() => []);
        setHubReaders(rs);
        const online = rs.find((r) => r.status === 'ONLINE') ?? rs[0];
        if (online) setHubReader(online.externalReaderId);
      } catch { /* hub off / not connected -> CARD stays manual */ }
    })();
  }, [token]);
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
    setTaxRate(c.taxRate); setCardSurchargePct(c.cardSurchargePct ?? 0); setCardSurchargeOn(!!c.cardSurchargeOn); setTransferInfo(c.transferInfo); setTransferQr(c.transferQr); setPayDetails(c.payDetails ?? {}); setCurrency(c.currency);
    setLoyalty(c.loyalty);
    setSalonName(c.salonName ?? ''); setSalonLogo(c.salonLogo ?? ''); setSalonAccent(c.salonAccent ?? '#6366f1'); setSalonWelcome(c.salonWelcome ?? '');
    setTipsOn(c.tipsOn !== false);
    setTillMethods(tillMethodsFrom(c.tillMethods));
    // Exact, from the currency this salon actually counts in — the shell only
    // guessed it from the market.
    setUiCurrency(c.currency);
    setUiCurrencySymbol(currencySymbolFor(c.currency));
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
        apiFetch<{ pos?: { taxRatePercent?: number; cardSurchargePercent?: number; cardSurchargeEnabled?: boolean; transferInstructions?: string; transferQrUrl?: string; tipsEnabled?: boolean; resolvedPaymentMethods?: string[]; paymentDetails?: Record<string, { instructions?: string; qrUrl?: string }> }; booking?: { currency?: string }; loyalty?: { enabled: boolean; redeemCentsPerPoint: number; minRedeemPoints: number }; company?: { name?: string; slug?: string }; branding?: { logoUrl?: string; accentColor?: string; welcomeImageUrl?: string } }>('/settings', { token }),
      ]);
      const cat: CatalogCache = {
        services: s.filter((x) => x.isActive),
        products: p.filter((x) => x.isActive),
        addons: a,
        staff: st.filter((x) => x.isActive),
        taxRate: settings.pos?.taxRatePercent ?? 0,
        cardSurchargePct: settings.pos?.cardSurchargePercent ?? 0,
        cardSurchargeOn: settings.pos?.cardSurchargeEnabled ?? false,
        transferInfo: settings.pos?.transferInstructions ?? '',
        transferQr: settings.pos?.transferQrUrl ?? '',
        payDetails: settings.pos?.paymentDetails ?? {},
        tipsOn: settings.pos?.tipsEnabled !== false,
        // Which buttons this till shows. Resolved server-side from the salon's
        // own choice, else its market — the page just renders what it is given.
        tillMethods: tillMethodsFrom(settings.pos?.resolvedPaymentMethods),
        currency: settings.booking?.currency ?? 'USD',
        loyalty: settings.loyalty
          ? { enabled: settings.loyalty.enabled, redeemCentsPerPoint: settings.loyalty.redeemCentsPerPoint, minRedeemPoints: settings.loyalty.minRedeemPoints }
          : { enabled: false, redeemCentsPerPoint: 5, minRedeemPoints: 100 },
        salonName: settings.company?.name ?? '',
        salonLogo: settings.branding?.logoUrl ?? '',
        salonAccent: settings.branding?.accentColor ?? '#6366f1',
        salonWelcome: settings.branding?.welcomeImageUrl ?? '',
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
      if (services.length === 0) return; // catalog not ready — effect re-runs on load

      // Booking checkout: pull the WHOLE appointment — primary service + every extra
      // service, each already carrying the technician the system auto-assigned. So a
      // multi-service visit checks out with all lines and all techs pre-filled; the
      // front desk just presses Pay. No re-adding services, no re-picking techs.
      if (appointmentId) {
        try {
          // Group ticket: pull every member of the party and lay their lines out
          // one person after another, each prefixed with the name, so the
          // cashier reads a bill and not a jumble of forty services.
          const gid = groupId;
          if (gid) {
            const all = await apiFetch<Array<{
              id: string; groupId?: string | null; priceCents?: number;
              customer: { firstName?: string; lastName?: string | null } | null;
              service: { id: string; name: string } | null;
              assignedStaff: { id: string } | null;
              addons?: Array<{ id?: string; name?: string; priceCents?: number; kind?: string; staffMemberId?: string }>;
            }>>('/bookings', { token });
            const party = all.filter((x) => x.groupId === gid);
            if (alive && party.length > 1) {
              const lines: Line[] = [];
              for (const m of party) {
                const whoName = `${m.customer?.firstName ?? ''} ${m.customer?.lastName ?? ''}`.trim();
                const addonsTotal = (m.addons ?? []).reduce((sum, it) => sum + (it.priceCents ?? 0), 0);
                const primary = Math.max(0, (m.priceCents ?? 0) - addonsTotal);
                if (m.service) {
                  lines.push({
                    uid: `u${uidSeq++}`, kind: 'SERVICE', refId: m.service.id,
                    name: whoName ? `${whoName} · ${m.service.name}` : m.service.name,
                    origUnitPriceCents: primary, unitPriceCents: primary, discountPercent: 0,
                    quantity: 1, tipCents: 0, staffMemberId: m.assignedStaff?.id ?? '', apptId: m.id,
                  });
                }
                for (const it of m.addons ?? []) {
                  lines.push({
                    uid: `u${uidSeq++}`, kind: 'SERVICE', refId: it.id ?? '', isAddon: it.kind !== 'service',
                    name: whoName ? `${whoName} · ${it.name ?? ''}` : (it.name ?? ''),
                    origUnitPriceCents: it.priceCents ?? 0, unitPriceCents: it.priceCents ?? 0,
                    discountPercent: 0, quantity: 1, tipCents: 0,
                    staffMemberId: it.staffMemberId ?? '', apptId: m.id,
                  });
                }
              }
              if (lines.length > 0) {
                setGroupApptIds(party.map((m) => m.id));
                setCart((c) => (c.length === 0 ? lines : c));
                setPrefilled(true);
                return;
              }
            }
          }
          const appt = await apiFetch<{
            priceCents?: number;
            service: { id: string; name: string } | null;
            assignedStaff: { id: string } | null;
            addons?: Array<{ id?: string; name?: string; priceCents?: number; durationMinutes?: number; kind?: string; staffMemberId?: string }>;
            offerCode?: string | null;
          }>(`/bookings/${appointmentId}`, { token });
          if (alive && appt) {
            // The customer booked from a campaign link: the code rode along on
            // the booking, so the till applies it without anyone typing it.
            if (appt.offerCode) setBookedOffer(appt.offerCode);
            const lines: Line[] = [];
            if (appt.service) {
              const s = services.find((x) => x.id === appt.service!.id);
              const base = s?.priceCents ?? 0;
              // The appointment stores the FINAL booked price (service sale +
              // weekday/date promo + visit/group programs, best % per line).
              // Charge THAT — never re-derive from the catalog, or the discount
              // the customer was promised at booking would silently disappear.
              const addonsTotal = (appt.addons ?? []).reduce((sum, it) => sum + (it.priceCents ?? 0), 0);
              const savedPrimary = Math.max(0, (appt.priceCents ?? 0) - addonsTotal);
              const legacyD = s?.discountPercent ?? 0;
              const legacyUnit = legacyD > 0 ? Math.round((base * (100 - legacyD)) / 100) : base;
              const unit = (appt.priceCents ?? 0) > 0 ? savedPrimary : legacyUnit; // old rows w/o price fall back
              const orig = Math.max(base, unit);
              const d = orig > 0 && unit < orig ? Math.round(((orig - unit) / orig) * 100) : 0;
              lines.push({ uid: `u${uidSeq++}`, kind: 'SERVICE', refId: appt.service.id, name: appt.service.name, origUnitPriceCents: orig, unitPriceCents: unit, discountPercent: d, quantity: 1, tipCents: 0, staffMemberId: appt.assignedStaff?.id ?? '' });
            }
            for (const it of appt.addons ?? []) {
              const isSvc = it.kind === 'service';
              lines.push({
                uid: `u${uidSeq++}`, kind: 'SERVICE', refId: it.id ?? '', isAddon: !isSvc,
                name: it.name ?? '', origUnitPriceCents: it.priceCents ?? 0, unitPriceCents: it.priceCents ?? 0,
                discountPercent: 0, quantity: 1, tipCents: 0, staffMemberId: it.staffMemberId ?? '',
              });
            }
            if (lines.length > 0) { setCart((c) => (c.length === 0 ? lines : c)); setPrefilled(true); return; }
          }
        } catch { /* fall through to the single-service param prefill */ }
      }

      // Fallback: one service + tech from the URL params.
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
  }, [services, prefilled, params, token, walkInId, appointmentId, groupId]);

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
  // Apply the booking's campaign code once, on its own timeline.
  useEffect(() => {
    if (!token || !bookedOffer) return;
    let alive = true;
    apiFetch<{ code: string; label: string; kind: string; value: number; appliesDiscount: boolean } | null>(`/campaigns/code/${encodeURIComponent(bookedOffer)}`, { token })
      .then((r) => {
        if (!alive) return;
        if (r) { setPromo(r); setPromoInput(r.code); setPromoErr(null); }
        // The booking carried a code the campaign no longer offers — say so
        // instead of leaving an empty box the cashier cannot explain.
        else { setPromoInput(bookedOffer); setPromoErr(t('po.promoStale').replace('{code}', bookedOffer)); }
      })
      .catch(() => { if (alive) { setPromoInput(bookedOffer); setPromoErr(t('po.promoStale').replace('{code}', bookedOffer)); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, bookedOffer]);

  function updateLine(uid: string, patch: Partial<Line>) {
    setCart((c) => c.map((l) => (l.uid === uid ? { ...l, ...patch } : l)));
  }
  /**
   * Charge a different price for one line — the salon quoted $12 for a Take Off
   * but only did part of it and charges $5. We keep the catalog price in
   * origUnitPriceCents so the receipt, the reports and the tech's commission all
   * still show what was marked down, instead of silently pretending the service
   * always cost $5.
   */
  function setLinePrice(uid: string, dollars: string) {
    const cents = Math.max(0, toMinorUnits(dollars, currency));
    setCart((c) => c.map((l) => {
      if (l.uid !== uid) return l;
      const orig = Math.max(l.origUnitPriceCents, cents);
      const pct = orig > 0 && cents < orig ? Math.round(((orig - cents) / orig) * 100) : 0;
      return { ...l, unitPriceCents: cents, origUnitPriceCents: orig, discountPercent: pct };
    }));
  }
  function resetLinePrice(uid: string) {
    setCart((c) => c.map((l) => {
      if (l.uid !== uid) return l;
      const cat = catalogPrice(l);
      return cat == null ? l : { ...l, unitPriceCents: cat, origUnitPriceCents: cat, discountPercent: 0 };
    }));
  }
  /** List price from the catalog for this line (null when it is a free-text line). */
  function catalogPrice(l: Line): number | null {
    const src = l.kind === 'SERVICE' ? services.find((x) => x.id === l.refId) : products.find((x) => x.id === l.refId);
    if (!src) return null;
    const d = src.discountPercent ?? 0;
    return d > 0 ? Math.round((src.priceCents * (100 - d)) / 100) : src.priceCents;
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
        payload: { cart, customerId, customerLabel, orderDiscount, discountMode },
      } });
      clearCart();
      await loadHeld();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not hold this ticket'); }
  }
  function recall(h: { id: string; payload: unknown }) {
    if (cart.length > 0 && !window.confirm(lang === 'vi' ? 'Thay giỏ hàng hiện tại bằng bill này?' : 'Replace the current cart with this bill?')) return;
    const pp = (h.payload || {}) as { cart?: Line[]; customerId?: string | null; customerLabel?: string | null; orderDiscount?: string; discountMode?: 'AMOUNT' | 'PERCENT' };
    setCart(Array.isArray(pp.cart) ? pp.cart.map((l) => ({ ...l, uid: `u${uidSeq++}` })) : []);
    setCustomerId(pp.customerId ?? null);
    setCustomerLabel(pp.customerLabel ?? null);
    setOrderDiscount(pp.orderDiscount ?? ''); setDiscountMode(pp.discountMode ?? 'AMOUNT');
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

  async function applyPromo() {
    if (!token || !promoInput.trim() || promoBusy) return;
    setPromoBusy(true); setPromoErr(null);
    try {
      const r = await apiFetch<{ code: string; label: string; kind: string; value: number; appliesDiscount: boolean } | null>(`/campaigns/code/${encodeURIComponent(promoInput.trim())}`, { token });
      if (r) setPromo(r); else setPromoErr(t('po.promoBad'));
    } catch { setPromoErr(t('po.promoBad')); }
    finally { setPromoBusy(false); }
  }

  const money = useMemo(() => {
    const subtotal = cart.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
    // Savings from per-item promo discounts (list price vs net price).
    const itemSavings = cart.reduce((s, l) => s + (l.origUnitPriceCents - l.unitPriceCents) * l.quantity, 0);
    const productBase = cart.filter((l) => l.kind === 'PRODUCT').reduce((s, l) => s + l.unitPriceCents * l.quantity, 0);
    // A percent/amount promo lands on top of whatever was typed in the discount
    // box; a gift promo is handed over at the counter and must not deduct money.
    const typedRaw = parseFloat(orderDiscount) || 0;
    const typedDiscount = discountMode === 'PERCENT'
      ? Math.round((subtotal * Math.max(0, Math.min(100, typedRaw))) / 100)
      : Math.round(Math.max(0, typedRaw) * 100);
    const promoCents = promo?.appliesDiscount
      ? (promo.kind === 'percent' ? Math.round((subtotal * Math.min(90, promo.value)) / 100) : promo.value)
      : 0;
    const discount = Math.min(typedDiscount + promoCents, subtotal);
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
    const dueBase = Math.max(0, total - giftApplied);
    // Dual pricing: paying by CARD adds a surcharge on the ticket EXCLUDING the
    // tip (the tip is pass-through to staff) and excluding any gift-covered part.
    // Single-method only — split payments keep the plain cash price to avoid
    // ambiguous per-part math.
    const cardBase = Math.max(0, dueBase - tip);
    const cardSurcharge = (cardSurchargeOn && !split && payMethod === 'CARD' && cardSurchargePct > 0)
      ? Math.round((cardBase * cardSurchargePct) / 100) : 0;
    const due = dueBase + cardSurcharge;
    const tenderedCents = toMinorUnits(tendered, currency);
    // Split mode: sum the parts; any overpay is cash change (someone rounds a cash part up).
    const splitCents = parts.reduce((sum, p) => sum + toMinorUnits(p.amount, currency), 0);
    const change = split ? Math.max(0, splitCents - due) : (payMethod === 'CASH' ? Math.max(0, tenderedCents - due) : 0);
    const splitRemaining = due - splitCents; // >0 = still owed, <0 = change
    return { subtotal, itemSavings, discount, typedDiscount, promoCents, tax, tip, total, savings, giftApplied, due, tenderedCents, change, redeemDiscount, redeemPts, splitCents, splitRemaining, cardSurcharge };
  }, [cart, orderDiscount, discountMode, promo, taxRate, tendered, payMethod, cardSurchargePct, cardSurchargeOn, loyalty, customerId, customerPoints, redeemInput, online, giftCard, split, parts]);

  // ---- Customer-facing display (2nd monitor). Mirrors the live cart to the
  // /pos-display page via BroadcastChannel — same browser, no server, no internet. ----
  // Every message on the channel carries the salon it comes from: the channel
  // is shared by all tabs of the browser, and an agency has several salons'
  // registers open at once. A display opened for one salon ignores the rest.
  const tenantId = user?.tenantId ?? '';
  const tenantRef = useRef(tenantId);
  tenantRef.current = tenantId;
  const displayPayload = useMemo(() => ({
    type: 'state' as const,
    tenant: tenantId || undefined,
    state: {
      status: (cart.length ? 'active' : 'idle') as 'active' | 'idle',
      currency,
      salonName, salonLogo, salonAccent, salonWelcome,
      lines: cart.map((l) => {
        const st = l.staffMemberId ? staff.find((x) => x.id === l.staffMemberId) : null;
        return { name: l.name, qty: l.quantity, lineCents: l.unitPriceCents * l.quantity, staff: st ? `${st.firstName} ${st.lastName ?? ''}`.trim() : undefined };
      }),
      subtotalCents: money.subtotal,
      savingsCents: money.savings,
      tipCents: money.tip,
      taxCents: money.tax,
      giftCents: money.giftApplied,
      cardFeeCents: money.cardSurcharge,
      cardFeePct: cardSurchargePct,
      dueCents: money.due,
      // Tip prompt for the customer screen: tippable only when there's a service
      // line, and the % is computed off the service subtotal.
      tippable: tipsOn && cart.some((l) => l.kind === 'SERVICE'),
      tipBaseCents: cart.filter((l) => l.kind === 'SERVICE').reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0),
      reviewUrl: reviewUrl ?? undefined,
    },
  }), [cart, currency, money, cardSurchargePct, staff, salonName, salonLogo, salonAccent, salonWelcome, reviewUrl, tipsOn, tenantId]);
  const displayChRef = useRef<BroadcastChannel | null>(null);
  const displayPayloadRef = useRef(displayPayload);
  displayPayloadRef.current = displayPayload;
  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return;
    const ch = new BroadcastChannel('lumio-pos-display');
    displayChRef.current = ch;
    ch.onmessage = (e) => {
      const d = e.data;
      // A screen that belongs to another salon — not ours to answer.
      if (d?.tenant && tenantRef.current && d.tenant !== tenantRef.current) return;
      // A freshly-opened display asks the register to replay the current ticket.
      if (d?.type === 'request') ch.postMessage(displayPayloadRef.current);
      // Channel 1 — customer tapped a tip ON THE BILL during checkout.
      else if (d?.type === 'tip' && typeof d.amountCents === 'number') applyCustomerTip(d.amountCents);
      // Channel 3 — customer tapped a tip on the AFTER-PAYMENT screen (scans the
      // tech's QR to pay directly). We log it against the just-paid ticket's techs.
      else if (d?.type === 'tipDirect' && typeof d.amountCents === 'number') logPaidTip(Math.max(0, Math.round(d.amountCents)));
    };
    // Opening the register claims the customer screen: if it is sitting on the
    // walk-in check-in form, it goes back to the register's own view. One system
    // owns the monitor at a time, and the last one opened wins.
    ch.postMessage(tenantRef.current ? { type: 'claim', tenant: tenantRef.current } : { type: 'claim' });
    ch.postMessage(displayPayloadRef.current);
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
  function broadcastPaid(ticketRef: string, feedbackToken?: string | null) {
    const tt = paidTipRef.current;
    const paidState = {
      status: 'paid', currency, salonName, salonLogo, salonAccent, lines: [] as unknown[],
      saleRef: ticketRef, // lets an independent iPad detect a NEW sale and reset its tip UI
      subtotalCents: 0, savingsCents: 0, tipCents: 0, taxCents: 0, giftCents: 0,
      dueCents: money.due, paidCents: money.tenderedCents || money.due, changeCents: money.change,
      // Channel 3 — offer a QR tip on the Thank-you screen for the tech(s) on this ticket.
      tippable: tipsOn && tt.techs.length > 0,
      tipBaseCents: tt.baseCents,
      tipTechs: tipsOn ? tt.techs.map((t) => ({ name: t.name, qr: t.qr, handle: t.handle })) : [],
      reviewUrl: reviewUrl ?? undefined,
      // The customer screen asks "how was your visit?" over this Paid view.
      feedbackToken: feedbackToken ?? undefined,
    };
    displayChRef.current?.postMessage({ type: 'state', tenant: tenantRef.current || undefined, state: paidState });
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
    if (typeof window === 'undefined') return;
    // `?t=` binds the screen to THIS salon (see displayPayload). Same window
    // name as the walk-in board, so this re-uses an open screen instead of
    // spawning a second one — and re-binds it if it was another salon's.
    const q = tenantRef.current ? `?t=${encodeURIComponent(tenantRef.current)}` : '';
    window.open(`/pos-display${q}`, 'lumioCustomerDisplay', 'width=1100,height=760');
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
  // One gate for every tip surface in the till: the direct-tip panel here, the
  // prompt on the customer's screen and the QR on the thank-you screen all read
  // from this, so turning tipping off cannot leave one of them behind.
  const tipTechs = tipsOn
    ? staff.filter((s) => (s.tipQrUrl || s.tipHandle) && cart.some((l) => l.staffMemberId === s.id))
    : [];

  async function logDirectTip(staffId: string) {
    const raw = (tipLogInput[staffId] || '').trim();
    const dollars = Number(raw);
    if (!raw || !Number.isFinite(dollars) || dollars <= 0) { setError(t('po.tipLogInvalid')); return; }
    const amountCents = toMinorUnits(dollars, currency);
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
    // Live sale with no shift open where the salon insists on one: open the
    // drawer first. Offline sales are never blocked — the money is already in
    // the till and the queue uploads them under whatever shift is open then.
    if (shiftCtl.mustOpen && online) {
      setError(lang === 'vi' ? 'Chưa vào ca — vào ca (nhập tiền đầu ca) rồi mới thu tiền.' : 'No shift open — open the shift (enter the float) before taking payment.');
      setShowShift(true);
      return;
    }
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
    // The method IS the stored value now. This used to collapse Transfer into
    // OTHER because OTHER was the only value the database had — which meant a
    // Vietnamese salon's VietQR, MoMo and ZaloPay would all have been the same
    // row, and "how much came in by MoMo" would have had no answer.
    const apiOf = (m: PayMethod) => m;
    // Cash needs the amount received; Card & Transfer pay the due in full at the terminal/bank.
    const tenderCents = payMethod === 'CASH' ? money.tenderedCents : dueCents;
    // Build the tender list. Split mode = one tender per part; else a single tender.
    let tenderList: { method: string; amountCents: number }[] = [];
    if (dueCents > 0) {
      if (split) {
        tenderList = parts
          .map((p) => ({ method: apiOf(p.method), amountCents: toMinorUnits(p.amount, currency) }))
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
      appointmentIds: groupApptIds.length > 1 ? groupApptIds : undefined,
      walkInId: walkInId || undefined,
      customerId: customerId || undefined,
      discountCents: money.discount,
      redeemPoints: money.redeemPts || undefined,
      giftCardCode: giftCard?.code || undefined,
      // A marked-down line is stored as list price + a discount, never as a
      // cheaper service. The money charged is identical (gross − discount), but
      // the record keeps WHAT was given away — otherwise a $12 Take Off sold at
      // $5 looks in the data like a $5 service and the giveaway is invisible.
      items: cart.map((l) => {
        const marked = l.origUnitPriceCents > l.unitPriceCents;
        return {
          kind: l.kind,
          serviceId: l.kind === 'SERVICE' && !l.isAddon ? l.refId : undefined,
          productId: l.kind === 'PRODUCT' ? l.refId : undefined,
          name: l.name,
          unitPriceCents: marked ? l.origUnitPriceCents : l.unitPriceCents,
          discountCents: marked ? (l.origUnitPriceCents - l.unitPriceCents) * l.quantity : undefined,
          quantity: l.quantity,
          tipCents: l.tipCents,
          staffMemberId: l.staffMemberId || undefined,
          appointmentId: l.apptId || undefined,
        };
      }),
      tenders: tenderList,
    };
    setSubmitting(true); setError(null); setOkMsg(null);

    // Save the sale on this device + print, leaving it queued to upload later.
    // Used when offline or if the network drops mid-checkout — the sale is never
    // lost, and the clientRef means re-syncing can't duplicate it. Redeemed points
    // are dropped offline (can't verify the balance) so a queued order is never
    // rejected at sync time.
    const saveOffline = () => {
      queueOrder({ clientRef, payload: { ...payload, redeemPoints: undefined, offline: true }, at: Date.now(), totalCents: money.total });
      setPendingSync(queueCount());
      const offRef = `OFF-${clientRef.slice(0, 5).toUpperCase()}`;
      printReceipt(offRef);
      setDone({ label: offRef, offline: true, paidCents: money.due, changeCents: money.change, method: split ? (lang === 'vi' ? 'Chia bill' : 'Split') : payLabel(payMethod, lang), customer: customerLabel, printed: printOn });
      setOkMsg(t('po.savedOffline'));
      broadcastPaid(clientRef);
      paidLinesRef.current = cart;
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
      // Card-present: collect on the connected reader BEFORE recording the sale.
      // Only when the salon has a Payment Hub reader; otherwise CARD stays manual.
      const cardCents = tenderList.filter((tn) => tn.method === 'CARD').reduce((a, tn) => a + tn.amountCents, 0);
      if (hubConn && hubReader && cardCents > 0) {
        setCharging(true);
        try {
          // Itemise the tip on the terminal only when the card covers the whole
          // ticket. On a split tender we cannot say how much of the tip belongs
          // to the card, and guessing would change what the customer is charged,
          // so the tip just rides inside the total instead.
          const cardCoversAll = cardCents >= money.total && money.tip > 0 && money.tip < cardCents;
          const tipForCard = cardCoversAll ? money.tip : 0;
          setCardStuck(null); setCardWait(0);
          let intent = await apiFetch<{ id: string; status: string; error?: string }>('/payments-hub/charge', { method: 'POST', token, body: { provider: hubConn.provider, amountCents: cardCents - tipForCard, tipCents: tipForCard, clientRef: `${clientRef}-card`, readerExternalId: hubReader, description: 'POS sale' } });
          // Dejavoo terminals wait up to 120s for the card, so poll past that
          // before giving up — cutting it short made the POS say "not completed"
          // while the customer was still tapping.
          for (let i = 0; i < 75 && (intent.status === 'PROCESSING' || intent.status === 'REQUIRES_PAYMENT'); i++) {
            await new Promise((r) => setTimeout(r, 2000));
            setCardWait((i + 1) * 2);
            intent = await apiFetch(`/payments-hub/intents/${intent.id}`, { token });
          }
          if (intent.status === 'PROCESSING' || intent.status === 'REQUIRES_PAYMENT') {
            // We genuinely do not know whether the card was charged. Do NOT
            // record the sale and do NOT let the cashier simply try again.
            setCardStuck({ intentId: intent.id, note: intent.error ?? '' });
            return;
          }
          if (intent.status !== 'SUCCEEDED') { setError('Card not completed: ' + (intent.error ?? intent.status)); return; }
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Card terminal error'); return;
        } finally {
          setCharging(false); setCardWait(0);
        }
      }
      try {
        const order = await apiFetch<{ id: string; orderNumber: number; feedback?: { token: string | null; status: string; receiptQr?: boolean } | null }>('/pos/orders', { method: 'POST', token, body: payload });
        // "How was your visit?" — the server decided whether to ask (feature on,
        // not asked recently). The token goes to the customer screen and the receipt.
        const fbToken = order.feedback?.token ?? null;
        const fbLink = fbToken && order.feedback?.receiptQr && typeof window !== 'undefined' ? `${window.location.origin}/f/${fbToken}?src=qr` : undefined;
        setFbReq(order.feedback ? { orderId: order.id, status: order.feedback.status, onScreen: !!fbToken && ipadEnabledRef.current } : null);
        printReceipt(order.orderNumber, fbLink);
        setDone({ label: `#${order.orderNumber}`, offline: false, paidCents: money.due, changeCents: money.change, method: split ? (lang === 'vi' ? 'Chia bill' : 'Split') : payLabel(payMethod, lang), customer: customerLabel, printed: printOn });
        setOkMsg(t('po.paidOk').replace('{n}', String(order.orderNumber)));
        broadcastPaid(clientRef, fbToken);
        paidLinesRef.current = cart;
        clearCart();
        setOnline(true);
        setPendingSync(queueCount());
        load(); // refresh stock
        void shiftCtl.refresh();
      } catch (err) {
        // A real server rejection (bad data / auth) → show it. A network failure
        // (no response) → save the sale offline so nothing is lost.
        if (err instanceof ApiError) {
          if (/SHIFT_REQUIRED/.test(err.message || '')) { setError(lang === 'vi' ? 'Chưa vào ca — vào ca rồi mới thu tiền.' : 'No shift open — open the shift before taking payment.'); setShowShift(true); void shiftCtl.refresh(); return; }
          setError(err.message || t('po.payFail')); return;
        }
        if (giftCard) { setError(t('po.gcOffline')); return; }
        saveOffline();
      }
    } finally {
      setSubmitting(false);
    }
  }

  function printReceipt(orderNumber: number | string, feedbackLink?: string) {
    // The receipt is built NOW, while the bill is still on the till, and kept
    // whole: the "Hoàn tất" screen's "In lại" prints this same paper after the
    // bill has been cleared. Whether anything prints at all is the device's
    // "In hoá đơn" switch (on by default, which is what the till always did).
    const snap = { orderNumber, text: buildReceiptText(orderNumber), html: buildReceiptHtml(orderNumber) };
    if (feedbackLink) {
      // The QR opens the same two-button "how was it?" page on the customer's phone.
      snap.text += `\nHow was your visit?\nTell us: ${feedbackLink}\n`;
      snap.html = snap.html.replace('</body>', `<hr><div class="center" style="margin-top:6px"><b>How was your visit?</b><br><img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=1&data=${encodeURIComponent(feedbackLink)}" width="120" height="120" alt="" style="margin-top:6px"><br>Scan to tell us</div></body>`);
    }
    lastReceiptRef.current = snap;
    if (printOn) printSnapshot(snap);
  }
  /** Send a built receipt to the printer this device uses. */
  function printSnapshot(snap: { orderNumber: number | string; text: string; html: string }) {
    // Route to the reception-desk printer (via the print agent) when enabled on
    // this device; otherwise print locally on the phone. If sending to reception
    // fails (offline / agent down), fall back to local print so the receipt is
    // never lost.
    if (printToReception) {
      apiFetch('/print-jobs', { method: 'POST', token, body: { title: `Receipt #${snap.orderNumber}`, text: snap.text } })
        .then(() => setOkMsg(t('po.sentToReception').replace('{n}', String(snap.orderNumber))))
        .catch(() => printHtml(snap.html));
      return;
    }
    printHtml(snap.html);
  }

  // What actually paid the bill, line by line — so a split (part cash, part card)
  // prints "Cash $35 / Card $10" instead of a single lumped "Paid (CASH)".
  function paidLines(): { label: string; cents: number }[] {
    const nameOf = (m: string) => (m === 'CASH' ? 'Cash' : m === 'CARD' ? 'Card' : 'Transfer');
    if (money.giftApplied > 0 && cart.length && money.due === 0) {
      return [{ label: 'Gift card', cents: money.giftApplied }];
    }
    const lines: { label: string; cents: number }[] = [];
    if (money.giftApplied > 0) lines.push({ label: 'Gift card', cents: money.giftApplied });
    if (split) {
      for (const p of parts) {
        const c = toMinorUnits(p.amount, currency);
        if (c > 0) lines.push({ label: nameOf(p.method), cents: c });
      }
    } else {
      lines.push({ label: nameOf(payMethod), cents: payMethod === 'CASH' ? (money.tenderedCents || money.due) : money.due });
    }
    return lines;
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
        let s = row(`${l.quantity}x ${l.name}`, posMoney(l.unitPriceCents * l.quantity, currency));
        if (l.staffMemberId) s += `\n  ${staffName(l.staffMemberId)}`;
        if (l.tipCents) s += `\n  Tip: ${posMoney(l.tipCents, currency)}`;
        return s;
      })
      .join('\n');
    let o = center('RECEIPT') + '\n' + center(`Order #${orderNumber}`) + '\n' + center(fmtInTz(new Date(), { dateStyle: 'short', timeStyle: 'short' })) + '\n' + sep + '\n';
    o += items + '\n' + sep + '\n';
    o += row('Subtotal', posMoney(money.subtotal, currency)) + '\n';
    if (money.discount) o += row('Discount', '-' + posMoney(money.discount, currency)) + '\n';
    if (money.tax) o += row('Tax', posMoney(money.tax, currency)) + '\n';
    if (money.tip) o += row('Tip', posMoney(money.tip, currency)) + '\n';
    if (money.cardSurcharge) o += row(`Card fee (${cardSurchargePct}%)`, posMoney(money.cardSurcharge, currency)) + '\n';
    o += row('TOTAL', posMoney(money.total + money.cardSurcharge, currency)) + '\n';
    for (const pl of paidLines()) o += row(`Paid · ${pl.label}`, posMoney(pl.cents, currency)) + '\n';
    if (money.change) o += row('Change', posMoney(money.change, currency)) + '\n';
    o += sep + '\n' + center('Thank you!') + '\n';
    return o;
  }

  function buildReceiptHtml(orderNumber: number | string): string {
    const rows = cart
      .map((l) => {
        const lt = posMoney(l.unitPriceCents * l.quantity, currency);
        const tech = l.staffMemberId ? `<div style="font-size:11px;color: #555">${staffName(l.staffMemberId)}</div>` : '';
        const tip = l.tipCents ? `<div style="font-size:11px;color: #555">Tip: ${posMoney(l.tipCents, currency)}</div>` : '';
        const disc = l.discountPercent > 0
          ? `<div style="font-size:11px;color: #777"><s>${posMoney(l.origUnitPriceCents * l.quantity, currency)}</s> &nbsp;-${l.discountPercent}%</div>`
          : '';
        const addon = l.isAddon ? `<span style="font-size:10px;color: #777"> (add-on)</span>` : '';
        return `<tr><td>${l.quantity}× ${escapeHtml(l.name)}${addon}${disc}${tech}${tip}</td><td style="text-align:right;vertical-align:top">${lt}</td></tr>`;
      })
      .join('');
    const line = (label: string, val: string, bold = false) =>
      `<tr><td style="${bold ? 'font-weight:600' : ''}">${label}</td><td style="text-align:right;${bold ? 'font-weight:600' : ''}">${val}</td></tr>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Receipt #${orderNumber}</title>
      <style>body{font-family:ui-monospace,Menlo,monospace;width:300px;margin:0 auto;padding:12px;color: #000}
      h2{text-align:center;margin:4px 0}table{width:100%;border-collapse:collapse;font-size:13px}
      td{padding:2px 0;vertical-align:top}hr{border:none;border-top:1px dashed #999;margin:8px 0}
      .center{text-align:center;font-size:12px;color: #333}</style></head><body>
      <h2>Receipt</h2>
      <div class="center">Order #${orderNumber} · ${fmtInTz(new Date(), { dateStyle: 'short', timeStyle: 'short' })}</div><hr>
      <table>${rows}</table><hr>
      <table>
        ${line('Subtotal', posMoney(money.subtotal, currency))}
        ${money.discount ? line('Order discount', '-' + posMoney(money.discount, currency)) : ''}
        ${money.tax ? line('Tax', posMoney(money.tax, currency)) : ''}
        ${money.tip ? line('Tip', posMoney(money.tip, currency)) : ''}
        ${money.cardSurcharge ? line(`Card fee (${cardSurchargePct}%)`, posMoney(money.cardSurcharge, currency)) : ''}
        ${money.savings ? line('You saved', '-' + posMoney(money.savings, currency)) : ''}
        ${line('TOTAL', posMoney(money.total + money.cardSurcharge, currency), true)}
        ${paidLines().map((pl) => line('Paid · ' + pl.label, posMoney(pl.cents, currency))).join('')}
        ${money.change ? line('Change', posMoney(money.change, currency)) : ''}
      </table><hr>
      <div class="center">Thank you!</div>
      </body></html>`;
    return html;
  }

  function printHtml(html: string) {
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

  /* ==========================================================================
   * THE REGISTER — as drawn in the approved mockup ("Lumio POS Redesign").
   *
   * The register is its own mode: it covers the admin shell (the ☰ button
   * brings the menu back), so the whole screen is the till. Three layouts, one
   * look, chosen by the width of the screen:
   *
   *   wide  (≥1024px — computers, iPad held sideways): catalog on the left,
   *         the bill on the right.
   *   dock  (700–1023px — iPad held upright): catalog on top, the bill docked
   *         at the bottom where the thumb is.
   *   phone (<700px): three steps — pick services, the bill, payment — with
   *         the running total always on a bar at the bottom.
   *
   * Payment is its own screen on every size (method, cash keypad, change, tip
   * split by technician), and a finished sale shows a "Hoàn tất" screen.
   * Everything the old register did is still here: held bills, promo codes,
   * discounts, gift cards, points, split tender, the card terminal, transfer
   * QR codes, the customer screen and iPad, receipt printing, offline sales,
   * checkout from a booking or a walk-in ticket, add-ons and products.
   * ======================================================================== */
  const narrow = useIsMobile(699);
  const midW = useIsMobile(1023);
  const tightTop = useIsMobile(1279);
  const layout: 'wide' | 'dock' | 'phone' = narrow ? 'phone' : midW ? 'dock' : 'wide';
  const [step, setStep] = useState<'register' | 'pay'>('register');
  const [menuOpen, setMenuOpen] = useState<'nav' | 'more' | null>(null);
  const [editUid, setEditUid] = useState<string | null>(null);
  const [adj, setAdj] = useState<'discount' | 'promo' | 'gift' | 'points' | null>(null);
  const [customTip, setCustomTip] = useState('');
  const [tipMode, setTipMode] = useState<string | null>(null);
  const [ipadModal, setIpadModal] = useState(false);
  const [waiting, setWaiting] = useState<WaitingTicket[]>([]);
  const catScroll = useHorizontalScroll<HTMLDivElement>();
  const measureCats = catScroll.measure;
  useEffect(() => { const id = window.setTimeout(measureCats, 50); return () => window.clearTimeout(id); }, [services, tab, layout, measureCats]);

  // Clients on the floor whose ticket is open — the ones waiting to pay first.
  // Read from the walk-in board (a checked-in booking is a floor ticket too).
  // A salon without the walk-in board gets a 403 here and simply no strip.
  const loadWaiting = useCallback(async () => {
    if (!token || !online) return;
    try {
      const b = await apiFetch<{ serving?: Array<Record<string, unknown>> }>('/walkins/board', { token });
      const rows = Array.isArray(b?.serving) ? b.serving : [];
      const list: WaitingTicket[] = rows.map((w) => {
        const items = Array.isArray(w.items) ? (w.items as Array<{ name?: string; staffId?: string | null }>) : [];
        const svc = w.service as { name?: string } | null | undefined;
        const tech = w.assignedStaff as { id?: string; firstName?: string } | null | undefined;
        const names = items.length ? items.map((it) => it.name || '').filter(Boolean) : (svc?.name ? [svc.name] : []);
        const techIds = new Set<string>();
        for (const it of items) if (it.staffId) techIds.add(it.staffId);
        if (!techIds.size && tech?.id) techIds.add(tech.id);
        const techNames = [...techIds].map((id) => staff.find((s) => s.id === id)?.firstName || (tech?.id === id ? tech?.firstName : '') || '').filter(Boolean);
        return {
          id: String(w.id),
          customerId: (w.customerId as string | null) ?? null,
          name: (w.customerName as string | null) || '',
          what: [names.join(' + '), techNames.join(', ')].filter(Boolean).join(' · '),
          awaitingPayment: Boolean(w.awaitingPayment),
        };
      });
      list.sort((a, b2) => Number(b2.awaitingPayment) - Number(a.awaitingPayment));
      setWaiting(list);
    } catch { setWaiting([]); }
  }, [token, online, staff]);
  useEffect(() => {
    if (step !== 'register' || done) return;
    loadWaiting();
    const h = setInterval(loadWaiting, 30000);
    return () => clearInterval(h);
  }, [loadWaiting, step, done]);

  // The till's methods decide the default: a salon without cash starts on its first method.
  useEffect(() => {
    if (tillMethods.length && !tillMethods.includes(payMethod)) setPayMethod(tillMethods[0]);
  }, [tillMethods, payMethod]);

  const L = (vi: string, en: string) => (lang === 'vi' ? vi : en);
  const fmt = (c: number) => posMoney(c, currency);
  /** Buttons: $140 rather than $140.00 when the amount is whole. */
  const fmtShort = (c: number) => fmt(c).replace(/[.,]00(?=\D*$)/, '');
  const staffIdx = (id: string) => staff.findIndex((s) => s.id === id);
  const staffHue = (id: string) => STAFF_COLORS[(Math.max(0, staffIdx(id))) % STAFF_COLORS.length];
  const catHue = useMemo(() => {
    const m = new Map<string, string>();
    serviceCats.forEach((c, i) => m.set(c.id, CAT_COLORS[i % CAT_COLORS.length]));
    return m;
  }, [serviceCats]);
  const qtyInCart = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of cart) m.set(l.refId, (m.get(l.refId) || 0) + l.quantity);
    return m;
  }, [cart]);
  const cashDue = money.due - money.cardSurcharge;
  const dualPrice = cardSurchargeOn && cardSurchargePct > 0 && tillMethods.includes('CARD');
  const cardDue = cashDue + Math.round((Math.max(0, cashDue - money.tip) * cardSurchargePct) / 100);
  const missingTech = staff.length > 0 && cart.some((l) => l.kind === 'SERVICE' && !l.staffMemberId);
  const svcBase = cart.filter((l) => l.kind === 'SERVICE').reduce((s2, l) => s2 + l.unitPriceCents * l.quantity, 0);
  const custName = (customerLabel || bookingCustomer || '').split(' · ')[0].trim();
  const custPhone = (customerLabel || '').split(' · ').slice(1).join(' · ');
  const initials = (n: string) => (n.trim().split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2) || '?').toUpperCase();

  // Tip per technician: what each tech's service lines carry.
  const techTips = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of cart) if (l.kind === 'SERVICE') m.set(l.staffMemberId || '', (m.get(l.staffMemberId || '') || 0) + l.tipCents);
    return m;
  }, [cart]);
  const techsOnBill = useMemo(() => {
    const seen: string[] = [];
    for (const l of cart) if (l.kind === 'SERVICE' && !seen.includes(l.staffMemberId || '')) seen.push(l.staffMemberId || '');
    return seen;
  }, [cart]);
  /** Set one technician's share of the tip, spread over that tech's lines by value. */
  function setTechTip(staffId: string, cents: number) {
    const amt = Math.max(0, Math.round(cents));
    setCart((c) => {
      const mine = c.filter((l) => l.kind === 'SERVICE' && (l.staffMemberId || '') === staffId);
      if (!mine.length) return c;
      const base = mine.reduce((a, l) => a + l.unitPriceCents * l.quantity, 0);
      const lastUid = mine[mine.length - 1].uid;
      let given = 0;
      return c.map((l) => {
        if (l.kind !== 'SERVICE' || (l.staffMemberId || '') !== staffId) return l;
        if (l.uid === lastUid) return { ...l, tipCents: Math.max(0, amt - given) };
        const share = base > 0 ? Math.round((amt * l.unitPriceCents * l.quantity) / base) : 0;
        given += share;
        return { ...l, tipCents: share };
      });
    });
  }

  /** Start a clean bill: nothing from the last sale — customer, booking, promo — carries over. */
  function newBill() {
    clearCart();
    setAppointmentId(null); setWalkInId(null); setGroupId(null); setGroupApptIds([]);
    setCustomerId(null); setCustomerLabel(null); setCustomerPoints(0);
    setPromo(null); setPromoInput(''); setPromoErr(null); setBookedOffer(null);
    setTendered(''); setSplit(false); setParts([]); setCustomTip(''); setTipMode(null);
    setAdj(null); setEditUid(null); setOkMsg(null); setError(null);
    setDone(null); setNextVisit(null); setShowRebook(false); setFbReq(null); setStep('register'); setMobileView('catalog'); setPrefilled(true);
    try { window.history.replaceState(null, '', '/salon/pos'); } catch { /* ignore */ }
  }
  /** Open a waiting client's floor ticket on this till. */
  function openWaiting(w: WaitingTicket) {
    if (walkInId === w.id && cart.length) { if (layout === 'phone') setMobileView('ticket'); return; }
    if (cart.length > 0 && !window.confirm(L('Thay bill đang mở bằng bill của khách này?', 'Replace the open bill with this client’s?'))) return;
    newBill();
    setWalkInId(w.id);
    setCustomerId(w.customerId);
    setCustomerLabel(w.name || null);
    setPrefilled(false);
    if (layout === 'phone') setMobileView('ticket');
    try {
      const q = new URLSearchParams({ walkInId: w.id, ...(w.customerId ? { customerId: w.customerId } : {}), ...(w.name ? { customer: w.name } : {}) });
      window.history.replaceState(null, '', `/salon/pos?${q.toString()}`);
    } catch { /* ignore */ }
  }
  function goPay() {
    if (cart.length === 0) { setError(t('po.addItem')); return; }
    setError(null); setOkMsg(null); setEditUid(null);
    setStep('pay');
  }
  /** The cash keypad types into "khách đưa" the way a register does: digits fill from the right. */
  function keypad(k: string) {
    const cur = money.tenderedCents;
    let next = cur;
    if (k === 'back') next = Math.floor(cur / 10);
    else if (k === '00') next = cur * 100;
    else next = cur * 10 + Number(k);
    if (next > 99999999) return;
    setTendered(next > 0 ? fromMinorUnits(next, currency) : '');
  }
  function searchEnter() {
    const code = query.trim();
    if (!code) return;
    const hit = products.find((p) => (p.barcode ?? '').trim().toLowerCase() === code.toLowerCase());
    if (hit) { addProduct(hit); setQuery(''); setScanMsg({ ok: true, text: t('po.scanAdded').replace('{name}', hit.name) }); setTimeout(() => setScanMsg(null), 2500); }
  }

  if (loading) return <p style={{ color: 'var(--c94a3b8)' }}>{t('po.loadingReg')}</p>;

  /* ---------------------------------------------------------------- pieces */
  const tabsAll: { id: 'SERVICE' | 'ADDON' | 'PRODUCT'; label: string; n: number }[] = [
    { id: 'SERVICE', label: t('po.tabServices'), n: services.length },
    { id: 'ADDON', label: t('po.tabAddons'), n: addons.length },
    { id: 'PRODUCT', label: t('po.tabProducts'), n: products.length },
  ];
  const tabs = tabsAll.filter((x) => x.id === 'SERVICE' || x.n > 0);
  const flatServices = serviceGroups.flatMap((g) => g.items);
  const tileMin = layout === 'phone' ? 150 : 200;
  // Every tile the same height, as drawn — a photo or a two-line name never makes one row taller than the next.
  const tileRow = layout === 'phone' ? 92 : layout === 'wide' && !tightTop ? 112 : 104;

  const iconBtn = (label: string, onClick: () => void, icon: React.ReactNode, extra?: React.CSSProperties) => (
    <button type="button" aria-label={label} title={label} onClick={onClick} style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 10, border: '1px solid var(--line)', background: 'var(--c0f172a)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--ce2e8f0)', ...extra }}>{icon}</button>
  );
  const textBtn: React.CSSProperties = { height: 44, padding: '0 14px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--c0f172a)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, color: 'var(--ce2e8f0)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, textDecoration: 'none' };
  const heldCount = (
    <span style={{ minWidth: 22, height: 22, padding: '0 6px', boxSizing: 'border-box', borderRadius: 999, background: 'var(--c1e1b4b)', color: 'var(--ce0e7ff)', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{heldBills.length}</span>
  );

  const topBar = (
    <div style={{ height: layout === 'wide' && !tightTop ? 64 : 56, flexShrink: 0, boxSizing: 'border-box', padding: layout === 'phone' ? '0 12px' : '0 16px', display: 'flex', alignItems: 'center', gap: layout === 'phone' ? 10 : 12, background: 'var(--c0f172a)', borderBottom: '1px solid var(--line)', position: 'relative' }}>
      {iconBtn(L('Menu quản lý', 'Admin menu'), () => setMenuOpen(menuOpen === 'nav' ? null : 'nav'), <IcoMenu />, layout === 'phone' ? { border: 'none', background: 'transparent' } : undefined)}
      {layout === 'phone' ? (
        <span style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{L('Thu ngân', 'Checkout')}</span>
      ) : layout === 'wide' && !tightTop ? (
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, minWidth: 0 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{salonName || t('po.title')}</span>
          <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{L('Quầy thu ngân', 'Checkout')}{user?.firstName ? ` · ${L('Thu ngân', 'Cashier')}: ${user.firstName}` : ''}</span>
        </div>
      ) : (
        <span style={{ minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden' }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--cf1f5f9)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{salonName || t('po.title')}</span>
          <span style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>· {L('Quầy thu ngân', 'Checkout')}</span>
        </span>
      )}
      {layout !== 'phone' && <div style={{ flex: 1 }} />}
      {layout === 'wide' && !tightTop && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', background: online ? 'var(--c052e16)' : 'rgba(245,158,11,.14)', color: online ? 'var(--ink-good)' : 'var(--ink-warn)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: online ? '#16a34a' : '#f59e0b' }} />
          {online ? L('Đang kết nối', 'Online') : L('Mất mạng — lưu tạm', 'Offline — saving locally')}
        </span>
      )}
      {layout === 'wide' && shiftCtl.state && (
        <button type="button" onClick={() => setShowShift(true)} title={L('Ca thu ngân', 'Cashier shift')} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', border: 'none', cursor: 'pointer', fontFamily: 'inherit', background: shiftCtl.state.shift ? 'var(--c1e1b4b)' : 'rgba(245,158,11,.14)', color: shiftCtl.state.shift ? 'var(--ca5b4fc)' : 'var(--ink-warn)' }}>
          {shiftCtl.state.shift
            ? `${L('Ca', 'Shift')}: ${shiftCtl.state.shift.openedByName || '—'} · ${fmtInTz(shiftCtl.state.shift.openedAt, { hour: 'numeric', minute: '2-digit' })}`
            : L('Chưa vào ca', 'No shift open')}
        </button>
      )}
      {layout === 'wide' && (tightTop
        ? iconBtn(t('po.custScreen'), openCustomerScreen, <IcoScreen />)
        : <button type="button" onClick={openCustomerScreen} title={t('po.custScreenHint')} style={textBtn}><IcoScreen />{L('Màn hình khách', 'Customer screen')}</button>)}
      {layout === 'wide' && !tightTop && (
        <button type="button" onClick={() => togglePrint(!printOn)} title={L('In hoá đơn khi thanh toán xong', 'Print a receipt when a sale completes')} style={textBtn}><IcoPrint />{L('In bill', 'Print')}: {printOn ? L('Bật', 'On') : L('Tắt', 'Off')}</button>
      )}
      <button type="button" onClick={() => { loadHeld(); setShowHeld(true); }} style={{ ...textBtn, ...(layout === 'phone' ? { height: 40, padding: '0 10px', fontSize: 13 } : null) }}>
        {L('Bill chờ', 'Held')} {heldCount}
      </button>
      {layout !== 'phone' && iconBtn(L('Thêm tuỳ chọn', 'More'), () => setMenuOpen(menuOpen === 'more' ? null : 'more'), <IcoMore />)}
      {menuOpen && (
        <>
          <div onClick={() => setMenuOpen(null)} style={{ position: 'fixed', inset: 0, zIndex: 5 }} />
          <div style={{ position: 'absolute', top: '100%', marginTop: 6, zIndex: 6, ...(menuOpen === 'nav' ? { left: 12 } : { right: 12 }), width: 280, background: 'var(--c0f172a)', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 16px 40px rgba(15,23,42,.18)', padding: 6, display: 'flex', flexDirection: 'column' }}>
            {menuOpen === 'nav' ? (
              <>
                {[
                  ['/salon', L('Tổng quan', 'Dashboard')],
                  ['/salon/calendar', L('Lịch hẹn', 'Calendar')],
                  ['/salon/walkins', L('Khách vãng lai · Lượt', 'Walk-ins')],
                  ['/salon/orders', L('Đơn hàng', 'Orders')],
                  ['/salon/pos/shifts', L('Lịch sử ca thu ngân', 'Shift history')],
                  ['/salon/services', L('Dịch vụ', 'Services')],
                  ['/salon/products', t('po.manageProducts')],
                ].map(([href, label]) => (
                  <a key={href} href={href} style={menuItem}>{label}</a>
                ))}
              </>
            ) : (
              <>
                <button type="button" onClick={() => { setMenuOpen(null); enableIpad(); setIpadModal(true); }} style={menuItem}>{t('po.ipad')}</button>
                {layout !== 'wide' && <button type="button" onClick={() => { setMenuOpen(null); openCustomerScreen(); }} style={menuItem}>{t('po.custScreen')}</button>}
                <button type="button" onClick={() => togglePrint(!printOn)} style={menuItem}>{L('In hoá đơn khi xong', 'Print receipts')}: <b style={{ marginLeft: 'auto' }}>{printOn ? L('Bật', 'On') : L('Tắt', 'Off')}</b></button>
                <button type="button" onClick={() => toggleReception(!printToReception)} style={menuItem}>{t('po.printReception')}: <b style={{ marginLeft: 'auto' }}>{printToReception ? L('Bật', 'On') : L('Tắt', 'Off')}</b></button>
                <button type="button" onClick={() => { setMenuOpen(null); toggleFull(); }} style={menuItem}>{fullscreen ? t('po.fullOff') : t('po.fullOn')}</button>
                <button type="button" onClick={() => { setMenuOpen(null); setShowShift(true); }} style={menuItem}>{L('Ca thu ngân', 'Cashier shift')}{shiftCtl.state && <b style={{ marginLeft: 'auto', color: shiftCtl.state.shift ? 'var(--ink-good)' : 'var(--ink-warn)' }}>{shiftCtl.state.shift ? L('Đang mở', 'Open') : L('Chưa mở', 'Closed')}</b>}</button>
                <button type="button" onClick={() => { setMenuOpen(null); park(); }} disabled={cart.length === 0} style={{ ...menuItem, opacity: cart.length ? 1 : 0.45 }}>{L('Giữ bill này', 'Hold this bill')}</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );

  const notices = (
    <>
      {error && <div style={{ ...noticeBox, background: 'rgba(239,68,68,.10)', color: 'var(--ink-bad)' }}>{error}</div>}
      {okMsg && !done && <div style={{ ...noticeBox, background: 'var(--c052e16)', color: 'var(--ink-good)' }}>{okMsg}</div>}
      {!online && (layout !== 'wide' || tightTop) && <div style={{ ...noticeBox, background: 'rgba(245,158,11,.12)', color: 'var(--ink-warn)' }}>{t('po.offlineMode')}</div>}
      {pendingSync > 0 && (
        <div style={{ ...noticeBox, background: 'var(--c1e293b)', color: 'var(--ccbd5e1)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1 }}>{t('po.pendingSync').replace('{n}', String(pendingSync))}</span>
          {online && <button type="button" onClick={syncPending} style={{ ...textBtn, height: 32, fontSize: 13 }}>{t('po.syncNow')}</button>}
        </div>
      )}
      {scanMsg && <div style={{ ...noticeBox, background: scanMsg.ok ? 'var(--c052e16)' : 'rgba(245,158,11,.12)', color: scanMsg.ok ? 'var(--ink-good)' : 'var(--ink-warn)' }}>{scanMsg.text}</div>}
    </>
  );

  const waitingStrip = waiting.length > 0 && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
      {layout === 'wide' && <div style={sectionLabel}>{L('KHÁCH CHỜ THANH TOÁN', 'READY TO CHECK OUT')}</div>}
      <div className="pos-noscroll" style={{ display: 'flex', gap: layout === 'phone' ? 8 : 10, overflowX: 'auto', scrollbarWidth: 'none' }}>
        {waiting.slice(0, 12).map((w) => {
          const on = walkInId === w.id;
          const nm = w.name || L('Khách vãng lai', 'Walk-in');
          return (
            <button key={w.id} type="button" onClick={() => openWaiting(w)} style={{
              flex: layout === 'phone' || waiting.length > 3 ? '0 0 auto' : '1 1 0', minWidth: layout === 'phone' ? 0 : 200, maxWidth: layout === 'phone' ? 220 : undefined,
              height: layout === 'wide' ? (tightTop ? 56 : 64) : (layout === 'dock' ? 52 : 48), boxSizing: 'border-box', padding: '0 12px', borderRadius: 12,
              border: on ? '2px solid #4f46e5' : '1px solid var(--line)', background: 'var(--c0f172a)', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', cursor: 'pointer',
            }}>
              <span style={{ width: layout === 'wide' ? 36 : 30, height: layout === 'wide' ? 36 : 30, flexShrink: 0, borderRadius: '50%', background: 'var(--c1e1b4b)', color: 'var(--ce0e7ff)', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials(nm)}</span>
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.3 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nm}</span>
                {layout !== 'phone' && layout !== 'dock' && (
                  <span style={{ fontSize: 12.5, color: w.awaitingPayment ? 'var(--ink-good)' : 'var(--c94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.awaitingPayment ? `${L('Chờ trả tiền', 'Ready to pay')} · ` : ''}{w.what}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const searchBox = (
    <label style={{ flex: layout === 'phone' ? '0 0 auto' : '1 1 0', minWidth: 0, height: layout === 'wide' && !tightTop ? 52 : 48, boxSizing: 'border-box', padding: '0 14px', borderRadius: 12, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <IcoSearch />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); searchEnter(); } }}
        placeholder={layout === 'phone' ? L('Tìm dịch vụ', 'Search services') : products.length ? L('Tìm dịch vụ, sản phẩm — hoặc quét mã vạch', 'Search services, products — or scan a barcode') : L('Tìm dịch vụ', 'Search services')}
        style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 16, fontFamily: 'inherit', background: 'transparent', color: 'var(--cf1f5f9)' }}
      />
      {query && <button type="button" onClick={() => setQuery('')} aria-label={L('Xoá tìm kiếm', 'Clear search')} style={{ border: 'none', background: 'transparent', color: 'var(--c94a3b8)', fontSize: 20, cursor: 'pointer', padding: 4 }}>×</button>}
      {products.length > 0 && (
        <button type="button" onClick={() => setShowScanner(true)} aria-label={t('po.scanCamera')} title={t('po.scanCamera')} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4, display: 'flex', color: 'var(--c94a3b8)' }}><IcoBarcode /></button>
      )}
    </label>
  );

  const tabSwitch = tabs.length > 1 && (
    <div style={{ height: layout === 'wide' && !tightTop ? 52 : 48, boxSizing: 'border-box', padding: 4, borderRadius: 12, background: 'var(--c1e293b)', display: 'flex', gap: 4, flexShrink: 0 }}>
      {tabs.map((x) => (
        <button key={x.id} type="button" onClick={() => setTab(x.id)} style={{ height: '100%', padding: layout === 'phone' ? '0 10px' : '0 16px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: tab === x.id ? 700 : 600, background: tab === x.id ? 'var(--c0f172a)' : 'transparent', color: tab === x.id ? 'var(--cf1f5f9)' : 'var(--c94a3b8)', boxShadow: tab === x.id ? '0 1px 2px rgba(15,23,42,.12)' : 'none', whiteSpace: 'nowrap' }}>{x.label}</button>
      ))}
    </div>
  );

  const catArrow = (dir: -1 | 1, show: boolean) => (
    <button type="button" aria-label={dir < 0 ? L('Danh mục trước', 'Previous categories') : L('Danh mục sau', 'More categories')} onClick={() => catScroll.nudge(dir)}
      style={{ position: 'absolute', top: 0, bottom: 0, [dir < 0 ? 'left' : 'right']: 0, width: 56, border: 'none', padding: 0, cursor: 'pointer', display: show ? 'flex' : 'none', alignItems: 'center', justifyContent: dir < 0 ? 'flex-start' : 'flex-end',
        background: `linear-gradient(to ${dir < 0 ? 'right' : 'left'}, var(--c0b1120) 45%, transparent)`, color: 'var(--ccbd5e1)' }}>
      <span style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--line)', background: 'var(--c0f172a)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 1px 3px rgba(15,23,42,.12)' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">{dir < 0 ? <path d="M15 18l-6-6 6-6" /> : <path d="M9 18l6-6-6-6" />}</svg>
      </span>
    </button>
  );
  const catRow = tab === 'SERVICE' && serviceCats.length > 0 && (
    <div style={{ position: 'relative', flexShrink: 0, margin: layout === 'phone' ? '0 -12px' : 0 }}>
    <div ref={catScroll.ref} className="pos-noscroll" style={{ display: 'flex', gap: layout === 'phone' ? 6 : 8, overflowX: 'auto', scrollbarWidth: 'none', padding: layout === 'phone' ? '0 12px' : '0 1px', scrollSnapType: 'x proximity' }}>
      {[{ id: null as string | null, name: t('po.allCats') }, ...serviceCats].map((c) => {
        const on = catFilter === c.id;
        return (
          <button key={c.id ?? 'all'} type="button" onClick={() => setCatFilter(c.id)} style={{ height: layout === 'phone' ? 38 : 40, flexShrink: 0, padding: '0 14px', borderRadius: 999, border: '1px solid ' + (on ? 'var(--ce2e8f0)' : 'var(--line)'), background: on ? 'var(--ce2e8f0)' : 'var(--c0f172a)', color: on ? 'var(--c0f172a)' : 'var(--ccbd5e1)', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {c.id && <span style={{ width: 8, height: 8, borderRadius: '50%', background: catHue.get(c.id) }} />}
            {niceName(c.name)}
          </button>
        );
      })}
    </div>
    {layout !== 'phone' && catArrow(-1, catScroll.canLeft)}
    {layout !== 'phone' && catArrow(1, catScroll.canRight)}
    </div>
  );

  const tile = (key: string, name: string, meta: string, price: React.ReactNode, count: number, onClick: () => void, dot?: string, dashed?: boolean, img?: string | null) => (
    <button key={key} type="button" onClick={onClick} className="pos-tile" style={{
      position: 'relative', boxSizing: 'border-box', height: '100%', minHeight: tileRow,
      padding: layout === 'phone' ? '10px 12px' : '14px 14px 12px', borderRadius: layout === 'phone' ? 12 : 14,
      border: count ? '2px solid #4f46e5' : `1px ${dashed ? 'dashed' : 'solid'} var(--line)`, background: 'var(--c0f172a)',
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 8, textAlign: 'left', cursor: 'pointer', boxShadow: '0 1px 2px rgba(15,23,42,.05)',
    }}>
      <span style={{ display: 'flex', alignItems: img ? 'center' : 'flex-start', gap: img ? 10 : 8, minWidth: 0 }}>
        {img
          ? <img src={img} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} style={{ width: layout === 'phone' ? 40 : 48, height: layout === 'phone' ? 40 : 48, flexShrink: 0, borderRadius: 10, objectFit: 'cover', background: 'var(--c1e293b)' }} />
          : dot && <span style={{ width: 8, height: 8, marginTop: 7, flexShrink: 0, borderRadius: '50%', background: dot }} />}
        <span style={{ fontSize: layout === 'phone' ? 14.5 : 15, fontWeight: 600, lineHeight: 1.3, color: 'var(--cf1f5f9)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' }}>{niceName(name)}</span>
      </span>
      <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, minWidth: 0 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--c94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta}</span>
        <span style={{ flexShrink: 0, fontSize: layout === 'phone' ? 16 : 17, fontWeight: 700, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap' }}>{price}</span>
      </span>
      {count > 0 && (
        <span style={{ position: 'absolute', top: -8, right: -8, minWidth: 26, height: 26, padding: '0 6px', boxSizing: 'border-box', borderRadius: 999, background: '#4f46e5', color: '#fff', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--c0b1120)' }}>{count}</span>
      )}
    </button>
  );
  const priceTag = (cents: number, disc?: number, from?: boolean) => {
    const d = disc ?? 0;
    const netC = d > 0 ? Math.round((cents * (100 - d)) / 100) : cents;
    return (
      <>
        {d > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--c64748b)', textDecoration: 'line-through', marginRight: 5 }}>{fmtShort(cents)}</span>}
        {from ? <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c94a3b8)', marginRight: 3 }}>{L('từ', 'from')}</span> : null}{fmtShort(netC)}
      </>
    );
  };

  const grid = (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', margin: '0 -8px', padding: '10px 8px 12px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${tileMin}px, 1fr))`, gridAutoRows: tileRow, gap: layout === 'phone' ? 8 : layout === 'wide' && !tightTop ? 12 : 10, alignContent: 'start' }}>
        {tab === 'SERVICE' && flatServices.map((s) => tile(
          s.id, s.name, s.durationMinutes > 0 ? `${s.durationMinutes} ${L('phút', 'min')}` : (s.category && catFilter === null ? niceName(s.category.name) : ''), priceTag(s.priceCents, s.discountPercent, s.priceFrom),
          qtyInCart.get(s.id) || 0, () => addService(s), s.category ? catHue.get(s.category.id) : undefined, false, s.imageUrl,
        ))}
        {tab === 'ADDON' && addonGroups.flatMap((g) => g.items).map((a) => tile(
          a.id, `+ ${a.name}`, a.service?.name ?? '', fmt(a.priceCents), qtyInCart.get(a.id) || 0, () => addAddon(a), undefined, true,
        ))}
        {tab === 'PRODUCT' && productsF.map((p) => tile(
          p.id, p.name, p.trackStock ? `${t('po.stock')}: ${p.stockQty}` : '', priceTag(p.priceCents, p.discountPercent), qtyInCart.get(p.id) || 0, () => addProduct(p), undefined, false, p.imageUrl,
        ))}
      </div>
      {tab === 'SERVICE' && flatServices.length === 0 && <EmptyState text={services.length === 0 ? t('po.noServices') : `${t('po.noMatch')} "${query}"`} />}
      {tab === 'ADDON' && addonGroups.length === 0 && <EmptyState text={addons.length === 0 ? L('Chưa có add-on nào.', 'No add-ons yet.') : `${t('po.noMatch')} "${query}"`} />}
      {tab === 'PRODUCT' && productsF.length === 0 && <EmptyState text={products.length === 0 ? L('Chưa có sản phẩm nào.', 'No products yet.') : `${t('po.noMatch')} "${query}"`} />}
    </div>
  );

  /* ------------------------------------------------------------- the bill */
  const custRow = (compactRow: boolean) => (
    <div style={{ padding: compactRow ? '10px 16px' : '16px 20px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
      {customerId || custName ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: compactRow ? 40 : 44, height: compactRow ? 40 : 44, flexShrink: 0, borderRadius: '50%', background: 'rgba(219,39,119,.14)', color: 'var(--ce2e8f0)', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{initials(custName || '?')}</span>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
            <span style={{ fontSize: compactRow ? 15 : 16, fontWeight: 700, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{custName || t('po.custAttached')}</span>
            <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[custPhone, loyalty.enabled && customerId ? `${customerPoints} ${L('điểm', 'points')}` : ''].filter(Boolean).join(' · ') || (walkInId ? L('Khách tại tiệm', 'In the salon') : '')}</span>
          </div>
          <button type="button" onClick={() => { setCustomerId(null); setCustomerLabel(null); setCustomerPoints(0); setRedeemInput(''); }} style={{ height: 36, padding: '0 12px', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--c0f172a)', fontSize: 13, fontWeight: 600, color: 'var(--ccbd5e1)', cursor: 'pointer' }}>{L('Đổi', 'Change')}</button>
        </div>
      ) : (
        <CustomerBox
          token={token} t={t}
          customerId={customerId} customerLabel={customerLabel} customerPoints={customerPoints}
          onPick={(id, label, points) => { setCustomerId(id); setCustomerLabel(label); setCustomerPoints(points); }}
          onClear={() => { setCustomerId(null); setCustomerLabel(null); setCustomerPoints(0); setRedeemInput(''); }}
        />
      )}
    </div>
  );

  const techChip = (l: Line) => {
    const st = l.staffMemberId ? staff.find((x) => x.id === l.staffMemberId) : null;
    const nm = st ? st.firstName : L('Chọn thợ', 'Pick tech');
    const warn = !st && l.kind === 'SERVICE' && staff.length > 0;
    return (
      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 10px 0 4px', borderRadius: 999, border: '1px solid ' + (warn ? 'rgba(217,119,6,.55)' : 'var(--line)'), background: warn ? 'rgba(245,158,11,.12)' : 'var(--c1e293b)', color: warn ? 'var(--ink-warn)' : 'var(--cf1f5f9)', fontSize: 13, fontWeight: 600, flexShrink: 0, maxWidth: 170 }}>
        <span style={{ width: 24, height: 24, flexShrink: 0, borderRadius: '50%', background: st ? staffHue(st.id) : '#c2410c', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{st ? (st.firstName[0] || '?').toUpperCase() : '?'}</span>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nm}</span>
        {/* The real control: a native picker laid over the chip — one tap, works with touch and mouse alike. */}
        <select
          aria-label={t('po.technician')}
          value={l.staffMemberId}
          onChange={(e) => updateLine(l.uid, { staffMemberId: e.target.value })}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', fontSize: 16 }}
        >
          <option value="">{t('po.technician')}</option>
          {staff.map((s2) => <option key={s2.id} value={s2.id}>{s2.firstName} {s2.lastName ?? ''}</option>)}
        </select>
      </span>
    );
  };

  const lineRow = (l: Line, dense: boolean) => {
    const open = editUid === l.uid;
    const cat = catalogPrice(l);
    return (
      <div key={l.uid} style={{ borderBottom: '1px solid var(--line)', padding: dense ? '10px 4px' : '12px 8px' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button type="button" onClick={() => setEditUid(open ? null : l.uid)} style={{ border: 'none', background: 'transparent', padding: 0, textAlign: 'left', cursor: 'pointer', fontSize: dense ? 14.5 : 15, fontWeight: 600, color: 'var(--cf1f5f9)', lineHeight: 1.35 }}>
              {l.isAddon && <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ce0e7ff)', background: 'var(--c1e1b4b)', borderRadius: 5, padding: '1px 6px', marginRight: 6, verticalAlign: 'middle' }}>{t('po.addonBadge')}</span>}
              {niceName(l.name)}{l.quantity > 1 ? <span style={{ color: 'var(--c94a3b8)', fontWeight: 600 }}> × {l.quantity}</span> : null}
            </button>
            {(l.kind === 'SERVICE' && staff.length > 0) && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                {techChip(l)}
                {!dense && (() => { const sv = services.find((x) => x.id === l.refId); return sv && sv.durationMinutes > 0 ? <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{sv.durationMinutes} {L('phút', 'min')}</span> : null; })()}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
            <button type="button" onClick={() => setEditUid(open ? null : l.uid)} style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'right' }}>
              {l.discountPercent > 0 && <span style={{ display: 'block', fontSize: 12, color: 'var(--c64748b)', textDecoration: 'line-through' }}>{fmt(l.origUnitPriceCents * l.quantity)}</span>}
              <span style={{ fontSize: dense ? 15 : 16, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{fmt(l.unitPriceCents * l.quantity)}</span>
            </button>
            {!dense && (
              <button type="button" onClick={() => removeLine(l.uid)} aria-label={L('Bỏ dòng này', 'Remove line')} style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--c94a3b8)' }}><IcoX /></button>
            )}
          </div>
        </div>
        {open && (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 12, background: 'var(--c1e293b)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{L('Giá', 'Price')}</span>
            <input
              type="number" min={0} step="0.01" inputMode="decimal" autoFocus
              value={fromMinorUnits(l.unitPriceCents, currency)}
              onChange={(e) => setLinePrice(l.uid, e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              style={{ width: 110, height: 40, boxSizing: 'border-box', padding: '0 10px', borderRadius: 10, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--cf1f5f9)', fontSize: 16, fontWeight: 600, textAlign: 'right' }}
            />
            {cat != null && cat !== l.unitPriceCents && <button type="button" onClick={() => resetLinePrice(l.uid)} style={smallBtn}>{t('po.resetPrice')}</button>}
            {l.kind === 'PRODUCT' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
                <button type="button" onClick={() => updateLine(l.uid, { quantity: Math.max(1, l.quantity - 1) })} style={{ ...smallBtn, width: 40, padding: 0 }}>−</button>
                <span style={{ minWidth: 20, textAlign: 'center', fontWeight: 600, color: 'var(--cf1f5f9)' }}>{l.quantity}</span>
                <button type="button" onClick={() => updateLine(l.uid, { quantity: l.quantity + 1 })} style={{ ...smallBtn, width: 40, padding: 0 }}>+</button>
              </span>
            )}
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => { removeLine(l.uid); setEditUid(null); }} style={{ ...smallBtn, color: 'var(--ink-bad)' }}>{L('Xoá', 'Remove')}</button>
            <button type="button" onClick={() => setEditUid(null)} style={smallBtn}>{L('Xong', 'Done')}</button>
          </div>
        )}
      </div>
    );
  };

  const adjButtons = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      <button type="button" onClick={() => setAdj(adj === 'discount' ? null : 'discount')} style={adjBtn(adj === 'discount' || !!orderDiscount)}>{orderDiscount ? `${L('Giảm giá', 'Discount')} −${fmt(money.typedDiscount)}` : `+ ${L('Giảm giá', 'Discount')}`}</button>
      <button type="button" onClick={() => setAdj(adj === 'promo' ? null : 'promo')} style={adjBtn(adj === 'promo' || !!promo)}>{promo ? `${promo.code}${money.promoCents ? ` −${fmt(money.promoCents)}` : ''}` : `+ ${L('Mã ưu đãi', 'Promo code')}`}</button>
      {online && <button type="button" onClick={() => setAdj(adj === 'gift' ? null : 'gift')} style={adjBtn(adj === 'gift' || !!giftCard)}>{giftCard ? `${L('Thẻ quà', 'Gift card')} −${fmt(money.giftApplied)}` : `+ ${L('Thẻ quà', 'Gift card')}`}</button>}
      {loyalty.enabled && customerId && online && customerPoints >= loyalty.minRedeemPoints && (
        <button type="button" onClick={() => setAdj(adj === 'points' ? null : 'points')} style={adjBtn(adj === 'points' || money.redeemPts > 0)}>{money.redeemPts > 0 ? `${money.redeemPts} ${L('điểm', 'pts')} −${fmt(money.redeemDiscount)}` : `+ ${L(`Dùng ${customerPoints} điểm`, `Use ${customerPoints} pts`)}`}</button>
      )}
    </div>
  );

  const adjPanel = adj && (
    <div style={{ padding: 10, borderRadius: 12, background: 'var(--c1e293b)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {adj === 'discount' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 10, background: 'var(--c0f172a)', border: '1px solid var(--line)', flexShrink: 0 }}>
            {([['AMOUNT', uiCurrencySymbol()], ['PERCENT', '%']] as const).map(([m, sym]) => (
              <button key={m} type="button" onClick={() => setDiscountMode(m)} style={discountMode === m ? { width: 38, height: 34, borderRadius: 8, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 700, cursor: 'pointer' } : { width: 38, height: 34, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--c94a3b8)', fontWeight: 700, cursor: 'pointer' }}>{sym}</button>
            ))}
          </div>
          <input type="number" min={0} step={discountMode === 'PERCENT' ? 1 : 0.01} autoFocus value={orderDiscount} onChange={(e) => setOrderDiscount(e.target.value)} placeholder="0" style={adjInput} />
          {orderDiscount && <button type="button" onClick={() => setOrderDiscount('')} style={smallBtn}>{L('Bỏ', 'Clear')}</button>}
        </div>
      )}
      {adj === 'promo' && (promo ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--ink-good)', fontWeight: 600 }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{promo.code} · {promo.label}</span>
          <button type="button" onClick={() => { setPromo(null); setPromoInput(''); setPromoErr(null); }} style={smallBtn}>{L('Bỏ', 'Remove')}</button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input value={promoInput} autoFocus onChange={(e) => { setPromoInput(e.target.value.toUpperCase()); setPromoErr(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyPromo(); } }} placeholder={t('po.promoPh')} style={{ ...adjInput, textAlign: 'left', textTransform: 'uppercase' }} />
          <button type="button" disabled={!promoInput.trim() || promoBusy} onClick={applyPromo} style={{ height: 40, padding: '0 14px', borderRadius: 10, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 600, cursor: 'pointer', opacity: !promoInput.trim() || promoBusy ? 0.5 : 1 }}>{promoBusy ? '…' : t('po.promoApply')}</button>
        </div>
      ))}
      {adj === 'promo' && promoErr && <div style={{ fontSize: 12.5, color: 'var(--ink-bad)' }}>{promoErr}</div>}
      {adj === 'promo' && promo && !promo.appliesDiscount && <div style={{ fontSize: 12.5, color: 'var(--ink-warn)' }}>{t('po.promoGift')}</div>}
      {adj === 'gift' && (giftCard ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: 'var(--ccbd5e1)' }}>
          <span style={{ flex: 1 }}>{giftCard.code} · {fmt(money.giftApplied)}</span>
          <button type="button" onClick={() => setGiftCard(null)} style={smallBtn}>{t('po.gcRemove')}</button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input value={giftInput} autoFocus onChange={(e) => setGiftInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyGift(); } }} placeholder={t('po.gcPlaceholder')} style={{ ...adjInput, textAlign: 'left' }} />
          <button type="button" onClick={applyGift} style={{ height: 40, padding: '0 14px', borderRadius: 10, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>{t('po.gcApply')}</button>
        </div>
      ))}
      {adj === 'points' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{t('po.redeemPoints').replace('{n}', String(customerPoints))}</span>
          <input type="number" min={0} autoFocus value={redeemInput} onChange={(e) => setRedeemInput(e.target.value)} placeholder={t('po.minPts').replace('{n}', String(loyalty.minRedeemPoints))} style={adjInput} />
        </div>
      )}
    </div>
  );

  const totalsBlock = (big: number) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={totRow}><span>{t('po.subtotal')}</span><span>{fmt(money.subtotal)}</span></div>
      {money.discount > 0 && <div style={totRow}><span>{L('Giảm giá', 'Discount')}</span><span>−{fmt(money.discount)}</span></div>}
      {money.redeemDiscount > 0 && <div style={totRow}><span>{t('po.pointsDiscount').replace('{n}', String(money.redeemPts))}</span><span>−{fmt(money.redeemDiscount)}</span></div>}
      {money.tax > 0 && <div style={totRow}><span>{t('po.tax').replace('{r}', String(taxRate))}</span><span>{fmt(money.tax)}</span></div>}
      {tipsOn && svcBase > 0 && <div style={totRow}><span>Tip</span><span>{money.tip > 0 ? fmt(money.tip) : L('Khách chọn khi thanh toán', 'Chosen at payment')}</span></div>}
      {money.giftApplied > 0 && <div style={totRow}><span>{L('Thẻ quà', 'Gift card')}</span><span>−{fmt(money.giftApplied)}</span></div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4, gap: 10 }}>
        <span style={{ fontSize: big > 28 ? 16 : 15, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{dualPrice ? L('Tổng · tiền mặt', 'Total · cash') : t('po.total')}</span>
        <span style={{ fontSize: big, fontWeight: 700, letterSpacing: -0.5, color: 'var(--cf1f5f9)' }}>{fmt(cashDue)}</span>
      </div>
      {dualPrice && <div style={{ ...totRow, fontSize: 13.5 }}><span>{L(`Trả thẻ (+${cardSurchargePct}%)`, `By card (+${cardSurchargePct}%)`)}</span><b style={{ color: 'var(--ccbd5e1)' }}>{fmt(cardDue)}</b></div>}
    </div>
  );

  const missingNote = missingTech && (
    <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(245,158,11,.12)', color: 'var(--ink-warn)', fontSize: 13, fontWeight: 600 }}>
      {L('Còn dịch vụ chưa chọn thợ — chạm “Chọn thợ” để tính tip và hoa hồng đúng người.', 'Some services have no technician — tap “Pick tech” so tips and commission go to the right person.')}
    </div>
  );

  const emptyBill = (
    <div style={{ flex: 1, minHeight: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, textAlign: 'center', padding: 16 }}>
      <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ccbd5e1)' }}>{L('Bill đang trống', 'The bill is empty')}</span>
      <span style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{waiting.length ? L('Chạm dịch vụ, hoặc chọn khách đang chờ', 'Tap a service, or pick a waiting client') : L('Chạm dịch vụ để thêm vào bill', 'Tap a service to add it')}</span>
    </div>
  );

  const payBtn = (h: number, label?: string) => (
    <button type="button" onClick={goPay} disabled={cart.length === 0} style={cart.length
      ? { flex: 1, height: h, borderRadius: 14, border: 'none', background: '#4f46e5', color: '#fff', fontSize: h >= 60 ? 18 : 17, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }
      : { flex: 1, height: h, borderRadius: 14, border: 'none', background: '#a5b4fc', color: '#fff', fontSize: h >= 60 ? 18 : 17, fontWeight: 700, cursor: 'default', whiteSpace: 'nowrap' }}>
      {label ?? `${L('Thanh toán', 'Charge')} · ${fmt(cashDue)}`}
    </button>
  );
  const holdBtn = (h: number, short?: boolean) => (
    <button type="button" onClick={park} disabled={cart.length === 0} style={{ height: h, padding: '0 16px', borderRadius: 14, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', fontSize: 15, fontWeight: 600, color: 'var(--ccbd5e1)', cursor: cart.length ? 'pointer' : 'default', opacity: cart.length ? 1 : 0.5, whiteSpace: 'nowrap', flexShrink: 0 }}>{short ? L('Giữ', 'Hold') : L('Giữ bill', 'Hold')}</button>
  );

  /** The bill on the right of a wide screen. */
  const sideTicket = (
    <div style={{ width: tightTop ? 380 : 440, flexShrink: 0, boxSizing: 'border-box', background: 'var(--c0f172a)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {custRow(tightTop)}
      {!tightTop && (
        <div style={{ padding: '12px 20px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexShrink: 0 }}>
          <span style={sectionLabel}>{L('BILL', 'BILL')} · {cart.length} {L('DÒNG', cart.length === 1 ? 'ITEM' : 'ITEMS')}</span>
          {cart.length > 0 && <button type="button" onClick={() => { if (window.confirm(L('Xoá toàn bộ bill?', 'Clear the whole bill?'))) clearCart(); }} style={{ border: 'none', background: 'transparent', fontSize: 13, fontWeight: 600, color: 'var(--c94a3b8)', cursor: 'pointer', padding: '6px 0' }}>{L('Xoá bill', 'Clear bill')}</button>}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: tightTop ? '4px 12px' : '0 12px', display: 'flex', flexDirection: 'column' }}>
        {cart.length === 0 ? emptyBill : cart.map((l) => lineRow(l, tightTop))}
      </div>
      <div style={{ padding: tightTop ? '8px 16px' : '10px 20px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        {adjButtons}
        {adjPanel}
      </div>
      <div style={{ padding: tightTop ? '8px 16px' : '12px 20px 8px', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        {totalsBlock(tightTop ? 26 : 30)}
        {missingNote}
      </div>
      <div style={{ padding: tightTop ? '8px 16px 16px' : '8px 20px 20px', display: 'flex', gap: 10, flexShrink: 0 }}>
        {holdBtn(tightTop ? 56 : 60, tightTop)}
        {payBtn(tightTop ? 56 : 60)}
      </div>
    </div>
  );

  /** The bill docked under the catalog on an upright iPad. */
  const dockTicket = (
    <div style={{ height: 'clamp(300px, 40dvh, 440px)', flexShrink: 0, boxSizing: 'border-box', background: 'var(--c0f172a)', borderTop: '1px solid var(--line)', borderRadius: '20px 20px 0 0', boxShadow: '0 -8px 24px rgba(15,23,42,.08)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8 }}><span style={{ width: 44, height: 5, borderRadius: 999, background: 'var(--c334155)' }} /></div>
      {custRow(true)}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 16px', display: 'flex', flexDirection: 'column' }}>
        {cart.length === 0 ? emptyBill : cart.map((l) => lineRow(l, true))}
      </div>
      <div style={{ padding: '8px 16px 0', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        {adjButtons}
        {adjPanel}
        {missingNote}
      </div>
      <div style={{ padding: '10px 20px calc(16px + env(safe-area-inset-bottom, 0px))', display: 'flex', alignItems: 'center', gap: 14, borderTop: '1px solid var(--line)', marginTop: 8, flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, minWidth: 0 }}>
          <span style={{ fontSize: 13, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{dualPrice ? `${L('Tiền mặt · thẻ', 'Cash · card')} ${fmt(cardDue)}` : t('po.total')}</span>
          <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{fmt(cashDue)}</span>
        </div>
        <div style={{ flex: 1 }} />
        {holdBtn(56)}
        <div style={{ width: 260, display: 'flex' }}>{payBtn(56, L('Thanh toán', 'Charge'))}</div>
      </div>
    </div>
  );

  /** The bill as its own screen on a phone. */
  const phoneTicket = (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--c0f172a)' }}>
      <div style={{ height: 56, flexShrink: 0, boxSizing: 'border-box', padding: '0 8px', display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid var(--line)' }}>
        <button type="button" onClick={() => setMobileView('catalog')} style={{ height: 44, padding: '0 8px', border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', gap: 4, fontSize: 15, fontWeight: 600, color: 'var(--ink-link)', cursor: 'pointer' }}><IcoBack />{L('Thêm dịch vụ', 'Add services')}</button>
        <span style={{ flex: 1, textAlign: 'right', paddingRight: 8, fontSize: 14, fontWeight: 600, color: 'var(--c94a3b8)' }}>{L('Bill', 'Bill')} · {cart.length}</span>
      </div>
      {custRow(true)}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 16px', display: 'flex', flexDirection: 'column' }}>
        {cart.length === 0 ? emptyBill : cart.map((l) => lineRow(l, false))}
        {cart.length > 0 && <span style={{ display: 'block', padding: '10px 0', fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L('Chạm vào một dòng để sửa giá, số lượng hoặc xoá.', 'Tap a line to change its price, quantity or remove it.')}</span>}
      </div>
      <div style={{ padding: '10px 16px 0', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        {adjButtons}
        {adjPanel}
      </div>
      <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        {totalsBlock(28)}
        {missingNote}
      </div>
      <div style={{ padding: '8px 16px calc(16px + env(safe-area-inset-bottom, 0px))', display: 'flex', gap: 8, flexShrink: 0 }}>
        {holdBtn(56, true)}
        {payBtn(56)}
      </div>
    </div>
  );

  /** The bar at the bottom of the phone catalog: the running bill, one tap away. */
  const phoneBar = (
    <div style={{ flexShrink: 0, boxSizing: 'border-box', padding: '10px 12px calc(12px + env(safe-area-inset-bottom, 0px))', background: 'var(--c0f172a)', borderTop: '1px solid var(--line)' }}>
      <button type="button" onClick={() => setMobileView('ticket')} style={{ width: '100%', height: 60, boxSizing: 'border-box', padding: '0 16px', borderRadius: 14, border: 'none', background: '#4f46e5', color: '#fff', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ minWidth: 28, height: 28, padding: '0 6px', boxSizing: 'border-box', borderRadius: 999, background: '#ffffff', color: '#3730a3', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{cart.reduce((a, l) => a + l.quantity, 0)}</span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
          <span style={{ fontSize: 15, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{L('Xem bill', 'View bill')}{custName ? ` · ${custName}` : ''}</span>
          {missingTech && <span style={{ fontSize: 12, opacity: 0.9 }}>{L('Có dịch vụ chưa chọn thợ', 'A service has no technician')}</span>}
        </span>
        <span style={{ fontSize: 18, fontWeight: 700 }}>{fmt(cashDue)}</span>
      </button>
    </div>
  );

  /* ------------------------------------------------------------- payment */
  const methodSub = (m: PayMethod) => (m === 'CARD' && dualPrice ? `${fmt(cardDue)} · +${cardSurchargePct}%` : fmt(m === 'CARD' ? cardDue : cashDue));
  const selectMethod = (m: PayMethod) => { setSplit(false); setParts([]); setPayMethod(m); };
  const startSplit = () => { setSplit(true); setParts([{ method: tillMethods.includes('CASH') ? 'CASH' : tillMethods[0], amount: fromMinorUnits(cashDue, currency) }, { method: tillMethods.includes('CARD') ? 'CARD' : (tillMethods[1] ?? tillMethods[0]), amount: '' }]); };
  const payNarrow = layout !== 'wide';

  const methodTiles = (
    <div className={payNarrow ? 'pos-noscroll' : undefined} style={payNarrow
      ? { display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', flexShrink: 0 }
      : { display: 'grid', gridTemplateColumns: `repeat(${Math.min(tillMethods.length + 1, 6)}, minmax(0, 1fr))`, gap: 10 }}>
      {[...tillMethods.map((m) => ({ id: m as string, label: payLabel(m, lang), sub: methodSub(m), on: !split && payMethod === m, go: () => selectMethod(m) })),
        { id: 'SPLIT', label: L('Chia bill', 'Split'), sub: L('Nhiều cách trả', 'Several ways'), on: split, go: () => (split ? selectMethod(payMethod) : startSplit()) }]
        .map((x) => (payNarrow ? (
          <button key={x.id} type="button" onClick={x.go} style={x.on
            ? { height: 44, flexShrink: 0, padding: '0 14px', borderRadius: 10, border: '2px solid #4f46e5', background: 'var(--c1e1b4b)', fontSize: 14, fontWeight: 700, color: 'var(--ce0e7ff)', cursor: 'pointer', whiteSpace: 'nowrap' }
            : { height: 44, flexShrink: 0, padding: '0 14px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--c0f172a)', fontSize: 14, fontWeight: 600, color: 'var(--cf1f5f9)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {x.id === 'CARD' && dualPrice ? `${x.label} +${cardSurchargePct}%` : x.id === 'SPLIT' ? L('Chia', 'Split') : x.label}
          </button>
        ) : (
          <button key={x.id} type="button" onClick={x.go} style={{ height: 84, borderRadius: 14, border: x.on ? '2px solid #4f46e5' : '1px solid var(--line)', background: x.on ? 'var(--c1e1b4b)' : 'var(--c0f172a)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer', padding: '0 6px' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: x.on ? 'var(--ce0e7ff)' : 'var(--cf1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{x.label}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: x.on ? 'var(--ce0e7ff)' : 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{x.sub}</span>
          </button>
        )))}
    </div>
  );

  const keyRow = payNarrow ? (layout === 'phone' ? 50 : 60) : tightTop ? 62 : 72;
  const short = money.tenderedCents > 0 && money.tenderedCents < money.due;
  const changeBox = (
    <div style={{ marginTop: payNarrow ? 0 : 'auto', flexShrink: 0, padding: payNarrow ? '10px 14px' : tightTop ? '14px 16px' : '18px 20px', borderRadius: 14, background: short ? 'rgba(245,158,11,.12)' : 'var(--c052e16)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
      <span style={{ fontSize: payNarrow || tightTop ? 15 : 17, fontWeight: 700, color: short ? 'var(--ink-warn)' : 'var(--ink-good)' }}>{short ? L('Còn thiếu', 'Still owed') : L('Tiền thừa trả khách', 'Change due')}</span>
      <span style={{ fontSize: payNarrow ? 26 : tightTop ? 30 : 40, fontWeight: 700, whiteSpace: 'nowrap', color: short ? 'var(--ink-warn)' : 'var(--ink-good)' }}>{fmt(short ? money.due - money.tenderedCents : money.change)}</span>
    </div>
  );
  const cashPanel = (
    <div style={payNarrow
      ? { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gridAutoRows: 'max-content', gap: 12 }
      : { display: 'flex', gap: tightTop ? 16 : 24, flex: 1, minHeight: 0 }}>
      <div style={{ flex: payNarrow ? undefined : 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: payNarrow ? 10 : 14 }}>
        {!payNarrow && <span style={sectionLabel}>{L('KHÁCH ĐƯA', 'CASH RECEIVED')}</span>}
        <div
          tabIndex={0}
          onKeyDown={(e) => {
            if (/^[0-9]$/.test(e.key)) { e.preventDefault(); keypad(e.key); }
            else if (e.key === 'Backspace') { e.preventDefault(); keypad('back'); }
            else if (e.key === 'Enter') { e.preventDefault(); pay(); }
          }}
          style={{ height: payNarrow ? 56 : 76, boxSizing: 'border-box', padding: '0 18px', borderRadius: 14, border: '2px solid var(--ce2e8f0)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, outline: 'none', background: 'var(--c0f172a)' }}>
          {payNarrow && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c94a3b8)' }}>{L('Khách đưa', 'Received')}</span>}
          <span style={{ marginLeft: 'auto', fontSize: payNarrow ? 28 : tightTop ? 32 : 40, fontWeight: 700, whiteSpace: 'nowrap', color: money.tenderedCents ? 'var(--cf1f5f9)' : 'var(--c64748b)' }}>{fmt(money.tenderedCents)}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: tightTop && !payNarrow ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: payNarrow ? 6 : 10 }}>
          {[{ k: 'exact', label: t('po.exact'), cents: money.due }, ...quickCash(money.due).map((c) => ({ k: String(c), label: fmtShort(c), cents: c }))].slice(0, 4).map((q2) => {
            const on = money.tenderedCents === q2.cents && money.tenderedCents > 0;
            return <button key={q2.k} type="button" onClick={() => setTendered(fromMinorUnits(q2.cents, currency))} style={{ height: payNarrow ? 44 : 56, borderRadius: 12, border: on ? '2px solid var(--ce2e8f0)' : '1px solid var(--line)', background: on ? 'var(--c1e293b)' : 'var(--c0f172a)', fontSize: 15, fontWeight: on ? 800 : 700, color: 'var(--cf1f5f9)', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{q2.label}</button>;
          })}
        </div>
        {!payNarrow && changeBox}
      </div>
      <div style={{ width: payNarrow ? '100%' : tightTop ? 240 : 330, flexShrink: 0, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gridAutoRows: keyRow, gap: payNarrow ? 6 : 10, alignContent: 'start' }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'back'].map((k) => (
          <button key={k} type="button" onClick={() => keypad(k)} aria-label={k === 'back' ? L('Xoá một số', 'Delete a digit') : undefined} style={{ borderRadius: payNarrow ? 12 : 14, border: payNarrow ? 'none' : '1px solid var(--line)', background: 'var(--c1e293b)', fontSize: payNarrow ? 21 : 24, fontWeight: 600, color: 'var(--cf1f5f9)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {k === 'back' ? <IcoBackspace /> : k}
          </button>
        ))}
      </div>
      {payNarrow && changeBox}
    </div>
  );

  const cardPanel = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 14, background: 'var(--c1e293b)' }}>
      <span style={{ fontSize: 15, color: 'var(--ccbd5e1)' }}>{t('po.cardHint').replace('{x}', fmt(money.due))}</span>
      {hubConn && (
        <div style={{ fontSize: 14, color: 'var(--ce2e8f0)' }}>
          {hubReaders.length > 1 ? (
            <select value={hubReader} onChange={(e) => setHubReader(e.target.value)} style={{ height: 44, borderRadius: 10, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--cf1f5f9)', padding: '0 10px', fontSize: 15 }}>
              {hubReaders.map((r) => <option key={r.id} value={r.externalReaderId}>{(r.label || r.externalReaderId) + ' (' + r.status + ')'}</option>)}
            </select>
          ) : (
            <span>{hubReaders.find((r) => r.externalReaderId === hubReader)?.label || L('Máy quẹt thẻ', 'Card reader')} {hubReader ? L('· sẵn sàng', '· ready') : L('— chưa có máy', '— no reader')}</span>
          )}
          <div style={{ color: 'var(--c94a3b8)', fontSize: 13, marginTop: 4 }}>{L('Bấm Hoàn tất để gửi số tiền tới máy quẹt.', 'Press Complete to send the amount to the reader.')}</div>
        </div>
      )}
    </div>
  );

  const transferPanel = (() => {
    const d = payDetails[payMethod] ?? {};
    const info = d.instructions ?? (payMethod === 'TRANSFER' ? transferInfo : '');
    const qr = d.qrUrl ?? (payMethod === 'TRANSFER' ? transferQr : '');
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 14, background: 'var(--c1e293b)' }}>
        {info || qr ? (
          <>
            <span style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{t('po.transferShow').replace('{x}', fmt(money.due))}</span>
            {info && <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, color: 'var(--ce2e8f0)', margin: 0 }}>{info}</pre>}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {qr && <img src={qr} alt={`${payMethod} QR`} style={{ width: 160, height: 160, objectFit: 'contain', background: '#fff', borderRadius: 10, padding: 6 }} />}
            <span style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{t('po.transferAfter')}</span>
          </>
        ) : (
          <span style={{ fontSize: 14, color: 'var(--c94a3b8)' }}>{t('po.transferNoneA')}<a href="/salon/settings" style={{ color: 'var(--ink-link)' }}>{t('po.transferSettingsLink')}</a>{t('po.transferNoneB')}</span>
        )}
      </div>
    );
  })();

  const splitPanel = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 14, borderRadius: 14, background: 'var(--c1e293b)' }}>
      {parts.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={p.method} onChange={(e) => setParts((ps) => ps.map((x, j) => (j === i ? { ...x, method: e.target.value as PayMethod } : x)))} style={{ height: 44, width: 140, borderRadius: 10, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--cf1f5f9)', padding: '0 8px', fontSize: 15 }}>
            {tillMethods.map((m) => <option key={m} value={m}>{payLabel(m, lang)}</option>)}
          </select>
          <input type="number" min={0} step="0.01" inputMode="decimal" value={p.amount} placeholder="0.00" onChange={(e) => setParts((ps) => ps.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} style={{ ...adjInput, height: 44 }} />
          <button type="button" onClick={() => {
            const others = parts.reduce((a, x, j) => a + (j === i ? 0 : toMinorUnits(x.amount, currency)), 0);
            setParts((ps) => ps.map((x, j) => (j === i ? { ...x, amount: fromMinorUnits(Math.max(0, money.due - others), currency) } : x)));
          }} style={smallBtn}>{t('po.splitRest')}</button>
          {parts.length > 2 && <button type="button" onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))} aria-label={L('Bỏ phần này', 'Remove part')} style={{ ...smallBtn, color: 'var(--ink-bad)' }}>×</button>}
        </div>
      ))}
      {parts.length < 4 && <button type="button" onClick={() => setParts((ps) => [...ps, { method: tillMethods.includes('CARD') ? 'CARD' : tillMethods[0], amount: '' }])} style={{ ...smallBtn, alignSelf: 'flex-start' }}>+ {t('po.splitAdd')}</button>}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, fontWeight: 700, paddingTop: 6, borderTop: '1px solid var(--line)' }}>
        <span style={{ color: 'var(--c94a3b8)' }}>{money.splitRemaining > 0 ? t('po.splitRemaining') : t('po.change')}</span>
        <span style={{ color: money.splitRemaining > 0 ? 'var(--ink-warn)' : 'var(--ink-good)' }}>{fmt(Math.abs(money.splitRemaining))}</span>
      </div>
    </div>
  );

  const tipOptions = [
    { k: 'none', label: layout === 'phone' || (tightTop && !payNarrow) ? L('Không', 'None') : L('Không tip', 'No tip'), cents: 0 },
    ...[15, 18, 20].map((p) => ({ k: String(p), label: `${p}%`, cents: Math.round((svcBase * p) / 100) })),
  ];
  const tipBlock = tipsOn && svcBase > 0 && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: payNarrow ? 12 : 16, borderRadius: 14, background: 'var(--c1e293b)', border: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--cf1f5f9)', flexShrink: 0 }}>Tip</span>
        <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', textAlign: 'right' }}>{L('Khách chọn trên màn hình khách, hoặc bấm ở đây', 'The client picks it on their screen, or tap here')}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 6 }}>
        {tipOptions.map((o) => {
          const on = tipMode === o.k || (tipMode === null && o.k === 'none' && money.tip === 0);
          return <button key={o.k} type="button" onClick={() => { setTipMode(o.k); setCustomTip(''); applyCustomerTip(o.cents); }} style={{ height: payNarrow ? 48 : 54, minWidth: 0, padding: '0 2px', borderRadius: 10, border: on ? '2px solid #4f46e5' : '1px solid var(--line)', background: on ? 'var(--c1e1b4b)' : 'var(--c0f172a)', color: on ? 'var(--ce0e7ff)' : 'var(--cf1f5f9)', fontSize: 14, fontWeight: 600, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden' }}>
            <span>{o.label}</span>{o.cents > 0 && <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.8, whiteSpace: 'nowrap' }}>{fmt(o.cents)}</span>}
          </button>;
        })}
        <input type="number" min={0} step="0.01" inputMode="decimal" placeholder={L('Khác', 'Other')} value={customTip}
          onChange={(e) => { setCustomTip(e.target.value); setTipMode('custom'); applyCustomerTip(Math.max(0, toMinorUnits(e.target.value || '0', currency))); }}
          style={{ height: payNarrow ? 48 : 54, minWidth: 0, boxSizing: 'border-box', borderRadius: 10, border: tipMode === 'custom' ? '2px solid #4f46e5' : '1px solid var(--line)', background: 'var(--c0f172a)', color: 'var(--cf1f5f9)', fontSize: 14, fontWeight: 600, textAlign: 'center', padding: '0 4px' }} />
      </div>
      {money.tip > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--cf1f5f9)', flexShrink: 0, whiteSpace: 'nowrap' }}>{L('Chia tip theo thợ', 'Tip by technician')}</span>
            <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', textAlign: 'right' }}>{L('Tự chia theo giá dịch vụ · sửa được', 'Split by service value · editable')}</span>
          </div>
          {techsOnBill.map((sid) => {
            const st = sid ? staff.find((x) => x.id === sid) : null;
            return (
              <div key={sid || 'none'} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 32, height: 32, flexShrink: 0, borderRadius: '50%', background: st ? staffHue(st.id) : '#c2410c', color: '#fff', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{st ? (st.firstName[0] || '?').toUpperCase() : '?'}</span>
                <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: st ? 'var(--cf1f5f9)' : 'var(--ink-warn)' }}>{st ? `${st.firstName} ${st.lastName ?? ''}`.trim() : L('Chưa chọn thợ', 'No technician')}</span>
                <input type="number" min={0} step="0.01" inputMode="decimal" value={fromMinorUnits(techTips.get(sid) || 0, currency)}
                  onChange={(e) => setTechTip(sid, toMinorUnits(e.target.value || '0', currency))}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ width: 110, height: 40, boxSizing: 'border-box', padding: '0 12px', borderRadius: 10, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--cf1f5f9)', fontSize: 15, fontWeight: 600, textAlign: 'right' }} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const directTip = tipTechs.length > 0 && (
    <details style={{ borderRadius: 14, background: 'var(--c1e293b)', padding: '10px 14px' }}>
      <summary style={{ cursor: 'pointer', fontSize: 13.5, fontWeight: 600, color: 'var(--ccbd5e1)' }}>{t('po.tipTitle')}</summary>
      <div style={{ fontSize: 12, color: 'var(--c94a3b8)', margin: '8px 0' }}>{t('po.tipQrAfterNote')}</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {tipTechs.map((s2) => (
          <div key={s2.id} style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 160 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--cf1f5f9)' }}>{s2.firstName} {s2.lastName ?? ''}</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <input type="number" min={0} step="0.01" placeholder={uiCurrencySymbol()} value={tipLogInput[s2.id] || ''} onChange={(e) => setTipLogInput((m) => ({ ...m, [s2.id]: e.target.value }))} style={{ ...adjInput, height: 36, width: 70, flex: 'none' }} />
              <button type="button" onClick={() => logDirectTip(s2.id)} disabled={tipBusy === s2.id} style={{ ...smallBtn, height: 36 }}>{tipBusy === s2.id ? '…' : t('po.tipLogBtn')}</button>
            </div>
            {tipLogged[s2.id] > 0 && <span style={{ fontSize: 12, color: 'var(--ink-good)', fontWeight: 600 }}>✓ {fmt(tipLogged[s2.id])}</span>}
          </div>
        ))}
      </div>
    </details>
  );

  const printCheck = (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 600, color: 'var(--ccbd5e1)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
      <input type="checkbox" checked={printOn} onChange={(e) => togglePrint(e.target.checked)} style={{ width: 22, height: 22 }} />
      {L('In hoá đơn', 'Print receipt')}
    </label>
  );
  const completeLabel = submitting ? t('po.processing') : `${L('Hoàn tất · Thu', 'Complete · Take')} ${fmt(money.due)}`;
  const completeBtn = (h: number, w?: number) => (
    <button type="button" onClick={pay} disabled={submitting || cart.length === 0} style={{ width: w ?? '100%', height: h, borderRadius: 14, border: 'none', background: '#4f46e5', color: '#fff', fontSize: h >= 64 ? 19 : 17, fontWeight: 700, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1, whiteSpace: 'nowrap' }}>{completeLabel}</button>
  );
  const methodBody = money.due === 0
    ? <div style={{ padding: 16, borderRadius: 14, background: 'var(--c052e16)', color: 'var(--ink-good)', fontWeight: 600 }}>{L('Thẻ quà đã trả đủ — bấm Hoàn tất.', 'The gift card covers it — press Complete.')}</div>
    : split ? splitPanel
      : payMethod === 'CASH' ? cashPanel
        : payMethod === 'CARD' ? cardPanel
          : transferPanel;

  const payHeader = (
    <div style={{ height: layout === 'phone' ? 56 : 64, flexShrink: 0, boxSizing: 'border-box', padding: layout === 'phone' ? '0 8px' : '0 20px', display: 'flex', alignItems: 'center', gap: 16, background: 'var(--c0f172a)', borderBottom: '1px solid var(--line)' }}>
      <button type="button" onClick={() => setStep('register')} style={layout === 'phone'
        ? { height: 44, padding: '0 8px', border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', gap: 4, fontSize: 15, fontWeight: 600, color: 'var(--ink-link)', cursor: 'pointer' }
        : { ...textBtn, fontWeight: 600 }}>
        <IcoBack />{layout === 'phone' ? L('Bill', 'Bill') : L('Quay lại bill', 'Back to bill')}
      </button>
      <span style={{ flex: layout === 'phone' ? 1 : undefined, textAlign: layout === 'phone' ? 'right' : undefined, paddingRight: layout === 'phone' ? 8 : 0, fontSize: layout === 'phone' ? 14 : 16, fontWeight: layout === 'phone' ? 700 : 800, color: layout === 'phone' ? 'var(--c94a3b8)' : 'var(--cf1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {L('Thanh toán', 'Payment')}{custName ? ` · ${custName}` : ''}
      </span>
    </div>
  );

  const dueHead = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: payNarrow ? 'center' : 'flex-start', textAlign: payNarrow ? 'center' : 'left' }}>
      <span style={sectionLabel}>{L('CẦN THU', 'AMOUNT DUE')}</span>
      <span style={{ fontSize: payNarrow ? 40 : 52, fontWeight: 700, letterSpacing: -1, lineHeight: 1.1, color: 'var(--cf1f5f9)' }}>{fmt(money.due)}</span>
      <span style={{ fontSize: payNarrow ? 12.5 : 14, color: 'var(--c94a3b8)' }}>
        {`${L('Dịch vụ', 'Services')} ${fmt(money.subtotal - money.discount - money.redeemDiscount + money.tax)}`}
        {money.tip > 0 && ` + tip ${fmt(money.tip)}`}
        {money.cardSurcharge > 0 && ` + ${L('phí thẻ', 'card fee')} ${fmt(money.cardSurcharge)}`}
        {money.giftApplied > 0 && ` − ${L('thẻ quà', 'gift card')} ${fmt(money.giftApplied)}`}
      </span>
    </div>
  );

  const payLines = (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {cart.map((l) => {
        const st = l.staffMemberId ? staff.find((x) => x.id === l.staffMemberId) : null;
        return (
          <div key={l.uid} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderTop: '1px solid var(--line)', fontSize: 15, color: 'var(--cf1f5f9)' }}>
            <span style={{ minWidth: 0 }}>{l.name}{l.quantity > 1 ? ` × ${l.quantity}` : ''}{st && <span style={{ color: 'var(--c94a3b8)' }}> · {st.firstName}</span>}</span>
            <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{fmt(l.unitPriceCents * l.quantity)}</span>
          </div>
        );
      })}
    </div>
  );

  const payScreen = payNarrow ? (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--c0f172a)' }}>
      {payHeader}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', boxSizing: 'border-box', padding: layout === 'phone' ? '14px 16px' : '20px 24px', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gridAutoRows: 'max-content', alignContent: 'start', gap: 12, width: '100%', maxWidth: 720, margin: '0 auto' }}>
        {notices}
        {dueHead}
        {tipBlock}
        {money.due > 0 && methodTiles}
        {methodBody}
        {directTip}
        {layout !== 'phone' && payLines}
      </div>
      <div style={{ padding: `10px 16px calc(16px + env(safe-area-inset-bottom, 0px))`, display: 'flex', alignItems: 'center', gap: 12, borderTop: '1px solid var(--line)', width: '100%', maxWidth: 720, margin: '0 auto', boxSizing: 'border-box' }}>
        {printCheck}
        {completeBtn(58)}
      </div>
    </div>
  ) : (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {payHeader}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: tightTop ? 16 : 24, padding: tightTop ? 16 : 24, boxSizing: 'border-box' }}>
        <div style={{ width: tightTop ? 380 : 520, flexShrink: 0, boxSizing: 'border-box', padding: tightTop ? 20 : 24, borderRadius: 18, background: 'var(--c0f172a)', border: '1px solid var(--line)', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gridAutoRows: 'max-content', alignContent: 'start', gap: 18, overflowY: 'auto' }}>
          {dueHead}
          {payLines}
          {tipBlock}
          {directTip}
        </div>
        <div style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', padding: 24, borderRadius: 18, background: 'var(--c0f172a)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto' }}>
          {notices}
          {money.due > 0 && methodTiles}
          <div style={{ flex: '1 0 auto', display: 'flex', flexDirection: 'column' }}>{methodBody}</div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {printCheck}
            <div style={{ flex: 1 }} />
            {completeBtn(64, 420)}
          </div>
        </div>
      </div>
    </div>
  );

  /* ---------------------------------------------------------------- done */
  const doneScreen = done && (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', alignItems: layout === 'phone' ? 'stretch' : 'center', justifyContent: 'center', padding: layout === 'phone' ? 0 : 40, boxSizing: 'border-box' }}>
      <div style={{ width: layout === 'phone' ? '100%' : 'min(680px, 100%)', boxSizing: 'border-box', padding: layout === 'phone' ? '32px 20px calc(20px + env(safe-area-inset-bottom, 0px))' : 40, borderRadius: layout === 'phone' ? 0 : 22, background: 'var(--c0f172a)', border: layout === 'phone' ? 'none' : '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 26 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
          <span style={{ width: 72, height: 72, borderRadius: '50%', background: done.offline ? 'rgba(245,158,11,.14)' : 'var(--c052e16)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: done.offline ? 'var(--ink-warn)' : 'var(--ink-good)' }}><IcoCheck /></span>
          <span style={{ fontSize: 30, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{done.offline ? L('Đã lưu tạm', 'Saved offline') : L('Đã thu', 'Paid')} {fmt(done.paidCents)}</span>
          <span style={{ fontSize: 16, color: 'var(--c94a3b8)' }}>
            {done.method}{done.changeCents > 0 && <> · {L('Trả lại khách', 'Change')} <b style={{ color: 'var(--ink-good)' }}>{fmt(done.changeCents)}</b></>} · {L('Đơn', 'Order')} {done.label}
          </span>
          {done.offline && <span style={{ fontSize: 13.5, color: 'var(--ink-warn)' }}>{t('po.savedOffline')}</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={sectionLabel}>{L('HOÁ ĐƠN CHO KHÁCH', 'RECEIPT')}</span>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ flex: 1, minWidth: 180, fontSize: 15, color: 'var(--ccbd5e1)' }}>{done.printed ? (printToReception ? L('Đã gửi tới máy in quầy lễ tân', 'Sent to the reception printer') : L('Đã in hoá đơn', 'Receipt printed')) : L('Không in hoá đơn', 'No receipt printed')}</span>
            <button type="button" onClick={() => { const s2 = lastReceiptRef.current; if (s2) { printSnapshot(s2); setDone({ ...done, printed: true }); } }} disabled={!lastReceiptRef.current} style={{ height: 56, padding: '0 22px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--c0f172a)', fontSize: 15, fontWeight: 600, color: 'var(--cf1f5f9)', cursor: 'pointer' }}>{done.printed ? L('In lại', 'Print again') : L('In hoá đơn', 'Print receipt')}</button>
          </div>
        </div>
        {fbReq && token && <FeedbackStatus token={token} req={fbReq} lang={lang} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={sectionLabel}>{L('LẦN SAU', 'NEXT VISIT')}</span>
          {nextVisit ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 14px', borderRadius: 12, background: 'var(--c052e16)', border: '1px solid var(--line)' }}>
              <span style={{ color: 'var(--ink-good)', display: 'flex' }}><IcoCheck /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{fmtInTz(nextVisit.startTime, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}{nextVisit.staffName ? ` · ${nextVisit.staffName}` : ''}</div>
                <div style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{nextVisit.serviceNames.filter(Boolean).join(', ')} · {L('Đã gửi xác nhận cho khách nếu có số điện thoại.', 'Confirmation sent to the customer if a mobile is on file.')}</div>
              </div>
              <a href={`/salon/bookings`} style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ca5b4fc)', textDecoration: 'none', whiteSpace: 'nowrap' }}>{L('Xem lịch', 'Open')}</a>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ flex: 1, minWidth: 180, fontSize: 15, color: 'var(--ccbd5e1)' }}>{L('Khách muốn hẹn lần tới? Khách, dịch vụ và thợ đã có sẵn — chỉ chọn ngày giờ.', 'Want to book the next visit? Customer, services and tech are already filled in — just pick a time.')}</span>
              <button type="button" onClick={() => setShowRebook(true)} style={{ height: 56, padding: '0 22px', borderRadius: 12, border: '1px solid var(--ca5b4fc)', background: 'var(--c0f172a)', fontSize: 15, fontWeight: 700, color: 'var(--ca5b4fc)', cursor: 'pointer', whiteSpace: 'nowrap' }}>📅 {L('Đặt lịch lần sau', 'Book next visit')}</button>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 'auto' }}>
          <a href="/salon/orders" style={{ height: 60, padding: '0 22px', borderRadius: 14, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', fontSize: 15, fontWeight: 600, color: 'var(--ccbd5e1)', display: 'flex', alignItems: 'center', textDecoration: 'none', whiteSpace: 'nowrap' }}>{L('Xem đơn hàng', 'Orders')}</a>
          <button type="button" onClick={newBill} style={{ flex: 1, height: 60, borderRadius: 14, border: 'none', background: '#4f46e5', color: '#fff', fontSize: 18, fontWeight: 700, cursor: 'pointer' }}>{L('Bill mới', 'New bill')}</button>
        </div>
      </div>
    </div>
  );

  /* -------------------------------------------------------------- catalog */
  const catalog = (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, boxSizing: 'border-box', padding: layout === 'phone' ? 12 : layout === 'wide' && !tightTop ? '20px 20px 0 24px' : '16px 16px 0', display: 'flex', flexDirection: 'column', gap: layout === 'phone' ? 10 : layout === 'wide' && !tightTop ? 16 : 12 }}>
      {notices}
      {layout === 'phone' ? <>{searchBox}{waitingStrip}</> : <>{waitingStrip}<div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>{searchBox}{tabSwitch}</div></>}
      {layout === 'phone' && tabSwitch}
      {catRow}
      {grid}
    </div>
  );

  /* ------------------------------------------------------------- the page */
  let body: React.ReactNode;
  if (done) body = doneScreen;
  else if (step === 'pay') body = payScreen;
  else if (layout === 'wide') body = <><div style={{ flex: 1, minHeight: 0, display: 'flex' }}>{catalog}{sideTicket}</div></>;
  else if (layout === 'dock') body = <><div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{catalog}</div>{dockTicket}</>;
  else body = mobileView === 'ticket' ? phoneTicket : <><div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{catalog}</div>{phoneBar}</>;

  const showTop = !done && (step === 'register') && !(layout === 'phone' && mobileView === 'ticket');

  return (
    <section style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', flexDirection: 'column', background: 'var(--c0b1120)', paddingTop: 'env(safe-area-inset-top, 0px)', fontVariantNumeric: 'tabular-nums', color: 'var(--cf1f5f9)' }}>
      <style>{`
        .pos-tile { transition: border-color .12s ease, transform .06s ease; }
        .pos-tile:hover { border-color: #6366f1 !important; }
        .pos-tile:active { transform: scale(.97); }
        .pos-noscroll::-webkit-scrollbar { display: none; }
      `}</style>
      {showTop && topBar}
      {body}

      {showScanner && (
        <BarcodeScanner
          title={t('po.scanTitle')}
          hint={t('po.scanHint')}
          errorText={t('po.scanError')}
          onDetect={(code) => { setShowScanner(false); scanLookup(code); }}
          onClose={() => setShowScanner(false)}
        />
      )}

      {charging && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.88)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 46 }}>💳</div>
          <div style={{ color: '#e2e8f0', fontSize: 18, marginTop: 12 }}>{t('po.cardWaiting')}</div>
          <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 6 }}>{t('po.cardFollow')}</div>
          {cardWait > 0 && <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 10 }}>{cardWait}s</div>}
        </div>
      )}

      {/* Unresolved card payment. Blocking by design: the safest thing a
          cashier can do here is look at the terminal, not press pay again. */}
      {cardStuck && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.94)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: 24 }}>
          <div style={{ maxWidth: 460, background: 'var(--c0f172a)', border: '1px solid #f59e0b', borderRadius: 14, padding: 22 }}>
            <div style={{ color: 'var(--ink-warn)', fontWeight: 600, fontSize: 17 }}>{t('po.cardUnknownTitle')}</div>
            <p style={{ color: 'var(--ce2e8f0)', fontSize: 14, lineHeight: 1.6, marginTop: 10 }}>{t('po.cardUnknownBody')}</p>
            {cardStuck.note && <p style={{ color: 'var(--c94a3b8)', fontSize: 12 }}>{cardStuck.note}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const r = await apiFetch<{ status: string }>(`/payments-hub/intents/${cardStuck.intentId}`, { token });
                    if (r.status === 'SUCCEEDED') { setCardStuck(null); setOkMsg(t('po.cardNowPaid')); }
                    else if (r.status === 'PROCESSING' || r.status === 'REQUIRES_PAYMENT') setCardStuck({ ...cardStuck, note: t('po.cardStillWaiting') });
                    else { setCardStuck(null); setError(t('po.cardNotCharged').replace('{s}', r.status)); }
                  } catch (e) { setError(e instanceof Error ? e.message : 'error'); }
                }}
                style={ui.primaryBtn}
              >{t('po.cardRecheck')}</button>
              <button type="button" onClick={() => setCardStuck(null)} style={ghost}>{t('po.close')}</button>
            </div>
          </div>
        </div>
      )}

      {ipadModal && typeof document !== 'undefined' && createPortal(
        <div onClick={() => setIpadModal(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.7)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...ui.card, width: 'min(520px, 96vw)', maxHeight: '90vh', overflowY: 'auto' }}>
            <IpadPairPanel session={displaySession} onRotate={rotateDisplay} onClose={() => setIpadModal(false)} t={t} />
          </div>
        </div>, document.body)}

      {showRebook && done && token && typeof document !== 'undefined' && createPortal(
        <RebookSheet
          token={token}
          lang={lang}
          customerId={customerId}
          customerLabel={customerLabel}
          lines={paidLinesRef.current.filter((l) => l.kind === 'SERVICE' && !l.isAddon).map((l) => ({ serviceId: l.refId, staffId: l.staffMemberId || null }))}
          services={services}
          staff={staff}
          onClose={() => setShowRebook(false)}
          onBooked={(r) => {
            setNextVisit(r); setShowRebook(false);
            // The paper the customer takes home says when they are coming back —
            // on a reprint, since the first copy left the printer with the sale.
            const snap = lastReceiptRef.current;
            if (snap) {
              const when = fmtInTz(r.startTime, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
              const who = r.staffName ? ` with ${r.staffName}` : '';
              lastReceiptRef.current = {
                ...snap,
                text: `${snap.text}\n\nNEXT VISIT: ${when}${who}\n`,
                html: snap.html.replace('</body>', `<hr><div class="center"><b>Next visit:</b> ${when}${who}</div></body>`),
              };
            }
          }}
        />, document.body)}
      {showShift && typeof document !== 'undefined' && createPortal(
        <CashShiftPanel
          token={token}
          vi={lang === 'vi'}
          currency={currency}
          fmt={fmt}
          salonName={salonName}
          cashierName={user?.firstName || undefined}
          onState={shiftCtl.setState}
          onClose={() => setShowShift(false)}
          onHistory={() => { window.location.href = '/salon/pos/shifts'; }}
        />, document.body)}
      {showHeld && typeof document !== 'undefined' && createPortal(
        <div onClick={() => setShowHeld(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.7)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...ui.card, width: 'min(460px, 96vw)', maxHeight: '85vh', overflowY: 'auto', padding: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ce2e8f0)' }}>{L('Bill đang giữ', 'Held bills')} {heldBills.length ? `(${heldBills.length})` : ''}</div>
              <button type="button" onClick={() => setShowHeld(false)} aria-label={t('po.close')} style={{ background: 'none', border: 'none', color: 'var(--c94a3b8)', fontSize: 22, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ padding: 12 }}>
              {cart.length > 0 && (
                <button type="button" onClick={() => { park(); setShowHeld(false); }} style={{ ...ui.primaryBtn, width: '100%', marginBottom: 10 }}>{L('Giữ bill đang mở', 'Hold the open bill')}</button>
              )}
              {heldBills.length === 0 ? <div style={{ color: 'var(--c64748b)', fontSize: 13, padding: 8 }}>{L('Chưa có bill nào được giữ.', 'No held bills.')}</div>
                : heldBills.map((h) => (
                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 8px', borderBottom: '1px solid var(--line)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ce2e8f0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.label || 'Walk-in'}</div>
                      <div style={{ fontSize: 11, color: 'var(--c94a3b8)' }}>{fmt(h.totalCents)} · {fmtInTz(h.createdAt, { hour: 'numeric', minute: '2-digit' })}</div>
                    </div>
                    <button type="button" onClick={() => { recall(h); setStep('register'); }} style={{ ...ui.primaryBtn, padding: '7px 14px' }}>{L('Mở lại', 'Recall')}</button>
                    <button type="button" onClick={() => deleteHeld(h.id)} aria-label={L('Xoá', 'Delete')} style={{ background: 'none', border: 'none', color: 'var(--ink-bad)', fontSize: 18, cursor: 'pointer' }}>×</button>
                  </div>
                ))}
            </div>
          </div>
        </div>, document.body)}
    </section>
  );
}

interface WaitingTicket { id: string; customerId: string | null; name: string; what: string; awaitingPayment: boolean }

/** Category dots and technician avatars: accents, the same in light and dark. */
const CAT_COLORS = ['#db2777', '#0891b2', '#7c3aed', '#ea580c', '#2563eb', '#059669', '#ca8a04', '#64748b'];
const STAFF_COLORS = ['#be185d', '#0e7490', '#6d28d9', '#c2410c', '#1d4ed8', '#047857', '#a16207', '#475569'];

const sectionLabel: React.CSSProperties = { fontSize: 12, fontWeight: 700, letterSpacing: 0.8, color: 'var(--c94a3b8)' };
const noticeBox: React.CSSProperties = { padding: '10px 14px', borderRadius: 10, fontSize: 14, fontWeight: 600, flexShrink: 0 };
const menuItem: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '0 12px', borderRadius: 10, border: 'none', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 14.5, fontWeight: 600, textAlign: 'left', cursor: 'pointer', textDecoration: 'none', fontFamily: 'inherit' };
const smallBtn: React.CSSProperties = { height: 40, padding: '0 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--c0f172a)', color: 'var(--ccbd5e1)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' };
const adjInput: React.CSSProperties = { flex: 1, minWidth: 0, height: 40, boxSizing: 'border-box', padding: '0 12px', borderRadius: 10, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--cf1f5f9)', fontSize: 16, fontWeight: 600, textAlign: 'right', fontFamily: 'inherit' };
const totRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 14, color: 'var(--c94a3b8)' };
const adjBtn = (on: boolean): React.CSSProperties => ({ height: 36, flexShrink: 0, padding: '0 12px', borderRadius: 9, border: on ? '1px solid #4f46e5' : '1px dashed var(--c475569)', background: on ? 'var(--c1e1b4b)' : 'var(--c0f172a)', color: on ? 'var(--ce0e7ff)' : 'var(--ccbd5e1)', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' });

const svgProps = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
function IcoMenu() { return <svg width="20" height="20" viewBox="0 0 24 24" {...svgProps}><path d="M4 6h16M4 12h16M4 18h16" /></svg>; }
function IcoMore() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>; }
function IcoScreen() { return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>; }
function IcoPrint() { return <svg width="18" height="18" viewBox="0 0 24 24" {...svgProps}><path d="M6 3h12v6H6zM6 17H4a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2" /><path d="M7 14h10v7H7z" /></svg>; }
function IcoSearch() { return <svg width="20" height="20" viewBox="0 0 24 24" {...svgProps} style={{ color: 'var(--c94a3b8)', flexShrink: 0 }}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>; }
function IcoBarcode() { return <svg width="22" height="22" viewBox="0 0 24 24" {...svgProps}><path d="M4 6v12M7 6v12M11 6v12M14 6v12M18 6v12M20 6v12" /></svg>; }
function IcoX() { return <svg width="16" height="16" viewBox="0 0 24 24" {...svgProps} strokeWidth={2.2}><path d="M6 6l12 12M18 6 6 18" /></svg>; }
function IcoBack() { return <svg width="20" height="20" viewBox="0 0 24 24" {...svgProps} strokeWidth={2.4}><path d="M15 18l-6-6 6-6" /></svg>; }
function IcoBackspace() { return <svg width="26" height="26" viewBox="0 0 24 24" {...svgProps}><path d="M21 5H9l-6 7 6 7h12z" /><path d="m17 9-6 6M11 9l6 6" /></svg>; }
function IcoCheck() { return <svg width="36" height="36" viewBox="0 0 24 24" {...svgProps} strokeWidth={2.6}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>; }

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
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 16, padding: 22, width: 'min(94vw, 430px)', color: 'var(--ce2e8f0)', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>📱 {t('po.ipadTitle')}</h3>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--c94a3b8)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--c94a3b8)', lineHeight: 1.5 }}>{t('po.ipadStep')}</p>
        {qrSrc && !qrFailed && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc} alt="Pairing QR" onError={() => setQrFailed(true)} style={{ width: 200, height: 200, borderRadius: 12, background: '#fff', padding: 8 }} />
          </div>
        )}
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginBottom: 4 }}>{t('po.ipadOpenOn')} <strong style={{ color: 'var(--ce2e8f0)' }}>{displayUrl}</strong></div>
          <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginBottom: 4 }}>{t('po.ipadCodeLabel')}</div>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 6, color: 'var(--ca5f3fc)', fontFamily: 'monospace' }}>{code}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button onClick={() => { if (pairUrl) { navigator.clipboard?.writeText(pairUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } }} style={{ ...ghost, padding: '8px 14px', fontSize: 13 }}>{copied ? '✓' : t('po.ipadCopyLink')}</button>
          <button onClick={onRotate} style={{ ...ghost, padding: '8px 14px', fontSize: 13 }}>{t('po.ipadNewCode')}</button>
        </div>
        <p style={{ margin: '14px 0 0', fontSize: 11.5, color: 'var(--c64748b)', lineHeight: 1.5 }}>{t('po.ipadNote')}</p>
      </div>
    </div>
  );
}

function CatPrice({ priceCents, discountPercent, currency }: { priceCents: number; discountPercent?: number; currency: string }) {
  const d = discountPercent ?? 0;
  if (d <= 0) return <span style={{ color: 'var(--ink-good)' }}>{posMoney(priceCents, currency)}</span>;
  const netP = Math.round((priceCents * (100 - d)) / 100);
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
      <span style={{ textDecoration: 'line-through', color: 'var(--c64748b)', fontSize: 11 }}>{posMoney(priceCents, currency)}</span>
      <span style={{ color: 'var(--ink-good)', fontWeight: 600 }}>{posMoney(netP, currency)}</span>
      <span style={{ background: '#ef4444', color: '#fff', borderRadius: 4, padding: '0 4px', fontSize: 10, fontWeight: 600 }}>-{d}%</span>
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'var(--c94a3b8)' }}>{label}</span><span>{value}</span>
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

/** One third of the payment segmented control. Fixed height, never wraps. */
const payTab = (active: boolean): React.CSSProperties => ({
  height: 46, padding: '0 6px', borderRadius: 9, border: 'none', cursor: 'pointer',
  background: active ? '#6366f1' : 'transparent', color: active ? '#fff' : 'var(--ccbd5e1)',
  fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
});
const tabBtn = (active: boolean): React.CSSProperties => ({
  flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid ' + (active ? '#6366f1' : 'var(--c334155)'),
  background: active ? '#6366f1' : 'transparent', color: active ? '#fff' : 'var(--ccbd5e1)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
});
const catBtn: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-start', textAlign: 'left', justifyContent: 'space-between',
  minHeight: 74, padding: '12px', borderRadius: 10, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', cursor: 'pointer', fontSize: 13,
};
const catGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(142px, 1fr))', gap: 10 };
const cardTitle: React.CSSProperties = { fontWeight: 600, fontSize: 13, lineHeight: 1.3, color: 'var(--cf1f5f9)' };
const cardMeta: React.CSSProperties = { fontSize: 11, color: 'var(--c64748b)' };
const mutedP: React.CSSProperties = { color: 'var(--c94a3b8)', fontSize: 13 };
const chipSel = (active: boolean): React.CSSProperties => ({
  padding: '5px 12px', borderRadius: 999, border: '1px solid ' + (active ? '#6366f1' : 'var(--c334155)'),
  background: active ? '#6366f1' : 'transparent', color: active ? '#fff' : 'var(--ccbd5e1)', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
});

function TabCount({ n, active }: { n: number; active: boolean }) {
  return <span style={{ fontSize: 11, fontWeight: 600, marginLeft: 6, padding: '1px 6px', borderRadius: 999, background: active ? 'rgba(255,255,255,0.22)' : 'var(--c1e293b)', color: active ? '#fff' : 'var(--c94a3b8)' }}>{n}</span>;
}
function GroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--c94a3b8)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--c64748b)' }}>· {count}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
    </div>
  );
}
function EmptyState({ text }: { text: string }) {
  return <div style={{ color: 'var(--c64748b)', fontSize: 14, textAlign: 'center', padding: '36px 12px' }}>{text}</div>;
}
const qtyBtn: React.CSSProperties = {
  width: 24, height: 24, borderRadius: 6, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--ce2e8f0)', cursor: 'pointer', fontSize: 14, lineHeight: 1,
};
const chip: React.CSSProperties = {
  padding: '5px 10px', borderRadius: 999, border: '1px solid var(--c475569)', background: 'var(--c0f172a)', color: 'var(--ccbd5e1)', fontSize: 12, cursor: 'pointer',
};
const ghost: React.CSSProperties = {
  padding: '10px 14px', borderRadius: 8, border: '1px solid var(--c475569)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 14, cursor: 'pointer',
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--c0f172a)', border: '1px solid #4f46e5', borderRadius: 8, padding: '8px 10px', marginBottom: 12 }}>
        <span style={{ fontSize: 15 }}>👤</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ce2e8f0)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{customerLabel || t('po.custAttached')}</div>
          <div style={{ fontSize: 11, color: 'var(--ceab308)' }}>⭐ {t('po.custPoints').replace('{n}', String(customerPoints))}</div>
        </div>
        <button onClick={onClear} title={t('po.custRemove')} style={{ background: 'none', border: '1px solid var(--c475569)', borderRadius: 6, color: 'var(--c94a3b8)', cursor: 'pointer', fontSize: 13, padding: '3px 8px' }}>✕</button>
      </div>
    );
  }

  // Quick-add form.
  if (adding) {
    return (
      <form onSubmit={quickAdd} style={{ background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 8, padding: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ccbd5e1)', marginBottom: 8 }}>{t('po.custNew')}</div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input value={nf.firstName} onChange={(e) => setNf({ ...nf, firstName: e.target.value })} placeholder={t('po.custName')} style={{ ...ui.input, flex: 1, padding: '7px 9px', fontSize: 13 }} />
          <input value={nf.phone} onChange={(e) => setNf({ ...nf, phone: e.target.value })} placeholder={t('po.custPhone')} inputMode="tel" autoFocus style={{ ...ui.input, flex: 1, padding: '7px 9px', fontSize: 13 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>🎂 {t('po.custBirthday')}</span>
          <input lang="en-US" type="date" value={nf.birthDate} onChange={(e) => setNf({ ...nf, birthDate: e.target.value })} style={{ ...ui.input, flex: 1, padding: '6px 9px', fontSize: 13 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>✉️ {t('po.custEmail')}</span>
          <input type="email" value={nf.email} onChange={(e) => setNf({ ...nf, email: e.target.value })} placeholder="name@email.com" style={{ ...ui.input, flex: 1, padding: '6px 9px', fontSize: 13 }} />
        </div>
        {err && <div style={{ color: 'var(--cfca5a5)', fontSize: 12, marginBottom: 6 }}>{err}</div>}
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
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4, background: 'var(--c1e293b)', border: '1px solid var(--c475569)', borderRadius: 8, maxHeight: 220, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
          {results.map((c) => (
            <button key={c.id} type="button" onClick={() => { onPick(c.id, hitLabel(c), c.loyaltyPoints ?? 0); setResults(null); setQ(''); }}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '8px 10px', background: 'none', border: 'none', borderBottom: '1px solid var(--c334155)', color: 'var(--ce2e8f0)', cursor: 'pointer', fontSize: 13 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hitLabel(c)}</span>
              <span style={{ color: 'var(--ceab308)', fontSize: 11, whiteSpace: 'nowrap' }}>⭐ {c.loyaltyPoints ?? 0}</span>
            </button>
          ))}
        </div>
      )}
      {results && results.length === 0 && q.trim().length >= 2 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, marginTop: 4, background: 'var(--c1e293b)', border: '1px solid var(--c475569)', borderRadius: 8, padding: '8px 10px', fontSize: 12, color: 'var(--c94a3b8)' }}>
          {t('po.custNone')} <button type="button" onClick={() => { setAdding(true); setNf({ firstName: '', phone: q.replace(/[^\d+]/g, ''), email: '', birthDate: '' }); }} style={{ background: 'none', border: 'none', color: 'var(--c818cf8)', cursor: 'pointer', fontSize: 12, padding: 0 }}>＋ {t('po.custAdd')}</button>
        </div>
      )}
    </div>
  );
}
