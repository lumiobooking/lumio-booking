/**
 * Dishes ordered with a reservation: ids + quantities from the page, names and
 * prices from THIS restaurant's active menu only.
 */
import { UserRole } from '@prisma/client';
import { BookingsService } from './bookings.service';
import { buildPreOrder, preOrderText, preOrderTotal } from './pre-order';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

const MENU = [
  { id: 'pho', tenantId: 'r1', name: 'Phở bò', priceCents: 1500, isActive: true },
  { id: 'roll', tenantId: 'r1', name: 'Gỏi cuốn', priceCents: 800, isActive: true },
  { id: 'old', tenantId: 'r1', name: 'Bánh cũ', priceCents: 500, isActive: false },
  { id: 'theirs', tenantId: 'r2', name: 'Their steak', priceCents: 9900, isActive: true },
];

describe('pre-order — rules', () => {
  it('merges repeats, caps quantities, drops unknown dishes, takes names and prices from the menu', () => {
    const lines = buildPreOrder([{ menuItemId: 'pho', qty: 2 }, { menuItemId: 'pho', qty: 1 }, { menuItemId: 'roll', qty: 99 }, { menuItemId: 'nope', qty: 1 }, { menuItemId: 'roll', qty: 0 }], MENU.slice(0, 2));
    expect(lines).toEqual([{ id: 'pho', name: 'Phở bò', qty: 3, priceCents: 1500 }, { id: 'roll', name: 'Gỏi cuốn', qty: 50, priceCents: 800 }]);
    expect(preOrderText(lines)).toBe('3× Phở bò, 50× Gỏi cuốn');
    expect(preOrderTotal(lines)).toBe(3 * 1500 + 50 * 800);
    expect(buildPreOrder(undefined, MENU)).toEqual([]);
  });
});

describe('pre-order — on a reservation, one restaurant\'s menu only', () => {
  function make() {
    const created: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const tx = {
      $executeRaw: jest.fn(async () => 1),
      customer: { upsert: jest.fn(async () => ({ id: 'c1' })), create: jest.fn(async () => ({ id: 'c1' })), findFirst: jest.fn(async () => null) },
      appointment: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: any) => { created.push(data); return { id: 'ap1', ...data }; }) }, // eslint-disable-line @typescript-eslint/no-explicit-any
      tenant: { findUnique: jest.fn(async () => ({ businessType: 'SALON' })) },
    };
    const menuFind = jest.fn(async ({ where }: any) => MENU.filter((m) => m.tenantId === where.tenantId && m.isActive === where.isActive && where.id.in.includes(m.id))); // eslint-disable-line @typescript-eslint/no-explicit-any
    const prisma = {
      service: { findFirst: jest.fn(async ({ where }: any) => ({ id: 'svc', tenantId: where.tenantId, durationMinutes: 90, priceCents: 0, currency: 'USD', isActive: true })) }, // eslint-disable-line @typescript-eslint/no-explicit-any
      staffMember: { findFirst: jest.fn(async () => ({ id: 's1' })) },
      appointment: { findFirst: jest.fn(async () => null), count: jest.fn(async () => 0), updateMany: jest.fn(async () => ({ count: 1 })) },
      menuItem: { findMany: menuFind },
      tenant: { findUnique: jest.fn(async () => ({ timezone: 'America/Los_Angeles' })) },
      $transaction: jest.fn(async (cb: any) => cb(tx)), // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const settings = {
      getBookingRules: jest.fn(async () => ({ businessHours: Array(7).fill({ closed: false, openMinutes: 0, closeMinutes: 1439 }), daysOff: [], assignmentMode: 'none' })),
      getNotificationSettings: jest.fn(async () => ({ emailCustomerOnBooking: false, emailAdminOnBooking: false, smsCustomerOnBooking: false, smsAdminOnBooking: false, smtp: {}, twilio: {} })),
    };
    const noop = { log: jest.fn(async () => undefined), send: jest.fn(async () => undefined), resolveReferrerId: jest.fn(async () => null), notifyNewBooking: jest.fn(async () => undefined), softDelete: jest.fn(async () => undefined), settleOnComplete: jest.fn(async () => undefined), rankEligibleStaff: jest.fn(async () => ({ orderedStaffIds: [], ranked: [] })) };
    const svc = new BookingsService(prisma as never, noop as never, noop as never, noop as never, settings as never, noop as never, noop as never, noop as never, noop as never);
    return { svc, prisma, created, menuFind };
  }
  const owner = (t: string) => ({ userId: 'u', email: 'o@x.test', role: UserRole.SALON_ADMIN, tenantId: t }) as AuthenticatedUser;
  const dto = (pre: unknown) => ({ serviceId: 'svc', startTime: '2099-06-20T19:00:00.000Z', customerFirstName: 'Anna', partySize: 4, notes: 'Window', preOrder: pre }) as never;

  it('stores the dishes and writes them into the notes', async () => {
    const { svc, prisma, created, menuFind } = make();
    await svc.create(owner('r1'), dto([{ menuItemId: 'pho', qty: 2 }, { menuItemId: 'theirs', qty: 1 }, { menuItemId: 'old', qty: 1 }]));
    expect(menuFind.mock.calls[0][0].where.tenantId).toBe('r1');
    expect(created[0].notes).toBe('Window · Pre-order: 2× Phở bò');
    const up = prisma.appointment.updateMany.mock.calls[0][0];
    expect(up.where).toEqual({ id: 'ap1', tenantId: 'r1' });
    expect(up.data.preOrder).toEqual([{ id: 'pho', name: 'Phở bò', qty: 2, priceCents: 1500 }]);
  });

  it('another restaurant\'s dish orders nothing', async () => {
    const { svc, prisma, created } = make();
    await svc.create(owner('r1'), dto([{ menuItemId: 'theirs', qty: 3 }]));
    expect(created[0].notes).toBe('Window');
    expect(prisma.appointment.updateMany).not.toHaveBeenCalled();
  });

  it('an address (a property to view, a client\'s home) is stored on the booking and in the notes', async () => {
    const { svc, prisma, created } = make();
    await svc.create(owner('r1'), { ...(dto(undefined) as object), notes: undefined, location: '  12  Main St,\n Austin ' } as never);
    expect(created[0].notes).toBe('Address: 12 Main St, Austin');
    const up = prisma.appointment.updateMany.mock.calls[0][0];
    expect(up.where).toEqual({ id: 'ap1', tenantId: 'r1' });
    expect(up.data).toEqual({ location: '12 Main St, Austin' });
  });

  it('no pre-order: no menu query, nothing extra', async () => {
    const { svc, menuFind, prisma } = make();
    await svc.create(owner('r1'), dto(undefined));
    expect(menuFind).not.toHaveBeenCalled();
    expect(prisma.appointment.updateMany).not.toHaveBeenCalled();
  });
});
