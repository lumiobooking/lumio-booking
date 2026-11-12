import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PostReviewService } from './post-review.service';

/**
 * The client's plan link (12/11/2026): the team sends /plan/{token} instead
 * of a Google Sheet. The link is the only credential, so what it can reach is
 * the whole security story: one salon, read + approve + comment, nothing else.
 */
type Row = Record<string, unknown>;

function world() {
  const settings: Row[] = [];
  const posts: Row[] = [
    { id: 'post-a-1', tenantId: 'tenant-aaaa-0001', status: 'scheduled', scheduledAt: new Date(Date.now() + 86_400_000), message: 'A1', channels: ['facebook'], media: [] },
    { id: 'post-b-1', tenantId: 'tenant-bbbb-0002', status: 'scheduled', scheduledAt: new Date(Date.now() + 86_400_000), message: 'B1', channels: ['facebook'], media: [] },
  ];
  const audits: Row[] = [];
  const match = (r: Row, where: Row) => Object.entries(where).every(([k, v]) => (v && typeof v === 'object' && 'in' in (v as Row) ? ((v as { in: unknown[] }).in).includes(r[k]) : r[k] === v));
  const prisma = {
    tenant: { findUnique: async ({ where }: { where: { id: string } }) => ({ name: where.id === 'tenant-aaaa-0001' ? 'Salon A' : 'Salon B', timezone: 'America/Chicago' }) },
    setting: {
      findFirst: async ({ where }: { where: Row }) => settings.find((s) => match(s, where)) ?? null,
      create: async ({ data }: { data: Row }) => { const r = { id: `s${settings.length + 1}`, ...data }; settings.push(r); return r; },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => { const r = settings.find((s) => s.id === where.id)!; Object.assign(r, data); return r; },
    },
    scheduledPost: {
      findMany: async ({ where }: { where: Row }) => posts.filter((p) => p.tenantId === where.tenantId),
      findFirst: async ({ where }: { where: Row }) => posts.find((p) => match(p, where)) ?? null,
      updateMany: async ({ where, data }: { where: Row; data: Row }) => { const hit = posts.filter((p) => match(p, where)); hit.forEach((p) => Object.assign(p, data)); return { count: hit.length }; },
    },
    auditLog: { create: async ({ data }: { data: Row }) => { audits.push(data); return data; } },
  };
  const told: Row[] = [];
  const chat = { alertApproved: async (tenantId: string, postId: string, who: string) => { told.push({ tenantId, postId, who }); }, alertTeam: async () => undefined };
  const svc = new PostReviewService(prisma as never, chat as never);
  return { svc, posts, audits, told, settings };
}
const support = (tenantId: string) => ({ userId: 'u-team', role: 'SALON_ADMIN', tenantId, supportSession: true }) as never;
const owner = (tenantId: string) => ({ userId: 'u-owner', role: 'SALON_ADMIN', tenantId }) as never;
const tokenOf = (url: string) => url.split('/plan/')[1];

describe('the client plan link', () => {
  it('only the Lumio team makes one, and it is a /plan/ address good for 30 days', async () => {
    const { svc, audits } = world();
    await expect(svc.ensureLink(owner('tenant-aaaa-0001'))).rejects.toBeInstanceOf(ForbiddenException);
    const link = await svc.ensureLink(support('tenant-aaaa-0001'));
    expect(link.url).toMatch(/\/plan\/[A-Za-z0-9_-]+$/);
    const days = (link.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9); expect(days).toBeLessThanOrEqual(30);
    // Asking again hands back the same link, not a second door.
    expect((await svc.ensureLink(support('tenant-aaaa-0001'))).url).toBe(link.url);
    expect(audits.filter((a) => a.action === 'content.plan_link_created')).toHaveLength(1);
  });

  it('opens its own salon and no other', async () => {
    const { svc } = world();
    const a = tokenOf((await svc.ensureLink(support('tenant-aaaa-0001'))).url);
    const tenantId = await svc.resolveToken(a);
    expect(tenantId).toBe('tenant-aaaa-0001');
    const feed = await svc.feed(tenantId!);
    expect(feed.salonName).toBe('Salon A');
    expect(feed.posts.map((p) => p.id)).toEqual(['post-a-1']);
  });

  it("salon A's link cannot approve or comment on salon B's post", async () => {
    const { svc, posts } = world();
    const tenantId = (await svc.resolveToken(tokenOf((await svc.ensureLink(support('tenant-aaaa-0001'))).url)))!;
    await expect(svc.approve(tenantId, 'post-b-1', 'Hang', { notifyTeam: true })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.addComment(tenantId, 'post-b-1', 'Hang', 'doi anh')).rejects.toBeInstanceOf(NotFoundException);
    expect(posts.find((p) => p.id === 'post-b-1')!.approvedAt).toBeUndefined();
  });

  it('an approval through the link is stored with the name, told to the team, and logged', async () => {
    const { svc, posts, told, audits } = world();
    const tenantId = (await svc.resolveToken(tokenOf((await svc.ensureLink(support('tenant-aaaa-0001'))).url)))!;
    await svc.approve(tenantId, 'post-a-1', 'Chị Hằng', { notifyTeam: true });
    const p = posts.find((x) => x.id === 'post-a-1')!;
    expect(p.approvedByName).toBe('Chị Hằng');
    expect(p.approvedAt).toBeInstanceOf(Date);
    await new Promise((r) => setTimeout(r, 0));
    expect(told).toEqual([{ tenantId: 'tenant-aaaa-0001', postId: 'post-a-1', who: 'Chị Hằng' }]);
    expect(audits.some((a) => a.action === 'content.post_approved' && a.tenantId === 'tenant-aaaa-0001' && a.resourceId === 'post-a-1')).toBe(true);
  });

  it('a revoked link is dead at once, and a tampered one never worked', async () => {
    const { svc, audits } = world();
    const t = tokenOf((await svc.ensureLink(support('tenant-aaaa-0001'))).url);
    // Same tenant id, somebody else's secret.
    const forged = Buffer.from(`tenant-bbbb-0002:${'ab'.repeat(24)}`, 'utf8').toString('base64url');
    expect(await svc.resolveToken(forged)).toBeNull();
    await expect(svc.revokeLink(owner('tenant-aaaa-0001'))).rejects.toBeInstanceOf(ForbiddenException);
    await svc.revokeLink(support('tenant-aaaa-0001'));
    expect(await svc.resolveToken(t)).toBeNull();
    expect(audits.some((a) => a.action === 'content.plan_link_revoked')).toBe(true);
  });
});
