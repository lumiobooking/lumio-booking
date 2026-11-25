import { foldBankCredit } from './bank-fold';

/** What the drawer is expected to gain from one bill, as cash-shifts.service counts it. */
function drawerGain(tenders: { method: string; amountCents: number }[], dueCents: number): number {
  const sum = tenders.reduce((s, t) => s + t.amountCents, 0);
  const cash = tenders.filter((t) => t.method === 'CASH').reduce((s, t) => s + t.amountCents, 0);
  const change = cash > 0 ? Math.max(0, sum - dueCents) : 0;
  return cash - change;
}

describe('rt235 — a bank transfer is never counted as cash', () => {
  it('nothing came by bank: tenders untouched', () => {
    expect(foldBankCredit([{ method: 'CASH', amountCents: 500 }], 0)).toEqual({ tenders: [{ method: 'CASH', amountCents: 500 }], addedCents: 0 });
  });

  it('paid in full by transfer, then closed with the default "cash" button: drawer gains nothing', () => {
    const r = foldBankCredit([{ method: 'CASH', amountCents: 500 }], 500);
    expect(r.addedCents).toBe(500);
    expect(drawerGain(r.tenders, 500)).toBe(0);
  });

  it('part by transfer, the full total typed as cash: drawer gains only the rest', () => {
    const r = foldBankCredit([{ method: 'CASH', amountCents: 500 }], 200);
    expect(drawerGain(r.tenders, 500)).toBe(300);
  });

  it('part by transfer, the rest in cash correctly: nothing double counted', () => {
    const r = foldBankCredit([{ method: 'CASH', amountCents: 300 }, { method: 'VIETQR', amountCents: 200 }], 200);
    expect(r.addedCents).toBe(0);
    expect(drawerGain(r.tenders, 500)).toBe(300);
  });

  it('the screen already sent the bank line: no fold', () => {
    const r = foldBankCredit([{ method: 'CASH', amountCents: 300 }, { method: 'TRANSFER', amountCents: 200 }], 200);
    expect(r.tenders).toHaveLength(2);
  });

  it('a card line typed for money the bank has shrinks instead', () => {
    const r = foldBankCredit([{ method: 'CARD', amountCents: 500 }], 200);
    expect(r.tenders).toEqual([{ method: 'CARD', amountCents: 300 }, { method: 'VIETQR', amountCents: 200 }]);
  });

  it('a transfer bigger than the bill never takes cash out of the drawer', () => {
    const r = foldBankCredit([{ method: 'CASH', amountCents: 500 }], 900);
    expect(drawerGain(r.tenders, 500)).toBe(0);
  });
});

/* service: the restaurant's own bill only, with bankPaidCents read from that bill */
import { UserRole } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { RestaurantService } from './restaurant.service';

describe('rt235 — paying a bill that the bank already partly paid', () => {
  function make() {
    const check = { id: 'c1', tenantId: 't1', number: 5, tableIds: [], status: 'OPEN', guests: 2, bankPaidCents: 200000, preBilledAt: null, preBillCount: 0, changedAfterPrebill: false, customerId: null, note: null,
      lines: [{ id: 'l1', tenantId: 't1', checkId: 'c1', state: 'SENT', quantity: 1, unitPriceCents: 500000, name: 'Lẩu', options: [], note: null }] };
    const prisma: any = {
      tableCheck: {
        findFirst: jest.fn(async (a: any) => (a.where.id === 'c1' && a.where.tenantId === 't1' ? { ...check, lines: check.lines.map((l) => ({ ...l })) } : null)),
        updateMany: jest.fn(async (a: any) => ({ count: a.where.tenantId === 't1' ? 1 : 0 })),
        findMany: jest.fn(async () => []),
      },
      restaurantTable: { findMany: jest.fn(async () => []) },
      setting: { findUnique: jest.fn(async () => null) },
      tenant: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh' })) },
      customer: { findFirst: jest.fn(async () => null) },
      user: { findFirst: jest.fn(async () => null) },
      tableCheckLine: { findMany: jest.fn(async () => []) },
    };
    const audit = { log: jest.fn(async () => undefined) };
    const pos = { createOrder: jest.fn(async () => ({ id: 'o1', orderNumber: 9, status: 'PAID' })) };
    const settings = { getBookingRules: jest.fn(async () => ({ currency: 'VND' })), receiptProfile: jest.fn(async () => null) };
    const svc = new RestaurantService(prisma, audit as never, settings as never, pos as never, undefined as never);
    (svc as any).getCheck = jest.fn(async () => ({}));
    return { svc, pos, audit };
  }
  const u = (t: string) => ({ userId: 'u1', role: UserRole.SALON_ADMIN, tenantId: t } as never);

  it('the order gets a bank tender for what the bank received, and the fold is logged', async () => {
    const { svc, pos, audit } = make();
    await svc.pay(u('t1'), 'c1', { tenders: [{ method: 'CASH' as never, amountCents: 500000 }] });
    const dto = (pos.createOrder.mock.calls[0] as any[])[1];
    expect(dto.tenders).toEqual([{ method: 'CASH', amountCents: 500000 }, { method: 'VIETQR', amountCents: 200000 }]);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', action: 'restaurant.bank_tender_folded', metadata: expect.objectContaining({ bankCents: 200000 }) }));
  });

  it('another restaurant cannot pay this bill', async () => {
    const { svc } = make();
    await expect(svc.pay(u('t2'), 'c1', { tenders: [{ method: 'CASH' as never, amountCents: 1 }] })).rejects.toBeInstanceOf(NotFoundException);
  });
});
