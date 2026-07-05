'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';
import { useIsMobile } from '../lib/responsive';
import { useLang, tr, NAV_KEY } from '../lib/i18n';
import { InstallAppButton } from './InstallAppButton';
import { ShareBookingLink } from './ShareBookingLink';

// `feature: 'pos'` items only show when the salon's plan unlocks the POS suite.
const NAV: { href: string; label: string; icon: string; feature?: 'pos' }[] = [
  { href: '/salon', label: 'Dashboard', icon: '◉' },
  { href: '/salon/pos', label: 'POS / Checkout', icon: '🧾', feature: 'pos' },
  { href: '/salon/orders', label: 'Orders', icon: '📋', feature: 'pos' },
  { href: '/salon/calendar', label: 'Calendar', icon: '▦' },
  { href: '/salon/bookings', label: 'Bookings', icon: '🗓' },
  { href: '/salon/walkins', label: 'Walk-ins · Turns', icon: '🔄' },
  { href: '/salon/waitlist', label: 'Waitlist', icon: '⏳' },
  { href: '/salon/customers', label: 'Customers', icon: '☺' },
  { href: '/salon/services', label: 'Services', icon: '✦' },
  { href: '/salon/products', label: 'Products', icon: '🛍', feature: 'pos' },
  { href: '/salon/gift-cards', label: 'Gift cards', icon: '🎁', feature: 'pos' },
  { href: '/salon/staff', label: 'Staff', icon: '✄' },
  { href: '/salon/payroll', label: 'Lương thợ · Payroll', icon: '💵', feature: 'pos' },
  { href: '/salon/reviews', label: 'Reviews & rewards', icon: '★' },
  { href: '/salon/reviews-replies', label: 'Google reviews', icon: '💬' },
  { href: '/salon/messenger', label: 'Messenger bot', icon: '🤖' },
  { href: '/salon/voice', label: 'AI Hotline', icon: '📞' },
  { href: '/salon/marketing', label: 'Marketing', icon: '📣' },
  { href: '/salon/inventory', label: 'Inventory', icon: '📦', feature: 'pos' },
  { href: '/salon/pos/report', label: 'Sales report', icon: '📊', feature: 'pos' },
  { href: '/salon/payments', label: 'Payments', icon: '＄' },
  { href: '/salon/notifications', label: 'Notifications', icon: '✉' },
  { href: '/salon/integrations', label: 'Integrations', icon: '⚙' },
  { href: '/salon/billing', label: 'Billing & plan', icon: '💳' },
  { href: '/salon/settings', label: 'Settings', icon: '⚙' },
];

// Each nav route → the feature capability needed to use it (RBAC). Routes not
// listed need no capability. Must match the backend capability names.
const HREF_CAP: Record<string, string> = {
  '/salon': 'dashboard', '/salon/pos': 'pos', '/salon/orders': 'orders',
  '/salon/calendar': 'calendar', '/salon/bookings': 'bookings', '/salon/walkins': 'walkins',
  '/salon/waitlist': 'waitlist', '/salon/customers': 'customers', '/salon/services': 'services',
  '/salon/products': 'products', '/salon/gift-cards': 'pos', '/salon/staff': 'staff', '/salon/payroll': 'payroll',
  '/salon/reviews': 'reviews', '/salon/marketing': 'marketing', '/salon/inventory': 'inventory',
  '/salon/pos/report': 'reports', '/salon/payments': 'payments', '/salon/notifications': 'notifications',
  '/salon/integrations': 'integrations', '/salon/billing': 'billing', '/salon/settings': 'settings',
  '/salon/chain': 'reports', // multi-branch consolidated report
};
const ALL_CAPS = Object.values(HREF_CAP);

// Remember the salon's POS entitlement between page loads so the nav renders
// the correct items immediately (no flash of locked items).
const POS_CACHE_KEY = 'lumio_pos_enabled';
function readCachedPos(): boolean | null {
  if (typeof window === 'undefined') return null;
  const v = window.localStorage.getItem(POS_CACHE_KEY);
  return v === null ? null : v === '1';
}
function writeCachedPos(on: boolean) {
  if (typeof window !== 'undefined') window.localStorage.setItem(POS_CACHE_KEY, on ? '1' : '0');
}

/**
 * Salon Admin layout. Desktop: fixed left sidebar. Mobile: a sticky top bar
 * with a hamburger that opens a slide-in drawer. Auth-guarded.
 */
export function SalonShell({ children }: { children: ReactNode }) {
  const { token, user, ready, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const { lang, setLang } = useLang();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Start from the last-known plan (cached) so the sidebar doesn't flash all
  // items then hide them on every reload/navigation. null = unknown (first ever
  // load) → gated items stay hidden until the plan resolves (no "show all" flash).
  const [posEnabled, setPosEnabled] = useState<boolean | null>(() => readCachedPos());

  // Feature permissions. Older sessions carry no `capabilities` → owners fall
  // back to "all" so upgrading never locks the owner out.
  const caps: string[] = user?.capabilities ?? (user && (user.role === 'SALON_ADMIN' || user.role === 'SUPER_ADMIN') ? ALL_CAPS : []);
  const hasSalonAccess = caps.length > 0;
  const can = (href: string) => { const c = HREF_CAP[href]; return !c || caps.includes(c); };
  // Staff with salon access are assumed POS-entitled (the owner's plan applies);
  // only the owner's own view is gated by the cached plan flag.
  const posOk = posEnabled === true || (hasSalonAccess && user?.role === 'STAFF');
  const visibleNav = NAV.filter((item) => (item.feature !== 'pos' || posOk) && can(item.href));
  const firstAllowedHref = visibleNav[0]?.href ?? '/salon';

  useEffect(() => {
    if (!ready) return;
    if (!token) { router.replace('/login'); return; }
    if (!user) return;
    if (!hasSalonAccess) { router.replace('/'); return; } // technicians → routed to their own portal
    if (!can(pathname)) router.replace(firstAllowedHref); // on a page this role can't open
  }, [ready, token, user, pathname, hasSalonAccess, firstAllowedHref]);

  // Load the salon's plan to gate plan-locked features, and cache the result.
  useEffect(() => {
    if (!token || user?.role !== 'SALON_ADMIN') return;
    apiFetch<{ posEnabled: boolean }>('/me/plan', { token })
      .then((p) => { const on = p?.posEnabled ?? true; setPosEnabled(on); writeCachedPos(on); })
      .catch(() => {});
  }, [token, user]);

  // Close the drawer whenever the route changes.
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  if (!ready || !token || !user || !hasSalonAccess) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#94a3b8' }}>
        {tr('shell.loading', lang)}
      </div>
    );
  }

  const navList = (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {visibleNav.map((item) => {
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
            {NAV_KEY[item.href] ? tr(NAV_KEY[item.href], lang) : item.label}
          </Link>
        );
      })}
    </nav>
  );

  const footer = (
    <div style={{ marginTop: 'auto', borderTop: '1px solid #1f2937', paddingTop: 14 }}>
      <div style={{ marginBottom: 10 }}>
        <ShareBookingLink />
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8', padding: '0 10px 8px', wordBreak: 'break-all' }}>{user.email}</div>
      <Link href="/salon/account" style={{ display: 'block', textAlign: 'center', marginBottom: 8, padding: '9px 12px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e2e8f0', fontSize: 14, textDecoration: 'none' }}>
        {tr('shell.myAccount', lang)}
      </Link>
      <button onClick={logout} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e2e8f0', fontSize: 14, cursor: 'pointer' }}>
        {tr('shell.logout', lang)}
      </button>
      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
        <InstallAppButton label={tr('shell.installApp', lang)} />
      </div>
      <a href="https://lumioagency.com/" target="_blank" rel="noopener noreferrer"
        style={{ display: 'block', textAlign: 'center', marginTop: 12, fontSize: 11, color: '#64748b', textDecoration: 'none' }}>
        Powered by <span style={{ color: '#818cf8', fontWeight: 600 }}>Lumio Booking</span>
      </a>
    </div>
  );

  const brand = (
    <div style={{ padding: '4px 10px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#e2e8f0' }}>Lumio</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['en', 'vi'] as const).map((l) => (
            <button key={l} onClick={() => setLang(l)} aria-label={l === 'en' ? 'English' : 'Tiếng Việt'}
              style={{ padding: '3px 9px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${lang === l ? '#6366f1' : '#334155'}`, background: lang === l ? '#6366f1' : 'transparent', color: lang === l ? '#fff' : '#94a3b8' }}>
              {l === 'en' ? 'EN' : 'VI'}
            </button>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{tr('shell.subtitle', lang)}</div>
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
            <aside style={{ position: 'fixed', top: 0, left: 0, bottom: 0, width: 'min(82vw, 300px)', background: '#111827', borderRight: '1px solid #1f2937', padding: '18px 14px', display: 'flex', flexDirection: 'column', overflowY: 'auto', WebkitOverflowScrolling: 'touch', zIndex: 50, boxShadow: '4px 0 24px rgba(0,0,0,0.4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                {brand}
                <button onClick={() => setDrawerOpen(false)} aria-label="Close" style={{ width: 36, height: 36, borderRadius: 8, border: 'none', background: 'transparent', color: '#94a3b8', fontSize: 22, cursor: 'pointer' }}>✕</button>
              </div>
              <BranchSwitcher />
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
      <aside style={{ background: '#111827', borderRight: '1px solid #1f2937', padding: '20px 14px', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}>
        {brand}
        <BranchSwitcher />
        {navList}
        {footer}
      </aside>
      <main style={{ padding: '28px 32px', color: '#e2e8f0', minWidth: 0 }}>{children}</main>
    </div>
  );
}

/**
 * Branch switcher for multi-branch (chain) owners/managers. Renders nothing for
 * single-salon users. Selecting a branch stores it (apiFetch then sends it as
 * X-Branch-Id) and reloads so every page re-scopes to the chosen branch.
 */
function BranchSwitcher() {
  const { token } = useAuth();
  const { lang } = useLang();
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [home, setHome] = useState('');
  const [active, setActive] = useState('');

  useEffect(() => {
    if (!token) return;
    apiFetch<{ canSwitch: boolean; homeTenantId: string | null; branches: { id: string; name: string }[] }>('/branches', { token })
      .then((r) => {
        if (!r.canSwitch) { setBranches([]); return; }
        setBranches(r.branches);
        setHome(r.homeTenantId || '');
        let stored = '';
        try { stored = localStorage.getItem('lumio_active_branch') || ''; } catch { /* ignore */ }
        const valid = r.branches.some((b) => b.id === stored);
        if (stored && !valid) { try { localStorage.removeItem('lumio_active_branch'); } catch { /* ignore */ } }
        setActive(valid ? stored : (r.homeTenantId || ''));
      })
      .catch(() => setBranches([]));
  }, [token]);

  if (branches.length <= 1) return null;

  function switchTo(id: string) {
    if (!id || id === active) return;
    try {
      if (id !== home) localStorage.setItem('lumio_active_branch', id);
      else localStorage.removeItem('lumio_active_branch');
    } catch { /* ignore */ }
    if (typeof window !== 'undefined') window.location.reload();
  }

  return (
    <div style={{ padding: '0 10px 14px', marginBottom: 4, borderBottom: '1px solid #1f2937' }}>
      <div style={{ fontSize: 11, color: '#818cf8', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>{tr('shell.branch', lang)}</div>
      <select value={active} onChange={(e) => switchTo(e.target.value)}
        style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid #4f46e5', background: '#1e293b', color: '#e2e8f0', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
        {branches.map((b) => <option key={b.id} value={b.id}>{b.name}{b.id === home ? ' ★' : ''}</option>)}
      </select>
      <Link href="/salon/chain" style={{ display: 'block', textAlign: 'center', marginTop: 8, fontSize: 12, color: '#a5b4fc', textDecoration: 'none' }}>
        {tr('shell.chainReport', lang)} →
      </Link>
    </div>
  );
}
