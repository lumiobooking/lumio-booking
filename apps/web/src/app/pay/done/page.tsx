'use client';

/**
 * /pay/done — where Stripe, PayPal and Clover send the customer back after
 * paying a deposit (Square and Helcim have their own pages). The booking tab
 * is still open and confirms the payment with our server; this page nudges
 * the same check once (the server asks the provider, never this page) and
 * says what to do: go back to the booking.
 */
import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8005/api';

export default function PayDonePage() {
  const [state, setState] = useState<'checking' | 'paid' | 'pending'>('checking');
  const [slug, setSlug] = useState('');

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get('s') ?? '';
    const b = q.get('b') ?? '';
    setSlug(s);
    if (!s || !b) { setState('pending'); return; }
    let stop = false;
    (async () => {
      for (let i = 0; i < 4 && !stop; i++) {
        try {
          const r = await fetch(`${API_URL}/public/salons/${encodeURIComponent(s)}/bookings/${encodeURIComponent(b)}/online-confirm`, { method: 'POST' });
          const j = await r.json().catch(() => null);
          if (j?.ok) { setState('paid'); return; }
        } catch { /* keep trying a moment */ }
        await new Promise((res) => setTimeout(res, 2500));
      }
      if (!stop) setState('pending');
    })();
    return () => { stop = true; };
  }, []);

  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#f4f6fa', padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: '#fff', borderRadius: 18, padding: 28, maxWidth: 420, width: '100%', textAlign: 'center', boxShadow: '0 20px 50px -30px rgba(15,23,42,.5)', color: '#0f172a' }}>
        <div style={{ fontSize: 44 }}>{state === 'paid' ? '✅' : state === 'checking' ? '⏳' : '🧾'}</div>
        <h1 style={{ fontSize: 20, margin: '10px 0 6px' }}>
          {state === 'paid' ? 'Payment received · Đã nhận thanh toán' : state === 'checking' ? 'Checking your payment… · Đang kiểm tra…' : 'Thank you · Cảm ơn bạn'}
        </h1>
        <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, margin: 0 }}>
          {state === 'pending'
            ? 'If you completed the payment, your booking page will show it in a moment. · Nếu bạn đã thanh toán xong, trang đặt lịch sẽ hiện trong giây lát.'
            : 'You can close this tab and go back to your booking. · Bạn có thể đóng tab này và quay lại trang đặt lịch.'}
        </p>
        {slug && (
          <a href={`/book/${encodeURIComponent(slug)}`} style={{ display: 'block', marginTop: 18, padding: '12px 16px', borderRadius: 12, background: '#4f46e5', color: '#fff', fontWeight: 700, textDecoration: 'none' }}>
            Back to booking · Quay lại đặt lịch
          </a>
        )}
      </div>
    </main>
  );
}
