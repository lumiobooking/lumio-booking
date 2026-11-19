import { MessengerService } from './messenger.service';

/** rt212 — the old conversations, followed back through Meta's pages. */
function fakeService() {
  const created: Record<string, unknown>[] = [];
  const self = Object.create(MessengerService.prototype) as Record<string, unknown>;
  Object.assign(self, {
    prisma: {
      messengerPage: { findMany: jest.fn(async ({ where }: { where: { tenantId: string } }) => (where.tenantId === 'A' ? [{ pageId: 'P1', pageToken: 'tok', pageName: 'Lumio Agency', igId: null }] : [])) },
      messengerConnection: { findUnique: jest.fn(async () => null) },
      messengerThread: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return data; }),
      },
      auditLog: { create: jest.fn(async () => ({})) },
    },
    events: { publish: jest.fn() },
    syncSeen: new Map(), igSyncErrors: new Map(),
    logger: { warn: jest.fn(), log: jest.fn() },
    handleMessage: jest.fn(async () => undefined),
  });
  return { svc: self as unknown as MessengerService, created, self };
}
const conv = (id: string, daysAgo: number) => {
  const at = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  return { id, updated_time: at, participants: { data: [{ id: 'P1', name: 'Page' }, { id: `c${id}`, name: `Khách ${id}` }] }, messages: { data: [{ message: `Xin chào ${id}`, from: { id: `c${id}` }, created_time: at }] } };
};

describe('rt212 — pulling the old conversations from Meta', () => {
  afterEach(() => { (global as { fetch?: unknown }).fetch = undefined; });

  it('follows Meta’s pages back to the chosen date, adds them to the salon, answers nobody', async () => {
    const { svc, created, self } = fakeService();
    const pages = [
      { data: [conv('1', 1), conv('2', 20)], paging: { next: 'https://graph/next1' } },
      { data: [conv('3', 60), conv('4', 120)], paging: { next: 'https://graph/next2' } },
      { data: [conv('5', 200)] },
    ];
    let call = 0;
    (global as { fetch?: unknown }).fetch = jest.fn(async () => ({ json: async () => pages[Math.min(call++, pages.length - 1)] }));
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const r = await svc.syncConversations('A', { limit: 100, lines: 20, reply: false, pages: 60, since });
    expect(created.map((c) => c.senderId)).toEqual(['c1', 'c2', 'c3']);
    expect(created.every((c) => c.tenantId === 'A' && c.pageId === 'P1')).toBe(true);
    expect(r.imported).toBe(3);
    expect(call).toBe(2); // stopped once the page reached past the date
    expect(self.handleMessage as jest.Mock).not.toHaveBeenCalled();
  });

  it('a salon with no Page is told so; another salon is never read', async () => {
    const { svc } = fakeService();
    await expect(svc.syncConversations('B', { pages: 5 })).rejects.toThrow(/No Page/);
  });
});
