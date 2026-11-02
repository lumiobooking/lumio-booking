'use client';

/**
 * Hold and drag down a technician's column to pick a stretch of time
 * (lib/cal-range.ts says what can be done with it).
 *  - mouse: press and move — a plain click still books;
 *  - finger / pen: hold still ~0.4 s (a short buzz), then drag. A quick
 *    swipe still scrolls the page as before.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { snapRange, type Span } from '../../../lib/cal-range';

export interface RangeSel { col: string; s: number; e: number }
type Pending = {
  col: string; id: number; type: string; x: number; y: number; a: number; active: boolean;
  el: HTMLElement; toMin: (el: HTMLElement, clientY: number) => number; min: number; max: number;
  timer: number | null; range: Span;
};

const HOLD_MS = 420;

export function useRangeDrag(opts: { enabled: boolean; onDone: (col: string, r: Span, at: { x: number; y: number }) => void }) {
  const [sel, setSel] = useState<RangeSel | null>(null);
  const cur = useRef<Pending | null>(null);
  const lastDone = useRef(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // While a finger is selecting, the page must not scroll under it (a passive React listener cannot stop that).
  useEffect(() => {
    const stop = (e: TouchEvent) => { if (cur.current?.active) e.preventDefault(); };
    document.addEventListener('touchmove', stop, { passive: false });
    return () => document.removeEventListener('touchmove', stop);
  }, []);

  const drop = () => { const c = cur.current; if (c?.timer) window.clearTimeout(c.timer); cur.current = null; };
  const activate = () => {
    const c = cur.current; if (!c || c.active) return;
    c.active = true;
    try { c.el.setPointerCapture?.(c.id); } catch { /* finger already lifted */ }
    try { if (c.type !== 'mouse') navigator.vibrate?.(12); } catch { /* no vibration */ }
    c.range = snapRange(c.a, c.a + 15, c.min, c.max);
    setSel({ col: c.col, ...c.range });
  };
  const update = (clientY: number) => {
    const c = cur.current; if (!c?.active) return;
    const b = Math.max(c.min, Math.min(c.max, c.toMin(c.el, clientY)));
    const r = snapRange(c.a, b, c.min, c.max);
    if (r.s !== c.range.s || r.e !== c.range.e) { c.range = r; setSel({ col: c.col, ...r }); }
  };

  const bind = useCallback((col: string, toMin: (el: HTMLElement, clientY: number) => number, min: number, max: number) => ({
    onPointerDown: (e: RPointerEvent<HTMLElement>) => {
      if (!optsRef.current.enabled) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if ((e.target as HTMLElement).closest('[data-card],button,a,input,select')) return;
      drop();
      const el = e.currentTarget;
      const a = Math.max(min, Math.min(max, toMin(el, e.clientY)));
      const p: Pending = { col, id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, a, active: false, el, toMin, min, max, timer: null, range: { s: a, e: a + 15 } };
      cur.current = p;
      if (e.pointerType !== 'mouse') p.timer = window.setTimeout(activate, HOLD_MS);
    },
    onPointerMove: (e: RPointerEvent<HTMLElement>) => {
      const c = cur.current; if (!c || c.id !== e.pointerId) return;
      if (!c.active) {
        const dx = Math.abs(e.clientX - c.x), dy = Math.abs(e.clientY - c.y);
        if (c.type === 'mouse') { if (dy >= 8) activate(); else return; } else { if (dx > 10 || dy > 10) drop(); return; }
      }
      e.preventDefault();
      update(e.clientY);
    },
    onPointerUp: (e: RPointerEvent<HTMLElement>) => {
      const c = cur.current; if (!c || c.id !== e.pointerId) return;
      if (c.active) {
        lastDone.current = Date.now();
        const r = c.range;
        drop();
        optsRef.current.onDone(col, r, { x: e.clientX, y: e.clientY });
        return;
      }
      drop();
    },
    onPointerCancel: () => { if (!cur.current?.active) drop(); },
    onContextMenu: (e: { preventDefault: () => void }) => { if (cur.current) e.preventDefault(); },
  }), []);

  /** A click that ends a drag is not a click. */
  const justDragged = () => Date.now() - lastDone.current < 450;
  const clear = () => setSel(null);
  return { sel, bind, justDragged, clear };
}

/** The picked stretch, painted in the column. */
export function RangeBox({ top, height, label }: { top: number; height: number; label: string }) {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', left: 2, right: 2, top, height: Math.max(14, height), zIndex: 4, boxSizing: 'border-box', borderRadius: 8, border: '2px solid #7c3aed', background: 'rgba(124,58,237,0.16)', pointerEvents: 'none', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
      <span style={{ marginTop: 3, padding: '2px 8px', borderRadius: 999, background: '#7c3aed', color: '#fff', fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  );
}

export interface RangeItem { key: string; label: string; hint?: string; tone?: 'primary' | 'warn' | 'plain'; onClick: () => void }

/** What to do with the picked stretch: a small menu where the pointer let go, a sheet on a phone. */
export function RangeMenu({ at, title, items, onClose, sheet, vi }: { at: { x: number; y: number }; title: string; items: RangeItem[]; onClose: () => void; sheet: boolean; vi: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const W = 280;
  const panel: CSSProperties = sheet
    ? { position: 'fixed', left: 0, right: 0, bottom: 0, padding: '14px 16px calc(14px + env(safe-area-inset-bottom))', borderRadius: '16px 16px 0 0' }
    : { position: 'fixed', left: Math.max(8, Math.min(at.x + 8, (typeof window !== 'undefined' ? window.innerWidth : 1200) - W - 8)), top: Math.max(8, Math.min(at.y + 8, (typeof window !== 'undefined' ? window.innerHeight : 800) - 240)), width: W, padding: 12, borderRadius: 12 };
  const btn = (tone: RangeItem['tone']): CSSProperties => ({
    width: '100%', minHeight: 44, padding: '8px 12px', borderRadius: 10, fontFamily: 'inherit', fontSize: 14, fontWeight: 700, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2,
    ...(tone === 'primary' ? { border: '1px solid #4f46e5', background: '#4f46e5', color: '#fff' }
      : tone === 'warn' ? { border: '1px solid var(--line)', background: 'var(--wash-amber)', color: 'var(--ink-warn)' }
        : { border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ce2e8f0)' }),
  });
  return (
    <div role="dialog" aria-label={title} onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 80, background: sheet ? 'rgba(15,23,42,0.35)' : 'transparent' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...panel, boxSizing: 'border-box', background: 'var(--c1e293b)', border: '1px solid var(--c334155)', boxShadow: '0 12px 32px -8px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <strong style={{ fontSize: 14, color: 'var(--cf1f5f9)' }}>{title}</strong>
        {items.map((it) => (
          <button key={it.key} type="button" onClick={it.onClick} style={btn(it.tone)}>
            <span>{it.label}</span>
            {it.hint && <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.85 }}>{it.hint}</span>}
          </button>
        ))}
        <button type="button" onClick={onClose} style={{ ...btn('plain'), alignItems: 'center', fontWeight: 600 }}>{vi ? 'Huỷ' : 'Cancel'}</button>
      </div>
    </div>
  );
}
