jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    AppointmentStatus: actual.AppointmentStatus?.CONFIRMED ? actual.AppointmentStatus : { PENDING: 'PENDING', ASSIGNED: 'ASSIGNED', ACCEPTED: 'ACCEPTED', CONFIRMED: 'CONFIRMED', ARRIVED: 'ARRIVED', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED', NO_SHOW: 'NO_SHOW', REJECTED: 'REJECTED' },
  };
});
import { BookingsService } from './bookings.service';

/**
 * "Khách đã gọi điện rồi, sao còn phải xác nhận lần nữa?" A booking the salon
 * makes itself — on the phone or at the counter — is CONFIRMED the moment it
 * exists. Online / bot bookings keep the salon's confirm step. A salon that
 * has its technicians accept in the app keeps that step for a booking with a
 * technician. Every write is fenced to the salon's own id.
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function make(rows: Row[], staffMustAccept = false) {
  const svc = Object.create(BookingsService.prototype) as BookingsService;
  const writes: Row[] = [];
  Object.assign(svc as unknown as Row, {
    logger: { warn: jest.fn(), log: jest.fn() },
    settings: { getBookingRules: jest.fn(async () => ({ staffMustAccept })) },
    prisma: {
      appointment: {
        updateMany: jest.fn(async ({ where, data }: Row) => {
          writes.push(where);
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
    return (svc as unknown as { confirmDeskBooking: (t: string, b: Row) => Promise<Row | null> }).confirmDeskBooking(tenantId, r);
  };
  return { svc, confirm, writes };
}

describe('a booking the salon makes itself is confirmed on the spot', () => {
  it('ASSIGNED (a technician picked or auto-assigned) → CONFIRMED, customer counted as confirmed, no accept deadline', async () => {
    const rows = [{ id: 'a1', tenantId: 'A', status: 'ASSIGNED', assignedStaffId: 'lisa', responseDeadline: new Date() }];
    const { confirm } = make(rows);
    const r = await confirm('A', 'a1');
    expect(r?.status).toBe('CONFIRMED');
    expect(rows[0].confirmedAt).toBeInstanceOf(Date);
    expect(rows[0].customerConfirmedAt).toBeInstanceOf(Date);
    expect(rows[0].responseDeadline).toBeNull();
  });

  it('PENDING with no technician yet → CONFIRMED too (the customer already agreed)', async () => {
    const rows = [{ id: 'a1', tenantId: 'A', status: 'PENDING', assignedStaffId: null }];
    expect((await make(rows).confirm('A', 'a1'))?.status).toBe('CONFIRMED');
  });

  it('a salon whose technicians must accept keeps that step when a technician is on it', async () => {
    const rows = [{ id: 'a1', tenantId: 'A', status: 'ASSIGNED', assignedStaffId: 'lisa' }];
    expect(await make(rows, true).confirm('A', 'a1')).toBeNull();
    expect(rows[0].status).toBe('ASSIGNED');
  });

  it('never touches a booking that already moved on (arrived, cancelled…)', async () => {
    const rows = [{ id: 'a1', tenantId: 'A', status: 'ARRIVED', assignedStaffId: 'lisa' }, { id: 'a2', tenantId: 'A', status: 'CANCELLED', assignedStaffId: null }];
    const { confirm } = make(rows);
    expect(await confirm('A', 'a1')).toBeNull();
    expect(await confirm('A', 'a2')).toBeNull();
    expect(rows.map((r) => r.status)).toEqual(['ARRIVED', 'CANCELLED']);
  });

  it('cross-tenant: salon B cannot confirm salon A’s booking, and every write carries the tenant', async () => {
    const rows = [{ id: 'a1', tenantId: 'A', status: 'PENDING', assignedStaffId: null }];
    const { confirm, writes } = make(rows);
    expect(await confirm('B', 'a1')).toBeNull();
    expect(rows[0].status).toBe('PENDING');
    expect(writes.every((w) => w.tenantId === 'B')).toBe(true);
  });

  it('the desk path asks for it; nothing else does', async () => {
    const svc = Object.create(BookingsService.prototype) as BookingsService;
    Object.assign(svc as unknown as Row, { tenantId: () => 'A' });
    const spy = jest.spyOn(svc, 'createForTenant').mockResolvedValue({ id: 'x' } as never);
    await svc.create({ userId: 'u', email: 'd@x', role: 'SALON_ADMIN', tenantId: 'A' } as never, { serviceId: 's', startTime: '2099-01-01T15:00:00Z', customerFirstName: 'Viet', staffId: 'lisa' } as never);
    expect(spy.mock.calls[0][5]).toMatchObject({ deskConfirm: true });
  });
});
