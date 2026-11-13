import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'crypto';
import { UserRole } from '@prisma/client';
import { ContentChatService } from './content-chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { PLAN_SHEET_KEY, cleanSheet, entryForShop, ideaReady, ideaStatusOf, isDayKey, setClientDecision, shiftMonthKey } from './plan-sheet';
import { dayKeyTz } from '../common/salon-time';
import { PLAN_TAGS_KEY, readTags } from './plan-tags';
import { REVIEW_LINK_TTL_DAYS, SHORT_CODE_LEN, clientStatusOf, isShortCode, makeShortCode, parseReviewToken, statsByPost, tokenFresh, type PostStats } from './post-review';

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
  /** The team sent it back after a change — the salon sees "updated, please look again". */
  reviewRequestedAt: Date | null;
  links: { channel: string; url: string | null }[];
  /** Posted only: views, likes and comments the networks reported (social_posts), summed. */
  stats: PostStats | null;
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
/** One day's idea as the plan link shows it (see ideasFor). */
export interface LinkIdea {
  day: string; topic: string; detail: string; air: string[];
  pillar: { vi: string; en: string } | null; format: { vi: string; en: string } | null;
  status: 'wait' | 'held' | 'making'; by: string | null; note: string | null;
}

@Injectable()
export class PostReviewService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly chat?: ContentChatService,
  ) {}

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
      const status = clientStatusOf(r as { status: string; heldAt?: Date | null; approvedAt?: Date | null; scheduledAt?: Date | null });
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
        reviewRequestedAt: (r.reviewRequestedAt as Date | null) ?? null,
        links: results.map((x) => ({ channel: String(x.channel ?? ''), url: x.url ?? null })),
        stats: null,
      });
    }
    // What went out, and what it earned. Same tenantId as the posts above —
    // a post id is only ever looked up under the salon that owns it.
    const postedIds = posts.filter((p) => p.clientStatus === 'posted').map((p) => p.id);
    if (postedIds.length) {
      const social = await (this.loose.socialPost?.findMany({
        where: { tenantId, scheduledPostId: { in: postedIds }, deletedAt: null },
        select: { scheduledPostId: true, views: true, reach: true, likes: true, comments: true },
      }).catch(() => []) ?? Promise.resolve([])) as { scheduledPostId?: string | null; views?: number | null; reach?: number | null; likes?: number | null; comments?: number | null }[];
      const byPost = statsByPost(social ?? []);
      for (const p of posts) p.stats = byPost.get(p.id) ?? null;
    }
    // The plan's ideas are an addition to this feed, never a condition of it:
    // if the sheet cannot be read, the posts still arrive.
    let ideas: LinkIdea[] = [];
    try { ideas = await this.ideasFor(tenantId, tenant.timezone || 'UTC', new Set(posts.map((p) => p.id))); } catch { ideas = []; }
    return {
      salonName: tenant.name,
      timezone: tenant.timezone || 'UTC',
      pageName: page?.pageName ?? tenant.name,
      igUsername: page?.igUsername ?? null,
      posts,
      waiting: posts.filter((p) => p.clientStatus === 'wait').length,
      ideas,
      ideasWaiting: ideas.filter((i) => i.status === 'wait').length,
    };
  }

  // ---- the plan's ideas ---------------------------------------------------------
  //
  // The month plan (plan-sheet) holds a day's IDEA before there is a post:
  // topic, caption draft, format, networks. The salon answers for the idea
  // first and for the finished post later — one calendar, two questions
  // (13/11/2026). Everything here is additive: a stored day without `client`
  // is simply a day nobody has answered, and nothing is blocked by it.

  private async sheetRow(tenantId: string, month: string) {
    const key = `${PLAN_SHEET_KEY}:${month}`;
    const row = await this.prisma.setting.findFirst({ where: { tenantId, key }, select: { id: true, value: true } }).catch(() => null);
    return { id: row?.id ?? null, sheet: cleanSheet(row?.value ?? null, month) };
  }

  /**
   * The days from today on that are still ideas to the client: written, and
   * with no post the client can already see. This month and the next two.
   * Rebuilt field by field (entryForShop): no Drive link, no by-line.
   */
  private async ideasFor(tenantId: string, tz: string, visiblePostIds: Set<string>): Promise<LinkIdea[]> {
    if (!this.prisma.setting) return [];
    const today = dayKeyTz(new Date(), tz);
    const month0 = today.slice(0, 7);
    const tagsRow = await this.prisma.setting.findFirst({ where: { tenantId, key: PLAN_TAGS_KEY }, select: { value: true } }).catch(() => null);
    const tags = readTags(tagsRow?.value);
    const label = (list: { id: string; vi: string; en: string }[], id: string) => { const t = list.find((x) => x.id === id); return t ? { vi: t.vi, en: t.en } : null; };
    const out: LinkIdea[] = [];
    for (const m of [month0, shiftMonthKey(month0, 1), shiftMonthKey(month0, 2)]) {
      const { sheet } = await this.sheetRow(tenantId, m);
      for (const e of Object.values(sheet)) {
        if (e.day < today || !ideaReady(e)) continue;
        if (e.postId && visiblePostIds.has(e.postId)) continue; // the post speaks for this day now
        const s = entryForShop(e);
        out.push({
          day: s.day, topic: s.topic, detail: s.detail, air: s.air,
          pillar: label(tags.pillars, s.pillar), format: label(tags.formats, s.format),
          status: ideaStatusOf(e), by: e.client?.by ?? null, note: e.client?.state === 'change' ? e.client.note : null,
        });
      }
    }
    return out.sort((a, b) => a.day.localeCompare(b.day));
  }

  /**
   * The salon's answer for one day's idea. `tenantId` comes from the session
   * or from the token — never from the request — so a link can only reach
   * its own salon's sheet; the day is looked up inside that sheet or not at
   * all. An approval does not publish or schedule anything.
   */
  async decideIdea(tenantId: string, day: string, state: 'approved' | 'change', name: string, note = '') {
    if (!isDayKey(day)) throw new BadRequestException('day must be YYYY-MM-DD');
    const who = String(name ?? '').trim().slice(0, 60) || 'Tiệm';
    const text = String(note ?? '').trim();
    if (state === 'change' && !text) throw new BadRequestException('Ghi giúp điều anh/chị muốn đổi nhé.');
    const month = day.slice(0, 7);
    const { id, sheet } = await this.sheetRow(tenantId, month);
    const entry = sheet[day];
    if (!id || !entry || !ideaReady(entry)) throw new NotFoundException('Ngày này chưa có kế hoạch để duyệt.');
    sheet[day] = setClientDecision(entry, state, who, text, new Date());
    await this.prisma.setting.update({ where: { id }, data: { value: sheet as never } });
    await this.audit({ tenantId, userId: null, action: state === 'approved' ? 'content.plan_day_approved' : 'content.plan_day_change_asked', resourceType: 'plan_day', resourceId: day, metadata: { by: who } });
    void this.chat?.alertPlanDay(tenantId, day, who, state, text).catch(() => undefined);
    return { ok: true, day, status: ideaStatusOf(sheet[day]) };
  }

  async feedFor(user: AuthenticatedUser) {
    return this.feed(this.tenantOf(user));
  }

  /** audit_logs row; never lets a logging hiccup fail the action it records. */
  private async audit(data: Record<string, unknown>): Promise<void> {
    try { await (this.prisma as unknown as { auditLog?: { create: (a: unknown) => Promise<unknown> } }).auditLog?.create({ data }); } catch { /* logged best-effort */ }
  }

  // ---- approving -------------------------------------------------------------

  async approve(tenantId: string, postId: string, name: string, opts: { notifyTeam?: boolean } = {}) {
    const who = String(name ?? '').trim().slice(0, 80) || 'Chủ tiệm';
    const r = await this.loose.scheduledPost?.updateMany({
      // Only a scheduled post takes a signature. Approving a held one is fine
      // too — the salon saying "actually it's OK" IS the answer — so a held
      // post that gets approved also releases its hold.
      where: { id: postId, tenantId, status: 'scheduled' },
      data: { approvedAt: new Date(), approvedByName: who, heldAt: null, reviewRequestedAt: null },
    }).catch(() => ({ count: 0 })) as { count: number };
    if (!r?.count) throw new NotFoundException('Bài không còn ở trạng thái chờ duyệt.');
    // Through the link nobody on the team is watching the screen: tell them.
    if (opts.notifyTeam) void this.chat?.alertApproved(tenantId, postId, who).catch(() => undefined);
    await this.audit({ tenantId, userId: null, action: 'content.post_approved', resourceType: 'scheduled_post', resourceId: postId, metadata: { by: who, via: opts.notifyTeam ? 'plan_link' : 'salon_login' } });
    return { ok: true, approvedByName: who };
  }

  async approveFor(user: AuthenticatedUser, postId: string) {
    const email = String(user.email ?? '');
    const person = email.includes('@') ? email.split('@')[0].replace(/[._-]+/g, ' ') : email;
    return this.approve(this.tenantOf(user), postId, person);
  }

  // ---- the link --------------------------------------------------------------

  private async linkRow(tenantId: string): Promise<{ secret?: string; createdAt?: string; code?: string } | null> {
    const row = await this.prisma.setting.findFirst({
      where: { tenantId, key: LINK_KEY },
      select: { value: true },
    }).catch(() => null);
    return (row?.value as { secret?: string; createdAt?: string; code?: string } | null) ?? null;
  }

  /** Team only: the share-into-the-group link. Reuses a fresh one, mints on demand. */
  async ensureLink(user: AuthenticatedUser) {
    if (user.role !== UserRole.SUPER_ADMIN && !user.supportSession) {
      throw new ForbiddenException('Chỉ đội Lumio tạo link duyệt bài.');
    }
    const tenantId = this.tenantOf(user);
    let row = await this.linkRow(tenantId);
    const fresh = Boolean(row?.secret) && tokenFresh(row?.createdAt);
    if (!fresh || !row?.code) {
      // A link made before the short code keeps its secret and its 30 days —
      // the long address already in a group chat must not die because
      // somebody pressed the button again. It only gains a code.
      row = fresh
        ? { ...row, code: makeShortCode(randomBytes(SHORT_CODE_LEN)) }
        : { secret: randomBytes(24).toString('hex'), createdAt: new Date().toISOString(), code: makeShortCode(randomBytes(SHORT_CODE_LEN)) };
      if (!fresh) {
        await this.audit({ tenantId, userId: user.userId ?? null, action: 'content.plan_link_created', resourceType: 'setting', resourceId: LINK_KEY });
      }
      const existing = await this.prisma.setting.findFirst({ where: { tenantId, key: LINK_KEY }, select: { id: true } }).catch(() => null);
      if (existing) await this.prisma.setting.update({ where: { id: existing.id }, data: { value: row as never } });
      else await this.prisma.setting.create({ data: { tenantId, key: LINK_KEY, value: row as never } });
    }
    const token = row.code!;
    const base = process.env.PUBLIC_WEB_URL || 'https://lumiobooking.com';
    // /plan/{token}: the month plan the client reads and approves. The older
    // /review-posts/{token} address still opens the same page.
    return { url: `${base}/plan/${token}`, expiresAt: new Date(Date.parse(row.createdAt!) + REVIEW_LINK_TTL_DAYS * 86_400_000) };
  }

  async revokeLink(user: AuthenticatedUser) {
    if (user.role !== UserRole.SUPER_ADMIN && !user.supportSession) {
      throw new ForbiddenException('Chỉ đội Lumio thu hồi link.');
    }
    const tenantId = this.tenantOf(user);
    const existing = await this.prisma.setting.findFirst({ where: { tenantId, key: LINK_KEY }, select: { id: true } }).catch(() => null);
    if (existing) await this.prisma.setting.update({ where: { id: existing.id }, data: { value: {} as never } });
    await this.audit({ tenantId, userId: user.userId ?? null, action: 'content.plan_link_revoked', resourceType: 'setting', resourceId: LINK_KEY });
    return { ok: true };
  }

  /** A token from the wild into a tenantId — or nothing. Never throws detail. */
  async resolveToken(token: string): Promise<string | null> {
    if (isShortCode(token)) {
      // The short link: the code is the whole credential, so it is looked up,
      // not parsed. It belongs to one salon's row or to none.
      const hit = await this.prisma.setting.findFirst({
        where: { key: LINK_KEY, value: { path: ['code'], equals: token } },
        select: { tenantId: true, value: true },
      }).catch(() => null);
      const v = (hit?.value ?? null) as { secret?: string; createdAt?: string; code?: string } | null;
      if (!hit?.tenantId || !v?.secret || v.code !== token || !tokenFresh(v.createdAt)) return null;
      return hit.tenantId;
    }
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
    void this.chat?.alertTeam(tenantId, subject, text, who).catch(() => undefined);
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
