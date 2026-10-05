/**
 * "Me and my two friends, Saturday at two — gel and a pedicure for me,
 * pedicures for them." The hotline's booking tools, played against the real
 * service with a fake database: the book is checked first, everyone is
 * written at the same time with one group id, nothing half-books, and one
 * salon's team, menu and diary never leak into another's call.
 */
import { VoiceService } from './voice.service';

type Row = Record<string, any>;
const TZ = 'America/Chicago';
// Saturday 9 March 2030, 2 PM in Chicago (CST, UTC-6).
const DAY = '2030-03-09';
const TWO_PM = new Date('2030-03-09T20:00:00.000Z');

const menu = [
  { id: 'gel', name: 'Gel Manicure', minutes: 45 },
  { id: 'pedi', name: 'Pedicure', minutes: 45 },
  { id: 'reg', name: 'Regular Manicure', minutes: 30 },
];

function makeSvc(o: { staff?: Row[]; appts?: Row[]; failOnCall?: number; dupe?: Row | null } = {}) {
  const calls: { model: string; where: Row }[] = [];
  const created: Row[] = [];
  const updates: Row[] = [];
  const staff = o.staff ?? [
    { id: 'kim', tenantId: 't1', firstName: 'Kim' },
    { id: 'lily', tenantId: 't1', firstName: 'Lily' },
    { id: 'mai', tenantId: 't1', firstName: 'Mai' },
    { id: 'zoe', tenantId: 't2', firstName: 'Zoe' }, // another salon's tech
  ];
  const appts = o.appts ?? [];
  const log = (model: string) => (a: { where: Row }) => calls.push({ model, where: a.where });
  const prisma = {
    tenant: { findUnique: async () => ({ timezone: TZ }) },
    setting: { findFirst: async (a: { where: Row }) => { log('setting')(a); return null; } },
    staffMember: {
      findMany: async (a: { where: Row }) => {
        log('staffMember')(a);
        return staff.filter((s) => s.tenantId === a.where.tenantId).map((s) => ({ ...s, staffServices: s.skills ?? [], workingHours: [] }));
      },
    },
    appointment: {
      findMany: async (a: { where: Row }) => { log('appointment')(a); return appts.filter((x) => x.tenantId === a.where.tenantId); },
      findFirst: async (a: { where: Row }) => { log('appointment.findFirst')(a); return o.dupe && o.dupe.tenantId === a.where.tenantId ? { id: o.dupe.id } : null; },
      updateMany: async (a: { where: Row }) => { log('appointment.updateMany')(a); updates.push(a); return { count: 1 }; },
    },
  };
  const bookings = {
    createForTenant: async (tenantId: string, dto: Row, actor: unknown, source: string, device: unknown, opts: Row) => {
      if (o.failOnCall && created.length + 1 === o.failOnCall) throw new Error('Service not found or inactive');
      const row = { tenantId, dto, actor, source, opts, id: `ap${created.length + 1}` };
      created.push(row);
      return { id: row.id };
    },
  };
  const settings = {
    getBookingRules: async (tenantId: string) => {
      calls.push({ model: 'rules', where: { tenantId } });
      return { businessHours: Array(7).fill({ closed: false, openMinutes: 9 * 60, closeMinutes: 19 * 60 }), daysOff: [], minLeadHours: 0, maxAdvanceDays: 0, slotStepMinutes: 30 };
    },
  };
  const svc = new VoiceService(prisma as never, bookings as never, settings as never, {} as never);
  const t1Staff = staff.filter((s) => s.tenantId === 't1').map((s) => ({ id: s.id, firstName: s.firstName, lastName: null }));
  const ctx = { menu, staff: t1Staff, groupMode: true };
  const acc = { wantEnd: false, booked: false, appointmentId: null as string | null };
  // A booking is only made once the caller said yes to a read-back with the
  // number's last four digits (phone-readback.ts). The cases below are about
  // the party itself, so they pass that confirmation unless they set it.
  const tool = (name: string, input: Row) =>
    (svc as unknown as { runTool: (...a: unknown[]) => Promise<string> }).runTool(
      't1', TZ, '+17145550000', name,
      name === 'create_booking' && !('phoneConfirmed' in input) ? { ...input, phoneConfirmed: true } : input,
      acc, ctx,
    );
  return { tool, calls, created, updates, acc };
}

const party3 = [
  { firstName: 'Anna', services: ['S1', 'S2'] },
  { firstName: 'Lisa', services: ['S2'] },
  { firstName: 'Mai', services: ['pedicure'] },
];

describe('booking a whole party by phone', () => {
  it('books three people at the same time, one group, the caller last and the only contact', async () => {
    const { tool, created, acc } = makeSvc();
    const out = await tool('create_booking', { localDateTime: `${DAY}T14:00`, people: party3 });
    expect(out).toMatch(/^SUCCESS/);
    expect(out).toContain('Anna (Gel Manicure + Pedicure)');
    expect(created).toHaveLength(3);
    // Guests first, the caller last — her confirmation text only goes out once everyone is in.
    expect(created.map((c) => c.dto.customerFirstName)).toEqual(['Lisa', 'Mai', 'Anna']);
    const lead = created[2];
    expect(lead.dto.customerPhone).toBe('+17145550000');
    expect(lead.dto.serviceId).toBe('gel');
    expect(lead.dto.serviceIds).toEqual(['gel', 'pedi']);
    expect(lead.opts).toEqual({ autoAssign: true, groupGuest: false });
    for (const g of created.slice(0, 2)) {
      expect(g.dto.customerPhone).toBeUndefined();
      expect(g.opts.groupGuest).toBe(true);
    }
    const groupIds = new Set(created.map((c) => c.dto.groupId));
    expect(groupIds.size).toBe(1);
    expect([...groupIds][0]).toMatch(/^ph-/);
    for (const c of created) {
      expect(c.tenantId).toBe('t1');
      expect(c.source).toBe('hotline');
      expect(c.dto.partySize).toBe(3);
      expect(new Date(c.dto.startTime).toISOString()).toBe(TWO_PM.toISOString());
    }
    expect(acc.booked).toBe(true);
    expect(acc.appointmentId).toBe('ap3');
  });

  it('one person stays a plain booking — no group id, no party size', async () => {
    const { tool, created } = makeSvc();
    const out = await tool('create_booking', { localDateTime: `${DAY}T14:00`, people: [{ firstName: 'Anna', services: ['S1'] }] });
    expect(out).toMatch(/^SUCCESS/);
    expect(created).toHaveLength(1);
    expect(created[0].dto.groupId).toBeUndefined();
    expect(created[0].dto.partySize).toBeUndefined();
  });

  it('a time that cannot seat everybody books nobody and offers the nearest that can', async () => {
    const busy = { tenantId: 't1', assignedStaffId: 'mai', startTime: new Date('2030-03-09T19:30:00Z'), endTime: new Date('2030-03-09T21:00:00Z') };
    const { tool, created } = makeSvc({ appts: [busy] });
    const out = await tool('create_booking', { localDateTime: `${DAY}T14:00`, people: party3 });
    expect(out).toMatch(/^NOT BOOKED/);
    expect(out).toContain('for all 3 people');
    expect(out).toMatch(/Nearest open times that day: .*PM/);
    expect(created).toHaveLength(0);
  });

  it('if one booking fails halfway, the ones already written are cancelled', async () => {
    const { tool, created, updates, acc } = makeSvc({ failOnCall: 2 });
    const out = await tool('create_booking', { localDateTime: `${DAY}T14:00`, people: party3 });
    expect(out).toMatch(/^NOT BOOKED/);
    expect(created).toHaveLength(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].where).toEqual({ tenantId: 't1', id: { in: ['ap1'] } });
    expect(acc.booked).toBe(false);
  });

  it('never picks between two services and never books without names', async () => {
    const { tool, created } = makeSvc();
    expect(await tool('create_booking', { localDateTime: `${DAY}T14:00`, people: [{ firstName: 'Anna', services: ['manicure'] }] })).toMatch(/not one exact menu item/);
    expect(await tool('create_booking', { localDateTime: `${DAY}T14:00`, people: [{ services: ['S2'] }] })).toMatch(/no name yet/);
    expect(created).toHaveLength(0);
  });

  it('a "yes" heard twice does not book twice', async () => {
    const { tool, created, acc } = makeSvc({ dupe: { tenantId: 't1', id: 'ap-earlier' } });
    const out = await tool('create_booking', { localDateTime: `${DAY}T14:00`, people: party3 });
    expect(out).toMatch(/^ALREADY BOOKED/);
    expect(created).toHaveLength(0);
    expect(acc.appointmentId).toBe('ap-earlier');
  });
});

describe('checking the book before offering a time', () => {
  it('says OPEN when every person has a free technician', async () => {
    const { tool } = makeSvc();
    const out = await tool('check_availability', { date: DAY, time: '14:00', people: party3.map((p) => ({ services: p.services })) });
    expect(out).toMatch(/^OPEN: Saturday, March 9(,| at) 2:00\sPM works for all 3 people/);
  });

  it('a party bigger than the free team is not open, and gets real alternatives', async () => {
    const { tool } = makeSvc({ staff: [{ id: 'kim', tenantId: 't1', firstName: 'Kim' }, { id: 'lily', tenantId: 't1', firstName: 'Lily' }] });
    const out = await tool('check_availability', { date: DAY, time: '14:00', people: party3.map((p) => ({ services: p.services })) });
    // Two technicians can never seat three people at once — the whole week is closed to this party.
    expect(out).toMatch(/^NOT OPEN/);
    expect(out).toMatch(/Nothing is open in the next week/);
  });

  it('an asked-for technician is honoured, and a name from another salon is not one of ours', async () => {
    const busyKim = { tenantId: 't1', assignedStaffId: 'kim', startTime: new Date('2030-03-09T20:00:00Z'), endTime: new Date('2030-03-09T21:00:00Z') };
    const { tool } = makeSvc({ appts: [busyKim] });
    expect(await tool('check_availability', { date: DAY, time: '14:00', people: [{ services: ['S2'], technician: 'Kim' }] })).toMatch(/^NOT OPEN/);
    expect(await tool('check_availability', { date: DAY, time: '14:00', people: [{ services: ['S2'], technician: 'Lily' }] })).toMatch(/^OPEN/);
    expect(await tool('check_availability', { date: DAY, time: '14:00', people: [{ services: ['S2'], technician: 'Zoe' }] })).toMatch(/no single technician called "Zoe"/);
  });
});

describe('tenant isolation', () => {
  it('every read and write of a party booking is scoped to the calling salon', async () => {
    // Another salon's booking for the same minute must not take one of OUR chairs.
    const theirs = { tenantId: 't2', assignedStaffId: 'kim', startTime: new Date('2030-03-09T19:00:00Z'), endTime: new Date('2030-03-09T22:00:00Z') };
    const { tool, calls, created } = makeSvc({ appts: [theirs], failOnCall: 3 });
    await tool('check_availability', { date: DAY, time: '14:00', people: party3.map((p) => ({ services: p.services })) });
    await tool('create_booking', { localDateTime: `${DAY}T14:00`, people: party3 });
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.where.tenantId).toBe('t1');
    for (const c of created) expect(c.tenantId).toBe('t1');
  });

  it('a service id from another salon is not on this menu', async () => {
    const { tool, created } = makeSvc();
    const out = await tool('create_booking', { localDateTime: `${DAY}T14:00`, people: [{ firstName: 'Anna', services: ['svc-of-t2'] }] });
    expect(out).toMatch(/not one exact menu item/);
    expect(created).toHaveLength(0);
  });
});

describe('the phone number is read back before a hotline booking', () => {
  it('without the caller’s yes to the last four digits, nobody is booked', async () => {
    const { tool, created } = makeSvc();
    const out = await tool('create_booking', { localDateTime: `${DAY}T14:00`, people: party3, phoneConfirmed: false });
    expect(out).toMatch(/^NOT BOOKED YET/);
    expect(out).toContain('ending in 0, 0, 0, 0'); // caller ID +17145550000
    expect(created).toHaveLength(0);
  });

  it('a different number the caller gave is the one booked', async () => {
    const { tool, created } = makeSvc();
    const out = await tool('create_booking', { localDateTime: `${DAY}T14:00`, people: [{ firstName: 'Anna', services: ['S1'] }], customerPhone: '714 555 0147' });
    expect(out).toMatch(/^SUCCESS/);
    expect(created.map((c) => c.dto.customerPhone).filter(Boolean)).toEqual(['+17145550147']);
  });

  it('a garbled number is asked for again — never swapped for the caller ID', async () => {
    const { tool, created } = makeSvc();
    const out = await tool('create_booking', { localDateTime: `${DAY}T14:00`, people: [{ firstName: 'Anna', services: ['S1'] }], customerPhone: '555 01' });
    expect(out).toMatch(/not a complete phone number/);
    expect(created).toHaveLength(0);
  });
});

