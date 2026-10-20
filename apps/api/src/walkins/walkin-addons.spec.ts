/**
 * ADD-ONS ON A WALK-IN TICKET (walkin-legs.ts `kind: 'addon'`).
 *
 * "Vẽ móng" on a Take Off is its own line — the till bills two lines, the
 * board reads both names — but it is NOT its own job: it rides on the
 * service's leg, with the same technician, adds its minutes, and is worth no
 * turn and no skill of its own. The turn rules the salon runs on must not
 * move because an add-on was sold.
 */
import { attachLines, canDo, legsOf, LegItem, Zone, planDispatch, TechInfo } from './walkin-legs';

const svc = (over: Partial<LegItem & { zone: Zone }> = {}): LegItem & { zone: Zone } => ({
  lineId: 'l1', serviceId: 'S1', name: 'Take Off Only', priceCents: 2000, durationMinutes: 15, staffId: null, zone: 'HAND', turnValue: 1, ...over,
});
const addon = (over: Partial<LegItem & { zone: Zone }> = {}): LegItem & { zone: Zone } => ({
  lineId: 'a1', serviceId: 'A1', kind: 'addon', forLineId: 'l1', name: 'Vẽ móng', priceCents: 1500, durationMinutes: 15, staffId: null, zone: 'HAND', turnValue: 0, ...over,
});
const ticket = (items: LegItem[]) => ({ id: 'w1', status: 'WAITING' as const, assignedStaffId: null, createdAt: new Date(), items });

describe('an add-on on a walk-in ticket', () => {
  it('joins the leg of the service it belongs to, in the same batch or later', () => {
    const items = attachLines([], [addon(), svc()]); // add-on listed first on purpose
    expect(items).toHaveLength(2);
    const [s, a] = [items.find((i) => i.lineId === 'l1')!, items.find((i) => i.lineId === 'a1')!];
    expect(a.legId).toBe(s.legId);
    expect(a.legStatus).toBe(s.legStatus);
    const later = attachLines(items.filter((i) => i.lineId === 'l1'), [addon({ lineId: 'a2' })]);
    expect(later.find((i) => i.lineId === 'a2')!.legId).toBe(s.legId);
  });

  it('adds its minutes and its price to the leg, but never a turn', () => {
    const items = attachLines([], [svc({ turnValue: 2 }), addon()]);
    const [leg] = legsOf(ticket(items));
    expect(leg.minutes).toBe(30);
    expect(leg.names).toEqual(['Take Off Only', 'Vẽ móng']);
    expect(leg.turnValue).toBe(2);
    expect(items.reduce((s, i) => s + i.priceCents, 0)).toBe(3500);
  });

  it('is not a skill: a technician who does the service can take the leg', () => {
    const items = attachLines([], [svc(), addon()]);
    const [leg] = legsOf(ticket(items));
    expect(leg.serviceIds).toEqual(['S1']);
    const linh: TechInfo = { id: 't1', name: 'Linh', priority: 0, skills: ['S1'] };
    expect(canDo(linh, leg.serviceIds)).toBe(true);
    const plan = planDispatch([ticket(items)], [linh], new Map());
    expect(plan.map((p) => p.staffId)).toEqual(['t1']);
  });

  it('follows the service line to its technician when the leg is handed out', () => {
    const items = attachLines([], [svc({ staffId: 't9' }), addon()]);
    expect(items.every((i) => i.staffId === 't9')).toBe(true);
    expect(new Set(items.map((i) => i.legId)).size).toBe(1);
  });

  it('with no service line to ride on, it becomes an ordinary line (never lost)', () => {
    const items = attachLines([], [addon({ forLineId: 'missing' })]);
    expect(items).toHaveLength(1);
    expect(items[0].legId).toBeTruthy();
  });
});
