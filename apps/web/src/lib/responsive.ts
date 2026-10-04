'use client';

import { useSyncExternalStore } from 'react';

/**
 * Returns true when the viewport is at or below `breakpoint` (px).
 * Used to switch inline-style layouts between desktop and mobile.
 *
 * useSyncExternalStore makes the FIRST client render already correct (matchMedia)
 * instead of defaulting to false and flipping after mount — that flip was the
 * visible flicker on load (desktop grid -> mobile agenda). The server snapshot is
 * false so SSR/hydration stays consistent.
 */
export function useIsMobile(breakpoint = 768): boolean {
  const query = `(max-width: ${breakpoint}px)`;
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * Up to this width a data list shows as CARDS instead of a table.
 *
 * It used to be the phone breakpoint (768). An iPad — 810 to 1080 wide —
 * then got the desktop table with half the room, and every column was
 * squeezed until words broke letter by letter ("Inacti / ve"). Cards hold
 * every field at any width; from here up the tables have space to breathe
 * (and scroll inside their frame if they still do not fit).
 */
export const CARD_LIST_MAX = 1100;
