'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SourceDot } from '../../../components/SourceChip';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang, tr } from '../../../lib/i18n';
import { uiLocale, wallToInstantISO } from '../../../lib/datetime';

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
export function StaffDayView({ date, items, tz, isMobile, onOpen, today, onChanged }: {
  date: Date; items: Booking[]; tz?: string; isMobile: boolean; onOpen: (b: Booking) => void; today: Date; onChanged?: () => void;
}) {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);
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

  const activeStaff = useMemo(
    () => staff.filter((s) => s.isActive && s.takesAppointments !== false).sort((a, b) => a.firstName.localeCompare(b.firstName)),
    [staff],
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
  const HP = isMobile ? 52 : 62;
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
      await apiFetch(`/bookings/${b.id}/move`, { method: 'POST', token, body: { startTime: target === orig ? b.startTime : wallToInstantISO(wall(target), tz), ...(toTech ? { staffId: col.id } : {}) } });
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
      await apiFetch(`/bookings/${u.id}/move`, { method: 'POST', token, body: { startTime: u.startTime, staffId: u.staffId } });
      flash(vi ? 'Đã hoàn tác' : 'Undone');
      onChanged?.();
    } catch (e) {
      flash(e instanceof Error ? e.message : t('cal.reassignFail'), 5000);
    } finally { setBusy(false); }
  };
  const bookAt = (colId: string, m: number) => {
    const q = new URLSearchParams({ new: '1', at: wall(m) });
    if (colId !== '__un') q.set('staff', colId);
    window.location.href = `/salon/bookings?${q.toString()}`;
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
    const labelStep = aSpan > 8 * 60 ? 2 : 1;
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
          if (gap >= 30) return { text: `${vi ? 'Trống đến' : 'Free until'} ${hm(span(next).s)} · ${vi ? 'nhận khách vãng lai được' : 'can take a walk-in'}`, tone: 'good' };
          return { text: `${vi ? 'Kế tiếp' : 'Next'} ${hm(span(next).s)} · ${custName(next)}`, tone: 'muted' };
        }
        if (n === 0) return { text: vi ? 'Trống cả ngày' : 'Free all day', tone: 'good' };
        if (r.shift && nowMin >= shiftEnd) return { text: vi ? 'Đã xong ca' : 'Shift over', tone: 'muted' };
        return { text: `${vi ? 'Trống đến hết ca' : 'Free for the rest of the shift'} · ${vi ? 'nhận khách vãng lai được' : 'can take a walk-in'}`, tone: 'good' };
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

    const dayBar = (r: Row) => (
      <div style={{ position: 'relative', height: 24, borderRadius: 5, overflow: 'hidden', background: 'var(--c0b1120)', border: '1px solid var(--c1f2937)' }}>
        {r.shift && <span style={{ position: 'absolute', left: `${pct(r.shift.s)}%`, width: `${pct(r.shift.e) - pct(r.shift.s)}%`, top: 0, bottom: 0, background: 'rgba(148,163,184,0.2)' }} />}
        {hours.slice(1, -1).map((h) => <span key={h} style={{ position: 'absolute', left: `${pct(h)}%`, top: 0, bottom: 0, width: 1, background: 'var(--c243044)' }} />)}
        {r.live.map((b) => {
          const { s, e } = span(b);
          const w = Math.max(pct(e) - pct(s), 3);
          return (
            <span key={b.id} style={{ position: 'absolute', left: `${pct(s)}%`, width: `${w}%`, top: 2, bottom: 2, borderRadius: 4, fontSize: 10, fontWeight: 700, lineHeight: '20px', paddingLeft: 4, boxSizing: 'border-box', whiteSpace: 'nowrap', overflow: 'hidden', ...onHue(barColor(b.status)) }}>{hm(s)}</span>
          );
        })}
        {nowPct >= 0 && <span style={{ position: 'absolute', left: `${nowPct}%`, top: -3, bottom: -3, width: 2, background: '#f43f5e' }} />}
      </div>
    );

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
          {onShift.length === 0 && unassigned.length === 0 ? (
            <div style={{ ...ui.card, textAlign: 'center', color: 'var(--c64748b)', padding: '36px 0', fontSize: 14 }}>{items.length === 0 ? t('cal.noAppts') : (vi ? 'Chưa có thợ nào làm hôm nay.' : 'No technician on shift today.')}</div>
          ) : (
            <div style={{ position: 'relative', height: 14, margin: '0 12px 0 58px', fontSize: 10.5, color: 'var(--c64748b)' }}>
              {hours.filter((h, i) => i % labelStep === 0 && (i === hours.length - 1 || i + labelStep <= hours.length - 1 || labelStep === 1)).map((h, i, arr) => (
                <span key={h} style={{ position: 'absolute', left: `${pct(h)}%`, transform: i === 0 ? 'none' : i === arr.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)', whiteSpace: 'nowrap' }}>{hm(h)}</span>
              ))}
            </div>
          )}
          {unassigned.length > 0 && (
            <div style={{ ...card, cursor: 'default', border: '1px dashed var(--c7c5c22)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 36, height: 36, flexShrink: 0, borderRadius: '50%', background: 'var(--c334155)', color: 'var(--ccbd5e1)', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>?</span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{t('cal.unassignedCol')}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--ink-warn)', fontWeight: 600 }}>{vi ? 'Bấm vào lịch để chọn thợ' : 'Tap a booking to pick a technician'}</span>
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{unassigned.length} {t('cal.apptWord')}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {unassigned.map((b) => (
                  <button key={b.id} type="button" onClick={() => onOpen(b)} style={{ height: 30, padding: '0 10px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: barColor(b.status), fontWeight: 700 }}>{hm(span(b).s)}</span>{custName(b)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {onShift.map((r) => {
            const st = statusLine(r);
            return (
              <button key={r.id} type="button" onClick={() => setFocus(r.id)} style={card}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {avatar(r, 36, 14)}
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.name}{r.shift && <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--c94a3b8)' }}> · {vi ? 'ca' : 'shift'} {hm(r.shift.s)}–{hm(r.shift.e)}</span>}
                    </span>
                    <span style={{ fontSize: 12.5, color: toneColor(st.tone), fontWeight: st.tone === 'good' ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{st.text}</span>
                  </span>
                  <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{r.live.length} {t('cal.apptWord')}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--c64748b)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
                </div>
                {dayBar(r)}
              </button>
            );
          })}
          {offToday.map((r) => (
            <button key={r.id} type="button" onClick={() => setFocus(r.id)} style={{ boxSizing: 'border-box', padding: '10px 12px', borderRadius: 14, border: '1px dashed var(--c243044)', background: 'transparent', display: 'flex', alignItems: 'center', gap: 10, opacity: 0.7, width: '100%', textAlign: 'left', cursor: 'pointer' }}>
              <span style={{ width: 36, height: 36, flexShrink: 0, borderRadius: '50%', background: 'var(--c1e293b)', color: 'var(--c94a3b8)', fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{r.name.charAt(0).toUpperCase()}</span>
              <span style={{ flex: 1, fontSize: 14, color: 'var(--c94a3b8)' }}>{r.name} · {vi ? 'nghỉ hôm nay' : 'off today'}</span>
            </button>
          ))}
          {onShift.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', padding: '2px 2px 8px', fontSize: 11.5, color: 'var(--c94a3b8)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 18, height: 10, borderRadius: 3, background: 'rgba(148,163,184,0.2)', border: '1px solid var(--c243044)' }} />{vi ? 'Ca làm' : 'Shift'}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 18, height: 10, borderRadius: 3, background: '#4f46e5' }} />{vi ? 'Đang làm' : 'In progress'}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 18, height: 10, borderRadius: 3, background: '#3b82f6' }} />{vi ? 'Đã đặt' : 'Booked'}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 18, height: 10, borderRadius: 3, background: '#b45309' }} />{vi ? 'Chờ xác nhận' : 'Pending'}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 18, height: 10, borderRadius: 3, background: '#0f766e' }} />{vi ? 'Xong' : 'Done'}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 2, height: 12, background: '#f43f5e' }} />{vi ? 'Bây giờ' : 'Now'}</span>
            </div>
          )}
        </div>
      );
    }

    // ── Board 4: one technician, full-width column ──
    const order = [...onShift, ...offToday];
    const idx = order.findIndex((r) => r.id === focusRow.id);
    const go = (d: number) => { const n = order[(idx + d + order.length) % order.length]; if (n) setFocus(n.id); };
    const r = focusRow;
    const rev = r.live.reduce((s, b) => s + b.priceCents, 0);
    // Column range: the shift (or the shared axis), stretched to fit bookings.
    let cS = r.shift?.s ?? aS, cE = r.shift?.e ?? aE;
    for (const b of r.live) { const { s, e } = span(b); cS = Math.min(cS, s); cE = Math.max(cE, e); }
    cS = Math.floor(cS / 60) * 60; cE = Math.ceil(cE / 60) * 60; if (cE - cS < 4 * 60) cE = cS + 4 * 60;
    const H = 68; // px per hour — the mockup's column
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

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
        onTouchStart={(e) => { const tch = e.touches[0]; swipe.current = { x: tch.clientX, y: tch.clientY }; }}
        onTouchEnd={(e) => {
          const st = swipe.current; swipe.current = null; if (!st) return;
          const tch = e.changedTouches[0]; const dx = tch.clientX - st.x, dy = tch.clientY - st.y;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
        }}>
        {note && <div style={{ fontSize: 13, color: 'var(--ca7f3d0)', background: 'var(--c064e3b)', padding: '6px 10px', borderRadius: 8 }}>{note}</div>}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', alignItems: 'center', scrollbarWidth: 'none', paddingBottom: 2 }}>
          <button type="button" onClick={() => setFocus(null)} aria-label={t('cal.allStaff')} style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 999, border: '1px solid var(--c243044)', background: 'var(--c111827)', color: 'var(--ccbd5e1)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          {order.map((o) => (
            <button key={o.id} type="button" onClick={() => setFocus(o.id)}
              style={o.id === r.id
                ? { flexShrink: 0, height: 34, padding: '0 10px 0 4px', borderRadius: 999, border: 'none', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', background: '#4f46e5', color: '#fff' }
                : { flexShrink: 0, height: 34, padding: '0 10px 0 4px', borderRadius: 999, border: '1px solid var(--c243044)', background: 'var(--c111827)', color: 'var(--ce2e8f0)', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              {avatar(o, 26, 11)}{o.name}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {avatar(r, 40, 16)}
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--cf1f5f9)' }}>{r.name}</span>
            <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>
              {r.live.length} {t('cal.apptWord')}{rev > 0 && <> · {formatPrice(rev, currency).replace(/[.,]00(?=\D*$)/, '')}</>}
              {firstGap ? <> · {vi ? 'trống' : 'free'} {hm(firstGap.s)}–{hm(firstGap.e)}</> : r.shift && !r.live.length ? <> · {vi ? 'nghỉ hôm nay' : 'off today'}</> : null}
            </span>
          </span>
          <a href={bookHref} style={{ height: 36, padding: '0 12px', borderRadius: 10, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', textDecoration: 'none', whiteSpace: 'nowrap', background: '#4f46e5', color: '#fff' }}>+ {vi ? `Đặt cho ${r.name}` : `Book ${r.name}`}</a>
        </div>
        <div style={{ borderRadius: 14, background: 'var(--c111827)', border: '1px solid var(--c1f2937)', overflow: 'hidden', display: 'flex', opacity: busy ? 0.6 : 1 }}>
          <div style={{ width: 48, flexShrink: 0, borderRight: '1px solid var(--c1f2937)', position: 'relative', height: colH }}>
            {Array.from({ length: (cE - cS) / 60 }, (_, i) => cS + i * 60).map((h) => (
              <span key={h} style={{ position: 'absolute', top: y(h) + 4, left: 8, fontSize: 11, color: 'var(--c64748b)' }}>{hm(h)}</span>
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
                style={{ position: 'absolute', left: 6, right: 6, top: y(g.s) + 3, height: Math.max(28, y(g.e) - y(g.s) - 6), boxSizing: 'border-box', borderRadius: 10, border: '1px dashed var(--c334155)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, color: 'var(--c64748b)', textDecoration: 'none' }}>
                + {vi ? 'Trống' : 'Free'} {hm(g.s)} – {hm(g.e)} · {vi ? 'chạm để đặt' : 'tap to book'}
              </a>
            ))}
            {lanes.map(({ b, s, e, col, cols }) => {
              const cc = barColor(b.status);
              const w = 100 / cols;
              const h = Math.max(48, y(e) - y(s) - 6);
              const stLabel = b.status === 'ARRIVED' ? (vi ? 'Đã đến · đang làm' : 'Arrived · in progress')
                : b.status === 'COMPLETED' ? (vi ? 'Đã xong' : 'Done')
                : (b.status === 'PENDING' || b.status === 'ASSIGNED' || b.status === 'REJECTED') ? (vi ? 'Chờ xác nhận' : 'Pending')
                : '';
              return (
                <div key={b.id} onClick={() => onOpen(b)}
                  style={{ position: 'absolute', top: y(s) + 3, height: h, left: `calc(${col * w}% + 6px)`, width: `calc(${w}% - 12px)`, boxSizing: 'border-box', padding: '6px 10px', borderRadius: 10, background: `${cc}22`, border: `1px solid ${cc}`, display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1.25, overflow: 'hidden', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: cc, whiteSpace: 'nowrap' }}>{hm(s)} – {hm(e)}</span>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: cc, whiteSpace: 'nowrap' }}>{formatPrice(b.priceCents, b.currency).replace(/[.,]00(?=\D*$)/, '')}</span>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--cf1f5f9)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{custName(b)}{b.partySize != null && b.partySize > 1 ? ` ×${b.partySize}` : ''}</span>
                  {h >= 58 && <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.service?.name ?? ''}</span>}
                  {h > 84 && stLabel && <span style={{ fontSize: 11.5, color: cc, marginTop: 'auto' }}>{stLabel}</span>}
                </div>
              );
            })}
            {r.items.filter((b) => isGone(b.status)).map((b) => {
              const { s } = span(b);
              return <div key={b.id} onClick={() => onOpen(b)} style={{ position: 'absolute', left: 6, right: 6, top: y(s) + 3, height: 24, boxSizing: 'border-box', padding: '0 10px', borderRadius: 8, background: 'var(--c18202f)', border: '1px solid var(--c334155)', fontSize: 11.5, color: 'var(--c64748b)', display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'line-through', cursor: 'pointer' }}>{hm(s)} · {custName(b)}</div>;
            })}
            {colNow >= 0 && (
              <div style={{ position: 'absolute', left: 0, right: 0, top: colNow, borderTop: '2px solid #f43f5e', pointerEvents: 'none' }}>
                <span style={{ position: 'absolute', left: -5, top: -5, width: 8, height: 8, borderRadius: '50%', background: '#f43f5e' }} />
              </div>
            )}
          </div>
        </div>
        <span style={{ fontSize: 12, color: 'var(--c64748b)', padding: '2px 0 8px' }}>{vi ? 'Vuốt trái/phải để sang thợ khác · Đổi thợ cho một lịch: mở lịch → “Đổi thợ”.' : 'Swipe left/right for the next technician · To reassign one booking: open it → “Change tech”.'}</span>
      </div>
    );
  }

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
          <span style={{ fontSize: 11.5, color: 'var(--c64748b)', marginLeft: 6 }}>{t('cal.dragHint')}</span>
        </div>
      )}

      {items.length === 0 && columns.length > 0 && (
        <div style={{ fontSize: 13, color: 'var(--c94a3b8)', margin: '0 0 8px' }}>{t('cal.noAppts')} {isPastDay ? '' : (vi ? 'Bấm vào ô trống của một thợ để đặt lịch.' : 'Click an empty slot to book.')}</div>
      )}
      {columns.length === 0 ? (
        <div style={{ ...ui.card, textAlign: 'center', color: 'var(--c64748b)', padding: '44px 0', fontSize: 14 }}>{t('cal.noAppts')}</div>
      ) : (
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', border: '1px solid var(--c1f2937)', borderRadius: 12, background: 'var(--c0f172a)', opacity: busy ? 0.6 : 1, transition: 'opacity .15s' }}>
          <div style={{ position: 'relative', display: 'flex', minWidth: railW + columns.length * colW }}>
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
                    if (!canDrop || !dragged) return;
                    e.preventDefault(); setOverCol(c.id);
                    const m = dropMin(e.currentTarget, e.clientY, durOf(dragged));
                    const at = m === null || Math.abs(m - minInTz(dragged.startTime)) < 15 ? minInTz(dragged.startTime) : m;
                    if (!ghost || ghost.col !== c.id || ghost.min !== at || !ghost.drag) setGhost({ col: c.id, min: at, dur: durOf(dragged), drag: true, clash: clashIn(c, dragged, at) });
                  }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setOverCol((o) => (o === c.id ? null : o)); setGhost((gh) => (gh && gh.col === c.id ? null : gh)); } }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const b = dragged; setDragId(null); setOverCol(null); setGhost(null);
                    if (!b || !canDrop) return;
                    moveTo(b, dropMin(e.currentTarget, e.clientY, durOf(b)), c);
                  }}
                  style={{ flex: `1 0 ${colW}px`, minWidth: colW, borderRight: '1px solid var(--c1f2937)', background: isTarget ? 'rgba(99,102,241,0.12)' : un ? 'rgba(99,102,241,0.05)' : 'transparent', outline: isTarget ? '2px dashed #6366f1' : 'none', outlineOffset: -2 }}>
                  <div style={{ height: headH, display: 'flex', alignItems: 'center', gap: 7, padding: '0 8px', borderBottom: '1px solid var(--c1f2937)', boxSizing: 'border-box' }}>
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
                    {g && (
                      <div style={{ position: 'absolute', top: (g.min - gStart) / 60 * HP, height: Math.max(22, g.dur / 60 * HP - 3), left: 3, right: 3, boxSizing: 'border-box', borderRadius: 8, border: `1.5px dashed ${g.clash ? '#ef4444' : '#6366f1'}`, background: g.clash ? 'rgba(239,68,68,0.12)' : 'rgba(99,102,241,0.10)', color: g.clash ? 'var(--ink-bad)' : 'var(--ink-link)', fontSize: 11.5, fontWeight: 700, padding: '3px 7px', pointerEvents: 'none', zIndex: 2 }}>
                        {g.drag ? `${clock(g.min)} – ${clock(g.min + g.dur)}${g.clash ? (vi ? ' · trùng lịch' : ' · clash') : ''}` : `+ ${clock(g.min)} · ${vi ? 'đặt lịch' : 'book'}`}
                      </div>
                    )}
                    {pos.map(({ b, s, e, col, cols }) => {
                      const cc = sc(b.status);
                      const topPx = (s - gStart) / 60 * HP;
                      const h = Math.max(38, (e - s) / 60 * HP - 3);
                      const dim = b.status === 'CANCELLED' || b.status === 'NO_SHOW';
                      const w = 100 / cols;
                      const paid = paidOf(b);
                      const sm = srcMeta(b.source, t);
                      const dep = paid > 0 ? (paid >= b.priceCents && b.priceCents > 0 ? t('cal.paidFull') : t('cal.deposit')) : '';
                      return (
                        <div key={b.id} data-card="1" draggable={!dim} onDragStart={(ev) => { setDragId(b.id); setGhost(null); grab.current = ((ev.clientY - ev.currentTarget.getBoundingClientRect().top) / HP) * 60; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', b.id); }} onDragEnd={() => { setDragId(null); setOverCol(null); setGhost(null); }}
                          onClick={() => onOpen(b)} title={`${fmtT(b.startTime)} · ${b.customer?.firstName ?? ''} · ${b.service?.name ?? ''}`}
                          style={{ position: 'absolute', top: topPx, height: h, left: `calc(${col * w}% + 3px)`, width: `calc(${w}% - 6px)`, boxSizing: 'border-box', background: dim ? 'var(--c18202f)' : `${cc}22`, border: `1px solid ${cc}66`, borderRadius: 8, padding: '3px 7px', overflow: 'hidden', cursor: dim ? 'pointer' : 'grab', opacity: dim ? 0.7 : dragId === b.id ? 0.4 : 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 4 }}>
                            <span style={{ fontSize: 10.5, fontWeight: 600, color: cc, whiteSpace: 'nowrap' }}>{fmtT(b.startTime)}</span>
                            <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--ccbd5e1)', whiteSpace: 'nowrap' }}>{formatPrice(b.priceCents, b.currency)}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ce2e8f0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: b.status === 'CANCELLED' ? 'line-through' : 'none' }}>
                              {b.customer ? `${b.customer.firstName}${b.customer.lastName ? ' ' + b.customer.lastName : ''}` : '—'}
                            </span>
                            <span style={{ display: 'flex', gap: 3, alignItems: 'center', flexShrink: 0 }}>
                              {b.partySize != null && b.partySize > 1 && <span title={t('cal.dParty')} style={{ fontSize: 9, fontWeight: 600, color: 'var(--ce2e8f0)', background: 'var(--c475569)', borderRadius: 4, padding: '0 3px', lineHeight: '13px' }}>×{b.partySize}</span>}
                              {paid > 0 && <span title={`${dep} · ${formatPrice(paid, b.currency)}`} style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e' }} />}
                              <SourceDot b={b} vi={true} />
                            </span>
                          </div>
                          {h > 48 && <div style={{ fontSize: 11, color: 'var(--c94a3b8)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.service?.name ?? ''}</div>}
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
      <p style={{ color: 'var(--c64748b)', fontSize: 12, marginTop: 10 }}>{t('cal.staffHint')}</p>
    </div>
  );
}

function chip(active: boolean): React.CSSProperties {
  return { padding: '4px 11px', borderRadius: 999, fontSize: 12, cursor: 'pointer', fontWeight: 600, border: `1px solid ${active ? '#6366f1' : 'var(--c334155)'}`, background: active ? '#6366f1' : 'transparent', color: active ? '#fff' : 'var(--c94a3b8)' };
}

// White text on a coloured (never themed) block: the block's hue is the
// booking's status, so light mode does not flip it.
const onHue = (bg: string): React.CSSProperties => ({ background: bg, color: '#fff' });
