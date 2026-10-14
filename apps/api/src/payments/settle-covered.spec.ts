/**
 * "Complete" on a booking a paid ticket already covers touches no money: its
 * pay-at-salon row would otherwise count the visit a second time.
 */
import { PaymentsService } from './payments.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function make(orderCount: number) {
  const touched: Row[] = [];
  const counts: Row[] = [];
  const prisma: Row = {
    appointment: { findFirst: async () => ({ id: 'a1', priceCents: 4500, currency: 'USD', customerId: 'c1' }) },
    order: { count: async ({ where }: Row) => { counts.push(where); return orderCount; } },
    payment: {
      findMany: async () => [{ id: 'p1', status: 'PENDING', amountCents: 4500 }],
      updateMany: async (a: Row) => { touched.push(a); return { count: 1 }; },
      create: async (a: Row) => { touched.push(a); return { id: 'new' }; },
    },
  };
  const svc = new PaymentsService(prisma as never, { log: async () => undefined } as never, { award: async () => undefined } as never);
  (svc as unknown as Row).provider = { name: 'mock' };
  return { svc, touched, counts };
}

describe('Complete after the till', () => {
  it('covered by a paid ticket (solo or party): nothing is flipped or created', async () => {
    const { svc, touched, counts } = make(1);
    await svc.settleOnComplete('t1', 'a1', 'u1');
    expect(touched).toHaveLength(0);
    expect(counts[0].tenantId).toBe('t1');
    expect(counts[0].OR).toEqual([{ appointmentId: 'a1' }, { appointmentIds: { has: 'a1' } }]);
  });
  it('no ticket: the pay-at-salon row is collected as before', async () => {
    const { svc, touched } = make(0);
    await svc.settleOnComplete('t1', 'a1', 'u1');
    expect(touched.length).toBeGreaterThan(0);
  });
});
