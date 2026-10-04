import { StaffRole, UserRole } from '@prisma/client';

/**
 * Feature permissions ("capabilities"). Each maps to a salon admin area / nav
 * item and is checked both in the frontend (to hide menus) and the backend
 * (to reject API calls) so a restricted user can't bypass the UI.
 */
export type Capability =
  | 'dashboard'
  | 'pos'
  | 'orders'
  | 'calendar'
  | 'bookings'
  | 'walkins'
  | 'waitlist'
  | 'customers'
  | 'services'
  | 'products'
  | 'staff'
  | 'payroll'
  | 'reviews'
  | 'marketing'
  | 'inventory'
  | 'reports'
  | 'payments'
  | 'notifications'
  | 'integrations'
  | 'billing'
  | 'settings';

export const ALL_CAPS: Capability[] = [
  'dashboard', 'pos', 'orders', 'calendar', 'bookings', 'walkins', 'waitlist',
  'customers', 'services', 'products', 'staff', 'payroll', 'reviews', 'marketing',
  'inventory', 'reports', 'payments', 'notifications', 'integrations', 'billing', 'settings',
];

// Owner-only areas no staff account is ever handed, whatever its role or the
// owner's per-person picks: the subscription, the connected accounts and the
// salon's settings belong to the person who signs for the salon.
export const OWNER_ONLY: Capability[] = ['integrations', 'billing', 'settings'];

/** Everything a staff account CAN be given. */
export const STAFF_GRANTABLE: Capability[] = ALL_CAPS.filter((c) => !OWNER_ONLY.includes(c));

const MANAGER_CAPS: Capability[] = [...STAFF_GRANTABLE];

// Cashier / front desk: greet, book, check in, take payment. No revenue
// dashboard / reports — they don't see the salon's totals.
const RECEPTIONIST_CAPS: Capability[] = [
  'pos', 'orders', 'calendar', 'bookings', 'walkins', 'waitlist', 'customers',
];

/** What each role starts with — the preset the owner can then adjust per person. */
export const ROLE_PRESETS: Record<StaffRole, Capability[]> = {
  MANAGER: MANAGER_CAPS,
  RECEPTIONIST: RECEPTIONIST_CAPS,
  TECHNICIAN: [], // their own schedule and work only — the staff portal
};

/**
 * A per-person list as stored or as sent by the owner, made safe: only known
 * capability ids, only ones a staff account may hold, no duplicates, in the
 * catalogue's order. Anything that is not an array reads as "no custom list"
 * (null) — never as "nothing" and never as "everything".
 */
export function cleanStaffCaps(raw: unknown): Capability[] | null {
  if (!Array.isArray(raw)) return null;
  const want = new Set(raw.map((x) => String(x)));
  return STAFF_GRANTABLE.filter((c) => want.has(c));
}

/**
 * The capabilities a user is allowed, derived from their role + staff sub-role,
 * or — for a staff member the owner adjusted — from that person's own list.
 */
export function capabilitiesFor(role: UserRole, staffRole?: StaffRole | null, custom?: unknown): Capability[] {
  // Salon owner + platform admin: everything.
  if (role === UserRole.SALON_ADMIN || role === UserRole.SUPER_ADMIN) return [...ALL_CAPS];
  if (role === UserRole.STAFF) {
    const own = cleanStaffCaps(custom);
    if (own) return own;
    return [...(ROLE_PRESETS[(staffRole ?? StaffRole.TECHNICIAN) as StaffRole] ?? [])];
  }
  return [];
}

export function hasCapability(role: UserRole, staffRole: StaffRole | null | undefined, cap: Capability, custom?: unknown): boolean {
  return capabilitiesFor(role, staffRole, custom).includes(cap);
}
