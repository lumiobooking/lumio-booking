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

// Owner-only areas a Manager should NOT touch.
const OWNER_ONLY: Capability[] = ['integrations', 'billing', 'settings'];

const MANAGER_CAPS: Capability[] = ALL_CAPS.filter((c) => !OWNER_ONLY.includes(c));

// Cashier / front desk: greet, book, check in, take payment. No revenue
// dashboard / reports — they don't see the salon's totals.
const RECEPTIONIST_CAPS: Capability[] = [
  'pos', 'orders', 'calendar', 'bookings', 'walkins', 'waitlist', 'customers',
];

/** The capabilities a user is allowed, derived from their role + staff sub-role. */
export function capabilitiesFor(role: UserRole, staffRole?: StaffRole | null): Capability[] {
  // Salon owner + platform admin: everything.
  if (role === UserRole.SALON_ADMIN || role === UserRole.SUPER_ADMIN) return [...ALL_CAPS];
  if (role === UserRole.STAFF) {
    if (staffRole === StaffRole.MANAGER) return [...MANAGER_CAPS];
    if (staffRole === StaffRole.RECEPTIONIST) return [...RECEPTIONIST_CAPS];
    return []; // TECHNICIAN: no salon-admin areas — they use the staff portal.
  }
  return [];
}

export function hasCapability(role: UserRole, staffRole: StaffRole | null | undefined, cap: Capability): boolean {
  return capabilitiesFor(role, staffRole).includes(cap);
}
