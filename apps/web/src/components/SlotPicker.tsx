'use client';

// ---------------------------------------------------------------------------
// The booking form's date & time: open days as a strip, open times as buttons,
// each with how many technicians are free. Times outside opening hours and
// times already gone are simply not offered. The desk can still record a
// customer already in the chair ("Khách đã đến") and the owner can still pick
// a time outside hours on purpose — both one tap away, never the default.
// Falls back to the browser's picker when the salon has no hours set.
// ---------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { ui } from '../lib/ui';
import { instantToWall, wallToInstantISO } from '../lib/datetime';
import { clockText, wallParts, type HoursRules } from '../lib/desk-hours';
import { dayOptions, firstOpenDay, hasHours, slotsForDay, wallOf } from '../lib/slot-picker';

interface BusyBooking { status: string; startTime: string; endTime: string; assignedStaff: { id: string } | null }

const DAY_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const DAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DEAD = new Set(['CANCELLED', 'COMPLETED', 'NO_SHOW']);

export function SlotPicker({ value, onChange, rules, salonTz, vi, isOwner, minutes, bookings, staff, staffId }: {
  value: string;
  onChange: (v: string) => void;
  rules: HoursRules | null | undefined;
  salonTz?: string;
  vi: boolean;
  isOwner?: boolean;
  /** Longest service time in the party — the window "free" is measured over. */
  minutes: number;
  bookings: BusyBooking[];
  staff: { id: string; isActive: boolean }[];
  /** The technician picked for the booker ('' / '__none' = none). */
  staffId: string;
}) {
  const nowWall = instantToWall(Date.now(), salonTz || undefined);
  const today = nowWall.slice(0, 10);
  const [showPast, setShowPast] = useState(false);
  const [custom, setCustom] = useState(false);
  const picked = wallParts(value);
  const [dayState, setDay] = useState<string | null>(null);
  const day = dayState ?? picked?.ymd ?? firstOpenDay(today, rules, nowWall) ?? today;
  const days = useMemo(() => dayOptions(today, rules, 14), [today, rules]);
  const slots = useMemo(() => slotsForDay(day, rules, { nowWall, showPast }), [day, rules, nowWall, showPast]);
  const active = staff.filter((s) => s.isActive);
  const tech = staffId && staffId !== '__none' ? staffId : '';

  // Who is busy at each offered time, over the length of the visit.
  const freeAt = useMemo(() => {
    const len = Math.max(15, minutes) * 60_000;
    const live = bookings.filter((b) => !DEAD.has(b.status) && b.assignedStaff?.id);
    const out = new Map<number, { free: number; techBusy: boolean }>();
    for (const s of slots) {
      const start = Date.parse(wallToInstantISO(wallOf(day, s.min), salonTz || undefined));
      if (!Number.isFinite(start)) continue;
      const end = start + len;
      const busy = new Set(live.filter((b) => Date.parse(b.startTime) < end && Date.parse(b.endTime) > start).map((b) => b.assignedStaff!.id));
      out.set(s.min, { free: active.filter((a) => !busy.has(a.id)).length, techBusy: Boolean(tech && busy.has(tech)) });
    }
    return out;
  }, [slots, bookings, minutes, day, salonTz, active, tech]);

  if (!hasHours(rules) || custom) {
    return (
      <div>
        <input style={ui.input} type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} required />
        {custom && (
          <button type="button" onClick={() => setCustom(false)} style={linkBtn}>
            {vi ? '← Chọn trong giờ mở cửa' : '← Pick within opening hours'}
          </button>
        )}
      </div>
    );
  }

  const groups = [
    { label: vi ? 'Sáng' : 'Morning', items: slots.filter((s) => s.min < 12 * 60) },
    { label: vi ? 'Chiều' : 'Afternoon', items: slots.filter((s) => s.min >= 12 * 60 && s.min < 17 * 60) },
    { label: vi ? 'Tối' : 'Evening', items: slots.filter((s) => s.min >= 17 * 60) },
  ].filter((g) => g.items.length);
  const isToday = day === today;
  const offStrip = !days.some((d) => d.ymd === day);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* ---- days ---- */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'thin' }}>
        {days.map((d) => {
          const on = d.ymd === day;
          return (
            <button key={d.ymd} type="button" disabled={!d.open} onClick={() => { setDay(d.ymd); setShowPast(false); if (picked && picked.ymd !== d.ymd) onChange(''); }}
              title={!d.open ? (d.reason === 'dayOff' ? (vi ? 'Tiệm nghỉ ngày này' : 'Day off') : (vi ? 'Tiệm không mở cửa' : 'Closed')) : undefined}
              style={{
                flex: '0 0 auto', width: 58, padding: '6px 0', borderRadius: 10, cursor: d.open ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, opacity: d.open ? 1 : 0.45,
                ...(on ? { background: '#6366f1', border: '1px solid #6366f1', color: '#ffffff' } : { background: 'transparent', border: '1px solid var(--c334155)', color: 'var(--ce2e8f0)' }),
              }}>
              <span style={{ fontSize: 11, fontWeight: 600, opacity: on ? 0.9 : 0.75 }}>{d.ymd === today ? (vi ? 'Hôm nay' : 'Today') : (vi ? DAY_VI : DAY_EN)[d.weekday]}</span>
              <span style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.1 }}>{d.d}</span>
              <span style={{ fontSize: 10.5, opacity: 0.75 }}>{d.open ? (vi ? `Th ${d.mo}` : MON_EN[d.mo - 1]) : (vi ? 'Nghỉ' : 'Closed')}</span>
            </button>
          );
        })}
        <label title={vi ? 'Chọn ngày khác' : 'Another date'} style={{
          flex: '0 0 auto', position: 'relative', width: 58, borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
          cursor: 'pointer', fontSize: 11, fontWeight: 600, textAlign: 'center',
          ...(offStrip ? { background: '#6366f1', border: '1px solid #6366f1', color: '#ffffff' } : { border: '1px dashed var(--c334155)', color: 'var(--c94a3b8)' }),
        }}>
          <span style={{ fontSize: 15 }}>📅</span>{offStrip ? `${Number(day.slice(8))}/${Number(day.slice(5, 7))}` : (vi ? 'Ngày khác' : 'Other')}
          <input type="date" min={today} value={offStrip ? day : ''} onChange={(e) => { if (e.target.value) { setDay(e.target.value); onChange(''); } }}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', fontSize: 16 }} />
        </label>
      </div>

      {/* ---- times ---- */}
      {groups.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--c94a3b8)', padding: '10px 12px', border: '1px dashed var(--c334155)', borderRadius: 10 }}>
          {isToday
            ? (vi ? 'Hôm nay đã hết giờ nhận lịch — chọn ngày khác.' : 'No times left today — pick another day.')
            : (vi ? 'Tiệm không nhận lịch ngày này — chọn ngày khác.' : 'The salon takes no bookings that day — pick another day.')}
        </div>
      ) : groups.map((g) => (
        <div key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--c94a3b8)' }}>{g.label}</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(78px, 1fr))', gap: 6 }}>
            {g.items.map((s) => {
              const on = picked?.ymd === day && picked.minutes === s.min;
              const f = freeAt.get(s.min);
              const full = f ? f.free === 0 : false;
              const sub = s.past ? (vi ? 'đã qua' : 'past')
                : f?.techBusy ? (vi ? 'thợ này bận' : 'tech busy')
                : full ? (vi ? 'hết thợ' : 'full')
                : f ? `${f.free} ${vi ? 'thợ rảnh' : 'free'}` : '';
              return (
                <button key={s.min} type="button" onClick={() => onChange(wallOf(day, s.min))} aria-pressed={on}
                  title={sub}
                  style={{
                    minHeight: 42, padding: '4px 4px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0,
                    ...(on ? { background: '#6366f1', border: '1px solid #6366f1', color: '#ffffff' }
                      : { background: 'transparent', border: `1px ${full || s.past || f?.techBusy ? 'dashed' : 'solid'} var(--c334155)`, color: full || s.past ? 'var(--c64748b)' : 'var(--ce2e8f0)' }),
                  }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{clockText(s.min, vi)}</span>
                  {sub && <span style={{ fontSize: 10, fontWeight: 600, opacity: on ? 0.85 : 1, color: on ? undefined : f?.techBusy || full ? 'var(--ink-warn)' : 'var(--c94a3b8)' }}>{sub}</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {isToday && (
          <button type="button" onClick={() => setShowPast((v) => !v)} style={linkBtn}>
            {showPast ? (vi ? 'Ẩn giờ đã qua' : 'Hide past times') : (vi ? '⏱ Khách đã đến — ghi giờ đã qua' : '⏱ Customer already here — record an earlier time')}
          </button>
        )}
        {isOwner && (
          <button type="button" onClick={() => setCustom(true)} style={linkBtn}>
            {vi ? 'Giờ ngoài giờ mở cửa (chủ tiệm)' : 'A time outside opening hours (owner)'}
          </button>
        )}
      </div>
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  border: 0, background: 'transparent', padding: '2px 0', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, color: 'var(--ink-link)', cursor: 'pointer',
};
