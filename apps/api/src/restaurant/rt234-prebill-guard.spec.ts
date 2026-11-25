import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RestaurantService } from './restaurant.service';
import { lowersPrintedBill, reasonOf, shortOfPrinted, voidNeedsReason } from './prebill-guard';
import { alertKeyOf, alertText, logKindOf } from './night-alerts';

describe('rt234 — after the guest check: pure rules', () => {
  const printed = { preBilledAt: new Date('2026-11-25T03:00:00Z') };
  const fresh = { preBilledAt: null };
  it('only a change that lowers a printed bill is guarded', () => {
    expect(lowersPrintedBill(fresh, 2, 0)).toBe(false);
    expect(lowersPrintedBill(printed, 2, 3)).toBe(false);
    expect(lowersPrintedBill(printed, 2, 2)).toBe(false);
    expect(lowersPrintedBill(printed, 2, 1)).toBe(true);
    expect(lowersPrintedBill(printed, 2, 0)).toBe(true);
  });
  it('voiding needs a reason when the kitchen has dishes or a check was printed', () => {
    expect(voidNeedsReason(fresh, 0)).toBe(false);
    expect(voidNeedsReason(fresh, 1)).toBe(true);
    expect(voidNeedsReason(printed, 0)).toBe(true);
  });
  it('reasons and shortfalls', () => {
    expect(reasonOf(' x ')).toBeNull();
    expect(reasonOf('  Khách   đổi ý ')).toBe('Khách đổi ý');
    expect(shortOfPrinted(null, 100)).toBe(0);
    expect(shortOfPrinted(500000, 500000)).toBe(0);
    expect(shortOfPrinted(500000, 520000)).toBe(0);
    expect(shortOfPrinted(500000, 380000)).toBe(120000);
  });
  it('the night log and alerts know the new actions', () => {
    expect(logKindOf('restaurant.paid_below_prebill')).toBe('void');
    expect(logKindOf('restaurant.after_prebill_change')).toBe('void');
    expect(alertKeyOf('restaurant.paid_below_prebill')).toBe('checkVoid');
    const t = alertText('checkVoid', 'restaurant.paid_below_prebill', { vi: true, money: (c) => `${c}đ`, who: 'Mai', amountCents: 120000, orderNumber: 7 });
    expect(t.title).toContain('Thu ít hơn tạm tính');
    expect(t.title).toContain('120000đ');
  });
});

/* ---- service, with a small in-memory store honouring tenantId ---- */
type Row = Record<string, any>;
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      if ('in' in v) return (v.in as unknown[]).includes(row[k]);
      if ('not' in v) return row[k] !== v.not;
      return true;
    }
    return (row[k] ?? null) === (v ?? null);
  });
}
function table(rows: Row[], defaults: () => Row) {
  let seq = 0;
  return {
    rows,
    findFirst: jest.fn(async (a: Row = {}) => { const r = rows.filter((x) => matches(x, a.where)); const list = a.orderBy?.number === 'desc' ? [...r].sort((x, y) => y.number - x.number) : r; return list[0] ? { ...list[0] } : null; }),
    findMany: jest.fn(async (a: Row = {}) => rows.filter((r) => matches(r, a.where)).map((r) => ({ ...r }))),
    create: jest.fn(async (a: Row) => { const r = { id: `new-${++seq}`, createdAt: new Date(Date.now() + seq), ...defaults(), ...a.data }; rows.push(r); return { ...r }; }),
    updateMany: jest.fn(async (a: Row) => { const hit = rows.filter((r) => matches(r, a.where)); hit.forEach((r) => Object.assign(r, a.data)); return { count: hit.length }; }),
    count: jest.fn(async (a: Row = {}) => rows.filter((r) => matches(r, a.where)).length),
    deleteMany: jest.fn(async (a: Row) => { const keep = rows.filter((r) => !matches(r, a.where)); const n = rows.length - keep.length; rows.splice(0, rows.length, ...keep); return { count: n }; }),
  };
}
const user = (tenantId: string, extra: Row = {}) => ({ userId: `u-${tenantId}`, email: 'x@y.z', role: UserRole.SALON_ADMIN, tenantId, ...extra } as never);

function make(opts: { needApproval?: boolean } = {}) {
  // the owner (SALON_ADMIN) approves herself, as the real approverFor does for pos.void
  const restaurantTable = table([
    { id: 'A3', tenantId: 't1', name: 'A3', seats: 4, area: null, isActive: true, sortOrder: 0, qrToken: null },
    { id: 'B1', tenantId: 't2', name: 'B1', seats: 4, area: null, isActive: true, sortOrder: 0, qrToken: null },
  ], () => ({}));
  const menuItem = table([
    { id: 'beer', tenantId: 't1', name: 'Bia', category: 'Đồ uống', priceCents: 30000, isActive: true, imageUrl: null, sortOrder: 0, soldOutAt: null, options: [] },
    { id: 'lau', tenantId: 't1', name: 'Lẩu', category: 'Lẩu', priceCents: 400000, isActive: true, imageUrl: null, sortOrder: 0, soldOutAt: null, options: [] },
  ], () => ({}));
  const tableCheck = table([], () => ({ bankPaidCents: 0, status: 'OPEN', sendCount: 0, preBillCount: 0, preBilledAt: null, changedAfterPrebill: false, customerId: null, orderId: null, openedAt: new Date(), payRequestedAt: null, note: null, callReason: null }));
  const tableCheckLine = table([], () => ({ held: false, readyAt: null, source: null, state: 'UNSENT', batch: null, sentAt: null, voidReason: null, voidedAt: null, note: null, options: [] }));
  const printJob = table([], () => ({ status: 'PENDING' }));
  const logs: Row[] = [];
  const audit = { log: jest.fn(async (e: Row) => { logs.push({ ...e, createdAt: new Date(Date.now() + logs.length) }); }) };
  const store: Row = {};
  if (opts.needApproval) store['t1/restaurant_settings'] = { voidNeedsApproval: true };
  const prisma: Row = {
    restaurantTable, menuItem, tableCheckLine, printJob,
    tableCheck: {
      ...tableCheck,
      findFirst: jest.fn(async (a: Row = {}) => {
        const c = await tableCheck.findFirst(a);
        if (!c || !a.include?.lines) return c;
        return { ...c, lines: tableCheckLine.rows.filter((l) => l.checkId === c.id && matches(l, a.include.lines.where)).map((l) => ({ ...l })) };
      }),
      findMany: jest.fn(async (a: Row = {}) => (await tableCheck.findMany(a)).map((c: Row) => ({ ...c, lines: tableCheckLine.rows.filter((l) => l.checkId === c.id) }))),
    },
    auditLog: {
      findFirst: jest.fn(async (a: Row) => {
        const hit = logs.filter((l) => l.tenantId === a.where.tenantId && l.action === a.where.action && l.resourceId === a.where.resourceId);
        return hit.length ? { metadata: hit[hit.length - 1].metadata } : null;
      }),
    },
    setting: {
      findUnique: jest.fn(async (a: Row) => { const v = store[`${a.where.tenantId_key.tenantId}/${a.where.tenantId_key.key}`]; return v ? { value: v } : null; }),
      upsert: jest.fn(async () => ({})),
      findFirst: jest.fn(async () => null),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
    user: { findUnique: jest.fn(async () => ({ firstName: 'Mai', email: null })), findFirst: jest.fn(async () => ({ firstName: 'Mai', email: null })), findMany: jest.fn(async () => []) },
    tenant: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh', name: 'Quán' })) },
    customer: { findFirst: jest.fn(async () => null) },
  };
  prisma.$transaction = jest.fn(async (fn: (tx: Row) => unknown) => fn(prisma));
  const settings = { getBookingRules: jest.fn(async () => ({ currency: 'VND' })), receiptProfile: jest.fn(async () => ({ shop: { name: 'Quán', address: '', phone: '' } })) };
  const pos = {
    approverFor: jest.fn(async (u: Row, _t: string, pin?: string) => { if (pin === '1234') return 'manager'; if (u.role === UserRole.SALON_ADMIN) return u.userId; throw new ForbiddenException('APPROVAL_PIN_REQUIRED'); }),
    createOrder: jest.fn(async () => ({ id: 'order-1', orderNumber: 77, status: 'PAID' })),
  };
  const svc = new RestaurantService(prisma as never, audit as never, settings as never, pos as never, { sendToTenant: jest.fn() } as never);
  return { svc, logs, tableCheckLine, tableCheck, pos };
}

async function printedBill(svc: RestaurantService, tableCheckLine: { rows: Row[] }) {
  const c = await svc.openCheck(user('t1'), { tableIds: ['A3'] });
  await svc.addLine(user('t1'), c.id, { menuItemId: 'beer', quantity: 4 });
  await svc.addLine(user('t1'), c.id, { menuItemId: 'lau', quantity: 1 });
  await svc.prebill(user('t1'), c.id);
  const beer = tableCheckLine.rows.find((l) => l.menuItemId === 'beer')!;
  return { id: c.id, beerId: beer.id };
}

describe('rt234 — after the guest check: the till', () => {
  it('before the check is printed, taking a dish off is free', async () => {
    const { svc, tableCheckLine } = make();
    const c = await svc.openCheck(user('t1'), { tableIds: ['A3'] });
    await svc.addLine(user('t1'), c.id, { menuItemId: 'beer', quantity: 2 });
    const after = await svc.updateLine(user('t1'), c.id, tableCheckLine.rows[0].id, { quantity: 1 });
    expect(after.subtotalCents).toBe(30000);
  });

  it('after it is printed: adding stays free, taking off needs a reason and is logged with the amount', async () => {
    const { svc, tableCheckLine, logs } = make();
    const { id, beerId } = await printedBill(svc, tableCheckLine);
    await svc.addLine(user('t1'), id, { menuItemId: 'beer', quantity: 1 }); // merges: 5 beers now
    await expect(svc.updateLine(user('t1'), id, beerId, { quantity: 2 })).rejects.toThrow('PREBILL_REASON_REQUIRED');
    await expect(svc.removeLine(user('t1'), id, beerId)).rejects.toThrow('PREBILL_REASON_REQUIRED');
    await svc.updateLine(user('t1'), id, beerId, { quantity: 2, reason: 'Gọi trùng' });
    const cut = logs.find((l) => l.action === 'restaurant.after_prebill_change' && l.metadata.lowered);
    expect(cut).toMatchObject({ tenantId: 't1', metadata: { reason: 'Gọi trùng', minusCents: 90000, quantity: 3, name: 'Bia' } });
  });

  it('where approval is on, a cashier without the right needs the manager PIN', async () => {
    const { svc, tableCheckLine } = make({ needApproval: true });
    const { id, beerId } = await printedBill(svc, tableCheckLine);
    const staff = user('t1', { role: UserRole.STAFF, staffRole: 'CASHIER' });
    await expect(svc.removeLine(staff, id, beerId, { reason: 'Khách đổi ý' })).rejects.toBeInstanceOf(ForbiddenException);
    const ok = await svc.removeLine(staff, id, beerId, { reason: 'Khách đổi ý', approvalPin: '1234' });
    expect(ok.subtotalCents).toBe(400000);
  });

  it('voiding a printed bill with nothing sent still needs a reason, and remembers what was printed', async () => {
    const { svc, tableCheckLine, logs } = make();
    const { id } = await printedBill(svc, tableCheckLine);
    await expect(svc.voidCheck(user('t1'), id, {})).rejects.toThrow('VOID_REASON_REQUIRED');
    await svc.voidCheck(user('t1'), id, { reason: 'Khách bỏ về' });
    const v = logs.find((l) => l.action === 'restaurant.check_voided')!;
    expect(v.metadata).toMatchObject({ afterPrebill: true, prebillCount: 1, printedCents: 520000 });
  });

  it('paying less than the printed check is written down; paying the same is not', async () => {
    const a = make();
    const p1 = await printedBill(a.svc, a.tableCheckLine);
    await a.svc.pay(user('t1'), p1.id, { tenders: [{ method: 'CASH' as never, amountCents: 520000 }], allowUnsent: true });
    expect(a.logs.some((l) => l.action === 'restaurant.paid_below_prebill')).toBe(false);

    const b = make();
    const p2 = await printedBill(b.svc, b.tableCheckLine);
    await b.svc.pay(user('t1'), p2.id, { tenders: [{ method: 'CASH' as never, amountCents: 400000 }], manualDiscountCents: 120000, allowUnsent: true });
    const flag = b.logs.find((l) => l.action === 'restaurant.paid_below_prebill')!;
    expect(flag).toMatchObject({ tenantId: 't1', metadata: { printedCents: 520000, paidCents: 400000, amountCents: 120000 } });
  });

  it('a bill split off a printed bill stays printed', async () => {
    const { svc, tableCheckLine, tableCheck } = make();
    const { id, beerId } = await printedBill(svc, tableCheckLine);
    const r = await svc.split(user('t1'), id, { lines: [{ lineId: beerId, quantity: 2 }] } as never);
    const created = tableCheck.rows.find((c) => c.id === (r as Row).to.id)!;
    expect(created.preBilledAt).toBeTruthy();
    await expect(svc.voidCheck(user('t1'), created.id, {})).rejects.toThrow('VOID_REASON_REQUIRED');
  });

  it('another restaurant cannot touch the bill', async () => {
    const { svc, tableCheckLine } = make();
    const { id, beerId } = await printedBill(svc, tableCheckLine);
    await expect(svc.removeLine(user('t2'), id, beerId, { reason: 'x y' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.voidCheck(user('t2'), id, { reason: 'x y' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('rt234 — salon held bills: throwing one away is logged, recalling is not', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { HeldBillsService } = require('../pos/held-bills.service');
  function mk() {
    const rows = [{ id: 'h1', tenantId: 't1', label: 'Chị Lan', totalCents: 650000, createdByUserId: 'u9', createdAt: new Date() }];
    const prisma = {
      heldBill: {
        findFirst: jest.fn(async (a: Row) => rows.find((r) => r.id === a.where.id && r.tenantId === a.where.tenantId) ?? null),
        deleteMany: jest.fn(async (a: Row) => { const i = rows.findIndex((r) => r.id === a.where.id && r.tenantId === a.where.tenantId); if (i >= 0) rows.splice(i, 1); return { count: i >= 0 ? 1 : 0 }; }),
      },
    };
    const audit = { log: jest.fn(async () => undefined) };
    return { svc: new HeldBillsService(prisma as never, audit as never), audit, rows };
  }
  it('discard → audit with the amount; recall → no audit', async () => {
    const a = mk();
    await a.svc.remove(user('t1'), 'h1');
    expect(a.audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', action: 'pos.held_discarded', metadata: expect.objectContaining({ amountCents: 650000, label: 'Chị Lan' }) }));
    const b = mk();
    await b.svc.remove(user('t1'), 'h1', { recalled: true });
    expect(b.audit.log).not.toHaveBeenCalled();
  });
  it('another salon cannot delete it', async () => {
    const a = mk();
    await expect(a.svc.remove(user('t2'), 'h1')).rejects.toBeInstanceOf(NotFoundException);
    expect(a.rows).toHaveLength(1);
  });
});
