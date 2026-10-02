import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { BookingsService } from './bookings.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

const salonA: AuthenticatedUser = {
  userId: 'u-a',
  email: 'admin@salon-a.test',
  role: UserRole.SALON_ADMIN,
  tenantId: 'tenant-a',
};

const futureStart = '2099-06-20T14:00:00.000Z';

const baseDto = {
  serviceId: 'svc-a',
  startTime: futureStart,
  staffId: 'staff-1',
  customerFirstName: 'Jane',
  customerEmail: 'jane@example.com',
};

/**
 * Builds a Prisma mock. `overlapConflict` controls whether the in-transaction
 * overlap check finds a clashing appointment.
 */
function makePrisma(opts: { overlapConflict: boolean; serviceTenantId?: string }) {
  const tx = {
    $executeRaw: jest.fn(async () => 1), // advisory lock no-op
    customer: {
      upsert: jest.fn(async () => ({ id: 'cust-1' })),
      create: jest.fn(async () => ({ id: 'cust-1' })),
    },
    appointment: {
      // overlap check
      findFirst: jest.fn(async () => (opts.overlapConflict ? { id: 'existing' } : null)),
      create: jest.fn(async ({ data }: any) => ({ id: 'appt-new', ...data })),
    },
    // createForTenant reads the tenant's businessType inside the transaction to
    // decide whether to auto-assign a restaurant table. A nail salon is the
    // case these tests are about, so it answers SALON.
    tenant: {
      findUnique: jest.fn(async () => ({ businessType: 'SALON' })),
    },
  };

  const prisma = {
    service: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.tenantId === (opts.serviceTenantId ?? 'tenant-a')
          ? { id: 'svc-a', tenantId: 'tenant-a', durationMinutes: 60, priceCents: 3500, currency: 'USD', isActive: true }
          : null,
      ),
    },
    staffMember: {
      findFirst: jest.fn(async () => ({ id: 'staff-1' })),
    },
    appointment: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.tenantId === 'tenant-a' ? { id: where.id, tenantId: 'tenant-a' } : null,
      ),
    },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
    _tx: tx,
  };
  return prisma;
}

const audit = { log: jest.fn(async () => undefined) };
// The assignment engine is not exercised by these create/isolation tests.
const assignment = { rankEligibleStaff: jest.fn(async () => ({ orderedStaffIds: [], ranked: [] })) };
// Notifications are fire-and-forget; a no-op mock is enough here.
const notifications = { send: jest.fn(async () => undefined) };
// Settings: notification config read during the fire-and-forget confirmation.
const settings = {
  getNotificationSettings: jest.fn(async () => ({
    senderName: '', adminEmail: '', adminPhone: '',
    emailCustomerOnBooking: false, emailAdminOnBooking: false,
    smsCustomerOnBooking: false, smsAdminOnBooking: false,
    smtp: { host: 'smtp.gmail.com', port: 465, user: '', pass: '', fromEmail: '' },
    twilio: { accountSid: '', authToken: '', fromNumber: '' },
  })),
};

const payments = { settleOnComplete: jest.fn(async () => undefined) };

// Referrals: a booking with no referral code attributes to nobody.
const referral = { resolveReferrerId: jest.fn(async () => null) };
// Push and trash are fire-and-forget from create(); no-ops are enough.
const push = { notifyNewBooking: jest.fn(async () => undefined) };
const trash = { softDelete: jest.fn(async () => undefined) };

/**
 * Build the service under test.
 *
 * WHY A HELPER RATHER THAN `new BookingsService(...)` IN EVERY TEST
 *
 * The constructor grew three dependencies — referral, push, trash — and the
 * fourteen call sites in this file did not. TypeScript could not catch it
 * because every argument was already cast to `any`, so the tests kept compiling
 * and started failing at runtime with "Cannot read properties of undefined
 * (reading 'resolveReferrerId')".
 *
 * That is worse than a broken test: four of the checks protecting
 * double-booking and tenant isolation were dead, and had been for a while,
 * while the suite reported them as ordinary failures nobody was reading. One
 * construction site means the next added dependency breaks in one place.
 */
function makeService(prisma: unknown) {
  return new BookingsService(
    prisma as never, audit as never, assignment as never, notifications as never,
    settings as never, payments as never, referral as never, push as never, trash as never,
  );
}

describe('BookingsService double-booking prevention', () => {
  it('rejects a booking that overlaps an existing one for the same staff', async () => {
    const prisma = makePrisma({ overlapConflict: true });
    const svc = makeService(prisma);

    await expect(svc.create(salonA, baseDto as any)).rejects.toBeInstanceOf(ConflictException);
    // It must NOT create the appointment when a conflict exists.
    expect(prisma._tx.appointment.create).not.toHaveBeenCalled();
  });

  it('acquires the advisory lock before checking overlap (race safety)', async () => {
    const prisma = makePrisma({ overlapConflict: false });
    const svc = makeService(prisma);

    await svc.create(salonA, baseDto as any);

    // Lock first, then the overlap query, then create.
    const lockOrder = prisma._tx.$executeRaw.mock.invocationCallOrder[0];
    const overlapOrder = prisma._tx.appointment.findFirst.mock.invocationCallOrder[0];
    const createOrder = prisma._tx.appointment.create.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(overlapOrder);
    expect(overlapOrder).toBeLessThan(createOrder);
  });

  it('creates an ASSIGNED booking stamped with the caller tenantId', async () => {
    const prisma = makePrisma({ overlapConflict: false });
    const svc = makeService(prisma);

    const result: any = await svc.create(salonA, baseDto as any);

    expect(result.tenantId).toBe('tenant-a');
    expect(result.status).toBe('ASSIGNED');
    expect(result.assignedStaffId).toBe('staff-1');
  });

  it('creates a PENDING booking when no staff is provided', async () => {
    const prisma = makePrisma({ overlapConflict: false });
    const svc = makeService(prisma);

    const { staffId, ...noStaff } = baseDto;
    const result: any = await svc.create(salonA, noStaff as any);

    expect(result.status).toBe('PENDING');
    expect(result.assignedStaffId).toBeNull();
    // No staff -> no advisory lock / overlap check needed.
    expect(prisma._tx.$executeRaw).not.toHaveBeenCalled();
  });
});

/**
 * The till's rebook: the customer who just paid, confirmed on the spot. Both
 * shortcuts exist for staff only — an end customer posting them is ignored.
 */
describe('BookingsService counter rebook', () => {
  it('books the customer on file (no twin record) and confirms at once for staff', async () => {
    const prisma = makePrisma({ overlapConflict: false });
    prisma._tx.customer.findFirst = jest.fn(async ({ where }: any) => (where.tenantId === 'tenant-a' && where.id === 'cust-on-file' ? { id: 'cust-on-file' } : null));
    const svc = makeService(prisma);

    const result: any = await svc.create(salonA, { ...baseDto, customerId: 'cust-on-file', confirmNow: true } as any, 'counter');

    expect(result.customerId).toBe('cust-on-file');
    expect(prisma._tx.customer.upsert).not.toHaveBeenCalled();
    expect(result.status).toBe('CONFIRMED');
    expect(result.confirmedAt).toBeInstanceOf(Date);
    expect(result.responseDeadline).toBeNull();
    expect(result.source).toBe('counter');
  });

  it('never lets a public booking pick a customer record or skip the technician\'s acceptance', async () => {
    const prisma = makePrisma({ overlapConflict: false });
    prisma._tx.customer.findFirst = jest.fn(async () => ({ id: 'cust-on-file' }));
    (prisma.appointment as any).count = jest.fn(async () => 0); // the public velocity cap
    (prisma as any).tenant = { findUnique: jest.fn(async () => ({ timezone: 'UTC' })) };
    // Open all week, so the opening-hours gate lets 14:00 UTC through.
    (settings as any).getBookingRules = jest.fn(async () => ({ businessHours: Array(7).fill({ closed: false, openMinutes: 0, closeMinutes: 1440 }), daysOff: [], assignmentMode: 'none' }));
    const svc = makeService(prisma);

    const result: any = await svc.createForTenant('tenant-a', { ...baseDto, customerId: 'cust-on-file', confirmNow: true, customerPhone: '+15125550123' } as any, null, 'hosted');

    expect(prisma._tx.customer.findFirst).not.toHaveBeenCalled();
    expect(result.customerId).toBe('cust-1'); // the upsert's own record
    expect(result.status).toBe('ASSIGNED');
    expect(result.responseDeadline).toBeInstanceOf(Date);
  });

  it('a customer id from another salon falls back to the normal upsert', async () => {
    const prisma = makePrisma({ overlapConflict: false });
    prisma._tx.customer.findFirst = jest.fn(async ({ where }: any) => (where.tenantId === 'tenant-a' ? null : { id: 'leak' }));
    const svc = makeService(prisma);

    const result: any = await svc.create(salonA, { ...baseDto, customerId: 'cust-of-tenant-b' } as any);

    expect(prisma._tx.customer.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'cust-of-tenant-b', tenantId: 'tenant-a' } }));
    expect(result.customerId).toBe('cust-1');
  });
});

describe('BookingsService reschedule', () => {
  const booked = {
    id: 'appt-1',
    tenantId: 'tenant-a',
    status: 'CONFIRMED',
    assignedStaffId: 'staff-1',
    startTime: new Date('2099-06-20T14:00:00.000Z'),
    endTime: new Date('2099-06-20T15:00:00.000Z'), // 60-minute visit
  };

  function primed(opts: { overlapConflict: boolean; booking?: any | null }) {
    const prisma = makePrisma({ overlapConflict: opts.overlapConflict });
    prisma.appointment.findFirst = jest.fn(async ({ where }: any) =>
      opts.booking === null || where.tenantId !== 'tenant-a' ? null : (opts.booking ?? booked),
    ) as any;
    (prisma._tx.appointment as any).updateMany = jest.fn(async () => ({ count: 1 }));
    return prisma;
  }

  it('404s when the booking belongs to another tenant', async () => {
    const prisma = primed({ overlapConflict: false, booking: null });
    const svc = makeService(prisma);
    await expect(svc.reschedule(salonA, 'appt-of-tenant-b', '2099-06-21T10:00:00.000Z')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a move onto a conflicting slot and does not update', async () => {
    const prisma = primed({ overlapConflict: true });
    const svc = makeService(prisma);
    await expect(svc.reschedule(salonA, 'appt-1', '2099-06-21T10:00:00.000Z')).rejects.toBeInstanceOf(ConflictException);
    expect((prisma._tx.appointment as any).updateMany).not.toHaveBeenCalled();
  });

  it('moves the booking, preserving duration and status', async () => {
    const prisma = primed({ overlapConflict: false });
    const svc = makeService(prisma);
    await svc.reschedule(salonA, 'appt-1', '2099-06-21T10:00:00.000Z');
    const data = (prisma._tx.appointment as any).updateMany.mock.calls[0][0].data;
    expect(data.startTime.toISOString()).toBe('2099-06-21T10:00:00.000Z');
    expect(data.endTime.toISOString()).toBe('2099-06-21T11:00:00.000Z'); // +60 min kept
    expect(data.status).toBeUndefined(); // status untouched
  });

  it('refuses to reschedule a finished booking', async () => {
    const prisma = primed({ overlapConflict: false, booking: { ...booked, status: 'COMPLETED' } });
    const svc = makeService(prisma);
    await expect(svc.reschedule(salonA, 'appt-1', '2099-06-21T10:00:00.000Z')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('BookingsService move (calendar drag)', () => {
  const booked = {
    id: 'appt-1', tenantId: 'tenant-a', status: 'CONFIRMED', assignedStaffId: 'staff-1',
    startTime: new Date('2099-06-20T14:00:00.000Z'), endTime: new Date('2099-06-20T15:00:00.000Z'),
  };
  function primed(opts: { overlapConflict: boolean; booking?: any | null }) {
    const prisma = makePrisma({ overlapConflict: opts.overlapConflict });
    prisma.appointment.findFirst = jest.fn(async ({ where }: any) =>
      opts.booking === null || where.tenantId !== 'tenant-a' ? null : (opts.booking ?? booked),
    ) as any;
    // Only tenant A's technicians are bookable for tenant A.
    prisma.staffMember.findFirst = jest.fn(async ({ where }: any) => (where.tenantId === 'tenant-a' && where.id !== 'staff-of-b' ? { id: where.id } : null)) as any;
    (prisma._tx.appointment as any).updateMany = jest.fn(async () => ({ count: 1 }));
    return prisma;
  }

  it('moves time and technician together, keeping duration and a confirmed status', async () => {
    const prisma = primed({ overlapConflict: false });
    await makeService(prisma).move(salonA, 'appt-1', '2099-06-20T16:30:00.000Z', 'staff-2');
    const call = (prisma._tx.appointment as any).updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'appt-1', tenantId: 'tenant-a' });
    expect(call.data.assignedStaffId).toBe('staff-2');
    expect(call.data.startTime.toISOString()).toBe('2099-06-20T16:30:00.000Z');
    expect(call.data.endTime.toISOString()).toBe('2099-06-20T17:30:00.000Z');
    expect(call.data.status).toBeUndefined();
    // The clash check ran against the NEW technician, inside the tenant.
    const overlapWhere = (prisma._tx.appointment.findFirst as jest.Mock).mock.calls[0][0].where;
    expect(overlapWhere).toMatchObject({ tenantId: 'tenant-a', assignedStaffId: 'staff-2' });
  });

  it('a clash on the new technician changes nothing', async () => {
    const prisma = primed({ overlapConflict: true });
    await expect(makeService(prisma).move(salonA, 'appt-1', '2099-06-20T16:30:00.000Z', 'staff-2')).rejects.toBeInstanceOf(ConflictException);
    expect((prisma._tx.appointment as any).updateMany).not.toHaveBeenCalled();
  });

  it('cannot move onto another salon\'s technician', async () => {
    const prisma = primed({ overlapConflict: false });
    await expect(makeService(prisma).move(salonA, 'appt-1', '2099-06-20T16:30:00.000Z', 'staff-of-b')).rejects.toBeInstanceOf(BadRequestException);
    expect((prisma._tx.appointment as any).updateMany).not.toHaveBeenCalled();
  });

  it('404s for another salon\'s booking', async () => {
    const prisma = primed({ overlapConflict: false, booking: null });
    await expect(makeService(prisma).move(salonA, 'appt-of-b', '2099-06-20T16:30:00.000Z', 'staff-2')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a finished booking', async () => {
    const prisma = primed({ overlapConflict: false, booking: { ...booked, status: 'COMPLETED' } });
    await expect(makeService(prisma).move(salonA, 'appt-1', '2099-06-20T16:30:00.000Z', 'staff-2')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('same technician = a plain reschedule', async () => {
    const prisma = primed({ overlapConflict: false });
    await makeService(prisma).move(salonA, 'appt-1', '2099-06-20T16:30:00.000Z', 'staff-1');
    const data = (prisma._tx.appointment as any).updateMany.mock.calls[0][0].data;
    expect(data.assignedStaffId).toBeUndefined();
    expect(data.startTime.toISOString()).toBe('2099-06-20T16:30:00.000Z');
  });
});

describe('BookingsService tenant isolation', () => {
  it('returns 404 when reading a booking that belongs to another tenant', async () => {
    const prisma = makePrisma({ overlapConflict: false });
    // Force appointment lookups to behave as if the row is in another tenant.
    prisma.appointment.findFirst = jest.fn(async (_args: any) => null) as any;
    const svc = makeService(prisma);

    await expect(svc.getById(salonA, 'appt-from-b')).rejects.toBeInstanceOf(NotFoundException);
  });
});
