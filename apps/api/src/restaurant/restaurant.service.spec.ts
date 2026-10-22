import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RestaurantService } from './restaurant.service';

/* A tiny in-memory Prisma: just the calls the service makes, with tenantId
 * honoured exactly as written in each where — so a query that forgot its
 * tenantId would read the other restaurant's rows and fail these tests. */
type Row = Record<string, any>;
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Row[]).some((w) => matches(row, w));
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      if ('in' in v) return (v.in as unknown[]).includes(row[k]);
      if ('hasSome' in v) return (row[k] ?? []).some((x: unknown) => (v.hasSome as unknown[]).includes(x));
      if ('not' in v) return row[k] !== v.not;
      if ('gte' in v) return row[k] >= v.gte;
      return true;
    }
    return (row[k] ?? null) === (v ?? null);
  });
}
function table(rows: Row[], defaults: () => Row) {
  let seq = 0;
  return {
    rows,
    findFirst: jest.fn(async (a: Row = {}) => {
      let list = rows.filter((r) => matches(r, a.where));
      if (a.orderBy?.number === 'desc') list = [...list].sort((x, y) => y.number - x.number);
      return list[0] ? { ...list[0] } : null;
    }),
    findMany: jest.fn(async (a: Row = {}) => rows.filter((r) => matches(r, a.where)).map((r) => ({ ...r }))),
    findUnique: jest.fn(async (a: Row = {}) => rows.find((r) => matches(r, a.where)) ?? null),
    create: jest.fn(async (a: Row) => { const r = { id: `new-${++seq}`, createdAt: new Date(Date.now() + seq), ...defaults(), ...a.data }; rows.push(r); return { ...r }; }),
    updateMany: jest.fn(async (a: Row) => { const hit = rows.filter((r) => matches(r, a.where)); hit.forEach((r) => Object.assign(r, a.data)); return { count: hit.length }; }),
    deleteMany: jest.fn(async (a: Row) => { const keep = rows.filter((r) => !matches(r, a.where)); const n = rows.length - keep.length; rows.splice(0, rows.length, ...keep); return { count: n }; }),
  };
}

const user = (tenantId: string, extra: Row = {}) => ({ userId: `u-${tenantId}`, email: 'x@y.z', role: UserRole.SALON_ADMIN, tenantId, ...extra } as never);

function make() {
  const restaurantTable = table([
    { id: 'A3', tenantId: 't1', name: 'A3', seats: 4, area: 'In', isActive: true, sortOrder: 0 },
    { id: 'S3', tenantId: 't1', name: 'S3', seats: 4, area: 'Out', isActive: true, sortOrder: 1 },
    { id: 'B1', tenantId: 't2', name: 'B1', seats: 4, area: null, isActive: true, sortOrder: 0 },
  ], () => ({}));
  const menuItem = table([
    { id: 'pho', tenantId: 't1', name: 'Phở bò', category: 'Phở', priceCents: 85000, isActive: true, imageUrl: null, sortOrder: 0, soldOutAt: null,
      options: [{ id: 'size', name: 'Cỡ', required: true, max: 1, choices: [{ id: 'n', name: 'Thường', priceCents: 0 }, { id: 'l', name: 'Lớn', priceCents: 15000 }] }] },
    { id: 'beer', tenantId: 't1', name: 'Bia', category: 'Đồ uống', priceCents: 30000, isActive: true, imageUrl: null, sortOrder: 0, soldOutAt: null, options: [] },
    { id: 'bbh', tenantId: 't1', name: 'Bún bò', category: 'Bún', priceCents: 80000, isActive: true, imageUrl: null, sortOrder: 0, soldOutAt: null, options: [] },
    { id: 'steak', tenantId: 't2', name: 'Steak', category: 'Mains', priceCents: 3000, isActive: true, imageUrl: null, sortOrder: 0, soldOutAt: null, options: [] },
  ], () => ({}));
  const tableCheck = table([], () => ({ status: 'OPEN', sendCount: 0, preBillCount: 0, preBilledAt: null, changedAfterPrebill: false, customerId: null, orderId: null, openedAt: new Date(), payRequestedAt: null, note: null }));
  const tableCheckLine = table([], () => ({ state: 'UNSENT', batch: null, sentAt: null, sentByName: null, voidReason: null, voidedAt: null, note: null, options: [] }));
  const printJob = table([], () => ({ status: 'PENDING' }));
  const prisma: Row = {
    restaurantTable, menuItem, tableCheckLine, printJob,
    tableCheck: {
      ...tableCheck,
      findFirst: jest.fn(async (a: Row = {}) => {
        const c = await tableCheck.findFirst(a);
        if (!c || !a.include?.lines) return c;
        return { ...c, lines: tableCheckLine.rows.filter((l) => l.checkId === c.id && matches(l, a.include.lines.where)).sort((x, y) => x.createdAt - y.createdAt).map((l) => ({ ...l })) };
      }),
      findMany: jest.fn(async (a: Row = {}) => (await tableCheck.findMany(a)).map((c: Row) => ({ ...c, lines: tableCheckLine.rows.filter((l) => l.checkId === c.id && matches(l, a.include?.lines?.where)) }))),
    },
    setting: {
      store: {} as Row,
      findUnique: jest.fn(async (a: Row) => { const k = `${a.where.tenantId_key.tenantId}/${a.where.tenantId_key.key}`; return prisma.setting.store[k] ? { value: prisma.setting.store[k] } : null; }),
      upsert: jest.fn(async (a: Row) => { prisma.setting.store[`${a.where.tenantId_key.tenantId}/${a.where.tenantId_key.key}`] = a.create.value; return {}; }),
    },
    user: {
      findUnique: jest.fn(async () => ({ firstName: 'Lan', email: 'lan@x.y' })),
      findFirst: jest.fn(async () => ({ firstName: 'Quân', email: null })),
      findMany: jest.fn(async (a: Row) => [{ id: 'cashier-0001', tenantId: 't1', firstName: 'Mai', lastName: null, email: 'm@x.y' }].filter((u) => matches(u, { tenantId: a.where.tenantId, ...(a.where.id ? { id: a.where.id } : {}) }))),
    },
    tenant: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Ho_Chi_Minh' })) },
    customer: { findFirst: jest.fn(async (a: Row) => (a.where.tenantId === 't1' && a.where.id === 'c1' ? { id: 'c1' } : null)) },
  };
  prisma.$transaction = jest.fn(async (fn: (tx: Row) => unknown) => fn(prisma));
  const audit = { log: jest.fn(async () => undefined) };
  const settings = { getBookingRules: jest.fn(async () => ({ currency: 'VND' })), receiptProfile: jest.fn(async () => ({ shop: { name: 'Phở Lumio', address: '1 Lê Lợi', phone: '0909' } })) };
  const pos = {
    approverFor: jest.fn(async (u: Row, _t: string, pin?: string) => { if (pin === '1234') return 'manager'; throw new ForbiddenException('APPROVAL_PIN_REQUIRED'); }),
    createOrder: jest.fn(async (_u: Row, dto: Row) => ({ id: 'order-1', orderNumber: 1043, status: 'PAID', dto })),
  };
  const svc = new RestaurantService(prisma as never, audit as never, settings as never, pos as never);
  return { prisma, audit, pos, svc, tableCheckLine, printJob, tableCheck };
}

describe('RestaurantService — a table from open to paid', () => {
  it('opens a bill, adds dishes, sends only the new ones per station, then pays through the till', async () => {
    const { svc, printJob, pos, tableCheck } = make();
    const c = await svc.openCheck(user('t1'), { tableIds: ['A3'], guests: 4 });
    expect(c.tables).toBe('A3');
    expect(c.number).toBe(1);
    await svc.addLine(user('t1'), c.id, { menuItemId: 'pho', quantity: 2, note: 'ít hành', options: [{ groupId: 'size', choiceIds: ['n'] }] });
    await svc.addLine(user('t1'), c.id, { menuItemId: 'beer', quantity: 2 });
    const first = await svc.send(user('t1'), c.id);
    expect(first.sent).toBe(2);
    expect(printJob.rows.map((j) => j.station).sort()).toEqual(['BAR', 'KITCHEN']);
    expect(printJob.rows.every((j) => j.tenantId === 't1')).toBe(true);
    expect(printJob.rows.find((j) => j.station === 'KITCHEN')!.text).toContain('2 x Phở bò');

    const again = await svc.send(user('t1'), c.id);
    expect(again.sent).toBe(0);
    expect(printJob.rows).toHaveLength(2);

    await svc.addLine(user('t1'), c.id, { menuItemId: 'beer' });
    const second = await svc.send(user('t1'), c.id);
    expect(second.batch).toBe(2);
    expect(printJob.rows).toHaveLength(3);

    const paid = await svc.pay(user('t1'), c.id, { tenders: [{ method: 'CASH' as never, amountCents: 300000 }] });
    expect(pos.createOrder).toHaveBeenCalledTimes(1);
    const dto = pos.createOrder.mock.calls[0][1];
    expect(dto.items.reduce((s: number, i: Row) => s + i.unitPriceCents * i.quantity, 0)).toBe(260000);
    expect(dto.note).toContain('A3');
    expect(paid.check.status).toBe('PAID');
    expect(tableCheck.rows[0].orderId).toBe('order-1');
  });

  it('a table with a running bill cannot be opened twice', async () => {
    const { svc } = make();
    await svc.openCheck(user('t1'), { tableIds: ['A3'] });
    await expect(svc.openCheck(user('t1'), { tableIds: ['A3'] })).rejects.toBeInstanceOf(ConflictException);
  });

  it('a sent dish is locked: editing it is refused, taking it back needs a reason and approval, and prints a cancel ticket', async () => {
    const { svc, tableCheckLine, printJob, audit } = make();
    const c = await svc.openCheck(user('t1'), { tableIds: ['A3'] });
    await svc.addLine(user('t1'), c.id, { menuItemId: 'pho', quantity: 2, options: [{ groupId: 'size', choiceIds: ['n'] }] });
    await svc.send(user('t1'), c.id);
    const lineId = tableCheckLine.rows[0].id;
    await expect(svc.updateLine(user('t1'), c.id, lineId, { quantity: 1 })).rejects.toThrow('LINE_SENT');
    await expect(svc.voidLine(user('t1'), c.id, lineId, { quantity: 1, reason: '' })).rejects.toThrow('VOID_REASON_REQUIRED');
    await expect(svc.voidLine(user('t1'), c.id, lineId, { quantity: 1, reason: 'Khách đổi ý' })).rejects.toBeInstanceOf(ForbiddenException);
    const after = await svc.voidLine(user('t1'), c.id, lineId, { quantity: 1, reason: 'Khách đổi ý', approvalPin: '1234' });
    expect(after.subtotalCents).toBe(85000);
    expect(after.lines.filter((l) => l.state === 'VOID')).toHaveLength(1);
    expect(printJob.rows.some((j) => j.text.includes('HUỶ MÓN') && j.text.includes('Khách đổi ý'))).toBe(true);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', action: 'restaurant.item_voided' }));
  });

  it('paying with dishes not yet sent is refused unless the cashier says so', async () => {
    const { svc, pos } = make();
    const c = await svc.openCheck(user('t1'), { tableIds: ['A3'] });
    await svc.addLine(user('t1'), c.id, { menuItemId: 'beer' });
    await expect(svc.pay(user('t1'), c.id, { tenders: [{ method: 'CASH' as never, amountCents: 30000 }] })).rejects.toThrow('UNSENT_LINES');
    expect(pos.createOrder).not.toHaveBeenCalled();
    const ok = await svc.pay(user('t1'), c.id, { tenders: [{ method: 'CASH' as never, amountCents: 30000 }], allowUnsent: true });
    expect(ok.check.status).toBe('PAID');
  });

  it('a failed payment unlocks the bill', async () => {
    const { svc, pos, tableCheck } = make();
    const c = await svc.openCheck(user('t1'), { tableIds: ['A3'] });
    await svc.addLine(user('t1'), c.id, { menuItemId: 'pho', options: [{ groupId: 'size', choiceIds: ['n'] }] });
    await svc.send(user('t1'), c.id);
    pos.createOrder.mockRejectedValueOnce(new Error('SHIFT_REQUIRED'));
    await expect(svc.pay(user('t1'), c.id, { tenders: [{ method: 'CASH' as never, amountCents: 85000 }] })).rejects.toThrow('SHIFT_REQUIRED');
    expect(tableCheck.rows[0].status).toBe('OPEN');
  });

  it('moving a bill tells the kitchen and frees the old table', async () => {
    const { svc, printJob } = make();
    const c = await svc.openCheck(user('t1'), { tableIds: ['A3'] });
    await svc.addLine(user('t1'), c.id, { menuItemId: 'pho', options: [{ groupId: 'size', choiceIds: ['n'] }] });
    await svc.send(user('t1'), c.id);
    const moved = await svc.move(user('t1'), c.id, { tableIds: ['S3'] });
    expect(moved.tables).toBe('S3');
    expect(printJob.rows.some((j) => j.text.includes('A3 -> S3'))).toBe(true);
    const fresh = await svc.openCheck(user('t1'), { tableIds: ['A3'] });
    expect(fresh.tables).toBe('A3');
  });

  it('the guest check prints to the counter and later edits are remembered', async () => {
    const { svc, printJob, audit } = make();
    const c = await svc.openCheck(user('t1'), { tableIds: ['A3'] });
    await svc.addLine(user('t1'), c.id, { menuItemId: 'pho', options: [{ groupId: 'size', choiceIds: ['n'] }] });
    const pb = await svc.prebill(user('t1'), c.id);
    expect(pb.text).toContain('PHIẾU TẠM TÍNH');
    expect(printJob.rows.at(-1)!.station).toBeNull();
    const changed = await svc.addLine(user('t1'), c.id, { menuItemId: 'beer' });
    expect(changed.changedAfterPrebill).toBe(true);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'restaurant.after_prebill_change' }));
  });
});

describe('RestaurantService — phase 2', () => {
  it('a dish with a required option cannot be added without it, and the option is priced and printed', async () => {
    const { svc, printJob } = make();
    const c = await svc.openCheck(user('t1'), { tableIds: ['A3'] });
    await expect(svc.addLine(user('t1'), c.id, { menuItemId: 'pho' })).rejects.toThrow('OPTION_REQUIRED');
    const v = await svc.addLine(user('t1'), c.id, { menuItemId: 'pho', options: [{ groupId: 'size', choiceIds: ['l'] }] });
    expect(v.subtotalCents).toBe(100000);
    expect(v.lines[0].options).toEqual(['Lớn']);
    await svc.send(user('t1'), c.id);
    expect(printJob.rows[0].text).toContain('+ Lớn');
  });

  it('a sold-out dish cannot be ordered until it is back', async () => {
    const { svc } = make();
    const c = await svc.openCheck(user('t1'), { tableIds: ['A3'] });
    const menu = await svc.setSoldOut(user('t1'), 'bbh', true);
    expect(menu.find((m) => m.id === 'bbh')!.soldOut).toBe(true);
    await expect(svc.addLine(user('t1'), c.id, { menuItemId: 'bbh' })).rejects.toThrow('SOLD_OUT');
    await svc.setSoldOut(user('t1'), 'bbh', false);
    const ok = await svc.addLine(user('t1'), c.id, { menuItemId: 'bbh' });
    expect(ok.itemCount).toBe(1);
  });

  it('a to-go bill has no table and is named by its number', async () => {
    const { svc, printJob } = make();
    const c = await svc.openCheck(user('t1'), { takeaway: true });
    expect(c.takeaway).toBe(true);
    expect(c.tables).toBe(`Mang về #${c.number}`);
    await svc.addLine(user('t1'), c.id, { menuItemId: 'beer' });
    await svc.send(user('t1'), c.id);
    expect(printJob.rows[0].text).toContain('MANG VỀ');
  });

  it('merging brings dishes, tables and guests over and closes the other bill', async () => {
    const { svc, tableCheck } = make();
    const a = await svc.openCheck(user('t1'), { tableIds: ['A3'], guests: 2 });
    const b = await svc.openCheck(user('t1'), { tableIds: ['S3'], guests: 3 });
    await svc.addLine(user('t1'), b.id, { menuItemId: 'beer', quantity: 2 });
    const merged = await svc.merge(user('t1'), a.id, { fromCheckId: b.id });
    expect(merged.tableIds).toEqual(['A3', 'S3']);
    expect(merged.guests).toBe(5);
    expect(merged.subtotalCents).toBe(60000);
    expect(tableCheck.rows.find((r) => r.id === b.id)!.status).toBe('VOID');
    await expect(svc.merge(user('t1'), a.id, { fromCheckId: a.id })).rejects.toThrow('MERGE_SAME');
  });

  it('splitting moves chosen dishes (or part of a line) to a new bill on the same table', async () => {
    const { svc } = make();
    const c = await svc.openCheck(user('t1'), { tableIds: ['A3'] });
    await svc.addLine(user('t1'), c.id, { menuItemId: 'beer', quantity: 2 });
    await svc.addLine(user('t1'), c.id, { menuItemId: 'bbh' });
    await svc.send(user('t1'), c.id);
    const beer = (await svc.getCheck(user('t1'), c.id)).lines.find((l) => l.name === 'Bia')!;
    const r = await svc.split(user('t1'), c.id, { lines: [{ lineId: beer.id, quantity: 1 }] });
    expect(r.from.subtotalCents).toBe(110000);
    expect(r.to.subtotalCents).toBe(30000);
    expect(r.to.tableIds).toEqual(['A3']);
    expect(r.to.lines[0].state).toBe('SENT');
    const all = (await svc.getCheck(user('t1'), c.id)).lines.map((l) => l.id);
    await expect(svc.split(user('t1'), c.id, { lines: all.map((lineId) => ({ lineId })) })).rejects.toThrow('SPLIT_ALL');
    const floor = await svc.floor(user('t1'));
    expect(floor.checks.filter((x) => x.tableIds.includes('A3'))).toHaveLength(2);
  });

  it('when the owner names cashiers, other staff ask for payment instead of taking it', async () => {
    const { svc, pos } = make();
    await svc.saveSettings(user('t1'), { cashierUserIds: ['cashier-0001', 'someone-of-t2'] });
    expect((await svc.readSettings(user('t1'))).cashierUserIds).toEqual(['cashier-0001']);
    const server = user('t1', { userId: 'server-0001', role: UserRole.STAFF });
    const c = await svc.openCheck(server, { tableIds: ['A3'] });
    await svc.addLine(server, c.id, { menuItemId: 'beer' });
    await svc.send(server, c.id);
    expect((await svc.floor(server)).canPay).toBe(false);
    await expect(svc.pay(server, c.id, { tenders: [{ method: 'CASH' as never, amountCents: 30000 }] })).rejects.toThrow('PAY_NOT_ALLOWED');
    const asked = await svc.requestPay(server, c.id);
    expect(asked.payRequestedAt).toBeTruthy();
    const cashier = user('t1', { userId: 'cashier-0001', role: UserRole.STAFF });
    const paid = await svc.pay(cashier, c.id, { tenders: [{ method: 'CASH' as never, amountCents: 30000 }] });
    expect(paid.check.status).toBe('PAID');
    expect(pos.createOrder).toHaveBeenCalledTimes(1);
  });
});

describe('RestaurantService — one restaurant never touches another', () => {
  it('cannot merge, split, request payment on or mark sold out another restaurant\'s things', async () => {
    const { svc } = make();
    const a = await svc.openCheck(user('t1'), { tableIds: ['A3'] });
    const b2 = await svc.openCheck(user('t2'), { tableIds: ['B1'] });
    await expect(svc.merge(user('t1'), a.id, { fromCheckId: b2.id })).rejects.toThrow('CHECK_NOT_FOUND');
    await expect(svc.merge(user('t2'), b2.id, { fromCheckId: a.id })).rejects.toThrow('CHECK_NOT_FOUND');
    await expect(svc.split(user('t2'), a.id, { lines: [] })).rejects.toThrow('CHECK_NOT_FOUND');
    await expect(svc.requestPay(user('t2'), a.id)).rejects.toThrow('CHECK_NOT_FOUND');
    await expect(svc.setSoldOut(user('t2'), 'pho', true)).rejects.toThrow('DISH_NOT_FOUND');
  });

  it('cannot open a bill on another restaurant\'s table', async () => {
    const { svc } = make();
    await expect(svc.openCheck(user('t1'), { tableIds: ['B1'] })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cannot read, order on, send, pay or move another restaurant\'s bill', async () => {
    const { svc, pos } = make();
    const c = await svc.openCheck(user('t1'), { tableIds: ['A3'] });
    await svc.addLine(user('t1'), c.id, { menuItemId: 'pho', options: [{ groupId: 'size', choiceIds: ['n'] }] });
    const other = user('t2');
    await expect(svc.getCheck(other, c.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.addLine(other, c.id, { menuItemId: 'steak' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.send(other, c.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.pay(other, c.id, { tenders: [{ method: 'CASH' as never, amountCents: 1 }], allowUnsent: true })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.move(other, c.id, { tableIds: ['B1'] })).rejects.toBeInstanceOf(NotFoundException);
    expect(pos.createOrder).not.toHaveBeenCalled();
  });

  it('cannot add another restaurant\'s dish to its own bill', async () => {
    const { svc } = make();
    const c = await svc.openCheck(user('t1'), { tableIds: ['A3'] });
    await expect(svc.addLine(user('t1'), c.id, { menuItemId: 'steak' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the floor lists only the caller\'s tables and bills', async () => {
    const { svc } = make();
    await svc.openCheck(user('t1'), { tableIds: ['A3'] });
    const f2 = await svc.floor(user('t2'));
    expect(f2.tables.map((t) => t.id)).toEqual(['B1']);
    expect(f2.checks).toEqual([]);
    const f1 = await svc.floor(user('t1'));
    expect(f1.checks).toHaveLength(1);
  });

  it('a user with no restaurant is refused', async () => {
    const { svc } = make();
    await expect(svc.floor({ userId: 'x', role: UserRole.SALON_ADMIN, tenantId: null } as never)).rejects.toThrow();
  });
});
