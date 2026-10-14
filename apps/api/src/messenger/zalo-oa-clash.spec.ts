/**
 * One Zalo OA belongs to one salon. Salon A pasting Salon B's OA id (with a
 * token that is not B's) must not route B's customers' messages to A.
 */
jest.mock('./zalo-oa', () => {
  const actual = jest.requireActual('./zalo-oa');
  return { ...actual, fetchZaloOaInfo: jest.fn(async (token: string) => (token === 'tok-b' ? { oaid: 'oa-b', name: 'Salon B' } : token === 'tok-a' ? { oaid: 'oa-a', name: 'Salon A' } : null)) };
});
jest.mock('./messenger.service', () => ({ MessengerService: class {} }));
import { ZaloOaService } from './zalo-oa.service';

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const adminA = { userId: 'ua', tenantId: 'tA', role: 'SALON_ADMIN' } as never;

function make(pages: Row[]) {
  const upserts: Row[] = [];
  const prisma: Row = {
    setting: { findFirst: async () => null, findUnique: async () => null, upsert: async () => undefined },
    messengerPage: {
      findUnique: async ({ where }: Row) => pages.find((p) => p.pageId === where.pageId) ?? null,
      upsert: async (a: Row) => { upserts.push(a); return {}; },
    },
    messengerConnection: { findUnique: async () => ({ id: 'c', enabled: true, pageId: 'fb-page' }), create: async () => ({}) },
  };
  const svc = new ZaloOaService(prisma as never, {} as never);
  (svc as unknown as { status: () => Promise<unknown> }).status = async () => ({ ok: true });
  return { svc, upserts };
}

const paste = (oaid: string, accessToken: string) => ({ appId: 'app', oaid, accessToken, refreshToken: 'r' });

describe('connecting a Zalo OA by pasting a config', () => {
  it("refuses an OA already wired to another salon, and writes nothing", async () => {
    const { svc, upserts } = make([{ pageId: 'oa-b', tenantId: 'tB' }]);
    await expect(svc.connect(adminA, paste('oa-b', 'tok-b'))).rejects.toThrow(/tiệm khác/);
    expect(upserts).toHaveLength(0);
  });
  it("refuses a token that is not the OA's own (a free OA cannot be claimed with a made-up token)", async () => {
    const { svc, upserts } = make([]);
    await expect(svc.connect(adminA, paste('oa-b', 'made-up'))).rejects.toThrow(/xác minh/);
    await expect(svc.connect(adminA, paste('oa-b', 'tok-a'))).rejects.toThrow(/xác minh/);
    expect(upserts).toHaveLength(0);
  });
  it("connects the salon's own OA with its own token", async () => {
    const { svc, upserts } = make([]);
    await svc.connect(adminA, paste('oa-a', 'tok-a'));
    expect(upserts).toHaveLength(1);
    expect(upserts[0].where).toEqual({ pageId: 'oa-a' });
    expect(upserts[0].create.tenantId).toBe('tA');
  });
});
