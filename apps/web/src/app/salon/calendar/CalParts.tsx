'use client';

/**
 * The shared pieces of the redesigned calendar (the approved "Lịch hẹn —
 * thiết kế lại" mockup): the date bar with its strip of days, the month
 * picker, the Filters panel, the active-filter chips, the source tabs, the
 * status chip and the popover / bottom-sheet shells.
 *
 * Colours are the theme's variables, so every piece reads in light and dark;
 * the only fixed hues are the status and brand colours, which mean the same
 * thing in both themes.
 */
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { SOURCE_META, SOURCE_ORDER, type SourceKey } from '../../../lib/booking-sources';
import { SourceChip } from '../../../components/SourceChip';
import {
  activeFilterCount, addDays, LIST_KEYS, loadLevel, monthGrid, nextMonday, NO_FILTERS, toggle,
  type CalFilters, type FacetCounts, type ListKey, type Preset,
} from '../../../lib/cal-day';
import { ind } from '../../../lib/ui-industry';

export const C = {
  panel: 'var(--c0f172a)',
  soft: 'var(--c0b1322)',
  chip: 'var(--c1e293b)',
  line: 'var(--line)',
  border: 'var(--c334155)',
  ink: 'var(--cf1f5f9)',
  ink2: 'var(--ce2e8f0)',
  body: 'var(--ccbd5e1)',
  sub: 'var(--c94a3b8)',
  muted: 'var(--c64748b)',
  indigo: '#4f46e5',
  indigoText: 'var(--c818cf8)',
  indigoSoft: 'var(--c1e1b4b)',
  indigoLine: 'var(--c3730a3)',
};

/** White on the brand indigo — one line, so the theme lint sees the pair. */
export const onIndigo: CSSProperties = { background: '#4f46e5', color: '#fff' };

export const ST: Record<ListKey, { bar: string; text: string; vi: string; en: string }> = {
  pending: { bar: '#f59e0b', text: 'var(--ink-warn)', vi: 'Chờ xác nhận', en: 'Pending' },
  confirmed: { bar: '#3b82f6', text: 'var(--c93c5fd)', vi: 'Đã xác nhận', en: 'Confirmed' },
  late: { bar: '#f97316', text: 'var(--cfed7aa)', vi: 'Chưa đến', en: 'Not arrived' },
  arrived: { bar: '#10b981', text: 'var(--c6ee7b7)', vi: 'Đã check-in', en: 'Checked in' },
  completed: { bar: '#8b5cf6', text: '#8b5cf6', vi: 'Hoàn tất', en: 'Completed' },
  noshow: { bar: '#ef4444', text: 'var(--ink-bad)', vi: 'Không đến', en: 'No-show' },
  cancelled: { bar: '#94a3b8', text: 'var(--c64748b)', vi: 'Đã huỷ', en: 'Cancelled' },
};

export const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#f43f5e'];
export function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

const PATHS: Record<string, ReactNode> = {
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  shrink: <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  left: <path d="m15 18-6-6 6-6" />,
  right: <path d="m9 18 6-6-6-6" />,
  down: <path d="m6 9 6 6 6-6" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
};
export function Icon({ name, size = 16, color = 'currentColor', sw = 2 }: { name: keyof typeof PATHS | string; size?: number; color?: string; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, display: 'block' }}>
      {PATHS[name]}
    </svg>
  );
}

export function StatusChip({ k, vi, small }: { k: ListKey; vi: boolean; small?: boolean }) {
  const m = ST[k];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: small ? '2px 8px' : '3px 9px', borderRadius: 999, background: `${m.bar}1f`, color: m.text, fontSize: small ? 11 : 11.5, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: m.bar }} />{vi ? m.vi : m.en}
    </span>
  );
}

export function Avatar({ id, name, size = 24 }: { id: string | null; name: string; size?: number }) {
  if (!id) {
    return (
      <span aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', border: '1.5px dashed var(--ink-warn)', color: 'var(--ink-warn)', fontSize: Math.round(size * 0.46), fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxSizing: 'border-box' }}>?</span>
    );
  }
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', background: avatarColor(id), color: '#fff', fontSize: Math.round(size * 0.46), fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export const btn = (primary = false, h = 36): CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, height: h, padding: '0 14px', borderRadius: 10,
  fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', boxSizing: 'border-box', flexShrink: 0, cursor: 'pointer', textDecoration: 'none',
  ...(primary ? { ...onIndigo, border: '1px solid #4f46e5' } : { background: C.panel, color: C.ink2, border: `1px solid ${C.border}` }),
});

export function IconBtn({ name, label, onClick, size = 36, badge, active }: { name: string; label: string; onClick?: () => void; size?: number; badge?: number; active?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      style={{ position: 'relative', width: size, height: size, padding: 0, borderRadius: 10, background: active ? C.indigoSoft : C.panel, border: `1px solid ${active ? C.indigoLine : C.border}`, color: active ? C.indigoText : C.sub, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer', boxSizing: 'border-box' }}>
      <Icon name={name} size={17} />
      {!!badge && <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 17, height: 17, padding: '0 4px', boxSizing: 'border-box', borderRadius: 999, ...onIndigo, fontSize: 10.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{badge}</span>}
    </button>
  );
}

export function Seg<T extends string>({ items, value, onChange, full, h = 36 }: { items: { key: T; label: string }[]; value: T; onChange: (v: T) => void; full?: boolean; h?: number }) {
  return (
    <div role="tablist" style={{ display: full ? 'flex' : 'inline-flex', background: C.chip, border: `1px solid ${C.line}`, borderRadius: 11, padding: 3, gap: 2, flexShrink: 0 }}>
      {items.map((it) => {
        const on = it.key === value;
        return (
          <button key={it.key} type="button" role="tab" aria-selected={on} onClick={() => onChange(it.key)}
            style={{ flex: full ? 1 : undefined, height: h - 8, padding: '0 14px', border: 0, borderRadius: 8, fontFamily: 'inherit', fontSize: 13.5, fontWeight: on ? 600 : 500, whiteSpace: 'nowrap', cursor: 'pointer',
              background: on ? C.panel : 'transparent', color: on ? C.ink : C.sub, boxShadow: on ? '0 1px 2px rgba(16,31,54,.14)' : 'none' }}>
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

// ── shells ────────────────────────────────────────────────────────────────

/** Anchored panel under its trigger; closes on outside click and Escape. */
export function Popover({ open, onClose, children, align = 'left', width }: { open: boolean; onClose: () => void; children: ReactNode; align?: 'left' | 'right'; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-pop-trigger]')) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} role="dialog" style={{ position: 'absolute', top: 'calc(100% + 8px)', [align]: 0, zIndex: 50, width, maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box', background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 16, boxShadow: '0 24px 48px -16px rgba(0,0,0,.35)' }}>
      {children}
    </div>
  );
}

/** Phone bottom sheet, above the tab bar. */
export function Sheet({ open, onClose, title, sub, children, footer, tall }: { open: boolean; onClose: () => void; title: string; sub?: string; children: ReactNode; footer?: ReactNode; tall?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 70 }} />
      <div role="dialog" aria-label={title} style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 71, background: C.panel, borderRadius: '22px 22px 0 0', display: 'flex', flexDirection: 'column', maxHeight: tall ? 'calc(100dvh - 48px)' : '88dvh', height: tall ? 'calc(100dvh - 48px)' : undefined, boxShadow: '0 -18px 40px -20px rgba(0,0,0,.45)' }}>
        <div style={{ padding: '10px 16px 8px', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
          <span style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, background: C.border }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{title}</span>
            {sub && <span style={{ fontSize: 12.5, color: C.muted }}>{sub}</span>}
            <button type="button" onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', width: 40, height: 40, border: 0, background: 'transparent', color: C.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="x" size={22} /></button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '0 16px 16px' }}>{children}</div>
        {footer && <div style={{ padding: '12px 16px', paddingBottom: 'calc(14px + env(safe-area-inset-bottom, 0px))', borderTop: `1px solid ${C.line}`, flexShrink: 0 }}>{footer}</div>}
      </div>
    </>
  );
}

// ── the date bar ──────────────────────────────────────────────────────────

export interface DayInfo { count: number; load: number | null; closed: boolean }
const LOAD_COLOR = { light: '#10b981', busy: '#f59e0b', full: '#ef4444' } as const;

function LoadBar({ info, on, h = 4 }: { info: DayInfo; on?: boolean; h?: number }) {
  if (info.closed) return <span style={{ display: 'block', width: '100%', height: h, borderRadius: 3, background: 'repeating-linear-gradient(135deg, var(--c334155) 0 3px, transparent 3px 6px)' }} />;
  const p = info.load ?? 0;
  return (
    <span style={{ display: 'block', width: '100%', height: h, borderRadius: 3, background: on ? 'rgba(255,255,255,.35)' : C.chip, overflow: 'hidden' }}>
      <span style={{ display: 'block', width: `${Math.round(p * 100)}%`, height: '100%', borderRadius: 3, background: on ? '#fff' : LOAD_COLOR[loadLevel(p)] }} />
    </span>
  );
}

const DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_VI = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** One day of the strip. `solid` = the phone's filled selection. */
function DayCell({ d, info, selected, isToday, vi, onPick, compact, solid, short }: { d: Date; info: DayInfo; selected: boolean; isToday: boolean; vi: boolean; onPick: (d: Date) => void; compact?: boolean; solid?: boolean; short?: boolean }) {
  const filled = selected && solid;
  const tone = info.closed ? C.muted : C.ink;
  return (
    <button type="button" onClick={() => onPick(d)} aria-pressed={selected}
      aria-label={`${d.toDateString()}${info.closed ? (vi ? ', nghỉ' : ', closed') : `, ${info.count}`}`}
      style={{ position: 'relative', flex: 1, minWidth: 0, boxSizing: 'border-box', border: 0, borderRadius: 11, padding: compact ? '6px 2px 7px' : '7px 4px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: compact ? 4 : 5, cursor: 'pointer', fontFamily: 'inherit',
        ...(filled ? onIndigo : { background: selected ? C.indigoSoft : 'transparent', boxShadow: selected ? `inset 0 0 0 1.5px ${C.indigo}` : 'none' }) }}>
      {isToday && !filled && <span style={{ position: 'absolute', top: 3, right: 3, width: 5, height: 5, borderRadius: '50%', background: C.indigo }} />}
      <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase', color: filled ? 'inherit' : selected ? C.indigoText : C.muted }}>{(vi ? DOW_VI : DOW_EN)[d.getDay()]}</span>
      <span style={{ fontSize: compact ? 16 : 16, fontWeight: 700, lineHeight: 1, color: filled ? 'inherit' : selected ? C.indigoText : tone }}>{d.getDate()}</span>
      {!compact && (
        <span style={{ fontSize: 10, fontWeight: 600, color: selected ? C.indigoText : C.muted, whiteSpace: 'nowrap' }}>
          {info.closed ? (vi ? 'Nghỉ' : 'Closed') : short ? info.count : `${info.count} ${vi ? 'lịch' : info.count === 1 ? 'appt' : 'appts'}`}
        </span>
      )}
      <span style={{ width: compact ? '60%' : '70%' }}><LoadBar info={info} on={filled} /></span>
    </button>
  );
}

export function DayStrip({ days, selected, today, info, vi, onPick, compact, solid, short }: { days: Date[]; selected: Date; today: Date; info: (d: Date) => DayInfo; vi: boolean; onPick: (d: Date) => void; compact?: boolean; solid?: boolean; short?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: compact ? 2 : 3, flex: 1, minWidth: 0, alignItems: 'stretch' }}>
      {days.map((d, i) => (
        <div key={d.toDateString()} style={{ display: 'contents' }}>
          {i > 0 && d.getDay() === 1 && <span aria-hidden="true" style={{ width: 1, alignSelf: 'stretch', margin: '6px 2px', background: C.line, flexShrink: 0 }} />}
          <DayCell d={d} info={info(d)} selected={d.getTime() === selected.getTime()} isToday={d.getTime() === today.getTime()} vi={vi} onPick={onPick} compact={compact} solid={solid} short={short} />
        </div>
      ))}
    </div>
  );
}

/** The month as a grid with each day's load, plus quick jumps. */
export function MonthPicker({ month, selected, today, info, vi, onPick, onMonth }: { month: Date; selected: Date; today: Date; info: (d: Date) => DayInfo; vi: boolean; onPick: (d: Date) => void; onMonth: (delta: number) => void }) {
  const cells = monthGrid(month);
  const label = month.toLocaleDateString(vi ? 'vi-VN' : 'en-US', { month: 'long', year: 'numeric' });
  const quick: [string, Date][] = [
    [vi ? 'Hôm nay' : 'Today', today],
    [vi ? 'Ngày mai' : 'Tomorrow', addDays(today, 1)],
    [vi ? 'Thứ 2 tới' : 'Next Mon', nextMonday(today)],
    [vi ? '+1 tuần' : '+1 week', addDays(selected, 7)],
    [vi ? '+2 tuần' : '+2 weeks', addDays(selected, 14)],
  ];
  const dows = vi ? ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.ink, textTransform: 'capitalize' }}>{label}</span>
        <span style={{ flex: 1 }} />
        <IconBtn name="left" label={vi ? 'Tháng trước' : 'Previous month'} size={32} onClick={() => onMonth(-1)} />
        <IconBtn name="right" label={vi ? 'Tháng sau' : 'Next month'} size={32} onClick={() => onMonth(1)} />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {quick.map(([l, d]) => (
          <button key={l} type="button" onClick={() => onPick(d)} style={{ height: 30, padding: '0 11px', borderRadius: 999, border: `1px solid ${C.border}`, background: C.panel, color: C.body, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}>{l}</button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 2 }}>
        {dows.map((x, i) => <span key={i} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: C.muted, paddingBottom: 4 }}>{x}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} />;
          const inf = info(d);
          const on = d.getTime() === selected.getTime();
          const past = d.getTime() < today.getTime();
          const isT = d.getTime() === today.getTime();
          return (
            <button key={d.toDateString()} type="button" onClick={() => onPick(d)} aria-pressed={on}
              style={{ height: 42, border: 0, borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: 0,
                ...(on ? onIndigo : { background: 'transparent', boxShadow: isT ? `inset 0 0 0 1.5px ${C.indigo}` : 'none' }) }}>
              <span style={{ fontSize: 13.5, fontWeight: on || isT ? 700 : 500, color: on ? 'inherit' : inf.closed ? C.muted : past ? C.muted : C.ink, textDecoration: inf.closed ? 'line-through' : 'none' }}>{d.getDate()}</span>
              <span style={{ width: 18, height: 3, borderRadius: 2, opacity: past && !on ? 0.5 : 1, background: on ? 'rgba(255,255,255,.9)' : inf.closed || inf.load === null || inf.count === 0 ? 'transparent' : LOAD_COLOR[loadLevel(inf.load)] }} />
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 11.5, color: C.muted, alignItems: 'center', flexWrap: 'wrap' }}>
        {(['light', 'busy', 'full'] as const).map((k) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 14, height: 3, borderRadius: 2, background: LOAD_COLOR[k] }} />
            {k === 'light' ? (vi ? 'Vắng' : 'Light') : k === 'busy' ? (vi ? 'Đông' : 'Busy') : (vi ? 'Kín' : 'Full')}
          </span>
        ))}
        <span style={{ marginLeft: 'auto' }}>{vi ? 'Gạch ngang = ngày nghỉ' : 'Struck = closed'}</span>
      </div>
    </div>
  );
}

// ── filters ───────────────────────────────────────────────────────────────

export interface StaffOpt { id: string; name: string }

const PRESET_LABEL: Record<Preset, [string, string, string]> = {
  attention: ['Cần xử lý', 'Needs attention', 'var(--cfed7aa)'],
  unassigned: ['Chưa có thợ', 'Unassigned', 'var(--ink-warn)'],
  online: ['Đặt online', 'Online bookings', 'var(--c818cf8)'],
  upcoming: ['Sắp tới', 'Still to come', 'var(--c93c5fd)'],
};
export const presetLabel = (p: Preset, vi: boolean) => ind(vi ? PRESET_LABEL[p][0] : PRESET_LABEL[p][1]);

function CheckRow({ lead, label, count, on, onClick }: { lead: ReactNode; label: string; count: number; on: boolean; onClick: () => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 40, padding: '0 10px', borderRadius: 10, border: 0, cursor: 'pointer', fontFamily: 'inherit', width: '100%', textAlign: 'left', background: on ? C.indigoSoft : 'transparent', opacity: count === 0 && !on ? 0.55 : 1 }}>
      <span style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', ...(on ? { ...onIndigo, border: '1.5px solid #4f46e5' } : { border: `1.5px solid ${C.border}` }) }}>
        {on && <Icon name="check" size={13} sw={3} />}
      </span>
      {lead}
      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: on ? 600 : 500, color: C.ink2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      <span style={{ fontSize: 12.5, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
    </button>
  );
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 10px 6px' }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.6, color: C.sub, textTransform: 'uppercase' }}>{title}</span>
        {note && <span style={{ marginLeft: 'auto', fontSize: 11.5, color: C.muted }}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

const dot = (c: string) => <span style={{ width: 9, height: 9, borderRadius: '50%', background: c, flexShrink: 0 }} />;
function srcGlyph(k: SourceKey) {
  const m = SOURCE_META[k];
  return <span style={{ width: 22, height: 22, borderRadius: '50%', background: `${m.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: m.color }} /></span>;
}

export function PresetChips({ f, set, counts, vi }: { f: CalFilters; set: (f: CalFilters) => void; counts: FacetCounts; vi: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {(['attention', 'unassigned', 'online', 'upcoming'] as Preset[]).map((p) => {
        const on = f.preset === p;
        return (
          <button key={p} type="button" aria-pressed={on} onClick={() => set({ ...f, preset: on ? null : p })}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', borderRadius: 999, fontFamily: 'inherit', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap',
              ...(on ? { ...onIndigo, border: '1px solid #4f46e5' } : { background: C.panel, color: C.ink2, border: `1px solid ${C.border}` }) }}>
            {presetLabel(p, vi)}
            <span style={{ color: on ? 'inherit' : PRESET_LABEL[p][2], fontWeight: 700 }}>{counts.presets[p]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The whole Filters body: presets, what is on, then Source · Technician · Status. */
export function FilterBody({ f, set, counts, staff, vi, columns }: { f: CalFilters; set: (f: CalFilters) => void; counts: FacetCounts; staff: StaffOpt[]; vi: boolean; columns: boolean }) {
  const L = (a: string, b: string) => ind(vi ? a : b);
  const srcKeys = SOURCE_ORDER.filter((k) => (counts.sources[k] ?? 0) > 0 || f.sources.includes(k));
  const source = (
    <Group title={L('Nguồn', 'Source')}>
      {srcKeys.length === 0 && <span style={{ fontSize: 12.5, color: C.muted, padding: '4px 10px' }}>{L('Chưa có lịch nào', 'No bookings yet')}</span>}
      {srcKeys.map((k) => <CheckRow key={k} lead={srcGlyph(k)} label={vi ? SOURCE_META[k].labelVi : SOURCE_META[k].labelEn} count={counts.sources[k] ?? 0} on={f.sources.includes(k)} onClick={() => set({ ...f, sources: toggle(f.sources, k) })} />)}
    </Group>
  );
  const tech = (
    <Group title={L('Thợ', 'Technician')}>
      <CheckRow lead={<Avatar id={null} name="?" size={22} />} label={L('Chưa có thợ', 'Unassigned')} count={counts.staff.__un ?? 0} on={f.staff.includes('__un')} onClick={() => set({ ...f, staff: toggle(f.staff, '__un') })} />
      {staff.map((s) => <CheckRow key={s.id} lead={<Avatar id={s.id} name={s.name} size={22} />} label={s.name} count={counts.staff[s.id] ?? 0} on={f.staff.includes(s.id)} onClick={() => set({ ...f, staff: toggle(f.staff, s.id) })} />)}
    </Group>
  );
  const groups: [string, ListKey[]][] = [[L('Sắp tới', 'Coming up'), ['pending', 'confirmed', 'late']], [L('Trong tiệm', 'In the salon'), ['arrived']], [L('Đã xong', 'Finished'), ['completed', 'noshow', 'cancelled']]];
  const status = (
    <Group title={L('Trạng thái', 'Status')}>
      {groups.map(([g, keys]) => (
        <div key={g} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 11, color: C.muted, padding: '4px 10px 2px' }}>{g}</span>
          {keys.map((k) => <CheckRow key={k} lead={dot(ST[k].bar)} label={vi ? ST[k].vi : ST[k].en} count={counts.statuses[k] ?? 0} on={f.statuses.includes(k)} onClick={() => set({ ...f, statuses: toggle(f.statuses, k) })} />)}
        </div>
      ))}
    </Group>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PresetChips f={f} set={set} counts={counts} vi={vi} />
      {columns ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14, borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>{source}{tech}{status}</div>
      ) : (
        <>{source}{tech}{status}</>
      )}
    </div>
  );
}

export function FilterFooter({ f, set, result, vi, onDone }: { f: CalFilters; set: (f: CalFilters) => void; result: number; vi: boolean; onDone: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button type="button" onClick={() => set(NO_FILTERS)} disabled={!activeFilterCount(f)} style={{ ...btn(false, 42), flex: 1, opacity: activeFilterCount(f) ? 1 : 0.5 }}>{vi ? 'Bỏ lọc' : 'Clear all'}</button>
      <button type="button" onClick={onDone} style={{ ...btn(true, 42), flex: 1.6 }}>{vi ? `Xem ${result} lịch` : `Show ${result} booking${result === 1 ? '' : 's'}`}</button>
    </div>
  );
}

/** What is filtered, as chips with ✕ — shown on top of the list and in the panel. */
export function ActiveChips({ f, set, staff, vi, pad = '10px 16px', rounded }: { f: CalFilters; set: (f: CalFilters) => void; staff: StaffOpt[]; vi: boolean; pad?: string; rounded?: boolean }) {
  if (!activeFilterCount(f)) return null;
  const chips: { key: string; label: ReactNode; drop: () => void }[] = [];
  if (f.preset) chips.push({ key: 'p', label: presetLabel(f.preset, vi), drop: () => set({ ...f, preset: null }) });
  for (const k of f.sources) chips.push({ key: `s${k}`, label: <><span style={{ width: 8, height: 8, borderRadius: '50%', background: SOURCE_META[k].color }} />{vi ? SOURCE_META[k].labelVi : SOURCE_META[k].labelEn}</>, drop: () => set({ ...f, sources: f.sources.filter((x) => x !== k) }) });
  for (const id of f.staff) chips.push({ key: `t${id}`, label: id === '__un' ? ind(vi ? 'Chưa có thợ' : 'Unassigned') : staff.find((s) => s.id === id)?.name ?? '—', drop: () => set({ ...f, staff: f.staff.filter((x) => x !== id) }) });
  for (const k of f.statuses) chips.push({ key: `k${k}`, label: vi ? ST[k].vi : ST[k].en, drop: () => set({ ...f, statuses: f.statuses.filter((x) => x !== k) }) });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: pad, background: C.indigoSoft, borderBottom: rounded ? 0 : `1px solid ${C.indigoLine}`, borderRadius: rounded ? 10 : 0 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: C.indigoText, marginRight: 2 }}>{vi ? 'Đang lọc:' : 'Filtered:'}</span>
      {chips.map((c) => (
        <button key={c.key} type="button" onClick={c.drop} aria-label={`${vi ? 'Bỏ' : 'Remove'}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 6px 0 9px', borderRadius: 999, background: C.panel, border: `1px solid ${C.indigoLine}`, color: C.ink2, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          {c.label}<Icon name="x" size={14} color="var(--c64748b)" />
        </button>
      ))}
      <button type="button" onClick={() => set(NO_FILTERS)} style={{ marginLeft: 'auto', border: 0, background: 'transparent', color: C.indigoText, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>{vi ? 'Bỏ lọc' : 'Clear all'}</button>
    </div>
  );
}

/** "Source: All 11 · Lumio link 5 · Google Maps 3 …" — one tap filters to that source. */
export function SourceTabs({ f, set, counts, total, vi, scroll, label = true, pad = '10px 16px' }: { f: CalFilters; set: (f: CalFilters) => void; counts: FacetCounts; total: number; vi: boolean; scroll?: boolean; label?: boolean; pad?: string }) {
  const keys = SOURCE_ORDER.filter((k) => (counts.sources[k] ?? 0) > 0 || f.sources.includes(k));
  if (!keys.length) return null;
  const tab = (on: boolean): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 11px 0 9px', borderRadius: 999, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0, cursor: 'pointer',
    ...(on ? { background: C.ink, color: C.panel, border: `1px solid ${C.ink}` } : { background: C.panel, color: C.body, border: `1px solid ${C.border}` }),
  });
  const all = f.sources.length === 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: pad, borderBottom: `1px solid ${C.line}`, ...(scroll ? { overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' } : { flexWrap: 'wrap' }) } as CSSProperties}>
      {label && <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: C.muted, textTransform: 'uppercase', marginRight: 2, flexShrink: 0 }}>{vi ? 'Nguồn' : 'Source'}</span>}
      <button type="button" aria-pressed={all} onClick={() => set({ ...f, sources: [] })} style={tab(all)}>{vi ? 'Tất cả' : 'All'} <span style={{ opacity: 0.7 }}>{total}</span></button>
      {keys.map((k) => {
        const on = f.sources.length === 1 && f.sources[0] === k;
        const m = SOURCE_META[k];
        return (
          <button key={k} type="button" aria-pressed={on} onClick={() => set({ ...f, sources: on ? [] : [k] })} style={tab(on)}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.color }} />
            {vi ? m.labelVi : m.labelEn} <span style={{ opacity: 0.65 }}>{counts.sources[k] ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Icon + label pill for one booking's source (the shared SourceChip). */
export function SrcPill({ b, vi }: { b: { source?: string | null; utmSource?: string | null; attrReferrer?: string | null; attrLandingUrl?: string | null }; vi: boolean }) {
  return <SourceChip b={b} vi={vi} />;
}

export const ALL_LIST_KEYS = LIST_KEYS;
