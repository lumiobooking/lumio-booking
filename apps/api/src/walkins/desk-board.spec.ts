/**
 * Walk-in 2.0 — the desk's picture of the floor: the line in turn order, the
 * next booking per technician, what each one usually does, today's totals,
 * and closing a visit without a receipt (own salon only, reason kept).
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    WalkInStatus: actual.WalkInStatus ?? { WAITING: 'WAITING', SERVING: 'SERVING', DONE: 'DONE', CANCELLED: 'CANCELLED' },
  };
});
import { WalkinsService } from './walkins.service';
import { cleanCloseReason, frequentServices, nextBookingByStaff, todayTotals, turnOrder } from './desk-board';
import type { TechInfo } from './walkin-legs';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const T = (id: string, priority = 0): TechInfo => ({ id, name: id, priority, skills: [] });

describe('the line in turn order', () => {
  it('fewest turns first, then the salon priority; a technician on a break is not in the line', () => {
    const techs = [T('elena', 3), T('tai', 1), T('mimi', 2), T('eric', 0)];
    const turns = new Map([['elena', 3], ['tai', 2], ['mimi', 3], ['eric', 3]]);
    expect(turnOrder(techs, turns, {}, new Set(['mimi']))).toEqual(['tai', 'elena', 'eric']);
  });
  it('the owner outside the rotation never shows a place in it', () => {
    const techs = [T('owner', 9), T('tai')];
    expect(turnOrder(techs, new Map(), { manualOnly: new Set(['owner']) }, new Set())).toEqual(['tai']);
  });
});

describe('desk facts', () => {
  it('next booking: the earliest one still to come, per technician', () => {
    const now = new Date('2026-10-17T20:00:00Z');
    const m = nextBookingByStaff([
      { startTime: '2026-10-17T19:30:00Z', staffId: 'tino' }, // already started
      { startTime: '2026-10-17T22:45:00Z', staffId: 'tino' },
      { startTime: '2026-10-17T20:45:00Z', staffId: 'tino' },
      { startTime: '2026-10-17T21:00:00Z', staffId: null },
    ], now);
    expect(m.get('tino')).toBe('2026-10-17T20:45:00.000Z');
    expect(m.size).toBe(1);
  });

  it('what each technician usually does: by count, a line names its own technician', () => {
    const rows = [
      { assignedStaffId: 'elena', items: [{ serviceId: 'gel', staffId: 'elena' }, { serviceId: 'pedi', staffId: 'hien' }] },
      { assignedStaffId: 'elena', items: [{ serviceId: 'dip' }] },
      { assignedStaffId: 'elena', items: [{ serviceId: 'gel' }] },
      { assignedStaffId: null, items: 'broken' },
    ];
    const f = frequentServices(rows, 4);
    expect(f.elena).toEqual(['gel', 'dip']);
    expect(f.hien).toEqual(['pedi']);
  });

  it('today: count and service money; a bad reason becomes "other"', () => {
    expect(todayTotals([{ items: [{ priceCents: 4500 }, { priceCents: 1000 }] }, { items: [] }])).toEqual({ count: 2, serviceCents: 5500 });
    expect(cleanCloseReason('paid_elsewhere')).toBe('paid_elsewhere');
    expect(cleanCloseReason('<script>')).toBe('other');
  });
});

describe('closing a visit without a receipt', () => {
  function build() {
    const rows: Row[] = [
      { id: 'w1', tenantId: 't1', status: 'SERVING', awaitingPayment: true, doneAt: null, assignedStaffId: 'lan', createdAt: new Date(), assignedAt: new Date(), items: [] },
      { id: 'w2', tenantId: 't2', status: 'SERVING', awaitingPayment: true, doneAt: null, assignedStaffId: 'kim', createdAt: new Date(), assignedAt: new Date(), items: [] },
    ];
    const audits: Row[] = [];
    const prisma: Row = {
      walkIn: {
        findFirst: async ({ where }: Row) => rows.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null,
        updateMany: async ({ where, data }: Row) => {
          let count = 0;
          for (const r of rows) if (r.id === where.id && r.tenantId === where.tenantId) { Object.assign(r, data); count++; }
          return { count };
        },
      },
    };
    const svc = new WalkinsService(prisma as never, {} as never, {} as never, undefined, { log: async (a: Row) => { audits.push(a); } } as never);
    // The queue drain and the row read-back are not what is tested here.
    (svc as unknown as Row).settle = async () => undefined;
    (svc as unknown as Row).row = async (_t: string, id: string) => rows.find((r) => r.id === id);
    return { svc, rows, audits };
  }

  it('closes this salon\'s visit as done, off the till, with the reason audited', async () => {
    const { svc, rows, audits } = build();
    await svc.closeUnpaid({ userId: 'u1', tenantId: 't1', role: 'SALON_ADMIN' } as never, 'w1', 'paid_elsewhere', 'Clover');
    expect(rows[0]).toMatchObject({ status: 'DONE', awaitingPayment: false });
    expect(rows[0].doneAt).toBeInstanceOf(Date);
    expect(audits[0]).toMatchObject({ tenantId: 't1', action: 'walkin.closed_unpaid', resourceId: 'w1', metadata: { reason: 'paid_elsewhere', note: 'Clover' } });
  });

  it('another salon\'s visit is not found and stays untouched', async () => {
    const { svc, rows, audits } = build();
    await expect(svc.closeUnpaid({ userId: 'u1', tenantId: 't1', role: 'SALON_ADMIN' } as never, 'w2', 'mistake')).rejects.toThrow('Walk-in not found');
    expect(rows[1]).toMatchObject({ status: 'SERVING', awaitingPayment: true });
    expect(audits).toHaveLength(0);
  });
});
