import {
  attachLines, busyTechs, canRunTogether, legsOf, LegItem, phaseOf, pickTech, planDispatch, syncTicket,
  TechInfo, TicketLike, turnsFromTickets, upgradeItems, zoneOf,
} from './walkin-legs';

const at = (min: number) => new Date(Date.UTC(2026, 9, 1, 15, min));
const line = (lineId: string, serviceId: string, name: string, extra: Partial<LegItem> = {}): LegItem & { zone: ReturnType<typeof zoneOf> } =>
  ({ lineId, serviceId, name, priceCents: 3000, durationMinutes: 30, staffId: null, zone: zoneOf(name), turnValue: 1, ...extra });
const ticket = (id: string, items: LegItem[], extra: Partial<TicketLike> = {}): TicketLike =>
  ({ id, status: 'WAITING', assignedStaffId: null, createdAt: at(0), items, ...extra });
const tech = (id: string, skills: string[] = [], priority = 0): TechInfo => ({ id, name: id, priority, skills });

describe('zones', () => {
  it('reads hands, feet and everything else from the service name', () => {
    expect(zoneOf('Gel Manicure')).toBe('HAND');
    expect(zoneOf('Spa Pedicure')).toBe('FOOT');
    expect(zoneOf('Toe Nail Polish')).toBe('FOOT');
    expect(zoneOf('Sơn gel tay')).toBe('HAND');
    expect(zoneOf('Làm chân')).toBe('FOOT');
    expect(zoneOf('Full Body Massage (1hr)')).toBe('OTHER');
    expect(zoneOf('Princess Pedicure & Manicure')).toBe('OTHER');
  });
  it('only hands + feet run at the same time', () => {
    expect(canRunTogether('HAND', 'FOOT')).toBe(true);
    expect(canRunTogether('HAND', 'HAND')).toBe(false);
    expect(canRunTogether('OTHER', 'FOOT')).toBe(false);
  });
});

describe('building legs', () => {
  it('a manicure + a pedicure are two legs; nail art joins the manicure', () => {
    const items = attachLines([], [line('a', 'mani', 'Gel Manicure'), line('b', 'pedi', 'Spa Pedicure'), line('c', 'art', 'Nail Art')]);
    const legs = legsOf(ticket('t', items));
    expect(legs.map((l) => [l.zone, l.lineIds])).toEqual([['HAND', ['a', 'c']], ['FOOT', ['b']]]);
    expect(legs.every((l) => l.status === 'WAITING')).toBe(true);
  });
  it('a ticket from before legs reads as one leg with the ticket’s tech and status', () => {
    const old = ticket('t', [{ lineId: 'a', serviceId: 'mani', name: 'Gel Manicure', priceCents: 1, staffId: null }, { lineId: 'b', serviceId: 'pedi', name: 'Spa Pedicure', priceCents: 1, staffId: null }], { status: 'SERVING', assignedStaffId: 'hana', assignedAt: at(1) });
    const legs = legsOf(old);
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ status: 'SERVING', staffId: 'hana', zone: 'OTHER', legacy: true });
    // …and keeps meaning that once written with real legs.
    const up = legsOf({ ...old, items: upgradeItems(old) });
    expect(up).toHaveLength(1);
    expect(up[0]).toMatchObject({ status: 'SERVING', staffId: 'hana' });
  });
  it('an old ticket still waiting in the queue is split by zone when upgraded', () => {
    const old = ticket('t', [{ lineId: 'a', serviceId: 'mani', name: 'Gel Manicure', priceCents: 1, staffId: null }, { lineId: 'b', serviceId: 'pedi', name: 'Spa Pedicure', priceCents: 1, staffId: null }]);
    expect(legsOf({ ...old, items: upgradeItems(old) }).map((l) => l.zone)).toEqual(['HAND', 'FOOT']);
  });
});

describe('who goes next', () => {
  const mp = (id: string, min = 0) => ticket(id, attachLines([], [line(`${id}a`, 'mani', 'Gel Manicure'), line(`${id}b`, 'pedi', 'Spa Pedicure')]), { createdAt: at(min) });

  it('two free techs: hands and feet start together', () => {
    const plan = planDispatch([mp('t1')], [tech('hana'), tech('lisa')], new Map());
    expect(plan.map((p) => p.staffId).sort()).toEqual(['hana', 'lisa']);
  });

  it('a tech who only does hands never gets the feet', () => {
    const t = mp('t1');
    const plan = planDispatch([t], [tech('hana', ['mani'])], new Map());
    expect(plan).toHaveLength(1);
    expect(plan[0].staffId).toBe('hana');
    expect(plan[0].legId).toBe(legsOf(t).find((l) => l.zone === 'HAND')!.legId);
  });

  it('fewest turns first, then priority', () => {
    const turns = new Map([['hana', 2], ['lisa', 1], ['vy', 1]]);
    const t = ticket('t1', attachLines([], [line('a', 'mani', 'Gel Manicure')]));
    expect(planDispatch([t], [tech('hana'), tech('lisa'), tech('vy', [], 5)], turns)[0].staffId).toBe('vy');
  });

  it('hands finished, feet waiting: that customer is served before someone who just walked in', () => {
    let t1 = mp('t1', 0);
    const hand = legsOf(t1).find((l) => l.zone === 'HAND')!;
    t1 = { ...t1, status: 'SERVING', items: (t1.items as LegItem[]).map((it) => (it.legId === hand.legId ? { ...it, legStatus: 'DONE' as const, staffId: 'hana', doneAt: at(30).toISOString() } : it)) };
    const t2 = ticket('t2', attachLines([], [line('x', 'pedi', 'Spa Pedicure')]), { createdAt: at(10) });
    const plan = planDispatch([t2, t1], [tech('lisa')], new Map());
    expect(plan).toHaveLength(1);
    expect(plan[0].ticketId).toBe('t1');
    expect(phaseOf(t1)).toBe('BETWEEN');
  });

  it('first come, first served for new tickets', () => {
    const plan = planDispatch([mp('late', 9), mp('early', 1)], [tech('hana', ['mani'])], new Map());
    expect(plan[0].ticketId).toBe('early');
  });

  it('a pinned leg waits for its tech even when someone else is free', () => {
    const t = ticket('t1', attachLines([], [line('a', 'pedi', 'Spa Pedicure', { staffId: 'lisa' })]));
    expect(legsOf(t)[0].pinned).toBe(true);
    expect(planDispatch([t], [tech('hana')], new Map())).toEqual([]);
    expect(planDispatch([t], [tech('hana'), tech('lisa')], new Map())[0].staffId).toBe('lisa');
  });

  it('a busy tech is never handed a second leg, a massage never runs beside anything', () => {
    const items = attachLines([], [line('a', 'mani', 'Gel Manicure'), line('m', 'massage', 'Full Body Massage (1hr)')]);
    const running = ticket('t1', items.map((it) => (it.zone === 'HAND' ? { ...it, legStatus: 'SERVING' as const, staffId: 'hana' } : it)), { status: 'SERVING' });
    expect(busyTechs([running]).has('hana')).toBe(true);
    expect(planDispatch([running], [tech('hana'), tech('lisa')], new Map())).toEqual([]);
  });

  it('a tech asked for by name is kept for that customer when someone else can serve the earlier one', () => {
    const early = ticket('early', attachLines([], [line('a', 'mani', 'Gel Manicure')]), { createdAt: at(0) });
    const asked = ticket('asked', attachLines([], [line('b', 'mani', 'Gel Manicure', { staffId: 'hana' })]), { createdAt: at(5) });
    const plan = planDispatch([early, asked], [tech('hana'), tech('lisa', [], 0)], new Map([['lisa', 3]]));
    expect(plan.map((p) => [p.ticketId, p.staffId])).toEqual([['early', 'lisa'], ['asked', 'hana']]);
  });

  it('a service nobody is ticked for never blocks the queue', () => {
    const t = ticket('t1', attachLines([], [line('a', 'newthing', 'Gel Manicure')]));
    // Every tech has skills, none has "newthing".
    const team = [tech('hana', ['mani']), tech('lisa', ['pedi'])];
    expect(planDispatch([t], team, new Map(), { restricted: new Set(['mani', 'pedi']) })).toHaveLength(1);
    // Even without the hint: nobody does it, so anybody may.
    expect(planDispatch([t], team, new Map())).toHaveLength(1);
  });

  it('when nobody does the whole leg, its main service decides', () => {
    const t = ticket('t1', attachLines([], [line('a', 'mani', 'Gel Manicure'), line('b', 'art', 'Nail Art')]));
    const plan = planDispatch([t], [tech('lisa', ['pedi']), tech('hana', ['mani'])], new Map());
    expect(plan[0].staffId).toBe('hana');
  });

  it('a technician with no skills set up does everything (salons that never ticked boxes keep working)', () => {
    expect(pickTech([tech('hana')], ['anything'], new Map())?.id).toBe('hana');
  });
});

describe('the ticket follows its legs', () => {
  it('waiting → serving → between → done', () => {
    const base = ticket('t1', attachLines([], [line('a', 'mani', 'Gel Manicure'), line('b', 'pedi', 'Spa Pedicure')]));
    const [hand, foot] = legsOf(base);
    const items1 = (base.items as LegItem[]).map((it) => (it.legId === hand.legId ? { ...it, legStatus: 'SERVING' as const, staffId: 'hana', startedAt: at(5).toISOString() } : it));
    const s1 = syncTicket(base, items1, at(5));
    expect(s1).toMatchObject({ status: 'SERVING', assignedStaffId: 'hana' });
    const items2 = items1.map((it) => (it.legId === hand.legId ? { ...it, legStatus: 'DONE' as const, doneAt: at(40).toISOString() } : it));
    expect(syncTicket(base, items2, at(40)).status).toBe('SERVING');
    expect(phaseOf({ ...base, status: 'SERVING', items: items2 })).toBe('BETWEEN');
    const items3 = items2.map((it) => (it.legId === foot.legId ? { ...it, legStatus: 'DONE' as const, staffId: 'lisa', doneAt: at(80).toISOString() } : it));
    const s3 = syncTicket(base, items3, at(80));
    expect(s3.status).toBe('DONE');
    expect(s3.assignedStaffId).toBe('lisa');
  });
});

describe('turns', () => {
  it('each finished leg is worth its service’s turn value, to whoever did it', () => {
    const items = attachLines([], [line('a', 'mani', 'Gel Manicure'), line('b', 'pedi', 'Spa Pedicure'), line('c', 'wax', 'Eyebrows Wax', { turnValue: 0.5 })])
      .map((it) => ({ ...it, legStatus: 'DONE' as const, doneAt: at(50).toISOString(), staffId: it.zone === 'FOOT' ? 'lisa' : 'hana' }));
    const turns = turnsFromTickets([ticket('t1', items, { status: 'DONE', doneAt: at(60) })], at(0));
    expect(turns.get('hana')).toBe(1.5);
    expect(turns.get('lisa')).toBe(1);
  });
  it('a ticket paid at the till counts its legs in progress as finished', () => {
    const items = attachLines([], [line('a', 'mani', 'Gel Manicure')]).map((it) => ({ ...it, legStatus: 'SERVING' as const, staffId: 'hana' }));
    expect(turnsFromTickets([ticket('t1', items, { status: 'DONE', doneAt: at(60) })], at(0)).get('hana')).toBe(1);
  });
  it('old tickets keep the old rule: one turn per tech on the ticket', () => {
    const old = ticket('t1', [{ lineId: 'a', serviceId: 's', name: 'x', priceCents: 1, staffId: 'hana' }, { lineId: 'b', serviceId: 's', name: 'y', priceCents: 1, staffId: 'lisa' }], { status: 'DONE', doneAt: at(30) });
    const turns = turnsFromTickets([old], at(0));
    expect([turns.get('hana'), turns.get('lisa')]).toEqual([1, 1]);
  });
  it('yesterday does not count', () => {
    const items = attachLines([], [line('a', 'mani', 'Gel Manicure')]).map((it) => ({ ...it, legStatus: 'DONE' as const, staffId: 'hana', doneAt: at(-60 * 24).toISOString() }));
    expect(turnsFromTickets([ticket('t1', items, { status: 'DONE', doneAt: at(-60 * 24) })], at(0)).get('hana')).toBeUndefined();
  });
});
