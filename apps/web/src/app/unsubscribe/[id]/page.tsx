'use client';

// One-click unsubscribe. No login, no "are you sure", no dark patterns — the law
// (CAN-SPAM / CASL) and basic decency both require it to just work.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://lumio-api-uqm6.onrender.com/api';

export default function UnsubscribePage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? '');
  const [state, setState] = useState<'working' | 'done' | 'error'>('working');
  const [info, setInfo] = useState<{ email?: string; brand?: string }>({});

  useEffect(() => {
    if (!id) return;
    if (id === 'preview') { setState('done'); setInfo({ brand: 'Lumio Booking', email: 'you@example.com' }); return; }
    fetch(`${API}/public/unsubscribe/${encodeURIComponent(id)}`, { method: 'POST' })
      .then((r) => r.json())
      .then((r) => { if (r?.ok) { setInfo(r); setState('done'); } else setState('error'); })
      .catch(() => setState('error'));
  }, [id]);

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f1f5f9', padding: 20,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 480, background: '#fff', borderRadius: 16, padding: '36px 32px',
        textAlign: 'center', boxShadow: '0 8px 40px rgba(15,23,42,0.12)' }}>
        {state === 'working' && <p style={{ color: '#64748b', margin: 0 }}>Working…</p>}

        {state === 'done' && (
          <>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#dcfce7', color: '#16a34a',
              display: 'grid', placeItems: 'center', fontSize: 28, margin: '0 auto 18px' }}>✓</div>
            <h1 style={{ fontSize: 22, margin: '0 0 10px', color: '#0f172a' }}>You&rsquo;re unsubscribed</h1>
            <p style={{ color: '#475569', fontSize: 15, lineHeight: 1.6, margin: 0 }}>
              {info.email ? <><b>{info.email}</b> will not </> : 'You will not '}
              receive marketing emails from {info.brand || 'us'} again. Appointment confirmations and reminders are not affected.
            </p>
          </>
        )}

        {state === 'error' && (
          <>
            <h1 style={{ fontSize: 20, margin: '0 0 10px', color: '#0f172a' }}>Link not recognised</h1>
            <p style={{ color: '#475569', fontSize: 15, lineHeight: 1.6, margin: 0 }}>
              This unsubscribe link is no longer valid. Reply to the email and we&rsquo;ll take you off the list by hand.
            </p>
          </>
        )}

        <p style={{ color: '#94a3b8', fontSize: 12, margin: '24px 0 0' }}>Powered by Lumio Booking</p>
      </div>
    </main>
  );
}
