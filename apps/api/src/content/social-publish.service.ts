import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import {
  planPublish, dueNow, crowding, shapeOf, MAX_ATTEMPTS,
  type Channel, type ConnectedPage, type PublishPlan, type MediaItem,
} from './social-publish';

const GRAPH = 'https://graph.facebook.com/' + (process.env.META_GRAPH_VERSION || 'v21.0');

interface PostRow {
  id: string; tenantId: string; channels: unknown; message: string;
  media: unknown; imageUrl: string | null;
  scheduledAt: Date; status: string; attempts: number; lastError: string | null;
  results: unknown; postedAt: Date | null; createdByName: string | null; ideaId: string | null;
}

/**
 * Where one channel's attempt landed.
 *
 * Exported because it appears in the return type of `publishNow`, which the
 * controller re-exports. With `declaration: true` a private interface in a
 * public signature is a build error (TS4053) — and `tsc --noEmit` does NOT
 * emit declarations, so it does not catch it. The real build does.
 */
export interface PublishResult { channel: Channel; id: string | null; url: string | null; error: string | null }

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
 *
 * VIDEO IS NOT A BIGGER PHOTO
 *
 * Instagram accepts a photo container and can publish it in the same breath. A
 * video container has to be TRANSCODED first, and publishing before it is
 * finished fails. So video waits on a status poll — see `awaitContainer`. This
 * is the single biggest difference between the two, and getting it wrong looks
 * exactly like a flaky API.
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

  /**
   * The post's media, normalised.
   *
   * Rows written before media[] existed carry a single `imageUrl`. Reading them
   * through here means the old rows keep publishing instead of silently losing
   * their picture on the deploy that added the column.
   */
  private mediaOf(row: { media: unknown; imageUrl?: string | null }): MediaItem[] {
    const raw = Array.isArray(row.media) ? row.media : [];
    const out = raw
      .filter((m): m is { url: string; kind?: string } => Boolean(m) && typeof (m as { url?: unknown }).url === 'string')
      .map((m) => ({ url: m.url.trim(), kind: m.kind === 'video' ? 'video' as const : 'image' as const }))
      .filter((m) => m.url);
    if (out.length) return out;
    const legacy = (row.imageUrl ?? '').trim();
    return legacy ? [{ url: legacy, kind: 'image' as const }] : [];
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
      take: 300,
    }).catch(() => []) as PostRow[];

    const conn = await this.pageFor(tenantId);
    const posts = (rows ?? []).map((r) => {
      const media = this.mediaOf(r);
      const channels = this.channelsOf(r);
      const plan = planPublish({ channels, message: r.message, media }, conn?.page ?? null);
      return {
        id: r.id,
        ideaId: r.ideaId,
        channels,
        message: r.message,
        media,
        shape: shapeOf(media),
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
    });

    // Advice about a month laid end to end, kept separate from `blockers`:
    // crowding never stops a post, and mixing the two would train the salon to
    // ignore the ones that do.
    const live = posts.filter((p) => p.status === 'draft' || p.status === 'scheduled');
    return {
      connected: conn ? {
        pageName: conn.page.pageName, igUsername: conn.page.igUsername,
        hasInstagram: Boolean(conn.page.igId), enabled: conn.page.enabled,
      } : null,
      posts,
      crowding: crowding(live.map((p) => ({ id: p.id, scheduledAt: p.scheduledAt, channels: p.channels }))),
    };
  }

  // ---- writing --------------------------------------------------------------

  async save(user: AuthenticatedUser, body: {
    id?: string; ideaId?: string | null; channels?: Channel[]; message?: string;
    media?: { url?: string; kind?: string }[]; scheduledAt?: string; status?: string;
  }) {
    const tenantId = this.tenantId(user);
    const channels = (body.channels ?? ['facebook']).filter((c) => c === 'facebook' || c === 'instagram');
    const message = (body.message ?? '').trim();
    const media = this.mediaOf({ media: body.media ?? [] });
    const when = body.scheduledAt ? new Date(body.scheduledAt) : null;
    if (!message && !media.length) throw new BadRequestException('Bài chưa có nội dung.');
    if (!when || Number.isNaN(when.getTime())) throw new BadRequestException('Chưa chọn thời gian đăng.');
    if (!channels.length) throw new BadRequestException('Chọn ít nhất một nơi để đăng.');

    const status = body.status === 'scheduled' ? 'scheduled' : 'draft';
    if (status === 'scheduled') {
      // Refuse at write time, while the person who wrote it is still looking at
      // it, rather than failing in a scheduler run nobody is watching.
      const conn = await this.pageFor(tenantId);
      const plan = planPublish({ channels, message, media }, conn?.page ?? null);
      if (!plan.ready) throw new BadRequestException(plan.problems.join(' '));
    }

    const data = { channels, message, media, imageUrl: null, scheduledAt: when, status };
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

  /**
   * Move one post to a new time — the drag on the month calendar.
   *
   * Its own endpoint rather than a full save, because dragging a card must not
   * require the client to send back the message and every media URL. A round
   * trip that re-posts the whole body is a round trip that can lose an edit.
   */
  async reschedule(user: AuthenticatedUser, id: string, scheduledAt: string) {
    const tenantId = this.tenantId(user);
    const when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime())) throw new BadRequestException('Thời gian không hợp lệ.');
    const r = await this.posts?.updateMany({
      where: { id, tenantId, status: { in: ['draft', 'scheduled', 'failed', 'expired'] } },
      data: { scheduledAt: when, status: 'scheduled', attempts: 0, lastError: null },
    }).catch(() => ({ count: 0 })) as { count: number };
    if (!r?.count) throw new NotFoundException('Không đổi được — bài không tồn tại hoặc đã đăng.');
    return { ok: true };
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
    const media = this.mediaOf(row);
    const plan: PublishPlan = planPublish({ channels, message: row.message, media }, conn?.page ?? null);
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
        ? await this.toFacebook(p.targetId!, conn.token, row.message, media)
        : await this.toInstagram(p.targetId!, conn.token, media, row.message);
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

  // ---- Facebook -------------------------------------------------------------

  private async post(url: string, body: URLSearchParams, timeoutMs = 30_000) {
    const res = await fetch(url, { method: 'POST', body, signal: AbortSignal.timeout(timeoutMs) });
    const json = await res.json().catch(() => null) as
      { id?: string; post_id?: string; error?: { message?: string } } | null;
    return { ok: res.ok && !json?.error, status: res.status, json };
  }

  private async toFacebook(pageId: string, token: string, message: string, media: MediaItem[]): Promise<PublishResult> {
    const fail = (e: string): PublishResult => ({ channel: 'facebook', id: null, url: null, error: e });
    const done = (id: string | null): PublishResult =>
      ({ channel: 'facebook', id, url: id ? `https://www.facebook.com/${id}` : null, error: null });
    try {
      const vid = media.find((m) => m.kind === 'video');
      if (vid) {
        const r = await this.post(`${GRAPH}/${pageId}/videos`, new URLSearchParams({
          file_url: vid.url, description: message, access_token: token,
        }), 60_000);
        if (!r.ok) return fail(r.json?.error?.message ?? `Facebook ${r.status}`);
        return done(r.json?.id ?? null);
      }

      if (media.length === 0) {
        const r = await this.post(`${GRAPH}/${pageId}/feed`, new URLSearchParams({ message, access_token: token }));
        if (!r.ok) return fail(r.json?.error?.message ?? `Facebook ${r.status}`);
        return done(r.json?.post_id ?? r.json?.id ?? null);
      }

      if (media.length === 1) {
        // /photos rather than /feed with a link: posting the URL as a link gives
        // a small grey preview card, not the salon's photograph.
        const r = await this.post(`${GRAPH}/${pageId}/photos`, new URLSearchParams({
          url: media[0].url, caption: message, access_token: token,
        }));
        if (!r.ok) return fail(r.json?.error?.message ?? `Facebook ${r.status}`);
        return done(r.json?.post_id ?? r.json?.id ?? null);
      }

      // Several photos: upload each UNPUBLISHED, then attach the ids to one
      // feed post. Uploading them published instead would put every photo on
      // the Page as its own post — the salon's followers would see five.
      const ids: string[] = [];
      for (const m of media) {
        const r = await this.post(`${GRAPH}/${pageId}/photos`, new URLSearchParams({
          url: m.url, published: 'false', access_token: token,
        }));
        if (!r.ok || !r.json?.id) return fail(r.json?.error?.message ?? `Facebook ${r.status}`);
        ids.push(r.json.id);
      }
      const body = new URLSearchParams({ message, access_token: token });
      ids.forEach((id, i) => body.set(`attached_media[${i}]`, JSON.stringify({ media_fbid: id })));
      const r = await this.post(`${GRAPH}/${pageId}/feed`, body);
      if (!r.ok) return fail(r.json?.error?.message ?? `Facebook ${r.status}`);
      return done(r.json?.post_id ?? r.json?.id ?? null);
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'lỗi mạng');
    }
  }

  // ---- Instagram ------------------------------------------------------------

  /**
   * Wait for a container to finish before publishing it.
   *
   * A photo container is ready immediately. A VIDEO container has to be
   * transcoded, and publishing before that finishes returns an error that looks
   * exactly like a flaky API — which is how this gets misdiagnosed. Polling
   * status_code is the documented way, and the only reliable one.
   */
  private async awaitContainer(id: string, token: string, tries = 20, gapMs = 3000): Promise<string | null> {
    for (let i = 0; i < tries; i += 1) {
      const res = await fetch(
        `${GRAPH}/${id}?fields=status_code,status&access_token=${encodeURIComponent(token)}`,
        { signal: AbortSignal.timeout(15_000) },
      ).catch(() => null);
      const j = await res?.json().catch(() => null) as { status_code?: string; status?: string } | null;
      const code = j?.status_code;
      if (code === 'FINISHED') return null;
      if (code === 'ERROR' || code === 'EXPIRED') return j?.status || `Instagram xử lý file thất bại (${code}).`;
      await new Promise((r) => setTimeout(r, gapMs));
    }
    return 'Instagram xử lý video quá lâu. Thử lại với file nhẹ hơn, hoặc kiểm tra link video.';
  }

  /** One container. `child` marks it as part of a carousel rather than a post. */
  private async igContainer(igId: string, token: string, m: MediaItem, caption: string | null, child: boolean) {
    const body = new URLSearchParams({ access_token: token });
    if (m.kind === 'video') {
      body.set('video_url', m.url);
      // A standalone video on a professional account publishes as a Reel; a
      // carousel item must NOT carry media_type, or the parent is rejected.
      if (!child) body.set('media_type', 'REELS');
    } else {
      body.set('image_url', m.url);
    }
    if (child) body.set('is_carousel_item', 'true');
    if (caption !== null) body.set('caption', caption);
    return this.post(`${GRAPH}/${igId}/media`, body, 60_000);
  }

  private async toInstagram(igId: string, token: string, media: MediaItem[], caption: string): Promise<PublishResult> {
    const fail = (e: string): PublishResult => ({ channel: 'instagram', id: null, url: null, error: e });
    try {
      let creationId: string;

      if (media.length === 1) {
        const c = await this.igContainer(igId, token, media[0], caption, false);
        if (!c.ok || !c.json?.id) return fail(c.json?.error?.message ?? `Instagram ${c.status}`);
        creationId = c.json.id;
      } else {
        // Children first, each waited on: a carousel whose third video is still
        // transcoding fails the parent, and the salon sees "unknown error".
        const children: string[] = [];
        for (const m of media) {
          const c = await this.igContainer(igId, token, m, null, true);
          if (!c.ok || !c.json?.id) return fail(c.json?.error?.message ?? `Instagram ${c.status}`);
          if (m.kind === 'video') {
            const err = await this.awaitContainer(c.json.id, token);
            if (err) return fail(err);
          }
          children.push(c.json.id);
        }
        const parent = await this.post(`${GRAPH}/${igId}/media`, new URLSearchParams({
          media_type: 'CAROUSEL', children: children.join(','), caption, access_token: token,
        }), 60_000);
        if (!parent.ok || !parent.json?.id) return fail(parent.json?.error?.message ?? `Instagram ${parent.status}`);
        creationId = parent.json.id;
      }

      // Wait unless it is a single photo, which is ready the moment it exists.
      if (!(media.length === 1 && media[0].kind === 'image')) {
        const err = await this.awaitContainer(creationId, token);
        if (err) return fail(err);
      }

      const p = await this.post(`${GRAPH}/${igId}/media_publish`, new URLSearchParams({
        creation_id: creationId, access_token: token,
      }), 60_000);
      if (!p.ok || !p.json?.id) return fail(p.json?.error?.message ?? `Instagram publish ${p.status}`);
      return { channel: 'instagram', id: p.json.id, url: `https://www.instagram.com/p/${p.json.id}`, error: null };
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'lỗi mạng');
    }
  }
}
