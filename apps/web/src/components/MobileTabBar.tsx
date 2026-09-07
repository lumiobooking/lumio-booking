'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';
import { useLang } from '../lib/i18n';

// Icon paths (stroke, 24x24). Kept inline so the tab bar has no extra deps.
const IC: Record<string, string> = {
  home: 'M3 10l9-7 9 7v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z',
  cal: 'M3 4h18v17H3zM8 2v4M16 2v4M3 10h18',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  card: 'M2 5h20v14H2zM2 10h20',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  check: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
};

function Icon({ d, active }: { d: string; active: boolean }) {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke={active ? 'var(--c818cf8)' : 'var(--c94a3b8)'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {d.split('M').filter(Boolean).map((seg, i) => <path key={i} d={'M' + seg} />)}
    </svg>
  );
}

/**
 * Bottom tab bar for the salon admin on phones. Shows the 5 things owners need
 * on the go — everything else (settings, staff, integrations…) stays in the top
 * hamburger and on desktop.
 *
 * Alerts are not one of the five: the bell at the top of every screen already
 * is the alerts button, and a second one at the bottom was a tab spent on a
 * thing the owner could already reach. Its slot went to "Duyệt bài" — the one
 * thing Lumio needs the owner to do on the phone, most days — and the unread
 * count moved onto that tab: how many posts are waiting for a yes.
 */
export function MobileTabBar() {
  const { token } = useAuth();
  const { lang } = useLang();
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const L = (vi: string, en: string) => (lang === 'vi' ? vi : en);

  const pos = typeof window !== 'undefined' && window.localStorage.getItem('lumio_pos_enabled') === '1';

  const tabs = [
    { href: '/salon', label: L('Tổng quan', 'Home'), icon: IC.home, exact: true },
    { href: '/salon/calendar', label: L('Lịch', 'Calendar'), icon: IC.cal },
    pos
      ? { href: '/salon/pos', label: L('Tính tiền', 'Checkout'), icon: IC.card }
      : { href: '/salon/bookings', label: L('Lịch hẹn', 'Bookings'), icon: IC.list },
    { href: '/salon/approve-posts', label: L('Duyệt bài', 'Approve'), icon: IC.check, badge: true },
    pos
      ? { href: '/salon/pos/report', label: L('Báo cáo', 'Reports'), icon: IC.chart }
      : { href: '/salon/customers', label: L('Khách', 'Clients'), icon: IC.users },
  ];

  // Posts waiting for the owner's yes — the same count the tab header shows.
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const load = () => apiFetch<{ waiting?: number }>('/content/review', { token })
      .then((r) => { if (alive && r && typeof r.waiting === 'number') setUnread(r.waiting); })
      .catch(() => undefined);
    load();
    const iv = window.setInterval(load, 60000);
    window.addEventListener('focus', load);
    return () => { alive = false; window.clearInterval(iv); window.removeEventListener('focus', load); };
  }, [token, pathname]);

  const onAlerts = pathname === '/salon/approve-posts';

  return (
    <nav style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60, display: 'flex', background: 'var(--c111827)', borderTop: '1px solid var(--c1f2937)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {tabs.map((t) => {
        const active = t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(t.href + '/');
        return (
          <Link key={t.href} href={t.href} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '9px 2px 11px', textDecoration: 'none', color: active ? 'var(--c818cf8)' : 'var(--c94a3b8)', fontSize: 10.5, fontWeight: 600 }}>
            <span style={{ position: 'relative', lineHeight: 0 }}>
              <Icon d={t.icon} active={active} />
              {t.badge && unread > 0 && !onAlerts && (
                <span style={{ position: 'absolute', top: -6, right: -9, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999, background: '#ef4444', color: '#fff', fontSize: 9.5, fontWeight: 800, display: 'grid', placeItems: 'center', border: '1.5px solid var(--c111827)' }}>{unread > 9 ? '9+' : unread}</span>
              )}
            </span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
