/**
 * Booking at the DESK (the salon's own staff, not the online page).
 *
 * From the screenshots: a booking typed as "11:40" became 11:40 PM on a salon
 * that closes at 6 and nothing objected; and a desk booking with no technician
 * picked sat "unassigned" until someone pressed a button. Now:
 *  - the desk may only book a START time inside opening hours (owner may override);
 *  - with no technician chosen, the engine picks one, as for an online booking.
 * Every read is the caller's own salon.
 */
import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { BookingsService } from './bookings.service';
import { startsInBusinessHours } from '../settings/business-hours';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

const owner: AuthenticatedUser = { userId: 'u-own', email: 'o@a.test', role: UserRole.SALON_ADMIN, tenantId: 'tenant-a' };
const desk = { userId: 'u-desk', email: 'letan@a.test', role: UserRole.STAFF, tenantId: 'tenant-a', staffRole: 'RECEPTIONIST', capabilities: ['bookings'] } as unknown as AuthenticatedUser;
const deskB = { ...desk, userId: 'u-desk-b', tenantId: 'tenant-b' } as AuthenticatedUser;

// Los Angeles in June is UTC-7. Open 9:00–18:00 every day.
const AT_1140_AM = '2099-06-20T18:40:00.000Z';
const AT_1140_PM = '2099-06-21T06:40:00.000Z';
const HOURS = { businessHours: Array(7).fill({ closed: false, openMinutes: 9 * 60, closeMinutes: 18 * 60 }), daysOff: [], assignmentMode: 'none' };

function make() {
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    customer: { upsert: jest.fn(async () => ({ id: 'cust-1' })), create: jest.fn(async () => ({ id: 'cust-1' })), findFirst: jest.fn(async () => null) },
    appointment: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: any) => ({ id: 'appt-new', ...data })) }, // eslint-disable-line @typescript-eslint/no-explicit-any
    tenant: { findUnique: jest.fn(async () => ({ businessType: 'SALON' })) },
  };
  const tenantFind = jest.fn(async ({ where }: any) => ({ timezone: where.id === 'tenant-a' ? 'America/Los_Angeles' : 'Asia/Ho_Chi_Minh' })); // eslint-disable-line @typescript-eslint/no-explicit-any
  const prisma = {
    service: { findFirst: jest.fn(async ({ where }: any) => ({ id: 'svc-a', tenantId: where.tenantId, durationMinutes: 60, priceCents: 3500, currency: 'USD', isActive: true })) }, // eslint-disable-line @typescript-eslint/no-explicit-any
    staffMember: { findFirst: jest.fn(async () => ({ id: 'staff-1' })) },
    appointment: { findFirst: jest.fn(async () => null), count: jest.fn(async () => 0) },
    tenant: { findUnique: tenantFind },
    $transaction: jest.fn(async (cb: any) => cb(tx)), // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const settings = {
    getBookingRules: jest.fn(async () => HOURS),
    getNotificationSettings: jest.fn(async () => ({ emailCustomerOnBooking: false, emailAdminOnBooking: false, smsCustomerOnBooking: false, smsAdminOnBooking: false, smtp: {}, twilio: {} })),
  };
  const noop = { log: jest.fn(async () => undefined), send: jest.fn(async () => undefined), resolveReferrerId: jest.fn(async () => null), notifyNewBooking: jest.fn(async () => undefined), softDelete: jest.fn(async () => undefined), settleOnComplete: jest.fn(async () => undefined), rankEligibleStaff: jest.fn(async () => ({ orderedStaffIds: [], ranked: [] })) };
  const svc = new BookingsService(prisma as never, noop as never, noop as never, noop as never, settings as never, noop as never, noop as never, noop as never, noop as never);
  return { svc, prisma, tenantFind };
}
const dto = (startTime: string, extra: Record<string, unknown> = {}) => ({ serviceId: 'svc-a', startTime, customerFirstName: 'linh', ...extra }) as never;

describe('the desk rule: the appointment must START while the salon is open', () => {
  const day = { closed: false, openMinutes: 540, closeMinutes: 1080 };
  it('start inside the window passes, at closing time or later does not', () => {
    expect(startsInBusinessHours({ day, startMinutes: 9 * 60 })).toBe(true);
    expect(startsInBusinessHours({ day, startMinutes: 17 * 60 + 30 })).toBe(true); // may run past 6 — a human call
    expect(startsInBusinessHours({ day, startMinutes: 18 * 60 })).toBe(false);
    expect(startsInBusinessHours({ day, startMinutes: 23 * 60 + 40 })).toBe(false);
    expect(startsInBusinessHours({ day: { ...day, closed: true }, startMinutes: 600 })).toBe(false);
  });
});

describe('a receptionist booking at the desk', () => {
  it('11:40 PM on a salon open 9–6 is refused, with the salon-time reason', async () => {
    const { svc } = make();
    await expect(svc.create(desk, dto(AT_1140_PM))).rejects.toThrow(BadRequestException);
    await expect(svc.create(desk, dto(AT_1140_PM))).rejects.toThrow(/^OUTSIDE_HOURS: Sat 2099-06-20 23:40/);
  });

  it('11:40 AM goes through', async () => {
    const { svc } = make();
    const b: any = await svc.create(desk, dto(AT_1140_AM)); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(b.tenantId).toBe('tenant-a');
  });

  it('a receptionist cannot override; the owner can, on purpose', async () => {
    const { svc } = make();
    await expect(svc.create(desk, dto(AT_1140_PM, { outsideHours: true }))).rejects.toThrow(/OUTSIDE_HOURS/);
    const b: any = await svc.create(owner, dto(AT_1140_PM, { outsideHours: true })); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(b.id).toBe('appt-new');
  });

  it('reads the hours and timezone of HER salon only', async () => {
    const { svc, tenantFind } = make();
    await svc.create(desk, dto(AT_1140_AM));
    expect(tenantFind.mock.calls.every((c: any[]) => c[0].where.id === 'tenant-a')).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
    // Same instant, another salon in another timezone (Vietnam: 01:40 on the 21st) — judged by ITS clock.
    await expect(svc.create(deskB, dto(AT_1140_AM))).rejects.toThrow(/OUTSIDE_HOURS: Sun 2099-06-21 01:40/);
  });
});

describe('no technician chosen at the desk: the system picks one', () => {
  it('asks the engine to assign when no technician was chosen', async () => {
    const { svc } = make();
    const spy = jest.spyOn(svc, 'createForTenant').mockResolvedValue({} as never);
    await svc.create(desk, dto(AT_1140_AM));
    expect(spy.mock.calls[0][5]).toEqual({ autoAssign: true });
    expect(spy.mock.calls[0][0]).toBe('tenant-a');
  });

  it('not when a technician was chosen, nor when the desk leaves it open on purpose', async () => {
    const { svc } = make();
    const spy = jest.spyOn(svc, 'createForTenant').mockResolvedValue({} as never);
    await svc.create(desk, dto(AT_1140_AM, { staffId: 'staff-1' }));
    await svc.create(desk, dto(AT_1140_AM, { autoAssign: false }));
    expect(spy.mock.calls.map((c) => c[5])).toEqual([{ autoAssign: false }, { autoAssign: false }]);
  });

  it('never passes a receptionist’s outsideHours through', async () => {
    const { svc } = make();
    const spy = jest.spyOn(svc, 'createForTenant').mockResolvedValue({} as never);
    await svc.create(desk, dto(AT_1140_PM, { outsideHours: true }));
    await svc.create(owner, dto(AT_1140_PM, { outsideHours: true }));
    expect((spy.mock.calls[0][1] as { outsideHours?: boolean }).outsideHours).toBe(false);
    expect((spy.mock.calls[1][1] as { outsideHours?: boolean }).outsideHours).toBe(true);
  });
});

describe('moving a booking at the desk is held to the same opening hours', () => {
  // A 10:00 AM booking (LA) for tenant-a, assigned to staff-1.
  const TEN_AM = new Date('2099-06-20T17:00:00.000Z');
  function withBooking() {
    const m = make();
    const booking = { id: 'b1', tenantId: 'tenant-a', status: 'CONFIRMED', startTime: TEN_AM, endTime: new Date(TEN_AM.getTime() + 3600_000), assignedStaffId: 'staff-1' };
    (m.prisma.appointment as any).findFirst = jest.fn(async ({ where }: any) => (where.id === 'b1' && where.tenantId === 'tenant-a' ? booking : null)); // eslint-disable-line @typescript-eslint/no-explicit-any
    const tx = { $executeRaw: jest.fn(async () => 1), appointment: { findFirst: jest.fn(async () => null), updateMany: jest.fn(async () => ({ count: 1 })) } };
    (m.prisma as any).$transaction = jest.fn(async (cb: any) => { const r = await cb(tx); return r ?? booking; }); // eslint-disable-line @typescript-eslint/no-explicit-any
    return { ...m, tx };
  }

  it('dragging it to 11:40 PM is refused for the receptionist', async () => {
    const { svc, tx } = withBooking();
    await expect(svc.reschedule(desk, 'b1', AT_1140_PM)).rejects.toThrow(/OUTSIDE_HOURS: Sat 2099-06-20 23:40/);
    await expect(svc.move(desk, 'b1', AT_1140_PM, 'staff-2')).rejects.toThrow(/OUTSIDE_HOURS/);
    expect(tx.appointment.updateMany).not.toHaveBeenCalled();
  });

  it('11:40 AM moves; the owner may move it after hours on purpose; a receptionist’s override is ignored', async () => {
    const { svc, tx } = withBooking();
    await svc.reschedule(desk, 'b1', AT_1140_AM);
    await expect(svc.reschedule(desk, 'b1', AT_1140_PM, true)).rejects.toThrow(/OUTSIDE_HOURS/);
    await svc.reschedule(owner, 'b1', AT_1140_PM, true);
    expect(tx.appointment.updateMany).toHaveBeenCalledTimes(2);
  });

  it('handing it to another technician at the SAME time is never blocked', async () => {
    const { svc, tx, prisma } = withBooking();
    (prisma.staffMember as any).findFirst = jest.fn(async () => ({ id: 'staff-2', isActive: true })); // eslint-disable-line @typescript-eslint/no-explicit-any
    await svc.move(desk, 'b1', TEN_AM.toISOString(), 'staff-2');
    expect(tx.appointment.updateMany).toHaveBeenCalled();
  });

  it('another salon’s booking is not found, whatever the time', async () => {
    const { svc } = withBooking();
    await expect(svc.reschedule(deskB, 'b1', AT_1140_AM)).rejects.toThrow(/not found/i);
  });
});
