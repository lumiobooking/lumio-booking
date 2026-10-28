'use client';

// ---------------------------------------------------------------------------
// Self check-in kiosk — the iPad the customer touches at the door.
//
// Runs beside the front desk, not instead of it: whatever the customer taps
// lands in the same WAITING queue the receptionist types into, so either side
// can do the work and neither blocks the other. Nothing here can assign a tech
// or take money — the desk stays in control of the floor.
//
// Pairs once with the salon's 6-character display code (the same code the
// customer display uses), then talks to the backend with that token only.
//
// PHONE FIRST. The customer types their mobile number on a big keypad and the
// salon answers "have we seen you before?" (POST /display/checkin-lookup):
//   - a returning customer goes straight to the services, greeted by name,
//     with today's booking or "same as last time" one tap away;
//   - a new customer gives a first name, then (optionally) a birthday picked
//     as MONTH then DAY on big buttons — no dd/mm/yyyy field, no year;
//   - no phone at all: "check in with your name".
// Older customers could not work the native date field or the old one-page
// form; every target here is at least 56px and one decision per screen.
//
// LIGHT, ON PURPOSE. This page has its own daylight palette (below), fixed,
// independent of the owner's theme toggle. No `var(--c…)` tokens here.
//
// A PARTY picks per person: each person has their own tab on the services
// step, and each becomes their own ticket on their own technician.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState, CSSProperties } from 'react';
import { apiFetch } from '../../lib/api';
import { useHorizontalScroll } from '../../lib/useHorizontalScroll';

const TOKEN_KEY = 'lumio_checkin_token';
const IDLE_RESET_MS = 90_000; // abandoned half-filled form clears itself

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
type Step = 'phone' | 'about' | 'birthday' | 'services' | 'done';

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
};

export default function CheckInKiosk() {
  const [token, setToken] = useState<string | null>(null);
  // Arrived from the desk's QR on the customer's own phone: no "scan to check
  // in on your phone" offer here — they already are.
  const [viaQr, setViaQr] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [pairInput, setPairInput] = useState('');
  const [pairErr, setPairErr] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('phone');
  const [digits, setDigits] = useState('');
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [looking, setLooking] = useState(false);
  // Walk-in 2.0: "about how long?" from the floor, shown on the thank-you screen.
  const [eta, setEta] = useState<{ min: number; max: number } | null>(null);
  const [seated, setSeated] = useState(false);
  // Massage / spa: forms still to sign for this ticket — signed right here, on the iPad.
  const [formsToken, setFormsToken] = useState<string | null>(null);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '' });
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

  // Restore a previous pairing so the iPad comes back up ready after a reboot.
  // A phone arriving from the salon's QR carries ?c=CODE and pairs itself.
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(TOKEN_KEY); } catch { /* private mode */ }
    const code = new URLSearchParams(window.location.search).get('c');
    if (code) {
      setViaQr(true);
      apiFetch<{ token: string }>('/display/pair', { method: 'POST', body: { pairCode: code.toUpperCase() } })
        .then((r) => setToken(r.token))
        .catch(() => setToken(saved));
      return;
    }
    setToken(saved);
  }, []);

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
    setForm({ firstName: '', lastName: '', email: '' });
    setDigits(''); setLookup(null); setBMonth(null); setBDay(null); setPartySize(1);
    setPicked([]); setGuests([]); setWho(0); setCat(null); setErr(null); setStep('phone');
    setEta(null); setSeated(false); setFormsToken(null); setExtras({});
  }, []);

  // Someone walks away mid-way; the next customer should meet a clean screen.
  useEffect(() => {
    if (step === 'phone' && !digits) return;
    if (step === 'done') return;
    const id = window.setTimeout(reset, IDLE_RESET_MS);
    return () => window.clearTimeout(id);
  }, [step, digits, form, picked, guests, who, bMonth, bDay, reset]);

  const panelQr = menu?.panelQr ?? 'checkin';
  useEffect(() => {
    if (panelQr !== 'both' || step !== 'phone') return;
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
    if (r.returning) {
      setForm((f) => ({ ...f, firstName: r.firstName ?? '' }));
      if (r.appointment?.serviceIds?.length) setPicked(r.appointment.serviceIds);
      setStep(r.firstName ? 'services' : 'about');
    } else {
      setStep('about');
    }
    window.scrollTo({ top: 0 });
  }, [token, digits, looking]);

  useEffect(() => {
    if (step !== 'phone' || !menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Enter') void findMe();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, menu, press, findMe]);

  const current = people[Math.min(who, people.length - 1)] ?? people[0];
  const currentPicked = who === 0 ? picked : (guests[who - 1]?.picked ?? []);
  const pickedList = current.list;
  const togglePick = (id: string) => {
    if (who === 0) { setPicked((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id])); return; }
    setGuests((gs) => gs.map((g, i) => (i === who - 1 ? { ...g, picked: g.picked.includes(id) ? g.picked.filter((x) => x !== id) : [...g.picked, id] } : g)));
  };
  /** The party size buttons also make (or trim) one slot per guest. */
  const setParty = (n: number) => {
    setPartySize(n);
    setGuests((gs) => Array.from({ length: Math.min(n, MAX_PARTY) - 1 }, (_, i) => gs[i] ?? { name: '', picked: [] }));
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

  async function submit() {
    if (!token || busy) return;
    setBusy(true); setErr(null);
    try {
      const res = await apiFetch<{ estimate?: { min: number; max: number } | null; formsToken?: string; seated?: boolean }>(`/display/checkin/${token}`, {
        method: 'POST',
        body: {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim() || undefined,
          phone: digits || undefined,
          email: form.email.trim() || undefined,
          birthDate: bMonth !== null && bDay !== null ? birthIso(bMonth, bDay) : undefined,
          partySize: party,
          serviceIds: picked,
          ...(extrasOf(0).length ? { addonIds: extrasOf(0).map((a) => a.id) } : {}),
          ...(group ? { guests: guests.slice(0, party - 1).map((g, i) => ({ firstName: g.name.trim() || `Guest ${i + 2}`, serviceIds: g.picked, ...(extrasOf(i + 1).length ? { addonIds: extrasOf(i + 1).map((a) => a.id) } : {}) })) } : {}),
        },
      });
      setEta(res?.estimate ?? null);
      setFormsToken(res?.formsToken ?? null);
      setSeated(!!res?.seated);
      setStep('done');
      // Thank-you screen, then ready for the next person: longer when there
      // are forms to sign, or a review code to scan while they wait.
      const showReview = !!lookup?.returning && !!menu?.reviewUrl;
      window.setTimeout(reset, res?.formsToken ? 60000 : showReview ? 25000 : 9000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong. Please ask the front desk.');
    } finally {
      setBusy(false);
    }
  }

  // ---- Pairing ------------------------------------------------------------
  if (!token) {
    return (
      <main style={{ ...screen, ...accentVar(accent) }}>
        <style>{baseCss}</style>
        <div style={{ ...panel, maxWidth: 520, textAlign: 'center', padding: 'clamp(28px, 6vw, 44px)' }}>
          <Monogram accent={accent} size={72} />
          <h1 style={{ ...serifTitle, fontSize: 32, margin: '18px 0 8px' }}>Connect this iPad</h1>
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

  const firstShown = form.firstName.trim() || 'friend';
  const returning = !!lookup?.returning;

  // ---- Thank you ----------------------------------------------------------
  if (step === 'done') {
    const showReview = returning && !!menu.reviewUrl;
    return (
      <main style={{ ...screen, ...accentVar(accent), background: accent, color: '#fff', alignItems: 'stretch', padding: 0 }}>
        <style>{baseCss + layoutCss}</style>
        <div className="ck-done">
          <span style={{ width: 'clamp(72px, 10vh, 96px)', height: 'clamp(72px, 10vh, 96px)', borderRadius: '50%', background: '#fff', color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="50%" height="50%" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
          </span>
          <div style={{ ...eyebrow, color: 'rgba(255,255,255,0.9)', fontSize: 15 }}>You&rsquo;re checked in</div>
          <h1 style={{ ...serifTitle, color: '#fff', fontSize: 'clamp(34px, 6vw, 64px)', lineHeight: 1.05, margin: 0 }}>Thank you, {firstShown}!</h1>
          <p style={{ fontSize: 'clamp(18px, 2.6vw, 24px)', lineHeight: 1.45, margin: 0 }}>
            {seated ? 'Your technician is getting ready for you.' : group ? `Please have a seat — we’ll be with all ${party} of you shortly.` : 'Please have a seat — we’ll be with you shortly.'}
          </p>
          <div className="ck-tiles">
            <div className="ck-tile">
              <span style={tileLabel}>Estimated wait</span>
              <b style={tileBig}>{seated ? 'Now' : eta && eta.max > 0 ? `${eta.min}–${eta.max}` : 'Shortly'}</b>
              {!seated && eta && eta.max > 0 && <span style={tileSub}>minutes</span>}
            </div>
            <div className="ck-tile">
              <span style={tileLabel}>Your visit</span>
              <b style={tileBig}>{pickedCount || '—'}</b>
              <span style={tileSub}>{pickedCount ? (pickedCount === 1 ? 'service' : 'services') : 'we’ll ask at the chair'}</span>
            </div>
            <div className="ck-tile">
              <span style={tileLabel}>We&rsquo;ll call</span>
              <b style={{ ...tileBig, fontSize: 'clamp(22px, 2.6vw, 30px)', lineHeight: 1.2 }}>{group ? people.map((p) => p.name).join(', ') : firstShown}</b>
            </div>
          </div>
          {formsToken && (
            <button onClick={() => { window.location.href = `/sign/${formsToken}?return=${encodeURIComponent('/checkin')}`; }}
              style={{ ...primary('#fff'), color: accent, boxShadow: 'none', alignSelf: 'flex-start' }}>
              Please sign your forms (1 min) · Ký phiếu
            </button>
          )}
          {showReview && (
            <div className="ck-review">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrSrc(menu.reviewUrl as string, 300)} alt="QR code to review us on Google" style={{ width: 'clamp(96px, 13vh, 132px)', height: 'auto', aspectRatio: '1 / 1', flexShrink: 0, display: 'block' }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                <span style={{ ...eyebrow, color: accent }}>While you wait</span>
                <b style={{ fontSize: 'clamp(17px, 2vw, 21px)', lineHeight: 1.25, color: C.ink }}>Loved your last visit? Review us on Google</b>
                <span aria-label="5 stars" style={{ color: '#f59e0b', fontSize: 20, letterSpacing: 2 }}>★★★★★</span>
                <span style={{ fontSize: 14.5, color: C.ink2, lineHeight: 1.45 }}>Point your phone camera at the code — it takes a minute.</span>
              </span>
            </div>
          )}
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <button onClick={reset} style={{ ...primary('#fff'), color: accent, boxShadow: 'none', minWidth: 160 }}>Done</button>
            <span style={{ fontSize: 15, opacity: 0.92 }}>Back to the start in a few seconds</span>
          </div>
        </div>
      </main>
    );
  }

  // ---- The flow ------------------------------------------------------------
  const path = returning ? (lookup?.firstName ? ['Your mobile', 'Services'] : ['Your mobile', 'Your name', 'Services']) : ['Your mobile', 'About you', 'Services'];
  const idx = step === 'phone' ? 0 : step === 'services' ? path.length - 1 : 1;
  const showCheckinQr = !viaQr && !!menu.checkinUrl && (panelQr === 'checkin' || (panelQr === 'both' && qrTurn === 0) || !menu.reviewUrl);
  const qrUrl = showCheckinQr ? menu.checkinUrl : menu.reviewUrl;
  const qrKind: 'checkin' | 'review' = showCheckinQr ? 'checkin' : 'review';
  const lastVisit = lookup?.lastVisit && lookup.lastVisit.serviceIds.length ? lookup.lastVisit : null;
  const lastList = lastVisit ? listOf(lastVisit.serviceIds) : [];
  const lastApplied = lastList.length > 0 && lastList.every((s) => picked.includes(s.id)) && picked.length === lastList.length;
  const appt = lookup?.appointment ?? null;
  const goBack = () => {
    if (step === 'about') { setStep('phone'); return; }
    if (step === 'birthday') { setStep('about'); return; }
    if (step === 'services') {
      if (group && who > 0) { setWho(who - 1); return; }
      setStep(returning ? (lookup?.firstName ? 'phone' : 'about') : digits ? 'birthday' : 'about');
    }
  };
  const aboutNext = () => {
    if (!form.firstName.trim()) return;
    setStep(returning ? 'services' : 'birthday');
    window.scrollTo({ top: 0 });
  };

  return (
    <main className="ck-page" style={{ ...screen, ...accentVar(accent), alignItems: 'stretch', padding: 0, display: 'block' }}>
      <style>{baseCss + layoutCss}</style>
      <div className="ck-shell">
        {/* ---- Side panel (iPad landscape and up) ---- */}
        <aside className="ck-side" style={{ background: accent, color: '#fff' }}>
          <span aria-hidden className="ck-deco1" />
          <span aria-hidden className="ck-deco2" />
          <div className="ck-side-in">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <SalonMark menu={menu} accent={accent} size={58} />
              <div style={{ minWidth: 0 }}>
                <div style={{ ...eyebrow, color: 'rgba(255,255,255,0.85)' }}>Welcome to</div>
                <div style={{ ...serifTitle, color: '#fff', fontSize: 'clamp(20px, 1.9vw, 26px)', lineHeight: 1.15 }}>{menu.salonName}</div>
              </div>
            </div>
            {menu.rating && menu.rating.count > 0 && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={liveChip}><span style={{ color: '#fcd34d' }}>★</span> {menu.rating.value.toFixed(1)} · {menu.rating.count} reviews</span>
              </div>
            )}

            {step === 'phone' ? (
              <>
                {qrUrl && (
                  <div className="ck-qrcard">
                    <span style={{ ...eyebrow, color: accent }}>{qrKind === 'checkin' ? 'Skip the line' : 'Love your nails?'}</span>
                    <b style={{ fontSize: 'clamp(18px, 1.7vw, 22px)', lineHeight: 1.2, color: C.ink }}>{qrKind === 'checkin' ? 'Check in on your phone' : 'Review us on Google'}</b>
                    {qrKind === 'review' && <span aria-label="5 stars" style={{ color: '#f59e0b', fontSize: 18, letterSpacing: 2 }}>★★★★★</span>}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrSrc(qrUrl, 360)} alt={qrKind === 'checkin' ? 'QR code to check in on your phone' : 'QR code to review us on Google'}
                      style={{ width: 'clamp(120px, 17vh, 180px)', height: 'auto', aspectRatio: '1 / 1', display: 'block', borderRadius: 12, border: `1.5px solid ${C.line}`, padding: 6, background: '#fff' }} />
                    <span style={{ fontSize: 14, lineHeight: 1.45, color: C.ink2 }}>
                      {qrKind === 'checkin' ? 'Someone at the iPad? Point your camera here and check in from your seat.' : 'Point your camera here — it takes a minute and means the world to us.'}
                    </span>
                    {panelQr === 'both' && menu.reviewUrl && !viaQr && (
                      <span style={{ display: 'flex', gap: 6 }} aria-hidden>
                        <span style={{ width: qrTurn === 0 ? 22 : 6, height: 6, borderRadius: 6, background: qrTurn === 0 ? accent : C.line }} />
                        <span style={{ width: qrTurn === 1 ? 22 : 6, height: 6, borderRadius: 6, background: qrTurn === 1 ? accent : C.line }} />
                      </span>
                    )}
                  </div>
                )}
                {menu.promo && menu.promo.percent > 0 && <OfferCard menu={menu} accent={accent} />}
              </>
            ) : (
              <>
                <div style={{ ...serifTitle, color: '#fff', fontSize: 'clamp(22px, 2vw, 28px)' }}>
                  {form.firstName.trim() ? (returning ? `Hi ${form.firstName.trim()}, welcome back!` : `Hi ${form.firstName.trim()}!`) : 'Almost there'}
                </div>
                <ol className="ck-stepbox">
                  {path.map((name, i) => (
                    <li key={name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{
                        width: 34, height: 34, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800,
                        ...(i <= idx ? { background: '#fff', color: accent } : { border: '2px solid rgba(255,255,255,0.6)', color: '#fff' }),
                      }}>{i < idx ? '✓' : i + 1}</span>
                      <span style={{ fontSize: 17, fontWeight: i === idx ? 800 : 600, opacity: i <= idx ? 1 : 0.8 }}>{name}</span>
                    </li>
                  ))}
                </ol>
                <div className="ck-visit">
                  <span style={{ ...eyebrow, color: accent }}>Your visit</span>
                  {pickedCount === 0 ? (
                    <span style={{ fontSize: 15, color: C.ink2, lineHeight: 1.45 }}>Your services will show up here as you pick them.</span>
                  ) : (
                    <>
                      {people.map((p, i) => [...p.list.map((s) => ({ k: `${i}-${s.id}`, n: s.name, c: payCents(s) })), ...extrasOf(i).map((a) => ({ k: `${i}-x-${a.id}`, n: `+ ${a.name}`, c: a.priceCents }))]
                        .map((l) => (
                          <span key={l.k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 15.5, color: C.ink }}>
                            <span style={{ minWidth: 0 }}>{group ? `${p.name}: ` : ''}{l.n}</span><b style={{ fontVariantNumeric: 'tabular-nums' }}>{money(l.c)}</b>
                          </span>
                        )))}
                      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 10, paddingTop: 8, borderTop: `1px dashed ${C.line}`, fontSize: 15, color: C.ink2 }}>
                        <span>{mins(totalMinutes) ? `~${mins(totalMinutes)}` : 'Estimate'}</span><b style={{ color: C.ink, fontVariantNumeric: 'tabular-nums' }}>{money(totalCents)}</b>
                      </span>
                    </>
                  )}
                </div>
              </>
            )}
            <div style={{ marginTop: 'auto', fontSize: 13.5, color: 'rgba(255,255,255,0.85)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <LockIcon /> Your details are seen only by the salon.
            </div>
          </div>
        </aside>

        <section className="ck-main">
          {/* ---- Band (iPad portrait and phones) ---- */}
          <header className="ck-top" style={{ background: accent, color: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <SalonMark menu={menu} accent={accent} size={44} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ ...serifTitle, color: '#fff', fontSize: 19, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{menu.salonName}</div>
                <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.85)' }}>Step {idx + 1} of {path.length} · {path[idx]}</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${path.length}, minmax(0, 1fr))`, gap: 6 }}>
              {path.map((n, i) => <span key={n} style={{ height: 5, borderRadius: 5, background: i <= idx ? '#fff' : 'rgba(255,255,255,0.35)' }} />)}
            </div>
            {step === 'phone' && qrUrl && (
              <div className="ck-bandqr">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrSrc(qrUrl, 240)} alt={qrKind === 'checkin' ? 'QR code to check in on your phone' : 'QR code to review us on Google'} style={{ width: 92, height: 92, flexShrink: 0, display: 'block' }} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                  <span style={{ ...eyebrow, color: accent }}>{qrKind === 'checkin' ? 'Skip the line' : 'Love your nails?'}</span>
                  <b style={{ fontSize: 18, color: C.ink }}>{qrKind === 'checkin' ? 'Check in on your phone' : 'Review us on Google'}</b>
                  <span style={{ fontSize: 14, color: C.ink2 }}>Open your camera and point it at the code.</span>
                </span>
              </div>
            )}
          </header>

          <div className="ck-body">
            {step !== 'phone' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <button type="button" onClick={goBack} style={{ ...ghostBtn, minHeight: 50, padding: '10px 18px' }}>← Back</button>
                <span style={{ flex: 1 }} />
                <span className="ck-eyebrow" style={eyebrow}>Step {idx + 1} of {path.length}</span>
              </div>
            )}

            {/* ---- Phone ---- */}
            {step === 'phone' && (
              <div className="ck-phone">
                <h1 style={{ ...serifTitle, fontSize: 'clamp(26px, 3.4vw, 38px)', margin: 0 }}>What&rsquo;s your mobile number?</h1>
                <p style={{ ...stepHint, margin: 0, fontSize: 'clamp(16px, 1.8vw, 19px)' }}>Been here before? That&rsquo;s all we need — we&rsquo;ll remember the rest.</p>
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
                <button type="button" onClick={() => { setDigits(''); setLookup(null); setStep('about'); }}
                  style={{ alignSelf: 'center', minHeight: 48, border: 'none', background: 'transparent', color: C.ink2, fontSize: 17, fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 4, cursor: 'pointer' }}>
                  No mobile number? Check in with your name
                </button>
                {menu.promo && menu.promo.percent > 0 && <div className="ck-promo-m"><OfferCard menu={menu} accent={accent} light /></div>}
              </div>
            )}

            {/* ---- About you (new customers; a returning one we know no name for) ---- */}
            {step === 'about' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 760 }}>
                <h1 style={{ ...serifTitle, fontSize: 'clamp(26px, 3.4vw, 38px)', margin: 0 }}>{returning ? 'Welcome back!' : 'Nice to meet you!'}</h1>
                <p style={{ ...stepHint, margin: 0, fontSize: 'clamp(16px, 1.8vw, 19px)' }}>
                  {returning ? 'What name should we call?' : digits ? 'Looks like your first visit. Just your name — it takes 10 seconds.' : 'Just your name, and we’ll call you when it’s your turn.'}
                </p>
                <div className="ck-grid">
                  <Field label="First name" required>
                    <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} placeholder="e.g. Anna" style={{ ...bigInput, minHeight: 66, fontSize: 22, borderColor: accent }} autoCapitalize="words" autoComplete="given-name" enterKeyHint="next" autoFocus
                      onKeyDown={(e) => { if (e.key === 'Enter') aboutNext(); }} />
                  </Field>
                  {!returning && (
                    <Field label="Last name" hint="optional">
                      <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} style={{ ...bigInput, minHeight: 66, fontSize: 22 }} autoCapitalize="words" autoComplete="family-name" enterKeyHint="next" />
                    </Field>
                  )}
                  {!returning && (
                    <Field label="Email" hint="optional · for your receipt">
                      <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="anna@email.com" style={{ ...bigInput, minHeight: 66, fontSize: 20 }} inputMode="email" type="email" autoComplete="email" autoCapitalize="off" autoCorrect="off" enterKeyHint="done" />
                    </Field>
                  )}
                </div>
                {digits && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderRadius: 18, background: C.card, border: `1px solid ${C.line}`, fontSize: 18 }}>
                    <span style={{ flex: 1 }}>Mobile <b>{fmtPhone(digits)}</b></span>
                    <button type="button" onClick={() => setStep('phone')} style={{ minHeight: 44, padding: '0 12px', border: 'none', background: 'transparent', color: accent, fontSize: 17, fontWeight: 800, cursor: 'pointer' }}>Change</button>
                  </div>
                )}
              </div>
            )}

            {/* ---- Birthday: month, then day — big targets, no year ---- */}
            {step === 'birthday' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <h1 style={{ ...serifTitle, fontSize: 'clamp(26px, 3.4vw, 38px)', margin: 0 }}>When&rsquo;s your birthday?</h1>
                <p style={{ ...stepHint, margin: 0, fontSize: 'clamp(16px, 1.8vw, 19px)' }}>Optional — we&rsquo;ll send you a birthday treat. No year needed.</p>
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
            )}

            {/* ---- Services ---- */}
            {step === 'services' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                  <h1 style={{ ...serifTitle, fontSize: 'clamp(24px, 3vw, 34px)', margin: 0, flex: '1 1 280px' }}>
                    {group ? `What would ${who === 0 ? 'you' : current.name} like?` : returning ? `Welcome back, ${firstShown}!` : `Thanks, ${firstShown}! What would you like?`}
                  </h1>
                  <div role="group" aria-label="How many of you?" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: C.ink2, marginRight: 4 }}>Guests</span>
                    {[1, 2, 3, 4, 5].map((n) => {
                      const on = party === n;
                      return (
                        <button key={n} type="button" onClick={() => setParty(n)} aria-pressed={on}
                          style={{ minWidth: 48, minHeight: 48, borderRadius: 14, cursor: 'pointer', fontSize: 17, fontWeight: 800, border: `1.5px solid ${on ? accent : C.line}`, background: on ? accent : C.card, color: on ? '#fff' : C.ink }}>
                          {n}{n === 5 ? '+' : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {appt && who === 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 18, border: `2px solid ${accent}`, background: `${accent}0d`, marginBottom: 14 }}>
                    <CalendarIcon color={accent} />
                    <span style={{ fontSize: 16.5, lineHeight: 1.45, color: C.ink }}>
                      <b>We found your {timeOf(appt.at)} appointment{appt.staffName ? ` with ${appt.staffName}` : ''}.</b>{' '}
                      {appt.serviceIds.length ? 'Your services are already picked — just tap Check in.' : 'Pick your services, then tap Check in.'}
                    </span>
                  </div>
                )}
                {!appt && lastVisit && lastList.length > 0 && who === 0 && (
                  <button type="button" onClick={() => { setPicked(lastList.map((s) => s.id)); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', padding: '14px 16px', borderRadius: 18, border: `2px solid ${accent}`, background: `${accent}0d`, cursor: 'pointer', marginBottom: 14, flexWrap: 'wrap', color: C.ink }}>
                    <span style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <b style={{ fontSize: 18 }}>Same as last time?</b>
                      <span style={{ fontSize: 15, color: C.ink2 }}>{lastList.map((s) => s.name).join(' + ')}{lastVisit.staffName ? ` · with ${lastVisit.staffName}` : ''} · {dateOf(lastVisit.at)}</span>
                    </span>
                    <span style={{ minHeight: 48, padding: '0 20px', borderRadius: 999, background: lastApplied ? C.ok : accent, color: '#fff', display: 'flex', alignItems: 'center', fontSize: 16, fontWeight: 800 }}>
                      {lastApplied ? '✓ Added' : 'Choose this'}
                    </span>
                  </button>
                )}

                {group && (
                  <div style={{ marginBottom: 16 }}>
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
                          <span style={{ display: 'block', fontSize: 14, color: C.ink2, marginBottom: 6, fontWeight: 600 }}>
                            Their first name <span style={{ fontWeight: 500, color: C.muted }}>· optional</span>
                          </span>
                          <input
                            value={guests[who - 1]?.name ?? ''}
                            onChange={(e) => setGuests((gs) => gs.map((g, i) => (i === who - 1 ? { ...g, name: e.target.value } : g)))}
                            placeholder={`Guest ${who + 1}`} style={{ ...bigInput, minHeight: 56 }} autoCapitalize="words" autoComplete="off"
                          />
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
                  <div style={{ position: 'relative', marginLeft: -16, marginRight: -16, marginBottom: 4 }}>
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
                          position: 'relative', textAlign: 'left', borderRadius: 20,
                          padding: 'clamp(14px, 3.4vw, 18px) clamp(14px, 3.6vw, 20px)', cursor: 'pointer',
                          background: on ? `${accent}0f` : C.card,
                          border: `${on ? 3 : 1.5}px solid ${on ? accent : C.line}`,
                          color: C.ink, minHeight: 108, display: 'flex', flexDirection: 'column', gap: 6,
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
                        <span style={{ fontSize: 'clamp(16px, 1.9vw, 19px)', fontWeight: 700, lineHeight: 1.3, paddingRight: 30, color: C.ink }}>{s.name}</span>
                        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 'clamp(16px, 1.9vw, 18px)', fontWeight: 800, color: C.price, fontVariantNumeric: 'tabular-nums' }}>{money(payCents(s))}</span>
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
                              position: 'relative', textAlign: 'left', borderRadius: 20,
                              padding: 'clamp(12px, 3vw, 16px) clamp(14px, 3.6vw, 20px)', cursor: 'pointer',
                              background: on ? `${accent}0f` : C.card,
                              border: `${on ? 3 : 1.5}px solid ${on ? accent : C.line}`,
                              color: C.ink, minHeight: 76, display: 'flex', flexDirection: 'column', gap: 4,
                            }}>
                            <span style={{
                              position: 'absolute', top: 12, right: 12, width: 28, height: 28, borderRadius: '50%',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: on ? accent : 'transparent', color: '#fff', border: `1.5px solid ${on ? accent : C.line}`,
                            }}>{on && <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>}</span>
                            <span style={{ fontSize: 'clamp(15px, 1.8vw, 17px)', fontWeight: 700, lineHeight: 1.3, paddingRight: 30, color: C.ink }}>{a.askAtBooking ? `Would you like ${a.name}?` : a.name}</span>
                            <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 'clamp(16px, 1.9vw, 17.5px)', fontWeight: 800, color: C.price, fontVariantNumeric: 'tabular-nums' }}>+{money(a.priceCents)}</span>
                              {mins(a.durationMinutes) && <span style={{ fontSize: 14, color: C.ink2 }}>· {mins(a.durationMinutes)}</span>}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {err && <div role="alert" style={{ color: C.bad, fontSize: 16, marginTop: 14 }}>{err}</div>}
              </>
            )}
          </div>

          {/* Sticky action bar: thumbs live at the bottom of a tablet */}
          {step !== 'phone' && (
            <footer className="ck-foot">
              {step === 'about' && <span style={{ flex: '1 1 200px', fontSize: 16, color: C.ink2 }}>{returning ? 'Next: your services' : digits ? 'Next: your birthday (optional)' : 'Next: your services'}</span>}
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
              {step === 'birthday' && (
                <button type="button" onClick={() => { setBMonth(null); setBDay(null); setStep('services'); window.scrollTo({ top: 0 }); }} style={ghostBtn}>Skip</button>
              )}
              {step === 'about' && (
                <button type="button" onClick={aboutNext} disabled={!form.firstName.trim()} style={{ ...primary(accent), flex: '0 1 280px', opacity: form.firstName.trim() ? 1 : 0.45 }}>Continue</button>
              )}
              {step === 'birthday' && (
                <button type="button" onClick={() => { setStep('services'); window.scrollTo({ top: 0 }); }} style={{ ...primary(accent), flex: '0 1 280px' }}>Continue</button>
              )}
              {step === 'services' && (group && who < people.length - 1 ? (
                <button type="button" onClick={() => { setWho(who + 1); setCat(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }} style={{ ...primary(accent), flex: '0 1 300px' }}>
                  Next: {people[who + 1].name} →
                </button>
              ) : (
                <button type="button" onClick={submit} disabled={busy} style={{ ...primary(accent), flex: '0 1 300px', opacity: busy ? 0.6 : 1 }}>
                  {busy ? 'Checking you in…' : 'Check in'}
                </button>
              ))}
            </footer>
          )}
        </section>
      </div>
    </main>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 16, color: C.ink2, marginBottom: 8, fontWeight: 700 }}>
        {label}
        {required && <span style={{ color: C.bad }}>*</span>}
        {hint && <span style={{ fontWeight: 500, color: C.muted, fontSize: 14.5 }}>· {hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** The salon's logo on a white tile, or its initial when it has none. */
function SalonMark({ menu, accent, size }: { menu: Menu; accent: string; size: number }) {
  if (menu.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={menu.logoUrl} alt="" style={{ width: size, height: size, objectFit: 'contain', borderRadius: size * 0.26, background: '#fff', padding: size * 0.08, boxSizing: 'border-box', flexShrink: 0 }} />;
  }
  return (
    <span style={{ width: size, height: size, borderRadius: size * 0.26, background: '#fff', color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.46, fontWeight: 800, flexShrink: 0 }}>
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
      display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18,
      ...(light ? { background: `${accent}0d`, border: `1px solid ${accent}40`, color: C.ink } : { background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.24)', color: '#fff' }),
    }}>
      <span style={{ flexShrink: 0, padding: '6px 10px', borderRadius: 10, background: light ? accent : '#fff', color: light ? '#fff' : accent, fontSize: 12, fontWeight: 800, letterSpacing: '0.1em' }}>TODAY</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <b style={{ fontSize: 16, lineHeight: 1.3 }}>{p.percent}% off {p.scope === 'all' ? 'every service' : p.scope.toLowerCase()}{p.label ? ` · ${p.label}` : ''}</b>
        <span style={{ fontSize: 13.5, opacity: 0.92 }}>Applied automatically when you check in.</span>
      </span>
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
 *  root layout), hierarchy by size and weight. The serif display face looked
 *  like a wedding menu next to a sans form and a sans price list. */
const FONT = 'var(--font-app), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const baseCss = `html,body{background:${C.page}}
.ck-page input::placeholder{color:#a8a29e}
.ck-page input:focus{outline:none;border-color:var(--ck-accent)!important;box-shadow:0 0 0 4px color-mix(in srgb, var(--ck-accent) 18%, transparent)}
.ck-page input[type=date]{-webkit-appearance:none;min-height:60px}
.ck-page button{font-family:inherit}`;
const layoutCss = `
.ck-chips::-webkit-scrollbar{display:none}
.ck-arrow{display:none} @media (hover:hover) and (pointer:fine){.ck-arrow{display:flex}}
.ck-shell{display:flex;min-height:100dvh;width:100%}
.ck-side{display:none}
.ck-deco1,.ck-deco2{position:absolute;border-radius:50%;pointer-events:none}
.ck-deco1{width:440px;height:440px;right:-200px;top:-160px;background:rgba(255,255,255,0.07)}
.ck-deco2{width:320px;height:320px;left:-160px;bottom:-120px;border:38px solid rgba(255,255,255,0.06);box-sizing:border-box}
.ck-side-in{position:relative;height:100%;box-sizing:border-box;padding:32px 30px 24px;display:flex;flex-direction:column;gap:18px;overflow-y:auto}
.ck-qrcard{background:#fff;border-radius:24px;padding:20px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;box-shadow:0 24px 48px -28px rgba(0,0,0,0.5)}
.ck-stepbox{list-style:none;margin:0;padding:16px;border-radius:18px;background:rgba(0,0,0,0.12);display:flex;flex-direction:column;gap:12px}
.ck-visit{background:#fff;border-radius:20px;padding:16px 18px;display:flex;flex-direction:column;gap:8px;box-shadow:0 24px 48px -28px rgba(0,0,0,0.5)}
.ck-main{flex:1;min-width:0;display:flex;flex-direction:column;min-height:100dvh}
.ck-top{display:flex;flex-direction:column;gap:12px;padding:calc(14px + env(safe-area-inset-top,0px)) 16px 14px;position:sticky;top:0;z-index:5}
.ck-bandqr{display:none;align-items:center;gap:16px;padding:12px;border-radius:18px;background:#fff;text-align:left}
@media (min-width:600px) and (max-width:899px){.ck-bandqr{display:flex}}
.ck-body{flex:1;padding:clamp(18px,4vw,28px) clamp(16px,4vw,40px) 24px;width:100%;box-sizing:border-box}
.ck-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:16px 18px}
.ck-phone{display:flex;flex-direction:column;gap:clamp(12px,2vh,18px);max-width:620px;margin:0 auto}
.ck-display{min-height:clamp(64px,9vh,88px);border-radius:20px;border:2.5px solid;background:#fff;display:flex;align-items:center;justify-content:center;font-size:clamp(30px,4.2vh,44px);font-weight:700;letter-spacing:.04em;font-variant-numeric:tabular-nums}
.ck-keypad{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(8px,1.4vh,14px)}
.ck-key{min-height:clamp(60px,9vh,88px);border-radius:18px;border:1.5px solid ${C.line};background:#fff;color:${C.ink};font-size:clamp(26px,3.6vh,38px);font-weight:700;cursor:pointer;touch-action:manipulation;-webkit-user-select:none;user-select:none}
.ck-key:active{transform:scale(.97);background:#f5f1ec}
.ck-key-del{background:#f0ece6;border:none;display:flex;align-items:center;justify-content:center}
.ck-key-go{border:none;color:#fff;font-size:clamp(16px,2.4vh,24px);font-weight:800;padding:0 4px}
@media (max-width:420px){.ck-key-go{font-size:16px}}
.ck-key-go:active{background:inherit}
.ck-months{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
@media (min-width:700px){.ck-months{grid-template-columns:repeat(4,minmax(0,1fr))}}
.ck-days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:clamp(6px,1vw,10px)}
.ck-big{min-height:clamp(60px,8vh,80px);border-radius:16px;border:1.5px solid ${C.line};background:#fff;color:${C.ink};font-size:clamp(16px,2.2vw,23px);padding:0 4px;font-weight:700;cursor:pointer;touch-action:manipulation}
.ck-big:active{transform:scale(.97)}
.ck-day{min-height:clamp(50px,7vh,66px);font-size:clamp(19px,2.4vw,25px);padding:0}
.ck-svcs{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr));gap:clamp(10px,2.5vw,14px)}
.ck-foot{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 16px;padding-bottom:max(14px,env(safe-area-inset-bottom));border-top:1px solid ${C.line};background:rgba(255,255,255,0.96);position:sticky;bottom:0;z-index:5}
.ck-done{min-height:100dvh;box-sizing:border-box;max-width:1100px;margin:0 auto;padding:clamp(28px,6vh,64px) clamp(20px,5vw,64px) clamp(20px,4vh,40px);display:flex;flex-direction:column;gap:clamp(12px,2vh,20px)}
.ck-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(8px,1.6vw,16px)}
.ck-tile{background:rgba(255,255,255,0.16);border-radius:22px;padding:clamp(14px,2vw,22px);display:flex;flex-direction:column;gap:4px;min-width:0}
.ck-review{display:flex;align-items:center;gap:18px;padding:16px 20px;border-radius:24px;background:#fff;max-width:720px}
@media (max-width:520px){.ck-tiles{grid-template-columns:1fr}.ck-tile{flex-direction:row;align-items:baseline;flex-wrap:wrap;gap:10px}}
@media (min-width:900px){
  .ck-side{display:block;position:sticky;top:0;height:100dvh;width:clamp(340px,32vw,460px);flex-shrink:0;overflow:hidden}
  .ck-top{display:none}
  .ck-body{padding:36px 48px 28px}
  .ck-foot{padding:16px 48px}
  .ck-promo-m{display:none}
}
@media (max-width:899px){ .ck-eyebrow{display:none} }`;

// No fixed height: on a phone the on-screen keyboard shrinks the viewport, and a
// locked 100dvh traps the focused field behind it. Let the page flow and keep the
// action bar sticky instead — that behaves on iOS, Android and a 27" monitor.
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
        // `display` deliberately NOT set here: the stylesheet decides it, so
        // an inline value cannot out-rank the hover-capable media query
        // that hides these on a phone.
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
  ...pill, padding: '9px 16px', minHeight: 42, fontSize: 14.5, whiteSpace: 'nowrap', flexShrink: 0,
};
const ghostBtn: CSSProperties = {
  border: `1.5px solid ${C.line}`, background: C.card, color: C.ink,
  borderRadius: 999, padding: '14px 26px', fontSize: 16, fontWeight: 600, cursor: 'pointer', minHeight: 54,
};
const primary = (accent: string): CSSProperties => ({
  border: 'none', background: accent, color: '#fff', borderRadius: 999,
  padding: '14px 32px', fontSize: 17, fontWeight: 700, cursor: 'pointer', minHeight: 56, letterSpacing: '0',
  boxShadow: `0 10px 24px ${accent}40`,
});
const serifTitle: CSSProperties = { fontFamily: FONT, fontWeight: 700, color: C.ink, letterSpacing: '-0.02em', lineHeight: 1.2 };
const eyebrow: CSSProperties = { fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: C.faint };
const stepHint: CSSProperties = { fontSize: 'clamp(14.5px, 3.6vw, 16px)', color: C.muted, margin: '0 0 20px', lineHeight: 1.5 };

const liveChip: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 32, padding: '0 12px', borderRadius: 999, background: 'rgba(255,255,255,0.16)', fontSize: 14, fontWeight: 700 };
const tileLabel: CSSProperties = { fontSize: 13, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' };
const tileBig: CSSProperties = { fontSize: 'clamp(30px, 4vw, 48px)', lineHeight: 1.05, fontWeight: 800, overflowWrap: 'anywhere' };
const tileSub: CSSProperties = { fontSize: 16 };
function CalendarIcon({ color }: { color: string }) {
  return (
    <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" style={{ flexShrink: 0 }} aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
