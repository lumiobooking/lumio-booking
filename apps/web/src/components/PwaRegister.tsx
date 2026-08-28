'use client';

import { useEffect, useState } from 'react';

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
 *     "nothing changed". We reload silently when the tab is in the background
 *     and offer a reload bar when it is in use, so nobody loses half-typed work.
 */
export function PwaRegister() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
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
        if (document.visibilityState === 'hidden') window.location.reload();
        else setStale(true);
      } catch {
        /* offline, or the route is not deployed yet — ignore */
      }
    };

    check();
    const id = window.setInterval(check, 2 * 60 * 1000);
    window.addEventListener('focus', check);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('focus', check);
    };
  }, []);

  if (!stale) return null;

  return (
    <div
      style={{
        position: 'fixed', left: '50%', bottom: 18, transform: 'translateX(-50%)',
        zIndex: 9999, display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--c1e1b4b)', border: '1px solid #6366f1', borderRadius: 999,
        padding: '9px 10px 9px 16px', boxShadow: '0 10px 30px rgba(0,0,0,.45)',
        color: 'var(--ce0e7ff)', fontSize: 13.5, fontWeight: 600,
      }}
    >
      <span>Đã có bản cập nhật mới · A new version is available</span>
      <button
        onClick={() => window.location.reload()}
        style={{
          border: 'none', borderRadius: 999, padding: '7px 16px', cursor: 'pointer',
          background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 700,
        }}
      >
        Tải lại / Reload
      </button>
    </div>
  );
}
