'use client';

import { ReactNode, createContext, useContext, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth';
import { apiFetch } from '../lib/api';
import { useIsMobile } from '../lib/responsive';
import { useLang, tr, NAV_KEY } from '../lib/i18n';
import { InstallAppButton } from './InstallAppButton';
import { ShareBookingLink } from './ShareBookingLink';
import { MobileTabBar } from './MobileTabBar';
import { NotificationBell } from './NotificationBell';

// `feature: 'pos'` items only show when the salon's plan unlocks the POS suite.
type NavItem = { href: string; label: string; icon: string; feature?: 'pos'; biz?: 'restaurant' };
type NavGroup = { id: string; label: string; icon: string; items: NavItem[] };

// Dashboard sits on its own above the collapsible groups.
const DASHBOARD: NavItem = { href: '/salon', label: 'Dashboard', icon: '◉' };

// The sidebar is organised as a folder tree: 5 collapsible groups. Usage & costs
// now lives inside Billing & plan, so it is no longer a separate nav item.
const GROUPS: NavGroup[] = [
  { id: 'ops', label: 'Operations', icon: '🗂', items: [
    { href: '/salon/calendar', label: 'Calendar', icon: '▦' },
    { href: '/salon/bookings', label: 'Bookings', icon: '🗓' },
    { href: '/salon/activity', label: 'Activity', icon: '🔔' },
    { href: '/salon/tables', label: 'Tables', icon: '🍽', biz: 'restaurant' },
    { href: '/salon/menu', label: 'Menu', icon: '🍜', biz: 'restaurant' },
    { href: '/salon/waitlist', label: 'Waitlist', icon: '⏳' },
    { href: '/salon/pos', label: 'POS / Checkout', icon: '🧾', feature: 'pos' },
    { href: '/salon/orders', label: 'Orders', icon: '📋', feature: 'pos' },
  ] },
  { id: 'clients', label: 'Clients & Catalog', icon: '☺', items: [
    { href: '/salon/customers', label: 'Customers', icon: '☺' },
    { href: '/salon/services', label: 'Services', icon: '✦' },
    { href: '/salon/products', label: 'Products', icon: '🛍', feature: 'pos' },
    { href: '/salon/gift-cards', label: 'Gift cards', icon: '🎁', feature: 'pos' },
    { href: '/salon/staff', label: 'Staff', icon: '✄' },
    { href: '/salon/stations', label: 'Chairs', icon: '💺' },
  ] },
  { id: 'growth', label: 'Marketing & AI', icon: '📣', items: [
    { href: '/salon/marketing', label: 'Marketing', icon: '📣' },
    { href: '/salon/email', label: 'Email marketing', icon: '✉️' },
    { href: '/salon/reviews', label: 'Reviews & rewards', icon: '★' },
    { href: '/salon/reviews-replies', label: 'Google reviews', icon: '💬' },
    { href: '/salon/messenger', label: 'Messenger bot', icon: '🤖' },
    { href: '/salon/voice', label: 'AI Hotline', icon: '📞' },
  ] },
  { id: 'finance', label: 'Finance', icon: '＄', items: [
    { href: '/salon/payments', label: 'Payments', icon: '＄' },
    { href: '/salon/reports', label: 'Reports', icon: '📈' },
    { href: '/salon/pos/report', label: 'Sales report', icon: '📊', feature: 'pos' },
    { href: '/salon/payroll', label: 'Payroll', icon: '💵', feature: 'pos' },
    { href: '/salon/inventory', label: 'Inventory', icon: '📦', feature: 'pos' },
  ] },
  { id: 'account', label: 'Account', icon: '⚙', items: [
    { href: '/salon/billing', label: 'Billing & plan', icon: '💳' },
    { href: '/salon/notifications', label: 'Notifications', icon: '✉' },
    { href: '/salon/integrations', label: 'Integrations', icon: '⚙' },
    { href: '/salon/settings', label: 'Settings', icon: '⚙' },
  ] },
];

const GROUP_KEY: Record<string, string> = {
  ops: 'navg.ops', clients: 'navg.clients', growth: 'navg.growth', finance: 'navg.finance', account: 'navg.account',
};

// Each nav route → the feature capability needed to use it (RBAC). Routes not
// listed need no capability. Must match the backend capability names.
const HREF_CAP: Record<string, string> = {
  '/salon': 'dashboard', '/salon/pos': 'pos', '/salon/orders': 'orders',
  '/salon/calendar': 'calendar', '/salon/bookings': 'bookings', '/salon/walkins': 'walkins',
  '/salon/waitlist': 'waitlist', '/salon/customers': 'customers', '/salon/services': 'services',
  '/salon/products': 'products', '/salon/gift-cards': 'pos', '/salon/staff': 'staff', '/salon/stations': 'staff', '/salon/payroll': 'payroll',
  '/salon/reviews': 'reviews', '/salon/marketing': 'marketing', '/salon/inventory': 'inventory',
  '/salon/pos/report': 'reports', '/salon/reports': 'reports', '/salon/payments': 'payments', '/salon/notifications': 'notifications',
  '/salon/integrations': 'integrations', '/salon/billing': 'billing', '/salon/usage-costs': 'billing', '/salon/settings': 'settings',
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

const RESTAURANT_CACHE_KEY = 'lumio_is_restaurant';
function readCachedRestaurant(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(RESTAURANT_CACHE_KEY) === '1';
}
function writeCachedRestaurant(on: boolean) {
  if (typeof window !== 'undefined') window.localStorage.setItem(RESTAURANT_CACHE_KEY, on ? '1' : '0');
}

/**
 * Salon Admin layout. Desktop: fixed left sidebar. Mobile: a sticky top bar
 * with a hamburger that opens a slide-in drawer. Auth-guarded.
 */
const ShellMountedContext = createContext(false);

export function SalonShell({ children }: { children: ReactNode }) {
  const alreadyInShell = useContext(ShellMountedContext);
  if (alreadyInShell) return <>{children}</>;
  return (
    <ShellMountedContext.Provider value={true}>
      <SalonShellChrome>{children}</SalonShellChrome>
    </ShellMountedContext.Provider>
  );
}

function SalonShellChrome({ children }: { children: ReactNode }) {
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
  // Routes hidden because Super Admin set the feature to platform-managed.
  const [hiddenHrefs, setHiddenHrefs] = useState<string[]>([]);
  const [isRestaurant, setIsRestaurant] = useState<boolean>(() => readCachedRestaurant());
  // Which sidebar groups are expanded (persisted). The group holding the active
  // route auto-expands so the current page is always reachable.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(window.localStorage.getItem('lumio_nav_groups') || '{}'); } catch { return {}; }
  });
  const toggleGroup = (id: string) => setOpenGroups((prev) => {
    const next = { ...prev, [id]: !prev[id] };
    try { localStorage.setItem('lumio_nav_groups', JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  // Feature permissions. Older sessions carry no `capabilities` → owners fall
  // back to "all" so upgrading never locks the owner out.
  const caps: string[] = user?.capabilities ?? (user && (user.role === 'SALON_ADMIN' || user.role === 'SUPER_ADMIN') ? ALL_CAPS : []);
  const hasSalonAccess = caps.length > 0;
  const can = (href: string) => { const c = HREF_CAP[href]; return !c || caps.includes(c); };
  // Staff with salon access are assumed POS-entitled (the owner's plan applies);
  // only the owner's own view is gated by the cached plan flag.
  const posOk = posEnabled === true || (hasSalonAccess && user?.role === 'STAFF');
  const itemVisible = (item: NavItem) => (item.feature !== 'pos' || posOk) && (item.biz !== 'restaurant' || isRestaurant) && can(item.href) && !hiddenHrefs.includes(item.href);
  const visibleGroups = GROUPS
    .map((g) => ({ ...g, items: g.items.filter(itemVisible) }))
    .filter((g) => g.items.length > 0);
  const firstAllowedHref = (can(DASHBOARD.href) && DASHBOARD.href) || visibleGroups[0]?.items[0]?.href || '/salon';

  useEffect(() => {
    if (!ready) return;
    if (!token) { router.replace('/login'); return; }
    if (!user) return;
    if (!hasSalonAccess) { router.replace('/'); return; } // technicians → routed to their own portal
    if (!can(pathname)) router.replace(firstAllowedHref); // on a page this role can't open
  }, [ready, token, user, pathname, hasSalonAccess, firstAllowedHref]);

  // Live entitlements: plan (POS gating), feature-access policy, and business
  // type. Refetched on mount, on window focus/visibility, and on an interval so a
  // change made in Super Admin (plan, feature access, salon <-> restaurant) shows
  // on the salon side within seconds — no re-login or hard reload needed.
  const refreshEntitlements = useCallback(() => {
    if (!token || !hasSalonAccess) return;
    apiFetch<{ posEnabled: boolean }>('/me/plan', { token })
      .then((p) => { const on = p?.posEnabled ?? true; setPosEnabled(on); writeCachedPos(on); })
      .catch(() => {});
    apiFetch<{ policy: Record<string, string>; defs: { key: string; hrefs: string[] }[] }>('/feature-policy', { token })
      .then((r) => setHiddenHrefs((r?.defs || []).filter((d) => r.policy?.[d.key] === 'platform').flatMap((d) => d.hrefs)))
      .catch(() => {});
    apiFetch<{ businessType?: string; timezone?: string }>('/me/tenant', { token })
      .then((r) => { const on = r?.businessType === 'RESTAURANT'; setIsRestaurant(on); writeCachedRestaurant(on); if (r?.timezone) { try { window.localStorage.setItem('lumio_tz', r.timezone); } catch { /* ignore */ } } })
      .catch(() => {});
  }, [token, hasSalonAccess]);

  useEffect(() => {
    refreshEntitlements();
    const onFocus = () => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') refreshEntitlements(); };
    const iv = window.setInterval(refreshEntitlements, 45000);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { window.clearInterval(iv); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [refreshEntitlements]);

  // Close the drawer whenever the route changes.
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  // Auto-expand the group that contains the current route.
  useEffect(() => {
    const g = GROUPS.find((grp) => grp.items.some((it) => pathname === it.href || pathname.startsWith(it.href + '/')));
    if (g) setOpenGroups((prev) => (prev[g.id] ? prev : { ...prev, [g.id]: true }));
  }, [pathname]);

  if (!ready || !token || !user || !hasSalonAccess) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', color: '#94a3b8', background: '#0b1120' }}>
        {tr('shell.loading', lang)}
      </div>
    );
  }

  const renderLink = (item: NavItem, indent: boolean) => {
    const active = pathname === item.href;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setDrawerOpen(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: indent ? '9px 12px 9px 22px' : '11px 12px', borderRadius: 8, fontSize: indent ? 14 : 15,
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
  };

  const navList = (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {can(DASHBOARD.href) && renderLink(DASHBOARD, false)}
      {visibleGroups.map((grp) => {
        const open = !!openGroups[grp.id];
        const hasActive = grp.items.some((it) => pathname === it.href || pathname.startsWith(it.href + '/'));
        return (
          <div key={grp.id} style={{ marginTop: 6 }}>
            <button
              onClick={() => toggleGroup(grp.id)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                padding: '8px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: 'transparent', color: hasActive && !open ? '#c7d2fe' : '#64748b',
                fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 16, textAlign: 'center', fontSize: 12 }}>{grp.icon}</span>
                {tr(GROUP_KEY[grp.id], lang)}
                {hasActive && !open && <span style={{ width: 6, height: 6, borderRadius: 999, background: '#6366f1' }} />}
              </span>
              <span style={{ fontSize: 10, opacity: 0.8, transition: 'transform .15s', transform: open ? 'rotate(90deg)' : 'none' }}>▸</span>
            </button>
            {open && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
                {grp.items.map((item) => renderLink(item, true))}
              </div>
            )}
          </div>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <NotificationBell />
            <button onClick={() => setDrawerOpen(true)} aria-label="Menu"
              style={{ width: 42, height: 42, borderRadius: 10, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontSize: 20, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
              ☰
            </button>
          </div>
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

        <main style={{ padding: '18px 16px 88px', color: '#e2e8f0', minWidth: 0 }}>{children}</main>
        <MobileTabBar />
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
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header style={{ position: 'sticky', top: 0, zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, padding: '10px 32px', background: 'rgba(11,17,32,0.82)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', borderBottom: '1px solid #1f2937' }}>
          <NotificationBell />
        </header>
        <main style={{ padding: '22px 32px 40px', color: '#e2e8f0', minWidth: 0 }}>{children}</main>
      </div>
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
