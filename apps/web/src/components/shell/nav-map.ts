/**
 * The salon admin's menu: every screen, and the two ways of showing it.
 *
 * GROUPS is the classic sidebar (five collapsible groups). SECTIONS is the
 * two-tier menu of the new layout (an icon rail of six areas, each opening a
 * short list). Both read the SAME items, so a screen added to GROUPS cannot
 * silently go missing from the new menu — nav-map.spec.ts fails if it does.
 *
 * One job, one place (menu review 2026-10-21). Screens that do the same job
 * are ONE menu entry whose `tabs` are the screens themselves: the entry opens
 * the first tab the person may see, and every tab page shows the same tab
 * strip on top. Nothing was deleted and no route moved — saved links, QR
 * codes, push notifications and the permission of each screen are unchanged;
 * a tab this person may not open (role, plan, market, agency switch) is simply
 * not drawn.
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
export type NavItem = {
  href: string; label: string; icon: string;
  feature?: 'pos'; biz?: 'restaurant'; market?: 'na'; team?: true;
  /** A menu entry gathering several screens. The first tab is this screen itself. */
  tabs?: NavItem[];
  /** i18n key of the menu entry's name when it gathers tabs (each tab keeps its own). */
  hubKey?: string;
  /** i18n key of the screen's name on the tab strip, when it differs from its menu name. */
  tabKey?: string;
};
export type NavGroup = { id: string; label: string; items: NavItem[] };

/** A tab may carry `?tab=` (one screen, several views). Gating reads the page itself. */
export const basePath = (href: string) => href.split('?')[0];

// Every screen once, so a tab and its menu entry can never disagree on gating.
const S = {
  dashboard: { href: '/salon', label: 'Dashboard', icon: 'home', tabKey: 'navt.overview' },
  activity: { href: '/salon/activity', label: 'Activity', icon: 'pulse' },
  frontDesk: { href: '/salon/front-desk', label: 'Front desk', icon: 'desk' },
  calendar: { href: '/salon/calendar', label: 'Calendar', icon: 'calendarDays', tabKey: 'navt.calendar' },
  bookings: { href: '/salon/bookings', label: 'Bookings', icon: 'calendarCheck', tabKey: 'navt.bookingList' },
  waitlist: { href: '/salon/waitlist', label: 'Waitlist', icon: 'hourglass', tabKey: 'navt.waitlist' },
  walkins: { href: '/salon/walkins', label: 'Walk-ins · Turns', icon: 'walk' },
  tables: { href: '/salon/tables', label: 'Tables', icon: 'utensils', biz: 'restaurant' },
  menu: { href: '/salon/menu', label: 'Menu', icon: 'bowl', biz: 'restaurant' },
  pos: { href: '/salon/pos', label: 'POS / Checkout', icon: 'register', feature: 'pos' },
  orders: { href: '/salon/orders', label: 'Orders', icon: 'receipt', feature: 'pos', tabKey: 'navt.bills' },
  payments: { href: '/salon/payments', label: 'Payments', icon: 'dollar' },
  // North America only. The whole screen is the card terminal's receipt book —
  // void, refund, approval code, batch number, card brand, all of it Dejavoo —
  // and the terminal itself is already vetoed for Vietnam by the market.
  cardTx: { href: '/salon/card-transactions', label: 'Card transactions', icon: 'card', feature: 'pos', market: 'na' },
  shifts: { href: '/salon/pos/shifts', label: 'Cashier shifts', icon: 'drawer', feature: 'pos' },
  customers: { href: '/salon/customers', label: 'Customers', icon: 'users' },
  // The inbox sits with clients: the receptionist answers it fifty times a day.
  inbox: { href: '/salon/inbox', label: 'Inbox', icon: 'inboxTray' },
  // Two-button feedback after every visit: the owner's cases and each tech's scorecard.
  feedback: { href: '/salon/feedback', label: 'Feedback', icon: 'thumbs', tabKey: 'navt.feedback' },
  googleReviews: { href: '/salon/reviews-replies', label: 'Google reviews', icon: 'starChat' },
  reviews: { href: '/salon/reviews', label: 'Reviews & rewards', icon: 'award', tabKey: 'navt.reviewQr' },
  // Massage / spa paperwork: intake, consent and SOAP notes (massage & spa salons only).
  forms: { href: '/salon/forms', label: 'Client forms', icon: 'formSign' },
  giftCards: { href: '/salon/gift-cards', label: 'Gift cards', icon: 'gift', feature: 'pos' },
  services: { href: '/salon/services', label: 'Services', icon: 'nailPolish' },
  products: { href: '/salon/products', label: 'Products', icon: 'bag', feature: 'pos' },
  inventory: { href: '/salon/inventory', label: 'Inventory', icon: 'box', feature: 'pos' },
  staff: { href: '/salon/staff', label: 'Staff', icon: 'userBadge', tabKey: 'navt.team' },
  stations: { href: '/salon/stations', label: 'Chairs', icon: 'chair', tabKey: 'nav.chairs' },
  content: { href: '/salon/content', label: 'Marketing plan & posts', icon: 'wand', tabKey: 'navt.plan' },
  // The client's own door: preview + approve what is about to publish.
  // Deliberately its own route, NOT the content page — that page is the
  // agency's kitchen and has its own switch; this one is the dining room.
  approvePosts: { href: '/salon/approve-posts', label: 'Post approval', icon: 'docCheck' },
  // One door for every channel the shop publishes to or is reached on.
  channels: { href: '/salon/channels', label: 'Social channels', icon: 'share' },
  marketing: { href: '/salon/marketing', label: 'Marketing', icon: 'megaphone', tabKey: 'navt.offers' },
  email: { href: '/salon/email', label: 'Email marketing', icon: 'mail', tabKey: 'navt.email' },
  marketingReport: { href: '/salon/marketing/monthly', label: 'Marketing report', icon: 'chart' },
  ai: { href: '/salon/ai', label: 'AI brain', icon: 'brain', tabKey: 'navt.brain' },
  messenger: { href: '/salon/messenger', label: 'Messenger bot', icon: 'bot', tabKey: 'navt.messenger' },
  voice: { href: '/salon/voice', label: 'AI Hotline', icon: 'headset', tabKey: 'navt.hotline' },
  reports: { href: '/salon/reports', label: 'Business report', icon: 'trendUp', tabKey: 'navt.revenue' },
  techReport: { href: '/salon/pos/report', label: 'Sales report', icon: 'pie', feature: 'pos', tabKey: 'navt.byTech' },
  serviceReport: { href: '/salon/reports?tab=services', label: 'Services', icon: 'sparkle', tabKey: 'navt.byService' },
  clientReport: { href: '/salon/reports?tab=clients', label: 'Clients & bookings', icon: 'users', tabKey: 'navt.clientsBookings' },
  chain: { href: '/salon/chain', label: 'Multi-location', icon: 'store', tabKey: 'navt.locations' },
  payroll: { href: '/salon/payroll', label: 'Staff & pay', icon: 'banknote', feature: 'pos' },
  // Thu & Chi: the cash book, the P&L and the costs that come round.
  finance: { href: '/salon/finance', label: 'Income & expenses', icon: 'wallet', tabKey: 'navt.finOverview' },
  financeLedger: { href: '/salon/finance?tab=ledger', label: 'Cash book', icon: 'wallet', tabKey: 'navt.finLedger' },
  financeRecurring: { href: '/salon/finance?tab=recurring', label: 'Recurring costs', icon: 'wallet', tabKey: 'navt.finRecurring' },
  settings: { href: '/salon/settings', label: 'Settings', icon: 'cog', tabKey: 'navt.salonSettings' },
  notifications: { href: '/salon/notifications', label: 'Notifications', icon: 'bell', tabKey: 'navt.templates' },
  terminals: { href: '/salon/payment-terminals', label: 'Card terminals', icon: 'terminal', feature: 'pos' },
  billing: { href: '/salon/billing', label: 'Billing & plan', icon: 'crown' },
  integrations: { href: '/salon/integrations', label: 'Integrations', icon: 'puzzle' },
  // Lumio's wiring board — every OAuth, token and webhook behind the salon.
  // An owner reading it sees a wall of red for things Lumio runs on its behalf. Team only.
  connections: { href: '/salon/connections', label: 'Connections', icon: 'plug', team: true },
  // Deleted items live here for a week before they are gone for good.
  trash: { href: '/salon/trash', label: 'Recycle bin', icon: 'trash' },
} satisfies Record<string, NavItem>;

/** A menu entry made of several screens; it opens (and is named after) the hub, not the first tab. */
const hub = (hubKey: string, label: string, tabs: NavItem[]): NavItem => ({ ...tabs[0], label, hubKey, tabs });

// Dashboard sits on its own above the collapsible groups. Activity (the feed
// of what just happened) is its second tab rather than a menu entry.
export const DASHBOARD: NavItem = hub('nav.dashboard', 'Dashboard', [S.dashboard, S.activity]);

export const GROUPS: NavGroup[] = [
  { id: 'ops', label: 'Operations', items: [
    // The receptionist's home: arriving, waiting, in a chair, ready to pay.
    S.frontDesk,
    hub('navh.appointments', 'Appointments', [S.calendar, S.bookings, S.waitlist]),
    S.walkins,
    S.tables, S.menu,
    S.pos,
    // Every money record: the till's bills, the payment ledger, what the card
    // terminal did, and the cashier's drawer — four menu entries before.
    hub('navh.orders', 'Orders', [S.orders, S.payments, S.cardTx, S.shifts]),
  ] },
  { id: 'clients', label: 'Clients & Catalog', items: [
    S.customers,
    S.inbox,
    hub('navh.reviews', 'Reviews', [S.feedback, S.googleReviews, S.reviews]),
    S.forms,
    S.giftCards,
    S.services,
    hub('navh.products', 'Products & stock', [S.products, S.inventory]),
    hub('navh.staff', 'Staff', [S.staff, S.stations]),
  ] },
  { id: 'growth', label: 'Marketing & AI', items: [
    hub('navh.posts', 'Posts', [S.content, S.approvePosts]),
    S.channels,
    hub('navh.campaigns', 'Campaigns', [S.marketing, S.email]),
    S.marketingReport,
    // The brain is what the hotline and the Messenger bot both read.
    hub('navh.ai', 'AI assistant', [S.ai, S.messenger, S.voice]),
  ] },
  { id: 'finance', label: 'Finance', items: [
    // One report, one number per question: sales by technician lived on three
    // screens (business report, sales report, payroll's performance tab).
    hub('navh.reports', 'Reports', [S.reports, S.techReport, S.serviceReport, S.clientReport, S.chain]),
    // Where the money went: the profit & loss, the cash book, recurring costs.
    hub('navh.finance', 'Income & expenses', [S.finance, S.financeLedger, S.financeRecurring]),
    S.payroll,
  ] },
  { id: 'account', label: 'Account', items: [
    // Settings, the message templates and the card terminals are all "set once".
    hub('navh.settings', 'Settings', [S.settings, S.notifications, S.terminals]),
    S.billing,
    S.integrations,
    S.connections,
    S.trash,
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
 * uses a screen and when, not by what kind of data it holds. Same entries,
 * same order as GROUPS (the classic sidebar folds clients and catalog together).
 */
export const SECTIONS: Section[] = [
  { id: 'ops', vi: 'Vận hành', en: 'Operations', viDesc: 'Điều hành tiệm hằng ngày', enDesc: 'Run the floor day to day', icon: 'store',
    hrefs: ['/salon', '/salon/front-desk', '/salon/calendar', '/salon/walkins', '/salon/tables', '/salon/menu', '/salon/pos', '/salon/orders'] },
  { id: 'clients', vi: 'Khách hàng', en: 'Clients', viDesc: 'Khách, tin nhắn, đánh giá', enDesc: 'Clients, messages, reviews', icon: 'users',
    hrefs: ['/salon/customers', '/salon/inbox', '/salon/feedback', '/salon/forms', '/salon/gift-cards'] },
  { id: 'catalog', vi: 'Dịch vụ & Thợ', en: 'Services & team', viDesc: 'Menu, sản phẩm, đội thợ', enDesc: 'Menu, products, team', icon: 'nailPolish',
    hrefs: ['/salon/services', '/salon/products', '/salon/staff'] },
  { id: 'growth', vi: 'Marketing & AI', en: 'Marketing & AI', viDesc: 'Kéo khách mới, giữ khách cũ', enDesc: 'Win and keep clients', icon: 'megaphone',
    hrefs: ['/salon/content', '/salon/channels', '/salon/marketing', '/salon/marketing/monthly', '/salon/ai'] },
  { id: 'finance', vi: 'Tài chính', en: 'Finance', viDesc: 'Báo cáo, thu chi, lương', enDesc: 'Reports, money in & out, pay', icon: 'wallet',
    hrefs: ['/salon/reports', '/salon/finance', '/salon/payroll'] },
  { id: 'account', vi: 'Cài đặt', en: 'Settings', viDesc: 'Làm một lần, ít khi quay lại', enDesc: 'Set once, rarely revisited', icon: 'cog',
    hrefs: ['/salon/settings', '/salon/billing', '/salon/integrations', '/salon/connections', '/salon/trash'] },
];

const MENU_ITEMS: NavItem[] = [DASHBOARD, ...GROUPS.flatMap((g) => g.items)];

/** Every menu entry, by route (a gathering entry is keyed by its first tab). */
export const ITEM_BY_HREF: Record<string, NavItem> = Object.fromEntries(MENU_ITEMS.map((i) => [i.href, i]));

/** Every screen, tabs included, by route — what the page guard and links ask about. */
export const SCREEN_BY_HREF: Record<string, NavItem> = Object.fromEntries(
  MENU_ITEMS.flatMap((i) => (i.tabs ?? [i])).map((i) => [i.href, i]),
);

/** Screen route → the menu entry it lives under. */
const OWNER: Record<string, string> = Object.fromEntries(
  MENU_ITEMS.flatMap((i) => (i.tabs ?? [i]).map((t) => [basePath(t.href), i.href] as [string, string])),
);

/** Routes that are not menu screens but belong to an area (so the rail still lights up). */
const EXTRA_SECTION: [string, SectionId][] = [
  ['/salon/account', 'account'], ['/salon/usage-costs', 'account'],
];
/** Deep pages that are reached from a screen whose route is not their prefix. */
const EXTRA_OWNER: [string, string][] = [
  ['/salon/marketing/report', '/salon/marketing/monthly'],
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

/** The menu entry a route lives under — a tab's route answers with its gathering entry. */
export function menuOwner(pathname: string): string | null {
  const extra = EXTRA_OWNER.find(([p]) => pathname === p || pathname.startsWith(p + '/'));
  if (extra) return extra[1];
  const screen = activeHref(pathname, Object.keys(OWNER));
  return screen ? OWNER[screen] : null;
}

/** The area a route belongs to (defaults to Operations). */
export function sectionFor(pathname: string): SectionId {
  const owner = menuOwner(pathname);
  const s = owner ? SECTIONS.find((x) => x.hrefs.includes(owner)) : undefined;
  if (s) return s.id;
  const extra = EXTRA_SECTION.find(([p]) => pathname === p || pathname.startsWith(p + '/'));
  return extra ? extra[1] : 'ops';
}

/**
 * Which tab of a strip is the page on. Longest route wins (`/salon/pos/shifts`
 * is not `/salon/pos`); among tabs of the same route the one whose `?tab=`
 * matches, else the plain one.
 */
export function activeTab(tabs: NavItem[], pathname: string, tabParam: string | null): string | null {
  const route = activeHref(pathname, tabs.map((t) => basePath(t.href)));
  if (!route) return null;
  const same = tabs.filter((t) => basePath(t.href) === route);
  const q = (h: string) => new URLSearchParams(h.split('?')[1] ?? '').get('tab');
  return (same.find((t) => tabParam && q(t.href) === tabParam) ?? same.find((t) => !q(t.href)) ?? same[0]).href;
}
