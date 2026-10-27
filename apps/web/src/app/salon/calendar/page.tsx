'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UnassignedBanner, UnassignedHelp } from '../../../components/UnassignedHelp';
import { SourceChip, SourceDot } from '../../../components/SourceChip';
import { srcKey, srcMetaOf, sourceCounts } from '../../../lib/booking-sources';
import { SalonShell } from '../../../components/SalonShell';
import { FloorView } from '../../../components/FloorView';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { fmtPhone } from '../../../lib/cal-card';
import { useLang, tr, DAY_LABEL } from '../../../lib/i18n';
import { missedMinutes } from '../../../lib/missed';
import { useLiveRefresh } from '../../../lib/useLiveRefresh';
import { useLiveTopics } from '../../../lib/useLiveEvents';
import { useIsMobile } from '../../../lib/responsive';
import { StaffDayView } from './StaffDayView';
import { wallToInstantISO, instantToWall } from '../../../lib/datetime';
import { todayInZone } from '../../../lib/salon-clock';
import { TableDayView } from './TableDayView';
import { uiLocale } from '../../../lib/datetime';
import { DateTimeField } from '../../../components/DateTimeField';
import { ind } from '../../../lib/ui-industry';
import { withHoursOverride } from '../../../lib/desk-hours';
import { ListView, type ShiftStaffFull } from './ListView';
import { C, Seg, IconBtn, Icon, btn, onIndigo, Popover, Sheet, DayStrip, MonthPicker, FilterBody, FilterFooter, ActiveChips, type DayInfo } from './CalParts';
import { applyFilters, facetCounts, activeFilterCount, NO_FILTERS, stripDays, suggestStart, isClosedDay, capacityMinutes, loadOf, bookedMinutes, addDays, type CalFilters, type HoursDay } from '../../../lib/cal-day';
import { minutesInZone } from '../../../lib/salon-card';
import { NewBookingModal, type NewBookingPrefill } from '../../../components/NewBookingModal';
import { ClientFormsPanel } from '../../../components/forms/ClientFormsPanel';
import { VisitContactEditor } from '../../../components/VisitContactEditor';
import { notify } from '../../../lib/feedback';

interface Addon { id: string; name: string; priceCents: number; durationMinutes?: number; kind?: string; staffMemberId?: string }
/** Pill/label text: primary service plus a +N badge for the extra lines. */
function svcLabel(b: Booking): string {
  const n = (b.addons ?? []).filter((a) => a.kind === 'service').length;
  return b.service?.name ? `${b.service.name}${n > 0 ? ` +${n}` : ''}` : '';
}

interface Booking {
  id: string;
  status: string;
  /** Set by "Adjust visit" when a visit that already started now overlaps the technician's next booking. */
  stretchWarning?: string | null;
  startTime: string;
  endTime: string;
  priceCents: number;
  currency: string;
  notes: string | null;
  /** Where it happens when not at the business (a property to view, a client's home). */
  location?: string | null;
  preferredStaff?: { id: string; firstName: string; lastName: string | null } | null;
  source?: string | null;
  utmSource?: string | null;
  attrReferrer?: string | null;
  /**
   * The URL the customer landed on. Carried because it is the ONLY evidence
   * left when a Google Maps arrival has no utm (the salon has not pasted the
   * /gbp link yet) and no referrer (the Maps app opens links in an in-app
   * browser, which has none). See fromLanding in lib/booking-sources.
   */
  attrLandingUrl?: string | null;
  cancelledBy?: string | null;
  cancelledByName?: string | null;
  device?: string | null;
  partySize?: number;
  // Shared by everyone booked together, so four rows at 2 PM can be drawn as
  // one table instead of four strangers who happen to collide.
  groupId?: string | null;
  addons?: Addon[];
  payments?: { status: string; amountCents: number; type?: string; createdAt?: string }[];
  customer: { id: string; firstName: string; lastName: string | null; email: string | null; phone: string | null } | null;
  service: { id: string; name: string; durationMinutes: number } | null;
  assignedStaff: { id: string; firstName: string; lastName: string | null } | null;
  tableId?: string | null;
  table?: { id: string; name: string; seats: number } | null;
}

/**
 * "👥 2/3": this booking is the second of three made together, so the desk
 * can see at a glance which rows of the day belong to one party and whether
 * the whole party is on the page. A lone booking shows nothing.
 */
function partyLabel(b: { id: string; groupId?: string | null }, all: { id: string; groupId?: string | null; startTime: string; createdAt?: string }[]): string {
  if (!b.groupId) return '';
  const mates = all.filter((x) => x.groupId === b.groupId).sort((x, y) => +new Date(x.startTime) - +new Date(y.startTime) || x.id.localeCompare(y.id));
  const i = mates.findIndex((x) => x.id === b.id);
  return mates.length > 1 && i >= 0 ? ` 👥 ${i + 1}/${mates.length}` : ' 👥';
}

// Six operational buckets the front desk actually tracks. The 8 raw enum values
// fold into these so the calendar reads at a glance (key → bilingual label via
// `cal.st<Key>`; color → dot/stripe).
const STATUS_BUCKETS: { key: string; color: string }[] = [
  { key: 'Pending', color: 'var(--ink-warn)' },
  { key: 'Confirmed', color: '#3b82f6' },
  { key: 'Arrived', color: '#10b981' },
  { key: 'Completed', color: '#8b5cf6' },
  { key: 'NoShow', color: 'var(--ink-bad)' },
  { key: 'Cancelled', color: 'var(--c64748b)' },
  // A still-open booking an hour past its start: nobody came (yet).
  { key: 'Missed', color: '#f97316' },
];
function statusBucket(status: string, startTime?: string): { key: string; color: string } {
  if (startTime && missedMinutes({ status, startTime }) !== null) return STATUS_BUCKETS[6];
  switch (status) {
    case 'PENDING': case 'ASSIGNED': case 'REJECTED': return STATUS_BUCKETS[0];
    case 'ACCEPTED': case 'CONFIRMED': return STATUS_BUCKETS[1];
    case 'ARRIVED': return STATUS_BUCKETS[2];
    case 'COMPLETED': return STATUS_BUCKETS[3];
    case 'NO_SHOW': return STATUS_BUCKETS[4];
    case 'CANCELLED': return STATUS_BUCKETS[5];
    default: return STATUS_BUCKETS[0];
  }
}

export default function CalendarPage() {
  return <SalonShell><Inner /></SalonShell>;
}

function Inner() {
  const { token, user } = useAuth();
  // Only the owner may put a booking outside opening hours on purpose.
  const isOwner = user?.role === 'SALON_ADMIN' || user?.role === 'SUPER_ADMIN';
  const { lang } = useLang();
  const isMobile = useIsMobile();
  const t = (k: string) => tr(k, lang);
  const locale = uiLocale(); // dates always render US month/day/year
  const [bookings, setBookings] = useState<Booking[]>([]);
  /** The booking pop-up, with the time / technician the clicked link carried. */
  const [newBook, setNewBook] = useState<NewBookingPrefill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Booking | null>(null);
  // Right-click context menu on a booking chip: { screen position, booking }.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; b: Booking } | null>(null);
  const [search, setSearch] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  // "Today" is the SALON's calendar day, not the viewer's — from Vietnam the
  // browser is already on tomorrow while the Austin salon is still serving.
  const today = useMemo(() => todayInZone(typeof window !== 'undefined' ? window.localStorage.getItem('lumio_tz') : null), []);
  const [view, setView] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  // Month grid vs. detailed single-day timeline.
  const [mode, setMode] = useState<'month' | 'day' | 'staff' | 'floor'>('month');
  // The view is remembered per device. With no memory yet, the new layout
  // opens on the day by technician (what the front desk works from); the
  // classic layout keeps the month it always opened on.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem('lumio_cal_mode');
      if (v === 'month' || v === 'day' || v === 'staff') setMode(v);
      else if (window.localStorage.getItem('lumio_ui2') === '1') setMode('staff');
    } catch { /* ignore */ }
  }, []);
  const modeSeen = useRef(false);
  const weekSwipe = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    // Not the first render: that is the default, not a choice.
    if (!modeSeen.current) { modeSeen.current = true; return; }
    if (mode === 'floor') return;
    try { window.localStorage.setItem('lumio_cal_mode', mode); } catch { /* ignore */ }
  }, [mode]);
  // Day view: a scannable card grid (best for busy days) or a time-axis timeline.
  const [dayLayout, setDayLayout] = useState<'grid' | 'timeline'>(() => {
    if (typeof window === 'undefined') return 'grid';
    return window.localStorage.getItem('lumio_day_layout') === 'timeline' ? 'timeline' : 'grid';
  });
  // Phone header state: the search box folds behind its icon; the month list
  // can start from a tapped day and folds the past away.
  const [searchOpen, setSearchOpen] = useState(false);
  const [monthFocus, setMonthFocus] = useState<Date | null>(null);
  const [showPast, setShowPast] = useState(false);
  const pickDayLayout = (v: 'grid' | 'timeline') => { setDayLayout(v); try { window.localStorage.setItem('lumio_day_layout', v); } catch { /* ignore */ } };
  const [dayDate, setDayDate] = useState<Date>(today);
  const goDay = useCallback((d: Date) => {
    const dd = new Date(d); dd.setHours(0, 0, 0, 0);
    setDayDate(dd);
    setView(new Date(dd.getFullYear(), dd.getMonth(), 1)); // keep the month fetch covering this day
    setMode((m) => (m === 'staff' ? 'staff' : 'day')); // keep staff mode when just stepping days
  }, []);
  // Native month / date pickers (jump to a specific month or day).
  const monthInputRef = useRef<HTMLInputElement>(null);
  const dayInputRef = useRef<HTMLInputElement>(null);
  // The phone's day strip swipes through the whole month; whenever the chosen
  // day changes (tap, arrows, "Today", the picker) it is scrolled into view.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = stripRef.current; if (!box) return;
    const el = box.querySelector<HTMLElement>('[data-on="1"]'); if (!el) return;
    box.scrollTo({ left: Math.max(0, el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2), behavior: 'smooth' });
  }, [mode, monthFocus, dayDate, view, isMobile]);
  const openMonthPicker = () => { const el = monthInputRef.current; if (!el) return; const anyEl = el as unknown as { showPicker?: () => void }; try { anyEl.showPicker ? anyEl.showPicker() : el.focus(); } catch { el.focus(); } };
  const openDayPicker = () => { const el = dayInputRef.current; if (!el) return; const anyEl = el as unknown as { showPicker?: () => void }; try { anyEl.showPicker ? anyEl.showPicker() : el.focus(); } catch { el.focus(); } };
  const onMonthPick = (e: React.ChangeEvent<HTMLInputElement>) => { const [y, m] = e.target.value.split('-').map(Number); if (y && m) setView(new Date(y, m - 1, 1)); };
  const onDayPick = (e: React.ChangeEvent<HTMLInputElement>) => { const [y, m, d] = e.target.value.split('-').map(Number); if (y && m && d) goDay(new Date(y, m - 1, d)); };
  const dayJumpMonth = (delta: number) => goDay(new Date(dayDate.getFullYear(), dayDate.getMonth() + delta, dayDate.getDate()));
  // Salon timezone so every appointment renders in the SALON's local time, never
  // the admin device's timezone (owners often manage US salons from abroad).
  // Seed from cache so times + the staff/tables label don't reflow (flicker) when
  // the /settings and /me/tenant fetches land a moment after mount.
  const [tz, setTz] = useState<string | undefined>(() => (typeof window !== 'undefined' ? (window.localStorage.getItem('lumio_tz') || undefined) : undefined));
  // Opening hours + days off (closed days in the date strip) and the techs with
  // their shifts (how full each day is; the Staff-today card; the filters).
  const [hours, setHours] = useState<{ week: HoursDay[] | null; daysOff: string[] }>({ week: null, daysOff: [] });
  const [staffList, setStaffList] = useState<ShiftStaffFull[]>([]);
  useEffect(() => {
    if (!token) return;
    apiFetch<{ id: string; firstName: string; isActive?: boolean; takesAppointments?: boolean; workingHours?: ShiftStaffFull['workingHours'] }[]>('/staff', { token })
      .then((rows) => setStaffList((rows ?? []).map((r) => ({ id: r.id, name: r.firstName, isActive: r.isActive, takesAppointments: r.takesAppointments, workingHours: r.workingHours }))
        .sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => undefined);
  }, [token]);
  const [isRestaurant, setIsRestaurant] = useState<boolean>(() => (typeof window !== 'undefined' && window.localStorage.getItem('lumio_is_restaurant') === '1'));
  useEffect(() => {
    if (!token) return;
    apiFetch<{ company?: { timezone?: string }; booking?: { businessHours?: HoursDay[]; daysOff?: string[] } }>('/settings', { token })
      .then((s) => {
        const z = s.company?.timezone || undefined; setTz(z); if (z) { try { window.localStorage.setItem('lumio_tz', z); } catch { /* ignore */ } }
        setHours({ week: s.booking?.businessHours ?? null, daysOff: s.booking?.daysOff ?? [] });
      })
      .catch(() => undefined);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ businessType?: string }>('/me/tenant', { token })
      .then((r) => { const on = r?.businessType === 'RESTAURANT'; setIsRestaurant(on); try { window.localStorage.setItem('lumio_is_restaurant', on ? '1' : '0'); } catch { /* ignore */ } })
      .catch(() => undefined);
  }, [token]);
  const fmtT = useCallback(
    (iso: string) => new Date(iso).toLocaleTimeString(uiLocale(), { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }),
    [tz],
  );

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    // Fetch the visible month range (+/- to catch spillover days).
    const from = new Date(view.getFullYear(), view.getMonth() - 1, 1).toISOString();
    const to = new Date(view.getFullYear(), view.getMonth() + 2, 0).toISOString();
    try {
      const params = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      setBookings(await apiFetch<Booking[]>(`/bookings${params}`, { token }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar');
    }
  }, [token, view]);

  useEffect(() => { load(); }, [load]);

  // Walk-ins live outside the appointment list; surface a live count so the
  // calendar's "today" line reflects them too (managed in the Floor view).
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const tick = () => apiFetch<{ serving?: unknown[]; waiting?: unknown[] }>('/walkins/board', { token })
      .then((b) => { if (alive) setWalkinNow((b.serving?.length ?? 0) + (b.waiting?.length ?? 0)); })
      .catch(() => {});
    tick();
    const iv = window.setInterval(() => { if (document.visibilityState === 'visible') tick(); }, 30000);
    return () => { alive = false; window.clearInterval(iv); };
  }, [token]);
  useLiveRefresh(load, 15000); // new bookings appear within ~15s, no reload needed
  // …and at once when another device books, checks in or takes a payment.
  useLiveTopics(['bookings', 'walkins', 'payments'], token, load);

  const toggleFull = useCallback(() => {
    setFullscreen((f) => {
      const next = !f;
      try {
        if (next) { document.documentElement.requestFullscreen?.().catch(() => undefined); }
        else if (document.fullscreenElement) { document.exitFullscreen?.().catch(() => undefined); }
      } catch { /* ignore */ }
      return next;
    });
  }, []);
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setFullscreen(false); };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const days = useMemo(() => buildMonth(view), [view]);
  /** The Filters panel (source · technician · status · quick presets). It
   *  applies to every view; the counts in it are for what is on screen. */
  const [filters, setFilters] = useState<CalFilters>(NO_FILTERS);
  // "Not arrived", the Now line and the attention list follow the clock.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const iv = window.setInterval(() => setNow(Date.now()), 60000); return () => window.clearInterval(iv); }, []);
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bookings;
    const qd = q.replace(/\D/g, '');
    return bookings.filter((b) => {
      const c = b.customer;
      const nm = c ? (c.firstName + ' ' + (c.lastName ?? '')).toLowerCase() : '';
      const ph = (c?.phone ?? '').replace(/\D/g, '');
      const em = (c?.email ?? '').toLowerCase();
      return nm.includes(q) || em.includes(q) || (!!qd && ph.includes(qd));
    });
  }, [bookings, search]);
  const filtered = useMemo(() => applyFilters(searched, filters, now), [searched, filters, now]);
  // The legend counts what is ON SCREEN — the month being shown, or the one
  // day in the day / staff views — not the three-month window fetched to
  // catch spill-over days. It ignores the source filter itself, so every
  // chip keeps its number while one of them is selected.
  const scopeRows = useMemo(() => {
    const keys = mode === 'month'
      ? new Set(days.filter((d): d is Date => !!d).map(cellKey))
      : new Set([cellKey(dayDate)]);
    return searched.filter((b) => keys.has(dayKeyTz(new Date(b.startTime), tz)));
  }, [searched, mode, days, dayDate, tz]);
  const showsCancelled = filters.statuses.includes('cancelled');
  const counts = useMemo(() => facetCounts(scopeRows, filters, now, { hideCancelled: !showsCancelled }), [scopeRows, filters, now, showsCancelled]);
  const groupByDay = (rows: Booking[]) => {
    const map = new Map<string, Booking[]>();
    for (const b of rows) { const k = dayKeyTz(new Date(b.startTime), tz); const a = map.get(k) ?? []; a.push(b); map.set(k, a); }
    return map;
  };
  /** Search applied, filters not: the day's numbers in the List and its rail. */
  const searchedByDay = useMemo(() => groupByDay(searched), [searched, tz]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Everything, for the strip: how many bookings and how full each day is. */
  const allByDay = useMemo(() => groupByDay(bookings), [bookings, tz]); // eslint-disable-line react-hooks/exhaustive-deps
  const dayInfo = useCallback((d: Date): DayInfo => {
    const list = allByDay.get(cellKey(d)) ?? [];
    const closed = isClosedDay({ date: d, week: hours.week, daysOff: hours.daysOff });
    const cap = capacityMinutes({ date: d, staff: staffList, week: hours.week, daysOff: hours.daysOff });
    return { count: list.filter((b) => b.status !== 'CANCELLED').length, load: loadOf(bookedMinutes(list), cap), closed: closed && list.length === 0 };
  }, [allByDay, hours, staffList]);
  const monthSearched = useMemo(() => {
    const keys = new Set(days.filter((d): d is Date => !!d).map(cellKey));
    return searched.filter((b) => keys.has(dayKeyTz(new Date(b.startTime), tz)));
  }, [searched, days, tz]);
  // Screen widths: the 14-day strip, and the right-hand rail of the List.
  const [wideStrip, setWideStrip] = useState(false);
  const [railScreen, setRailScreen] = useState(false);
  useEffect(() => {
    const a = window.matchMedia('(min-width: 1100px)');
    const b = window.matchMedia('(min-width: 1360px)');
    const on = () => { setWideStrip(a.matches); setRailScreen(b.matches); };
    on();
    a.addEventListener?.('change', on); b.addEventListener?.('change', on);
    return () => { a.removeEventListener?.('change', on); b.removeEventListener?.('change', on); };
  }, []);
  const [dateOpen, setDateOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [pickMonth, setPickMonth] = useState<Date>(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const byDay = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of filtered) {
      const key = dayKeyTz(new Date(b.startTime), tz);
      const arr = map.get(key) ?? [];
      arr.push(b);
      map.set(key, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));
    return map;
  }, [filtered, tz]);

  // Mobile agenda: nearest day to today on top (upcoming ascending, then past
  // descending), paginated so a busy month never becomes an endless scroll.
  const [monthPage, setMonthPage] = useState(0);
  useEffect(() => { setMonthPage(0); }, [view, search, mode]);
  const orderedMonthDays = useMemo(() => {
    const withItems = days.filter((d): d is Date => !!d && (byDay.get(cellKey(d))?.length ?? 0) > 0);
    const anchor = monthFocus ?? today;
    const upcoming = withItems.filter((d) => d.getTime() >= anchor.getTime()).sort((a, b) => a.getTime() - b.getTime());
    const past = withItems.filter((d) => d.getTime() < anchor.getTime()).sort((a, b) => b.getTime() - a.getTime());
    return [...upcoming, ...past];
  }, [days, byDay, today, monthFocus]);
  const monthUpcomingCount = useMemo(() => orderedMonthDays.filter((d) => d.getTime() >= (monthFocus ?? today).getTime()).length, [orderedMonthDays, monthFocus, today]);
  const MONTH_PAGE_SIZE = 6;
  const monthPageCount = Math.max(1, Math.ceil(orderedMonthDays.length / MONTH_PAGE_SIZE));
  const monthSafePage = Math.min(monthPage, monthPageCount - 1);
  const monthPageDays = orderedMonthDays.slice(monthSafePage * MONTH_PAGE_SIZE, monthSafePage * MONTH_PAGE_SIZE + MONTH_PAGE_SIZE);

  const [walkinNow, setWalkinNow] = useState(0);
  const todayStats = useMemo(() => {
    const list = byDay.get(cellKey(today)) ?? [];
    const count = (k: string) => list.filter((b) => statusBucket(b.status).key === k).length;
    return { total: list.length, pending: count('Pending'), arrived: count('Arrived') };
  }, [byDay, today]);

  const monthLabel = view.toLocaleString(locale, { month: 'long', year: 'numeric' });
  const name = (c: { firstName: string; lastName?: string | null } | null) => (c ? c.firstName : '');

  async function action(id: string, path: string, body?: unknown) {
    // Cancelling asks once, and says what the cancellation triggers: the
    // customer and the technician are told, and money already taken is not
    // sent back by itself — that is a deliberate step at Thanh toán.
    if (path === 'cancel') {
      const b = bookings.find((x) => x.id === id);
      const paid = (b?.payments ?? []).filter((p) => p.status === 'PAID').reduce((sum, p) => sum + p.amountCents, 0);
      const vi = lang === 'vi';
      const lines = [
        vi ? `Huỷ lịch của ${b ? name(b.customer) : 'khách'}?` : `Cancel ${b ? name(b.customer) : 'this customer'}'s booking?`,
        vi ? 'Khách và thợ sẽ được báo theo mẫu thông báo của tiệm.' : 'The customer and the technician are notified with the salon\'s templates.',
      ];
      if (!window.confirm(lines.join('\n'))) return;
      // Money already taken: the owner decides for THIS booking. OK sends it
      // back to the customer's card through the provider that took it; Cancel
      // keeps it (a late cancellation, a no-show deposit).
      if (paid > 0) {
        const refund = window.confirm(vi
          ? `Khách đã trả ${formatPrice(paid, b?.currency)}.\n\nOK = HOÀN tiền về thẻ của khách\nHuỷ = TIỆM GIỮ tiền cọc`
          : `${formatPrice(paid, b?.currency)} was paid.\n\nOK = REFUND it to the customer's card\nCancel = the salon KEEPS the deposit`);
        body = { money: refund ? 'refund' : 'keep' };
      }
    }
    try {
      // A move outside opening hours: the owner is asked once and may go ahead.
      const timed = path === 'reschedule' || path === 'move';
      const updated = await withHoursOverride(
        (o) => apiFetch<Booking>(`/bookings/${id}/${path}`, { method: 'POST', token, body: o && timed ? { ...(body as object), outsideHours: true } : body }),
        { owner: isOwner && timed, vi: lang === 'vi' },
      );
      // Status changes and visit edits keep the drawer open showing the new
      // state; the one-shot actions (arrive/complete/cancel) close it as before.
      const failed = (updated as { cancelMoney?: { failed?: { provider: string; error: string }[] } } | null)?.cancelMoney?.failed ?? [];
      if (path === 'cancel' && failed.length) {
        setError(lang === 'vi'
          ? `Đã huỷ lịch nhưng hoàn tiền KHÔNG thành công (${failed.map((f) => `${f.provider}: ${f.error}`).join('; ')}). Hãy hoàn tay trong tài khoản thanh toán của tiệm.`
          : `Cancelled, but the refund FAILED (${failed.map((f) => `${f.provider}: ${f.error}`).join('; ')}). Refund it by hand in the salon's payment account.`);
      }
      if ((path === 'status' || path === 'lines' || path === 'line-staff' || path === 'assign') && updated && typeof updated === 'object') setSelected(updated);
      else setSelected(null);
      await load();
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Action failed';
      // The API speaks English; the one message staff hit often gets translated.
      setError(/in the past/i.test(raw) ? t('cal.pastTime') : raw);
    }
  }

  // Right-click on any booking chip → delete (with confirm). Cancel keeps
  // history; delete removes the row for cluttered test/mistake bookings.
  async function removeBooking(id: string) {
    const msg = lang === 'vi'
      ? 'Xóa vĩnh viễn booking này? Không thể hoàn tác. (Muốn giữ lịch sử thì dùng Cancel.)'
      : 'Delete this booking permanently? This cannot be undone. (Use Cancel to keep history.)';
    if (!window.confirm(msg)) return;
    try {
      await apiFetch(`/bookings/${id}`, { method: 'DELETE', token });
      setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  // ── the header of every view (approved mockup "Lịch hẹn — thiết kế lại") ──
  const vi = lang === 'vi';
  const L = (a: string, b: string) => ind(vi ? a : b);
  const nF = activeFilterCount(filters);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  // Never outside opening hours: at 4:30 in the morning this used to offer
  // 4:30 AM. See suggestStart (lib/cal-day) for the rule.
  const newHref = (() => {
    const sug = suggestStart({ date: dayDate, today, nowMin: minutesInZone(tz), week: hours.week, daysOff: hours.daysOff });
    const m = sug.minutes;
    return `/salon/bookings?new=1&at=${encodeURIComponent(`${cellKey(sug.date)}T${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`)}`;
  })();
  /**
   * "Đặt lịch" opens as a pop-up over the calendar instead of a page change.
   * Every booking link in this view (header, empty day, "+ Đặt cho <thợ>",
   * a free gap in a technician's column) still points at
   * /salon/bookings?new=1…, so ctrl/⌘-click or a middle click still opens
   * the full page in a new tab; a plain click is caught here, its time and
   * technician read from the link, and the form opens in place.
   */
  const interceptBook = (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    let u: URL;
    try { u = new URL(a.getAttribute('href') ?? '', window.location.href); } catch { return; }
    if (u.pathname !== '/salon/bookings' || u.searchParams.get('new') !== '1') return;
    e.preventDefault();
    const at = u.searchParams.get('at') ?? '';
    const txt = (k: string) => (u.searchParams.get(k) ?? '').slice(0, 80) || undefined;
    setNewBook({
      startLocal: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(at) ? at : undefined,
      staffId: u.searchParams.get('staff') ?? undefined,
      firstName: txt('first'), lastName: txt('last'), phone: txt('phone'),
    });
  };
  const bookModal = newBook && (
    <NewBookingModal
      initial={newBook}
      bookings={bookings}
      onClose={() => setNewBook(null)}
      onCreated={() => { setNewBook(null); void load(); }}
    />
  );
  const rel = (d: Date) => (d.getTime() === today.getTime() ? L('Hôm nay', 'Today')
    : d.getTime() === addDays(today, 1).getTime() ? L('Ngày mai', 'Tomorrow')
    : d.getTime() === addDays(today, -1).getTime() ? L('Hôm qua', 'Yesterday') : '');
  const monthAnchor = monthFocus ?? (view.getMonth() === today.getMonth() && view.getFullYear() === today.getFullYear() ? today : new Date(view.getFullYear(), view.getMonth(), 1));
  const stripAnchor = mode === 'month' ? monthAnchor : dayDate;
  const stripSelected = mode === 'month' ? (monthFocus ?? (monthAnchor.getTime() === today.getTime() ? today : new Date(-1))) : dayDate;
  const step = (delta: number) => {
    if (mode === 'month') { setView(new Date(view.getFullYear(), view.getMonth() + delta, 1)); setMonthFocus(null); setMonthPage(0); }
    else goDay(addDays(dayDate, delta));
  };
  // Phone week strip: a week back / forward keeps the same weekday selected.
  const weekStep = (delta: number) => pickStrip(addDays(mode === 'month' ? (monthFocus ?? stripAnchor) : dayDate, delta * 7));
  const stripMonth = (mode === 'month' ? (monthFocus ?? view) : dayDate).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const goToday = () => { setMonthFocus(null); setMonthPage(0); if (mode === 'month') setView(new Date(today.getFullYear(), today.getMonth(), 1)); else goDay(today); };
  const pickStrip = (d: Date) => {
    if (mode === 'month') { setMonthFocus(d); setMonthPage(0); setShowPast(false); if (d.getMonth() !== view.getMonth()) setView(new Date(d.getFullYear(), d.getMonth(), 1)); }
    else goDay(d);
  };
  const openPicker = () => { setPickMonth(new Date((mode === 'month' ? view : dayDate).getFullYear(), (mode === 'month' ? view : dayDate).getMonth(), 1)); setDateOpen((o) => !o); };
  const pickFromPicker = (d: Date) => {
    setDateOpen(false);
    if (mode === 'month') { setView(new Date(d.getFullYear(), d.getMonth(), 1)); setMonthFocus(d); setMonthPage(0); setShowPast(false); }
    else goDay(d);
  };
  const resultCount = (mode === 'month' ? days.flatMap((d) => (d ? byDay.get(cellKey(d)) ?? [] : [])) : byDay.get(cellKey(dayDate)) ?? []).filter((b) => showsCancelled || b.status !== 'CANCELLED').length;
  const viewItems = ([
    { key: 'staff', label: isRestaurant ? t('cal.viewTables') : (isMobile ? L('Thợ', 'Staff') : t('cal.viewStaff')) },
    { key: 'day', label: L('Danh sách', 'List') },
    { key: 'month', label: t('cal.viewMonth') },
    ...(isRestaurant ? [] : [{ key: 'floor', label: isMobile ? L('Sơ đồ', 'Floor') : L('Sơ đồ ghế', 'Floor') }]),
  ] as { key: 'staff' | 'day' | 'month' | 'floor'; label: string }[]);
  const dateTitle = mode === 'month' ? monthLabel : dayDate.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
  const monthCount = days.flatMap((d) => (d ? byDay.get(cellKey(d)) ?? [] : [])).filter((b) => b.status !== 'CANCELLED').length;
  async function autoAssignOpen() {
    try { await apiFetch('/bookings/auto-assign-open', { method: 'POST', token }); } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); }
    await load();
  }
  const staffOpts = staffList.filter((s) => s.isActive !== false && s.takesAppointments !== false);
  const filterTitle = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{L('Bộ lọc', 'Filters')}</span>
      <span style={{ fontSize: 12.5, color: C.muted }}>{mode === 'month' ? monthLabel : dateTitle} · {L('số đếm cập nhật khi bạn chọn', 'counts update as you pick')}</span>
      <button type="button" onClick={() => setFilterOpen(false)} aria-label="Close" style={{ marginLeft: 'auto', border: 0, background: 'transparent', color: C.muted, cursor: 'pointer', padding: 4 }}><Icon name="x" size={18} /></button>
    </div>
  );
  const picker = (
    <MonthPicker month={pickMonth} selected={mode === 'month' ? (monthFocus ?? today) : dayDate} today={today} info={dayInfo} vi={vi}
      onPick={pickFromPicker} onMonth={(dl) => setPickMonth(new Date(pickMonth.getFullYear(), pickMonth.getMonth() + dl, 1))} />
  );
  const searchBox = (w: number | string, h: number) => (
    <div style={{ position: 'relative', width: w, flexShrink: 1, minWidth: 0 }}>
      <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.muted, pointerEvents: 'none' }}><Icon name="search" size={16} /></span>
      <input value={search} onChange={(e) => setSearch(e.target.value)} autoFocus={isMobile}
        placeholder={L('Tìm tên hoặc số điện thoại', 'Search name or phone')} aria-label={L('Tìm khách', 'Search customers')}
        style={{ width: '100%', boxSizing: 'border-box', height: h, padding: '0 34px 0 36px', borderRadius: 10, border: `1px solid ${C.border}`, background: C.panel, color: C.ink2, fontSize: isMobile ? 16 : 13.5, fontFamily: 'inherit' }} />
      {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear" style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', width: 28, height: 28, border: 0, background: 'transparent', color: C.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={15} /></button>}
    </div>
  );

  const header = isMobile ? (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <h1 style={{ fontSize: 22, margin: 0, flex: 1, minWidth: 0, letterSpacing: -0.3, color: C.ink }}>{t('cal.title')}</h1>
        {mode !== 'floor' && <IconBtn name="search" size={40} label={L('Tìm khách', 'Search')} active={searchOpen} onClick={() => { setSearchOpen((o) => !o); if (searchOpen) setSearch(''); }} />}
        {mode !== 'floor' && <IconBtn name="filter" size={40} label={L('Bộ lọc', 'Filters')} badge={nF} active={nF > 0} onClick={() => setFilterOpen(true)} />}
        <a href={newHref} aria-label={L('Đặt lịch', 'New booking')} title={L('Đặt lịch', 'New booking')} style={{ width: 40, height: 40, borderRadius: 10, ...onIndigo, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon name="plus" size={20} sw={2.4} /></a>
      </div>
      <Seg full h={40} items={viewItems} value={mode} onChange={(v) => setMode(v)} />
      {searchOpen && mode !== 'floor' && <div style={{ marginTop: 10 }}>{searchBox('100%', 44)}</div>}
      {mode !== 'floor' && (
        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: '4px 6px 6px', margin: '10px 0' }}>
          {/* Phone: the month on the left, "Today" on the right, and a week
              strip you can swipe (or step with the arrows at its sides). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 4px 0 0' }}>
            <button type="button" onClick={() => { setPickMonth(new Date((mode === 'month' ? view : dayDate).getFullYear(), (mode === 'month' ? view : dayDate).getMonth(), 1)); setDateOpen(true); }}
              style={{ minWidth: 0, height: 44, padding: '0 8px', border: 0, background: 'transparent', color: C.ink, fontFamily: 'inherit', fontSize: 16, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, textTransform: 'capitalize' }}>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stripMonth}</span><Icon name="down" size={15} color="var(--c94a3b8)" />
            </button>
            <span style={{ flex: 1 }} />
            <button type="button" onClick={goToday} aria-pressed={stripSelected.getTime() === today.getTime()}
              style={{ height: 34, padding: '0 14px', borderRadius: 999, border: `1px solid ${C.indigoLine}`, background: C.indigoSoft, color: C.indigoText, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>{t('cal.today')}</button>
          </div>
          <div style={{ position: 'relative', padding: '0 28px' }}
            onTouchStart={(e) => { const p = e.touches[0]; weekSwipe.current = { x: p.clientX, y: p.clientY }; }}
            onTouchEnd={(e) => {
              const st = weekSwipe.current; weekSwipe.current = null; if (!st) return;
              const p = e.changedTouches[0]; const dx = p.clientX - st.x, dy = p.clientY - st.y;
              if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) weekStep(dx < 0 ? 1 : -1);
            }}>
            <button type="button" aria-label={L('Tuần trước', 'Previous week')} onClick={() => weekStep(-1)} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 28, border: 0, background: 'transparent', color: C.indigoText, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><Icon name="left" size={18} sw={2.6} /></button>
            <DayStrip compact solid days={stripDays(stripAnchor, 7)} selected={stripSelected} today={today} info={dayInfo} vi={vi} onPick={pickStrip} />
            <button type="button" aria-label={L('Tuần sau', 'Next week')} onClick={() => weekStep(1)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 28, border: 0, background: 'transparent', color: C.indigoText, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}><Icon name="right" size={18} sw={2.6} /></button>
          </div>
        </div>
      )}
      {mode !== 'floor' && mode !== 'day' && nF > 0 && <div style={{ marginBottom: 10 }}><ActiveChips f={filters} set={setFilters} staff={staffList} vi={vi} pad="8px 12px" rounded /></div>}
      {mode === 'month' && (
        <div style={{ fontSize: 13.5, color: C.sub, marginBottom: 10 }}>
          <strong style={{ color: C.ink }}>{monthCount} {t('cal.apptWord')}</strong> {L('trong tháng', 'this month')}
        </div>
      )}
      {error && <div style={ui.banner}>{error}</div>}
      {mode !== 'day' && mode !== 'floor' && <UnassignedBanner bookings={bookings} vi={vi} onDone={load} />}
      <Sheet open={dateOpen} onClose={() => setDateOpen(false)} title={L('Chọn ngày', 'Pick a day')}>{picker}</Sheet>
      <Sheet open={filterOpen} onClose={() => setFilterOpen(false)} tall title={L('Bộ lọc', 'Filters')} sub={mode === 'month' ? monthLabel : dateTitle}
        footer={<FilterFooter f={filters} set={setFilters} result={resultCount} vi={vi} onDone={() => setFilterOpen(false)} />}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ActiveChips f={filters} set={setFilters} staff={staffList} vi={vi} pad="8px 12px" rounded />
          <FilterBody f={filters} set={setFilters} counts={counts} staff={staffOpts} vi={vi} columns={false} />
        </div>
      </Sheet>
    </>
  ) : (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.ink, letterSpacing: -0.3 }}>{t('cal.title')}</h1>
        <Seg items={viewItems} value={mode} onChange={(v) => setMode(v)} />
        <span style={{ flex: 1 }} />
        {mode !== 'floor' && searchBox(railScreen ? 260 : 220, 36)}
        {mode !== 'floor' && (
          <div style={{ position: 'relative' }}>
            <button type="button" data-pop-trigger onClick={() => setFilterOpen((o) => !o)} aria-expanded={filterOpen}
              style={{ ...btn(false), ...(nF ? { background: C.indigoSoft, borderColor: C.indigoLine, color: C.indigoText } : {}) }}>
              <Icon name="filter" size={16} />{L('Bộ lọc', 'Filters')}
              {nF > 0 && <span style={{ minWidth: 18, height: 18, padding: '0 5px', boxSizing: 'border-box', borderRadius: 999, ...onIndigo, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{nF}</span>}
            </button>
            <Popover open={filterOpen} onClose={() => setFilterOpen(false)} align="right" width={wideStrip ? 720 : 560}>
              {filterTitle}
              <FilterBody f={filters} set={setFilters} counts={counts} staff={staffOpts} vi={vi} columns={wideStrip} />
              <div style={{ marginTop: 14 }}><FilterFooter f={filters} set={setFilters} result={resultCount} vi={vi} onDone={() => setFilterOpen(false)} /></div>
            </Popover>
          </div>
        )}
        <IconBtn name={fullscreen ? 'shrink' : 'expand'} label={fullscreen ? L('Thoát toàn màn hình', 'Exit full screen') : L('Toàn màn hình', 'Full screen')} onClick={toggleFull} />
        <a href={newHref} style={btn(true)}><Icon name="plus" size={16} />{L('Đặt lịch', 'New booking')}</a>
      </div>
      {mode !== 'floor' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: '8px 10px 8px 12px', marginBottom: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button type="button" onClick={goToday} style={{ ...btn(false, 32), padding: '0 12px' }}>{t('cal.today')}</button>
              <IconBtn name="left" size={32} label={mode === 'month' ? L('Tháng trước', 'Previous month') : L('Ngày trước', 'Previous day')} onClick={() => step(-1)} />
              <IconBtn name="right" size={32} label={mode === 'month' ? L('Tháng sau', 'Next month') : L('Ngày sau', 'Next day')} onClick={() => step(1)} />
            </div>
            <div style={{ position: 'relative' }}>
              <button type="button" data-pop-trigger onClick={openPicker} aria-expanded={dateOpen}
                style={{ display: 'flex', alignItems: 'center', gap: 6, border: 0, background: 'transparent', padding: '0 2px', cursor: 'pointer', fontFamily: 'inherit', color: C.ink }}>
                <span style={{ fontSize: 17, fontWeight: 700, whiteSpace: 'nowrap', textTransform: 'capitalize', letterSpacing: -0.2 }}>{dateTitle}</span>
                <Icon name="down" size={16} color="var(--c94a3b8)" />
                {mode !== 'month' && rel(dayDate) && <span style={{ fontSize: 12, color: C.muted, marginLeft: 2 }}>{rel(dayDate)}</span>}
              </button>
              <Popover open={dateOpen} onClose={() => setDateOpen(false)} width={360}>{picker}</Popover>
            </div>
          </div>
          {mode !== 'month' ? (
            <>
              <span style={{ width: 1, alignSelf: 'stretch', background: C.line }} />
              <DayStrip days={stripDays(dayDate, wideStrip ? 14 : 7)} selected={dayDate} today={today} info={dayInfo} vi={vi} onPick={goDay} short={!railScreen && !wideStrip} />
            </>
          ) : (
            <span style={{ marginLeft: 'auto', fontSize: 13.5, color: C.sub, paddingRight: 6 }}>
              <strong style={{ color: C.ink }}>{monthCount}</strong> {t('cal.apptWord')} {L('trong tháng', 'this month')}
              {todayStats.total > 0 && <> · {t('cal.todayLabel')} <strong style={{ color: C.ink }}>{todayStats.total}</strong></>}
            </span>
          )}
        </div>
      )}
      {mode !== 'floor' && mode !== 'day' && nF > 0 && <div style={{ marginBottom: 12 }}><ActiveChips f={filters} set={setFilters} staff={staffList} vi={vi} pad="8px 12px" rounded /></div>}
      {error && <div style={ui.banner}>{error}</div>}
      {mode !== 'day' && mode !== 'floor' && <UnassignedBanner bookings={bookings} vi={vi} onDone={load} />}
    </>
  );

  const sectionStyle: React.CSSProperties | undefined = fullscreen ? { position: 'fixed', inset: 0, zIndex: 100, background: 'var(--c0b1120)', padding: '14px 18px', paddingTop: 'calc(14px + env(safe-area-inset-top, 0px))', overflow: 'auto' } : undefined;

  if (mode === 'floor') {
    return (
      <section style={sectionStyle} onClickCapture={interceptBook}>
        {header}
        <FloorView token={token} lang={lang} />
        {bookModal}
      </section>
    );
  }

  return (
    <section style={sectionStyle} onClickCapture={interceptBook}>
      {header}

      {mode === 'staff' ? (
        isRestaurant ? (
          <TableDayView date={dayDate} items={byDay.get(cellKey(dayDate)) ?? []} tz={tz} isMobile={isMobile} onOpen={setSelected} today={today} onChanged={load} />
        ) : (
          <StaffDayView date={dayDate} items={byDay.get(cellKey(dayDate)) ?? []} tz={tz} isMobile={isMobile} onOpen={setSelected} today={today} onChanged={load} onBook={(staffId, at) => setNewBook({ staffId: staffId ?? undefined, startLocal: at })} />
        )
      ) : mode === 'day' ? (
        <ListView
          all={searchedByDay.get(cellKey(dayDate)) ?? []} rows={byDay.get(cellKey(dayDate)) ?? []} monthRows={monthSearched}
          date={dayDate} today={today} now={now} tz={tz} vi={vi} isMobile={isMobile} wide={railScreen} staff={staffList}
          f={filters} setF={setFilters} counts={counts} fmtT={fmtT}
          onOpen={(b) => setSelected(b as Booking)} onAction={action} onCtx={(b, x, y) => setCtxMenu({ x, y, b: b as Booking })}
          onAutoAssign={autoAssignOpen} onStaffView={() => setMode('staff')} newHref={newHref} searching={!!search.trim()}
        />
      ) : isMobile ? (
        /* Phones: the month as a list of days — the day you are on (today, or
           the day tapped on the strip) first and forward from there; the days
           before it fold away behind one button. */
        orderedMonthDays.length === 0 ? (
          <p style={{ color: 'var(--c64748b)', fontSize: 14, padding: '20px 0', textAlign: 'center' }}>{t('cal.noneThisMonth')}</p>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(showPast ? orderedMonthDays : orderedMonthDays.slice(0, Math.max(1, monthUpcomingCount))).map((d) => {
            const items = byDay.get(cellKey(d)) ?? [];
            const isToday = d.getTime() === today.getTime();
            const isPast = d.getTime() < today.getTime();
            const isAnchor = d.getTime() === (monthFocus ?? today).getTime();
            return (
              <div key={d.toDateString()} style={{ ...ui.card, padding: '12px 14px', border: `1px solid ${isAnchor ? '#4f46e5' : 'var(--line)'}`, opacity: isPast ? 0.72 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: isToday ? 'var(--c818cf8)' : 'var(--ce2e8f0)' }}>
                    {d.toLocaleDateString(locale, { weekday: 'long', month: 'short', day: 'numeric' })}{isToday ? ' · ' + t('cal.todayLabel') : ''}
                  </span>
                  {isPast && <span style={{ fontSize: 10.5, color: 'var(--c64748b)', border: '1px solid var(--c334155)', borderRadius: 999, padding: '1px 7px' }}>{lang === 'vi' ? 'đã qua' : 'past'}</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c64748b)' }}>{items.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {items.map((b) => {
                    const m = statusBucket(b.status, b.startTime);
                    const struck = b.status === 'CANCELLED';
                    return (
                      <div key={b.id} onClick={() => setSelected(b)}
                        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, b }); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '8px 10px', borderRadius: 9, background: 'var(--c1e293b)', borderLeft: `3px solid ${m.color}`, cursor: 'pointer', opacity: struck ? 0.75 : 1 }}>
                        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, flexShrink: 0 }}>
                          <span style={{ fontWeight: 700, whiteSpace: 'nowrap', color: 'var(--cf1f5f9)', fontSize: 14 }}>{fmtT(b.startTime)}</span>
                          <span style={{ whiteSpace: 'nowrap', color: 'var(--c94a3b8)', fontSize: 11.5 }}>– {fmtT(b.endTime)}</span>
                        </span>
                        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--cf1f5f9)', fontWeight: 600, fontSize: 14, textDecoration: struck ? 'line-through' : 'none' }}>{name(b.customer)}</span>
                            <SourceDot b={b} vi={lang === 'vi'} />
                          </span>
                          {svcLabel(b) && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--c94a3b8)', fontSize: 12.5 }}>{svcLabel(b)}</span>}
                          {b.customer?.phone && <span style={{ whiteSpace: 'nowrap', color: 'var(--c94a3b8)', fontSize: 12.5 }}>{fmtPhone(b.customer.phone)}</span>}
                        </span>
                        <span style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 600, color: m.color, whiteSpace: 'nowrap' }}>{t('cal.st' + m.key)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {orderedMonthDays.length > monthUpcomingCount && (
            <button type="button" onClick={() => setShowPast((v) => !v)} style={{ height: 40, borderRadius: 10, border: '1px dashed var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
              {showPast ? (lang === 'vi' ? 'Ẩn ngày đã qua ▴' : 'Hide past days ▴') : (lang === 'vi' ? `Xem ${orderedMonthDays.length - monthUpcomingCount} ngày đã qua ▾` : `Show ${orderedMonthDays.length - monthUpcomingCount} past days ▾`)}
            </button>
          )}
        </div>
        )
      ) : (
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', borderRadius: 12 }}>
      <style>{`.cal-ev{transition:filter .12s ease}.cal-ev:hover{filter:brightness(1.2)}`}</style>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 1, minWidth: 680, background: 'var(--c243044)', border: '1px solid var(--c243044)', borderRadius: 12, overflow: 'hidden' }}>
        {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
          const weekend = dow === 0 || dow === 6;
          const todayCol = today.getDay() === dow;
          return (
            <div key={dow} style={{ background: 'var(--c1e293b)', textAlign: 'center', padding: '9px 0', fontSize: 11.5, letterSpacing: 0.6, textTransform: 'uppercase', color: todayCol ? 'var(--ca5b4fc)' : weekend ? 'var(--c8ea2c4)' : 'var(--c94a3b8)', fontWeight: 600 }}>{DAY_LABEL[lang][dow]}</div>
          );
        })}
        {days.map((d, i) => {
          const items = d ? byDay.get(cellKey(d)) ?? [] : [];
          const isToday = !!d && d.getTime() === today.getTime();
          const dow = d ? d.getDay() : -1;
          const weekend = dow === 0 || dow === 6;
          const cellBg = !d ? 'var(--c0b1322)' : isToday ? 'var(--c151f38)' : weekend ? 'var(--c0d1526)' : 'var(--c0f172a)';
          return (
            <div key={i} style={{ background: cellBg, minHeight: 116, minWidth: 0, overflow: 'hidden', padding: 7, opacity: d ? 1 : 0.5, boxShadow: isToday ? 'inset 0 0 0 1.5px #4f46e5' : undefined }}>
              {d && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <span onClick={() => goDay(d)} title={t('cal.viewDay')}
                      style={{ display: 'inline-grid', placeItems: 'center', minWidth: 22, height: 22, padding: '0 6px', borderRadius: 999, fontSize: 12.5, fontWeight: isToday ? 800 : 600, color: isToday ? '#fff' : 'var(--ccbd5e1)', background: isToday ? '#6366f1' : 'transparent', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      {d.getDate()}
                    </span>
                    {items.length > 0 && <span style={{ fontSize: 10.5, color: 'var(--c64748b)', fontWeight: 600 }}>{items.length}</span>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {items.slice(0, 4).map((b) => {
                      const m = statusBucket(b.status, b.startTime);
                      const dim = m.key === 'Cancelled' || m.key === 'NoShow';
                      const strike = m.key === 'Cancelled' ? 'line-through' : 'none';
                      return (
                        <div key={b.id} className="cal-ev" title={`${t('cal.st' + m.key)} · ${svcLabel(b)} · ${name(b.customer)}`}
                          onClick={() => setSelected(b)}
                          onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, b }); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, fontSize: 11, padding: '3px 7px', borderRadius: 5, background: `${m.color}1f`, borderLeft: `3px solid ${m.color}`, cursor: 'pointer', opacity: dim ? 0.55 : 1, overflow: 'hidden' }}>
                          <SourceDot b={b} vi={lang === 'vi'} />
                          <span style={{ fontWeight: 600, whiteSpace: 'nowrap', color: m.color, textDecoration: strike, flexShrink: 0 }}>{fmtT(b.startTime)}</span>
                          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--cdbe2ea)', textDecoration: strike }}>{name(b.customer)}{svcLabel(b) ? ` · ${svcLabel(b)}` : ''}</span>
                        </div>
                      );
                    })}
                    {items.length > 4 && <div onClick={() => goDay(d)} style={{ fontSize: 10.5, color: 'var(--c818cf8)', cursor: 'pointer', fontWeight: 600, padding: '2px 4px 0' }}>{t('cal.more').replace('{n}', String(items.length - 4))}</div>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      </div>
      )}

      {ctxMenu && (() => {
        const b = ctxMenu.b;
        const canArrive = ['PENDING', 'ASSIGNED', 'ACCEPTED', 'CONFIRMED'].includes(b.status);
        const isActive = canArrive || b.status === 'ARRIVED';
        const top = Math.max(8, Math.min(ctxMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 250));
        const left = Math.max(8, Math.min(ctxMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 210));
        const close = () => setCtxMenu(null);
        return (
          <>
            {/* click-away backdrop (right-click also closes) */}
            <div onClick={close} onContextMenu={(e) => { e.preventDefault(); close(); }} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
            <div style={{ position: 'fixed', top, left, zIndex: 61, background: 'var(--c1e293b)', border: '1px solid var(--c334155)', borderRadius: 10, minWidth: 190, boxShadow: '0 14px 34px rgba(0,0,0,0.55)', padding: 4 }}>
              <div style={{ padding: '7px 12px 6px', fontSize: 11.5, color: 'var(--c94a3b8)', borderBottom: '1px solid var(--c273449)', marginBottom: 3, maxWidth: 230, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {fmtT(b.startTime)} · {name(b.customer)}{svcLabel(b) ? ` · ${svcLabel(b)}` : ''}
              </div>
              <CtxItem label={`👁 ${lang === 'vi' ? 'Xem chi tiết' : 'View details'}`} onClick={() => { setSelected(b); close(); }} />
              {canArrive && <CtxItem label={`🙋 ${t('cal.arrive')}`} onClick={() => { close(); action(b.id, 'arrive'); }} />}
              {isActive && <CtxItem label={`✅ ${t('cal.complete')}`} onClick={() => { close(); action(b.id, 'complete'); }} />}
              {isActive && <CtxItem color="#f59e0b" label={`✖ ${t('cal.cancel')}`} onClick={() => { close(); action(b.id, 'cancel'); }} />}
              <div style={{ borderTop: '1px solid var(--c273449)', margin: '3px 0' }} />
              <CtxItem color="var(--cf87171)" label={`🗑 ${lang === 'vi' ? 'Xóa booking' : 'Delete booking'}`} onClick={() => { close(); removeBooking(b.id); }} />
            </div>
          </>
        );
      })()}

      {selected && (
        <BookingDetail booking={selected} all={bookings} tz={tz} onClose={() => setSelected(null)} onAction={action} onReload={() => { setSelected(null); void load(); }} />
      )}
      {bookModal}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Day view: a detailed single-day timeline. Appointments are placed by time,
// sized by duration, and split into side-by-side columns when they overlap.
// ---------------------------------------------------------------------------
// Distinct, stable avatar color per staff member (hash of id -> palette).
const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#f43f5e'];
function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function CtxItem({ label, onClick, color }: { label: string; onClick: () => void; color?: string }) {
  return (
    <div
      onClick={onClick}
      style={{ padding: '8px 12px', fontSize: 13, fontWeight: 600, color: color ?? 'var(--ce2e8f0)', cursor: 'pointer', borderRadius: 6, whiteSpace: 'nowrap' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--c273449)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {label}
    </div>
  );
}

/** The phone's view switcher: a full-width segmented control, 36px tall. */
function segBtnPhone(active: boolean): React.CSSProperties {
  return { flex: 1, height: 36, border: 'none', cursor: 'pointer', padding: 0, borderRadius: 8, fontSize: 13.5, fontWeight: 600, background: active ? '#4f46e5' : 'transparent', color: active ? '#fff' : 'var(--ccbd5e1)', whiteSpace: 'nowrap' };
}
function segBtn(active: boolean): React.CSSProperties {
  return { border: 'none', cursor: 'pointer', padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, background: active ? '#6366f1' : 'transparent', color: active ? '#fff' : 'var(--c94a3b8)' };
}

function BookingDetail({ booking: b, all, tz, onClose, onAction, onReload }: {
  booking: Booking; all: Booking[]; tz?: string; onClose: () => void; onAction: (id: string, path: string, body?: unknown) => void;
  /** After the client's details were corrected: reload the calendar. */
  onReload?: () => void;
}) {
  const { lang } = useLang();
  const [editing, setEditing] = useState(false);
  const t = (k: string) => tr(k, lang);
  const locale = uiLocale(); // dates always render US month/day/year
  const start = new Date(b.startTime);
  const end = new Date(b.endTime);
  const duration = Math.round((end.getTime() - start.getTime()) / 60000);
  const fullName = b.customer ? `${b.customer.firstName} ${b.customer.lastName ?? ''}`.trim() : '—';
  const canArrive = ['PENDING', 'ASSIGNED', 'ACCEPTED', 'CONFIRMED'].includes(b.status);
  const active = canArrive || b.status === 'ARRIVED';
  const paidCents = (b.payments ?? []).filter((p) => p.status === 'PAID').reduce((s, p) => s + p.amountCents, 0);
  const posUrl = `/salon/pos?appointmentId=${b.id}&serviceId=${b.service?.id ?? ''}&staffId=${b.assignedStaff?.id ?? ''}&customerId=${b.customer?.id ?? ''}&customer=${encodeURIComponent(fullName)}`;
  // Everyone of this party still to be settled (cancelled / no-show / declined do not pay).
  const groupLive = b.groupId
    ? all.filter((x) => x.groupId === b.groupId && !['CANCELLED', 'NO_SHOW', 'REJECTED'].includes(String((x as { status?: string }).status ?? ''))).length
    : 0;

  return (
    <>
      {/* backdrop */}
      {/* Above the phone tab bar, not under it.
          The tab bar is position:fixed at zIndex 60. This drawer sat at 41 and
          its backdrop at 40, so on a phone the bar drew ON TOP of both — a
          bright strip across the bottom of a dimmed screen, covering the last
          64px of the drawer, which is exactly where the actions are. */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 70 }} />
      {/* right drawer */}
      <div style={{ position: 'fixed', top: 0, right: 0, height: '100dvh', width: 380, maxWidth: '90vw', background: 'var(--c111827)', borderLeft: '1px solid var(--c1f2937)', zIndex: 71, padding: 24, paddingTop: 'calc(24px + env(safe-area-inset-top, 0px))', paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))', overflowY: 'auto', WebkitOverflowScrolling: 'touch', boxShadow: '-8px 0 30px rgba(0,0,0,0.4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>{t('cal.detailsTitle')}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--c94a3b8)', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{b.service?.name ?? t('cal.service')}</div>
          <div style={{ marginTop: 8 }}>
            <StatusBadge status={b.status} startTime={b.startTime} />
          </div>
        </div>

        <DetailRow label={t('cal.dDate')} value={start.toLocaleDateString(locale, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric', ...(tz ? { timeZone: tz } : {}) })} />
        <DetailRow label={t('cal.dTime')} value={`${fmtTime(start, tz)} – ${fmtTime(end, tz)}`} />
        <DetailRow label={t('cal.dDuration')} value={(() => {
          // Say where the minutes come from when they are not just the services
          // ("120 phút" on a "60 mins" massage reads like a bug otherwise).
          const planned = b.service ? (b.service.durationMinutes ?? 0) + (b.addons ?? []).reduce((s, a) => s + (a.durationMinutes ?? 0), 0) : 0;
          const diff = duration - planned;
          if (!b.service || !planned || diff === 0) return `${duration} ${t('cal.min')}`;
          const vi = lang === 'vi';
          const why = diff > 0 ? (vi ? `dịch vụ ${planned} + thêm ${diff}` : `services ${planned} + ${diff} added`) : (vi ? `dịch vụ ${planned}, bớt ${-diff}` : `services ${planned}, ${-diff} less`);
          return <span>{duration} {t('cal.min')} <span style={{ color: 'var(--c94a3b8)', fontWeight: 500 }}>({why})</span></span>;
        })()} />
        {active && <QuickEdit b={b} onAction={onAction} />}
        {active && !b.assignedStaff && <UnassignedHelp bookingId={b.id} vi={lang === 'vi'} onAssign={() => onAction(b.id, 'auto-assign')} />}
        <DetailRow label={t('cal.dSource')} value={<SourceChip b={b} vi={lang === 'vi'} />} />
        {String(b.status).toUpperCase() === 'CANCELLED' && (() => {
          // "Đã huỷ" must answer BY WHOM — an authorless cancellation starts
          // arguments at the front desk.
          const vi = lang === 'vi';
          const who = b.cancelledBy === 'customer' ? (vi ? 'Khách tự huỷ' : 'Customer (self-service)')
            : b.cancelledBy === 'ai' ? (vi ? 'Trợ lý AI' : 'AI assistant')
            : b.cancelledBy === 'staff' ? `${vi ? 'Nhân viên' : 'Staff'}${b.cancelledByName ? ` · ${b.cancelledByName}` : ''}`
            : b.cancelledBy === 'system' ? `${vi ? 'Tự động' : 'Automatic'}${b.cancelledByName ? ` · ${b.cancelledByName}` : ''}`
            : (vi ? 'Không rõ (trước bản cập nhật)' : 'Unknown (pre-update)');
          return <DetailRow label={vi ? 'Huỷ bởi' : 'Cancelled by'} value={<span style={{ color: 'var(--cfca5a5)', fontWeight: 600 }}>{who}</span>} />;
        })()}
        {(() => { const dm = deviceMeta(b.device); return dm ? <DetailRow label={t('cal.dDevice')} value={`${dm.icon} ${t(dm.key)}`} /> : null; })()}
        <DetailRow label={t('cal.dPrice')} value={formatPrice(b.priceCents, b.currency)} />
        {b.partySize != null && b.partySize > 1 && <DetailRow label={t('cal.dParty')} value={String(b.partySize)} />}
        {(() => {
          // Everyone booked in the same party. Names beat a bare count: staff
          // seat the table by name, and it makes clear WHICH of the day's rows
          // belong together.
          if (!b.groupId) return null;
          const mates = all.filter((x) => x.groupId === b.groupId && x.id !== b.id);
          if (mates.length === 0) return null;
          const names = mates
            .map((m) => `${m.customer?.firstName ?? ''} ${m.customer?.lastName ?? ''}`.trim() || '—')
            .join(', ');
          return (
            <DetailRow
              label={t('cal.dGroup')}
              value={`${t('cal.dGroupWith').replace('{n}', String(mates.length + 1))} · ${names}`}
            />
          );
        })()}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', fontSize: 14 }}>
          <span style={{ color: 'var(--c94a3b8)' }}>{t('cal.dPaid')}</span>
          <span style={{ textAlign: 'right', fontWeight: 600, color: paidCents > 0 ? 'var(--ink-good)' : 'var(--ink-warn)' }}>
            {paidCents > 0 ? `✓ ${formatPrice(paidCents, b.currency)}` : (() => {
              // An online deposit the customer has not paid yet (the slot is held for her).
              const wait = (b.payments ?? []).find((p) => p.status === 'PENDING' && p.type === 'PAY_ONLINE');
              if (!wait || !active) return t('cal.unpaid');
              const since = wait.createdAt ? fmtTime(new Date(wait.createdAt), tz) : '';
              return lang === 'vi'
                ? `Chờ khách trả online ${formatPrice(wait.amountCents, b.currency)}${since ? ` (từ ${since})` : ''}`
                : `Waiting for online payment ${formatPrice(wait.amountCents, b.currency)}${since ? ` (since ${since})` : ''}`;
            })()}
          </span>
        </div>
        <ServiceLines b={b} onAction={onAction} editable={active} />
        <div style={{ marginTop: 12 }}><ClientFormsPanel appointmentId={b.id} /></div>

        {/* Status is editable in BOTH directions and at ANY status: pressing
            Complete by mistake used to leave the front desk with no way back. */}
        <StatusPicker b={b} onAction={onAction} />
        <VisitEditor b={b} onAction={onAction} />

        <div style={{ borderTop: '1px solid var(--c1f2937)', margin: '16px 0 12px' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--c94a3b8)', fontWeight: 600 }}>{t('cal.customer')}</span>
          {b.customer && (
            <button type="button" onClick={() => setEditing((x) => !x)}
              style={{ background: 'transparent', border: '1px solid var(--line-strong)', borderRadius: 8, color: 'var(--ink-link)', fontSize: 12, fontWeight: 700, padding: '3px 8px', cursor: 'pointer' }}>✎ {tr('wi.editInfo', lang)}</button>
          )}
        </div>
        {editing && b.customer && (
          <VisitContactEditor kind="booking" id={b.id}
            initial={{ firstName: b.customer.firstName, lastName: b.customer.lastName, phone: b.customer.phone, email: b.customer.email }}
            onCancel={() => setEditing(false)}
            onSaved={(r) => {
              setEditing(false);
              if (r.switched) window.setTimeout(() => notify('info', tr('wi.contactSwitched', lang)), 0);
              else if (r.emailSkipped) window.setTimeout(() => notify('info', tr('wi.emailSkipped', lang)), 0);
              onReload?.();
            }} />
        )}
        <DetailRow label={t('cal.dName')} value={fullName} />
        {b.customer?.phone && <DetailRow label={t('cal.dPhone')} value={b.customer.phone} />}
        {b.customer?.email && <DetailRow label={t('cal.dEmail')} value={b.customer.email} />}
        {/* Who the customer ASKED for — the hotline and the chat bot write it,
            and it is the one thing the desk must know before moving a booking. */}
        {b.preferredStaff && b.preferredStaff.id !== b.assignedStaff?.id && (
          <DetailRow label={t('cal.dPreferred')} value={<span style={{ color: 'var(--cfcd34d)', fontWeight: 600 }}>★ {`${b.preferredStaff.firstName} ${b.preferredStaff.lastName ?? ''}`.trim()}</span>} />
        )}
        {b.location && (
          <DetailRow label="📍" value={<a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.location)}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c818cf8)', textDecoration: 'none', textAlign: 'right' }}>{b.location}</a>} />
        )}
        {b.notes && <NoteBox label={t('cal.dNote')} text={b.notes} />}

        {active && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 20 }}>
            {/* A party that booked together pays together: one bill for everyone
                (the POS lays the people out one after another). Paying this one
                person alone stays right under it. */}
            {groupLive > 1 && b.groupId ? (
              <>
                <a href={`/salon/pos?appointmentId=${b.id}&groupId=${encodeURIComponent(b.groupId)}&customerId=${b.customer?.id ?? ''}`}
                  style={{ ...ui.primaryBtn, background: '#6366f1', width: '100%', padding: 12, textAlign: 'center', textDecoration: 'none', display: 'block', boxSizing: 'border-box' }}>
                  {t('bk.checkoutGroup').replace('{n}', String(groupLive))}
                </a>
                <a href={posUrl} style={{ ...ui.primaryBtn, background: 'transparent', border: '1px solid #6366f1', color: 'var(--ink-link)', width: '100%', padding: 10, textAlign: 'center', textDecoration: 'none', display: 'block', boxSizing: 'border-box' }}>
                  {t('cal.checkoutOne').replace('{name}', b.customer?.firstName || fullName)}
                </a>
              </>
            ) : (
              <a href={posUrl} style={{ ...ui.primaryBtn, background: '#6366f1', width: '100%', padding: 12, textAlign: 'center', textDecoration: 'none', display: 'block', boxSizing: 'border-box' }}>{t('cal.checkout')}</a>
            )}
            {canArrive && (
              <button onClick={() => onAction(b.id, 'arrive')} style={{ ...ui.primaryBtn, background: '#10b981', width: '100%', padding: '11px' }}>{t('cal.arrive')}</button>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => onAction(b.id, 'complete')} style={{ ...ui.primaryBtn, background: '#22c55e', flex: 1 }}>{t('cal.complete')}</button>
              <button onClick={() => onAction(b.id, 'cancel')} style={{ ...ui.dangerBtn, flex: 1 }}>{t('cal.cancel')}</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

const ALL_STATUSES = ['PENDING', 'ASSIGNED', 'ACCEPTED', 'CONFIRMED', 'ARRIVED', 'COMPLETED', 'NO_SHOW', 'CANCELLED', 'REJECTED'] as const;

/**
 * Free-form status change. The old drawer hid every action once a visit was
 * finished, so a mis-click on Complete was permanent from the UI's point of
 * view. Money follows the status server-side.
 */
function StatusPicker({ b, onAction }: { b: Booking; onAction: (id: string, path: string, body?: unknown) => void }) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [next, setNext] = useState(b.status);
  useEffect(() => { setNext(b.status); }, [b.status, b.id]);
  return (
    <div style={{ border: '1px solid var(--c334155)', borderRadius: 10, padding: 10, marginTop: 12, background: 'var(--c0f172a)' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c94a3b8)', marginBottom: 7 }}>{t('cal.setStatus')}</div>
      <div style={{ display: 'flex', gap: 6 }}>
        <select value={next} onChange={(e) => setNext(e.target.value)} style={{ ...ui.input, flex: 1, padding: '7px 8px', fontSize: 13 }}>
          {ALL_STATUSES.map((sName) => <option key={sName} value={sName}>{t(`cal.st${sName}`)}</option>)}
        </select>
        <button
          disabled={next === b.status}
          onClick={() => onAction(b.id, 'status', { status: next })}
          style={{ ...ui.primaryBtn, padding: '7px 14px', fontSize: 13, opacity: next === b.status ? 0.5 : 1, cursor: next === b.status ? 'default' : 'pointer' }}
        >{t('cal.apply')}</button>
      </div>
      {b.status === 'COMPLETED' && (
        <div style={{ fontSize: 11, color: 'var(--c64748b)', marginTop: 6, lineHeight: 1.5 }}>{t('cal.statusHint')}</div>
      )}
    </div>
  );
}

/**
 * Adjust a visit that is already running: the customer asks for one more
 * service, or the work is taking longer. Both change the price and the finish
 * time, and the server re-checks the technician's slot before saving.
 */
function VisitEditor({ b, onAction }: { b: Booking; onAction: (id: string, path: string, body?: unknown) => void }) {
  const { token } = useAuth();
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [services, setServices] = useState<{ id: string; name: string; durationMinutes: number; priceCents: number }[]>([]);
  const [pick, setPick] = useState('');
  const [minutes, setMinutes] = useState(0);
  const [drop, setDrop] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || !token || services.length) return;
    apiFetch<{ id: string; name: string; durationMinutes: number; priceCents: number; isActive: boolean }[]>('/services', { token })
      .then((r) => setServices(r.filter((x) => x.isActive)))
      .catch(() => undefined);
  }, [open, token, services.length]);
  useEffect(() => { setPick(''); setMinutes(0); setDrop([]); }, [b.id]);

  const lines = b.addons ?? [];
  const dirty = !!pick || minutes !== 0 || drop.length > 0;
  const vi = lang === 'vi';
  // The visit as booked now, and how far it may shrink (the API keeps at least 5 minutes).
  const curMin = Math.max(5, Math.round((new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / 60000));
  const minDelta = -(curMin - 5);
  if (b.status === 'CANCELLED' || b.status === 'REJECTED') return null;

  return (
    <div style={{ border: '1px solid var(--c334155)', borderRadius: 10, padding: 10, marginTop: 8, background: 'var(--c0f172a)' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ background: 'none', border: 'none', color: 'var(--c94a3b8)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}
      >
        {t('cal.editVisit')}<span style={{ marginLeft: 'auto', color: 'var(--c64748b)' }}>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 9, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {lines.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {lines.map((a, i) => (
                <label key={`${a.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: drop.includes(i) ? 'var(--c64748b)' : 'var(--ccbd5e1)', textDecoration: drop.includes(i) ? 'line-through' : 'none' }}>
                  <input
                    type="checkbox" checked={drop.includes(i)}
                    onChange={() => setDrop((d) => d.includes(i) ? d.filter((x) => x !== i) : [...d, i])}
                  />
                  {a.name} <span style={{ marginLeft: 'auto', color: 'var(--c64748b)' }}>{t('cal.removeLine')}</span>
                </label>
              ))}
            </div>
          )}
          <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ ...ui.input, padding: '7px 8px', fontSize: 13 }}>
            <option value="">{t('cal.addService')}</option>
            {services.map((sv) => <option key={sv.id} value={sv.id}>{sv.name} · {sv.durationMinutes}m</option>)}
          </select>
          {/* Time: shorter as well as longer. Only "+" existed, so a visit
              stretched by mistake could not be brought back down. The new
              length is spelled out (75 → 90 min) instead of a bare "+15m". */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)', flex: '1 1 70px' }}>{vi ? 'Thời gian' : 'Time'}</span>
            <button type="button" onClick={() => setMinutes((v) => Math.max(minDelta, v - 15))} disabled={minutes - 15 < minDelta} style={{ ...chipBtn, opacity: minutes - 15 < minDelta ? 0.4 : 1 }} aria-label={vi ? 'Bớt 15 phút' : 'Take off 15 minutes'}>−15m</button>
            {[15, 30, 60].map((m) => (
              <button key={m} type="button" onClick={() => setMinutes((v) => v + m)} style={chipBtn}>+{m}m</button>
            ))}
            <button type="button" onClick={() => setMinutes(0)} style={{ ...chipBtn, opacity: minutes === 0 ? 0.4 : 1 }} disabled={minutes === 0} title={vi ? 'Về như cũ' : 'Undo'}>↺</button>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: -2 }}>
            {curMin} {vi ? 'phút' : 'min'}
            {minutes !== 0 && <> → <b style={{ color: minutes > 0 ? 'var(--ink-good)' : 'var(--ink-warn)' }}>{curMin + minutes} {vi ? 'phút' : 'min'}</b> ({minutes > 0 ? '+' : '−'}{Math.abs(minutes)}m)</>}
          </div>
          {b.stretchWarning && (
            <div role="status" style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--ink-warn)', background: 'var(--wash-amber-3)', borderRadius: 8, padding: '7px 9px' }}>⚠ {b.stretchWarning}</div>
          )}
          <button
            disabled={!dirty || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onAction(b.id, 'lines', {
                  ...(pick ? { addServiceIds: [pick] } : {}),
                  ...(drop.length ? { removeIndexes: drop } : {}),
                  ...(minutes ? { extraMinutes: minutes } : {}),
                  lang: vi ? 'vi' : 'en',
                });
              } finally { setBusy(false); setPick(''); setMinutes(0); setDrop([]); }
            }}
            style={{ ...ui.primaryBtn, padding: '9px', fontSize: 13, opacity: (!dirty || busy) ? 0.5 : 1, cursor: (!dirty || busy) ? 'default' : 'pointer' }}
          >{busy ? t('cal.savingVisit') : t('cal.saveVisit')}</button>
        </div>
      )}
    </div>
  );
}

const chipBtn: React.CSSProperties = {
  border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)',
  borderRadius: 7, padding: '4px 8px', fontSize: 12, cursor: 'pointer',
};

// Inline quick edit inside the details drawer: move the booking to a new
// date/time (duration kept, conflicts re-checked server-side) or hand it to a
// different technician — one click each, no extra screens.
function QuickEdit({ b, onAction }: { b: Booking; onAction: (id: string, path: string, body?: unknown) => void }) {
  const { lang } = useLang();
  // The picker speaks SALON wall time, both reading the instant out and
  // writing the edit back — otherwise rescheduling from another timezone
  // silently moves the appointment.
  const [when, setWhen] = useState(() => instantToWall(b.startTime));
  // The staff picker that used to sit here moved into ServiceLines below:
  // one place answers "who does what", for one service or five.
  return (
    <div style={{ background: 'var(--c0f172a)', border: '1px solid var(--c1f2937)', borderRadius: 10, padding: 10, margin: '8px 0 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <DateTimeField value={when} onChange={setWhen} style={{ padding: '6px 8px' }} />
        <button onClick={() => onAction(b.id, 'reschedule', { startTime: wallToInstantISO(when) })} style={{ ...ui.primaryBtn, padding: '7px 12px', fontSize: 12.5, whiteSpace: 'nowrap' }}>{tr('bk.move', lang)}</button>
      </div>
    </div>
  );
}

/**
 * Every service on the visit with ITS OWN technician. The primary keeps the
 * calendar slot (change it via "Change staff" above); each extra line gets a
 * picker that writes straight onto the line item — the same field auto-assign
 * fills and the POS checkout pays commission from. Empty = the main tech
 * carries that service too.
 */
function ServiceLines({ b, onAction, editable }: { b: Booking; onAction: (id: string, path: string, body?: unknown) => void; editable: boolean }) {
  const { token } = useAuth();
  const { lang } = useLang();
  const [staff, setStaff] = useState<{ id: string; firstName: string; lastName: string | null; isActive: boolean }[]>([]);
  useEffect(() => {
    if (!token) return;
    apiFetch<{ id: string; firstName: string; lastName: string | null; isActive: boolean }[]>('/staff', { token })
      .then((list) => setStaff(list.filter((x) => x.isActive)))
      .catch(() => undefined);
  }, [token]);

  const lines = (b.addons ?? []).filter((a) => a.kind === 'service');
  const extras = (b.addons ?? []).filter((a) => a.kind !== 'service');

  const nameOf = (id?: string) => {
    const st = staff.find((x) => x.id === id);
    return st ? `${st.firstName} ${st.lastName ?? ''}`.trim() : null;
  };
  const primaryTech = b.assignedStaff
    ? `${b.assignedStaff.firstName} ${b.assignedStaff.lastName ?? ''}`.trim()
    : tr('cal.unassigned', lang);

  return (
    <div style={{ background: 'var(--c0f172a)', border: '1px solid var(--c1f2937)', borderRadius: 10, padding: 10, margin: '8px 0 4px' }}>
      <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', fontWeight: 600, marginBottom: 8 }}>
        {tr('cal.dServices', lang)} ({lines.length + 1})
      </div>

      {/* primary service — changing it re-assigns the visit's main tech
          (overlap-checked server-side, keeps CONFIRMED/ARRIVED status). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 13.5 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {b.service?.name ?? '—'}
          <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: 'var(--c818cf8)', border: '1px solid var(--c3730a3)', borderRadius: 6, padding: '1px 5px', verticalAlign: 'middle' }}>
            {tr('cal.lineMain', lang)}
          </span>
        </span>
        {editable ? (
          <select
            value={b.assignedStaff?.id ?? ''}
            onChange={(e) => { if (e.target.value) onAction(b.id, 'assign', { staffId: e.target.value }); }}
            style={{ ...ui.input, padding: '5px 7px', fontSize: 12.5, width: 150, flexShrink: 0, ...(b.assignedStaff ? {} : { color: 'var(--ink-warn)', borderColor: 'var(--c7c5c22)' }) }}
          >
            <option value="" disabled>{tr('cal.linePick', lang)}</option>
            {staff.map((x) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName ?? ''}</option>)}
          </select>
        ) : (
          <span style={{ color: b.assignedStaff ? 'var(--ce2e8f0)' : 'var(--ink-warn)', fontWeight: 600, whiteSpace: 'nowrap' }}>👤 {primaryTech}</span>
        )}
      </div>

      {/* extra service lines — each with its own tech picker */}
      {lines.map((line) => (
        <div key={line.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 13.5, borderTop: '1px solid var(--c1f2937)' }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line.name}</span>
          {editable ? (
            <select
              value={line.staffMemberId ?? ''}
              onChange={(e) => onAction(b.id, 'line-staff', { serviceId: line.id, staffId: e.target.value || null })}
              style={{ ...ui.input, padding: '5px 7px', fontSize: 12.5, width: 150, flexShrink: 0 }}
            >
              <option value="">{tr('cal.lineWithMain', lang)}</option>
              {staff.map((x) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName ?? ''}</option>)}
            </select>
          ) : (
            <span style={{ color: 'var(--ce2e8f0)', whiteSpace: 'nowrap' }}>👤 {nameOf(line.staffMemberId) ?? primaryTech}</span>
          )}
        </div>
      ))}

      {extras.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginTop: 6 }}>
          {tr('cal.dAddons', lang)}: {extras.map((a) => a.name).join(', ')}
        </div>
      )}
    </div>
  );
}

/**
 * A note the way it was written — line breaks kept. An AI booking's note is
 * two lines (where it came from · phone · technician asked for · group, then
 * what the customer said) and used to be flattened into one grey run.
 */
function NoteBox({ label, text }: { label: string; text: string }) {
  const ai = /^[☎️💬]/u.test(text);
  return (
    <div style={{ padding: '6px 0', fontSize: 14 }}>
      <div style={{ color: 'var(--c94a3b8)', marginBottom: 4 }}>{label}</div>
      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.45, padding: '8px 10px', borderRadius: 8, background: ai ? 'rgba(99,102,241,0.10)' : 'var(--c0f172a)', border: `1px solid ${ai ? 'rgba(99,102,241,0.35)' : 'var(--line)'}`, color: 'var(--ce2e8f0)' }}>{text}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', fontSize: 14 }}>
      <span style={{ color: 'var(--c94a3b8)' }}>{label}</span>
      <span style={{ textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

function StatusBadge({ status, startTime }: { status: string; startTime?: string }) {
  const { lang } = useLang();
  const m = statusBucket(status, startTime);
  return <span style={{ color: m.color, border: `1px solid ${m.color}`, borderRadius: 999, padding: '3px 12px', fontSize: 12, fontWeight: 600 }}>{tr('cal.st' + m.key, lang)}</span>;
}

function fmtTime(d: Date, tz?: string) {
  return d.toLocaleTimeString(uiLocale(), { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
}

// Salon-timezone-aware day key (YYYY-MM-DD): a booking lands on the salon's
// Booking channel -> {icon, i18n key}. Legacy values (online/web/mobile) still map
// so old rows render sensibly. 'web'/'mobile' were once written into source by a
// bug that has since been fixed to store them in `device` instead.
const SOURCE_META: Record<string, { icon: string; key: string }> = {
  plugin:    { icon: '🌐', key: 'cal.srcPlugin' },
  hosted:    { icon: '🔗', key: 'cal.srcHosted' },
  hotline:   { icon: '📞', key: 'cal.srcHotline' },
  messenger: { icon: '💬', key: 'cal.srcMessenger' },
  admin:     { icon: '🏪', key: 'cal.srcAdmin' },
  walkin:    { icon: '🚶', key: 'cal.srcWalkin' },
  online:    { icon: '🌐', key: 'cal.srcOnline' },
  web:       { icon: '🌐', key: 'cal.srcOnline' },
  mobile:    { icon: '🌐', key: 'cal.srcOnline' },
};
function sourceMeta(src?: string | null) { return src ? (SOURCE_META[src] ?? { icon: '🌐', key: 'cal.srcOnline' }) : null; }
function deviceMeta(dev?: string | null) {
  if (dev === 'mobile') return { icon: '📱', key: 'cal.devMobile' };
  if (dev === 'web') return { icon: '💻', key: 'cal.devWeb' };
  return null;
}

// Compact origin chip for calendar cards. The SOURCE comes from the shared
// resolver (lib/booking-sources) — the same one the month grid, the legend,
// the filter and the detail sheet use. It used to read the raw door
// (`hosted` → "Lumio link") and so contradicted the month view for every
// Google customer who arrived through the Lumio link.
function OriginChip({ b }: { b: Booking; t?: (k: string) => string }) {
  const { lang } = useLang();
  const vi = lang === 'vi';
  const m = srcMetaOf(b);
  const dm = deviceMeta(b.device);
  const devLabel = dm ? (dm.key === 'cal.devMobile' ? (vi ? 'Điện thoại' : 'Phone') : (vi ? 'Máy tính' : 'Computer')) : '';
  return (
    <span title={[vi ? m.labelVi : m.labelEn, devLabel].filter(Boolean).join(' · ')}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0, fontSize: 10.5, fontWeight: 600,
        color: 'var(--ccbd5e1)', background: 'var(--c1e293b)', border: '1px solid var(--c334155)', borderRadius: 999, padding: '1px 7px 1px 3px', whiteSpace: 'nowrap' }}>
      <SourceDot b={b} vi={vi} />
      <span>{vi ? m.labelVi : m.labelEn}</span>
      {dm && <span style={{ opacity: 0.85 }}>{dm.icon}</span>}
    </span>
  );
}

// calendar day regardless of the admin device timezone. Grid cells are built at
// local midnight, so cellKey keys them by their plain calendar Y-M-D to match.
function dayKeyTz(d: Date, tz?: string): string {
  return d.toLocaleDateString('en-CA', tz ? { timeZone: tz } : undefined);
}
function cellKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildMonth(view: Date): (Date | null)[] {
  const year = view.getFullYear(), month = view.getMonth();
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) { const dt = new Date(year, month, d); dt.setHours(0, 0, 0, 0); cells.push(dt); }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const navBtn: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'var(--c1e293b)', color: 'var(--ce2e8f0)', fontSize: 13, cursor: 'pointer',
};

const navIconBtn: React.CSSProperties = {
  width: 40, height: 40, flexShrink: 0, padding: 0, borderRadius: 10, border: '1px solid var(--c334155)', background: 'var(--c1e293b)', color: 'var(--ce2e8f0)', fontSize: 18, cursor: 'pointer',
};

const pickerBtn: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 8, border: '1px solid #4f46e5', background: 'var(--c1e293b)', color: 'var(--ce2e8f0)', fontSize: 13, fontWeight: 600, cursor: 'pointer', minWidth: 128, textAlign: 'center', whiteSpace: 'nowrap',
};

// Zero-size but still rendered, so the browser's native month/date picker
// (input.showPicker()) can anchor to it without showing a visible field.
const hiddenInput: React.CSSProperties = {
  width: 0, height: 0, opacity: 0, pointerEvents: 'none', border: 0, padding: 0, margin: 0, overflow: 'hidden', flex: '0 0 0px',
};
