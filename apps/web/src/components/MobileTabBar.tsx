'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';
import { useLang } from '../lib/i18n';

interface ActivityItem { id: string; type: string; at: string }

const ACT_SEEN_KEY = 'lumio_activity_seen';

// Icon paths (stroke, 24x24). Kept inline so the tab bar has no extra deps.
const IC: Record<string, string> = {
  home: 'M3 10l9-7 9 7v9a2 2 0 0 1-2 2h-4v-6H9v6H5a2 2 0 0 1-2-2z',
  cal: 'M3 4h18v17H3zM8 2v4M16 2v4M3 10h18',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  card: 'M2 5h20v14H2zM2 10h20',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
};

function Icon({ d, active }: { d: string; active: boolean }) {
  return (
    <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke={active ? '#818cf8' : '#94a3b8'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {d.split('M').filter(Boolean).map((seg, i) => <path key={i} d={'M' + seg} />)}
    </svg>
  );
}

/**
 * Bottom tab bar for the salon admin on phones. Shows the 5 things owners need
 * on the go — everything else (settings, staff, integrations…) stays in the top
 * hamburger and on desktop. The "Thông báo" tab carries an unread badge that
 * polls the activity feed, so a new booking pings the owner without opening email.
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
    { href: '/salon/activity', label: L('Thông báo', 'Alerts'), icon: IC.bell, badge: true },
    pos
      ? { href: '/salon/pos/report', label: L('Báo cáo', 'Reports'), icon: IC.chart }
      : { href: '/salon/customers', label: L('Khách', 'Clients'), icon: IC.users },
    pos
      ? { href: '/salon/pos', label: L('Tính tiền', 'Checkout'), icon: IC.card }
      : { href: '/salon/bookings', label: L('Lịch hẹn', 'Bookings'), icon: IC.list },
  ];

  useEffect(() => {
    if (!token) return;
    let alive = true;
    const compute = (items: ActivityItem[]) => {
      let seen = 0;
      try { seen = new Date(window.localStorage.getItem(ACT_SEEN_KEY) || 0).getTime(); } catch { seen = 0; }
      setUnread(items.filter((i) => new Date(i.at).getTime() > seen).length);
    };
    const load = () => apiFetch<ActivityItem[]>('/activity', { token })
      .then((items) => { if (alive && Array.isArray(items)) compute(items); })
      .catch(() => undefined);
    load();
    const iv = window.setInterval(load, 45000);
    const onSeen = () => setUnread(0);
    window.addEventListener('lumio-activity-seen', onSeen);
    window.addEventListener('focus', load);
    return () => { alive = false; window.clearInterval(iv); window.removeEventListener('lumio-activity-seen', onSeen); window.removeEventListener('focus', load); };
  }, [token]);

  const onAlerts = pathname === '/salon/activity';

  return (
    <nav style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60, display: 'flex', background: '#111827', borderTop: '1px solid #1f2937', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {tabs.map((t) => {
        const active = t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(t.href + '/');
        return (
          <Link key={t.href} href={t.href} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '9px 2px 11px', textDecoration: 'none', color: active ? '#818cf8' : '#94a3b8', fontSize: 10.5, fontWeight: 600 }}>
            <span style={{ position: 'relative', lineHeight: 0 }}>
              <Icon d={t.icon} active={active} />
              {t.badge && unread > 0 && !onAlerts && (
                <span style={{ position: 'absolute', top: -6, right: -9, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999, background: '#ef4444', color: '#fff', fontSize: 9.5, fontWeight: 800, display: 'grid', placeItems: 'center', border: '1.5px solid #111827' }}>{unread > 9 ? '9+' : unread}</span>
              )}
            </span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
