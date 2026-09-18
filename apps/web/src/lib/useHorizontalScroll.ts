'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A row of chips that scrolls sideways — and can actually be scrolled on a
 * computer.
 *
 * THE BUG
 *
 * Both the booking page and the check-in kiosk hide the row's scrollbar,
 * which is right on a phone: the row is swiped, and a scrollbar under a row
 * of pills looks broken. On a desktop it removed the only way to move the
 * row. A mouse has no sideways swipe, the wheel scrolls the PAGE, and the
 * hidden scrollbar meant nothing on screen said the row went any further —
 * so the categories simply stopped at "Natu…" and every category to the
 * right of the screen edge did not exist for that customer.
 *
 * THE FIX, IN THREE PARTS
 *
 * The wheel over the row scrolls the row, not the page — a vertical wheel
 * on a horizontal strip has no other sensible meaning. Two arrow buttons,
 * shown only while there is something to scroll to on that side, give a
 * mouse something to click. And the caller can fade the edge so the eye is
 * told there is more. Touch is untouched: on a phone `canLeft`/`canRight`
 * still report, but the caller hides the arrows below a hover-capable width.
 */
export function useHorizontalScroll<T extends HTMLElement>() {
  // A callback ref, not a useRef: the row is often rendered only on a later
  // step of the screen (the kiosk shows it on step 2), so an effect that ran
  // on mount would find no element, attach nothing, and never run again.
  // Holding the node in state re-runs the wiring the moment the row appears.
  const [node, setNode] = useState<T | null>(null);
  const ref = useCallback((el: T | null) => setNode(el), []);
  const nodeRef = useRef<T | null>(null);
  nodeRef.current = node;
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const measure = useCallback(() => {
    const el = nodeRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft < max - 2);
  }, []);

  useEffect(() => {
    const el = node;
    if (!el) return;
    measure();
    const onWheel = (e: WheelEvent) => {
      // Only when the row can move: a row that fits must let the page scroll.
      if (el.scrollWidth <= el.clientWidth) return;
      // A trackpad already sends deltaX; leave that alone.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', measure, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    // Fonts arriving late widen the chips; measure once more after they land.
    const t = window.setTimeout(measure, 300);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
      window.clearTimeout(t);
    };
  }, [node, measure]);

  const nudge = useCallback((dir: -1 | 1) => {
    const el = nodeRef.current;
    if (!el) return;
    // Most of a viewport, so the last visible chip becomes the first — the
    // person keeps their place instead of losing it.
    el.scrollBy({ left: dir * Math.max(120, Math.round(el.clientWidth * 0.7)), behavior: 'smooth' });
  }, []);

  return { ref, canLeft, canRight, measure, nudge };
}
