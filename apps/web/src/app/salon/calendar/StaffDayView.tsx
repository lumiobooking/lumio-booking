'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SourceChip, SourceDot } from '../../../components/SourceChip';
import { srcMetaOf } from '../../../lib/booking-sources';
import { useAuth } from '../../../lib/auth';
import { withHoursOverride } from '../../../lib/desk-hours';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { uiLocale, wallToInstantISO } from '../../../lib/datetime';
import { ind } from '../../../lib/ui-industry';
import { statusTag } from '../../../lib/cal-day';
import { HOUR_PX, cardTier, fmtPhone, timeRange, useCardColor } from '../../../lib/cal-card';
import { CardBody, CardColorSwitch, cardLook, cardPad, WIDE_CARD_PX, type CardFace } from './CalCard';
import { arrange, moveTo as moveId, type StaffLayout } from '../../../lib/staff-order';
import { StaffOrderSheet } from './StaffOrderSheet';

interface Addon { id: string; name: string; priceCents: number; kind?: string }
interface Booking {
  id: string;
  status: string;
  startTime: string;
  endTime: string;
  priceCents: number;
  currency: string;
  notes: string | null;
  source?: string | null;
  partySize?: number;
  addons?: Addon[];
  payments?: { status: string; amountCents: number }[];
  customer: { id: string; firstName: string; lastName: string | null; email: string | null; phone: string | null } | null;
  service: { id: string; name: string; durationMinutes: number } | null;
  assignedStaff: { id: string; firstName: string; lastName: string | null } | null;
}
interface StaffLite {
  id: string;
  firstName: string;
  lastName: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  takesAppointments?: boolean;
  workingHours?: { dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }[];
}

// Phone palette (the approved mockup's legend): one hue per state so the
// day bar reads at a glance. Cancelled / no-show never take up time.
const BAR_COLOR: Record<string, string> = {
  ARRIVED: '#4f46e5',
  ACCEPTED: '#3b82f6', CONFIRMED: '#3b82f6',
  PENDING: '#b45309', ASSIGNED: '#b45309', REJECTED: '#b45309',
  COMPLETED: '#0f766e',
};
const barColor = (status: string) => BAR_COLOR[status] ?? '#b45309';
const isGone = (status: string) => status === 'CANCELLED' || status === 'NO_SHOW';
/** Not shown in the columns unless asked: cancelled and declined. (A no-show stays — the desk needs to see it.) */
const hiddenByDefault = (status: string) => status === 'CANCELLED' || status === 'REJECTED';
const SHOW_GONE_KEY = 'lumio_cal_show_cancelled';
const PHONE_AVATAR = ['#be185d', '#1d4ed8', '#0f766e', '#7c3aed', '#c2410c', '#a16207', '#0e7490', '#4338ca'];

const STATUS_COLOR: Record<string, string> = {
  PENDING: '#f59e0b', ASSIGNED: '#f59e0b', REJECTED: '#f59e0b',
  ACCEPTED: '#3b82f6', CONFIRMED: '#3b82f6',
  ARRIVED: '#10b981', COMPLETED: '#8b5cf6', NO_SHOW: '#ef4444', CANCELLED: 'var(--c64748b)',
};
const sc = (status: string) => STATUS_COLOR[status] ?? '#f59e0b';
const AVATAR_BG = ['#f472b6', 'var(--c60a5fa)', '#34d399', '#fbbf24', '#a78bfa', 'var(--cf87171)', '#22d3ee', '#c084fc'];

// Paid amount (deposit or full) — same rule the detail drawer uses.
const paidOf = (b: Booking) => (b.payments ?? []).filter((p) => p.status === 'PAID').reduce((s, p) => s + p.amountCents, 0);

/** What a block on the calendar says (CalCard.tsx): name, service, phone, from–to, price. */
function faceOf(b: Booking, s: number, e: number, vi: boolean, t: (k: string) => string): CardFace {
  const paid = paidOf(b);
  const extra = (b.addons ?? []).length;
  return {
    name: b.customer ? `${b.customer.firstName}${b.customer.lastName ? ' ' + b.customer.lastName : ''}` : (vi ? 'Khách' : 'Guest'),
    partySize: b.partySize ?? null,
    price: formatPrice(b.priceCents, b.currency).replace(/[.,]00(?=\D*$)/, ''),
    service: `${b.service?.name ?? ''}${extra ? ` +${extra}` : ''}`,
    serviceName: b.service?.name ?? '',
    extra,
    phone: fmtPhone(b.customer?.phone),
    range: timeRange(s, e, vi),
    start: timeRange(s, s, vi).split(' – ')[0],
    status: b.status,
    serviceKey: b.service?.id ?? b.service?.name ?? null,
    paid: paid > 0,
    paidTitle: paid > 0 ? `${paid >= b.priceCents && b.priceCents > 0 ? t('cal.paidFull') : t('cal.deposit')} · ${formatPrice(paid, b.currency)}` : undefined,
    cancelled: isGone(b.status),
  };
}

// Booking channel → compact 1-letter badge + tooltip. Older bookings have no
// source (null) and simply show nothing.
function srcMeta(s: string | null | undefined, t: (k: string) => string): { icon: React.ReactNode; full: string } | null {
  const ic = (children: React.ReactNode) => (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
  );
  const monitor = ic(<><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></>);
  switch (s) {
    case 'web': return { full: t('cal.srcWeb'), icon: monitor };
    case 'online': return { full: t('cal.srcOnline'), icon: monitor };
    case 'mobile': return { full: t('cal.srcMobile'), icon: ic(<><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>) };
    case 'hotline': return { full: t('cal.srcHotline'), icon: ic(<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.98.37 1.92.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.89.33 1.83.57 2.81.7A2 2 0 0 1 22 16.92z" />) };
    case 'messenger': return { full: t('cal.srcMessenger'), icon: ic(<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />) };
    case 'admin': return { full: t('cal.srcAdmin'), icon: ic(<><circle cx="12" cy="8" r="4" /><path d="M4 21v-1a6 6 0 0 1 12 0v1" /></>) };
    case 'walkin': return { full: t('cal.srcWalkin'), icon: ic(<><circle cx="11" cy="4.5" r="2" /><path d="M11 7l-1.5 5 3 2.5 1 5.5M9.5 12L6 14" /></>) };
    default: return null;
  }
}

// Resource view: one column per technician + an "unassigned" lane.
// Desktop: click an empty slot to book that tech at that time; drag a card up
// or down to change the time, sideways to change the tech (one POST /move, so a
// clash leaves the booking where it was; "Hoàn tác" puts it back). Hours
// outside a tech's shift, and breaks between split shifts, are hatched.
export function StaffDayView({ date, items: allItems, tz, isMobile, onOpen, today, onChanged, onBook, onCtx }: {
  date: Date; items: Booking[]; tz?: string; isMobile: boolean; onOpen: (b: Booking) => void; today: Date; onChanged?: () => void;
  /** An empty slot was clicked: open the booking form in place (staffId null = unassigned column). Without it the page changes. */
  onBook?: (staffId: string | null, startLocal: string) => void;
  /** Right-click on a card: the same menu as the month (view, arrive, complete, cancel, delete). */
  onCtx?: (b: Booking, x: number, y: number) => void;
}) {
  const { token, user } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  // A cancelled booking used to stay in its technician's column, struck
  // through — so a visit moved to someone else (cancelled and booked again)
  // still showed on the old technician. Cancelled and declined bookings are
  // hidden from the columns unless the desk asks to see them (chip "Đã huỷ").
  const [showGone, setShowGone] = useState(() => { try { return localStorage.getItem(SHOW_GONE_KEY) === '1'; } catch { return false; } });
  const goneCount = useMemo(() => allItems.filter((b) => hiddenByDefault(b.status)).length, [allItems]);
  const items = useMemo(() => (showGone ? allItems : allItems.filter((b) => !hiddenByDefault(b.status))), [allItems, showGone]);
  const toggleGone = () => setShowGone((v) => { const n = !v; try { localStorage.setItem(SHOW_GONE_KEY, n ? '1' : '0'); } catch { /* private mode */ } return n; });
  const goneChip = goneCount > 0 ? (
    <button type="button" aria-pressed={showGone} onClick={toggleGone} title={lang === 'vi' ? 'Hiện / ẩn lịch đã huỷ' : 'Show / hide cancelled bookings'}
      style={{ ...chip(showGone), display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {showGone ? '✓ ' : ''}{lang === 'vi' ? `Đã huỷ · ${goneCount}` : `Cancelled · ${goneCount}`}
    </button>
  ) : null;
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  // Phone, one technician: the chip row (arrows at an edge while more chips
  // are hidden there) and which way the column slid in.
  const chipsRef = useRef<HTMLDivElement | null>(null);
  const [chipEdge, setChipEdge] = useState({ l: false, r: false });
  const [slide, setSlide] = useState<0 | 1 | -1>(0);
  // Status colours or one colour per service — the owner's choice, on every view.
  const [colorMode, setColorMode] = useCardColor();
  // Phone, everyone: technicians side by side, swiped sideways; an arrow at an
  // edge while more columns are hidden there.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [gridEdge, setGridEdge] = useState({ l: false, r: false });
  const gridEdges = () => {
    const el = gridRef.current; if (!el) return;
    const l = el.scrollLeft > 4, r = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setGridEdge((p) => (p.l === l && p.r === r ? p : { l, r }));
  };
  useEffect(() => {
    gridEdges();
    window.addEventListener('resize', gridEdges);
    return () => window.removeEventListener('resize', gridEdges);
  }, [items, staff.length, focus]);
  const chipEdges = () => {
    const el = chipsRef.current; if (!el) return;
    const l = el.scrollLeft > 4, r = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setChipEdge((p) => (p.l === l && p.r === r ? p : { l, r }));
  };
  // The chosen technician's chip slides to the middle of the row.
  useEffect(() => {
    const box = chipsRef.current; if (!box || !focus) return;
    const el = box.querySelector<HTMLElement>(`[data-chip="${CSS.escape(focus)}"]`);
    if (el) box.scrollTo({ left: Math.max(0, el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2), behavior: 'smooth' });
    const t = window.setTimeout(chipEdges, 350);
    chipEdges();
    return () => window.clearTimeout(t);
  }, [focus, staff.length]);
  // Desktop: the dashed slot under the pointer — where a click books, or where
  // a dragged card will land — and how far down the card it was grabbed.
  const [ghost, setGhost] = useState<{ col: string; min: number; dur: number; drag: boolean; clash?: boolean } | null>(null);
  const grab = useRef(0);
  const [undo, setUndo] = useState<{ id: string; startTime: string; staffId: string } | null>(null);
  const noteTimer = useRef<number | null>(null);
  const flash = (msg: string, ms = 2600) => {
    setNote(msg);
    if (noteTimer.current) window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => { setNote(null); setUndo(null); }, ms);
  };
  useEffect(() => () => { if (noteTimer.current) window.clearTimeout(noteTimer.current); }, []);

  useEffect(() => {
    if (!token) return;
    apiFetch<StaffLite[]>('/staff', { token }).then(setStaff).catch(() => undefined);
  }, [token]);

  // The salon's line-up of technician columns (canvas boards 3A / 3B): one
  // order for every device, saved by the owner or a manager.
  const [layout, setLayout] = useState<StaffLayout & { canEdit?: boolean }>({ order: [], hidden: [] });
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    if (!token) return;
    apiFetch<StaffLayout & { canEdit?: boolean }>('/calendar-layout/staff', { token }).then((l) => { if (l && Array.isArray(l.order)) setLayout(l); }).catch(() => undefined);
  }, [token]);
  const canArrange = !!layout.canEdit;
  const saveLayout = async (order: string[], hidden: string[]) => {
    const before = layout;
    setLayout({ ...layout, order, hidden });
    try {
      const r = await apiFetch<StaffLayout & { canEdit?: boolean }>('/calendar-layout/staff', { method: 'PATCH', token, body: { order, hidden } });
      if (r && Array.isArray(r.order)) setLayout(r);
    } catch (e) {
      setLayout(before);
      throw e;
    }
  };
  // Header drag (desktop): which column is being carried, and where it would land.
  const [colDrag, setColDrag] = useState<string | null>(null);
  const [colTo, setColTo] = useState<number | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const colPxRef = useRef(172);
  // How wide the grid is: a column wider than WIDE_CARD_PX lays its cards across (board 1B).
  const [deskW, setDeskW] = useState(0);
  const deskRo = useRef<ResizeObserver | null>(null);
  const deskRef = useCallback((el: HTMLDivElement | null) => {
    deskRo.current?.disconnect(); deskRo.current = null;
    if (!el) return;
    setDeskW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setDeskW(el.clientWidth));
    ro.observe(el);
    deskRo.current = ro;
  }, []);
  useEffect(() => () => { deskRo.current?.disconnect(); }, []);

  const fmtT = (iso: string) => new Date(iso).toLocaleTimeString(uiLocale(), { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
  const minInTz = (iso: string) => {
    const d = new Date(iso);
    if (!tz) return d.getHours() * 60 + d.getMinutes();
    const p = new Intl.DateTimeFormat(uiLocale(), { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).formatToParts(d);
    return (Number(p.find((x) => x.type === 'hour')?.value ?? 0) % 24) * 60 + Number(p.find((x) => x.type === 'minute')?.value ?? 0);
  };

  const isToday = date.getTime() === today.getTime();
  const currency = items[0]?.currency ?? 'USD';
  const revenue = items.reduce((s, b) => s + (b.status === 'CANCELLED' || b.status === 'NO_SHOW' ? 0 : b.priceCents), 0);
  const arrived = items.filter((b) => b.status === 'ARRIVED').length;

  // Everyone bookable, in the salon's order (staff-order.ts) — hidden ones too, for the sheet.
  const bookable = useMemo(
    () => arrange(staff.filter((s) => s.isActive && s.takesAppointments !== false), { order: layout.order, hidden: [] }),
    [staff, layout.order],
  );
  // A hidden technician still shows on a day she has a booking: a booking never vanishes.
  const busyIds = useMemo(() => new Set(allItems.filter((b) => !isGone(b.status) && b.assignedStaff).map((b) => b.assignedStaff!.id)), [allItems]);
  const activeStaff = useMemo(
    () => arrange(bookable, { order: bookable.map((x) => x.id), hidden: layout.hidden }, busyIds),
    [bookable, layout.hidden, busyIds],
  );

  const columns = useMemo(() => {
    const byStaff = new Map<string, Booking[]>();
    const unassigned: Booking[] = [];
    for (const b of items) {
      const id = b.assignedStaff?.id;
      if (!id) { unassigned.push(b); continue; }
      const arr = byStaff.get(id) ?? [];
      arr.push(b); byStaff.set(id, arr);
    }
    const seen = new Set<string>();
    const cols: { id: string; name: string; avatar: string | null; items: Booking[] }[] = [];
    for (const s of activeStaff) {
      seen.add(s.id);
      cols.push({ id: s.id, name: s.firstName, avatar: s.avatarUrl, items: byStaff.get(s.id) ?? [] });
    }
    for (const [id, arr] of byStaff) {
      if (seen.has(id)) continue;
      cols.push({ id, name: arr[0].assignedStaff?.firstName ?? '—', avatar: null, items: arr });
    }
    const shown = focus ? cols.filter((c) => c.id === focus) : cols;
    return (!focus && unassigned.length)
      ? [{ id: '__un', name: t('cal.unassignedCol'), avatar: null, items: unassigned }, ...shown]
      : shown;
  }, [items, activeStaff, focus, t]);

  // Each technician's hours on this weekday (several rows = a split shift).
  const dowD = date.getDay();
  const hhmm = (v: string) => { const [h, m] = v.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const deskShift = (st: StaffLite | undefined): { hasHours: boolean; parts: { s: number; e: number }[] } => {
    const all = st?.workingHours ?? [];
    const parts = all.filter((w) => w.dayOfWeek === dowD && w.isActive).map((w) => ({ s: hhmm(w.startTime), e: hhmm(w.endTime) })).filter((x) => x.e > x.s).sort((a, b) => a.s - b.s);
    return { hasHours: all.length > 0, parts };
  };

  let startH = 9, endH = 18;
  for (const st of activeStaff) for (const x of deskShift(st).parts) { startH = Math.min(startH, Math.floor(x.s / 60)); endH = Math.max(endH, Math.ceil(x.e / 60)); }
  for (const b of items) {
    const s = minInTz(b.startTime);
    let e = minInTz(b.endTime); if (e <= s) e = s + 30;
    startH = Math.min(startH, Math.floor(s / 60));
    endH = Math.max(endH, Math.ceil(e / 60));
  }
  startH = Math.max(7, startH); endH = Math.min(21, Math.max(endH, startH + 4));
  const gStart = startH * 60;
  const HP = isMobile ? 52 : HOUR_PX.desk;
  const railW = 50;
  const colW = isMobile ? 138 : 172;
  const headH = 46;
  const total = (endH - startH) * HP;
  const nowMin = isToday ? minInTz(new Date().toISOString()) : -1;
  const nowTop = nowMin >= gStart && nowMin <= endH * 60 ? (nowMin - gStart) / 60 * HP : -1;

  const place = (list: Booking[]) => {
    const ev = list.map((b) => {
      const s = minInTz(b.startTime);
      let e = minInTz(b.endTime); if (e <= s) e = s + (b.service?.durationMinutes || 30);
      return { b, s, e };
    }).sort((a, z) => a.s - z.s || a.e - z.e);
    type P = { b: Booking; s: number; e: number; col: number; cols: number };
    const out: P[] = [];
    let cluster: { b: Booking; s: number; e: number; col: number }[] = [];
    let clusterEnd = -1;
    const laneEnds: number[] = [];
    const flush = () => {
      const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
      for (const c of cluster) out.push({ ...c, cols });
      cluster = []; laneEnds.length = 0;
    };
    for (const x of ev) {
      if (cluster.length && x.s >= clusterEnd) flush();
      let col = laneEnds.findIndex((end) => end <= x.s);
      if (col === -1) { col = laneEnds.length; laneEnds.push(x.e); } else laneEnds[col] = x.e;
      cluster.push({ b: x.b, s: x.s, e: x.e, col });
      clusterEnd = cluster.length === 1 ? x.e : Math.max(clusterEnd, x.e);
    }
    if (cluster.length) flush();
    return out;
  };

  // ── desktop: click an empty slot to book, drag a card to a new time / tech ──
  const vi = lang === 'vi';
  const pad = (n: number) => String(n).padStart(2, '0');
  const dKey = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const wall = (m: number) => `${dKey}T${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const clock = (m: number) => { const h = Math.floor(m / 60) % 24, mm = m % 60; return vi ? `${h}:${pad(mm)}` : `${(h % 12) || 12}:${pad(mm)}${h < 12 ? 'a' : 'p'}`; };
  const isPastDay = date.getTime() < today.getTime();
  const durOf = (b: Booking) => { const s0 = minInTz(b.startTime); let e0 = minInTz(b.endTime); if (e0 <= s0) e0 = s0 + (b.service?.durationMinutes || 30); return e0 - s0; };
  const bodyOf = (el: HTMLElement) => el.querySelector<HTMLElement>('[data-body]') ?? el;
  const minAt = (body: HTMLElement, clientY: number) => gStart + ((clientY - body.getBoundingClientRect().top) / HP) * 60;
  /** Where a dragged card would start; null while the pointer is over the column header (= keep the time). */
  const dropMin = (wrap: HTMLElement, clientY: number, dur: number) => {
    const body = bodyOf(wrap);
    if (clientY < body.getBoundingClientRect().top) return null;
    const m = Math.round((minAt(body, clientY) - grab.current) / 15) * 15;
    return Math.max(gStart, Math.min(endH * 60 - dur, m));
  };

  /** Would this card overlap another live booking in that column? (The API checks too.) */
  const clashIn = (col: { id: string; items: Booking[] }, b: Booking, startMin: number) => {
    if (col.id === '__un') return false;
    const end = startMin + durOf(b);
    return col.items.some((x) => x.id !== b.id && !isGone(x.status) && x.status !== 'COMPLETED' && minInTz(x.startTime) < end && minInTz(x.startTime) + durOf(x) > startMin);
  };

  const moveTo = async (b: Booking, startMin: number | null, col: { id: string; name: string; items: Booking[] }) => {
    const toTech = col.id !== '__un' && col.id !== b.assignedStaff?.id;
    const orig = minInTz(b.startTime);
    // A drop within a quarter-hour of where it was is a change of tech, not of time.
    const target = startMin === null || Math.abs(startMin - orig) < 15 ? orig : startMin;
    if (!toTech && target === orig) return;
    if (clashIn(col, b, target)) {
      flash(vi ? `${col.name} đã có lịch lúc ${clock(target)} — chọn giờ khác.` : `${col.name} is already booked at ${clock(target)} — pick another time.`, 4000);
      return;
    }
    const prev = b.assignedStaff ? { id: b.id, startTime: b.startTime, staffId: b.assignedStaff.id } : null;
    setBusy(true); setUndo(null);
    try {
      // Dropped outside opening hours: refused for the desk; the owner is asked once.
      await withHoursOverride(
        (o) => apiFetch(`/bookings/${b.id}/move`, { method: 'POST', token, body: { startTime: target === orig ? b.startTime : wallToInstantISO(wall(target), tz), ...(toTech ? { staffId: col.id } : {}), ...(o ? { outsideHours: true } : {}) } }),
        { owner: user?.role === 'SALON_ADMIN' || user?.role === 'SUPER_ADMIN', vi },
      );
      const who = b.customer?.firstName ?? (vi ? 'Lịch hẹn' : 'Booking');
      flash(vi ? `Đã chuyển ${who} → ${toTech ? col.name + ' · ' : ''}${clock(target)}` : `Moved ${who} → ${toTech ? col.name + ' · ' : ''}${clock(target)}`, 7000);
      setUndo(prev);
      onChanged?.();
    } catch (e) {
      flash(e instanceof Error ? e.message : t('cal.reassignFail'), 5000);
    } finally {
      setBusy(false); setDragId(null); setOverCol(null); setGhost(null);
    }
  };
  const undoMove = async () => {
    const u = undo; if (!u) return;
    setUndo(null); setBusy(true);
    try {
      // Back to where it was — even if the owner had put it outside hours (ignored for anyone else).
      await apiFetch(`/bookings/${u.id}/move`, { method: 'POST', token, body: { startTime: u.startTime, staffId: u.staffId, outsideHours: true } });
      flash(vi ? 'Đã hoàn tác' : 'Undone');
      onChanged?.();
    } catch (e) {
      flash(e instanceof Error ? e.message : t('cal.reassignFail'), 5000);
    } finally { setBusy(false); }
  };
  const bookAt = (colId: string, m: number) => {
    // In the calendar the form opens as a pop-up over the day — no page change,
    // the day being looked at stays put. The URL route is the fallback.
    if (onBook) { onBook(colId === '__un' ? null : colId, wall(m)); return; }
    const q = new URLSearchParams({ new: '1', at: wall(m) });
    if (colId !== '__un') q.set('staff', colId);
    window.location.href = `/salon/bookings?${q.toString()}`;
  };



  // ── the technician line-up: the sheet (board 3B) and the header drag (3A) ──
  const sheetEl = sheet ? (
    <StaffOrderSheet vi={vi} mobile={isMobile} hidden={layout.hidden} onClose={() => setSheet(false)} onSave={saveLayout}
      staff={bookable.map((s, i) => ({ id: s.id, name: s.firstName, avatar: s.avatarUrl, hue: PHONE_AVATAR[i % PHONE_AVATAR.length], count: allItems.filter((b) => b.assignedStaff?.id === s.id && !isGone(b.status)).length }))} />
  ) : null;
  const arrangeBtn = canArrange && bookable.length > 1 ? (
    <button type="button" onClick={() => setSheet(true)} title={vi ? 'Đổi thứ tự cột thợ, ẩn / hiện thợ trên lịch' : 'Reorder the technician columns, hide or show technicians'}
      style={{ ...chip(false), display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--ce2e8f0)' }}>
      <span aria-hidden="true" style={{ letterSpacing: -2, color: 'var(--c94a3b8)' }}>⋮⋮</span>{vi ? 'Sắp xếp thợ' : 'Arrange technicians'}
    </button>
  ) : null;
  /** The carried column's floating card (board 3A): lifted, purple, "the whole column comes along". */
  const dragImage = (e: React.DragEvent, c: { name: string; items: Booking[] }, avatarBg: string) => {
    try {
      const n = c.items.filter((b) => !isGone(b.status)).length;
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;top:-200px;left:-400px;width:230px;height:46px;box-sizing:border-box;padding:0 12px;display:flex;align-items:center;gap:8px;background:#ffffff;color:#111827;border:2px solid #7c3aed;border-radius:10px;box-shadow:0 16px 34px rgba(76,29,149,.28);font:600 12.5px system-ui,sans-serif;z-index:9999';
      const grip = document.createElement('span'); grip.textContent = '⋮⋮'; grip.style.cssText = 'color:#7c3aed;letter-spacing:-2px;font-size:14px';
      const av = document.createElement('span'); av.textContent = c.name.charAt(0).toUpperCase(); av.style.cssText = `width:26px;height:26px;border-radius:50%;background:${avatarBg};color:#0b1220;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700`;
      const txt = document.createElement('span'); txt.style.cssText = 'display:flex;flex-direction:column;line-height:1.25';
      const nm = document.createElement('b'); nm.textContent = c.name;
      const sub = document.createElement('span'); sub.textContent = vi ? `${n} hẹn · cả cột đi theo` : `${n} booked · the column comes along`; sub.style.cssText = 'font-size:10.5px;color:#6b7280;font-weight:500';
      txt.append(nm, sub); el.append(grip, av, txt);
      document.body.appendChild(el);
      e.dataTransfer.setDragImage(el, 24, 22);
      window.setTimeout(() => el.remove(), 0);
    } catch { /* the browser draws its own */ }
  };

  // ───────────────────────────── phone ─────────────────────────────
  // Board 3 "Theo thợ — cả ca trong một màn hình": one card per technician
  // with a 24px day bar (shift band + booking blocks + now line). Tap a card
  // → board 4 "Một thợ": a single full-width column, swipe to the next tech.
  if (isMobile) {
    const vi = lang === 'vi';
    const dow = date.getDay();
    const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
    // Short clock for bars and axis: vi "9:30" · en "9:30a" — never "9:30 AM".
    const hm = (m: number) => {
      const h = Math.floor(m / 60) % 24, mm = m % 60;
      if (vi) return `${h}:${String(mm).padStart(2, '0')}`;
      return `${(h % 12) || 12}${mm ? ':' + String(mm).padStart(2, '0') : ''}${h < 12 ? 'a' : 'p'}`;
    };
    const shiftOf = (s: StaffLite): { s: number; e: number } | null => {
      const rows = (s.workingHours ?? []).filter((w) => w.dayOfWeek === dow && w.isActive);
      if (!rows.length) return null;
      return { s: Math.min(...rows.map((w) => toMin(w.startTime))), e: Math.max(...rows.map((w) => toMin(w.endTime))) };
    };
    const span = (b: Booking) => {
      const s = minInTz(b.startTime);
      let e = minInTz(b.endTime); if (e <= s) e = s + (b.service?.durationMinutes || 30);
      return { s, e };
    };
    const custName = (b: Booking) => (b.customer ? `${b.customer.firstName}${b.customer.lastName ? ' ' + b.customer.lastName : ''}` : (vi ? 'Khách' : 'Guest'));

    // Everyone who takes appointments, plus anyone who has a booking today
    // even if they are not on the staff list any more.
    const byStaff = new Map<string, Booking[]>();
    const unassigned: Booking[] = [];
    for (const b of items) {
      const id = b.assignedStaff?.id;
      if (!id) { unassigned.push(b); continue; }
      byStaff.set(id, [...(byStaff.get(id) ?? []), b]);
    }
    type Row = { id: string; name: string; avatar: string | null; hue: string; shift: { s: number; e: number } | null; hasHours: boolean; items: Booking[]; live: Booking[] };
    const rows: Row[] = activeStaff.map((s, i) => {
      const its = (byStaff.get(s.id) ?? []).slice().sort((a, b) => minInTz(a.startTime) - minInTz(b.startTime));
      return { id: s.id, name: s.firstName, avatar: s.avatarUrl, hue: PHONE_AVATAR[i % PHONE_AVATAR.length], shift: shiftOf(s), hasHours: (s.workingHours ?? []).length > 0, items: its, live: its.filter((b) => !isGone(b.status)) };
    });
    for (const [id, arr] of byStaff) {
      if (rows.some((r) => r.id === id)) continue;
      rows.push({ id, name: arr[0].assignedStaff?.firstName ?? '—', avatar: null, hue: PHONE_AVATAR[rows.length % PHONE_AVATAR.length], shift: null, hasHours: false, items: arr, live: arr.filter((b) => !isGone(b.status)) });
    }
    // Off today = has a schedule, nothing on this weekday, and no booking.
    const onShift = rows.filter((r) => !(r.hasHours && !r.shift && r.live.length === 0));
    const offToday = rows.filter((r) => r.hasHours && !r.shift && r.live.length === 0);

    // Shared hour axis: the salon's day (9–19 by default) stretched to cover
    // every shift and every booking.
    let aS = 9 * 60, aE = 19 * 60;
    for (const r of onShift) {
      if (r.shift) { aS = Math.min(aS, r.shift.s); aE = Math.max(aE, r.shift.e); }
      for (const b of r.live) { const { s, e } = span(b); aS = Math.min(aS, s); aE = Math.max(aE, e); }
    }
    for (const b of unassigned) { const { s, e } = span(b); aS = Math.min(aS, s); aE = Math.max(aE, e); }
    aS = Math.max(0, Math.floor(aS / 60) * 60); aE = Math.min(24 * 60, Math.ceil(aE / 60) * 60);
    const aSpan = Math.max(60, aE - aS);
    const pct = (m: number) => Math.max(0, Math.min(100, ((m - aS) / aSpan) * 100));
    const hours = Array.from({ length: aSpan / 60 + 1 }, (_, i) => aS + i * 60);
    const nowPct = nowMin >= aS && nowMin <= aE ? pct(nowMin) : -1;

    // What each technician is doing right now (only meaningful today).
    const statusLine = (r: Row): { text: string; tone: 'muted' | 'good' | 'warn' } => {
      const n = r.live.length;
      if (isToday && nowMin >= 0) {
        const cur = r.live.find((b) => { const { s, e } = span(b); return s <= nowMin && nowMin < e && b.status !== 'COMPLETED'; });
        if (cur) {
          const left = span(cur).e - nowMin;
          const who = cur.customer ? custName(cur) : (cur.service?.name ?? '');
          if (cur.status === 'PENDING' || cur.status === 'ASSIGNED' || cur.status === 'REJECTED') return { text: `${vi ? 'Đang làm' : 'Working'} · ${who} · ${vi ? 'chờ xác nhận' : 'awaiting confirmation'}`, tone: 'warn' };
          return { text: `${vi ? 'Đang làm' : 'Working'} · ${who} · ${vi ? `còn ${left} phút` : `${left} min left`}`, tone: 'muted' };
        }
        const next = r.live.find((b) => span(b).s > nowMin);
        const shiftEnd = r.shift?.e ?? aE;
        if (next) {
          const gap = span(next).s - nowMin;
          if (gap >= 30) return { text: `${vi ? 'Trống đến' : 'Free until'} ${hm(span(next).s)} · ${ind(vi ? 'nhận khách vãng lai được' : 'can take a walk-in')}`, tone: 'good' };
          return { text: `${vi ? 'Kế tiếp' : 'Next'} ${hm(span(next).s)} · ${custName(next)}`, tone: 'muted' };
        }
        if (n === 0) return { text: vi ? 'Trống cả ngày' : 'Free all day', tone: 'good' };
        if (r.shift && nowMin >= shiftEnd) return { text: vi ? 'Đã xong ca' : 'Shift over', tone: 'muted' };
        return { text: `${vi ? 'Trống đến hết ca' : 'Free for the rest of the shift'} · ${ind(vi ? 'nhận khách vãng lai được' : 'can take a walk-in')}`, tone: 'good' };
      }
      if (n === 0) return { text: vi ? 'Trống cả ngày' : 'Free all day', tone: 'good' };
      const first = r.live[0];
      return { text: `${vi ? 'Bắt đầu' : 'Starts'} ${hm(span(first).s)} · ${custName(first)}`, tone: 'muted' };
    };
    const toneColor = (tone: 'muted' | 'good' | 'warn') => (tone === 'good' ? 'var(--ink-good)' : tone === 'warn' ? 'var(--ink-warn)' : 'var(--c94a3b8)');
    const workingNow = isToday ? onShift.filter((r) => r.live.some((b) => { const { s, e } = span(b); return s <= nowMin && nowMin < e && b.status !== 'COMPLETED'; })).length : 0;
    const freeNow = isToday ? onShift.filter((r) => (!r.shift || (nowMin >= r.shift.s && nowMin < r.shift.e)) && !r.live.some((b) => { const { s, e } = span(b); return s <= nowMin && nowMin < e && b.status !== 'COMPLETED'; })).length : 0;

    const avatar = (r: Row, size: number, font: number) => r.avatar
      ? <img src={r.avatar} alt="" style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }} />
      : <span style={{ width: size, height: size, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: font, fontWeight: 700, ...onHue(r.hue) }}>{r.name.charAt(0).toUpperCase()}</span>;

    const card: React.CSSProperties = { boxSizing: 'border-box', padding: '10px 12px', borderRadius: 14, background: 'var(--c111827)', border: '1px solid var(--c1f2937)', display: 'flex', flexDirection: 'column', gap: 8, width: '100%', textAlign: 'left', cursor: 'pointer', color: 'var(--ce2e8f0)' };
    const focusRow = focus ? rows.find((r) => r.id === focus) ?? null : null;

    if (!focusRow) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {note && <div style={{ fontSize: 13, color: 'var(--ca7f3d0)', background: 'var(--c064e3b)', padding: '6px 10px', borderRadius: 8 }}>{note}</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 2px' }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.8, color: 'var(--c94a3b8)', flex: 1 }}>
              {isToday ? `${vi ? 'THỢ ĐANG LÀM' : 'ON THE FLOOR'} · ${hm(nowMin)}` : (vi ? 'THỢ TRONG NGÀY' : 'TECHNICIANS')}
            </span>
            {isToday && onShift.length > 0 && (
              <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{workingNow} {vi ? 'đang làm' : 'busy'} · <span style={{ color: 'var(--ink-good)', fontWeight: 600 }}>{freeNow} {vi ? 'trống' : 'free'}</span></span>
            )}
          </div>
          {onShift.length > 0 && <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{arrangeBtn}{goneChip}<CardColorSwitch mode={colorMode} set={setColorMode} vi={vi} /></div>}
          {onShift.length === 0 && unassigned.length === 0 && (
            <div style={{ ...ui.card, textAlign: 'center', color: 'var(--c64748b)', padding: '36px 0', fontSize: 14 }}>{items.length === 0 ? t('cal.noAppts') : (vi ? 'Chưa có thợ nào làm hôm nay.' : 'No technician on shift today.')}</div>
          )}
          {unassigned.length > 0 && (
            <div style={{ ...card, cursor: 'default', border: '1px dashed var(--c7c5c22)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 36, height: 36, flexShrink: 0, borderRadius: '50%', background: 'var(--c334155)', color: 'var(--ccbd5e1)', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>?</span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{t('cal.unassignedCol')}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--ink-warn)', fontWeight: 600 }}>{ind(vi ? 'Bấm vào lịch để chọn thợ' : 'Tap a booking to pick a technician')}</span>
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{unassigned.length} {t('cal.apptWord')}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {unassigned.map((b) => (
                  <button key={b.id} type="button" onClick={() => onOpen(b)} style={{ height: 30, padding: '0 10px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: barColor(b.status), fontWeight: 700 }}>{hm(span(b).s)}</span>{custName(b)}<SourceDot b={b} vi={vi} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {onShift.length > 0 && (() => {
            // Board 2 of "Lịch — thẻ đủ thông tin": every technician a column,
            // two on screen, swiped sideways; each block says who, what,
            // which number and from when to when. Tap a name for that
            // technician alone (board 3).
            const HG = HOUR_PX.phoneColumns;
            const COLW = 160;
            const gy = (m: number) => ((m - aS) / 60) * HG;
            const gH = (aSpan / 60) * HG;
            const hatchBg = 'repeating-linear-gradient(135deg, transparent 0 6px, rgba(148,163,184,0.10) 6px 7px)';
            const arrow = (side: 'l' | 'r') => (
              <button type="button" onClick={() => gridRef.current?.scrollBy({ left: side === 'r' ? COLW : -COLW, behavior: 'smooth' })}
                aria-label={side === 'r' ? (vi ? 'Xem thợ tiếp theo' : 'Next technicians') : (vi ? 'Xem thợ trước' : 'Previous technicians')}
                style={{ position: 'absolute', top: 8, [side === 'r' ? 'right' : 'left']: side === 'r' ? 6 : 50, zIndex: 5, width: 36, height: 36, borderRadius: '50%', border: '1px solid var(--c334155)', background: 'var(--c1e293b)', color: 'var(--ink-link)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,0.18)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={side === 'r' ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'} /></svg>
              </button>
            );
            return (
              <div style={{ position: 'relative' }}>
                <style>{'.lumio-cols::-webkit-scrollbar{display:none}'}</style>
                <div ref={gridRef} className="lumio-cols" onScroll={gridEdges}
                  style={{ overflowX: 'auto', scrollSnapType: 'x proximity', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', borderRadius: 14, border: '1px solid var(--c1f2937)', background: 'var(--c111827)' }}>
                  <div style={{ display: 'flex', width: 'max-content' }}>
                    <div style={{ position: 'sticky', left: 0, zIndex: 4, width: 44, flexShrink: 0, background: 'var(--c111827)', borderRight: '1px solid var(--c1f2937)' }}>
                      <div style={{ height: 52, borderBottom: '1px solid var(--c1f2937)' }} />
                      <div style={{ position: 'relative', height: gH }}>
                        {hours.slice(0, -1).map((hh) => <span key={hh} style={{ position: 'absolute', top: gy(hh) + 5, left: 6, fontSize: 11, fontWeight: 600, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{hm(hh)}</span>)}
                      </div>
                    </div>
                    {onShift.map((r) => {
                      const lanes = place(r.live);
                      return (
                        <div key={r.id} style={{ width: COLW, flexShrink: 0, borderRight: '1px solid var(--c1f2937)', scrollSnapAlign: 'start' }}>
                          <button type="button" onClick={() => setFocus(r.id)} aria-label={vi ? `Chỉ xem lịch của ${r.name}` : `Show ${r.name} only`}
                            style={{ height: 52, width: '100%', boxSizing: 'border-box', border: 0, borderBottom: '1px solid var(--c1f2937)', background: 'transparent', display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                            {avatar(r, 28, 12)}
                            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                              <span style={{ fontSize: 11.5, color: toneColor(statusLine(r).tone), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{statusLine(r).text}</span>
                            </span>
                          </button>
                          <div style={{ position: 'relative', height: gH }}>
                            {r.shift && r.shift.s > aS && <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: gy(r.shift.s), background: hatchBg }} />}
                            {r.shift && r.shift.e < aE && <div style={{ position: 'absolute', left: 0, right: 0, top: gy(r.shift.e), bottom: 0, background: hatchBg }} />}
                            {hours.slice(1, -1).map((hh) => <div key={hh} style={{ position: 'absolute', top: gy(hh), left: 0, right: 0, borderTop: '1px solid var(--c1f2937)' }} />)}
                            {lanes.map(({ b, s, e, col, cols }) => {
                              const w = 100 / cols;
                              const h = Math.max(20, gy(e) - gy(s) - 4);
                              const tier = cardTier(h, 'sm');
                              const face: CardFace = { ...faceOf(b, s, e, vi, t), source: <SourceDot b={b} vi={vi} /> };
                              const look = cardLook(face, colorMode, barColor(b.status));
                              return (
                                <button key={b.id} type="button" onClick={() => onOpen(b)} onContextMenu={onCtx ? (ev) => { ev.preventDefault(); onCtx(b, ev.clientX, ev.clientY); } : undefined} aria-label={[face.name, face.service, face.phone, face.range].filter(Boolean).join(', ')}
                                  style={{ position: 'absolute', top: gy(s) + 2, height: h, left: `calc(${col * w}% + 3px)`, width: `calc(${w}% - 6px)`, boxSizing: 'border-box', padding: cardPad(tier, 'sm'), borderRadius: 10,
                                    background: look.background, border: look.border, display: 'flex', flexDirection: 'column', justifyContent: tier === 1 ? 'center' : 'flex-start', alignItems: 'stretch', gap: 2, overflow: 'hidden', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                                  <CardBody f={face} tier={tier} size="sm" look={look} />
                                </button>
                              );
                            })}
                            {nowPct >= 0 && <div style={{ position: 'absolute', left: 0, right: 0, top: gy(nowMin), borderTop: '2px solid #f43f5e', pointerEvents: 'none', zIndex: 2 }} />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {gridEdge.l && arrow('l')}
                {gridEdge.r && arrow('r')}
              </div>
            );
          })()}
          {offToday.map((r) => (
            <button key={r.id} type="button" onClick={() => setFocus(r.id)} style={{ boxSizing: 'border-box', padding: '10px 12px', borderRadius: 14, border: '1px dashed var(--c243044)', background: 'transparent', display: 'flex', alignItems: 'center', gap: 10, opacity: 0.7, width: '100%', textAlign: 'left', cursor: 'pointer' }}>
              <span style={{ width: 36, height: 36, flexShrink: 0, borderRadius: '50%', background: 'var(--c1e293b)', color: 'var(--c94a3b8)', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{r.name.charAt(0).toUpperCase()}</span>
              <span style={{ flex: 1, fontSize: 14, color: 'var(--c94a3b8)' }}>{r.name} · {vi ? 'nghỉ hôm nay' : 'off today'}</span>
            </button>
          ))}
          {sheetEl}
        </div>
      );
    }

    // ── Board 4: one technician, full-width column ──
    const order = [...onShift, ...offToday];
    const idx = order.findIndex((r) => r.id === focusRow.id);
    const r = focusRow;
    const rev = r.live.reduce((s, b) => s + b.priceCents, 0);
    // Column range: the shift (or the shared axis), stretched to fit bookings.
    let cS = r.shift?.s ?? aS, cE = r.shift?.e ?? aE;
    for (const b of r.live) { const { s, e } = span(b); cS = Math.min(cS, s); cE = Math.max(cE, e); }
    cS = Math.floor(cS / 60) * 60; cE = Math.ceil(cE / 60) * 60; if (cE - cS < 4 * 60) cE = cS + 4 * 60;
    const H = HOUR_PX.phoneOne; // px per hour: a 60-min card holds name · service · phone · time (lib/cal-card)
    const y = (m: number) => ((m - cS) / 60) * H;
    const colH = ((cE - cS) / 60) * H;
    // Free gaps (≥ 45 min) inside the column, after now if today.
    const gaps: { s: number; e: number }[] = [];
    {
      const floor = isToday && nowMin > cS ? nowMin : cS;
      let cursor = floor;
      const spans = r.live.map(span).sort((a, b) => a.s - b.s);
      for (const sp of spans) { if (sp.s - cursor >= 45) gaps.push({ s: cursor, e: sp.s }); cursor = Math.max(cursor, sp.e); }
      const end = r.shift?.e ?? cE;
      if (end - cursor >= 45) gaps.push({ s: cursor, e: end });
    }
    const firstGap = gaps[0];
    const bookHref = `/salon/bookings?new=1&staff=${encodeURIComponent(r.id)}&at=${encodeURIComponent(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(Math.floor((firstGap?.s ?? cS) / 60)).padStart(2, '0')}:${String((firstGap?.s ?? cS) % 60).padStart(2, '0')}`)}`;
    const colNow = isToday && nowMin >= cS && nowMin <= cE ? y(nowMin) : -1;
    const lanes = place(r.live);

    // Swipe the column (never the chip row) for the next / previous technician.
    const canPrev = idx > 0, canNext = idx < order.length - 1;
    const prevR = canPrev ? order[idx - 1] : null, nextR = canNext ? order[idx + 1] : null;
    const goTo = (d: -1 | 1) => { const n = order[idx + d]; if (n) { setSlide(d); setFocus(n.id); } };
    const swipeHandlers = {
      onTouchStart: (e: React.TouchEvent) => { const tch = e.touches[0]; swipe.current = { x: tch.clientX, y: tch.clientY }; },
      onTouchEnd: (e: React.TouchEvent) => {
        const st = swipe.current; swipe.current = null; if (!st) return;
        const tch = e.changedTouches[0]; const dx = tch.clientX - st.x, dy = tch.clientY - st.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) goTo(dx < 0 ? 1 : -1);
      },
    };
    const arrowBtn = (side: 'l' | 'r') => (
      <button type="button" onClick={() => chipsRef.current?.scrollBy({ left: side === 'r' ? 180 : -180, behavior: 'smooth' })}
        aria-label={side === 'r' ? (vi ? 'Xem thêm thợ bên phải' : 'More technicians to the right') : (vi ? 'Xem thêm thợ bên trái' : 'More technicians to the left')}
        style={{ position: 'absolute', top: 0, [side === 'r' ? 'right' : 'left']: 0, width: 52, height: 44, border: 0, padding: side === 'r' ? '0 6px 0 0' : '0 0 0 6px', cursor: 'pointer',
          background: `linear-gradient(to ${side === 'r' ? 'right' : 'left'}, transparent, var(--page-bg, var(--c0b1120)) 55%)`, display: 'flex', alignItems: 'center', justifyContent: side === 'r' ? 'flex-end' : 'flex-start' }}>
        <span style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--c1e293b)', border: '1px solid var(--c334155)', color: 'var(--ink-link)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={side === 'r' ? 'M9 18l6-6-6-6' : 'M15 18l-6-6 6-6'} /></svg>
        </span>
      </button>
    );
    const navBtn = (d: -1 | 1, who: Row) => (
      <button type="button" onClick={() => goTo(d)} aria-label={d < 0 ? (vi ? `Thợ trước: ${who.name}` : `Previous technician: ${who.name}`) : (vi ? `Thợ sau: ${who.name}` : `Next technician: ${who.name}`)}
        style={{ height: 40, maxWidth: '100%', minWidth: 0, padding: d < 0 ? '0 12px 0 6px' : '0 6px 0 12px', borderRadius: 999, border: '1px solid var(--c243044)', background: 'var(--c111827)', color: 'var(--ink-link)', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
        {d < 0 && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M15 18l-6-6 6-6" /></svg>}
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{who.name}</span>
        {d > 0 && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M9 18l6-6-6-6" /></svg>}
      </button>
    );

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <style>{'@keyframes lumioInR{from{opacity:.35;transform:translateX(28px)}to{opacity:1;transform:none}}@keyframes lumioInL{from{opacity:.35;transform:translateX(-28px)}to{opacity:1;transform:none}}.lumio-chips::-webkit-scrollbar{display:none}'}</style>
        {note && <div style={{ fontSize: 13, color: 'var(--ca7f3d0)', background: 'var(--c064e3b)', padding: '6px 10px', borderRadius: 8 }}>{note}</div>}
        {/* Technician chips: swipe sideways; an arrow shows at an edge while more are hidden there. */}
        <div style={{ position: 'relative' }}>
          <div ref={chipsRef} className="lumio-chips" onScroll={chipEdges}
            style={{ display: 'flex', gap: 8, overflowX: 'auto', alignItems: 'center', scrollbarWidth: 'none', scrollSnapType: 'x proximity', WebkitOverflowScrolling: 'touch' }}>
            <button type="button" onClick={() => setFocus(null)} aria-label={t('cal.allStaff')}
              style={{ flexShrink: 0, height: 44, padding: '0 14px', borderRadius: 999, border: '1px solid var(--c243044)', background: 'var(--c111827)', color: 'var(--ccbd5e1)', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', scrollSnapAlign: 'start' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
              {vi ? 'Tất cả' : 'All'}
            </button>
            {order.map((o) => {
              const on = o.id === r.id;
              return (
                <button key={o.id} type="button" data-chip={o.id} aria-pressed={on} onClick={() => { setSlide(order.indexOf(o) < idx ? -1 : 1); setFocus(o.id); }}
                  style={{ flexShrink: 0, height: 44, maxWidth: 190, padding: '0 12px 0 5px', borderRadius: 999, fontSize: 14, fontWeight: 600, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', scrollSnapAlign: 'center',
                    ...(on ? { border: '1px solid #4f46e5', background: '#4f46e5', color: '#fff' } : { border: '1px solid var(--c243044)', background: 'var(--c111827)', color: 'var(--ce2e8f0)' }) }}>
                  {avatar(o, 32, 13)}
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{o.name}</span>
                  <span style={{ flexShrink: 0, minWidth: 20, height: 20, padding: '0 6px', boxSizing: 'border-box', borderRadius: 999, fontSize: 11.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    ...(on ? { background: 'rgba(255,255,255,0.22)', color: '#fff' } : { background: 'var(--c1e293b)', color: 'var(--ccbd5e1)' }) }}>{o.live.length}</span>
                </button>
              );
            })}
            <span aria-hidden="true" style={{ flex: '0 0 4px' }} />
          </div>
          {chipEdge.l && arrowBtn('l')}
          {chipEdge.r && arrowBtn('r')}
        </div>

        <div key={r.id} {...swipeHandlers} style={{ display: 'flex', flexDirection: 'column', gap: 10, animation: slide ? `${slide > 0 ? 'lumioInR' : 'lumioInL'} .22s ease-out` : undefined }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48 }}>
            {avatar(r, 44, 17)}
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.25 }}>
              <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
              <span style={{ fontSize: 13, color: 'var(--c94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.live.length} {t('cal.apptWord')}{rev > 0 && <> · {formatPrice(rev, currency).replace(/[.,]00(?=\D*$)/, '')}</>}
                {firstGap ? <> · {vi ? 'trống' : 'free'} {hm(firstGap.s)}–{hm(firstGap.e)}</> : r.shift && !r.live.length ? <> · {vi ? 'nghỉ hôm nay' : 'off today'}</> : null}
              </span>
            </span>
            <a href={bookHref} aria-label={vi ? `Đặt lịch cho ${r.name}` : `Book ${r.name}`}
              style={{ flexShrink: 0, height: 44, padding: '0 16px', borderRadius: 12, fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none', whiteSpace: 'nowrap', background: '#4f46e5', color: '#fff' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              {vi ? 'Đặt' : 'Book'}
            </a>
          </div>

          {order.length > 1 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', alignItems: 'center', gap: 8, minHeight: 40 }}>
              <span style={{ display: 'flex', justifyContent: 'flex-start', minWidth: 0 }}>{prevR && navBtn(-1, prevR)}</span>
              {order.length <= 10 ? (
                <span aria-hidden="true" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {order.map((o) => <span key={o.id} style={{ height: 6, width: o.id === r.id ? 18 : 6, borderRadius: 999, background: o.id === r.id ? 'var(--ink-link)' : 'var(--c334155)' }} />)}
                </span>
              ) : (
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c94a3b8)' }}>{idx + 1}/{order.length}</span>
              )}
              <span style={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0 }}>{nextR && navBtn(1, nextR)}</span>
            </div>
          )}

          <div style={{ borderRadius: 14, background: 'var(--c111827)', border: '1px solid var(--c1f2937)', overflow: 'hidden', display: 'flex', opacity: busy ? 0.6 : 1 }}>
            <div style={{ width: 44, flexShrink: 0, borderRight: '1px solid var(--c1f2937)', position: 'relative', height: colH }}>
              {Array.from({ length: (cE - cS) / 60 }, (_, i) => cS + i * 60).map((h) => (
                <span key={h} style={{ position: 'absolute', top: y(h) + 6, left: 8, fontSize: 11.5, fontWeight: 600, color: 'var(--c94a3b8)' }}>{hm(h)}</span>
              ))}
            </div>
            <div style={{ flex: 1, position: 'relative', height: colH }}>
              {Array.from({ length: (cE - cS) / 60 - 1 }, (_, i) => i + 1).map((i) => (
                <div key={i} style={{ position: 'absolute', top: i * H, left: 0, right: 0, borderTop: '1px solid var(--c1f2937)' }} />
              ))}
              {r.shift && r.shift.s > cS && <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: y(r.shift.s), background: 'repeating-linear-gradient(135deg, transparent 0 6px, rgba(148,163,184,0.10) 6px 7px)' }} />}
              {r.shift && r.shift.e < cE && <div style={{ position: 'absolute', left: 0, right: 0, top: y(r.shift.e), bottom: 0, background: 'repeating-linear-gradient(135deg, transparent 0 6px, rgba(148,163,184,0.10) 6px 7px)' }} />}
              {gaps.map((g) => (
                <a key={`${g.s}-${g.e}`} href={`/salon/bookings?new=1&staff=${encodeURIComponent(r.id)}&at=${encodeURIComponent(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(Math.floor(g.s / 60)).padStart(2, '0')}:${String(g.s % 60).padStart(2, '0')}`)}`}
                  style={{ position: 'absolute', left: 8, right: 8, top: y(g.s) + 4, height: Math.max(30, y(g.e) - y(g.s) - 8), boxSizing: 'border-box', borderRadius: 10, border: '1px dashed var(--c334155)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: 'var(--c94a3b8)', textDecoration: 'none' }}>
                  + {vi ? 'Trống' : 'Free'} {hm(g.s)} – {hm(g.e)} · {vi ? 'chạm để đặt' : 'tap to book'}
                </a>
              ))}
              {lanes.map(({ b, s, e, col, cols }) => {
                const w = 100 / cols;
                // Height decides how many lines fit — never more lines than room (no text on text).
                const h = Math.max(30, y(e) - y(s) - 4);
                const tier = cardTier(h, 'lg');
                const face: CardFace = { ...faceOf(b, s, e, vi, t), tag: statusTag(b.status, vi), source: <SourceChip b={b} vi={vi} /> };
                const look = cardLook(face, colorMode, barColor(b.status));
                return (
                  <button key={b.id} type="button" onClick={() => onOpen(b)} onContextMenu={onCtx ? (ev) => { ev.preventDefault(); onCtx(b, ev.clientX, ev.clientY); } : undefined} aria-label={[face.name, face.service, face.phone, face.range, face.price, face.tag].filter(Boolean).join(', ')}
                    style={{ position: 'absolute', top: y(s) + 2, height: h, left: `calc(${col * w}% + 8px)`, width: `calc(${w}% - 16px)`, boxSizing: 'border-box', padding: cardPad(tier, 'lg'), borderRadius: 10,
                      background: look.background, border: look.border, display: 'flex', flexDirection: 'column', justifyContent: tier === 1 ? 'center' : 'flex-start', alignItems: 'stretch', gap: 2, overflow: 'hidden', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                    <CardBody f={face} tier={tier} size="lg" look={look} />
                  </button>
                );
              })}
              {r.items.filter((b) => isGone(b.status)).map((b) => {
                const { s } = span(b);
                return <button key={b.id} type="button" onClick={() => onOpen(b)} style={{ position: 'absolute', left: 8, right: 8, top: y(s) + 3, height: 26, boxSizing: 'border-box', padding: '0 10px', borderRadius: 8, background: 'var(--c18202f)', border: '1px solid var(--c334155)', fontSize: 12, fontFamily: 'inherit', color: 'var(--c94a3b8)', display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'line-through', cursor: 'pointer' }}>{hm(s)} · {custName(b)}</button>;
              })}
              {colNow >= 0 && (
                <div style={{ position: 'absolute', left: 0, right: 0, top: colNow, borderTop: '2px solid #f43f5e', pointerEvents: 'none' }}>
                  <span style={{ position: 'absolute', left: -5, top: -5, width: 8, height: 8, borderRadius: '50%', background: '#f43f5e' }} />
                </div>
              )}
            </div>
          </div>
          {sheetEl}
          <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', padding: '2px 0 8px', textAlign: 'center', lineHeight: 1.5 }}>{ind(vi ? 'Vuốt lịch hoặc bấm ‹ › để sang thợ khác · Đổi thợ cho một lịch: mở lịch → “Đổi thợ”.' : 'Swipe the schedule, or tap ‹ ›, for the next technician · To reassign one booking: open it → “Change tech”.')}</span>
        </div>
      </div>
    );
  }

  // ── desktop: the header drag (board 3A) ──
  const staffCols = columns.filter((c) => c.id !== '__un');
  const canReorderCols = canArrange && !focus && staffCols.length > 1 && !dragId;
  const previewCols = (() => {
    if (!colDrag || colTo === null) return columns;
    const carried = staffCols.find((c) => c.id === colDrag);
    if (!carried) return columns;
    const rest = staffCols.filter((c) => c.id !== colDrag);
    const preview = [...rest.slice(0, colTo), carried, ...rest.slice(colTo)];
    const lane = columns.find((c) => c.id === '__un');
    return lane ? [lane, ...preview] : preview;
  })();
  // While a column is carried nothing moves in the page (the browser would drop
  // the drag if its source left the page): the columns slide with a transform.
  const laneFirst = columns[0]?.id === '__un';
  const shiftOf = (id: string): number => {
    if (!colDrag || colTo === null) return 0;
    const o = staffCols.findIndex((x) => x.id === id);
    if (o < 0) return 0;
    if (id === colDrag) return (colTo - o) * colPxRef.current;
    const r = staffCols.filter((x) => x.id !== colDrag).findIndex((x) => x.id === id);
    const v = r < colTo ? r : r + 1;
    return (v - o) * colPxRef.current;
  };
  const overGrid = (e: React.DragEvent<HTMLDivElement>) => {
    if (!colDrag) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    const box = innerRef.current?.getBoundingClientRect();
    if (!box) return;
    const start = box.left + railW + (laneFirst ? colPxRef.current : 0);
    const to = Math.max(0, Math.min(staffCols.length - 1, Math.floor((e.clientX - start) / colPxRef.current)));
    if (to !== colTo) setColTo(to);
  };
  const dropCol = () => {
    const id = colDrag, to = colTo;
    setColDrag(null); setColTo(null);
    if (!id || to === null) return;
    const shown = staffCols.map((c) => c.id);
    const moved = moveId(shown, id, to);
    if (moved.join() === shown.join()) return;
    // Anyone not on screen (hidden, or off the list) keeps a place after the columns shown.
    const full = [...moved, ...bookable.map((x) => x.id).filter((x) => !moved.includes(x))];
    saveLayout(full, layout.hidden)
      .then(() => flash(vi ? 'Đã lưu thứ tự thợ cho cả tiệm' : 'Order saved for the whole salon'))
      .catch((e) => flash(e instanceof Error ? e.message : (vi ? 'Không lưu được thứ tự' : 'Could not save the order'), 5000));
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, padding: '10px 14px', background: 'var(--c111827)', border: '1px solid var(--c1f2937)', borderRadius: 10 }}>
        <span style={{ fontSize: 14 }}><strong style={{ fontSize: 18 }}>{items.length}</strong> <span style={{ color: 'var(--c94a3b8)' }}>{t('cal.apptWord')}</span></span>
        <span style={{ color: 'var(--ink-faint)' }}>|</span>
        <span style={{ fontSize: 14 }}><span style={{ color: 'var(--c94a3b8)' }}>{t('cal.expected')}: </span><strong style={{ color: 'var(--ink-good)' }}>{formatPrice(revenue, currency)}</strong></span>
        <span style={{ color: 'var(--ink-faint)' }}>|</span>
        <span style={{ fontSize: 14 }}><span style={{ color: 'var(--c94a3b8)' }}>{t('cal.stArrived')}: </span><strong style={{ color: '#10b981' }}>{arrived}</strong></span>
        {note && (
          <span role="status" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--ca7f3d0)', background: 'var(--c064e3b)', padding: '3px 6px 3px 10px', borderRadius: 6 }}>
            {note}
            {undo && <button type="button" onClick={undoMove} style={{ border: '1px solid var(--ca7f3d0)', background: 'transparent', color: 'var(--ca7f3d0)', borderRadius: 6, padding: '2px 8px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>{vi ? 'Hoàn tác' : 'Undo'}</button>}
          </span>
        )}
      </div>

      {activeStaff.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
          <button onClick={() => setFocus(null)} style={chip(!focus)}>{t('cal.allStaff')}</button>
          {activeStaff.map((s) => (
            <button key={s.id} onClick={() => setFocus(focus === s.id ? null : s.id)} style={chip(focus === s.id)}>{s.firstName}</button>
          ))}
          <span style={{ fontSize: 11.5, color: 'var(--c64748b)', marginLeft: 6 }}>{t('cal.dragHint')}{canArrange && !focus && columns.length > 1 ? (vi ? ' · Kéo tên thợ ở đầu cột để đổi thứ tự' : ' · Drag a name at the top of a column to reorder') : ''}</span>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>{arrangeBtn}{goneChip}<CardColorSwitch mode={colorMode} set={setColorMode} vi={vi} /></span>
        </div>
      )}

      {items.length === 0 && columns.length > 0 && (
        <div style={{ fontSize: 13, color: 'var(--c94a3b8)', margin: '0 0 8px' }}>{t('cal.noAppts')} {isPastDay ? '' : (vi ? 'Bấm vào ô trống của một thợ để đặt lịch.' : 'Click an empty slot to book.')}</div>
      )}
      {columns.length === 0 ? (
        <div style={{ ...ui.card, textAlign: 'center', color: 'var(--c64748b)', padding: '44px 0', fontSize: 14 }}>{t('cal.noAppts')}</div>
      ) : (
        <div ref={deskRef} style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', border: '1px solid var(--c1f2937)', borderRadius: 12, background: 'var(--c0f172a)', opacity: busy ? 0.6 : 1, transition: 'opacity .15s' }}>
          <div ref={innerRef} onDragOver={overGrid} onDrop={(e) => { if (colDrag) { e.preventDefault(); dropCol(); } }}
            style={{ position: 'relative', display: 'flex', minWidth: railW + columns.length * colW }}>
            <div style={{ position: 'sticky', left: 0, zIndex: 4, width: railW, flexShrink: 0, background: 'var(--c0f172a)', borderRight: '1px solid var(--c1f2937)' }}>
              <div style={{ height: headH }} />
              <div style={{ position: 'relative', height: total }}>
                {Array.from({ length: endH - startH + 1 }, (_, i) => startH + i).map((h) => (
                  <div key={h} style={{ position: 'absolute', top: (h - startH) * HP - 6, right: 7, fontSize: 11, color: 'var(--c64748b)' }}>
                    {((h % 12) || 12)}{h < 12 ? 'a' : 'p'}
                  </div>
                ))}
              </div>
            </div>

            {columns.map((c, ci) => {
              const pos = place(c.items);
              const load = c.items.filter((b) => b.status !== 'CANCELLED' && b.status !== 'NO_SHOW').length;
              const un = c.id === '__un';
              const dragged = dragId ? items.find((x) => x.id === dragId) : undefined;
              // The unassigned lane takes a time change for its own cards only.
              const canDrop = !!dragged && (!un || !dragged.assignedStaff);
              const isTarget = overCol === c.id && canDrop;
              const st = un ? undefined : activeStaff.find((x) => x.id === c.id);
              const sh = deskShift(st);
              const offToday = !un && sh.hasHours && sh.parts.length === 0;
              const hatch = 'repeating-linear-gradient(135deg, transparent 0 6px, rgba(148,163,184,0.12) 6px 7px)';
              const offBands: { s: number; e: number }[] = [];
              if (!un && sh.parts.length) {
                let cur = gStart;
                for (const x of sh.parts) { if (x.s > cur) offBands.push({ s: cur, e: x.s }); cur = Math.max(cur, x.e); }
                if (cur < endH * 60) offBands.push({ s: cur, e: endH * 60 });
              }
              const g = ghost && ghost.col === c.id ? ghost : null;
              return (
                <div key={c.id}
                  onDragOver={(e) => {
                    if (colDrag) return; // a column being carried: the grid handles it
                    if (!canDrop || !dragged) return;
                    e.preventDefault(); setOverCol(c.id);
                    const m = dropMin(e.currentTarget, e.clientY, durOf(dragged));
                    const at = m === null || Math.abs(m - minInTz(dragged.startTime)) < 15 ? minInTz(dragged.startTime) : m;
                    if (!ghost || ghost.col !== c.id || ghost.min !== at || !ghost.drag) setGhost({ col: c.id, min: at, dur: durOf(dragged), drag: true, clash: clashIn(c, dragged, at) });
                  }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setOverCol((o) => (o === c.id ? null : o)); setGhost((gh) => (gh && gh.col === c.id ? null : gh)); } }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (colDrag) return;
                    const b = dragged; setDragId(null); setOverCol(null); setGhost(null);
                    if (!b || !canDrop) return;
                    moveTo(b, dropMin(e.currentTarget, e.clientY, durOf(b)), c);
                  }}
                  style={{ flex: `1 0 ${colW}px`, minWidth: colW, borderRight: '1px solid var(--c1f2937)', background: isTarget ? 'rgba(99,102,241,0.12)' : un ? 'rgba(99,102,241,0.05)' : 'transparent', outline: isTarget ? '2px dashed #6366f1' : 'none', outlineOffset: -2,
                    position: 'relative', transform: colDrag ? `translateX(${shiftOf(c.id)}px)` : undefined, transition: colDrag ? 'transform .15s ease-out' : undefined, zIndex: colDrag === c.id ? 3 : undefined }}>
                  {colDrag === c.id && (
                    // Where the carried column will land (board 3A): striped, a purple line at its left edge.
                    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none', background: 'repeating-linear-gradient(135deg, color-mix(in srgb, #7c3aed 14%, var(--c0f172a)) 0 10px, var(--c0f172a) 10px 20px)' }}>
                      <span style={{ position: 'absolute', left: -3, top: 0, bottom: 0, width: 5, borderRadius: 3, background: '#7c3aed', boxShadow: '0 0 0 4px rgba(124,58,237,0.18)' }} />
                      <span style={{ position: 'absolute', left: -11, top: 4, width: 20, height: 20, borderRadius: '50%', background: '#7c3aed' }} />
                      <div style={{ position: 'absolute', left: 0, right: 0, top: headH + Math.min(200, total / 3), textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#8b5cf6' }}>{vi ? 'Thả vào đây' : 'Drop here'}</div>
                    </div>
                  )}
                  <div draggable={canReorderCols && !un}
                    onDragStart={canReorderCols && !un ? (e) => {
                      e.stopPropagation();
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', `col:${c.id}`);
                      dragImage(e, c, AVATAR_BG[ci % AVATAR_BG.length]);
                      colPxRef.current = (e.currentTarget.parentElement as HTMLElement | null)?.offsetWidth || colW;
                      const from = staffCols.findIndex((x) => x.id === c.id);
                      // Next frame: changing what is under the pointer while the drag starts can cancel it.
                      window.setTimeout(() => { setColDrag(c.id); setColTo(from); setGhost(null); }, 0);
                    } : undefined}
                    onDragEnd={canReorderCols && !un ? () => { setColDrag(null); setColTo(null); } : undefined}
                    title={canReorderCols && !un ? (vi ? 'Kéo sang trái / phải để đổi thứ tự cột' : 'Drag left / right to reorder') : undefined}
                    style={{ height: headH, display: 'flex', alignItems: 'center', gap: 7, padding: '0 8px', borderBottom: '1px solid var(--c1f2937)', boxSizing: 'border-box', cursor: canReorderCols && !un ? 'grab' : 'default' }}>
                    {canReorderCols && !un && <span aria-hidden="true" style={{ color: 'var(--c64748b)', fontSize: 13, letterSpacing: -2, marginRight: -2 }}>⋮⋮</span>}
                    {un ? (
                      <div style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, background: 'var(--c334155)', color: 'var(--ccbd5e1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>?</div>
                    ) : c.avatar ? (
                      <img src={c.avatar} alt="" style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, objectFit: 'cover', border: '1px solid var(--c334155)' }} />
                    ) : (
                      <div style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0, background: AVATAR_BG[ci % AVATAR_BG.length], color: '#0b1220', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>{c.name.charAt(0).toUpperCase()}</div>
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ce2e8f0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                      <div style={{ fontSize: 10.5, color: offToday ? 'var(--ink-warn)' : 'var(--c64748b)' }}>{load} {t('cal.apptWord')}{offToday ? (vi ? ' · nghỉ hôm nay' : ' · off today') : ''}</div>
                    </div>
                  </div>
                  <div data-body="1" style={{ position: 'relative', height: total, cursor: isPastDay ? 'default' : 'cell' }}
                    onMouseMove={(e) => {
                      if (dragId || isPastDay) return;
                      if ((e.target as HTMLElement).closest('[data-card]')) { if (g) setGhost(null); return; }
                      const m = Math.floor(minAt(e.currentTarget, e.clientY) / 15) * 15;
                      if (isToday && m + 15 <= nowMin) { if (g) setGhost(null); return; }
                      if (!g || g.min !== m || g.drag) setGhost({ col: c.id, min: m, dur: 30, drag: false });
                    }}
                    onMouseLeave={() => { if (!dragId) setGhost((gh) => (gh && gh.col === c.id ? null : gh)); }}
                    onClick={(e) => {
                      if (isPastDay || (e.target as HTMLElement).closest('[data-card]')) return;
                      const m = Math.floor(minAt(e.currentTarget, e.clientY) / 15) * 15;
                      if (isToday && m + 15 <= nowMin) return;
                      bookAt(c.id, m);
                    }}>
                    {offToday && <div style={{ position: 'absolute', inset: 0, background: hatch, pointerEvents: 'none' }} />}
                    {offBands.map((x) => (
                      <div key={x.s} style={{ position: 'absolute', left: 0, right: 0, top: (x.s - gStart) / 60 * HP, height: (x.e - x.s) / 60 * HP, background: hatch, pointerEvents: 'none' }} />
                    ))}
                    {Array.from({ length: endH - startH }, (_, i) => i + 1).map((i) => (
                      <div key={i} style={{ position: 'absolute', top: i * HP, left: 0, right: 0, borderTop: '1px solid var(--line)', pointerEvents: 'none' }} />
                    ))}
                    {g && (() => {
                      // The "+ đặt lịch" slot shows only in real free time: it stops at the next card (board 1B).
                      const next = g.drag ? Infinity : Math.min(Infinity, ...pos.filter((p) => p.s > g.min).map((p) => p.s));
                      const gh = Math.max(16, (Math.min(g.min + g.dur, next) - g.min) / 60 * HP - 3);
                      const short = gh < 24;
                      return (
                        <div style={{ position: 'absolute', top: (g.min - gStart) / 60 * HP, height: gh, left: 3, right: 3, boxSizing: 'border-box', borderRadius: 8, border: `1.5px dashed ${g.clash ? '#ef4444' : '#6366f1'}`, background: g.clash ? 'rgba(239,68,68,0.12)' : 'rgba(99,102,241,0.10)', color: g.clash ? 'var(--ink-bad)' : 'var(--ink-link)', fontSize: short ? 11 : 11.5, fontWeight: 700, padding: short ? '0 7px' : '3px 7px', display: short ? 'flex' : 'block', alignItems: 'center', lineHeight: short ? 1 : undefined, overflow: 'hidden', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 2 }}>
                          {g.drag ? `${clock(g.min)} – ${clock(g.min + g.dur)}${g.clash ? (vi ? ' · trùng lịch' : ' · clash') : ''}` : `+ ${clock(g.min)} · ${ind(vi ? 'đặt lịch' : 'book')}`}
                        </div>
                      );
                    })()}
                    {pos.map(({ b, s, e, col, cols }) => {
                      const cc = sc(b.status);
                      const topPx = (s - gStart) / 60 * HP;
                      const h = Math.max(20, (e - s) / 60 * HP - 3);
                      const dim = b.status === 'CANCELLED' || b.status === 'NO_SHOW';
                      const w = 100 / cols;
                      const tier = cardTier(h, 'sm');
                      // One technician (or one in focus): the column is the screen — the card reads across (board 1B).
                      const wide = tier >= 3 && deskW > 0 && (Math.max(colW, (deskW - railW) / Math.max(1, columns.length)) * w) / 100 - 6 >= WIDE_CARD_PX;
                      const face: CardFace = { ...faceOf(b, s, e, vi, t), source: wide ? <SourceChip b={b} vi={vi} /> : <MiniSrc b={b} vi={vi} /> };
                      const look = cardLook(face, colorMode, cc);
                      return (
                        <div key={b.id} data-card="1" draggable={!dim} onDragStart={(ev) => { setDragId(b.id); setGhost(null); grab.current = ((ev.clientY - ev.currentTarget.getBoundingClientRect().top) / HP) * 60; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', b.id); }} onDragEnd={() => { setDragId(null); setOverCol(null); setGhost(null); }}
                          onClick={() => onOpen(b)} onContextMenu={onCtx ? (ev) => { ev.preventDefault(); onCtx(b, ev.clientX, ev.clientY); } : undefined}
                          title={[face.name, face.service, face.phone, face.range].filter(Boolean).join(' · ')}
                          style={{ position: 'absolute', top: topPx, height: h, left: `calc(${col * w}% + 3px)`, width: `calc(${w}% - 6px)`, boxSizing: 'border-box', background: look.background, border: look.border, ...(wide ? { borderLeft: `4px solid ${look.solid ? 'rgba(255,255,255,0.65)' : cc}` } : {}), borderRadius: 8, padding: wide ? '10px 14px' : cardPad(tier, 'sm'), display: 'flex', flexDirection: 'column', justifyContent: tier === 1 ? 'center' : 'flex-start', gap: 2, overflow: 'hidden', cursor: dim ? 'pointer' : 'grab', opacity: dragId === b.id ? 0.4 : 1 }}>
                          <CardBody f={face} tier={tier} size="sm" look={look} wide={wide} vi={vi} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {nowTop >= 0 && (
              <div style={{ position: 'absolute', top: headH + nowTop, left: railW, right: 0, height: 0, borderTop: '2px solid #ef4444', zIndex: 5, pointerEvents: 'none' }}>
                <span style={{ position: 'absolute', left: 0, top: -4, width: 7, height: 7, borderRadius: '50%', background: '#ef4444' }} />
              </div>
            )}
          </div>
        </div>
      )}
      {colDrag ? (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12.5, marginTop: 10 }}>
          <span style={{ padding: '6px 10px', borderRadius: 8, background: 'var(--c111827)', border: '1px solid var(--c1f2937)', color: 'var(--ccbd5e1)' }}>{vi ? 'Thứ tự trước' : 'Before'}: {staffCols.map((x) => x.name).join(' · ')}</span>
          <span style={{ padding: '6px 10px', borderRadius: 8, background: 'color-mix(in srgb, #7c3aed 12%, transparent)', border: '1px solid color-mix(in srgb, #7c3aed 35%, transparent)', color: 'var(--ce2e8f0)', fontWeight: 600 }}>
            {vi ? 'Sau khi thả' : 'After the drop'}: {previewCols.filter((x) => x.id !== '__un').map((x) => x.name).join(' · ')} — {vi ? 'lưu cho cả tiệm' : 'saved for the whole salon'}
          </span>
        </div>
      ) : (
        <p style={{ color: 'var(--c64748b)', fontSize: 12, marginTop: 10 }}>{t('cal.staffHint')}</p>
      )}
      {sheetEl}
    </div>
  );
}

function chip(active: boolean): React.CSSProperties {
  return { padding: '4px 11px', borderRadius: 999, fontSize: 12, cursor: 'pointer', fontWeight: 600, border: `1px solid ${active ? '#6366f1' : 'var(--c334155)'}`, background: active ? '#6366f1' : 'transparent', color: active ? '#fff' : 'var(--c94a3b8)' };
}

// White text on a coloured (never themed) block: the block's hue is the
// booking's status, so light mode does not flip it.
const onHue = (bg: string): React.CSSProperties => ({ background: bg, color: '#fff' });

/** The source on a calendar card: brand colour + name, one line, 15px tall. */
function MiniSrc({ b, vi }: { b: { source?: string | null; utmSource?: string | null; attrReferrer?: string | null; attrLandingUrl?: string | null }; vi: boolean }) {
  const m = srcMetaOf(b);
  const label = vi ? m.labelVi : m.labelEn;
  return (
    <span title={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, height: 15, padding: '0 6px', borderRadius: 999, background: `${m.color}1f`, color: m.color, fontSize: 9.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', minWidth: 0, flexShrink: 1 }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </span>
  );
}
