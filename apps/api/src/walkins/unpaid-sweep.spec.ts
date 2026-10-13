/**
 * "Chờ tính tiền · 37": visits parked at the till stayed there for days. Once
 * the salon's day has moved on they close as Done on their own day, with no
 * order — in their own salon only — and the board still lists them for the
 * till until a receipt settles them.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    WalkInStatus: actual.WalkInStatus ?? { WAITING: 'WAITING', SERVING: 'SERVING', DONE: 'DONE', CANCELLED: 'CANCELLED' },
  };
});
import { WalkinsService } from './walkins.service';
import { lastActivity, settledWalkIns, unpaidFromPastDays } from './unpaid-sweep';
import { turnsFromTickets, TicketLike } from './walkin-legs';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
// 09:00 on Oct 8 in Chicago (UTC-5).
const NOW = new Date('2026-10-08T14:00:00Z');
const chicago = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

function ticket(o: { id: string; tenantId?: string; at: string; legDone?: string | null; awaitingPayment?: boolean; status?: string; legs?: boolean }): TicketLike & Row {
  return {
    id: o.id, tenantId: o.tenantId ?? 't1', status: o.status ?? 'SERVING', assignedStaffId: 'lan',
    createdAt: o.at, assignedAt: o.at, doneAt: null, awaitingPayment: o.awaitingPayment ?? true,
    items: o.legs === false
      ? [{ lineId: 'l0', serviceId: 's0', name: 'Gel', priceCents: 3500, durationMinutes: 45, staffId: 'lan' }]
      : [{ lineId: 'l0', legId: 'leg0', serviceId: 's0', name: 'Gel', priceCents: 3500, durationMinutes: 45, zone: 'HAND', legStatus: 'SERVING', staffId: 'lan', startedAt: o.at, doneAt: o.legDone ?? null }],
  };
}

describe('which parked visits belong to an earlier day', () => {
  it('yesterday afternoon closes, this morning stays, a ticket still in a chair is not touched', () => {
    const y = ticket({ id: 'y', at: '2026-10-07T21:30:00Z' }); // 16:30 Oct 7 Chicago
    const late = ticket({ id: 'late', at: '2026-10-08T04:30:00Z' }); // 23:30 Oct 7 Chicago
    const today = ticket({ id: 'today', at: '2026-10-08T13:10:00Z' }); // 08:10 Oct 8
    const chair = ticket({ id: 'chair', at: '2026-10-06T20:00:00Z', awaitingPayment: false });
    const out = unpaidFromPastDays([y, late, today, chair], chicago(NOW), chicago);
    expect(out.map((c) => c.id)).toEqual(['y', 'late']);
    expect(out[0].doneAt.toISOString()).toBe('2026-10-07T21:30:00.000Z');
  });
  it('the close time is the last thing that happened on the visit, so its turn stays on its day', () => {
    const t = ticket({ id: 'a', at: '2026-10-07T20:00:00Z', legDone: '2026-10-07T20:50:00Z' });
    expect(lastActivity(t).toISOString()).toBe('2026-10-07T20:50:00.000Z');
    // A leg finished after midnight: the visit belongs to today and stays.
    const t2 = ticket({ id: 'b', at: '2026-10-08T04:40:00Z', legDone: '2026-10-08T05:20:00Z' });
    expect(unpaidFromPastDays([t2], chicago(NOW), chicago)).toEqual([]);
  });
  it('settled ids come from the ticket, the party list and line-by-line receipts', () => {
    const s = settledWalkIns([{ walkInId: 'a' }, { walkInIds: ['b', 'c'] }, { items: [{ walkInId: 'd' }, { walkInId: null }] }]);
    expect([...s].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('the sweep, per salon', () => {
  function make(tickets: Row[], orders: Row[] = []) {
    const updates: Row[] = [];
    const audits: Row[] = [];
    const prisma: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
      walkIn: {
        findMany: async ({ where, distinct, select }: Row) => {
          let rows = tickets.filter((t) => (!where.tenantId || t.tenantId === where.tenantId) && t.status === where.status && t.awaitingPayment === where.awaitingPayment
            && (!where.doneAt || (t.doneAt && t.doneAt >= where.doneAt.gte && t.doneAt < where.doneAt.lt)));
          if (distinct) { const seen = new Set<string>(); rows = rows.filter((r) => !seen.has(r.tenantId) && seen.add(r.tenantId)); }
          return select?.tenantId && !select.id ? rows.map((r) => ({ tenantId: r.tenantId })) : rows;
        },
        updateMany: async ({ where, data }: Row) => {
          updates.push(where);
          const hit = tickets.filter((t) => where.id.in.includes(t.id) && t.tenantId === where.tenantId && t.status === where.status && t.awaitingPayment === where.awaitingPayment);
          for (const t of hit) Object.assign(t, data);
          return { count: hit.length };
        },
      },
      order: { findMany: async ({ where }: Row) => orders.filter((o) => o.tenantId === where.tenantId) },
      tenant: { findUnique: async () => ({ timezone: 'America/Chicago' }) },
    };
    const audit: any = { log: async (x: Row) => { audits.push(x); } }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const svc = new WalkinsService(prisma, {} as never, {} as never, undefined as never, audit);
    return { svc, updates, audits };
  }

  it('closes last week\'s parked visits as Done on their own day, no order, and never the other salon\'s', async () => {
    const old = ticket({ id: 'old', at: '2026-10-03T19:00:00Z' });
    const now1 = ticket({ id: 'now1', at: '2026-10-08T13:30:00Z' });
    const theirs = ticket({ id: 'theirs', tenantId: 't2', at: '2026-10-03T19:00:00Z' });
    const { svc, updates, audits } = make([old, now1, theirs]);
    expect(await svc.closeUnpaidPastDays('t1', NOW)).toEqual(['old']);
    expect(old.status).toBe('DONE');
    expect((old.doneAt as Date).toISOString()).toBe('2026-10-03T19:00:00.000Z');
    expect(now1.status).toBe('SERVING');
    expect(theirs.status).toBe('SERVING');
    for (const u of updates) expect(u.tenantId).toBe('t1');
    expect(audits).toEqual([expect.objectContaining({ tenantId: 't1', action: 'walkin.unpaid_closed', metadata: { count: 1, ids: ['old'] } })]);
  });

  it('a visit parked for days stops counting as a turn today once it is closed', async () => {
    const old = ticket({ id: 'old', at: '2026-10-03T19:00:00Z', legs: false });
    const startOfToday = new Date('2026-10-08T05:00:00Z');
    expect(turnsFromTickets([old as TicketLike], startOfToday).get('lan')).toBe(1); // the old bug
    const { svc } = make([old]);
    await svc.closeUnpaidPastDays('t1', NOW);
    expect(turnsFromTickets([old as TicketLike], startOfToday).get('lan')).toBeUndefined();
  });

  it('the all-salons sweep visits each salon with its own tenantId', async () => {
    const a = ticket({ id: 'a', tenantId: 't1', at: '2026-10-05T19:00:00Z' });
    const b = ticket({ id: 'b', tenantId: 't2', at: '2026-10-05T19:00:00Z' });
    const { svc, updates } = make([a, b]);
    expect(await svc.closeUnpaidEverywhere(NOW)).toEqual({ tenants: 2, closed: 2 });
    expect(updates.map((u) => u.tenantId).sort()).toEqual(['t1', 't2']);
  });

  it('the board lists closed-unpaid visits until a receipt settles them, in its own salon only', async () => {
    const today = new Date('2026-10-08T05:00:00Z');
    const a = { ...ticket({ id: 'a', at: '2026-10-06T19:00:00Z' }), status: 'DONE', doneAt: new Date('2026-10-06T19:30:00Z') };
    const paid = { ...ticket({ id: 'paid', at: '2026-10-06T19:00:00Z' }), status: 'DONE', doneAt: new Date('2026-10-06T19:30:00Z') };
    const ancient = { ...ticket({ id: 'ancient', at: '2026-09-01T19:00:00Z' }), status: 'DONE', doneAt: new Date('2026-09-01T19:30:00Z') };
    const theirs = { ...ticket({ id: 'theirs', tenantId: 't2', at: '2026-10-06T19:00:00Z' }), status: 'DONE', doneAt: new Date('2026-10-06T19:30:00Z') };
    const { svc } = make([a, paid, ancient, theirs], [{ tenantId: 't1', walkInIds: ['paid'] }, { tenantId: 't2', walkInId: 'a' }]);
    const list = await (svc as unknown as { unpaidEarlier: (t: string, d: Date) => Promise<Row[]> }).unpaidEarlier('t1', today);
    expect(list.map((w) => w.id)).toEqual(['a']);
  });
});
