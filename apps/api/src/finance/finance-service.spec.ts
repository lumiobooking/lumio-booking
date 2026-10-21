/**
 * Thu & Chi service: the books of one salon never touch another's, money is
 * never deleted (only voided), the same thing is never paid twice, big money
 * out needs an approver, and the cash book adds up.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    OrderStatus: actual.OrderStatus?.REFUNDED ? actual.OrderStatus : { OPEN: 'OPEN', PAID: 'PAID', VOID: 'VOID', REFUNDED: 'REFUNDED' },
    PaymentStatus: actual.PaymentStatus ?? { PENDING: 'PENDING', PAID: 'PAID', REFUNDED: 'REFUNDED', FAILED: 'FAILED' },
    UserRole: actual.UserRole ?? { SUPER_ADMIN: 'SUPER_ADMIN', SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF', CUSTOMER: 'CUSTOMER' },
  };
});
jest.mock('../pos/pos.service', () => ({ PosService: class {} }));
import { FinanceService } from './finance.service';
import { resetSetupCache } from './finance-setup';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Enough of Prisma's `where` to run the service's queries against arrays. */
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [k, cond] of Object.entries(where)) {
    if (k === 'NOT') { if (matches(row, cond as Row)) return false; continue; }
    if (k === 'OR') { if (!(cond as Row[]).some((c) => matches(row, c))) return false; continue; }
    const v = row[k];
    if (cond === null) { if (v !== null && v !== undefined) return false; continue; }
    if (cond instanceof Date || typeof cond !== 'object') { if ((v instanceof Date ? v.getTime() : v) !== (cond instanceof Date ? cond.getTime() : cond)) return false; continue; }
    const c = cond as Row;
    const val = v instanceof Date ? v.getTime() : v;
    const n = (x: unknown) => (x instanceof Date ? x.getTime() : x) as number;
    if ('in' in c && !(c.in as unknown[]).includes(v)) return false;
    if ('gte' in c && !(val >= n(c.gte))) return false;
    if ('lte' in c && !(val <= n(c.lte))) return false;
    if ('lt' in c && !(val < n(c.lt))) return false;
    if ('gt' in c && !(val > n(c.gt))) return false;
    if ('startsWith' in c && !(typeof v === 'string' && v.startsWith(c.startsWith))) return false;
  }
  return true;
}

let seq = 0;
function table(rows: Row[], wheres: Row[], uniques: ((a: Row, b: Row) => boolean)[] = []) {
  return {
    rows,
    findMany: async (a: Row = {}) => {
      wheres.push(a.where ?? {});
      let out = rows.filter((r) => matches(r, a.where));
      if (a.orderBy && !Array.isArray(a.orderBy)) {
        const [[key, dir]] = Object.entries(a.orderBy as Row);
        out = [...out].sort((x, y) => (x[key] > y[key] ? 1 : x[key] < y[key] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      return a.take ? out.slice(0, a.take) : out;
    },
    findFirst: async (a: Row = {}) => { wheres.push(a.where ?? {}); return rows.find((r) => matches(r, a.where)) ?? null; },
    findUnique: async (a: Row = {}) => { wheres.push(a.where ?? {}); return rows.find((r) => matches(r, a.where)) ?? null; },
    create: async ({ data }: Row) => {
      const row = { id: `id${++seq}`, createdAt: new Date(), voidedAt: null, archivedAt: null, ...data };
      for (const u of uniques) if (rows.some((r) => u(r, row))) throw Object.assign(new Error('unique'), { code: 'P2002', meta: { target: ['x'] } });
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: Row) => { const r = rows.find((x) => matches(x, where)); Object.assign(r!, data); return r; },
    updateMany: async ({ where, data }: Row) => { wheres.push(where); const hit = rows.filter((r) => matches(r, where)); hit.forEach((r) => Object.assign(r, data)); return { count: hit.length }; },
  };
}

function make(opts: { payments?: Row[]; runs?: Row[]; moves?: Row[]; approver?: (u: Row, t: string, pin?: string) => Promise<string> } = {}) {
  const wheres: Row[] = [];
  const audits: Row[] = [];
  const entries: Row[] = [];
  const prisma: Row = {
    tenant: { findUnique: async ({ where }: Row) => ({ id: where.id, timezone: 'UTC', market: 'VN' }) },
    user: { findFirst: async () => ({ firstName: 'Mai', lastName: '' }) },
    setting: { findUnique: async () => null, upsert: async () => ({}) },
    cashFund: table([], wheres),
    cashCategory: table([], wheres, [(a, b) => a.tenantId === b.tenantId && !!a.systemKey && a.systemKey === b.systemKey]),
    cashEntry: table(entries, wheres, [
      (a, b) => a.tenantId === b.tenantId && a.code === b.code,
      (a, b) => a.tenantId === b.tenantId && !a.voidedAt && !!a.sourceRef && a.source === b.source && a.sourceRef === b.sourceRef,
    ]),
    recurringExpense: table([], wheres),
    cashMovement: table(opts.moves ?? [], wheres),
    cashShift: table([], wheres),
    orderRefund: table([], wheres),
    supplyMovement: table([], wheres),
    supplyItem: table([], wheres),
    payrollRun: table(opts.runs ?? [], wheres),
    payment: table(opts.payments ?? [], wheres),
    order: table([], wheres),
  };
  const pos = {
    salesSummary: async () => ({ totals: { grossCents: 0, discountCents: 0, refundCents: 0, netCents: 0, tipsCents: 0, taxCents: 0, serviceCents: 0, productCents: 0 } }),
    approverFor: opts.approver ?? (async (u: Row) => u.userId),
  };
  const svc = new FinanceService(prisma as never, { log: async (a: Row) => { audits.push(a); } } as never, pos as never);
  return { svc, prisma, wheres, audits, entries };
}

const owner = { userId: 'u1', tenantId: 't1', role: 'SALON_ADMIN' } as never;
const otherOwner = { userId: 'u9', tenantId: 't2', role: 'SALON_ADMIN' } as never;
const today = new Date().toISOString().slice(0, 10);

async function setup(m: ReturnType<typeof make>, user = owner) {
  const funds = await m.svc.listFunds(user);
  const cats = await m.svc.listCategories(user);
  return {
    cash: funds.find((f) => f.kind === 'CASH')!,
    bank: funds.find((f) => f.kind === 'BANK')!,
    cat: (key: string) => cats.find((c) => c.systemKey === key)!,
  };
}

beforeEach(() => resetSetupCache());

describe('setup', () => {
  it('makes one cash drawer, one default bank and the standard categories — once', async () => {
    const m = make();
    await setup(m);
    await m.svc.listFunds(owner);
    resetSetupCache();
    await m.svc.listFunds(owner);
    const funds = (m.prisma.cashFund.rows as Row[]).filter((f) => f.tenantId === 't1');
    expect(funds.map((f) => f.kind).sort()).toEqual(['BANK', 'CASH']);
    expect(funds.find((f) => f.kind === 'BANK')!.isDefault).toBe(true);
    const cats = (m.prisma.cashCategory.rows as Row[]).filter((c) => c.tenantId === 't1');
    expect(new Set(cats.map((c) => c.systemKey)).size).toBe(cats.length);
    expect(cats.find((c) => c.systemKey === 'rent')!.name).toBe('Thuê mặt bằng');
  });
});

describe('vouchers', () => {
  it('writes a numbered payment voucher; the system’s own categories cannot be typed by hand', async () => {
    const m = make();
    const { cash, cat } = await setup(m);
    const e = await m.svc.createEntry(owner, { direction: 'OUT', amountCents: 10_500, fundId: cash.id, categoryId: cat('laundry').id, payee: 'Sunshine' });
    expect(e).toMatchObject({ code: 'PC-000001', tenantId: 't1', countsInPl: true, source: 'MANUAL', day: today });
    const e2 = await m.svc.createEntry(owner, { direction: 'OUT', amountCents: 100, fundId: cash.id, categoryId: cat('laundry').id });
    expect(e2.code).toBe('PC-000002');
    await expect(m.svc.createEntry(owner, { direction: 'OUT', amountCents: 100, fundId: cash.id, categoryId: cat('payroll').id })).rejects.toThrow(/hệ thống/);
    await expect(m.svc.createEntry(owner, { direction: 'IN', amountCents: 100, fundId: cash.id, categoryId: cat('rent').id })).rejects.toThrow(/chiều/);
    expect(m.audits.some((a) => a.action === 'finance.entry_created' && a.tenantId === 't1')).toBe(true);
  });

  it('a NON-P&L category can never be put on the P&L', async () => {
    const m = make();
    const { bank, cat } = await setup(m);
    const e = await m.svc.createEntry(owner, { direction: 'OUT', amountCents: 2000, fundId: bank.id, categoryId: cat('owner_out').id, countsInPl: true });
    expect(e.countsInPl).toBe(false);
  });

  it('no voucher before the fund’s books start, none in the future', async () => {
    const m = make();
    const { cash, cat } = await setup(m);
    await expect(m.svc.createEntry(owner, { direction: 'OUT', amountCents: 100, fundId: cash.id, categoryId: cat('rent').id, day: '2020-01-01' })).rejects.toThrow(/bắt đầu/);
    await expect(m.svc.createEntry(owner, { direction: 'OUT', amountCents: 100, fundId: cash.id, categoryId: cat('rent').id, day: '2999-01-01' })).rejects.toThrow(/tương lai/);
  });

  it('money out above the limit asks for an approver', async () => {
    const calls: Row[] = [];
    const m = make({ approver: async (u, t, pin) => { calls.push({ u, t, pin }); if (pin !== '1234') throw new Error('APPROVAL_PIN_REQUIRED'); return 'mgr'; } });
    const { bank, cat } = await setup(m);
    const staff = { userId: 's1', tenantId: 't1', role: 'STAFF' } as never;
    await expect(m.svc.createEntry(staff, { direction: 'OUT', amountCents: 450_000, fundId: bank.id, categoryId: cat('rent').id })).rejects.toThrow(/APPROVAL_PIN_REQUIRED/);
    const ok = await m.svc.createEntry(staff, { direction: 'OUT', amountCents: 450_000, fundId: bank.id, categoryId: cat('rent').id, approvalPin: '1234' });
    expect(ok.approvedByUserId).toBe('mgr');
    expect(calls.every((c) => c.t === 't1')).toBe(true);
    // under the limit: nobody is asked
    calls.length = 0;
    await m.svc.createEntry(staff, { direction: 'OUT', amountCents: 4_000, fundId: bank.id, categoryId: cat('rent').id });
    expect(calls).toHaveLength(0);
  });

  it('void needs a reason, keeps the row, and takes it out of the totals', async () => {
    const m = make();
    const { cash, cat } = await setup(m);
    const e = await m.svc.createEntry(owner, { direction: 'OUT', amountCents: 700, fundId: cash.id, categoryId: cat('repairs').id });
    await expect(m.svc.voidEntry(owner, e.id, { reason: '' })).rejects.toThrow(/lý do/);
    await m.svc.voidEntry(owner, e.id, { reason: 'nhập trùng' });
    expect(m.entries.find((x) => x.id === e.id)).toMatchObject({ voidReason: 'nhập trùng' });
    const led = await m.svc.ledger(owner, { from: today, to: today });
    expect(led.outCents).toBe(0);
    expect(led.lines.find((l) => l.id === `entry:${e.id}`)!.voided).toBeTruthy();
  });

  it('a transfer moves nothing in the all-funds view and is voided as a pair', async () => {
    const m = make();
    const { cash, bank } = await setup(m);
    const t = await m.svc.transfer(owner, { fromFundId: cash.id, toFundId: bank.id, amountCents: 200_000 });
    expect(t.out.code).toMatch(/^CQ-\d{6}$/);
    expect(t.in.code).toBe(`${t.out.code}-N`);
    const all = await m.svc.ledger(owner, { from: today, to: today });
    expect([all.inCents, all.outCents, all.transferCents]).toEqual([0, 0, 200_000]);
    const one = await m.svc.ledger(owner, { from: today, to: today, fundId: cash.id });
    expect(one.outCents).toBe(200_000);
    await m.svc.voidEntry(owner, t.in.id, { reason: 'sai' });
    expect(m.entries.filter((x) => x.transferId === t.out.transferId).every((x) => x.voidedAt)).toBe(true);
    await expect(m.svc.transfer(owner, { fromFundId: cash.id, toFundId: cash.id, amountCents: 1 })).rejects.toThrow(/khác nhau/);
  });
});

describe('paying what the system already knows about', () => {
  it('a payroll run is paid once (split cash / bank); voiding frees it', async () => {
    const m = make({ runs: [{ id: 'run1', tenantId: 't1', status: 'FINAL', periodFrom: today, periodTo: today, totals: { netPayCents: 30_000, cashCents: 10_000, checkCents: 20_000 } }] });
    const { cash, bank } = await setup(m);
    const pend = await m.svc.pending(owner);
    expect(pend.payroll).toEqual([expect.objectContaining({ runId: 'run1', cashCents: 10_000, bankCents: 20_000 })]);
    const made = await m.svc.payPayroll(owner, 'run1', { cashCents: 10_000, bankCents: 20_000 });
    expect(made.map((e) => [e.fundId, e.amountCents, e.countsInPl, e.sourceRef])).toEqual([[cash.id, 10_000, false, 'run1:cash'], [bank.id, 20_000, false, 'run1:bank']]);
    await expect(m.svc.payPayroll(owner, 'run1', { cashCents: 1 })).rejects.toThrow(/đã ghi trả/);
    expect((await m.svc.pending(owner)).payroll).toEqual([]);
    for (const e of made) await m.svc.voidEntry(owner, e.id, { reason: 'ghi nhầm' });
    expect((await m.svc.pending(owner)).payroll).toHaveLength(1);
  });

  it('another salon’s payroll run cannot be paid from here', async () => {
    const m = make({ runs: [{ id: 'runX', tenantId: 't2', status: 'FINAL', periodFrom: today, periodTo: today, totals: {} }] });
    await setup(m);
    await expect(m.svc.payPayroll(owner, 'runX', { cashCents: 100 })).rejects.toThrow(/Không thấy/);
  });
});

describe('the cash book reads sales live', () => {
  it('sales by fund, a voided bill nowhere, closing = opening + in − out', async () => {
    const now = new Date();
    const payments = [
      { id: 'p1', tenantId: 't1', amountCents: 3_000, provider: 'pos-cash', status: 'PAID', paidAt: now, providerReference: 'order:o1' },
      { id: 'p2', tenantId: 't1', amountCents: 4_500, provider: 'pos-card', status: 'PAID', paidAt: now, providerReference: 'order:o2' },
      { id: 'p3', tenantId: 't1', amountCents: 9_000, provider: 'pos-card', status: 'REFUNDED', paidAt: now, providerReference: 'order:voided' },
      { id: 'pX', tenantId: 't2', amountCents: 77_000, provider: 'pos-cash', status: 'PAID', paidAt: now, providerReference: 'order:theirs' },
    ];
    const m = make({ payments });
    const { cash, cat } = await setup(m);
    (m.prisma.order.rows as Row[]).push({ id: 'voided', tenantId: 't1', status: 'VOID', orderNumber: 9 });
    await m.svc.createEntry(owner, { direction: 'OUT', amountCents: 1_000, fundId: cash.id, categoryId: cat('laundry').id });
    const r = await m.svc.ledger(owner, { from: today, to: today });
    expect(r.inCents).toBe(7_500);
    expect(r.outCents).toBe(1_000);
    expect(r.closingCents).toBe(r.openingCents + r.inCents - r.outCents);
    expect(r.fundList.find((f) => f.id === cash.id)!.balanceCents).toBe(2_000);
    // every read named this salon
    const reads = m.wheres.filter((w) => 'tenantId' in w);
    expect(reads.length).toBeGreaterThan(5);
    expect(reads.every((w) => w.tenantId === 't1')).toBe(true);
  });

  it('a drawer movement can be classified only with this salon’s category, the right way round', async () => {
    const moves = [{ id: 'mv1', tenantId: 't1', shiftId: 's1', kind: 'OUT', amountCents: 1_800, reason: 'đá', byName: 'Linh', createdAt: new Date(), categoryId: null, source: null }];
    const m = make({ moves });
    const { cat } = await setup(m);
    const theirs = await setup(m, otherOwner);
    await expect(m.svc.categorizeDrawer(owner, 'mv1', { categoryId: theirs.cat('supplies').id })).rejects.toThrow();
    await expect(m.svc.categorizeDrawer(owner, 'mv1', { categoryId: cat('other_income').id })).rejects.toThrow(/chiều/);
    await m.svc.categorizeDrawer(owner, 'mv1', { categoryId: cat('supplies').id });
    expect(moves[0].categoryId).toBe(cat('supplies').id);
    await expect(m.svc.categorizeDrawer(otherOwner, 'mv1', { categoryId: theirs.cat('supplies').id })).rejects.toThrow(/Không thấy/);
  });
});

describe('cross-tenant', () => {
  it('one salon cannot use, void or see another salon’s fund or voucher', async () => {
    const m = make();
    const mine = await setup(m);
    const theirs = await setup(m, otherOwner);
    await expect(m.svc.createEntry(owner, { direction: 'OUT', amountCents: 100, fundId: theirs.cash.id, categoryId: mine.cat('rent').id })).rejects.toThrow(/quỹ/);
    await expect(m.svc.createEntry(owner, { direction: 'OUT', amountCents: 100, fundId: mine.cash.id, categoryId: theirs.cat('rent').id })).rejects.toThrow(/loại chi/);
    const e = await m.svc.createEntry(otherOwner, { direction: 'OUT', amountCents: 100, fundId: theirs.cash.id, categoryId: theirs.cat('rent').id });
    await expect(m.svc.voidEntry(owner, e.id, { reason: 'x' })).rejects.toThrow(/Không thấy/);
    await expect(m.svc.updateEntry(owner, e.id, { amountCents: 5 })).rejects.toThrow(/Không thấy/);
    await expect(m.svc.updateFund(owner, theirs.bank.id, { name: 'x' })).rejects.toThrow(/Không thấy/);
    await expect(m.svc.ledger(owner, { from: today, to: today, fundId: theirs.cash.id })).rejects.toThrow(/Không thấy/);
    const r = await m.svc.ledger(owner, { from: today, to: today });
    expect(r.lines).toHaveLength(0);
    // each salon numbers its own vouchers
    const own = await m.svc.createEntry(owner, { direction: 'OUT', amountCents: 100, fundId: mine.cash.id, categoryId: mine.cat('rent').id });
    expect(own.code).toBe('PC-000001');
  });

  it('only the owner touches funds, opening balances and the approval limit', async () => {
    const m = make();
    const { bank } = await setup(m);
    const staff = { userId: 's1', tenantId: 't1', role: 'STAFF' } as never;
    await expect(m.svc.updateFund(staff, bank.id, { openingCents: 1 })).rejects.toThrow(/chủ tiệm/);
    await expect(m.svc.createFund(staff, { kind: 'BANK', name: 'x' })).rejects.toThrow(/chủ tiệm/);
    await expect(m.svc.saveSettings(staff, { approvalOverCents: 1 })).rejects.toThrow(/chủ tiệm/);
  });
});

describe('recurring costs', () => {
  it('a reminder paid writes one voucher for its due day and moves to the next; paying the same day twice is refused', async () => {
    const m = make();
    const { bank, cat } = await setup(m);
    const r = await m.svc.createRecurring(owner, { name: 'Rent', categoryId: cat('rent').id, fundId: bank.id, amountCents: 450_000, cadence: 'MONTHLY', anchorDay: today, mode: 'REMIND' });
    const e = await m.svc.payRecurring(owner, r.id, {});
    expect(e).toMatchObject({ amountCents: 450_000, source: 'RECURRING', sourceRef: `${r.id}:${today}` });
    const after = (m.prisma.recurringExpense.rows as Row[]).find((x) => x.id === r.id)!;
    expect(after.nextDue > today).toBe(true);
    // voiding it brings the reminder back
    await m.svc.voidEntry(owner, e.id, { reason: 'chưa trả' });
    expect((m.prisma.recurringExpense.rows as Row[]).find((x) => x.id === r.id)!.nextDue).toBe(today);
  });

  it('AUTO writes its voucher on the due day by itself, exactly once, and never back-fills the past', async () => {
    const m = make();
    const { bank, cat } = await setup(m);
    const past = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
    const r = await m.svc.createRecurring(owner, { name: 'Lumio', categoryId: cat('software').id, fundId: bank.id, amountCents: 17_900, cadence: 'WEEKLY', anchorDay: past, mode: 'AUTO' });
    expect(r.nextDue >= today).toBe(true);
    const r2 = await m.svc.createRecurring(owner, { name: 'Wifi', categoryId: cat('utilities').id, fundId: bank.id, amountCents: 8_000, cadence: 'MONTHLY', anchorDay: today, mode: 'AUTO' });
    await m.svc.ledger(owner, { from: today, to: today });
    await m.svc.ledger(owner, { from: today, to: today });
    const autos = m.entries.filter((e) => e.source === 'RECURRING' && String(e.sourceRef).startsWith(r2.id));
    expect(autos).toHaveLength(1);
    expect(autos[0]).toMatchObject({ amountCents: 8_000, day: today, countsInPl: true });
    await expect(m.svc.createRecurring(owner, { name: 'x', categoryId: cat('rent').id, fundId: bank.id, cadence: 'MONTHLY', anchorDay: today, mode: 'AUTO' })).rejects.toThrow(/cố định/);
  });
});
