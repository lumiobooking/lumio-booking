import { useEffect, useRef } from 'react';

/**
 * Keeps a page live without a manual reload.
 *
 * - Re-runs `refresh` every `intervalMs` (default 20s).
 * - Re-runs it immediately when the tab regains focus or becomes visible again,
 *   so switching back to Lumio always shows the latest data at once.
 * - Pauses the interval while the tab is hidden, so we don't waste requests on
 *   background tabs.
 *
 * `refresh` is read through a ref, so passing a fresh closure each render does
 * NOT restart the interval — only `intervalMs` does.
 */
export function useLiveRefresh(refresh: () => void, intervalMs = 20000) {
  const ref = useRef(refresh);
  ref.current = refresh;

  useEffect(() => {
    if (typeof document === 'undefined') return; // SSR guard
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = () => ref.current();
    const start = () => { if (timer == null) timer = setInterval(() => { if (!document.hidden) run(); }, intervalMs); };
    const stop = () => { if (timer != null) { clearInterval(timer); timer = null; } };

    const onVisibility = () => {
      if (document.hidden) { stop(); }
      else { run(); start(); } // came back → refresh now, then resume polling
    };
    const onFocus = () => run();

    start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [intervalMs]);
}
