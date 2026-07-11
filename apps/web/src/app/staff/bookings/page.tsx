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

  return (
    <section style={{ maxWidth: 640 }}>
      {error && <div style={ui.banner}>{error}</div>}

      {/* Anything waiting on the tech's answer is surfaced before the calendar. */}
      {pending > 0 && (
        <div style={{ ...ui.card, marginBottom: 12, borderColor: '#3b82f6', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>🔔</span>
          <span style={{ color: '#e2e8f0', fontSize: 14 }}>
            {vi ? <><b>{pending}</b> lịch hẹn đang chờ bạn nhận.</> : <><b>{pending}</b> booking{pending === 1 ? '' : 's'} waiting for you to accept.</>}
          </span>
        </div>
      )}

      {/* Month header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button onClick={() => shift(-1)} style={navBtn} aria-label="Previous month">‹</button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: 700, color: '#e2e8f0', textTransform: 'capitalize' }}>{monthName}</div>
        <button onClick={() => shift(1)} style={navBtn} aria-label="Next month">›</button>
        <button onClick={jumpToday} style={{ ...navBtn, width: 'auto', padding: '0 12px', fontSize: 13, fontWeight: 700 }}>
          {vi ? 'Hôm nay' : 'Today'}
        </button>
      </div>

      {/* Month grid */}
      <div style={{ ...ui.card, padding: 10, marginBottom: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
          {dayNames.map((d) => (
            <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#64748b', padding: '2px 0' }}>{d}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {cells.map((d, i) => {
            if (!d) return <div key={i} />;
            const list = byDay.get(ymd(d)) ?? [];
            const live = list.filter((b) => !DEAD.includes(b.status));
            const isToday = sameDay(d, today);
            const on = sameDay(d, picked);
            const needsMe = live.some((b) => b.status === 'ASSIGNED');
            return (
              <button key={i} onClick={() => setPicked(d)}
                style={{
                  height: 52, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                  borderRadius: 10, cursor: 'pointer', padding: 2,
                  border: on ? '2px solid #6366f1' : isToday ? '1px solid #475569' : '1px solid transparent',
                  background: on ? 'rgba(99,102,241,0.16)' : live.length ? '#0f172a' : 'transparent',
                  color: on ? '#e2e8f0' : '#cbd5e1',
                }}>
                <span style={{ fontSize: 13, fontWeight: isToday || on ? 800 : 500 }}>{d.getDate()}</span>
                {live.length > 0 && (
                  <span style={{
                    minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999, fontSize: 10, fontWeight: 800,
                    display: 'grid', placeItems: 'center',
                    background: needsMe ? '#3b82f6' : '#334155', color: '#fff',
                  }}>{live.length}</span>
                )}
              </button>
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
        <div style={{ ...ui.card, color: '#94a3b8', textAlign: 'center', padding: '28px 16px' }}>
          {vi ? 'Ngày này bạn không có lịch hẹn nào.' : 'Nothing booked for you on this day.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {dayList.map((b) => {
            const colour = STATUS_COLORS[b.status] ?? '#94a3b8';
            const dead = DEAD.includes(b.status);
            return (
              <div key={b.id} style={{ ...ui.card, display: 'flex', gap: 12, alignItems: 'stretch', padding: 0, overflow: 'hidden', opacity: dead ? 0.55 : 1 }}>
                <div style={{ width: 4, background: colour, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0, padding: '12px 14px 12px 2px' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0' }}>{hhmm(b.startTime)}</span>
                    <span style={{ fontSize: 15, fontWeight: 600, color: '#cbd5e1', minWidth: 0 }}>{b.service?.name ?? 'Service'}</span>
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 3 }}>{name(b.customer)}</div>
                  {b.notes && <div style={{ color: '#64748b', fontSize: 12, marginTop: 4, fontStyle: 'italic' }}>“{b.notes}”</div>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <span style={{ color: colour, border: `1px solid ${colour}`, borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 700 }}>
                      {b.status}
                    </span>
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
          })}
        </div>
      )}
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
