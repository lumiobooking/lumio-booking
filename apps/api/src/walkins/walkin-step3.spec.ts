/**
 * Walk-in 2.0, step 3 — "about how long?", calling a customer, the "your
 * turn is coming" text, no-shows, and the end-of-day review. Rules off by
 * default; every read and write stays inside one salon.
 */
jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  return {
    ...actual,
    WalkInStatus: actual.WalkInStatus ?? { WAITING: 'WAITING', SERVING: 'SERVING', DONE: 'DONE', CANCELLED: 'CANCELLED' },
  };
});
import { WalkinsService } from './walkins.service';
import { queueEstimates, startsIn, waitEstimate } from './wait-estimate';
import { calledTooLong, cleanDeskPolicy, pruneCalled, turnSoonSms, upcomingToNotify, yourTurnSms } from './desk-policy';
import { dayReview, waitedMinutes } from './day-review';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const NOW = new Date('2026-10-17T20:00:00Z');

describe('about how long', () => {
  it('a free chair and nobody ahead is "now"; otherwise a 5-minute range', () => {
    expect(waitEstimate({ techFreeIn: [0, 20], aheadMinutes: [] })).toEqual({ min: 0, max: 0 });
    expect(startsIn({ techFreeIn: [0, 20], aheadMinutes: [45] })).toBe(20);
    expect(waitEstimate({ techFreeIn: [0, 20], aheadMinutes: [45] })).toEqual({ min: 20, max: 25 });
    expect(waitEstimate({ techFreeIn: [], aheadMinutes: [] })).toBeNull();
  });
  it('down the queue, each customer waits for the ones ahead', () => {
    const est = queueEstimates([10, 30], [40, 50, 30]);
    expect(est.map((e) => e && e.min)).toEqual([10, 30, 50]);
  });
});

describe('calling and texting', () => {
  it('the rules are off by default, and clean their numbers', () => {
    expect(cleanDeskPolicy(null)).toMatchObject({ notifyAhead: 0, noShowMin: 0 });
    expect(cleanDeskPolicy({ notifyAhead: 9, noShowMin: -3 })).toMatchObject({ notifyAhead: 5, noShowMin: 0 });
  });
  it('"your turn is coming": people ahead ≤ N, with a phone, once', () => {
    const q = [{ id: 'a', phone: '+1' }, { id: 'b', phone: null }, { id: 'c', phone: '+3' }, { id: 'd', phone: '+4' }];
    expect(upcomingToNotify(q, 2, ['a'])).toEqual(['c']);
    expect(upcomingToNotify(q, 0, [])).toEqual([]);
  });
  it('called too long ago and still waiting = no-show; the called list keeps only who still waits', () => {
    const called = { a: { at: '2026-10-17T19:50:00Z' }, b: { at: '2026-10-17T19:58:00Z' }, gone: { at: '2026-10-17T10:00:00Z' } };
    expect(calledTooLong(called, ['a', 'b'], NOW, 5)).toEqual(['a']);
    expect(calledTooLong(called, ['a', 'b'], NOW, 0)).toEqual([]);
    expect(Object.keys(pruneCalled(called, ['a']))).toEqual(['a']);
    expect(yourTurnSms('Glow', true)).toMatch(/^Glow: Tới lượt/);
    expect(turnSoonSms('Glow', false)).toMatch(/^Glow: You're almost up/);
  });
});

describe('the salon floor, step 3', () => {
  function build(policy: Row | null) {
    const rows: Row[] = [
      { id: 'w1', tenantId: 't1', status: 'WAITING', phone: '+15125550001', createdAt: new Date(NOW.getTime() - 20 * 60000), items: [] },
      { id: 'w2', tenantId: 't1', status: 'WAITING', phone: '+15125550002', createdAt: new Date(NOW.getTime() - 10 * 60000), items: [] },
      { id: 'x1', tenantId: 't2', status: 'WAITING', phone: '+15125559999', createdAt: new Date(NOW.getTime() - 30 * 60000), items: [] },
    ];
    const settings: Row[] = policy ? [{ tenantId: 't1', key: 'desk_policy', value: policy }] : [];
    const texts: Row[] = [];
    const audits: Row[] = [];
    const prisma: Row = {
      walkIn: {
        findFirst: async ({ where }: Row) => rows.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null,
        findMany: async ({ where }: Row) => rows.filter((r) => (!where.tenantId || r.tenantId === where.tenantId) && (!where.status || r.status === where.status))
          .sort((a, b) => a.createdAt - b.createdAt),
        updateMany: async ({ where, data }: Row) => { for (const r of rows) if (r.id === where.id && r.tenantId === where.tenantId && (!where.status || r.status === where.status)) Object.assign(r, data); return { count: 1 }; },
      },
      setting: {
        findUnique: async ({ where }: Row) => settings.find((x) => x.tenantId === where.tenantId_key.tenantId && x.key === where.tenantId_key.key) ?? null,
        upsert: async ({ where, create, update }: Row) => {
          const cur = settings.find((x) => x.tenantId === where.tenantId_key.tenantId && x.key === where.tenantId_key.key);
          if (cur) Object.assign(cur, update); else settings.push({ ...create });
          return {};
        },
      },
      tenant: { findUnique: async () => ({ name: 'Glow Nails', market: 'US', timezone: 'America/Chicago' }) },
    };
    const notifications = { send: async (a: Row) => { texts.push(a); return { status: 'SENT' }; } };
    const svc = new WalkinsService(prisma as never, {} as never, {} as never, undefined, { log: async (a: Row) => { audits.push(a); } } as never, notifications as never);
    (svc as unknown as Row).row = async (_t: string, id: string) => rows.find((r) => r.id === id);
    return { svc, rows, settings, texts, audits };
  }
  const desk = { userId: 'u1', tenantId: 't1', role: 'SALON_ADMIN' } as never;

  it('calling a customer texts her, marks the time under this salon, and audits', async () => {
    const { svc, settings, texts, audits } = build(null);
    const r = await svc.callCustomer(desk, 'w1');
    expect(r.sms).toBe(true);
    expect(texts[0]).toMatchObject({ tenantId: 't1', recipient: '+15125550001', relatedId: 'w1' });
    expect(texts[0].body).toMatch(/^Glow Nails: It's your turn/);
    expect(settings.find((x) => x.key === 'walkin_called')).toMatchObject({ tenantId: 't1' });
    expect(audits[0]).toMatchObject({ action: 'walkin.called', resourceId: 'w1' });
    await expect(svc.callCustomer(desk, 'x1')).rejects.toThrow('Walk-in not found');
  });

  it('no-show leaves the queue (kept as cancelled, audited)', async () => {
    const { svc, rows, audits } = build(null);
    await svc.noShow(desk, 'w2');
    expect(rows[1].status).toBe('CANCELLED');
    expect(audits[0]).toMatchObject({ action: 'walkin.no_show', metadata: { auto: false } });
  });

  it('"your turn is coming": off by default; on → one text each, this salon only', async () => {
    const off = build(null);
    expect(await off.svc.notifyUpcoming('t1')).toBe(0);
    const on = build({ notifyAhead: 1 });
    expect(await on.svc.notifyUpcoming('t1')).toBe(2);
    expect(on.texts.map((t) => t.recipient)).toEqual(['+15125550001', '+15125550002']);
    expect(await on.svc.notifyUpcoming('t1')).toBe(0); // not twice
    expect(on.texts.every((t) => t.tenantId === 't1')).toBe(true);
  });

  it('auto no-show only when the rule is on and the call is old enough', async () => {
    const { svc, rows, settings } = build({ noShowMin: 5 });
    settings.push({ tenantId: 't1', key: 'walkin_called', value: { w1: { at: new Date(NOW.getTime() - 6 * 60000).toISOString() }, w2: { at: new Date(NOW.getTime() - 60000).toISOString() } } });
    expect(await svc.autoNoShow('t1', NOW)).toBe(1);
    expect(rows.map((r) => r.status)).toEqual(['CANCELLED', 'WAITING', 'WAITING']);
  });
});

describe('end of day', () => {
  const t = (o: Row): Row => ({ customerName: o.id, awaitingPayment: false, createdAt: '2026-10-17T15:00:00Z', assignedAt: '2026-10-17T15:10:00Z', doneAt: '2026-10-17T16:00:00Z', assignedStaffId: 'elena', serviceId: null, items: [{ serviceId: 's1', priceCents: 4000, startedAt: '2026-10-17T15:12:00Z', staffId: 'elena' }], ...o });
  it('lists what needs a hand — no service first, then unpaid, then still open — and the day\'s numbers', () => {
    const r = dayReview({
      tickets: [
        t({ id: 'paid', status: 'DONE' }) as never,
        t({ id: 'unpaid', status: 'SERVING', awaitingPayment: true }) as never,
        t({ id: 'nosvc', status: 'SERVING', awaitingPayment: true, items: [] }) as never,
        t({ id: 'open', status: 'WAITING', assignedAt: null, items: [] }) as never,
        t({ id: 'closed', status: 'DONE', items: [] }) as never,
        t({ id: 'left', status: 'CANCELLED' }) as never,
      ],
      settledIds: new Set(['paid']),
      closedUnpaid: [{ walkInId: 'closed', reason: 'paid_elsewhere', note: null, at: '2026-10-17T17:00:00Z', userId: 'u1' }],
      overrides: [{ walkInId: 'paid', suggested: 'tai', chosen: 'elena', reason: 'customer_request', at: '2026-10-17T15:10:00Z', userId: 'u1' }],
      noShowIds: new Set(['left']),
    });
    expect(r.issues.map((i) => `${i.kind}:${i.id}`)).toEqual(['no_service:nosvc', 'unpaid:unpaid', 'open:open']);
    expect(r.totals).toMatchObject({ tickets: 6, done: 2, cancelled: 1, noShows: 1, serviceCents: 4000, avgWaitMin: 11, longestWaitMin: 12 });
    expect(waitedMinutes(t({ id: 'x', status: 'DONE' }) as never)).toBe(12);
  });
});
