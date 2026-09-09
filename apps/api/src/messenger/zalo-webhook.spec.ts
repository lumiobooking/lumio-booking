import { createHash } from 'crypto';
import { ZaloOaService } from './zalo-oa.service';

/**
 * The webhook path end to end: authenticate with the tenant's own OA secret,
 * keep the reply token alive, then hand the text to the brain — and nothing
 * at all on forged or foreign events.
 */
const CFG = {
  appId: '111', appSecret: 'app-secret', oaSecretKey: 'oa-secret',
  oaid: 'oa-7', accessToken: 'tok-old', refreshToken: 'ref-old',
  accessExpiresAtMs: Date.now() + 24 * 60 * 60 * 1000, enabled: true,
};

function makeSvc(cfg: Record<string, unknown> | null = CFG) {
  const prisma = {
    messengerPage: {
      findFirst: jest.fn(async () => ({ tenantId: 't1', pageId: 'oa-7', pageToken: 'tok-old', enabled: true })),
      updateMany: jest.fn(async () => ({})),
      upsert: jest.fn(async () => ({})),
    },
    messengerConnection: { findUnique: jest.fn(async () => null), updateMany: jest.fn(async () => ({})), create: jest.fn() },
    setting: {
      findFirst: jest.fn(async () => (cfg ? { value: cfg } : null)),
      upsert: jest.fn(async (_args?: unknown) => ({})),
      deleteMany: jest.fn(),
    },
  };
  const messenger = { inboundZalo: jest.fn(async () => undefined) };
  return { svc: new ZaloOaService(prisma as any, messenger as any), prisma, messenger };
}

function signedEvent(text = 'Dạ em muốn đặt lịch', secret = 'oa-secret') {
  const body = JSON.stringify({
    app_id: '111', event_name: 'user_send_text', timestamp: '1700000000123',
    sender: { id: 'user-9' }, recipient: { id: 'oa-7' }, message: { text },
  });
  const sig = 'mac=' + createHash('sha256').update(`111${body}1700000000123${secret}`).digest('hex');
  return { body, sig };
}

describe('Zalo webhook → brain', () => {
  const realFetch = global.fetch;
  afterEach(() => { (global as any).fetch = realFetch; });

  it('feeds a signed text event to the messenger brain', async () => {
    const { svc, messenger } = makeSvc();
    const { body, sig } = signedEvent();
    await svc.handleWebhook(body, sig);
    expect(messenger.inboundZalo).toHaveBeenCalledWith('oa-7', 'user-9', 'Dạ em muốn đặt lịch', 1700000000123);
  });

  it('drops a forged signature silently', async () => {
    const { svc, messenger } = makeSvc();
    const { body } = signedEvent();
    const bad = 'mac=' + '0'.repeat(64);
    await svc.handleWebhook(body, bad);
    expect(messenger.inboundZalo).not.toHaveBeenCalled();
  });

  it('drops everything when no OA secret is configured — never "temporarily open"', async () => {
    const { svc, messenger } = makeSvc({ ...CFG, oaSecretKey: '' });
    const { body, sig } = signedEvent();
    await svc.handleWebhook(body, sig);
    expect(messenger.inboundZalo).not.toHaveBeenCalled();
  });

  it('acknowledges non-text events without touching the brain', async () => {
    const { svc, messenger } = makeSvc();
    await svc.handleWebhook(JSON.stringify({ event_name: 'follow', follower: { id: 'x' } }), undefined);
    await svc.handleWebhook('not json at all', undefined);
    expect(messenger.inboundZalo).not.toHaveBeenCalled();
  });

  it('refreshes a dying token and persists the new single-use pair BEFORE replying', async () => {
    const order: string[] = [];
    const { svc, prisma, messenger } = makeSvc({ ...CFG, accessExpiresAtMs: Date.now() + 30 * 60 * 1000 });
    // The webhook also writes its trace row through the same upsert; only the
    // token row counts for the ordering this test is about.
    prisma.setting.upsert.mockImplementation(async (a: { where: { tenantId_key: { key: string } } }) => {
      if (a.where.tenantId_key.key === 'zalo_oa') order.push('persist');
      return {};
    });
    (messenger.inboundZalo as jest.Mock).mockImplementation(async () => { order.push('brain'); });
    (global as any).fetch = jest.fn(async () => ({
      json: async () => ({ access_token: 'tok-new', refresh_token: 'ref-new', expires_in: '90000' }),
    }));

    const { body, sig } = signedEvent();
    await svc.handleWebhook(body, sig);

    expect(order).toEqual(['persist', 'brain']);
    const tokenWrite = (prisma.setting.upsert.mock.calls as unknown as [{ where: { tenantId_key: { key: string } }; update: { value: Record<string, unknown> } }][])
      .map((c) => c[0]).find((c) => c.where.tenantId_key.key === 'zalo_oa')!;
    const saved = tokenWrite.update.value;
    expect(saved.accessToken).toBe('tok-new');
    expect(saved.refreshToken).toBe('ref-new');
    expect(prisma.messengerPage.updateMany).toHaveBeenCalledWith({ where: { pageId: 'oa-7' }, data: { pageToken: 'tok-new' } });
  });
});

describe('the trace the screen reads', () => {
  const written = (prisma: { setting: { upsert: jest.Mock } }) =>
    prisma.setting.upsert.mock.calls
      .map((c) => c[0] as { where: { tenantId_key: { key: string } }; update: { value: { outcome?: string; event?: string } } })
      .filter((c) => c.where.tenantId_key.key === 'zalo_webhook_trace')
      .map((c) => c.update.value);

  it('records "ok" when a signed text event went to the brain', async () => {
    const { svc, prisma } = makeSvc();
    const { body, sig } = signedEvent();
    await svc.handleWebhook(body, sig);
    expect(written(prisma).at(-1)).toMatchObject({ outcome: 'ok', event: 'user_send_text' });
  });

  it('NAMES THE GATE that stopped a forged event — the one fact that ends a support call', async () => {
    const { svc, prisma, messenger } = makeSvc();
    const { body } = signedEvent();
    await svc.handleWebhook(body, 'mac=' + '0'.repeat(64));
    expect(messenger.inboundZalo).not.toHaveBeenCalled();
    expect(written(prisma).at(-1)).toMatchObject({ outcome: 'bad-signature' });
  });

  it('records a follow event as ignored rather than silence — Zalo IS delivering', async () => {
    const { svc, prisma } = makeSvc();
    const body = JSON.stringify({ app_id: '111', event_name: 'follow', timestamp: '1700000000123', follower: { id: 'u' }, oa_id: 'oa-7' });
    const sig = 'mac=' + createHash('sha256').update(`111${body}1700000000123oa-secret`).digest('hex');
    await svc.handleWebhook(body, sig);
    expect(written(prisma).at(-1)).toMatchObject({ outcome: 'ignored', event: 'follow' });
  });

  it('never writes the customer\'s words into the trace', async () => {
    const { svc, prisma } = makeSvc();
    const { body, sig } = signedEvent('số điện thoại của tôi là 0909');
    await svc.handleWebhook(body, sig);
    expect(JSON.stringify(written(prisma))).not.toContain('0909');
  });
});
