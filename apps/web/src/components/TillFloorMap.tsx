'use client';

/**
 * The drawn floor plan on the till (sơ đồ thật): area zones, tables with
 * their chairs, coloured by what the table needs. Tapping a table selects it;
 * the till shows what it holds and what to do next beside the plan (a sheet
 * on a phone). Always on a light "paper" so the colours read the same in
 * both themes. Shrinks to fit; a phone keeps tables big enough to tap and
 * scrolls sideways.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { planFloor, planScale, type PlanTable } from '../lib/floor-map';
import type { Spot } from '../lib/till-floor';
import type { TableState } from '../lib/restaurant-till';

export const MAP_COLORS: Record<TableState, { fill: string; line: string; text: string; sub: string }> = {
  free: { fill: '#f8fafc', line: '#cbd5e1', text: '#94a3b8', sub: '#94a3b8' },
  seated: { fill: '#ffffff', line: '#a5b4fc', text: '#3730a3', sub: '#6366f1' },
  ordered: { fill: '#eef0ff', line: '#4f46e5', text: '#312e81', sub: '#4338ca' },
  unsent: { fill: '#fff4ec', line: '#ea580c', text: '#9a3412', sub: '#c2410c' },
  prebilled: { fill: '#e6fffa', line: '#0d9488', text: '#115e59', sub: '#0f766e' },
  askpay: { fill: '#e11d48', line: '#e11d48', text: '#ffffff', sub: '#ffe4e6' },
  paying: { fill: '#ccfbf1', line: '#0f766e', text: '#115e59', sub: '#0f766e' },
  call: { fill: '#f59e0b', line: '#b45309', text: '#1c1917', sub: '#451a03' },
};

export interface MapTableView {
  state: TableState; label: string; sub: string; dim: boolean;
  /** Ticked while the cashier picks tables to join ("Ghép bàn"). */
  picked?: boolean;
  /** Part of a bill that spans several tables: they wear the same chain badge. */
  joined?: boolean;
}

export function TillFloorMap({ tables, layout, view, selectedId, phone, vi, onSelect, footer, canDrag, onDropOn }: {
  tables: PlanTable[];
  layout?: Record<string, Spot> | null;
  /** What each table shows (state colour, its name, a short line under it). */
  view: (t: PlanTable) => MapTableView;
  selectedId: string | null;
  phone: boolean;
  vi: boolean;
  onSelect: (t: PlanTable) => void;
  footer?: React.ReactNode;
  /** A table with guests may be dragged onto another one to join their bills (mouse; touch uses the bill's button). */
  canDrag?: (t: PlanTable) => boolean;
  onDropOn?: (fromId: string, toId: string) => void;
}) {
  const [over, setOver] = useState<string | null>(null);
  const plan = useMemo(() => planFloor(tables, layout), [tables, layout]);
  const byId = useMemo(() => new Map(tables.map((t) => [t.id, t])), [tables]);
  const box = useRef<HTMLDivElement | null>(null);
  const [boxW, setBoxW] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setBoxW(el.clientWidth);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const scale = planScale(plan.width, boxW, phone);
  return (
    <div ref={box} style={{ width: '100%', overflowX: 'auto', overflowY: 'hidden', borderRadius: 20, background: '#ffffff', boxShadow: '0 1px 2px rgba(15,23,42,.06)', border: '1px solid #e6e9f2' }}>
      <div style={{ position: 'relative', width: plan.width * scale, height: plan.height * scale }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: plan.width, height: plan.height, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
          {plan.zones.map((z) => (
            <div key={z.area || '_'} style={{ position: 'absolute', left: z.x, top: z.y, width: z.w, height: z.h, borderRadius: 18, background: z.tint, border: '1px solid rgba(15,23,42,.06)', boxSizing: 'border-box' }}>
              <span style={{ position: 'absolute', left: 14, top: 10, fontSize: 12, fontWeight: 800, letterSpacing: '.1em', color: '#64748b' }}>{(z.area || (vi ? 'Khác' : 'Other')).toUpperCase()}</span>
            </div>
          ))}
          {plan.tables.map((p) => {
            const t = byId.get(p.id);
            if (!t) return null;
            const v = view(t);
            const c = MAP_COLORS[v.state];
            const on = selectedId === p.id;
            const chairs = (n: number) => (
              <span aria-hidden style={{ display: 'flex', gap: 10, justifyContent: 'center', height: 8 }}>
                {Array.from({ length: n }, (_, i) => <span key={i} style={{ width: 22, height: 8, borderRadius: 6, background: v.state === 'free' ? '#d5dbe6' : '#b8c1d1' }} />)}
              </span>
            );
            return (
              <button key={p.id} type="button" onClick={() => onSelect(t)} aria-pressed={on || !!v.picked} aria-label={`${t.name} · ${v.sub}`}
                draggable={!!canDrag?.(t)}
                onDragStart={(e) => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; }}
                onDragOver={(e) => { if (onDropOn && canDrag?.(t)) { e.preventDefault(); if (over !== p.id) setOver(p.id); } }}
                onDragLeave={() => setOver((o) => (o === p.id ? null : o))}
                onDrop={(e) => { e.preventDefault(); setOver(null); const from = e.dataTransfer.getData('text/plain'); if (from && from !== p.id) onDropOn?.(from, p.id); }}
                style={{ position: 'absolute', left: p.x, top: p.y, width: p.boxW, padding: 0, border: 'none', background: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: 'inherit', opacity: v.dim ? 0.28 : 1, transition: 'opacity .15s' }}>
                {chairs(p.top)}
                <span style={{ width: p.w, height: p.h, boxSizing: 'border-box', borderRadius: p.round ? '50%' : 16, background: c.fill, border: `2px solid ${c.line}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: '0 6px', boxShadow: on || v.picked || over === p.id ? `0 0 0 4px #ffffff, 0 0 0 7px ${over === p.id ? '#16a34a' : '#4f46e5'}` : v.state === 'free' ? 'none' : '0 4px 12px rgba(15,23,42,.08)', position: 'relative' }}>
                  {v.picked && <span aria-hidden style={{ position: 'absolute', top: -10, right: -10, width: 26, height: 26, borderRadius: '50%', background: '#4f46e5', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 15, fontWeight: 800, boxShadow: '0 0 0 3px #fff' }}>✓</span>}
                  {v.joined && !v.picked && <span aria-hidden title={vi ? 'Bàn ghép' : 'Joined tables'} style={{ position: 'absolute', top: -9, left: -9, minWidth: 24, height: 24, borderRadius: 12, background: '#0f766e', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, boxShadow: '0 0 0 3px #fff' }}>🔗</span>}
                  <b style={{ fontSize: 19, lineHeight: 1.1, color: c.text, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.label}</b>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: c.sub, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.sub}</span>
                </span>
                {chairs(p.bottom)}
              </button>
            );
          })}
          {footer}
        </div>
      </div>
    </div>
  );
}
