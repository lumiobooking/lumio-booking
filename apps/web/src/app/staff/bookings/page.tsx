'use client';

// The technician's schedule.
//
// On a phone it is a WEEK, not a month: a strip of seven days she can hit
// with a thumb (each showing how many bookings it holds), and under it the
// chosen day as a list in time order. A month grid on a 390px screen is
// either unreadable or scrolls sideways — the old page did the latter.
// Anything waiting for her yes carries "Nhận / Không nhận" right on the
// row; tapping a booking opens it close up (call or text the client, or
// "Khách đã đến — bắt đầu làm").
//
// On a computer the month grid stays, as a tab beside the week.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { StaffShell } from '../../../components/StaffShell';
import { useAuth } from '../../../lib/auth';
import { apiFetch } from '../../../lib/api';
import { useLang } from '../../../lib/i18n';
import { useIsMobile } from '../../../lib/responsive';
import { useLiveRefresh } from '../../../lib/useLiveRefresh';
import { uiLocale, dayKeyInTz, fmtInTz } from '../../../lib/datetime';
import { IC, Icon, L, Pill, Toast, st, useToast } from '../../../components/staff/kit';
import { BookingSheet, StaffBooking, bookingName, bookingServices, bookingMinutes, bookingStatus } from '../../../components/staff/BookingSheet';

const DEAD = ['CANCELLED', 'NO_SHOW', 'REJECTED'];
const STATUS_COLORS: Record<string, string> = {
  ASSIGNED: '#f59e0b', ACCEPTED: '#6366f1', CONFIRMED: '#6366f1', ARRIVED: '#0ea5e9',
  COMPLETED: '#94a3b8', CANCELLED: '#94a3b8', NO_SHOW: '#ef4444', REJECTED: '#94a3b8',
};

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromKey = (k: string) => new Date(`${k}T00:00:00`);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));

export default function StaffBookingsPage() {
  const { lang } = useLang();
  const vi = lang === 'vi';
  return (
    <StaffShell title={L(vi, 'Lịch của tôi', 'My schedule')}>
      <Inner />
    </StaffShell>
  );
}

function Inner() {
  const { token } = useAuth();
  const router = useRouter();
  const { lang } = useLang();
  const vi = lang === 'vi';
  const isMobile = useIsMobile(720);
  const [bookings, setBookings] = useState<StaffBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const [picked, setPicked] = useState(() => fromKey(dayKeyInTz(new Date())));
  const [view, setView] = useState(() => new Date());
  const [autoPicked, setAutoPicked] = useState(false);
  const [open, setOpen] = useState<{ b: StaffBooking; reject: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast, show } = useToast();

  const load = useCallback(async () => {
    if (!token) return;
    try { setBookings(await apiFetch<StaffBooking[]>('/bookings/my', { token })); setError(null); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to load bookings'); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(load, 30000);

  const byDay = useMemo(() => {
    const m = new Map<string, StaffBooking[]>();
    for (const b of bookings) {
      const k = dayKeyInTz(b.startTime); // the SALON's day, not the phone's
      const list = m.get(k);
      if (list) list.push(b); else m.set(k, [b]);
    }
    for (const list of m.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    return m;
  }, [bookings]);

  // Landing on an empty today makes the page look broken: open the nearest
  // day that has work (today if it has any, else the next one coming).
  useEffect(() => {
    if (autoPicked || bookings.length === 0) return;
    const todayKey = dayKeyInTz(new Date());
    const days = [...byDay.keys()].sort();
    const target = (byDay.get(todayKey)?.length ? todayKey : undefined) ?? days.find((d) => d >= todayKey) ?? todayKey;
    const d = fromKey(target);
    setPicked(d); setView(new Date(d.getFullYear(), d.getMonth(), 1)); setAutoPicked(true);
  }, [bookings, byDay, autoPicked]);

  async function call(path: string, body?: Record<string, unknown>) {
    setBusy(true); setError(null);
    try { await apiFetch(path, { method: 'POST', token, body }); await load(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); return false; }
    finally { setBusy(false); }
  }
  const accept = async (b: StaffBooking) => {
    if (await call(`/bookings/${b.id}/accept`)) { setOpen(null); show(L(vi, `Đã nhận lịch · ${bookingName(b)}`, `Accepted · ${bookingName(b)}`)); }
  };
  const reject = async (b: StaffBooking, reason: string) => {
    if (await call(`/bookings/${b.id}/reject`, { reason })) { setOpen(null); show(L(vi, 'Đã báo quầy — lịch sẽ giao thợ khác', 'The desk will give it to someone else')); }
  };
  const start = async (b: StaffBooking) => {
    if (await call(`/my-chair/appointments/${b.id}/start`)) { setOpen(null); router.push('/staff/today'); }
  };

  const todayKey = dayKeyInTz(new Date());
  const pending = bookings.filter((b) => b.status === 'ASSIGNED' && new Date(b.startTime).getTime() > Date.now() - 3600_000);
  const week = Array.from({ length: 7 }, (_, i) => addDays(mondayOf(picked), i));
  const dayList = byDay.get(ymd(picked)) ?? [];
  const live = dayList.filter((b) => !DEAD.includes(b.status));
  const dowShort = vi ? ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const monthLabel = vi ? `Tháng ${picked.getMonth() + 1}, ${picked.getFullYear()}` : picked.toLocaleDateString(uiLocale(), { month: 'long', year: 'numeric' });
  const dayLabel = ymd(picked) === todayKey
    ? L(vi, 'Hôm nay', 'Today')
    : (() => { const t = picked.toLocaleDateString(vi ? 'vi-VN' : uiLocale(), { weekday: 'long', day: 'numeric', month: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); })();

  const tab = (key: 'week' | 'month', label: string) => (
    <button type="button" onClick={() => setMode(key)} aria-pressed={mode === key}
      style={{ height: 40, padding: '0 16px', borderRadius: 999, cursor: 'pointer', fontSize: 14, fontWeight: 700,
        border: mode === key ? '1px solid #4f46e5' : '1px solid var(--line-strong)',
        background: mode === key ? '#4f46e5' : 'transparent', color: mode === key ? '#fff' : 'var(--ccbd5e1)' }}>
      {label}
    </button>
  );

  return (
    <section style={{ width: '100%', maxWidth: 900 }}>
      {error && <div style={{ ...st.card, borderColor: 'var(--ink-bad)', color: 'var(--ink-bad)', fontSize: 14, padding: 12, marginBottom: 12 }}>{error}</div>}

      {!isMobile && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {tab('week', L(vi, 'Tuần', 'Week'))}
          {tab('month', L(vi, 'Tháng', 'Month'))}
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ ...st.card, background: 'var(--wash-amber)', borderColor: 'var(--ink-warn)', padding: '12px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, color: 'var(--ce2e8f0)', flex: 1 }}>
            {vi ? <><b>{pending.length}</b> lịch hẹn đang chờ bạn nhận.</> : <><b>{pending.length}</b> booking{pending.length === 1 ? '' : 's'} waiting for your OK.</>}
          </span>
          <button type="button" onClick={() => setOpen({ b: pending[0], reject: false })} style={{ ...st.primary, height: 44, fontSize: 14 }}>{L(vi, 'Xem', 'Review')}</button>
        </div>
      )}

      {(mode === 'week' || isMobile) && (
        <>
          {/* The week strip: seven thumb-sized days, with how busy each is. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <button type="button" aria-label={L(vi, 'Tuần trước', 'Previous week')} onClick={() => setPicked(addDays(picked, -7))} style={{ ...st.ghost, width: 44, padding: 0 }}><Icon d={IC.back} size={20} /></button>
            <span style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', textTransform: 'capitalize', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{monthLabel}</span>
            <button type="button" onClick={() => setPicked(fromKey(todayKey))} style={{ ...st.ghost, height: 44, fontSize: 14 }}>{L(vi, 'Hôm nay', 'Today')}</button>
            <button type="button" aria-label={L(vi, 'Tuần sau', 'Next week')} onClick={() => setPicked(addDays(picked, 7))} style={{ ...st.ghost, width: 44, padding: 0 }}><Icon d={IC.chevron} size={20} /></button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6, marginBottom: 16 }}>
            {week.map((d, i) => {
              const k = ymd(d);
              const n = (byDay.get(k) ?? []).filter((b) => !DEAD.includes(b.status)).length;
              const waiting = (byDay.get(k) ?? []).some((b) => b.status === 'ASSIGNED');
              const on = k === ymd(picked);
              const isToday = k === todayKey;
              const past = k < todayKey;
              return (
                <button key={k} type="button" onClick={() => setPicked(d)} aria-pressed={on}
                  aria-label={`${dowShort[i]} ${d.getDate()}, ${n} ${L(vi, 'lịch hẹn', 'bookings')}`}
                  style={{ height: 68, borderRadius: 14, cursor: 'pointer', padding: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, position: 'relative',
                    border: `1.5px solid ${on ? '#4f46e5' : isToday ? '#6366f1' : 'var(--line)'}`,
                    background: on ? '#4f46e5' : 'var(--c111827)', color: on ? '#fff' : past ? 'var(--c94a3b8)' : 'var(--ce2e8f0)' }}>
                  <span style={{ fontSize: 11, fontWeight: 600 }}>{dowShort[i]}</span>
                  <span style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.1 }}>{d.getDate()}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: on ? '#e0e7ff' : n ? 'var(--ink-link)' : 'var(--c64748b)' }}>{n ? n : '–'}</span>
                  {waiting && <span style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 999, background: '#f59e0b' }} />}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{dayLabel}</span>
            <span style={{ fontSize: 13, color: 'var(--c94a3b8)' }}>{live.length} {L(vi, 'lịch', live.length === 1 ? 'booking' : 'bookings')}</span>
          </div>

          {loading ? <p style={{ color: 'var(--c94a3b8)' }}>{L(vi, 'Đang tải…', 'Loading…')}</p> : dayList.length === 0 ? (
            <div style={{ ...st.card, textAlign: 'center', color: 'var(--c94a3b8)', fontSize: 14, padding: '24px 16px' }}>
              {L(vi, 'Ngày này bạn chưa có lịch hẹn.', 'Nothing booked for you on this day.')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {dayList.map((b) => (
                <AgendaRow key={b.id} b={b} vi={vi} busy={busy}
                  onOpen={() => setOpen({ b, reject: false })} onAccept={() => accept(b)} onReject={() => setOpen({ b, reject: true })} />
              ))}
            </div>
          )}
        </>
      )}

      {mode === 'month' && !isMobile && (
        <MonthGrid vi={vi} view={view} setView={setView} picked={picked} setPicked={(d) => { setPicked(d); setMode('week'); }} byDay={byDay} todayKey={todayKey} />
      )}

      <BookingSheet booking={open?.b ?? null} startReject={open?.reject ?? false} vi={vi}
        onClose={() => setOpen(null)} onAccept={accept} onReject={reject} onStart={start} />
      {toast && <Toast text={toast.text} action={toast.action} onAction={toast.onAction} />}
    </section>
  );
}

function AgendaRow({ b, vi, busy, onOpen, onAccept, onReject }: {
  b: StaffBooking; vi: boolean; busy: boolean; onOpen: () => void; onAccept: () => void; onReject: () => void;
}) {
  const s = bookingStatus(b.status, vi);
  const dead = DEAD.includes(b.status) || b.status === 'COMPLETED';
  const mins = bookingMinutes(b);
  return (
    <div style={{ display: 'flex', gap: 12, opacity: dead ? 0.6 : 1 }}>
      <div style={{ width: 54, flexShrink: 0, paddingTop: 14, textAlign: 'right' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{fmtInTz(b.startTime, { hour: 'numeric', minute: '2-digit' })}</div>
        {mins > 0 && <div style={{ fontSize: 11, color: 'var(--c94a3b8)', marginTop: 2 }}>{mins} {L(vi, 'phút', 'min')}</div>}
      </div>
      <div style={{ ...st.card, flex: 1, minWidth: 0, padding: 0, overflow: 'hidden', borderColor: b.status === 'ASSIGNED' ? 'var(--ink-warn)' : 'var(--line)' }}>
        <button type="button" onClick={onOpen}
          style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '12px 14px', cursor: 'pointer', color: 'var(--ce2e8f0)', minHeight: 48 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16, fontWeight: 700, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: b.status === 'CANCELLED' ? 'line-through' : 'none' }}>{bookingName(b)}</span>
            <Pill text={s.text} tone={s.tone} />
          </div>
          <div style={{ fontSize: 14, color: 'var(--ccbd5e1)', marginTop: 3 }}>{bookingServices(b)}</div>
          {b.notes && <div style={{ fontSize: 13, color: 'var(--c94a3b8)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.notes}</div>}
        </button>
        {b.status === 'ASSIGNED' && (
          <div style={{ display: 'flex', gap: 8, padding: '0 12px 12px' }}>
            <button type="button" disabled={busy} onClick={onReject} style={{ ...st.ghost, flex: '1 1 0', height: 46, fontSize: 14, padding: '0 8px' }}>{L(vi, 'Không nhận', 'Decline')}</button>
            <button type="button" disabled={busy} onClick={onAccept} style={{ ...st.primary, flex: '1.3 1 0', height: 46, fontSize: 15 }}>{L(vi, 'Nhận', 'Accept')}</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The month at a glance — for a computer screen, where it fits. */
function MonthGrid({ vi, view, setView, picked, setPicked, byDay, todayKey }: {
  vi: boolean; view: Date; setView: (d: Date) => void; picked: Date; setPicked: (d: Date) => void;
  byDay: Map<string, StaffBooking[]>; todayKey: string;
}) {
  const y = view.getFullYear(), mo = view.getMonth();
  const offset = (new Date(y, mo, 1).getDay() + 6) % 7;
  const days = new Date(y, mo + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(y, mo, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const dayNames = vi ? ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const name = (b: StaffBooking) => bookingName(b);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button type="button" onClick={() => setView(new Date(y, mo - 1, 1))} style={{ ...st.ghost, width: 44, padding: 0 }} aria-label="Previous month"><Icon d={IC.back} size={20} /></button>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 16, fontWeight: 700, color: 'var(--ce2e8f0)', textTransform: 'capitalize' }}>
          {view.toLocaleDateString(vi ? 'vi-VN' : uiLocale(), { month: 'long', year: 'numeric' })}
        </div>
        <button type="button" onClick={() => setView(new Date(y, mo + 1, 1))} style={{ ...st.ghost, width: 44, padding: 0 }} aria-label="Next month"><Icon d={IC.chevron} size={20} /></button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 1, background: 'var(--c243044)', border: '1px solid var(--c243044)', borderRadius: 12, overflow: 'hidden' }}>
        {dayNames.map((d) => (
          <div key={d} style={{ background: 'var(--c1e293b)', textAlign: 'center', padding: '9px 0', fontSize: 11.5, fontWeight: 600, color: 'var(--c94a3b8)', textTransform: 'uppercase' }}>{d}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} style={{ background: 'var(--c0b1322)', minHeight: 110 }} />;
          const list = byDay.get(ymd(d)) ?? [];
          const isToday = ymd(d) === todayKey;
          const on = ymd(d) === ymd(picked);
          return (
            <button key={i} type="button" onClick={() => setPicked(d)}
              style={{ background: isToday ? 'var(--c151f38)' : 'var(--c0f172a)', minHeight: 110, minWidth: 0, overflow: 'hidden', padding: 7, cursor: 'pointer', border: 'none', textAlign: 'left', display: 'block',
                boxShadow: on ? 'inset 0 0 0 2px #6366f1' : isToday ? 'inset 0 0 0 1.5px #4f46e5' : undefined }}>
              <div style={{ fontSize: 12.5, fontWeight: isToday ? 800 : 600, color: 'var(--ccbd5e1)', marginBottom: 5 }}>{d.getDate()}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {list.slice(0, 4).map((b) => {
                  const colour = STATUS_COLORS[b.status] ?? '#94a3b8';
                  return (
                    <div key={b.id} style={{ display: 'flex', gap: 5, fontSize: 11, padding: '3px 6px', borderRadius: 5, background: 'var(--c1e293b)', opacity: DEAD.includes(b.status) ? 0.55 : 1, overflow: 'hidden' }}>
                      <span style={{ width: 6, height: 6, borderRadius: 999, background: colour, marginTop: 4, flexShrink: 0 }} />
                      <span style={{ fontWeight: 700, whiteSpace: 'nowrap', color: 'var(--ce2e8f0)' }}>{fmtInTz(b.startTime, { hour: 'numeric', minute: '2-digit' })}</span>
                      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ccbd5e1)' }}>{name(b)}</span>
                    </div>
                  );
                })}
                {list.length > 4 && <div style={{ fontSize: 10.5, color: 'var(--ink-link)', fontWeight: 600 }}>+{list.length - 4}</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
