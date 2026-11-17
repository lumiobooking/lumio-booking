import { fleetReport, pctl, replyTimes, stillWaiting, type FleetThread } from './ai-fleet';

const T0 = Date.parse('2026-11-17T02:00:00.000Z');
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
const U = (sec: number, content = 'hi') => ({ role: 'user', content, at: at(sec) });
const B = (sec: number, content = 'Hello!', extra: object = {}) => ({ role: 'assistant', content, at: at(sec), ...extra });
const from = new Date(T0 - 86_400_000); const to = new Date(T0 + 86_400_000);
const thread = (tenantId: string, history: object[], extra: object = {}): FleetThread =>
  ({ id: `${tenantId}-${Math.round(Math.random() * 1e9)}`, tenantId, channel: 'messenger', handoff: false, customerId: null, lastMessageAt: new Date(T0), history: history as never, ...extra });

describe('how long the customer waited for each AI reply', () => {
  it('is measured from their last message to the reply', () => {
    const r = replyTimes([U(0), U(3, 'how much?'), B(15), U(60), B(64, 'x', { ms: { w: 1500, t: 2200, s: 300 } })], from.getTime(), to.getTime());
    expect(r.sec).toEqual([12, 4]);
    expect([r.w, r.t, r.s]).toEqual([[1500], [2200], [300]]);
  });

  it('reads what happened INSIDE the working time where a reply carries it, and tolerates older replies that do not', () => {
    const r = replyTimes([
      U(0), B(6, 'x', { ms: { w: 1000, t: 3600, s: 500 } }),                                             // before 18/11: no steps
      U(60), B(65, 'x', { ms: { w: 100, t: 3400, s: 500, p: 300, m: 2000, j: 1000, k: 0, n: 1, r: 0 } }),
      U(120), B(132, 'x', { ms: { w: 100, t: 9800, s: 500, p: 300, m: 6000, j: 2200, k: 0, n: 2, r: 1 } }), // a draft sent back
    ], from.getTime(), to.getTime());
    expect(r.t).toEqual([3600, 3400, 9800]);
    expect(r.steps).toEqual([{ p: 300, m: 2000, j: 1000, k: 0, n: 1, r: 0 }, { p: 300, m: 6000, j: 2200, k: 0, n: 2, r: 1 }]);
    const rep = fleetReport({ salons: [{ id: 's1', name: 'S', slug: 's', botOn: true }], threads: [thread('s1', [
      U(60), B(65, 'x', { ms: { w: 100, t: 3400, s: 500, p: 300, m: 2000, j: 1000, k: 0, n: 1, r: 0 } }),
      U(120), B(132, 'x', { ms: { w: 100, t: 9800, s: 500, p: 300, m: 6000, j: 2200, k: 0, n: 2, r: 1 } }),
    ])], bookings: [], instructions: [], from, to, days: 1 });
    expect(rep.rows[0].steps).toEqual({ prepMs: 300, modelMs: 2000, checkMs: 1000, rewriteRate: 0.5, samples: 2 });
    // A salon whose replies carry no steps yet says so with null, never with zeros.
    const old = fleetReport({ salons: [{ id: 's1', name: 'S', slug: 's', botOn: true }], threads: [thread('s1', [U(0), B(6, 'x', { ms: { w: 1000, t: 3600, s: 500 } })])], bookings: [], instructions: [], from, to, days: 1 });
    expect(old.rows[0].steps).toBeNull();
    expect(old.rows[0].phases?.thinkMs).toBe(3600);
  });

  it('does not time a second bubble, a nudge, a survey question, a failed send or a person', () => {
    const r = replyTimes([
      U(0), B(10), B(11, 'second bubble'),
      U(100), B(105, 'x', { manual: true }),
      U(200), B(9000, 'nudge', { nudge: true }),
      U(300), B(305, 'x', { failed: true }),
      U(400), B(404, 'How was it?', { survey: 'ask' }),
    ], from.getTime(), to.getTime());
    expect(r.sec).toEqual([10]);
  });

  it('counts the apology the customer got when the AI failed', () => {
    const r = replyTimes([U(0), B(14, 'Dạ em xin lỗi, hệ thống đang hơi chậm một chút 🙏 Em đã chuyển tin nhắn của anh/chị cho nhân viên')], from.getTime(), to.getTime());
    expect(r.apologies).toBe(1);
  });

  it('ignores what is outside the period, and a gap too long to be a reply', () => {
    expect(replyTimes([U(0), B(5)], T0 + 3600_000, to.getTime()).sec).toEqual([]);
    expect(replyTimes([U(0), B(5000)], from.getTime(), to.getTime()).sec).toEqual([]);
    expect(replyTimes(null, 0, 1).sec).toEqual([]);
  });

  it('still waiting = the customer wrote last, more than half an hour ago', () => {
    expect(stillWaiting([B(0), U(10)], from.getTime(), T0 + 3600_000)).toBe(true);
    expect(stillWaiting([B(0), U(10)], from.getTime(), T0 + 600_000)).toBe(false);
    expect(stillWaiting([U(10), B(20)], from.getTime(), T0 + 3600_000)).toBe(false);
  });

  it('percentiles', () => {
    expect(pctl([], 0.5)).toBeNull();
    expect(pctl([14, 2, 12, 15, 38], 0.5)).toBe(14);
    expect(pctl([14, 2, 12, 15, 38], 0.9)).toBe(38);
  });
});

describe('the platform\'s AI health: one row of numbers per salon', () => {
  const salons = [
    { id: 'agency', name: 'Lumio Agency', slug: 'lumio-agency', botOn: true },
    { id: 'amy', name: "Amy's Lash", slug: 'amys', botOn: false },
    { id: 'quiet', name: 'Quiet Nails', slug: 'quiet', botOn: true },
  ];
  const threads = [
    thread('agency', [U(0, 'giá gói'), B(14), U(100), B(117), U(200), B(212), U(300), B(338, 'Dạ em xin lỗi, hệ thống đang hơi chậm một chút')]),
    thread('amy', [U(0, 'where are you located?')]),
  ];
  const rep = fleetReport({ salons, threads, bookings: [], instructions: [{ tenantId: 'agency', used: 988, blocked: 361 }, { tenantId: 'quiet', used: 5, blocked: 5 }], from, to, days: 7 });
  const row = (id: string) => rep.rows.find((r) => r.tenantId === id)!;

  it('speed, failures and blocked replies, per salon', () => {
    expect(row('agency').botReplies).toBe(4);
    expect(row('agency').medianSec).toBe(14);
    expect(row('agency').over15).toBe(2);
    expect(row('agency').apologies).toBe(1);
    expect(row('agency').blockRate).toBeCloseTo(0.365, 2);
    expect(row('agency').flags.sort()).toEqual(['blocked', 'errors', 'slow']);
  });

  it('a salon with the AI off while customers write is named; too few checks is not a block rate', () => {
    expect(row('amy').bot).toBe('off');
    expect(row('amy').conversations).toBe(1);
    expect(row('amy').flags).toEqual(['off']);
    expect(row('quiet').blockRate).toBeNull();
    expect(row('quiet').flags).toEqual([]);
  });

  it('salons that need attention come first; the totals add up', () => {
    expect(rep.rows.map((r) => r.tenantId)).toEqual(['agency', 'amy', 'quiet']);
    expect(rep.totals).toMatchObject({ salons: 3, botOn: 2, botOff: 1, conversations: 2, botReplies: 4, apologies: 1, medianSec: 14 });
  });

  it('ISOLATION: a salon\'s row is built from its own conversations only', () => {
    // The same thread ids and customers under another tenant change nothing for this one.
    const again = fleetReport({ salons, threads: [...threads, thread('quiet', [U(0), B(2), U(10), B(13)])], bookings: [{ tenantId: 'quiet', customerId: 'c1', createdAt: new Date(T0) }], instructions: [], from, to, days: 7 });
    const a = again.rows.find((r) => r.tenantId === 'agency')!;
    expect([a.botReplies, a.medianSec, a.conversations, a.booked]).toEqual([4, 14, 1, 0]);
    expect(again.rows.find((r) => r.tenantId === 'quiet')!.medianSec).toBe(2);
    // A thread whose tenant is not on the list is in nobody's row.
    const stray = fleetReport({ salons: [salons[0]], threads: [thread('someone-else', [U(0), B(1)])], bookings: [], instructions: [], from, to, days: 7 });
    expect(stray.rows[0].botReplies).toBe(0);
    expect(stray.totals.botReplies).toBe(0);
  });

  it('carries numbers only — no message text, no customer name', () => {
    const json = JSON.stringify(rep);
    expect(json).not.toContain('giá gói');
    expect(json).not.toContain('where are you located');
  });
});

import { BotReportService } from './bot-report.service';
import { SupportAiFleetController } from './support-ai-leaks.controller';

describe('the fleet report: service and endpoint', () => {
  const now = Date.now();
  const iso = (secAgo: number) => new Date(now - secAgo * 1000).toISOString();
  function build() {
    const audit: Record<string, unknown>[] = [];
    const prisma = {
      tenant: { findMany: async () => [{ id: 'a', name: 'Salon A', slug: 'a' }, { id: 'b', name: 'Salon B', slug: 'b' }, { id: 'c', name: 'No channel', slug: 'c' }] },
      messengerConnection: { findMany: async () => [{ tenantId: 'a', enabled: true }, { tenantId: 'b', enabled: false }] },
      appointment: { findMany: async () => [] },
      aiInstruction: { groupBy: async () => [{ tenantId: 'a', _sum: { usedCount: 100, blockedCount: 40 } }] },
      messengerThread: { findMany: async () => [
        { id: 't1', tenantId: 'a', channel: 'messenger', handoff: false, customerId: null, lastMessageAt: new Date(), history: [{ role: 'user', content: 'giá?', at: iso(120) }, { role: 'assistant', content: 'Dạ $35 ạ', at: iso(116) }] },
        { id: 't2', tenantId: 'b', channel: 'messenger', handoff: false, customerId: null, lastMessageAt: new Date(), history: [{ role: 'user', content: 'secret words of salon B', at: iso(4000) }] },
      ] },
      auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { audit.push(data); return {}; } },
    };
    const svc = new BotReportService(prisma as never);
    return { svc, ctl: new SupportAiFleetController(svc, prisma as never, {} as never), audit };
  }

  it('lists the salons that have a channel, counts the rest, and audits the look', async () => {
    const { ctl, audit } = build();
    const out = await ctl.fleet({ userId: 'u1', email: 's@x.test', role: 'SUPER_ADMIN', tenantId: null } as never, '7');
    expect(out.rows.map((r) => r.tenantId).sort()).toEqual(['a', 'b']);
    expect(out.totals).toMatchObject({ salons: 3, botOn: 1, botOff: 1, noChannel: 1 });
    const a = out.rows.find((r) => r.tenantId === 'a')!;
    expect([a.medianSec, a.blockRate, a.bot]).toEqual([4, 0.4, 'on']);
    const b = out.rows.find((r) => r.tenantId === 'b')!;
    expect([b.bot, b.waiting, b.flags]).toEqual(['off', 1, ['off']]);
    expect(JSON.stringify(out)).not.toContain('secret words');
    expect(audit).toEqual([expect.objectContaining({ action: 'support.ai_fleet_viewed', tenantId: null, userId: 'u1' })]);
  });

  it('is for support and Super Admin only — never a salon\'s own login', () => {
    const roles = Reflect.getMetadata('roles', SupportAiFleetController) as string[];
    expect(roles.sort()).toEqual(['SUPER_ADMIN', 'SUPPORT']);
    expect(roles).not.toContain('SALON_ADMIN');
    expect(roles).not.toContain('STAFF');
  });
});
