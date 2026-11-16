import { AiDigestService } from './ai-digest.service';

// Monday 16 Nov 2026 09:30 in Chicago.
const NOW = new Date('2026-11-16T15:30:00Z');

function build(settings: { tenantId: string; value: string }[]) {
  const pushes: { tenantId: string; userId: string; body: string }[] = [];
  const reportsFor: string[] = [];
  const prisma = {
    setting: {
      findMany: jest.fn(async () => settings.map((s) => ({ ...s }))),
      findUnique: jest.fn(async (a: { where: { tenantId_key: { tenantId: string } } }) => settings.find((s) => s.tenantId === a.where.tenantId_key.tenantId) ?? null),
      update: jest.fn(async (a: { where: { tenantId_key: { tenantId: string } }; data: { value: string } }) => { const s = settings.find((x) => x.tenantId === a.where.tenantId_key.tenantId)!; s.value = a.data.value; return s; }),
      upsert: jest.fn(async (a: { where: { tenantId_key: { tenantId: string } }; create: { tenantId: string; value: string }; update: { value: string } }) => { const s = settings.find((x) => x.tenantId === a.where.tenantId_key.tenantId); if (s) s.value = a.update.value; else settings.push({ tenantId: a.create.tenantId, value: a.create.value }); }),
    },
    tenant: { findFirst: jest.fn(async (a: { where: { id: string } }) => ({ id: a.where.id, timezone: a.where.id === 'vn' ? 'Asia/Ho_Chi_Minh' : 'America/Chicago', market: a.where.id === 'vn' ? 'VN' : 'US' })) },
    user: { findMany: jest.fn(async (a: { where: { tenantId: string; role: string } }) => (a.where.role === 'SALON_ADMIN' ? [{ id: `owner-${a.where.tenantId}` }] : [])) },
    auditLog: { create: jest.fn(async () => undefined) },
  };
  const reports = { forTenant: jest.fn(async (t: string) => { reportsFor.push(t); return { conversations: 90, selfHandledRate: 0.82, booked: 41, unanswered: { open: 3 }, survey: { happyRate: null } }; }) };
  const push = { sendToUser: jest.fn(async (tenantId: string, userId: string, p: { body: string }) => { pushes.push({ tenantId, userId, body: p.body }); return 1; }) };
  return { svc: new AiDigestService(prisma as never, reports as never, push as never), pushes, reportsFor, settings, prisma };
}

describe('the Monday digest sweep', () => {
  it('sends each opted-in salon ITS OWN numbers, to its own owner, once', async () => {
    const { svc, pushes, reportsFor, settings } = build([
      { tenantId: 'a', value: '{"on":true}' },
      { tenantId: 'b', value: '{"on":false}' },
      { tenantId: 'vn', value: '{"on":true}' }, // Monday 22:30 there — not now
    ]);
    expect(await svc.sweep(NOW)).toEqual({ sent: 1, salons: 1 });
    expect(reportsFor).toEqual(['a']);
    expect(pushes).toEqual([{ tenantId: 'a', userId: 'owner-a', body: expect.stringContaining('41') }]);
    expect(JSON.parse(settings[0].value)).toEqual({ on: true, lastWeek: '2026-11-16' });
    // A restart twenty minutes later: nothing more.
    expect(await svc.sweep(new Date(NOW.getTime() + 20 * 60_000))).toEqual({ sent: 0, salons: 0 });
    expect(pushes).toHaveLength(1);
  });

  it('the switch is per salon and keeps the week already sent', async () => {
    const { svc, settings } = build([{ tenantId: 'a', value: '{"on":true,"lastWeek":"2026-11-16"}' }]);
    const owner = (tenantId: string) => ({ userId: 'u', role: 'SALON_ADMIN', tenantId }) as never;
    expect(await svc.get(owner('a'))).toEqual({ on: true });
    expect(await svc.get(owner('b'))).toEqual({ on: false });
    await svc.set(owner('a'), false);
    expect(JSON.parse(settings[0].value)).toEqual({ on: false, lastWeek: '2026-11-16' });
    await svc.set(owner('b'), true);
    expect(settings.find((s) => s.tenantId === 'b')).toBeTruthy();
    await expect(svc.get({ userId: 's', role: 'SUPER_ADMIN', tenantId: null } as never)).rejects.toThrow();
  });
});
