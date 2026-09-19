'use client';

import { useEffect, useState } from 'react';
import { useLang } from '../lib/i18n';
import { useIsMobile } from '../lib/responsive';

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
  // "Để sau" is not "never": the bar covers content, so it has to be
  // dismissable, but a tab left on an old build is the thing this exists to
  // stop — so it comes back in ten minutes.
  const [snoozed, setSnoozed] = useState(false);
  const { lang } = useLang();
  const L = (vi: string, en: string) => (lang === 'vi' ? vi : en);
  const isMobile = useIsMobile();

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

  if (!stale || snoozed) return null;

  return (
    <div
      role="status"
      style={{
        position: 'fixed', zIndex: 9999,
        left: '50%', transform: 'translateX(-50%)',
        // Above the mobile tab bar, not on top of it. The public booking pages
        // keep their own fixed bar at the same edge, so the lift helps there too.
        bottom: isMobile ? 'calc(72px + env(safe-area-inset-bottom, 0px))' : 22,
        width: 'max-content', maxWidth: 'calc(100vw - 24px)',
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '9px 8px 9px 14px',
        borderRadius: 14,
        background: 'var(--c1e1b4b)', border: '1px solid #4f46e5',
        boxShadow: '0 12px 32px rgba(0,0,0,.45)',
        color: 'var(--ce0e7ff)', fontSize: 13.5, fontWeight: 600,
        animation: 'lumio-toast-in .18s ease-out',
      }}
    >
      <span aria-hidden style={{ fontSize: 15, lineHeight: 1, flexShrink: 0 }}>↻</span>
      {/* One line, one language, ellipsis before it ever wraps — a three-line
          lozenge with the word "Reload" broken in half was the old shape. */}
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {L('Đã có bản cập nhật', 'A new version is ready')}
      </span>
      <button
        onClick={() => window.location.reload()}
        style={{
          flexShrink: 0, whiteSpace: 'nowrap',
          border: 'none', borderRadius: 10, padding: '7px 14px', cursor: 'pointer',
          background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 700,
        }}
      >
        {L('Tải lại', 'Reload')}
      </button>
      <button
        onClick={() => { setSnoozed(true); window.setTimeout(() => setSnoozed(false), 10 * 60 * 1000); }}
        aria-label={L('Để sau', 'Later')}
        title={L('Để sau', 'Later')}
        style={{
          flexShrink: 0, width: 28, height: 28, borderRadius: 8,
          border: 'none', background: 'transparent', color: 'var(--ca5b4fc)',
          fontSize: 17, lineHeight: 1, cursor: 'pointer',
        }}
      >
        ×
      </button>
    </div>
  );
}
