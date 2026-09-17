import { ConflictException, NotFoundException } from '@nestjs/common';
import { WalkinsService } from './walkins.service';

// Deleting a walk-in is the one action on this board that leaves nothing
// behind. Everything below is about the two ways that goes wrong: erasing a
// visit that money is attached to, and erasing another salon's.
const ADMIN = { userId: 'u1', role: 'SALON_ADMIN', tenantId: 'tenant-a' } as never;

function makePrisma(opts: { found?: boolean; invoices?: number } = {}) {
  const found = opts.found ?? true;
  return {
    walkIn: {
      findFirst: jest.fn(async () => (found ? { id: 'w1', tenantId: 'tenant-a' } : null)),
      delete: jest.fn(async () => ({ id: 'w1' })),
    },
    order: { count: jest.fn(async () => opts.invoices ?? 0) },
  };
}
const svc = (prisma: unknown) => new WalkinsService(prisma as never, {} as never, {} as never);

describe('deleting a walk-in', () => {
  it('deletes a ticket that never became money', () => {
    const prisma = makePrisma();
    return svc(prisma).remove(ADMIN, 'w1').then((r) => {
      expect(r).toEqual({ ok: true });
      expect(prisma.walkIn.delete).toHaveBeenCalledWith({ where: { id: 'w1' } });
    });
  });

  // THE MONEY RULE, same shape as the one on self-cancel: a row with revenue
  // behind it is not this button's to remove. Deleting it would leave an order
  // pointing at a visit that no longer exists, and the day's takings and the
  // day's visits would stop agreeing with each other.
  it('refuses once an invoice exists, and deletes nothing', async () => {
    const prisma = makePrisma({ invoices: 1 });
    await expect(svc(prisma).remove(ADMIN, 'w1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.walkIn.delete).not.toHaveBeenCalled();
  });

  it('says where to go instead of just saying no', async () => {
    const prisma = makePrisma({ invoices: 2 });
    await expect(svc(prisma).remove(ADMIN, 'w1')).rejects.toThrow(/Đơn hàng/);
  });

  it('counts invoices within the tenant, never by walk-in id alone', async () => {
    const prisma = makePrisma();
    await svc(prisma).remove(ADMIN, 'w1');
    expect(prisma.order.count).toHaveBeenCalledWith({ where: { tenantId: 'tenant-a', walkInId: 'w1' } });
  });

  it('cannot reach a walk-in belonging to another salon', async () => {
    const prisma = makePrisma({ found: false });
    await expect(svc(prisma).remove(ADMIN, 'w1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.walkIn.delete).not.toHaveBeenCalled();
  });

  // The count runs on a Prisma client that may predate the walkInId column on
  // this machine. A crash there must not become "you may not delete this".
  it('treats an unreadable invoice count as no invoice, not as a refusal', async () => {
    const prisma = makePrisma();
    prisma.order.count = jest.fn(async () => { throw new Error('no such column'); });
    await expect(svc(prisma).remove(ADMIN, 'w1')).resolves.toEqual({ ok: true });
  });
});
