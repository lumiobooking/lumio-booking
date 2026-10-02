/**
 * The salon admin's menu: every screen, and the two ways of showing it.
 *
 * GROUPS is the classic sidebar (five collapsible groups). SECTIONS is the
 * two-tier menu of the new layout (an icon rail of six areas, each opening a
 * short list). Both read the SAME items, so a screen added to GROUPS cannot
 * silently go missing from the new menu — nav-map.spec.ts fails if it does.
 *
 * Pure (no React) so it is tested directly.
 */

// `feature: 'pos'` items only show when the salon's plan unlocks the POS suite.
//
// `market: 'na'` means the screen only makes sense in North America. It is a
// nav-level condition rather than a feature-policy key on purpose: every key in
// FEATURE_DEFS ships OFF — "nothing opens by accident" — so giving one of these
// screens a key would take it away from every US salon that has it today, to
// solve a problem only Vietnam has.
export type NavItem = { href: string; label: string; icon: string; feature?: 'pos'; biz?: 'restaurant'; market?: 'na'; team?: true };
export type NavGroup = { id: string; label: string; items: NavItem[] };

// Dashboard sits on its own above the collapsible groups.
export const DASHBOARD: NavItem = { href: '/salon', label: 'Dashboard', icon: 'home' };

// The sidebar is organised as a folder tree: 5 collapsible groups. Usage & costs
// now lives inside Billing & plan, so it is no longer a separate nav item.
export const GROUPS: NavGroup[] = [
  { id: 'ops', label: 'Operations', items: [
    { href: '/salon/calendar', label: 'Calendar', icon: 'calendar' },
    { href: '/salon/bookings', label: 'Bookings', icon: 'calendarCheck' },
    // Front-desk check-in board: seat a customer, run their ticket, hand it to
    // the till. Its route and permission always existed — the nav entry didn't.
    { href: '/salon/walkins', label: 'Walk-ins · Turns', icon: 'walk' },
    { href: '/salon/activity', label: 'Activity', icon: 'pulse' },
    { href: '/salon/tables', label: 'Tables', icon: 'utensils', biz: 'restaurant' },
    { href: '/salon/menu', label: 'Menu', icon: 'bowl', biz: 'restaurant' },
    { href: '/salon/waitlist', label: 'Waitlist', icon: 'clock' },
    { href: '/salon/pos', label: 'POS / Checkout', icon: 'receipt', feature: 'pos' },
    { href: '/salon/orders', label: 'Orders', icon: 'clipboard', feature: 'pos' },
  ] },
  { id: 'clients', label: 'Clients & Catalog', items: [
    { href: '/salon/customers', label: 'Customers', icon: 'users' },
    // Two-button feedback after every visit: the owner's cases and each tech's scorecard.
    { href: '/salon/feedback', label: 'Feedback', icon: 'heart' },
    { href: '/salon/services', label: 'Services', icon: 'sparkle' },
    { href: '/salon/products', label: 'Products', icon: 'bag', feature: 'pos' },
    { href: '/salon/gift-cards', label: 'Gift cards', icon: 'gift', feature: 'pos' },
    { href: '/salon/staff', label: 'Staff', icon: 'scissors' },
    { href: '/salon/stations', label: 'Chairs', icon: 'chair' },
  ] },
  { id: 'growth', label: 'Marketing & AI', items: [
    { href: '/salon/content', label: 'Marketing plan & posts', icon: 'sparkle' },
    // One door for every channel the shop publishes to or is reached on —
    // Facebook, Instagram, Google Business, TikTok, Zalo, website chat.
    // The screens that use a channel keep a status line and link here.
    { href: '/salon/channels', label: 'Social channels', icon: 'plug' },
    // The client's own door: preview + approve what is about to publish.
    // Deliberately its own route, NOT the content page — that page is the
    // agency's kitchen and has its own switch; this one is the dining room.
    { href: '/salon/approve-posts', label: 'Post approval', icon: 'check' },
    { href: '/salon/marketing', label: 'Marketing', icon: 'megaphone' },
    { href: '/salon/marketing/monthly', label: 'Marketing report', icon: 'chart' },
    { href: '/salon/email', label: 'Email marketing', icon: 'mail' },
    { href: '/salon/reviews', label: 'Reviews & rewards', icon: 'star' },
    { href: '/salon/reviews-replies', label: 'Google reviews', icon: 'chat' },
    // The inbox sits ABOVE the bot settings on purpose: answering customers is
    // done fifty times a day by a receptionist, configuring the bot is done once
    // by the owner. The frequent job should not live under the rare one.
    { href: '/salon/inbox', label: 'Inbox', icon: 'inboxTray' },
    { href: '/salon/messenger', label: 'Messenger bot', icon: 'bot' },
    { href: '/salon/voice', label: 'AI Hotline', icon: 'phone' },
  ] },
  { id: 'finance', label: 'Finance', items: [
    { href: '/salon/payments', label: 'Payments', icon: 'dollar' },
    { href: '/salon/payment-terminals', label: 'Card terminals', icon: 'card', feature: 'pos' },
    // North America only. The whole screen is the card terminal's receipt book —
    // void, refund, approval code, batch number, card brand, all of it Dejavoo —
    // and the terminal itself is already vetoed for Vietnam by the market.
    // Blocking the machine and leaving its receipt book in the menu was half a
    // veto: a row a Vietnamese salon can never have, on a screen it can never act on.
    { href: '/salon/card-transactions', label: 'Card transactions', icon: 'fileText', feature: 'pos', market: 'na' },
    { href: '/salon/reports', label: 'Business report', icon: 'trendUp' },
    { href: '/salon/pos/report', label: 'Sales report', icon: 'pie', feature: 'pos' },
    { href: '/salon/pos/shifts', label: 'Cashier shifts', icon: 'banknote', feature: 'pos' },
    { href: '/salon/payroll', label: 'Staff & pay', icon: 'banknote', feature: 'pos' },
    { href: '/salon/inventory', label: 'Inventory', icon: 'box', feature: 'pos' },
  ] },
  { id: 'account', label: 'Account', items: [
    { href: '/salon/billing', label: 'Billing & plan', icon: 'card' },
    { href: '/salon/notifications', label: 'Notifications', icon: 'bell' },
    { href: '/salon/integrations', label: 'Integrations', icon: 'puzzle' },
    // Lumio's wiring board — every OAuth, token and webhook behind the salon,
    // with test buttons. The team reads it while setting a salon up; an owner
    // reading it sees a wall of red "not connected" for things Lumio runs on
    // its behalf, and rings to ask. Team only.
    { href: '/salon/connections', label: 'Connections', icon: 'plug', team: true },
    { href: '/salon/settings', label: 'Settings', icon: 'gear' },
    // Deleted items live here for a week before they are gone for good.
    { href: '/salon/trash', label: 'Recycle bin', icon: 'trash' },
  ] },
];


// ---------------------------------------------------------------- new layout

export type SectionId = 'ops' | 'clients' | 'catalog' | 'growth' | 'finance' | 'account';

export interface Section {
  id: SectionId;
  vi: string; en: string;
  /** One line under the section name in the sub-menu. */
  viDesc: string; enDesc: string;
  icon: string;
  hrefs: string[];
  /** Items shown under a "less used" divider in the sub-menu. */
  lessUsed?: string[];
}

/**
 * Six areas, ordered by how often the front desk needs them. Grouped by who
 * uses a screen and when, not by what kind of data it holds: the inbox lives
 * with clients (the receptionist answers it), inventory with the catalog (the
 * owner restocks what the menu sells).
 */
export const SECTIONS: Section[] = [
  { id: 'ops', vi: 'Vận hành', en: 'Operations', viDesc: 'Điều hành tiệm hằng ngày', enDesc: 'Run the floor day to day', icon: 'home',
    hrefs: ['/salon', '/salon/calendar', '/salon/bookings', '/salon/walkins', '/salon/pos', '/salon/orders', '/salon/waitlist', '/salon/activity', '/salon/tables', '/salon/menu'],
    lessUsed: ['/salon/waitlist', '/salon/activity'] },
  { id: 'clients', vi: 'Khách hàng', en: 'Clients', viDesc: 'Khách, tin nhắn, góp ý', enDesc: 'Clients, messages, feedback', icon: 'users',
    hrefs: ['/salon/customers', '/salon/inbox', '/salon/feedback', '/salon/reviews', '/salon/gift-cards'] },
  { id: 'catalog', vi: 'Dịch vụ & Thợ', en: 'Services & team', viDesc: 'Menu, sản phẩm, đội thợ', enDesc: 'Menu, products, team', icon: 'scissors',
    hrefs: ['/salon/services', '/salon/products', '/salon/inventory', '/salon/staff', '/salon/stations'] },
  { id: 'growth', vi: 'Marketing & AI', en: 'Marketing & AI', viDesc: 'Kéo khách mới, giữ khách cũ', enDesc: 'Win and keep clients', icon: 'megaphone',
    hrefs: ['/salon/content', '/salon/approve-posts', '/salon/channels', '/salon/marketing', '/salon/marketing/monthly', '/salon/email', '/salon/reviews-replies', '/salon/messenger', '/salon/voice'] },
  { id: 'finance', vi: 'Tài chính', en: 'Finance', viDesc: 'Doanh thu, thanh toán, lương', enDesc: 'Revenue, payments, pay', icon: 'dollar',
    hrefs: ['/salon/reports', '/salon/pos/report', '/salon/payments', '/salon/card-transactions', '/salon/pos/shifts', '/salon/payroll', '/salon/payment-terminals'] },
  { id: 'account', vi: 'Cài đặt', en: 'Settings', viDesc: 'Làm một lần, ít khi quay lại', enDesc: 'Set once, rarely revisited', icon: 'gear',
    hrefs: ['/salon/settings', '/salon/notifications', '/salon/billing', '/salon/integrations', '/salon/connections', '/salon/trash'] },
];

/** Every menu item, by route. */
export const ITEM_BY_HREF: Record<string, NavItem> = Object.fromEntries(
  [DASHBOARD, ...GROUPS.flatMap((g) => g.items)].map((i) => [i.href, i]),
);

/** Routes that are not menu items but belong to an area (so the rail still lights up). */
const EXTRA_SECTION: [string, SectionId][] = [
  ['/salon/account', 'account'], ['/salon/usage-costs', 'account'], ['/salon/chain', 'finance'],
];

/** The menu item a route belongs to: the longest matching prefix among `hrefs`. */
export function activeHref(pathname: string, hrefs: string[]): string | null {
  let best: string | null = null;
  for (const h of hrefs) {
    const hit = h === '/salon' ? pathname === '/salon' : (pathname === h || pathname.startsWith(h + '/'));
    if (hit && (!best || h.length > best.length)) best = h;
  }
  return best;
}

/** The area a route belongs to (defaults to Operations). */
export function sectionFor(pathname: string): SectionId {
  const all = SECTIONS.flatMap((s) => s.hrefs);
  const href = activeHref(pathname, all);
  if (href) return SECTIONS.find((s) => s.hrefs.includes(href))!.id;
  const extra = EXTRA_SECTION.find(([p]) => pathname === p || pathname.startsWith(p + '/'));
  return extra ? extra[1] : 'ops';
}
