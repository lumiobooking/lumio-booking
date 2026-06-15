'use client';

import { ReactNode, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth';

const NAV: { href: string; label: string; icon: string }[] = [
  { href: '/salon', label: 'Dashboard', icon: '◉' },
  { href: '/salon/calendar', label: 'Calendar', icon: '▦' },
  { href: '/salon/bookings', label: 'Bookings', icon: '🗓' },
  { href: '/salon/customers', label: 'Customers', icon: '☺' },
  { href: '/salon/services', label: 'Services', icon: '✦' },
  { href: '/salon/staff', label: 'Staff', icon: '✄' },
  { href: '/salon/payments', label: 'Payments', icon: '＄' },
  { href: '/salon/notifications', label: 'Notifications', icon: '✉' },
  { href: '/salon/integrations', label: 'Integrations', icon: '⚙' },
  { href: '/salon/settings', label: 'Settings', icon: '⚙' },
];

/**
 * Salon Admin dashboard layout: left sidebar navigation + main content area.
 * Auth guard: redirects to /login (unauthenticated) or / (wrong role).
 */
export function SalonShell({ children }: { children: ReactNode }) {
  const { token, user, ready, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!ready) return;
    if (!token) router.replace('/login');
    else if (user && user.role !== 'SALON_ADMIN') router.replace('/');
  }, [ready, token, user, router]);

  if (!ready || !token || user?.role !== 'SALON_ADMIN') {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#94a3b8' }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '230px 1fr', background: '#0b1120' }}>
      {/* Sidebar */}
      <aside
        style={{
          background: '#111827',
          borderRight: '1px solid #1f2937',
          padding: '20px 14px',
          display: 'flex',
          flexDirection: 'column',
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        <div style={{ padding: '4px 10px 18px' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#e2e8f0' }}>Lumio</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>Salon dashboard</div>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 12px',
                  borderRadius: 8,
                  fontSize: 14,
                  textDecoration: 'none',
                  color: active ? 'white' : '#94a3b8',
                  background: active ? '#6366f1' : 'transparent',
                  fontWeight: active ? 600 : 500,
                }}
              >
                <span style={{ width: 18, textAlign: 'center', fontSize: 13 }}>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div style={{ marginTop: 'auto', borderTop: '1px solid #1f2937', paddingTop: 14 }}>
          <div style={{ fontSize: 12, color: '#94a3b8', padding: '0 10px 8px', wordBreak: 'break-all' }}>
            {user.email}
          </div>
          <button
            onClick={logout}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #334155',
              background: 'transparent',
              color: '#e2e8f0',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Log out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ padding: '28px 32px', color: '#e2e8f0', minWidth: 0 }}>{children}</main>
    </div>
  );
}
