'use client';

import { ReactNode, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth';

/** Layout + auth guard for the Staff (technician) portal. */
export function StaffShell({ children }: { children: ReactNode }) {
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
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#94a3b8' }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 24px' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>My Bookings</h1>
          <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: 13 }}>
            Technician · {user.email}
          </p>
        </div>
        <button
          onClick={logout}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid #475569',
            background: 'transparent',
            color: '#e2e8f0',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Log out
        </button>
      </header>
      {children}
    </div>
  );
}
