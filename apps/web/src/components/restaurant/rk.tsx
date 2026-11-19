'use client';

/**
 * Small shared pieces of the restaurant home and report screens (18/11/2026,
 * from the approved mockup "Tổng quan nhà hàng — thiết kế lại"): every label
 * and every number stays on ONE line — the old screens broke "629.567 đ" over
 * two lines and wrapped every sentence on a phone.
 */
import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';

export const C = {
  page: 'var(--c0f172a)',
  card: 'var(--c1e293b)',
  line: 'var(--c334155)',
  ink: 'var(--cf1f5f9)',
  ink2: 'var(--ccbd5e1)',
  muted: 'var(--c94a3b8)',
  good: 'var(--ink-good)',
  warn: 'var(--ink-warn)',
  bad: 'var(--ink-bad)',
  link: 'var(--ink-link)',
  accent: '#6366f1',
};

export const one: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 };
export const num: CSSProperties = { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };

export function Card({ children, style, tone }: { children: ReactNode; style?: CSSProperties; tone?: 'warn' }) {
  return (
    <section style={{ background: C.card, border: `1px solid ${tone === 'warn' ? 'rgba(245,158,11,.55)' : C.line}`, borderRadius: 18, padding: '16px 18px', minWidth: 0, ...style }}>
      {children}
    </section>
  );
}

export function H2({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
      <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: C.ink, ...one }}>{children}</h2>
      {right}
    </div>
  );
}

/** Label on the left, value on the right, one line each. */
export function Row({ label, value, tone, sub, first, href, onClick }: {
  label: ReactNode; value: ReactNode; tone?: 'good' | 'warn' | 'bad'; sub?: ReactNode; first?: boolean; href?: string; onClick?: () => void;
}) {
  const color = tone ? C[tone] : C.ink;
  const inner = (
    <>
      <span style={{ flex: '1 1 auto', fontSize: 15, color: C.ink2, ...one }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 700, color, ...num }}>{value}</span>
      {sub !== undefined && <span style={{ width: 64, textAlign: 'right', fontSize: 13, fontWeight: 700, color: C.muted, ...num }}>{sub}</span>}
      {(href || onClick) && (
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{ color: C.muted, flexShrink: 0 }}><path d="M9 18l6-6-6-6" /></svg>
      )}
    </>
  );
  const style: CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, width: '100%', boxSizing: 'border-box',
    borderWidth: `${first ? 0 : 1}px 0 0 0`, borderStyle: 'solid', borderColor: C.line,
    textDecoration: 'none', color: 'inherit', background: 'none', padding: 0, font: 'inherit', textAlign: 'left', cursor: href || onClick ? 'pointer' : 'default',
  };
  if (href) return <Link href={href} style={style}>{inner}</Link>;
  if (onClick) return <button type="button" onClick={onClick} style={style}>{inner}</button>;
  return <div style={style}>{inner}</div>;
}

export function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return <span style={{ color: up ? C.good : C.bad, fontWeight: 700, ...num }}>{up ? '▲' : '▼'} {Math.abs(pct)}%</span>;
}

export function Dot({ tone }: { tone: 'bad' | 'warn' | 'ok' }) {
  const bg = tone === 'bad' ? '#ef4444' : tone === 'warn' ? '#f59e0b' : '#22c55e';
  return <span aria-hidden="true" style={{ flexShrink: 0, width: 10, height: 10, borderRadius: 5, background: bg }} />;
}

/** Bars for the hours of one night, in the order the night runs. */
export function HourBars({ rows, label }: { rows: { hour: number; cents: number }[]; label: (h: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.cents));
  const peak = rows.reduce((a, r) => (r.cents > a.cents ? r : a), rows[0] ?? { hour: 0, cents: 0 });
  return (
    <div>
      <div role="img" aria-label="Doanh thu theo giờ" style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(rows.length, 1)}, minmax(0, 1fr))`, gap: 6, alignItems: 'end', height: 120, marginTop: 10 }}>
        {rows.map((r) => (
          <div key={r.hour} title={`${label(r.hour)}`} style={{ height: Math.max(4, Math.round((r.cents / max) * 120)), borderRadius: '6px 6px 2px 2px', background: r.hour === peak.hour ? C.accent : 'rgba(99,102,241,.45)' }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(rows.length, 1)}, minmax(0, 1fr))`, gap: 6, marginTop: 6 }}>
        {rows.map((r) => <span key={r.hour} style={{ fontSize: 12, color: C.muted, textAlign: 'center', ...num }}>{r.hour}h</span>)}
      </div>
    </div>
  );
}
