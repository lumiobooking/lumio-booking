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
    expect(lan.cells['2026-11-27']).toMatchObject({ received: 2, turns: 2, answered: 1, onTime: 1, lost: 1, declined: 0, contact: 1, booked: 1, medianSec: 120 });
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
    expect(csv).toContain('2026-11-27,Lan,2,2,1,1,120,1,0,0,1,1,50');
    expect(csv).toContain('"Mai, B"');
    expect(csv).toContain('TỔNG TIỆM');
  });
});

describe('rt245 rating against the team', () => {
  const t = (o: Partial<{ received: number; turns: number; onTime: number; answered: number; lost: number; declined: number; booked: number }>) => ({ received: 0, turns: 0, onTime: 0, answered: 0, lost: 0, declined: 0, booked: 0, ...o });
  it('too few turns: not judged', () => expect(rate(t({ received: 5, turns: 5, lost: 5 }), 20).rating).toBe('few'));
  it('fast, keeps turns, books above the team: good', () => expect(rate(t({ received: 20, turns: 20, onTime: 18, answered: 20, lost: 1, booked: 6 }), 20).rating).toBe('good'));
  it('slow and lets turns go: weak with reasons', () => {
    const x = rate(t({ received: 20, turns: 20, onTime: 5, answered: 8, lost: 12 }), 20);
    expect(x.rating).toBe('weak');
    expect(x.reasons).toEqual(expect.arrayContaining(['slow', 'lost', 'lowConv']));
  });
  it('fine on time but books half the team rate: weak, low conversion', () => {
    expect(rate(t({ received: 40, turns: 40, onTime: 36, answered: 40, booked: 3 }), 20)).toEqual({ rating: 'weak', reasons: ['lowConv'] });
  });
  it('rt248: declining is not "slow"; declining most turns is its own reason', () => {
    // 20 turns, 10 declined at once, the 10 kept all answered on time.
    expect(rate(t({ received: 20, turns: 20, declined: 10, onTime: 10, answered: 10, booked: 4 }), 20).reasons).not.toContain('slow');
    expect(rate(t({ received: 20, turns: 20, declined: 12, onTime: 8, answered: 8, booked: 4 }), 20).reasons).toContain('declines');
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
      salesLead: { findMany: jest.fn(async () => []) },
      $queryRaw: jest.fn(async () => []),
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

describe('rt248 turn rules the report follows', () => {
  const now = at('2026-11-27T10:00:00Z');
  const base = { grain: 'day' as const, tz: TZ, now, bookings: [], limitMins: () => 5 };
  const threads = [{ id: 'x', createdAt: at('2026-11-27T01:00:00Z'), customerId: null }, { id: 'y', createdAt: at('2026-11-27T01:00:00Z'), customerId: null, hasContact: true }];

  it('answering a customer nobody held is "tự nhận", not a turn and not a 0-second answer', () => {
    const r = leadReport({ ...base, threads, logs: [log('x', 'trang', 'took-by-reply', '2026-11-27T02:00:00Z'), log('x', 'trang', 'first-reply', '2026-11-27T02:00:00Z')] });
    expect(r.people[0].cells['2026-11-27']).toMatchObject({ turns: 0, selfTaken: 1, answered: 0, medianSec: null });
  });

  it('the customer writing back to the holder is a new turn — a pass after it is counted against a turn', () => {
    const r = leadReport({ ...base, threads, logs: [
      log('x', 'lan', 'round-robin', '2026-11-27T02:00:00Z'),
      log('x', 'lan', 'first-reply', '2026-11-27T02:01:00Z'),
      log('x', 'lan', 'customer-back', '2026-11-27T03:00:00Z'),
      log('x', 'mai', 'reassign-unreplied', '2026-11-27T03:06:00Z', 'lan'),
    ] });
    const c = r.people.find((p) => p.userId === 'lan')!.cells['2026-11-27'];
    expect(c).toMatchObject({ received: 1, turns: 2, answered: 1, lost: 1 });
    expect(r.people.find((p) => p.userId === 'lan')!.total.lostPct).toBe(50);
  });

  it('"Không nhận" is counted as declined, not as a turn lost', () => {
    const r = leadReport({ ...base, threads, logs: [log('x', 'lan', 'round-robin', '2026-11-27T02:00:00Z'), log('x', 'mai', 'skip', '2026-11-27T02:00:20Z', 'lan')] });
    expect(r.people.find((p) => p.userId === 'lan')!.cells['2026-11-27']).toMatchObject({ turns: 1, declined: 1, lost: 0 });
    expect(r.people.find((p) => p.userId === 'mai')!.cells['2026-11-27']).toMatchObject({ turns: 1 });
  });

  it('a phone typed in the chat counts as "có SĐT" even with no customer record', () => {
    const r = leadReport({ ...base, threads, logs: [log('y', 'lan', 'round-robin', '2026-11-27T02:00:00Z')] });
    expect(r.people[0].cells['2026-11-27'].contact).toBe(1);
    expect(r.company['2026-11-27'].withContact).toBe(1);
  });

  it('follow-up give-outs are not turns', () => {
    const r = leadReport({ ...base, threads, logs: [log('x', 'lan', 'prospect', '2026-11-27T02:00:00Z'), log('x', 'lan', 'first-reply', '2026-11-27T02:30:00Z')] });
    expect(r.people).toHaveLength(0);
  });
});

describe('rt248 "Không nhận" in the inbox', () => {
  function setup(o: { answered?: boolean } = {}) {
    const threads = [
      { tenantId: 'A', id: 'a1', customerId: null, assignedUserId: 'lan', assignedAt: new Date(Date.now() - 60_000), assignHops: 0, status: 'open' },
      { tenantId: 'B', id: 'b1', customerId: null, assignedUserId: 'bao', assignedAt: new Date(Date.now() - 60_000), assignHops: 0, status: 'open' },
    ];
    const audits: Record<string, unknown>[] = [];
    const prisma = {
      messengerThread: { findFirst: jest.fn(async ({ where }: { where: { id: string; tenantId: string } }) => threads.find((t) => t.id === where.id && t.tenantId === where.tenantId) ?? null) },
      chatAssignmentLog: { findFirst: jest.fn(async () => (o.answered ? { id: 'r' } : null)) },
      auditLog: { create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); return {}; }) },
    };
    const svc = new ChatTurnsService(prisma as never, { publish: jest.fn() } as never);
    const route = jest.spyOn(svc, 'route').mockImplementation(async () => 'mai');
    return { svc, route, audits };
  }

  it('the holder releases it at once; it goes to the next person (logged as a decline)', async () => {
    const { svc, route, audits } = setup();
    const r = await svc.decline({ userId: 'lan', tenantId: 'A', role: 'STAFF' } as never, 'a1');
    expect(r).toEqual({ ok: true, to: 'mai' });
    expect(route).toHaveBeenCalledWith('A', 'a1', null, { excludeUserId: 'lan', reason: 'skip' });
    expect(audits[0]).toMatchObject({ tenantId: 'A', action: 'messenger.turn_declined' });
  });

  it('not someone else\'s customer, not after answering, never another salon\'s', async () => {
    const { svc, route } = setup();
    await expect(svc.decline({ userId: 'mai', tenantId: 'A', role: 'STAFF' } as never, 'a1')).rejects.toThrow(/không phải khách của bạn/);
    await expect(svc.decline({ userId: 'lan', tenantId: 'A', role: 'STAFF' } as never, 'b1')).rejects.toThrow(/Không tìm thấy/);
    expect(route).not.toHaveBeenCalled();
    const s2 = setup({ answered: true });
    await expect(s2.svc.decline({ userId: 'lan', tenantId: 'A', role: 'STAFF' } as never, 'a1')).rejects.toThrow(/đã trả lời/);
  });
});
