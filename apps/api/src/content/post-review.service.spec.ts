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
      findFirst: async ({ where }: { where: Row }) => settings.find((s) => Object.entries(where).every(([k, v]) => (k === 'value'
        ? (s.value as Row)?.[(v as { path: string[] }).path[0]] === (v as { equals: unknown }).equals
        : match(s, { [k]: v })))) ?? null,
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
  const plan: Row[] = [];
  const chat = {
    alertApproved: async (tenantId: string, postId: string, who: string) => { told.push({ tenantId, postId, who }); },
    alertPlanDay: async (tenantId: string, day: string, who: string, state: string) => { plan.push({ tenantId, day, who, state }); },
    alertTeam: async () => undefined,
  };
  const svc = new PostReviewService(prisma as never, chat as never);
  return { svc, posts, audits, told, settings, plan };
}
const support = (tenantId: string) => ({ userId: 'u-team', role: 'SALON_ADMIN', tenantId, supportSession: true }) as never;
const owner = (tenantId: string) => ({ userId: 'u-owner', role: 'SALON_ADMIN', tenantId }) as never;
const tokenOf = (url: string) => url.split('/plan/')[1];

describe('the client plan link', () => {
  it('only the Lumio team makes one, and it is a /plan/ address good for 30 days', async () => {
    const { svc, audits } = world();
    await expect(svc.ensureLink(owner('tenant-aaaa-0001'))).rejects.toBeInstanceOf(ForbiddenException);
    const link = await svc.ensureLink(support('tenant-aaaa-0001'));
    // Short enough to sit on one line of a chat: 16 letters and digits, nothing about the salon in it.
    expect(link.url).toMatch(/\/plan\/[A-Za-z0-9]{16}$/);
    expect(link.url).not.toContain('tenant');
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

  it('a long link shared before the short code keeps working, and gains a short one', async () => {
    const { svc, settings } = world();
    const secret = 'ab12'.repeat(12);
    settings.push({ id: 's-old', tenantId: 'tenant-aaaa-0001', key: 'post_review_link', value: { secret, createdAt: new Date(Date.now() - 5 * 86_400_000).toISOString() } });
    const long = Buffer.from(`tenant-aaaa-0001:${secret}`, 'utf8').toString('base64url');
    expect(await svc.resolveToken(long)).toBe('tenant-aaaa-0001');
    const link = await svc.ensureLink(support('tenant-aaaa-0001'));
    expect(await svc.resolveToken(tokenOf(link.url))).toBe('tenant-aaaa-0001');
    expect(await svc.resolveToken(long)).toBe('tenant-aaaa-0001');
    // The 30 days still count from when the first link was made.
    expect((link.expiresAt.getTime() - Date.now()) / 86_400_000).toBeLessThan(25.1);
  });

  it('a guessed short code opens nothing', async () => {
    const { svc } = world();
    await svc.ensureLink(support('tenant-aaaa-0001'));
    expect(await svc.resolveToken('AAAAAAAAAAAAAAAA')).toBeNull();
  });

  describe('the month plan through the link', () => {
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    const seed = (settings: Row[], tenantId: string, d: string, extra: Row = {}) => {
      const key = `content_plan_sheet:${d.slice(0, 7)}`;
      let row = settings.find((s) => s.tenantId === tenantId && s.key === key);
      if (!row) { row = { id: `sheet-${tenantId}-${d.slice(0, 7)}`, tenantId, key, value: {} }; settings.push(row); }
      (row.value as Row)[d] = { topic: `Idea ${tenantId.slice(7, 8)} ${d}`, detail: 'caption', mediaUrl: 'https://drive.example/secret', air: ['facebook'], updatedBy: 'team@lumio', ...extra };
    };

    it('shows the days still ahead as ideas, without the Drive link or who wrote them, and only its own salon', async () => {
      const { svc, settings } = world();
      seed(settings, 'tenant-aaaa-0001', day(3)); seed(settings, 'tenant-aaaa-0001', day(-2)); seed(settings, 'tenant-bbbb-0002', day(4));
      const tenantId = (await svc.resolveToken(tokenOf((await svc.ensureLink(support('tenant-aaaa-0001'))).url)))!;
      const feed = await svc.feed(tenantId);
      expect(feed.ideas.map((i) => i.day)).toEqual([day(3)]);
      expect(feed.ideas[0].status).toBe('wait');
      expect(feed.ideasWaiting).toBe(1);
      expect(JSON.stringify(feed)).not.toContain('drive.example');
      expect(JSON.stringify(feed)).not.toContain('team@lumio');
      expect(JSON.stringify(feed)).not.toContain('Idea b');
    });

    it('a day whose post the client can already see is left to the post', async () => {
      const { svc, settings } = world();
      seed(settings, 'tenant-aaaa-0001', day(1), { postId: 'post-a-1' });   // scheduled → visible
      seed(settings, 'tenant-aaaa-0001', day(2), { postId: 'draft-xyz' });  // a draft the client cannot see yet
      const feed = await svc.feed('tenant-aaaa-0001');
      expect(feed.ideas.map((i) => [i.day, i.status])).toEqual([[day(2), 'making']]);
    });

    it('approving and asking for a change are stored, logged and told to the team; nothing is scheduled', async () => {
      const { svc, settings, audits, plan, posts } = world();
      seed(settings, 'tenant-aaaa-0001', day(3)); seed(settings, 'tenant-aaaa-0001', day(5));
      const before = JSON.stringify(posts);
      expect((await svc.decideIdea('tenant-aaaa-0001', day(3), 'approved', 'Chị Hằng')).status).toBe('making');
      expect((await svc.decideIdea('tenant-aaaa-0001', day(5), 'change', 'Chị Hằng', 'đổi ngày giúp chị')).status).toBe('held');
      await expect(svc.decideIdea('tenant-aaaa-0001', day(5), 'change', 'Chị Hằng', '  ')).rejects.toThrow(/muốn đổi/);
      const feed = await svc.feed('tenant-aaaa-0001');
      expect(feed.ideas.map((i) => [i.status, i.by, i.note])).toEqual([['making', 'Chị Hằng', null], ['held', 'Chị Hằng', 'đổi ngày giúp chị']]);
      await new Promise((r) => setTimeout(r, 0));
      expect(plan.map((p) => p.state)).toEqual(['approved', 'change']);
      expect(audits.filter((a) => String(a.action).startsWith('content.plan_day_')).map((a) => [a.tenantId, a.resourceId])).toEqual([['tenant-aaaa-0001', day(3)], ['tenant-aaaa-0001', day(5)]]);
      expect(JSON.stringify(posts)).toBe(before);
    });

    it("salon A's link cannot answer for salon B's day", async () => {
      const { svc, settings } = world();
      seed(settings, 'tenant-bbbb-0002', day(4));
      const tenantId = (await svc.resolveToken(tokenOf((await svc.ensureLink(support('tenant-aaaa-0001'))).url)))!;
      await expect(svc.decideIdea(tenantId, day(4), 'approved', 'Hang')).rejects.toBeInstanceOf(NotFoundException);
      const b = settings.find((s) => s.tenantId === 'tenant-bbbb-0002' && String(s.key).startsWith('content_plan_sheet'))!;
      expect(((b.value as Row)[day(4)] as Row).client).toBeUndefined();
      await expect(svc.decideIdea(tenantId, 'not-a-day', 'approved', 'Hang')).rejects.toThrow(/YYYY-MM-DD/);
    });
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
