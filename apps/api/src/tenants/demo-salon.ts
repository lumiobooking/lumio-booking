/**
 * A demo salon's data — for the App Store / Google Play reviewer, the store
 * screenshots and sales demos. Everything here is invented: customer names,
 * @example.com emails and 555-01xx phone numbers (reserved for fiction), so
 * nothing can reach a real person.
 *
 * Pure: builds rows; TenantsService.loadDemoData writes them into ONE salon
 * (its tenantId on every row) and only into a salon that is a demo — see
 * demoAllowed().
 */
import { addDaysToKey, dayKeyTz, wallTimeToUtcTz } from '../common/salon-time';

export const DEMO_TENANT_KEY = 'demo_tenant';

export interface DemoService { key: string; name: string; durationMinutes: number; priceCents: number }
export interface DemoStaff { key: string; firstName: string; lastName: string }
export interface DemoCustomer { key: string; firstName: string; lastName: string; email: string; phone: string }
export interface DemoBooking {
  day: number; // 0 = today, 1 = tomorrow…
  at: string; // salon-local "HH:MM"
  service: string; staff: string | null; customer: string;
  source: string;
  /** Wanted status if the slot is still ahead; a slot already over is COMPLETED (or stays CANCELLED). */
  status: 'CONFIRMED' | 'PENDING' | 'CANCELLED';
  cancelledBy?: 'customer';
  note?: string;
}

export const DEMO_SERVICES: DemoService[] = [
  { key: 'gel', name: 'Gel Manicure', durationMinutes: 45, priceCents: 4000 },
  { key: 'pedi', name: 'Classic Pedicure', durationMinutes: 45, priceCents: 3500 },
  { key: 'spa', name: 'Deluxe Spa Pedicure', durationMinutes: 60, priceCents: 5500 },
  { key: 'acrylic', name: 'Acrylic Full Set', durationMinutes: 75, priceCents: 6000 },
  { key: 'dip', name: 'Dip Powder', durationMinutes: 60, priceCents: 5000 },
  { key: 'gelx', name: 'Gel-X Extensions', durationMinutes: 90, priceCents: 7000 },
];

export const DEMO_STAFF: DemoStaff[] = [
  { key: 'lisa', firstName: 'Lisa', lastName: 'Tran' },
  { key: 'kim', firstName: 'Kim', lastName: 'Nguyen' },
  { key: 'mai', firstName: 'Mai', lastName: 'Le' },
  { key: 'tina', firstName: 'Tina', lastName: 'Pham' },
];

const C = (key: string, firstName: string, lastName: string, n: number): DemoCustomer => ({
  key, firstName, lastName,
  email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
  phone: `+1512555${String(100 + n).padStart(4, '0')}`, // 555-0100…0199: fictional numbers
});
export const DEMO_CUSTOMERS: DemoCustomer[] = [
  C('anna', 'Anna', 'Miller', 1), C('jenny', 'Jenny', 'Lopez', 2), C('sophia', 'Sophia', 'Reed', 3),
  C('emma', 'Emma', 'Clark', 4), C('olivia', 'Olivia', 'Brooks', 5), C('mia', 'Mia', 'Hayes', 6),
  C('chloe', 'Chloe', 'Bennett', 7), C('grace', 'Grace', 'Ward', 8), C('lily', 'Lily', 'Foster', 9),
  C('zoe', 'Zoe', 'Hughes', 10), C('ava', 'Ava', 'Price', 11), C('ella', 'Ella', 'Sanders', 12),
];

/** Three days of a busy, believable salon. */
export const DEMO_BOOKINGS: DemoBooking[] = [
  { day: 0, at: '09:30', service: 'gel', staff: 'lisa', customer: 'anna', source: 'admin', status: 'CONFIRMED' },
  { day: 0, at: '10:00', service: 'spa', staff: 'kim', customer: 'jenny', source: 'hosted', status: 'CONFIRMED' },
  { day: 0, at: '10:30', service: 'acrylic', staff: 'mai', customer: 'sophia', source: 'messenger', status: 'CONFIRMED', note: 'Almond shape, nude pink' },
  { day: 0, at: '11:00', service: 'dip', staff: 'tina', customer: 'emma', source: 'plugin', status: 'CONFIRMED' },
  { day: 0, at: '12:30', service: 'gelx', staff: 'lisa', customer: 'olivia', source: 'instagram', status: 'CONFIRMED' },
  { day: 0, at: '13:00', service: 'pedi', staff: 'kim', customer: 'mia', source: 'admin', status: 'CONFIRMED' },
  { day: 0, at: '14:30', service: 'gel', staff: 'mai', customer: 'chloe', source: 'hosted', status: 'PENDING' },
  { day: 0, at: '15:00', service: 'spa', staff: 'tina', customer: 'grace', source: 'plugin', status: 'CONFIRMED' },
  { day: 0, at: '16:00', service: 'acrylic', staff: 'kim', customer: 'lily', source: 'messenger', status: 'CANCELLED', cancelledBy: 'customer' },
  { day: 0, at: '16:30', service: 'dip', staff: 'lisa', customer: 'zoe', source: 'hosted', status: 'CONFIRMED' },
  { day: 0, at: '17:30', service: 'gel', staff: null, customer: 'ava', source: 'plugin', status: 'PENDING' },
  { day: 1, at: '10:00', service: 'gelx', staff: 'mai', customer: 'ella', source: 'instagram', status: 'PENDING' },
  { day: 1, at: '10:30', service: 'pedi', staff: 'lisa', customer: 'jenny', source: 'admin', status: 'CONFIRMED' },
  { day: 1, at: '11:30', service: 'gel', staff: 'tina', customer: 'sophia', source: 'hosted', status: 'CONFIRMED' },
  { day: 1, at: '14:00', service: 'acrylic', staff: 'kim', customer: 'anna', source: 'messenger', status: 'CONFIRMED' },
  { day: 1, at: '16:00', service: 'spa', staff: 'mai', customer: 'grace', source: 'plugin', status: 'CONFIRMED' },
  { day: 2, at: '09:30', service: 'dip', staff: 'lisa', customer: 'olivia', source: 'hosted', status: 'CONFIRMED' },
  { day: 2, at: '11:00', service: 'gel', staff: 'kim', customer: 'mia', source: 'admin', status: 'CONFIRMED' },
  { day: 2, at: '13:30', service: 'gelx', staff: 'tina', customer: 'chloe', source: 'instagram', status: 'CONFIRMED' },
];

export interface BookingRow {
  dayKey: string;
  startTime: Date; endTime: Date;
  status: 'COMPLETED' | 'CONFIRMED' | 'PENDING' | 'CANCELLED' | 'ARRIVED';
  serviceKey: string; staffKey: string | null; customerKey: string;
  priceCents: number; source: string; notes: string | null;
  confirmedAt: Date | null; completedAt: Date | null; arrivedAt: Date | null; cancelledAt: Date | null; cancelledBy: string | null;
  createdAt: Date;
}

/**
 * The bookings for the salon's today and the next two days, in its timezone.
 * A visit already over is COMPLETED; one going on now is ARRIVED (in the
 * chair); later ones keep their status. Skips days listed in `skipDays`
 * (they already have bookings — running it twice must not double a day).
 */
export function buildDemoBookings(now: Date, tz: string, skipDays: Set<string> = new Set()): BookingRow[] {
  const today = dayKeyTz(now, tz);
  const svc = new Map(DEMO_SERVICES.map((s) => [s.key, s]));
  const out: BookingRow[] = [];
  for (const b of DEMO_BOOKINGS) {
    const dayKey = addDaysToKey(today, b.day);
    if (skipDays.has(dayKey)) continue;
    const s = svc.get(b.service);
    if (!s) continue;
    const startTime = wallTimeToUtcTz(dayKey, b.at, tz);
    const endTime = new Date(startTime.getTime() + s.durationMinutes * 60_000);
    let status: BookingRow['status'] = b.status;
    if (b.status !== 'CANCELLED') {
      if (endTime.getTime() <= now.getTime()) status = 'COMPLETED';
      else if (startTime.getTime() <= now.getTime()) status = 'ARRIVED';
    }
    const createdAt = new Date(Math.min(now.getTime() - 20 * 60_000 * (out.length + 1), startTime.getTime() - 3600_000));
    out.push({
      dayKey, startTime, endTime, status,
      serviceKey: b.service, staffKey: b.staff, customerKey: b.customer,
      priceCents: s.priceCents, source: b.source, notes: b.note ?? null,
      confirmedAt: status === 'PENDING' ? null : createdAt,
      completedAt: status === 'COMPLETED' ? endTime : null,
      arrivedAt: status === 'ARRIVED' || status === 'COMPLETED' ? startTime : null,
      cancelledAt: status === 'CANCELLED' ? new Date(Math.min(now.getTime() - 30 * 60_000, startTime.getTime() - 3600_000)) : null,
      cancelledBy: status === 'CANCELLED' ? (b.cancelledBy ?? 'customer') : null,
      // Bookings customers made in the last hours show in the bell's "Mới đặt" (new) tab.
      createdAt,
    });
  }
  return out;
}

/**
 * Demo data only goes into a demo salon: one already marked as the demo, or a
 * brand-new, empty salon whose name says "demo". Never into a working salon.
 */
export function demoAllowed(t: { name: string; marked: boolean; customers: number; appointments: number }): { ok: true } | { ok: false; reason: string } {
  if (t.marked) return { ok: true };
  if (!/demo/i.test(t.name)) return { ok: false, reason: 'Only a salon whose name contains "Demo" can get demo data (e.g. "Lumio Demo Nails").' };
  if (t.customers > 0 || t.appointments > 0) return { ok: false, reason: 'This salon already has customers or bookings — demo data only goes into a new, empty salon.' };
  return { ok: true };
}
