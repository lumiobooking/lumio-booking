'use client';

/**
 * LIST — the calendar's day as one chronological list (replaces the old "Day"
 * card grid and timeline). From the approved mockup:
 *
 *  - one row per booking, read top to bottom by time, grouped Morning /
 *    Afternoon / Evening, with a red "Now" line between the past and the rest;
 *  - each row: time · status bar · client + source + service · technician (or
 *    an Assign picker) · price · status, and the action the row is waiting for
 *    right on it (Not arrived → Check in / No-show, Pending → Confirm,
 *    Checked in → Checkout);
 *  - cancelled bookings fold behind "Show cancelled"; on a phone, today's
 *    finished visits fold into one "Earlier today" line;
 *  - on a wide screen a rail: the day at a glance, what needs attention, where
 *    bookings came from and how booked each tech is; narrower screens get the
 *    same numbers as four tiles and one attention banner.
 *
 * Every number comes from lib/cal-day, the same module the filters and the
 * date strip use.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { formatPrice } from '../../../lib/ui';
import { ind } from '../../../lib/ui-industry';
import { sourceCounts } from '../../../lib/booking-sources';
import {
  activeFilterCount, attentionOf, facetCounts, bookedMinutes, durationMin, isGone, isOpen, lateMinutes, listKey, periodOf, shiftMinutes, summarize, hhmm,
  type CalFilters, type DayBooking, type FacetCounts,
} from '../../../lib/cal-day';
import { ActiveChips, Avatar, C, Icon, SourceTabs, SrcPill, ST, StatusChip, btn, onIndigo, type StaffOpt } from './CalParts';

export interface ListBooking extends DayBooking {
  currency: string;
  customer: { id: string; firstName: string; lastName: string | null; phone: string | null } | null;
  service: { id: string; name: string; durationMinutes: number } | null;
  assignedStaff: { id: string; firstName: string; lastName: string | null } | null;
  addons?: { kind?: string }[];
  partySize?: number;
  groupId?: string | null;
}

export interface ShiftStaffFull extends StaffOpt {
  isActive?: boolean;
  takesAppointments?: boolean;
  workingHours?: { dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }[];
}

type Act = (id: string, path: string, body?: unknown) => void;

export function fmtDur(min: number): string {
  if (min <= 0) return '';
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

const clientName = (b: ListBooking) => (b.customer ? `${b.customer.firstName}${b.customer.lastName ? ' ' + b.customer.lastName : ''}` : '—');
function svcText(b: ListBooking, vi: boolean): string {
  const extra = (b.addons ?? []).filter((a) => a.kind === 'service').length;
  const party = b.partySize && b.partySize > 1 ? ` · ${vi ? 'nhóm' : 'party of'} ${b.partySize}` : '';
  return `${b.service?.name ?? ''}${extra ? ` +${extra}` : ''}${party}`;
}
export const posUrlOf = (b: ListBooking) =>
  `/salon/pos?appointmentId=${b.id}&serviceId=${b.service?.id ?? ''}&staffId=${b.assignedStaff?.id ?? ''}&customerId=${b.customer?.id ?? ''}&customer=${encodeURIComponent(clientName(b))}`;

function minuteOf(iso: string, tz?: string): number {
  const d = new Date(iso);
  if (!tz) return d.getHours() * 60 + d.getMinutes();
  const p = new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).formatToParts(d);
  return (Number(p.find((x) => x.type === 'hour')?.value ?? 0) % 24) * 60 + Number(p.find((x) => x.type === 'minute')?.value ?? 0);
}

const small = (primary = false): CSSProperties => ({ ...btn(primary, 32), padding: '0 11px', fontSize: 13 });

// ── one row ───────────────────────────────────────────────────────────────

function AssignPick({ b, staff, onAction, vi, compact }: { b: ListBooking; staff: StaffOpt[]; onAction: Act; vi: boolean; compact?: boolean }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 3, color: C.indigoText, fontSize: compact ? 12 : 12.5, fontWeight: 600, cursor: 'pointer' }}
      onClick={(e) => e.stopPropagation()}>
      {ind(vi ? 'Giao thợ' : 'Assign')}<Icon name="down" size={13} />
      <select aria-label={ind(vi ? 'Giao thợ' : 'Assign a technician')} value="" onChange={(e) => { if (e.target.value) onAction(b.id, 'assign', { staffId: e.target.value }); }}
        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }}>
        <option value="">{ind(vi ? 'Chọn thợ…' : 'Choose a technician…')}</option>
        {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </span>
  );
}

function Actions({ b, k, vi, onAction, phone }: { b: ListBooking; k: ReturnType<typeof listKey>; vi: boolean; onAction: Act; phone?: boolean }) {
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const s = phone ? { ...btn(true, 40), flex: 1 } : small(true);
  const g = phone ? { ...btn(false, 40), flex: 1 } : small(false);
  if (k === 'late') return (
    <>
      <button type="button" style={s} onClick={(e) => { stop(e); onAction(b.id, 'arrive'); }}>{vi ? 'Check in' : 'Check in'}</button>
      <button type="button" style={g} onClick={(e) => { stop(e); onAction(b.id, 'no-show'); }}>{vi ? 'Không đến' : 'No-show'}</button>
    </>
  );
  if (k === 'pending') return <button type="button" style={phone ? { ...btn(true, 32), padding: '0 12px', fontSize: 13 } : s} onClick={(e) => { stop(e); onAction(b.id, 'status', { status: 'CONFIRMED' }); }}>{vi ? 'Xác nhận' : 'Confirm'}</button>;
  if (k === 'arrived') return <a href={posUrlOf(b)} onClick={stop} style={phone ? { ...btn(false, 32), padding: '0 12px', fontSize: 13 } : g}>{vi ? 'Tính tiền' : 'Checkout'}</a>;
  return null;
}

function StaffCell({ b, staff, onAction, vi, small: sm }: { b: ListBooking; staff: StaffOpt[]; onAction: Act; vi: boolean; small?: boolean }) {
  const size = sm ? 18 : 26;
  if (b.assignedStaff) return (
    <><Avatar id={b.assignedStaff.id} name={b.assignedStaff.firstName} size={size} />
      <span style={{ fontSize: sm ? 12 : 13, color: C.body, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.assignedStaff.firstName}</span></>
  );
  return (
    <><Avatar id={null} name="?" size={size} />
      <span style={{ display: 'flex', flexDirection: sm ? 'row' : 'column', gap: sm ? 6 : 0, alignItems: sm ? 'center' : 'flex-start', lineHeight: 1.25 }}>
        <span style={{ fontSize: sm ? 12 : 12.5, color: 'var(--ink-warn)', fontWeight: 600 }}>{ind(vi ? 'Chưa có thợ' : 'Unassigned')}</span>
        {isOpen(b.status) && <AssignPick b={b} staff={staff} onAction={onAction} vi={vi} compact={sm} />}
      </span></>
  );
}

function Row({ b, now, tz, fmtT, vi, staff, onOpen, onAction, onCtx, narrow }: {
  b: ListBooking; now: number; tz?: string; fmtT: (iso: string) => string; vi: boolean; staff: StaffOpt[];
  onOpen: (b: ListBooking) => void; onAction: Act; onCtx: (b: ListBooking, x: number, y: number) => void; narrow?: boolean;
}) {
  const k = listKey(b, now);
  const past = k === 'completed' || k === 'noshow' || k === 'cancelled';
  const late = lateMinutes(b, now);
  const name = clientName(b);
  return (
    <div className="cal-row" role="button" tabIndex={0} onClick={() => onOpen(b)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(b); }}
      onContextMenu={(e) => { e.preventDefault(); onCtx(b, e.clientX, e.clientY); }}
      style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px', minHeight: 62, boxSizing: 'border-box', borderBottom: `1px solid ${C.line}`, cursor: 'pointer',
        background: k === 'late' ? 'var(--wash-amber)' : 'transparent', opacity: k === 'noshow' || k === 'cancelled' ? 0.62 : 1 }}>
      <div style={{ width: narrow ? 74 : 86, flexShrink: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: past ? C.muted : C.ink, whiteSpace: 'nowrap' }}>{fmtT(b.startTime)}</span>
        <span style={{ fontSize: 11.5, color: C.muted }}>{late !== null && k === 'late' ? (vi ? `trễ ${late}′` : `${late}m late`) : fmtDur(durationMin(b))}</span>
      </div>
      <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 3, background: ST[k].bar, flexShrink: 0, margin: '2px 0' }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3, lineHeight: 1.3 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: past ? C.muted : C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: k === 'cancelled' ? 'line-through' : 'none' }}>{name}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <span style={{ flexShrink: 0, display: 'inline-flex' }}><SrcPill b={b} vi={vi} /></span>
          <span style={{ fontSize: 12.5, color: C.sub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{svcText(b, vi)}</span>
        </span>
        {narrow && <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}><StaffCell b={b} staff={staff} onAction={onAction} vi={vi} small /></span>}
      </div>
      {narrow ? (
        <>
          {/* Tablet / small laptop: the technician moves under the service and
              the price sits over the status, so the client keeps its room. */}
          <div style={{ width: 196, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: past ? C.muted : C.ink }}>{formatPrice(b.priceCents, b.currency)}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {k !== 'late' && <StatusChip k={k} vi={vi} small />}
              <Actions b={b} k={k} vi={vi} onAction={onAction} />
            </span>
          </div>
        </>
      ) : (
        <>
          <div style={{ width: 140, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <StaffCell b={b} staff={staff} onAction={onAction} vi={vi} />
          </div>
          <div style={{ width: 72, textAlign: 'right', fontSize: 14, fontWeight: 700, color: past ? C.muted : C.ink, flexShrink: 0 }}>{formatPrice(b.priceCents, b.currency)}</div>
          <div style={{ width: 220, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, flexShrink: 0 }}>
            {/* A late booking says so with its bar, its "15m late" and its wash;
                the row keeps the room for the two buttons that settle it. */}
            {k !== 'late' && <StatusChip k={k} vi={vi} />}
            <Actions b={b} k={k} vi={vi} onAction={onAction} />
          </div>
        </>
      )}
    </div>
  );
}

function PhoneRow({ b, now, fmtT, vi, staff, onOpen, onAction, onCtx }: {
  b: ListBooking; now: number; fmtT: (iso: string) => string; vi: boolean; staff: StaffOpt[];
  onOpen: (b: ListBooking) => void; onAction: Act; onCtx: (b: ListBooking, x: number, y: number) => void;
}) {
  const k = listKey(b, now);
  const past = k === 'completed' || k === 'noshow' || k === 'cancelled';
  const late = lateMinutes(b, now);
  return (
    <div role="button" tabIndex={0} onClick={() => onOpen(b)} onContextMenu={(e) => { e.preventDefault(); onCtx(b, e.clientX, e.clientY); }}
      style={{ display: 'flex', gap: 10, padding: '11px 14px', borderBottom: `1px solid ${C.line}`, cursor: 'pointer', background: k === 'late' ? 'var(--wash-amber)' : 'transparent', opacity: k === 'noshow' || k === 'cancelled' ? 0.62 : 1 }}>
      <div style={{ width: 62, flexShrink: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: past ? C.muted : C.ink, whiteSpace: 'nowrap' }}>{fmtT(b.startTime)}</span>
        <span style={{ fontSize: 11, color: C.muted }}>{late !== null && k === 'late' ? (vi ? `trễ ${late}′` : `${late}m late`) : fmtDur(durationMin(b))}</span>
      </div>
      <span style={{ width: 4, borderRadius: 3, background: ST[k].bar, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 600, color: past ? C.muted : C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: k === 'cancelled' ? 'line-through' : 'none' }}>{clientName(b)}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: past ? C.muted : C.ink }}>{formatPrice(b.priceCents, b.currency)}</span>
        </div>
        <span style={{ fontSize: 12.5, color: C.sub, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{svcText(b, vi)}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 1, flexWrap: 'wrap' }}>
          <span style={{ flexShrink: 0, display: 'inline-flex' }}><SrcPill b={b} vi={vi} /></span>
          {b.assignedStaff
            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.body }}><Avatar id={b.assignedStaff.id} name={b.assignedStaff.firstName} size={18} />{b.assignedStaff.firstName}</span>
            : isOpen(b.status) ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Avatar id={null} name="?" size={18} /><AssignPick b={b} staff={staff} onAction={onAction} vi={vi} compact /></span>
              : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.muted }}><Avatar id={null} name="?" size={18} />{ind(vi ? 'Chưa có thợ' : 'Unassigned')}</span>}
          <span style={{ flex: 1 }} />
          {k === 'pending' || k === 'arrived' ? <Actions b={b} k={k} vi={vi} onAction={onAction} phone /> : <StatusChip k={k} vi={vi} small />}
        </div>
        {k === 'late' && <div style={{ display: 'flex', gap: 8, marginTop: 8 }}><Actions b={b} k={k} vi={vi} onAction={onAction} phone /></div>}
      </div>
    </div>
  );
}

function NowLine({ label, pad = 16 }: { label: string; pad?: number }) {
  return (
    <div aria-label={label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: `0 ${pad}px`, height: 22, background: 'var(--wash-red)' }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-bad)', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ flex: 1, height: 2, background: '#ef4444', borderRadius: 2 }} />
    </div>
  );
}

// ── the rail ──────────────────────────────────────────────────────────────

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 13.5, fontWeight: 700, color: C.ink }}>{title}</h3>
        {action && <span style={{ marginLeft: 'auto' }}>{action}</span>}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div style={{ background: C.soft, borderRadius: 11, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 11.5, color: C.muted, fontWeight: 500 }}>{label}</span>
      <span style={{ fontSize: 20, fontWeight: 700, color: tone ?? C.ink, letterSpacing: -0.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
      {sub && <span style={{ fontSize: 11, color: C.muted }}>{sub}</span>}
    </div>
  );
}

const linkBtn: CSSProperties = { border: 0, background: 'transparent', padding: 0, color: C.indigoText, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' };

export interface ListViewProps {
  /** Every booking of the day (search applied, filters not): the numbers. */
  all: ListBooking[];
  /** What the filters let through: the list. */
  rows: ListBooking[];
  /** This month's bookings, for the "Booking sources · Month" switch. */
  monthRows: ListBooking[];
  date: Date; today: Date; now: number; tz?: string; vi: boolean;
  isMobile: boolean; wide: boolean;
  staff: ShiftStaffFull[];
  f: CalFilters; setF: (f: CalFilters) => void; counts: FacetCounts;
  fmtT: (iso: string) => string;
  onOpen: (b: ListBooking) => void; onAction: Act; onCtx: (b: ListBooking, x: number, y: number) => void;
  onAutoAssign: () => void; onStaffView: () => void; newHref: string; searching: boolean;
}

export function ListView(p: ListViewProps) {
  const { all, rows, date, today, now, tz, vi, isMobile, wide, staff, f, setF, counts, fmtT, onOpen, onAction, onCtx } = p;
  const L = (a: string, b: string) => ind(vi ? a : b);
  const [showCancelled, setShowCancelled] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);
  const [srcScope, setSrcScope] = useState<'day' | 'month'>('day');
  const isToday = date.getTime() === today.getTime();
  const sum = useMemo(() => summarize(all, now), [all, now]);
  const cur = all.find((b) => b.currency)?.currency ?? 'USD';
  const money = (c: number) => formatPrice(c, cur).replace(/[.,]00(?=\D*$)/, '');
  const bookable: ShiftStaffFull[] = staff.filter((s) => s.isActive !== false && s.takesAppointments !== false);

  const wantCancelled = showCancelled || f.statuses.includes('cancelled');
  const hiddenCancelled = wantCancelled ? 0 : rows.filter((b) => b.status === 'CANCELLED').length;
  const live = useMemo(() => (wantCancelled ? all : all.filter((b) => b.status !== 'CANCELLED')), [all, wantCancelled]);
  const tabCounts = useMemo(() => facetCounts(live, f, now), [live, f, now]);
  const shown = useMemo(() => [...rows].filter((b) => wantCancelled || b.status !== 'CANCELLED').sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime)), [rows, wantCancelled]);

  // Phone, today: the visits that are over fold into one line.
  const earlier = isMobile && isToday && !activeFilterCount(f)
    ? shown.filter((b) => (b.status === 'COMPLETED' || b.status === 'NO_SHOW' || b.status === 'CANCELLED') && new Date(b.endTime).getTime() <= now)
    : [];
  const earlierIds = new Set(earlier.map((b) => b.id));
  const listed = showEarlier ? shown : shown.filter((b) => !earlierIds.has(b.id));
  const nowLabel = `${vi ? 'Bây giờ' : 'Now'} · ${new Date(now).toLocaleTimeString(vi ? 'vi-VN' : 'en-US', { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) })}`;
  const nowIdx = isToday ? listed.findIndex((b) => new Date(b.startTime).getTime() >= now) : -2;

  const periods = [L('Buổi sáng', 'Morning'), L('Buổi chiều', 'Afternoon'), L('Buổi tối', 'Evening')];
  const ranges = [L('trước 12h', 'before 12 PM'), L('12h – 17h', '12 – 5 PM'), L('sau 17h', 'after 5 PM')];
  const groups: { p: number; items: ListBooking[] }[] = [0, 1, 2].map((pi) => ({ p: pi, items: listed.filter((b) => periodOf(minuteOf(b.startTime, tz)) === pi) }));

  const RowC = isMobile ? PhoneRow : Row;
  let flat = 0;
  const list = (
    <div>
      {earlier.length > 0 && (
        <button type="button" onClick={() => setShowEarlier((v) => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', border: 0, borderBottom: `1px solid ${C.line}`, background: C.soft, color: C.sub, fontFamily: 'inherit', fontSize: 12.5, cursor: 'pointer', textAlign: 'left' }}>
          <Icon name="check" size={15} color="#8b5cf6" />
          <span style={{ flex: 1, minWidth: 0 }}>
            <b style={{ color: C.ink2 }}>{L('Đã qua hôm nay', 'Earlier today')}</b>
            {' · '}{earlier.filter((b) => b.status === 'COMPLETED').length} {L('xong', 'done')}
            {sum.doneCents > 0 && <> · {money(sum.doneCents)}</>}
            {sum.noShow > 0 && <> · {sum.noShow} {L('không đến', 'no-show')}</>}
          </span>
          <span style={{ color: C.indigoText, fontWeight: 600 }}>{showEarlier ? L('Ẩn', 'Hide') : L('Xem', 'Show')}</span>
        </button>
      )}
      {groups.map((g) => {
        if (!g.items.length) return null;
        const done = g.items.filter((b) => b.status === 'COMPLETED');
        return (
          <div key={g.p}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '8px 14px' : '9px 16px', background: C.soft, borderBottom: `1px solid ${C.line}`, position: 'sticky', top: 0, zIndex: 2 }}>
              <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.7, color: C.sub, textTransform: 'uppercase' }}>{periods[g.p]}</span>
              <span style={{ fontSize: 12, color: C.muted }}>{g.items.length} · {ranges[g.p]}</span>
              {done.length > 0 && <span style={{ marginLeft: 'auto', fontSize: 12, color: C.muted }}>{done.length} {L('xong', 'done')} · {money(done.reduce((s, b) => s + b.priceCents, 0))}</span>}
            </div>
            {g.items.map((b) => {
              const i = flat++;
              return (
                <div key={b.id}>
                  {i === nowIdx && <NowLine label={nowLabel} pad={isMobile ? 14 : 16} />}
                  <RowC b={b} now={now} tz={tz} fmtT={fmtT} vi={vi} staff={bookable} onOpen={onOpen} onAction={onAction} onCtx={onCtx} narrow={!wide} />
                </div>
              );
            })}
          </div>
        );
      })}
      {isToday && nowIdx === -1 && listed.length > 0 && <NowLine label={nowLabel} pad={isMobile ? 14 : 16} />}
    </div>
  );

  const empty = shown.length === 0 && (
    <div style={{ padding: '40px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      {activeFilterCount(f) || p.searching ? (
        <>
          <span style={{ fontSize: 14, color: C.sub }}>{L('Không có lịch khớp bộ lọc.', 'No bookings match these filters.')}</span>
          {activeFilterCount(f) > 0 && <button type="button" onClick={() => setF({ sources: [], staff: [], statuses: [], preset: null })} style={btn(false)}>{L('Bỏ lọc', 'Clear filters')}</button>}
        </>
      ) : (
        <>
          <span style={{ fontSize: 14, color: C.sub }}>{L('Ngày này chưa có lịch hẹn.', 'No appointments on this day.')}</span>
          {date.getTime() >= today.getTime() && <a href={p.newHref} style={btn(true)}><Icon name="plus" size={16} />{L('Đặt lịch', 'New booking')}</a>}
        </>
      )}
    </div>
  );

  const header = (
    <>
      {!isMobile && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: `1px solid ${C.line}`, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{shown.filter((b) => b.status !== 'CANCELLED').length} {L('lịch hẹn', shown.length === 1 ? 'appointment' : 'appointments')}</span>
          {hiddenCancelled > 0 && <span style={{ fontSize: 13, color: C.muted }}>· {hiddenCancelled} {L('lịch huỷ đang ẩn', 'cancelled hidden')}</span>}
          {(sum.cancelled > 0 || showCancelled) && (
            <button type="button" aria-pressed={showCancelled} onClick={() => setShowCancelled((v) => !v)}
              style={{ marginLeft: 'auto', height: 28, padding: '0 10px', borderRadius: 999, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', ...(showCancelled ? { background: C.indigoSoft, border: `1px solid ${C.indigoLine}`, color: C.indigoText } : { background: 'transparent', border: `1px solid ${C.border}`, color: C.sub }) }}>
              {showCancelled ? L('Ẩn lịch huỷ', 'Hide cancelled') : L('Xem lịch huỷ', 'Show cancelled')}
            </button>
          )}
        </div>
      )}
      <SourceTabs f={f} set={setF} counts={tabCounts} total={live.length} vi={vi} scroll={isMobile} label={!isMobile} pad={isMobile ? '10px 14px' : '10px 16px'} />
      <ActiveChips f={f} set={setF} staff={staff} vi={vi} pad={isMobile ? '8px 14px' : '10px 16px'} />
      {isMobile && hiddenCancelled > 0 && (
        <button type="button" onClick={() => setShowCancelled(true)} style={{ width: '100%', border: 0, borderBottom: `1px solid ${C.line}`, background: 'transparent', padding: '8px 14px', textAlign: 'left', fontFamily: 'inherit', fontSize: 12.5, color: C.muted, cursor: 'pointer' }}>
          {hiddenCancelled} {L('lịch huỷ đang ẩn', 'cancelled hidden')} · <span style={{ color: C.indigoText, fontWeight: 600 }}>{L('Xem', 'Show')}</span>
        </button>
      )}
      {activeFilterCount(f) > 0 && (
        <div style={{ padding: isMobile ? '8px 14px' : '8px 16px', fontSize: 12.5, color: C.sub, borderBottom: `1px solid ${C.line}` }}>
          {shown.length} / {live.length} {L('lịch', 'bookings')} · <b style={{ color: 'var(--ink-good)' }}>{money(shown.filter((b) => !isGone(b.status)).reduce((s, b) => s + b.priceCents, 0))}</b>
        </div>
      )}
    </>
  );

  const panel = (
    <div style={{ background: C.panel, border: isMobile ? 0 : `1px solid ${C.line}`, borderTop: `1px solid ${C.line}`, borderRadius: isMobile ? 0 : 14, overflow: 'hidden', margin: isMobile ? '0 -16px' : 0 }}>
      <style>{`.cal-row{transition:background .12s ease}.cal-row:hover{background:var(--c273449) !important}`}</style>
      {header}
      {empty || list}
    </div>
  );

  // ── attention, shared by the rail and the banner ──
  const att = all.map((b) => ({ b, a: attentionOf(b, now) })).filter((x) => x.a);
  const lateItems = att.filter((x) => x.a === 'late');
  const pendItems = att.filter((x) => x.a === 'pending');
  const unItems = att.filter((x) => x.a === 'unassigned');

  if (isMobile) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.sub, margin: '0 0 10px' }}>
          <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <b style={{ color: C.ink }}>{sum.appointments} {L('lịch', 'appts')}</b>
            {sum.expectedCents > 0 && <> · <b style={{ color: 'var(--ink-good)' }}>{money(sum.expectedCents)}</b> {L('dự kiến', 'expected')}</>}
          </span>
          {sum.attention.total > 0 && (
            <button type="button" aria-pressed={f.preset === 'attention'} onClick={() => setF({ ...f, preset: f.preset === 'attention' ? null : 'attention' })}
              style={{ height: 28, padding: '0 10px', borderRadius: 999, border: 0, background: 'var(--wash-amber-3)', color: 'var(--cfed7aa)', fontFamily: 'inherit', fontWeight: 600, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              {sum.attention.total} {L('cần xử lý', 'need you')}
            </button>
          )}
        </div>
        {panel}
      </div>
    );
  }

  const tiles = (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
      {[
        [L('Lịch hẹn', 'Appointments'), String(sum.appointments), C.ink],
        [L('Dự kiến', 'Expected'), money(sum.expectedCents), 'var(--ink-good)'],
        [L('Đã check-in', 'Checked in'), String(sum.checkedIn), 'var(--ink-good)'],
        [L('Cần xử lý', 'Needs attention'), String(sum.attention.total), sum.attention.total ? 'var(--cfed7aa)' : C.ink],
      ].map(([l, v, c]) => (
        <div key={l} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: '9px 12px' }}>
          <span style={{ display: 'block', fontSize: 11.5, color: C.muted }}>{l}</span>
          <span style={{ display: 'block', fontSize: 19, fontWeight: 700, color: c }}>{v}</span>
        </div>
      ))}
    </div>
  );

  const banner = sum.attention.total > 0 && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--wash-amber)', border: '1px solid var(--c7c5c22)', borderRadius: 12, padding: '9px 12px', fontSize: 13, color: 'var(--ccbd5e1)' }}>
      <Icon name="clock" size={16} color="var(--cfed7aa)" />
      <span style={{ flex: 1, minWidth: 0 }}>
        {[
          lateItems.length ? (lateItems.length === 1 ? L(`${clientName(lateItems[0].b)} trễ ${lateMinutes(lateItems[0].b, now)} phút`, `${clientName(lateItems[0].b)} is ${lateMinutes(lateItems[0].b, now)} min late`) : L(`${lateItems.length} khách chưa đến`, `${lateItems.length} not arrived`)) : '',
          pendItems.length ? (pendItems.length === 1 ? L(`${clientName(pendItems[0].b)} chờ xác nhận`, `${clientName(pendItems[0].b)} to confirm`) : L(`${pendItems.length} lịch chờ xác nhận`, `${pendItems.length} to confirm`)) : '',
          unItems.length ? L(`${unItems.length} lịch chưa có thợ`, `${unItems.length} without a technician`) : '',
        ].filter(Boolean).join(' · ')}
      </span>
      <button type="button" style={linkBtn} onClick={() => setF({ ...f, preset: 'attention' })}>{L('Xem', 'Review')}</button>
    </div>
  );

  if (!wide) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {tiles}
        {banner}
        {panel}
      </div>
    );
  }

  // ── the rail ──
  const dateLabel = date.toLocaleDateString(vi ? 'vi-VN' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const attentionList = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {sum.attention.total === 0 && <span style={{ fontSize: 13, color: C.muted }}>{L('Không có gì đang chờ. Mọi thứ ổn.', 'Nothing waiting — all good.')}</span>}
      {[...lateItems, ...pendItems].slice(0, 5).map(({ b, a }) => (
        <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: a === 'late' ? '#f97316' : '#f59e0b', flexShrink: 0 }} />
          <button type="button" onClick={() => onOpen(b)} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.35, border: 0, background: 'transparent', padding: 0, textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.ink2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
              {a === 'late' ? L(`${clientName(b)} trễ ${lateMinutes(b, now)} phút`, `${clientName(b)} is ${lateMinutes(b, now)} min late`) : L(`${clientName(b)} chờ xác nhận`, `${clientName(b)} to confirm`)}
            </span>
            <span style={{ fontSize: 12, color: C.muted }}>{fmtT(b.startTime)}{b.assignedStaff ? ` · ${b.assignedStaff.firstName}` : ''}</span>
          </button>
          {a === 'late'
            ? <button type="button" style={linkBtn} onClick={() => onAction(b.id, 'arrive')}>Check in</button>
            : <button type="button" style={linkBtn} onClick={() => onAction(b.id, 'status', { status: 'CONFIRMED' })}>{L('Xác nhận', 'Confirm')}</button>}
        </div>
      ))}
      {unItems.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--ink-warn)', flexShrink: 0 }} />
          <button type="button" onClick={() => setF({ ...f, preset: 'unassigned' })} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', lineHeight: 1.35, border: 0, background: 'transparent', padding: 0, textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: C.ink2 }}>{L(`${unItems.length} lịch chưa có thợ`, `${unItems.length} booking${unItems.length === 1 ? '' : 's'} with no technician`)}</span>
            <span style={{ fontSize: 12, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>{unItems.map((x) => clientName(x.b)).join(' · ')}</span>
          </button>
          <button type="button" style={linkBtn} onClick={p.onAutoAssign}>{L('Tự giao', 'Auto-assign')}</button>
        </div>
      )}
      {lateItems.length + pendItems.length > 5 && <button type="button" style={{ ...linkBtn, alignSelf: 'flex-start' }} onClick={() => setF({ ...f, preset: 'attention' })}>{L(`Xem tất cả ${sum.attention.total}`, `See all ${sum.attention.total}`)}</button>}
    </div>
  );

  const srcRows = (srcScope === 'day' ? all : p.monthRows).filter((b) => b.status !== 'CANCELLED');
  const srcList = sourceCounts(srcRows);
  const srcTotal = srcRows.length || 1;
  const sources = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {srcList.length === 0 && <span style={{ fontSize: 13, color: C.muted }}>{L('Chưa có lịch.', 'No bookings yet.')}</span>}
      {srcList.map(({ meta, count }) => {
        const pct = Math.round((count / srcTotal) * 100);
        const on = f.sources.length === 1 && f.sources[0] === meta.key;
        return (
          <button key={meta.key} type="button" onClick={() => setF({ ...f, sources: on ? [] : [meta.key] })} aria-pressed={on}
            style={{ display: 'flex', alignItems: 'center', gap: 10, border: 0, background: on ? C.indigoSoft : 'transparent', borderRadius: 8, padding: '3px 4px', margin: '-3px -4px', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ width: 26, height: 26, borderRadius: '50%', background: `${meta.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: meta.color }} /></span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ display: 'flex', fontSize: 12.5 }}><span style={{ fontWeight: 600, color: C.ink2 }}>{vi ? meta.labelVi : meta.labelEn}</span><span style={{ marginLeft: 'auto', color: C.muted }}>{count} · {pct}%</span></span>
              <span style={{ display: 'block', height: 6, borderRadius: 3, background: C.chip, overflow: 'hidden' }}><span style={{ display: 'block', width: `${pct}%`, height: '100%', background: meta.color, borderRadius: 3 }} /></span>
            </span>
          </button>
        );
      })}
    </div>
  );
  const scopeSwitch = (
    <span style={{ display: 'inline-flex', background: C.chip, borderRadius: 8, padding: 2 }}>
      {(['day', 'month'] as const).map((k) => (
        <button key={k} type="button" aria-pressed={srcScope === k} onClick={() => setSrcScope(k)}
          style={{ border: 0, borderRadius: 6, padding: '3px 9px', fontFamily: 'inherit', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', background: srcScope === k ? C.panel : 'transparent', color: srcScope === k ? C.ink : C.sub }}>
          {k === 'day' ? L('Ngày', 'Day') : L('Tháng', 'Month')}
        </button>
      ))}
    </span>
  );

  const dow = date.getDay();
  const staffRows = bookable.map((s) => {
    const mine = all.filter((b) => b.assignedStaff?.id === s.id);
    const booked = bookedMinutes(mine);
    const shift = shiftMinutes(s, dow);
    const parts = (s.workingHours ?? []).filter((w) => w.isActive && w.dayOfWeek === dow).sort((a, b) => hhmm(a.startTime) - hhmm(b.startTime));
    const clock = (m: number) => new Date(2000, 0, 1, Math.floor(m / 60), m % 60).toLocaleTimeString(vi ? 'vi-VN' : 'en-US', { hour: 'numeric', minute: m % 60 ? '2-digit' : undefined });
    const range = parts.length ? `${clock(hhmm(parts[0].startTime))} – ${clock(hhmm(parts[parts.length - 1].endTime))}` : '';
    return { s, booked, shift, range, n: mine.filter((b) => !isGone(b.status)).length };
  });
  const staffCard = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {staffRows.length === 0 && <span style={{ fontSize: 13, color: C.muted }}>{L('Chưa có thợ nhận lịch.', 'No technicians take bookings yet.')}</span>}
      {staffRows.map(({ s, booked, shift, range }) => {
        const off = shift === 0;
        const p01 = shift ? Math.min(1, booked / shift) : 0;
        return (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: off ? 0.6 : 1 }}>
            <Avatar id={s.id} name={s.name} size={26} />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', fontSize: 12.5, gap: 6 }}>
                <span style={{ fontWeight: 600, color: C.ink2 }}>{s.name}</span>
                <span style={{ marginLeft: 'auto', color: C.muted, whiteSpace: 'nowrap' }}>{off ? L('Nghỉ hôm nay', 'Off today') : `${fmtDur(booked) || '0m'} ${L('đã đặt', 'booked')}`}</span>
              </div>
              {!off && <span style={{ display: 'block', height: 6, borderRadius: 3, background: C.chip, overflow: 'hidden' }}><span style={{ display: 'block', width: `${Math.round(p01 * 100)}%`, height: '100%', background: p01 < 0.6 ? '#10b981' : p01 < 0.9 ? '#f59e0b' : '#ef4444', borderRadius: 3 }} /></span>}
              {!off && <span style={{ fontSize: 11, color: C.muted }}>{range || L('Chưa đặt giờ làm', 'No hours set')}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>{panel}</div>
      <aside style={{ width: 296, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12, position: 'sticky', top: 12 }}>
        <Card title={`${dateLabel} · ${L('tổng quan', 'at a glance')}`}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Kpi label={L('Lịch hẹn', 'Appointments')} value={String(sum.appointments)} />
            <Kpi label={L('Dự kiến', 'Expected')} value={money(sum.expectedCents)} tone="var(--ink-good)" />
            <Kpi label={L('Đã check-in', 'Checked in')} value={String(sum.checkedIn)} tone="var(--ink-good)" sub={sum.checkedIn ? L(`${sum.checkedIn} đang làm`, `${sum.checkedIn} in the chair`) : undefined} />
            <Kpi label={L('Không đến', 'No-show')} value={String(sum.noShow)} tone={sum.noShow ? 'var(--ink-bad)' : undefined} />
          </div>
        </Card>
        <Card title={`${L('Cần xử lý', 'Needs attention')} · ${sum.attention.total}`}>{attentionList}</Card>
        <Card title={L('Nguồn booking', 'Booking sources')} action={scopeSwitch}>{sources}</Card>
        <Card title={ind(L('Thợ hôm nay', 'Staff today'))} action={<button type="button" style={linkBtn} onClick={p.onStaffView}>{L('Xem theo thợ →', 'Staff view →')}</button>}>{staffCard}</Card>
      </aside>
    </div>
  );
}

export { onIndigo };
