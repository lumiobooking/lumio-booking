import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import {
  planPublish, dueNow, MAX_ATTEMPTS,
  type Channel, type ConnectedPage, type PublishPlan,
} from './social-publish';

const GRAPH = 'https://graph.facebook.com/' + (process.env.META_GRAPH_VERSION || 'v21.0');

interface PostRow {
  id: string; tenantId: string; channels: unknown; message: string; imageUrl: string | null;
  scheduledAt: Date; status: string; attempts: number; lastError: string | null;
  results: unknown; postedAt: Date | null; createdByName: string | null; ideaId: string | null;
}

interface PublishResult { channel: Channel; id: string | null; url: string | null; error: string | null }

/**
 * Publishing the salon's approved posts to the salon's own Page and Instagram.
 *
 * TENANT ISOLATION IS THE FIRST RULE, NOT A LATER CHECK
 *
 * Every read and write here is filtered by the tenant on the JWT, and the page
 * a post is sent to is looked up FROM that tenant. There is no code path where a
 * post id alone selects a row: publishing to the wrong salon's Facebook Page
 * would be a public, permanent mistake in front of that salon's customers.
 *
 * THE TOKEN IS NEVER STORED ON THE POST
 *
 * It is read from MessengerPage at send time. A Page access token copied onto a
 * queue row is a token that outlives the salon disconnecting their page, and one
 * more place a leak can come from.
 */
@Injectable()
export class SocialPublishService {
  private readonly log = new Logger(SocialPublishService.name);
  constructor(private readonly prisma: PrismaService) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = user?.tenantId;
    if (!id) throw new BadRequestException('Thiếu tenant.');
    return id;
  }

  /** Loose access: the model exists on deploy but not in the local client. */
  private get posts() {
    return (this.prisma as unknown as Record<string, {
      findMany: (a: unknown) => Promise<unknown>;
      findFirst: (a: unknown) => Promise<unknown>;
      create: (a: unknown) => Promise<unknown>;
      update: (a: unknown) => Promise<unknown>;
      updateMany: (a: unknown) => Promise<unknown>;
    }>).scheduledPost;
  }

  /** The one page this tenant publishes to, with its live token. */
  private async pageFor(tenantId: string): Promise<{ page: ConnectedPage; token: string } | null> {
    // Named `pg`, not `row`, deliberately: everywhere else in this file `row`
    // means a queued POST, and the one thing that must never happen is a page
    // id or token being read off a post. The lint in the isolation spec checks
    // for exactly that, so the two must not share a variable name.
    const pg = await this.prisma.messengerPage.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: { pageId: true, igId: true, igUsername: true, pageName: true, enabled: true, pageToken: true },
    }).catch(() => null);
    if (!pg) return null;
    return {
      page: {
        pageId: pg.pageId, igId: pg.igId ?? null, igUsername: pg.igUsername ?? null,
        pageName: pg.pageName ?? null, enabled: pg.enabled,
      },
      token: pg.pageToken,
    };
  }

  private channelsOf(row: { channels: unknown }): Channel[] {
    const raw = Array.isArray(row.channels) ? row.channels : [];
    return raw.filter((c): c is Channel => c === 'facebook' || c === 'instagram');
  }

  // ---- what the salon sees --------------------------------------------------

  /**
   * The queue, and whether each row can actually go out.
   *
   * The check runs on READ, not only on save: a post written on Monday for
   * Friday can be broken by Thursday — the salon disconnects the Page, or
   * unlinks Instagram — and a queue that still shows a green "scheduled" for a
   * post that can no longer be delivered is a queue that lies.
   */
  async list(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const rows = await this.posts?.findMany({
      where: { tenantId },
      orderBy: { scheduledAt: 'asc' },
      take: 100,
    }).catch(() => []) as PostRow[];

    const conn = await this.pageFor(tenantId);
    return {
      connected: conn ? {
        pageName: conn.page.pageName, igUsername: conn.page.igUsername,
        hasInstagram: Boolean(conn.page.igId), enabled: conn.page.enabled,
      } : null,
      posts: (rows ?? []).map((r) => {
        const plan = planPublish(
          { channels: this.channelsOf(r), message: r.message, imageUrl: r.imageUrl },
          conn?.page ?? null,
        );
        return {
          id: r.id,
          ideaId: r.ideaId,
          channels: this.channelsOf(r),
          message: r.message,
          imageUrl: r.imageUrl,
          scheduledAt: r.scheduledAt,
          status: r.status,
          attempts: r.attempts,
          lastError: r.lastError,
          results: Array.isArray(r.results) ? r.results : [],
          postedAt: r.postedAt,
          createdByName: r.createdByName,
          // Only meaningful while it is still waiting; a posted row's page state
          // says nothing about what already went out.
          blockers: r.status === 'draft' || r.status === 'scheduled' ? plan.problems : [],
        };
      }),
    };
  }

  // ---- writing --------------------------------------------------------------

  async save(user: AuthenticatedUser, body: {
    id?: string; ideaId?: string | null; channels?: Channel[]; message?: string;
    imageUrl?: string | null; scheduledAt?: string; status?: string;
  }) {
    const tenantId = this.tenantId(user);
    const channels = (body.channels ?? ['facebook']).filter((c) => c === 'facebook' || c === 'instagram');
    const message = (body.message ?? '').trim();
    const imageUrl = (body.imageUrl ?? '').trim() || null;
    const when = body.scheduledAt ? new Date(body.scheduledAt) : null;
    if (!message) throw new BadRequestException('Bài chưa có nội dung.');
    if (!when || Number.isNaN(when.getTime())) throw new BadRequestException('Chưa chọn thời gian đăng.');
    if (!channels.length) throw new BadRequestException('Chọn ít nhất một nơi để đăng.');

    const status = body.status === 'scheduled' ? 'scheduled' : 'draft';
    if (status === 'scheduled') {
      // Refuse at write time, while the person who wrote it is still looking at
      // it, rather than failing in a scheduler run nobody is watching.
      const conn = await this.pageFor(tenantId);
      const plan = planPublish({ channels, message, imageUrl }, conn?.page ?? null);
      if (!plan.ready) throw new BadRequestException(plan.problems.join(' '));
    }

    const data = { channels, message, imageUrl, scheduledAt: when, status };
    if (body.id) {
      const owned = await this.posts?.findFirst({ where: { id: body.id, tenantId }, select: { id: true, status: true } })
        .catch(() => null) as { id: string; status: string } | null;
      if (!owned) throw new NotFoundException('Không tìm thấy bài này.');
      // A post that already went out is history. Editing it here would change
      // the record without changing what is on Facebook.
      if (owned.status === 'posted') throw new BadRequestException('Bài đã đăng rồi — không sửa được nữa.');
      await this.posts?.update({ where: { id: owned.id }, data: { ...data, attempts: 0, lastError: null } });
      return { ok: true, id: owned.id };
    }

    const created = await this.posts?.create({
      data: { tenantId, ideaId: body.ideaId ?? null, ...data, createdByName: user.email ?? null },
    }) as { id: string };
    return { ok: true, id: created?.id };
  }

  async cancel(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const r = await this.posts?.updateMany({
      where: { id, tenantId, status: { in: ['draft', 'scheduled', 'failed', 'expired'] } },
      data: { status: 'cancelled' },
    }).catch(() => ({ count: 0 })) as { count: number };
    if (!r?.count) throw new NotFoundException('Không huỷ được — bài không tồn tại hoặc đã đăng.');
    return { ok: true };
  }

  /** Send one now. Also the call that satisfies Meta's API-test requirement. */
  async publishNow(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const row = await this.posts?.findFirst({ where: { id, tenantId } }).catch(() => null) as PostRow | null;
    if (!row) throw new NotFoundException('Không tìm thấy bài này.');
    if (row.status === 'posted') throw new BadRequestException('Bài này đã đăng rồi.');
    const out = await this.deliver(row);
    if (!out.ok) throw new BadRequestException(out.error ?? 'Đăng không thành công.');
    return out;
  }

  // ---- the scheduler --------------------------------------------------------

  /** Called every minute. Cross-tenant by nature; each send re-reads its own tenant's page. */
  async runDue(now = new Date()): Promise<{ sent: number; failed: number; expired: number }> {
    const rows = await this.posts?.findMany({
      where: { status: 'scheduled', scheduledAt: { lte: now } },
      orderBy: { scheduledAt: 'asc' },
      take: 50,
    }).catch(() => []) as PostRow[];

    const { send, expired } = dueNow(rows ?? [], now);
    for (const e of expired) {
      await this.posts?.update({
        where: { id: e.id },
        data: { status: 'expired', lastError: 'Quá hạn đăng — hệ thống không đăng bài cũ vào ngày khác.' },
      }).catch(() => undefined);
    }

    let sent = 0; let failed = 0;
    for (const p of send) {
      const full = (rows ?? []).find((r) => r.id === p.id)!;
      const out = await this.deliver(full).catch(() => ({ ok: false, error: 'lỗi không xác định', results: [] }));
      if (out.ok) sent += 1; else failed += 1;
    }
    if (sent || failed || expired.length) {
      this.log.log(`Scheduled posts: ${sent} sent, ${failed} failed, ${expired.length} expired`);
    }
    return { sent, failed, expired: expired.length };
  }

  // ---- delivery -------------------------------------------------------------

  private async deliver(row: PostRow): Promise<{ ok: boolean; error: string | null; results: PublishResult[] }> {
    const conn = await this.pageFor(row.tenantId);
    const channels = this.channelsOf(row);
    const plan: PublishPlan = planPublish(
      { channels, message: row.message, imageUrl: row.imageUrl },
      conn?.page ?? null,
    );
    if (!plan.ready || !conn) {
      const error = plan.problems.join(' ') || 'Chưa kết nối Trang.';
      await this.fail(row, error);
      return { ok: false, error, results: [] };
    }

    // Claim it first. Two scheduler instances running the same minute must not
    // both publish: a duplicate post is visible to every follower the salon has.
    const claimed = await this.posts?.updateMany({
      where: { id: row.id, status: { in: ['draft', 'scheduled', 'failed'] } },
      data: { status: 'publishing', attempts: { increment: 1 } },
    }).catch(() => ({ count: 0 })) as { count: number };
    if (!claimed?.count) return { ok: false, error: 'Bài đang được đăng ở tiến trình khác.', results: [] };

    const results: PublishResult[] = [];
    for (const p of plan.plans) {
      const r = p.channel === 'facebook'
        ? await this.toFacebook(p.targetId!, conn.token, row.message, row.imageUrl)
        : await this.toInstagram(p.targetId!, conn.token, row.imageUrl!, row.message);
      results.push(r);
    }

    const bad = results.filter((r) => r.error);
    if (bad.length) {
      // Partial delivery is recorded exactly as it happened. Rewriting it as a
      // clean failure would hide a post that really is live on Facebook.
      const error = bad.map((b) => `${b.channel}: ${b.error}`).join(' · ');
      await this.fail(row, error, results);
      return { ok: false, error, results };
    }

    await this.posts?.update({
      where: { id: row.id },
      data: { status: 'posted', postedAt: new Date(), results: results as never, lastError: null },
    }).catch(() => undefined);
    return { ok: true, error: null, results };
  }

  private async fail(row: PostRow, error: string, results: PublishResult[] = []) {
    const attempts = (row.attempts ?? 0) + 1;
    await this.posts?.update({
      where: { id: row.id },
      data: {
        // Back to 'scheduled' while retries remain, so the next sweep picks it
        // up; 'failed' only when we have stopped trying, so the word on screen
        // means "this needs you" rather than "it may still fix itself".
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'scheduled',
        lastError: error.slice(0, 500),
        results: results as never,
      },
    }).catch(() => undefined);
  }

  private async toFacebook(pageId: string, token: string, message: string, imageUrl: string | null): Promise<PublishResult> {
    // A post with a picture goes to /photos: posting the URL as a link instead
    // gives a small grey preview card, not the salon's photograph.
    const endpoint = imageUrl ? `${GRAPH}/${pageId}/photos` : `${GRAPH}/${pageId}/feed`;
    const body = new URLSearchParams({ access_token: token });
    if (imageUrl) { body.set('url', imageUrl); body.set('caption', message); }
    else body.set('message', message);
    try {
      const res = await fetch(endpoint, { method: 'POST', body, signal: AbortSignal.timeout(20_000) });
      const json = await res.json().catch(() => null) as { id?: string; post_id?: string; error?: { message?: string } } | null;
      if (!res.ok || json?.error) {
        return { channel: 'facebook', id: null, url: null, error: json?.error?.message ?? `Facebook ${res.status}` };
      }
      const id = json?.post_id ?? json?.id ?? null;
      return { channel: 'facebook', id, url: id ? `https://www.facebook.com/${id}` : null, error: null };
    } catch (e) {
      return { channel: 'facebook', id: null, url: null, error: e instanceof Error ? e.message : 'lỗi mạng' };
    }
  }

  /** Instagram publishing is two calls: build the container, then publish it. */
  private async toInstagram(igId: string, token: string, imageUrl: string, caption: string): Promise<PublishResult> {
    try {
      const make = new URLSearchParams({ image_url: imageUrl, caption, access_token: token });
      const c = await fetch(`${GRAPH}/${igId}/media`, { method: 'POST', body: make, signal: AbortSignal.timeout(30_000) });
      const cj = await c.json().catch(() => null) as { id?: string; error?: { message?: string } } | null;
      if (!c.ok || !cj?.id) {
        return { channel: 'instagram', id: null, url: null, error: cj?.error?.message ?? `Instagram ${c.status}` };
      }
      const pub = new URLSearchParams({ creation_id: cj.id, access_token: token });
      const p = await fetch(`${GRAPH}/${igId}/media_publish`, { method: 'POST', body: pub, signal: AbortSignal.timeout(30_000) });
      const pj = await p.json().catch(() => null) as { id?: string; error?: { message?: string } } | null;
      if (!p.ok || !pj?.id) {
        return { channel: 'instagram', id: null, url: null, error: pj?.error?.message ?? `Instagram publish ${p.status}` };
      }
      return { channel: 'instagram', id: pj.id, url: `https://www.instagram.com/p/${pj.id}`, error: null };
    } catch (e) {
      return { channel: 'instagram', id: null, url: null, error: e instanceof Error ? e.message : 'lỗi mạng' };
    }
  }
}
