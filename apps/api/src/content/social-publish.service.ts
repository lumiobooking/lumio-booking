import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { wallTimeToUtcTz } from '../common/salon-time';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import {
  planPublish, dueNow, crowding, shapeOf, explainMetaError, gbpLanguage, MAX_ATTEMPTS, CHANNELS,
  type Channel, type ConnectedPage, type PublishPlan, type MediaItem, type GoogleLocation,
} from './social-publish';
import { planPurge, storagePathOf, DEFAULT_RETENTION_DAYS, type RetentionPost } from './media-retention';
import { MEDIA_STORE, type MediaStore } from './media-store';
import { buildPostKit, type ShopFacts } from './post-kit';
import { publicWebBase } from '../common/public-url.util';
import { explainPublishGap, type GapCause, type PublishGrant } from '../messenger/publish-grant';
import { GoogleDriveService } from '../uploads/google-drive.service';
import { GoogleReviewsService } from '../google-reviews/google-reviews.service';
import { TikTokService } from '../tiktok/tiktok.service';
import { cleanTikTokOptions, type TikTokPostOptions, type TikTokTarget } from '../tiktok/tiktok';
import { checkGbpPost, gbpImageHeaderProblem, gbpSummary, type GbpCheck } from './gbp-policy';
import { gbpScreenPrompt, parseScreenVerdict, screenRefusal, type ScreenVerdict } from './gbp-screen';
import { createHash } from 'crypto';
import {
  cleanStage, statusFor, keepDriveLinks, unarchived, postFolderName, mediaFileName, type Stage, type MediaRef,
} from './post-workflow';

const GRAPH = 'https://graph.facebook.com/' + (process.env.META_GRAPH_VERSION || 'v21.0');

interface PostRow {
  id: string; tenantId: string; channels: unknown; message: string;
  media: unknown; imageUrl: string | null;
  scheduledAt: Date; status: string; attempts: number; lastError: string | null;
  results: unknown; postedAt: Date | null; createdByName: string | null; ideaId: string | null;
  mediaPurgedAt?: Date | null;
  /** An open client request nobody has closed out. Red on the calendar. */
  heldAt?: Date | null;
  /** The team's workflow — see post-workflow.ts. Absent on rows that predate it. */
  stage?: string | null;
  writerName?: string | null;
  designerName?: string | null;
  teamNote?: string | null;
  driveFolderUrl?: string | null;
  /** TikTok's per-post decisions (tiktok/tiktok.ts). Absent on rows that predate it. */
  tiktok?: unknown;
}

/** The client's own words, carried to the screen that has to act on them. */
export interface HoldInfo {
  at: Date;
  /** Who asked. Null when the row predates the name being stored. */
  by: string | null;
  /** What they asked for, trimmed to what fits on a card. */
  note: string | null;
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
    // Optional so the isolation tests can build the service without Drive;
    // in the app it is always there (UploadsModule exports it).
    @Optional() private readonly drive?: GoogleDriveService,
    // Google Business posting rides the OAuth grant the reviews screen holds.
    // Optional for the same reason as Drive: the isolation tests build the
    // service bare, and a shop without Google simply has no third channel.
    @Optional() private readonly google?: GoogleReviewsService,
    // The client's TikTok account — same shape of optionality as Google.
    @Optional() private readonly tiktok?: TikTokService,
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

  /** Loose access: the conversation models, present on deploy only. */
  private get messages() {
    return (this.prisma as unknown as Record<string, {
      findMany: (a: unknown) => Promise<unknown>;
    }>).contentMessage;
  }

  private get threads() {
    return (this.prisma as unknown as Record<string, {
      updateMany: (a: unknown) => Promise<unknown>;
    }>).contentThread;
  }

  /**
   * The open requests behind the held posts, in the client's own words.
   *
   * One query for the whole month rather than one per post. A red card that
   * cannot say WHAT was asked sends the reader hunting through the inbox for
   * it, which is how the red gets ignored.
   */
  private async holdsFor(tenantId: string, postIds: string[]): Promise<Map<string, HoldInfo>> {
    const out = new Map<string, HoldInfo>();
    if (!postIds.length) return out;
    const rows = await this.messages?.findMany({
      where: { tenantId, side: 'salon', subject: { in: postIds.map((id) => `post:${id}`) } },
      orderBy: { createdAt: 'desc' },
      take: 400,
      select: { subject: true, authorName: true, body: true, createdAt: true },
    }).catch(() => []) as { subject: string; authorName: string | null; body: string | null; createdAt: Date }[];
    // Newest first, so the first row seen for a post is the latest thing asked.
    for (const r of rows ?? []) {
      const id = String(r.subject ?? '').slice('post:'.length);
      if (!id || out.has(id)) continue;
      out.set(id, {
        at: r.createdAt,
        by: r.authorName ?? null,
        note: (r.body ?? '').trim().slice(0, 400) || null,
      });
    }
    return out;
  }

  /**
   * Close the conversation attached to a post.
   *
   * Called wherever the post itself leaves the red, so the calendar and the
   * team inbox cannot end up saying different things about the same request.
   * A no-op when there was never a thread.
   */
  private async closeThread(tenantId: string, subject: string, byName: string | null) {
    await this.threads?.updateMany({
      where: { tenantId, subject, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedByName: byName ?? 'Lumio' },
    }).catch(() => undefined);
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
        // `contactPhone` lives on the tenant row, not in company_extra. Reading
        // it from the wrong place is why the first version of this block went
        // out with no phone line at all — silently, because a missing fact is
        // omitted rather than faked.
        select: { name: true, slug: true, city: true, market: true, businessType: true, contactPhone: true } as never,
      }).catch(() => null),
      this.prisma.setting.findFirst({ where: { tenantId, key: 'company_extra' }, select: { value: true } }).catch(() => null),
      this.prisma.setting.findFirst({ where: { tenantId, key: 'business_profile' }, select: { value: true } }).catch(() => null),
    ]);
    const tenant = (t ?? {}) as {
      name?: string; slug?: string; city?: string | null; market?: string;
      businessType?: string; contactPhone?: string | null;
    };
    const extra = (extraRow?.value ?? {}) as { address?: string; website?: string };
    const profile = (profileRow?.value ?? {}) as { trade?: string };

    const shop: ShopFacts = {
      name: tenant.name ?? '',
      phone: tenant.contactPhone ?? null,
      address: extra.address ?? null,
      city: tenant.city ?? null,
      instagram: igUsername,
      // Printed. Some shops take no bookings through Lumio at all.
      website: extra.website ?? null,
      // Checked, never printed — a writer who pastes a booking CTA by hand can
      // paste another salon's, and that is unambiguous when it is wrong.
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
   *
   * KEYED BY THE TOKEN, NOT THE SALON
   *
   * It was keyed by tenant, which meant a salon that reconnected its Page and
   * came straight back to this screen was shown the OLD token's answer for up
   * to five minutes: "still missing — reconnect". They had just reconnected.
   * That is the exact moment a fix message is tested, and it failed the test.
   * A new token is a different key and gets a fresh answer.
   */
  private scopeCache = new Map<string, { at: number; scopes: string[] }>();

  private async grantedScopes(tenantId: string, token: string): Promise<string[] | null> {
    const key = `${tenantId}:${token.slice(-24)}`;
    const hit = this.scopeCache.get(key);
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
      // Old tokens' entries are never read again; keep the map from growing
      // one entry per reconnect for the life of the process.
      for (const k of this.scopeCache.keys()) if (k.startsWith(`${tenantId}:`)) this.scopeCache.delete(k);
      this.scopeCache.set(key, { at: Date.now(), scopes: uniq });
      return uniq;
    } catch {
      return null;
    }
  }

  private channelsOf(row: { channels: unknown }): Channel[] {
    const raw = Array.isArray(row.channels) ? row.channels : [];
    return raw.filter((c): c is Channel => (CHANNELS as unknown[]).includes(c));
  }

  /**
   * The Google Business location this tenant may post to — looked up FROM the
   * tenant, like the Page, never off a post row. Null when not connected.
   */
  private async googleFor(tenantId: string): Promise<GoogleLocation | null> {
    if (!this.google) return null;
    return this.google.postingLocation(tenantId).catch(() => null);
  }

  /** The TikTok connection this tenant holds — from the tenant, never the row. */
  private async tiktokFor(tenantId: string): Promise<TikTokTarget | null> {
    if (!this.tiktok) return null;
    return this.tiktok.targetFor(tenantId).catch(() => null);
  }

  private tiktokOf(row: { tiktok?: unknown }): TikTokPostOptions | null {
    return cleanTikTokOptions(row.tiktok);
  }

  /**
   * The post's media, normalised.
   *
   * Rows written before media[] existed carry a single `imageUrl`. Reading them
   * through here means the old rows keep publishing instead of silently losing
   * their picture on the deploy that added the column.
   */
  private mediaOf(row: { media: unknown; imageUrl?: string | null }): MediaRef[] {
    const raw = Array.isArray(row.media) ? row.media : [];
    const out = raw
      .filter((m): m is { url: string; kind?: string; driveUrl?: string } => Boolean(m) && typeof (m as { url?: unknown }).url === 'string')
      .map((m) => ({
        url: m.url.trim(),
        kind: m.kind === 'video' ? 'video' as const : 'image' as const,
        // The archive copy rides along; the sweep and the screen both read it.
        ...(typeof m.driveUrl === 'string' && m.driveUrl.trim() ? { driveUrl: m.driveUrl.trim() } : {}),
      }))
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
    const gbp = await this.googleFor(tenantId);
    const tt = await this.tiktokFor(tenantId);

    // Can this connection publish at all? Asked before anything is attempted,
    // so the answer arrives on the screen rather than as a failed post — and so
    // a stale permission error can be recognised as stale.
    let missingScopes: string[] | null = null;
    let publishGap: { cause: GapCause; reconnectHelps: boolean } | null = null;
    if (conn) {
      const granted = await this.grantedScopes(tenantId, conn.token);
      if (granted) {
        const need = ['pages_manage_posts', ...(conn.page.igId ? ['instagram_content_publish'] : [])];
        missingScopes = need.filter((n) => !granted.includes(n));
        if (missingScopes.length) {
          // WHY it is missing decides what the screen tells the person to do.
          // "Reconnect" is only the fix when the person unticked the box; when
          // Meta never offered it, reconnecting is a treadmill. See
          // messenger/publish-grant.
          const row = await this.prisma.setting.findUnique({
            where: { tenantId_key: { tenantId, key: 'messenger_publish_grant' } },
          }).catch(() => null);
          const grant = (row?.value ?? null) as PublishGrant | null;
          publishGap = explainPublishGap(missingScopes, grant && typeof grant === 'object' && grant.scopes ? grant : null);
        }
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

    // Only the held ones are looked up: a month of green posts must not cost a
    // second query over every conversation the salon ever had.
    const holds = await this.holdsFor(tenantId, (rows ?? []).filter((r) => r.heldAt).map((r) => r.id));

    const posts = (rows ?? []).map((r) => {
      const media = this.mediaOf(r);
      const channels = this.channelsOf(r);
      const plan = planPublish({ channels, message: r.message, media, tiktok: this.tiktokOf(r) }, conn?.page ?? null, gbp, tt);
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
        // The team's path (post-workflow): where it stands, whose it is, the
        // note nobody outside the team sees, and where the files were filed.
        stage: cleanStage(r.stage),
        writerName: r.writerName ?? null,
        designerName: r.designerName ?? null,
        teamNote: r.teamNote ?? null,
        driveFolderUrl: r.driveFolderUrl ?? null,
        tiktok: this.tiktokOf(r),
        // The files are gone from storage; the post itself is untouched on
        // Facebook. The screen draws a placeholder instead of a broken image.
        mediaPurged: Boolean(r.mediaPurgedAt),
        // Only meaningful while it is still waiting; a posted row's page state
        // says nothing about what already went out.
        blockers: r.status === 'draft' || r.status === 'scheduled' ? plan.problems : [],
        /**
         * The client asked for something and nobody has said it is done.
         *
         * This is the red on the calendar, and it is also the reason the post
         * is not publishing — one field for both, so the colour can never
         * promise something the scheduler does not honour.
         */
        held: r.heldAt ? {
          at: r.heldAt,
          by: holds.get(r.id)?.by ?? null,
          note: holds.get(r.id)?.note ?? null,
        } : null,
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
        /** Why they are missing, and whether reconnecting is the fix. */
        publishGap,
      } : null,
      /**
       * The Business Profile location, when the shop connected one under
       * Đánh giá Google. Separate from `connected`: a shop can have Google
       * and no Facebook Page, and the composer offers whichever exists.
       */
      google: gbp ? { title: gbp.title } : null,
      /** The TikTok account, when connected: who it is and what it may post. */
      tiktok: tt ? { displayName: tt.displayName, username: tt.username, avatarUrl: tt.avatarUrl, needsReconnect: tt.needsReconnect, creator: tt.creator } : null,
      posts,
      /** True for a Lumio support session: may delete published rows too. */
      canDeletePosted: isLumio,
      crowding: crowding(live.map((p) => ({ id: p.id, scheduledAt: p.scheduledAt, channels: p.channels }))),
    };
  }

  // ---- writing --------------------------------------------------------------

  async save(user: AuthenticatedUser, body: {
    id?: string; ideaId?: string | null; channels?: Channel[]; message?: string;
    media?: { url?: string; kind?: string; driveUrl?: string }[]; scheduledAt?: string; status?: string;
    stage?: string; writerName?: string; designerName?: string; teamNote?: string;
    tiktok?: unknown;
  }) {
    const tenantId = this.tenantId(user);
    const channels = (body.channels ?? ['facebook']).filter((c) => (CHANNELS as unknown[]).includes(c));
    const message = (body.message ?? '').trim();
    let media = this.mediaOf({ media: body.media ?? [] });
    const when = body.scheduledAt ? await this.whenOf(tenantId, body.scheduledAt) : null;
    if (!message && !media.length) throw new BadRequestException('Bài chưa có nội dung.');
    if (!when || Number.isNaN(when.getTime())) throw new BadRequestException('Chưa chọn thời gian đăng.');
    if (!channels.length) throw new BadRequestException('Chọn ít nhất một nơi để đăng.');

    // The team's stage decides what status is allowed to say. "Schedule it"
    // on a post still in design is a request to lock it — so the stage moves
    // to ready; a post explicitly kept in writing/design stays a draft.
    const prevRow = body.id
      ? await this.posts?.findFirst({ where: { id: body.id, tenantId }, select: { id: true, status: true, media: true, stage: true, writerName: true, designerName: true, teamNote: true, tiktok: true } })
        .catch(() => null) as { id: string; status: string; media: unknown; stage?: string | null; writerName?: string | null; designerName?: string | null; teamNote?: string | null; tiktok?: unknown } | null
      : null;
    let stage: Stage = cleanStage(body.stage, prevRow ? cleanStage(prevRow.stage) : 'ready');
    if (body.status === 'scheduled' && body.stage === undefined) stage = 'ready';
    const status = statusFor(stage, body.status === 'scheduled' ? 'scheduled' : 'draft');
    if (prevRow) media = keepDriveLinks(media, this.mediaOf({ media: prevRow.media }));
    // TikTok's decisions travel with the post; a save that omits them keeps
    // what the row had, so a drag or a stage change cannot erase a choice.
    const tiktokOpts: TikTokPostOptions | null = body.tiktok !== undefined
      ? cleanTikTokOptions(body.tiktok)
      : (prevRow ? cleanTikTokOptions((prevRow as { tiktok?: unknown }).tiktok) : null);
    const workflow = {
      stage,
      writerName: typeof body.writerName === 'string' ? body.writerName.trim().slice(0, 80) || null : prevRow?.writerName ?? null,
      designerName: typeof body.designerName === 'string' ? body.designerName.trim().slice(0, 80) || null : prevRow?.designerName ?? null,
      teamNote: typeof body.teamNote === 'string' ? body.teamNote.trim().slice(0, 2000) || null : prevRow?.teamNote ?? null,
    };
    if (status === 'scheduled') {
      // Refuse at write time, while the person who wrote it is still looking at
      // it, rather than failing in a scheduler run nobody is watching.
      const conn = await this.pageFor(tenantId);
      const plan = planPublish({ channels, message, media, tiktok: tiktokOpts }, conn?.page ?? null, await this.googleFor(tenantId), await this.tiktokFor(tenantId));
      if (!plan.ready) throw new BadRequestException(plan.problems.join(' '));
      if (channels.includes('google')) {
        const g = await this.googleGate(tenantId, message, media);
        if (g) throw new BadRequestException(g);
      }
    }

    // The key is written only when there is something to write: the isolation
    // spec reads the create payload for anything token-shaped, and an empty
    // "tiktok: null" would trip it for nothing.
    const tiktokVal = tiktokOpts ?? (body.tiktok && typeof body.tiktok === 'object' ? body.tiktok : null);
    const data = { channels, message, media, imageUrl: null, scheduledAt: when, status, ...workflow, ...(tiktokVal ? { tiktok: tiktokVal as never } : {}) };
    if (body.id) {
      const owned = prevRow;
      if (!owned) throw new NotFoundException('Không tìm thấy bài này.');
      // A post that already went out is history. Editing it here would change
      // the record without changing what is on Facebook.
      if (owned.status === 'posted') throw new BadRequestException('Bài đã đăng rồi — không sửa được nữa.');
      // An edit resets the salon's sign-off and releases any comment-hold:
      // what they approved is not what will publish now, and the team acting
      // on the post IS the answer the hold was waiting for.
      await this.posts?.update({ where: { id: owned.id }, data: { ...data, attempts: 0, lastError: null, approvedAt: null, approvedByName: null, heldAt: null } });
      // Out of the red, so the conversation that put it there is closed with
      // it. Leaving the thread open would keep the team inbox nagging about a
      // request that has already been carried out.
      await this.closeThread(tenantId, `post:${owned.id}`, user.email ?? null);
      void this.archiveToDrive(owned.id).catch((e) => this.log.warn(`drive archive ${owned.id}: ${e instanceof Error ? e.message : e}`));
      return { ok: true, id: owned.id };
    }

    const created = await this.posts?.create({
      data: { tenantId, ideaId: body.ideaId ?? null, ...data, createdByName: user.email ?? null },
    }) as { id: string };
    if (created?.id) void this.archiveToDrive(created.id).catch((e) => this.log.warn(`drive archive ${created.id}: ${e instanceof Error ? e.message : e}`));
    return { ok: true, id: created?.id };
  }

  /**
   * Move a post along the team's path without re-sending its body.
   *
   * Locking it (stage → ready) schedules it only when it can actually go
   * out; otherwise it stays a draft and the caller is told why, in the same
   * words the composer uses. Stepping back from ready pulls it out of the
   * sweep at once.
   */
  async setStage(user: AuthenticatedUser, id: string, body: { stage: string; writerName?: string; designerName?: string; teamNote?: string }) {
    const tenantId = this.tenantId(user);
    const row = await this.posts?.findFirst({ where: { id, tenantId } }).catch(() => null) as PostRow | null;
    if (!row) throw new NotFoundException('Không tìm thấy bài này.');
    if (row.status === 'posted' || row.status === 'publishing') throw new BadRequestException('Bài đã đăng rồi — không đổi trạng thái được nữa.');
    const stage = cleanStage(body.stage, cleanStage(row.stage));
    let status = row.status;
    let blockers: string[] = [];
    if (stage === 'ready') {
      const conn = await this.pageFor(tenantId);
      const plan = planPublish({ channels: this.channelsOf(row), message: row.message, media: this.mediaOf(row), tiktok: this.tiktokOf(row) }, conn?.page ?? null, await this.googleFor(tenantId), await this.tiktokFor(tenantId));
      blockers = plan.ready ? [] : plan.problems;
      if (plan.ready && this.channelsOf(row).includes('google')) {
        const g = await this.googleGate(tenantId, row.message, this.mediaOf(row));
        if (g) blockers = [g];
      }
      status = blockers.length === 0 ? 'scheduled' : 'draft';
    } else {
      status = 'draft';
    }
    const data: Record<string, unknown> = { stage, status };
    if (status === 'scheduled') Object.assign(data, { attempts: 0, lastError: null });
    if (typeof body.writerName === 'string') data.writerName = body.writerName.trim().slice(0, 80) || null;
    if (typeof body.designerName === 'string') data.designerName = body.designerName.trim().slice(0, 80) || null;
    if (typeof body.teamNote === 'string') data.teamNote = body.teamNote.trim().slice(0, 2000) || null;
    await this.posts?.updateMany({ where: { id, tenantId }, data });
    return { ok: true, stage, status, blockers };
  }

  /**
   * File this post's pictures and clips in the salon's Drive, in a folder
   * named for the day and the caption, and remember the links on the row.
   *
   * The reason: the same picture goes on the Google Business post and the
   * TikTok, and without this somebody re-downloads it from Facebook. Runs
   * after every save, copies only what is not copied yet, and never blocks
   * the save — Drive being slow is not the composer's problem.
   */
  async archiveToDrive(postId: string): Promise<{ copied: number }> {
    if (!this.drive || !(await this.drive.configured().catch(() => false))) return { copied: 0 };
    const row = await this.posts?.findFirst({ where: { id: postId } }).catch(() => null) as PostRow | null;
    if (!row) return { copied: 0 };
    const media = this.mediaOf(row);
    const todo = unarchived(media);
    if (!todo.length) return { copied: 0 };
    const tz = (await this.prisma.tenant.findUnique({ where: { id: row.tenantId }, select: { timezone: true } }).catch(() => null))?.timezone || 'America/Los_Angeles';
    const day = (() => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(row.scheduledAt); } catch { return row.scheduledAt.toISOString().slice(0, 10); } })();
    const folder = await this.drive.postFolder(row.tenantId, postFolderName(day, row.message));
    let copied = 0;
    const next = [...media];
    for (let i = 0; i < next.length; i += 1) {
      const m = next[i];
      if (m.driveUrl || !/^https?:\/\//i.test(m.url)) continue;
      try {
        const out = await this.drive.mirrorFromUrl(row.tenantId, m.url, mediaFileName(i, m), m.kind, folder.folderId);
        if (out?.url) { next[i] = { ...m, driveUrl: out.url }; copied += 1; }
      } catch (e) {
        this.log.warn(`drive copy failed for post ${postId} #${i + 1}: ${e instanceof Error ? e.message : e}`);
      }
    }
    await this.posts?.updateMany({ where: { id: postId }, data: { media: next, driveFolderUrl: folder.folderUrl } }).catch(() => undefined);
    return { copied };
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
    // A dragged post keeps its stage: one still being written or designed
    // moves day but stays a draft. Only a ready post is (re)armed.
    const cur = await this.posts?.findFirst({ where: { id, tenantId }, select: { stage: true } }).catch(() => null) as { stage?: string | null } | null;
    const ready = cleanStage(cur?.stage) === 'ready';
    const r = await this.posts?.updateMany({
      where: { id, tenantId, status: { in: ['draft', 'scheduled', 'failed', 'expired'] } },
      data: ready
        ? { scheduledAt: when, status: 'scheduled', attempts: 0, lastError: null }
        : { scheduledAt: when },
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
    const gbp = await this.googleFor(row.tenantId);
    const tt = await this.tiktokFor(row.tenantId);
    const channels = this.channelsOf(row);
    const media = this.mediaOf(row);
    const plan: PublishPlan = planPublish({ channels, message: row.message, media, tiktok: this.tiktokOf(row) }, conn?.page ?? null, gbp, tt);
    // A Meta channel that planned OK has a Page behind it (the planner refuses
    // otherwise); the second clause only keeps the compiler honest about `conn`.
    const needsMeta = plan.plans.some((p) => p.channel !== 'google' && p.channel !== 'tiktok');
    if (!plan.ready || (needsMeta && !conn)) {
      const error = plan.problems.join(' ') || 'Chưa kết nối Trang.';
      await this.fail(row, error);
      return { ok: false, error, results: [] };
    }
    // Google's policy gate runs again at send time — the picture's host may
    // have changed the file, and a post edited after its screen is a post
    // the screen never saw. Cached, so an unchanged post costs nothing.
    if (channels.includes('google')) {
      const g = await this.googleGate(row.tenantId, row.message, media);
      if (g) { await this.fail(row, g); return { ok: false, error: g, results: [] }; }
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
      const r = p.channel === 'google'
        ? await this.toGoogle(row.tenantId, row.message, media)
        : p.channel === 'tiktok'
          ? await this.toTikTok(row.tenantId, row.message, media, this.tiktokOf(row))
          : p.channel === 'facebook'
            ? await this.toFacebook(p.targetId!, conn!.token, row.message, media)
            : await this.toInstagram(p.targetId!, conn!.token, media, row.message);
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

  // ---- Google policy ----------------------------------------------------------

  /**
   * What the composer asks while the writer types: the text Google would get,
   * what was stripped, and every word-list finding. No network, no model —
   * cheap enough to call on every pause. `ai: true` adds the model's look at
   * the photo and the caption, for the "Kiểm duyệt" button.
   */
  async googleCheck(user: AuthenticatedUser, body: { message?: string; media?: { url?: string; kind?: string }[]; ai?: boolean }): Promise<GbpCheck & { ai: ScreenVerdict | null; aiOff: boolean }> {
    const tenantId = this.tenantId(user);
    const media = this.mediaOf({ media: body.media ?? [] });
    const check = checkGbpPost(body.message ?? '', media);
    let ai: ScreenVerdict | null = null;
    if (body.ai && check.blockers.length === 0) {
      const photo = media.find((m) => m.kind === 'image')?.url ?? null;
      if (photo) {
        const p = await this.googleImageProblem(photo);
        if (p) check.blockers.push({ code: 'file', vi: p, en: p });
      }
      if (check.blockers.length === 0) ai = await this.googleScreen(tenantId, check.summary, photo);
    }
    return { ...check, ai, aiOff: !process.env.ANTHROPIC_API_KEY };
  }

  /**
   * The gate every Google post passes before it is locked and again before
   * it is sent: the file's headers, then the model's look. The refusal, or
   * null. The word list ran already inside planPublish.
   */
  private async googleGate(tenantId: string, message: string, media: MediaItem[]): Promise<string | null> {
    const photo = media.find((m) => m.kind === 'image')?.url ?? null;
    if (photo) {
      const p = await this.googleImageProblem(photo);
      if (p) return `Google Business: ${p}`;
    }
    const v = await this.googleScreen(tenantId, checkGbpPost(message, media).summary, photo);
    return screenRefusal(v);
  }

  /**
   * Ask the picture's host what it is. Google fetches the file itself and
   * refuses anything but a JPG/PNG of 10 KB – 5 MB, an hour after the writer
   * has left — so the same question is asked here first. Null when the host
   * will not say (a CDN that answers HEAD with nothing): not proof of a
   * problem, so not a refusal.
   */
  private async googleImageProblem(url: string): Promise<string | null> {
    try {
      let res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(8_000) }).catch(() => null);
      if (!res || !res.ok || !res.headers.get('content-type')) {
        res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(8_000) }).catch(() => null);
        if (!res) return null;
        void res.body?.cancel().catch(() => undefined);
        if (!res.ok) return `Google sẽ không tải được ảnh này (link trả về HTTP ${res.status}). Tải lại bằng "Tải ảnh lên".`;
      }
      const len = Number(res.headers.get('content-length') || 0) || null;
      return gbpImageHeaderProblem({ contentType: res.headers.get('content-type'), contentLength: len });
    } catch {
      return null;
    }
  }

  /** Verdicts by (text, photo), for a day: a post locked at 9 and sent at 5 is screened once. */
  private screenCache = new Map<string, { at: number; v: ScreenVerdict }>();

  /**
   * The model reads the photo and the caption against Google's policy.
   * Null when there is no key or the call failed — "could not tell", which
   * the callers treat as "no refusal from here"; the word list still stands.
   */
  async googleScreen(tenantId: string, summary: string, photoUrl: string | null): Promise<ScreenVerdict | null> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return null;
    const hash = createHash('sha1').update(`${tenantId}\n${summary}\n${photoUrl ?? ''}`).digest('hex');
    const hit = this.screenCache.get(hash);
    if (hit && Date.now() - hit.at < 24 * 60 * 60 * 1000) return hit.v;

    const [t, profRow] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, businessType: true } }).catch(() => null) as Promise<{ name?: string; businessType?: string } | null>,
      this.prisma.setting.findFirst({ where: { tenantId, key: 'business_profile' }, select: { value: true } }).catch(() => null),
    ]);
    const prof = (profRow?.value ?? {}) as { trade?: string; whatWeDo?: string };
    const { system, user } = gbpScreenPrompt({
      summary, hasPhoto: Boolean(photoUrl), shopName: t?.name ?? '',
      trade: prof.whatWeDo?.trim() || prof.trade || t?.businessType || 'SALON',
    });
    const content: unknown[] = [];
    if (photoUrl) content.push({ type: 'image', source: { type: 'url', url: photoUrl } });
    content.push({ type: 'text', text: user });
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_AGENT_MODEL || 'claude-haiku-4-5-20251001',
        max_tokens: 700,
        system,
        messages: [{ role: 'user', content }],
      }),
      signal: AbortSignal.timeout(45_000),
    }).catch(() => null);
    if (!res || !res.ok) {
      this.log.warn(`gbp screen: model call failed for ${tenantId} (${res ? res.status : 'network'})`);
      return null;
    }
    const data = (await res.json().catch(() => ({}))) as { content?: { type?: string; text?: string }[] };
    const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('');
    const v = parseScreenVerdict(text, Boolean(photoUrl));
    if (!v) { this.log.warn(`gbp screen: unusable answer for ${tenantId}`); return null; }
    if (this.screenCache.size > 500) this.screenCache.clear();
    this.screenCache.set(hash, { at: Date.now(), v });
    return v;
  }

  // ---- TikTok -----------------------------------------------------------------

  /**
   * The post's one video to the client's TikTok. The token never passes
   * through here — TikTokService holds it and makes every call. TikTok
   * finishes processing in the background: a "pending" answer is still a
   * success, recorded with the publish id so the row is never sent twice.
   */
  private async toTikTok(tenantId: string, message: string, media: MediaItem[], opts: TikTokPostOptions | null): Promise<PublishResult> {
    const fail = (e: string): PublishResult => ({ channel: 'tiktok', id: null, url: null, error: e });
    if (!this.tiktok) return fail('TikTok chưa được bật trên máy chủ.');
    const video = media.find((m) => m.kind === 'video');
    if (!video || !opts) return fail('Bài thiếu video hoặc chưa chọn quyền riêng tư TikTok.');
    try {
      const out = await this.tiktok.publish(tenantId, { caption: message, videoUrl: video.url, opts });
      return { channel: 'tiktok', id: out.postId ?? out.publishId, url: out.url, error: null };
    } catch (e) {
      return fail(e instanceof Error ? e.message.replace(/^Bad Request Exception:?\s*/i, '') : 'lỗi mạng');
    }
  }

  // ---- Google Business Profile ----------------------------------------------

  /**
   * One "What's new" post on the shop's Business Profile: the caption, the
   * FIRST photo, and a Book button pointing at the shop's own booking page.
   *
   * The token never passes through here — GoogleReviewsService holds the
   * grant and makes the call, so a post row can no more carry a Google token
   * than it can carry a Page token.
   */
  private async toGoogle(tenantId: string, message: string, media: MediaItem[]): Promise<PublishResult> {
    const fail = (e: string): PublishResult => ({ channel: 'google', id: null, url: null, error: e });
    if (!this.google) return fail('Google Business chưa được bật trên máy chủ.');
    try {
      const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true } }).catch(() => null) as { slug?: string } | null;
      const bookingUrl = t?.slug ? `${publicWebBase()}/book/${t.slug}` : null;
      const photo = media.find((m) => m.kind === 'image')?.url ?? null;
      // What Google receives is the caption minus the contact block — the
      // same text the composer previewed and the gate approved.
      const summary = gbpSummary(message).text;
      const out = await this.google.createLocalPost(tenantId, {
        summary,
        languageCode: gbpLanguage(summary),
        photoUrl: photo,
        cta: bookingUrl ? { actionType: 'BOOK', url: bookingUrl } : null,
      });
      return { channel: 'google', id: out.name, url: out.url, error: null };
    } catch (e) {
      return fail(e instanceof Error ? e.message.replace(/^Bad Request Exception:?\s*/i, '') : 'lỗi mạng');
    }
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
