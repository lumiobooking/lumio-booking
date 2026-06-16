'use client';

import Link from 'next/link';

const INK = '#0f172a';
const INDIGO = '#6366f1';

export default function WelcomePage() {
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
      <div style={{ background: '#fff', borderRadius: 24, padding: '44px 36px', maxWidth: 520, textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#dcfce7', display: 'grid', placeItems: 'center', margin: '0 auto 20px', fontSize: 36 }}>🎉</div>
        <h1 style={{ fontSize: 28, margin: 0, color: INK, letterSpacing: -0.5 }}>Welcome to Lumio Booking!</h1>
        <p style={{ color: '#475569', fontSize: 16, lineHeight: 1.55, margin: '14px 0 0' }}>
          Your payment is being confirmed and your salon account is being activated — this usually takes just a few seconds.
          Sign in with the email and password you just created to set up your salon.
        </p>

        <Link href="/login" style={{ display: 'inline-block', background: INDIGO, color: '#fff', fontWeight: 700, fontSize: 16, padding: '14px 32px', borderRadius: 12, textDecoration: 'none', marginTop: 26 }}>
          Sign in to your dashboard →
        </Link>

        <div style={{ marginTop: 26, padding: 16, background: '#f8fafc', borderRadius: 12, textAlign: 'left' }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#334155', marginBottom: 8 }}>Your first steps</div>
          <ol style={{ margin: 0, paddingLeft: 18, color: '#475569', fontSize: 14, lineHeight: 1.7 }}>
            <li>Add your services, prices and staff</li>
            <li>Set your working hours and share your booking link</li>
            <li>Connect payments &amp; turn on loyalty rewards</li>
          </ol>
        </div>

        <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 22 }}>
          If you can't sign in right away, wait a moment and refresh — activation completes as soon as the payment confirms.
        </p>
      </div>
    </div>
  );
}
