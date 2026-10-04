/**
 * The one diary every AI door reads. A chat customer asking "Saturday at 2
 * for me and my sister" gets the same answer the hotline would give — and
 * neither ever reads another salon's technicians or bookings.
 */
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  AppointmentStatus: { PENDING: 'PENDING', ASSIGNED: 'ASSIGNED', ACCEPTED: 'ACCEPTED', CONFIRMED: 'CONFIRMED', ARRIVED: 'ARRIVED', CANCELLED: 'CANCELLED' },
}));
import { PartyAvailabilityService } from './party-availability.service';

type Row = Record<string, any>;
const TZ = 'America/Chicago';
const DAY = '2030-03-09'; // Saturday; 14:00 CST = 20:00Z

function make(o: { staff?: Row[]; appts?: Row[] } = {}) {
  const wheres: Row[] = [];
  const staff = o.staff ?? [
    { id: 'kim', tenantId: 't1', firstName: 'Kim', lastName: null },
    { id: 'lily', tenantId: 't1', firstName: 'Lily', lastName: null },
    { id: 'zoe', tenantId: 't2', firstName: 'Zoe', lastName: null },
  ];
  const appts = o.appts ?? [];
  const prisma: any = {
    staffMember: { findMany: async ({ where }: Row) => { wheres.push(where); return staff.filter((s) => s.tenantId === where.tenantId).map((s) => ({ ...s, staffServices: [], workingHours: [] })); } },
    appointment: { findMany: async ({ where }: Row) => { wheres.push(where); return appts.filter((a) => a.tenantId === where.tenantId); } },
  };
  const settings: any = { getBookingRules: async () => ({ businessHours: Array(7).fill({ closed: false, openMinutes: 9 * 60, closeMinutes: 19 * 60 }), daysOff: [], minLeadHours: 0, maxAdvanceDays: 0, slotStepMinutes: 30 }) };
  const svc = new PartyAvailabilityService(prisma, settings);
  const ctx = { menu: [{ id: 'gel', name: 'Gel Manicure', minutes: 45 }, { id: 'pedi', name: 'Pedicure', minutes: 45 }], staff: staff.filter((s) => s.tenantId === 't1') };
  return { svc, ctx, wheres };
}

describe('one diary for every AI door', () => {
  it('two people, two free technicians: OPEN', async () => {
    const { svc, ctx } = make();
    const out = await svc.describe('t1', TZ, { date: DAY, time: '14:00', people: [{ services: ['Gel Manicure'] }, { services: ['pedi'] }] }, ctx);
    expect(out).toMatch(/^OPEN: Saturday, March 9(,| at) 2:00\sPM works for all 2 people/);
  });

  it('three people, two technicians: not open, with the next real option', async () => {
    const { svc, ctx } = make();
    const out = await svc.describe('t1', TZ, { date: DAY, time: '14:00', people: [{ services: ['gel'] }, { services: ['pedi'] }, { services: ['pedi'] }] }, ctx);
    expect(out).toMatch(/^NOT OPEN/);
  });

  it('no time given: lists open starts, a few at a time', async () => {
    const { svc, ctx } = make();
    const out = await svc.describe('t1', TZ, { date: DAY, people: [{ services: ['gel'] }] }, ctx);
    expect(out).toMatch(/^Open start times that day: 9:00\sAM, 9:30\sAM/);
    expect(out).toContain('Offer two or three');
  });

  it("another salon's bookings never take one of our chairs, and we never read its team", async () => {
    const theirs = { tenantId: 't2', assignedStaffId: 'kim', startTime: new Date('2030-03-09T19:00:00Z'), endTime: new Date('2030-03-09T22:00:00Z') };
    const { svc, ctx, wheres } = make({ appts: [theirs] });
    const out = await svc.describe('t1', TZ, { date: DAY, time: '14:00', people: [{ services: ['gel'], technician: 'Kim' }] }, ctx);
    expect(out).toMatch(/^OPEN/);
    for (const w of wheres) expect(w.tenantId).toBe('t1');
    expect(await svc.describe('t1', TZ, { date: DAY, time: '14:00', people: [{ services: ['gel'], technician: 'Zoe' }] }, ctx)).toMatch(/no single technician called "Zoe"/);
  });

  it('a service the model cannot name exactly is a question, not a guess', async () => {
    const { svc, ctx } = make();
    expect(await svc.describe('t1', TZ, { date: DAY, people: [{ services: ['manicure'] }] }, { ...ctx, menu: [...ctx.menu, { id: 'reg', name: 'Regular Manicure', minutes: 30 }] })).toMatch(/not one exact menu item/);
  });
});
