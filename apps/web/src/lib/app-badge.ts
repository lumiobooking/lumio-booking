/**
 * The red number on the app icon (iPhone home screen, Android, desktop PWA).
 * Badging API: iOS 16.4+ for an app added to the home screen, Chrome/Edge.
 * The service worker raises it on every push (public/sw.js); the open app sets
 * it to what is really unread, and clears it when nothing is.
 */
type BadgeNav = Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

export function setAppBadge(n: number): void {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as BadgeNav;
  try {
    if (n > 0) void nav.setAppBadge?.(n)?.catch(() => undefined);
    else void nav.clearAppBadge?.()?.catch(() => undefined);
  } catch { /* not supported here */ }
  // The worker keeps its own running count for pushes that arrive while the app is closed.
  try { navigator.serviceWorker?.controller?.postMessage({ type: 'BADGE', count: Math.max(0, n) }); } catch { /* no worker */ }
}
