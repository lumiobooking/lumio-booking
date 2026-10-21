'use client';

import { useCallback, useEffect, useRef, useState, FormEvent, CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { SalonShell } from '../../../components/SalonShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { useLiveRefresh } from '../../../lib/useLiveRefresh';
import { useLiveEvents } from '../../../lib/useLiveEvents';
import { useIsMobile } from '../../../lib/responsive';
import { FloorStats, TechBoard } from './TechBoard';
import { techState, ticketTech, ticketTimeline, turnLine } from '../../../lib/walkin-floor';
import { PartyChip, type PartyInfo } from '../../../components/PartyChip';
import { clockIn } from '../../../lib/desk-time';
import { salonTz, uiLocale } from '../../../lib/datetime';
import { ind } from '../../../lib/ui-industry';
import { TurnDrawer } from '../../../components/TurnDrawer';
import { DeskPolicyPanel } from '../../../components/DeskPolicyPanel';
import { CustomerPicker, type CustomerHistoryView, type CustomerLookupRow, type PickedCustomer } from '../../../components/CustomerPicker';
import { ServicePicker } from '../../../components/ServicePicker';
import { ClientFormsPanel } from '../../../components/forms/ClientFormsPanel';
import { VisitContactEditor, splitName } from '../../../components/VisitContactEditor';

interface WalkInItem { lineId: string; serviceId: string; name: string; priceCents: number; durationMinutes?: number; staffId: string | null; legId?: string; kind?: string }
/** One part of a visit done by one technician (hands, feet, …) — see walkin-legs.ts in the API. */
interface Leg {
  legId: string; zone: 'HAND' | 'FOOT' | 'OTHER'; status: 'WAITING' | 'SERVING' | 'DONE';
  staffId: string | null; pinned: boolean; startedAt: string | null; doneAt: string | null;
  lineIds: string[]; serviceIds: string[]; names: string[]; minutes: number; turnValue: number; legacy?: boolean;
}
interface WalkIn {
  id: string; customerId: string | null; customerName: string | null; phone: string | null; note: string | null;
  partySize: number; status: string; createdAt: string; assignedAt: string | null;
  station: string | null;
  // Minutes the front desk tacked on after the customer was already seated.
  extraMinutes?: number | null;
  items: WalkInItem[];
  service: { id: string; name: string } | null;
  assignedStaff: { id: string; firstName: string; lastName: string | null } | null;
  legs?: Leg[];
  /** WAITING | SERVING | BETWEEN (one part done, the next one waiting for a technician) | DONE */
  phase?: string;
  /** Minutes past the visit's expected finish (server-computed); amber from 15, red from 45. */
  overdueMinutes?: number | null;
  /** The party this ticket belongs to (friends who came in together), or null. */
  groupId?: string | null;
  group?: PartyInfo | null;
  /** Finished in the chair (or parked by the sweeper): the bill is open, the technician is free. */
  awaitingPayment?: boolean;
  /** When the customer actually came in — a booking's check-in, not its booked time. */
  arrivedAt?: string | null;
  bookedAt?: string | null;
  /** Walk-in 2.0: the technician the salon's rules would give this waiting customer now. */
  suggestedStaffId?: string | null;
  /** Step 3: about how long (a range in minutes; 0–0 = now), and when the desk called her. */
  eta?: { min: number; max: number } | null;
  calledAt?: string | null;
}
/** Walk-in 2.0, step 2: the salon's optional desk rules (all off by default). */
interface DeskPolicy {
  requireService: boolean; overrideReason: boolean; protectBooking: boolean; bookingBufferMin: number;
  waitTargetMin: number; payNudge: boolean; payNudgeMin: number;
  notifyAhead?: number; noShowMin?: number;
}
const OVERRIDE_REASONS: { key: string; vi: string; en: string }[] = [
  { key: 'customer_request', vi: 'Khách yêu cầu', en: 'Customer asked' },
  { key: 'specialist', vi: 'Thợ chuyên dịch vụ này', en: 'Specialist for it' },
  { key: 'tech_yielded', vi: 'Thợ gợi ý nhường lượt', en: 'Suggested tech passed' },
  { key: 'other', vi: 'Khác', en: 'Other' },
];
/** "NO_SERVICE: Chọn dịch vụ…" → the sentence, without the code the screens match on. */
const plainError = (m: string) => m.replace(/^[A-Z_]{4,}:\s*/, '');
/** "vào 10:02" / "in 10:02 AM" — salon clock. */
function cameInText(w: WalkIn): string {
  const vi = uiLocale().startsWith('vi');
  const at = clockIn(w.arrivedAt ?? w.createdAt, salonTz() || null, vi);
  return at ? `${vi ? 'vào' : 'in'} ${at}` : '';
}
/** Someone who came in with the customer: a ticket of their own in the same party. */
interface GuestDraft { name: string; serviceIds: string[]; staffChoice: string; addonIds?: string[] }
/** An add-on from /services/addons/all: its own service, a category's services, or every service. */
interface DeskAddon { id: string; name: string; priceCents: number; durationMinutes: number; serviceId: string | null; categoryId?: string | null; askAtBooking?: boolean }
interface StaffTurn {
  id: string; name: string; avatarUrl: string | null; turns: number; busy: boolean; nextUp: boolean;
  /** Minutes left on what she is doing (rough). */
  busyFor?: number | null;
  /** Lunch / a break: not offered a client until she is back. */
  onBreak?: boolean;
  /** Services she does; empty = all of them. */
  skills?: string[];
  /** Walk-in 2.0: place in the turn line, request-only, next booking today. */
  rank?: number | null;
  manualOnly?: boolean;
  nextBookingAt?: string | null;
}
interface Board {
  waiting: WalkIn[]; serving: WalkIn[]; done?: WalkIn[]; staff: StaffTurn[]; nextUpStaffId: string | null; restricted?: string[];
  today?: { count: number; serviceCents: number };
  frequent?: Record<string, string[]>;
  policy?: DeskPolicy;
}

/** Turns can be halves (a small add-on is worth ½): 1.5 → "1½". */
function fmtTurns(n: number): string {
  const whole = Math.floor(n + 1e-9);
  const half = Math.abs(n - whole - 0.5) < 0.01;
  if (half) return whole ? `${whole}½` : '½';
  return String(Math.round(n * 100) / 100);
}
/** Can this technician do every service of the leg? (Unticked services are open to all.) */
function canDoLeg(s: StaffTurn, leg: Leg, restricted: Set<string>): boolean {
  const need = leg.serviceIds.filter((id) => restricted.has(id));
  if (!s.skills || s.skills.length === 0 || need.length === 0) return true;
  return need.every((id) => s.skills!.includes(id));
}
const ZONE_ICON: Record<Leg['zone'], string> = { HAND: '✋', FOOT: '🦶', OTHER: '✦' };
function legLabel(leg: Leg, t: (k: string) => string): string {
  if (leg.legacy) return t('wi.legWhole');
  return leg.zone === 'HAND' ? t('wi.legHand') : leg.zone === 'FOOT' ? t('wi.legFoot') : (leg.names[0] ?? t('wi.legOther'));
}
interface Service {
  id: string; name: string;
  // Needed by the customer screen so it can show price and length per service.
  priceCents?: number; durationMinutes?: number;
  category?: { id: string; name: string } | null;
}

export default function WalkinsPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function fullName(s: { firstName: string; lastName: string | null } | null) {
  return s ? `${s.firstName}${s.lastName ? ' ' + s.lastName : ''}` : '';
}
function waitedMins(iso: string) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

function Inner() {
  const { token, user } = useAuth();
  // The owner's own account, or a Lumio support session inside this salon.
  // A technician signed in on the floor is excluded on purpose — see the API.
  const canDelete = user?.role === 'SALON_ADMIN' || user?.role === 'SUPER_ADMIN' || Boolean(user?.supportSession);
  const [turnsOpen, setTurnsOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const { lang } = useLang();
  const isMobile = useIsMobile();
  // iPad landscape and up: the intake form slides in from the right and the
  // board stays in view behind it, instead of being pushed down the page.
  const wide = !useIsMobile(1023);
  const t = (k: string) => tr(k, lang);
  const vi = lang === 'vi';
  const [board, setBoard] = useState<Board | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const BLANK_FORM = { customerName: '', lastName: '', phone: '', email: '', birthDate: '', partySize: '1', staffChoice: 'auto', station: '', extraMinutes: '' };
  const [form, setForm] = useState(BLANK_FORM);
  // A walk-in rarely wants exactly one thing; the picker adds to this list.
  const [pickedIds, setPickedIds] = useState<string[]>([]);
  // The customer on file (null = new or a passer-by) and what the records say about her.
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [hist, setHist] = useState<CustomerHistoryView | null>(null);
  const onCustomer = (v: PickedCustomer, row: CustomerLookupRow | null) => {
    setCustomerId(v.id);
    setForm((f) => ({ ...f, customerName: v.firstName, lastName: v.lastName, phone: v.phone, email: v.email, birthDate: v.birthDate }));
    setHist(row?.history ?? null);
    // Her last services when nothing is picked yet — one tap clears them.
    const lastIds = (row?.history.last?.services ?? []).map((x) => x.id).filter((id) => services.some((sv) => sv.id === id));
    if (row && lastIds.length) setPickedIds((cur) => (cur.length ? cur : lastIds));
  };
  // The people who came in with her — one ticket each, linked as one party.
  const [guests, setGuests] = useState<GuestDraft[]>([]);
  // The salon's add-ons, and the ones picked for the customer at the desk.
  const [deskAddons, setDeskAddons] = useState<DeskAddon[]>([]);
  const [addonPick, setAddonPick] = useState<string[]>([]);
  // The form is a drawer, not a permanent header: reception looks at the board
  // all day and only needs the form when someone walks in.
  const [formOpen, setFormOpen] = useState(false);
  // Second monitor facing the customer. Same browser, so BroadcastChannel keeps
  // both screens in step with no pairing, no login and no network.
  const [screenOn, setScreenOn] = useState(false);
  const chRef = useRef<BroadcastChannel | null>(null);
  // Every message carries this salon's id: the channel is shared by every tab
  // of the browser, and an agency keeps several salons open at once — the
  // screen opened here for one salon used to greet customers as another.
  const tenantRef = useRef(user?.tenantId ?? '');
  tenantRef.current = user?.tenantId ?? '';
  const post = useCallback((msg: Record<string, unknown>) => {
    chRef.current?.postMessage(tenantRef.current ? { ...msg, tenant: tenantRef.current } : msg);
  }, []);
  const winRef = useRef<Window | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  // Which waiting row is showing its full ticket (one at a time — a list, not a wall).
  const [openWait, setOpenWait] = useState<string | null>(null);
  // Walk-in 2.0 desk: one search over every column; "done today" folds under the till.
  const [q, setQ] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [currency, setCurrency] = useState('USD');
  const [salonName, setSalonName] = useState('');
  const [salonLogo, setSalonLogo] = useState('');
  // Everything the customer display needs to paint its normal welcome screen,
  // so this page can hand it back complete — including the Google review QR —
  // even when the register isn't open in another tab.
  const [salonWelcome, setSalonWelcome] = useState('');
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // "Danh sách" (the list, as always) or "Theo thợ" (a column per technician).
  // Remembered per device: the front-desk PC and the owner's phone differ.
  const [view, setViewState] = useState<'list' | 'tech'>('list');
  useEffect(() => {
    try { const v = window.localStorage.getItem('lumio_wi_view'); if (v === 'list' || v === 'tech') setViewState(v); } catch { /* ignore */ }
  }, []);
  const setView = (v: 'list' | 'tech') => { setViewState(v); try { window.localStorage.setItem('lumio_wi_view', v); } catch { /* ignore */ } };
  // The customer the "waiting too long" chip points at.
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => { if (!focusId) return; const id = window.setTimeout(() => setFocusId(null), 4000); return () => window.clearTimeout(id); }, [focusId]);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [b, svc, settings, adds] = await Promise.all([
        apiFetch<Board>('/walkins/board', { token }),
        apiFetch<Service[]>('/services', { token }).catch(() => []),
        apiFetch<{ booking?: { currency?: string }; company?: { name?: string; slug?: string }; branding?: { logoUrl?: string; welcomeImageUrl?: string } }>('/settings', { token })
          .catch(() => ({} as { booking?: { currency?: string }; company?: { name?: string; slug?: string }; branding?: { logoUrl?: string; welcomeImageUrl?: string } })),
        apiFetch<DeskAddon[]>('/services/addons/all', { token }).catch(() => [] as DeskAddon[]),
      ]);
      setBoard(b); setServices(svc); setDeskAddons(Array.isArray(adds) ? adds : []);
      if (settings?.booking?.currency) setCurrency(settings.booking.currency);
      if (settings?.company?.name) setSalonName(settings.company.name);
      if (settings?.branding?.logoUrl) setSalonLogo(settings.branding.logoUrl);
      if (settings?.branding?.welcomeImageUrl) setSalonWelcome(settings.branding.welcomeImageUrl);
      const rvSlug = settings?.company?.slug;
      if (rvSlug) {
        try {
          const rv = await apiFetch<{ enabled?: boolean; hasGoogle?: boolean }>(`/public/review/${encodeURIComponent(rvSlug)}/salon`, { token });
          const origin = typeof window !== 'undefined' ? window.location.origin : '';
          setReviewUrl(rv?.enabled && rv?.hasGoogle ? `${origin}/review/${rvSlug}/salon` : null);
        } catch { /* the review invite is optional */ }
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);
  // The board is the shared source of truth between reception, the techs' chair
  // app and self check-ins from a phone — so it refreshes itself often enough
  // that nobody ever reaches for the reload button.
  useLiveRefresh(load, 5000);
  // And it is told the moment something changes — a customer's phone
  // check-in, a "Giao" from another desk — so it fetches NOW rather than up
  // to five seconds later with the customer standing at the counter. The
  // poll above stays as the safety net when the stream is down.
  useLiveEvents('/walkins/events', token, () => { void load(); });

  // Keep the newest form state in a ref so the channel handler (registered once)
  // always reads current values instead of the ones captured at mount.
  const liveRef = useRef({ form, pickedIds, formOpen, qrOn: false, addonPick: [] as string[] });

  const addRef = useRef<() => void>(() => undefined);
  const checkinUrlRef = useRef('');
  const qrTextRef = useRef({ title: '', hint: '' });
  const thanksNameRef = useRef<string | null>(null);
  const salonNameRef = useRef('');
  const salonLogoRef = useRef('');
  const salonWelcomeRef = useRef('');
  const reviewUrlRef = useRef<string | null>(null);

  /** The salon's real welcome: cover image, logo, name and the review QR. */
  const sendWelcome = useCallback(() => {
    post({
      type: 'state',
      state: {
        status: 'idle', checkinExit: true, currency: 'USD', lines: [],
        subtotalCents: 0, savingsCents: 0, tipCents: 0, taxCents: 0, giftCents: 0, dueCents: 0,
        salonName: salonNameRef.current || undefined,
        salonLogo: salonLogoRef.current || undefined,
        salonWelcome: salonWelcomeRef.current || undefined,
        reviewUrl: reviewUrlRef.current || undefined,
      },
    });
  }, [post]);
  // True while this page is the one driving the customer screen, so it only
  // hands the screen back when it actually had it.
  const ownsScreenRef = useRef(false);
  // Walk-ins already waiting when the QR went up — anything new after that is a
  // customer who just checked themselves in on their phone.
  const knownWaitingRef = useRef<Set<string>>(new Set());

  const [qrOn, setQrOn] = useState(false);
  // Name to greet on the display after a self check-in lands (the customer used
  // their own phone, so it is not in the desk's form).
  const [thanksName, setThanksName] = useState<string | null>(null);
  const [pairCode, setPairCode] = useState('');
  const checkinUrl = pairCode && typeof window !== 'undefined' ? `${window.location.origin}/checkin?c=${pairCode}` : '';

  const pushToScreen = useCallback((mode: 'idle' | 'form' | 'thanks' | 'qr') => {
    // Handing the screen back must NOT push a stripped-down idle state — that
    // wiped the salon's welcome image and the Google review QR. Tell the display
    // to restore the register's own view instead.
    if (mode === 'idle') {
      post({
        type: 'checkinRelease',
        // What to show if no register is open to replay its own state: the real
        // welcome screen, with the salon's image and the review QR — not the
        // bare fallback the display uses when it knows nothing.
        fallback: {
          status: 'idle', currency: 'USD', lines: [],
          subtotalCents: 0, savingsCents: 0, tipCents: 0, taxCents: 0, giftCents: 0, dueCents: 0,
          salonName: salonNameRef.current || undefined,
          salonLogo: salonLogoRef.current || undefined,
          salonWelcome: salonWelcomeRef.current || undefined,
          reviewUrl: reviewUrlRef.current || undefined,
        },
      });
      return;
    }
    const { form: f, pickedIds: p } = liveRef.current;
    post({
      type: 'state',
      // Same envelope the register uses, so the customer display it is already
      // showing simply switches mode — no second window to open.
      state: {
        status: 'checkin',
        currency: 'USD',
        salonName: salonName || '',
        salonLogo: salonLogo || undefined,
        lines: [],
        subtotalCents: 0, savingsCents: 0, tipCents: 0, taxCents: 0, giftCents: 0, dueCents: 0,
        checkin: {
          done: mode === 'thanks',
          qr: mode === 'qr' ? checkinUrlRef.current : undefined,
          qrTitle: mode === 'qr' ? qrTextRef.current.title : undefined,
          qrHint: mode === 'qr' ? qrTextRef.current.hint : undefined,
          services: services.map((x) => ({ id: x.id, name: x.name, priceCents: x.priceCents ?? 0, durationMinutes: x.durationMinutes ?? 0, category: x.category ?? null })),
          // The add-ons of what she picked, and the ones already ticked (her screen shows them under her picks).
          addons: addonsFor(p).map((a) => ({ id: a.id, name: a.name, priceCents: a.priceCents, durationMinutes: a.durationMinutes, askAtBooking: !!a.askAtBooking })),
          addonPicked: liveRef.current.addonPick ?? [],
          form: {
            firstName: mode === 'thanks' && thanksNameRef.current ? thanksNameRef.current : f.customerName,
            lastName: f.lastName, phone: f.phone,
            email: f.email, birthDate: f.birthDate, partySize: parseInt(f.partySize, 10) || 1,
          },
          picked: p,
        },
      },
    });
  }, [salonName, salonLogo, services, deskAddons, post]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return;
    const ch = new BroadcastChannel('lumio-pos-display');
    chRef.current = ch;
    ch.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type: string; payload?: unknown; tenant?: string };
      // A screen or register of another salon in this same browser — not ours.
      if (msg?.tenant && tenantRef.current && msg.tenant !== tenantRef.current) return;
      // The display asks for state when it loads (and the register answers the
      // same message) — only reply while our form is actually open.
      // A display that just loaded asks whoever is around for something to show.
      // The register answers when it is open; when it is NOT (staff opened the
      // screen straight from this page) nobody replied and it sat on the bare
      // fallback welcome — no cover image, no review QR. Answer it ourselves.
      if (msg?.type === 'request') {
        setScreenOn(true);
        if (liveRef.current.formOpen) pushToScreen('form');
        else if (liveRef.current.qrOn) pushToScreen('qr');
        else sendWelcome();
        return;
      }
      if (msg?.type === 'form') {
        // The customer is typing on the other monitor.
        const p = (msg.payload ?? {}) as Partial<{ firstName: string; lastName: string; phone: string; email: string; birthDate: string; partySize: number }>;
        setForm((f) => ({
          ...f,
          ...(p.firstName !== undefined ? { customerName: p.firstName } : {}),
          ...(p.lastName !== undefined ? { lastName: p.lastName } : {}),
          ...(p.phone !== undefined ? { phone: p.phone } : {}),
          ...(p.email !== undefined ? { email: p.email } : {}),
          ...(p.birthDate !== undefined ? { birthDate: p.birthDate } : {}),
          ...(p.partySize !== undefined ? { partySize: String(p.partySize) } : {}),
        }));
        setFormOpen(true);
      }
      if (msg?.type === 'toggleService') {
        const id = String(msg.payload ?? '');
        setPickedIds((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
      }
      if (msg?.type === 'toggleAddon') {
        const id = String(msg.payload ?? '');
        setAddonPick((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
      }
      // The customer pressed "I'm done" — the desk owns the token, so the desk saves.
      if (msg?.type === 'submit') void addRef.current();
    };
    return () => { ch.close(); chRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushToScreen]);

  // Mirror every desk keystroke onto the customer screen while the form is open.
  useEffect(() => { liveRef.current = { form, pickedIds, formOpen, qrOn, addonPick }; }, [form, pickedIds, formOpen, qrOn, addonPick]);
  useEffect(() => { thanksNameRef.current = thanksName; }, [thanksName]);
  // "+ Tạo mới → Khách vãng lai" from the header (?new=1) opens the intake form at once.
  useEffect(() => { if (new URLSearchParams(window.location.search).get('new') === '1') startNew(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // "/salon/walkins?focus=<id>" — from the dashboard's long-wait alert: ring the card.
  useEffect(() => { const f = new URLSearchParams(window.location.search).get('focus'); if (f) { setFocusId(f); setOpenWait(f); } }, []);
  useEffect(() => {
    salonNameRef.current = salonName; salonLogoRef.current = salonLogo;
    salonWelcomeRef.current = salonWelcome; reviewUrlRef.current = reviewUrl;
  }, [salonName, salonLogo, salonWelcome, reviewUrl]);

  useEffect(() => {
    if (thanksName) { ownsScreenRef.current = true; pushToScreen('thanks'); }
    else if (qrOn) { ownsScreenRef.current = true; pushToScreen('qr'); }
    else if (formOpen) { ownsScreenRef.current = true; pushToScreen('form'); }
    else if (ownsScreenRef.current) { ownsScreenRef.current = false; pushToScreen('idle'); }
  }, [form, pickedIds, addonPick, formOpen, qrOn, thanksName, pushToScreen]);

  // While the QR is up, watch the queue: the phone posts straight to the API, so
  // the arrival of a new waiting ticket IS the signal that the customer is done.
  // Both lists: a phone check-in now lands straight on a free technician
  // (SERVING), so watching only the waiting queue would miss it and the
  // customer's thank-you would never show.
  useEffect(() => {
    const all = [...(board?.waiting ?? []), ...(board?.serving ?? [])];
    if (!qrOn) { knownWaitingRef.current = new Set(all.map((x) => x.id)); return; }
    const fresh = all.filter((x) => !knownWaitingRef.current.has(x.id));
    if (fresh.length === 0) return;
    knownWaitingRef.current = new Set(all.map((x) => x.id));
    setThanksName((fresh[0].customerName || '').split(' ')[0] || '');
  }, [board, qrOn]);

  // Thank-you sits for a moment, then the QR comes straight back for the next
  // customer in line — no staff action. (It used to drop back to the welcome
  // picture, so the second customer had nothing to scan until someone at the
  // desk pressed the button again.)
  useEffect(() => {
    if (thanksName === null) return;
    const id = window.setTimeout(() => setThanksName(null), 6000);
    return () => window.clearTimeout(id);
  }, [thanksName]);

  // A phone check-in should show up in seconds, not on the 15s board tick.
  useEffect(() => {
    if (!qrOn) return;
    const id = window.setInterval(() => { void load(); }, 2000);
    return () => window.clearInterval(id);
  }, [qrOn, load]);

  // Say hello on mount too: a display window opened before this page has already
  // sent its own 'request' and would otherwise never hear from us.
  useEffect(() => { post({ type: 'request' }); }, [post]);
  useEffect(() => { checkinUrlRef.current = checkinUrl; }, [checkinUrl]);
  useEffect(() => { qrTextRef.current = { title: t('wi.qrScanTitle'), hint: t('wi.qrScanHint') }; }, [t]);

  // Leaving this page (to POS, calendar, anywhere) hands the customer screen
  // back to whoever else drives it. Without this the monitor would sit on the
  // check-in form while the cashier is ringing someone up.
  useEffect(() => () => { post({ type: 'checkinRelease' }); }, [post]);

  // The QR the customer scans comes from the salon's own display pairing code.
  useEffect(() => {
    if (!token || pairCode) return;
    apiFetch<{ pairCode: string }>('/display/session', { token })
      .then((r) => setPairCode(r.pairCode))
      .catch(() => undefined);
  }, [token, pairCode]);

  // Same window name the register uses, so this focuses the display that is
  // already open on the second monitor instead of spawning another one.
  function openCustomerScreen() {
    if (typeof window === 'undefined') return;
    // `?t=` binds the screen to THIS salon; same window name as the register,
    // so an open screen is re-used (and re-bound) instead of a second one.
    const q = tenantRef.current ? `?t=${encodeURIComponent(tenantRef.current)}` : '';
    winRef.current = window.open(`/pos-display${q}`, 'lumioCustomerDisplay', 'width=1100,height=760');
    setScreenOn(true);
    // Opened from the walk-in board, the screen is there for customers to
    // check themselves in — so it opens ON the check-in QR, not on a welcome
    // picture the owner then has to click past ("I opened the customer
    // screen and saw nothing"). The form, when open, keeps priority.
    if (!liveRef.current.formOpen && checkinUrl) setQrOn(true);
    // If the window was already open, window.open only focuses it and no
    // 'request' is sent — push the welcome so it is never left on the fallback.
    window.setTimeout(() => { if (!liveRef.current.formOpen && !liveRef.current.qrOn) sendWelcome(); }, 500);
  }
  function startNew() {
    setQrOn(false);
    setForm(BLANK_FORM); setPickedIds([]); setGuests([]); setAddonPick([]); setFormOpen(true);
    // Push immediately: the customer should see the form the moment it opens.
    setTimeout(() => pushToScreen('form'), 0);
  }

  /** The add-ons offered on these services (own, category's, whole menu's), once each. */
  function addonsFor(ids: string[]): DeskAddon[] {
    const picked = ids.map((id) => services.find((x) => x.id === id)).filter((x): x is Service => !!x);
    return deskAddons.filter((a) => (a.serviceId ? picked.some((x) => x.id === a.serviceId)
      : a.categoryId ? picked.some((x) => x.category?.id === a.categoryId) : picked.length > 0));
  }
  /** One row of add-on chips, in the menu's own chip style. */
  function addonChips(list: DeskAddon[], on: string[], toggle: (id: string) => void) {
    if (!list.length) return null;
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--c94a3b8)', textTransform: 'uppercase', marginRight: 2 }}>{vi ? 'Thêm' : 'Add-ons'}</span>
        {list.map((a) => {
          const sel = on.includes(a.id);
          return (
            <button key={a.id} type="button" onClick={() => toggle(a.id)} title={a.askAtBooking ? (vi ? 'Tiệm dặn: hỏi khách món này' : 'The salon asks: offer this to the customer') : undefined}
              style={{ height: 30, padding: '0 12px', borderRadius: 999, border: `1px solid ${sel ? '#6366f1' : 'var(--c334155)'}`, background: sel ? '#6366f1' : 'transparent', color: sel ? '#fff' : 'var(--ccbd5e1)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
              {sel ? '✓ ' : '+ '}{a.askAtBooking ? `${a.name}?` : a.name} · {formatPrice(a.priceCents, currency)}{a.durationMinutes > 0 ? ` · ${a.durationMinutes}′` : ''}
            </button>
          );
        })}
      </div>
    );
  }

  async function add(e?: FormEvent) {
    e?.preventDefault(); setError(null);
    try {
      const body: Record<string, unknown> = {
        // Picked from the records: linked by id, no retyping (the API checks the salon).
        customerId: customerId ?? undefined,
        customerName: form.customerName.trim() || undefined,
        lastName: form.lastName.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        birthDate: form.birthDate || undefined,
        // First pick leads (it decides which kind of chair to look for).
        serviceId: pickedIds[0] || undefined,
        serviceIds: pickedIds.length > 1 ? pickedIds.slice(1) : undefined,
        // Only add-ons of services still picked: dropping a service drops its extras.
        addonIds: (() => { const ok = addonsFor(pickedIds).map((a) => a.id); const ids = addonPick.filter((id) => ok.includes(id)); return ids.length ? ids : undefined; })(),
        extraMinutes: parseInt(form.extraMinutes, 10) || undefined,
        partySize: guests.length + 1,
        station: form.station.trim() || undefined,
        guests: guests.length
          ? guests.map((g) => ({
              firstName: g.name.trim() || undefined,
              serviceIds: g.serviceIds,
              addonIds: (() => { const ok = addonsFor(g.serviceIds).map((a) => a.id); const ids = (g.addonIds ?? []).filter((id) => ok.includes(id)); return ids.length ? ids : undefined; })(),
              assignedStaffId: g.staffChoice !== 'auto' && g.staffChoice !== 'wait' ? g.staffChoice : undefined,
            }))
          : undefined,
      };
      // 'auto' = give it to the up-next free tech; a staff id = a requested tech;
      // 'wait' = just add to the waiting list (assign later).
      if (form.staffChoice === 'auto') body.autoAssign = true;
      else if (form.staffChoice !== 'wait') body.assignedStaffId = form.staffChoice;
      await apiFetch('/walkins', { method: 'POST', token, body });
      pushToScreen('thanks');
      setQrOn(false);
      setForm(BLANK_FORM); setPickedIds([]); setGuests([]); setAddonPick([]); setCustomerId(null); setHist(null); setFormOpen(false);
      // Leave the thank-you up for a moment, then reset the customer screen.
      setTimeout(() => pushToScreen('idle'), 6000);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not add'); }
  }
  addRef.current = () => { void add(); };

  async function act(path: string, body?: unknown) {
    setError(null);
    try { await apiFetch(`/walkins/${path}`, { method: 'PATCH', token, body }); await load(); }
    catch (e) { setError(e instanceof Error ? plainError(e.message) : 'Action failed'); }
  }

  /** Walk-in 2.0, step 3: call a waiting customer / mark her a no-show. */
  async function postAction(path: string) {
    setError(null);
    try { await apiFetch(`/walkins/${path}`, { method: 'POST', token }); await load(); }
    catch (e) { setError(e instanceof Error ? plainError(e.message) : 'Action failed'); }
  }

  /**
   * Remove a visit that should not be on the board — a test ticket, a row
   * entered twice, somebody who walked out before sitting down.
   *
   * Deliberately NOT offered to a technician: the API refuses them too, and a
   * button that appears and then fails is worse than no button. It is also not
   * the same thing as "Huỷ" on a waiting customer, which keeps the row. This
   * one asks first, because there is nothing to undo it with.
   */
  async function deleteWalkIn(id: string) {
    if (!canDelete) return;
    if (typeof window !== 'undefined' && !window.confirm(t('wi.deleteAsk'))) return;
    setError(null);
    try { await apiFetch(`/walkins/${id}`, { method: 'DELETE', token }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
  }

  async function addServiceLine(id: string, serviceId: string, staffId: string, extraMinutes?: number) {
    setError(null);
    try {
      await apiFetch(`/walkins/${id}/services`, {
        method: 'POST', token,
        body: { serviceId: serviceId || undefined, staffId: staffId || undefined, extraMinutes },
      });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
  }
  async function updateServiceLine(id: string, lineId: string, patch: Record<string, unknown>) {
    setError(null);
    try { await apiFetch(`/walkins/${id}/services/${lineId}`, { method: 'PATCH', token, body: patch }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
  }
  async function removeServiceLine(id: string, lineId: string) {
    setError(null);
    try { await apiFetch(`/walkins/${id}/services/${lineId}`, { method: 'DELETE', token }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
  }
  /** Walk-in 2.0: a finished visit closed without a receipt in Lumio, with its reason. */
  async function closeUnpaid(id: string, reason: string) {
    setError(null);
    try { await apiFetch(`/walkins/${id}/close-unpaid`, { method: 'PATCH', token, body: { reason } }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
  }
  async function setStationFor(id: string, station: string) {
    setError(null);
    try { await apiFetch(`/walkins/${id}/station`, { method: 'PATCH', token, body: { station } }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
  }

  if (loading && !board) return <section><h2 style={{ fontSize: 18 }}>{t('wi.title')}</h2><p style={{ color: 'var(--c94a3b8)' }}>Loading…</p></section>;

  const staff = board?.staff ?? [];
  const nextUp = board?.nextUpStaffId ?? null;
  const closeForm = () => { setFormOpen(false); pushToScreen('idle'); };
  const formEl = (
      <form onSubmit={add} style={{ ...ui.card, padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <SecHead label={t('wi.secWho')} extra={vi ? 'gõ tên hoặc SĐT — khách cũ tự điền' : 'name or phone — a returning customer fills itself in'} />
            <CustomerPicker
              token={token!} vi={vi} allowAnonymous autoFocus
              value={{ id: customerId, firstName: form.customerName, lastName: form.lastName, phone: form.phone, email: form.email, birthDate: form.birthDate }}
              onChange={onCustomer}
            />
          </div>

          <div>
            <SecHead label={t('wi.secWhat')} extra={pickedIds.length ? `${pickedIds.length} ${t('wi.picked')}` : undefined} />
            <ServicePicker
              services={services.map((sv) => ({ ...sv, durationMinutes: sv.durationMinutes ?? 0 }))}
              selected={pickedIds}
              onToggle={(id) => setPickedIds((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]))}
              onSet={setPickedIds}
              history={hist}
              currency={currency}
              vi={vi}
              maxHeight={230}
            />
            {addonChips(addonsFor(pickedIds), addonPick, (id) => setAddonPick((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id])))}
            <div style={{ ...wiGrid, marginTop: 10 }}>
              <label>
                <WiLabel text={t('wi.extraTime')} opt={t('wi.optional')} hint={t('wi.extraTimeHint')} />
                <input style={ui.input} type="number" min={0} max={600} step={5} value={form.extraMinutes} placeholder="0" onChange={(e) => setForm({ ...form, extraMinutes: e.target.value })} />
              </label>
            </div>
          </div>

          <div>
            <SecHead label={t('wi.secGuests')} extra={guests.length ? `${guests.length + 1} ${t('wi.people')}` : undefined} />
            <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--c64748b)', lineHeight: 1.45 }}>{t('wi.guestsHint')}</p>
            {guests.map((g, i) => (
              <div key={i} style={{ border: '1px solid var(--c334155)', borderRadius: 10, padding: '10px 12px', marginBottom: 8, background: 'var(--c0f172a)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--cc7d2fe)', whiteSpace: 'nowrap' }}>👥 {t('wi.guestN').replace('{n}', String(i + 2))}</span>
                  <input style={{ ...ui.input, marginBottom: 0, flex: 1 }} value={g.name} placeholder={t('wi.guestNamePh')} onChange={(e) => setGuests((v) => v.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <button type="button" aria-label={t('wi.removeGuest')} onClick={() => setGuests((v) => v.filter((_, j) => j !== i))} style={{ background: 'none', border: '1px solid var(--c334155)', color: 'var(--c94a3b8)', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', flexShrink: 0 }}>✕</button>
                </div>
                {g.serviceIds.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {g.serviceIds.map((id) => {
                      const sv = services.find((x) => x.id === id);
                      return (
                        <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--c1e3a8a)', color: 'var(--cdbeafe)', borderRadius: 999, padding: '4px 10px', fontSize: 12.5, fontWeight: 600 }}>
                          {sv?.name ?? id}
                          <button type="button" onClick={() => setGuests((v) => v.map((x, j) => (j === i ? { ...x, serviceIds: x.serviceIds.filter((y) => y !== id) } : x)))} style={{ background: 'none', border: 'none', color: 'var(--c93c5fd)', cursor: 'pointer', fontSize: 13, padding: 0, lineHeight: 1 }}>✕</button>
                        </span>
                      );
                    })}
                  </div>
                )}
                {addonChips(addonsFor(g.serviceIds), g.addonIds ?? [], (id) => setGuests((v) => v.map((x, j) => (j === i ? { ...x, addonIds: (x.addonIds ?? []).includes(id) ? (x.addonIds ?? []).filter((y) => y !== id) : [...(x.addonIds ?? []), id] } : x))))}
                <div style={wiGrid}>
                  <label style={{ gridColumn: 'span 2', minWidth: 0 }}>
                    <WiLabel text={t('wi.service')} opt={t('wi.optional')} />
                    <ServiceSearchSelect
                      services={services} value=""
                      onChange={(id) => { if (id) setGuests((v) => v.map((x, j) => (j === i && !x.serviceIds.includes(id) ? { ...x, serviceIds: [...x.serviceIds, id] } : x))); }}
                      placeholder={t('wi.serviceSearch')}
                    />
                  </label>
                  <label><WiLabel text={ind(lang === 'vi' ? 'Thợ' : 'Technician')} />
                    <select style={ui.input} value={g.staffChoice} onChange={(e) => setGuests((v) => v.map((x, j) => (j === i ? { ...x, staffChoice: e.target.value } : x)))}>
                      <option value="auto">{ind(lang === 'vi' ? 'Tự động — thợ tới lượt' : 'Auto — up next')}</option>
                      {(board?.staff ?? []).map((sm) => <option key={sm.id} value={sm.id}>{sm.name}{sm.busy ? (lang === 'vi' ? ' · đang bận' : ' · busy') : sm.onBreak ? (lang === 'vi' ? ' · tạm nghỉ' : ' · on break') : ''}</option>)}
                    </select>
                  </label>
                </div>
              </div>
            ))}
            {guests.length < 9 && (
              <button type="button" onClick={() => setGuests((v) => [...v, { name: '', serviceIds: [], staffChoice: 'auto' }])}
                style={{ ...ui.input, width: 'auto', cursor: 'pointer', fontWeight: 600, color: 'var(--cc7d2fe)', borderStyle: 'dashed', marginBottom: 0 }}>
                + {t('wi.addGuest')}
              </button>
            )}
          </div>

          <div>
            <SecHead label={t('wi.secSeat')} />
            <div style={wiGrid}>
              <label><WiLabel text={t('wi.station')} opt={t('wi.optional')} /><input style={ui.input} value={form.station} placeholder={t('wi.stationPh')} onChange={(e) => setForm({ ...form, station: e.target.value })} /></label>
              <label style={{ gridColumn: 'span 2', minWidth: 0 }}><WiLabel text={ind(lang === 'vi' ? 'Thợ' : 'Technician')} />
                <select style={ui.input} value={form.staffChoice} onChange={(e) => setForm({ ...form, staffChoice: e.target.value })}>
                  <option value="auto">{ind(lang === 'vi' ? 'Tự động — thợ tới lượt' : 'Auto — up next')}</option>
                  {(board?.staff ?? []).map((sm) => <option key={sm.id} value={sm.id}>{sm.name}{hist?.favoriteStaff?.id === sm.id ? (vi ? ' ★ thợ quen' : ' ★ her usual') : ''}{sm.busy ? (lang === 'vi' ? ' · đang bận' : ' · busy') : ''}</option>)}
                  <option value="wait">{lang === 'vi' ? 'Chỉ thêm vào hàng chờ' : 'Add to waiting'}</option>
                </select>
              </label>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: '1px solid var(--c334155)', background: 'var(--c0f172a)' }}>
          <span style={{ flex: 1, fontSize: 12.5, color: 'var(--c64748b)' }}>{t('wi.subtitle')}</span>
          <button type="submit" style={{ ...ui.primaryBtn, padding: '10px 20px', fontSize: 14 }}>{t('wi.addQueue')}</button>
        </div>
      </form>
  );

  return (
    <section>
      {/* WALK-IN 2.0 — the desk header from the mockup: the day and the time,
          one search over every column, the two views and the desk actions. */}
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: -0.4, color: 'var(--ce2e8f0)' }}>{vi ? 'Khách vãng lai' : 'Walk-ins'}</h2>
          <span style={{ fontSize: 13, color: 'var(--c64748b)' }}>{deskDay(vi)}</span>
        </div>
        <label style={{ flex: isMobile ? '1 1 100%' : '1 1 240px', maxWidth: isMobile ? 'none' : 380, order: isMobile ? 9 : 0, display: 'flex', alignItems: 'center', gap: 8, height: 40, border: '1px solid var(--line-strong)', borderRadius: 11, background: 'var(--raised)', padding: '0 12px', marginLeft: isMobile ? 0 : 8, boxSizing: 'border-box' }}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--c64748b)', flexShrink: 0 }}><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label={vi ? 'Tìm khách' : 'Find a customer'} placeholder={vi ? 'Tìm tên hoặc SĐT…' : 'Name or phone…'}
            style={{ border: 0, outline: 0, fontFamily: 'inherit', fontSize: 14, width: '100%', minWidth: 0, background: 'transparent', color: 'var(--ce2e8f0)' }} />
          {q && <button type="button" onClick={() => setQ('')} aria-label={vi ? 'Xoá tìm kiếm' : 'Clear search'} style={{ border: 0, background: 'transparent', color: 'var(--c64748b)', cursor: 'pointer', fontSize: 14, padding: 0 }}>✕</button>}
        </label>
        <span style={{ flex: 1 }} />
        <div role="group" aria-label={vi ? 'Cách xem' : 'View'} style={{ display: 'inline-flex', padding: 3, gap: 2, borderRadius: 12, background: 'var(--c1e293b)' }}>
          {(['list', 'tech'] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
              style={{ border: 'none', borderRadius: 9, height: 34, padding: '0 13px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
                background: view === v ? 'var(--raised)' : 'transparent', color: view === v ? 'var(--ce2e8f0)' : 'var(--c94a3b8)', boxShadow: view === v ? '0 1px 2px rgba(15,23,42,0.08)' : 'none' }}>
              {v === 'list' ? (vi ? 'Bảng' : 'Board') : (vi ? 'Theo thợ' : 'By tech')}
            </button>
          ))}
        </div>
        <KioskInline
          t={t}
          qrOn={qrOn}
          canShow={!!checkinUrl}
          onToggleQr={() => { const next = !qrOn; setQrOn(next); if (next) { setFormOpen(false); pushToScreen('qr'); } else pushToScreen('idle'); }}
        />
        <button type="button" onClick={openCustomerScreen} title={t('wi.custScreenHint')}
          style={{ ...deskBtn, ...(screenOn ? { border: '1px solid #4f46e5' } : null) }}>
          <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: screenOn ? '#22c55e' : 'var(--c94a3b8)' }} />
          {screenOn ? t('wi.custScreenOn') : t('wi.custScreen')}
        </button>
        <button type="button"
          onClick={() => { if (formOpen) { setFormOpen(false); pushToScreen('idle'); } else startNew(); }}
          style={{ ...ui.primaryBtn, background: '#4f46e5', height: 40, padding: '0 16px', borderRadius: 11, fontSize: 14, fontWeight: 700 }}
        >{formOpen ? t('wi.closeForm') : t('wi.newWalkin')}</button>
      </header>

      {error && <div style={ui.banner}>{error}</div>}

      {board && (
        <FloorStats board={board} vi={lang === 'vi'} currency={currency} isMobile={isMobile}
          onLongest={(id) => { setFocusId(id); if (view === 'list') setOpenWait(id); }}
          onToPay={() => { if (view !== 'list') setView('list'); window.setTimeout(() => document.getElementById('wi-topay')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); }} />
      )}

      {/* Wide screens: the intake form is a drawer over the right edge, so the
          board (and the customer who just walked in) stay in view. */}
      {formOpen && wide && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 85, display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={closeForm} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} />
          <aside aria-label={t('wi.newWalkin')} style={{ position: 'relative', width: 'min(600px, 100vw)', height: '100%', boxSizing: 'border-box', overflowY: 'auto', background: 'var(--c111827)', borderLeft: '1px solid var(--line)', boxShadow: '-16px 0 40px rgba(0,0,0,0.3)', padding: '16px 16px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <b style={{ fontSize: 17, color: 'var(--cf8fafc)', flex: 1 }}>{t('wi.newWalkin')}</b>
              <button type="button" onClick={closeForm} aria-label={t('wi.closeForm')} style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid var(--line)', background: 'transparent', color: 'var(--c94a3b8)', fontSize: 18, cursor: 'pointer' }}>✕</button>
            </div>
            {formEl}
          </aside>
        </div>
      )}

      {/* Three labelled blocks instead of one long strip of inputs: who the
          customer is (kept for marketing), what they want (several services at
          once), and where they sit. */}
      {formOpen && !wide && formEl}

      {view === 'tech' && board ? (
        <TechBoard
          board={board} vi={lang === 'vi'} currency={currency} isMobile={isMobile} focusId={focusId}
          onAssign={(id, staffId) => act(`${id}/assign`, { staffId })}
          onOpen={(id) => setOpenId(id)}
          onCancel={(id) => act(`${id}/cancel`)}
        />
      ) : (<>
      {turnsOpen && <TurnDrawer vi={lang === 'vi'} isOwner={canDelete} onClose={() => setTurnsOpen(false)} />}
      {policyOpen && <DeskPolicyPanel vi={vi} canEdit={canDelete} onClose={() => setPolicyOpen(false)} onSaved={() => { void load(); }} />}

      {/* WALK-IN 2.0 — the turn line as one card: the salon's own order, who is
          next, what each one is doing, a booking coming up. Display only. */}
      <section aria-label={vi ? 'Hàng tua' : 'Turn line'} style={{ background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 16, padding: isMobile ? 12 : '14px 16px', marginBottom: 16, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px 14px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{vi ? 'Hàng tua' : 'Turn line'}</span>
          {!isMobile && <span style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{vi ? 'theo quy tắc tua của tiệm · số 1 tới lượt' : "the salon's turn rules · #1 is up next"}</span>}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={() => setTurnsOpen(true)} style={railLink}>{vi ? 'Chi tiết tua' : 'Turn details'}</button>
          <button type="button" onClick={() => setPolicyOpen(true)} style={railLink}>{vi ? 'Quy tắc quầy' : 'Desk rules'}</button>
          <a href="/salon/walkins/day" style={railLink}>{vi ? 'Đối soát cuối ngày' : 'End of day'}</a>
          <a href="/queue-tv" target="_blank" rel="noreferrer" style={railLink}>{vi ? 'TV hàng chờ' : 'Queue TV'}</a>
        </div>
        {staff.length === 0 ? (
          <div style={{ color: 'var(--c94a3b8)', fontSize: 13.5 }}>{t('wi.noStaff')}</div>
        ) : (
          <div className={isMobile ? 'wi-strip' : undefined} style={isMobile
            ? { display: 'flex', gap: 8, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 2, scrollbarWidth: 'none' }
            : { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(184px, 1fr))', gap: 10 }}>
            {turnLine(staff).map((s) => <TurnTile key={s.id} s={s} vi={vi} t={t} isMobile={isMobile} />)}
          </div>
        )}
      </section>

      <style>{`.wi-serving{transition:border-color .12s ease, transform .06s ease}.wi-serving:hover{border-color: #6366f1}.wi-serving:active{transform:scale(.995)}.wi-strip::-webkit-scrollbar{display:none}`}</style>

      {/* THE BOARD: one ticket = one card in one column — waiting, in a chair,
          waiting to pay. The search box above narrows all three at once. */}
      {(() => {
        const match = (w: WalkIn) => matchesQuery(w, q);
        const allWaiting = board?.waiting ?? [];
        const waiting = allWaiting.filter(match);
        const inChair = (board?.serving ?? []).filter((w) => !w.awaitingPayment && w.phase !== 'BETWEEN').filter(match).sort((a, b) => minutesLeft(a) - minutesLeft(b));
        const between = (board?.serving ?? []).filter((w) => !w.awaitingPayment && w.phase === 'BETWEEN').filter(match);
        const toPay = (board?.serving ?? []).filter((w) => w.awaitingPayment).filter(match);
        // Missing a service first: those are the ones that cannot be rung up.
        const ordered = [...toPay.filter((w) => (w.items ?? []).length === 0), ...toPay.filter((w) => (w.items ?? []).length > 0)];
        const done = (board?.done ?? []).filter(match);
        const none = (text: string) => <div style={emptyCol}>{q ? (vi ? 'Không có ai khớp tìm kiếm.' : 'Nobody matches the search.') : text}</div>;
        return (
          <div style={isMobile ? { display: 'grid', gap: 18 } : { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
            <div style={deskCol}>
              <ColHead title={t('wi.waiting')} n={waiting.length} hint={vi ? 'theo giờ đến' : 'by arrival'} />
              {waiting.length === 0 ? none(t('wi.noWaiting')) : waiting.map((w) => (
                <WaitingRow
                  key={w.id} w={w} pos={allWaiting.indexOf(w) + 1} staff={staff} currency={currency} t={t} isMobile={isMobile}
                  sel={pick[w.id] ?? w.suggestedStaffId ?? nextUp ?? ''} onPick={(v) => setPick({ ...pick, [w.id]: v })}
                  suggested={w.suggestedStaffId ?? null} requireReason={Boolean(board?.policy?.overrideReason)} waitTarget={board?.policy?.waitTargetMin ?? 10}
                  open={openWait === w.id} onToggle={() => setOpenWait(openWait === w.id ? null : w.id)}
                  onAssign={(staffId, reason) => act(`${w.id}/assign`, { staffId, ...(reason ? { reason } : {}) })}
                  onCall={() => postAction(`${w.id}/call`)}
                  onNoShow={() => { if (window.confirm(vi ? 'Khách không có mặt — đưa ra khỏi hàng chờ?' : 'Not here — take her off the queue?')) void postAction(`${w.id}/no-show`); }}
                  onCancel={() => act(`${w.id}/cancel`)}
                  onManage={() => setOpenId(w.id)}
                />
              ))}
            </div>

            <div style={deskCol}>
              <ColHead title={t('wi.inService')} n={inChair.length + between.length} hint={vi ? 'sắp xong trước' : 'finishing first'} />
              {inChair.length + between.length === 0 ? none(t('wi.noInService')) : (<>
                {inChair.map((w) => (
                  <ServingRow key={w.id} w={w} staff={staff} currency={currency} t={t} isMobile={isMobile} onOpen={() => setOpenId(w.id)} onPay={() => act(`${w.id}/wait-payment`)} />
                ))}
                {between.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 10, background: 'var(--wash-amber-2)', fontSize: 12.5, fontWeight: 700, color: 'var(--ink-warn)' }}>
                    <span>⏸ {t('wi.between')}</span>
                    <span style={{ marginLeft: 'auto' }}>{between.length}</span>
                  </div>
                )}
                {between.map((w) => (
                  <ServingRow key={w.id} w={w} staff={staff} currency={currency} t={t} isMobile={isMobile} onOpen={() => setOpenId(w.id)} onPay={() => act(`${w.id}/wait-payment`)} />
                ))}
              </>)}
            </div>

            <div id="wi-topay" style={{ ...deskCol, scrollMarginTop: 80 }}>
              <ColHead title={vi ? 'Chờ tính tiền' : 'Waiting to pay'} n={toPay.length} tone="warn">
                {(board?.done ?? []).length > 0 && (
                  <button type="button" onClick={() => setShowDone(!showDone)} aria-expanded={showDone} style={railLink}>
                    {t('wi.doneToday')} · {(board?.done ?? []).length} {showDone ? '▴' : '▾'}
                  </button>
                )}
              </ColHead>
              {ordered.length === 0 ? none(vi ? 'Không có khách chờ tính tiền.' : 'Nobody waiting to pay.') : ordered.map((w) => {
                const techId = ticketTech(w);
                return (
                  <ToPayRow key={w.id} w={w} staff={staff} services={services} currency={currency} vi={vi}
                    nudgeMin={board?.policy?.payNudge ? board.policy.payNudgeMin : null}
                    usual={(board?.frequent?.[techId ?? ''] ?? [])}
                    onAdd={(serviceId) => addServiceLine(w.id, serviceId, techId ?? '')}
                    onOpen={() => setOpenId(w.id)}
                    onCloseUnpaid={(reason) => closeUnpaid(w.id, reason)} />
                );
              })}
              {showDone && done.map((d) => {
                // Marked Done too early, or done before the customer paid — the
                // ticket stays reachable here instead of vanishing off the board.
                const total = (d.items ?? []).reduce((sum, it) => sum + (it.priceCents || 0), 0);
                const href = `/salon/pos?walkInId=${d.id}&serviceId=${d.service?.id ?? ''}&staffId=${d.assignedStaff?.id ?? ''}&customerId=${d.customerId ?? ''}&customer=${encodeURIComponent(d.customerName || '')}`;
                return (
                  <div key={d.id} style={{ ...deskCard, flexDirection: 'row', alignItems: 'center', padding: '9px 12px', opacity: 0.92 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ce2e8f0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.customerName || 'Walk-in'}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>{fullName(d.assignedStaff) || '—'} · {formatPrice(total, currency)}</div>
                    </div>
                    <button type="button" onClick={() => act(`${d.id}/reactivate`)} style={{ ...deskBtn, height: 32, padding: '0 10px', fontSize: 12.5 }}>{t('wi.reopen')}</button>
                    <a href={href} style={{ ...ui.primaryBtn, padding: '7px 12px', fontSize: 12.5, textDecoration: 'none' }}>{t('wi.checkout')}</a>
                    {canDelete && (
                      <button type="button" onClick={() => deleteWalkIn(d.id)} title={t('wi.delete')} aria-label={t('wi.delete')}
                        style={{ background: 'none', border: 'none', color: 'var(--c64748b)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '0 2px' }}>🗑</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
      </>)}

      {openId && board && (() => {
        const w = board.serving.find((x) => x.id === openId) ?? board.waiting.find((x) => x.id === openId);
        if (!w) return null;
        return (
          <WalkInTicketSheet
            w={w} staff={staff} services={services} t={t} currency={currency}
            restricted={new Set(board.restricted ?? [])}
            requireService={Boolean(board.policy?.requireService)}
            onLeg={(legId, staffId, start) => act(`${w.id}/legs/${legId}`, { staffId, start })}
            onLegDone={(legId) => act(`${w.id}/legs/${legId}/done`)}
            onAdd={addServiceLine} onUpdateLine={updateServiceLine} onRemove={removeServiceLine} onStation={setStationFor}
            onDone={async () => { await act(`${w.id}/done`); setOpenId(null); }}
            onDelete={canDelete ? async () => { await deleteWalkIn(w.id); setOpenId(null); } : null}
            onClose={() => setOpenId(null)}
          />
        );
      })()}
    </section>
  );
}

/**
 * Type-to-search service picker for the walk-in form. A native <select> is hard
 * to scan once a salon has many services; this filters the list as you type.
 */
function ServiceSearchSelect({ services, value, onChange, placeholder }: {
  services: Service[]; value: string; onChange: (id: string) => void; placeholder: string;
}) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = services.find((s) => s.id === value) || null;
  const q = query.trim().toLowerCase();
  const filtered = q ? services.filter((s) => s.name.toLowerCase().includes(q)) : services;
  return (
    <div style={{ position: 'relative' }}>
      <style>{`.svc-opt:hover{background:var(--c1e293b) !important}`}</style>
      <input
        style={ui.input}
        value={open ? query : selected?.name ?? ''}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
      />
      {open && (
        <div style={{ position: 'absolute', zIndex: 30, top: 'calc(100% + 4px)', left: 0, right: 0, maxHeight: 260, overflowY: 'auto', background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.45)' }}>
          <button type="button" className="svc-opt" onMouseDown={(e) => { e.preventDefault(); onChange(''); setQuery(''); setOpen(false); }} style={svcOpt(!value)}>—</button>
          {filtered.map((s) => (
            <button key={s.id} type="button" className="svc-opt" onMouseDown={(e) => { e.preventDefault(); onChange(s.id); setQuery(s.name); setOpen(false); }} style={svcOpt(s.id === value)}>
              {s.name}
            </button>
          ))}
          {filtered.length === 0 && <div style={{ padding: '10px 12px', color: 'var(--c64748b)', fontSize: 13 }}>{t('wi.noMatch')}</div>}
        </div>
      )}
    </div>
  );
}
const svcOpt = (active: boolean): CSSProperties => ({
  display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none',
  background: active ? 'var(--c312e81)' : 'transparent', color: active ? 'var(--cc7d2fe)' : 'var(--ce2e8f0)', cursor: 'pointer', fontSize: 14,
});

/** Compact "in service" card: name, station, tech, service count + running total,
 *  a quick Checkout, and a Details button that opens the full ticket sheet. Kept
 *  small on purpose so the whole floor fits on one screen when it's busy. */
/** One line for one customer in the queue: number, who, what, how long, seat. */
function WaitingRow({ w, pos, staff, currency, t, isMobile, sel, onPick, suggested, requireReason, waitTarget, open, onToggle, onAssign, onCancel, onManage, onCall, onNoShow }: {
  w: WalkIn; pos: number; staff: StaffTurn[]; currency: string; t: (k: string) => string; isMobile: boolean;
  sel: string; onPick: (v: string) => void;
  /** Walk-in 2.0: the rules' suggestion; choosing another asks why (required when the salon says so). */
  suggested: string | null; requireReason: boolean; waitTarget: number;
  open: boolean; onToggle: () => void;
  onAssign: (staffId: string, reason?: string) => void; onCancel: () => void; onManage: () => void;
  onCall: () => void; onNoShow: () => void;
}) {
  const [reason, setReason] = useState('');
  const [other, setOther] = useState(false);
  const vi = uiLocale().startsWith('vi');
  const overriding = Boolean(sel && suggested && sel !== suggested);
  const blocked = overriding && requireReason && !reason;
  const legs = (w.legs ?? []).filter((l) => !l.legacy || l.lineIds.length > 0);
  const items = w.items ?? [];
  const total = items.reduce((sum, it) => sum + (it.priceCents || 0), 0);
  const mins = items.reduce((sum, it) => sum + (it.durationMinutes || 0), 0);
  const waited = waitedMins(w.arrivedAt ?? w.createdAt);
  // A wait that is getting long turns amber, then red — the card asks for
  // attention before the customer does.
  const late = waited >= waitTarget * 2;
  const waitColor = waited >= waitTarget * 4 ? 'var(--ink-bad)' : late ? 'var(--ink-warn)' : 'var(--ce2e8f0)';
  const picked = staff.find((s) => s.id === sel);
  const sug = staff.find((s) => s.id === suggested) ?? staff.find((s) => s.nextUp) ?? null;
  const sugWhy = !sug ? '' : sug.onBreak ? (vi ? 'đang nghỉ' : 'on a break')
    : sug.busy ? (sug.busyFor != null ? (vi ? `rảnh sau ~${sug.busyFor}′` : `free in ~${sug.busyFor}′`) : (vi ? 'đang làm' : 'busy'))
    : (vi ? 'rảnh ngay · tới lượt' : 'free now · up next');
  const showPicker = other || overriding;
  return (
    <article style={{ ...deskCard, ...(late ? { border: '1px solid #f59e0b' } : null) }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={ticketNo}>#{pos}</span>
        <button type="button" onClick={onToggle} aria-expanded={open} style={{ border: 0, background: 'transparent', padding: 0, textAlign: 'left', cursor: 'pointer', minWidth: 0, flex: 1, fontFamily: 'inherit' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ce2e8f0)', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {w.customerName || 'Walk-in'}{!w.group && w.partySize > 1 ? <span style={{ fontWeight: 600, color: 'var(--c94a3b8)' }}> · {w.partySize} {t('wi.people')}</span> : null}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 3, fontSize: 12.5, color: 'var(--c94a3b8)' }}>
            {w.group && <PartyChip group={w.group} />}
            <span>{cameInText(w)}{w.phone ? ` · ${w.phone}` : ''}</span>
          </div>
        </button>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <b title={t('wi.waited')} style={{ display: 'block', fontSize: 17, fontWeight: 800, color: waitColor, fontVariantNumeric: 'tabular-nums' }}>{waited}′</b>
          <span style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>{vi ? 'đã chờ' : 'waited'}</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {legs.length > 1 || legs.some((l) => l.pinned && l.staffId)
          ? <LegChips legs={legs} staff={staff} t={t} />
          : items.length
            ? items.map((it) => <span key={it.lineId} style={svcPill}>{it.kind === 'addon' ? `+ ${it.name}` : it.name}</span>)
            : w.service ? <span style={svcPill}>{w.service.name}</span> : <span style={missPill}>{t('wi.noService')}</span>}
        {items.length > 0 && <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{formatPrice(total, currency)}{mins > 0 ? ` · ~${mins}′` : ''}</span>}
      </div>

      {(w.calledAt || sug || w.eta) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--ccbd5e1)', background: 'var(--c1e293b)', borderRadius: 10, padding: '7px 10px' }}>
          {w.calledAt
            ? <span style={{ fontWeight: 700, color: 'var(--ink-link)' }}>{vi ? `Đã gọi ${waitedMins(w.calledAt)}′ trước` : `Called ${waitedMins(w.calledAt)}′ ago`}</span>
            : sug ? <span>{vi ? 'Gợi ý' : 'Suggested'}: <b style={{ color: 'var(--ce2e8f0)' }}>{sug.name}</b> — {sugWhy}</span> : null}
          {w.eta && !w.calledAt && (
            <span title={vi ? 'Thời gian chờ dự kiến' : 'Estimated wait'} style={{ marginLeft: 'auto', color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>
              {w.eta.max === 0 ? (vi ? 'vào ngay' : 'now') : (vi ? `dự kiến ${w.eta.min}–${w.eta.max}′` : `est. ${w.eta.min}–${w.eta.max}′`)}
            </span>
          )}
        </div>
      )}

      {showPicker && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <select value={sel} onChange={(e) => onPick(e.target.value)} aria-label={t('wi.pickStaff')}
            style={{ ...ui.input, width: 'auto', flex: '1 1 140px', minWidth: 0, marginBottom: 0, padding: '7px 10px', fontSize: 13 }}>
            <option value="">{t('wi.pickStaff')}</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}{(suggested ? s.id === suggested : s.nextUp) ? ' ★' : s.busy ? (vi ? ' · đang làm' : ' · busy') : s.onBreak ? (vi ? ' · nghỉ' : ' · break') : ''}</option>)}
          </select>
          {overriding && (
            <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label={vi ? 'Lý do chọn thợ khác' : 'Why another technician'}
              style={{ ...ui.input, width: 'auto', flex: '1 1 150px', minWidth: 0, marginBottom: 0, padding: '7px 10px', fontSize: 13, borderColor: blocked ? '#f59e0b' : undefined }}>
              <option value="">{vi ? (requireReason ? 'Lý do? (bắt buộc)' : 'Lý do?') : (requireReason ? 'Why? (required)' : 'Why?')}</option>
              {OVERRIDE_REASONS.map((r) => <option key={r.key} value={r.key}>{vi ? r.vi : r.en}</option>)}
            </select>
          )}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {/* Seat with the suggested tech in ONE press; another tech is the exception. */}
        <button type="button" disabled={!sel || blocked} onClick={() => sel && !blocked && onAssign(sel, overriding ? reason || undefined : undefined)}
          title={blocked ? (vi ? 'Chọn lý do vì không phải thợ được gợi ý' : 'Pick a reason: not the suggested technician') : undefined}
          style={{ ...ui.primaryBtn, background: '#4f46e5', height: 34, padding: '0 13px', borderRadius: 10, fontSize: 13, fontWeight: 700, opacity: sel && !blocked ? 1 : 0.5 }}>
          {picked ? (vi ? `Giao cho ${picked.name}` : `Seat with ${picked.name}`) : t('wi.assign')}
        </button>
        {!showPicker && <button type="button" onClick={() => setOther(true)} style={deskBtnSm}>{vi ? 'Chọn thợ khác' : 'Another tech'}</button>}
        {!w.calledAt
          ? <button type="button" onClick={onCall} title={w.phone ? (vi ? 'Gọi khách (nhắn tin “Tới lượt bạn”)' : 'Call (texts “It’s your turn”)') : (vi ? 'Đánh dấu đã gọi' : 'Mark as called')}
              style={{ ...deskBtnSm, color: 'var(--ink-link)' }}>{vi ? 'Gọi' : 'Call'}</button>
          : <button type="button" onClick={onNoShow} title={vi ? 'Khách không có mặt' : 'Not here'}
              style={{ ...deskBtnSm, border: '1px solid #f59e0b', color: 'var(--ink-warn)' }}>{vi ? 'Vắng mặt' : 'No-show'}</button>}
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onManage} style={{ ...deskBtnSm, border: 0, background: 'transparent', color: 'var(--ink-link)' }}>{vi ? 'Chi tiết' : 'Details'}</button>
        <button type="button" onClick={onCancel} aria-label={t('wi.cancel')} title={t('wi.cancel')} style={{ ...ui.dangerBtn, height: 34, padding: '0 10px', borderRadius: 10, fontSize: 12.5, lineHeight: 1 }}>✕</button>
      </div>

      {open && items.length > 0 && (
        <div>
          <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
            {items.map((it) => (
              <div key={it.lineId} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--line)' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--ccbd5e1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.kind === 'addon' ? `+ ${it.name}` : it.name}</span>
                {it.durationMinutes ? <span style={{ fontSize: 11, color: 'var(--c64748b)', flexShrink: 0 }}>{it.durationMinutes}′</span> : null}
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ce2e8f0)', flexShrink: 0 }}>{formatPrice(it.priceCents || 0, currency)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px' }}>
              <span style={{ flex: 1, fontSize: 11.5, fontWeight: 600, color: 'var(--c94a3b8)' }}>{t('wi.subtotal')}</span>
              {mins > 0 && <span style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>{mins} {t('wi.mins')}</span>}
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink-good)' }}>{formatPrice(total, currency)}</span>
            </div>
          </div>
          {w.note && <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 6 }}>📝 {w.note}</div>}
          <button type="button" onClick={onManage} style={{ ...deskBtnSm, marginTop: 8 }}>{t('wi.splitTechs')}</button>
        </div>
      )}
    </article>
  );
}

/**
 * "Quá giờ +47′": the visit is past the time its services add up to. Amber
 * from 15 minutes over, red from 45 — at 45 the server parks it at the till by
 * itself, so a red badge means "this one is about to leave the floor".
 */
function OverdueBadge({ minutes, t }: { minutes: number | null | undefined; t: (k: string) => string }) {
  if (minutes == null || minutes < 15) return null;
  const red = minutes >= 45;
  return (
    <span title={t('wi.overdueHint')} style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0, borderRadius: 999, padding: '2px 8px', color: red ? 'var(--ink-bad)' : 'var(--ink-warn)', background: red ? 'rgba(239,68,68,0.14)' : 'var(--wash-amber-2)' }}>
      ⏰ {t('wi.overdue')} +{minutes}′
    </span>
  );
}

/** One card for one customer in a chair: who, with whom, how far along, what, checkout. */
function ServingRow({ w, staff, currency, t, isMobile, onOpen, onPay }: {
  w: WalkIn; staff: StaffTurn[]; currency: string; t: (k: string) => string; isMobile: boolean; onOpen: () => void;
  /** "Xong → chờ tính tiền": the chair is free, the bill waits at the till. */
  onPay: () => void;
}) {
  const vi = uiLocale().startsWith('vi');
  const items = w.items ?? [];
  const legs = (w.legs ?? []).filter((l) => !l.legacy || l.lineIds.length > 0);
  const between = w.phase === 'BETWEEN';
  // Who is on the customer right now (two at once for hands + feet).
  const nameOf = (id: string | null) => staff.find((s) => s.id === id)?.name ?? (w.assignedStaff?.id === id ? fullName(w.assignedStaff) : '');
  const onNow = [...new Set(legs.filter((l) => l.status === 'SERVING' && l.staffId).map((l) => nameOf(l.staffId)).filter(Boolean))];
  const techText = onNow.length ? onNow.join(' + ') : between ? t('wi.waitingTech') : (fullName(w.assignedStaff) || '—');
  const techId = ticketTech(w);
  const subtotal = items.reduce((sum, it) => sum + (it.priceCents || 0), 0);
  const mins = items.reduce((sum, it) => sum + (it.durationMinutes || 0), 0) + (w.extraMinutes || 0);
  const since = waitedMins(w.assignedAt ?? w.createdAt);
  const left = mins > 0 ? mins - since : null;
  const pct = mins > 0 ? Math.min(100, Math.round((since / mins) * 100)) : 0;
  const startAt = w.assignedAt ? clockIn(w.assignedAt, salonTz() || null, vi) : '';
  // Sending her to pay closes every part, so not while another part is still to do.
  const openParts = legs.filter((l) => !l.legacy && l.status !== 'DONE').length;
  const canPay = !between && openParts <= 1;
  const checkoutHref = `/salon/pos?walkInId=${w.id}&serviceId=${w.service?.id ?? ''}&staffId=${w.assignedStaff?.id ?? ''}&customerId=${w.customerId ?? ''}&customer=${encodeURIComponent(w.customerName || '')}`;
  return (
    <article className="wi-serving" onClick={onOpen} style={{ ...deskCard, cursor: 'pointer', ...(between ? { border: '1px solid #f59e0b' } : null) }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <Avatar id={techId ?? w.id} name={onNow[0] ?? (between ? '…' : techText)} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ce2e8f0)', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.customerName || 'Walk-in'}</div>
          <div style={{ fontSize: 12.5, color: between ? 'var(--ink-warn)' : 'var(--c94a3b8)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {between ? `⏸ ${techText}` : techText}{w.station ? ` · ${t('wi.stationShort')} ${w.station}` : ''}{startAt ? ` · ${vi ? 'từ' : 'since'} ${startAt}` : ''}
          </div>
          {(w.group || (w.overdueMinutes ?? 0) >= 15) && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              {w.group && <PartyChip group={w.group} />}
              <OverdueBadge minutes={w.overdueMinutes} t={t} />
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <b style={{ display: 'block', fontSize: 17, fontWeight: 800, color: 'var(--ce2e8f0)', fontVariantNumeric: 'tabular-nums' }}>{mins > 0 ? `${since}/${mins}′` : `${since}′`}</b>
          <span style={{ fontSize: 11.5, color: left != null && left < 0 ? 'var(--ink-warn)' : 'var(--c64748b)' }}>
            {left == null ? (vi ? 'trên ghế' : 'in the chair') : left > 0 ? (vi ? `còn ~${left}′` : `~${left}′ left`) : (vi ? 'quá giờ' : 'over time')}
          </span>
        </div>
      </div>
      {mins > 0 && (
        <div aria-hidden="true" style={{ height: 6, borderRadius: 999, background: 'var(--c1e293b)', overflow: 'hidden' }}>
          <i style={{ display: 'block', height: '100%', width: `${pct}%`, borderRadius: 999, background: pct >= 85 ? '#f59e0b' : '#6366f1' }} />
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {legs.length > 1
          // Several parts: one chip per part, each with its technician.
          ? <LegChips legs={legs} staff={staff} t={t} />
          : items.length
            ? items.map((it) => <span key={it.lineId} style={svcPill}>{it.kind === 'addon' ? `+ ${it.name}` : it.name}</span>)
            : <span style={missPill}>⚠ {t('wi.noService')}</span>}
        <span style={{ flex: 1 }} />
        {items.length > 0 && <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink-good)', fontVariantNumeric: 'tabular-nums' }}>{formatPrice(subtotal, currency)}</span>}
      </div>
      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" onClick={onOpen} style={deskBtnSm}>+ {vi ? 'Dịch vụ' : 'Service'}</button>
        {canPay && <button type="button" onClick={onPay} title={vi ? 'Thợ rảnh, khách ra quầy trả tiền' : 'The tech is free; the bill waits at the till'} style={deskBtnSm}>{vi ? 'Xong → chờ tính tiền' : 'Done → to the till'}</button>}
        <span style={{ flex: 1 }} />
        <a href={checkoutHref} style={{ ...ui.primaryBtn, background: '#4f46e5', height: 34, padding: '0 13px', borderRadius: 10, fontSize: 13, fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', ...(isMobile ? { flex: 1, justifyContent: 'center' } : null) }}>{t('wi.checkout')}</a>
      </div>
    </article>
  );
}

const CLOSE_REASONS: { key: string; vi: string; en: string }[] = [
  { key: 'paid_elsewhere', vi: 'Đã thu ở máy khác', en: 'Paid on another machine' },
  { key: 'pay_later', vi: 'Khách trả sau', en: 'Pays later' },
  { key: 'free_redo', vi: 'Miễn phí / làm lại', en: 'Free / redo' },
  { key: 'mistake', vi: 'Tạo nhầm', en: 'Created by mistake' },
  { key: 'other', vi: 'Khác', en: 'Other' },
];

/**
 * WALK-IN 2.0 — one customer waiting to pay. A visit with no service cannot
 * be rung up, so it says so and offers what this technician usually does, one
 * tap each; "Đóng không thu" closes it without a receipt, with a reason.
 */
function ToPayRow({ w, staff, services, currency, vi, nudgeMin, usual, onAdd, onOpen, onCloseUnpaid }: {
  w: WalkIn; staff: StaffTurn[]; services: Service[]; currency: string; vi: boolean;
  /** Minutes after which the salon wants this nudged (its rule), or null when the rule is off. */
  nudgeMin: number | null;
  usual: string[];
  onAdd: (serviceId: string) => Promise<void> | void;
  onOpen: () => void;
  onCloseUnpaid: (reason: string) => Promise<void> | void;
}) {
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState('paid_elsewhere');
  const [busy, setBusy] = useState<string | null>(null);
  const items = w.items ?? [];
  const missing = items.length === 0;
  const total = items.reduce((sum, it) => sum + (it.priceCents || 0), 0);
  const techId = ticketTech(w);
  const techName = staff.find((s) => s.id === techId)?.name ?? fullName(w.assignedStaff) ?? '';
  const doneAt = (w.legs ?? []).map((l) => l.doneAt).filter(Boolean).sort().pop() ?? null;
  const waitingFor = waitedMins(doneAt ?? w.assignedAt ?? w.createdAt);
  const tooLong = nudgeMin != null && waitingFor >= nudgeMin;
  const usualSvcs = usual.map((id) => services.find((x) => x.id === id)).filter((x): x is Service => !!x).slice(0, 4);
  const checkoutHref = `/salon/pos?walkInId=${w.id}&serviceId=${w.service?.id ?? ''}&staffId=${w.assignedStaff?.id ?? ''}&customerId=${w.customerId ?? ''}&customer=${encodeURIComponent(w.customerName || '')}`;
  const run = async (key: string, fn: () => Promise<void> | void) => { if (busy) return; setBusy(key); try { await fn(); } finally { setBusy(null); } };
  return (
    <article style={{ ...deskCard, gap: 8, ...(missing || tooLong ? { background: 'var(--wash-amber)', border: '1px solid #f59e0b' } : null) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <Avatar id={techId ?? w.id} name={techName || '?'} />
        <button type="button" onClick={onOpen} style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', textAlign: 'left', minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, color: 'var(--ce2e8f0)', fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.customerName || 'Walk-in'}</div>
          <div style={{ color: 'var(--c64748b)', fontSize: 11.5, whiteSpace: 'nowrap' }}>
            {techName ? `${techName} · ` : ''}{doneAt ? `${vi ? 'xong' : 'done'} ${clockIn(doneAt, salonTz() || null, vi)}` : cameInText(w)}
            <span style={{ color: tooLong ? 'var(--ink-warn)' : undefined, fontWeight: tooLong ? 700 : undefined }}> · {vi ? 'chờ' : 'waiting'} {waitingFor}′</span>
          </div>
        </button>
        {w.group && <PartyChip group={w.group} />}
        {missing
          ? <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-warn)', whiteSpace: 'nowrap' }}>⚠ {vi ? 'Thiếu dịch vụ' : 'No service'}</span>
          : <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink-good)', whiteSpace: 'nowrap' }}>{formatPrice(total, currency)}</span>}
      </div>
      {!missing && <div style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{items.map((it) => it.name).join(' · ')}</div>}
      {missing && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {usualSvcs.length > 0 && <span style={{ fontSize: 11.5, color: 'var(--ink-warn)', fontWeight: 600 }}>{techName ? (vi ? `${techName} hay làm:` : `${techName} usually does:`) : (vi ? 'Hay làm:' : 'Usual:')}</span>}
          {usualSvcs.map((sv) => (
            <button key={sv.id} type="button" disabled={!!busy} onClick={() => run(sv.id, () => onAdd(sv.id))}
              style={{ border: '1px dashed var(--c94a3b8)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', borderRadius: 999, padding: '6px 11px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', opacity: busy && busy !== sv.id ? 0.5 : 1 }}>
              {busy === sv.id ? '…' : `+ ${sv.name}${sv.priceCents ? ` ${formatPrice(sv.priceCents, currency)}` : ''}`}
            </button>
          ))}
          <button type="button" onClick={onOpen} style={{ border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ink-link)', borderRadius: 999, padding: '6px 11px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>{vi ? 'Chọn dịch vụ khác…' : 'Other service…'}</button>
        </div>
      )}
      {!closing ? (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {missing
            ? <span style={{ ...ui.primaryBtn, padding: '7px 12px', fontSize: 12.5, opacity: 0.45, cursor: 'not-allowed' }} title={vi ? 'Chọn dịch vụ trước' : 'Pick a service first'}>{vi ? 'Thu tiền' : 'Check out'}</span>
            : <a href={checkoutHref} style={{ ...ui.primaryBtn, padding: '7px 12px', fontSize: 12.5, textDecoration: 'none', whiteSpace: 'nowrap' }}>{vi ? 'Thu tiền' : 'Check out'}</a>}
          <button type="button" onClick={() => setClosing(true)} style={{ border: 0, background: 'transparent', color: 'var(--c94a3b8)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: '7px 4px' }}>{vi ? 'Đóng không thu…' : 'Close without payment…'}</button>
          <button type="button" onClick={onOpen} style={{ marginLeft: 'auto', padding: '7px 10px', background: 'transparent', border: '1px solid var(--c334155)', borderRadius: 8, color: 'var(--ccbd5e1)', cursor: 'pointer', fontSize: 12.5, whiteSpace: 'nowrap' }}>{vi ? 'Chi tiết' : 'Details'} ›</button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', fontWeight: 600 }} htmlFor={`cu-${w.id}`}>{vi ? 'Lý do' : 'Reason'}</label>
          <select id={`cu-${w.id}`} value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...ui.input, width: 'auto', marginBottom: 0, padding: '7px 10px', fontSize: 13 }}>
            {CLOSE_REASONS.map((r) => <option key={r.key} value={r.key}>{vi ? r.vi : r.en}</option>)}
          </select>
          <button type="button" disabled={!!busy} onClick={() => run('close', () => onCloseUnpaid(reason))} style={{ ...ui.primaryBtn, padding: '7px 12px', fontSize: 12.5, background: 'var(--c334155)', color: 'var(--ce2e8f0)' }}>{busy === 'close' ? '…' : (vi ? 'Đóng phiếu' : 'Close ticket')}</button>
          <button type="button" onClick={() => setClosing(false)} style={{ border: 0, background: 'transparent', color: 'var(--c94a3b8)', fontSize: 12.5, cursor: 'pointer' }}>{vi ? 'Thôi' : 'Cancel'}</button>
        </div>
      )}
    </article>
  );
}

/** The ticket's story, from its own fields (Walk-in 2.0 drawer). */
function TicketTimeline({ w, staff, vi }: { w: WalkIn; staff: StaffTurn[]; vi: boolean }) {
  const ev = ticketTimeline(w);
  const nameOf = (id: string | null) => (id ? staff.find((s) => s.id === id)?.name ?? '' : '');
  const label = (e: (typeof ev)[number]) => {
    const who = nameOf(e.staffId);
    const what = e.text.join(', ');
    if (e.kind === 'in') return vi ? 'Khách vào' : 'Came in';
    if (e.kind === 'start') return `${who || (vi ? 'Thợ' : 'Tech')} ${vi ? 'bắt đầu' : 'started'}${what ? ` · ${what}` : ''}`;
    if (e.kind === 'done') return `${who || (vi ? 'Thợ' : 'Tech')} ${vi ? 'xong' : 'finished'}${what ? ` · ${what}` : ''}`;
    return vi ? 'Chờ tính tiền' : 'Waiting to pay';
  };
  const dot = { in: '#6366f1', start: '#22c55e', done: '#94a3b8', pay: '#f59e0b' } as const;
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--c64748b)', marginBottom: 8 }}>{vi ? 'Lịch sử phiếu' : 'Ticket history'}</div>
      <div style={{ display: 'grid', gap: 6 }}>
        {ev.map((e, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '52px 10px minmax(0, 1fr)', gap: 8, alignItems: 'center', fontSize: 12.5 }}>
            <span style={{ color: 'var(--c94a3b8)', fontVariantNumeric: 'tabular-nums' }}>{clockIn(e.at, salonTz() || null, vi)}</span>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot[e.kind] }} />
            <span style={{ color: 'var(--ce2e8f0)' }}>{label(e)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Walk-in 2.0 desk pieces ─────────────────────────────────────────── */

const deskCard: CSSProperties = { background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 14, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0, boxSizing: 'border-box' };
const deskCol: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 };
const emptyCol: CSSProperties = { border: '1px dashed var(--line-strong)', borderRadius: 14, padding: '16px 18px', fontSize: 13.5, color: 'var(--c64748b)' };
const deskBtn: CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, height: 40, padding: '0 14px', borderRadius: 11, border: '1px solid var(--line-strong)', background: 'var(--raised)', color: 'var(--ce2e8f0)', fontSize: 14, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit', textDecoration: 'none' };
const deskBtnSm: CSSProperties = { ...deskBtn, height: 34, padding: '0 12px', fontSize: 13, borderRadius: 10 };
const railLink: CSSProperties = { border: 0, background: 'transparent', padding: '4px 2px', fontSize: 13, fontWeight: 700, color: 'var(--ink-link)', textDecoration: 'none', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' };
const svcPill: CSSProperties = { display: 'inline-flex', alignItems: 'center', height: 24, padding: '0 9px', borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', background: 'var(--c1e293b)', color: 'var(--ce2e8f0)' };
const missPill: CSSProperties = { ...svcPill, background: 'var(--wash-amber-3)', color: 'var(--ink-warn)' };
const ticketNo: CSSProperties = { fontSize: 11.5, fontWeight: 800, borderRadius: 7, padding: '3px 7px', flexShrink: 0, fontVariantNumeric: 'tabular-nums', background: 'var(--wash-blue)', color: 'var(--ink-link)' };

/** "Thứ Bảy, 17/10 · 3:12 PM" — the salon's day and clock for the header. */
function deskDay(vi: boolean): string {
  const tz = salonTz() || undefined;
  const now = new Date();
  let day = '';
  try { day = new Intl.DateTimeFormat(vi ? 'vi-VN' : 'en-US', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: tz }).format(now); } catch { day = ''; }
  const at = clockIn(now.toISOString(), tz ?? null, vi);
  return [day, at].filter(Boolean).join(' · ');
}

/** The search box: part of the name, or 3+ digits of the phone. */
function matchesQuery(w: WalkIn, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  if ((w.customerName ?? '').toLowerCase().includes(s)) return true;
  const digits = s.replace(/\D/g, '');
  return digits.length >= 3 && (w.phone ?? '').replace(/\D/g, '').includes(digits);
}

/** Minutes until a chair is expected free (unknown length sorts last). */
function minutesLeft(w: WalkIn): number {
  const mins = (w.items ?? []).reduce((sum, it) => sum + (it.durationMinutes || 0), 0) + (w.extraMinutes || 0);
  if (!mins) return 1e9;
  return mins - waitedMins(w.assignedAt ?? w.createdAt);
}

function ColHead({ title, n, hint, tone, children }: { title: string; n: number; hint?: string; tone?: 'warn'; children?: React.ReactNode }) {
  const hot = tone === 'warn' && n > 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 28, padding: '0 2px' }}>
      <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{title}</span>
      <span style={{ minWidth: 24, height: 24, padding: '0 8px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 800, background: hot ? 'var(--wash-amber-3)' : 'var(--line)', color: hot ? 'var(--ink-warn)' : 'var(--ccbd5e1)' }}>{n}</span>
      <span style={{ flex: 1 }} />
      {hint && <span style={{ fontSize: 12.5, color: 'var(--c64748b)' }}>{hint}</span>}
      {children}
    </div>
  );
}

/** One technician in the turn line: place, face, what she is doing, turns today. */
function TurnTile({ s, vi, t, isMobile }: { s: StaffTurn; vi: boolean; t: (k: string) => string; isMobile: boolean }) {
  const st = techState(s);
  const isNext = st.kind === 'next';
  const dim = Boolean(s.onBreak && !s.busy);
  const soon = st.bookingSoon ? clockIn(st.bookingSoon, salonTz() || null, vi) : '';
  const status = isNext ? (vi ? 'Tới lượt · rảnh' : 'Up next · free')
    : s.busy ? (s.busyFor != null ? (vi ? `Đang làm · còn ~${s.busyFor}′` : `Busy · ~${s.busyFor}′ left`) : t('wi.serving'))
    : s.onBreak ? t('wi.onBreak') : st.kind === 'request' ? (vi ? 'Chỉ khách request' : 'Requests only') : t('wi.free');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px 9px 9px', borderRadius: 14, minWidth: 0, boxSizing: 'border-box',
      border: `1px solid ${isNext ? '#22c55e' : 'var(--line)'}`, background: isNext ? 'rgba(34,197,94,0.10)' : dim ? 'var(--line)' : 'var(--raised)',
      boxShadow: isNext ? '0 0 0 3px rgba(34,197,94,0.12)' : 'none', ...(isMobile ? { flex: '0 0 178px' } : null) }}>
      <span aria-label={s.rank != null ? (vi ? `thứ ${s.rank} trong hàng tua` : `#${s.rank} in the turn line`) : undefined}
        style={{ fontSize: 12, fontWeight: 800, width: 16, textAlign: 'center', flexShrink: 0, color: isNext ? 'var(--ink-good)' : 'var(--c64748b)' }}>{s.rank ?? '–'}</span>
      <Avatar id={s.id} name={s.name} dim={dim} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: dim ? 'var(--c94a3b8)' : 'var(--ce2e8f0)' }}>{s.name}</div>
        <div style={{ fontSize: 12, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: isNext ? 800 : 500, color: isNext ? 'var(--ink-good)' : s.busy ? 'var(--ink-warn)' : 'var(--c94a3b8)' }}>{status}</div>
        {soon && <div style={{ fontSize: 11.5, fontWeight: 700, marginTop: 1, whiteSpace: 'nowrap', color: 'var(--ink-link)' }}>{vi ? `Có hẹn ${soon}` : `Booking ${soon}`}</div>}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0, lineHeight: 1 }}>
        <b style={{ fontSize: 17, fontWeight: 800, color: 'var(--ce2e8f0)', fontVariantNumeric: 'tabular-nums' }}>{fmtTurns(s.turns)}</b>
        <small style={{ display: 'block', fontSize: 10.5, fontWeight: 600, marginTop: 2, color: 'var(--c64748b)' }}>{t('wi.turns')}</small>
      </div>
    </div>
  );
}



/** Full ticket editor for one in-service walk-in, in a focused overlay: service
 *  lines (each with its tech), add a service, edit station, checkout, done. Opened
 *  from a compact card so the board itself stays a clean overview. Portaled to body. */
function WalkInTicketSheet({ w, staff, services, t, currency, restricted, requireService, onLeg, onLegDone, onAdd, onUpdateLine, onRemove, onStation, onDone, onDelete, onClose }: {
  w: WalkIn; staff: StaffTurn[]; services: Service[]; t: (k: string) => string; currency: string;
  restricted: Set<string>;
  /** Walk-in 2.0: the salon asks for a service before a visit is finished. */
  requireService?: boolean;
  onLeg: (legId: string, staffId: string | null, start?: boolean) => Promise<void> | void;
  onLegDone: (legId: string) => Promise<void> | void;
  onAdd: (id: string, serviceId: string, staffId: string, extraMinutes?: number) => Promise<void> | void;
  onUpdateLine: (id: string, lineId: string, patch: Record<string, unknown>) => Promise<void> | void;
  onRemove: (id: string, lineId: string) => Promise<void> | void;
  onStation: (id: string, station: string) => void;
  onDone: () => void;
  /** Null for a technician, who may run this ticket but not erase it. */
  onDelete: (() => void) | null;
  onClose: () => void;
}) {
  const [svcId, setSvcId] = useState('');
  const [techId, setTechId] = useState('');
  const [extra, setExtra] = useState(String(w.extraMinutes ?? ''));
  const [station, setStation] = useState(w.station ?? '');
  const [busy, setBusy] = useState(false);
  // The client wants their name / phone corrected after checking in.
  const [editing, setEditing] = useState(false);
  const [contactMsg, setContactMsg] = useState<string | null>(null);
  const items = w.items ?? [];
  const legs = w.legs ?? [];
  const subtotal = items.reduce((sum, it) => sum + (it.priceCents || 0), 0);
  const onNow = [...new Set(legs.filter((l) => l.status === 'SERVING' && l.staffId).map((l) => staff.find((s) => s.id === l.staffId)?.name).filter(Boolean))] as string[];
  const techLabel = (id: string | null) => {
    if (!id) return t('wi.unassignedTech');
    const s = staff.find((x) => x.id === id);
    if (s) return s.name;
    return w.assignedStaff && w.assignedStaff.id === id ? fullName(w.assignedStaff) : t('wi.unassignedTech');
  };
  const extraChanged = (extra.trim() === '' ? null : Math.max(0, parseInt(extra, 10) || 0)) !== (w.extraMinutes ?? null);
  async function add() {
    // Either half can be empty: add a service, change the time, or both.
    if ((!svcId && !extraChanged) || busy) return;
    setBusy(true);
    try {
      await onAdd(w.id, svcId, techId, extraChanged ? Math.max(0, parseInt(extra, 10) || 0) : undefined);
      setSvcId('');
    } finally { setBusy(false); }
  }
  const checkoutHref = `/salon/pos?walkInId=${w.id}&serviceId=${w.service?.id ?? ''}&staffId=${w.assignedStaff?.id ?? ''}&customerId=${w.customerId ?? ''}&customer=${encodeURIComponent(w.customerName || '')}`;
  const content = (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...ui.card, width: 'min(560px, 96vw)', maxHeight: '88vh', overflowY: 'auto', padding: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, background: 'var(--c111827)', zIndex: 1 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--ce2e8f0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.customerName || 'Walk-in'}</div>
              <button type="button" onClick={() => { setEditing((x) => !x); setContactMsg(null); }}
                style={{ flexShrink: 0, background: 'transparent', border: '1px solid var(--line-strong)', borderRadius: 8, color: 'var(--ink-link)', fontSize: 12, fontWeight: 700, padding: '3px 8px', cursor: 'pointer' }}>✎ {t('wi.editInfo')}</button>
            </div>
            {!onNow.length && (w.phase === 'BETWEEN' || w.status === 'WAITING')
              ? <div style={{ color: 'var(--ink-warn)', fontSize: 12, marginTop: 2, fontWeight: 600 }}>{w.phase === 'BETWEEN' ? `⏸ ${t('wi.between')}` : t('wi.legWaiting')}</div>
              : <div style={{ color: 'var(--c94a3b8)', fontSize: 12, marginTop: 2 }}>{t('wi.tech')} <strong style={{ color: 'var(--ccbd5e1)' }}>{onNow.length ? onNow.join(' + ') : fullName(w.assignedStaff) || '—'}</strong></div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title={t('wi.station')}>
              <span style={{ fontSize: 11, color: 'var(--c64748b)' }}>{t('wi.stationShort')}</span>
              <input value={station} onChange={(e) => setStation(e.target.value)}
                onBlur={() => { const v = station.trim(); if (v !== (w.station ?? '')) onStation(w.id, v); }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                placeholder={t('wi.stationPh')}
                style={{ width: 52, background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 8, color: 'var(--ce2e8f0)', fontSize: 12, padding: '5px 8px', textAlign: 'center' }} />
            </label>
            <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--c94a3b8)', fontSize: 24, lineHeight: 1, cursor: 'pointer' }}>×</button>
          </div>
        </div>

        <div style={{ padding: 16 }}>
          {/* Massage / spa: forms signed or missing, the client's cautions, the SOAP note. */}
          {editing && (
            <VisitContactEditor kind="walkin" id={w.id} withNote
              initial={{ ...splitName(w.customerName), phone: w.phone, note: w.note }}
              onCancel={() => setEditing(false)}
              onSaved={(r) => { setEditing(false); setContactMsg(r.switched ? t('wi.contactSwitched') : r.emailSkipped ? t('wi.emailSkipped') : null); }} />
          )}
          {contactMsg && <div style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--ink-link)' }}>{contactMsg}</div>}
          <ClientFormsPanel walkInId={w.id} />
          {legs.length > 0 && (
            <LegsPanel w={w} legs={legs} staff={staff} restricted={restricted} t={t} onLeg={onLeg} onLegDone={onLegDone} />
          )}
          <div style={{ border: '1px solid var(--c263041)', borderRadius: 10, overflow: 'hidden' }}>
            {items.length === 0 ? (
              <div style={{ padding: '12px', color: 'var(--c64748b)', fontSize: 13 }}>{t('wi.noLines')}</div>
            ) : items.map((it) => (
              <LineRow
                key={it.lineId} it={it} w={w} staff={staff} services={services} t={t} currency={currency}
                techLabel={techLabel} onUpdateLine={onUpdateLine} onRemove={onRemove}
              />
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 12px', background: 'var(--c0f172a)' }}>
              <span style={{ color: 'var(--c94a3b8)', fontSize: 13, fontWeight: 600 }}>{t('wi.subtotal')}</span>
              <span style={{ color: 'var(--cf8fafc)', fontSize: 16, fontWeight: 700 }}>{formatPrice(subtotal, currency)}</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 150 }}>
              <ServiceSearchSelect services={services} value={svcId} onChange={setSvcId} placeholder={t('wi.addServicePh')} />
            </div>
            <select style={{ ...ui.input, padding: '9px 10px', width: 'auto', maxWidth: 150 }} value={techId} onChange={(e) => setTechId(e.target.value)}>
              <option value="">{t('wi.legAutoShort')}</option>
              {staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }} title={t('wi.extraTimeHint')}>
              <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{t('wi.extraTime')}</span>
              <input
                type="number" min={0} max={600} step={5} value={extra} placeholder="0"
                onChange={(e) => setExtra(e.target.value)}
                style={{ width: 64, background: 'var(--c0f172a)', border: '1px solid var(--c334155)', borderRadius: 8, color: 'var(--ce2e8f0)', fontSize: 12.5, padding: '7px 8px', textAlign: 'right' }}
              />
              <span style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>m</span>
            </label>
            <button onClick={add} disabled={(!svcId && !extraChanged) || busy} style={{ ...ui.primaryBtn, padding: '9px 14px', opacity: ((svcId || extraChanged) && !busy) ? 1 : 0.5 }}>{busy ? '…' : t('wi.addLine')}</button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <a href={checkoutHref}
              style={{ ...ui.primaryBtn, flex: '1 1 140px', textAlign: 'center', padding: '12px 16px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>{t('wi.checkout')} · {formatPrice(subtotal, currency)}</a>
            {w.status !== 'WAITING' && (() => {
              const locked = Boolean(requireService) && items.length === 0;
              const vi = uiLocale().startsWith('vi');
              return (
                <button onClick={locked ? undefined : onDone} disabled={locked}
                  title={locked ? (vi ? 'Tiệm yêu cầu chọn dịch vụ trước khi bấm Xong' : 'This salon asks for a service before finishing') : legs.length > 1 ? t('wi.doneAllHint') : undefined}
                  style={{ ...ui.primaryBtn, background: 'var(--c334155)', color: 'var(--ce2e8f0)', padding: '12px 14px', whiteSpace: 'nowrap', opacity: locked ? 0.45 : 1, cursor: locked ? 'not-allowed' : 'pointer' }}>{legs.length > 1 ? t('wi.doneAll') : t('wi.done')}</button>
              );
            })()}
            {/* An in-service row is the one that gets stuck: it is not filtered
                by date, so a test ticket left here sits on the board tomorrow
                and keeps its technician marked busy for good. */}
            {onDelete && (
              <button onClick={onDelete} title={t('wi.delete')} aria-label={t('wi.delete')}
                style={{ background: 'transparent', border: '1px solid var(--c334155)', color: 'var(--c94a3b8)', borderRadius: 10, padding: '12px 14px', fontSize: 15, cursor: 'pointer' }}>🗑</button>
            )}
          </div>
          <TicketTimeline w={w} staff={staff} vi={uiLocale().startsWith('vi')} />
        </div>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? null : createPortal(content, document.body);
}

/** The parts of a visit at a glance: ✋ Hana ✓ · 🦶 chờ thợ. */
function LegChips({ legs, staff, t }: { legs: Leg[]; staff: StaffTurn[]; t: (k: string) => string }) {
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'nowrap', overflow: 'hidden', minWidth: 0 }}>
      {legs.map((l) => {
        const who = l.staffId ? staff.find((s) => s.id === l.staffId)?.name ?? '' : '';
        const tone = l.status === 'DONE'
          ? { color: 'var(--c64748b)', border: 'var(--c334155)', mark: '✓' }
          : l.status === 'SERVING'
            ? { color: 'var(--ink-good)', border: 'rgba(34,197,94,0.45)', mark: '●' }
            : { color: 'var(--ink-warn)', border: 'rgba(245,158,11,0.45)', mark: '○' };
        return (
          <span key={l.legId} title={l.names.join(' · ')} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, maxWidth: 140,
            fontSize: 11.5, fontWeight: 600, color: tone.color, border: `1px solid ${tone.border}`,
            borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            <span>{ZONE_ICON[l.zone]}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {who || (l.status === 'WAITING' ? t('wi.legWaitingShort') : legLabel(l, t))}{l.pinned && l.status === 'WAITING' && who ? ' 📌' : ''}
            </span>
            <span style={{ fontSize: 9 }}>{tone.mark}</span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * Who does which part of the visit. Each leg (hands, feet, anything else) has
 * its own technician: "Tự động" lets the dispatcher pick the fairest free one
 * who does those services; picking a name reserves it for her. Works at any
 * moment — before, during (the customer wants someone else) or after (fixing
 * who gets the turn).
 */
function LegsPanel({ w, legs, staff, restricted, t, onLeg, onLegDone }: {
  w: WalkIn; legs: Leg[]; staff: StaffTurn[]; restricted: Set<string>; t: (k: string) => string;
  onLeg: (legId: string, staffId: string | null, start?: boolean) => Promise<void> | void;
  onLegDone: (legId: string) => Promise<void> | void;
}) {
  const [busyLeg, setBusyLeg] = useState<string | null>(null);
  async function run(legId: string, fn: () => Promise<void> | void) {
    if (busyLeg) return;
    setBusyLeg(legId);
    try { await fn(); } finally { setBusyLeg(null); }
  }
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--c94a3b8)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{t('wi.legs')}</div>
        <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 2 }}>{t('wi.legsHint')}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {legs.map((l) => {
          const able = staff.filter((s) => canDoLeg(s, l, restricted));
          const others = staff.filter((s) => !canDoLeg(s, l, restricted));
          const since = l.startedAt ? waitedMins(l.startedAt) : 0;
          const status = l.status === 'DONE'
            ? { text: t('wi.legDone'), color: 'var(--c94a3b8)', bg: 'var(--c1e293b)' }
            : l.status === 'SERVING'
              ? { text: `${t('wi.legServing')} · ${since}′`, color: 'var(--ink-good)', bg: 'rgba(34,197,94,0.12)' }
              : { text: t('wi.legWaiting'), color: 'var(--ink-warn)', bg: 'var(--wash-amber-2)' };
          const opt = (s: StaffTurn) => `${s.name}${s.nextUp ? ' ★' : ''}${s.busy && s.id !== l.staffId ? ` · ${s.busyFor != null ? t('wi.freeIn').replace('{m}', String(s.busyFor)) : t('wi.busyShort')}` : ''}`;
          const busy = busyLeg === l.legId;
          return (
            <div key={l.legId} style={{ border: '1px solid var(--c263041)', borderRadius: 10, padding: '10px 12px', background: 'var(--c0f172a)', opacity: busy ? 0.6 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>{ZONE_ICON[l.zone]}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ce2e8f0)' }}>{legLabel(l, t)}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {l.names.join(' · ') || t('wi.noService')}{l.minutes ? ` · ${l.minutes} ${t('wi.mins')}` : ''}{l.turnValue !== 1 ? ` · ${fmtTurns(l.turnValue)} ${t('wi.turns')}` : ''}
                  </div>
                </div>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: status.color, background: status.bg, borderRadius: 999, padding: '2px 9px', whiteSpace: 'nowrap' }}>{status.text}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <select
                  aria-label={t('wi.pickStaff')}
                  value={l.staffId && (l.pinned || l.status !== 'WAITING') ? l.staffId : ''}
                  disabled={busy}
                  onChange={(e) => { const v = e.target.value || null; void run(l.legId, () => onLeg(l.legId, v)); }}
                  style={{ ...ui.input, marginBottom: 0, padding: '7px 9px', fontSize: 12.5, flex: '1 1 170px', minWidth: 0 }}
                >
                  {l.status !== 'DONE' && <option value="">{t('wi.legAuto')}</option>}
                  {able.map((s) => <option key={s.id} value={s.id}>{opt(s)}</option>)}
                  {others.length > 0 && (
                    <optgroup label={t('wi.cantDo')}>
                      {others.map((s) => <option key={s.id} value={s.id}>{opt(s)}</option>)}
                    </optgroup>
                  )}
                </select>
                {l.status === 'WAITING' && l.staffId && l.pinned && (
                  <button disabled={busy} onClick={() => run(l.legId, () => onLeg(l.legId, l.staffId, true))}
                    style={{ ...ui.primaryBtn, padding: '7px 12px', fontSize: 12.5, whiteSpace: 'nowrap' }}>{t('wi.legStartNow')}</button>
                )}
                {l.status === 'SERVING' && (
                  <button disabled={busy} onClick={() => run(l.legId, () => onLegDone(l.legId))}
                    style={{ ...ui.primaryBtn, background: 'var(--c334155)', color: 'var(--ce2e8f0)', padding: '7px 12px', fontSize: 12.5, whiteSpace: 'nowrap' }}>✓ {t('wi.legFinish')}</button>
                )}
              </div>
              {l.status === 'WAITING' && l.pinned && l.staffId && (
                <div style={{ fontSize: 11, color: 'var(--c94a3b8)', marginTop: 6 }}>📌 {t('wi.legPinned')}</div>
              )}
            </div>
          );
        })}
      </div>
      {w.status === 'WAITING' && <div style={{ fontSize: 11.5, color: 'var(--c64748b)', marginTop: 6 }}>{t('wi.legQueueHint')}</div>}
    </div>
  );
}

const wiGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 };

function SecHead({ label, extra }: { label: string; extra?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--c94a3b8)', textTransform: 'uppercase' }}>{label}</span>
      {extra && <span style={{ fontSize: 11.5, color: 'var(--c818cf8)', fontWeight: 600 }}>{extra}</span>}
      <span style={{ flex: 1, height: 1, background: 'var(--c334155)' }} />
    </div>
  );
}

function WiLabel({ text, opt, hint }: { text: string; opt?: string; hint?: string }) {
  // Some i18n strings already carry "(optional)"; strip it so the tag isn't said twice.
  const clean = text.replace(/\s*\((tuỳ chọn|tùy chọn|optional)\)\s*/i, '').trim();
  return (
    <span style={{ ...ui.label, display: 'flex', alignItems: 'center', gap: 6 }} title={hint}>
      {clean}
      {opt && <span style={{ fontSize: 10.5, color: 'var(--c64748b)', border: '1px solid var(--c334155)', borderRadius: 5, padding: '1px 5px', fontWeight: 600 }}>{opt}</span>}
    </span>
  );
}

/**
 * One ticket line. Read-only by default; the pencil turns it into four small
 * fields — service, tech, price, minutes — because a nail ticket is negotiated
 * at the chair, not fixed by the menu.
 */
function LineRow({ it, w, staff, services, t, currency, techLabel, onUpdateLine, onRemove }: {
  it: WalkInItem; w: WalkIn; staff: StaffTurn[]; services: Service[]; t: (k: string) => string; currency: string;
  techLabel: (id: string | null) => string;
  onUpdateLine: (id: string, lineId: string, patch: Record<string, unknown>) => Promise<void> | void;
  onRemove: (id: string, lineId: string) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [svc, setSvc] = useState(it.serviceId);
  const [tech, setTech] = useState(it.staffId ?? '');
  const [price, setPrice] = useState((it.priceCents / 100).toFixed(2));
  const [mins, setMins] = useState(String(it.durationMinutes ?? ''));
  const [busy, setBusy] = useState(false);

  function reset() {
    setSvc(it.serviceId); setTech(it.staffId ?? '');
    setPrice((it.priceCents / 100).toFixed(2)); setMins(String(it.durationMinutes ?? ''));
    setEditing(false);
  }
  async function save() {
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {};
      if (svc && svc !== it.serviceId) patch.serviceId = svc;
      const cents = Math.max(0, Math.round((parseFloat(price) || 0) * 100));
      if (cents !== it.priceCents) patch.priceCents = cents;
      const m = mins.trim() === '' ? undefined : Math.max(0, parseInt(mins, 10) || 0);
      if (m !== undefined && m !== (it.durationMinutes ?? undefined)) patch.durationMinutes = m;
      if ((tech || null) !== (it.staffId ?? null)) patch.staffId = tech;
      if (Object.keys(patch).length) await onUpdateLine(w.id, it.lineId, patch);
      setEditing(false);
    } finally { setBusy(false); }
  }

  if (!editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'var(--ce2e8f0)', fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
          <div style={{ color: 'var(--c94a3b8)', fontSize: 11 }}>
            {techLabel(it.staffId)}
            {it.durationMinutes ? <span style={{ color: 'var(--c64748b)' }}> · {it.durationMinutes} {t('wi.mins')}</span> : null}
          </div>
        </div>
        <div style={{ color: 'var(--ce2e8f0)', fontSize: 14, fontWeight: 600 }}>{formatPrice(it.priceCents, currency)}</div>
        <button onClick={() => setEditing(true)} title={t('wi.editLine')} aria-label={t('wi.editLine')}
          style={{ background: 'none', border: 'none', color: 'var(--c818cf8)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px' }}>✎</button>
        <button onClick={() => onRemove(w.id, it.lineId)} title={t('wi.removeLine')} aria-label={t('wi.removeLine')}
          style={{ background: 'none', border: 'none', color: 'var(--ink-bad)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
      </div>
    );
  }
  return (
    <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)', background: 'var(--c0f172a)', display: 'flex', flexDirection: 'column', gap: 7 }}>
      <select value={svc} onChange={(e) => setSvc(e.target.value)} style={{ ...ui.input, padding: '7px 8px', fontSize: 13 }}>
        {services.every((x) => x.id !== svc) && <option value={svc}>{it.name}</option>}
        {services.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <select value={tech} onChange={(e) => setTech(e.target.value)} style={{ ...ui.input, padding: '7px 8px', fontSize: 12.5, flex: 1, minWidth: 110 }}>
          <option value="">{t('wi.unassignedTech')}</option>
          {staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>$</span>
          <input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)}
            style={{ ...ui.input, width: 78, padding: '7px 8px', fontSize: 12.5, textAlign: 'right' }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="number" min={0} max={600} step={5} value={mins} placeholder="0" onChange={(e) => setMins(e.target.value)}
            style={{ ...ui.input, width: 64, padding: '7px 8px', fontSize: 12.5, textAlign: 'right' }} />
          <span style={{ fontSize: 11.5, color: 'var(--c64748b)' }}>{t('wi.mins')}</span>
        </label>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={save} disabled={busy} style={{ ...ui.primaryBtn, padding: '7px 14px', fontSize: 12.5, opacity: busy ? 0.5 : 1 }}>{busy ? '…' : t('wi.lineSave')}</button>
        <button onClick={reset} style={{ border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, cursor: 'pointer' }}>{t('wi.lineCancel')}</button>
      </div>
    </div>
  );
}

/**
 * Pair the customer-facing iPad. Deliberately quiet — it is a one-time setup,
 * not something the front desk touches every day — but always reachable,
 * because a rotated code makes the kiosk stop working until it is re-entered.
 */
/**
 * Everything about the self check-in link in one place. There is only one link
 * and one code — the choices are just where you put it: on the customer screen
 * for the person standing here, on paper at the counter, or on a tablet by the
 * door. Splitting that into two buttons only made staff wonder which was which.
 */
function KioskInline({ t, qrOn, canShow, onToggleQr }: {
  t: (k: string) => string; qrOn: boolean; canShow: boolean; onToggleQr: () => void;
}) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<{ pairCode: string; displayUrl: string } | null>(null);
  const load = useCallback(async () => {
    if (!token) return;
    try { setS(await apiFetch<{ pairCode: string; displayUrl: string }>('/display/session', { token })); }
    catch { /* not fatal — the desk still works without a kiosk */ }
  }, [token]);
  useEffect(() => { if (open && !s) load(); }, [open, s, load]);
  // THE QR MUST CARRY THE SHOP'S CODE. The check-in page pairs itself from
  // `?c=CODE` and shows a customer the menu straight away; without it, a
  // customer who scanned the poster landed on "Enter the 6-character code" —
  // a screen written for the salon's own iPad, not for a stranger with a
  // phone. The link used to be built from the display's base URL alone, so
  // every printed code was a link to that screen. Same code every time: it
  // only changes when somebody presses "New code" below, on purpose.
  const url = s ? `${s.displayUrl.replace(/\/display\/?$/, '')}/checkin?c=${encodeURIComponent(s.pairCode)}` : '';
  // On a phone the toolbar wraps and this button lands at the LEFT edge, so
  // a panel hung off its right edge opened almost entirely off-screen — the
  // owner saw a grey slab with the last few letters of each line. There the
  // panel simply drops into the flow, full width, under the toolbar.
  const isMobile = useIsMobile();

  return (
    <div style={isMobile ? { width: '100%' } : { position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          background: qrOn ? 'rgba(79,70,229,0.14)' : 'var(--raised)',
          border: `1px solid ${qrOn ? '#4f46e5' : 'var(--line-strong)'}`, borderRadius: 11, height: 40, boxSizing: 'border-box',
          color: qrOn ? 'var(--ink-link)' : 'var(--ce2e8f0)', fontSize: 14, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
          padding: '0 14px', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
        }}
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h3v3h-3z M20 14v6h-3" /></svg>
        {t('wi.kiosk')}
        {qrOn && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e' }} />{t('wi.qrLive')}
        </span>}
        <span style={{ color: 'var(--c64748b)' }}>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div style={{
          ...ui.card, display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap',
          ...(isMobile
            ? { position: 'static', width: '100%', marginTop: 8, boxSizing: 'border-box' as const }
            : { position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 20, width: 'min(560px, 88vw)' }),
        }}>
          {/* The QR IS the link — a code to type is the fallback, not the point. */}
          <div style={{ textAlign: 'center' }}>
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=1&data=${encodeURIComponent(url)}`}
                alt={t('wi.kioskScan')}
                style={{ width: 156, height: 156, background: '#fff', borderRadius: 12, padding: 8, display: 'block' }}
              />
            ) : (
              <div style={{ width: 156, height: 156, borderRadius: 12, background: 'var(--c0f172a)', border: '1px solid var(--c334155)' }} />
            )}
            <div style={{ fontSize: 11, color: 'var(--c64748b)', marginTop: 6 }}>{t('wi.kioskScan')}</div>
          </div>
          <div style={{ flex: 1, minWidth: 190 }}>
            <div style={{ fontSize: 10.5, color: 'var(--c94a3b8)', letterSpacing: '0.1em', fontWeight: 600 }}>{t('wi.kioskCodeLabel')}</div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 3, color: 'var(--cc7d2fe)', marginBottom: 8 }}>{s?.pairCode ?? '······'}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ccbd5e1)', lineHeight: 1.55, marginBottom: 10 }}>{t('wi.kioskHow')}</div>
            {url && <div style={{ fontSize: 12, color: 'var(--c818cf8)', wordBreak: 'break-all', fontWeight: 600, marginBottom: 10 }}>{url}</div>}
            <button
              onClick={onToggleQr}
              disabled={!canShow}
              style={{
                width: '100%', marginBottom: 8, borderRadius: 8, padding: '10px 12px', fontSize: 12.5, fontWeight: 600,
                cursor: canShow ? 'pointer' : 'not-allowed', opacity: canShow ? 1 : 0.5,
                border: `1px solid ${qrOn ? '#4f46e5' : 'var(--c334155)'}`,
                background: qrOn ? '#4f46e5' : 'transparent', color: qrOn ? '#fff' : 'var(--ccbd5e1)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              }}
            >🖥️ {qrOn ? t('wi.qrHide') : t('wi.qrOnScreen')}</button>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                onClick={() => { if (url) printQr(url, t('wi.kioskScan'), { hint: t('wi.qrScanHint'), print: t('wi.kioskPrint'), close: t('wi.printClose') }); }}
                disabled={!url}
                style={{ border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', borderRadius: 8, padding: '8px 12px', fontSize: 12, cursor: url ? 'pointer' : 'not-allowed', opacity: url ? 1 : 0.5 }}
              >🖨️ {t('wi.kioskPrint')}</button>
              <button
                // A new code retires the old one: every printed poster and every
                // paired iPad stops working until it is replaced. That is what
                // the button is for (a lost tablet), and it must never happen
                // from a stray tap next to "Print".
                onClick={async () => {
                  if (!token) return;
                  const ok = window.confirm(t('wi.kioskNewConfirm'));
                  if (!ok) return;
                  // The route is /display/session/rotate — the old '/display/rotate'
                  // was a 404 swallowed by this catch, so the button did nothing.
                  try { setS(await apiFetch('/display/session/rotate', { method: 'POST', token })); } catch { /* ignore */ }
                }}
                style={{ border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', borderRadius: 8, padding: '8px 12px', fontSize: 12, cursor: 'pointer' }}
              >{t('wi.kioskNew')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Open a clean print sheet with just the QR — for a counter card or door sign. */
function printQr(url: string, title: string, labels: { hint: string; print: string; close: string }) {
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=900x900&margin=2&data=${encodeURIComponent(url)}`;
  const w = window.open('', '_blank', 'width=620,height=780');
  if (!w) return;
  // On a phone this opens as a full tab with no window chrome of its own, and
  // iOS Safari's print dialog on top of it left the owner with no visible way
  // out ("I pressed Print on my phone and could not get back"). So the sheet
  // carries its own Print and Close buttons — hidden on paper — and only a
  // desktop, where the dialog is a modal you can cancel, prints by itself.
  const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  const touch = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (window.matchMedia?.('(pointer: coarse)').matches ?? false);
  w.document.write(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
    <style>
      body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
        font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a;text-align:center;background:#fff;padding:24px;box-sizing:border-box}
      h1{font-size:clamp(24px,6vw,34px);margin:0 0 8px}p{font-size:clamp(14px,3.8vw,17px);color:#475569;margin:0 0 22px}
      img{width:min(340px,78vw);height:auto;aspect-ratio:1/1}
      .bar{position:fixed;left:0;right:0;bottom:0;display:flex;gap:10px;padding:12px 16px calc(12px + env(safe-area-inset-bottom,0px));background:#fff;border-top:1px solid #e2e8f0}
      .bar button{flex:1;font:inherit;font-size:16px;font-weight:600;padding:14px;border-radius:12px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer}
      .bar button.go{background:#4f46e5;border-color:#4f46e5;color:#fff}
      @media print{.bar{display:none}body{padding:0}}
    </style>
    <h1>${esc(title)}</h1><p>${esc(labels.hint)}</p><img src="${src}" alt="">
    <div class="bar"><button type="button" onclick="window.close()">✕ ${esc(labels.close)}</button><button type="button" class="go" onclick="window.print()">🖨️ ${esc(labels.print)}</button></div>`);
  w.document.close();
  if (touch) return;
  const go = () => { try { w.focus(); w.print(); } catch { /* user cancelled */ } };
  w.onload = () => setTimeout(go, 200);
  setTimeout(go, 900);
}


/* A face for a technician: initials on a colour of her own (stable per id). */
const AV_COLORS = ['#4f46e5', '#7c3aed', '#0e7490', '#be185d', '#047857', '#b45309', '#2563eb', '#9333ea'];

function initialsOf(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  return (p.length > 1 ? p[0][0] + p[p.length - 1][0] : p[0].slice(0, 2)).toUpperCase();
}

function Avatar({ id, name, dim }: { id: string; name: string; dim?: boolean }) {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const ground = dim ? '#94a3b8' : AV_COLORS[h % AV_COLORS.length];
  return (
    <span aria-hidden="true"
      style={{ width: 34, height: 34, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 800, flexShrink: 0, background: ground, color: '#ffffff' }}>
      {initialsOf(name)}
    </span>
  );
}
