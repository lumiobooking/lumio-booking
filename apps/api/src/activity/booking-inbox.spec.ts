jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return { ...actual, AppointmentStatus: actual.AppointmentStatus?.PENDING ? actual.AppointmentStatus : { PENDING: 'PENDING', ASSIGNED: 'ASSIGNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' }, PaymentStatus: actual.PaymentStatus ?? { PAID: 'PAID' } };
});
import { buildInbox, isDeskSource, type InboxRow } from './booking-inbox';
import { ActivityService } from './activity.service';

const NOW = new Date('2026-10-28T15:00:00Z');
const h = (n: number) => new Date(NOW.getTime() + n * 3600_000);
let seq = 0;
function row(p: Partial<InboxRow>): InboxRow {
  seq += 1;
  return {
    id: `b${seq}`, status: 'PENDING', source: 'online', startTime: h(3), createdAt: h(-1), cancelledAt: null, cancelledBy: null,
    priceCents: 4500, currency: 'USD', addons: [], customer: { firstName: 'Anna', lastName: 'Nguyen' }, service: { name: 'Gel Manicure' }, assignedStaff: { firstName: 'Kim' },
    ...p,
  };
}

describe('header booking inbox — what goes in which tab', () => {
  it('a customer\'s online / bot booking still waiting → "Cần xác nhận"; the desk\'s own never', () => {
    const online = row({ source: 'online' });
    const bot = row({ source: 'messenger', status: 'ASSIGNED' });
    const deskMade = row({ source: 'admin' });
    const walk = row({ source: 'walkin' });
    const r = buildInbox([online, bot, deskMade, walk], [], NOW);
    expect(r.needs.map((x) => x.id).sort()).toEqual([online.id, bot.id].sort());
    expect(r.needs[0]).toMatchObject({ customer: expect.any(String), staff: 'Kim', priceCents: 4500 });
  });

  it('a visit long past is no longer something to confirm', () => {
    const old = row({ startTime: h(-3) });
    expect(buildInbox([old], [], NOW).needs).toHaveLength(0);
  });

  it('"Mới đặt": customer bookings of the last 48 h, not already in "Cần xác nhận", not cancelled', () => {
    const waiting = row({});
    const confirmed = row({ status: 'CONFIRMED', createdAt: h(-5) });
    const old = row({ status: 'CONFIRMED', createdAt: h(-60) });
    const deskMade = row({ status: 'CONFIRMED', source: 'staff' });
    const r = buildInbox([waiting], [waiting, confirmed, old, deskMade], NOW);
    expect(r.fresh.map((x) => x.id)).toEqual([confirmed.id]);
  });

  it('"Đã huỷ": cancelled by the customer / AI / system in 48 h — not the desk\'s own cancellations', () => {
    const byCustomer = row({ status: 'CANCELLED', cancelledAt: h(-1), cancelledBy: 'customer', createdAt: h(-200) });
    const byStaff = row({ status: 'CANCELLED', cancelledAt: h(-1), cancelledBy: 'staff' });
    const longAgo = row({ status: 'CANCELLED', cancelledAt: h(-80), cancelledBy: 'customer' });
    const r = buildInbox([], [byCustomer, byStaff, longAgo], NOW);
    expect(r.cancelled.map((x) => x.id)).toEqual([byCustomer.id]);
    expect(r.cancelled[0].at).toBe(h(-1).toISOString());
    expect(r.fresh).toHaveLength(0);
  });

  it('desk sources', () => {
    expect(['admin', 'Staff', 'manual', 'walkin', 'walk-in'].every(isDeskSource)).toBe(true);
    expect(['online', 'messenger', 'plugin', null, ''].some((s) => isDeskSource(s))).toBe(false);
  });
});

describe('header booking inbox — tenant isolation', () => {
  it('every query is fenced to the caller\'s salon', async () => {
    const calls: Record<string, unknown>[] = [];
    const prisma = { appointment: { findMany: jest.fn(async (a: { where: Record<string, unknown> }) => { calls.push(a.where); return []; }) } };
    const svc = new ActivityService(prisma as never);
    const r = await svc.inbox('tenant-a', NOW);
    expect(r).toEqual({ needs: [], fresh: [], cancelled: [] });
    expect(calls).toHaveLength(2);
    for (const w of calls) expect(w.tenantId).toBe('tenant-a');
  });

  it('cross-tenant: rows the database returns are only what the query asked for — salon B sees nothing of A', async () => {
    const a = row({});
    const all = [{ ...a, tenantId: 'tenant-a' }];
    const prisma = { appointment: { findMany: jest.fn(async ({ where }: { where: { tenantId: string } }) => all.filter((x) => x.tenantId === where.tenantId)) } };
    const svc = new ActivityService(prisma as never);
    expect((await svc.inbox('tenant-b', NOW)).needs).toHaveLength(0);
    expect((await svc.inbox('tenant-a', NOW)).needs.map((x) => x.id)).toEqual([a.id]);
  });
});
