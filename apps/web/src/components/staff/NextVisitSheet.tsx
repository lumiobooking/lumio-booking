'use client';

// "HẸN LẦN SAU" from the chair.
//
// The client is still sitting with her — "same again in two weeks?" — so the
// sheet asks only two things: which day (chips: 1–4 weeks, or a date) and
// which of HER open times. The services are the ones she just did, already
// ticked. One tap books it on her, confirmed; the client gets the usual
// confirmation text. GET /bookings/my-open-times and POST /bookings/my-rebook
// only ever work on her own slots and her own client.

import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { dayKeyInTz, fmtInTz } from '../../lib/datetime';
import { L, Sheet, st } from './kit';

export interface NextVisitClient {
  /** Her walk-in ticket (the usual case) or her booking. */
  walkInId?: string; appointmentId?: string;
  name: string;
  /** What she just did — preselected. */
  serviceIds: string[];
}
export interface NextVisitService { id: string; name: string; durationMinutes?: number }

const DAY_MS = 86_400_000;

/** The chips' day keys, from today in the salon's calendar. */
export function quickDays(now: number, dayKey: (ms: number) => string): { days: number; key: string }[] {
  return [7, 14, 21, 28].map((days) => ({ days, key: dayKey(now + days * DAY_MS) }));
}

export function NextVisitSheet({ client, services, token, vi, onClose, onBooked }: {
  client: NextVisitClient | null; services: NextVisitService[]; token: string | null; vi: boolean;
  onClose: () => void; onBooked: (text: string) => void;
}) {
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [date, setDate] = useState<string>('');
  const [times, setTimes] = useState<string[] | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // A fresh sheet per client: her services ticked, two weeks out.
  useEffect(() => {
    if (!client) return;
    const known = client.serviceIds.filter((id) => services.some((s) => s.id === id));
    setServiceIds(known.length ? known : services.slice(0, 1).map((s) => s.id));
    setDate(dayKeyInTz(Date.now() + 14 * DAY_MS));
    setAt(null); setErr(null);
  }, [client, services]);

  const minutes = useMemo(() => Math.max(15, serviceIds.reduce((n, id) => n + (services.find((s) => s.id === id)?.durationMinutes ?? 30), 0)), [serviceIds, services]);

  useEffect(() => {
    if (!client || !token || !date) return;
    let alive = true;
    setTimes(null); setAt(null);
    apiFetch<{ times: string[] }>(`/bookings/my-open-times?date=${date}&minutes=${minutes}`, { token })
      .then((r) => { if (alive) setTimes(r.times); })
      .catch((e) => { if (alive) { setTimes([]); setErr(e instanceof Error ? e.message : 'error'); } });
    return () => { alive = false; };
  }, [client, token, date, minutes]);

  const chips = quickDays(Date.now(), (ms) => dayKeyInTz(ms));
  const today = dayKeyInTz(Date.now());

  async function book() {
    if (!client || !at || !serviceIds.length) return;
    setBusy(true); setErr(null);
    try {
      await apiFetch('/bookings/my-rebook', { method: 'POST', token, body: {
        walkInId: client.walkInId, appointmentId: client.appointmentId,
        serviceId: serviceIds[0], serviceIds, startTime: at,
        notes: L(vi, 'Hẹn lần sau — thợ đặt tại ghế', 'Next visit — booked at the chair'),
      } });
      onBooked(L(vi, `Đã hẹn ${client.name} · ${fmtInTz(at, { weekday: 'short', day: 'numeric', month: 'numeric' })} ${fmtInTz(at, { hour: 'numeric', minute: '2-digit' })}`, `Booked ${client.name} · ${fmtInTz(at, { weekday: 'short', day: 'numeric', month: 'numeric' })} ${fmtInTz(at, { hour: 'numeric', minute: '2-digit' })}`));
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  const chip = (on: boolean) => ({
    minHeight: 44, padding: '8px 12px', borderRadius: 12, cursor: 'pointer', fontSize: 14, fontWeight: 600,
    border: `1.5px solid ${on ? '#6366f1' : 'var(--line-strong)'}`, background: on ? 'var(--c1e1b4b)' : 'var(--c0f172a)', color: on ? 'var(--cc7d2fe)' : 'var(--ce2e8f0)',
  });

  return (
    <Sheet open={!!client} onClose={onClose} label={L(vi, 'Hẹn lần sau', 'Next visit')}>
      {client && (
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{L(vi, `Hẹn lần sau cho ${client.name}`, `Next visit for ${client.name}`)}</div>
          <div style={{ fontSize: 14, color: 'var(--c94a3b8)', marginTop: 4 }}>{L(vi, 'Đặt với bạn, xác nhận ngay. Khách nhận tin nhắn xác nhận như thường.', 'With you, confirmed at once. The client gets the usual confirmation.')}</div>

          <div style={{ ...st.label, marginTop: 14 }}>{L(vi, 'Dịch vụ', 'Services')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            {services.slice(0, 24).map((s) => {
              const on = serviceIds.includes(s.id);
              return <button key={s.id} type="button" aria-pressed={on} onClick={() => setServiceIds((x) => (on ? x.filter((y) => y !== s.id) : [...x, s.id]))} style={chip(on)}>{s.name}</button>;
            })}
          </div>

          <div style={{ ...st.label, marginTop: 14 }}>{L(vi, 'Ngày', 'Day')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
            {chips.map((c) => <button key={c.days} type="button" aria-pressed={date === c.key} onClick={() => setDate(c.key)} style={chip(date === c.key)}>{L(vi, `${c.days / 7} tuần`, `${c.days / 7} wk`)}</button>)}
            <input type="date" lang="en-US" min={today} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label={L(vi, 'Chọn ngày', 'Pick a date')}
              style={{ ...chip(!chips.some((c) => c.key === date)), padding: '0 10px', minWidth: 140 }} />
          </div>

          <div style={{ ...st.label, marginTop: 14 }}>{L(vi, `Giờ trống của bạn · ${fmtInTz(`${date}T12:00:00`, { weekday: 'long', day: 'numeric', month: 'numeric' })}`, `Your open times · ${fmtInTz(`${date}T12:00:00`, { weekday: 'long', day: 'numeric', month: 'numeric' })}`)}</div>
          {times === null ? <div style={{ fontSize: 14, color: 'var(--c94a3b8)', marginTop: 8 }}>…</div> : times.length === 0 ? (
            <div style={{ fontSize: 14, color: 'var(--ink-warn)', marginTop: 8 }}>{L(vi, 'Bạn không còn giờ trống ngày này — chọn ngày khác.', 'No open times for you that day — pick another.')}</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginTop: 8, maxHeight: 200, overflowY: 'auto' }}>
              {times.map((t) => <button key={t} type="button" aria-pressed={at === t} onClick={() => setAt(t)} style={{ ...chip(at === t), padding: '8px 4px' }}>{fmtInTz(t, { hour: 'numeric', minute: '2-digit' })}</button>)}
            </div>
          )}

          {err && <div style={{ color: 'var(--ink-bad)', fontSize: 14, marginTop: 10 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button type="button" onClick={onClose} style={{ ...st.ghost, flex: 1, height: 56 }}>{L(vi, 'Để sau', 'Not now')}</button>
            <button type="button" disabled={busy || !at || !serviceIds.length} onClick={book} style={{ ...st.primary, flex: 2, height: 56, opacity: at && serviceIds.length ? 1 : 0.45 }}>
              {busy ? '…' : L(vi, 'Đặt lịch', 'Book it')}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
