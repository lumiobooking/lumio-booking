'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker and keeps the installed app up to date.
 * When a new version is deployed, the new SW activates and we reload once
 * automatically — so users never get stuck on a stale cached build.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    let refreshing = false;
    // When the new SW takes control, reload once to load the fresh assets.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Check for a new version now and every minute while the app is open.
        reg.update().catch(() => {});
        const id = setInterval(() => reg.update().catch(() => {}), 60 * 1000);

        // If an updated SW is found, tell it to activate immediately.
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              sw.postMessage('SKIP_WAITING');
            }
          });
        });

        return () => clearInterval(id);
      })
      .catch(() => {});
  }, []);

  return null;
}
