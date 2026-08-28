'use client';

import { ReactNode, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth';
import { InboxNavLink } from './InboxAlerts';
import { ThemeToggle } from './ThemeToggle';

/** Layout + auth guard for the Staff (technician) portal. */
export function StaffShell({ children, title = 'My Bookings', wide = false }: { children: ReactNode; title?: string; wide?: boolean }) {
  const { token, user, ready, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    if (!token) {
      router.replace('/login');
    } else if (user && user.role !== 'STAFF') {
      router.replace('/');
    }
  }, [ready, token, user, router]);

  if (!ready || !token || user?.role !== 'STAFF') {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: 'var(--c94a3b8)' }}>
        Loading...
      </div>
    );
  }

  return (
    // The inbox needs the whole screen; 900px would squeeze four columns into
    // a letterbox. Everything else keeps the readable column it had.
    <div style={{ maxWidth: wide ? 1500 : 900, margin: '0 auto', padding: '20px 16px' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>{title}</h1>
          <p style={{ color: 'var(--c94a3b8)', margin: '4px 0 0', fontSize: 13 }}>
            Technician · {user.email}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <ThemeToggle />
          <InboxNavLink />
          <a href="/staff/bookings" style={navBtn}>My bookings</a>
          <a href="/staff/chair" style={navBtn}>🪑 My chair</a>
          <a href="/staff/reviews" style={navBtn}>My reviews</a>
          <a href="/staff/profile" style={navBtn}>My profile</a>
          <a href="/staff/tips" style={navBtn}>💸 Tips</a>
          <button
            onClick={logout}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid var(--c475569)',
              background: 'transparent',
              color: 'var(--ce2e8f0)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Log out
          </button>
        </div>
      </header>
      {children}
      <a href="https://lumioagency.com/" target="_blank" rel="noopener noreferrer"
        style={{ display: 'block', textAlign: 'center', marginTop: 28, fontSize: 11, color: 'var(--c64748b)', textDecoration: 'none' }}>
        Powered by <span style={{ color: 'var(--c818cf8)', fontWeight: 600 }}>Lumio Booking</span>
      </a>
    </div>
  );
}

const navBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: '1px solid var(--c475569)',
  background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 13, textDecoration: 'none',
};
