import { GoogleReviewsService } from './google-reviews.service';

/* The salon's own token was revoked by Google's 100-per-account limit; the
 * account's newest token (or another salon's, same account) still works. */
describe('GoogleReviewsService.accessToken — one Google account, one live token', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  function make(pool: Record<string, string>, siblings: { connectedEmail: string; refreshToken: string }[]) {
    const prisma = {
      platformConfig: {
        findUnique: jest.fn(async ({ where }: any) => (pool[where.key] ? { key: where.key, value: pool[where.key] } : null)),
        upsert: jest.fn(async ({ where, create }: any) => { pool[where.key] = create.value; return {}; }),
      },
      setting: { findMany: jest.fn(async () => siblings.map((v) => ({ value: { connected: true, ...v }, updatedAt: new Date() }))) },
    };
    const svc = new GoogleReviewsService(prisma as any, {} as any, {} as any);
    (svc as any).clientId = () => 'cid'; (svc as any).clientSecret = () => 'sec';
    return { svc, prisma, pool };
  }
  const google = (live: string[]) => {
    global.fetch = jest.fn(async (_u: any, init: any) => {
      const rt = new URLSearchParams(String(init.body)).get('refresh_token')!;
      return live.includes(rt)
        ? ({ ok: true, status: 200, json: async () => ({ access_token: `at-${rt}` }), text: async () => '' } as any)
        : ({ ok: false, status: 400, json: async () => ({}), text: async () => '{"error":"invalid_grant","error_description":"Token has been expired or revoked."}' } as any);
    }) as any;
  };
  const S = (refreshToken: string, connectedEmail = 'Partners@lumiobooking.com') => ({ refreshToken, connectedEmail } as any);

  it('uses the account\'s newest token before the salon\'s own (revoked) one', async () => {
    const { svc } = make({ 'gbp_token:partners@lumiobooking.com': 'NEW' }, []);
    google(['NEW']);
    await expect((svc as any).accessToken(S('OLD'))).resolves.toBe('at-NEW');
  });

  it('keeps the salon\'s own token as the account token when the pooled one died', async () => {
    const { svc, pool } = make({ 'gbp_token:partners@lumiobooking.com': 'DEAD' }, []);
    google(['OWN']);
    await expect((svc as any).accessToken(S('OWN'))).resolves.toBe('at-OWN');
    expect(pool['gbp_token:partners@lumiobooking.com']).toBe('OWN');
  });

  it('heals from another salon connected with the SAME account, never from another account', async () => {
    const { svc, pool } = make({}, [
      { connectedEmail: 'owner@other-salon.com', refreshToken: 'FOREIGN' },
      { connectedEmail: 'partners@lumiobooking.com', refreshToken: 'SIBLING' },
    ]);
    google(['SIBLING', 'FOREIGN']);
    await expect((svc as any).accessToken(S('OLD'))).resolves.toBe('at-SIBLING');
    expect(pool['gbp_token:partners@lumiobooking.com']).toBe('SIBLING');
    const used = (global.fetch as jest.Mock).mock.calls.map((c) => new URLSearchParams(String(c[1].body)).get('refresh_token'));
    expect(used).not.toContain('FOREIGN');
  });

  it('every token of the account dead → the same clear "reconnect" error, then no retry storm', async () => {
    const { svc } = make({}, [{ connectedEmail: 'partners@lumiobooking.com', refreshToken: 'ALSO_DEAD' }]);
    google([]);
    await expect((svc as any).accessToken(S('OLD'))).rejects.toThrow(/Reconnect the account/);
    const n = (global.fetch as jest.Mock).mock.calls.length;
    await expect((svc as any).accessToken(S('OLD'))).rejects.toThrow(/Reconnect the account/);
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(n);
  });
});
