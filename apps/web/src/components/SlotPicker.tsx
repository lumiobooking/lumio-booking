'use client';

// ---------------------------------------------------------------------------
// The booking form's date & time (approved canvas "Đặt lịch — chọn ngày &
// giờ gọn hơn").
//
// Computer and tablet: one quiet panel — a small month calendar on the left,
// the day's times as a grid on the right. Days gone by and days the salon is
// shut are faint and struck through; so are times gone by and times with no
// technician free. A period that is entirely past folds into one faint line.
// Under the panel one line confirms the choice and how many technicians are
// free. Phone: two fields, Ngày and Giờ, each opening a sheet from the bottom.
//
// Everything is the SALON's wall clock ("YYYY-MM-DDTHH:mm"). With no opening
// hours recorded the browser's own picker is used, as before.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { DateTimeField } from './DateTimeField';
import { instantToWall, wallToInstantISO } from '../lib/datetime';
import { clockText, wallParts, type HoursRules } from '../lib/desk-hours';
import { dayIsOpen, firstOpenDay, hasHours, monthCells, periodOf, slotsForDay, wallOf, type Period } from '../lib/slot-picker';
import { useIsMobile } from '../lib/responsive';

interface BusyBooking { status: string; startTime: string; endTime: string; assignedStaff: { id: string } | null }
interface StaffLite { id: string; isActive: boolean; firstName?: string; lastName?: string | null }

const DEAD = new Set(['CANCELLED', 'COMPLETED', 'NO_SHOW']);
const DOW_VI = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const DOW_EN = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY_VI = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const DAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PERIODS: Period[] = ['morning', 'afternoon', 'evening'];
const PERIOD_LABEL: Record<Period, [string, string]> = { morning: ['Sáng', 'Morning'], afternoon: ['Chiều', 'Afternoon'], evening: ['Tối', 'Evening'] };

const T = {
  ink: 'var(--cf1f5f9)', ink2: 'var(--ce2e8f0)', body: 'var(--ccbd5e1)', sub: 'var(--c94a3b8)', muted: 'var(--c64748b)', faint: 'var(--ink-faint)',
  line: 'var(--c1f2937)', border: 'var(--c334155)', soft: 'var(--c0f172a)', panel: 'var(--c111827)',
  good: 'var(--ink-good)', warn: 'var(--ink-warn)', link: 'var(--ink-link)',
};

function Dot({ color, size = 6 }: { color: string; size?: number }) {
  return <span aria-hidden style={{ width: size, height: size, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />;
}
function Chev({ dir }: { dir: 'left' | 'right' | 'down' }) {
  const d = dir === 'left' ? 'm15 18-6-6 6-6' : dir === 'right' ? 'm9 18 6-6-6-6' : 'm6 9 6 6 6-6';
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
}
function CalIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>;
}
function ClockIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>;
}

function fmtDayLong(ymd: string, vi: boolean): string {
  const p = wallParts(`${ymd}T00:00`);
  if (!p) return ymd;
  return vi ? `${DAY_VI[p.weekday]}, ${p.d}/${p.mo}/${ymd.slice(0, 4)}` : `${DAY_EN[p.weekday]}, ${p.mo}/${p.d}/${ymd.slice(0, 4)}`;
}
function fmtDayShort(ymd: string, vi: boolean): string {
  const p = wallParts(`${ymd}T00:00`);
  if (!p) return ymd;
  return vi ? `${DAY_VI[p.weekday]} ${p.d}/${p.mo}` : `${DAY_EN[p.weekday].slice(0, 3)} ${p.mo}/${p.d}`;
}

/** Who is busy over the visit at each offered time. */
function useFreeAt(day: string, slots: { min: number }[], bookings: BusyBooking[], staff: StaffLite[], minutes: number, salonTz: string | undefined, tech: string) {
  return useMemo(() => {
    const len = Math.max(15, minutes) * 60_000;
    const live = bookings.filter((b) => !DEAD.has(b.status) && b.assignedStaff?.id);
    const active = staff.filter((s) => s.isActive);
    const out = new Map<number, { free: StaffLite[]; techBusy: boolean }>();
    for (const s of slots) {
      const start = Date.parse(wallToInstantISO(wallOf(day, s.min), salonTz || undefined));
      if (!Number.isFinite(start)) continue;
      const end = start + len;
      const busy = new Set(live.filter((b) => Date.parse(b.startTime) < end && Date.parse(b.endTime) > start).map((b) => b.assignedStaff!.id));
      out.set(s.min, { free: active.filter((a) => !busy.has(a.id)), techBusy: Boolean(tech && busy.has(tech)) });
    }
    return out;
  }, [day, slots, bookings, staff, minutes, salonTz, tech]);
}

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
  staff: StaffLite[];
  /** The technician picked for the booker ('' / '__none' = none). */
  staffId: string;
}) {
  const phone = useIsMobile(699);
  const nowWall = instantToWall(Date.now(), salonTz || undefined);
  const today = nowWall.slice(0, 10);
  const picked = wallParts(value);
  const [dayState, setDay] = useState<string | null>(null);
  const day = dayState ?? picked?.ymd ?? firstOpenDay(today, rules, nowWall) ?? today;
  const [showPast, setShowPast] = useState(false);
  const [custom, setCustom] = useState(false);
  const [sheet, setSheet] = useState<'day' | 'time' | null>(null);
  const [ym, setYm] = useState<{ y: number; m: number }>(() => ({ y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)) }));
  const slots = useMemo(() => slotsForDay(day, rules, { nowWall, showPast }), [day, rules, nowWall, showPast]);
  const tech = staffId && staffId !== '__none' ? staffId : '';
  const freeAt = useFreeAt(day, slots, bookings, staff, minutes, salonTz, tech);
  const isToday = day === today;
  /** Every time the salon takes that day, past or not — to tell "all gone" from "never open". */
  const dayAll = useMemo(() => slotsForDay(day, rules, { nowWall: `${day}T00:00` }), [day, rules]);
  const wide = !useIsMobile(899);

  const pickDay = (ymd: string) => { setDay(ymd); setShowPast(false); if (picked && picked.ymd !== ymd) onChange(''); setSheet(null); };

  if (!hasHours(rules) || custom) {
    return (
      <div>
        <DateTimeField value={value} onChange={onChange} required />
        {custom && <button type="button" onClick={() => setCustom(false)} style={linkBtn}>{vi ? '← Chọn trong giờ mở cửa' : '← Pick within opening hours'}</button>}
      </div>
    );
  }

  // ---- the pieces --------------------------------------------------------

  const calendar = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: T.ink }}>{vi ? `Tháng ${ym.m}, ${ym.y}` : `${MON_EN[ym.m - 1]} ${ym.y}`}</span>
        <span style={{ display: 'flex', gap: 4 }}>
          {([-1, 1] as const).map((d) => (
            <button key={d} type="button" aria-label={d < 0 ? (vi ? 'Tháng trước' : 'Previous month') : (vi ? 'Tháng sau' : 'Next month')}
              onClick={() => setYm((c) => { const m = c.m + d; return m < 1 ? { y: c.y - 1, m: 12 } : m > 12 ? { y: c.y + 1, m: 1 } : { y: c.y, m }; })}
              style={{ width: 28, height: 28, borderRadius: 7, border: `1px solid ${T.border}`, background: 'transparent', color: T.sub, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <Chev dir={d < 0 ? 'left' : 'right'} />
            </button>
          ))}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, textAlign: 'center', fontSize: 11, fontWeight: 600, color: T.muted }}>
        {(vi ? DOW_VI : DOW_EN).map((d) => <span key={d}>{d}</span>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {monthCells(ym.y, ym.m, today, rules).map((c) => {
          const on = c.ymd === day;
          const dead = !c.inMonth || c.past || !c.open;
          return (
            <button key={c.ymd} type="button" disabled={dead} onClick={() => pickDay(c.ymd)} aria-pressed={on}
              aria-label={c.ymd} title={!c.inMonth ? undefined : c.past ? (vi ? 'Đã qua' : 'Past') : !c.open ? (vi ? 'Tiệm nghỉ' : 'Closed') : undefined}
              style={{
                height: 34, borderRadius: 8, border: 0, fontFamily: 'inherit', fontSize: 13, cursor: dead ? 'default' : 'pointer', position: 'relative',
                background: on ? '#6366f1' : 'transparent', fontWeight: on || c.today ? 700 : 500,
                color: on ? '#ffffff' : !c.inMonth || c.past ? T.faint : !c.open ? T.muted : T.ink,
                textDecoration: c.inMonth && !c.past && !c.open ? 'line-through' : 'none', opacity: c.inMonth && !c.past && !c.open ? 0.7 : 1,
                boxShadow: c.today && !on ? 'inset 0 0 0 1.5px #6366f1' : 'none',
              }}>
              {c.d}
            </button>
          );
        })}
      </div>
      <span style={{ fontSize: 11.5, color: T.muted }}>{vi ? 'Ngày mờ = đã qua hoặc tiệm nghỉ' : 'Faint = past, or the salon is closed'}</span>
    </div>
  );

  const groups = PERIODS.map((p) => ({ p, items: slots.filter((s) => periodOf(s.min) === p) })).filter((g) => g.items.length);
  // A period the salon is open for but whose times are all gone folds into
  // one faint line; with "Khách đã đến" on, its times come back instead.
  const allGone = (p: Period) => isToday && dayAll.some((s) => periodOf(s.min) === p);

  const timeChip = (s: { min: number; past: boolean }) => {
    const on = picked?.ymd === day && picked.minutes === s.min;
    const f = freeAt.get(s.min);
    const full = f ? f.free.length === 0 : false;
    const dead = full || s.past;
    const dotColor = on ? '#ffffff' : dead ? null : f?.techBusy ? '#f59e0b' : f && f.free.length >= 2 ? '#22c55e' : '#f59e0b';
    const tip = s.past ? (vi ? 'Đã qua — ghi bù' : 'Past — recording') : full ? (vi ? 'Hết thợ' : 'No technician free') : f?.techBusy ? (vi ? 'Thợ đã chọn đang bận' : 'Chosen tech is busy') : f ? `${f.free.length} ${vi ? 'thợ rảnh' : 'free'}` : '';
    return (
      <button key={s.min} type="button" onClick={() => onChange(wallOf(day, s.min))} aria-pressed={on} title={tip}
        style={{
          height: 36, borderRadius: 9, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, boxSizing: 'border-box',
          background: on ? '#6366f1' : dead ? 'transparent' : T.panel,
          border: `1px solid ${on ? '#6366f1' : dead ? 'transparent' : T.border}`,
          color: on ? '#ffffff' : dead ? T.faint : T.ink,
          textDecoration: full && !s.past && !on ? 'line-through' : 'none',
        }}>
        {dotColor && <Dot color={dotColor} />}{clockText(s.min, vi)}
      </button>
    );
  };

  const timeGrid = (cols: number) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {PERIODS.map((p) => {
        const g = groups.find((x) => x.p === p);
        if (!g) return allGone(p) ? <div key={p} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: T.faint }}>{PERIOD_LABEL[p][vi ? 0 : 1]} · {vi ? 'đã qua' : 'past'}</div> : null;
        return (
          <div key={p} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: T.muted }}>{PERIOD_LABEL[p][vi ? 0 : 1]}</span>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: 6 }}>{g.items.map(timeChip)}</div>
          </div>
        );
      })}
      {groups.length === 0 && (
        <span style={{ fontSize: 13, color: T.sub }}>{isToday ? (vi ? 'Hôm nay đã hết giờ nhận lịch — chọn ngày khác.' : 'No times left today — pick another day.') : (vi ? 'Tiệm không nhận lịch ngày này.' : 'No bookings that day.')}</span>
      )}
    </div>
  );

  const legend = (
    <span style={{ display: 'inline-flex', gap: 12, fontSize: 11.5, color: T.sub, alignItems: 'center', whiteSpace: 'nowrap' }}>
      <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><Dot color="#22c55e" />{vi ? '≥2 thợ' : '≥2 free'}</span>
      <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><Dot color="#f59e0b" />{vi ? '1 thợ' : '1 free'}</span>
      <span style={{ color: T.faint }}><s>{vi ? 'hết / đã qua' : 'full / past'}</s></span>
    </span>
  );

  const chosen = picked && picked.ymd === day ? freeAt.get(picked.minutes) : undefined;
  const endMin = picked ? picked.minutes + Math.max(0, minutes) : 0;
  const summary = picked ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: T.sub, flexWrap: 'wrap' }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      <span>
        <b style={{ color: T.ink }}>{fmtDayShort(picked.ymd, vi)} · {clockText(picked.minutes, vi)}</b>
        {minutes > 0 && <> → {vi ? 'xong khoảng' : 'ends about'} <b style={{ color: T.ink }}>{clockText(endMin, vi)}</b></>}
        {chosen && (
          <> · <span style={{ color: chosen.free.length ? T.good : T.warn, fontWeight: 600 }}>{chosen.free.length ? `${chosen.free.length} ${vi ? 'thợ rảnh' : 'free'}` : (vi ? 'hết thợ' : 'no one free')}</span>
            {chosen.free.length > 0 && !phone && <span> ({chosen.free.map((s) => s.firstName ?? s.id).join(', ')})</span>}</>
        )}
      </span>
    </div>
  ) : null;

  const extras = (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      {isToday && (
        <button type="button" onClick={() => setShowPast((v) => !v)} style={linkBtn}>
          {showPast ? (vi ? 'Ẩn giờ đã qua' : 'Hide past times') : (vi ? 'Khách đã đến?' : 'Customer already here?')}
        </button>
      )}
      {isOwner && <button type="button" onClick={() => setCustom(true)} style={linkBtn}>{vi ? 'Giờ khác (chủ tiệm)' : 'Another time (owner)'}</button>}
    </div>
  );

  // ---- phone: two fields and two sheets -----------------------------------
  if (phone) {
    const fieldStyle = (on: boolean): React.CSSProperties => ({
      height: 44, borderRadius: 10, border: `1px solid ${on ? '#6366f1' : T.border}`, background: T.soft, color: T.ink2, fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
      display: 'flex', alignItems: 'center', gap: 9, padding: '0 12px', cursor: 'pointer', width: '100%', textAlign: 'left', boxSizing: 'border-box',
    });
    const count = slots.filter((s) => !s.past && (freeAt.get(s.min)?.free.length ?? 1) > 0).length;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" onClick={() => setSheet('day')} style={fieldStyle(sheet === 'day')}>
          <span style={{ color: sheet === 'day' ? T.link : T.sub, display: 'flex' }}><CalIcon /></span><span style={{ flex: 1 }}>{fmtDayLong(day, vi)}</span><span style={{ color: T.sub, display: 'flex' }}><Chev dir="down" /></span>
        </button>
        <button type="button" onClick={() => setSheet('time')} style={fieldStyle(sheet === 'time')}>
          <span style={{ color: sheet === 'time' ? T.link : T.sub, display: 'flex' }}><ClockIcon /></span>
          <span style={{ flex: 1, color: picked ? T.ink2 : T.muted }}>{picked && picked.ymd === day ? clockText(picked.minutes, vi) : (vi ? `Chọn giờ · ${count} giờ trống` : `Pick a time · ${count} open`)}</span>
          <span style={{ color: T.sub, display: 'flex' }}><Chev dir="down" /></span>
        </button>
        {summary}
        {extras}
        {sheet && (
          <Sheet title={sheet === 'day' ? (vi ? 'Chọn ngày' : 'Pick a day') : `${vi ? 'Chọn giờ' : 'Pick a time'} · ${fmtDayShort(day, vi)}`} onClose={() => setSheet(null)}>
            {sheet === 'day' ? calendar : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {slots.map((s) => {
                  const on = picked?.ymd === day && picked.minutes === s.min;
                  const f = freeAt.get(s.min);
                  const full = f ? f.free.length === 0 : false;
                  const dead = full || s.past;
                  return (
                    <button key={s.min} type="button" onClick={() => { onChange(wallOf(day, s.min)); setSheet(null); }} aria-pressed={on}
                      style={{
                        height: 44, borderRadius: 9, border: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', fontFamily: 'inherit', fontSize: 15, fontWeight: on ? 700 : 600, cursor: 'pointer',
                        background: on ? '#6366f1' : 'transparent', color: on ? '#ffffff' : dead ? T.faint : T.ink, textDecoration: full && !s.past && !on ? 'line-through' : 'none',
                      }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{!dead && <Dot color={on ? '#ffffff' : f && f.free.length >= 2 && !f.techBusy ? '#22c55e' : '#f59e0b'} size={7} />}{clockText(s.min, vi)}</span>
                      <span style={{ fontSize: 12, fontWeight: 500, color: on ? 'rgba(255,255,255,.85)' : s.past ? T.faint : full ? T.faint : f?.techBusy ? T.warn : T.good }}>
                        {s.past ? (vi ? 'đã qua' : 'past') : full ? (vi ? 'hết thợ' : 'full') : f?.techBusy ? (vi ? 'thợ này bận' : 'tech busy') : f ? `${f.free.length} ${vi ? 'thợ rảnh' : 'free'}` : ''}
                      </span>
                    </button>
                  );
                })}
                {slots.length === 0 && <span style={{ padding: 12, fontSize: 13, color: T.sub }}>{isToday ? (vi ? 'Hôm nay đã hết giờ nhận lịch — chọn ngày khác.' : 'No times left today.') : (vi ? 'Tiệm không nhận lịch ngày này.' : 'No bookings that day.')}</span>}
              </div>
            )}
          </Sheet>
        )}
      </div>
    );
  }

  // ---- computer and tablet: the panel ------------------------------------
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ border: `1px solid ${T.line}`, borderRadius: 14, background: T.soft, padding: 14, display: 'flex', gap: 18 }}>
        <div style={{ width: wide ? 280 : 250, flexShrink: 0, borderRight: `1px solid ${T.line}`, paddingRight: 18 }}>{calendar}</div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: T.ink }}>{fmtDayShort(day, vi)} · {vi ? 'chọn giờ' : 'pick a time'}</span>
            {legend}
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto', paddingRight: 2 }}>{timeGrid(wide ? 4 : 3)}</div>
        </div>
      </div>
      {summary}
      {extras}
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 130, background: 'rgba(2,6,23,.5)' }} />
      <div role="dialog" aria-label={title} style={{ position: 'fixed', left: 0, right: 0, bottom: 0, top: 'max(80px, 18dvh)', zIndex: 131, background: T.panel, borderRadius: '20px 20px 0 0', borderTop: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 16px 6px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span aria-hidden style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, background: T.border }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: T.ink }}>{title}</span>
            <button type="button" aria-label="Đóng" onClick={onClose} style={{ width: 36, height: 36, border: 0, background: 'transparent', color: T.sub, fontSize: 18, cursor: 'pointer' }}>✕</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 16px calc(16px + env(safe-area-inset-bottom, 0px))' }}>{children}</div>
      </div>
    </>
  );
}

const linkBtn: React.CSSProperties = {
  border: 0, background: 'transparent', padding: '2px 0', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, color: 'var(--ink-link)', cursor: 'pointer',
};
