'use client';

// ---------------------------------------------------------------------------
// Self check-in kiosk — the tablet the customer touches at the door.
//
// Runs beside the front desk, not instead of it: whatever the customer taps
// lands in the same WAITING queue the receptionist types into, so either side
// can do the work and neither blocks the other. Nothing here can assign a tech
// or take money — the desk stays in control of the floor.
//
// Pairs once with the salon's 6-character display code (the same code the
// customer display uses), then talks to the backend with that token only.
//
// V2 (mockup "Check-in v2 — toàn màn hình", "Khi bàn phím bật lên" B4):
//   - WELCOME screen ("Tap anywhere to check in"). That first tap is what lets
//     the browser go full screen (no Chrome bar) and keep the screen awake.
//   - PHONE FIRST on a big keypad; the salon is asked "seen this number?"
//     (POST /display/checkin-lookup): a returning guest goes straight to the
//     services, a new one gives a name, then (optionally) a birthday.
//   - NAMES ON THE SALON'S OWN KEYBOARD. Android's keyboard covered the form
//     (Chrome lays it OVER the page), so on the tablet the name is typed on
//     big A–Z keys drawn by this page and the device keyboard never opens.
//     "Phone keys" switches to the device keyboard for a name with accents.
//     On a customer's own phone (arrived by QR) the device keyboard is used,
//     the page resizes with it and goes compact.
//   - ONE BAR at the top after the phone step — the coloured side panel only
//     on the phone step, so the content has the screen.
//   - WALKED AWAY? After a quiet spell "Still there?" counts down; then a guest
//     who gave a name is SAVED and put in line ("services at the chair"),
//     anyone else is cleared for the next person.
//   - STAFF: hold the salon logo 3 s for the kiosk settings (full screen, keep
//     awake, quiet time, device keyboard, disconnect). Per device.
//
// LIGHT, ON PURPOSE. This page has its own daylight palette (below), fixed,
// independent of the owner's theme toggle. No `var(--c…)` tokens here.
//
// A PARTY picks per person: each person has their own tab on the services
// step, and each becomes their own ticket on their own technician.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState, CSSProperties } from 'react';
import { apiFetch } from '../../lib/api';
import { useHorizontalScroll } from '../../lib/useHorizontalScroll';
import { NAME_MAX, splitSalonName, typeInto } from '../../lib/kiosk-name';

const TOKEN_KEY = 'lumio_checkin_token';
const PREFS_KEY = 'lumio_checkin_prefs';
/** Seconds the "Still there?" countdown runs before the kiosk acts on its own. */
const STILL_THERE_SEC = 15;

/** This device's kiosk settings (the staff sheet). Stored on the tablet only. */
interface Prefs {
  /** Go full screen on the first tap (hides the browser bar). */
  fullscreen: boolean;
  /** Ask the browser to keep the screen on. */
  awake: boolean;
  /** Quiet seconds before "Still there?". */
  idleSec: number;
  /** Use the device's own keyboard for names instead of the salon keys. */
  deviceKeys: boolean;
}
const DEFAULT_PREFS: Prefs = { fullscreen: true, awake: true, idleSec: 90, deviceKeys: false };
const IDLE_CHOICES = [60, 90, 120];
function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as Partial<Prefs>;
    return {
      fullscreen: raw.fullscreen !== false,
      awake: raw.awake !== false,
      idleSec: IDLE_CHOICES.includes(Number(raw.idleSec)) ? Number(raw.idleSec) : DEFAULT_PREFS.idleSec,
      deviceKeys: raw.deviceKeys === true,
    };
  } catch { return { ...DEFAULT_PREFS }; }
}

interface Service {
  id: string;
  name: string;
  /** List price. */
  priceCents: number;
  /** The service's own discount, 0–90. Absent on an older server. */
  discountPercent?: number;
  /** Today's promotion for its category, 0–90. Absent on an older server. */
  promoPercent?: number;
  /** What the customer pays today — the SAME number the ticket will carry. */
  netCents?: number;
  isFeatured?: boolean;
  durationMinutes: number;
  category: { id: string; name: string } | null;
}
interface Menu {
  salonName: string;
  logoUrl: string | null;
  accentColor: string;
  services: Service[];
  addons?: KAddon[];
  promo?: { percent: number; label: string | null; scope: 'all' | string } | null;
  /** Side panel: "check in on your phone" link (this salon's own pairing link). */
  checkinUrl?: string | null;
  /** Side panel: the salon's Google review page, when its review program is on. */
  reviewUrl?: string | null;
  rating?: { value: number; count: number } | null;
  /** Which QR the side panel shows. */
  panelQr?: 'checkin' | 'review' | 'both';
}
/** What the salon knows about the phone number typed in — first name only. */
interface Lookup {
  returning: boolean;
  firstName?: string | null;
  appointment?: { at: string; serviceIds: string[]; staffName: string | null } | null;
  lastVisit?: { at: string; serviceIds: string[]; staffName: string | null } | null;
}
type Step = 'welcome' | 'phone' | 'name' | 'birthday' | 'services' | 'done';

const SALE = '__sale';
const POPULAR = '__popular';
const payCents = (s: Service) => (typeof s.netCents === 'number' ? s.netCents : s.priceCents);
const offPct = (s: Service) => Math.min(90, Math.max(0, s.discountPercent ?? 0));
const dealPct = (s: Service) => Math.min(90, Math.max(0, s.promoPercent ?? 0));
const onSale = (s: Service) => payCents(s) < s.priceCents;

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
/** "45 min" — or nothing, when the salon never set a length (never "0 min"). */
const mins = (n: number) => (n > 0 ? `${n} min` : '');
/** The most people the kiosk takes one by one; a bigger group goes to the desk. */
const MAX_PARTY = 5;
interface Guest { name: string; picked: string[] }
interface KAddon { id: string; name: string; priceCents: number; durationMinutes: number; serviceId: string | null; categoryId: string | null; askAtBooking?: boolean }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Days per month in a leap year: a Feb 29 birthday must be choosable. */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** A birthday with no year is stored on year 2000, like an imported "03/14" (customers/import-rows). */
const birthIso = (m: number, d: number) => `2000-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
/** Keypad display: (512) 886-8189 for ten digits; longer numbers stay grouped by three. */
function fmtPhone(d: string): string {
  if (!d) return '';
  if (d.length > 10) return d.replace(/(\d{3})(?=\d)/g, '$1 ');
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
const MIN_DIGITS = 10;
const MAX_DIGITS = 15;
const qrSrc = (data: string, px: number) => `https://api.qrserver.com/v1/create-qr-code/?size=${px}x${px}&margin=1&data=${encodeURIComponent(data)}`;
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const dateOf = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** The customer page's own daylight palette. */
const C = {
  page: '#faf9f7',
  card: '#ffffff',
  line: '#e7e3dd',
  ink: '#1c1917',
  ink2: '#44403c',
  muted: '#6f6a64',
  faint: '#a39d96',
  field: '#ffffff',
  price: '#15803d',
  bad: '#b91c1c',
  ok: '#16a34a',
  soft: '#f1eee9',
};

type WakeSentinel = { release: () => Promise<void>; addEventListener?: (t: string, f: () => void) => void };

export default function CheckInKiosk() {
  const [token, setToken] = useState<string | null>(null);
  // Opened through the salon's pairing link (?c=CODE).
  const [viaQr, setViaQr] = useState(false);
  // A phone-sized screen. The pairing link is ALSO how many salons set up the
  // tablet itself (they bookmark lumiobooking.com/checkin?c=CODE), so the link
  // alone must not switch the tablet into "customer's phone" mode — that hid
  // the welcome screen, the salon keyboard and the QR cards on the tablet.
  const [onPhone, setOnPhone] = useState(false);
  // The tablet at the door: welcome screen, full screen, salon keys, QR cards.
  // Only a customer's own phone that arrived by the QR is not a kiosk.
  const kiosk = !(viaQr && onPhone);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [pairInput, setPairInput] = useState('');
  const [pairErr, setPairErr] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('welcome');
  const [digits, setDigits] = useState('');
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [looking, setLooking] = useState(false);
  // Walk-in 2.0: "about how long?" from the floor, shown on the thank-you screen.
  const [eta, setEta] = useState<{ min: number; max: number } | null>(null);
  const [seated, setSeated] = useState(false);
  // Massage / spa: forms still to sign for this ticket — signed right here, on the iPad.
  const [formsToken, setFormsToken] = useState<string | null>(null);
  const [form, setForm] = useState({ firstName: '', lastName: '' });
  // Salon keys: which name the keyboard is typing.
  const [nameField, setNameField] = useState<'first' | 'last'>('first');
  // The guest pressed "Phone keys": the device keyboard for this check-in.
  const [nativeNow, setNativeNow] = useState(false);
  const [bMonth, setBMonth] = useState<number | null>(null);
  const [bDay, setBDay] = useState<number | null>(null);
  const [partySize, setPartySize] = useState(1);
  const [picked, setPicked] = useState<string[]>([]);
  // Everyone after the person checking in, each with their own services.
  const [guests, setGuests] = useState<Guest[]>([]);
  // Whose services the menu is picking right now: 0 = the main guest.
  const [who, setWho] = useState(0);
  const [cat, setCat] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 'both': the side panel alternates its QR every 8 seconds.
  const [qrTurn, setQrTurn] = useState(0);
  // Add-ons picked, per person of the party (0 = the one checking in).
  const [extras, setExtras] = useState<Record<number, string[]>>({});
  // "Still there?" — seconds left, or null when not showing.
  const [still, setStill] = useState<number | null>(null);
  // How the thank-you screen reads: finished, or saved for them after the countdown.
  const [outcome, setOutcome] = useState<'done' | 'saved'>('done');
  // The guest-name sheet on the salon keys (party member index), or null.
  const [guestKeys, setGuestKeys] = useState<number | null>(null);
  const [staffOpen, setStaffOpen] = useState(false);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  // The device keyboard is up (customer's phone / "Phone keys"): go compact.
  const [kbOpen, setKbOpen] = useState(false);

  const lastTouch = useRef(Date.now());
  const wakeRef = useRef<WakeSentinel | null>(null);

  // Restore a previous pairing so the iPad comes back up ready after a reboot.
  // A phone arriving from the salon's QR carries ?c=CODE and pairs itself.
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(TOKEN_KEY); } catch { /* private mode */ }
    setPrefs(readPrefs());
    const small = Math.min(window.screen?.width || window.innerWidth, window.screen?.height || window.innerHeight) < 600;
    setOnPhone(small);
    const code = new URLSearchParams(window.location.search).get('c');
    if (code) {
      setViaQr(true);
      if (small) setStep('phone');
      apiFetch<{ token: string }>('/display/pair', { method: 'POST', body: { pairCode: code.toUpperCase() } })
        .then((r) => {
          // A tablet set up through the link keeps its pairing across reboots.
          if (!small) { try { localStorage.setItem(TOKEN_KEY, r.token); } catch { /* private mode */ } }
          setToken(r.token);
        })
        .catch(() => setToken(saved));
      return;
    }
    setToken(saved);
  }, []);

  const savePrefs = (p: Prefs) => {
    setPrefs(p);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode */ }
    if (!p.fullscreen && typeof document !== 'undefined' && document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
    if (!p.awake && wakeRef.current) { wakeRef.current.release().catch(() => undefined); wakeRef.current = null; }
  };

  const loadMenu = useCallback(async (tk: string) => {
    try {
      setMenu(await apiFetch<Menu>(`/display/checkin-menu/${tk}`));
    } catch {
      // The salon rotated its code — drop the stale token and ask to pair again.
      try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
      setToken(null);
    }
  }, []);
  useEffect(() => { if (token) loadMenu(token); }, [token, loadMenu]);

  const reset = useCallback(() => {
    setForm({ firstName: '', lastName: '' }); setNameField('first'); setNativeNow(false);
    setDigits(''); setLookup(null); setBMonth(null); setBDay(null); setPartySize(1);
    setPicked([]); setGuests([]); setWho(0); setCat(null); setErr(null);
    setStep(viaQr && onPhone ? 'phone' : 'welcome');
    setEta(null); setSeated(false); setFormsToken(null); setExtras({});
    setStill(null); setOutcome('done'); setGuestKeys(null); setStaffOpen(false); setConfirmUnpair(false);
  }, [viaQr, onPhone]);

  // ---- Kiosk: full screen + screen awake, re-armed by any tap ---------------
  // A browser only allows full screen from a tap, so the welcome screen's
  // "Tap anywhere" is that tap — and any later tap puts it back if someone
  // swiped out of it.
  const enterKiosk = useCallback(() => {
    if (!kiosk || !token) return;
    // iPadOS Safari still spells it webkitRequestFullscreen.
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    const doc = document as Document & { webkitFullscreenElement?: Element | null };
    if (prefs.fullscreen && !doc.fullscreenElement && !doc.webkitFullscreenElement) {
      if (typeof el.requestFullscreen === 'function') el.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
      else if (typeof el.webkitRequestFullscreen === 'function') { try { el.webkitRequestFullscreen(); } catch { /* not allowed here */ } }
    }
    const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<WakeSentinel> } }).wakeLock;
    if (prefs.awake && !wakeRef.current && wl) {
      wl.request('screen').then((s) => {
        wakeRef.current = s;
        s.addEventListener?.('release', () => { wakeRef.current = null; });
      }).catch(() => undefined);
    }
  }, [kiosk, token, prefs.fullscreen, prefs.awake]);
  useEffect(() => {
    if (!kiosk) return;
    const on = () => enterKiosk();
    window.addEventListener('click', on);
    return () => window.removeEventListener('click', on);
  }, [kiosk, enterKiosk]);

  // Any touch or key counts as "still here".
  useEffect(() => {
    const mark = () => { lastTouch.current = Date.now(); };
    window.addEventListener('pointerdown', mark, true);
    window.addEventListener('keydown', mark, true);
    return () => { window.removeEventListener('pointerdown', mark, true); window.removeEventListener('keydown', mark, true); };
  }, []);

  // The device keyboard is up when the page has shrunk well below its full
  // height (the viewport resizes with the keyboard — see layout.tsx).
  useEffect(() => {
    let full = window.innerHeight;
    const check = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      full = Math.max(full, window.innerHeight);
      setKbOpen(h < full * 0.72);
    };
    check();
    window.visualViewport?.addEventListener('resize', check);
    window.addEventListener('resize', check);
    return () => { window.visualViewport?.removeEventListener('resize', check); window.removeEventListener('resize', check); };
  }, []);

  const panelQr = menu?.panelQr ?? 'checkin';
  useEffect(() => {
    if (panelQr !== 'both' || (step !== 'phone' && step !== 'welcome')) return;
    const id = window.setInterval(() => setQrTurn((t) => 1 - t), 8000);
    return () => window.clearInterval(id);
  }, [panelQr, step]);

  // A keyboard works too (a counter PC, a tablet with a keyboard case).
  const press = useCallback((k: string) => {
    if (k === 'del') setDigits((d) => d.slice(0, -1));
    else if (/^\d$/.test(k)) setDigits((d) => (d.length < MAX_DIGITS ? d + k : d));
  }, []);

  const accent = menu?.accentColor || '#6366f1';
  const cats = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of menu?.services ?? []) if (s.category) seen.set(s.category.id, s.category.name);
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [menu]);
  const hasSale = useMemo(() => (menu?.services ?? []).some(onSale), [menu]);
  const hasPopular = useMemo(() => (menu?.services ?? []).some((s) => s.isFeatured), [menu]);
  const shown = useMemo(
    () => (menu?.services ?? []).filter((s) =>
      !cat ? true
        : cat === SALE ? onSale(s)
          : cat === POPULAR ? !!s.isFeatured
            : s.category?.id === cat),
    [menu, cat],
  );
  const chips = useHorizontalScroll<HTMLDivElement>();
  const listOf = useCallback(
    (ids: string[]) => ids.map((id) => (menu?.services ?? []).find((s) => s.id === id)).filter(Boolean) as Service[],
    [menu],
  );
  const party = Math.max(1, Math.min(MAX_PARTY, partySize));
  const group = party > 1;
  const people = useMemo(
    () => [
      { name: form.firstName.trim() || 'You', picked },
      ...guests.slice(0, party - 1).map((g, i) => ({ name: g.name.trim() || `Guest ${i + 2}`, picked: g.picked })),
    ].map((p) => ({ ...p, list: listOf(p.picked) })),
    [form.firstName, picked, guests, party, listOf],
  );

  const returning = !!lookup?.returning;
  // The salon's own keys for names: the paired tablet, unless staff turned on
  // the device keyboard or this guest asked for it.
  const salonKeys = kiosk && !prefs.deviceKeys && !nativeNow;

  const findMe = useCallback(async () => {
    if (!token || digits.length < MIN_DIGITS || looking) return;
    setLooking(true); setErr(null);
    let r: Lookup = { returning: false };
    try {
      r = await apiFetch<Lookup>(`/display/checkin-lookup/${token}`, { method: 'POST', body: { phone: digits } });
    } catch {
      // Lookup unavailable (older server, a blip): carry on as a new customer —
      // the check-in itself still matches the phone to the right record.
      r = { returning: false };
    } finally {
      setLooking(false);
    }
    setLookup(r);
    setNameField('first');
    if (r.returning) {
      setForm((f) => ({ ...f, firstName: r.firstName ?? '' }));
      if (r.appointment?.serviceIds?.length) setPicked(r.appointment.serviceIds);
      setStep(r.firstName ? 'services' : 'name');
    } else {
      setStep('name');
    }
  }, [token, digits, looking]);

  const current = people[Math.min(who, people.length - 1)] ?? people[0];
  const currentPicked = who === 0 ? picked : (guests[who - 1]?.picked ?? []);
  const pickedList = current.list;
  const togglePick = (id: string) => {
    if (who === 0) { setPicked((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id])); return; }
    setGuests((gs) => gs.map((g, i) => (i === who - 1 ? { ...g, picked: g.picked.includes(id) ? g.picked.filter((x) => x !== id) : [...g.picked, id] } : g)));
  };
  /** The party size also makes (or trims) one slot per guest. */
  const setParty = (n: number) => {
    const next = Math.max(1, Math.min(MAX_PARTY, n));
    setPartySize(next);
    setGuests((gs) => Array.from({ length: next - 1 }, (_, i) => gs[i] ?? { name: '', picked: [] }));
    setWho(0);
  };
  const everyone = people.flatMap((p) => p.list);
  const addonsOf = (list: Service[]): KAddon[] => (menu?.addons ?? []).filter((a) =>
    a.serviceId ? list.some((sv) => sv.id === a.serviceId) : a.categoryId ? list.some((sv) => sv.category?.id === a.categoryId) : list.length > 0);
  const extrasOf = (i: number): KAddon[] => addonsOf(people[i]?.list ?? []).filter((a) => (extras[i] ?? []).includes(a.id));
  const addonCentsOf = (i: number) => extrasOf(i).reduce((sum, a) => sum + a.priceCents, 0);
  const allExtras = people.flatMap((_, i) => extrasOf(i));
  const extrasCents = allExtras.reduce((sum, a) => sum + a.priceCents, 0);
  const extrasMinutes = allExtras.reduce((sum, a) => sum + (a.durationMinutes || 0), 0);
  const viewWho = Math.min(who, people.length - 1);
  const viewAddons = addonsOf(pickedList);
  const viewExtras = extras[viewWho] ?? [];
  const toggleExtra = (id: string) => setExtras((m) => {
    const cur = m[viewWho] ?? [];
    return { ...m, [viewWho]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
  });
  const totalCents = everyone.reduce((sum, s) => sum + payCents(s), 0) + extrasCents;
  const fullCents = everyone.reduce((sum, s) => sum + s.priceCents, 0) + extrasCents;
  const savedCents = Math.max(0, fullCents - totalCents);
  const pickedCount = everyone.length;
  const totalMinutes = everyone.reduce((sum, s) => sum + (s.durationMinutes || 0), 0) + extrasMinutes;
  const subtotal = (list: Service[]) => list.reduce((sum, s) => sum + payCents(s), 0);

  async function pair() {
    const code = pairInput.trim().toUpperCase();
    if (code.length < 4) return;
    setPairErr(null);
    try {
      const r = await apiFetch<{ token: string }>('/display/pair', { method: 'POST', body: { pairCode: code } });
      try { localStorage.setItem(TOKEN_KEY, r.token); } catch { /* ignore */ }
      setToken(r.token); setPairInput('');
    } catch {
      setPairErr('That code did not work. Ask the front desk for a new one.');
    }
  }

  const unpair = () => {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    reset(); setMenu(null); setToken(null);
  };

  async function submit(opts: { unfinished?: boolean } = {}) {
    if (!token || busy) return;
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch<{ estimate?: { min: number; max: number } | null; formsToken?: string; seated?: boolean }>(`/display/checkin/${token}`, {
        method: 'POST',
        body: {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim() || undefined,
          phone: digits || undefined,
          birthDate: bMonth !== null && bDay !== null ? birthIso(bMonth, bDay) : undefined,
          partySize: party,
          serviceIds: picked,
          ...(opts.unfinished ? { unfinished: true } : {}),
          ...(extrasOf(0).length ? { addonIds: extrasOf(0).map((a) => a.id) } : {}),
          ...(group ? { guests: guests.slice(0, party - 1).map((g, i) => ({ firstName: g.name.trim() || `Guest ${i + 2}`, serviceIds: g.picked, ...(extrasOf(i + 1).length ? { addonIds: extrasOf(i + 1).map((a) => a.id) } : {}) })) } : {}),
        },
      });
      setEta(res?.estimate ?? null);
      setFormsToken(res?.formsToken ?? null);
      setSeated(!!res?.seated);
      setOutcome(opts.unfinished ? 'saved' : 'done');
      setStill(null);
      setStep('done');
    } catch (e) {
      if (opts.unfinished) { reset(); return; }
      setErr(e instanceof Error ? e.message : 'Something went wrong. Please ask the front desk.');
    } finally {
      setBusy(false);
    }
  }

  // ---- Still there? ----------------------------------------------------------
  const working = !!menu && step !== 'welcome' && step !== 'done' && !(step === 'phone' && !digits);
  // A guest who gave a name is saved and put in line; anyone else is cleared.
  const canSave = form.firstName.trim().length > 0 && step !== 'phone';
  useEffect(() => {
    if (!working || still !== null || staffOpen) return;
    lastTouch.current = Date.now();
    const id = window.setInterval(() => {
      if (Date.now() - lastTouch.current > prefs.idleSec * 1000) setStill(STILL_THERE_SEC);
    }, 1000);
    return () => window.clearInterval(id);
  }, [working, still, staffOpen, prefs.idleSec, step]);
  const timeUp = useRef<() => void>(() => undefined);
  timeUp.current = () => {
    setStill(null);
    if (canSave) void submit({ unfinished: true });
    else reset();
  };
  useEffect(() => {
    if (still === null) return;
    if (still <= 0) { timeUp.current(); return; }
    const id = window.setTimeout(() => setStill((s) => (s === null ? null : s - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [still]);
  const stillHere = () => { lastTouch.current = Date.now(); setStill(null); };

  // Thank-you screen, then ready for the next person: longer when there are
  // forms to sign, or a review code to scan while they wait. One timer, owned
  // by the screen — pressing Done and starting the next guest cancels it.
  useEffect(() => {
    if (step !== 'done') return;
    const showReview = returning && !!menu?.reviewUrl;
    const id = window.setTimeout(reset, formsToken ? 60000 : showReview ? 25000 : 9000);
    return () => window.clearTimeout(id);
  }, [step, formsToken, returning, menu?.reviewUrl, reset]);

  // ---- Name: the salon keys (and a real keyboard, when there is one) --------
  const typeName = useCallback((k: string) => {
    if (guestKeys !== null) {
      setGuests((gs) => gs.map((g, i) => (i === guestKeys - 1 ? { ...g, name: typeInto(g.name, k) } : g)));
      return;
    }
    setForm((f) => (nameField === 'first' ? { ...f, firstName: typeInto(f.firstName, k) } : { ...f, lastName: typeInto(f.lastName, k) }));
  }, [nameField, guestKeys]);

  const afterName = useCallback(() => {
    setStep(returning || !digits ? 'services' : 'birthday');
  }, [returning, digits]);
  // Enter / Next: on to the birthday or the services once there is a first name.
  const nameNext = useCallback(() => {
    if (!form.firstName.trim()) return;
    afterName();
  }, [form.firstName, afterName]);

  useEffect(() => {
    if (!menu || staffOpen || still !== null) return;
    const keysUp = (step === 'name' && salonKeys) || guestKeys !== null;
    if (step !== 'phone' && !keysUp) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (step === 'phone' && guestKeys === null) {
        if (e.key >= '0' && e.key <= '9') press(e.key);
        else if (e.key === 'Backspace') press('del');
        else if (e.key === 'Enter') void findMe();
        return;
      }
      if (/^[a-zA-Z]$/.test(e.key) || e.key === ' ' || e.key === '-' || e.key === "'") { e.preventDefault(); typeName(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); typeName('del'); }
      else if (e.key === 'Enter') { e.preventDefault(); if (guestKeys !== null) setGuestKeys(null); else nameNext(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, menu, press, findMe, salonKeys, guestKeys, typeName, nameNext, staffOpen, still]);

  // ---- Staff: hold the salon logo 3 seconds ---------------------------------
  const holdTimer = useRef<number | null>(null);
  const held = useRef(false);
  const holdProps = kiosk ? {
    onPointerDown: () => {
      held.current = false;
      holdTimer.current = window.setTimeout(() => { held.current = true; setStaffOpen(true); setConfirmUnpair(false); }, 3000);
    },
    onPointerUp: () => { if (holdTimer.current) window.clearTimeout(holdTimer.current); },
    onPointerLeave: () => { if (holdTimer.current) window.clearTimeout(holdTimer.current); },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  } : {};

  // ---- Pairing ------------------------------------------------------------
  if (!token) {
    return (
      <main style={{ ...screen, ...accentVar(accent) }}>
        <style>{baseCss}</style>
        <div style={{ ...panel, maxWidth: 520, textAlign: 'center', padding: 'clamp(28px, 6vw, 44px)' }}>
          <Monogram accent={accent} size={72} />
          <h1 style={{ ...titleStyle, fontSize: 32, margin: '18px 0 8px' }}>Connect this tablet</h1>
          <p style={{ color: C.muted, fontSize: 17, lineHeight: 1.55, margin: '0 0 26px' }}>
            Enter the 6-character shop code from the salon dashboard. You only do this once.
          </p>
          <input
            value={pairInput}
            onChange={(e) => setPairInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') pair(); }}
            placeholder="ABC123"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            style={{ ...bigInput, textAlign: 'center', letterSpacing: 10, fontSize: 34, fontWeight: 700, minHeight: 72 }}
          />
          {pairErr && <div style={{ color: C.bad, fontSize: 15, marginTop: 12 }}>{pairErr}</div>}
          <button onClick={pair} disabled={pairInput.trim().length < 4} style={{ ...primary(accent), marginTop: 18, width: '100%', opacity: pairInput.trim().length < 4 ? 0.5 : 1 }}>
            Connect
          </button>
        </div>
      </main>
    );
  }

  if (!menu) {
    return <main style={screen}><div style={{ color: C.muted, fontSize: 20 }}>Loading…</div></main>;
  }

  const brand = splitSalonName(menu.salonName);
  const firstShown = form.firstName.trim() || 'friend';
  const showCheckinQr = kiosk && !!menu.checkinUrl && (panelQr === 'checkin' || (panelQr === 'both' && qrTurn === 0) || !menu.reviewUrl);
  const qrUrl = showCheckinQr ? menu.checkinUrl : menu.reviewUrl;
  const qrKind: 'checkin' | 'review' = showCheckinQr ? 'checkin' : 'review';

  const staffSheet = staffOpen && (
    <StaffSheet
      prefs={prefs} onChange={savePrefs} onClose={() => { setStaffOpen(false); setConfirmUnpair(false); }}
      confirmUnpair={confirmUnpair} onUnpair={() => (confirmUnpair ? unpair() : setConfirmUnpair(true))} accent={accent}
    />
  );
  const stillSheet = still !== null && (
    <StillThere
      seconds={still} name={form.firstName.trim()} canSave={canSave} accent={accent} busy={busy}
      onHere={stillHere} onSaveNow={() => timeUp.current()} onStartOver={reset}
    />
  );

  // ---- Welcome (the paired tablet, between guests) ---------------------------
  if (step === 'welcome') {
    return (
      <main className="ck-page" style={{ ...screen, ...accentVar(accent), padding: 0, display: 'block' }}>
        <style>{baseCss + layoutCss}</style>
        <div className="ck-welcome">
          <button type="button" className="ck-wel-go" style={{ background: accent }}
            onClick={() => { if (held.current) { held.current = false; return; } enterKiosk(); setStep('phone'); }}>
            <span aria-hidden className="ck-deco1" />
            <span aria-hidden className="ck-deco2" />
            <span style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16 }} {...holdProps}>
              <SalonMark menu={menu} accent={accent} size={68} />
              <BrandName brand={brand} size={30} />
            </span>
            {menu.rating && menu.rating.count > 0 && (
              <span style={{ ...liveChip, position: 'relative', alignSelf: 'flex-start', fontSize: 16, minHeight: 38 }}>
                <span style={{ color: '#fcd34d' }}>★</span> {menu.rating.value.toFixed(1)} · {menu.rating.count.toLocaleString('en-US')} Google reviews
              </span>
            )}
            <span style={{ flex: 1 }} />
            <span className="ck-wel-big">Tap anywhere<br />to check in</span>
            <span style={{ position: 'relative', fontSize: 'clamp(17px, 2.4vh, 22px)', opacity: 0.94, textAlign: 'left' }}>Takes about 20 seconds. Been here before? Just your number.</span>
            <span className="ck-wel-cta" style={{ color: accent }}>Start check-in →</span>
          </button>
          <aside className="ck-wel-side">
            {kiosk && menu.checkinUrl && (
              <QrCard url={menu.checkinUrl} accent={accent} eyebrow="Someone using the tablet?" title="Check in on your phone" note="Point your camera here — no app needed." />
            )}
            {menu.reviewUrl && (
              <QrCard url={menu.reviewUrl} accent={accent} eyebrow="Loved your visit?" title="Review us on Google" note="Takes a minute — it means the world to us." stars />
            )}
            {!menu.checkinUrl && !menu.reviewUrl && (
              <span style={{ fontSize: 18, color: C.ink2, lineHeight: 1.5 }}>Welcome! Tap the screen to let us know you’re here.</span>
            )}
            <span className="ck-wel-spacer" style={{ flex: 1 }} />
            {menu.promo && menu.promo.percent > 0 && <div className="ck-wel-offer"><OfferCard menu={menu} accent={accent} light /></div>}
          </aside>
        </div>
        {staffSheet}
      </main>
    );
  }

  // ---- Thank you / saved for you --------------------------------------------
  if (step === 'done') {
    const showReview = returning && !!menu.reviewUrl && outcome === 'done';
    const saved = outcome === 'saved';
    return (
      <main className="ck-page" style={{ ...screen, ...accentVar(accent), alignItems: 'stretch', padding: 0 }}>
        <style>{baseCss + layoutCss}</style>
        <div className="ck-done">
          <span style={{ width: 'clamp(76px, 11vh, 96px)', height: 'clamp(76px, 11vh, 96px)', borderRadius: '50%', background: accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="54%" height="54%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
          </span>
          <h1 style={{ ...titleStyle, fontSize: 'clamp(32px, 6vh, 46px)', lineHeight: 1.1, margin: 0 }}>
            {saved ? `You’re on the list, ${firstShown}.` : `You’re checked in, ${firstShown}!`}
          </h1>
          <p style={{ fontSize: 'clamp(17px, 2.6vh, 20px)', lineHeight: 1.45, margin: 0, color: C.ink2, maxWidth: 760 }}>
            {saved ? 'We saved your details and your place in line. The front desk will come and help you choose your services.'
              : seated ? 'Your technician is getting ready for you.'
                : `${pickedCount ? `${everyone.map((x) => x.name).join(' + ')} · ${money(totalCents)}. ` : ''}${group ? `Have a seat — we’ll call all ${party} of you.` : 'Have a seat — we’ll call your name.'}`}
          </p>
          <div className="ck-tiles">
            <div className="ck-tile">
              <span style={tileLabel}>About</span>
              <b style={tileBig}>{seated ? 'Now' : eta && eta.max > 0 ? `${eta.min}–${eta.max} min` : 'Shortly'}</b>
              <span style={tileSub}>{seated ? 'Your technician is ready' : 'Estimated wait'}</span>
            </div>
            <div className="ck-tile">
              <span style={tileLabel}>Services</span>
              <b style={tileBig}>{pickedCount ? pickedCount : 'At the chair'}</b>
              <span style={tileSub}>{pickedCount ? (pickedCount === 1 ? 'service picked' : 'services picked') : 'The desk will ask you'}</span>
            </div>
            <div className="ck-tile">
              <span style={tileLabel}>We&rsquo;ll call</span>
              <b style={{ ...tileBig, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{group ? people.map((p) => p.name).join(', ') : firstShown}</b>
              <span style={tileSub}>{group ? `${party} people` : 'Listen for your name'}</span>
            </div>
          </div>
          {formsToken && !saved && (
            <button onClick={() => { window.location.href = `/sign/${formsToken}?return=${encodeURIComponent('/checkin')}`; }}
              style={{ ...primary(accent) }}>
              Please sign your forms (1 min) · Ký phiếu
            </button>
          )}
          {showReview && (
            <div className="ck-review">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrSrc(menu.reviewUrl as string, 300)} alt="QR code to review us on Google" style={{ width: 'clamp(96px, 14vh, 124px)', height: 'auto', aspectRatio: '1 / 1', flexShrink: 0, display: 'block' }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, textAlign: 'left' }}>
                <span style={{ ...eyebrow, color: accent }}>While you wait</span>
                <b style={{ fontSize: 'clamp(17px, 2.6vh, 20px)', lineHeight: 1.25, color: C.ink }}>Loved your last visit? Review us on Google</b>
                <span aria-label="5 stars" style={{ color: '#f59e0b', fontSize: 18, letterSpacing: 2 }}>★★★★★</span>
                <span style={{ fontSize: 14, color: C.ink2, lineHeight: 1.4 }}>Point your phone camera at the code.</span>
              </span>
            </div>
          )}
          <span style={{ fontSize: 15, color: C.muted }}>Back to the start in a few seconds.</span>
          <button onClick={reset} style={{ ...ghostBtn, minHeight: 60, padding: '0 40px', fontSize: 18, fontWeight: 800, borderRadius: 18 }}>Done</button>
        </div>
      </main>
    );
  }

  // ---- The flow ------------------------------------------------------------
  const path = returning ? (lookup?.firstName ? ['Mobile', 'Services'] : ['Mobile', 'Your name', 'Services']) : ['Mobile', 'About you', 'Services'];
  const idx = step === 'phone' ? 0 : step === 'services' ? path.length - 1 : 1;
  const lastVisit = lookup?.lastVisit && lookup.lastVisit.serviceIds.length ? lookup.lastVisit : null;
  const lastList = lastVisit ? listOf(lastVisit.serviceIds) : [];
  const lastApplied = lastList.length > 0 && lastList.every((s) => picked.includes(s.id)) && picked.length === lastList.length;
  const appt = lookup?.appointment ?? null;
  const goBack = () => {
    if (step === 'name') {
      setStep('phone'); return;
    }
    if (step === 'birthday') { setStep('name'); setNameField('first'); return; }
    if (step === 'services') {
      if (group && who > 0) { setWho(who - 1); return; }
      if (returning && lookup?.firstName) { setStep('phone'); return; }
      if (!returning && digits) { setStep('birthday'); return; }
      setStep('name'); setNameField('first');
    }
  };

  const topBar = (
    <header className="ck-bar">
      <button type="button" className="ck-iconbtn" aria-label="Back" onClick={goBack}>
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <span className="ck-bar-brand" {...holdProps}>
        <SalonMark menu={menu} accent={accent} size={36} />
        <span className="ck-bar-name">{brand.name}</span>
      </span>
      <ol className="ck-steps" aria-label={`Step ${idx + 1} of ${path.length}`}>
        {path.map((n, i) => (
          <li key={n} className={i === idx ? 'on' : i < idx ? 'past' : ''}>
            <span className="ck-dot" style={i < idx ? { background: accent, borderColor: accent, color: '#fff' } : i === idx ? { background: C.ink, borderColor: C.ink, color: '#fff' } : undefined}>{i < idx ? '✓' : i + 1}</span>
            <span className="ck-steplbl">{n}</span>
          </li>
        ))}
      </ol>
      <span className="ck-steps-sm">Step {idx + 1} of {path.length}</span>
      <button type="button" className="ck-textbtn" onClick={reset}>Start over</button>
    </header>
  );

  // ---- Phone ----------------------------------------------------------------
  if (step === 'phone') {
    return (
      <main className={`ck-page${kbOpen ? ' ck-kb' : ''}`} style={{ ...screen, ...accentVar(accent), padding: 0, display: 'block' }}>
        <style>{baseCss + layoutCss}</style>
        <div className="ck-app ck-row">
          <aside className="ck-rail" style={{ background: accent }}>
            <span aria-hidden className="ck-deco1" />
            <span aria-hidden className="ck-deco2" />
            <span style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12 }} {...holdProps}>
              <SalonMark menu={menu} accent={accent} size={54} />
              <BrandName brand={brand} size={22} />
            </span>
            {menu.rating && menu.rating.count > 0 && (
              <span style={{ ...liveChip, position: 'relative', alignSelf: 'flex-start' }}><span style={{ color: '#fcd34d' }}>★</span> {menu.rating.value.toFixed(1)} · {menu.rating.count.toLocaleString('en-US')} reviews</span>
            )}
            {qrUrl && (
              <section className="ck-qrrow" aria-label={qrKind === 'checkin' ? 'Check in on your phone' : 'Review us on Google'}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrSrc(qrUrl, 300)} alt={qrKind === 'checkin' ? 'QR code to check in on your phone' : 'QR code to review us on Google'}
                  style={{ width: 'clamp(92px, 15vh, 120px)', height: 'auto', aspectRatio: '1 / 1', display: 'block', flexShrink: 0 }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <span style={{ ...eyebrow, color: accent }}>{qrKind === 'checkin' ? 'Skip the line' : 'Loved your visit?'}</span>
                  <b style={{ fontSize: 17, lineHeight: 1.2, color: C.ink }}>{qrKind === 'checkin' ? 'Check in on your phone' : 'Review us on Google'}</b>
                  <span style={{ fontSize: 13.5, lineHeight: 1.4, color: C.ink2 }}>{qrKind === 'checkin' ? 'Point your camera here.' : 'Takes a minute — thank you!'}</span>
                </span>
              </section>
            )}
            <span style={{ flex: 1 }} />
            {menu.promo && menu.promo.percent > 0 && <OfferCard menu={menu} accent={accent} />}
            <span style={{ position: 'relative', fontSize: 13, color: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', gap: 8 }}><LockIcon /> Only the salon sees your details.</span>
          </aside>
          <section className="ck-col">
            <header className="ck-mhead" style={{ background: accent }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }} {...holdProps}>
                <SalonMark menu={menu} accent={accent} size={44} />
                <BrandName brand={brand} size={19} />
              </span>
              {step === 'phone' && qrUrl && (
                <div className="ck-bandqr">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrSrc(qrUrl, 240)} alt={qrKind === 'checkin' ? 'QR code to check in on your phone' : 'QR code to review us on Google'} style={{ width: 84, height: 84, flexShrink: 0, display: 'block' }} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                    <span style={{ ...eyebrow, color: accent }}>{qrKind === 'checkin' ? 'Skip the line' : 'Loved your visit?'}</span>
                    <b style={{ fontSize: 17, color: C.ink }}>{qrKind === 'checkin' ? 'Check in on your phone' : 'Review us on Google'}</b>
                  </span>
                </div>
              )}
            </header>
            <div className="ck-scroll">
              <div className="ck-phone">
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  {kiosk && (
                    <button type="button" className="ck-iconbtn" aria-label="Back to the welcome screen" onClick={reset} style={{ marginTop: 4 }}>
                      <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
                    </button>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <h1 style={{ ...titleStyle, fontSize: 'clamp(26px, 4.6vh, 38px)', margin: 0 }}>What&rsquo;s your mobile number?</h1>
                    <p className="ck-hide-kb" style={{ margin: 0, color: C.ink2, fontSize: 'clamp(15px, 2.2vh, 18px)' }}>Been here before? That&rsquo;s all we need.</p>
                  </div>
                </div>
                <div aria-live="polite" className="ck-display" style={{ borderColor: accent, color: digits ? C.ink : C.faint }}>
                  {digits ? fmtPhone(digits) : '(___) ___-____'}
                </div>
                <div className="ck-keypad">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
                    <button key={k} type="button" className="ck-key" onClick={() => press(k)}>{k}</button>
                  ))}
                  <button type="button" className="ck-key ck-key-del" aria-label="Delete" onClick={() => press('del')}>
                    <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 5H9l-6 7 6 7h12z" /><path d="m17 9-5 6M12 9l5 6" /></svg>
                  </button>
                  <button type="button" className="ck-key" onClick={() => press('0')}>0</button>
                  <button type="button" className="ck-key ck-key-go" onClick={() => void findMe()} disabled={digits.length < MIN_DIGITS || looking}
                    style={{ background: accent, opacity: digits.length < MIN_DIGITS || looking ? 0.4 : 1 }}>
                    {looking ? '…' : 'Continue'}
                  </button>
                </div>
                <button type="button" onClick={() => { setDigits(''); setLookup(null); setNameField('first'); setStep('name'); }}
                  style={{ alignSelf: 'center', minHeight: 48, border: 'none', background: 'transparent', color: C.ink2, fontSize: 17, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 4, cursor: 'pointer' }}>
                  No mobile number? Check in with your name
                </button>
                {menu.promo && menu.promo.percent > 0 && <div className="ck-promo-m"><OfferCard menu={menu} accent={accent} light /></div>}
              </div>
            </div>
          </section>
        </div>
        {stillSheet}
        {staffSheet}
      </main>
    );
  }

  // ---- Name -------------------------------------------------------------------
  if (step === 'name') {
    const title = returning ? 'Welcome back! What name should we call?' : digits ? 'Nice to meet you! What’s your name?' : 'What’s your name?';
    const firstOk = form.firstName.trim().length > 0;
    const keyField = (which: 'first' | 'last') => {
      const on = nameField === which;
      const value = which === 'first' ? form.firstName : form.lastName;
      return (
        <div className="ck-kfield">
          <span className="ck-lbl">{which === 'first' ? <>First name <span style={{ color: C.bad }}>*</span></> : <>Last name <span style={{ fontWeight: 500, color: C.muted }}>· optional</span></>}</span>
          <button type="button" aria-label={which === 'first' ? 'First name' : 'Last name'} aria-pressed={on}
            className={`ck-namebox${on ? ' on' : ''}`} onClick={() => setNameField(which)}>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
            {on && <span className="ck-caret" aria-hidden />}
            {!value && !on && <span style={{ color: C.faint, fontWeight: 600 }}>Tap to add</span>}
          </button>
        </div>
      );
    };
    return (
      <main className={`ck-page${kbOpen ? ' ck-kb' : ''}`} style={{ ...screen, ...accentVar(accent), padding: 0, display: 'block' }}>
        <style>{baseCss + layoutCss}</style>
        <div className="ck-app">
          {topBar}
          {salonKeys ? (
            <>
              <div className="ck-nametop">
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 360px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                    <h1 style={{ ...titleStyle, fontSize: 'clamp(24px, 4.2vh, 32px)', margin: 0 }}>{title}</h1>
                    <span style={{ fontSize: 'clamp(15px, 2.2vh, 16px)', color: C.ink2 }}>
                      {digits ? 'First visit — this takes 10 seconds.' : 'We’ll call you by this name.'}
                    </span>
                  </div>
                  {digits && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 14px', borderRadius: 999, background: C.card, border: `1px solid ${C.line}`, fontSize: 15, fontWeight: 700 }}>
                      {fmtPhone(digits)}
                      <button type="button" onClick={() => setStep('phone')} style={{ minHeight: 40, padding: '0 14px', borderRadius: 999, border: 0, background: C.soft, color: C.ink, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Change</button>
                    </span>
                  )}
                </div>
                <div className="ck-kfields">
                  {keyField('first')}
                  {!returning && keyField('last')}
                </div>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: C.muted }}><LockIcon /> Saved as you go — if you step away, the front desk keeps your spot.</span>
              </div>
              <SalonKeys
                accent={accent}
                onKey={typeName}
                onDevice={() => setNativeNow(true)}
                goLabel="Next"
                goDisabled={!firstOk}
                onGo={() => { if (firstOk) afterName(); }}
              />
            </>
          ) : (
            <div className="ck-scroll">
              <div className="ck-namenative">
                <h1 style={{ ...titleStyle, fontSize: 'clamp(22px, 4vh, 32px)', margin: 0 }}>{returning ? 'What name should we call?' : 'What’s your name?'}</h1>
                <p className="ck-hide-kb" style={{ margin: 0, fontSize: 16, color: C.ink2 }}>
                  {digits ? <>Mobile <b>{fmtPhone(digits)}</b> · </> : null}Just your name — it takes 10 seconds.
                </p>
                <form className="ck-namerow" onSubmit={(e) => { e.preventDefault(); nameNext(); }}>
                  <label>
                    <span className="ck-lbl">First name <span style={{ color: C.bad }}>*</span></span>
                    <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value.slice(0, NAME_MAX) })} placeholder="e.g. Anna"
                      style={{ ...bigInput, minHeight: 60, fontSize: 22, borderColor: accent }} autoCapitalize="words" autoComplete="off" autoCorrect="off" enterKeyHint={returning ? 'done' : 'next'} autoFocus />
                  </label>
                  {!returning && (
                    <label>
                      <span className="ck-lbl">Last name <span style={{ fontWeight: 500, color: C.muted }}>· optional</span></span>
                      <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value.slice(0, NAME_MAX) })}
                        style={{ ...bigInput, minHeight: 60, fontSize: 20 }} autoCapitalize="words" autoComplete="off" autoCorrect="off" enterKeyHint="done" />
                    </label>
                  )}
                  <button type="submit" disabled={!firstOk} style={{ ...primary(accent), minHeight: 60, borderRadius: 16, flex: '0 0 auto', opacity: firstOk ? 1 : 0.45 }}>Next →</button>
                </form>
                {kiosk && (
                  <button type="button" onClick={() => setNativeNow(false)} className="ck-hide-kb" style={{ ...ghostBtn, alignSelf: 'flex-start', minHeight: 48, padding: '8px 18px', fontSize: 15 }}>Use the big salon keys</button>
                )}
              </div>
            </div>
          )}
        </div>
        {stillSheet}
        {staffSheet}
      </main>
    );
  }

  // ---- Birthday & services -------------------------------------------------------
  const actionBtn = step === 'birthday' ? (
    <button type="button" onClick={() => setStep('services')} style={{ ...primary(accent), flex: '0 1 280px' }}>Continue</button>
  ) : group && who < people.length - 1 ? (
    <button type="button" onClick={() => { setWho(who + 1); setCat(null); }} style={{ ...primary(accent), flex: '1 1 260px', minHeight: 64, fontSize: 19 }}>
      Next: {people[who + 1].name} →
    </button>
  ) : (
    <button type="button" onClick={() => void submit()} disabled={busy} style={{ ...primary(accent), flex: '1 1 260px', minHeight: 64, fontSize: 20, opacity: busy ? 0.6 : 1 }}>
      {busy ? 'Checking you in…' : 'Check in'}
    </button>
  );
  const visitLines = people.flatMap((p, i) => [
    ...p.list.map((s) => ({ k: `${i}-${s.id}`, n: s.name, c: payCents(s), who: p.name, remove: () => { if (i === 0) setPicked((v) => v.filter((x) => x !== s.id)); else setGuests((gs) => gs.map((g, j) => (j === i - 1 ? { ...g, picked: g.picked.filter((x) => x !== s.id) } : g))); } })),
    ...extrasOf(i).map((a) => ({ k: `${i}-x-${a.id}`, n: `+ ${a.name}`, c: a.priceCents, who: p.name, remove: () => setExtras((m) => ({ ...m, [i]: (m[i] ?? []).filter((x) => x !== a.id) })) })),
  ]);

  return (
    <main className={`ck-page${kbOpen ? ' ck-kb' : ''}`} style={{ ...screen, ...accentVar(accent), padding: 0, display: 'block' }}>
      <style>{baseCss + layoutCss}</style>
      <div className="ck-app">
        {topBar}

        {/* ---- Birthday: month, then day — big targets, no year ---- */}
        {step === 'birthday' && (
          <div className="ck-scroll">
            <div className="ck-pad" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <h1 style={{ ...titleStyle, fontSize: 'clamp(24px, 4.2vh, 34px)', margin: 0 }}>When&rsquo;s your birthday, {firstShown}?</h1>
                  <span style={{ fontSize: 'clamp(15px, 2.2vh, 17px)', color: C.ink2 }}>Optional — a little treat comes your way. No year needed.</span>
                </div>
                <button type="button" onClick={() => { setBMonth(null); setBDay(null); setStep('services'); }} style={{ ...ghostBtn, minHeight: 56 }}>Skip</button>
              </div>
              {bMonth === null ? (
                <>
                  <span style={{ fontSize: 17, fontWeight: 700, color: C.ink2 }}>1 · Tap your month</span>
                  <div className="ck-months">
                    {MONTHS.map((m, i) => (
                      <button key={m} type="button" className="ck-big" onClick={() => { setBMonth(i); setBDay(null); }}>{m}</button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 17, fontWeight: 700, color: C.ink2 }}>2 · Tap the day in</span>
                    <b style={{ fontSize: 'clamp(20px, 2.4vw, 26px)', color: accent }}>{MONTHS[bMonth]}</b>
                    <span style={{ flex: 1 }} />
                    <button type="button" onClick={() => { setBMonth(null); setBDay(null); }} style={{ ...ghostBtn, minHeight: 48, padding: '8px 16px' }}>Change month</button>
                  </div>
                  <div className="ck-days">
                    {Array.from({ length: MONTH_DAYS[bMonth] }, (_, i) => i + 1).map((d) => {
                      const on = bDay === d;
                      return (
                        <button key={d} type="button" className="ck-big ck-day" aria-pressed={on} onClick={() => setBDay(d)}
                          style={on ? { background: accent, borderColor: accent, color: '#fff' } : undefined}>{d}</button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ---- Services ---- */}
        {step === 'services' && (
          <div className="ck-svcwrap">
            <div className="ck-scroll ck-svcmain">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                <h1 style={{ ...titleStyle, fontSize: 'clamp(22px, 3.8vh, 30px)', margin: 0, flex: '1 1 280px' }}>
                  {group ? `What would ${who === 0 ? 'you' : current.name} like?` : returning ? `What are we doing today, ${firstShown}?` : `Thanks, ${firstShown}! What would you like?`}
                </h1>
                <div role="group" aria-label="How many of you?" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: C.ink2 }}>Guests</span>
                  <span style={{ display: 'flex', alignItems: 'center', border: `1.5px solid ${C.line}`, borderRadius: 16, background: C.card }}>
                    <button type="button" aria-label="One less guest" disabled={party <= 1} onClick={() => setParty(party - 1)} className="ck-step" style={{ opacity: party <= 1 ? 0.35 : 1 }}>−</button>
                    <b aria-live="polite" style={{ minWidth: 34, textAlign: 'center', fontSize: 20 }}>{party}</b>
                    <button type="button" aria-label="One more guest" disabled={party >= MAX_PARTY} onClick={() => setParty(party + 1)} className="ck-step" style={{ opacity: party >= MAX_PARTY ? 0.35 : 1 }}>+</button>
                  </span>
                </div>
              </div>

              {appt && who === 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 16, border: `2px solid ${accent}`, background: `${accent}0d`, marginBottom: 12 }}>
                  <CalendarIcon color={accent} />
                  <span style={{ fontSize: 16, lineHeight: 1.45, color: C.ink }}>
                    <b>We found your {timeOf(appt.at)} appointment{appt.staffName ? ` with ${appt.staffName}` : ''}.</b>{' '}
                    {appt.serviceIds.length ? 'Your services are already picked — just tap Check in.' : 'Pick your services, then tap Check in.'}
                  </span>
                </div>
              )}
              {!appt && lastVisit && lastList.length > 0 && who === 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 12px 10px 18px', borderRadius: 16, border: `1.5px solid ${C.line}`, background: C.card, marginBottom: 12, flexWrap: 'wrap' }}>
                  <span style={{ flex: '1 1 260px', fontSize: 15.5, color: C.ink2, lineHeight: 1.4 }}>
                    <b style={{ color: C.ink }}>Same as last time?</b> {lastList.map((s) => s.name).join(' + ')}{lastVisit.staffName ? ` with ${lastVisit.staffName}` : ''} · {dateOf(lastVisit.at)}
                  </span>
                  <button type="button" onClick={() => setPicked(lastList.map((s) => s.id))}
                    style={{ minHeight: 48, padding: '0 18px', borderRadius: 12, border: 0, background: lastApplied ? C.ok : C.ink, color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer' }}>
                    {lastApplied ? '✓ Added' : lastList.length > 1 ? 'Add both' : 'Add it'}
                  </button>
                </div>
              )}

              {group && (
                <div style={{ marginBottom: 12 }}>
                  <div role="tablist" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none' }} className="ck-chips">
                    {people.map((p, i) => {
                      const on = i === who;
                      return (
                        <button key={i} type="button" role="tab" aria-selected={on} onClick={() => setWho(i)}
                          style={{
                            flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, cursor: 'pointer',
                            minWidth: 120, padding: '10px 14px', borderRadius: 14, textAlign: 'left',
                            border: `1.5px solid ${on ? accent : C.line}`, background: on ? `${accent}0f` : C.card,
                          }}>
                          <span style={{ fontSize: 15, fontWeight: 700, color: on ? accent : C.ink, whiteSpace: 'nowrap' }}>{i === 0 ? `${p.name} (you)` : p.name}</span>
                          <span style={{ fontSize: 13, color: C.muted, whiteSpace: 'nowrap' }}>
                            {p.list.length ? `${p.list.length} · ${money(subtotal(p.list) + addonCentsOf(i))}` : 'Nothing yet'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {who > 0 && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
                      <label style={{ flex: '1 1 220px' }}>
                        <span className="ck-lbl">Their first name <span style={{ fontWeight: 500, color: C.muted }}>· optional</span></span>
                        {salonKeys ? (
                          <button type="button" onClick={() => setGuestKeys(who)}
                            style={{ ...bigInput, minHeight: 56, textAlign: 'left', cursor: 'pointer', color: guests[who - 1]?.name ? C.ink : C.faint, fontWeight: 600 }}>
                            {guests[who - 1]?.name || `Guest ${who + 1} — tap to type`}
                          </button>
                        ) : (
                          <input
                            value={guests[who - 1]?.name ?? ''}
                            onChange={(e) => setGuests((gs) => gs.map((g, i) => (i === who - 1 ? { ...g, name: e.target.value.slice(0, NAME_MAX) } : g)))}
                            placeholder={`Guest ${who + 1}`} style={{ ...bigInput, minHeight: 56 }} autoCapitalize="words" autoComplete="off"
                          />
                        )}
                      </label>
                      {picked.length > 0 && (
                        <button type="button" onClick={() => setGuests((gs) => gs.map((g, i) => (i === who - 1 ? { ...g, picked: [...picked] } : g)))}
                          style={{ ...ghostBtn, minHeight: 56, padding: '12px 18px', fontSize: 15 }}>
                          Same as {people[0].name}
                        </button>
                      )}
                    </div>
                  )}
                  {party >= MAX_PARTY && <div style={{ fontSize: 14, color: C.muted, marginTop: 8 }}>More than 5? The front desk will add the rest.</div>}
                </div>
              )}

              {(cats.length > 0 || hasSale || hasPopular) && (
                <div style={{ position: 'relative', marginLeft: -16, marginRight: -16, marginBottom: 2 }}>
                  {chips.canLeft && <ChipArrow dir={-1} onClick={() => chips.nudge(-1)} />}
                  <div ref={chips.ref} className="ck-chips" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 12, paddingLeft: 16, paddingRight: 16, scrollbarWidth: 'none' }}>
                    <button onClick={() => setCat(null)} style={{ ...chip, ...(cat === null ? { background: C.ink, borderColor: C.ink, color: '#fff' } : null) }}>All</button>
                    {hasSale && (
                      <button onClick={() => setCat(SALE)} style={{ ...chip, display: 'inline-flex', alignItems: 'center', gap: 6, ...(cat === SALE ? { background: C.ink, borderColor: C.ink, color: '#fff' } : { borderColor: `${accent}66`, color: accent }) }}>
                        <TagIcon color="currentColor" size={16} />On sale
                      </button>
                    )}
                    {hasPopular && (
                      <button onClick={() => setCat(POPULAR)} style={{ ...chip, display: 'inline-flex', alignItems: 'center', gap: 6, ...(cat === POPULAR ? { background: C.ink, borderColor: C.ink, color: '#fff' } : null) }}>
                        <StarIcon size={16} />Popular
                      </button>
                    )}
                    {cats.map((c) => (
                      <button key={c.id} onClick={() => setCat(c.id)} style={{ ...chip, ...(cat === c.id ? { background: C.ink, borderColor: C.ink, color: '#fff' } : null) }}>{c.name}</button>
                    ))}
                  </div>
                  {chips.canRight && <ChipArrow dir={1} onClick={() => chips.nudge(1)} />}
                </div>
              )}
              <div className="ck-svcs">
                {shown.map((s) => {
                  const on = currentPicked.includes(s.id);
                  return (
                    <button key={s.id} type="button" onClick={() => togglePick(s.id)} aria-pressed={on}
                      style={{
                        position: 'relative', textAlign: 'left', borderRadius: 18,
                        padding: '14px 16px', cursor: 'pointer',
                        background: on ? `${accent}0f` : C.card,
                        border: `${on ? 3 : 1.5}px solid ${on ? accent : C.line}`,
                        color: C.ink, minHeight: 104, display: 'flex', flexDirection: 'column', gap: 6,
                      }}>
                      <span style={{
                        position: 'absolute', top: 12, right: 12, width: 28, height: 28, borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: on ? accent : 'transparent', color: '#fff', border: `1.5px solid ${on ? accent : C.line}`,
                      }}>{on && <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>}</span>
                      {offPct(s) > 0 ? (
                        <span style={{ ...badge, background: `${accent}14`, color: accent }}>−{offPct(s)}% for you</span>
                      ) : dealPct(s) > 0 ? (
                        <span style={{ ...badge, background: `${accent}14`, color: accent }}>Today −{dealPct(s)}%</span>
                      ) : s.isFeatured ? (
                        <span style={{ ...badge, background: '#fdf3e0', color: '#8a5a12' }}>★ Popular</span>
                      ) : null}
                      <span style={{ fontSize: 'clamp(16px, 2.4vh, 19px)', fontWeight: 700, lineHeight: 1.3, paddingRight: 30, color: C.ink }}>{s.name}</span>
                      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 'clamp(16px, 2.4vh, 18px)', fontWeight: 800, color: C.price, fontVariantNumeric: 'tabular-nums' }}>{money(payCents(s))}</span>
                        {onSale(s) && <span style={{ fontSize: 14, color: C.muted, textDecoration: 'line-through' }}>{money(s.priceCents)}</span>}
                        {mins(s.durationMinutes) && <span style={{ fontSize: 14.5, color: C.ink2 }}>· {mins(s.durationMinutes)}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
              {viewAddons.length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <div style={{ ...eyebrow, marginBottom: 10 }}>Add-ons</div>
                  <div className="ck-svcs">
                    {viewAddons.map((a) => {
                      const on = viewExtras.includes(a.id);
                      return (
                        <button key={a.id} type="button" onClick={() => toggleExtra(a.id)} aria-pressed={on}
                          style={{
                            position: 'relative', textAlign: 'left', borderRadius: 18,
                            padding: '12px 16px', cursor: 'pointer',
                            background: on ? `${accent}0f` : C.card,
                            border: `${on ? 3 : 1.5}px solid ${on ? accent : C.line}`,
                            color: C.ink, minHeight: 76, display: 'flex', flexDirection: 'column', gap: 4,
                          }}>
                          <span style={{
                            position: 'absolute', top: 12, right: 12, width: 28, height: 28, borderRadius: '50%',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: on ? accent : 'transparent', color: '#fff', border: `1.5px solid ${on ? accent : C.line}`,
                          }}>{on && <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>}</span>
                          <span style={{ fontSize: 'clamp(15px, 2.2vh, 17px)', fontWeight: 700, lineHeight: 1.3, paddingRight: 30, color: C.ink }}>{a.askAtBooking ? `Would you like ${a.name}?` : a.name}</span>
                          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 'clamp(16px, 2.4vh, 17.5px)', fontWeight: 800, color: C.price, fontVariantNumeric: 'tabular-nums' }}>+{money(a.priceCents)}</span>
                            {mins(a.durationMinutes) && <span style={{ fontSize: 14, color: C.ink2 }}>· {mins(a.durationMinutes)}</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {err && <div role="alert" style={{ color: C.bad, fontSize: 16, marginTop: 14 }}>{err}</div>}
            </div>

            {/* Your visit — the right column on a wide screen */}
            <aside className="ck-sum" aria-label="Your visit">
              <span style={{ ...eyebrow, color: C.muted }}>Your visit</span>
              {visitLines.length === 0 ? (
                <span style={{ fontSize: 15, color: C.ink2, lineHeight: 1.45 }}>Your services will show up here as you pick them.</span>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', minHeight: 0 }}>
                  {visitLines.map((l) => (
                    <li key={l.k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <b style={{ fontSize: 16, lineHeight: 1.3 }}>{l.n}</b>
                        {group && <span style={{ fontSize: 13, color: C.muted }}>{l.who}</span>}
                      </span>
                      <b style={{ fontSize: 16, fontVariantNumeric: 'tabular-nums' }}>{money(l.c)}</b>
                      <button type="button" aria-label={`Remove ${l.n}`} onClick={l.remove}
                        style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 10, border: `1px solid ${C.line}`, background: C.card, color: C.ink2, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {visitLines.length > 0 && (
                <>
                  <div style={{ height: 1, background: C.line, flexShrink: 0 }} />
                  <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                    <b style={{ fontSize: 15, color: C.ink2 }}>Total today</b>
                    <b style={{ fontSize: 28, fontVariantNumeric: 'tabular-nums' }}>{money(totalCents)}</b>
                  </span>
                  <span style={{ fontSize: 14, color: C.muted }}>
                    {mins(totalMinutes) ? `About ${mins(totalMinutes)}` : ''}{savedCents > 0 ? `${mins(totalMinutes) ? ' · ' : ''}you save ${money(savedCents)}` : ''}
                  </span>
                </>
              )}
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 14, color: C.ink2, lineHeight: 1.45 }}>Not sure yet? Tap Check in anyway — we&rsquo;ll ask at the chair.</span>
              <div style={{ display: 'flex' }}>{actionBtn}</div>
            </aside>
          </div>
        )}

        {/* Bottom bar: birthday always; services until the right column takes over */}
        <footer className={`ck-foot${step === 'services' ? ' ck-foot-svc' : ''}`}>
          {step === 'birthday' && (
            <span style={{ flex: '1 1 200px', fontSize: 17, fontWeight: 700, color: C.ink }}>
              {bMonth !== null && bDay !== null ? `Birthday: ${MONTHS[bMonth]} ${bDay}` : 'You can skip this'}
            </span>
          )}
          {step === 'services' && (
            <span style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 1, fontSize: 16, color: C.ink2, fontWeight: 600 }}>
              {pickedCount > 0 ? (
                <>
                  <span>
                    {group ? `${party} people · ` : `${pickedCount} ${pickedCount === 1 ? 'service' : 'services'}${mins(totalMinutes) ? ` · ~${mins(totalMinutes)}` : ''} · `}
                    {savedCents > 0 && <span style={{ color: C.muted, textDecoration: 'line-through', fontWeight: 500, marginRight: 6 }}>{money(fullCents)}</span>}
                    <span style={{ color: C.ink, fontWeight: 800 }}>{money(totalCents)}</span>
                  </span>
                  {savedCents > 0 && <span style={{ fontSize: 14, color: C.price, fontWeight: 700 }}>You save {money(savedCents)} today</span>}
                </>
              ) : <span>Not sure yet? That&rsquo;s fine — we&rsquo;ll ask at the chair.</span>}
            </span>
          )}
          {actionBtn}
        </footer>
      </div>

      {/* A guest's name on the salon keys */}
      {guestKeys !== null && (
        <div role="dialog" aria-modal="true" aria-label={`Guest ${guestKeys + 1} first name`} className="ck-sheetwrap" onClick={(e) => { if (e.target === e.currentTarget) setGuestKeys(null); }}>
          <div className="ck-keysheet">
            <div className="ck-nametop" style={{ flex: '0 0 auto' }}>
              <h2 style={{ ...titleStyle, fontSize: 'clamp(22px, 3.6vh, 28px)', margin: 0 }}>Guest {guestKeys + 1}&rsquo;s first name</h2>
              <div className="ck-namebox on" role="textbox" aria-readonly="true" aria-label="Guest first name" aria-live="polite">
                <span>{guests[guestKeys - 1]?.name ?? ''}</span><span className="ck-caret" aria-hidden />
              </div>
            </div>
            <SalonKeys accent={accent} onKey={typeName} goLabel="Done" onGo={() => setGuestKeys(null)} />
          </div>
        </div>
      )}
      {stillSheet}
      {staffSheet}
    </main>
  );
}

/** A QR with a heading, for the welcome screen's side. */
function QrCard({ url, accent, eyebrow: eb, title, note, stars }: { url: string; accent: string; eyebrow: string; title: string; note: string; stars?: boolean }) {
  return (
    <section className="ck-qrcard" aria-label={title}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qrSrc(url, 360)} alt={`QR code: ${title}`} className="ck-qrimg" />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <span style={{ ...eyebrow, color: accent }}>{eb}</span>
        <b style={{ fontSize: 'clamp(18px, 2.8vh, 22px)', lineHeight: 1.2, color: C.ink }}>{title}</b>
        {stars && <span aria-label="5 stars" style={{ color: '#f59e0b', fontSize: 16, letterSpacing: 2 }}>★★★★★</span>}
        <span style={{ fontSize: 14, lineHeight: 1.4, color: C.ink2 }}>{note}</span>
      </span>
    </section>
  );
}

/** The salon's name, with its branch on a second, quieter line. */
function BrandName({ brand, size }: { brand: { name: string; place: string | null }; size: number }) {
  return (
    <span style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, color: '#fff', textAlign: 'left' }}>
      <b style={{ fontSize: size, lineHeight: 1.08, fontWeight: 800, letterSpacing: '-0.015em', textWrap: 'balance' } as CSSProperties}>{brand.name}</b>
      {brand.place && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: Math.max(13, Math.round(size * 0.58)), fontWeight: 600, opacity: 0.9 }}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden>
            <path d="M12 21s-6.5-5.6-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" />
          </svg>
          {brand.place}
        </span>
      )}
    </span>
  );
}

/**
 * The salon's own keyboard for names. Drawn by the page, so the device's
 * keyboard never opens and never covers the form — big keys, A–Z, space,
 * hyphen and apostrophe. "Phone keys" hands over to the device keyboard for a
 * name with accents.
 */
function SalonKeys({ accent, onKey, onGo, goLabel, goDisabled, onDevice }: {
  accent: string; onKey: (k: string) => void; onGo: () => void; goLabel: string; goDisabled?: boolean; onDevice?: () => void;
}) {
  const row = (letters: string) => letters.split('').map((c) => (
    <button key={c} type="button" className="ck-k" onClick={() => onKey(c)} aria-label={c === "'" ? 'Apostrophe' : c === '-' ? 'Hyphen' : c.toUpperCase()}>{c.toUpperCase()}</button>
  ));
  return (
    <div className="ck-keys" role="group" aria-label="Keyboard">
      <div className="ck-krow">{row('qwertyuiop')}</div>
      <div className="ck-krow ck-r2">{row('asdfghjkl')}</div>
      <div className="ck-krow">
        {row("zxcvbnm'-")}
        <button type="button" className="ck-k ck-kw" aria-label="Delete" onClick={() => onKey('del')}>
          <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 5H9l-6 7 6 7h12z" /><path d="m17 9-5 6M12 9l5 6" /></svg>
        </button>
      </div>
      <div className="ck-krow">
        {onDevice && (
          <button type="button" className="ck-k ck-kw ck-kdev" onClick={onDevice}>
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 15h10" /></svg>
            <span>Phone keys</span>
          </button>
        )}
        <button type="button" className="ck-k ck-kspace" aria-label="Space" onClick={() => onKey(' ')}>space</button>
        <button type="button" className="ck-k ck-kgo" onClick={onGo} disabled={goDisabled} style={{ background: accent, opacity: goDisabled ? 0.45 : 1 }}>{goLabel} →</button>
      </div>
    </div>
  );
}

/** "Still there?" — a countdown, then the kiosk keeps (or clears) the guest. */
function StillThere({ seconds, name, canSave, accent, busy, onHere, onSaveNow, onStartOver }: {
  seconds: number; name: string; canSave: boolean; accent: string; busy: boolean;
  onHere: () => void; onSaveNow: () => void; onStartOver: () => void;
}) {
  const r = 58;
  const len = 2 * Math.PI * r;
  const left = Math.max(0, Math.min(1, seconds / STILL_THERE_SEC));
  return (
    <div className="ck-sheetwrap" onClick={onHere} style={{ alignItems: 'center' }}>
      <section role="alertdialog" aria-modal="true" aria-label="Are you still there?" className="ck-still" onClick={(e) => e.stopPropagation()}>
        <svg width={132} height={132} viewBox="0 0 132 132" role="img" aria-label={`${seconds} seconds left`}>
          <circle cx={66} cy={66} r={r} fill="none" stroke={C.soft} strokeWidth={10} />
          <circle cx={66} cy={66} r={r} fill="none" stroke={accent} strokeWidth={10} strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - left)} transform="rotate(-90 66 66)" style={{ transition: 'stroke-dashoffset 1s linear' }} />
          <text x={66} y={80} textAnchor="middle" fontSize={44} fontWeight={800} fill={C.ink} fontFamily="inherit">{seconds}</text>
        </svg>
        <b style={{ fontSize: 'clamp(26px, 4.4vh, 34px)', lineHeight: 1.1 }}>{name ? `Still there, ${name}?` : 'Still there?'}</b>
        <span style={{ fontSize: 'clamp(16px, 2.4vh, 18px)', color: C.ink2, lineHeight: 1.45 }}>
          {canSave
            ? <>No rush. If we don&rsquo;t hear from you, we&rsquo;ll <b style={{ color: C.ink }}>save your spot in line</b> and the front desk will help you pick your services.</>
            : 'No rush. If we don’t hear from you, this screen starts over for the next guest.'}
        </span>
        <button type="button" onClick={onHere} style={{ ...primary(accent), width: '100%', minHeight: 72, fontSize: 22, borderRadius: 20 }}>I&rsquo;m still here</button>
        {canSave ? (
          <button type="button" disabled={busy} onClick={onSaveNow} className="ck-textbtn" style={{ fontSize: 17 }}>{busy ? 'Saving…' : 'Save my spot now'}</button>
        ) : (
          <button type="button" onClick={onStartOver} className="ck-textbtn" style={{ fontSize: 17 }}>Start over</button>
        )}
      </section>
    </div>
  );
}

/** Staff only: hold the salon logo 3 seconds. Settings for THIS tablet. */
function StaffSheet({ prefs, onChange, onClose, confirmUnpair, onUnpair, accent }: {
  prefs: Prefs; onChange: (p: Prefs) => void; onClose: () => void; confirmUnpair: boolean; onUnpair: () => void; accent: string;
}) {
  const row = (label: string, sub: string, on: boolean, flip: () => void) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 0', borderBottom: `1px solid ${C.line}`, cursor: 'pointer' }}>
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <b style={{ fontSize: 18 }}>{label}</b>
        <span style={{ fontSize: 14, color: C.muted, lineHeight: 1.4 }}>{sub}</span>
      </span>
      <input type="checkbox" role="switch" checked={on} onChange={flip} style={{ width: 26, height: 26, accentColor: accent, flexShrink: 0 }} />
    </label>
  );
  return (
    <div className="ck-sheetwrap" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ alignItems: 'center' }}>
      <section role="dialog" aria-modal="true" aria-label="Kiosk settings" className="ck-staff">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <b style={{ flex: 1, fontSize: 24 }}>Kiosk settings <span style={{ fontSize: 15, fontWeight: 600, color: C.muted }}>· this tablet</span></b>
          <button type="button" aria-label="Close" onClick={onClose} className="ck-iconbtn">
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div style={{ overflowY: 'auto', minHeight: 0 }}>
          {row('Full screen', 'Hides the browser bar. The first tap on the welcome screen turns it on.', prefs.fullscreen, () => onChange({ ...prefs, fullscreen: !prefs.fullscreen }))}
          {row('Keep the screen awake', 'The tablet never dims or locks while check-in is open.', prefs.awake, () => onChange({ ...prefs, awake: !prefs.awake }))}
          {row('Device keyboard for names', 'Off: big A–Z salon keys that never cover the form (recommended).', prefs.deviceKeys, () => onChange({ ...prefs, deviceKeys: !prefs.deviceKeys }))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 0', borderBottom: `1px solid ${C.line}`, flexWrap: 'wrap' }}>
            <span style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <b style={{ fontSize: 18 }}>Guest steps away</b>
              <span style={{ fontSize: 14, color: C.muted, lineHeight: 1.4 }}>Quiet time before “Still there?”. Then a guest with a name is saved and put in line.</span>
            </span>
            <span role="group" aria-label="Quiet time" style={{ display: 'flex', border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden' }}>
              {IDLE_CHOICES.map((s) => (
                <button key={s} type="button" aria-pressed={prefs.idleSec === s} onClick={() => onChange({ ...prefs, idleSec: s })}
                  style={{ minWidth: 70, minHeight: 46, border: 0, background: prefs.idleSec === s ? C.ink : C.card, color: prefs.idleSec === s ? '#fff' : C.ink, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
                  {s < 120 ? `${s} s` : '2 min'}
                </button>
              ))}
            </span>
          </div>
          <p style={{ fontSize: 14, color: C.muted, lineHeight: 1.5, margin: '14px 0 0' }}>
            iPad: Share → Add to Home Screen opens check-in with no browser bar; Settings → Accessibility → Guided Access locks the iPad to it.
          </p>
        </div>
        <button type="button" onClick={onUnpair}
          style={{ minHeight: 54, borderRadius: 14, border: `1.5px solid ${confirmUnpair ? C.bad : C.line}`, background: confirmUnpair ? C.bad : C.card, color: confirmUnpair ? '#fff' : C.ink, fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>
          {confirmUnpair ? 'Tap again to disconnect this tablet' : 'Disconnect this tablet'}
        </button>
      </section>
    </div>
  );
}

/** The salon's logo on a white tile, or its initial when it has none. */
function SalonMark({ menu, accent, size }: { menu: Menu; accent: string; size: number }) {
  if (menu.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={menu.logoUrl} alt="" draggable={false} style={{ width: size, height: size, objectFit: 'contain', borderRadius: size * 0.28, background: '#fff', padding: size * 0.08, boxSizing: 'border-box', flexShrink: 0, boxShadow: '0 8px 20px -10px rgba(0,0,0,0.45)' }} />;
  }
  return (
    <span style={{ width: size, height: size, borderRadius: size * 0.28, background: '#fff', color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.46, fontWeight: 800, flexShrink: 0, boxShadow: '0 8px 20px -10px rgba(0,0,0,0.45)' }}>
      {(menu.salonName.trim()[0] || '✦').toUpperCase()}
    </span>
  );
}

/** Today's promotion: on the side panel (white on the accent) or in the page (light). */
function OfferCard({ menu, accent, light }: { menu: Menu; accent: string; light?: boolean }) {
  const p = menu.promo;
  if (!p || p.percent <= 0) return null;
  return (
    <div style={{
      position: 'relative', display: 'flex', flexDirection: 'column', gap: 4, padding: '14px 16px', borderRadius: 18,
      ...(light ? { background: `${accent}0d`, border: `1px solid ${accent}40`, color: C.ink } : { background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.24)', color: '#fff' }),
    }}>
      <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.14em', color: light ? accent : 'rgba(255,255,255,0.9)' }}>TODAY</span>
      <b style={{ fontSize: 17, lineHeight: 1.3 }}>{p.percent}% off {p.scope === 'all' ? 'every service' : p.scope.toLowerCase()}</b>
      <span style={{ fontSize: 14, opacity: 0.92, lineHeight: 1.4 }}>{p.label ? `${p.label} · ` : ''}Applied automatically at the till.</span>
    </div>
  );
}

/** The salon's mark when it has no logo: its initial in its own colour. */
function Monogram({ accent, size, inverted }: { accent: string; size: number; inverted?: boolean }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: inverted ? 'rgba(255,255,255,0.16)' : `${accent}14`, border: `1.5px solid ${inverted ? 'rgba(255,255,255,0.4)' : `${accent}55`}`,
      color: inverted ? '#fff' : accent, fontSize: size * 0.42,
    }}>✦</span>
  );
}

function LockIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

// ---- styles ------------------------------------------------------------------

/** The salon's accent as a CSS variable, so the stylesheet can use it for focus rings. */
const accentVar = (accent: string): CSSProperties => ({ '--ck-accent': accent } as unknown as CSSProperties);

/** One family for the whole page — the app's own Be Vietnam Pro (loaded by the
 *  root layout), hierarchy by size and weight. */
const FONT = 'var(--font-app), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const baseCss = `html,body{background:${C.page};overscroll-behavior:none}
.ck-page input::placeholder{color:#a8a29e}
.ck-page input:focus{outline:none;border-color:var(--ck-accent)!important;box-shadow:0 0 0 4px color-mix(in srgb, var(--ck-accent) 18%, transparent)}
.ck-page button{font-family:inherit}
.ck-page button:focus-visible{outline:3px solid var(--ck-accent);outline-offset:2px}`;
const layoutCss = `
.ck-chips::-webkit-scrollbar{display:none}
.ck-arrow{display:none} @media (hover:hover) and (pointer:fine){.ck-arrow{display:flex}}
.ck-deco1,.ck-deco2{position:absolute;border-radius:50%;pointer-events:none}
.ck-deco1{width:440px;height:440px;right:-200px;top:-160px;background:rgba(255,255,255,0.07)}
.ck-deco2{width:320px;height:320px;left:-160px;bottom:-120px;border:38px solid rgba(255,255,255,0.06);box-sizing:border-box}

/* One screen tall; the middle scrolls, the bars stay. The viewport resizes
   with the device keyboard (layout.tsx), so nothing sits under it. */
.ck-app{height:100dvh;display:flex;flex-direction:column;overflow:hidden}
.ck-row{flex-direction:row}
.ck-col{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
.ck-scroll{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain}
.ck-pad{padding:clamp(16px,3vh,26px) clamp(16px,4vw,40px) 24px}

.ck-bar{flex-shrink:0;height:64px;box-sizing:border-box;padding:0 max(14px,env(safe-area-inset-left)) 0 max(14px,env(safe-area-inset-left));display:flex;align-items:center;gap:12px;background:#fff;border-bottom:1px solid ${C.line}}
.ck-bar-brand{display:flex;align-items:center;gap:10px;min-width:0;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.ck-bar-name{font-size:16px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
.ck-steps{flex:1;display:flex;align-items:center;justify-content:center;gap:10px;list-style:none;margin:0;padding:0;min-width:0}
.ck-steps li{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:${C.muted};white-space:nowrap}
.ck-steps li+li::before{content:"";width:24px;height:2px;background:${C.line};margin-right:2px}
.ck-steps li.on{color:${C.ink};font-weight:800}.ck-steps li.past{color:${C.ink2}}
.ck-dot{width:24px;height:24px;border-radius:50%;border:1.5px solid #b8b1a8;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800}
.ck-steps-sm{display:none;flex:1;text-align:center;font-size:14px;font-weight:700;color:${C.ink2}}
@media (max-width:820px){.ck-steps{display:none}.ck-steps-sm{display:block}.ck-bar-name{max-width:140px}}
@media (max-width:480px){.ck-bar-name{display:none}}
.ck-iconbtn{width:46px;height:46px;flex-shrink:0;border-radius:12px;border:1px solid ${C.line};background:#fff;color:${C.ink};display:flex;align-items:center;justify-content:center;cursor:pointer}
.ck-textbtn{min-height:46px;padding:0 10px;border:0;background:transparent;color:${C.ink2};font-size:15px;font-weight:700;cursor:pointer;white-space:nowrap}

/* Welcome */
.ck-welcome{height:100dvh;display:grid;grid-template-columns:minmax(0,1fr) clamp(320px,33vw,440px)}
.ck-wel-go{position:relative;overflow:hidden;border:0;color:#fff;text-align:left;cursor:pointer;padding:clamp(28px,7vh,56px) clamp(28px,5vw,64px);display:flex;flex-direction:column;gap:clamp(14px,3vh,26px);-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.ck-wel-big{position:relative;font-size:clamp(44px,9vh,76px);line-height:1.02;font-weight:800;letter-spacing:-0.02em}
.ck-wel-cta{position:relative;align-self:flex-start;display:inline-flex;align-items:center;min-height:clamp(60px,9vh,74px);padding:0 34px;border-radius:999px;background:#fff;font-size:clamp(19px,3vh,24px);font-weight:800}
.ck-wel-side{background:#fff;border-left:1px solid ${C.line};padding:clamp(20px,4vh,40px) clamp(20px,2.6vw,34px);display:flex;flex-direction:column;gap:clamp(12px,2.2vh,18px);overflow-y:auto}
.ck-qrcard{display:flex;align-items:center;gap:16px;padding:14px;border-radius:20px;border:1px solid ${C.line};background:#fff}
.ck-qrimg{width:clamp(104px,17vh,138px);height:auto;aspect-ratio:1/1;display:block;flex-shrink:0;border-radius:10px}
@media (max-width:760px),(orientation:portrait) and (max-width:1000px){
  .ck-welcome{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) auto}
  .ck-wel-side{border-left:0;border-top:1px solid ${C.line};display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));align-content:start}
  .ck-wel-spacer{display:none}
  .ck-wel-offer{grid-column:1 / -1}
}

/* Phone step */
.ck-rail{display:none}
.ck-mhead{display:flex;flex-direction:column;gap:12px;padding:calc(12px + env(safe-area-inset-top,0px)) 16px 12px;color:#fff;flex-shrink:0}
.ck-bandqr{display:none;align-items:center;gap:14px;padding:10px;border-radius:16px;background:#fff;text-align:left}
@media (min-width:600px) and (max-width:899px){.ck-bandqr{display:flex}}
.ck-qrrow{position:relative;background:#fff;border-radius:20px;padding:14px;display:flex;gap:14px;align-items:center;box-shadow:0 24px 48px -28px rgba(0,0,0,0.5)}
.ck-phone{display:flex;flex-direction:column;gap:clamp(10px,1.8vh,16px);max-width:700px;margin:0 auto;padding:clamp(16px,3.4vh,30px) clamp(16px,4vw,40px) 20px;box-sizing:border-box}
.ck-display{min-height:clamp(60px,9.5vh,80px);border-radius:20px;border:2.5px solid;background:#fff;display:flex;align-items:center;justify-content:center;font-size:clamp(28px,4.8vh,42px);font-weight:800;letter-spacing:.03em;font-variant-numeric:tabular-nums}
.ck-keypad{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(8px,1.4vh,12px)}
.ck-key{min-height:clamp(56px,10vh,84px);border-radius:18px;border:1.5px solid ${C.line};background:#fff;color:${C.ink};font-size:clamp(26px,4vh,36px);font-weight:700;cursor:pointer;touch-action:manipulation;-webkit-user-select:none;user-select:none;box-shadow:0 1px 0 #ddd6cc}
.ck-key:active{transform:scale(.97);background:#f5f1ec}
.ck-key-del{background:#f0ece6;border:none;display:flex;align-items:center;justify-content:center;box-shadow:none}
.ck-key-go{border:none;color:#fff;font-size:clamp(17px,2.8vh,24px);font-weight:800;padding:0 4px;box-shadow:none}
@media (max-width:420px){.ck-key-go{font-size:16px}}
.ck-key-go:active{background:inherit}
@media (min-width:900px){
  .ck-rail{display:flex;position:relative;overflow:hidden;flex-direction:column;gap:16px;width:clamp(300px,27vw,360px);flex-shrink:0;box-sizing:border-box;padding:28px 24px 22px;color:#fff;overflow-y:auto;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
  .ck-mhead{display:none}
  .ck-promo-m{display:none}
}

/* Name on the salon keys */
.ck-nametop{flex:1;min-height:0;overflow-y:auto;padding:clamp(12px,2.6vh,26px) clamp(16px,4vw,40px);display:flex;flex-direction:column;justify-content:center;gap:clamp(10px,1.8vh,14px)}
.ck-kfields{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:16px}
@media (max-width:700px){.ck-kfields{grid-template-columns:1fr}}
.ck-kfield{display:flex;flex-direction:column;gap:6px;min-width:0}
.ck-namebox{display:flex;align-items:center;width:100%;min-height:clamp(60px,9.5vh,76px);box-sizing:border-box;padding:0 20px;border-radius:16px;border:1.5px solid ${C.line};background:#fff;font-family:inherit;font-size:clamp(24px,4vh,30px);font-weight:800;color:${C.ink};text-align:left;cursor:pointer}
.ck-namebox.on{border:2.5px solid var(--ck-accent);box-shadow:0 0 0 4px color-mix(in srgb, var(--ck-accent) 14%, transparent)}
.ck-caret{width:3px;height:1.05em;background:var(--ck-accent);margin:0 6px 0 3px;flex-shrink:0;animation:ckblink 1.1s steps(1) infinite}
@keyframes ckblink{50%{opacity:0}}
.ck-keys{flex-shrink:0;background:${C.soft};border-top:1px solid ${C.line};padding:10px clamp(8px,1.4vw,16px) max(12px,env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:clamp(6px,1vh,8px)}
.ck-krow{display:flex;justify-content:center;gap:clamp(5px,0.7vw,8px)}
.ck-r2{padding:0 4.5%}
.ck-k{flex:1 1 0;min-width:0;max-width:124px;height:clamp(50px,9.4vh,82px);border-radius:14px;border:1px solid #ddd6cc;background:#fff;color:${C.ink};font-size:clamp(20px,3.4vh,28px);font-weight:700;box-shadow:0 1px 0 #d6cfc5;cursor:pointer;touch-action:manipulation;-webkit-user-select:none;user-select:none;padding:0}
.ck-k:active{background:#e9e4dd;transform:translateY(1px)}
.ck-kw{flex-grow:1.8;max-width:230px;background:#e2ddd5;border:0;box-shadow:none;display:flex;align-items:center;justify-content:center;gap:8px;font-size:clamp(14px,2.2vh,17px)}
.ck-kdev span{white-space:nowrap}
@media (max-width:600px){.ck-kdev span{display:none}}
.ck-kspace{flex-grow:5;max-width:none;color:${C.muted};font-size:16px;font-weight:600}
.ck-kgo{flex-grow:3;max-width:380px;border:0;color:#fff;box-shadow:none;font-size:clamp(18px,2.8vh,22px);font-weight:800}

/* Name on the device keyboard */
.ck-namenative{display:flex;flex-direction:column;gap:12px;padding:clamp(14px,3vh,28px) clamp(16px,4vw,40px);max-width:1100px}
.ck-namerow{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap}
.ck-namerow > label{flex:1 1 240px;min-width:0}
.ck-lbl{display:block;font-size:15px;font-weight:700;color:${C.ink2};margin-bottom:6px}

/* Keyboard up: compact everything that is not the field */
.ck-kb .ck-bar{height:50px}
.ck-kb .ck-hide-kb,.ck-kb .ck-mhead,.ck-kb .ck-rail{display:none!important}
.ck-kb .ck-namenative{padding-top:10px;gap:8px}

/* Birthday */
.ck-months{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
@media (min-width:700px){.ck-months{grid-template-columns:repeat(4,minmax(0,1fr))}}
.ck-days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:clamp(6px,1vw,10px)}
.ck-big{min-height:clamp(60px,10vh,88px);border-radius:16px;border:1.5px solid ${C.line};background:#fff;color:${C.ink};font-size:clamp(17px,3vh,24px);padding:0 4px;font-weight:700;cursor:pointer;touch-action:manipulation;box-shadow:0 1px 0 #ddd6cc}
.ck-big:active{transform:scale(.97)}
.ck-day{min-height:clamp(48px,7vh,64px);font-size:clamp(19px,3vh,25px);padding:0}

/* Services */
.ck-svcwrap{flex:1;min-height:0;display:flex}
.ck-svcmain{padding:clamp(14px,2.4vh,20px) clamp(16px,3vw,28px) 24px}
.ck-svcs{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr));gap:12px}
.ck-step{width:52px;height:52px;border:0;background:transparent;color:${C.ink};font-size:26px;font-weight:700;cursor:pointer}
.ck-sum{display:none}
.ck-foot{flex-shrink:0;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;padding-bottom:max(12px,env(safe-area-inset-bottom));border-top:1px solid ${C.line};background:#fff}
@media (min-width:1100px){
  .ck-sum{display:flex;flex-direction:column;gap:12px;width:clamp(300px,26vw,360px);flex-shrink:0;box-sizing:border-box;background:#fff;border-left:1px solid ${C.line};padding:20px 22px max(20px,env(safe-area-inset-bottom));min-height:0}
  .ck-foot-svc{display:none}
  .ck-foot{padding:14px 40px}
}

/* Sheets */
.ck-sheetwrap{position:fixed;inset:0;z-index:50;background:rgba(28,25,23,.55);display:flex;align-items:flex-end;justify-content:center}
.ck-keysheet{width:100%;max-height:100dvh;background:${C.page};border-radius:24px 24px 0 0;display:flex;flex-direction:column;overflow:hidden}
.ck-still{width:min(620px,calc(100vw - 32px));box-sizing:border-box;background:#fff;border-radius:28px;padding:clamp(24px,5vh,40px) clamp(22px,4vw,44px) clamp(20px,4vh,32px);display:flex;flex-direction:column;align-items:center;gap:clamp(10px,2vh,18px);text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.25)}
.ck-staff{width:min(720px,calc(100vw - 32px));max-height:calc(100dvh - 48px);box-sizing:border-box;background:#fff;border-radius:26px;padding:24px 30px;display:flex;flex-direction:column;gap:12px}

/* Thank you */
.ck-done{min-height:100dvh;box-sizing:border-box;max-width:1000px;margin:0 auto;padding:clamp(24px,5vh,48px) clamp(20px,5vw,64px);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:clamp(12px,2.4vh,20px)}
.ck-tiles{width:100%;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(8px,1.6vw,16px);text-align:left}
.ck-tile{background:#fff;border:1px solid ${C.line};border-radius:22px;padding:clamp(14px,2.6vh,22px) clamp(16px,2vw,24px);display:flex;flex-direction:column;gap:4px;min-width:0}
.ck-review{display:flex;align-items:center;gap:18px;padding:14px 20px;border-radius:22px;background:#fff;border:1px solid ${C.line};max-width:720px}
@media (max-width:520px){.ck-tiles{grid-template-columns:1fr}.ck-tile{flex-direction:row;align-items:baseline;flex-wrap:wrap;gap:10px}}`;

const screen: CSSProperties = {
  minHeight: '100dvh', background: C.page, color: C.ink,
  fontFamily: FONT,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 'clamp(14px, 4vw, 24px)',
  WebkitTapHighlightColor: 'transparent', colorScheme: 'light',
};
const panel: CSSProperties = {
  background: C.card, border: `1px solid ${C.line}`, borderRadius: 22, padding: 28, width: '100%',
  boxShadow: '0 10px 40px rgba(23,20,18,0.07)', overflow: 'hidden', boxSizing: 'border-box',
};
// 16px is the floor: anything smaller makes iOS Safari zoom the page on focus.
const bigInput: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '0 18px', borderRadius: 16,
  border: `1.5px solid ${C.line}`, background: C.field, color: C.ink,
  fontSize: 17, minHeight: 56, fontFamily: 'inherit',
};
const pill: CSSProperties = {
  border: `1.5px solid ${C.line}`, background: C.card, color: C.ink2,
  borderRadius: 999, padding: '14px 22px', fontSize: 17, fontWeight: 600, cursor: 'pointer', minHeight: 54,
};
const badge: CSSProperties = { alignSelf: 'flex-start', borderRadius: 999, padding: '3px 9px', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.02em' };
function TagIcon({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" /><circle cx="7.5" cy="7.5" r="1.5" />
    </svg>
  );
}
function StarIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#e0a526" stroke="#e0a526" strokeWidth={1.5} strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden>
      <path d="m12 2 3 6.6 7.2.8-5.3 5 1.4 7.1L12 18l-6.3 3.5 1.4-7.1-5.3-5 7.2-.8Z" />
    </svg>
  );
}
/** The desktop-only nudge at either end of the chip row. Hidden on a phone,
 *  where the row is swiped and a floating button would sit over the last chip. */
function ChipArrow({ dir, onClick }: { dir: -1 | 1; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ck-arrow" aria-label={dir < 0 ? 'Scroll categories left' : 'Scroll categories right'}
      style={{
        position: 'absolute', top: 2, [dir < 0 ? 'left' : 'right']: 6, zIndex: 2,
        // `display` deliberately NOT set here: the stylesheet decides it.
        width: 40, height: 40, borderRadius: '50%', border: `1.5px solid ${C.line}`, background: C.card, color: C.ink2,
        alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(23,20,18,0.12)',
      }}>
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={dir < 0 ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
      </svg>
    </button>
  );
}

/** A category chip: one line, never squeezed, never wrapped. */
const chip: CSSProperties = {
  ...pill, padding: '9px 16px', minHeight: 44, fontSize: 15, whiteSpace: 'nowrap', flexShrink: 0,
};
const ghostBtn: CSSProperties = {
  border: `1.5px solid ${C.line}`, background: C.card, color: C.ink,
  borderRadius: 999, padding: '14px 26px', fontSize: 16, fontWeight: 700, cursor: 'pointer', minHeight: 54,
};
const primary = (accent: string): CSSProperties => ({
  border: 'none', background: accent, color: '#fff', borderRadius: 999,
  padding: '14px 32px', fontSize: 17, fontWeight: 800, cursor: 'pointer', minHeight: 56, letterSpacing: '0',
  boxShadow: `0 10px 24px ${accent}40`,
});
const titleStyle: CSSProperties = { fontFamily: FONT, fontWeight: 800, color: C.ink, letterSpacing: '-0.02em', lineHeight: 1.15 };
const eyebrow: CSSProperties = { fontSize: 12, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.faint };

const liveChip: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 32, padding: '0 12px', borderRadius: 999, background: 'rgba(255,255,255,0.16)', fontSize: 14, fontWeight: 700 };
const tileLabel: CSSProperties = { fontSize: 13, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.muted };
const tileBig: CSSProperties = { fontSize: 'clamp(24px, 4.4vh, 34px)', lineHeight: 1.1, fontWeight: 800, color: C.ink };
const tileSub: CSSProperties = { fontSize: 15, color: C.ink2 };
function CalendarIcon({ color }: { color: string }) {
  return (
    <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" style={{ flexShrink: 0 }} aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
