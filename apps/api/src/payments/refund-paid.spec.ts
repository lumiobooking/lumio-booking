import { PaymentsService } from './payments.service';

/**
 * A cancelled booking's money goes back FOR REAL, through the provider that
 * took it — and only the salon's own rows are ever touched.
 */
type Row = { id: string; tenantId: string; appointmentId: string; amountCents: number; currency: string; type: string; status: string; provider: string; providerReference: string | null; paidAt: Date | null };

function setup(rows: Row[], hubOk = true) {
  const db = rows.map((r) => ({ ...r }));
  const created: Row[] = [];
  const prisma = {
    payment: {
      findMany: async (a: { where: Partial<Row> }) => db.filter((r) => r.tenantId === a.where.tenantId && r.appointmentId === a.where.appointmentId && r.status === a.where.status),
      updateMany: async (a: { where: { id: string; tenantId: string }; data: Partial<Row> }) => {
        const hit = db.filter((r) => r.id === a.where.id && r.tenantId === a.where.tenantId);
        hit.forEach((r) => Object.assign(r, a.data));
        return { count: hit.length };
      },
      create: async (a: { data: Row }) => { created.push(a.data); return a.data; },
    },
  };
  const calls: unknown[] = [];
  const hub = { onlineRefund: async (tenantId: string, provider: string, input: unknown) => { calls.push({ tenantId, provider, input }); return hubOk ? { ok: true } : { ok: false, error: 'card closed' }; } };
  const audit = { log: async () => undefined };
  const svc = new PaymentsService(prisma as never, audit as never, {} as never, hub as never);
  return { svc, db, created, calls };
}

const base: Row = { id: 'p1', tenantId: 'A', appointmentId: 'b1', amountCents: 2000, currency: 'USD', type: 'PAY_ONLINE', status: 'PAID', provider: 'stripe', providerReference: 'pi_123', paidAt: new Date() };

describe('refunding what was paid on a cancelled booking', () => {
  it('refunds through the provider that took it, then marks it refunded', async () => {
    const { svc, db, calls } = setup([base]);
    const r = await svc.refundPaid('A', 'b1', 2000);
    expect(r).toEqual({ refundedCents: 2000, failed: [] });
    expect(calls).toEqual([{ tenantId: 'A', provider: 'stripe', input: { transactionId: 'pi_123', reference: 'b1', amountCents: 2000, currency: 'USD' } }]);
    expect(db[0].status).toBe('REFUNDED');
  });

  it('a refund the provider refuses leaves the money recorded as paid', async () => {
    const { svc, db } = setup([base], false);
    const r = await svc.refundPaid('A', 'b1', 2000);
    expect(r.refundedCents).toBe(0);
    expect(r.failed[0]).toMatchObject({ provider: 'stripe', amountCents: 2000, error: 'card closed' });
    expect(db[0].status).toBe('PAID');
  });

  it('part of a payment: what stays and what went back become two rows', async () => {
    const { svc, db, created } = setup([{ ...base, amountCents: 6000 }]);
    await svc.refundPaid('A', 'b1', 4200);
    expect(db[0]).toMatchObject({ status: 'PAID', amountCents: 1800 });
    expect(created[0]).toMatchObject({ status: 'REFUNDED', amountCents: 4200, tenantId: 'A', appointmentId: 'b1' });
  });

  it('never touches another salon’s payment on the same booking id', async () => {
    const { svc, db, calls } = setup([base, { ...base, id: 'p2', tenantId: 'B' }]);
    await svc.refundPaid('A', 'b1', 4000);
    expect(db.find((r) => r.id === 'p2')?.status).toBe('PAID');
    expect(calls).toHaveLength(1);
  });

  it('an old mock row (no real money) is only re-labelled — no provider call', async () => {
    const { svc, db, calls } = setup([{ ...base, provider: 'mock', providerReference: 'mock_ch_1' }]);
    await svc.refundPaid('A', 'b1', 2000);
    expect(calls).toHaveLength(0);
    expect(db[0].status).toBe('REFUNDED');
  });
});
