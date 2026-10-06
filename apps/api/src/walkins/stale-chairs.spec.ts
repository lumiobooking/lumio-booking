/**
 * "anna nguy · Sang · 107′" on a 60-minute service, and the board kept Sang
 * busy all afternoon. The visit now says how late it is, and the sweeper
 * parks it at the till — in its own salon only.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    WalkInStatus: actual.WalkInStatus ?? { WAITING: 'WAITING', SERVING: 'SERVING', DONE: 'DONE', CANCELLED: 'CANCELLED' },
  };
});
import { WalkinsService } from './walkins.service';
import { isStale, overdueMinutes, staleAfterHours, STALE_GRACE_MIN, TicketLike } from './walkin-legs';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const NOW = new Date('2026-10-04T20:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60000).toISOString();

function ticket(o: { id?: string; tenantId?: string; startedMinAgo: number; minutes?: number; legs?: { startedMinAgo: number; minutes: number; status?: string }[]; awaitingPayment?: boolean; status?: string }): TicketLike & Row {
  const legs = o.legs ?? [{ startedMinAgo: o.startedMinAgo, minutes: o.minutes ?? 60 }];
  return {
    id: o.id ?? 'w1', tenantId: o.tenantId ?? 't1', status: o.status ?? 'SERVING', assignedStaffId: 'sang', createdAt: ago(200), assignedAt: ago(o.startedMinAgo),
    awaitingPayment: o.awaitingPayment ?? false,
    items: legs.map((l, i) => ({ lineId: `l${i}`, legId: `leg${i}`, serviceId: `s${i}`, name: 'Builder', priceCents: 7500, durationMinutes: l.minutes, zone: i ? 'FOOT' : 'HAND', legStatus: l.status ?? 'SERVING', staffId: `tech${i}`, startedAt: ago(l.startedMinAgo) })),
  };
}

describe('how late a visit is', () => {
  it('107 minutes into a 60-minute service is 47 over', () => {
    expect(overdueMinutes(ticket({ startedMinAgo: 107 }), NOW)).toBe(47);
    expect(overdueMinutes(ticket({ startedMinAgo: 30 }), NOW)).toBe(-30);
  });
  it('nothing to say about a visit at the till, or one with no running leg', () => {
    expect(overdueMinutes(ticket({ startedMinAgo: 107, awaitingPayment: true }), NOW)).toBeNull();
    expect(overdueMinutes(ticket({ startedMinAgo: 107, legs: [{ startedMinAgo: 107, minutes: 60, status: 'DONE' }] }), NOW)).toBeNull();
  });
  it('a line without a duration is assumed to take an hour, not zero', () => {
    expect(overdueMinutes(ticket({ startedMinAgo: 90, minutes: 0 }), NOW)).toBe(30);
  });
  it('stale only when EVERY running leg is past its time by the grace period', () => {
    expect(isStale(ticket({ startedMinAgo: 60 + STALE_GRACE_MIN }), NOW)).toBe(true);
    expect(isStale(ticket({ startedMinAgo: 60 + STALE_GRACE_MIN - 1 }), NOW)).toBe(false);
    // Hands finished long ago, feet started ten minutes ago: still on the floor.
    expect(isStale(ticket({ startedMinAgo: 0, legs: [{ startedMinAgo: 150, minutes: 45 }, { startedMinAgo: 10, minutes: 45 }] }), NOW)).toBe(false);
  });
});

describe('the sweeper parks stale visits at the till, per salon', () => {
  function make(tickets: Row[], o: { closeMinutes?: number; tz?: string } = {}) {
    const updates: Row[] = [];
    const prisma: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
      walkIn: {
        findMany: async ({ where, distinct, select }: Row) => {
          let rows = tickets.filter((t) => (!where.tenantId || t.tenantId === where.tenantId) && t.status === where.status && t.awaitingPayment === where.awaitingPayment);
          if (distinct) { const seen = new Set<string>(); rows = rows.filter((r) => !seen.has(r.tenantId) && seen.add(r.tenantId)); }
          return select?.tenantId && !select.id ? rows.map((r) => ({ tenantId: r.tenantId })) : rows;
        },
        updateMany: async ({ where, data }: Row) => {
          updates.push(where);
          const hit = tickets.filter((t) => where.id.in.includes(t.id) && t.tenantId === where.tenantId);
          for (const t of hit) Object.assign(t, data);
          return { count: hit.length };
        },
      },
      tenant: { findUnique: async () => ({ timezone: o.tz ?? 'America/Chicago' }) },
    };
    const settings: any = { getBookingRules: async () => ({ businessHours: Array(7).fill({ closed: false, openMinutes: 9 * 60, closeMinutes: o.closeMinutes ?? 19 * 60 }) }) }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const svc = new WalkinsService(prisma, {} as never, settings);
    (svc as unknown as { settle: () => Promise<void> }).settle = async () => undefined;
    return { svc, updates };
  }

  it('parks the forgotten visit, leaves the one still within time, never touches the other salon', async () => {
    const mine = ticket({ id: 'late', startedMinAgo: 107 });
    const fresh = ticket({ id: 'fresh', startedMinAgo: 20 });
    const theirs = ticket({ id: 'theirs', tenantId: 't2', startedMinAgo: 300 });
    const { svc, updates } = make([mine, fresh, theirs]);
    // 15:00 in Chicago (20:00Z in October, UTC-5): well before closing.
    expect(await svc.parkStale('t1', NOW)).toEqual(['late']);
    expect(mine.awaitingPayment).toBe(true);
    expect(mine.stationId).toBeNull();
    expect(mine.status).toBe('SERVING'); // the bill is still open
    expect(fresh.awaitingPayment).toBe(false);
    expect(theirs.awaitingPayment).toBe(false);
    for (const u of updates) expect(u.tenantId).toBe('t1');
  });

  it('an hour after closing, a visit that has run its time goes to the till — no grace needed', async () => {
    const done = ticket({ id: 'done', startedMinAgo: 61 });
    const { svc } = make([done], { closeMinutes: 13 * 60 }); // closed at 1 PM; it is 3 PM
    expect(await svc.parkStale('t1', NOW)).toEqual(['done']);
    const { svc: open } = make([ticket({ id: 'done2', startedMinAgo: 61 })], { closeMinutes: 14 * 60 + 30 }); // closed at 2:30: not yet an hour
    expect(await open.parkStale('t1', NOW)).toEqual([]);
  });

  it('after closing, a customer seated a few minutes ago STAYS in the chair (her technician is busy)', async () => {
    // The screenshot: "ana · Hana · 5′" on a 60-minute massage, seated late at
    // night — the desk showed her under "Ready to pay" and Hana as free.
    const ana = ticket({ id: 'ana', startedMinAgo: 5 });
    const { svc } = make([ana], { closeMinutes: 13 * 60 });
    expect(await svc.parkStale('t1', NOW)).toEqual([]);
    expect(ana.awaitingPayment).toBe(false);
    expect(staleAfterHours(ana as TicketLike, NOW)).toBe(false);
    expect(staleAfterHours(ticket({ startedMinAgo: 60 }) as TicketLike, NOW)).toBe(true);
    // Hands done, feet still running: not before the feet are due.
    expect(staleAfterHours(ticket({ startedMinAgo: 0, legs: [{ startedMinAgo: 150, minutes: 45, status: 'DONE' }, { startedMinAgo: 10, minutes: 45 }] }) as TicketLike, NOW)).toBe(false);
  });

  it('the all-salons sweep visits each salon with its own tenantId', async () => {
    const a = ticket({ id: 'a', tenantId: 't1', startedMinAgo: 200 });
    const b = ticket({ id: 'b', tenantId: 't2', startedMinAgo: 200 });
    const { svc, updates } = make([a, b]);
    expect(await svc.parkStaleEverywhere(NOW)).toEqual({ tenants: 2, parked: 2 });
    expect(updates.map((u) => u.tenantId).sort()).toEqual(['t1', 't2']);
  });
});
