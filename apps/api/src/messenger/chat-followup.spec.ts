/**
 * "Hệ thống AI messenger có tự động follow up cho khách nếu lâu quá chưa phản
 * hồi hoặc chưa chốt" — the follow-up for quiet booking chats.
 *
 * Opt-in per salon (off by default). Each case here is a way the nudge could
 * embarrass a salon: messaging a salon that never turned it on, nudging a
 * customer who already booked, talking over a human, nudging twice, or — the
 * multi-tenant one — sending with another salon's Page token.
 */
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  AppointmentStatus: { CANCELLED: 'CANCELLED' },
}));
import { MessengerService } from './messenger.service';
import { contextualNudge, followUpSettingsFrom, nudgeKindFor, threadStateFrom, CHAT_FOLLOWUP_KEY } from './followup';

type Row = Record<string, any>;
// 15:00 in Chicago — inside the default 9–20 window.
const NOW = new Date('2026-10-06T20:00:00Z');
const mins = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

function thread(over: Row = {}): Row {
  return {
    id: 'th1', tenantId: 't1', pageId: 'p1', senderId: 'psid1', channel: 'instagram', status: 'open', handoff: false,
    assignedUserId: null, customerId: null, summary: null,
    lastCustomerAt: new Date(mins(60)), lastMessageAt: new Date(mins(59)),
    history: [
      { role: 'user', content: 'pedicure tomorrow 2pm?', at: mins(60) },
      { role: 'assistant', content: "2:00 PM works 👍 What name and phone number should I put it under?", at: mins(59) },
    ],
    ...over,
  };
}

function makeSvc(o: { settings?: Record<string, unknown>; threads?: Row[]; pages?: Row[]; appts?: number; botMode?: string } = {}) {
  const sent: { token: string; to: string; text: string; channel: string }[] = [];
  const written: Row[] = [];
  const threadWheres: Row[] = [];
  const pageWheres: Row[] = [];
  const settingsRows: Row[] = Object.entries(o.settings ?? { t1: { enabled: true } }).map(([tenantId, value]) => ({ tenantId, key: CHAT_FOLLOWUP_KEY, value }));
  const threads = o.threads ?? [thread()];
  const pages = o.pages ?? [{ pageId: 'p1', tenantId: 't1', pageToken: 'TOKEN-T1', enabled: true }, { pageId: 'p2', tenantId: 't2', pageToken: 'TOKEN-T2', enabled: true }];
  const prisma = {
    setting: {
      findMany: async () => settingsRows,
      findFirst: async (a: { where: Row }) => settingsRows.find((r) => r.tenantId === a.where.tenantId && r.key === a.where.key) ?? null,
    },
    messengerConnection: {
      findUnique: async (a: { where: Row }) => ({ tenantId: a.where.tenantId, enabled: true, botMode: o.botMode ?? 'booking' }),
      findFirst: async () => null,
    },
    tenant: { findUnique: async () => ({ timezone: 'America/Chicago', market: 'US' }) },
    messengerThread: {
      findMany: async (a: { where: Row }) => { threadWheres.push(a.where); return threads.filter((t) => t.tenantId === a.where.tenantId); },
      findUnique: async (a: { where: Row }) => threads.find((t) => t.id === a.where.id) ?? null,
      update: async (a: Row) => {
        written.push(a);
        const t = threads.find((x) => x.id === a.where.id);
        if (t && a.data.history) { t.history = a.data.history; t.lastMessageAt = a.data.lastMessageAt; }
        return t;
      },
    },
    messengerPage: {
      findFirst: async (a: { where: Row }) => { pageWheres.push(a.where); return pages.find((p) => p.pageId === a.where.pageId && p.tenantId === a.where.tenantId) ?? null; },
    },
    appointment: { count: async () => o.appts ?? 0 },
  };
  const events = { publish: jest.fn() };
  const svc = new MessengerService(prisma as never, {} as never, {} as never, {} as never, events as never, {} as never);
  (svc as unknown as { sendText: unknown }).sendText = async (token: string, to: string, text: string, channel: string) => {
    sent.push({ token, to, text, channel });
    return { ok: true };
  };
  return { svc, sent, written, threadWheres, pageWheres, events, threads };
}

describe('the follow-up is the salon’s choice', () => {
  it('is OFF until the salon turns it on', () => {
    expect(followUpSettingsFrom(undefined).enabled).toBe(false);
    expect(followUpSettingsFrom(null).enabled).toBe(false);
    expect(followUpSettingsFrom({ enabled: 'yes' }).enabled).toBe(false);
    expect(followUpSettingsFrom({ enabled: true }).enabled).toBe(true);
  });

  it('a salon that never turned it on gets nothing sent', async () => {
    const { svc, sent } = makeSvc({ settings: {} });
    expect(await svc.sendFollowUpsFor('t1', NOW)).toBe(0);
    const all = await svc.sendFollowUpsEverywhere(NOW);
    expect(all).toEqual({ sent: 0, salons: 0 });
    expect(sent).toHaveLength(0);
  });

  it('only the salons that opted in are swept', async () => {
    const { svc, sent } = makeSvc({
      settings: { t1: { enabled: true }, t2: { enabled: false } },
      threads: [thread(), thread({ id: 'th2', tenantId: 't2', pageId: 'p2', senderId: 'psid2' })],
    });
    const r = await svc.sendFollowUpsEverywhere(NOW);
    expect(r).toEqual({ sent: 1, salons: 1 });
    expect(sent.map((s) => s.to)).toEqual(['psid1']);
  });

  it('the sales bot is never nudged by this', async () => {
    const { svc, sent } = makeSvc({ botMode: 'sales' });
    expect(await svc.sendFollowUpsFor('t1', NOW)).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe('when a nudge goes out', () => {
  it('a quiet chat waiting on name + phone gets ONE nudge asking for them, recorded as a bot turn', async () => {
    const { svc, sent, threads, events } = makeSvc();
    expect(await svc.sendFollowUpsFor('t1', NOW)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ token: 'TOKEN-T1', to: 'psid1', channel: 'instagram' });
    expect(sent[0].text).toMatch(/name and phone number/);
    const last = threads[0].history[threads[0].history.length - 1];
    expect(last).toMatchObject({ role: 'assistant', nudge: true });
    expect(events.publish).toHaveBeenCalledWith('t1', 'message');
    // The next sweep, a minute later: already nudged once → nothing.
    expect(await svc.sendFollowUpsFor('t1', new Date(NOW.getTime() + 60_000))).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('not yet quiet long enough → nothing', async () => {
    const { svc, sent } = makeSvc({ threads: [thread({ history: [
      { role: 'user', content: 'hi', at: mins(12) },
      { role: 'assistant', content: 'What service would you like?', at: mins(10) },
    ], lastCustomerAt: new Date(mins(12)), lastMessageAt: new Date(mins(10)) })] });
    expect(await svc.sendFollowUpsFor('t1', NOW)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('the customer spoke last → they are owed a reply, not a nudge', async () => {
    const t = thread();
    t.history.push({ role: 'user', content: 'Kim 512-555-0147', at: mins(50) });
    const { svc, sent } = makeSvc({ threads: [t] });
    expect(await svc.sendFollowUpsFor('t1', NOW)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('already booked from this chat → nothing', async () => {
    const { svc, sent } = makeSvc({ threads: [thread({ customerId: 'c1' })], appts: 1 });
    expect(await svc.sendFollowUpsFor('t1', NOW)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('a human answered last, or the chat is assigned → the bot does not talk over them', async () => {
    const t = thread();
    t.history[1] = { ...t.history[1], manual: true };
    const a = makeSvc({ threads: [t] });
    expect(await a.svc.sendFollowUpsFor('t1', NOW)).toBe(0);
    const b = makeSvc({ threads: [thread({ assignedUserId: 'u1' })] });
    expect(await b.svc.sendFollowUpsFor('t1', NOW)).toBe(0);
    expect([...a.sent, ...b.sent]).toHaveLength(0);
  });

  it('the customer said stop → never', async () => {
    const t = thread();
    t.history.unshift({ role: 'user', content: "please don't message me again", at: mins(70) });
    const { svc, sent } = makeSvc({ threads: [t] });
    expect(await svc.sendFollowUpsFor('t1', NOW)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('outside the salon’s hours → held back', async () => {
    const { svc, sent } = makeSvc();
    const lateNight = new Date('2026-10-07T04:00:00Z'); // 23:00 Chicago
    expect(await svc.sendFollowUpsFor('t1', lateNight)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('only messenger and instagram threads, never handed-off ones, are even read', async () => {
    const { svc, threadWheres } = makeSvc();
    await svc.sendFollowUpsFor('t1', NOW);
    expect(threadWheres[0]).toMatchObject({ tenantId: 't1', handoff: false, status: 'open', channel: { in: ['messenger', 'instagram'] } });
  });
});

describe('tenant isolation', () => {
  it('a thread pointing at another salon’s Page is never sent with that salon’s token', async () => {
    // A t1 thread whose pageId belongs to t2 — corrupt or crafted data.
    const { svc, sent, pageWheres } = makeSvc({ threads: [thread({ pageId: 'p2' })] });
    expect(await svc.sendFollowUpsFor('t1', NOW)).toBe(0);
    expect(sent).toHaveLength(0);
    expect(pageWheres[0]).toEqual({ pageId: 'p2', tenantId: 't1' });
  });

  it('salon t1’s sweep reads only t1’s threads and sends only with t1’s token', async () => {
    const { svc, sent, threadWheres } = makeSvc({
      settings: { t1: { enabled: true }, t2: { enabled: true } },
      threads: [thread(), thread({ id: 'th2', tenantId: 't2', pageId: 'p2', senderId: 'psid2' })],
    });
    await svc.sendFollowUpsFor('t1', NOW);
    expect(threadWheres.every((w) => w.tenantId === 't1')).toBe(true);
    expect(sent.map((s) => s.token)).toEqual(['TOKEN-T1']);
  });
});

describe('what the nudge says', () => {
  it('fits where the customer stopped', () => {
    expect(nudgeKindFor('Gel manicure, Monday Oct 6 at 11:00 AM, for Kim · 512-555-0147 — shall I book it?')).toBe('confirm');
    expect(nudgeKindFor('2:00 PM works 👍 What name and phone number should I put it under?')).toBe('contact');
    expect(nudgeKindFor('What day works for you?')).toBe('time');
    expect(nudgeKindFor('Our address is 12 Main St.')).toBe('general');
  });

  it('a second nudge is always the softer general line', () => {
    expect(contextualNudge('shall I book it?', false, 2)).toBe(contextualNudge('', false, 1));
  });

  it('Vietnamese nudges never guess anh or chị', () => {
    for (const ask of ['em đặt lịch luôn nhé?', 'cho em xin tên và số điện thoại', 'anh/chị muốn hôm nào ạ?', '']) {
      const line = contextualNudge(ask, true);
      expect(line.toLowerCase()).toContain('anh/chị');
      // \b is ASCII-only and never matches after "ị", so test the words directly.
      const rest = line.replace(/anh\/chị/gi, '');
      expect(rest).not.toMatch(/chị/i);
      expect(rest).not.toMatch(/\banh\b/i);
    }
  });

  it('the bot’s own earlier nudge does not count as what the customer was asked', () => {
    const s = threadStateFrom({
      history: [
        { role: 'assistant', content: 'What name and phone number should I put it under?', at: mins(100) },
        { role: 'assistant', content: 'Just checking in…', at: mins(60), nudge: true },
      ],
      lastCustomerAt: mins(110), lastMessageAt: mins(60), handoff: false, assigned: false, booked: false,
    });
    expect(s.lastBotText).toMatch(/name and phone/);
    expect(s.nudges).toBe(1);
  });
});
