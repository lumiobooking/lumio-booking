jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    UserRole: actual.UserRole?.SALON_ADMIN ? actual.UserRole : { SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF', SUPER_ADMIN: 'SUPER_ADMIN' },
    AppointmentStatus: actual.AppointmentStatus?.CONFIRMED ? actual.AppointmentStatus : { PENDING: 'PENDING', ASSIGNED: 'ASSIGNED', ACCEPTED: 'ACCEPTED', CONFIRMED: 'CONFIRMED', ARRIVED: 'ARRIVED', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED', NO_SHOW: 'NO_SHOW', REJECTED: 'REJECTED' },
  };
});
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BookingsService } from './bookings.service';

/**
 * Everything a customer booked can be changed when she asks: the main service
 * itself (not only extra lines), and the note on the booking. Prices and the
 * end time follow the new service; another salon's service or booking is never
 * reachable.
 */
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const T0 = new Date('2030-03-09T17:00:00Z');
function make() {
  const appts: Row[] = [
    { id: 'b1', tenantId: 'A', status: 'CONFIRMED', serviceId: 'fill', priceCents: 6000, startTime: T0, endTime: new Date(T0.getTime() + 75 * 60_000), addons: [{ id: 'art', name: 'Nail art', priceCents: 1000, durationMinutes: 15, kind: 'service' }], assignedStaffId: null, source: 'desk', notes: null },
    { id: 'bB', tenantId: 'B', status: 'CONFIRMED', serviceId: 'x', priceCents: 1000, startTime: T0, endTime: T0, addons: [], assignedStaffId: null, source: 'desk', notes: 'B only' },
  ];
  const services: Row[] = [
    { id: 'fill', tenantId: 'A', name: 'Gel fill', priceCents: 5000, durationMinutes: 60, isActive: true, discountPercent: 0, categoryId: null },
    { id: 'full', tenantId: 'A', name: 'Full set', priceCents: 7000, durationMinutes: 90, isActive: true, discountPercent: 0, categoryId: null },
    { id: 'theirs', tenantId: 'B', name: 'Their full set', priceCents: 100, durationMinutes: 10, isActive: true, discountPercent: 0, categoryId: null },
  ];
  const svc = Object.create(BookingsService.prototype) as BookingsService;
  const audit = { log: jest.fn(async () => undefined) };
  const appointment = {
    findFirst: jest.fn(async ({ where }: Row) => appts.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null),
    updateMany: jest.fn(async ({ where, data }: Row) => {
      const hit = appts.filter((r) => r.id === where.id && r.tenantId === where.tenantId);
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
  };
  const prisma = {
    appointment,
    service: {
      findFirst: jest.fn(async ({ where }: Row) => services.find((s) => s.id === where.id && s.tenantId === where.tenantId && (where.isActive === undefined || s.isActive === where.isActive)) ?? null),
      findMany: jest.fn(async ({ where }: Row) => services.filter((s) => where.id.in.includes(s.id) && s.tenantId === where.tenantId)),
    },
    $transaction: jest.fn(async (fn: (tx: Row) => unknown) => fn({ appointment })),
  };
  Object.assign(svc as unknown as Row, {
    audit, prisma,
    promoDiscountPercent: jest.fn(async () => 0),
    getById: jest.fn(async (_u: Row, id: string) => appts.find((r) => r.id === id)),
  });
  return { svc, appts, audit };
}
const desk = (tenantId: string) => ({ userId: 'u-' + tenantId, email: 'x@y', role: 'SALON_ADMIN', tenantId }) as never;

describe('changing the main service of a booking', () => {
  it('swaps it: price and end time follow the new service, extra lines stay, audited', async () => {
    const { svc, appts, audit } = make();
    await svc.editLines(desk('A'), 'b1', { replaceMainServiceId: 'full' });
    const b = appts[0];
    expect(b.serviceId).toBe('full');
    expect(b.priceCents).toBe(7000 + 1000); // the old main's $50 out, the full set's $70 in, nail art kept
    expect((b.endTime.getTime() - T0.getTime()) / 60_000).toBe(75 - 60 + 90);
    expect(b.addons).toHaveLength(1);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'A', action: 'booking.lines_edited', metadata: expect.objectContaining({ mainFrom: 'Gel fill', mainTo: 'Full set' }) }));
  });

  it('the same service again changes nothing', async () => {
    const { svc, appts } = make();
    await svc.editLines(desk('A'), 'b1', { replaceMainServiceId: 'fill' });
    expect(appts[0]).toMatchObject({ serviceId: 'fill', priceCents: 6000 });
  });

  it('another salon\'s service is refused, and another salon\'s booking is not found (cross-tenant)', async () => {
    const { svc, appts } = make();
    await expect(svc.editLines(desk('A'), 'b1', { replaceMainServiceId: 'theirs' })).rejects.toBeInstanceOf(BadRequestException);
    expect(appts[0].serviceId).toBe('fill');
    await expect(svc.editLines(desk('A'), 'bB', { replaceMainServiceId: 'full' })).rejects.toBeInstanceOf(NotFoundException);
    expect(appts[1].serviceId).toBe('x');
  });
});

describe('the note on a booking', () => {
  it('written, trimmed, cleared — audited', async () => {
    const { svc, appts, audit } = make();
    await svc.updateNotes(desk('A'), 'b1', '  allergic to acetone  ');
    expect(appts[0].notes).toBe('allergic to acetone');
    await svc.updateNotes(desk('A'), 'b1', '   ');
    expect(appts[0].notes).toBeNull();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'A', action: 'booking.notes_edited', resourceId: 'b1' }));
  });

  it('another salon\'s booking cannot be touched (cross-tenant)', async () => {
    const { svc, appts } = make();
    await expect(svc.updateNotes(desk('A'), 'bB', 'hi')).rejects.toBeInstanceOf(NotFoundException);
    expect(appts[1].notes).toBe('B only');
  });
});
