import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'crypto';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { clientStatusOf, makeReviewToken, parseReviewToken, tokenFresh } from './post-review';

const LINK_KEY = 'post_review_link';

/**
 * What one post looks like to the client — nothing the agency keeps to
 * itself. Exported because the controller's inferred return type names it,
 * and tsc refuses a public signature built on a name it cannot reach (TS4053).
 */
export interface ClientPost {
  id: string;
  channels: string[];
  message: string;
  media: { url: string; kind: 'image' | 'video' }[];
  scheduledAt: Date;
  postedAt: Date | null;
  clientStatus: string;
  approvedAt: Date | null;
  approvedByName: string | null;
  heldAt: Date | null;
  links: { channel: string; url: string | null }[];
}

/**
 * The salon's approval screen: the feed both doors read (the logged-in page
 * and the group-chat link), the one-tap approve, and the link itself.
 *
 * TENANT ISOLATION: every query here filters by a tenantId that came either
 * from the JWT (resolveTenantScope) or from a verified review token — never
 * from the request body. The public door can see exactly one salon's
 * scheduled and recently-posted posts, and nothing else in the system.
 */
@Injectable()
export class PostReviewService {
  constructor(private readonly prisma: PrismaService) {}

  /** Loose access: rows exist on the deploy, not in the stale local client. */
  private get loose() {
    return this.prisma as unknown as Record<string, {
      findMany: (a: unknown) => Promise<unknown>;
      findFirst: (a: unknown) => Promise<unknown>;
      findUnique?: (a: unknown) => Promise<unknown>;
      create: (a: unknown) => Promise<unknown>;
      updateMany: (a: unknown) => Promise<unknown>;
      upsert?: (a: unknown) => Promise<unknown>;
    }>;
  }

  private tenantOf(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new BadRequestException('No tenant context');
    return id;
  }

  // ---- the feed --------------------------------------------------------------

  async feed(tenantId: string) {
    const [tenant, page, rows] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, timezone: true } }),
      this.loose.messengerPage?.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
        select: { pageName: true, igUsername: true },
      }).catch(() => null) as Promise<{ pageName?: string | null; igUsername?: string | null } | null>,
      this.loose.scheduledPost?.findMany({
        where: {
          tenantId,
          OR: [
            { status: { in: ['scheduled', 'publishing'] } },
            // Recent history so the calendar shows what already went out —
            // proof the plan runs, not just promises.
            { status: 'posted', postedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
          ],
        },
        orderBy: { scheduledAt: 'asc' },
        take: 120,
      }).catch(() => []) as Promise<Record<string, unknown>[]>,
    ]);
    if (!tenant) throw new NotFoundException('Salon not found');

    const posts: ClientPost[] = [];
    for (const r of rows ?? []) {
      const status = clientStatusOf(r as { status: string; heldAt?: Date | null; approvedAt?: Date | null });
      if (!status) continue;
      const media = Array.isArray(r.media)
        ? (r.media as { url?: string; kind?: string }[])
          .filter((m) => typeof m?.url === 'string')
          .map((m) => ({ url: String(m.url), kind: m.kind === 'video' ? 'video' as const : 'image' as const }))
        : [];
      const results = Array.isArray(r.results) ? (r.results as { channel?: string; url?: string | null }[]) : [];
      posts.push({
        id: String(r.id),
        channels: Array.isArray(r.channels) ? (r.channels as string[]) : ['facebook'],
        message: String(r.message ?? ''),
        media,
        scheduledAt: r.scheduledAt as Date,
        postedAt: (r.postedAt as Date | null) ?? null,
        clientStatus: status,
        approvedAt: (r.approvedAt as Date | null) ?? null,
        approvedByName: (r.approvedByName as string | null) ?? null,
        heldAt: (r.heldAt as Date | null) ?? null,
        links: results.map((x) => ({ channel: String(x.channel ?? ''), url: x.url ?? null })),
      });
    }
    return {
      salonName: tenant.name,
      timezone: tenant.timezone || 'UTC',
      pageName: page?.pageName ?? tenant.name,
      igUsername: page?.igUsername ?? null,
      posts,
      waiting: posts.filter((p) => p.clientStatus === 'wait').length,
    };
  }

  async feedFor(user: AuthenticatedUser) {
    return this.feed(this.tenantOf(user));
  }

  // ---- approving -------------------------------------------------------------

  async approve(tenantId: string, postId: string, name: string) {
    const who = String(name ?? '').trim().slice(0, 80) || 'Chủ tiệm';
    const r = await this.loose.scheduledPost?.updateMany({
      // Only a scheduled post takes a signature. Approving a held one is fine
      // too — the salon saying "actually it's OK" IS the answer — so a held
      // post that gets approved also releases its hold.
      where: { id: postId, tenantId, status: 'scheduled' },
      data: { approvedAt: new Date(), approvedByName: who, heldAt: null },
    }).catch(() => ({ count: 0 })) as { count: number };
    if (!r?.count) throw new NotFoundException('Bài không còn ở trạng thái chờ duyệt.');
    return { ok: true, approvedByName: who };
  }

  async approveFor(user: AuthenticatedUser, postId: string) {
    const email = String(user.email ?? '');
    const person = email.includes('@') ? email.split('@')[0].replace(/[._-]+/g, ' ') : email;
    return this.approve(this.tenantOf(user), postId, person);
  }

  // ---- the link --------------------------------------------------------------

  private async linkRow(tenantId: string): Promise<{ secret?: string; createdAt?: string } | null> {
    const row = await this.prisma.setting.findFirst({
      where: { tenantId, key: LINK_KEY },
      select: { value: true },
    }).catch(() => null);
    return (row?.value as { secret?: string; createdAt?: string } | null) ?? null;
  }

  /** Team only: the share-into-the-group link. Reuses a fresh one, mints on demand. */
  async ensureLink(user: AuthenticatedUser) {
    if (user.role !== UserRole.SUPER_ADMIN && !user.supportSession) {
      throw new ForbiddenException('Chỉ đội Lumio tạo link duyệt bài.');
    }
    const tenantId = this.tenantOf(user);
    let row = await this.linkRow(tenantId);
    if (!row?.secret || !tokenFresh(row.createdAt)) {
      row = { secret: randomBytes(24).toString('hex'), createdAt: new Date().toISOString() };
      const existing = await this.prisma.setting.findFirst({ where: { tenantId, key: LINK_KEY }, select: { id: true } }).catch(() => null);
      if (existing) await this.prisma.setting.update({ where: { id: existing.id }, data: { value: row as never } });
      else await this.prisma.setting.create({ data: { tenantId, key: LINK_KEY, value: row as never } });
    }
    const token = makeReviewToken(tenantId, row.secret!);
    const base = process.env.PUBLIC_WEB_URL || 'https://lumiobooking.com';
    return { url: `${base}/review-posts/${token}`, expiresAt: new Date(Date.parse(row.createdAt!) + 30 * 86_400_000) };
  }

  async revokeLink(user: AuthenticatedUser) {
    if (user.role !== UserRole.SUPER_ADMIN && !user.supportSession) {
      throw new ForbiddenException('Chỉ đội Lumio thu hồi link.');
    }
    const tenantId = this.tenantOf(user);
    const existing = await this.prisma.setting.findFirst({ where: { tenantId, key: LINK_KEY }, select: { id: true } }).catch(() => null);
    if (existing) await this.prisma.setting.update({ where: { id: existing.id }, data: { value: {} as never } });
    return { ok: true };
  }

  /** A token from the wild into a tenantId — or nothing. Never throws detail. */
  async resolveToken(token: string): Promise<string | null> {
    const parsed = parseReviewToken(token);
    if (!parsed) return null;
    const row = await this.linkRow(parsed.tenantId);
    if (!row?.secret || !tokenFresh(row.createdAt)) return null;
    const a = Buffer.from(parsed.secret, 'utf8');
    const b = Buffer.from(row.secret, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return parsed.tenantId;
  }

  // ---- comments through the public door --------------------------------------

  async comments(tenantId: string, postId: string) {
    await this.assertPost(tenantId, postId);
    const rows = await this.loose.contentMessage?.findMany({
      where: { tenantId, subject: `post:${postId}` },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, side: true, authorName: true, body: true, createdAt: true },
    }).catch(() => []) as { id: string }[];
    return { messages: (rows ?? []).reverse() };
  }

  async addComment(tenantId: string, postId: string, name: string, body: string) {
    await this.assertPost(tenantId, postId);
    const text = String(body ?? '').trim();
    if (!text) throw new BadRequestException('Chưa có nội dung.');
    const who = String(name ?? '').trim().slice(0, 60) || 'Chủ tiệm';
    const subject = `post:${postId}`;
    const row = await this.loose.contentMessage?.create({
      data: {
        tenantId, subject, side: 'salon',
        authorId: null,
        authorName: who,
        body: text.slice(0, 4000),
        readBySalonAt: new Date(),
      },
      select: { id: true, side: true, authorName: true, body: true, createdAt: true },
    }).catch(() => null);
    if (!row) throw new BadRequestException('Chưa gửi được, thử lại giúp em.');
    await this.loose.contentThread?.upsert?.({
      where: { tenantId_subject: { tenantId, subject } },
      create: { tenantId, subject, lastMessageAt: new Date(), lastSide: 'salon' },
      update: { lastMessageAt: new Date(), lastSide: 'salon', resolvedAt: null, resolvedByName: null },
    }).catch(() => undefined);
    // The hold: a client comment on a scheduled post stops the clock until the
    // team answers. Same rule as the logged-in door (content-chat.service).
    await this.loose.scheduledPost?.updateMany({
      where: { id: postId, tenantId, status: 'scheduled' },
      data: { heldAt: new Date() },
    }).catch(() => undefined);
    return row;
  }

  /** The post must belong to THIS tenant and be one the client may see. */
  private async assertPost(tenantId: string, postId: string) {
    if (!/^[a-zA-Z0-9-]{6,40}$/.test(String(postId ?? ''))) throw new BadRequestException('Bài không hợp lệ.');
    const row = await this.loose.scheduledPost?.findFirst({
      where: { id: postId, tenantId, status: { in: ['scheduled', 'publishing', 'posted'] } },
      select: { id: true },
    }).catch(() => null);
    if (!row) throw new NotFoundException('Không tìm thấy bài.');
  }
}
