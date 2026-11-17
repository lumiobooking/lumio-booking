/**
 * The top of the AI page (17/11/2026): one salon's numbers and channels.
 * Every figure must come from the caller's own salon — a second salon's
 * conversations, instructions, leads and pages are in the same fake database
 * and must never be counted.
 */
import { BotReportService } from './bot-report.service';
import { MessengerService } from './messenger.service';
import { MessengerController } from './messenger.controller';

type Row = Record<string, unknown>;
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const user = (tenantId: string) => ({ userId: 'u1', tenantId, role: 'SALON_ADMIN' }) as never;
const ago = (m: number) => new Date(Date.now() - m * 60_000);
const iso = (m: number) => ago(m).toISOString();

/** A customer asks, the AI answers after `sec` seconds. */
const answered = (id: string, tenantId: string, sec: number): Row => ({
  id, tenantId, channel: 'messenger', handoff: false, customerId: null, lastMessageAt: ago(60), lastCustomerAt: ago(60),
  history: [{ role: 'user', content: 'giá gói?', at: iso(60) }, { role: 'assistant', content: 'Dạ…', at: new Date(ago(60).getTime() + sec * 1000).toISOString(), ms: { w: 1000, t: (sec - 1) * 1000 - 200, s: 200 } }],
});
/** A customer asked and nobody answered. */
const waiting = (id: string, tenantId: string): Row => ({
  id, tenantId, channel: 'messenger', handoff: false, customerId: null, lastMessageAt: ago(300), lastCustomerAt: ago(300),
  history: [{ role: 'user', content: 'Khi nào bên mình gọi lại?', at: iso(300) }],
});

function build() {
  const threads: Row[] = [answered('a1', A, 4), answered('a2', A, 6), waiting('a3', A), answered('b1', B, 40), waiting('b2', B), waiting('b3', B)];
  const asked: Row[] = [];
  const mine = (rows: Row[], where: Row) => rows.filter((r) => r.tenantId === where.tenantId);
  const prisma = {
    messengerThread: {
      findMany: async (q: { where: Row }) => { asked.push(q.where); return mine(threads, q.where); },
      findFirst: async (q: { where: Row }) => { asked.push(q.where); return q.where.tenantId === A ? { id: 'w1' } : null; },
    },
    appointment: { findMany: async (q: { where: Row }) => { asked.push(q.where); return []; } },
    botKnowledgeGap: { count: async (q: { where: Row }) => { asked.push(q.where); return q.where.tenantId === A ? (q.where.status === 'open' ? 82 : 5) : 999; } },
    aiInstruction: { aggregate: async (q: { where: Row }) => { asked.push(q.where); return { _sum: q.where.tenantId === A ? { usedCount: 140, blockedCount: 52 } : { usedCount: 1000, blockedCount: 0 } }; } },
    salesLead: { count: async (q: { where: Row }) => { asked.push(q.where); return q.where.tenantId === A ? 31 : 7; } },
    messengerConnection: { findUnique: async (q: { where: { tenantId: string } }) => (q.where.tenantId === A ? { tenantId: A, enabled: true, botMode: 'sales' } : { tenantId: B, enabled: false, botMode: 'booking' }) },
    messengerPage: {
      findMany: async (q: { where: Row }) => { asked.push(q.where); return q.where.tenantId === A
        ? [{ pageId: '111', pageName: 'Lumio Agency', igId: 'ig1', igUsername: 'lumio.agency' }, { pageId: 'zalo:9', pageName: 'Lumio OA', igId: null, igUsername: null }]
        : [{ pageId: '222', pageName: 'Kim Nails', igId: null, igUsername: null }]; },
    },
  };
  const release = { isOn: (f: string, id: string) => f === 'aiPageV2' && id === A };
  const report = new BotReportService(prisma as never);
  const svc = new MessengerService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    undefined, undefined, undefined, undefined, undefined, undefined, release as never);
  return { report, svc, asked };
}

describe('the AI page overview — one salon\'s numbers', () => {
  it('counts this salon\'s conversations, speed, blocked replies, leads and waiting customers', async () => {
    const { report } = build();
    const n = await report.overview(user(A), 7);
    expect(n).toMatchObject({ days: 7, conversations: 3, selfHandled: 2, leads: 31, gapsOpen: 82, waitingNow: 1, botReplies: 2 });
    expect(n.medianSec).toBeGreaterThanOrEqual(4);
    expect(n.medianSec).toBeLessThanOrEqual(6);
    expect(n.blockRate).toBeCloseTo(52 / 140, 5);
  });

  it('CROSS-TENANT: every query carries the caller\'s tenant id, and the other salon\'s rows change nothing', async () => {
    const { report, asked } = build();
    const a = await report.overview(user(A), 7);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((w) => w.tenantId === A)).toBe(true);
    const b = await report.overview(user(B), 7);
    expect(b).toMatchObject({ conversations: 3, leads: 7, gapsOpen: 999, waitingNow: 2, blockRate: 0 });
    expect(a.conversations).toBe(3);
    expect(a.leads).toBe(31);
  });

  it('with too few instruction checks to say, the blocked share is "unknown", not zero', async () => {
    const { report } = build();
    const prisma = (report as unknown as { prisma: { aiInstruction: { aggregate: unknown } } }).prisma;
    prisma.aiInstruction.aggregate = async () => ({ _sum: { usedCount: 6, blockedCount: 3 } });
    expect((await report.overview(user(A), 7)).blockRate).toBeNull();
  });

  it('a caller with no salon is refused', async () => {
    const { report } = build();
    await expect(report.overview({ userId: 'x', tenantId: null, role: 'SALON_ADMIN' } as never)).rejects.toThrow();
  });
});

describe('the AI page — which layout, which channels', () => {
  it('is answered per salon: release channel, kind of page, AI switch, and that salon\'s own channels', async () => {
    const { svc } = build();
    expect(await svc.aiPageUi(user(A))).toEqual({ v2: true, pageKind: 'sales', aiOn: true, channels: { messenger: ['Lumio Agency'], instagram: ['lumio.agency'], zalo: ['Lumio OA'], web: true } });
    expect(await svc.aiPageUi(user(B))).toEqual({ v2: false, pageKind: 'booking', aiOn: false, channels: { messenger: ['Kim Nails'], instagram: [], zalo: [], web: false } });
  });

  it('is readable by owner and staff of the salon only, and takes no tenant from the request', () => {
    const roles = Reflect.getMetadata('roles', (MessengerController.prototype as unknown as Record<string, object>).aiOverview) as string[];
    expect(roles.sort()).toEqual(['SALON_ADMIN', 'STAFF']);
  });
});
