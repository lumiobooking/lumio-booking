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
      upsert: jest.fn(async () => ({})),
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
    prisma.setting.upsert.mockImplementation(async () => { order.push('persist'); return {}; });
    (messenger.inboundZalo as jest.Mock).mockImplementation(async () => { order.push('brain'); });
    (global as any).fetch = jest.fn(async () => ({
      json: async () => ({ access_token: 'tok-new', refresh_token: 'ref-new', expires_in: '90000' }),
    }));

    const { body, sig } = signedEvent();
    await svc.handleWebhook(body, sig);

    expect(order).toEqual(['persist', 'brain']);
    const saved = (prisma.setting.upsert.mock.calls as unknown as [[{ update: { value: Record<string, unknown> } }]])[0][0].update.value;
    expect(saved.accessToken).toBe('tok-new');
    expect(saved.refreshToken).toBe('ref-new');
    expect(prisma.messengerPage.updateMany).toHaveBeenCalledWith({ where: { pageId: 'oa-7' }, data: { pageToken: 'tok-new' } });
  });
});
