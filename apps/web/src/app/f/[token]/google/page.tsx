'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { appDeepLink } from '../../../../components/feedback/FeedbackFlow';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';

/**
 * /f/<token>/google — where the iPad's QR and the "text me the link" message
 * point. Counts the tap, then shows ONE button: iOS only opens the Google Maps
 * app (where the customer is signed in) from a real tap, never from a script
 * redirect, so we do not auto-redirect on iPhone.
 */
export default function GoogleHop() {
  const { token } = useParams<{ token: string }>();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/public/feedback/${encodeURIComponent(token)}/google`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(async (r) => { const d = await r.json(); if (!r.ok || !d.url) throw new Error(); setUrl(d.url);
        // Android and desktop follow a script redirect into Maps fine; iPhone needs the tap.
        if (!/iPhone|iPad|iPod/i.test(navigator.userAgent || '')) window.location.replace(appDeepLink(d.url)); })
      .catch(() => setFailed(true));
  }, [token]);

  return (
    <main style={{ minHeight: '100dvh', background: '#faf9f7', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'system-ui, -apple-system, sans-serif', color: '#1c1917', textAlign: 'center' }}>
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ color: '#f5b301', fontSize: 30, letterSpacing: 6 }}>★★★★★</div>
        <p style={{ fontSize: 17, lineHeight: 1.5, color: '#44403c', margin: '14px 0 22px' }}>{failed ? 'This link isn’t valid any more.' : 'Thank you! One tap opens Google — you’re already signed in.'}</p>
        {url && (
          <a href={appDeepLink(url)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 58, borderRadius: 999, background: '#4285f4', color: '#fff', fontWeight: 700, fontSize: 17.5, textDecoration: 'none' }}>
            Write a Google review
          </a>
        )}
      </div>
    </main>
  );
}
