/**
 * "Nails removal, nail cut, polish change — we don't book an appointment for
 * that. First come, first served." A service flagged walkInOnly is off the
 * booking page and refused by every channel that creates appointments; the
 * walk-in board still takes it. One salon's flag never reaches another's menu.
 */
import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { BookingsService, walkInOnlyMessage } from './bookings.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const SERVICES: Row[] = [
  { id: 'gel', tenantId: 't1', name: 'Gel Manicure', durationMinutes: 45, priceCents: 3500, currency: 'USD', isActive: true, walkInOnly: false, categoryId: 'mani', addons: [] },
  { id: 'polish', tenantId: 't1', name: 'Polish Change', durationMinutes: 15, priceCents: 1500, currency: 'USD', isActive: true, walkInOnly: true, categoryId: 'mani', addons: [] },
  { id: 'other', tenantId: 't2', name: 'Polish Change', durationMinutes: 15, priceCents: 1200, currency: 'USD', isActive: true, walkInOnly: false, categoryId: null, addons: [] },
];
const ADDONS: Row[] = [
  { id: 'design', tenantId: 't1', serviceId: null, categoryId: 'mani', name: 'Design', durationMinutes: 20, priceCents: 1000, currency: 'USD', isActive: true, askAtBooking: true },
];
const matches = (r: Row, where: Row): boolean => Object.entries(where).every(([k, v]) => {
  if (k === 'OR') return (v as Row[]).some((w) => matches(r, w));
  if (v && typeof v === 'object' && 'in' in v) return (v.in as unknown[]).includes(r[k]);
  return (r[k] ?? null) === v;
});

function make() {
  const created: Row[] = [];
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    customer: { upsert: jest.fn(async () => ({ id: 'c1' })), create: jest.fn(async () => ({ id: 'c1' })), findFirst: jest.fn(async () => null) },
    appointment: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: Row) => { created.push(data); return { id: 'ap1', ...data }; }) },
    tenant: { findUnique: jest.fn(async () => ({ businessType: 'SALON' })) },
  };
  const prisma = {
    service: {
      findFirst: jest.fn(async ({ where }: Row) => SERVICES.find((s) => matches(s, where)) ?? null),
      findMany: jest.fn(async ({ where }: Row) => SERVICES.filter((s) => matches(s, where))),
    },
    serviceAddon: { findMany: jest.fn(async ({ where }: Row) => ADDONS.filter((a) => matches(a, where))) },
    staffMember: { findFirst: jest.fn(async () => ({ id: 's1' })) },
    appointment: { findFirst: jest.fn(async () => null), count: jest.fn(async () => 0), updateMany: jest.fn(async () => ({ count: 1 })) },
    menuItem: { findMany: jest.fn(async () => []) },
    tenant: { findUnique: jest.fn(async () => ({ timezone: 'America/Los_Angeles' })) },
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const settings = {
    getBookingRules: jest.fn(async () => ({ businessHours: Array(7).fill({ closed: false, openMinutes: 0, closeMinutes: 1439 }), daysOff: [], assignmentMode: 'none' })),
    getNotificationSettings: jest.fn(async () => ({ emailCustomerOnBooking: false, emailAdminOnBooking: false, smsCustomerOnBooking: false, smsAdminOnBooking: false, smtp: {}, twilio: {} })),
  };
  const noop = { log: jest.fn(async () => undefined), send: jest.fn(async () => undefined), resolveReferrerId: jest.fn(async () => null), notifyNewBooking: jest.fn(async () => undefined), softDelete: jest.fn(async () => undefined), settleOnComplete: jest.fn(async () => undefined), rankEligibleStaff: jest.fn(async () => ({ orderedStaffIds: [], ranked: [] })) };
  const svc = new BookingsService(prisma as never, noop as never, noop as never, noop as never, settings as never, noop as never, noop as never, noop as never, noop as never);
  return { svc, prisma, created };
}
const owner = (t: string) => ({ userId: 'u', email: 'o@x.test', role: UserRole.SALON_ADMIN, tenantId: t }) as AuthenticatedUser;
const dto = (serviceId: string, extra: Row = {}) => ({ serviceId, startTime: '2099-06-20T19:00:00.000Z', customerFirstName: 'Anna', customerPhone: '+12105550101', ...extra }) as never;

describe('walk-in only', () => {
  it('the message every channel says', () => {
    expect(walkInOnlyMessage('Polish Change')).toMatch(/^Polish Change is walk-in only .*just come in\.$/);
  });

  it('is refused as an appointment — alone or as the second service — by the desk, the web and the AI alike', async () => {
    const { svc, created } = make();
    await expect(svc.create(owner('t1'), dto('polish'))).rejects.toThrow(BadRequestException);
    await expect(svc.createForTenant('t1', dto('polish'), null, 'web')).rejects.toThrow(/walk-in only/);
    await expect(svc.createForTenant('t1', dto('polish'), null, 'hotline')).rejects.toThrow(/walk-in only/);
    await expect(svc.createForTenant('t1', dto('gel', { serviceIds: ['gel', 'polish'] }), null, 'messenger')).rejects.toThrow(/Polish Change is walk-in only/);
    expect(created).toHaveLength(0);
    // The bookable one still books, and the "Design?" extra lengthens it.
    await svc.createForTenant('t1', dto('gel', { addonIds: ['design'] }), null, 'web');
    expect(created).toHaveLength(1);
    expect(new Date(created[0].endTime).getTime() - new Date(created[0].startTime).getTime()).toBe((45 + 20) * 60_000);
  });

  it('is off the booking page but listed as a note; the other salon\'s same-named service is untouched', async () => {
    const { svc } = make();
    const page = (await svc.publicServices('t1')) as Row[];
    expect(page.map((s) => s.id)).toEqual(['gel']);
    expect(page[0].addons.map((a: Row) => [a.name, a.askAtBooking])).toEqual([['Design', true]]);
    expect((await svc.walkInOnlyServices('t1')).map((x) => [x.id, x.name])).toEqual([['polish', 'Polish Change']]);
    expect(((await svc.publicServices('t2')) as Row[]).map((s) => s.id)).toEqual(['other']);
    expect(await svc.walkInOnlyServices('t2')).toEqual([]);
  });
});
