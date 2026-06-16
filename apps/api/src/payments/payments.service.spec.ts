import { NotFoundException } from '@nestjs/common';
import { PaymentType, UserRole } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

const salonA: AuthenticatedUser = {
  userId: 'u-a',
  email: 'admin@salon-a.test',
  role: UserRole.SALON_ADMIN,
  tenantId: 'tenant-a',
};

function makePrisma(appointmentTenant: string | null) {
  return {
    appointment: {
      findFirst: jest.fn(async ({ where }: any) =>
        appointmentTenant && where.tenantId === appointmentTenant
          ? { id: 'appt-1', priceCents: 3500, currency: 'USD' }
          : null,
      ),
    },
    payment: {
      create: jest.fn(async ({ data }: any) => ({ id: 'pay-1', ...data })),
    },
  };
}

const audit = { log: jest.fn(async () => undefined) };
const loyalty = { award: jest.fn(async () => undefined) };

describe('PaymentsService', () => {
  it('PAY_ONLINE charges via the mock provider and is marked PAID', async () => {
    const prisma = makePrisma('tenant-a');
    const svc = new PaymentsService(prisma as any, audit as any, loyalty as any);

    const payment: any = await svc.createForBooking(salonA, {
      appointmentId: 'appt-1',
      type: PaymentType.PAY_ONLINE,
    });

    expect(payment.status).toBe('PAID');
    expect(payment.paidAt).not.toBeNull();
    expect(payment.providerReference).toContain('mock_ch_');
    expect(payment.tenantId).toBe('tenant-a');
  });

  it('PAY_LATER is recorded as PENDING with no charge', async () => {
    const prisma = makePrisma('tenant-a');
    const svc = new PaymentsService(prisma as any, audit as any, loyalty as any);

    const payment: any = await svc.createForBooking(salonA, {
      appointmentId: 'appt-1',
      type: PaymentType.PAY_LATER,
    });

    expect(payment.status).toBe('PENDING');
    expect(payment.paidAt).toBeNull();
  });

  it('rejects creating a payment for another tenant booking', async () => {
    // The appointment belongs to tenant-b; salonA must not be able to pay it.
    const prisma = makePrisma('tenant-b');
    const svc = new PaymentsService(prisma as any, audit as any, loyalty as any);

    await expect(
      svc.createForBooking(salonA, { appointmentId: 'appt-1', type: PaymentType.PAY_ONLINE }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
