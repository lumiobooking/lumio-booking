import { inboxBus, inboxWrite, tenantOf } from './inbox-events';
import { InboxEventsService } from './inbox-events.service';

describe('rt205 — every conversation write reaches the open inbox at once', () => {
  it('knows which writes move an inbox screen', () => {
    expect(inboxWrite({ model: 'MessengerThread', action: 'update' })).toBe(true);
    expect(inboxWrite({ model: 'ChatAgentPresence', action: 'upsert' })).toBe(false); // rt221: heartbeats do not reload screens
    expect(inboxWrite({ model: 'MessengerThread', action: 'findMany' })).toBe(false);
    expect(inboxWrite({ model: 'Appointment', action: 'update' })).toBe(false);
    expect(inboxWrite({ model: 'Setting', action: 'upsert', args: { where: { tenantId_key: { tenantId: 'A', key: 'messenger.turn_shift.u1' } } as never } })).toBe(true);
    expect(inboxWrite({ model: 'Setting', action: 'upsert', args: { where: { tenantId_key: { tenantId: 'A', key: 'booking.policy' } } as never } })).toBe(false);
  });

  it('reads the salon from the write itself', () => {
    expect(tenantOf({ args: { where: { id: 't', tenantId: 'A' } } }, { count: 1 })).toBe('A');
    expect(tenantOf({ args: {} }, { id: 't', tenantId: 'B' })).toBe('B');
    expect(tenantOf({ args: { where: { tenantId_userId: { tenantId: 'C', userId: 'u' } } as never } }, null)).toBe('C');
    expect(tenantOf({ args: { where: { id: 't' } } }, { count: 1 })).toBeNull();
  });

  it('a burst is one nudge, only to that salon', async () => {
    const svc = new InboxEventsService();
    const a: string[] = []; const b: string[] = [];
    svc.subscribe('A', (k) => a.push(k));
    svc.subscribe('B', (k) => b.push(k));
    inboxBus.emit('nudge', 'A', 'thread');
    inboxBus.emit('nudge', 'A', 'message');
    inboxBus.emit('nudge', 'A', 'thread');
    await new Promise((r) => setTimeout(r, 200));
    expect(a).toEqual(['message']);
    expect(b).toEqual([]);
  });

  it('the database hook nudges after a write', async () => {
    const { PrismaService } = await import('../prisma/prisma.service');
    const got: string[] = [];
    const on = (t: string) => got.push(t);
    inboxBus.on('nudge', on);
    const self = { messengerThread: { findUnique: jest.fn(async () => ({ tenantId: 'Z' })) } };
    const run = (PrismaService.prototype as unknown as { nudgeInbox: (this: unknown, p: unknown, r: unknown) => void }).nudgeInbox;
    run.call(self, { model: 'MessengerThread', action: 'update', args: { where: { id: 't1' } } }, { id: 't1', tenantId: 'A' });
    run.call(self, { model: 'MessengerThread', action: 'updateMany', args: { where: { id: 't2' } } }, { count: 1 });
    run.call(self, { model: 'Appointment', action: 'update', args: {} }, { tenantId: 'A' });
    await new Promise((r) => setTimeout(r, 20));
    inboxBus.off('nudge', on);
    expect(got).toEqual(['A', 'Z']);
  });
});
