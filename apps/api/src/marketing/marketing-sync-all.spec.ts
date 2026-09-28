import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { MarketingService } from './marketing.service';
import { credsSource } from './linked-channels';

/**
 * "Đồng bộ tất cả": one button (and one daily job) instead of a sync button
 * per channel. Connected anywhere → synced; never connected → skipped, not an
 * error; one failing channel never stops the others; a salon can only ever
 * sync itself.
 */

describe('which connection a channel uses', () => {
  it('an ACTIVE connection on the report page wins', () => {
    expect(credsSource('ACTIVE', true)).toBe('explicit');
  });
  it('the connection made on "Kết nối kênh social" beats a failing one here', () => {
    // The bug in the screenshot: an old ERROR row hid a healthy Messenger
    // connection, and the report asked the salon to connect Facebook again.
    expect(credsSource('ERROR', true)).toBe('linked');
    expect(credsSource(null, true)).toBe('linked');
    expect(credsSource('REVOKED', true)).toBe('linked');
  });
  it('a failing row is still retried when it is all there is', () => {
    expect(credsSource('ERROR', false)).toBe('explicit');
  });
  it('nothing anywhere → skipped', () => {
    expect(credsSource(null, false)).toBe('none');
    expect(credsSource('REVOKED', false)).toBe('none');
  });
});

type Row = { tenantId: string; platform: string; status: string; credentialEnc: string | null; externalAccountId: string | null };

function makeService(rows: Row[], opts: { messengerFor?: string[]; fail?: string[] } = {}) {
  const updates: { where: unknown; data: Record<string, unknown> }[] = [];
  const calls: { platform: string; token?: string }[] = [];
  const prisma: any = {
    marketingChannelConnection: {
      findMany: jest.fn(async ({ where }: any) => rows.filter((r) => r.tenantId === where.tenantId)),
      findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.tenantId === where.tenantId_platform.tenantId && r.platform === where.tenantId_platform.platform) ?? null),
      updateMany: jest.fn(async (a: any) => { updates.push(a); return { count: 1 }; }),
    },
    messengerPage: {
      findFirst: jest.fn(async ({ where }: any) => ((opts.messengerFor ?? []).includes(where.tenantId)
        ? { pageId: `page-${where.tenantId}`, pageToken: `tok-${where.tenantId}`, pageName: 'Page' } : null)),
    },
    messengerConnection: { findUnique: jest.fn(async () => null) },
    setting: { findUnique: jest.fn(async () => null) },
    socialInsight: { upsert: jest.fn(async () => ({})), findUnique: jest.fn(async () => null) },
    marketingSpend: { upsert: jest.fn(async () => ({})) },
    googleReview: { findMany: jest.fn(async () => []) },
    auditLog: { create: jest.fn(async () => ({})) },
    tenant: { findMany: jest.fn(async () => [{ id: 't1' }, { id: 't2' }]) },
  };
  const connector = (platform: string, hasSpend: boolean) => ({
    platform, label: platform, enabled: true, hasSpend,
    verify: jest.fn(async () => ({ ok: true })),
    fetchMonthly: jest.fn(async (c: any) => { calls.push({ platform, token: c.token }); if ((opts.fail ?? []).includes(platform)) throw new Error(`${platform} down`); return { spendCents: 1000 }; }),
    fetchOrganic: jest.fn(async (c: any) => { calls.push({ platform, token: c.token }); if ((opts.fail ?? []).includes(platform)) throw new Error(`${platform} down`); return { facebook: { followers: 10 } }; }),
  });
  const list = [connector('meta', true), connector('meta_social', false), connector('gbp', false), connector('tiktok', false)];
  const social: any = {
    list: () => [...list.map((c) => ({ platform: c.platform, label: c.label, enabled: true, hasSpend: c.hasSpend })), { platform: 'google_ads', label: 'Google Ads', enabled: false, hasSpend: true }],
    get: (p: string) => list.find((c) => c.platform === p),
  };
  const svc = new MarketingService(prisma, social, {} as any, {} as any);
  return { svc, updates, calls };
}

const admin = (tenantId: string) => ({ userId: 'u', email: 'a@b.c', role: UserRole.SALON_ADMIN, tenantId }) as any;

describe('sync all', () => {
  beforeEach(() => { process.env.META_AGENCY_TOKEN = 'agency'; });

  it('syncs what is connected anywhere and skips the rest without an error', async () => {
    const { svc, calls } = makeService(
      [{ tenantId: 't1', platform: 'meta', status: 'ACTIVE', credentialEnc: null, externalAccountId: 'act_1' }],
      { messengerFor: ['t1'] },
    );
    const r = await svc.syncAllForUser(admin('t1'), '2026-09');
    const state = Object.fromEntries(r.lines.map((l) => [l.platform, l.state]));
    expect(state).toEqual({ meta: 'synced', meta_social: 'synced', gbp: 'skipped', tiktok: 'skipped' });
    expect(r.synced).toBe(2);
    // The Facebook organic numbers came through the Messenger connection.
    expect(calls.find((c) => c.platform === 'meta_social')?.token).toBe('tok-t1');
  });

  it('uses the social-page connection when the old row here is failing, and leaves that row alone', async () => {
    const { svc, calls, updates } = makeService(
      [{ tenantId: 't1', platform: 'meta_social', status: 'ERROR', credentialEnc: null, externalAccountId: 'old' }],
      { messengerFor: ['t1'] },
    );
    const r = await svc.syncAllForUser(admin('t1'), '2026-09');
    expect(r.lines.find((l) => l.platform === 'meta_social')?.state).toBe('synced');
    expect(calls.find((c) => c.platform === 'meta_social')?.token).toBe('tok-t1');
    // Not flipped back to ACTIVE — otherwise the failing row would win next time.
    const flip = updates.find((u) => (u.data as { status?: string }).status === 'ACTIVE');
    expect(flip).toBeUndefined();
  });

  it('one failing channel is reported and does not stop the others', async () => {
    const { svc } = makeService(
      [{ tenantId: 't1', platform: 'meta', status: 'ACTIVE', credentialEnc: null, externalAccountId: 'act_1' }],
      { messengerFor: ['t1'], fail: ['meta'] },
    );
    const r = await svc.syncAllForUser(admin('t1'), '2026-09');
    expect(r.lines.find((l) => l.platform === 'meta')).toMatchObject({ state: 'error', message: 'meta down' });
    expect(r.lines.find((l) => l.platform === 'meta_social')?.state).toBe('synced');
  });

  it("a salon cannot sync another salon's channels", async () => {
    const { svc } = makeService([], { messengerFor: ['t1', 't2'] });
    await expect(svc.syncAllForUser(admin('t1'), '2026-09', 't2')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("never reads another salon's connection", async () => {
    const { svc, calls } = makeService(
      [{ tenantId: 't2', platform: 'meta', status: 'ACTIVE', credentialEnc: null, externalAccountId: 'act_2' }],
      { messengerFor: ['t2'] },
    );
    const r = await svc.syncAllForUser(admin('t1'), '2026-09');
    expect(r.synced).toBe(0);
    expect(r.lines.every((l) => l.state === 'skipped')).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('the whole-system run covers every active salon', async () => {
    const { svc } = makeService(
      [{ tenantId: 't2', platform: 'meta', status: 'ACTIVE', credentialEnc: null, externalAccountId: 'act_2' }],
      { messengerFor: ['t1'] },
    );
    const r = await svc.syncAllTenants('2026-09');
    expect(r).toMatchObject({ month: '2026-09', tenants: 2, synced: 2, failed: 0 });
  });

  it('rejects a malformed month', async () => {
    const { svc } = makeService([]);
    await expect(svc.syncAllForUser(admin('t1'), '09/2026')).rejects.toThrow(/YYYY-MM/);
  });
});
