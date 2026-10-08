/**
 * "After any change the AI must learn it and answer customers." A change
 * saved anywhere (the audit log carries it) makes the bot re-read the salon's
 * open conversations: the unanswered one is answered, the parked one ("I'll
 * check with the salon") is asked again with today's data — and stays silent
 * when the answer is still missing. A person's conversation is left alone;
 * another salon's threads are never touched.
 */
jest.mock('@prisma/client', () => ({ ...jest.requireActual('@prisma/client'), AppointmentStatus: { CANCELLED: 'CANCELLED' } }));
import { MessengerService } from './messenger.service';
import { botRelevantAction, onBotCatchUp, requestBotCatchUp } from './bot-refresh';
import { AuditService } from '../audit/audit.service';

type Row = Record<string, any>;

function makeSvc(threads: Row[], conn: Row = { tenantId: 't1', enabled: true, pageToken: 'TOK', aiInstruction: null, botFacts: [] }) {
  const queued: Row[] = [];
  const updates: Row[] = [];
  const prisma = {
    messengerConnection: { findUnique: async ({ where }: Row) => (where.tenantId === conn.tenantId ? conn : null) },
    messengerThread: {
      findMany: async ({ where }: Row) => threads.filter((t) => t.tenantId === where.tenantId),
      update: async ({ where, data }: Row) => { updates.push({ where, data }); const t = threads.find((x) => x.id === where.id); if (t && data.history) t.history = data.history; return t; },
    },
  };
  const svc = new MessengerService(prisma as never, {} as never, {} as never, {} as never, { publish: jest.fn() } as never, {} as never);
  const s = svc as unknown as Row;
  s.pageByEntry = async (pageId: string) => (pageId === 'p1' ? { tenantId: 't1', pageId: 'p1', pageToken: 'TOK', enabled: true } : null);
  s.queueReply = (_c: unknown, threadId: string, _s: string, text: string, _ts: unknown, _a: unknown, rid?: string) => { queued.push({ threadId, text, rid }); };
  return { svc, queued, updates };
}

describe('bot-refresh bus', () => {
  it('relays relevant audit actions to the bot, and only those', () => {
    expect(botRelevantAction('service.updated')).toBe(true);
    expect(botRelevantAction('service_addon.created')).toBe(true);
    expect(botRelevantAction('settings.ai_notes_updated')).toBe(true);
    expect(botRelevantAction('settings.booking_updated')).toBe(true);
    expect(botRelevantAction('messenger.knowledge_gap_answered')).toBe(true);
    expect(botRelevantAction('settings.gmail_connected')).toBe(false);
    expect(botRelevantAction('payroll.settings_updated')).toBe(false);
    const seen: string[] = [];
    const off = onBotCatchUp((t, r) => seen.push(`${t}:${r}`));
    requestBotCatchUp('t1', 'service.updated');
    requestBotCatchUp(null, 'service.updated');
    off();
    expect(seen).toEqual(['t1:service.updated']);
  });

  it('the audit log is the trigger: a saved service change reaches the bus with the tenant', async () => {
    const seen: string[] = [];
    const off = onBotCatchUp((t, r) => seen.push(`${t}:${r}`));
    const audit = new AuditService({ auditLog: { create: async () => ({}) } } as never);
    await audit.log({ tenantId: 't9', action: 'service.updated' });
    await audit.log({ tenantId: 't9', action: 'settings.gmail_connected' });
    off();
    expect(seen).toEqual(['t9:service.updated']);
  });
});

describe('catch-up after an update', () => {
  it('answers the unanswered, re-asks the parked question with an id, leaves the rest', async () => {
    const threads: Row[] = [
      { id: 'a', tenantId: 't1', pageId: 'p1', senderId: 'u1', status: 'open', handoff: false, history: [{ role: 'user', content: 'do you do dip powder?', at: '2026-10-08T01:00:00Z', rid: 'r-a' }] },
      { id: 'b', tenantId: 't1', pageId: 'p1', senderId: 'u2', status: 'open', handoff: false, history: [
        { role: 'user', content: 'how much is chrome?', at: '2026-10-08T01:00:00Z' },
        { role: 'assistant', content: "I'll check with the salon and get back to you.", at: '2026-10-08T01:00:10Z' },
      ] },
      { id: 'c', tenantId: 't1', pageId: 'p1', senderId: 'u3', status: 'open', handoff: false, history: [
        { role: 'user', content: 'thanks', at: '2026-10-08T01:00:00Z' },
        { role: 'assistant', content: 'You are welcome — see you Friday!', at: '2026-10-08T01:00:10Z' },
      ] },
      { id: 'd', tenantId: 't1', pageId: 'p1', senderId: 'u4', status: 'open', handoff: false, assignedUserId: 'staff-1', history: [{ role: 'user', content: 'hello?', at: '2026-10-08T01:00:00Z' }] },
      { id: 'z', tenantId: 't2', pageId: 'p2', senderId: 'u9', status: 'open', handoff: false, history: [{ role: 'user', content: 'other salon', at: '2026-10-08T01:00:00Z' }] },
    ];
    const { svc, queued, updates } = makeSvc(threads, { tenantId: 't1', enabled: true, pageToken: 'TOK', aiInstruction: null, botFacts: [], chatBotFirst: false });
    const r = await svc.catchUp('t1', 'service.updated');
    expect(r).toEqual({ unanswered: 1, parked: 1 });
    expect(queued.find((q) => q.threadId === 'a')).toEqual({ threadId: 'a', text: 'do you do dip powder?', rid: 'r-a' });
    const b = queued.find((q) => q.threadId === 'b')!;
    expect(b.text).toBe('how much is chrome?');
    expect(typeof b.rid).toBe('string');
    // The parked question's turn now carries that id, so the reply step re-uses it instead of adding it again.
    expect(updates.find((u) => u.where.id === 'b')!.data.history[0].rid).toBe(b.rid);
    expect(queued.some((q) => q.threadId === 'c' || q.threadId === 'd' || q.threadId === 'z')).toBe(false);
  });

  it('a salon with the bot off is left alone', async () => {
    const { svc, queued } = makeSvc([{ id: 'a', tenantId: 't1', pageId: 'p1', senderId: 'u1', status: 'open', handoff: false, history: [{ role: 'user', content: 'hi', at: '2026-10-08T01:00:00Z' }] }], { tenantId: 't1', enabled: false, pageToken: 'TOK', aiInstruction: null, botFacts: [] });
    expect(await svc.catchUp('t1')).toEqual({ unanswered: 0, parked: 0 });
    expect(queued).toHaveLength(0);
  });
});
