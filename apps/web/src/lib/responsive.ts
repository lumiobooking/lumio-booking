'use client';

import { useEffect, useState } from 'react';

/**
 * Returns true when the viewport is at or below `breakpoint` (px).
 * Used to switch inline-style layouts between desktop and mobile.
 * SSR-safe: starts false, updates on mount + resize.
 */
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [breakpoint]);

  return isMobile;
}
