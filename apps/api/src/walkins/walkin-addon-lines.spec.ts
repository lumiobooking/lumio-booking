/**
 * Which add-ons a walk-in ticket takes (WalkinsService.addonLines): only THIS
 * salon's active ones, each riding on a service it is offered for — its own
 * service, a service of its category, or any service — at list price.
 */
import { WalkinsService } from './walkins.service';
import type { LegItem } from './walkin-legs';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const ADDONS: Row[] = [
  { id: 'a-art', tenantId: 't1', isActive: true, name: 'Vẽ móng', priceCents: 1500, durationMinutes: 15, serviceId: 's-takeoff', categoryId: null },
  { id: 'a-gel', tenantId: 't1', isActive: true, name: 'Take Off (gel)', priceCents: 500, durationMinutes: 10, serviceId: null, categoryId: 'c-hand' },
  { id: 'a-all', tenantId: 't1', isActive: true, name: 'Hot towel', priceCents: 300, durationMinutes: 0, serviceId: null, categoryId: null },
  { id: 'a-off', tenantId: 't1', isActive: false, name: 'Retired', priceCents: 900, durationMinutes: 5, serviceId: 's-takeoff', categoryId: null },
  { id: 'a-other', tenantId: 't2', isActive: true, name: 'Other salon', priceCents: 9900, durationMinutes: 30, serviceId: null, categoryId: null },
];
const SERVICES: Row[] = [
  { id: 's-takeoff', tenantId: 't1', categoryId: 'c-all' },
  { id: 's-mani', tenantId: 't1', categoryId: 'c-hand' },
];

function makeSvc() {
  const seen: Row[] = [];
  const prisma = {
    serviceAddon: {
      findMany: async (q: Row) => {
        seen.push(q.where);
        return ADDONS.filter((a) => a.tenantId === q.where.tenantId && a.isActive === q.where.isActive && q.where.id.in.includes(a.id));
      },
    },
    service: {
      findMany: async (q: Row) => SERVICES.filter((s) => s.tenantId === q.where.tenantId && q.where.id.in.includes(s.id)).map((s) => ({ id: s.id, categoryId: s.categoryId })),
    },
  };
  const svc = new WalkinsService(prisma as never, {} as never, {} as never);
  return { svc, seen };
}

const line = (over: Partial<LegItem>): LegItem => ({ lineId: 'L1', serviceId: 's-takeoff', name: 'Take Off Only', priceCents: 2000, durationMinutes: 15, staffId: 'tech1', zone: 'HAND', ...over } as LegItem);

describe('add-on lines on a walk-in ticket', () => {
  it('rides on the service it belongs to, at list price, with that technician, worth no turn', async () => {
    const { svc } = makeSvc();
    const out = await svc.addonLines('t1', ['a-art'], [line({})]);
    expect(out).toEqual([expect.objectContaining({ kind: 'addon', forLineId: 'L1', serviceId: 'a-art', name: 'Vẽ móng', priceCents: 1500, durationMinutes: 15, staffId: 'tech1', turnValue: 0 })]);
  });

  it('a category add-on goes to the service of that category; a menu-wide one to the first service', async () => {
    const { svc } = makeSvc();
    const parents = [line({}), line({ lineId: 'L2', serviceId: 's-mani', name: 'Manicure', staffId: 'tech2' })];
    const out = await svc.addonLines('t1', ['a-gel', 'a-all'], parents);
    expect(out.map((o) => [o.serviceId, o.forLineId])).toEqual([['a-gel', 'L2'], ['a-all', 'L1']]);
  });

  it('drops an add-on whose service is not on the ticket, an inactive one, and another salon\'s', async () => {
    const { svc, seen } = makeSvc();
    const out = await svc.addonLines('t1', ['a-gel', 'a-off', 'a-other'], [line({})]);
    expect(out).toEqual([]);
    expect(seen.every((w) => w.tenantId === 't1')).toBe(true);
  });

  it('salon B asking for salon A\'s add-on gets nothing', async () => {
    const { svc } = makeSvc();
    expect(await svc.addonLines('t2', ['a-art'], [line({})])).toEqual([]);
  });

  it('an add-on is never the parent of another add-on', async () => {
    const { svc } = makeSvc();
    const onlyAddon = line({ lineId: 'X', serviceId: 'a-art', kind: 'addon' });
    expect(await svc.addonLines('t1', ['a-all'], [onlyAddon])).toEqual([]);
  });
});
