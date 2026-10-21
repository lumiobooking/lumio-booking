/**
 * The technician's own walk-ins and till sales (WalkinsService.myVisits).
 *
 * "Khách walk-in, hoặc tính tiền ở POS thì bên thợ không hiện dịch vụ": her
 * app listed only appointments. Now her day lists the tickets she worked and
 * the sales credited to her — her lines and her money only, each visit once,
 * and never anything of another salon.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    WalkInStatus: actual.WalkInStatus ?? { WAITING: 'WAITING', SERVING: 'SERVING', DONE: 'DONE', CANCELLED: 'CANCELLED' },
    AppointmentStatus: actual.AppointmentStatus ?? { COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED' },
  };
});
import { WalkinsService } from './walkins.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const T0 = new Date('2026-10-20T05:00:00Z');
const at = (h: number) => new Date(T0.getTime() + h * 3600_000);

const WALKINS: Row[] = [
  // Anna: Linh did hands (+ nail art), Kim did feet. Paid at the till.
  { id: 'w1', tenantId: 't1', customerName: 'Anna', status: 'DONE', createdAt: at(4), assignedAt: at(4), doneAt: at(5), awaitingPayment: false, assignedStaffId: 'linh', appointmentId: null,
    items: [
      { lineId: 'a', serviceId: 's-mani', name: 'Gel Manicure', priceCents: 3500, staffId: 'linh', legId: 'L1' },
      { lineId: 'b', serviceId: 'x-art', name: 'Nail art', priceCents: 1000, staffId: 'linh', legId: 'L1', kind: 'addon' },
      { lineId: 'c', serviceId: 's-pedi', name: 'Pedicure', priceCents: 4000, staffId: 'kim', legId: 'L2' },
    ] },
  // Bao: in Linh's chair right now.
  { id: 'w2', tenantId: 't1', customerName: 'Bao', status: 'SERVING', createdAt: at(6), assignedAt: at(6), doneAt: null, awaitingPayment: false, assignedStaffId: 'linh', appointmentId: null,
    items: [{ lineId: 'd', serviceId: 's-pedi', name: 'Pedicure', priceCents: 4000, staffId: 'linh', legId: 'L3' }] },
  // Kim's only — not Linh's.
  { id: 'w3', tenantId: 't1', customerName: 'Chi', status: 'DONE', createdAt: at(5), assignedAt: at(5), doneAt: at(6), awaitingPayment: false, assignedStaffId: 'kim', appointmentId: null,
    items: [{ lineId: 'e', serviceId: 's-mani', name: 'Manicure', priceCents: 2000, staffId: 'kim', legId: 'L4' }] },
  // Linh's own booking checked in: it is already in her calendar.
  { id: 'w4', tenantId: 't1', customerName: 'Dung', status: 'DONE', createdAt: at(7), assignedAt: at(7), doneAt: at(8), awaitingPayment: false, assignedStaffId: 'linh', appointmentId: 'ap-linh',
    items: [{ lineId: 'f', serviceId: 's-mani', name: 'Manicure', priceCents: 2000, staffId: 'linh', legId: 'L5' }] },
  // Another salon's ticket with a staff id that collides.
  { id: 'w9', tenantId: 't2', customerName: 'Other', status: 'DONE', createdAt: at(4), assignedAt: at(4), doneAt: at(5), assignedStaffId: 'linh', appointmentId: null,
    items: [{ lineId: 'z', serviceId: 's-x', name: 'Other salon', priceCents: 9900, staffId: 'linh', legId: 'Z' }] },
];
const ORDERS: Row[] = [
  // Anna's ticket settled: Linh's tip $7, Kim's tip $5.
  { id: 'o1', tenantId: 't1', status: 'PAID', paidAt: at(5), customerId: 'c-anna', walkInId: 'w1', walkInIds: [], appointmentId: null, appointmentIds: [],
    items: [
      { kind: 'SERVICE', name: 'Gel Manicure', lineTotalCents: 3500, tipCents: 700, quantity: 1, staffMemberId: 'linh', serviceId: 's-mani', walkInId: 'w1', guestName: null },
      { kind: 'SERVICE', name: 'Nail art', lineTotalCents: 1000, tipCents: 0, quantity: 1, staffMemberId: 'linh', serviceId: null, walkInId: 'w1', guestName: null },
      { kind: 'SERVICE', name: 'Pedicure', lineTotalCents: 4000, tipCents: 500, quantity: 1, staffMemberId: 'kim', serviceId: 's-pedi', walkInId: 'w1', guestName: null },
    ] },
  // A sale rung up straight at the till — no ticket, no booking.
  { id: 'o2', tenantId: 't1', status: 'PAID', paidAt: at(9), customerId: 'c-em', walkInId: null, walkInIds: [], appointmentId: null, appointmentIds: [],
    items: [
      { kind: 'SERVICE', name: 'Eyebrows', lineTotalCents: 1200, tipCents: 300, quantity: 1, staffMemberId: 'linh', serviceId: 's-brow', walkInId: null, guestName: null },
      { kind: 'PRODUCT', name: 'Cuticle oil', lineTotalCents: 900, tipCents: 0, quantity: 1, staffMemberId: 'linh', serviceId: null, walkInId: null, guestName: null },
    ] },
  // The checkout of Linh's own booking: shown as the booking, not twice.
  { id: 'o3', tenantId: 't1', status: 'PAID', paidAt: at(8), customerId: 'c-dung', walkInId: 'w4', walkInIds: [], appointmentId: 'ap-linh', appointmentIds: [],
    items: [{ kind: 'SERVICE', name: 'Manicure', lineTotalCents: 2000, tipCents: 0, quantity: 1, staffMemberId: 'linh', serviceId: 's-mani', walkInId: 'w4', guestName: null }] },
  // Another salon.
  { id: 'o9', tenantId: 't2', status: 'PAID', paidAt: at(9), customerId: null, walkInId: null, walkInIds: [], appointmentId: null, appointmentIds: [],
    items: [{ kind: 'SERVICE', name: 'Other', lineTotalCents: 5000, tipCents: 0, quantity: 1, staffMemberId: 'linh', serviceId: 's-x', walkInId: null, guestName: null }] },
];

function makeSvc(tenantId: string) {
  const inRange = (d: Date | null, w: Row | undefined) => !w || (!!d && (!w.gte || d >= w.gte) && (!w.lt || d < w.lt));
  const prisma = {
    staffMember: { findFirst: async ({ where }: Row) => (where.userId === 'u-linh' && where.tenantId === tenantId ? { id: 'linh' } : null) },
    walkIn: { findMany: async ({ where }: Row) => WALKINS.filter((w) => w.tenantId === where.tenantId && w.status !== 'CANCELLED' && inRange(w.createdAt, where.createdAt)) },
    order: {
      findMany: async ({ where }: Row) => ORDERS.filter((o) => {
        if (o.tenantId !== where.tenantId || o.status !== 'PAID') return false;
        if (where.paidAt && !inRange(o.paidAt, where.paidAt)) return false;
        if (where.items?.some?.staffMemberId && !o.items.some((i: Row) => i.staffMemberId === where.items.some.staffMemberId)) return false;
        if (where.OR) {
          const ids: string[] = where.OR[0].walkInId.in;
          return ids.includes(o.walkInId) || (o.walkInIds ?? []).some((x: string) => ids.includes(x));
        }
        return true;
      }),
    },
    appointment: { findMany: async ({ where }: Row) => (where.tenantId === 't1' ? [{ id: 'ap-linh', assignedStaffId: 'linh' }] : []).filter((a) => where.id.in.includes(a.id) && a.assignedStaffId === where.assignedStaffId).map((a) => ({ id: a.id })) },
    customer: { findMany: async ({ where }: Row) => [{ id: 'c-anna', firstName: 'Anna', lastName: 'P' }, { id: 'c-em', firstName: 'Em', lastName: null }].filter((c) => where.tenantId === 't1' && where.id.in.includes(c.id)) },
  };
  const svc = new WalkinsService(prisma as never, {} as never, {} as never);
  const user = { userId: 'u-linh', tenantId, role: 'STAFF' } as never;
  return { svc, user };
}

const range = { from: T0.toISOString(), to: at(24).toISOString() };

describe("the technician's walk-ins and till sales", () => {
  it('lists the walk-ins she served — her lines (add-on marked) and her own tip — and what is in her chair now', async () => {
    const { svc, user } = makeSvc('t1');
    const v = await svc.myVisits(user, range);
    const anna = v.find((x) => x.id === 'w:w1')!;
    expect(anna).toMatchObject({ kind: 'walkin', customer: 'Anna', services: ['Gel Manicure', '+ Nail art'], cents: 4500, tipsCents: 700, status: 'paid' });
    expect(v.find((x) => x.id === 'w:w2')).toMatchObject({ customer: 'Bao', services: ['Pedicure'], status: 'serving' });
  });

  it('lists a sale rung up at the till with no ticket — her service lines only', async () => {
    const { svc, user } = makeSvc('t1');
    const sale = (await svc.myVisits(user, range)).find((x) => x.id === 'o:o2')!;
    expect(sale).toMatchObject({ kind: 'sale', customer: 'Em', services: ['Eyebrows'], cents: 1200, tipsCents: 300, status: 'paid' });
  });

  it('never shows another technician\'s visit, nor a booking of hers twice', async () => {
    const { svc, user } = makeSvc('t1');
    const ids = (await svc.myVisits(user, range)).map((x) => x.id);
    expect(ids).not.toContain('w:w3');
    expect(ids).not.toContain('w:w4');
    expect(ids).not.toContain('o:o3');
    expect(ids).not.toContain('o:o1'); // Anna's payment is folded into her ticket
    expect(ids).toEqual(['w:w1', 'w:w2', 'o:o2']);
  });

  it('signed in to another salon, she sees that salon only — nothing of salon one', async () => {
    const { svc, user } = makeSvc('t2');
    const v = await svc.myVisits(user, range);
    expect(v.map((x) => x.id)).toEqual(['w:w9', 'o:o9']);
  });
});
