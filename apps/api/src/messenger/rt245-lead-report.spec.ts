import { ChatTurnsService } from './chat-turns.service';
import { leadReport, leadReportCsv, periodKey, periodsBack, rate } from './lead-report';

const TZ = 'Asia/Ho_Chi_Minh';
const at = (iso: string) => new Date(iso);
const log = (threadId: string, userId: string | null, reason: string, iso: string, fromUserId: string | null = null) => ({ threadId, userId, fromUserId, reason, createdAt: at(iso) });

describe('rt245 periods in the salon time zone', () => {
  it('a chat at 23:30 UTC is the next day in Vietnam', () => {
    expect(periodKey(at('2026-11-26T23:30:00Z'), TZ, 'day')).toBe('2026-11-27');
    expect(periodKey(at('2026-11-26T23:30:00Z'), 'America/Los_Angeles', 'day')).toBe('2026-11-26');
  });
  it('weeks start Monday, months by calendar', () => {
    expect(periodKey(at('2026-11-27T05:00:00Z'), TZ, 'week')).toBe('2026-11-23');
    expect(periodKey(at('2026-11-23T05:00:00Z'), TZ, 'week')).toBe('2026-11-23');
    expect(periodKey(at('2026-11-22T05:00:00Z'), TZ, 'week')).toBe('2026-11-16');
    expect(periodKey(at('2026-11-27T05:00:00Z'), TZ, 'month')).toBe('2026-11');
  });
  it('lists the periods oldest first, across a year end', () => {
    const now = at('2026-11-27T05:00:00Z');
    expect(periodsBack(now, TZ, 'day')).toHaveLength(31);
    expect(periodsBack(now, TZ, 'day').at(-1)).toBe('2026-11-27');
    expect(periodsBack(now, TZ, 'month', 13)[0]).toBe('2025-11');
    expect(periodsBack(at('2027-01-05T05:00:00Z'), TZ, 'month', 3)).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});

describe('rt245 the report', () => {
  const now = at('2026-11-27T10:00:00Z');
  const threads = [
    { id: 't1', createdAt: at('2026-11-27T01:00:00Z'), customerId: 'c1' },
    { id: 't2', createdAt: at('2026-11-27T02:00:00Z'), customerId: null },
    { id: 't3', createdAt: at('2026-11-26T02:00:00Z'), customerId: 'c3' },
    { id: 't4', createdAt: at('2026-11-26T03:00:00Z'), customerId: null }, // AI only, nobody held it
  ];
  const logs = [
    log('t1', 'lan', 'round-robin', '2026-11-27T01:00:10Z'),
    log('t1', 'lan', 'first-reply', '2026-11-27T01:02:10Z'),
    log('t2', 'lan', 'round-robin', '2026-11-27T02:00:10Z'),
    log('t2', 'mai', 'reassign-unread', '2026-11-27T02:20:10Z', 'lan'),
    log('t2', 'mai', 'first-reply', '2026-11-27T02:21:10Z'),
    log('t3', 'mai', 'round-robin', '2026-11-26T02:00:10Z'),
    log('t3', 'mai', 'first-reply', '2026-11-26T02:40:10Z'),
  ];
  const bookings = [{ threadId: 't1', at: at('2026-11-27T03:00:00Z') }, { threadId: 't3', at: at('2026-11-26T05:00:00Z') }];
  const r = leadReport({ grain: 'day', tz: TZ, now, logs, threads, bookings, limitMins: () => 10 });

  it('counts each person per day: received, answered, on time, let go, phone, booked', () => {
    const lan = r.people.find((p) => p.userId === 'lan')!;
    expect(lan.cells['2026-11-27']).toMatchObject({ received: 2, answered: 1, onTime: 1, lost: 1, contact: 1, booked: 1, medianSec: 120 });
    const mai = r.people.find((p) => p.userId === 'mai')!;
    expect(mai.cells['2026-11-27']).toMatchObject({ received: 1, answered: 1, onTime: 1 });
    expect(mai.cells['2026-11-26']).toMatchObject({ received: 1, answered: 1, onTime: 0, booked: 1, contact: 1 });
  });

  it('the salon counts every new chat, AI-handled ones too', () => {
    expect(r.company['2026-11-26']).toEqual({ newChats: 2, withContact: 1, booked: 1, bookedByStaff: 1 });
    expect(r.company['2026-11-27']).toEqual({ newChats: 2, withContact: 1, booked: 1, bookedByStaff: 1 });
    expect(r.companyTotal.newChats).toBe(4);
  });

  it('the same data by week and month adds up', () => {
    const w = leadReport({ grain: 'week', tz: TZ, now, logs, threads, bookings, limitMins: () => 10 });
    expect(w.company['2026-11-23'].newChats).toBe(4);
    expect(w.people.find((p) => p.userId === 'mai')!.cells['2026-11-23'].received).toBe(2);
    const m = leadReport({ grain: 'month', tz: TZ, now, logs, threads, bookings, limitMins: () => 10 });
    expect(m.company['2026-11'].booked).toBe(2);
  });

  it('a booking goes to whoever held the chat at that moment', () => {
    const r2 = leadReport({ grain: 'day', tz: TZ, now, logs, threads, bookings: [{ threadId: 't2', at: at('2026-11-27T04:00:00Z') }], limitMins: () => 10 });
    expect(r2.people.find((p) => p.userId === 'mai')!.cells['2026-11-27'].booked).toBe(1);
    expect(r2.people.find((p) => p.userId === 'lan')!.cells['2026-11-27'].booked).toBe(0);
  });

  it('CSV has a row per person per period and the salon line', () => {
    const csv = leadReportCsv(r, new Map([['lan', 'Lan'], ['mai', 'Mai, B']]));
    expect(csv.split('\n')[0]).toContain('Khách nhận');
    expect(csv).toContain('2026-11-27,Lan,2,1,1,120,1,1,1,50');
    expect(csv).toContain('"Mai, B"');
    expect(csv).toContain('TỔNG TIỆM');
  });
});

describe('rt245 rating against the team', () => {
  it('too few chats: not judged', () => expect(rate({ received: 5, onTime: 0, answered: 0, lost: 5, booked: 0 }, 20).rating).toBe('few'));
  it('fast, keeps turns, books above the team: good', () => expect(rate({ received: 20, onTime: 18, answered: 20, lost: 1, booked: 6 }, 20).rating).toBe('good'));
  it('slow and lets turns go: weak with reasons', () => {
    const x = rate({ received: 20, onTime: 5, answered: 10, lost: 12, booked: 0 }, 20);
    expect(x.rating).toBe('weak');
    expect(x.reasons).toEqual(expect.arrayContaining(['slow', 'lost', 'lowConv']));
  });
  it('fine on time but books half the team rate: weak, low conversion', () => {
    expect(rate({ received: 40, onTime: 36, answered: 40, lost: 0, booked: 3 }, 20)).toEqual({ rating: 'weak', reasons: ['lowConv'] });
  });
});

describe('rt245 service: one salon only, staff see only themselves', () => {
  function setup() {
    const logs = [
      { tenantId: 'A', ...log('a1', 'lan', 'round-robin', new Date(Date.now() - 3600_000).toISOString()) },
      { tenantId: 'A', ...log('a2', 'mai', 'round-robin', new Date(Date.now() - 3600_000).toISOString()) },
      { tenantId: 'B', ...log('b1', 'bao', 'round-robin', new Date(Date.now() - 3600_000).toISOString()) },
    ];
    const threads = [
      { tenantId: 'A', id: 'a1', createdAt: new Date(Date.now() - 3700_000), customerId: null, adId: null, adAt: null },
      { tenantId: 'A', id: 'a2', createdAt: new Date(Date.now() - 3700_000), customerId: null, adId: null, adAt: null },
      { tenantId: 'B', id: 'b1', createdAt: new Date(Date.now() - 3700_000), customerId: null, adId: null, adAt: null },
    ];
    const seen: string[] = [];
    const prisma = {
      tenant: { findUnique: jest.fn(async () => ({ timezone: TZ })) },
      messengerConnection: { findUnique: jest.fn(async () => null) },
      chatAssignmentLog: { findMany: jest.fn(async ({ where }: { where: { tenantId: string } }) => { seen.push(where.tenantId); return logs.filter((l) => l.tenantId === where.tenantId); }) },
      messengerThread: { findMany: jest.fn(async ({ where }: { where: { tenantId: string; id?: { in: string[] } } }) => { seen.push(where.tenantId); return threads.filter((t) => t.tenantId === where.tenantId && (!where.id || where.id.in.includes(t.id))); }) },
      appointment: { findMany: jest.fn(async () => []) },
      user: { findMany: jest.fn(async ({ where }: { where: { tenantId: string; id: { in: string[] } } }) => [{ id: 'lan', firstName: 'Lan' }, { id: 'mai', firstName: 'Mai' }, { id: 'bao', firstName: 'Bảo' }].filter((u) => where.id.in.includes(u.id) && (where.tenantId === 'A' ? u.id !== 'bao' : u.id === 'bao')).map((u) => ({ ...u, lastName: null, email: 'x' }))) },
    };
    return { svc: new ChatTurnsService(prisma as never, { publish: jest.fn() } as never), seen };
  }

  it('the owner of A sees A\'s people and totals, never B\'s', async () => {
    const { svc, seen } = setup();
    const r = await svc.leadReportView({ userId: 'own', tenantId: 'A', role: 'SALON_ADMIN' } as never, 'week');
    expect(r.people.map((p) => p.name).sort()).toEqual(['Lan', 'Mai']);
    expect(r.companyTotal!.newChats).toBe(2);
    expect(seen.every((t) => t === 'A')).toBe(true);
  });

  it('a staff member sees only their own row and no salon totals', async () => {
    const { svc } = setup();
    const r = await svc.leadReportView({ userId: 'lan', tenantId: 'A', role: 'STAFF' } as never, 'day');
    expect(r.people.map((p) => p.userId)).toEqual(['lan']);
    expect(r.company).toBeNull();
    expect(r.companyTotal).toBeNull();
    expect(r.teamConvPct).toBeNull();
  });
});
