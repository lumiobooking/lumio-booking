jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    AppointmentStatus: actual.AppointmentStatus?.CONFIRMED ? actual.AppointmentStatus : { PENDING: 'PENDING', ASSIGNED: 'ASSIGNED', ACCEPTED: 'ACCEPTED', CONFIRMED: 'CONFIRMED', ARRIVED: 'ARRIVED', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED', NO_SHOW: 'NO_SHOW', REJECTED: 'REJECTED' },
  };
});
import { BookingsService } from './bookings.service';
import { shouldConfirmOnCreate } from './auto-confirm';
import { DEFAULT_BOOKING_RULES } from '../settings/settings.constants';

/**
 * "Áp dụng tự động confirm cho tất cả các tiệm khi khách book… và cho phép
 * tắt khi tiệm nào không cần" (4 Nov 2026). A booking a customer makes is
 * CONFIRMED on the spot unless that salon switched it off; one salon's switch
 * never decides another salon's bookings.
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function make(rows: Row[], rulesByTenant: Record<string, Row | null>) {
  const svc = Object.create(BookingsService.prototype) as BookingsService;
  const asked: string[] = [];
  Object.assign(svc as unknown as Row, {
    logger: { warn: jest.fn(), log: jest.fn() },
    settings: {
      getBookingRules: jest.fn(async (tenantId: string) => {
        asked.push(tenantId);
        const r = rulesByTenant[tenantId];
        if (r === null) throw new Error('db down');
        return { ...DEFAULT_BOOKING_RULES, ...(r ?? {}) };
      }),
    },
    prisma: {
      appointment: {
        updateMany: jest.fn(async ({ where, data }: Row) => {
          const hit = rows.filter((r) => r.id === where.id && r.tenantId === where.tenantId && where.status.in.includes(r.status));
          hit.forEach((r) => Object.assign(r, data));
          return { count: hit.length };
        }),
        findFirst: jest.fn(async ({ where }: Row) => rows.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null),
      },
    },
  });
  const confirm = (tenantId: string, id: string) => {
    const r = rows.find((x) => x.id === id)!;
    return (svc as unknown as { confirmDeskBooking: (t: string, b: Row, o?: Row) => Promise<Row | null> }).confirmDeskBooking(tenantId, r, { customer: true });
  };
  return { confirm, asked };
}

describe('the rule', () => {
  it('on for every salon by default', () => {
    expect(DEFAULT_BOOKING_RULES.autoConfirm).toBe(true);
    // A salon whose saved rules predate the switch has no autoConfirm key: on.
    expect(shouldConfirmOnCreate({ customer: true, status: 'PENDING', hasStaff: false, rules: { staffMustAccept: false } })).toBe(true);
  });
  it('off → the customer\'s booking waits for the desk; the desk\'s own bookings are still confirmed', () => {
    const rules = { autoConfirm: false };
    expect(shouldConfirmOnCreate({ customer: true, status: 'ASSIGNED', hasStaff: true, rules })).toBe(false);
    expect(shouldConfirmOnCreate({ customer: false, status: 'ASSIGNED', hasStaff: true, rules })).toBe(true);
  });
  it('technicians must accept → a booking with a technician waits for them; one without is confirmed', () => {
    const rules = { autoConfirm: true, staffMustAccept: true };
    expect(shouldConfirmOnCreate({ customer: true, status: 'ASSIGNED', hasStaff: true, rules })).toBe(false);
    expect(shouldConfirmOnCreate({ customer: true, status: 'PENDING', hasStaff: false, rules })).toBe(true);
  });
  it('only a waiting booking moves', () => {
    for (const status of ['ACCEPTED', 'CONFIRMED', 'ARRIVED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'REJECTED']) {
      expect(shouldConfirmOnCreate({ customer: true, status, hasStaff: false, rules: { autoConfirm: true } })).toBe(false);
    }
  });
  it('rules unreadable → left for the desk (the switch may be off)', () => {
    expect(shouldConfirmOnCreate({ customer: true, status: 'PENDING', hasStaff: false, rules: null })).toBe(false);
  });
});

describe('a customer\'s booking, per salon', () => {
  it('switch on → CONFIRMED, but the customer has not confirmed (her reminder still asks)', async () => {
    const rows = [{ id: 'a1', tenantId: 'A', status: 'ASSIGNED', assignedStaffId: 'lisa', responseDeadline: new Date() }];
    const r = await make(rows, { A: {} }).confirm('A', 'a1');
    expect(r?.status).toBe('CONFIRMED');
    expect(rows[0].confirmedAt).toBeInstanceOf(Date);
    expect(rows[0].customerConfirmedAt).toBeUndefined();
    expect(rows[0].responseDeadline).toBeNull();
  });
  it('switch off → stays in "Cần xác nhận"', async () => {
    const rows = [{ id: 'a1', tenantId: 'A', status: 'PENDING', assignedStaffId: null }];
    expect(await make(rows, { A: { autoConfirm: false } }).confirm('A', 'a1')).toBeNull();
    expect(rows[0].status).toBe('PENDING');
  });
  it('cross-tenant: salon B turning it off does not stop salon A, and A\'s switch is read from A only', async () => {
    const rows = [
      { id: 'a1', tenantId: 'A', status: 'PENDING', assignedStaffId: null },
      { id: 'b1', tenantId: 'B', status: 'PENDING', assignedStaffId: null },
    ];
    const { confirm, asked } = make(rows, { A: { autoConfirm: true }, B: { autoConfirm: false } });
    expect((await confirm('A', 'a1'))?.status).toBe('CONFIRMED');
    expect(await confirm('B', 'b1')).toBeNull();
    expect(asked).toEqual(['A', 'B']);
    expect(rows.map((r) => r.status)).toEqual(['CONFIRMED', 'PENDING']);
  });
  it('cross-tenant: salon A cannot confirm salon B\'s booking', async () => {
    const rows = [{ id: 'b1', tenantId: 'B', status: 'PENDING', assignedStaffId: null }];
    expect(await make(rows, { A: {}, B: { autoConfirm: false } }).confirm('A', 'b1')).toBeNull();
    expect(rows[0].status).toBe('PENDING');
  });
  it('settings read fails → nothing moves', async () => {
    const rows = [{ id: 'a1', tenantId: 'A', status: 'PENDING', assignedStaffId: null }];
    expect(await make(rows, { A: null }).confirm('A', 'a1')).toBeNull();
    expect(rows[0].status).toBe('PENDING');
  });
});
