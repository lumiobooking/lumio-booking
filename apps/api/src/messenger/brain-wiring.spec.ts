/**
 * The chat bot reads the salon's brain (ai-brain): the request_callback tool
 * leaves the desk a task under THIS salon and the thread's own customer, and
 * never one for another salon.
 */
jest.mock('@prisma/client', () => ({
  ...jest.requireActual('@prisma/client'),
  AppointmentStatus: { CANCELLED: 'CANCELLED' },
}));
import { MessengerService } from './messenger.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function makeSvc() {
  const callbacks: Row[] = [];
  const ends: Row[] = [];
  const brain = {
    createCallback: async (c: Row) => { callbacks.push(c); return { id: 'cb1' }; },
    endSession: async (t: string, id: string, reason: string) => { ends.push({ t, id, reason }); },
  };
  const prisma = { tenant: { findUnique: async () => ({ market: 'US' }) } };
  const svc = new MessengerService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, undefined, undefined, undefined, undefined, brain as never);
  const tool = (tenantId: string, input: Row, ctx: Row) => (svc as unknown as { runTool: (...a: unknown[]) => Promise<string> })
    .runTool(tenantId, 'America/Chicago', 'request_callback', input, { mode: 'booking', leadEmail: null, ...ctx });
  return { tool, callbacks, ends };
}

describe('the chat bot asks the desk to step in', () => {
  it('leaves a task under the salon, the thread and its customer, and says so', async () => {
    const { tool, callbacks, ends } = makeSvc();
    const out = await tool('t1', { summary: 'Group of 8 on Saturday at 2', reason: 'too_large' }, { channel: 'zalo', threadId: 'th1', customerId: 'c1', known: { phone: '+15125550101', firstName: 'Anna' } });
    expect(out).toMatch(/^NOTED/);
    expect(callbacks).toEqual([expect.objectContaining({ tenantId: 't1', channel: 'zalo', reason: 'too_large', summary: 'Group of 8 on Saturday at 2', threadId: 'th1', customerId: 'c1', phone: '+15125550101', name: 'Anna' })]);
    expect(ends).toEqual([{ t: 't1', id: 'th1', reason: 'callback' }]);
  });

  it('a thread of another salon writes under that salon only', async () => {
    const { tool, callbacks } = makeSvc();
    await tool('t2', { summary: 'x' }, { channel: 'messenger', threadId: 'th9' });
    expect(callbacks.map((c) => c.tenantId)).toEqual(['t2']);
    expect(callbacks[0].reason).toBe('callback');
  });
});
