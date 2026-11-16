'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev';

/**
 * Registers the service worker AND keeps an open tab honest about its version.
 *
 * Two independent mechanisms, because each one alone has a hole:
 *  1. Service worker: reload once when a new SW takes control. That only fires
 *     when sw.js itself changes, so it misses ordinary deploys.
 *  2. Build check: every tab remembers the build id it was compiled with and
 *     asks /api/build which build is live. A mismatch means this tab is running
 *     code from an older deploy — the exact reason a shipped fix can look like
 *     "nothing changed".
 *
 * Silent, never a bar (16/11/2026): the owner deploys several times a day and
 * did not want every salon and its customers told "Đã có bản cập nhật" each
 * time. A stale tab now moves to the new build on its own at a moment nobody
 * is typing: when it goes to the background, or on the next page change inside
 * the app (a full load of the page the person just opened). Half-typed work on
 * the current page is never thrown away.
 */
export function PwaRegister() {
  const stale = useRef(false);
  const pathname = usePathname();
  const lastPath = useRef(pathname);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      // A new service worker: same rule, never under someone's hands.
      if (document.visibilityState === 'hidden') window.location.reload();
      else stale.current = true;
    });

    let stop: (() => void) | undefined;
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.update().catch(() => {});
        const id = window.setInterval(() => reg.update().catch(() => {}), 60 * 1000);
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              sw.postMessage('SKIP_WAITING');
            }
          });
        });
        stop = () => window.clearInterval(id);
      })
      .catch(() => {});

    return () => stop?.();
  }, []);

  // ---- Deploy detection ---------------------------------------------------
  useEffect(() => {
    if (BUILD_ID === 'dev') return; // local dev reloads itself
    let cancelled = false;

    const check = async () => {
      try {
        const r = await fetch('/api/build', { cache: 'no-store' });
        const j = (await r.json()) as { buildId?: string };
        if (cancelled || !j?.buildId || j.buildId === BUILD_ID) return;
        stale.current = true;
        if (document.visibilityState === 'hidden') window.location.reload();
      } catch {
        /* offline, or the route is not deployed yet — ignore */
      }
    };
    // Moving to the background is the quiet moment to pick up the new build.
    const onHide = () => { if (stale.current && document.visibilityState === 'hidden') window.location.reload(); };

    check();
    const id = window.setInterval(check, 2 * 60 * 1000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, []);

  // The next page change inside the app loads that page fresh from the new build.
  useEffect(() => {
    if (pathname === lastPath.current) return;
    lastPath.current = pathname;
    if (stale.current) window.location.reload();
  }, [pathname]);

  return null;
}
