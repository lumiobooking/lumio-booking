'use client';

import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NavIcon } from '../NavIcon';
import { ThemeToggle } from '../ThemeToggle';
import { NotificationBell } from '../NotificationBell';
import { InboxAlerts } from '../InboxAlerts';
import { ShareBookingLink } from '../ShareBookingLink';
import { InstallAppButton } from '../InstallAppButton';
import { MobileTabBar } from '../MobileTabBar';
import MarketBadge from '../MarketBadge';
import { LumioLogo } from '../LumioLogo';
import { useIsMobile } from '../../lib/responsive';
import { tr, NAV_KEY } from '../../lib/i18n';
import { CommandPalette, type PaletteItem } from './CommandPalette';
import { activeHref, ITEM_BY_HREF, SECTIONS, sectionFor, type NavItem, type Section, type SectionId } from './nav-map';

/**
 * The new salon-admin layout ("Giao diện mới"), one component for every screen size.
 *
 *   ≥ 1181 px  laptop / desktop   icon rail (6 areas) + the area's menu (foldable) + top bar
 *   769–1180   iPad / small laptop icon rail + top bar; the area's menu slides over the
 *                                  page when asked for, so the register and the turns
 *                                  board keep the full width
 *   ≤ 768      phone               top bar + bottom tabs; the full menu is a sheet
 *
 * Everything the classic sidebar decides — who may see which screen, plan,
 * market, restaurant, team-only — is decided by the caller and handed in as
 * `visible`; this component only arranges what it is given. Routes are the
 * same, so saved links, QR codes and push notifications open the same pages.
 */
export interface ShellV2Props {
  children: ReactNode;
  banner: ReactNode;
  visible: (item: NavItem) => boolean;
  badges: Record<string, number>;
  token: string | null;
  email: string;
  salonName?: string;
  isSupport: boolean;
  lang: 'en' | 'vi';
  setLang: (l: 'en' | 'vi') => void;
  logout: () => void;
  onClassic: () => void;
  branchSwitcher: ReactNode;
}

const SUB_KEY = 'lumio_nav2_sub';

export function ShellV2({ children, banner, visible, badges, token, email, salonName, isSupport, lang, setLang, logout, onClassic, branchSwitcher }: ShellV2Props) {
  const pathname = usePathname();
  const phone = useIsMobile();
  const narrow = useIsMobile(1180);
  const tablet = narrow && !phone;
  const vi = lang === 'vi';
  const L = (v: string, e: string) => (vi ? v : e);

  const label = useCallback((href: string) => {
    const it = ITEM_BY_HREF[href];
    return NAV_KEY[href] ? tr(NAV_KEY[href], lang) : it?.label ?? href;
  }, [lang]);

  // Areas with at least one screen this person may open.
  const sections = useMemo(() => SECTIONS
    .map((s) => ({ ...s, items: s.hrefs.map((h) => ITEM_BY_HREF[h]).filter((i): i is NavItem => !!i && visible(i)) }))
    .filter((s) => s.items.length > 0), [visible]);
  const here = sectionFor(pathname);
  const allVisible = useMemo(() => sections.flatMap((s) => s.items.map((i) => i.href)), [sections]);
  const current = activeHref(pathname, allVisible);

  // Which area's menu is showing. Follows the page; a click on the rail can
  // look at another area without leaving the page.
  const [shown, setShown] = useState<SectionId>(here);
  useEffect(() => { setShown(here); }, [here]);

  // Desktop: the area menu folds away (remembered). Tablet: it slides over.
  const [subOpen, setSubOpen] = useState(true);
  useEffect(() => {
    try { const v = window.localStorage.getItem(SUB_KEY); if (v === '0' || v === '1') setSubOpen(v === '1'); } catch { /* ignore */ }
  }, []);
  const [flyout, setFlyout] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [palette, setPalette] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [me, setMe] = useState(false);
  useEffect(() => { setFlyout(false); setSheet(false); setNewOpen(false); setMe(false); }, [pathname]);

  const toggleSub = () => {
    if (tablet) { setFlyout((v) => !v); return; }
    setSubOpen((v) => { const n = !v; try { window.localStorage.setItem(SUB_KEY, n ? '1' : '0'); } catch { /* ignore */ } return n; });
  };
  const pickSection = (id: SectionId) => {
    setShown(id);
    if (tablet) setFlyout((open) => !(open && shown === id));
    else if (!subOpen) { setSubOpen(true); try { window.localStorage.setItem(SUB_KEY, '1'); } catch { /* ignore */ } }
  };

  // Ctrl+K / ⌘K anywhere; "/" when not typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '') || (e.target as HTMLElement)?.isContentEditable;
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setPalette(true); }
      else if (e.key === '/' && !typing) { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const pages: PaletteItem[] = useMemo(() => sections.flatMap((s) => s.items.map((i) => ({
    href: i.href, label: label(i.href), icon: i.icon, section: vi ? s.vi : s.en,
  }))), [sections, label, vi]);

  const can = (href: string) => allVisible.includes(href);
  const createItems = [
    can('/salon/bookings') && { href: '/salon/bookings?new=1', icon: 'calendarCheck', t: L('Lịch hẹn mới', 'New booking'), d: L('Chọn dịch vụ, thợ, giờ', 'Service, tech, time') },
    can('/salon/walkins') && { href: '/salon/walkins?new=1', icon: 'walk', t: L('Khách vãng lai', 'Walk-in'), d: L('Thêm vào hàng chờ', 'Add to the queue') },
    can('/salon/pos') && { href: '/salon/pos', icon: 'receipt', t: L('Thu tiền', 'Checkout'), d: L('Mở quầy thu ngân', 'Open the register') },
    can('/salon/services') && { href: '/salon/services?new=1', icon: 'sparkle', t: L('Dịch vụ mới', 'New service'), d: L('Thêm vào menu', 'Add to the menu') },
  ].filter(Boolean) as { href: string; icon: string; t: string; d: string }[];

  const sectionBadge = (s: { items: NavItem[] }) => s.items.reduce((n, i) => n + (badges[i.href] ?? 0), 0);
  const shownSection = sections.find((s) => s.id === shown) ?? sections[0];
  const hereSection = sections.find((s) => s.id === here);
  const pageTitle = current ? label(current) : '';

  // ---------------------------------------------------------------- pieces

  const searchButton = (wide: boolean) => (
    <button type="button" onClick={() => setPalette(true)} aria-label={L('Tìm kiếm', 'Search')} title="Ctrl K"
      style={wide ? {
        display: 'flex', alignItems: 'center', gap: 8, width: 'clamp(200px, 24vw, 320px)', height: 40, padding: '0 12px', borderRadius: 11,
        border: '1px solid var(--line)', background: 'var(--c0f172a)', color: 'var(--c94a3b8)', fontSize: 13.5, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden',
      } : iconBtn}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden style={{ flexShrink: 0 }}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      {wide && <><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{L('Tìm khách, dịch vụ, mã bill…', 'Search clients, services, bills…')}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, border: '1px solid var(--c334155)', borderRadius: 6, padding: '0 6px', flexShrink: 0 }}>Ctrl K</span></>}
    </button>
  );

  const createButton = (compact: boolean) => createItems.length > 0 && !isSupport ? (
    <div style={{ position: 'relative' }}>
      <button type="button" onClick={() => setNewOpen((v) => !v)} aria-haspopup="menu" aria-expanded={newOpen} aria-label={L('Tạo mới', 'New')}
        style={{ height: compact ? 40 : 40, width: compact ? 40 : undefined, padding: compact ? 0 : '0 16px', borderRadius: 11, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
        {!compact && L('Tạo mới', 'New')}
      </button>
      {newOpen && (
        <>
          <div onClick={() => setNewOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 74 }} />
          <div role="menu" style={{ position: 'absolute', right: 0, top: 46, zIndex: 75, width: 270, background: 'var(--c111827)', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 18px 48px rgba(0,0,0,0.3)', padding: 6 }}>
            {createItems.map((c) => (
              <Link key={c.href} href={c.href} role="menuitem" onClick={() => setNewOpen(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 10px', borderRadius: 10, textDecoration: 'none', color: 'var(--ce2e8f0)' }} className="sn-item">
                <span style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--c1e1b4b)', color: 'var(--ca5b4fc)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><NavIcon name={c.icon} size={16} /></span>
                <span><span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{c.t}</span><span style={{ display: 'block', fontSize: 12, color: 'var(--c94a3b8)' }}>{c.d}</span></span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  ) : null;

  const navLink = (item: NavItem, big = false) => {
    const on = current === item.href;
    const b = badges[item.href] ?? 0;
    return (
      <Link key={item.href} href={item.href} className="sn-item" aria-current={on ? 'page' : undefined}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: big ? '12px 12px' : '9px 11px', minHeight: big ? 46 : undefined, borderRadius: 10, textDecoration: 'none', fontSize: big ? 15 : 13.5, lineHeight: 1.2,
          background: on ? '#4f46e5' : 'transparent', color: on ? '#ffffff' : 'var(--ccbd5e1)', fontWeight: on ? 700 : 500 }}>
        <span style={{ color: on ? '#ffffff' : 'var(--c94a3b8)', display: 'grid', placeItems: 'center', width: 20 }}><NavIcon name={item.icon} /></span>
        <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label(item.href)}</span>
        {b > 0 && <span style={{ minWidth: 20, height: 20, padding: '0 6px', borderRadius: 20, background: on ? 'rgba(255,255,255,0.25)' : '#ef4444', color: '#fff', fontSize: 11, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{b > 9 ? '9+' : b}</span>}
      </Link>
    );
  };

  const sectionMenu = (s: (typeof sections)[number], big = false) => {
    const less = new Set(s.lessUsed ?? []);
    const main = s.items.filter((i) => !less.has(i.href));
    const rest = s.items.filter((i) => less.has(i.href));
    return (
      <nav aria-label={vi ? s.vi : s.en} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {main.map((i) => navLink(i, big))}
        {rest.length > 0 && <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--c64748b)', padding: '14px 11px 4px' }}>{L('Ít dùng hơn', 'Less used')}</div>}
        {rest.map((i) => navLink(i, big))}
      </nav>
    );
  };

  const subPanel = (s: Section & { items: NavItem[] }, floating: boolean) => (
    <aside style={{
      width: 248, flexShrink: 0, boxSizing: 'border-box', background: 'var(--c111827)', borderRight: '1px solid var(--c1f2937)', padding: '18px 12px 14px',
      display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto',
      ...(floating
        ? { position: 'fixed', top: 0, bottom: 0, left: 72, zIndex: 66, boxShadow: '12px 0 32px rgba(0,0,0,0.25)', paddingTop: 'calc(18px + env(safe-area-inset-top, 0px))' }
        : { position: 'sticky', top: 0, height: '100dvh' }),
    }}>
      <div style={{ padding: '0 6px 10px' }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--cf8fafc)' }}>{vi ? s.vi : s.en}</div>
        <div style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{vi ? s.viDesc : s.enDesc}</div>
      </div>
      {s.id === 'ops' && branchSwitcher}
      {sectionMenu(s)}
      <div style={{ marginTop: 'auto', paddingTop: 14, display: 'grid', gap: 10 }}>
        {s.id === 'ops' && <ShareBookingLink />}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, background: 'var(--c0f172a)', border: '1px solid var(--line)' }}>
          <span style={{ width: 32, height: 32, borderRadius: '50%', background: '#4f46e5', color: '#fff', fontWeight: 700, fontSize: 12, display: 'grid', placeItems: 'center', flexShrink: 0 }}>{initials(salonName || email)}</span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--cf1f5f9)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{salonName || 'Lumio'}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--c94a3b8)' }}><MarketBadge compact /></span>
          </span>
        </div>
      </div>
    </aside>
  );

  const accountMenu = (anchor: 'rail' | 'top') => me && (
    <>
      <div onClick={() => setMe(false)} style={{ position: 'fixed', inset: 0, zIndex: 76 }} />
      <div role="menu" style={{ position: 'fixed', zIndex: 77, width: 260, background: 'var(--c111827)', border: '1px solid var(--line)', borderRadius: 14, boxShadow: '0 18px 48px rgba(0,0,0,0.3)', padding: 8,
        ...(anchor === 'rail' ? { left: 80, bottom: 16 } : { right: 12, top: 'calc(64px + env(safe-area-inset-top, 0px))' }) }}>
        <div style={{ padding: '6px 10px 10px', fontSize: 12.5, color: 'var(--c94a3b8)', wordBreak: 'break-all' }}>{email}</div>
        <Link href="/salon/account" className="sn-item" style={menuRow}>{tr('shell.myAccount', lang)}</Link>
        <div style={{ display: 'flex', gap: 6, padding: '8px 10px' }}>
          {(['vi', 'en'] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)}
              style={{ flex: 1, padding: '7px 0', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', border: `1px solid ${lang === l ? '#6366f1' : 'var(--c334155)'}`, background: lang === l ? '#6366f1' : 'transparent', color: lang === l ? '#fff' : 'var(--c94a3b8)' }}>
              {l === 'vi' ? 'Tiếng Việt' : 'English'}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => { setMe(false); onClassic(); }} className="sn-item" style={{ ...menuRow, width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer' }}>
          ↩ {L('Dùng giao diện cũ', 'Use the classic layout')}
        </button>
        <div style={{ padding: '6px 10px' }}><InstallAppButton label={tr('shell.installApp', lang)} /></div>
        <button type="button" onClick={logout} className="sn-item" style={{ ...menuRow, width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--ink-bad)' }}>
          {tr('shell.logout', lang)}
        </button>
      </div>
    </>
  );

  const palette_ = <CommandPalette open={palette} onClose={() => setPalette(false)} token={token} vi={vi} pages={pages} phone={phone} />;

  // ---------------------------------------------------------------- phone

  if (phone) {
    return (
      <div style={{ minHeight: '100dvh', background: 'var(--c0b1120)' }}>
        <header style={{ position: 'sticky', top: 'env(safe-area-inset-top, 0px)', zIndex: 30, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--c111827)', borderBottom: '1px solid var(--c1f2937)' }}>
          <button type="button" onClick={() => setSheet(true)} aria-label={L('Mở menu', 'Open menu')} style={iconBtn}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--c94a3b8)', lineHeight: 1.2 }}>{hereSection ? (vi ? hereSection.vi : hereSection.en) : 'Lumio'}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--cf8fafc)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.25 }}>{pageTitle || 'Lumio'}</div>
          </div>
          {searchButton(false)}
          {createButton(true)}
          <NotificationBell />
        </header>
        {sheet && (
          <>
            <div onClick={() => setSheet(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 70 }} />
            <aside className="lumio-sheet" style={{ position: 'fixed', top: 0, left: 0, bottom: 0, width: 'min(88vw, 340px)', boxSizing: 'border-box', background: 'var(--c111827)', zIndex: 71, display: 'flex', flexDirection: 'column', overflowY: 'auto',
              paddingTop: 'calc(14px + env(safe-area-inset-top, 0px))', paddingBottom: 'calc(14px + env(safe-area-inset-bottom, 0px))', boxShadow: '4px 0 24px rgba(0,0,0,0.35)' }}>
              <style>{'.lumio-sheet > *{flex-shrink:0}'}</style>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px 10px' }}>
                <LumioLogo size={28} />
                <button type="button" onClick={() => setSheet(false)} aria-label={L('Đóng', 'Close')} style={iconBtn}>✕</button>
              </div>
              <div style={{ padding: '0 10px' }}>{branchSwitcher}</div>
              {/* Areas as tabs across the top of the sheet: one tap to switch, the
                  list underneath stays short enough to reach with a thumb. */}
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '4px 10px 10px', scrollbarWidth: 'none' }}>
                {sections.map((s) => {
                  const on = s.id === shown;
                  const b = sectionBadge(s);
                  return (
                    <button key={s.id} type="button" onClick={() => setShown(s.id)}
                      style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', borderRadius: 999, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        border: `1px solid ${on ? '#4f46e5' : 'var(--line)'}`, background: on ? '#4f46e5' : 'transparent', color: on ? '#fff' : 'var(--ccbd5e1)' }}>
                      <NavIcon name={s.icon} size={15} />{vi ? s.vi : s.en}
                      {b > 0 && <span style={{ width: 7, height: 7, borderRadius: '50%', background: on ? '#fff' : '#ef4444' }} />}
                    </button>
                  );
                })}
              </div>
              <div style={{ padding: '0 10px' }}>{shownSection && sectionMenu(shownSection, true)}</div>
              <div style={{ marginTop: 'auto', padding: '16px 14px 0', display: 'grid', gap: 10 }}>
                <ShareBookingLink />
                <div style={{ fontSize: 12, color: 'var(--c94a3b8)', wordBreak: 'break-all' }}>{email}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['vi', 'en'] as const).map((l) => (
                    <button key={l} type="button" onClick={() => setLang(l)} style={{ flex: 1, padding: '10px 0', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: `1px solid ${lang === l ? '#6366f1' : 'var(--c334155)'}`, background: lang === l ? '#6366f1' : 'transparent', color: lang === l ? '#fff' : 'var(--c94a3b8)' }}>{l === 'vi' ? 'Tiếng Việt' : 'English'}</button>
                  ))}
                </div>
                <Link href="/salon/account" style={sheetBtn}>{tr('shell.myAccount', lang)}</Link>
                <button type="button" onClick={onClassic} style={sheetBtn}>↩ {L('Dùng giao diện cũ', 'Use the classic layout')}</button>
                <button type="button" onClick={logout} style={{ ...sheetBtn, color: 'var(--ink-bad)' }}>{tr('shell.logout', lang)}</button>
                <div style={{ display: 'flex', justifyContent: 'center' }}><InstallAppButton label={tr('shell.installApp', lang)} /></div>
              </div>
            </aside>
          </>
        )}
        <main style={{ padding: '16px 14px 92px', color: 'var(--ce2e8f0)', minWidth: 0 }}>{banner}{children}</main>
        <MobileTabBar />
        {palette_}
      </div>
    );
  }

  // ---------------------------------------------------------------- tablet + desktop

  const showDocked = !tablet && subOpen && shownSection;
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', background: 'var(--c0b1120)' }}>
      {/* Icon rail: six areas, always there, 72 px. Big enough for a finger on an iPad. */}
      <nav aria-label={L('Khu vực', 'Areas')} style={{ width: 72, flexShrink: 0, boxSizing: 'border-box', position: 'sticky', top: 0, height: '100dvh', zIndex: 67, background: 'var(--c111827)', borderRight: '1px solid var(--c1f2937)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '14px 0', paddingTop: 'calc(14px + env(safe-area-inset-top, 0px))' }}>
        <Link href="/salon" aria-label="Lumio" style={{ marginBottom: 10, display: 'grid', placeItems: 'center' }}><LumioLogo size={34} wordmark={false} /></Link>
        {sections.map((s) => {
          const on = s.id === (tablet && flyout ? shown : here);
          const b = sectionBadge(s);
          return (
            <button key={s.id} type="button" onClick={() => pickSection(s.id)} aria-label={vi ? s.vi : s.en} title={vi ? s.vi : s.en} aria-pressed={on}
              style={{ position: 'relative', width: 48, height: 48, borderRadius: 14, border: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center',
                background: on ? '#4f46e5' : 'transparent', color: on ? '#ffffff' : 'var(--c94a3b8)', boxShadow: on ? '0 8px 18px -8px #4f46e5' : 'none' }}>
              <NavIcon name={s.icon} size={21} />
              {b > 0 && <span style={{ position: 'absolute', top: 9, right: 9, width: 8, height: 8, borderRadius: '50%', background: '#ef4444', border: '2px solid var(--c111827)' }} />}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => setMe((v) => !v)} aria-label={L('Tài khoản', 'Account')} aria-haspopup="menu" aria-expanded={me}
          style={{ width: 40, height: 40, borderRadius: '50%', border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
          {initials(email)}
        </button>
        {accountMenu('rail')}
      </nav>

      {showDocked && subPanel(shownSection, false)}
      {tablet && flyout && shownSection && (
        <>
          <div onClick={() => setFlyout(false)} style={{ position: 'fixed', inset: 0, left: 72, zIndex: 65, background: 'rgba(0,0,0,0.35)' }} />
          {subPanel(shownSection, true)}
        </>
      )}

      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <header style={{ position: 'sticky', top: 'env(safe-area-inset-top, 0px)', zIndex: 40, display: 'flex', alignItems: 'center', gap: 10, padding: tablet ? '10px 16px' : '10px 24px', background: 'var(--glass)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', borderBottom: '1px solid var(--c1f2937)' }}>
          <button type="button" onClick={toggleSub} aria-label={L('Menu khu vực', 'Area menu')} title={tablet ? L('Mở menu', 'Open menu') : subOpen ? L('Thu menu — màn hình rộng hơn', 'Fold menu — wider screen') : L('Hiện menu', 'Show menu')} style={iconBtn}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              {tablet || !subOpen ? <path d="M4 6h16M4 12h16M4 18h16" /> : <path d="M11 6l-6 6 6 6M19 6l-6 6 6 6" />}
            </svg>
          </button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, color: 'var(--c94a3b8)', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {hereSection ? (vi ? hereSection.vi : hereSection.en) : 'Lumio'}
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--cf8fafc)', lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pageTitle}</div>
          </div>
          {searchButton(!tablet)}
          {createButton(tablet)}
          <ThemeToggle />
          {isSupport && <InboxAlerts href="/salon/inbox" label={L('Hộp thư', 'Inbox')} />}
          <NotificationBell />
        </header>
        <main style={{ padding: tablet ? '18px 18px 32px' : '22px 28px 40px', color: 'var(--ce2e8f0)', minWidth: 0 }}>{banner}{children}</main>
      </div>
      {palette_}
    </div>
  );
}

function initials(s: string): string {
  const parts = String(s || '').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? 'L') + (parts[1]?.[0] ?? '')).toUpperCase();
}

const iconBtn: React.CSSProperties = {
  width: 40, height: 40, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: 11, cursor: 'pointer',
  border: '1px solid var(--line)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)',
};
const menuRow: React.CSSProperties = { display: 'block', padding: '10px 10px', borderRadius: 9, fontSize: 14, color: 'var(--ce2e8f0)', textDecoration: 'none' };
const sheetBtn: React.CSSProperties = { display: 'block', textAlign: 'center', padding: '11px 12px', borderRadius: 10, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 14, textDecoration: 'none', cursor: 'pointer' };
