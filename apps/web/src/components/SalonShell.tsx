'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth';
import { useIsMobile } from '../lib/responsive';

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
 * Salon Admin layout. Desktop: fixed left sidebar. Mobile: a sticky top bar
 * with a hamburger that opens a slide-in drawer. Auth-guarded.
 */
export function SalonShell({ children }: { children: ReactNode }) {
  const { token, user, ready, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!token) router.replace('/login');
    else if (user && user.role !== 'SALON_ADMIN') router.replace('/');
  }, [ready, token, user, router]);

  // Close the drawer whenever the route changes.
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  if (!ready || !token || user?.role !== 'SALON_ADMIN') {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#94a3b8' }}>
        Loading...
      </div>
    );
  }

  const navList = (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {NAV.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setDrawerOpen(false)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '11px 12px', borderRadius: 8, fontSize: 15,
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
  );

  const footer = (
    <div style={{ marginTop: 'auto', borderTop: '1px solid #1f2937', paddingTop: 14 }}>
      <div style={{ fontSize: 12, color: '#94a3b8', padding: '0 10px 8px', wordBreak: 'break-all' }}>{user.email}</div>
      <button onClick={logout} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e2e8f0', fontSize: 14, cursor: 'pointer' }}>
        Log out
      </button>
    </div>
  );

  const brand = (
    <div style={{ padding: '4px 10px 18px' }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#e2e8f0' }}>Lumio</div>
      <div style={{ fontSize: 12, color: '#64748b' }}>Salon dashboard</div>
    </div>
  );

  // ---------------------------- Mobile ----------------------------
  if (isMobile) {
    return (
      <div style={{ minHeight: '100vh', background: '#0b1120' }}>
        {/* Sticky top bar */}
        <header style={{ position: 'sticky', top: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', background: '#111827', borderBottom: '1px solid #1f2937' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#e2e8f0' }}>Lumio</div>
          <button onClick={() => setDrawerOpen(true)} aria-label="Menu"
            style={{ width: 42, height: 42, borderRadius: 10, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontSize: 20, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
            ☰
          </button>
        </header>

        {/* Drawer + overlay */}
        {drawerOpen && (
          <>
            <div onClick={() => setDrawerOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 40 }} />
            <aside style={{ position: 'fixed', top: 0, left: 0, bottom: 0, width: 'min(82vw, 300px)', background: '#111827', borderRight: '1px solid #1f2937', padding: '18px 14px', display: 'flex', flexDirection: 'column', zIndex: 50, boxShadow: '4px 0 24px rgba(0,0,0,0.4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                {brand}
                <button onClick={() => setDrawerOpen(false)} aria-label="Close" style={{ width: 36, height: 36, borderRadius: 8, border: 'none', background: 'transparent', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>✕</button>
              </div>
              {navList}
              {footer}
            </aside>
          </>
        )}

        <main style={{ padding: '18px 16px', color: '#e2e8f0', minWidth: 0 }}>{children}</main>
      </div>
    );
  }

  // ---------------------------- Desktop ----------------------------
  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '230px 1fr', background: '#0b1120' }}>
      <aside style={{ background: '#111827', borderRight: '1px solid #1f2937', padding: '20px 14px', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh' }}>
        {brand}
        {navList}
        {footer}
      </aside>
      <main style={{ padding: '28px 32px', color: '#e2e8f0', minWidth: 0 }}>{children}</main>
    </div>
  );
}
