/**
 * A card refund reaches the books the way the owner expects:
 * the whole card payment of a card-only sale back → the sale is voided like the
 * till's Void (commission, tips, stock, points reverse); anything less → one
 * negative card row on the refund day. Always in the refunding salon.
 */
jest.mock('./provider-registry.service', () => ({ ProviderRegistry: class {} }));
jest.mock('./credential-store.service', () => ({ CredentialStore: class {} }));
jest.mock('../pos/pos.service', () => ({ PosService: class {} }));
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    PaymentStatus: actual.PaymentStatus ?? { PENDING: 'PENDING', PAID: 'PAID', REFUNDED: 'REFUNDED' },
    PaymentType: actual.PaymentType?.PAY_ONLINE ? actual.PaymentType : { PAY_LATER: 'PAY_LATER', PAY_ONLINE: 'PAY_ONLINE' },
  };
});
import { PaymentOrchestrator } from './payment-orchestrator.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const owner = { userId: 'u1', tenantId: 'A', role: 'SALON_ADMIN' } as never;

function make(orders: Row[], voidFails = false) {
  const ledger: Row[] = [];
  const voided: string[] = [];
  const audits: string[] = [];
  const prisma: Row = {
    order: { findFirst: async ({ where }: Row) => orders.find((o) => o.tenantId === where.tenantId && (where.id ? o.id === where.id : o.clientRef === where.clientRef)) ?? null },
    payment: { create: async ({ data }: Row) => { ledger.push(data); return data; } },
    auditLog: { create: async ({ data }: Row) => { audits.push(data.action); return data; } },
  };
  const moduleRef = { get: () => ({ voidOrder: async (_u: unknown, id: string) => { if (voidFails) throw new Error('closed payroll'); voided.push(id); } }) };
  const hub = new PaymentOrchestrator(prisma as never, {} as never, {} as never, moduleRef as never);
  const settle = (intent: Row, amount: number, full: boolean) =>
    (hub as unknown as { settleRefund: (...a: unknown[]) => Promise<void> }).settleRefund(owner, 'A', intent, amount, 'r1', full);
  return { settle, ledger, voided, audits };
}
const cardSale = { id: 'o1', tenantId: 'A', clientRef: 'pos-123', status: 'PAID', tenders: [{ method: 'CARD', amountCents: 5000 }] };

describe('card refunds reach the books', () => {
  it("the whole card payment of a card-only sale: the sale is voided (found by the till's clientRef)", async () => {
    const f = make([cardSale]);
    await f.settle({ id: 'i1', clientRef: 'pos-123-card', currency: 'USD' }, 5000, true);
    expect(f.voided).toEqual(['o1']);
    expect(f.ledger).toHaveLength(0);
    expect(f.audits).toContain('payment.refund_order_voided');
  });
  it('part of it: one negative row tied to the sale; the sale stands', async () => {
    const f = make([cardSale]);
    await f.settle({ id: 'i1', clientRef: 'pos-123-card', currency: 'USD' }, 1500, false);
    expect(f.voided).toEqual([]);
    expect(f.ledger[0]).toMatchObject({ tenantId: 'A', amountCents: -1500, providerReference: 'order:o1' });
  });
  it('a sale also paid in cash is never voided by a card refund', async () => {
    const f = make([{ ...cardSale, tenders: [{ method: 'CARD', amountCents: 3000 }, { method: 'CASH', amountCents: 2000 }] }]);
    await f.settle({ id: 'i1', clientRef: 'pos-123-card' }, 3000, true);
    expect(f.voided).toEqual([]);
    expect(f.ledger[0].amountCents).toBe(-3000);
  });
  it('a sale in a closed payroll cannot be voided: the negative row instead, and it is logged', async () => {
    const f = make([cardSale], true);
    await f.settle({ id: 'i1', clientRef: 'pos-123-card' }, 5000, true);
    expect(f.ledger[0].amountCents).toBe(-5000);
    expect(f.audits).toContain('payment.refund_order_not_voided');
  });
  it("another salon's sale with the same reference is never touched", async () => {
    const f = make([{ ...cardSale, tenantId: 'B' }]);
    await f.settle({ id: 'i1', clientRef: 'pos-123-card' }, 5000, true);
    expect(f.voided).toEqual([]);
    expect(f.ledger[0]).toMatchObject({ tenantId: 'A', providerReference: 'refund:r1' });
  });
});
