'use client';

/**
 * The Feedback screens' small kit: cards, pills, segmented controls, avatars
 * and three hand-drawn charts (a line chart with a hover card, a sparkline, a
 * meter). Kept local because the charts follow the approved mockup exactly —
 * thin marks, a recessive grid, ONE hue for the measure and a dashed muted
 * line for the reference — and nothing else in the app draws them that way.
 *
 * Every neutral is a theme token, so the same screen is right by day and by
 * night; only the accents (indigo, amber) are literal, as everywhere else.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { dayKeyInTz, fmtInTz } from '../../../lib/datetime';

export const C = {
  card: 'var(--c111827)',
  line: 'var(--line)',
  track: 'var(--c1e293b)',
  ink: 'var(--cf1f5f9)',
  ink2: 'var(--ccbd5e1)',
  muted: 'var(--c94a3b8)',
  faint: 'var(--c64748b)',
  acc: '#4f46e5',
  acc2: '#6366f1',
  accSoft: 'var(--c1e1b4b)',
  accInk: 'var(--ca5b4fc)',
  accLine: 'var(--c3730a3)',
  good: 'var(--ink-good)',
  goodBg: 'var(--c052e16)',
  warn: 'var(--ink-warn)',
  warnBg: 'var(--c451a03)',
  bad: 'var(--ink-bad)',
  badBg: 'var(--c450a0a)',
  flagRow: 'var(--wash-amber)',
  amber: '#d97706',
};

export type Lang = 'en' | 'vi';
export const Lx = (lang: string) => (vi: string, en: string) => (lang === 'vi' ? vi : en);

export const cardStyle: CSSProperties = {
  background: C.card, border: `1px solid ${C.line}`, borderRadius: 16, minWidth: 0,
  boxShadow: '0 1px 2px rgba(15,23,42,.04), 0 6px 20px rgba(15,23,42,.05)',
};

export const lblStyle: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '.09em', textTransform: 'uppercase', color: C.muted };

/** The CSS the inline styles cannot say: responsive grids and hover states. */
export const FB_CSS = `
.fb-kpis{display:grid;grid-template-columns:1.25fr 1fr 1fr 1fr;gap:14px}
.fb-g2{display:grid;grid-template-columns:1.62fr 1fr;gap:14px}
.fb-g2b{display:grid;grid-template-columns:1.5fr 1fr;gap:14px}
.fb-half{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.fb-split{display:grid;grid-template-columns:400px minmax(0,1fr);gap:14px;align-items:start}
.fb-score{display:grid;grid-template-columns:repeat(4,1fr);flex:1;min-width:0}
.fb-staffgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.fb-row{cursor:pointer;transition:background .12s}
.fb-row:hover{background:var(--c1e293b)}
.fb-tab{cursor:pointer;background:none;border:none;font-family:inherit}
.fb-btn{cursor:pointer;font-family:inherit;text-decoration:none}
.fb-btn:disabled{opacity:.5;cursor:default}
@media (max-width:1180px){.fb-kpis{grid-template-columns:1fr 1fr}.fb-split{grid-template-columns:330px minmax(0,1fr)}}
@media (max-width:980px){.fb-g2,.fb-g2b,.fb-half,.fb-split{grid-template-columns:minmax(0,1fr)}.fb-score{grid-template-columns:1fr 1fr;row-gap:14px}}
@media (max-width:560px){.fb-kpis{grid-template-columns:minmax(0,1fr)}.fb-hide-sm{display:none !important}}
`;

// ------------------------------------------------------------------ atoms

type Tone = 'good' | 'warn' | 'bad' | 'mut' | 'acc';
const TONE: Record<Tone, [string, string]> = {
  good: [C.goodBg, C.good], warn: [C.warnBg, C.warn], bad: [C.badBg, C.bad], mut: [C.track, C.muted], acc: [C.accSoft, C.accInk],
};

export function Pill({ tone, children, style }: { tone: Tone; children: ReactNode; style?: CSSProperties }) {
  const [bg, fg] = TONE[tone];
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', background: bg, color: fg, ...style }}>{children}</span>;
}

export function Chip({ bad, children }: { bad?: boolean; children: ReactNode }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 999, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', background: bad ? C.badBg : C.track, color: bad ? C.bad : C.ink2 }}>{children}</span>;
}

export function Btn({ primary, small, onClick, disabled, children, href, style, title }: {
  primary?: boolean; small?: boolean; onClick?: () => void; disabled?: boolean; children: ReactNode; href?: string; style?: CSSProperties; title?: string;
}) {
  const s: CSSProperties = {
    height: small ? 32 : 38, padding: small ? '0 11px' : '0 14px', borderRadius: 10, fontSize: small ? 12.5 : 13.5, fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap', boxSizing: 'border-box',
    border: `1px solid ${primary ? C.acc : C.line}`,
    background: primary ? C.acc : C.card,
    color: primary ? '#fff' : C.ink,
    boxShadow: primary ? '0 6px 14px rgba(79,70,229,.25)' : 'none',
    ...style,
  };
  if (href) {
    const ext = /^(tel:|sms:|https?:)/.test(href);
    return ext ? <a className="fb-btn" href={href} onClick={onClick} style={s} title={title}>{children}</a>
      : <Link className="fb-btn" href={href} onClick={onClick} style={s} title={title}>{children}</Link>;
  }
  return <button type="button" className="fb-btn" onClick={onClick} disabled={disabled} style={s} title={title}>{children}</button>;
}

export function Seg<K extends string>({ options, value, onChange, style }: { options: { key: K; label: ReactNode }[]; value: K; onChange: (k: K) => void; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: 3, gap: 2, overflowX: 'auto', maxWidth: '100%', boxSizing: 'border-box', ...style }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button key={o.key} type="button" className="fb-btn" onClick={() => onChange(o.key)}
            style={{ flex: style?.flex ? 1 : undefined, padding: '6px 12px', borderRadius: 7, border: 'none', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', background: on ? C.acc2 : 'transparent', color: on ? '#fff' : C.muted }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="fb-btn" disabled={disabled} onClick={() => onChange(!on)}
      style={{ width: 44, height: 26, borderRadius: 999, border: 'none', padding: 0, position: 'relative', flexShrink: 0, background: on ? C.acc2 : 'var(--c475569)', transition: 'background .15s' }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,.2)' }} />
    </button>
  );
}

const AV_COLORS = ['#7c3aed', '#0891b2', '#ea580c', '#16a34a', '#db2777', '#4f46e5', '#0d9488', '#c026d3'];
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}
export function initialsOf(name: string): string {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function Avatar({ name, initials, url, size = 32, seed }: { name: string; initials?: string; url?: string | null; size?: number; seed?: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  }
  return (
    <span style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: avatarColor(seed || name), color: '#fff', fontWeight: 700, fontSize: Math.round(size * 0.36) }}>
      {initials || initialsOf(name)}
    </span>
  );
}

export function CardHead({ title, right, style }: { title: ReactNode; right?: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px 10px', flexWrap: 'wrap', padding: '16px 18px 0', ...style }}>
      <h3 style={{ margin: 0, fontSize: 15.5, fontWeight: 700, color: C.ink, flexShrink: 0, maxWidth: '100%' }}>{title}</h3>
      {right != null && (typeof right === 'string' ? <span style={{ fontSize: 12.5, color: C.muted, textAlign: 'right' }}>{right}</span> : right)}
    </div>
  );
}

export function Delta({ v, unit = '', suffix }: { v: number | null | undefined; unit?: string; suffix?: ReactNode }) {
  if (v == null || !Number.isFinite(v)) return null;
  if (v === 0) return <span style={{ fontSize: 12.5, fontWeight: 700, color: C.muted, whiteSpace: 'nowrap' }}>= {suffix}</span>;
  return <span style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', color: v > 0 ? C.good : C.bad }}>{v > 0 ? '▲' : '▼'} {Math.abs(v)}{unit}{suffix ? <span style={{ fontWeight: 500, color: C.muted }}> {suffix}</span> : null}</span>;
}

export function Bars({ items, color = C.acc2 }: { items: { label: string; count: number }[]; color?: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <>
      {items.map((it) => (
        <div key={it.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13.5, marginBottom: 6 }}>
            <span style={{ color: C.ink2, fontWeight: 600 }}>{it.label}</span><b style={{ color: C.ink }}>{it.count}</b>
          </div>
          <div style={{ height: 10, borderRadius: 5, background: C.track }}>
            <div style={{ height: '100%', width: `${(it.count / max) * 100}%`, background: color, borderRadius: 5 }} />
          </div>
        </div>
      ))}
    </>
  );
}

export function Meter({ pct, color }: { pct: number | null; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, minWidth: 40, height: 8, borderRadius: 4, background: C.track, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct ?? 0}%`, background: color, borderRadius: 4 }} />
      </div>
      <b style={{ fontSize: 14, minWidth: 38, textAlign: 'right', color: C.ink }}>{pct == null ? '—' : `${pct}%`}</b>
    </div>
  );
}

// ------------------------------------------------------------------ charts

export function Spark({ data, color = C.acc2, w = 110, h = 30 }: { data: (number | null)[]; color?: string; w?: number; h?: number }) {
  const pts = data.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v != null);
  if (pts.length < 2) {
    return <svg width={w} height={h} aria-hidden><line x1={3} x2={w - 3} y1={h / 2} y2={h / 2} stroke="var(--c334155)" strokeWidth={2} strokeDasharray="3 4" /></svg>;
  }
  const mn = Math.min(...pts.map((p) => p.v)) - 2;
  const mx = Math.max(...pts.map((p) => p.v)) + 2;
  const n = data.length;
  const x = (i: number) => 3 + (i * (w - 6)) / Math.max(1, n - 1);
  const y = (v: number) => 3 + ((mx - v) * (h - 6)) / Math.max(1, mx - mn);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} aria-hidden style={{ display: 'block' }}>
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={3.2} fill={color} />
    </svg>
  );
}

function useWidth(min = 280) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(Math.max(min, Math.floor(el.clientWidth)));
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);
  return [ref, w] as const;
}

type Pt = { i: number; v: number };
function segments(data: (number | null)[]): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  data.forEach((v, i) => {
    if (v == null) { if (cur.length) out.push(cur); cur = []; } else cur.push({ i, v });
  });
  if (cur.length) out.push(cur);
  return out;
}

/**
 * One measured line (+ an optional dashed reference), a soft area under it,
 * a label at the end of each line, and a dark card for the week under the
 * pointer. Weeks with no answers leave a gap rather than a false slope.
 */
export function LineChart({ labels, series, reference, min, max, ticks = 4, height = 250, tip, unit = '%' }: {
  labels: string[];
  series: { label: string; color: string; data: (number | null)[] };
  reference?: { label: string; data: (number | null)[] };
  min: number; max: number; ticks?: number; height?: number; unit?: string;
  tip?: (i: number) => string[] | null;
}) {
  const [host, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const h = height;
  // Room on the right for the end labels, sized to the longer one.
  const endLen = Math.max(series.label.length, reference?.label.length ?? 0);
  const pad = { l: 38, r: Math.min(130, Math.max(64, Math.round(endLen * 6.9) + 16)), t: 14, b: 26 };
  const n = labels.length;
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i * (w - pad.l - pad.r)) / (n - 1));
  const y = (v: number) => pad.t + ((max - Math.min(max, Math.max(min, v))) * (h - pad.t - pad.b)) / Math.max(1, max - min);
  // Week labels: every other one on a wide chart, fewer on a phone, never touching.
  const perWeek = (w - pad.l - pad.r) / Math.max(1, n - 1);
  const step = Math.max(1, Math.ceil(52 / Math.max(1, perWeek)));
  const showLabel = (i: number) => i === n - 1 || (i % step === 0 && (n - 1 - i) * perWeek >= 47);
  const gridVals: number[] = [];
  for (let k = 0; k <= ticks; k++) gridVals.push(min + ((max - min) * k) / ticks);

  const segs = segments(series.data);
  const refSegs = reference ? segments(reference.data) : [];
  const lastPt = segs.length ? segs[segs.length - 1][segs[segs.length - 1].length - 1] : null;
  const refLast = refSegs.length ? refSegs[refSegs.length - 1][refSegs[refSegs.length - 1].length - 1] : null;
  // End labels: when they would collide, the higher line's label goes above, the lower one's below.
  let sDy = -8; let rDy = 4;
  if (lastPt && refLast && Math.abs(y(lastPt.v) - y(refLast.v)) < 18) {
    if (y(lastPt.v) <= y(refLast.v)) { sDy = -8; rDy = 16; } else { sDy = 16; rDy = -6; }
  }

  const onMove = (clientX: number, rect: DOMRect) => {
    const px = ((clientX - rect.left) / rect.width) * w;
    if (n <= 1) { setHover(0); return; }
    const i = Math.round(((px - pad.l) * (n - 1)) / (w - pad.l - pad.r));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const tipLines = hover != null && tip ? tip(hover) : null;
  const hv = hover != null ? series.data[hover] : null;

  return (
    <div ref={host} style={{ width: '100%', position: 'relative' }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} data-chart="line" style={{ display: 'block', touchAction: 'pan-y' }}
        onMouseMove={(e) => onMove(e.clientX, e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => setHover(null)}
        onTouchStart={(e) => onMove(e.touches[0].clientX, e.currentTarget.getBoundingClientRect())}>
        {gridVals.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} stroke="var(--c1e293b)" strokeWidth={1} />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--c64748b)">{Math.round(v)}{unit}</text>
          </g>
        ))}
        {labels.map((l, i) => (showLabel(i) ? (
          <text key={i} x={x(i)} y={h - 6} textAnchor="middle" fontSize={11} fill="var(--c64748b)">{l}</text>
        ) : null))}
        {refSegs.map((sg, k) => (
          <path key={`r${k}`} d={sg.map((p, j) => `${j ? 'L' : 'M'}${x(p.i)},${y(p.v)}`).join('')} fill="none" stroke="var(--c64748b)" strokeWidth={1.5} strokeDasharray="5 4" />
        ))}
        {reference && refLast && <text x={x(refLast.i) + 8} y={y(refLast.v) + rDy} fontSize={12} fill="var(--c64748b)" fontWeight={600}>{reference.label}</text>}
        {segs.map((sg, k) => {
          const d = sg.map((p, j) => `${j ? 'L' : 'M'}${x(p.i)},${y(p.v)}`).join('');
          return (
            <g key={`s${k}`}>
              {sg.length > 1 && <path d={`${d}L${x(sg[sg.length - 1].i)},${h - pad.b}L${x(sg[0].i)},${h - pad.b}Z`} fill={series.color} opacity={0.08} />}
              <path d={d} fill="none" stroke={series.color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
              {sg.length === 1 && <circle cx={x(sg[0].i)} cy={y(sg[0].v)} r={3} fill={series.color} />}
            </g>
          );
        })}
        {lastPt && (
          <>
            <circle cx={x(lastPt.i)} cy={y(lastPt.v)} r={4.5} fill={series.color} stroke="var(--c111827)" strokeWidth={2} />
            <text x={x(lastPt.i) + 8} y={y(lastPt.v) + sDy} fontSize={12} fill="var(--cf1f5f9)" fontWeight={700}>{series.label}</text>
          </>
        )}
        {hover != null && (
          <g pointerEvents="none">
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={h - pad.b} stroke="var(--c334155)" strokeWidth={1} />
            {hv != null && <circle cx={x(hover)} cy={y(hv)} r={5} fill="var(--c111827)" stroke={series.color} strokeWidth={2.2} />}
            {tipLines && (() => {
              const bw = Math.min(190, Math.max(150, ...tipLines.map((t) => t.length * 6.6 + 24)));
              const bh = 22 + tipLines.length * 18;
              const ty = hv != null ? y(hv) : pad.t + 30;
              const bx = x(hover) + 12 + bw > w - 4 ? Math.max(4, x(hover) - 12 - bw) : x(hover) + 12;
              const by = Math.max(pad.t, ty - bh - 10);
              return (
                <g>
                  <rect x={bx} y={by} width={bw} height={bh} rx={10} fill="#0f172a" stroke="#334155" />
                  {tipLines.map((t, i) => (
                    <text key={i} x={bx + 12} y={by + 20 + i * 18} fontSize={i ? 12 : 12.5} fill={i ? '#cbd5e1' : '#ffffff'} fontWeight={i ? 500 : 700}>{t}</text>
                  ))}
                </g>
              );
            })()}
          </g>
        )}
      </svg>
    </div>
  );
}

/** A rounded axis range that keeps the goal line and every point on the chart. */
export function axisRange(values: (number | null)[], goal?: number): { min: number; max: number } {
  const v = values.filter((x): x is number => x != null);
  const lo = Math.min(goal ?? 100, ...(v.length ? v : [goal ?? 80]));
  const min = Math.max(0, Math.floor((lo - 4) / 10) * 10);
  return { min: Math.min(min, 80), max: 100 };
}

// ------------------------------------------------------------------ text

const REASON_VI: Record<string, string> = {
  'Waited too long': 'Chờ quá lâu',
  'Service quality': 'Chất lượng dịch vụ',
  'Polish chipped': 'Sơn bị bong',
  'Staff attitude': 'Thái độ nhân viên',
  Cleanliness: 'Vệ sinh',
  Price: 'Giá cả',
  Other: 'Khác',
};
export const reasonText = (r: string, lang: string) => (lang === 'vi' ? REASON_VI[r] ?? r : r);

/** "Jul 14" for a Monday week key, read as a calendar date (no timezone drift). */
export function weekLabel(key: string, lang: string): string {
  const d = new Date(`${key}T12:00:00Z`);
  try { return d.toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); } catch { return key.slice(5); }
}

/** "today 2:40 PM", "yesterday 4:50 PM", "tomorrow 2:40 PM", else "Sat Sep 27, 5:30 PM". */
export function whenText(at: string | Date | null | undefined, lang: string): string {
  if (!at) return '';
  const L = Lx(lang);
  const key = dayKeyInTz(at);
  const today = dayKeyInTz(new Date());
  const dayMs = 86_400_000;
  const time = fmtInTz(at, { hour: 'numeric', minute: '2-digit' });
  if (key === today) return `${L('hôm nay', 'today')} ${time}`;
  if (key === dayKeyInTz(new Date(Date.now() - dayMs))) return `${L('hôm qua', 'yesterday')} ${time}`;
  if (key === dayKeyInTz(new Date(Date.now() + dayMs))) return `${L('ngày mai', 'tomorrow')} ${time}`;
  return fmtInTz(at, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function shortDate(at: string | Date | null | undefined): string {
  return at ? fmtInTz(at, { month: 'short', day: 'numeric' }) : '';
}

/** "21 h left" / "3 h overdue" / "40 min overdue" for a case clock. */
export function clockText(dueAt: string | Date, lang: string, now = Date.now()): { overdue: boolean; text: string; hours: number } {
  const L = Lx(lang);
  const ms = new Date(dueAt).getTime() - now;
  const mins = Math.round(Math.abs(ms) / 60000);
  const span = mins >= 60 ? `${Math.round(mins / 60)} h` : `${mins} ${L('phút', 'min')}`;
  return ms < 0
    ? { overdue: true, text: L(`Trễ ${span}`, `${span} overdue`), hours: -mins / 60 }
    : { overdue: false, text: L(`Còn ${span}`, `${span} left`), hours: mins / 60 };
}

export function minutesText(min: number | null | undefined, lang: string): string {
  if (min == null) return '—';
  const L = Lx(lang);
  if (min < 60) return `${min} ${L('phút', 'm')}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} ${L('phút', 'm')}` : `${h} h`;
}

export function ordinal(n: number, lang: string): string {
  if (lang === 'vi') return `#${n}`;
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div style={{ padding: '28px 18px', textAlign: 'center', color: C.muted, fontSize: 13.5, lineHeight: 1.5 }}>{children}</div>;
}
