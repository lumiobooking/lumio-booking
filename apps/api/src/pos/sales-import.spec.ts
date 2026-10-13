/**
 * Old sales brought in as ordinary paid tickets: read in the salon's own
 * currency and date order, grouped by bill, matched to the salon's own
 * technicians, never twice, never into a closed payroll, one salon only.
 */
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  OrderStatus: { OPEN: 'OPEN', PAID: 'PAID', VOID: 'VOID', REFUNDED: 'REFUNDED' },
  OrderItemKind: { SERVICE: 'SERVICE', PRODUCT: 'PRODUCT' },
  PaymentStatus: { PENDING: 'PENDING', PAID: 'PAID', FAILED: 'FAILED', REFUNDED: 'REFUNDED' },
  PaymentType: { PAY_LATER: 'PAY_LATER', ONLINE: 'ONLINE' },
}));
import { buildTickets, parseMoney, parseDay, matchStaff, summarize, split, type BuildCtx } from './sales-import';
import { SalesImportService } from './sales-import.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const STAFF = [
  { id: 's-lan', firstName: 'Lan', lastName: 'Nguyễn' },
  { id: 's-mai', firstName: 'Mai', lastName: null },
  { id: 's-anh1', firstName: 'Anh', lastName: 'Trần' },
  { id: 's-anh2', firstName: 'Anh', lastName: 'Lê' },
];
const ctx = (over: Partial<BuildCtx> = {}): BuildCtx => ({
  digits: 2, dayFirst: false, todayKey: '2026-10-13', staff: STAFF, services: [{ id: 'svc-pedi', name: 'Pedicure' }], locked: [], ...over,
});

describe('reading the file', () => {
  it('money and dates follow the salon: đồng are whole, dollars have cents; VN is day-first', () => {
    expect(parseMoney('1.250.000', 0)).toBe(1_250_000);
    expect(parseMoney('1.250.000', 2)).toBe(125_000_000); // $1,250,000.00 — the US reading of the same text
    expect(parseMoney('45.50', 2)).toBe(4550);
    expect(parseDay('05/09/2026', true)).toBe('2026-09-05');
    expect(parseDay('05/09/2026', false)).toBe('2026-05-09');
    expect(split(1000, 3)).toEqual([334, 333, 333]);
  });
  it('a name matches a technician by full name or a unique first name; a shared first name matches nobody', () => {
    expect(matchStaff('lan nguyen', STAFF)).toBe('s-lan');
    expect(matchStaff('Nguyễn Lan', STAFF)).toBe('s-lan');
    expect(matchStaff('MAI', STAFF)).toBe('s-mai');
    expect(matchStaff('Anh', STAFF)).toBeNull();
    expect(matchStaff('Anh Lê', STAFF)).toBe('s-anh2');
  });
});

describe('building bills', () => {
  it('rows sharing day + bill are one ticket; a row without a bill is its own; a count row becomes that many bills', () => {
    const r = buildTickets([
      { date: '09/14/2026', bill: '101', staff: 'Lan', item: 'Pedicure', amount: '35', tip: '5', method: 'Card', phone: '(512) 886-8189', customer: 'Jenny' },
      { date: '09/14/2026', bill: '101', staff: 'Mai', item: 'Gel polish', amount: '25', discount: '5' },
      { date: '09/15/2026', staff: 'Mai', item: 'Daily total', amount: '300', tip: '30', count: '3', method: 'cash' },
      { date: '09/15/2026', staff: 'Mai', item: 'Polish', kind: 'retail', amount: '12' },
    ], ctx());
    expect(r.errors).toEqual([]);
    expect(r.tickets).toHaveLength(5);
    const bill = r.tickets.find((t) => t.bill === '101')!;
    expect(bill).toMatchObject({ day: '2026-09-14', method: 'CARD', discount: 500, customer: 'Jenny', phone: '5128868189' });
    expect(bill.lines.map((l) => [l.staffId, l.amount, l.tip, l.serviceId])).toEqual([['s-lan', 3500, 500, 'svc-pedi'], ['s-mai', 2500, 0, null]]);
    const daily = r.tickets.filter((t) => t.lines[0].name === 'Daily total');
    expect(daily.map((t) => t.lines[0].amount)).toEqual([10000, 10000, 10000]);
    expect(new Set(daily.map((t) => t.signature)).size).toBe(3); // three distinct, stable bills
    expect(r.tickets.find((t) => t.lines[0].name === 'Polish')!.lines[0].kind).toBe('PRODUCT');
    const s = summarize(r.tickets, STAFF);
    expect(s.salesCents).toBe(3500 + 2500 - 500 + 30000 + 1200);
    expect(s.tipsCents).toBe(500 + 3000);
    expect(s.byStaff.find((x) => x.staffId === 's-mai')).toMatchObject({ tickets: 5, salesCents: 2500 + 30000 + 1200 });
  });

  it('refuses future days, closed payroll periods, bad money; reports names that match nobody', () => {
    const r = buildTickets([
      { date: '10/20/2026', staff: 'Lan', amount: '10' },
      { date: '09/03/2026', staff: 'Lan', amount: '10' },
      { date: 'yesterday', staff: 'Lan', amount: '10' },
      { date: '09/20/2026', staff: 'Lan', amount: 'abc' },
      { date: '09/20/2026', staff: 'Lan', amount: '-10' },
      { date: '09/20/2026', staff: 'Tiffany', amount: '10' },
      { date: '09/21/2026', staff: 'tiffany', amount: '20' },
    ], ctx({ locked: [{ from: '2026-09-01', to: '2026-09-07' }] }));
    expect(r.errors.map((e) => [e.row, e.reason])).toEqual([[1, 'future'], [2, 'payroll-closed'], [3, 'date'], [4, 'amount'], [5, 'amount']]);
    expect(r.lockedRows).toBe(1);
    expect(r.unknownStaff).toEqual([{ key: 'tiffany', name: 'Tiffany', rows: 2 }]);
    // Picked from the list on the entry screen: the id wins; another salon's id is ignored.
    const picked = buildTickets([
      { date: '09/20/2026', staffId: 's-anh2', amount: '10' },
      { date: '09/20/2026', staffId: 's-elsewhere', staff: 'Mai', amount: '11' },
    ], ctx());
    expect(picked.tickets.map((t) => [t.lines[0].staffId, t.lines[0].staffName])).toEqual([['s-anh2', 'Anh Lê'], ['s-mai', 'Mai']]);
    const answered = buildTickets([{ date: '09/20/2026', staff: 'Tiffany', amount: '10' }], ctx({ staffMap: { tiffany: 's-mai' } }));
    expect(answered.unknownStaff).toEqual([]);
    expect(answered.tickets[0].lines[0].staffId).toBe('s-mai');
  });
});

// ---- the service, against an in-memory salon ----
function makeDb() {
  const orders: Row[] = []; const items: Row[] = []; const tenders: Row[] = []; const payments: Row[] = []; const customers: Row[] = []; const audits: Row[] = [];
  const runs: Row[] = [];
  const startsWith = (v: unknown, w: Row) => (w && typeof w === 'object' && 'startsWith' in w ? String(v ?? '').startsWith(w.startsWith) : v === w);
  const db: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
    tenant: { findUnique: async ({ where }: Row) => ({ timezone: where.id === 't-vn' ? 'Asia/Ho_Chi_Minh' : 'America/Chicago', market: where.id === 't-vn' ? 'VN' : 'US' }) },
    staffMember: { findMany: async ({ where }: Row) => (where.tenantId === 't1' ? STAFF.slice(0, 2) : [{ id: 's-other', firstName: 'Lan', lastName: null }]) },
    service: { findMany: async () => [] },
    payrollRun: { findMany: async ({ where }: Row) => runs.filter((r) => r.tenantId === where.tenantId) },
    customer: {
      findMany: async ({ where }: Row) => customers.filter((c) => c.tenantId === where.tenantId),
      create: async ({ data }: Row) => { const c = { id: `c${customers.length + 1}`, ...data }; customers.push(c); return c; },
    },
    order: {
      findMany: async ({ where }: Row) => orders.filter((o) => o.tenantId === where.tenantId && (!where.clientRef || startsWith(o.clientRef, where.clientRef))),
      findFirst: async ({ where }: Row) => [...orders].filter((o) => o.tenantId === where.tenantId).sort((a, b) => b.orderNumber - a.orderNumber)[0] ?? null,
      create: async ({ data }: Row) => { const o = { id: `o${orders.length + 1}`, ...data }; orders.push(o); return o; },
      deleteMany: async ({ where }: Row) => { let n = 0; for (let i = orders.length - 1; i >= 0; i--) if (orders[i].tenantId === where.tenantId && where.id.in.includes(orders[i].id)) { orders.splice(i, 1); n++; } return { count: n }; },
    },
    orderItem: { createMany: async ({ data }: Row) => { items.push(...data); return { count: data.length }; } },
    orderPayment: { create: async ({ data }: Row) => { tenders.push(data); return data; } },
    payment: {
      create: async ({ data }: Row) => { payments.push(data); return data; },
      deleteMany: async ({ where }: Row) => { let n = 0; for (let i = payments.length - 1; i >= 0; i--) if (payments[i].tenantId === where.tenantId && where.providerReference.in.includes(payments[i].providerReference)) { payments.splice(i, 1); n++; } return { count: n }; },
    },
  };
  db.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  const settings: any = { getBookingRules: async (t: string) => ({ currency: t === 't-vn' ? 'VND' : 'USD' }) }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const audit: any = { log: async (e: Row) => { audits.push(e); } }; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { svc: new SalesImportService(db, audit, settings), orders, items, tenders, payments, customers, audits, runs };
}
const owner = (tenantId: string) => ({ userId: 'u1', email: 'o@x', role: 'SALON_ADMIN', tenantId }) as never;
const FILE = [
  { date: '09/14/2026', time: '2:30 PM', bill: '7', staff: 'Lan Nguyễn', item: 'Pedicure', amount: '35', tip: '6', method: 'card', phone: '512-886-8189', customer: 'Jenny Tran' },
  { date: '09/14/2026', bill: '7', staff: 'Mai', item: 'Gel', amount: '25' },
  { date: '09/15/2026', staff: 'Mai', item: 'Daily', amount: '100', count: '2', method: 'cash' },
];

describe('importing', () => {
  it('writes paid tickets on their own day, with lines, tenders and the Payment ledger; a second run adds nothing', async () => {
    const m = makeDb();
    const p = await m.svc.preview(owner('t1'), { rows: FILE });
    expect(p.summary).toMatchObject({ tickets: 3, salesCents: 16000, tipsCents: 600, firstDay: '2026-09-14', lastDay: '2026-09-15' });
    expect(m.orders).toHaveLength(0); // preview changes nothing
    const r = await m.svc.commit(owner('t1'), { rows: FILE, label: 'Sổ tháng 9' });
    expect(r).toMatchObject({ created: 3, failed: 0, duplicates: 0 });
    const bill = m.orders.find((o) => /bill 7/.test(o.note))!;
    expect(bill).toMatchObject({ tenantId: 't1', status: 'PAID', source: 'import', subtotalCents: 6000, tipCents: 600, totalCents: 6600, paidCents: 6600, customerId: 'c1' });
    expect(bill.paidAt.toISOString()).toBe('2026-09-14T19:30:00.000Z'); // 2:30 PM in Chicago (CDT)
    expect(bill.clientRef).toMatch(/^imp:[0-9a-f]+:[0-9a-f]{20}$/);
    expect(m.items.filter((i) => i.orderId === bill.id).map((i) => [i.staffMemberId, i.lineTotalCents, i.tipCents])).toEqual([['s-lan', 3500, 600], ['s-mai', 2500, 0]]);
    expect(m.tenders.find((t) => t.orderId === bill.id)).toMatchObject({ method: 'CARD', amountCents: 6600 });
    expect(m.payments.filter((x) => x.providerReference === `order:${bill.id}`)).toEqual([expect.objectContaining({ amountCents: 6600, status: 'PAID', provider: 'pos-card' })]);
    expect(m.customers[0]).toMatchObject({ tenantId: 't1', firstName: 'Jenny', lastName: 'Tran' });
    expect(m.orders.map((o) => o.orderNumber)).toEqual([1, 2, 3]);
    const again = await m.svc.commit(owner('t1'), { rows: FILE });
    expect(again).toMatchObject({ created: 0, duplicates: 3 });
    expect(m.orders).toHaveLength(3);
    expect(m.audits.map((a) => a.action)).toEqual(['pos.sales_imported', 'pos.sales_imported']);
  });

  it('a VN salon reads đồng and day-first dates', async () => {
    const m = makeDb();
    const r = await m.svc.preview(owner('t-vn'), { rows: [{ date: '05/09/2026', staff: 'Lan', amount: '250.000', tip: '20k' }] });
    expect(r.summary).toMatchObject({ salesCents: 250000, tipsCents: 20000, firstDay: '2026-09-05' });
  });

  it('refuses to write while a name matches nobody; the owner’s answer must be one of THIS salon’s technicians', async () => {
    const m = makeDb();
    const rows = [{ date: '09/14/2026', staff: 'Tiffany', amount: '20' }];
    await expect(m.svc.commit(owner('t1'), { rows })).rejects.toThrow(/match nobody/);
    // An id from another salon is treated as "leave unassigned", never accepted.
    await m.svc.commit(owner('t1'), { rows, staffMap: { Tiffany: 's-other' } });
    expect(m.items[0].staffMemberId).toBeNull();
  });

  it('one salon never sees or removes another salon’s imports; undo is refused inside a closed payroll', async () => {
    const m = makeDb();
    await m.svc.commit(owner('t1'), { rows: FILE });
    expect(await m.svc.batches(owner('t2'))).toEqual([]);
    const [b] = await m.svc.batches(owner('t1'));
    expect(b).toMatchObject({ tickets: 3, totalCents: 16600 });
    await expect(m.svc.undo(owner('t2'), b.batch)).rejects.toThrow(/Unknown import/);
    m.runs.push({ tenantId: 't1', periodFrom: '2026-09-08', periodTo: '2026-09-21' });
    await expect(m.svc.undo(owner('t1'), b.batch)).rejects.toThrow(/closed payroll/);
    m.runs.length = 0;
    expect(await m.svc.undo(owner('t1'), b.batch)).toEqual({ batch: b.batch, removed: 3 });
    expect(m.orders).toHaveLength(0);
    expect(m.payments).toHaveLength(0);
  });
});
