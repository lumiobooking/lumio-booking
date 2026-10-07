/**
 * "HẸN LẦN SAU" from the chair: the technician books her own client onto
 * herself, confirmed at once — never another technician's booking, never
 * another salon's ticket.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return { ...actual, UserRole: actual.UserRole ?? { SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF', SUPER_ADMIN: 'SUPER_ADMIN' } };
});
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BookingsService } from './bookings.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function make() {
  const created: Row[] = [];
  const prisma: Row = {
    staffMember: { findFirst: async ({ where }: Row) => (where.userId === 'u-kim' ? { id: where.tenantId === 'A' ? 'kim' : 'kim-b' } : null) },
    walkIn: { findFirst: async ({ where }: Row) => {
      if (where.tenantId !== 'A') return null;
      if (where.id === 'w1') return { customerId: 'c1', customerName: 'Mai Tran', phone: '+15125550123' };
      if (where.id === 'w2') return { customerId: null, customerName: 'Walk-in', phone: null };
      if (where.id === 'w3') return { customerId: null, customerName: 'Linh Nguyen Thi', phone: '+15125550199' };
      return null;
    } },
    appointment: { findFirst: async ({ where }: Row) => {
      if (where.tenantId !== 'A') return null;
      if (where.id === 'b1') return { customerId: 'c1', assignedStaffId: 'kim', customer: { firstName: 'Mai', lastName: 'Tran', phone: '+15125550123' } };
      if (where.id === 'b2') return { customerId: 'c2', assignedStaffId: 'lisa', customer: { firstName: 'Ann', lastName: null, phone: null } };
      return null;
    } },
  };
  const svc = Object.create(BookingsService.prototype) as BookingsService;
  (svc as unknown as Row).prisma = prisma;
  (svc as unknown as Row).create = jest.fn(async (_u: unknown, dto: Row, source: string) => { created.push({ ...dto, source }); return { id: 'new', status: 'CONFIRMED' }; });
  return { svc, created };
}
const kim = { userId: 'u-kim', tenantId: 'A', role: 'STAFF' } as never;
const kimB = { userId: 'u-kim', tenantId: 'B', role: 'STAFF' } as never;
const at = '2026-10-22T16:00:00.000Z';

describe('my rebook', () => {
  it('from her ticket: the client on file, on herself, confirmed, tagged counter', async () => {
    const { svc, created } = make();
    await svc.myRebook(kim, { walkInId: 'w1', serviceId: 'gel', startTime: at });
    expect(created[0]).toMatchObject({ staffId: 'kim', confirmNow: true, customerId: 'c1', customerFirstName: 'Mai', customerLastName: 'Tran', customerPhone: '+15125550123', serviceId: 'gel', startTime: at, source: 'counter' });
  });
  it('a ticket with only a name and phone still books (the customer record is made by phone); one with neither cannot', async () => {
    const { svc, created } = make();
    await svc.myRebook(kim, { walkInId: 'w3', serviceId: 'gel', startTime: at });
    expect(created[0]).toMatchObject({ customerFirstName: 'Linh', customerLastName: 'Nguyen Thi', customerPhone: '+15125550199' });
    expect(created[0].customerId).toBeUndefined();
    await expect(svc.myRebook(kim, { walkInId: 'w2', serviceId: 'gel', startTime: at })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('from her booking: yes; a colleague\'s booking: no; another salon\'s ticket: not found', async () => {
    const { svc, created } = make();
    await svc.myRebook(kim, { appointmentId: 'b1', serviceId: 'gel', startTime: at });
    expect(created[0]).toMatchObject({ customerId: 'c1', staffId: 'kim' });
    await expect(svc.myRebook(kim, { appointmentId: 'b2', serviceId: 'gel', startTime: at })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.myRebook(kimB, { walkInId: 'w1', serviceId: 'gel', startTime: at })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.myRebook(kim, { serviceId: 'gel', startTime: at })).rejects.toBeInstanceOf(BadRequestException);
  });
});
