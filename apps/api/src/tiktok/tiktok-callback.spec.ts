/**
 * "Lúc connect TikTok xong thì hệ thống phải load lại mấy lần thì mới được."
 *
 * The callback waited on three TikTok calls before sending the browser back,
 * so people reloaded — and the reload re-sent a spent one-time code, whose
 * failure was shown as "Kết nối không thành công" over a connection that had
 * already been saved. Now the browser goes back as soon as the token is saved,
 * and a replay of a callback that just succeeded is reported as connected.
 */
import { TikTokService } from './tiktok.service';
import { isReplayedCallback, TIKTOK_DEFAULTS, CALLBACK_REPLAY_MS, type TikTokSettings } from './tiktok';

const NOW = Date.parse('2026-10-05T10:00:00Z');
const justConnected: TikTokSettings = {
  ...TIKTOK_DEFAULTS, connected: true, accessToken: 'at', refreshToken: 'rt',
  connectedAt: new Date(NOW - 2 * 60_000).toISOString(),
};

describe('a replayed TikTok callback', () => {
  it('is recognised for a few minutes after a successful connect', () => {
    expect(isReplayedCallback(justConnected, NOW)).toBe(true);
  });
  it('is NOT assumed for an old connection, a missing token, or a never-connected salon', () => {
    expect(isReplayedCallback({ ...justConnected, connectedAt: new Date(NOW - CALLBACK_REPLAY_MS - 1).toISOString() }, NOW)).toBe(false);
    expect(isReplayedCallback({ ...justConnected, refreshToken: '' }, NOW)).toBe(false);
    expect(isReplayedCallback({ ...justConnected, connected: false }, NOW)).toBe(false);
    expect(isReplayedCallback(TIKTOK_DEFAULTS, NOW)).toBe(false);
    expect(isReplayedCallback({ ...justConnected, connectedAt: 'garbage' }, NOW)).toBe(false);
  });
});

describe('the callback itself', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; jest.useRealTimers(); });

  function makeSvc(stored: Record<string, TikTokSettings>) {
    const writes: { tenantId: string; value: TikTokSettings }[] = [];
    const prisma = {
      setting: {
        findUnique: async (a: { where: { tenantId_key: { tenantId: string } } }) => {
          const v = stored[a.where.tenantId_key.tenantId];
          return v ? { value: v } : null;
        },
        upsert: async (a: { where: { tenantId_key: { tenantId: string } }; update: { value: TikTokSettings } }) => {
          stored[a.where.tenantId_key.tenantId] = a.update.value;
          writes.push({ tenantId: a.where.tenantId_key.tenantId, value: a.update.value });
          return {};
        },
      },
      auditLog: { create: async () => ({}) },
    };
    const svc = new TikTokService(prisma as never);
    (svc as unknown as { verifyState: (s: string) => string | null }).verifyState = (s: string) => (s === 'good' ? 't1' : null);
    return { svc, writes, stored };
  }

  it('a reload that re-sends the spent code lands on "connected", not on an error', async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['setTimeout', 'setImmediate', 'nextTick', 'queueMicrotask'] });
    global.fetch = (async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'code already used' }) })) as unknown as typeof fetch;
    const { svc, writes } = makeSvc({ t1: justConnected });
    const url = await svc.callback('spent-code', 'good');
    expect(url).toMatch(/tiktok=connected$/);
    expect(writes).toHaveLength(0); // the saved connection is untouched
  });

  it('a genuine failure on a salon that was not just connected is still reported', async () => {
    global.fetch = (async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) })) as unknown as typeof fetch;
    const { svc } = makeSvc({});
    expect(await svc.callback('bad', 'good')).toMatch(/tiktok=error&msg=invalid_grant/);
  });

  it('sends the browser back as soon as the token is saved — without waiting for the profile calls', async () => {
    let profileCalls = 0;
    global.fetch = (async (url: string) => {
      if (String(url).includes('/oauth/token/')) {
        return {
          ok: true, status: 200,
          json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: 86400, refresh_expires_in: 31536000, open_id: 'o1', scope: 'user.info.basic,video.publish' }),
        };
      }
      profileCalls += 1;
      return new Promise(() => undefined); // TikTok's profile endpoints hang
    }) as unknown as typeof fetch;
    const { svc, stored } = makeSvc({});
    const url = await Promise.race([
      svc.callback('fresh', 'good'),
      new Promise<string>((r) => setTimeout(() => r('TIMED OUT'), 2000)),
    ]);
    expect(url).toMatch(/tiktok=connected$/);
    expect(stored.t1.accessToken).toBe('AT');
    expect(stored.t1.connected).toBe(true);
    expect(profileCalls).toBeGreaterThanOrEqual(1); // started, not awaited
  });

  it('a bad state never touches any salon', async () => {
    const { svc, writes } = makeSvc({ t1: justConnected });
    expect(await svc.callback('x', 'forged')).toMatch(/tiktok=error&msg=invalid_state/);
    expect(writes).toHaveLength(0);
  });
});
