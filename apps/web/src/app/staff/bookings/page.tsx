'use client';

// The technician's own schedule — as a CALENDAR, not a list. A tech thinks in
// days ("what have I got tomorrow?"), so they get a month grid they can scan at a
// glance, and the day they tap opens underneath as a timeline.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { StaffShell } from '../../../components/StaffShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { ui } from '../../../lib/ui';
import { useLang } from '../../../lib/i18n';

interface NamedRef { firstName?: string; lastName?: string | null }
interface Booking {
  id: string;
  status: string;
  startTime: string;
  endTime?: string | null;
  notes: string | null;
  customer: NamedRef | null;
  service: { name: string } | null;
}

const STATUS_COLORS: Record<string, string> = {
  ASSIGNED: '#3b82f6',
  ACCEPTED: '#22c55e',
  CONFIRMED: '#22c55e',
  ARRIVED: '#0ea5e9',
  COMPLETED: '#a855f7',
  CANCELLED: '#94a3b8',
  NO_SHOW: '#ef4444',
};
// A cancelled / no-show booking still shows, but never counts as work to do.
const DEAD = ['CANCELLED', 'NO_SHOW'];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sameDay = (a: Date, b: Date) => ymd(a) === ymd(b);

export default function StaffBookingsPage() {
  return (
    <StaffShell>
      <Inner />
    </StaffShell>
  );
}

function Inner() {
  const { token } = useAuth();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState(() => new Date());        // which month is on screen
  const [picked, setPicked] = useState(() => new Date());    // which day is open
  const [mode, setMode] = useState<'cal' | 'list'>('cal');
  const [autoPicked, setAutoPicked] = useState(false);

  // A month grid full of chips needs room. On a phone the tech starts on the list
  // (the grid is still one tap away, and scrolls sideways).
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 720) setMode('list');
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null);
    try { setBookings(await apiFetch<Booking[]>('/bookings/my', { token })); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load bookings'); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function respond(id: string, action: 'accept' | 'reject') {
    try {
      const body = action === 'reject' ? { reason: 'Not available' } : undefined;
      await apiFetch(`/bookings/${id}/${action}`, { method: 'POST', token, body });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Action failed'); }
  }

  // Bookings bucketed by day, so the grid can render counts without re-scanning.
  const byDay = useMemo(() => {
    const m = new Map<string, Booking[]>();
    for (const b of bookings) {
      const k = ymd(new Date(b.startTime));
      const list = m.get(k);
      if (list) list.push(b); else m.set(k, [b]);
    }
    for (const list of m.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return m;
  }, [bookings]);

  // Landing on "today" when today is empty makes the page look broken. Open the
  // nearest day that actually has work on it (today if it has any, else the next
  // upcoming day, else the most recent past one).
  useEffect(() => {
    if (autoPicked || bookings.length === 0) return;
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const days = [...new Set(bookings.map((b) => ymd(new Date(b.startTime))))].sort();
    const upcoming = days.find((d) => new Date(d + 'T00:00:00').getTime() >= t0.getTime());
    const target = upcoming ?? days[days.length - 1];
    if (!target) return;
    const d = new Date(target + 'T00:00:00');
    setPicked(d);
    setView(new Date(d.getFullYear(), d.getMonth(), 1));
    setAutoPicked(true);
  }, [bookings, autoPicked]);

  const cells = useMemo(() => {
    const y = view.getFullYear(), mo = view.getMonth();
    const offset = (new Date(y, mo, 1).getDay() + 6) % 7; // grid starts Monday
    const days = new Date(y, mo + 1, 0).getDate();
    const out: (Date | null)[] = [];
    for (let i = 0; i < offset; i++) out.push(null);
    for (let d = 1; d <= days; d++) out.push(new Date(y, mo, d));
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [view]);

  const today = new Date();
  const dayList = byDay.get(ymd(picked)) ?? [];
  const pending = bookings.filter((b) => b.status === 'ASSIGNED').length;

  const monthName = view.toLocaleDateString(vi ? 'vi-VN' : 'en-US', { month: 'long', year: 'numeric' });
  const dayNames = vi ? ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const shift = (n: number) => setView(new Date(view.getFullYear(), view.getMonth() + n, 1));
  const jumpToday = () => { setView(new Date()); setPicked(new Date()); };

  const name = (c: NamedRef | null) => (c ? `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() : '—');
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString(vi ? 'vi-VN' : 'en-US', { hour: 'numeric', minute: '2-digit' });

  const row = (b: Booking, withDate = false) => {
    const colour = STATUS_COLORS[b.status] ?? '#94a3b8';
    const dead = DEAD.includes(b.status);
    const d = new Date(b.startTime);
    return (
      <div key={b.id} style={{ ...ui.card, display: 'flex', gap: 12, alignItems: 'stretch', padding: 0, overflow: 'hidden', opacity: dead ? 0.55 : 1 }}>
        <div style={{ width: 4, background: colour, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0, padding: '12px 14px 12px 2px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0' }}>{hhmm(b.startTime)}</span>
            {withDate && (
              <span style={{ fontSize: 12, fontWeight: 700, color: '#a5b4fc', background: 'rgba(99,102,241,0.15)', borderRadius: 6, padding: '2px 8px' }}>
                {d.toLocaleDateString(vi ? 'vi-VN' : 'en-US', { day: 'numeric', month: 'short' })}
              </span>
            )}
            <span style={{ fontSize: 15, fontWeight: 600, color: '#cbd5e1', minWidth: 0 }}>{b.service?.name ?? 'Service'}</span>
          </div>
          <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 3 }}>{name(b.customer)}</div>
          {b.notes && <div style={{ color: '#64748b', fontSize: 12, marginTop: 4, fontStyle: 'italic' }}>“{b.notes}”</div>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <span style={{ color: colour, border: `1px solid ${colour}`, borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>{b.status}</span>
            {b.status === 'ASSIGNED' && (
              <>
                <button onClick={() => respond(b.id, 'accept')} style={acceptBtn}>{vi ? 'Nhận' : 'Accept'}</button>
                <button onClick={() => respond(b.id, 'reject')} style={{ ...ui.dangerBtn, padding: '6px 14px', fontSize: 13, whiteSpace: 'nowrap' }}>
                  {vi ? 'Từ chối' : 'Reject'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Everything from today on, soonest first — used by the List tab and by the
  // "nothing on this day" fallback, so the tech is never staring at an empty screen.
  const upcoming = useMemo(() => {
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    return bookings
      .filter((b) => new Date(b.startTime).getTime() >= t0.getTime())
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [bookings]);
  const past = useMemo(() => {
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    return bookings
      .filter((b) => new Date(b.startTime).getTime() < t0.getTime())
      .sort((a, b) => b.startTime.localeCompare(a.startTime));
  }, [bookings]);

  const tab = (key: 'cal' | 'list', label: string) => (
    <button onClick={() => setMode(key)}
      style={{ padding: '7px 16px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 700,
        border: mode === key ? '1px solid #6366f1' : '1px solid #334155',
        background: mode === key ? '#6366f1' : 'transparent', color: mode === key ? '#fff' : '#cbd5e1' }}>
      {label}
    </button>
  );

  return (
    <section style={{ width: '100%', maxWidth: 900 }}>
      {error && <div style={ui.banner}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {tab('cal', vi ? '📅 Lịch' : '📅 Calendar')}
        {tab('list', vi ? '📋 Danh sách' : '📋 List')}
      </div>

      {/* Anything waiting on the tech's answer is surfaced before the calendar. */}
      {pending > 0 && (
        <div style={{ ...ui.card, marginBottom: 12, borderColor: '#3b82f6', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>🔔</span>
          <span style={{ color: '#e2e8f0', fontSize: 14 }}>
            {vi ? <><b>{pending}</b> lịch hẹn đang chờ bạn nhận.</> : <><b>{pending}</b> booking{pending === 1 ? '' : 's'} waiting for you to accept.</>}
          </span>
        </div>
      )}

      {mode === 'list' && (
        <div style={{ display: 'grid', gap: 10 }}>
          {loading ? <p style={{ color: '#94a3b8' }}>Loading…</p> : bookings.length === 0 ? (
            <div style={{ ...ui.card, color: '#94a3b8', textAlign: 'center', padding: '28px 16px' }}>
              {vi ? 'Bạn chưa có lịch hẹn nào.' : 'You have no bookings yet.'}
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1' }}>{vi ? 'Sắp tới' : 'Upcoming'} ({upcoming.length})</div>
              {upcoming.length === 0
                ? <div style={{ ...ui.card, color: '#64748b', fontSize: 13 }}>{vi ? 'Không có lịch hẹn sắp tới.' : 'Nothing coming up.'}</div>
                : upcoming.map((b) => row(b, true))}
              {past.length > 0 && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#cbd5e1', marginTop: 8 }}>{vi ? 'Đã qua' : 'Past'} ({past.length})</div>
                  {past.slice(0, 20).map((b) => row(b, true))}
                </>
              )}
            </>
          )}
        </div>
      )}

      {mode === 'cal' && (<>
      {/* Month header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button onClick={() => shift(-1)} style={navBtn} aria-label="Previous month">‹</button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: 700, color: '#e2e8f0', textTransform: 'capitalize' }}>{monthName}</div>
        <button onClick={() => shift(1)} style={navBtn} aria-label="Next month">›</button>
        <button onClick={jumpToday} style={{ ...navBtn, width: 'auto', padding: '0 12px', fontSize: 13, fontWeight: 700 }}>
          {vi ? 'Hôm nay' : 'Today'}
        </button>
      </div>

      {/* Month grid — same visual language as the salon's admin calendar: every
          booking is a chip inside the day, colour-coded by status, so the tech can
          read the month at a glance instead of decoding a number badge. */}
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', borderRadius: 12, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 1, minWidth: 680,
          background: '#243044', border: '1px solid #243044', borderRadius: 12, overflow: 'hidden' }}>
          {dayNames.map((d, i) => {
            const weekend = i >= 5;
            return (
              <div key={d} style={{ background: '#1e293b', textAlign: 'center', padding: '9px 0', fontSize: 11.5,
                letterSpacing: 0.6, textTransform: 'uppercase', fontWeight: 700, color: weekend ? '#8ea2c4' : '#94a3b8' }}>{d}</div>
            );
          })}
          {cells.map((d, i) => {
            if (!d) return <div key={i} style={{ background: '#0b1322', minHeight: 116, opacity: 0.5 }} />;
            const list = byDay.get(ymd(d)) ?? [];
            const isToday = sameDay(d, today);
            const on = sameDay(d, picked);
            const dow = d.getDay();
            const weekend = dow === 0 || dow === 6;
            const bg = isToday ? '#151f38' : weekend ? '#0d1526' : '#0f172a';
            return (
              <div key={i} onClick={() => setPicked(d)}
                style={{ background: bg, minHeight: 116, minWidth: 0, overflow: 'hidden', padding: 7, cursor: 'pointer',
                  boxShadow: on ? 'inset 0 0 0 2px #6366f1' : isToday ? 'inset 0 0 0 1.5px #4f46e5' : undefined }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <span style={{ display: 'inline-grid', placeItems: 'center', minWidth: 22, height: 22, padding: '0 6px', borderRadius: 999,
                    fontSize: 12.5, fontWeight: isToday ? 800 : 600, color: isToday ? '#fff' : '#cbd5e1',
                    background: isToday ? '#6366f1' : 'transparent' }}>{d.getDate()}</span>
                  {list.length > 0 && <span style={{ fontSize: 10.5, color: '#64748b', fontWeight: 700 }}>{list.length}</span>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {list.slice(0, 4).map((b) => {
                    const colour = STATUS_COLORS[b.status] ?? '#94a3b8';
                    const dead = DEAD.includes(b.status);
                    return (
                      <div key={b.id} title={`${b.status} · ${b.service?.name ?? ''} · ${name(b.customer)}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, fontSize: 11, padding: '3px 7px', borderRadius: 5,
                          background: `${colour}1f`, borderLeft: `3px solid ${colour}`, opacity: dead ? 0.55 : 1, overflow: 'hidden',
                          textDecoration: b.status === 'CANCELLED' ? 'line-through' : 'none' }}>
                        <span style={{ fontWeight: 700, whiteSpace: 'nowrap', color: colour, flexShrink: 0 }}>{hhmm(b.startTime)}</span>
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#dbe2ea' }}>
                          {name(b.customer)}{b.service?.name ? ` · ${b.service.name}` : ''}
                        </span>
                      </div>
                    );
                  })}
                  {list.length > 4 && (
                    <div style={{ fontSize: 10.5, color: '#818cf8', fontWeight: 600, padding: '2px 4px 0' }}>
                      +{list.length - 4} {vi ? 'nữa' : 'more'}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* The day the tech tapped */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', textTransform: 'capitalize' }}>
          {picked.toLocaleDateString(vi ? 'vi-VN' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {dayList.length} {vi ? 'lịch hẹn' : dayList.length === 1 ? 'booking' : 'bookings'}
        </span>
      </div>

      {loading ? (
        <p style={{ color: '#94a3b8' }}>Loading…</p>
      ) : dayList.length === 0 ? (
        <div style={{ ...ui.card, padding: 16 }}>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: 14 }}>
            {vi ? 'Ngày này bạn không có lịch hẹn nào.' : 'Nothing booked for you on this day.'}
          </p>
          {upcoming.length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1', margin: '14px 0 8px' }}>
                {vi ? 'Lịch hẹn sắp tới của bạn' : 'Your next bookings'}
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {upcoming.slice(0, 3).map((b) => {
                  const d = new Date(b.startTime);
                  return (
                    <button key={b.id} onClick={() => { setPicked(d); setView(new Date(d.getFullYear(), d.getMonth(), 1)); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                        border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0', textAlign: 'left' }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: '#a5b4fc', flexShrink: 0 }}>
                        {d.toLocaleDateString(vi ? 'vi-VN' : 'en-US', { day: 'numeric', month: 'short' })} · {hhmm(b.startTime)}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {b.service?.name ?? 'Service'} · {name(b.customer)}
                      </span>
                      <span style={{ color: '#64748b', flexShrink: 0 }}>›</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {dayList.map((b) => row(b))}
        </div>
      )}
      </>)}
    </section>
  );
}

const navBtn: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 8, border: '1px solid #334155',
  background: '#0f172a', color: '#e2e8f0', fontSize: 18, cursor: 'pointer', lineHeight: 1,
};
const acceptBtn: React.CSSProperties = {
  padding: '6px 16px', borderRadius: 8, border: 'none', background: '#22c55e',
  color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
};
