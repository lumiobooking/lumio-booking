/**
 * Undoing the response-deadline sweep (Oct 4 → fix): the NO_RESPONSE marks it
 * wrote are removed and the upcoming bookings it left empty are staffed again
 * — only in salons that never asked technicians to tap Accept, each salon's
 * rows only.
 */
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  AppointmentStatus: { PENDING: 'PENDING', ASSIGNED: 'ASSIGNED', ACCEPTED: 'ACCEPTED', CONFIRMED: 'CONFIRMED' },
  RejectionType: { REJECTED: 'REJECTED', NO_RESPONSE: 'NO_RESPONSE' },
}));
import { BookingsService } from './bookings.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const NOW = new Date('2026-10-09T03:00:00Z');

function make(rules: Record<string, Row>) {
  const marks: Row[] = [
    { id: 'm1', tenantId: 'auto', appointmentId: 'a1', type: 'NO_RESPONSE', createdAt: new Date('2026-10-06T00:00:00Z') },
    { id: 'm2', tenantId: 'auto', appointmentId: 'a2', type: 'NO_RESPONSE', createdAt: new Date('2026-10-06T00:00:00Z') },
    { id: 'm3', tenantId: 'accept', appointmentId: 'b1', type: 'NO_RESPONSE', createdAt: new Date('2026-10-06T00:00:00Z') },
    { id: 'm4', tenantId: 'manual', appointmentId: 'c1', type: 'NO_RESPONSE', createdAt: new Date('2026-10-06T00:00:00Z') },
  ];
  const appts: Row[] = [
    { id: 'a1', tenantId: 'auto', assignedStaffId: null, status: 'PENDING', startTime: new Date('2026-10-12T19:00:00Z') },
    { id: 'a2', tenantId: 'auto', assignedStaffId: null, status: 'PENDING', startTime: new Date('2026-10-01T19:00:00Z') }, // past
    { id: 'c1', tenantId: 'manual', assignedStaffId: null, status: 'PENDING', startTime: new Date('2026-10-12T19:00:00Z') },
  ];
  const engine: Row[] = [];
  const prisma: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
    bookingRejection: {
      findMany: async () => marks.filter((m) => m.type === 'NO_RESPONSE'),
      deleteMany: async ({ where }: Row) => {
        const hit = marks.filter((m) => m.tenantId === where.tenantId && where.id.in.includes(m.id));
        for (const m of hit) marks.splice(marks.indexOf(m), 1);
        return { count: hit.length };
      },
    },
    appointment: {
      findMany: async ({ where }: Row) => appts.filter((a) => a.tenantId === where.tenantId && where.id.in.includes(a.id)
        && a.assignedStaffId === null && a.status === where.status && a.startTime > where.startTime.gt).map((a) => ({ id: a.id })),
    },
  };
  const svc = Object.create(BookingsService.prototype) as BookingsService & Row;
  svc.prisma = prisma;
  svc.logger = { warn: () => undefined, log: () => undefined };
  svc.settings = { getBookingRules: async (t: string) => rules[t] };
  svc.autoAssignForTenant = async (tenantId: string, id: string) => { engine.push({ tenantId, id }); return { reassigned: true }; };
  return { svc, marks, engine };
}

describe('repairing the assignments the deadline sweep removed', () => {
  it('clears the marks and re-staffs upcoming bookings, salon by salon, honouring each salon’s rules', async () => {
    const { svc, marks, engine } = make({
      auto: { staffMustAccept: false, assignmentMode: 'auto' },
      accept: { staffMustAccept: true, assignmentMode: 'auto' },
      manual: { staffMustAccept: false, assignmentMode: 'none' },
    });
    const r = await svc.repairStrippedAssignments(NOW);
    expect(r).toEqual({ tenants: 3, cleared: 3, restaffed: 1 });
    expect(marks.map((m) => m.id)).toEqual(['m3']); // the salon that asks for Accept keeps its marks
    expect(engine).toEqual([{ tenantId: 'auto', id: 'a1' }]); // not the past one, not the manual salon
  });
});
