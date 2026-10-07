'use client';

// CHẤM CÔNG on the technician's "Hôm nay" screen.
//
// One big button: "Vào ca" when she walks in, "Ra ca" when she leaves. While
// she is in, the card counts the shift up in real time. It only appears once
// the salon pays by the clock (or someone has used it) — a salon that never
// switches it on sees exactly the screen it had before.
//
// A shift left open on an earlier day can't be closed from the phone (she
// would be guessing the hour); the card says so and the owner fixes it under
// Lương → Chấm công.

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { fmtInTz } from '../../lib/datetime';
import { useLiveRefresh } from '../../lib/useLiveRefresh';
import { IC, Icon, L, SectionLabel, Sheet, st } from './kit';

interface Mine {
  timezone: string; today: string; inUse?: boolean;
  open: { id: string; clockIn: string } | null;
  todayMinutes: number;
  stale: { id: string; clockIn: string }[];
  recent?: { id: string; clockIn: string; clockOut: string | null; minutes: number | null }[];
}

/** "7h 05m" / "45m". */
export function fmtWorked(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h}h ${String(r).padStart(2, '0')}m` : `${r}m`;
}

export function ClockCard({ token, vi, onToast }: { token: string | null; vi: boolean; onToast: (text: string) => void }) {
  const [me, setMe] = useState<Mine | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    if (!token) return;
    // No staff profile (an owner peeking at the staff app) → no card.
    const r = await apiFetch<Mine>('/time-clock/me', { token }).catch(() => null);
    setMe(r);
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(load, 60000);

  // Count the open shift up once a minute, between loads.
  useEffect(() => {
    if (!me?.open) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 30000);
    return () => window.clearInterval(t);
  }, [me?.open]);

  if (!me || (!me.inUse && !me.open && me.stale.length === 0)) return null;

  // The open shift is counted fresh on every tick so the number keeps moving;
  // shifts already closed today come from the server as they are.
  void tick;
  const live = me.open ? Math.max(0, (Date.now() - new Date(me.open.clockIn).getTime()) / 60000) : 0;
  const worked = me.open ? closedToday(me) + Math.min(live, 960) : me.todayMinutes;

  async function act(path: '/time-clock/me/in' | '/time-clock/me/out') {
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch<Mine>(path, { method: 'POST', token });
      setMe((m) => ({ ...(m as Mine), ...r, inUse: true }));
      onToast(path.endsWith('/in')
        ? L(vi, `Đã vào ca lúc ${fmtInTz(new Date(), { hour: 'numeric', minute: '2-digit' })}`, `Clocked in at ${fmtInTz(new Date(), { hour: 'numeric', minute: '2-digit' })}`)
        : L(vi, `Đã ra ca · hôm nay ${fmtWorked(r.todayMinutes)}`, `Clocked out · ${fmtWorked(r.todayMinutes)} today`));
      setAsk(false);
      void load();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <SectionLabel right={me.open ? <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-good)' }}>{L(vi, '● Trong ca', '● On the clock')}</span> : undefined}>
        {L(vi, 'Chấm công', 'Time clock')}
      </SectionLabel>
      <div style={{ ...st.card, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 48, height: 48, borderRadius: 999, background: me.open ? 'var(--c052e16)' : 'var(--c1e1b4b)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon d={IC.clock} size={24} color={me.open ? 'var(--ink-good)' : 'var(--cc7d2fe)'} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ce2e8f0)' }}>
            {me.open
              ? L(vi, `Vào ca lúc ${fmtInTz(me.open.clockIn, { hour: 'numeric', minute: '2-digit' })}`, `In since ${fmtInTz(me.open.clockIn, { hour: 'numeric', minute: '2-digit' })}`)
              : worked > 0 ? L(vi, 'Đã ra ca', 'Clocked out') : L(vi, 'Chưa vào ca', 'Not clocked in')}
          </div>
          <div style={{ fontSize: 14, color: 'var(--c94a3b8)', marginTop: 2 }}>
            {L(vi, `Hôm nay: ${fmtWorked(worked)}`, `Today: ${fmtWorked(worked)}`)}
          </div>
        </div>
        {me.open ? (
          <button type="button" disabled={busy} onClick={() => setAsk(true)} style={{ ...st.ghost, height: 52, minWidth: 104 }}>{L(vi, 'Ra ca', 'Clock out')}</button>
        ) : (
          <button type="button" disabled={busy} onClick={() => act('/time-clock/me/in')} style={{ ...st.primary, minWidth: 104 }}>{L(vi, 'Vào ca', 'Clock in')}</button>
        )}
      </div>
      {me.stale.length > 0 && (
        <div style={{ ...st.card, marginTop: 8, padding: 12, background: 'var(--wash-amber)', borderColor: 'var(--ink-warn)', color: 'var(--ink-warn)', fontSize: 14, lineHeight: 1.45 }}>
          {L(vi,
            `Ca ngày ${fmtInTz(me.stale[0].clockIn, { day: 'numeric', month: 'numeric' })} chưa bấm "Ra ca". Nhờ chủ tiệm sửa giờ ra trong mục Chấm công.`,
            `Your shift on ${fmtInTz(me.stale[0].clockIn, { month: 'short', day: 'numeric' })} was never clocked out. Ask the owner to fix it under Time clock.`)}
        </div>
      )}
      {err && <div style={{ color: 'var(--ink-bad)', fontSize: 14, marginTop: 8 }}>{err}</div>}

      <Sheet open={ask} onClose={() => setAsk(false)} label={L(vi, 'Ra ca', 'Clock out')}>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ce2e8f0)' }}>{L(vi, 'Ra ca bây giờ?', 'Clock out now?')}</div>
        <div style={{ fontSize: 14, color: 'var(--c94a3b8)', marginTop: 4, lineHeight: 1.5 }}>
          {L(vi, `Hôm nay bạn đã làm ${fmtWorked(worked)}. Bấm nhầm thì vào ca lại là được — giờ đã tính vẫn giữ.`, `You have worked ${fmtWorked(worked)} today. Tapped by mistake? Just clock in again.`)}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button type="button" onClick={() => setAsk(false)} style={{ ...st.ghost, flex: 1, height: 56 }}>{L(vi, 'Chưa', 'Not yet')}</button>
          <button type="button" disabled={busy} onClick={() => act('/time-clock/me/out')} style={{ ...st.done, flex: 2 }}>{L(vi, 'Ra ca', 'Clock out')}</button>
        </div>
      </Sheet>
    </div>
  );
}

/** Minutes of today's already-closed shifts (the open one is counted live). */
function closedToday(me: Mine): number {
  return (me.recent ?? []).filter((r) => r.clockOut && r.minutes != null && sameDay(r.clockIn, me)).reduce((a, r) => a + (r.minutes ?? 0), 0);
}
function sameDay(iso: string, me: Mine): boolean {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: me.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)) === me.today; }
  catch { return false; }
}
