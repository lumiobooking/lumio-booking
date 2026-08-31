'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { moveItem, orderSignature } from './reorder';

/**
 * Grab a row and move it. One hook, used by the table and by the mobile cards.
 *
 * WHY THIS EXISTS AT ALL, TWICE OVER
 *
 * The first version put dragging inside a panel that opened above the table.
 * The list the owner was actually looking at still could not be touched, and
 * the panel had to be found behind a button in a row of four. A feature you
 * have to discover is a feature that does not exist for the person who
 * scrolled past it — which is exactly what happened, twice.
 *
 * So the handle is on every row, always, and there is no mode to enter.
 *
 * POINTER EVENTS, NOT THE HTML5 DRAG API
 *
 * The HTML5 drag API does not fire at all on a touch screen, and in Firefox a
 * dragstart without dataTransfer.setData never starts a drag. Both of those
 * silently broke the earlier attempt. Pointer events are one code path for
 * mouse, trackpad, finger and stylus.
 *
 * IT SAVES ITSELF
 *
 * 700ms after the dragging stops, so a drag across twenty rows is one request
 * and there is no button anybody has to remember.
 */
export function useRowDrag<T extends { id: string }>(
  rows: T[],
  commit: (ids: string[]) => Promise<void>,
) {
  const [order, setOrder] = useState<T[]>(rows);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const containerRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-seed only when the SET of rows really changes.
  //
  // Keying this on `rows` was the bug that made the whole thing look dead:
  // the caller rebuilds that array with .filter() on every render, so the
  // effect fired constantly and reset the list the instant anything moved.
  const sig = orderSignature(rows.map((r) => r.id));
  useEffect(() => {
    setOrder(rows);
    setSaved('idle');
    // `rows` is deliberately not a dependency — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const move = useCallback((from: number, to: number) => {
    setOrder((cur) => {
      const next = moveItem(cur, from, to);
      if (next.every((x, i) => cur[i] === x)) return cur;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setSaved('saving');
        commit(next.map((r) => r.id))
          .then(() => setSaved('saved'))
          .catch(() => setSaved('error'));
      }, 700);
      return next;
    });
  }, [commit]);

  const rowIndexAt = (clientY: number): number | null => {
    const els = Array.from(containerRef.current?.querySelectorAll('[data-row]') ?? []);
    for (let i = 0; i < els.length; i += 1) {
      const r = (els[i] as HTMLElement).getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return i;
    }
    return null;
  };

  return {
    order,
    dragIdx,
    saved,
    /** Spread onto the element that wraps the rows. */
    containerProps: {
      ref: containerRef,
      onPointerMove: (e: React.PointerEvent) => {
        if (dragIdx === null) return;
        e.preventDefault();
        const over = rowIndexAt(e.clientY);
        if (over !== null && over !== dragIdx) {
          move(dragIdx, over);
          setDragIdx(over);
        }
      },
      onPointerUp: () => setDragIdx(null),
      onPointerCancel: () => setDragIdx(null),
      style: { touchAction: dragIdx === null ? 'auto' : 'none' } as React.CSSProperties,
    },
    /** Spread onto each row's handle. */
    grab: (i: number) => (e: React.PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setDragIdx(i);
    },
  };
}
