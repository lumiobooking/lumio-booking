'use client';

import { useEffect } from 'react';

/**
 * Keep a screen current without anyone pressing reload.
 *
 * A shop opens "Your jobs" at nine, the team sends a suggestion at ten, and
 * the shop is still looking at nine o'clock's screen — the suggestion was
 * "not there" until somebody thought to refresh. This calls `fn` on a timer
 * while the page is visible, again the moment the tab or app comes back to
 * the front, and again when the network returns. Polling, not sockets:
 * fifteen salons on thirty-second polls is nothing, and it survives every
 * proxy, sleep and PWA quirk that a socket does not.
 */
export function useLive(fn: () => void | Promise<void>, everyMs = 30_000, enabled = true): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => { if (document.visibilityState === 'visible') void fn(); };
    const start = () => { if (!timer) timer = setInterval(tick, everyMs); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVis = () => { if (document.visibilityState === 'visible') { tick(); start(); } else stop(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', tick);
    window.addEventListener('online', tick);
    if (document.visibilityState === 'visible') start();
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', tick);
      window.removeEventListener('online', tick);
    };
  }, [fn, everyMs, enabled]);
}

/** A GET the memory cache must not answer: the point is what changed since last time. */
export function fresh(path: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}_=${Date.now()}`;
}
