import { ConflictException, NotFoundException } from '@nestjs/common';
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

describe('BookingsService double-booking prevention', () => {
  it('rejects a booking that overlaps an existing one for the same staff', async () => {
    const prisma = makePrisma({ overlapConflict: true });
    const svc = new BookingsService(prisma as any, audit as any, assignment as any, notifications as any, settings as any);

    await expect(svc.create(salonA, baseDto as any)).rejects.toBeInstanceOf(ConflictException);
    // It must NOT create the appointment when a conflict exists.
    expect(prisma._tx.appointment.create).not.toHaveBeenCalled();
  });

  it('acquires the advisory lock before checking overlap (race safety)', async () => {
    const prisma = makePrisma({ overlapConflict: false });
    const svc = new BookingsService(prisma as any, audit as any, assignment as any, notifications as any, settings as any);

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
    const svc = new BookingsService(prisma as any, audit as any, assignment as any, notifications as any, settings as any);

    const result: any = await svc.create(salonA, baseDto as any);

    expect(result.tenantId).toBe('tenant-a');
    expect(result.status).toBe('ASSIGNED');
    expect(result.assignedStaffId).toBe('staff-1');
  });

  it('creates a PENDING booking when no staff is provided', async () => {
    const prisma = makePrisma({ overlapConflict: false });
    const svc = new BookingsService(prisma as any, audit as any, assignment as any, notifications as any, settings as any);

    const { staffId, ...noStaff } = baseDto;
    const result: any = await svc.create(salonA, noStaff as any);

    expect(result.status).toBe('PENDING');
    expect(result.assignedStaffId).toBeNull();
    // No staff -> no advisory lock / overlap check needed.
    expect(prisma._tx.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('BookingsService tenant isolation', () => {
  it('returns 404 when reading a booking that belongs to another tenant', async () => {
    const prisma = makePrisma({ overlapConflict: false });
    // Force appointment lookups to behave as if the row is in another tenant.
    prisma.appointment.findFirst = jest.fn(async (_args: any) => null) as any;
    const svc = new BookingsService(prisma as any, audit as any, assignment as any, notifications as any, settings as any);

    await expect(svc.getById(salonA, 'appt-from-b')).rejects.toBeInstanceOf(NotFoundException);
  });
});
