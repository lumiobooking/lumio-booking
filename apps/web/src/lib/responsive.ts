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
