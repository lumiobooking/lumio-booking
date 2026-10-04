import { MenuItem, Tech, nearestTimes, partyFits, partyOpenTimes, resolveService, serviceCode } from './group-booking';

const menu: MenuItem[] = [
  { id: 'svc-gel-mani', name: 'Gel Manicure', minutes: 45 },
  { id: 'svc-pedi', name: 'Pedicure', minutes: 45 },
  { id: 'svc-reg-mani', name: 'Regular Manicure', minutes: 30 },
  { id: 'svc-tap', name: 'TAP Gel Manicure', minutes: 60 },
];

const at = (hhmm: string) => new Date(`2026-10-10T${hhmm}:00Z`);
const tech = (id: string, skills: string[] = [], busy: [string, string][] = []): Tech => ({
  id, name: id, skills, busy: busy.map(([s, e]) => ({ start: at(s), end: at(e) })),
});

describe('menu references the assistant passes', () => {
  it('reads a short code, an id or one exact name', () => {
    expect(serviceCode(0)).toBe('S1');
    expect(resolveService('S2', menu)?.id).toBe('svc-pedi');
    expect(resolveService('s4', menu)?.id).toBe('svc-tap');
    expect(resolveService('svc-gel-mani', menu)?.id).toBe('svc-gel-mani');
    expect(resolveService('pedicure', menu)?.id).toBe('svc-pedi');
  });

  it('never picks between two candidates — "manicure" is a question, not an answer', () => {
    expect(resolveService('manicure', menu)).toBeNull();
    expect(resolveService('S9', menu)).toBeNull();
    expect(resolveService('', menu)).toBeNull();
  });

  it('a service id from another salon is not on this menu', () => {
    expect(resolveService('svc-of-tenant-b', menu)).toBeNull();
  });
});

describe('does the whole party fit at one start time', () => {
  const party3 = [
    { serviceIds: ['svc-gel-mani', 'svc-pedi'], minutes: 90 },
    { serviceIds: ['svc-pedi'], minutes: 45 },
    { serviceIds: ['svc-pedi'], minutes: 45 },
  ];

  it('three people need three different free technicians', () => {
    const three = [tech('kim'), tech('lily'), tech('mai')];
    expect(partyFits(at('14:00'), party3, three)).toBe(true);
    const oneBusy = [tech('kim'), tech('lily'), tech('mai', [], [['13:30', '14:30']])];
    expect(partyFits(at('14:00'), party3, oneBusy)).toBe(false);
  });

  it('the long visit needs its technician free for its whole length', () => {
    const team = [tech('kim', [], [['15:00', '16:00']]), tech('lily', [], [['15:00', '16:00']])];
    // 90 minutes from 14:00 runs into 15:00 for both techs.
    expect(partyFits(at('14:00'), [{ serviceIds: ['svc-gel-mani', 'svc-pedi'], minutes: 90 }], team)).toBe(false);
    expect(partyFits(at('14:00'), [{ serviceIds: ['svc-pedi'], minutes: 45 }], team)).toBe(true);
  });

  it('skills matter: a pedicure-only tech cannot take the gel manicure', () => {
    const team = [tech('kim', ['svc-pedi']), tech('lily', ['svc-pedi'])];
    const party = [{ serviceIds: ['svc-gel-mani'], minutes: 45 }, { serviceIds: ['svc-pedi'], minutes: 45 }];
    // Nobody registered gel → that person lands PENDING (like the online page); the pedicure still needs a tech.
    expect(partyFits(at('14:00'), party, team)).toBe(true);
    const gelTech = [tech('kim', ['svc-pedi']), tech('lily', ['svc-gel-mani'], [['14:00', '15:00']])];
    expect(partyFits(at('14:00'), party, gelTech)).toBe(false);
  });

  it('an asked-for technician must be the one who is free', () => {
    const team = [tech('kim', [], [['14:00', '15:00']]), tech('lily')];
    expect(partyFits(at('14:00'), [{ serviceIds: ['svc-pedi'], minutes: 45, techId: 'kim' }], team)).toBe(false);
    expect(partyFits(at('14:00'), [{ serviceIds: ['svc-pedi'], minutes: 45, techId: 'lily' }], team)).toBe(true);
    expect(partyFits(at('14:00'), [{ serviceIds: ['svc-pedi'], minutes: 45, techId: 'someone-else' }], team)).toBe(false);
  });

  it('unassigned bookings already in the book each hold a chair', () => {
    const team = [tech('kim'), tech('lily'), tech('mai')];
    const unassigned = [{ start: at('14:00'), end: at('15:00') }, { start: at('13:45'), end: at('14:30') }];
    expect(partyFits(at('14:00'), party3, team, unassigned)).toBe(false);
    expect(partyFits(at('14:00'), party3.slice(0, 1), team, unassigned)).toBe(true);
  });

  it('a salon with no technicians set up books PENDING, as the online page does', () => {
    expect(partyFits(at('14:00'), party3, [])).toBe(true);
  });
});

describe('open times for a party', () => {
  const day = { closed: false, openMinutes: 9 * 60, closeMinutes: 18 * 60 } as never;
  const base = { dateStr: '2026-10-10', tz: 'UTC', day, stepMinutes: 30, now: new Date('2026-10-09T00:00:00Z') };

  it('only times where everybody fits, and the longest visit ends by closing', () => {
    const team = [tech('kim'), tech('lily', [], [['09:00', '12:00']])];
    const times = partyOpenTimes({ ...base, party: [{ serviceIds: ['svc-pedi'], minutes: 45 }, { serviceIds: ['svc-tap'], minutes: 60 }], techs: team });
    expect(times[0].toISOString()).toBe('2026-10-10T12:00:00.000Z');
    expect(times[times.length - 1].toISOString()).toBe('2026-10-10T17:00:00.000Z');
  });

  it('a closed day offers nothing', () => {
    expect(partyOpenTimes({ ...base, closedToday: true, party: [{ serviceIds: ['svc-pedi'], minutes: 45 }], techs: [tech('kim')] })).toEqual([]);
  });

  it('nearest options sit around the asked time, in order', () => {
    const times = ['10:00', '11:00', '13:00', '15:00', '16:00'].map(at);
    expect(nearestTimes(times, at('14:00'), 3).map((d) => d.toISOString().slice(11, 16))).toEqual(['13:00', '15:00', '16:00']);
    expect(nearestTimes(times, null, 2).map((d) => d.toISOString().slice(11, 16))).toEqual(['10:00', '11:00']);
  });
});
