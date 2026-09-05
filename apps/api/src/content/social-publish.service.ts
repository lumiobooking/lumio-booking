import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { wallTimeToUtcTz } from '../common/salon-time';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import {
  planPublish, dueNow, crowding, shapeOf, explainMetaError, MAX_ATTEMPTS,
  type Channel, type ConnectedPage, type PublishPlan, type MediaItem,
} from './social-publish';
import { planPurge, storagePathOf, DEFAULT_RETENTION_DAYS, type RetentionPost } from './media-retention';
import { MEDIA_STORE, type MediaStore } from './media-store';
import { buildPostKit, type ShopFacts } from './post-kit';
import { publicWebBase } from '../common/public-url.util';

const GRAPH = 'https://graph.facebook.com/' + (process.env.META_GRAPH_VERSION || 'v21.0');

interface PostRow {
  id: string; tenantId: string; channels: unknown; message: string;
  media: unknown; imageUrl: string | null;
  scheduledAt: Date; status: string; attempts: number; lastError: string | null;
  results: unknown; postedAt: Date | null; createdByName: string | null; ideaId: string | null;
  mediaPurgedAt?: Date | null;
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
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_STORE) private readonly uploads: MediaStore,
  ) {}

  /**
   * A scheduledAt from the client as an instant. A full ISO instant (with Z or
   * an offset) is taken as-is; an OFFSETLESS "2026-09-02T20:00" is a wall time
   * and means 8pm AT THE SALON — the server's own zone must never decide when
   * a salon's post goes out.
   */
  private async whenOf(tenantId: string, scheduledAt: string): Promise<Date> {
    const sIn = String(scheduledAt ?? '');
    const wall = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(sIn);
    if (wall) {
      const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }).catch(() => null);
      return wallTimeToUtcTz(wall[1], wall[2], t?.timezone || 'UTC');
    }
    return new Date(sIn);
  }

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
      deleteMany: (a: unknown) => Promise<unknown>;
    }>).scheduledPost;
  }

  /** The one page this tenant publishes to, with its live token. */
  /**
   * The facts a post about THIS salon may contain, and the block it opens with.
   *
   * Gathered here so a new post starts already carrying the right address,
   * phone, handle and link — the writer types the caption and nothing else. One
   * person writes for eight salons with eight tabs open; the way this goes
   * wrong is copying last week's post from another shop and rewriting only the
   * words above the contact block. Building that block removes the chance to
   * get it wrong, and shipping the facts alongside lets the screen name
   * anything typed that is not ours.
   */
  private async postKitFor(tenantId: string, igUsername: string | null) {
    const [t, extraRow, profileRow] = await Promise.all([
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true, slug: true, city: true, market: true, businessType: true } as never,
      }).catch(() => null),
      this.prisma.setting.findFirst({ where: { tenantId, key: 'company_extra' }, select: { value: true } }).catch(() => null),
      this.prisma.setting.findFirst({ where: { tenantId, key: 'business_profile' }, select: { value: true } }).catch(() => null),
    ]);
    const tenant = (t ?? {}) as { name?: string; slug?: string; city?: string | null; market?: string; businessType?: string };
    const extra = (extraRow?.value ?? {}) as { address?: string; contactPhone?: string };
    const profile = (profileRow?.value ?? {}) as { trade?: string };

    const shop: ShopFacts = {
      name: tenant.name ?? '',
      // The number a customer rings is the one on the shop record, not the one
      // Lumio bills to.
      phone: (extra as { contactPhone?: string }).contactPhone ?? null,
      address: extra.address ?? null,
      city: tenant.city ?? null,
      instagram: igUsername,
      bookingUrl: tenant.slug ? `${publicWebBase()}/book/${tenant.slug}` : null,
    };
    // The declared trade wins over the enum default: `businessType` is SALON
    // for every shop that never said otherwise, and generic salon hashtags on a
    // lash studio's post reach the wrong crowd.
    const industry = profile.trade || tenant.businessType || 'SALON';
    return { shop, kit: buildPostKit(industry, tenant.market, shop) };
  }

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

  // ---- what the stored token can actually DO --------------------------------

  /**
   * Scopes the live Page token carries, cached briefly per tenant.
   *
   * WHY THIS EXISTS
   *
   * A Page access token carries only the permissions granted at the moment it
   * was issued. Adding pages_manage_posts to the app in the Meta dashboard does
   * nothing for a token minted before that — so a salon can be looking at a
   * correctly configured app, a correctly written post, and a permanent failure,
   * with no way to tell the difference except by trying to publish and reading a
   * Graph error about Facebook Groups.
   *
   * Asking Meta what the token holds turns that into a fact on screen, and it
   * answers the only question that matters after a reconnect: did it work?
   *
   * Cached five minutes because the queue screen reloads on every edit and this
   * is a real network call whose answer changes about twice a year.
   */
  private scopeCache = new Map<string, { at: number; scopes: string[] }>();

  private async grantedScopes(tenantId: string, token: string): Promise<string[] | null> {
    const hit = this.scopeCache.get(tenantId);
    if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.scopes;

    const appId = process.env.FB_APP_ID || '';
    const appSecret = process.env.FB_APP_SECRET || '';
    // Without the app credentials we cannot ask, and guessing would be worse
    // than saying nothing: a false "missing permission" sends the salon through
    // a reconnect that fixes nothing.
    if (!appId || !appSecret) return null;

    try {
      const res = await fetch(
        `${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}`
        + `&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      const j = await res.json().catch(() => null) as {
        data?: { scopes?: string[]; granular_scopes?: { scope: string }[] };
      } | null;
      if (!res.ok || !j?.data) return null;
      const scopes = [
        ...(j.data.scopes ?? []),
        ...((j.data.granular_scopes ?? []).map((g) => g.scope)),
      ];
      const uniq = Array.from(new Set(scopes));
      this.scopeCache.set(tenantId, { at: Date.now(), scopes: uniq });
      return uniq;
    } catch {
      return null;
    }
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
    // Lumio staff get the extra affordance; the screen must know before it
    // draws a button, not find out from an error afterwards.
    const isLumio = user.role === UserRole.SUPER_ADMIN || Boolean(user.supportSession);
    const rows = await this.posts?.findMany({
      where: { tenantId },
      orderBy: { scheduledAt: 'asc' },
      take: 300,
    }).catch(() => []) as PostRow[];

    const conn = await this.pageFor(tenantId);

    // Can this connection publish at all? Asked before anything is attempted,
    // so the answer arrives on the screen rather than as a failed post — and so
    // a stale permission error can be recognised as stale.
    let missingScopes: string[] | null = null;
    if (conn) {
      const granted = await this.grantedScopes(tenantId, conn.token);
      if (granted) {
        const need = ['pages_manage_posts', ...(conn.page.igId ? ['instagram_content_publish'] : [])];
        missingScopes = need.filter((n) => !granted.includes(n));
      }
    }
    /**
     * The permission has since been granted, so any saved permission error is
     * history rather than an instruction.
     *
     * Telling somebody to reconnect a Page they just reconnected is how a fix
     * message stops being believed. The error text is still shown — it explains
     * why the post is sitting there — but the "do this" line is dropped.
     */
    const permissionFixed = missingScopes !== null && missingScopes.length === 0;

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
        // Meta's own words are kept; this is the sentence that says what to DO.
        // Replacing the raw text would remove the only precise string anybody
        // can search for when this reaches support.
        fix: permissionFixed && /pages_manage_posts|instagram_content_publish|#200/i.test(r.lastError ?? '')
          ? null
          : explainMetaError(r.lastError),
        /** True when the saved error is about a permission the token now has. */
        errorIsStale: permissionFixed && /pages_manage_posts|instagram_content_publish|#200/i.test(r.lastError ?? ''),
        results: Array.isArray(r.results) ? r.results : [],
        postedAt: r.postedAt,
        createdByName: r.createdByName,
        // The files are gone from storage; the post itself is untouched on
        // Facebook. The screen draws a placeholder instead of a broken image.
        mediaPurged: Boolean(r.mediaPurgedAt),
        // Only meaningful while it is still waiting; a posted row's page state
        // says nothing about what already went out.
        blockers: r.status === 'draft' || r.status === 'scheduled' ? plan.problems : [],
      };
    });

    // Advice about a month laid end to end, kept separate from `blockers`:
    // crowding never stops a post, and mixing the two would train the salon to
    // ignore the ones that do.
    const live = posts.filter((p) => p.status === 'draft' || p.status === 'scheduled');
    const { shop, kit } = await this.postKitFor(tenantId, conn?.page.igUsername ?? null);
    return {
      // What a new post opens with, and the facts the screen checks a draft
      // against. `shop` names only THIS salon: the question a draft has to
      // answer is "is this ours?", never "whose is it?", and the second one
      // would put another client's details on this client's screen.
      postKit: { ...kit, shop },
      connected: conn ? {
        pageName: conn.page.pageName, igUsername: conn.page.igUsername,
        hasInstagram: Boolean(conn.page.igId), enabled: conn.page.enabled,
        // Null when we could not ask — which is not the same as "nothing is
        // missing", and the screen words it differently.
        missingScopes,
      } : null,
      posts,
      /** True for a Lumio support session: may delete published rows too. */
      canDeletePosted: isLumio,
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
    const when = body.scheduledAt ? await this.whenOf(tenantId, body.scheduledAt) : null;
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
      // An edit resets the salon's sign-off and releases any comment-hold:
      // what they approved is not what will publish now, and the team acting
      // on the post IS the answer the hold was waiting for.
      await this.posts?.update({ where: { id: owned.id }, data: { ...data, attempts: 0, lastError: null, approvedAt: null, approvedByName: null, heldAt: null } });
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
    const when = await this.whenOf(tenantId, scheduledAt);
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

  /**
   * Take a post off the calendar — only if it never went out.
   *
   * A PUBLISHED POST IS A RECORD, NOT A QUEUE ITEM
   *
   * I first allowed deleting these and was wrong. Once a post is live it stops
   * being a plan and becomes the answer to "what did we actually publish?" —
   * the row carries the time it went out and the links to the real posts, and it
   * is what the weekly results read to say how many pieces went up with a link
   * anyone can open. Delete it and the week's record quietly shrinks.
   *
   * There is also the trap underneath: deleting the row would NOT delete the
   * post on Facebook. A salon that believes "delete" pulled an offer down will
   * not go and pull it down, and the offer keeps running. Refusing outright is a
   * better answer than a warning nobody reads.
   *
   * The clutter this was meant to solve is handled where it belongs — the
   * calendar can hide published posts from view without erasing them.
   *
   * For everything else — draft, scheduled, failed, expired, cancelled — the row
   * is deleted rather than hidden. There is nothing in a post nobody sent that
   * anybody comes back for.
   */
  async remove(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const row = await this.posts?.findFirst({ where: { id, tenantId }, select: { id: true, status: true } })
      .catch(() => null) as { id: string; status: string } | null;
    if (!row) throw new NotFoundException('Không tìm thấy bài này.');
    // The Lumio team can clear a published row; the salon cannot.
    //
    // For the salon this row is their only account of what went up, and losing
    // it silently shrinks the week's results. For Lumio staff it is sometimes
    // test data that has to go, and they are the ones who understand that
    // deleting the row does NOT take the post off Facebook.
    const isLumio = user.role === UserRole.SUPER_ADMIN || Boolean(user.supportSession);
    if (row.status === 'posted' && !isLumio) {
      throw new BadRequestException(
        'Bài đã đăng thì không xoá được — đây là sổ ghi những gì thật sự đã lên trang. '
        + 'Muốn gỡ bài thì xoá trực tiếp trên Facebook/Instagram. '
        + 'Muốn lịch gọn hơn thì tắt "Hiện bài đã đăng" ở lịch tháng.',
      );
    }
    // Mid-flight. Deleting the row now would leave a publish in progress with
    // nothing to write its result to, and possibly a live post nobody knows of.
    if (row.status === 'publishing') {
      throw new BadRequestException('Bài đang được đăng — chờ xong rồi mới xoá được.');
    }
    // Scoped by tenant in the filter as well as the lookup: two checks, because
    // this one is not reversible.
    await this.posts?.deleteMany({ where: { id, tenantId } });
    // The caller says the sentence about Facebook; this says which case it was.
    return { ok: true, wasPosted: row.status === 'posted' };
  }

  /** Send one now. Also the call that satisfies Meta's API-test requirement. */
  async publishNow(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const row = await this.posts?.findFirst({ where: { id, tenantId } }).catch(() => null) as PostRow | null;
    if (!row) throw new NotFoundException('Không tìm thấy bài này.');
    if (row.status === 'posted') throw new BadRequestException('Bài này đã đăng rồi.');
    if (row.status === 'publishing') throw new BadRequestException('Bài này đang được đăng, chờ một chút.');

    // A press of "Post now" clears the wreckage of earlier attempts.
    //
    // Without this the button is a lie on exactly the rows that need it most: a
    // post that failed three times is past MAX_ATTEMPTS and a cancelled one is
    // not claimable, so the press returned "đang được đăng ở tiến trình khác" —
    // a message about a race that was not happening. The attempt counter and the
    // old error belong to a connection that has since been fixed; keeping them
    // would make the fresh attempt fail for a reason that no longer exists.
    await this.posts?.update({
      where: { id: row.id },
      data: { status: 'scheduled', attempts: 0, lastError: null },
    }).catch(() => undefined);

    const out = await this.deliver({ ...row, status: 'scheduled', attempts: 0, lastError: null });
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

  // ---- storage retention ----------------------------------------------------

  /**
   * Delete the uploaded pictures of posts that went out long enough ago.
   *
   * Cross-tenant by nature, like the publish sweep. Runs on the slow clock: this
   * is housekeeping, and a day late costs nothing.
   *
   * The decision of WHAT may go lives in media-retention.ts and is tested there
   * — it is the part where a mistake deletes a salon's picture before their post
   * has run, or deletes a file that was never ours.
   */
  async purgeOldMedia(now = new Date()): Promise<{ files: number; posts: number }> {
    const publicBase = await this.uploads.publicBase().catch(() => null);
    if (!publicBase) return { files: 0, posts: 0 };

    const days = Number(process.env.MEDIA_RETENTION_DAYS || DEFAULT_RETENTION_DAYS) || DEFAULT_RETENTION_DAYS;
    const rows = await this.posts?.findMany({
      // Everything still holding a claim on a file has to be in this set, not
      // just the expired rows: the plan keeps any file another post still needs.
      where: { OR: [{ mediaPurgedAt: null }, { status: { not: 'posted' } }] },
      orderBy: { postedAt: 'asc' },
      take: 2000,
      select: { id: true, status: true, postedAt: true, mediaPurgedAt: true, media: true, imageUrl: true },
    }).catch(() => []) as (PostRow & { media: unknown })[];

    const forPlan: RetentionPost[] = (rows ?? []).map((r) => ({
      id: r.id,
      status: r.status,
      postedAt: r.postedAt ?? null,
      mediaPurgedAt: r.mediaPurgedAt ?? null,
      mediaUrls: this.mediaOf(r).map((m) => m.url),
    }));

    const plan = planPurge(forPlan, publicBase, now, days);
    if (!plan.postIds.length) return { files: 0, posts: 0 };

    const paths = plan.urls
      .map((u) => storagePathOf(u, publicBase))
      .filter((p): p is string => Boolean(p));
    const out = await this.uploads.deletePaths(paths).catch(() => ({ deleted: 0, failed: paths.length }));

    await this.posts?.updateMany({
      where: { id: { in: plan.postIds } },
      data: { mediaPurgedAt: now },
    }).catch(() => undefined);

    if (out.deleted || plan.postIds.length) {
      this.log.log(`Media retention: ${out.deleted} file(s) deleted, ${plan.postIds.length} post(s) marked, ${out.failed} failed.`);
    }
    return { files: out.deleted, posts: plan.postIds.length };
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
    //
    // 'cancelled' and 'expired' are claimable because publishNow() deliberately
    // moves a row back into 'scheduled' before calling here — a human pressing
    // "Post now" on a cancelled post means exactly "send this anyway". They stay
    // OUT of the scheduler's own sweep (see dueNow), which only ever takes
    // 'scheduled'. Only 'posted' and 'publishing' are never claimable: one has
    // already gone out, the other is going out right now.
    const claimed = await this.posts?.updateMany({
      where: { id: row.id, status: { in: ['draft', 'scheduled', 'failed', 'cancelled', 'expired'] } },
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
      // A photo is normally FINISHED on the first poll, so the first check must
      // happen BEFORE any sleep — otherwise every photo post pays three seconds
      // it does not need.
      const res = await fetch(
        `${GRAPH}/${id}?fields=status_code,status&access_token=${encodeURIComponent(token)}`,
        { signal: AbortSignal.timeout(15_000) },
      ).catch(() => null);
      const j = await res?.json().catch(() => null) as { status_code?: string; status?: string } | null;
      const code = j?.status_code;
      if (code === 'FINISHED') return null;
      if (code === 'ERROR' || code === 'EXPIRED') return j?.status || `Instagram xử lý file thất bại (${code}).`;
      // No status_code at all, but the container answered: photo containers do
      // not always report one. Waiting sixty seconds for a field that will never
      // arrive, then blaming the video, would be worse than proceeding — the
      // publish call itself is the real check.
      if (res?.ok && j && code === undefined) return null;
      await new Promise((r) => setTimeout(r, gapMs));
    }
    return 'Instagram xử lý file quá lâu. Với video, thử file nhẹ hơn; với ảnh, kiểm tra link mở được từ trình duyệt lạ.';
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

      // ---- always wait, photos included ----
      //
      // I skipped this for a single photo on the reasoning that a photo
      // container is ready the moment it exists. Usually true; not always. When
      // it is not, media_publish answers "Media ID is not available" — a message
      // that names the container and says nothing about timing, so it reads like
      // a broken id rather than one that simply is not finished yet.
      //
      // The saving was one status call of a few hundred milliseconds, on a job
      // that runs in the background. The cost was an intermittent failure that
      // looks like a different bug every time it appears.
      const err = await this.awaitContainer(creationId, token);
      if (err) return fail(err);

      const p = await this.post(`${GRAPH}/${igId}/media_publish`, new URLSearchParams({
        creation_id: creationId, access_token: token,
      }), 60_000);
      if (!p.ok || !p.json?.id) return fail(p.json?.error?.message ?? `Instagram publish ${p.status}`);

      // instagram.com/p/{...} takes the post's SHORTCODE, not this numeric
      // Graph id — a link built from the id opens "Post isn't available" even
      // though the post is live. The real address is the permalink field, one
      // read away; if that read fails the post still succeeded, so answer
      // with no link rather than a broken one.
      let permalink: string | null = null;
      try {
        const pl = await fetch(
          `${GRAPH}/${p.json.id}?fields=permalink&access_token=${encodeURIComponent(token)}`,
          { signal: AbortSignal.timeout(15_000) },
        );
        const j = await pl.json().catch(() => null) as { permalink?: string } | null;
        if (pl.ok && j?.permalink) permalink = j.permalink;
      } catch { /* the post is up; only the pretty link is missing */ }
      return { channel: 'instagram', id: p.json.id, url: permalink, error: null };
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'lỗi mạng');
    }
  }
}
