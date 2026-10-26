/**
 * Online deposits: recorded from every source, and unpaid holds let go.
 */
import { OnlineDepositService } from './online-deposit.service';
import { HOLD_REF } from '../payments/deposit-hold';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function make(o: { approved?: Record<string, { approved: boolean; amountCents?: number }>; holdMinutes?: number } = {}) {
  const appts: Row[] = [
    { id: 'a1', tenantId: 'A', priceCents: 10000, currency: 'USD', customerId: 'c1', partySize: 1, status: 'CONFIRMED' },
    { id: 'a2', tenantId: 'A', priceCents: 10000, currency: 'USD', customerId: 'c2', partySize: 1, status: 'CONFIRMED' },
    { id: 'b1', tenantId: 'B', priceCents: 10000, currency: 'USD', customerId: 'c9', partySize: 1, status: 'CONFIRMED' },
  ];
  const t0 = new Date('2026-10-26T10:00:00Z');
  const payments: Row[] = [
    { id: 'p1', tenantId: 'A', appointmentId: 'a1', type: 'PAY_ONLINE', status: 'PENDING', amountCents: 3000, providerReference: HOLD_REF, createdAt: t0, updatedAt: t0 },
    { id: 'p2', tenantId: 'A', appointmentId: 'a2', type: 'PAY_ONLINE', status: 'PENDING', amountCents: 3000, providerReference: HOLD_REF, createdAt: t0, updatedAt: t0 },
    { id: 'p3', tenantId: 'B', appointmentId: 'b1', type: 'PAY_ONLINE', status: 'PENDING', amountCents: 3000, providerReference: HOLD_REF, createdAt: t0, updatedAt: t0 },
  ];
  const intents: Row[] = [
    { tenantId: 'A', clientRef: 'online:a1' },
    { tenantId: 'B', clientRef: 'online:b1' },
  ];
  const cancelled: string[] = [];
  const refunds: string[] = [];
  const match = (row: Row, where: Row): boolean => Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Row[]).some((w) => match(row, w));
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const c = v as Row;
      if ('in' in c) return (c.in as unknown[]).includes(row[k]);
      if ('not' in c) return row[k] !== c.not;
      if ('gte' in c) return row[k] >= c.gte;
      return true;
    }
    return row[k] === v;
  });
  const prisma: Row = {
    appointment: { findFirst: async ({ where }: Row) => appts.find((a) => match(a, where)) ?? null },
    payment: {
      findFirst: async ({ where }: Row) => payments.find((p) => match(p, where)) ?? null,
      findMany: async ({ where }: Row) => payments.filter((p) => match(p, where)),
      update: async ({ where, data }: Row) => { const p = payments.find((x) => x.id === where.id)!; Object.assign(p, data); return p; },
      create: async ({ data }: Row) => { const p = { id: `p${payments.length + 1}`, ...data }; payments.push(p); return p; },
    },
    paymentIntentRecord: { findFirst: async ({ where }: Row) => intents.find((i) => i.tenantId === where.tenantId && i.clientRef === where.clientRef) ?? null },
  };
  const hub: Row = {
    onOnlinePaid: () => undefined,
    onlineLookup: async (tenantId: string, ref: string) => ({ provider: 'stripe', transactionId: `pi_${ref}`, ...(o.approved?.[`${tenantId}:${ref}`] ?? { approved: false }) }),
  };
  const settings: Row = {
    getDepositSettings: async () => ({ enabled: true, type: 'percent', percent: 30, holdMinutes: o.holdMinutes ?? 30 }),
    getPartyDeposit: async () => ({ enabled: false }),
    getPosSettings: async () => ({ cardSurchargeEnabled: false }),
  };
  const pay: Row = {
    depositFor: async (_t: string, a: Row) => Math.round(a.priceCents * 0.3),
    refundPaid: async (_t: string, id: string, cents: number) => { refunds.push(`${id}:${cents}`); return { refundedCents: cents, failed: [] }; },
  };
  const bookings: Row = {
    cancelForTenant: async (tenantId: string, id: string) => {
      cancelled.push(`${tenantId}:${id}`);
      const a = appts.find((x) => x.id === id && x.tenantId === tenantId)!; a.status = 'CANCELLED';
      payments.filter((p) => p.appointmentId === id && p.tenantId === tenantId && p.status === 'PENDING').forEach((p) => { p.status = 'FAILED'; });
    },
  };
  const svc = new OnlineDepositService(prisma as never, bookings as never, pay as never, settings as never, hub as never, { log: async () => undefined } as never);
  return { svc, payments, appts, cancelled, refunds };
}

describe('online deposit: recorded once, from any source', () => {
  it('paid → the hold row becomes PAID with what the provider took', async () => {
    const f = make({ approved: { 'A:a1': { approved: true, amountCents: 3000 } } });
    const r = await f.svc.settle('A', 'a1', 'webhook');
    expect(r.ok).toBe(true);
    expect(f.payments.find((p) => p.id === 'p1')).toMatchObject({ status: 'PAID', amountCents: 3000, providerReference: 'pi_a1' });
    expect((await f.svc.settle('A', 'a1')).alreadyPaid).toBe(true);
  });
  it('less than the deposit is not recorded', async () => {
    const f = make({ approved: { 'A:a1': { approved: true, amountCents: 100 } } });
    expect((await f.svc.settle('A', 'a1')).reason).toBe('amount_mismatch');
    expect(f.payments.find((p) => p.id === 'p1')!.status).toBe('PENDING');
  });
  it('another salon cannot settle this booking', async () => {
    const f = make({ approved: { 'B:a1': { approved: true, amountCents: 3000 } } });
    expect((await f.svc.settle('B', 'a1')).reason).toBe('not_found');
    expect(f.payments.find((p) => p.id === 'p1')!.status).toBe('PENDING');
  });
});

describe('deposit hold sweep', () => {
  const late = new Date('2026-10-26T10:31:00Z');
  it('records a payment the customer never came back for, and releases the unpaid hold', async () => {
    const f = make({ approved: { 'A:a1': { approved: true, amountCents: 3000 } } });
    const r = await f.svc.sweep(late);
    expect(f.payments.find((p) => p.id === 'p1')!.status).toBe('PAID');
    expect(f.cancelled).toEqual(['A:a2', 'B:b1']);
    expect(r).toEqual({ settled: 1, released: 2 });
  });
  it('nothing is released before the salon\'s minutes, nor ever with "never"', async () => {
    const early = make();
    await early.svc.sweep(new Date('2026-10-26T10:20:00Z'));
    expect(early.cancelled).toEqual([]);
    const never = make({ holdMinutes: 0 });
    await never.svc.sweep(new Date('2026-10-27T10:00:00Z'));
    expect(never.cancelled).toEqual([]);
  });
  it('a visit already under way is never cancelled by a lapsed hold', async () => {
    const f = make();
    f.appts.find((a) => a.id === 'a2')!.status = 'ARRIVED';
    await f.svc.sweep(late);
    expect(f.cancelled).not.toContain('A:a2');
  });
  it('paid after the hold ran out: recorded, then given straight back', async () => {
    const f = make();
    await f.svc.sweep(late); // a1 released (not paid yet)
    expect(f.cancelled).toContain('A:a1');
    const g = await (async () => {
      (f.svc as unknown as Row).hub.onlineLookup = async () => ({ provider: 'stripe', approved: true, amountCents: 3000, transactionId: 'pi_late' });
      return f.svc.settle('A', 'a1', 'return');
    })();
    expect(g.refunded).toBe(true);
    expect(f.refunds).toEqual(['a1:3000']);
  });
});
