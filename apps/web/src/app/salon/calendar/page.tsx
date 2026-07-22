'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SalonShell } from '../../../components/SalonShell';
import { FloorView } from '../../../components/FloorView';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui, formatPrice } from '../../../lib/ui';
import { useLang, tr, DAY_LABEL } from '../../../lib/i18n';
import { useLiveRefresh } from '../../../lib/useLiveRefresh';
import { useIsMobile } from '../../../lib/responsive';
import { StaffDayView } from './StaffDayView';
import { TableDayView } from './TableDayView';

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
  device?: string | null;
  partySize?: number;
  addons?: Addon[];
  payments?: { status: string; amountCents: number }[];
  customer: { id: string; firstName: string; lastName: string | null; email: string | null; phone: string | null } | null;
  service: { id: string; name: string; durationMinutes: number } | null;
  assignedStaff: { id: string; firstName: string; lastName: string | null } | null;
  tableId?: string | null;
  table?: { id: string; name: string; seats: number } | null;
}

// Six operational buckets the front desk actually tracks. The 8 raw enum values
// fold into these so the calendar reads at a glance (key → bilingual label via
// `cal.st<Key>`; color → dot/stripe).
const STATUS_BUCKETS: { key: string; color: string }[] = [
  { key: 'Pending', color: '#f59e0b' },
  { key: 'Confirmed', color: '#3b82f6' },
  { key: 'Arrived', color: '#10b981' },
  { key: 'Completed', color: '#8b5cf6' },
  { key: 'NoShow', color: '#ef4444' },
  { key: 'Cancelled', color: '#64748b' },
];
function statusBucket(status: string): { key: string; color: string } {
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
  const { token } = useAuth();
  const { lang } = useLang();
  const isMobile = useIsMobile();
  const t = (k: string) => tr(k, lang);
  const locale = 'en-US'; // dates always render US month/day/year
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Booking | null>(null);
  const [search, setSearch] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const [view, setView] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  // Month grid vs. detailed single-day timeline.
  const [mode, setMode] = useState<'month' | 'day' | 'staff' | 'floor'>('month');
  // Day view: a scannable card grid (best for busy days) or a time-axis timeline.
  const [dayLayout, setDayLayout] = useState<'grid' | 'timeline'>(() => {
    if (typeof window === 'undefined') return 'grid';
    return window.localStorage.getItem('lumio_day_layout') === 'timeline' ? 'timeline' : 'grid';
  });
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
  const [isRestaurant, setIsRestaurant] = useState<boolean>(() => (typeof window !== 'undefined' && window.localStorage.getItem('lumio_is_restaurant') === '1'));
  useEffect(() => {
    if (!token) return;
    apiFetch<{ company?: { timezone?: string } }>('/settings', { token })
      .then((s) => { const z = s.company?.timezone || undefined; setTz(z); if (z) { try { window.localStorage.setItem('lumio_tz', z); } catch { /* ignore */ } } })
      .catch(() => undefined);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ businessType?: string }>('/me/tenant', { token })
      .then((r) => { const on = r?.businessType === 'RESTAURANT'; setIsRestaurant(on); try { window.localStorage.setItem('lumio_is_restaurant', on ? '1' : '0'); } catch { /* ignore */ } })
      .catch(() => undefined);
  }, [token]);
  const fmtT = useCallback(
    (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }),
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
    const iv = window.setInterval(tick, 30000);
    return () => { alive = false; window.clearInterval(iv); };
  }, [token]);
  useLiveRefresh(load, 15000); // new bookings appear within ~15s, no reload needed

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
  const filtered = useMemo(() => {
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
    const upcoming = withItems.filter((d) => d.getTime() >= today.getTime()).sort((a, b) => a.getTime() - b.getTime());
    const past = withItems.filter((d) => d.getTime() < today.getTime()).sort((a, b) => b.getTime() - a.getTime());
    return [...upcoming, ...past];
  }, [days, byDay, today]);
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

  async function action(id: string, path: string) {
    try {
      await apiFetch(`/bookings/${id}/${path}`, { method: 'POST', token });
      setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    }
  }

  if (mode === 'floor') {
    return (
      <section style={fullscreen ? { position: 'fixed', inset: 0, zIndex: 100, background: '#0b1120', padding: '14px 18px', overflow: 'auto' } : undefined}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <h1 style={{ fontSize: isMobile ? 20 : 24, margin: 0 }}>{t('cal.title')}</h1>
          <div style={{ display: 'inline-flex', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: 3, ...(isMobile ? { flex: '1 1 100%' } : {}) }}>
            <button onClick={() => setMode('month')} style={{ ...segBtn(false), ...(isMobile ? { flex: 1 } : {}) }}>{t('cal.viewMonth')}</button>
            <button onClick={() => setMode('day')} style={{ ...segBtn(false), ...(isMobile ? { flex: 1 } : {}) }}>{t('cal.viewDay')}</button>
            <button onClick={() => setMode('staff')} style={{ ...segBtn(false), ...(isMobile ? { flex: 1 } : {}) }}>{isRestaurant ? t('cal.viewTables') : t('cal.viewStaff')}</button>
            <button onClick={() => setMode('floor')} style={{ ...segBtn(true), ...(isMobile ? { flex: 1 } : {}) }}>{lang === 'vi' ? 'Sơ đồ ghế' : 'Floor'}</button>
          </div>
        </div>
        <FloorView token={token} lang={lang} />
      </section>
    );
  }

  return (
    <section style={fullscreen ? { position: 'fixed', inset: 0, zIndex: 100, background: '#0b1120', padding: '14px 18px', overflow: 'auto' } : undefined}>
      {/* Row 1: title + view toggle (toggle is full-width on phones) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <h1 style={{ fontSize: isMobile ? 20 : 24, margin: 0 }}>{t('cal.title')}</h1>
        <div style={{ display: 'inline-flex', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: 3, ...(isMobile ? { flex: '1 1 100%' } : {}) }}>
          <button onClick={() => setMode('month')} style={{ ...segBtn(mode === 'month'), ...(isMobile ? { flex: 1 } : {}) }}>{t('cal.viewMonth')}</button>
          <button onClick={() => setMode('day')} style={{ ...segBtn(mode === 'day'), ...(isMobile ? { flex: 1 } : {}) }}>{t('cal.viewDay')}</button>
          <button onClick={() => setMode('staff')} style={{ ...segBtn(mode === 'staff'), ...(isMobile ? { flex: 1 } : {}) }}>{isRestaurant ? t('cal.viewTables') : t('cal.viewStaff')}</button>
          {!isRestaurant && <button onClick={() => setMode('floor')} style={{ ...segBtn(false), ...(isMobile ? { flex: 1 } : {}) }}>{lang === 'vi' ? 'Sơ đồ ghế' : 'Floor'}</button>}
        </div>
      </div>

      {/* Row 2: date navigation. Month mode = month arrows + month picker; Day/Staff = day arrows, month arrows, date picker. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 12, justifyContent: isMobile ? 'center' : 'flex-start' }}>
        {mode === 'month' ? (
          <>
            <button style={navBtn} onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))} aria-label={lang === 'vi' ? 'Tháng trước' : 'Previous month'}>‹</button>
            <button style={pickerBtn} onClick={openMonthPicker} title={lang === 'vi' ? 'Chọn tháng' : 'Pick a month'}>{monthLabel} ▾</button>
            <button style={navBtn} onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))} aria-label={lang === 'vi' ? 'Tháng sau' : 'Next month'}>›</button>
            <button style={navBtn} onClick={() => setView(new Date(today.getFullYear(), today.getMonth(), 1))}>{t('cal.today')}</button>
          </>
        ) : (
          <>
            <button style={navBtn} onClick={() => dayJumpMonth(-1)} title={lang === 'vi' ? 'Tháng trước' : 'Previous month'} aria-label={lang === 'vi' ? 'Tháng trước' : 'Previous month'}>«</button>
            <button style={navBtn} onClick={() => goDay(new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate() - 1))} aria-label={lang === 'vi' ? 'Ngày trước' : 'Previous day'}>‹</button>
            <button style={pickerBtn} onClick={openDayPicker} title={lang === 'vi' ? 'Chọn ngày' : 'Pick a date'}>{dayDate.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })} ▾</button>
            <button style={navBtn} onClick={() => goDay(new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate() + 1))} aria-label={lang === 'vi' ? 'Ngày sau' : 'Next day'}>›</button>
            <button style={navBtn} onClick={() => dayJumpMonth(1)} title={lang === 'vi' ? 'Tháng sau' : 'Next month'} aria-label={lang === 'vi' ? 'Tháng sau' : 'Next month'}>»</button>
            <button style={navBtn} onClick={() => goDay(today)}>{t('cal.today')}</button>
          </>
        )}
        <input ref={monthInputRef} type="month" value={`${view.getFullYear()}-${String(view.getMonth() + 1).padStart(2, '0')}`} onChange={onMonthPick} style={hiddenInput} tabIndex={-1} aria-hidden="true" />
        <input ref={dayInputRef} type="date" value={cellKey(dayDate)} onChange={onDayPick} style={hiddenInput} tabIndex={-1} aria-hidden="true" />
      </div>

      {/* Row 3: search + full screen */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={lang === 'vi' ? 'Tìm khách theo tên hoặc số điện thoại…' : 'Search customer by name or phone…'} style={{ flex: '1 1 240px', maxWidth: isMobile ? undefined : 380, padding: '9px 12px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', fontSize: 14 }} />
        {search && <button onClick={() => setSearch('')} style={navBtn} title="Clear">✕</button>}
        <button onClick={toggleFull} style={{ ...navBtn, marginLeft: 'auto' }} title={fullscreen ? (lang === 'vi' ? 'Thoát toàn màn hình' : 'Exit full screen') : (lang === 'vi' ? 'Toàn màn hình' : 'Full screen')}>{fullscreen ? '✕' : '⛶'}{isMobile ? '' : (fullscreen ? (lang === 'vi' ? ' Thoát' : ' Exit') : (lang === 'vi' ? ' Toàn màn hình' : ' Full screen'))}</button>
      </div>

      {error && <div style={ui.banner}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {STATUS_BUCKETS.map((s) => (
            <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#cbd5e1' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
              {t('cal.st' + s.key)}
            </span>
          ))}
        </div>
        <div style={{ fontSize: 13, color: '#94a3b8' }}>
          {t('cal.todayLabel')}: <strong style={{ color: '#e2e8f0' }}>{todayStats.total}</strong> {t('cal.apptWord')}
          {todayStats.pending > 0 && <> · <span style={{ color: '#f59e0b' }}>{todayStats.pending} {t('cal.stPending')}</span></>}
          {todayStats.arrived > 0 && <> · <span style={{ color: '#10b981' }}>{todayStats.arrived} {t('cal.stArrived')}</span></>}
          {walkinNow > 0 && <> · <span style={{ color: '#f59e0b' }}>{walkinNow} {lang === 'vi' ? 'khách vãng lai' : 'walk-in'}</span></>}
        </div>
      </div>

      {mode === 'staff' ? (
        isRestaurant ? (
          <TableDayView date={dayDate} items={byDay.get(cellKey(dayDate)) ?? []} tz={tz} isMobile={isMobile} onOpen={setSelected} today={today} onChanged={load} />
        ) : (
          <StaffDayView date={dayDate} items={byDay.get(cellKey(dayDate)) ?? []} tz={tz} isMobile={isMobile} onOpen={setSelected} today={today} onChanged={load} />
        )
      ) : mode === 'day' ? (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
            <div style={{ display: 'inline-flex', background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: 3 }}>
              <button onClick={() => pickDayLayout('grid')} style={segBtn(dayLayout === 'grid')}>▦ {lang === 'vi' ? 'Lưới' : 'Grid'}</button>
              <button onClick={() => pickDayLayout('timeline')} style={segBtn(dayLayout === 'timeline')}>☰ {lang === 'vi' ? 'Dòng thời gian' : 'Timeline'}</button>
            </div>
          </div>
          {dayLayout === 'grid'
            ? <DayGrid date={dayDate} items={byDay.get(cellKey(dayDate)) ?? []} tz={tz} isMobile={isMobile} onOpen={setSelected} today={today} />
            : <DayView date={dayDate} items={byDay.get(cellKey(dayDate)) ?? []} tz={tz} isMobile={isMobile} onOpen={setSelected} today={today} />}
        </div>
      ) : isMobile ? (
        /* Phones: day-by-day agenda — nearest day to today on top, paginated. */
        orderedMonthDays.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: 14, padding: '20px 0', textAlign: 'center' }}>{t('cal.noneThisMonth')}</p>
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {monthPageDays.map((d) => {
            const items = byDay.get(cellKey(d)) ?? [];
            const isToday = d.getTime() === today.getTime();
            const isPast = d.getTime() < today.getTime();
            return (
              <div key={d.toDateString()} style={{ ...ui.card, padding: 12, opacity: isPast ? 0.72 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: isToday ? '#818cf8' : '#e2e8f0' }}>
                    {d.toLocaleDateString(locale, { weekday: 'long', month: 'short', day: 'numeric' })}{isToday ? ' · ' + t('cal.todayLabel') : ''}
                  </span>
                  {isPast && <span style={{ fontSize: 10.5, color: '#64748b', border: '1px solid #334155', borderRadius: 999, padding: '1px 7px' }}>{lang === 'vi' ? 'đã qua' : 'past'}</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#64748b' }}>{items.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {items.map((b) => {
                    const m = statusBucket(b.status);
                    return (
                      <div key={b.id} onClick={() => setSelected(b)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '10px 11px', borderRadius: 7, background: '#1e293b', borderLeft: `3px solid ${m.color}`, cursor: 'pointer' }}>
                        <span style={{ fontWeight: 700, whiteSpace: 'nowrap', color: '#e2e8f0' }}>{fmtT(b.startTime)}</span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#cbd5e1' }}>{name(b.customer)}{b.service?.name ? ' · ' + b.service.name : ''}</span>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {monthPageCount > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 4 }}>
              <button style={{ ...navBtn, opacity: monthSafePage === 0 ? 0.5 : 1 }} disabled={monthSafePage === 0} onClick={() => setMonthPage((pp) => Math.max(0, pp - 1))}>‹ {lang === 'vi' ? 'Trước' : 'Prev'}</button>
              <span style={{ fontSize: 13, color: '#94a3b8' }}>{lang === 'vi' ? 'Trang' : 'Page'} {monthSafePage + 1}/{monthPageCount}</span>
              <button style={{ ...navBtn, opacity: monthSafePage >= monthPageCount - 1 ? 0.5 : 1 }} disabled={monthSafePage >= monthPageCount - 1} onClick={() => setMonthPage((pp) => Math.min(monthPageCount - 1, pp + 1))}>{lang === 'vi' ? 'Sau' : 'Next'} ›</button>
            </div>
          )}
        </div>
        )
      ) : (
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', borderRadius: 12 }}>
      <style>{`.cal-ev{transition:filter .12s ease}.cal-ev:hover{filter:brightness(1.2)}`}</style>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 1, minWidth: 680, background: '#243044', border: '1px solid #243044', borderRadius: 12, overflow: 'hidden' }}>
        {[1, 2, 3, 4, 5, 6, 0].map((dow) => {
          const weekend = dow === 0 || dow === 6;
          const todayCol = today.getDay() === dow;
          return (
            <div key={dow} style={{ background: '#1e293b', textAlign: 'center', padding: '9px 0', fontSize: 11.5, letterSpacing: 0.6, textTransform: 'uppercase', color: todayCol ? '#a5b4fc' : weekend ? '#8ea2c4' : '#94a3b8', fontWeight: 700 }}>{DAY_LABEL[lang][dow]}</div>
          );
        })}
        {days.map((d, i) => {
          const items = d ? byDay.get(cellKey(d)) ?? [] : [];
          const isToday = !!d && d.getTime() === today.getTime();
          const dow = d ? d.getDay() : -1;
          const weekend = dow === 0 || dow === 6;
          const cellBg = !d ? '#0b1322' : isToday ? '#151f38' : weekend ? '#0d1526' : '#0f172a';
          return (
            <div key={i} style={{ background: cellBg, minHeight: 116, minWidth: 0, overflow: 'hidden', padding: 7, opacity: d ? 1 : 0.5, boxShadow: isToday ? 'inset 0 0 0 1.5px #4f46e5' : undefined }}>
              {d && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <span onClick={() => goDay(d)} title={t('cal.viewDay')}
                      style={{ display: 'inline-grid', placeItems: 'center', minWidth: 22, height: 22, padding: '0 6px', borderRadius: 999, fontSize: 12.5, fontWeight: isToday ? 800 : 600, color: isToday ? '#fff' : '#cbd5e1', background: isToday ? '#6366f1' : 'transparent', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      {d.getDate()}
                    </span>
                    {items.length > 0 && <span style={{ fontSize: 10.5, color: '#64748b', fontWeight: 700 }}>{items.length}</span>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {items.slice(0, 4).map((b) => {
                      const m = statusBucket(b.status);
                      const dim = m.key === 'Cancelled' || m.key === 'NoShow';
                      const strike = m.key === 'Cancelled' ? 'line-through' : 'none';
                      return (
                        <div key={b.id} className="cal-ev" title={`${t('cal.st' + m.key)} · ${b.service?.name ?? ''} · ${name(b.customer)}`}
                          onClick={() => setSelected(b)}
                          style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, fontSize: 11, padding: '3px 7px', borderRadius: 5, background: `${m.color}1f`, borderLeft: `3px solid ${m.color}`, cursor: 'pointer', opacity: dim ? 0.55 : 1, overflow: 'hidden' }}>
                          {(() => { const sm = sourceMeta(b.source); return sm ? <span style={{ flexShrink: 0, fontSize: 10 }} title={t(sm.key)}>{sm.icon}</span> : null; })()}
                          <span style={{ fontWeight: 700, whiteSpace: 'nowrap', color: m.color, textDecoration: strike, flexShrink: 0 }}>{fmtT(b.startTime)}</span>
                          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#dbe2ea', textDecoration: strike }}>{name(b.customer)}{b.service?.name ? ` · ${b.service.name}` : ''}</span>
                        </div>
                      );
                    })}
                    {items.length > 4 && <div onClick={() => goDay(d)} style={{ fontSize: 10.5, color: '#818cf8', cursor: 'pointer', fontWeight: 600, padding: '2px 4px 0' }}>{t('cal.more').replace('{n}', String(items.length - 4))}</div>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      </div>
      )}

      {selected && (
        <BookingDetail booking={selected} tz={tz} onClose={() => setSelected(null)} onAction={action} />
      )}
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

function DayView({ date, items, tz, isMobile, onOpen, today }: {
  date: Date; items: Booking[]; tz?: string; isMobile: boolean; onOpen: (b: Booking) => void; today: Date;
}) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const fmtT = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
  const minInTz = (iso: string) => {
    const d = new Date(iso);
    if (!tz) return d.getHours() * 60 + d.getMinutes();
    const p = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).formatToParts(d);
    return (Number(p.find((x) => x.type === 'hour')?.value ?? 0) % 24) * 60 + Number(p.find((x) => x.type === 'minute')?.value ?? 0);
  };

  const isToday = date.getTime() === today.getTime();
  const revenue = items.reduce((s, b) => s + (b.status === 'CANCELLED' || b.status === 'NO_SHOW' ? 0 : b.priceCents), 0);
  const currency = items[0]?.currency ?? 'USD';

  const ev = items
    .map((b) => {
      const s = minInTz(b.startTime);
      let e = minInTz(b.endTime);
      if (e <= s) e = s + (Math.round((new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / 60000) || 30);
      return { b, s, e };
    })
    .sort((a, z) => a.s - z.s || a.e - z.e);

  // Tight window: ~1h of air before the first and after the last appointment
  // (min 6h span), so the day reads compact instead of a mostly-empty grid.
  let startH = 9, endH = 18;
  if (ev.length) {
    startH = Math.floor(ev[0].s / 60) - 1;
    endH = Math.ceil(Math.max(...ev.map((x) => x.e)) / 60) + 1;
  }
  startH = Math.max(6, startH); endH = Math.min(23, endH);
  while (endH - startH < 6 && endH < 22) endH++;
  while (endH - startH < 6 && startH > 6) startH--;
  const gStart = startH * 60;
  const HP = isMobile ? 60 : 66;
  const railW = isMobile ? 46 : 60;
  const total = (endH - startH) * HP;

  type Pos = { b: Booking; s: number; e: number; col: number; cols: number };
  const pos: Pos[] = [];
  let cluster: { b: Booking; s: number; e: number; col: number }[] = [];
  let clusterEnd = -1;
  const laneEnds: number[] = [];
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    for (const c of cluster) pos.push({ ...c, cols });
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

  const nowMin = isToday ? minInTz(new Date().toISOString()) : -1;
  const nowTop = nowMin >= gStart && nowMin <= endH * 60 ? (nowMin - gStart) / 60 * HP : -1;
  const nextB = isToday ? (ev.find((x) => x.e > nowMin)?.b ?? null) : null;

  return (
    <div>
      <style>{`.cal-day-card{transition:filter .12s ease, box-shadow .12s ease, transform .06s ease}.cal-day-card:hover{filter:brightness(1.14)}.cal-day-card:active{transform:scale(.995)}`}</style>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, padding: '10px 14px', background: '#111827', border: '1px solid #1f2937', borderRadius: 10 }}>
        <span style={{ fontSize: 14 }}><strong style={{ fontSize: 18 }}>{items.length}</strong> <span style={{ color: '#94a3b8' }}>{t('cal.apptWord')}</span></span>
        <span style={{ color: '#334155' }}>|</span>
        <span style={{ fontSize: 14 }}><span style={{ color: '#94a3b8' }}>{t('cal.expected')}: </span><strong style={{ color: '#22c55e' }}>{formatPrice(revenue, currency)}</strong></span>
        {ev.length > 0 && <><span style={{ color: '#334155' }}>|</span><span style={{ fontSize: 13, color: '#94a3b8' }}>{fmtT(ev[0].b.startTime)} – {fmtT(ev[ev.length - 1].b.endTime)}</span></>}
        {nextB && <><span style={{ color: '#334155' }}>|</span><span style={{ fontSize: 13, color: '#cbd5e1' }}>{lang === 'vi' ? 'Kế tiếp' : 'Next'}: <strong style={{ color: '#f1f5f9' }}>{fmtT(nextB.startTime)}</strong> {nextB.customer?.firstName ?? ''}</span></>}
      </div>

      {items.length === 0 ? (
        <div style={{ ...ui.card, textAlign: 'center', color: '#64748b', padding: '44px 0', fontSize: 14 }}>{t('cal.noAppts')}</div>
      ) : (
        <div style={{ display: 'flex', background: '#0f172a', border: '1px solid #1f2937', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ width: railW, flexShrink: 0, position: 'relative', height: total, borderRight: '1px solid #1f2937' }}>
            {Array.from({ length: endH - startH + 1 }, (_, i) => startH + i).map((h) => (
              <div key={h} style={{ position: 'absolute', top: (h - startH) * HP - 6, right: 8, fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>
                {((h % 12) || 12)}{h < 12 ? 'a' : 'p'}
              </div>
            ))}
          </div>
          <div style={{ position: 'relative', flex: 1, height: total }}>
            {Array.from({ length: endH - startH + 1 }, (_, i) => i).map((i) => (
              <div key={i} style={{ position: 'absolute', top: i * HP, left: 0, right: 0, borderTop: '1px solid #1e293b' }} />
            ))}
            {nowTop >= 0 && (
              <div style={{ position: 'absolute', top: nowTop, left: 0, right: 0, borderTop: '2px solid #ef4444', zIndex: 5 }}>
                <span style={{ position: 'absolute', left: -1, top: -5, width: 9, height: 9, borderRadius: '50%', background: '#ef4444' }} />
                <span style={{ position: 'absolute', right: 6, top: -9, background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 800, borderRadius: 5, padding: '1px 6px' }}>{fmtT(new Date().toISOString())}</span>
              </div>
            )}
            {pos.map(({ b, s, e, col, cols }) => {
              const m = statusBucket(b.status);
              const top = (s - gStart) / 60 * HP;
              const h = Math.max(44, (e - s) / 60 * HP - 4);
              const dim = b.status === 'CANCELLED' || b.status === 'NO_SHOW';
              const struck = b.status === 'CANCELLED';
              const w = 100 / cols;
              const wide = cols === 1 && !isMobile;
              const client = b.customer ? `${b.customer.firstName}${b.customer.lastName ? ' ' + b.customer.lastName : ''}` : '—';
              const tech = b.assignedStaff ? b.assignedStaff.firstName : t('cal.unassigned');
              const initial = b.assignedStaff ? b.assignedStaff.firstName.charAt(0).toUpperCase() : '?';
              const aColor = b.assignedStaff ? avatarColor(b.assignedStaff.id) : '#475569';
              const durMin = Math.max(0, Math.round((new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / 60000));
              const isNext = nextB?.id === b.id;
              return (
                <div key={b.id} onClick={() => onOpen(b)} className="cal-day-card" title={`${fmtT(b.startTime)} · ${client} · ${b.service?.name ?? ''}`}
                  style={{ position: 'absolute', top, height: h, left: `calc(${col * w}% + 4px)`, width: `calc(${w}% - 8px)`,
                    background: dim ? '#161f30' : `linear-gradient(180deg, ${m.color}26, ${m.color}12)`,
                    border: `1px solid ${m.color}55`, borderLeft: `4px solid ${m.color}`, borderRadius: 10,
                    boxShadow: isNext ? `0 0 0 2px ${m.color}, 0 4px 16px ${m.color}44` : '0 1px 3px rgba(0,0,0,0.35)',
                    padding: wide ? '0 12px' : '5px 9px', overflow: 'hidden', cursor: 'pointer', boxSizing: 'border-box', opacity: dim ? 0.72 : 1,
                    display: 'flex', flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'center' : 'stretch', gap: wide ? 12 : 1 }}>
                  {wide ? (
                    <>
                      <div style={{ width: 94, flexShrink: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: '#f1f5f9', whiteSpace: 'nowrap' }}>{fmtT(b.startTime)}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>{fmtT(b.endTime)} · {durMin}m</div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14.5, fontWeight: 700, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: struck ? 'line-through' : 'none' }}>{client}</div>
                        <div style={{ fontSize: 12.5, color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.service?.name ?? ''}{b.partySize && b.partySize > 1 ? ` · ${b.partySize}` : ''}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
                        <span style={{ width: 26, height: 26, borderRadius: '50%', background: aColor, color: '#fff', fontSize: 12, fontWeight: 700, display: 'grid', placeItems: 'center', flexShrink: 0 }}>{initial}</span>
                        <span style={{ fontSize: 12.5, color: '#cbd5e1', whiteSpace: 'nowrap', maxWidth: 96, overflow: 'hidden', textOverflow: 'ellipsis' }}>{tech}</span>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#22c55e', flexShrink: 0, minWidth: 54, textAlign: 'right' }}>{formatPrice(b.priceCents, b.currency)}</div>
                      <span style={{ flexShrink: 0, color: m.color, border: `1px solid ${m.color}`, borderRadius: 999, padding: '2px 9px', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{t('cal.st' + m.key)}</span>
                    </>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: m.color, whiteSpace: 'nowrap' }}>{fmtT(b.startTime)}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: '#22c55e', whiteSpace: 'nowrap' }}>{formatPrice(b.priceCents, b.currency)}</span>
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: struck ? 'line-through' : 'none' }}>{client}</div>
                      {h > 50 && <div style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.service?.name ?? ''}{b.assignedStaff ? ` · ${tech}` : ''}</div>}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <p style={{ color: '#64748b', fontSize: 12, marginTop: 10 }}>{t('cal.dayHint')}</p>
    </div>
  );
}

// Day view as a scannable card grid — grouped by morning / afternoon / evening,
// wrapping into as many columns as fit. Much easier to read on a busy day than a
// squished time-axis.
function DayGrid({ date, items, tz, isMobile, onOpen, today }: {
  date: Date; items: Booking[]; tz?: string; isMobile: boolean; onOpen: (b: Booking) => void; today: Date;
}) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const L = (vi: string, en: string) => (lang === 'vi' ? vi : en);
  const fmtT = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
  const hourInTz = (iso: string) => {
    const d = new Date(iso);
    if (!tz) return d.getHours();
    const parts = new Intl.DateTimeFormat('en-US', { hour: '2-digit', hour12: false, timeZone: tz }).formatToParts(d);
    return Number(parts.find((x) => x.type === 'hour')?.value ?? 0) % 24;
  };

  const isToday = date.getTime() === today.getTime();
  const revenue = items.reduce((sum, b) => sum + (b.status === 'CANCELLED' || b.status === 'NO_SHOW' ? 0 : b.priceCents), 0);
  const currency = items[0]?.currency ?? 'USD';
  const sorted = [...items].sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));
  const nowTs = Date.now();
  const nextId = isToday ? (sorted.find((b) => new Date(b.endTime).getTime() > nowTs)?.id ?? null) : null;

  const periods: { label: string; list: Booking[] }[] = [
    { label: L('Buổi sáng', 'Morning'), list: [] },
    { label: L('Buổi chiều', 'Afternoon'), list: [] },
    { label: L('Buổi tối', 'Evening'), list: [] },
  ];
  for (const b of sorted) { const h = hourInTz(b.startTime); periods[h < 12 ? 0 : h < 17 ? 1 : 2].list.push(b); }

  return (
    <div>
      <style>{`.cal-day-card{transition:filter .12s ease, box-shadow .12s ease, transform .06s ease}.cal-day-card:hover{filter:brightness(1.15)}.cal-day-card:active{transform:scale(.99)}`}</style>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14, padding: '10px 14px', background: '#111827', border: '1px solid #1f2937', borderRadius: 10 }}>
        <span style={{ fontSize: 14 }}><strong style={{ fontSize: 18 }}>{items.length}</strong> <span style={{ color: '#94a3b8' }}>{t('cal.apptWord')}</span></span>
        <span style={{ color: '#334155' }}>|</span>
        <span style={{ fontSize: 14 }}><span style={{ color: '#94a3b8' }}>{t('cal.expected')}: </span><strong style={{ color: '#22c55e' }}>{formatPrice(revenue, currency)}</strong></span>
      </div>

      {items.length === 0 ? (
        <div style={{ ...ui.card, textAlign: 'center', color: '#64748b', padding: '44px 0', fontSize: 14 }}>{t('cal.noAppts')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {periods.map((pg, i) => pg.list.length === 0 ? null : (
            <div key={i}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.5, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>{pg.label} · {pg.list.length}</div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(258px, 1fr))', gap: 10 }}>
                {pg.list.map((b) => {
                  const m = statusBucket(b.status);
                  const dim = b.status === 'CANCELLED' || b.status === 'NO_SHOW';
                  const struck = b.status === 'CANCELLED';
                  const client = b.customer ? `${b.customer.firstName}${b.customer.lastName ? ' ' + b.customer.lastName : ''}` : '—';
                  const tech = b.assignedStaff ? b.assignedStaff.firstName : t('cal.unassigned');
                  const initial = b.assignedStaff ? b.assignedStaff.firstName.charAt(0).toUpperCase() : '?';
                  const aColor = b.assignedStaff ? avatarColor(b.assignedStaff.id) : '#475569';
                  const durMin = Math.max(0, Math.round((new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / 60000));
                  const isNext = b.id === nextId;
                  return (
                    <div key={b.id} onClick={() => onOpen(b)} className="cal-day-card"
                      style={{ background: dim ? '#161f30' : '#111a2c', border: `1px solid ${m.color}44`, borderLeft: `4px solid ${m.color}`, borderRadius: 10,
                        padding: '10px 12px', cursor: 'pointer', boxSizing: 'border-box', opacity: dim ? 0.72 : 1,
                        boxShadow: isNext ? `0 0 0 2px ${m.color}, 0 4px 16px ${m.color}44` : '0 1px 3px rgba(0,0,0,0.3)',
                        display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 13.5, fontWeight: 800, color: '#f1f5f9', whiteSpace: 'nowrap' }}>{fmtT(b.startTime)}</span>
                          <span style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>· {durMin}m</span>
                        </span>
                        <span style={{ flexShrink: 0, color: m.color, border: `1px solid ${m.color}`, borderRadius: 999, padding: '1px 8px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{t('cal.st' + m.key)}</span>
                      </div>
                      <div style={{ fontSize: 14.5, fontWeight: 700, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: struck ? 'line-through' : 'none' }}>{client}</div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontSize: 12.5, color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{b.service?.name ?? '—'}{b.partySize && b.partySize > 1 ? ` · ${b.partySize}` : ''}</span>
                        <OriginChip b={b} t={t} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 1 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <span style={{ width: 22, height: 22, borderRadius: '50%', background: aColor, color: '#fff', fontSize: 11, fontWeight: 700, display: 'grid', placeItems: 'center', flexShrink: 0 }}>{initial}</span>
                          <span style={{ fontSize: 12, color: '#cbd5e1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tech}</span>
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 800, color: '#22c55e', flexShrink: 0 }}>{formatPrice(b.priceCents, b.currency)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <p style={{ color: '#64748b', fontSize: 12, marginTop: 12 }}>{t('cal.dayHint')}</p>
    </div>
  );
}

function segBtn(active: boolean): React.CSSProperties {
  return { border: 'none', cursor: 'pointer', padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, background: active ? '#6366f1' : 'transparent', color: active ? '#fff' : '#94a3b8' };
}

function BookingDetail({ booking: b, tz, onClose, onAction }: {
  booking: Booking; tz?: string; onClose: () => void; onAction: (id: string, path: string) => void;
}) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const locale = 'en-US'; // dates always render US month/day/year
  const start = new Date(b.startTime);
  const end = new Date(b.endTime);
  const duration = Math.round((end.getTime() - start.getTime()) / 60000);
  const fullName = b.customer ? `${b.customer.firstName} ${b.customer.lastName ?? ''}`.trim() : '—';
  const tech = b.assignedStaff ? `${b.assignedStaff.firstName} ${b.assignedStaff.lastName ?? ''}`.trim() : t('cal.unassigned');
  const canArrive = ['PENDING', 'ASSIGNED', 'ACCEPTED', 'CONFIRMED'].includes(b.status);
  const active = canArrive || b.status === 'ARRIVED';
  const paidCents = (b.payments ?? []).filter((p) => p.status === 'PAID').reduce((s, p) => s + p.amountCents, 0);
  const posUrl = `/salon/pos?appointmentId=${b.id}&serviceId=${b.service?.id ?? ''}&staffId=${b.assignedStaff?.id ?? ''}&customerId=${b.customer?.id ?? ''}&customer=${encodeURIComponent(fullName)}`;

  return (
    <>
      {/* backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 40 }} />
      {/* right drawer */}
      <div style={{ position: 'fixed', top: 0, right: 0, height: '100vh', width: 380, maxWidth: '90vw', background: '#111827', borderLeft: '1px solid #1f2937', zIndex: 41, padding: 24, overflowY: 'auto', boxShadow: '-8px 0 30px rgba(0,0,0,0.4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>{t('cal.detailsTitle')}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{b.service?.name ?? t('cal.service')}</div>
          <div style={{ marginTop: 8 }}>
            <StatusBadge status={b.status} />
          </div>
        </div>

        <DetailRow label={t('cal.dDate')} value={start.toLocaleDateString(locale, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric', ...(tz ? { timeZone: tz } : {}) })} />
        <DetailRow label={t('cal.dTime')} value={`${fmtTime(start, tz)} – ${fmtTime(end, tz)}`} />
        <DetailRow label={t('cal.dDuration')} value={`${duration} ${t('cal.min')}`} />
        <DetailRow label={t('cal.dTechnician')} value={tech} />
        {(() => { const sm = sourceMeta(b.source); return sm ? <DetailRow label={t('cal.dSource')} value={`${sm.icon} ${t(sm.key)}`} /> : null; })()}
        {(() => { const dm = deviceMeta(b.device); return dm ? <DetailRow label={t('cal.dDevice')} value={`${dm.icon} ${t(dm.key)}`} /> : null; })()}
        <DetailRow label={t('cal.dPrice')} value={formatPrice(b.priceCents, b.currency)} />
        {b.partySize != null && b.partySize > 1 && <DetailRow label={t('cal.dParty')} value={String(b.partySize)} />}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', fontSize: 14 }}>
          <span style={{ color: '#94a3b8' }}>{t('cal.dPaid')}</span>
          <span style={{ textAlign: 'right', fontWeight: 600, color: paidCents > 0 ? '#22c55e' : '#f59e0b' }}>
            {paidCents > 0 ? `✓ ${formatPrice(paidCents, b.currency)}` : t('cal.unpaid')}
          </span>
        </div>
        {b.addons && b.addons.some((a) => a.kind === 'service') && (
          <DetailRow label={t('cal.dAlsoBooked')} value={b.addons.filter((a) => a.kind === 'service').map((a) => a.name).join(', ')} />
        )}
        {b.addons && b.addons.some((a) => a.kind !== 'service') && (
          <DetailRow label={t('cal.dAddons')} value={b.addons.filter((a) => a.kind !== 'service').map((a) => a.name).join(', ')} />
        )}

        <div style={{ borderTop: '1px solid #1f2937', margin: '16px 0 12px' }} />
        <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>{t('cal.customer')}</div>
        <DetailRow label={t('cal.dName')} value={fullName} />
        {b.customer?.phone && <DetailRow label={t('cal.dPhone')} value={b.customer.phone} />}
        {b.customer?.email && <DetailRow label={t('cal.dEmail')} value={b.customer.email} />}
        {b.notes && <DetailRow label={t('cal.dNote')} value={b.notes} />}

        {active && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 20 }}>
            <a href={posUrl} style={{ ...ui.primaryBtn, background: '#6366f1', width: '100%', padding: 12, textAlign: 'center', textDecoration: 'none', display: 'block', boxSizing: 'border-box' }}>{t('cal.checkout')}</a>
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', fontSize: 14 }}>
      <span style={{ color: '#94a3b8' }}>{label}</span>
      <span style={{ textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { lang } = useLang();
  const m = statusBucket(status);
  return <span style={{ color: m.color, border: `1px solid ${m.color}`, borderRadius: 999, padding: '3px 12px', fontSize: 12, fontWeight: 600 }}>{tr('cal.st' + m.key, lang)}</span>;
}

function fmtTime(d: Date, tz?: string) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
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

// Compact origin chip for calendar cards: channel icon (+ device icon) + short label.
function OriginChip({ b, t }: { b: Booking; t: (k: string) => string }) {
  const sm = sourceMeta(b.source);
  const dm = deviceMeta(b.device);
  if (!sm && !dm) return null;
  return (
    <span title={[sm ? t(sm.key) : '', dm ? t(dm.key) : ''].filter(Boolean).join(' · ')}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0, fontSize: 10, fontWeight: 700,
        color: '#93a4bd', background: '#1e293b', border: '1px solid #334155', borderRadius: 999, padding: '1px 7px', whiteSpace: 'nowrap' }}>
      {sm && <span>{sm.icon}</span>}
      {sm && <span>{t(sm.key)}</span>}
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
  padding: '6px 12px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontSize: 13, cursor: 'pointer',
};

const pickerBtn: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 8, border: '1px solid #4f46e5', background: '#1e293b', color: '#e2e8f0', fontSize: 13, fontWeight: 700, cursor: 'pointer', minWidth: 128, textAlign: 'center', whiteSpace: 'nowrap',
};

// Zero-size but still rendered, so the browser's native month/date picker
// (input.showPicker()) can anchor to it without showing a visible field.
const hiddenInput: React.CSSProperties = {
  width: 0, height: 0, opacity: 0, pointerEvents: 'none', border: 0, padding: 0, margin: 0, overflow: 'hidden', flex: '0 0 0px',
};
