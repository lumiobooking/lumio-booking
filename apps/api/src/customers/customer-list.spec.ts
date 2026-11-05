import { CustomersService, CUSTOMER_LIST_MAX } from './customers.service';

describe('the client list', () => {
  const book = (tenantId: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${tenantId}-${i}`, tenantId, firstName: `C${i}`, lastName: null, email: null, phone: null, createdAt: new Date(2026, 0, 1 + (i % 300)), birthDate: null, loyaltyPoints: 0, _count: { appointments: 0 } }));
  const rows = [...book('salonA', 2710), ...book('salonB', 40)];
  const prisma = {
    customer: {
      findMany: jest.fn(async (a: { where: { tenantId: string }; take?: number }) => rows.filter((r) => r.tenantId === a.where.tenantId).slice(0, a.take ?? Infinity)),
    },
    appointment: { groupBy: jest.fn(async () => []) },
  };
  const svc = new CustomersService(prisma as never, {} as never, {} as never);
  const owner = (tenantId: string) => ({ userId: 'u', tenantId, role: 'SALON_ADMIN' }) as never;

  it('returns every imported client, not just the newest 500', async () => {
    expect(CUSTOMER_LIST_MAX).toBeGreaterThanOrEqual(20_000);
    const list = await svc.list(owner('salonA'));
    expect(list).toHaveLength(2710);
  });

  it('only ever lists the caller’s own salon', async () => {
    const list = await svc.list(owner('salonB'));
    expect(list).toHaveLength(40);
    expect(list.every((c) => String(c.id).startsWith('salonB-'))).toBe(true);
    for (const call of prisma.customer.findMany.mock.calls) expect(['salonA', 'salonB']).toContain(call[0].where.tenantId);
  });
});
