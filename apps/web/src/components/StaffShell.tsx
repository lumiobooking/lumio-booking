'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';
import { useLang } from '../lib/i18n';
import { useIsMobile } from '../lib/responsive';
import { ThemeToggle } from './ThemeToggle';
import { LumioLogo } from './LumioLogo';
import { IC, Icon, TAB_H, BOTTOM_SAFE } from './staff/kit';

/**
 * Layout + auth guard for the Staff (technician) portal.
 *
 * Technicians are the most phone-bound people in the product: they read this
 * standing at a chair, one-handed, between clients. On a phone the portal is
 * therefore an app, not a web page — four tabs along the bottom, where the
 * thumb already is (Hôm nay · Lịch · Lượt · Tôi), and a short header. A row
 * of six buttons at the TOP of the screen, which is what this used to be, is
 * the hardest place on a phone to reach. On a computer it keeps a top bar.
 */
export function StaffShell({ children, title = 'My Bookings', subtitle, right, wide = false }: {
  children: ReactNode; title?: string; subtitle?: ReactNode; right?: ReactNode; wide?: boolean;
}) {
  const { token, user, ready, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const { lang } = useLang();
  const vi = lang === 'vi';
  const isMobile = useIsMobile(720);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (!ready) return;
    if (!token) {
      router.replace('/login');
    } else if (user && user.role !== 'STAFF') {
      router.replace('/');
    }
  }, [ready, token, user, router]);

  // The salon's timezone, cached where every date helper reads it — so the
  // technician's schedule shows the SALON's hours even from another timezone.
  useEffect(() => {
    if (!token) return;
    apiFetch<{ timezone?: string }>('/me/tenant', { token })
      .then((r) => { if (r?.timezone) { try { window.localStorage.setItem('lumio_tz', r.timezone); } catch { /* ignore */ } } })
      .catch(() => { /* offline: yesterday's cached value still applies */ });
  }, [token]);

  // Bookings waiting for her yes: the number on the Lịch tab.
  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiFetch<{ startTime: string }[]>('/bookings/my?status=ASSIGNED', { token })
      .then((r) => { if (alive && Array.isArray(r)) setPending(r.filter((b) => new Date(b.startTime).getTime() > Date.now() - 3600_000).length); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [token, pathname]);

  if (!ready || !token || user?.role !== 'STAFF') {
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', color: 'var(--c94a3b8)' }}>
        Loading...
      </div>
    );
  }

  const tabs = [
    { href: '/staff/today', label: vi ? 'Hôm nay' : 'Today', icon: IC.home, also: ['/staff/chair'] },
    { href: '/staff/bookings', label: vi ? 'Lịch' : 'Schedule', icon: IC.calendar, badge: pending },
    { href: '/staff/turns', label: vi ? 'Lượt' : 'Turns', icon: IC.turns },
    { href: '/staff/me', label: vi ? 'Tôi' : 'Me', icon: IC.me, also: ['/staff/profile', '/staff/tips', '/staff/reviews', '/staff/inbox'] },
  ];
  const isOn = (t: { href: string; also?: string[] }) => pathname === t.href || pathname.startsWith(t.href + '/') || (t.also ?? []).some((a) => pathname.startsWith(a));

  if (isMobile) {
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--c0b1120)' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 'calc(14px + env(safe-area-inset-top, 0px)) 16px 10px' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--ce2e8f0)', lineHeight: 1.2 }}>{title}</h1>
            {subtitle && <div style={{ color: 'var(--c94a3b8)', fontSize: 13, marginTop: 2 }}>{subtitle}</div>}
          </div>
          {right}
        </header>
        <main style={{ padding: '4px 16px 0', paddingBottom: `calc(${TAB_H + 24}px + ${BOTTOM_SAFE})` }}>
          {children}
        </main>
        <nav aria-label={vi ? 'Mục chính' : 'Main'} style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 120, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          background: 'var(--c0f172a)', borderTop: '1px solid var(--line)', paddingBottom: BOTTOM_SAFE,
        }}>
          {tabs.map((t) => {
            const on = isOn(t);
            return (
              <Link key={t.href} href={t.href} aria-current={on ? 'page' : undefined}
                style={{ height: TAB_H - 6, margin: '3px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, position: 'relative', textDecoration: 'none', color: on ? 'var(--ink-link)' : 'var(--c94a3b8)' }}>
                <Icon d={t.icon} size={24} stroke={on ? 2.4 : 1.8} />
                <span style={{ fontSize: 12, fontWeight: on ? 700 : 500 }}>{t.label}</span>
                {!!t.badge && (
                  <span style={{ position: 'absolute', top: 2, left: '54%', minWidth: 18, height: 18, padding: '0 5px', boxSizing: 'border-box', borderRadius: 999, background: '#f59e0b', color: '#1c1405', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {t.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    );
  }

  return (
    // The inbox needs the whole screen; 900px would squeeze four columns into
    // a letterbox. Everything else keeps the readable column it had.
    <div style={{ maxWidth: wide ? 1500 : 900, margin: '0 auto', padding: '20px 16px', paddingBottom: 'calc(28px + env(safe-area-inset-bottom, 0px))' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>{title}</h1>
          <p style={{ color: 'var(--c94a3b8)', margin: '4px 0 0', fontSize: 13 }}>
            {subtitle ?? <>{vi ? 'Thợ' : 'Technician'} · {user.email}</>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <ThemeToggle />
          {tabs.map((t) => (
            <Link key={t.href} href={t.href} style={{ ...navBtn, ...(isOn(t) ? { borderColor: '#6366f1', color: 'var(--ink-link)' } : null) }}>
              {t.label}{t.badge ? ` (${t.badge})` : ''}
            </Link>
          ))}
          <button onClick={logout} style={{ ...navBtn, background: 'transparent', cursor: 'pointer' }}>
            {vi ? 'Đăng xuất' : 'Log out'}
          </button>
        </div>
      </header>
      {children}
      <a href="https://lumioagency.com/" target="_blank" rel="noopener noreferrer"
        style={{ display: 'block', textAlign: 'center', marginTop: 28, fontSize: 11, color: 'var(--c64748b)', textDecoration: 'none' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>Powered by <LumioLogo size={14} wordmark={false} /> <span style={{ color: 'var(--c818cf8)', fontWeight: 600 }}>Lumio Booking</span></span>
      </a>
    </div>
  );
}

const navBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: '1px solid var(--c475569)',
  background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 13, textDecoration: 'none',
};
