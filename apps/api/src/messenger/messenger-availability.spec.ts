/**
 * The chat bot looks in the book before promising a time, and what it writes
 * on the calendar says where the booking came from, who the customer asked
 * for, and what they said — in the salon's own language.
 */
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  AppointmentStatus: { PENDING: 'PENDING', ASSIGNED: 'ASSIGNED', ACCEPTED: 'ACCEPTED', CONFIRMED: 'CONFIRMED', ARRIVED: 'ARRIVED', CANCELLED: 'CANCELLED' },
}));
import { MessengerService } from './messenger.service';

type Row = Record<string, any>;
const MENU = [{ id: 'gel', name: 'Gel Manicure', durationMinutes: 45 }, { id: 'pedi', name: 'Pedicure', durationMinutes: 45 }];

function make(market = 'US') {
  const created: Row[] = [];
  const prisma: any = {
    service: { findMany: async ({ where }: Row) => (where.tenantId === 't1' ? MENU.filter((m) => !where.id || where.id.in.includes(m.id)) : []) },
    staffMember: { findMany: async ({ where }: Row) => (where.tenantId === 't1' ? [{ id: 'kim', firstName: 'Kim', lastName: null, staffServices: [], workingHours: [] }] : []) },
    appointment: { findMany: async () => [], updateMany: async () => ({ count: 1 }) },
    tenant: { findUnique: async () => ({ market }) },
    messengerThread: { update: async () => ({}) },
  };
  const bookings: any = {
    createForTenant: async (tenantId: string, dto: Row) => { created.push({ tenantId, dto }); return { id: `ap${created.length}`, customerId: null, endTime: new Date(dto.startTime) }; },
    buildApptManageUrl: (id: string) => `https://x.test/a/${id}`,
    autoAssignForTenant: async () => ({}),
  };
  const settings: any = { getBookingRules: async () => ({ assignmentMode: 'manual', businessHours: Array(7).fill({ closed: false, openMinutes: 9 * 60, closeMinutes: 19 * 60 }), daysOff: [], minLeadHours: 0, maxAdvanceDays: 0, slotStepMinutes: 30 }) };
  const svc = new MessengerService(prisma, bookings, settings, {} as never, {} as never, {} as never);
  const tool = (name: string, input: Row) => (svc as unknown as { runTool: (...a: unknown[]) => Promise<string> })
    .runTool('t1', 'America/Chicago', name, input, { mode: 'booking', leadEmail: null, channel: 'messenger' });
  return { tool, created };
}

describe('chat bot: the book first, then a clear line on the calendar', () => {
  it('check_availability answers from the salon diary', async () => {
    const { tool } = make();
    expect(await tool('check_availability', { date: '2030-03-09', time: '14:00', people: [{ services: ['Gel Manicure'] }] })).toMatch(/^OPEN/);
    expect(await tool('check_availability', { date: '2030-03-09', time: '14:00', people: [{ services: ['Gel Manicure'] }, { services: ['Pedicure'] }] })).toMatch(/^NOT OPEN/);
  });

  it('the booking carries channel, phone, technician asked for and the request', async () => {
    const { tool, created } = make('VN');
    const out = await tool('create_booking', {
      customerFirstName: 'Anna', customerPhone: '0912345678', localDateTime: '2030-03-09T14:00',
      services: [{ serviceId: 'gel', serviceName: 'Gel Manicure' }, { serviceId: 'pedi', serviceName: 'Pedicure' }],
      technician: 'Kim', request: 'dị ứng acrylic',
    });
    expect(out).toMatch(/^SUCCESS/);
    expect(created[0].dto.preferredStaffId).toBe('kim');
    expect(created[0].dto.notes).toBe('💬 AI Messenger · 📞 0912345678 · Dịch vụ: Gel Manicure + Pedicure · Thợ yêu cầu: Kim\nKhách dặn: "dị ứng acrylic"');
  });

  it('a technician the salon does not have is a question back, never a booking', async () => {
    const { tool, created } = make();
    const out = await tool('create_booking', { customerFirstName: 'Anna', customerPhone: '5125551234', localDateTime: '2030-03-09T14:00', services: [{ serviceId: 'gel', serviceName: 'Gel Manicure' }], technician: 'Zoe' });
    expect(out).toMatch(/no single technician called "Zoe"/);
    expect(created).toHaveLength(0);
  });
});
