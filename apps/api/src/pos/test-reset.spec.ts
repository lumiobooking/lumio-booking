/**
 * Xoá dữ liệu bán hàng thử: owner types XOA, the chosen days' sales go —
 * with stock, points and gift-card money put back — and nothing of another
 * salon, nothing before the chosen day, and nothing inside a closed payroll.
 */
import { confirmed, giftCardCredit, lockedPayroll, loyaltyNet, resetWindow, restock } from './test-reset';
import { TestResetService } from './test-reset.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('the rules', () => {
  const now = new Date('2026-11-05T09:00:00Z'); // 16:00 in Vietnam
  it('confirmation is the word XOA, with or without accents', () => {
    for (const ok of ['XOA', 'xoá', ' Xóa ', 'XOÁ']) expect(confirmed(ok)).toBe(true);
    for (const no of ['', 'XOA DI', 'delete', undefined, null]) expect(confirmed(no)).toBe(false);
  });
  it('the window is a real salon day up to today, or everything', () => {
    expect(resetWindow('', 'Asia/Ho_Chi_Minh', now)).toEqual({ fromDay: null, today: '2026-11-05', fromUtc: null });
    const w = resetWindow('2026-11-01', 'Asia/Ho_Chi_Minh', now)!;
    expect(w.fromUtc!.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(resetWindow('2026-11-06', 'Asia/Ho_Chi_Minh', now)).toBeNull();
    expect(resetWindow('2026-02-30', 'Asia/Ho_Chi_Minh', now)).toBeNull();
    expect(resetWindow('1/11/2026', 'Asia/Ho_Chi_Minh', now)).toBeNull();
  });
  it('a closed payroll blocks only when it touches the days wiped', () => {
    const runs = [{ periodFrom: '2026-10-01', periodTo: '2026-10-31' }];
    expect(lockedPayroll(runs, resetWindow('2026-11-01', 'UTC', now)!)).toBeNull();
    expect(lockedPayroll(runs, resetWindow('2026-10-31', 'UTC', now)!)).toEqual(runs[0]);
    expect(lockedPayroll(runs, resetWindow('', 'UTC', now)!)).toEqual(runs[0]);
  });
  it('points, gift-card money and stock are undone by what is still outstanding', () => {
    expect([...loyaltyNet([{ customerId: 'a', points: 10 }, { customerId: 'a', points: -10 }, { customerId: 'b', points: 5 }])]).toEqual([['b', 5]]);
    expect([...giftCardCredit([{ giftCardId: 'g', kind: 'REDEEM', amountCents: -500 }, { giftCardId: 'h', kind: 'REDEEM', amountCents: -300 }, { giftCardId: 'h', kind: 'ADJUST', amountCents: 300 }, { giftCardId: 'g', kind: 'ISSUE', amountCents: 9999 }])]).toEqual([['g', 500]]);
    expect([...restock([
      { status: 'PAID', items: [{ kind: 'PRODUCT', productId: 'p', quantity: 2 }, { kind: 'SERVICE', productId: null, quantity: 1 }] },
      { status: 'VOID', items: [{ kind: 'PRODUCT', productId: 'p', quantity: 5 }] },
    ])]).toEqual([['p', 2]]);
  });
});

// ---- the service, against two in-memory shops ----
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Row[]).some((w) => matches(row, w));
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return (v.in as unknown[]).includes(row[k]);
      if ('gte' in v) return row[k] >= v.gte;
      if ('lt' in v) return row[k] < v.lt;
      if ('increment' in v) return true;
    }
    return row[k] === v;
  });
}
function table(rows: Row[]) {
  return {
    rows,
    findMany: async ({ where }: Row = {}) => rows.filter((r) => matches(r, where)).map((r) => (r.items ? r : { ...r })),
    findFirst: async ({ where }: Row = {}) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: Row) => rows.find((r) => r.id === where.id) ?? null,
    count: async ({ where }: Row = {}) => rows.filter((r) => matches(r, where)).length,
    updateMany: async ({ where, data }: Row) => {
      let n = 0;
      for (const r of rows) if (matches(r, where)) {
        n++;
        for (const [k, v] of Object.entries(data)) r[k] = v && typeof v === 'object' && 'increment' in (v as Row) ? r[k] + (v as Row).increment : v;
      }
      return { count: n };
    },
    deleteMany: async ({ where }: Row) => {
      let n = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) { rows.splice(i, 1); n++; }
      return { count: n };
    },
  };
}

function makeShops() {
  const old = new Date('2026-10-20T03:00:00Z');
  const test = new Date('2026-11-03T05:00:00Z');
  const o = (id: string, tenantId: string, createdAt: Date, status = 'PAID', items: Row[] = []) => ({ id, tenantId, createdAt, status, totalCents: 100_000, currency: 'VND', items });
  const db: Row = {
    tenant: table([{ id: 'A', timezone: 'Asia/Ho_Chi_Minh' }, { id: 'B', timezone: 'Asia/Ho_Chi_Minh' }]),
    order: table([
      o('a-old', 'A', old),
      o('a1', 'A', test, 'PAID', [{ kind: 'PRODUCT', productId: 'pA', quantity: 2 }]),
      o('a2', 'A', test, 'VOID', [{ kind: 'PRODUCT', productId: 'pA', quantity: 4 }]),
      o('b1', 'B', test, 'PAID', [{ kind: 'PRODUCT', productId: 'pB', quantity: 1 }]),
    ]),
    payment: table([
      { id: 'pay-a-old', tenantId: 'A', providerReference: 'order:a-old' },
      { id: 'pay-a1', tenantId: 'A', providerReference: 'order:a1' },
      { id: 'pay-b1', tenantId: 'B', providerReference: 'order:b1' },
      { id: 'dep', tenantId: 'A', providerReference: null },
    ]),
    product: table([{ id: 'pA', tenantId: 'A', trackStock: true, stockQty: 10 }, { id: 'pB', tenantId: 'B', trackStock: true, stockQty: 10 }]),
    customer: table([{ id: 'cA', tenantId: 'A', loyaltyPoints: 30 }, { id: 'cB', tenantId: 'B', loyaltyPoints: 30 }]),
    loyaltyTransaction: table([
      { id: 'l1', tenantId: 'A', customerId: 'cA', points: 10, refType: 'order', refId: 'a1' },
      { id: 'l2', tenantId: 'B', customerId: 'cB', points: 10, refType: 'order', refId: 'b1' },
    ]),
    giftCard: table([{ id: 'gA', tenantId: 'A', balanceCents: 0, status: 'REDEEMED' }]),
    giftCardTransaction: table([
      { id: 'g1', tenantId: 'A', giftCardId: 'gA', kind: 'ISSUE', amountCents: 50_000, orderId: null },
      { id: 'g2', tenantId: 'A', giftCardId: 'gA', kind: 'REDEEM', amountCents: -50_000, orderId: 'a1' },
    ]),
    orderRefund: table([{ id: 'r1', tenantId: 'A', orderId: 'a1' }, { id: 'r2', tenantId: 'B', orderId: 'b1' }]),
    tipLog: table([{ id: 't1', tenantId: 'A', orderId: 'a1' }, { id: 't2', tenantId: 'A', orderId: null }]),
    tableCheck: table([
      { id: 'k-open', tenantId: 'A', openedAt: test, orderId: null },
      { id: 'k-old', tenantId: 'A', openedAt: old, orderId: 'a-old' },
      { id: 'k-b', tenantId: 'B', openedAt: test, orderId: null },
    ]),
    cashShift: table([{ id: 's-a', tenantId: 'A', openedAt: test }, { id: 's-b', tenantId: 'B', openedAt: test }]),
    heldBill: table([{ id: 'h-a', tenantId: 'A', createdAt: test }, { id: 'h-b', tenantId: 'B', createdAt: test }]),
    printJob: table([{ id: 'j-a', tenantId: 'A', createdAt: test }, { id: 'j-a-old', tenantId: 'A', createdAt: old }, { id: 'j-b', tenantId: 'B', createdAt: test }]),
    payrollRun: table([]),
  };
  db.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  const audits: Row[] = [];
  const svc = new TestResetService(db as never, { log: async (e: Row) => { audits.push(e); } } as never);
  // A Lumio Support session inside the salon (the only one allowed to wipe).
  const owner = (tenantId: string) => ({ userId: `u-${tenantId}`, tenantId, role: 'SALON_ADMIN', supportSession: true }) as never;
  const realOwner = (tenantId: string) => ({ userId: `o-${tenantId}`, tenantId, role: 'SALON_ADMIN' }) as never;
  const ids = (t: string) => db[t].rows.map((r: Row) => r.id);
  return { db, svc, owner, realOwner, ids, audits };
}

describe('wiping one shop\'s test sales', () => {
  it('the salon\'s own owner cannot wipe or even preview — Lumio Support only', async () => {
    const s = makeShops();
    await expect(s.svc.preview(s.realOwner('A'), '')).rejects.toThrow('Lumio Support');
    await expect(s.svc.run(s.realOwner('A'), { confirm: 'XOA' })).rejects.toThrow('Lumio Support');
    expect(s.ids('order')).toHaveLength(4);
  });

  it('refuses without the typed word and before a bad day', async () => {
    const s = makeShops();
    await expect(s.svc.run(s.owner('A'), { confirm: 'yes' })).rejects.toThrow('XOA');
    await expect(s.svc.run(s.owner('A'), { confirm: 'XOA', from: '2099-01-01' })).rejects.toThrow();
    expect(s.ids('order')).toHaveLength(4);
  });

  it('previews only this shop and the chosen days', async () => {
    const s = makeShops();
    const p = await s.svc.preview(s.owner('A'), '2026-11-01');
    expect(p).toMatchObject({ bills: 2, paidBills: 1, revenueCents: 100_000, tableBills: 1, shifts: 1, heldBills: 1, printJobs: 1, billsKept: 1, lockedPayroll: null });
  });

  it('from a day: those sales go, earlier ones stay, the other shop is untouched, stock/points/gift money come back', async () => {
    const s = makeShops();
    const r = await s.svc.run(s.owner('A'), { confirm: 'xoá', from: '2026-11-01' });
    expect(r).toMatchObject({ bills: 2, payments: 1, refunds: 1, tips: 1, tableBills: 1, shifts: 1, heldBills: 1, printJobs: 1 });
    expect(s.ids('order')).toEqual(['a-old', 'b1']);
    expect(s.ids('payment')).toEqual(['pay-a-old', 'pay-b1', 'dep']);
    expect(s.ids('tableCheck')).toEqual(['k-old', 'k-b']);
    expect(s.ids('cashShift')).toEqual(['s-b']);
    expect(s.ids('heldBill')).toEqual(['h-b']);
    expect(s.ids('printJob')).toEqual(['j-a-old', 'j-b']);
    expect(s.ids('tipLog')).toEqual(['t2']);
    expect(s.ids('orderRefund')).toEqual(['r2']);
    // Only the live sale's 2 units go back (the void already restocked its 4).
    expect(s.db.product.rows.map((p: Row) => p.stockQty)).toEqual([12, 10]);
    expect(s.db.customer.rows.map((c: Row) => c.loyaltyPoints)).toEqual([20, 30]);
    expect(s.ids('loyaltyTransaction')).toEqual(['l2']);
    expect(s.db.giftCard.rows[0]).toMatchObject({ balanceCents: 50_000, status: 'ACTIVE' });
    expect(s.ids('giftCardTransaction')).toEqual(['g1']);
    expect(s.audits[0]).toMatchObject({ tenantId: 'A', action: 'pos.test_data_reset' });
  });

  it('everything: all of this shop\'s sales go, the other shop keeps all of its own', async () => {
    const s = makeShops();
    await s.svc.run(s.owner('B'), { confirm: 'XOA' });
    expect(s.ids('order')).toEqual(['a-old', 'a1', 'a2']);
    expect(s.ids('tableCheck')).toEqual(['k-open', 'k-old']);
    expect(s.ids('payment')).toEqual(['pay-a-old', 'pay-a1', 'dep']);
    expect(s.db.product.rows.map((p: Row) => p.stockQty)).toEqual([10, 11]);
    expect(s.db.customer.rows.map((c: Row) => c.loyaltyPoints)).toEqual([30, 20]);
  });

  it('a closed payroll over those days stops it, and nothing is deleted', async () => {
    const s = makeShops();
    s.db.payrollRun.rows.push({ tenantId: 'A', status: 'FINAL', periodFrom: '2026-11-01', periodTo: '2026-11-15' });
    await expect(s.svc.run(s.owner('A'), { confirm: 'XOA', from: '2026-11-01' })).rejects.toThrow('Kỳ lương');
    expect(s.ids('order')).toHaveLength(4);
    // Salon B has no closed payroll: its owner can still wipe.
    await expect(s.svc.run(s.owner('B'), { confirm: 'XOA' })).resolves.toMatchObject({ bills: 1 });
  });
});
