/**
 * Which salon screens a Lumio setup employee sees, at their level.
 *
 * The salon's own menu is already gated twice — by capability (what this ROLE
 * may do) and by the per-salon feature switches (what this SALON was handed).
 * Neither answers the question this file exists for, because a support session
 * borrows the salon admin's role and therefore its full capability list.
 *
 * WHY IT IS A SECOND MAP RATHER THAN AN EDIT TO THE FIRST ONE
 *
 * `HREF_CAP` in SalonShell is deliberately incomplete: `/salon/activity`,
 * `/salon/inbox`, `/salon/connections` and `/salon/card-transactions` carry no
 * capability, which is how a receptionist can still answer the inbox. Adding
 * capabilities there to narrow Lumio's own staff would take those screens away
 * from paying salons' receptionists on the same deploy. So the tighter map
 * lives here and is consulted ONLY for a support session.
 *
 * The API enforces the same rule independently (support-scope.ts on the
 * server). This half decides what is worth showing; that half decides what is
 * allowed to happen, and it does not trust this one.
 */

/** Screens nobody is ever narrowed out of: your own account, and the door out. */
const ALWAYS: string[] = ['/salon/account', '/agency'];

/**
 * Every salon route a support session can reach, and the capability that owns
 * it. A route absent from this map is treated as owned by nothing and stays
 * visible — new screens should be added here deliberately, but a forgotten one
 * must not blank the menu.
 */
export const SUPPORT_HREF_CAP: Record<string, string> = {
  '/salon': 'dashboard',

  // the day's work — every one of these is a named customer at a named time
  '/salon/calendar': 'calendar',
  '/salon/bookings': 'bookings',
  '/salon/walkins': 'walkins',
  '/salon/waitlist': 'waitlist',
  '/salon/activity': 'bookings',
  '/salon/customers': 'customers',

  // the till
  '/salon/pos': 'pos',
  '/salon/pos/report': 'reports',
  '/salon/orders': 'orders',
  '/salon/gift-cards': 'pos',
  '/salon/payments': 'payments',
  '/salon/payment-terminals': 'payments',
  '/salon/card-transactions': 'payments',
  '/salon/reports': 'reports',
  '/salon/chain': 'reports',
  '/salon/payroll': 'payroll',
  '/salon/inventory': 'inventory',
  '/salon/billing': 'billing',
  '/salon/usage-costs': 'billing',

  // the catalog and the people
  '/salon/services': 'services',
  '/salon/menu': 'services',
  '/salon/tables': 'services',
  '/salon/products': 'products',
  '/salon/staff': 'staff',
  '/salon/stations': 'staff',

  // the marketing, which is what most of these accounts are for
  '/salon/content': 'marketing',
  '/salon/approve-posts': 'marketing',
  '/salon/marketing': 'marketing',
  '/salon/marketing/monthly': 'marketing',
  '/salon/email': 'marketing',
  '/salon/inbox': 'marketing',
  '/salon/messenger': 'marketing',
  '/salon/voice': 'marketing',
  '/staff/inbox': 'marketing',
  '/salon/reviews': 'reviews',
  '/salon/reviews-replies': 'reviews',

  // the machinery
  '/salon/notifications': 'notifications',
  '/salon/integrations': 'integrations',
  '/salon/connections': 'integrations',
  '/salon/settings': 'settings',
  '/salon/trash': 'settings',
};

/** Prefix match with a path boundary, so one spelling cannot claim another. */
function owns(base: string, path: string): boolean {
  return path === base || path.startsWith(base + '/');
}

/** The capability that owns this screen for a support session, or null. */
export function supportCapFor(path: string): string | null {
  const p = String(path ?? '').split('?')[0];
  if (ALWAYS.some((b) => owns(b, p))) return null;
  let best: { len: number; cap: string } | null = null;
  for (const [base, cap] of Object.entries(SUPPORT_HREF_CAP)) {
    if (!owns(base, p)) continue;
    if (!best || base.length > best.len) best = { len: base.length, cap };
  }
  return best?.cap ?? null;
}

/** May a support session holding these capabilities open this screen? */
export function supportMaySee(path: string, caps: string[]): boolean {
  const cap = supportCapFor(path);
  return !cap || caps.includes(cap);
}

/** What the level is called, for the banner and the account list. */
export const SUPPORT_LEVEL_LABEL: Record<string, string> = {
  content: 'Nội dung & marketing',
  setup: 'Setup (không xem tiền & khách)',
  full: 'Toàn quyền',
};
