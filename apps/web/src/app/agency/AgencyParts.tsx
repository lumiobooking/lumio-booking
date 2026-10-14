'use client';

// ---------------------------------------------------------------------------
// The pieces of the agency list that are not the list itself: icons, the
// filter bar and its drop-downs (computer, tablet), the filter page (phone),
// and the salon's detail panel — a drawer on a computer, a sheet on a phone.
// ---------------------------------------------------------------------------

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GroupKey, AgencyFilters, FacetCounts } from '../../lib/agency-filters';
import { groupSummary } from '../../lib/agency-filters';
import {
  addDays, addMonthsDay, fmtDay, renewState, termPhrase, termProgress, termStatus, whoShort, DEFAULT_ALERT_DAYS,
  type ServiceTerm, type TermState,
} from '../../lib/agency-term';
import { noticeSummary, ago as agoShort, type RowNotice } from '../../components/TeamBell';
import {
  ago, channelCells, MARKET_LOOK, marketOf, NEXT_LOOK, NEXT_ORDER, STAGE_LOOK, STAGE_ORDER, TIER_DOT,
  type Board, type OpsStage, type ServicePackage, type TenantRow, type WorkNext,
} from './agency-model';

/** Theme tokens: every one flips with light mode. */
export const C = {
  bg: 'var(--c0b1120)', panel: 'var(--c111827)', soft: 'var(--c0f172a)', raised: 'var(--c1e293b)',
  line: 'var(--c1f2937)', border: 'var(--c334155)',
  ink: 'var(--cf1f5f9)', ink2: 'var(--ce2e8f0)', body: 'var(--ccbd5e1)', sub: 'var(--c94a3b8)', muted: 'var(--c64748b)',
  link: 'var(--ink-link)', bad: 'var(--ink-bad)', warn: 'var(--ink-warn)', good: 'var(--ink-good)',
  indigo: '#6366f1', indigoSoft: 'rgba(99,102,241,.14)', indigoLine: 'rgba(99,102,241,.55)',
};

/** What each term state looks like — the only colour on a quiet row. */
export const TERM_LOOK: Record<TermState, { ink: string; bar: string; wash: string; edge: string; icon: IconName }> = {
  expired: { ink: C.bad, bar: '#ef4444', wash: 'var(--wash-red)', edge: 'rgba(239,68,68,.45)', icon: 'alert' },
  soon: { ink: C.warn, bar: '#f59e0b', wash: 'var(--wash-amber-3)', edge: 'rgba(245,158,11,.45)', icon: 'hourglass' },
  ok: { ink: C.sub, bar: 'transparent', wash: 'transparent', edge: C.line, icon: 'check' },
  none: { ink: C.muted, bar: 'transparent', wash: 'transparent', edge: C.line, icon: 'cal' },
};

// ---- icons ------------------------------------------------------------------

const PATHS = {
  alert: 'M12 4l9 16H3z M12 10v4 M12 17h.01',
  hourglass: 'M7 3h10 M7 21h10 M8 3c0 5 8 5 8 9s-8 4-8 9 M16 3c0 5-8 5-8 9',
  check: 'M5 12.5l4.5 4.5L19 7',
  cal: 'M4 6h16v14H4z M4 10h16 M9 3v4 M15 3v4',
  filter: 'M4 5h16l-6 8v5l-4 2v-7z',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14z M20 20l-4-4',
  x: 'M6 6l12 12 M18 6L6 18',
  down: 'M6 9l6 6 6-6',
  dots: 'M5 12h.01 M12 12h.01 M19 12h.01',
  sort: 'M7 4v16 M4 17l3 3 3-3 M17 20V4 M14 7l3-3 3 3',
  enter: 'M10 17l5-5-5-5 M15 12H3 M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5',
  send: 'M4 12l16-8-6 16-2.5-6.5z',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
  undo: 'M9 14l-4-4 4-4 M5 10h9a5 5 0 0 1 0 10h-3',
  checksq: 'M4 4h16v16H4z M8 12l3 3 5-6',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7',
};
export type IconName = keyof typeof PATHS;
export function Icon({ name, size = 16, color = 'currentColor', sw = 2 }: { name: IconName; size?: number; color?: string; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={name === 'dots' ? 3.4 : sw}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0, display: 'block' }}>
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Dot({ color, size = 7 }: { color: string; size?: number }) {
  return <span aria-hidden style={{ width: size, height: size, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />;
}

export function MarketChip({ code }: { code: string }) {
  const look = MARKET_LOOK[code] ?? MARKET_LOOK.US;
  return (
    <span title={`Thị trường: ${look.name}`} style={{
      flexShrink: 0, fontSize: 10, fontWeight: 700, letterSpacing: 0.4, lineHeight: 1,
      padding: '3px 5px', borderRadius: 5, color: look.fg, background: look.bg, border: `1px solid ${look.border}`,
    }}>{code}</span>
  );
}

function Check({ on, size = 18 }: { on: boolean; size?: number }) {
  return on ? (
    <span aria-hidden style={{ width: size, height: size, borderRadius: 5, background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Icon name="check" size={size - 5} color="#ffffff" sw={3} />
    </span>
  ) : (
    <span aria-hidden style={{ width: size, height: size, borderRadius: 5, border: `1.5px solid ${C.border}`, boxSizing: 'border-box', flexShrink: 0 }} />
  );
}

export function IconTile({ name, color, size = 28 }: { name: IconName; color: string; size?: number }) {
  return (
    <span aria-hidden style={{ width: size, height: size, borderRadius: 8, background: 'rgba(148,163,184,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Icon name={name} size={Math.round(size * 0.54)} color={color} />
    </span>
  );
}

// ---- term text ---------------------------------------------------------------

/** "Hết hạn 3 ngày" / "Còn 5 ngày" / "Đến 14/01/2027" — the only coloured words on a row. */
export function TermText({ term, today, size = 12.5, icon = true }: { term: ServiceTerm | null | undefined; today: string; size?: number; icon?: boolean }) {
  const st = termStatus(term, today);
  const look = TERM_LOOK[st.state];
  const loud = st.state === 'expired' || st.state === 'soon';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: look.ink, fontWeight: loud ? 700 : 500, fontSize: size, whiteSpace: 'nowrap' }}>
      {icon && loud && <Icon name={look.icon} size={13} color={look.ink} />}
      {st.state === 'none' ? '—' : termPhrase(st, today)}
    </span>
  );
}

/**
 * The renewal action beside a row: "Báo gia hạn →" while nobody has passed it
 * on, "✓ Đã báo · lan" after. Nothing for a term that is fine.
 */
export function RenewAction({ term, today, onTell, size = 12 }: { term: ServiceTerm | null | undefined; today: string; onTell: () => void; size?: number }) {
  const st = termStatus(term, today).state;
  const rs = renewState(term);
  if (rs === 'told') {
    return (
      <span title={term?.renew?.note ? `Ghi chú: ${term.renew.note}` : 'Đã báo bộ phận gia hạn'}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: C.link, fontSize: size, whiteSpace: 'nowrap' }}>
        <Icon name="check" size={12} color={C.link} sw={2.6} />Đã báo · {whoShort(term?.renew?.by)}
      </span>
    );
  }
  if (st !== 'expired' && st !== 'soon') return null;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onTell(); }}
      title="Đánh dấu đã báo bộ phận gia hạn — ghi lại ai báo và lúc nào"
      style={{ border: 0, background: 'transparent', padding: '6px 0', color: C.warn, fontFamily: 'inherit', fontSize: size, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
      Báo gia hạn →
    </button>
  );
}

// ---- channel strip -------------------------------------------------------------

const TONE: Record<string, { fg: string; bg: string; bd: string }> = {
  on: { fg: C.good, bg: 'rgba(34,197,94,.14)', bd: 'rgba(34,197,94,.5)' },
  off: { fg: C.muted, bg: 'transparent', bd: C.border },
  warn: { fg: C.warn, bg: 'rgba(245,158,11,.14)', bd: 'rgba(245,158,11,.7)' },
  bad: { fg: C.bad, bg: 'rgba(239,68,68,.14)', bd: 'rgba(239,68,68,.7)' },
};

/** Five small squares and a count — same width on every row, so a column of rows reads like a table. */
export function ChannelSquares({ t, size = 18 }: { t: TenantRow; size?: number }) {
  const ch = channelCells(t);
  if (!ch) return <span style={{ color: C.muted, fontSize: 12 }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} title={ch.worry ?? undefined}>
      {ch.cells.map((x) => {
        const tone = TONE[x.tone];
        const title = x.tone === 'off' ? `${x.label}: chưa kết nối`
          : x.tone === 'bad' ? `${x.label}: ${x.v ?? ''} — TIỆM KHÁC CŨNG ĐANG DÙNG tài khoản này`
          : x.tone === 'warn' ? `${x.label}: ${x.v} — tên không giống tên tiệm, kiểm tra xem có nối nhầm không`
          : `${x.label}: ${x.v}${x.extra ? ` · ${x.extra}` : ''}`;
        return (
          <span key={x.k} title={title} aria-label={title} style={{
            width: size, height: size - 2, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 5,
            border: `1px solid ${tone.bd}`, background: tone.bg, color: tone.fg, fontSize: 9.5, fontWeight: 800,
            opacity: x.tone === 'off' ? 0.55 : 1, flexShrink: 0,
          }}>{x.icon}</span>
        );
      })}
      <span style={{ fontSize: 11.5, fontWeight: 600, color: ch.n === 5 ? C.good : C.sub, marginLeft: 3, whiteSpace: 'nowrap' }}>{ch.n}/5</span>
    </span>
  );
}

/** Phone: the strip as words — "3/5 kênh", amber/red when something needs a look. */
export function ChannelWords({ t }: { t: TenantRow }) {
  const ch = channelCells(t);
  if (!ch) return null;
  const bad = ch.cells.some((x) => x.tone === 'bad');
  return (
    <span style={{ color: ch.worry ? (bad ? C.bad : C.warn) : C.sub, whiteSpace: 'nowrap' }} title={ch.worry ?? undefined}>
      {ch.worry ? '⚠ ' : ''}{ch.n}/5 kênh
    </span>
  );
}

// ---- filters -------------------------------------------------------------------

export interface FilterOption { value: string; label: string; sub?: string; lead?: React.ReactNode; icon?: IconName; tint?: string }
export interface FilterGroupDef { key: GroupKey; label: string; title: string; kind: 'tiles' | 'toggles' | 'list'; options: FilterOption[]; foot?: React.ReactNode }

function summaryOf(g: FilterGroupDef, f: AgencyFilters): string {
  return groupSummary(f[g.key], (v) => g.options.find((o) => o.value === v)?.label ?? v);
}

/**
 * One filter group as one button: "Thời hạn ▾" when unused, purple and
 * "Thời hạn: Hết hạn, Sắp hết hạn ×" when in use. The × drops just that group.
 */
export function FilterButton({ label, summary, open, onClick, onClear, h = 36, btnRef }: {
  label: string; summary: string; open?: boolean; onClick: () => void; onClear: () => void; h?: number;
  btnRef?: (el: HTMLButtonElement | null) => void;
}) {
  const active = Boolean(summary);
  return (
    <button ref={btnRef} type="button" onClick={onClick} aria-expanded={open}
      style={{
        height: h, padding: active ? '0 6px 0 12px' : '0 10px 0 12px', borderRadius: 10, flexShrink: 0,
        background: active ? C.indigoSoft : open ? C.raised : 'transparent',
        border: `1px solid ${open ? '#6366f1' : active ? C.indigoLine : C.border}`,
        fontFamily: 'inherit', fontSize: 13.5, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap',
      }}>
      {active ? (
        <>
          <span style={{ color: C.link, fontWeight: 500 }}>{label}:</span>
          <span style={{ color: C.ink, fontWeight: 700 }}>{summary}</span>
          <span role="button" tabIndex={0} aria-label={`Bỏ lọc ${label}`}
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onClear(); } }}
            style={{ width: 22, height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(129,140,248,.18)' }}>
            <Icon name="x" size={12} color={C.link} sw={2.6} />
          </span>
        </>
      ) : (
        <>
          <span style={{ color: C.ink2, fontWeight: 600 }}>{label}</span>
          <Icon name="down" size={15} color={C.sub} />
        </>
      )}
    </button>
  );
}

function OptionRow({ o, on, n, onClick }: { o: FilterOption; on: boolean; n: number; onClick: () => void }) {
  const dim = !on && n === 0;
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44, padding: '6px 8px', borderRadius: 10,
        border: 0, background: on ? 'rgba(99,102,241,.10)' : 'transparent', opacity: dim ? 0.42 : 1,
        fontFamily: 'inherit', fontSize: 13.5, cursor: 'pointer', textAlign: 'left',
      }}>
      <Check on={on} />
      {o.icon ? <IconTile name={o.icon} color={o.tint ?? C.sub} /> : o.lead}
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ color: on ? C.ink : C.ink2, fontWeight: on ? 700 : 500 }}>{o.label}</span>
        {o.sub && <span style={{ fontSize: 11.5, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.sub}</span>}
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: on ? C.link : C.muted, fontVariantNumeric: 'tabular-nums' }}>{n}</span>
    </button>
  );
}

/** A drop-down pinned under its button. Fixed-positioned, so a sideways-scrolling bar cannot clip it. */
function Popover({ anchor, width, onClose, children }: { anchor: HTMLElement | null; width: number; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos({ top: r.bottom + 8, left });
  }, [anchor, width]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const el = e.target as Node;
      if (ref.current?.contains(el) || anchor?.contains(el)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const away = () => onClose();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', away);
    window.addEventListener('scroll', away, true);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', away);
      window.removeEventListener('scroll', away, true);
    };
  }, [anchor, onClose]);
  if (!pos) return null;
  return (
    <div ref={ref} role="dialog" style={{
      position: 'fixed', top: pos.top, left: pos.left, width, zIndex: 60, maxHeight: `calc(100dvh - ${pos.top + 16}px)`,
      display: 'flex', flexDirection: 'column', background: C.panel, border: `1px solid ${C.border}`, borderRadius: 14,
      boxShadow: '0 24px 48px -12px rgba(0,0,0,.55)', overflow: 'hidden',
    }}>{children}</div>
  );
}

/** Computer and tablet: one button per group, each opening its own list. */
export function FilterBar({ groups, filters, counts, onToggle, onClear, h = 36 }: {
  groups: FilterGroupDef[]; filters: AgencyFilters; counts: FacetCounts;
  onToggle: (g: GroupKey, v: string) => void; onClear: (g: GroupKey) => void; h?: number;
}) {
  const [open, setOpen] = useState<GroupKey | null>(null);
  const btns = useRef<Partial<Record<GroupKey, HTMLButtonElement | null>>>({});
  const g = groups.find((x) => x.key === open) ?? null;
  return (
    <>
      {groups.map((x) => (
        <FilterButton key={x.key} label={x.label} summary={summaryOf(x, filters)} open={open === x.key} h={h}
          btnRef={(el) => { btns.current[x.key] = el; }}
          onClick={() => setOpen((o) => (o === x.key ? null : x.key))}
          onClear={() => onClear(x.key)} />
      ))}
      {g && (
        <Popover anchor={btns.current[g.key] ?? null} width={g.key === 'term' ? 340 : 320} onClose={() => setOpen(null)}>
          <div style={{ padding: '12px 14px 6px', fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5, color: C.sub, textTransform: 'uppercase' }}>{g.title}</div>
          <div style={{ padding: '0 6px 6px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {g.options.map((o) => (
              <OptionRow key={o.value} o={o} on={filters[g.key].includes(o.value)} n={counts[g.key][o.value] ?? 0} onClick={() => onToggle(g.key, o.value)} />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderTop: `1px solid ${C.line}`, background: C.soft }}>
            <span style={{ flex: 1, fontSize: 12, color: C.muted }}>{g.foot ?? 'Mục mờ = không có tiệm nào khớp'}</span>
            {filters[g.key].length > 0 && (
              <button type="button" onClick={() => onClear(g.key)} style={{ border: 0, background: 'transparent', color: C.sub, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Xoá</button>
            )}
            <button type="button" onClick={() => setOpen(null)} style={{ border: 0, background: 'transparent', color: C.link, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Xong</button>
          </div>
        </Popover>
      )}
    </>
  );
}

/** Phone: the groups in use, as the same purple buttons, under the search. Tap = open the filter page. */
export function ActiveChips({ groups, filters, onOpen, onClear }: {
  groups: FilterGroupDef[]; filters: AgencyFilters; onOpen: () => void; onClear: (g: GroupKey) => void;
}) {
  const used = groups.filter((g) => filters[g.key].length);
  if (!used.length) return null;
  return (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 2 }}>
      {used.map((g) => (
        <FilterButton key={g.key} label={g.label} h={36}
          summary={groupSummary(filters[g.key], (v) => g.options.find((o) => o.value === v)?.label ?? v, 1)}
          onClick={onOpen} onClear={() => onClear(g.key)} />
      ))}
    </div>
  );
}

function Tile({ o, on, n, onClick }: { o: FilterOption; on: boolean; n: number; onClick: () => void }) {
  const dim = !on && n === 0;
  return (
    <button type="button" onClick={onClick} aria-pressed={on} style={{
      textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 14, cursor: 'pointer', fontFamily: 'inherit',
      background: on ? 'rgba(99,102,241,.12)' : C.soft, border: `${on ? 1.5 : 1}px solid ${on ? '#6366f1' : C.border}`, opacity: dim ? 0.42 : 1,
    }}>
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {o.icon ? <IconTile name={o.icon} color={o.tint ?? C.sub} size={30} /> : o.lead}
        {on ? (
          <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#6366f1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={12} color="#ffffff" sw={3} />
          </span>
        ) : <span style={{ fontSize: 18, fontWeight: 800, color: C.sub }}>{n}</span>}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: on ? C.ink : C.ink2 }}>
          {o.label}{on && <span style={{ color: C.link, fontWeight: 600 }}> · {n}</span>}
        </span>
        {o.sub && <span style={{ fontSize: 12, color: C.muted }}>{o.sub}</span>}
      </span>
    </button>
  );
}

function Toggle({ o, on, n, onClick }: { o: FilterOption; on: boolean; n: number; onClick: () => void }) {
  const dim = !on && n === 0;
  return (
    <button type="button" onClick={onClick} aria-pressed={on} style={{
      flex: '1 1 calc(33.3% - 8px)', minWidth: 96, minHeight: 44, padding: '0 10px', borderRadius: 12, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap',
      background: on ? 'rgba(99,102,241,.12)' : 'transparent', border: `${on ? 1.5 : 1}px solid ${on ? '#6366f1' : C.border}`,
      color: on ? C.ink : C.ink2, fontWeight: on ? 700 : 500, opacity: dim ? 0.42 : 1,
    }}>
      {on && <Icon name="check" size={14} color={C.link} sw={3} />}
      {o.lead}{o.label}
      <span style={{ color: on ? C.link : C.muted, fontWeight: 600, fontSize: 12.5 }}>{n}</span>
    </button>
  );
}

/**
 * Phone: the whole filter as one page. Each group uses the control that suits
 * it — big coloured tiles for the term (the same colours as the list), on/off
 * buttons for short groups, a ticked list for the long ones. Changes apply as
 * they are made; the button at the bottom says how many salons that leaves.
 */
export function FilterSheet({ groups, filters, counts, result, onToggle, onClearAll, onClose }: {
  groups: FilterGroupDef[]; filters: AgencyFilters; counts: FacetCounts; result: number;
  onToggle: (g: GroupKey, v: string) => void; onClearAll: () => void; onClose: () => void;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div role="dialog" aria-label="Bộ lọc" style={{ position: 'fixed', inset: 0, zIndex: 80, background: C.panel, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', height: 56, padding: '0 8px', borderBottom: `1px solid ${C.line}`, paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <button type="button" aria-label="Đóng" onClick={onClose} style={{ width: 44, height: 44, border: 0, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
          <Icon name="x" size={22} color={C.body} />
        </button>
        <span style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: 700, color: C.ink }}>Bộ lọc</span>
        <button type="button" onClick={onClearAll} style={{ height: 44, padding: '0 10px', border: 0, background: 'transparent', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: C.link, cursor: 'pointer' }}>Xoá hết</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 24px' }}>
        {groups.map((g, i) => {
          const sum = summaryOf(g, filters);
          return (
            <section key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 0 18px', borderTop: i ? `1px solid ${C.line}` : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{g.label}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12.5, color: sum ? C.link : C.muted, fontWeight: sum ? 600 : 400, textAlign: 'right' }}>{sum || 'Tất cả'}</span>
              </div>
              {g.kind === 'tiles' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {g.options.map((o) => <Tile key={o.value} o={o} on={filters[g.key].includes(o.value)} n={counts[g.key][o.value] ?? 0} onClick={() => onToggle(g.key, o.value)} />)}
                </div>
              )}
              {g.kind === 'toggles' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {g.options.map((o) => <Toggle key={o.value} o={o} on={filters[g.key].includes(o.value)} n={counts[g.key][o.value] ?? 0} onClick={() => onToggle(g.key, o.value)} />)}
                </div>
              )}
              {g.kind === 'list' && (
                <div style={{ display: 'flex', flexDirection: 'column', margin: '0 -8px' }}>
                  {g.options.map((o) => <OptionRow key={o.value} o={o} on={filters[g.key].includes(o.value)} n={counts[g.key][o.value] ?? 0} onClick={() => onToggle(g.key, o.value)} />)}
                </div>
              )}
              {g.foot && <span style={{ fontSize: 12, color: C.muted }}>{g.foot}</span>}
            </section>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '12px 16px', paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))', borderTop: `1px solid ${C.line}`, background: C.panel }}>
        <button type="button" onClick={onClearAll} style={{ flex: '0 0 110px', height: 46, borderRadius: 12, border: `1px solid ${C.border}`, background: 'transparent', color: C.ink2, fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, cursor: 'pointer' }}>Xoá hết</button>
        <button type="button" onClick={onClose} style={{ flex: 1, height: 46, borderRadius: 12, border: 0, background: '#6366f1', color: '#ffffff', fontFamily: 'inherit', fontSize: 14.5, fontWeight: 700, cursor: 'pointer' }}>Xem {result} tiệm</button>
      </div>
    </div>
  );
}

// ---- the detail panel ------------------------------------------------------------

const label: React.CSSProperties = { fontSize: 11.5, fontWeight: 700, letterSpacing: 0.6, color: C.sub, textTransform: 'uppercase' };
function field(phone: boolean): React.CSSProperties {
  return {
    width: '100%', boxSizing: 'border-box', height: 42, borderRadius: 10, border: `1px solid ${C.border}`, background: C.soft,
    color: C.ink2, padding: '0 10px', fontFamily: 'inherit', fontSize: phone ? 16 : 14, fontWeight: 600,
  };
}
function ghostBtn(extra: React.CSSProperties = {}): React.CSSProperties {
  return {
    height: 40, padding: '0 12px', borderRadius: 10, border: `1px solid ${C.border}`, background: 'transparent', color: C.ink2, whiteSpace: 'nowrap',
    fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, ...extra,
  };
}

function Step({ done, title, sub, color, last }: { done: boolean; title: string; sub: string; color: string; last?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {done ? (
          <span style={{ width: 20, height: 20, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="check" size={12} color="#ffffff" sw={3} />
          </span>
        ) : <span style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${C.border}`, boxSizing: 'border-box', flexShrink: 0 }} />}
        {!last && <span style={{ flex: 1, width: 2, minHeight: 12, background: C.line }} />}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: last ? 0 : 10, minWidth: 0 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: done ? C.ink2 : C.sub }}>{title}</span>
        <span style={{ fontSize: 12, color: C.muted, overflowWrap: 'anywhere' }}>{sub}</span>
      </div>
    </div>
  );
}

const MONTH_CHOICES = [1, 3, 6, 12];

function MonthChips({ value, onPick }: { value: number | null; onPick: (m: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {MONTH_CHOICES.map((m) => {
        const on = value === m;
        return (
          <button key={m} type="button" onClick={() => onPick(m)} aria-pressed={on} style={{
            height: 36, padding: '0 14px', borderRadius: 10, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 600, cursor: 'pointer',
            background: on ? C.indigoSoft : 'transparent', color: on ? C.link : C.body, border: `1px solid ${on ? '#6366f1' : C.border}`,
          }}>{m} tháng</button>
        );
      })}
    </div>
  );
}

/** Set or change the term: a start, a length (or an end typed by hand), and how early to warn. */
function TermEditor({ term, today, phone, onSave, onCancel, onClear }: {
  term: ServiceTerm | null | undefined; today: string; phone: boolean;
  onSave: (b: { start: string | null; end: string; months: number | null; alertDays: number }) => Promise<void>;
  onCancel: () => void; onClear?: () => Promise<void>;
}) {
  const [start, setStart] = useState<string>(term?.start ?? today);
  const [months, setMonths] = useState<number | null>(term ? term.months : 3);
  const [end, setEnd] = useState<string>(term?.end ?? addMonthsDay(today, 3));
  const [alert, setAlert] = useState<number>(term?.alertDays ?? DEFAULT_ALERT_DAYS);
  const [saving, setSaving] = useState(false);
  const pickMonths = (m: number) => { setMonths(m); if (start) setEnd(addMonthsDay(start, m)); };
  const pickStart = (s: string) => { setStart(s); if (s && months) setEnd(addMonthsDay(s, months)); };
  const bad = !end || (Boolean(start) && end < start);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
          <span style={{ fontSize: 12, color: C.muted }}>Bắt đầu</span>
          <input type="date" value={start} onChange={(e) => pickStart(e.target.value)} style={field(phone)} />
        </label>
        <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
          <span style={{ fontSize: 12, color: C.muted }}>Kết thúc</span>
          <input type="date" value={end} onChange={(e) => { setEnd(e.target.value); setMonths(null); }} style={field(phone)} />
        </label>
      </div>
      <MonthChips value={months} onPick={pickMonths} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: C.body }}>
        Báo trước khi hết hạn
        <select value={alert} onChange={(e) => setAlert(Number(e.target.value))} style={{ ...field(phone), width: 'auto', height: 36 }}>
          {[7, 14, 21, 30].map((d) => <option key={d} value={d}>{d} ngày</option>)}
        </select>
      </label>
      <span style={{ fontSize: 12, color: C.muted }}>Chọn số tháng thì ngày kết thúc tự tính. Thời hạn chỉ để theo dõi — không khoá tiệm.</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" disabled={bad || saving}
          onClick={async () => { setSaving(true); try { await onSave({ start: start || null, end, months, alertDays: alert }); } finally { setSaving(false); } }}
          style={{ ...ghostBtn({ border: 0, background: '#6366f1', color: '#ffffff', opacity: bad || saving ? 0.5 : 1 }), flex: 1 }}>
          {saving ? 'Đang lưu…' : 'Lưu thời hạn'}
        </button>
        <button type="button" onClick={onCancel} style={ghostBtn()}>Huỷ</button>
        {onClear && (
          <button type="button" onClick={async () => { if (window.confirm('Xoá thời hạn của tiệm này?')) await onClear(); }}
            style={ghostBtn({ color: C.bad })}>Xoá</button>
        )}
      </div>
    </div>
  );
}

function TermBlock({ t, today, phone, onTerm, onRenewal }: {
  t: TenantRow; today: string; phone: boolean;
  onTerm: (t: TenantRow, body: Record<string, unknown>) => Promise<void>;
  onRenewal: (t: TenantRow, body: Record<string, unknown>) => Promise<void>;
}) {
  const term = t.serviceTerm ?? null;
  const st = termStatus(term, today);
  const rs = renewState(term);
  const [mode, setMode] = useState<'view' | 'edit' | 'renew'>('view');
  const [note, setNote] = useState('');
  const [months, setMonths] = useState<number>(term?.months ?? 3);
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); setMode('view'); setNote(''); } finally { setBusy(false); } };

  if (!term || mode === 'edit') {
    return (
      <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={label}>Thời hạn dịch vụ</span>
        {!term && mode !== 'edit' ? (
          <button type="button" onClick={() => setMode('edit')} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, border: `1px dashed ${C.border}`,
            background: 'transparent', color: C.sub, fontFamily: 'inherit', fontSize: 13.5, cursor: 'pointer', textAlign: 'left',
          }}>
            <Icon name="cal" size={18} color={C.sub} />
            <span style={{ flex: 1 }}>Chưa có thời hạn. <b style={{ color: C.link }}>Ghi thời hạn</b> để được báo khi sắp hết hạn.</span>
          </button>
        ) : (
          <TermEditor term={term} today={today} phone={phone}
            onSave={(b) => run(() => onTerm(t, b))}
            onCancel={() => setMode('view')}
            onClear={term ? () => run(() => onTerm(t, { clear: true })) : undefined} />
        )}
      </section>
    );
  }

  const look = TERM_LOOK[st.state];
  const loud = st.state === 'expired' || st.state === 'soon';
  const pct = termProgress(term, today);
  const alertFrom = fmtDay(addDays(term.end, -term.alertDays), today);
  const range = `${term.start ? `${fmtDay(term.start, today)} → ` : 'Đến '}${fmtDay(term.end, today, true)}${term.months ? ` · ${term.months} tháng` : ''}`;
  const r = term.renew;
  const showTrail = loud || rs !== 'untold';
  return (
    <section style={{
      display: 'flex', flexDirection: 'column', gap: 10, padding: 14, borderRadius: 14,
      border: `1px solid ${loud ? look.edge : C.line}`, background: loud ? look.wash : C.soft,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Icon name={look.icon} size={18} color={look.ink} />
        <span style={{ fontSize: 15, fontWeight: 700, color: loud ? look.ink : C.ink2 }}>{termPhrase(st, today)}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12.5, color: C.body }}>{range}</span>
      </div>
      {pct !== null && (
        <span style={{ display: 'block', height: 6, borderRadius: 3, background: 'rgba(148,163,184,.18)', overflow: 'hidden' }}>
          <span style={{ display: 'block', width: `${Math.round(pct * 100)}%`, height: '100%', background: loud ? look.bar : '#22c55e' }} />
        </span>
      )}
      {showTrail && (
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 2 }}>
          <Step done={loud || rs !== 'untold'} title={st.state === 'expired' ? 'Đã hết hạn' : 'Sắp hết hạn'} sub={`Tự báo từ ${alertFrom} · trước ${term.alertDays} ngày`} color={look.bar === 'transparent' ? '#f59e0b' : look.bar} />
          <Step done={rs === 'told' || rs === 'renewed'} title="Đã báo bộ phận gia hạn"
            sub={rs === 'told' && r ? `${whoShort(r.by)} · ${ago(r.at)}${r.note ? ` · “${r.note}”` : ''}` : rs === 'renewed' ? '—' : 'Chưa ai báo'} color="#6366f1" />
          <Step done={rs === 'renewed'} last title="Đã gia hạn"
            sub={rs === 'renewed' && r ? `Đến ${fmtDay(term.end, today, true)} · ${whoShort(r.by)} · ${ago(r.at)}` : 'Ghi ngày kết thúc mới khi khách đồng ý'} color="#22c55e" />
        </div>
      )}
      {mode === 'renew' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
          <span style={{ fontSize: 13, color: C.body }}>Khách gia hạn thêm:</span>
          <MonthChips value={months} onPick={setMonths} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={busy} onClick={() => run(() => onRenewal(t, { action: 'renewed', months }))}
              style={{ ...ghostBtn({ border: 0, background: '#16a34a', color: '#ffffff' }), flex: 1 }}>
              <Icon name="check" size={15} color="#ffffff" sw={2.6} />Gia hạn đến {fmtDay(addMonthsDay(term.end, months), today, true)}
            </button>
            <button type="button" onClick={() => setMode('view')} style={ghostBtn()}>Huỷ</button>
          </div>
        </div>
      ) : (
        <>
          {loud && rs === 'untold' && (
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú cho bộ phận gia hạn (không bắt buộc)"
              maxLength={500} style={{ ...field(phone), fontWeight: 400 }} />
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            {loud && rs === 'untold' && (
              <button type="button" disabled={busy} onClick={() => run(() => onRenewal(t, { action: 'told', note }))}
                style={{ ...ghostBtn({ border: 0, background: '#f59e0b', color: '#1c1206' }), flex: 1 }}>
                <Icon name="send" size={15} color="#1c1206" />Báo gia hạn
              </button>
            )}
            {rs === 'told' && (
              <button type="button" disabled={busy} onClick={() => run(() => onRenewal(t, { action: 'undo' }))} style={ghostBtn()}>
                <Icon name="undo" size={15} color={C.body} />Huỷ báo
              </button>
            )}
            <button type="button" onClick={() => { setMonths(term.months ?? 3); setMode('renew'); }} style={ghostBtn(rs === 'told' ? { flex: 1, borderColor: 'rgba(34,197,94,.6)', color: C.good } : {})}>
              <Icon name="refresh" size={15} color={rs === 'told' ? C.good : C.body} />Đã gia hạn
            </button>
            <button type="button" onClick={() => setMode('edit')} style={ghostBtn()}>
              <Icon name="edit" size={15} color={C.body} />Sửa
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function SelectField({ title, value, onChange, phone, children, disabled }: {
  title: string; value: string; onChange: (v: string) => void; phone: boolean; children: React.ReactNode; disabled?: boolean;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 160px', minWidth: 0 }}>
      <span style={{ fontSize: 12, color: C.muted }}>{title}</span>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={field(phone)}>{children}</select>
    </label>
  );
}

/**
 * Everything about one salon that used to sit on its row as buttons: the
 * term and its renewal, who works on it next, its stage, team and package,
 * the AI switch, its accounts and its posts. Opened by clicking the row.
 */
export function SalonPanel({
  t, today, phone, team, teams, canAssign, packages, notice, busy,
  onClose, onEnter, onNext, onStage, onPackage, onTeam, onBot, onTerm, onRenewal,
}: {
  t: TenantRow; today: string; phone: boolean; team: string; teams: Board['teams']; canAssign: boolean;
  packages: ServicePackage[]; notice: RowNotice | null; busy: boolean;
  onClose: () => void;
  onEnter: (t: TenantRow, landing?: string) => void;
  onNext: (t: TenantRow, n: WorkNext | '') => void;
  onStage: (t: TenantRow, s: OpsStage) => void;
  onPackage: (t: TenantRow, k: string) => void;
  onTeam: (id: string, team: string) => void;
  onBot: (t: TenantRow, on: boolean) => void;
  onTerm: (t: TenantRow, body: Record<string, unknown>) => Promise<void>;
  onRenewal: (t: TenantRow, body: Record<string, unknown>) => Promise<void>;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  const suspended = t.status === 'SUSPENDED';
  const ch = channelCells(t);
  const social = packages.filter((p) => p.family === 'social');
  const maps = packages.filter((p) => p.family === 'maps');
  const shell: React.CSSProperties = phone
    ? { position: 'fixed', left: 0, right: 0, bottom: 0, top: 'max(48px, 6dvh)', borderRadius: '20px 20px 0 0', borderTop: `1px solid ${C.border}` }
    : { position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(460px, 100vw)', borderLeft: `1px solid ${C.border}`, boxShadow: '-24px 0 48px -24px rgba(0,0,0,.6)' };
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(0,0,0,.45)' }} />
      <aside role="dialog" aria-label={t.name} style={{ ...shell, zIndex: 71, background: C.panel, display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
        {phone && <span aria-hidden style={{ alignSelf: 'center', width: 40, height: 5, borderRadius: 3, background: C.border, marginTop: 8 }} />}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: phone ? '10px 16px 12px' : '20px 20px 12px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: C.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
              <MarketChip code={marketOf(t)} />
              {suspended && <span style={{ fontSize: 10.5, fontWeight: 700, color: C.bad, border: '1px solid #ef4444', borderRadius: 999, padding: '1px 7px' }}>KHOÁ</span>}
            </div>
            <span style={{ fontSize: 12.5, color: C.muted }}>/{t.slug}</span>
          </div>
          <button type="button" aria-label="Đóng" onClick={onClose} style={{ width: 40, height: 40, border: 0, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginTop: -6 }}>
            <Icon name="x" size={22} color={C.sub} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: phone ? '0 16px 28px' : '0 20px 28px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <button type="button" disabled={suspended || busy} onClick={() => onEnter(t)}
            title={suspended ? 'Tiệm đang bị khoá — mở lại ở Super Admin' : 'Mở phiên setup 8 tiếng'}
            style={{ height: 44, borderRadius: 12, border: 0, background: '#6366f1', color: '#ffffff', fontFamily: 'inherit', fontWeight: 700, fontSize: 14.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: suspended ? 'default' : 'pointer', opacity: suspended || busy ? 0.5 : 1, flexShrink: 0 }}>
            <Icon name="enter" size={17} color="#ffffff" />{busy ? 'Đang mở…' : 'Vào tiệm'}
          </button>

          {(notice || (t.heldPosts ?? 0) > 0) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {notice && (
                <button type="button" onClick={() => onEnter(t, notice.newest.link)} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(239,68,68,.6)',
                  background: 'var(--wash-red)', color: C.bad, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', textAlign: 'left',
                }}>
                  <span>{notice.held ? '✏️' : '🔔'}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{noticeSummary(notice)} · {agoShort(notice.newest.at)}</span>
                  <span>Mở →</span>
                </button>
              )}
              {!notice && (t.heldPosts ?? 0) > 0 && (
                <button type="button" onClick={() => onEnter(t, '/salon/content?tab=queue&work=held')} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(239,68,68,.6)',
                  background: 'var(--wash-red)', color: C.bad, fontFamily: 'inherit', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', textAlign: 'left',
                }}>✏️ <span style={{ flex: 1 }}>{t.heldPosts} bài tiệm yêu cầu sửa</span><span>Mở →</span></button>
              )}
            </div>
          )}

          <TermBlock key={`${t.id}:${t.serviceTerm?.end ?? ''}`} t={t} today={today} phone={phone} onTerm={onTerm} onRenewal={onRenewal} />

          <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={label}>Công việc</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <SelectField title="Chuyển cho" phone={phone} value={t.workNext ?? ''} onChange={(v) => onNext(t, v as WorkNext | '')}>
                <option value="">— Chưa chọn —</option>
                {NEXT_ORDER.map((k) => <option key={k} value={k}>{NEXT_LOOK[k].label}</option>)}
              </SelectField>
              <SelectField title="Trạng thái" phone={phone} value={t.opsStage ?? 'running'} onChange={(v) => onStage(t, v as OpsStage)}>
                {STAGE_ORDER.map((k) => <option key={k} value={k}>{STAGE_LOOK[k].label}</option>)}
              </SelectField>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <SelectField title={canAssign ? 'Nhóm phụ trách' : 'Nhóm phụ trách (chỉ quản lý đổi được)'} phone={phone} value={team} disabled={!canAssign} onChange={(v) => onTeam(t.id, v)}>
                <option value="">— Chưa giao —</option>
                {teams.filter((x) => x.team).map((x) => <option key={x.team} value={x.team}>{x.label || x.team}</option>)}
                {team && !teams.some((x) => x.team === team) && <option value={team}>{team}</option>}
              </SelectField>
              {packages.length > 0 && (
                <SelectField title="Gói dịch vụ" phone={phone} value={t.servicePackage ?? ''} onChange={(v) => onPackage(t, v)}>
                  <option value="">— Chưa có gói —</option>
                  <optgroup label="Social / thương hiệu">{social.map((p) => <option key={p.key} value={p.key}>{p.name} · ${p.priceUsd}/tháng</option>)}</optgroup>
                  <optgroup label="Google Maps">{maps.map((p) => <option key={p.key} value={p.key}>{p.name} · ${p.priceUsd}/tháng</option>)}</optgroup>
                </SelectField>
              )}
            </div>
            <span style={{ fontSize: 12, color: C.muted }}>Trạng thái chỉ để nhóm theo dõi — không khoá tài khoản tiệm.</span>
          </section>

          {t.bot && t.bot !== 'none' && (
            <section style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, border: `1px solid ${C.line}` }}>
              <span style={{ fontSize: 18 }}>🤖</span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: C.ink2 }}>Trợ lý AI trả lời tin nhắn</span>
                <span style={{ fontSize: 12, color: C.muted }}>{t.bot === 'on' ? 'Đang bật — bot trả lời khách trên Messenger/Instagram' : 'Đang tắt — Page chỉ dùng để đăng bài'}</span>
              </span>
              <button type="button" onClick={() => onBot(t, t.bot !== 'on')} style={ghostBtn(t.bot === 'on' ? { color: C.good, borderColor: 'rgba(34,197,94,.6)' } : {})}>
                {t.bot === 'on' ? 'Tắt' : 'Bật'}
              </button>
            </section>
          )}

          {ch && (
            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={label}>Kênh đã kết nối · {ch.n}/5</span>
              {ch.cells.map((x) => {
                const tone = TONE[x.tone];
                return (
                  <div key={x.k} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, minWidth: 0 }}>
                    <Dot color={x.tone === 'on' ? '#22c55e' : x.tone === 'warn' ? '#f59e0b' : x.tone === 'bad' ? '#ef4444' : 'var(--c334155)'} size={8} />
                    <span style={{ width: 92, flexShrink: 0, color: C.ink2, fontWeight: 600 }}>{x.label}</span>
                    <span style={{ flex: 1, minWidth: 0, color: x.tone === 'off' ? C.muted : tone.fg === C.good ? C.sub : tone.fg, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={x.v ?? undefined}>
                      {x.v ?? 'Chưa kết nối'}{x.extra ? ` · ${x.extra}` : ''}
                    </span>
                  </div>
                );
              })}
              {ch.worry && <span style={{ fontSize: 12, color: ch.cells.some((x) => x.tone === 'bad') ? C.bad : C.warn }}>⚠ {ch.worry}</span>}
            </section>
          )}

          <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={label}>Bài đăng</span>
            <span style={{ fontSize: 13, color: C.body, lineHeight: 1.6 }}>
              {(t.awaitingApproval ?? 0)} bài chờ tiệm duyệt · {(t.approvedPosts ?? 0)} bài đã duyệt chờ đăng
              {t.lastApprovedAt ? ` · tiệm duyệt gần nhất ${ago(t.lastApprovedAt)}` : ''}
            </span>
            {(t.approvedPosts ?? 0) > 0 && (
              <button type="button" onClick={() => onEnter(t, '/salon/content?tab=queue&work=approved')}
                style={{ alignSelf: 'flex-start', border: 0, background: 'transparent', padding: 0, color: C.link, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Xem bài đã duyệt →
              </button>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}

/** The package as a coloured dot, name and price — quiet text, not a pill. */
export function PackageText({ pkg, size = 13 }: { pkg: ServicePackage | null; size?: number }) {
  if (!pkg) return <span style={{ color: C.muted, fontSize: size, whiteSpace: 'nowrap' }}>Chưa có gói</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: size, whiteSpace: 'nowrap', minWidth: 0, maxWidth: '100%' }}>
      <Dot color={TIER_DOT[pkg.tier] ?? TIER_DOT[1]} size={7} />
      <span style={{ color: C.body, overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{pkg.name}</span>
      <span style={{ color: C.muted, flexShrink: 0 }}>${pkg.priceUsd}</span>
    </span>
  );
}

export function StageText({ stage, size = 13 }: { stage: OpsStage; size?: number }) {
  const look = STAGE_LOOK[stage] ?? STAGE_LOOK.running;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: size, whiteSpace: 'nowrap', color: look.ink, textDecoration: stage === 'stopped' ? 'line-through' : 'none' }}>
      <Dot color={look.dot} size={6} />{look.label}
    </span>
  );
}
