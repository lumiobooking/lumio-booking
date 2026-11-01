/**
 * "Hãy làm đồng bộ cho hệ thống POS của Square" (1 Nov 2026): the salon keeps
 * checking out on Square POS; every bill paid there becomes a Lumio ticket,
 * the booking it paid for is closed, refunds follow — and one salon's Square
 * account never touches another salon's rows.
 */
import {
  buildTicket, byOrder, cleanStaffMap, isPosPayment, menuToCatalog, methodOf, pickBooking, readSettings, syncWindow,
  type Candidate, type SqOrder, type SqPayment,
} from './square-pos.logic';
import { SquarePosService } from './square-pos.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const at = (iso: string) => new Date(iso);

describe('which Square payments are read', () => {
  it('only bills rung up and finished on Square POS — never what Lumio itself charged', () => {
    expect(isPosPayment({ id: 'a', status: 'COMPLETED', application_details: { square_product: 'SQUARE_POS' } })).toBe(true);
    expect(isPosPayment({ id: 'b', status: 'COMPLETED', application_details: { square_product: 'TERMINAL_API' } })).toBe(false); // Lumio's terminal
    expect(isPosPayment({ id: 'c', status: 'COMPLETED', application_details: { square_product: 'ECOMMERCE_API' } })).toBe(false); // Lumio's deposit link
    expect(isPosPayment({ id: 'd', status: 'APPROVED', application_details: { square_product: 'SQUARE_POS' } })).toBe(false);
  });

  it('cash, card, wallet and gift card become the till’s tenders', () => {
    expect(methodOf({ id: '1', source_type: 'CASH' })).toBe('CASH');
    expect(methodOf({ id: '2', source_type: 'CARD' })).toBe('CARD');
    expect(methodOf({ id: '3', source_type: 'WALLET' })).toBe('CARD');
    expect(methodOf({ id: '4', source_type: 'CARD', card_details: { card: { card_brand: 'SQUARE_GIFT_CARD' } } })).toBe('OTHER');
    expect(methodOf({ id: '5', source_type: 'EXTERNAL' })).toBe('OTHER');
  });

  it('first run reads from the start date; later runs the last 48 hours; never more than 31 days', () => {
    const now = at('2026-11-01T20:00:00Z');
    expect(syncWindow({ since: '2026-10-30T00:00:00Z', lastOkAt: null }, now).from.toISOString()).toBe('2026-10-30T00:00:00.000Z');
    expect(syncWindow({ since: '2026-10-01T00:00:00Z', lastOkAt: '2026-11-01T19:55:00Z' }, now).from.toISOString()).toBe('2026-10-30T20:00:00.000Z');
    expect(syncWindow({ since: '2026-01-01T00:00:00Z', lastOkAt: null }, now).from.toISOString()).toBe('2026-10-01T20:00:00.000Z');
  });

  it('a split bill is one ticket', () => {
    const g = byOrder([{ id: 'p1', order_id: 'o1' }, { id: 'p2', order_id: 'o1' }, { id: 'p3', order_id: 'o2' }, { id: 'p4' }]);
    expect([...g.keys()]).toEqual(['o1', 'o2']);
    expect(g.get('o1')!.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('which booking a Square bill paid for', () => {
  const paidAt = at('2026-11-01T19:00:00Z');
  const c = (o: Partial<Candidate>): Candidate => ({ id: 'x', startTime: at('2026-11-01T18:00:00Z'), endTime: at('2026-11-01T19:00:00Z'), assignedStaffId: null, customerId: 'cu', customerPhone: null, ...o });

  it('the client on the bill has the booking’s phone', () => {
    const r = pickBooking([c({ id: 'a', customerPhone: '+17145550101' }), c({ id: 'b', customerPhone: '+17145550999' })], { phone: '(714) 555-0101', staffId: null, paidAt });
    expect(r).toEqual({ id: 'a', by: 'phone' });
  });

  it('no client on the bill: the technician’s ONE visit at that time', () => {
    expect(pickBooking([c({ id: 'a', assignedStaffId: 'kim' }), c({ id: 'b', assignedStaffId: 'lily' })], { phone: null, staffId: 'kim', paidAt })).toEqual({ id: 'a', by: 'staff' });
  });

  it('two visits for that technician, or a booking hours away: no guess', () => {
    expect(pickBooking([c({ id: 'a', assignedStaffId: 'kim' }), c({ id: 'b', assignedStaffId: 'kim' })], { phone: null, staffId: 'kim', paidAt })).toBeNull();
    expect(pickBooking([c({ id: 'a', customerPhone: '+17145550101', startTime: at('2026-11-02T01:00:00Z'), endTime: at('2026-11-02T02:00:00Z') })], { phone: '+17145550101', staffId: null, paidAt })).toBeNull();
    expect(pickBooking([], { phone: '+17145550101', staffId: 'kim', paidAt })).toBeNull();
  });
});

describe('a Square bill as a Lumio ticket', () => {
  const services = [{ id: 'gel', name: 'Gel Manicure' }, { id: 'pedi', name: 'Pedicure – Deluxe' }];
  const order: SqOrder = {
    id: 'o1', state: 'COMPLETED', closed_at: '2026-11-01T19:05:00Z',
    line_items: [
      { name: 'Gel manicure', quantity: '1', gross_sales_money: { amount: 4000 } },
      { name: 'Pedicure', variation_name: 'Deluxe', quantity: '1', base_price_money: { amount: 5500 } },
      { name: 'Cuticle oil', quantity: '2', base_price_money: { amount: 800 } },
    ],
    total_discount_money: { amount: 500 }, total_tax_money: { amount: 128 },
  };
  const pays: SqPayment[] = [
    { id: 'p1', source_type: 'CASH', total_money: { amount: 6000 }, tip_money: { amount: 0 }, created_at: '2026-11-01T19:04:00Z' },
    { id: 'p2', source_type: 'CARD', total_money: { amount: 6728 }, tip_money: { amount: 1500 }, receipt_number: 'R7Xa' },
  ];

  it('lines keep Square’s names and prices; menu names link to Lumio services', () => {
    const t = buildTicket(order, pays, { services, staffId: 'kim' });
    expect(t.lines.map((l) => [l.name, l.serviceId, l.amount])).toEqual([
      ['Gel manicure', 'gel', 4000],
      ['Pedicure · Deluxe', 'pedi', 5500],
      ['Cuticle oil', null, 1600],
    ]);
    expect(t.lines.every((l) => l.staffId === 'kim')).toBe(true);
  });

  it('the money is what was taken: tip on the technician’s first line, cash and card apart', () => {
    const t = buildTicket(order, pays, { services, staffId: 'kim' });
    expect(t).toMatchObject({ subtotal: 11100, discount: 500, tax: 128, tip: 1500, total: 12728, receipt: 'R7Xa' });
    expect(t.lines[0].tip).toBe(1500);
    expect(t.tenders).toEqual([{ method: 'CASH', amount: 6000 }, { method: 'CARD', amount: 6728 }]);
    expect(t.paidAt.toISOString()).toBe('2026-11-01T19:05:00.000Z');
  });
});

describe('settings and the menu', () => {
  it('a technician of another salon is never kept in the map', () => {
    expect(cleanStaffMap({ tm1: 'kim', tm2: 'zoe-of-t2', tm3: '', 'bad id!': 'kim' }, new Set(['kim', 'lily']))).toEqual({ tm1: 'kim', tm3: '' });
  });

  it('only services Square does not already have are sent', () => {
    const objs = menuToCatalog([{ id: 'a', name: 'Gel Manicure', priceCents: 4000 }, { id: 'b', name: 'Pedicure', priceCents: 3500 }, { id: 'c', name: 'pedicure', priceCents: 3500 }], ['GEL MANICURE'], 'USD') as Row[];
    expect(objs).toHaveLength(1);
    expect(objs[0].item_data.name).toBe('Pedicure');
    expect(objs[0].item_data.variations[0].item_variation_data.price_money).toEqual({ amount: 3500, currency: 'USD' });
  });

  it('a stored value in any shape reads as settings', () => {
    expect(readSettings(null).enabled).toBe(false);
    expect(readSettings({ enabled: true, staffMap: { a: 'kim', b: 3 }, refundsDone: ['r1', 2] })).toMatchObject({ enabled: true, staffMap: { a: 'kim' }, refundsDone: ['r1'], pushCustomers: true });
  });
});

// ---- the service, against a fake database and a fake Square ----------------

const PAID_AT = '2026-11-01T19:05:00Z';
const NOW = at('2026-11-01T20:00:00Z');

function world(opts: { locked?: boolean; squareCustomers?: string[] } = {}) {
  const db: Record<string, Row[]> = {
    setting: [
      { tenantId: 't1', key: 'square_pos_sync', value: { enabled: true, since: '2026-11-01T00:00:00Z', staffMap: { tm1: 'kim' } } },
      { tenantId: 't2', key: 'square_pos_sync', value: { enabled: true, since: '2026-11-01T00:00:00Z', staffMap: {} } },
    ],
    paymentConnection: [{ tenantId: 't1', provider: 'square', status: 'ACTIVE' }, { tenantId: 't2', provider: 'square', status: 'ACTIVE' }],
    staffMember: [{ id: 'kim', tenantId: 't1', firstName: 'Kim', isActive: true }, { id: 'zoe', tenantId: 't2', firstName: 'Zoe', isActive: true }],
    service: [{ id: 'gel', tenantId: 't1', name: 'Gel Manicure', priceCents: 4000, isActive: true }, { id: 'pedi', tenantId: 't1', name: 'Pedicure', priceCents: 3500, isActive: true }],
    tenant: [{ id: 't1', timezone: 'America/Los_Angeles', status: 'ACTIVE' }, { id: 't2', timezone: 'America/Los_Angeles', status: 'ACTIVE' }],
    payrollRun: opts.locked ? [{ tenantId: 't1', status: 'FINAL', periodFrom: '2026-10-26', periodTo: '2026-11-08' }] : [],
    appointment: [
      { id: 'a1', tenantId: 't1', status: 'CONFIRMED', startTime: at('2026-11-01T18:00:00Z'), endTime: at('2026-11-01T19:00:00Z'), assignedStaffId: 'kim', customerId: 'cu1', customer: { phone: '+17145550101', firstName: 'Anna', lastName: null } },
      { id: 'b1', tenantId: 't2', status: 'CONFIRMED', startTime: at('2026-11-01T18:00:00Z'), endTime: at('2026-11-01T19:00:00Z'), assignedStaffId: 'zoe', customerId: 'cu9', customer: { phone: '+17145550101', firstName: 'Anna', lastName: null } },
      { id: 'a2', tenantId: 't1', status: 'CONFIRMED', startTime: at('2026-11-02T17:00:00Z'), endTime: at('2026-11-02T18:00:00Z'), assignedStaffId: null, customerId: 'cu2', customer: { phone: '+17145550202', firstName: 'Bea', lastName: 'Tran' } },
    ],
    customer: [{ id: 'cu1', tenantId: 't1', phone: '+17145550101' }],
    order: [], orderItem: [], orderPayment: [], payment: [], walkIn: [{ id: 'w1', tenantId: 't1', appointmentId: 'a1', status: 'IN_SERVICE' }], auditLog: [],
  };
  const wheres: { model: string; where: Row }[] = [];
  const match = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Row[]).some((w) => match(row, w));
    if (k === 'NOT') return !match(row, v as Row);
    const val = row[k];
    if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
      const o = v as Row;
      if ('in' in o && !(o.in as unknown[]).includes(val)) return false;
      if ('notIn' in o && (o.notIn as unknown[]).includes(val)) return false;
      if ('not' in o && val === o.not) return false;
      if ('gte' in o && !(val >= o.gte)) return false;
      if ('lte' in o && !(val <= o.lte)) return false;
      if ('startsWith' in o && !String(val ?? '').startsWith(o.startsWith)) return false;
      if ('endsWith' in o && !String(val ?? '').endsWith(o.endsWith)) return false;
      if ('hasSome' in o && !(val ?? []).some((x: unknown) => (o.hasSome as unknown[]).includes(x))) return false;
      return true;
    }
    return val === v;
  });
  let seq = 0;
  const model = (name: string) => ({
    findMany: async (a: Row = {}) => { wheres.push({ model: name, where: a.where ?? {} }); return db[name].filter((r) => match(r, a.where)).slice(0, a.take ?? 1e9); },
    findFirst: async (a: Row = {}) => {
      wheres.push({ model: name, where: a.where ?? {} });
      let rows = db[name].filter((r) => match(r, a.where));
      if (a.orderBy?.orderNumber === 'desc') rows = [...rows].sort((x, y) => y.orderNumber - x.orderNumber);
      return rows[0] ?? null;
    },
    findUnique: async (a: Row) => {
      const w = a.where.tenantId_key ?? a.where.tenantId_provider ?? a.where;
      wheres.push({ model: name, where: w });
      return db[name].find((r) => match(r, w)) ?? null;
    },
    count: async (a: Row = {}) => db[name].filter((r) => match(r, a.where)).length,
    create: async (a: Row) => {
      if (name === 'order' && db.order.some((o) => o.tenantId === a.data.tenantId && o.clientRef === a.data.clientRef)) throw Object.assign(new Error('unique'), { code: 'P2002', meta: { target: ['tenantId', 'clientRef'] } });
      const row = { id: `${name}${++seq}`, ...a.data }; db[name].push(row); return row;
    },
    createMany: async (a: Row) => { for (const d of a.data) db[name].push({ id: `${name}${++seq}`, ...d }); return { count: a.data.length }; },
    updateMany: async (a: Row) => { wheres.push({ model: name, where: a.where }); let n = 0; for (const r of db[name]) if (match(r, a.where)) { Object.assign(r, a.data); n++; } return { count: n }; },
    upsert: async (a: Row) => {
      const w = a.where.tenantId_key; const r = db[name].find((x) => match(x, w));
      if (r) Object.assign(r, a.update); else db[name].push({ ...a.create });
      return r;
    },
  });
  const prisma: Row = {};
  for (const k of Object.keys(db)) prisma[k] = model(k);
  prisma.$transaction = async (fn: (tx: unknown) => unknown) => fn(prisma);

  // Square: what each salon's own account holds.
  const sq: Record<string, Row> = {
    'tok-t1': {
      payments: [
        { id: 'p1', status: 'COMPLETED', application_details: { square_product: 'SQUARE_POS' }, order_id: 'o1', customer_id: 'c1', team_member_id: 'tm1', source_type: 'CARD', total_money: { amount: 5500 }, tip_money: { amount: 1000 }, created_at: PAID_AT },
        { id: 'p2', status: 'COMPLETED', application_details: { square_product: 'TERMINAL_API' }, order_id: 'o2', source_type: 'CARD', total_money: { amount: 3000 }, created_at: PAID_AT },
        { id: 'p3', status: 'COMPLETED', application_details: { square_product: 'SQUARE_POS' }, order_id: 'o3', team_member_id: 'tm9', source_type: 'CASH', total_money: { amount: 2000 }, created_at: PAID_AT },
        { id: 'p4', status: 'COMPLETED', application_details: { square_product: 'SQUARE_POS' }, order_id: 'o3', team_member_id: 'tm9', source_type: 'CARD', total_money: { amount: 1500 }, created_at: PAID_AT },
      ],
      orders: {
        o1: { id: 'o1', state: 'COMPLETED', closed_at: PAID_AT, line_items: [{ name: 'Gel Manicure', quantity: '1', gross_sales_money: { amount: 4500 } }] },
        o3: { id: 'o3', state: 'COMPLETED', closed_at: PAID_AT, line_items: [{ name: 'Pedicure', quantity: '1', gross_sales_money: { amount: 3500 } }] },
      },
      customers: { c1: { phone_number: '+17145550101', given_name: 'Anna' } },
      refunds: [] as Row[],
      squareCustomers: opts.squareCustomers ?? [],
      created: [] as Row[],
      catalog: ['Gel Manicure'],
      upserted: [] as Row[],
    },
    'tok-t2': { payments: [], orders: {}, customers: {}, refunds: [], squareCustomers: [], created: [], catalog: [], upserted: [] },
  };
  const tokensSeen: string[] = [];
  const fetchMock = jest.fn(async (url: string, init: Row) => {
    const tok = String(init.headers.Authorization).replace('Bearer ', '');
    tokensSeen.push(tok);
    const acct = sq[tok];
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : {};
    let json: Row = {};
    if (u.pathname === '/v2/locations') json = { locations: [{ id: 'L1', currency: 'USD', status: 'ACTIVE' }] };
    else if (u.pathname === '/v2/payments') json = { payments: acct.payments };
    else if (u.pathname.startsWith('/v2/payments/')) json = { payment: acct.payments.find((p: Row) => p.id === u.pathname.split('/').pop()) };
    else if (u.pathname === '/v2/orders/batch-retrieve') json = { orders: body.order_ids.map((id: string) => acct.orders[id]).filter(Boolean) };
    else if (u.pathname.startsWith('/v2/customers/') && init.method === 'GET') json = { customer: acct.customers[u.pathname.split('/').pop()!] };
    else if (u.pathname === '/v2/customers/search') json = { customers: acct.squareCustomers.includes(body.query.filter.phone_number.exact) ? [{ id: 'x' }] : [] };
    else if (u.pathname === '/v2/customers') { acct.created.push(body); json = { customer: { id: 'new' } }; }
    else if (u.pathname === '/v2/refunds') json = { refunds: acct.refunds };
    else if (u.pathname === '/v2/team-members/search') json = { team_members: [{ id: 'tm1', given_name: 'Kim' }] };
    else if (u.pathname === '/v2/catalog/list') json = { objects: acct.catalog.map((n: string) => ({ item_data: { name: n } })) };
    else if (u.pathname === '/v2/catalog/batch-upsert') { acct.upserted.push(...body.batches[0].objects); json = {}; }
    return { status: 200, text: async () => JSON.stringify(json) };
  });
  const creds = { loadCred: async (tenantId: string) => ({ secret: `tok-${tenantId}` }) };
  const audit = { log: async (a: Row) => { db.auditLog.push(a); } };
  const svc = new SquarePosService(prisma as never, creds as never, audit as never);
  return { svc, db, sq, wheres, tokensSeen, fetchMock };
}

describe('SquarePosService — a sync run', () => {
  let fetchSpy: jest.SpyInstance;
  let w: ReturnType<typeof world>;
  const start = (o?: Parameters<typeof world>[0]) => { w = world(o); fetchSpy = jest.spyOn(globalThis, 'fetch' as never).mockImplementation(w.fetchMock as never); return w; };
  afterEach(() => fetchSpy?.mockRestore());

  it('bills paid on Square POS become paid tickets; Lumio’s own terminal charge is not read twice', async () => {
    const { svc, db } = start();
    const r = await svc.syncTenant('t1', null, NOW);
    expect(r).toMatchObject({ imported: 2, matched: 1 });
    expect(db.order.map((o) => o.clientRef).sort()).toEqual(['sq:o1', 'sq:o3']);
    expect(db.order.every((o) => o.tenantId === 't1' && o.source === 'square' && o.status === 'PAID')).toBe(true);
    // the split bill: one ticket, cash and card apart, in the ledger the dashboard reads
    const o3 = db.order.find((o) => o.clientRef === 'sq:o3')!;
    expect(db.orderPayment.filter((p) => p.orderId === o3.id).map((p) => [p.method, p.amountCents])).toEqual([['CASH', 2000], ['CARD', 1500]]);
    expect(db.payment.filter((p) => p.providerReference === `order:${o3.id}`).map((p) => p.provider)).toEqual(['pos-cash', 'pos-card']);
  });

  it('the booking it paid for is done: linked, completed, its floor ticket closed, the tip on its technician', async () => {
    const { svc, db } = start();
    await svc.syncTenant('t1', null, NOW);
    const o1 = db.order.find((o) => o.clientRef === 'sq:o1')!;
    expect(o1).toMatchObject({ appointmentId: 'a1', appointmentIds: ['a1'], customerId: 'cu1', tipCents: 1000, totalCents: 5500 });
    expect(db.appointment.find((a) => a.id === 'a1')!.status).toBe('COMPLETED');
    expect(db.walkIn.find((x) => x.id === 'w1')!.status).toBe('DONE');
    const line = db.orderItem.find((i) => i.orderId === o1.id)!;
    expect(line).toMatchObject({ serviceId: 'gel', staffMemberId: 'kim', tipCents: 1000, lineTotalCents: 4500 });
    // the unmapped Square team member: an unassigned sale, no booking guessed
    const o3 = db.order.find((o) => o.clientRef === 'sq:o3')!;
    expect(o3.appointmentId).toBeNull();
    expect(db.orderItem.find((i) => i.orderId === o3.id)!.staffMemberId).toBeNull();
  });

  it('running again adds nothing', async () => {
    const { svc, db } = start();
    await svc.syncTenant('t1', null, NOW);
    const r = await svc.syncTenant('t1', null, new Date(NOW.getTime() + 300_000));
    expect(r.imported).toBe(0);
    expect(db.order).toHaveLength(2);
    expect(db.payment.filter((p) => p.amountCents > 0)).toHaveLength(3);
  });

  it('one salon’s run reads only its own Square account and touches only its own rows', async () => {
    const { svc, db, wheres, tokensSeen } = start();
    await svc.syncTenant('t1', null, NOW);
    expect(new Set(tokensSeen)).toEqual(new Set(['tok-t1']));
    for (const q of wheres) expect(q.where.tenantId ?? 't1').toBe('t1');
    // the other salon's client with the same phone, same time: untouched
    expect(db.appointment.find((a) => a.id === 'b1')!.status).toBe('CONFIRMED');
    // and the other salon's own run finds nothing of the first salon's
    await svc.syncTenant('t2', null, NOW);
    expect(db.order.filter((o) => o.tenantId === 't2')).toHaveLength(0);
  });

  it('a bill on a day inside a closed payroll is left out', async () => {
    const { svc, db } = start({ locked: true });
    const r = await svc.syncTenant('t1', null, NOW);
    expect(r).toMatchObject({ imported: 0, skipped: 2 });
    expect(db.order).toHaveLength(0);
  });

  it('a refund made on Square comes off the takings once', async () => {
    const { svc, db, sq } = start();
    await svc.syncTenant('t1', null, NOW);
    sq['tok-t1'].refunds.push({ id: 'rf1', status: 'COMPLETED', payment_id: 'p1', amount_money: { amount: 2000 }, created_at: '2026-11-01T19:30:00Z' });
    expect((await svc.syncTenant('t1', null, new Date(NOW.getTime() + 60_000))).refunds).toBe(1);
    expect((await svc.syncTenant('t1', null, new Date(NOW.getTime() + 120_000))).refunds).toBe(0);
    const o1 = db.order.find((o) => o.clientRef === 'sq:o1')!;
    expect(db.payment.filter((p) => p.amountCents < 0)).toEqual([expect.objectContaining({ tenantId: 't1', amountCents: -2000, providerReference: `order:${o1.id}`, provider: 'pos-card' })]);
  });

  it('upcoming clients are added to Square’s customer list once — not when Square already has them', async () => {
    const { svc, sq } = start({ squareCustomers: ['+17145550101'] });
    const r = await svc.syncTenant('t1', null, at('2026-11-02T08:00:00Z'));
    expect(r.customers).toBe(1);
    expect(sq['tok-t1'].created).toEqual([expect.objectContaining({ phone_number: '+17145550202', given_name: 'Bea', family_name: 'Tran' })]);
    await svc.syncTenant('t1', null, at('2026-11-02T08:05:00Z'));
    expect(sq['tok-t1'].created).toHaveLength(1);
  });
});

describe('SquarePosService — the owner’s screen', () => {
  let fetchSpy: jest.SpyInstance;
  afterEach(() => fetchSpy?.mockRestore());
  const owner = (tenantId: string) => ({ userId: `u-${tenantId}`, role: 'SALON_ADMIN', tenantId }) as never;

  it('a technician of another salon cannot be mapped; the start date is at most 31 days back', async () => {
    const w = world();
    fetchSpy = jest.spyOn(globalThis, 'fetch' as never).mockImplementation(w.fetchMock as never);
    await w.svc.update(owner('t1'), { staffMap: { tm1: 'kim', tm2: 'zoe' } });
    expect(w.db.setting.find((s) => s.tenantId === 't1')!.value.staffMap).toEqual({ tm1: 'kim' });
    await expect(w.svc.update(owner('t1'), { since: '2026-01-01T00:00:00Z' })).rejects.toThrow(/31 days/);
    expect(w.db.auditLog.some((a) => a.action === 'square_pos.settings_updated' && a.tenantId === 't1')).toBe(true);
  });

  it('cannot be turned on before Square is connected', async () => {
    const w = world();
    w.db.paymentConnection = w.db.paymentConnection.filter((c) => c.tenantId !== 't1');
    await expect(w.svc.update(owner('t1'), { enabled: true })).rejects.toThrow(/Connect Square/);
  });

  it('sends only the menu items Square does not have yet', async () => {
    const w = world();
    fetchSpy = jest.spyOn(globalThis, 'fetch' as never).mockImplementation(w.fetchMock as never);
    const r = await w.svc.pushMenu(owner('t1'));
    expect(r).toEqual({ added: 1, alreadyThere: 1 });
    expect(w.sq['tok-t1'].upserted.map((o: Row) => o.item_data.name)).toEqual(['Pedicure']);
    expect(w.sq['tok-t2'].upserted).toHaveLength(0);
  });
});
