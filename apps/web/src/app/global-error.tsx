'use client';

import { useEffect, useState } from 'react';
import { isStaleBuild, reloadOnceForStaleBuild } from '../lib/stale-build';

/**
 * Same idea as error.tsx, for crashes in the root layout itself — which is
 * exactly where a stale tab lands after a deploy ("Loading chunk … failed"
 * on app/layout-*.js). That case reloads itself once; see lib/stale-build.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = useStaleReload(error);
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 560, width: '100%' }}>
          <h1 style={{ fontSize: 20, margin: '0 0 6px' }}>{stale ? 'Lumio vừa cập nhật · Lumio was just updated' : 'Có lỗi xảy ra · Something broke'}</h1>
          <p style={{ fontSize: 14, color: '#94a3b8', margin: '0 0 14px' }}>
            {stale
              ? 'Trang này mở từ trước bản cập nhật. Bấm "Tải lại" là xong, không mất gì. · This tab predates the update. Press "Reload" — nothing is lost.'
              : 'Chụp màn hình này gửi cho đội Lumio. · Screenshot this for the Lumio team.'}
          </p>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, lineHeight: 1.5, background: '#1e293b', border: '1px solid #334155', borderRadius: 10, padding: 12, maxHeight: 260, overflow: 'auto', color: '#fbbf24' }}>
            {String(error?.message || error)}{error?.digest ? `\n\ndigest: ${error.digest}` : ''}{'\n\n'}{String(error?.stack || '').slice(0, 800)}
          </pre>
          <button onClick={() => (stale ? window.location.reload() : reset())} style={{ marginTop: 14, width: '100%', padding: '12px 16px', borderRadius: 10, border: 'none', background: '#6366f1', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
            {stale ? 'Tải lại · Reload' : 'Thử lại · Try again'}
          </button>
        </div>
      </body>
    </html>
  );
}

function useStaleReload(error: unknown): boolean {
  const [stale] = useState(() => isStaleBuild(error));
  useEffect(() => { if (stale) reloadOnceForStaleBuild(); }, [stale]);
  return stale;
}
