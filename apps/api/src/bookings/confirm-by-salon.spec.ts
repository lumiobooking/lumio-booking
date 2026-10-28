jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    UserRole: actual.UserRole?.SALON_ADMIN ? actual.UserRole : { SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF', SUPER_ADMIN: 'SUPER_ADMIN' },
    AppointmentStatus: actual.AppointmentStatus?.CONFIRMED ? actual.AppointmentStatus : { PENDING: 'PENDING', ASSIGNED: 'ASSIGNED', ACCEPTED: 'ACCEPTED', CONFIRMED: 'CONFIRMED', ARRIVED: 'ARRIVED', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED', NO_SHOW: 'NO_SHOW', REJECTED: 'REJECTED' },
  };
});
import { NotFoundException } from '@nestjs/common';
import { BookingsService } from './bookings.service';

/**
 * "Xác nhận" in the header's booking inbox: the salon says yes to a booking a
 * customer made online. Only that salon's booking, only while it waits.
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function make(rows: Row[]) {
  const svc = Object.create(BookingsService.prototype) as BookingsService;
  const audit = { log: jest.fn(async () => undefined) };
  const writes: Row[] = [];
  Object.assign(svc as unknown as Row, {
    audit,
    getById: jest.fn(async (_u: Row, id: string) => rows.find((r) => r.id === id)),
    prisma: {
      appointment: {
        findFirst: jest.fn(async ({ where }: Row) => rows.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null),
        updateMany: jest.fn(async ({ where, data }: Row) => {
          writes.push(where);
          const hit = rows.filter((r) => r.id === where.id && r.tenantId === where.tenantId && where.status.in.includes(r.status));
          hit.forEach((r) => Object.assign(r, data));
          return { count: hit.length };
        }),
      },
    },
  });
  return { svc, audit, writes };
}
const desk = (tenantId: string) => ({ userId: 'u-' + tenantId, email: 'x@y', role: 'SALON_ADMIN', tenantId }) as never;

describe('the salon confirms a customer booking from the header', () => {
  it('PENDING → CONFIRMED with confirmedAt, no accept deadline, audited', async () => {
    const rows = [{ id: 'b1', tenantId: 'A', status: 'PENDING', responseDeadline: new Date() }];
    const { svc, audit } = make(rows);
    await svc.confirmBySalon(desk('A'), 'b1');
    expect(rows[0].status).toBe('CONFIRMED');
    expect(rows[0].confirmedAt).toBeInstanceOf(Date);
    expect(rows[0].responseDeadline).toBeNull();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'A', action: 'booking.confirmed_by_salon', resourceId: 'b1' }));
  });

  it('a technician said no (REJECTED) — the desk can still say yes', async () => {
    const rows = [{ id: 'b1', tenantId: 'A', status: 'REJECTED' }];
    await make(rows).svc.confirmBySalon(desk('A'), 'b1');
    expect(rows[0].status).toBe('CONFIRMED');
  });

  it('a cancelled or finished booking is left as it is', async () => {
    const rows = [{ id: 'b1', tenantId: 'A', status: 'CANCELLED' }, { id: 'b2', tenantId: 'A', status: 'COMPLETED' }];
    const { svc, writes, audit } = make(rows);
    await svc.confirmBySalon(desk('A'), 'b1');
    await svc.confirmBySalon(desk('A'), 'b2');
    expect(rows.map((r) => r.status)).toEqual(['CANCELLED', 'COMPLETED']);
    expect(writes).toHaveLength(0);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('cross-tenant: salon B cannot confirm salon A\'s booking', async () => {
    const rows = [{ id: 'b1', tenantId: 'A', status: 'PENDING' }];
    const { svc, writes } = make(rows);
    await expect(svc.confirmBySalon(desk('B'), 'b1')).rejects.toBeInstanceOf(NotFoundException);
    expect(rows[0].status).toBe('PENDING');
    expect(writes).toHaveLength(0);
  });
});
