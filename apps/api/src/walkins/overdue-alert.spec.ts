/**
 * The desk's phones buzz when a chair runs late, once per visit, and when the
 * sweeper parks visits at the till — only the people who run the floor, and
 * only in their own salon.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    WalkInStatus: actual.WalkInStatus ?? { WAITING: 'WAITING', SERVING: 'SERVING', DONE: 'DONE', CANCELLED: 'CANCELLED' },
    UserRole: actual.UserRole ?? { SUPER_ADMIN: 'SUPER_ADMIN', SALON_ADMIN: 'SALON_ADMIN', STAFF: 'STAFF' },
  };
});
import { WalkinsService } from './walkins.service';
import { deskUserIds, lateAlert, newlyLate, parkedAlert, rememberWarned, LATE_WARNED_KEY, NamedTicket } from './overdue-alert';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const NOW = new Date('2026-10-07T20:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60000).toISOString();
const ticket = (id: string, startedMinAgo: number, tenantId = 't1', name: string | null = 'Anna'): NamedTicket & Row => ({
  id, tenantId, status: 'SERVING', assignedStaffId: 's', createdAt: ago(200), assignedAt: ago(startedMinAgo), awaitingPayment: false, customerName: name,
  items: [{ lineId: 'l0', legId: 'leg0', serviceId: 's0', name: 'Gel', priceCents: 4000, durationMinutes: 60, zone: 'HAND', legStatus: 'SERVING', staffId: 'tech', startedAt: ago(startedMinAgo) }],
});

describe('which visits to warn about', () => {
  it('from +15′ until the sweeper takes over at +45′, once each, most late first', () => {
    const out = newlyLate([ticket('a', 60 + 14), ticket('b', 60 + 20), ticket('c', 60 + 30), ticket('d', 60 + 45), ticket('e', 60 + 25)], NOW, ['e']);
    expect(out.map((x) => x.id)).toEqual(['c', 'b']);
    expect(out[0]).toEqual({ id: 'c', name: 'Anna', over: 30 });
  });
  it('a nameless walk-in still reads as someone', () => {
    expect(newlyLate([ticket('x', 80, 't1', null)], NOW, [])[0].name).toBe('Walk-in');
  });
  it('remembers warned ids without duplicates, capped', () => {
    expect(rememberWarned(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(rememberWarned('junk', ['a'])).toEqual(['a']);
    expect(rememberWarned(Array.from({ length: 400 }, (_, i) => `x${i}`), ['new']).length).toBe(300);
  });
  it('messages', () => {
    expect(lateAlert([])).toBeNull();
    expect(parkedAlert([])).toBeNull();
    expect(lateAlert([{ id: 'a', name: 'Anna', over: 18 }])).toMatchObject({ body: 'Anna +18′', url: '/salon/front-desk', tag: 'walkin-late' });
    expect(parkedAlert(['A', 'B', 'C', 'D'])!.body).toContain('A, B, C +1');
  });
});

describe('who is woken', () => {
  it('owners and desk logins, never technicians', () => {
    const ids = deskUserIds([{ id: 'owner' }], [
      { userId: 'tech', staffRole: 'TECHNICIAN', permissions: null },
      { userId: 'tech2', staffRole: 'TECHNICIAN', permissions: ['walkins'] },
      { userId: 'desk', staffRole: 'RECEPTIONIST', permissions: null },
      { userId: 'mgr', staffRole: 'MANAGER', permissions: null },
      { userId: 'nofloor', staffRole: 'RECEPTIONIST', permissions: ['customers'] },
      { userId: null, staffRole: 'MANAGER', permissions: null },
    ]);
    expect(ids).toEqual(expect.arrayContaining(['owner', 'desk', 'mgr']));
    expect(ids).not.toContain('tech');
    expect(ids).not.toContain('tech2');
    expect(ids).not.toContain('nofloor');
  });
});

describe('the sweep pushes to its own salon only', () => {
  function make(tickets: Row[]) {
    const sent: Row[] = [];
    const settings: Row = {};
    const reads: Row[] = [];
    const prisma: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
      walkIn: {
        findMany: async ({ where }: Row) => tickets.filter((t) => t.tenantId === where.tenantId && t.status === where.status && t.awaitingPayment === where.awaitingPayment),
        updateMany: async () => ({ count: 0 }),
      },
      setting: {
        findUnique: async ({ where }: Row) => { reads.push(where); const v = settings[`${where.tenantId_key.tenantId}:${where.tenantId_key.key}`]; return v ? { value: v } : null; },
        upsert: async ({ where, create }: Row) => { settings[`${where.tenantId_key.tenantId}:${where.tenantId_key.key}`] = create.value; return {}; },
      },
      user: { findMany: async ({ where }: Row) => { reads.push(where); return where.tenantId === 't1' ? [{ id: 'owner1' }] : [{ id: 'owner2' }]; } },
      staffMember: { findMany: async ({ where }: Row) => { reads.push(where); return []; } },
      tenant: { findUnique: async () => ({ timezone: 'UTC' }) },
    };
    const push = { sendToTenant: jest.fn(async (tenantId: string, payload: Row, opts: Row) => { sent.push({ tenantId, payload, opts }); }) };
    const svc = new WalkinsService(prisma, {} as never, { getBookingRules: async () => ({ businessHours: [] }) } as never, push as never);
    (svc as unknown as { settle: () => Promise<void> }).settle = async () => undefined;
    return { svc, sent, settings, reads };
  }

  it('warns once per late visit, to the desk of that salon', async () => {
    const { svc, sent, settings, reads } = make([ticket('a', 80, 't1'), ticket('z', 80, 't2', 'Other salon')]);
    await svc.parkStale('t1', NOW);
    expect(sent).toHaveLength(1);
    expect(sent[0].tenantId).toBe('t1');
    expect(sent[0].opts.onlyUserIds).toEqual(['owner1']);
    expect(sent[0].payload.body).toContain('Anna');
    expect(sent[0].payload.body).not.toContain('Other salon');
    expect(settings[`t1:${LATE_WARNED_KEY}`]).toEqual({ ids: ['a'] });
    expect(reads.every((w) => (w.tenantId ?? w.tenantId_key?.tenantId) === 't1')).toBe(true);
    await svc.parkStale('t1', NOW);
    expect(sent).toHaveLength(1); // already warned
  });

  it('tells the desk when it parks a visit at the till', async () => {
    const { svc, sent } = make([ticket('a', 60 + 50, 't1', 'Bella')]);
    const parked = await svc.parkStale('t1', NOW);
    expect(parked).toEqual(['a']);
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.tag).toBe('walkin-parked');
    expect(sent[0].payload.body).toContain('Bella');
  });
});
