'use client';

/**
 * The last step of every "Connect Facebook / Zalo / TikTok / Gmail / Google"
 * flow. The provider's answer was parked by the API (common/oauth-gate.service);
 * this page, signed in, hands back the one-time pair and the grant is applied
 * only if the signed-in account belongs to the salon that started the flow.
 */
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { LumioLogo } from '../../../components/LumioLogo';

const ROUTES: Record<string, string> = {
  facebook: '/messenger/oauth/confirm',
  zalo: '/zalo/oauth/confirm',
  tiktok: '/tiktok/oauth/confirm',
  gmail: '/settings/gmail/confirm',
  google: '/google-reviews/oauth/confirm',
};

function Confirm() {
  const params = useSearchParams();
  const router = useRouter();
  const { token, ready } = useAuth();
  const [err, setErr] = useState<string | null>(null);
  const p = params.get('p') ?? '';
  const n = params.get('n') ?? '';
  const c = params.get('c') ?? '';

  useEffect(() => {
    if (!ready) return;
    const route = ROUTES[p];
    if (!route || !n || !c) { setErr('Liên kết kết nối không hợp lệ. Hãy bấm Kết nối lại từ trang cài đặt.'); return; }
    if (!token) {
      try { window.sessionStorage.setItem('lumio_oauth_resume', `/oauth/confirm?${params.toString()}`); } catch { /* ignore */ }
      router.replace('/login');
      return;
    }
    let alive = true;
    apiFetch<{ redirect?: string }>(route, { method: 'POST', token, body: { n, c } })
      .then((r) => {
        if (!alive) return;
        // The page the provider flow returns to, always on THIS app (path only).
        const to = String(r?.redirect ?? '');
        try {
          const u = new URL(to, window.location.origin);
          window.location.href = u.pathname.startsWith('/') ? `${u.pathname}${u.search}${u.hash}` : '/salon';
        } catch { window.location.href = '/salon'; }
      })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : 'Không hoàn tất được kết nối.'); });
    return () => { alive = false; };
  }, [ready, token, p, n, c, params, router]);

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'var(--c0f172a)' }}>
      <div style={{ maxWidth: 420, width: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
        <LumioLogo />
        {err ? (
          <>
            <div style={{ color: 'var(--ink-bad)', fontSize: 15, lineHeight: 1.5 }}>{err}</div>
            <a href="/salon" style={{ color: 'var(--ink-link)', fontSize: 14 }}>Về trang quản lý</a>
          </>
        ) : (
          <div style={{ color: 'var(--c94a3b8)', fontSize: 15 }}>Đang hoàn tất kết nối…</div>
        )}
      </div>
    </main>
  );
}

export default function OAuthConfirmPage() {
  return (
    <Suspense fallback={null}>
      <Confirm />
    </Suspense>
  );
}
