import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { GiftCardsService } from './gift-cards.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

const audit = { log: jest.fn(async () => undefined) };
const settings = { getBookingRules: jest.fn(async () => ({ currency: 'USD' })) };

const salonA: AuthenticatedUser = {
  userId: 'u-a', email: 'a@a.test', role: UserRole.SALON_ADMIN, tenantId: 'tenant-a',
};

function makePrisma(seed: any[]) {
  const rows = [...seed];
  const prisma: any = {
    giftCard: {
      findFirst: jest.fn(async ({ where }: any) =>
        rows.find((r) => {
          if (where.tenantId && r.tenantId !== where.tenantId) return false;
          if (where.id && r.id !== where.id) return false;
          if (where.code && r.code !== where.code) return false;
          return true;
        }) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) => rows.filter((r) => r.tenantId === where.tenantId)),
      create: jest.fn(async ({ data }: any) => { const c = { id: 'gc-new', ...data }; rows.push(c); return c; }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of rows) {
          if (r.id !== where.id || r.tenantId !== where.tenantId) continue;
          if (where.status && r.status !== where.status) continue;
          if (where.balanceCents?.gte !== undefined && r.balanceCents < where.balanceCents.gte) continue;
          if (data.balanceCents?.decrement !== undefined) r.balanceCents -= data.balanceCents.decrement;
          else if (data.balanceCents?.increment !== undefined) r.balanceCents += data.balanceCents.increment;
          else if (typeof data.balanceCents === 'number') r.balanceCents = data.balanceCents;
          if (data.status) r.status = data.status;
          count++;
        }
        return { count };
      }),
    },
    giftCardTransaction: { create: jest.fn(async () => ({})), findMany: jest.fn(async () => []) },
    payment: { create: jest.fn(async () => ({})) },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };
  return prisma;
}

describe('GiftCardsService tenant isolation + balance math', () => {
  it('lookup cannot see another tenant card', async () => {
    const prisma = makePrisma([{ id: 'gc-b', tenantId: 'tenant-b', code: 'GCB', balanceCents: 5000, status: 'ACTIVE' }]);
    const svc = new GiftCardsService(prisma, audit as any, settings as any);
    await expect(svc.lookup(salonA, 'GCB')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('issue creates a card at full balance + records revenue', async () => {
    const prisma = makePrisma([]);
    const svc = new GiftCardsService(prisma, audit as any, settings as any);
    const card = await svc.issue(salonA, { amountCents: 5000, code: 'PLASTIC1' } as any);
    expect(card.balanceCents).toBe(5000);
    expect(card.initialCents).toBe(5000);
    expect(prisma.payment.create).toHaveBeenCalled();
  });

  it('redeemInTx deducts the balance', async () => {
    const prisma = makePrisma([{ id: 'gc-a', tenantId: 'tenant-a', code: 'GCA', balanceCents: 3000, status: 'ACTIVE', expiresAt: null }]);
    const svc = new GiftCardsService(prisma, audit as any, settings as any);
    const applied = await svc.redeemInTx(prisma, 'tenant-a', 'GCA', 2000, 'order-1', 'u-a');
    expect(applied).toBe(2000);
    const card = (await prisma.giftCard.findMany({ where: { tenantId: 'tenant-a' } }))[0];
    expect(card.balanceCents).toBe(1000);
  });

  it('redeemInTx refuses another tenant card (no cross-tenant spend)', async () => {
    const prisma = makePrisma([{ id: 'gc-b', tenantId: 'tenant-b', code: 'GCB', balanceCents: 3000, status: 'ACTIVE', expiresAt: null }]);
    const svc = new GiftCardsService(prisma, audit as any, settings as any);
    await expect(svc.redeemInTx(prisma, 'tenant-a', 'GCB', 1000, 'order-1', 'u-a')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('redeemInTx caps the applied amount at the balance', async () => {
    const prisma = makePrisma([{ id: 'gc-a', tenantId: 'tenant-a', code: 'GCA', balanceCents: 1500, status: 'ACTIVE', expiresAt: null }]);
    const svc = new GiftCardsService(prisma, audit as any, settings as any);
    const applied = await svc.redeemInTx(prisma, 'tenant-a', 'GCA', 9999, 'order-1', 'u-a');
    expect(applied).toBe(1500);
    const card = (await prisma.giftCard.findMany({ where: { tenantId: 'tenant-a' } }))[0];
    expect(card.balanceCents).toBe(0);
    expect(card.status).toBe('REDEEMED');
  });
});
