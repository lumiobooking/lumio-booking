import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CashShiftsService } from './cash-shifts.service';

/**
 * Cashier shifts: the drawer maths, the one-open-shift rule, and — because
 * this is money — that one salon can never read or close another salon's till.
 *
 * The Prisma client is a small in-memory fake keyed by tenant, so every query
 * the service makes is checked for carrying a tenantId, the way the real
 * database would silently NOT check it.
 */
type Row = Record<string, any>;

function fakeDb() {
  const shifts: Row[] = [];
  const moves: Row[] = [];
  const orders: Row[] = [];
  let n = 0;
  const id = () => `id${++n}`;
  const match = (row: Row, where: Row) => Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date) && ('gte' in v || 'lte' in v)) {
      return (!('gte' in v) || row[k] >= v.gte) && (!('lte' in v) || row[k] <= v.lte);
    }
    return row[k] === v;
  });
  const requireTenant = (where: Row) => { if (!where || typeof where.tenantId !== 'string') throw new Error(`query without tenantId: ${JSON.stringify(where)}`); };
  const prisma: any = {
    user: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, firstName: where.id === 'u1' ? 'Lan' : 'Minh', lastName: null, email: `${where.id}@x.com` })) },
    cashShift: {
      findFirst: jest.fn(async ({ where }: any) => { requireTenant(where); return shifts.find((s) => match(s, where)) ?? null; }),
      findMany: jest.fn(async ({ where }: any) => { requireTenant(where); return shifts.filter((s) => match(s, where)); }),
      create: jest.fn(async ({ data }: any) => { const s = { id: id(), openedAt: new Date(), summary: null, closedAt: null, closedByName: null, expectedCashCents: null, countedCents: null, varianceCents: null, closeNote: null, ...data }; shifts.push(s); return s; }),
      update: jest.fn(async ({ where, data }: any) => { const s = shifts.find((x) => x.id === where.id)!; Object.assign(s, data); return s; }),
    },
    cashMovement: {
      findMany: jest.fn(async ({ where }: any) => { requireTenant(where); return moves.filter((m) => match(m, where)); }),
      findFirst: jest.fn(async ({ where, include }: any) => { requireTenant(where); const m = moves.find((x) => match(x, where)); if (!m) return null; return include?.shift ? { ...m, shift: shifts.find((s) => s.id === m.shiftId) } : m; }),
      create: jest.fn(async ({ data }: any) => { const m = { id: id(), createdAt: new Date(), ...data }; moves.push(m); return m; }),
      delete: jest.fn(async ({ where }: any) => { const i = moves.findIndex((m) => m.id === where.id); moves.splice(i, 1); }),
    },
    order: {
      findMany: jest.fn(async ({ where }: any) => { requireTenant(where); return orders.filter((o) => match(o, where)); }),
    },
  };
  return { prisma, shifts, moves, orders };
}

function makeService(requireShift = false) {
  const db = fakeDb();
  const settings: any = { getPosSettings: jest.fn(async () => ({ requireShift })) };
  const audit: any = { log: jest.fn(async () => undefined) };
  const svc = new CashShiftsService(db.prisma, settings, audit);
  return { svc, ...db, audit };
}

const lan = { userId: 'u1', tenantId: 'A', role: 'SALON_ADMIN' } as any;
const minh = { userId: 'u2', tenantId: 'B', role: 'SALON_ADMIN' } as any;

describe('a cashier shift', () => {
  it('opens with a counted float, and a second open on the same till is refused', async () => {
    const { svc } = makeService();
    const r = await svc.open(lan, { openingCents: 20000, note: 'sáng' });
    expect(r.shift.status).toBe('OPEN');
    expect(r.shift.openedByName).toBe('Lan');
    expect(r.summary.expectedCashCents).toBe(20000);
    await expect(svc.open(lan, { openingCents: 1 })).rejects.toBeInstanceOf(BadRequestException);
    // Another salon opening its own till is a different drawer entirely.
    await expect(svc.open(minh, { openingCents: 5000 })).resolves.toMatchObject({ shift: { openedByName: 'Minh' } });
  });

  it('expects opening + cash sales − change + cash in − cash out, and ignores voided sales', async () => {
    const { svc, orders, shifts } = makeService();
    await svc.open(lan, { openingCents: 10000 });
    const sid = shifts[0].id;
    orders.push(
      // $50 bill, customer gave $60 cash → $10 change: drawer gains $50.
      { tenantId: 'A', shiftId: sid, status: 'PAID', totalCents: 5000, tipCents: 0, changeCents: 1000, giftCardAppliedCents: 0, tenders: [{ method: 'CASH', amountCents: 6000 }] },
      // Split: $30 card + $20 cash exact.
      { tenantId: 'A', shiftId: sid, status: 'PAID', totalCents: 5000, tipCents: 500, changeCents: 0, giftCardAppliedCents: 0, tenders: [{ method: 'CARD', amountCents: 3000 }, { method: 'CASH', amountCents: 2000 }] },
      // Card-only bill with change recorded by mistake: change must NOT touch the drawer.
      { tenantId: 'A', shiftId: sid, status: 'PAID', totalCents: 4000, tipCents: 0, changeCents: 300, giftCardAppliedCents: 0, tenders: [{ method: 'CARD', amountCents: 4000 }] },
      // Voided after payment: never counted.
      { tenantId: 'A', shiftId: sid, status: 'VOID', totalCents: 9900, tipCents: 0, changeCents: 0, giftCardAppliedCents: 0, tenders: [{ method: 'CASH', amountCents: 9900 }] },
      // Another salon's sale that somehow carries the same shift id: not ours.
      { tenantId: 'B', shiftId: sid, status: 'PAID', totalCents: 7777, tipCents: 0, changeCents: 0, giftCardAppliedCents: 0, tenders: [{ method: 'CASH', amountCents: 7777 }] },
    );
    await svc.addMovement(lan, { kind: 'OUT', amountCents: 1500, reason: 'mua nước' });
    await svc.addMovement(lan, { kind: 'IN', amountCents: 500, reason: 'đổi tiền lẻ' });
    const { summary } = await svc.current(lan);
    expect(summary!.orders).toBe(3);
    expect(summary!.revenueCents).toBe(14000);
    expect(summary!.tipsCents).toBe(500);
    expect(summary!.byMethod).toEqual({ cashCents: 8000, cardCents: 7000, otherCents: 0, giftCardCents: 0 });
    expect(summary!.changeCents).toBe(1000);
    expect(summary!.cashInCents).toBe(500);
    expect(summary!.cashOutCents).toBe(1500);
    // 10000 + 8000 − 1000 + 500 − 1500
    expect(summary!.expectedCashCents).toBe(16000);
  });

  it('refuses a movement without a reason, without an amount, or without an open shift', async () => {
    const { svc } = makeService();
    await expect(svc.addMovement(lan, { kind: 'OUT', amountCents: 100, reason: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    await svc.open(lan, { openingCents: 0 });
    await expect(svc.addMovement(lan, { kind: 'OUT', amountCents: 100, reason: '  ' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.addMovement(lan, { kind: 'OUT', amountCents: 0, reason: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.addMovement(lan, { kind: 'SIDEWAYS', amountCents: 100, reason: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('closes with the counted amount, freezes the summary, and the variance is counted − expected', async () => {
    const { svc, orders, shifts } = makeService();
    await svc.open(lan, { openingCents: 10000 });
    const sid = shifts[0].id;
    orders.push({ tenantId: 'A', shiftId: sid, status: 'PAID', totalCents: 3000, tipCents: 0, changeCents: 0, giftCardAppliedCents: 0, tenders: [{ method: 'CASH', amountCents: 3000 }] });
    const r = await svc.close(lan, { countedCents: 12500, note: 'thiếu 5$' });
    expect(r.shift.status).toBe('CLOSED');
    expect(r.shift.expectedCashCents).toBe(13000);
    expect(r.shift.countedCents).toBe(12500);
    expect(r.shift.varianceCents).toBe(-500);
    expect(r.shift.closedByName).toBe('Lan');
    // A sale voided AFTER the close does not rewrite the signed sheet.
    orders[0].status = 'VOID';
    const again = await svc.detail(lan, sid);
    expect(again.summary.expectedCashCents).toBe(13000);
    // …and the shift can no longer take movements.
    await expect(svc.addMovement(lan, { kind: 'IN', amountCents: 100, reason: 'late' })).rejects.toBeInstanceOf(BadRequestException);
    expect((await svc.current(lan)).shift).toBeNull();
  });

  it('never lets one salon see, close, or edit another salon\'s till', async () => {
    const { svc, shifts, moves } = makeService();
    await svc.open(lan, { openingCents: 10000 });
    await svc.addMovement(lan, { kind: 'OUT', amountCents: 200, reason: 'x' });
    const sid = shifts[0].id;
    // B has no open shift: A's shift is invisible to it.
    expect((await svc.current(minh)).shift).toBeNull();
    await expect(svc.detail(minh, sid)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.close(minh, { countedCents: 0 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.removeMovement(minh, moves[0].id)).rejects.toBeInstanceOf(NotFoundException);
    expect((await svc.list(minh)).length).toBe(0);
    expect((await svc.list(lan)).length).toBe(1);
    // A's own shift is still open and untouched.
    expect((await svc.current(lan)).shift?.id).toBe(sid);
    expect(moves.length).toBe(1);
  });

  it('tells the till whether a shift is required and which shift is open', async () => {
    const { svc } = makeService(true);
    expect((await svc.current(lan)).requireShift).toBe(true);
    expect(await svc.openShiftId('A')).toBeNull();
    const r = await svc.open(lan, { openingCents: 100 });
    expect(await svc.openShiftId('A')).toBe(r.shift.id);
    expect(await svc.openShiftId('B')).toBeNull();
  });
});
