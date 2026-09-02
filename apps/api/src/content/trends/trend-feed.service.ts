import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentService } from '../content.service';
import { AuthenticatedUser, resolveTenantScope } from '../../common/tenant/tenant-context';
import { localizeDeep, bi, type Txt } from '../i18n';
import { trendLinks } from '../trend-sources';
import {
  queriesFor, scopeOf, marketCodes, parseYouTube, parseInstagram, parseGoogleTrends, parsePinterest,
  rankItems, diversify, overlay, overlayQueries, needsRefresh, relevant, withGrowth, STALE_AFTER_HOURS,
  type TrendItem, type RisingQuery, type TrendSource,
} from './trend-feed';

const GRAPH = 'https://graph.facebook.com/' + (process.env.META_GRAPH_VERSION || 'v21.0');
const YT = 'https://www.googleapis.com/youtube/v3';
const DFS = 'https://api.dataforseo.com/v3';
const PIN = 'https://api.pinterest.com/v5';

/** One stored pull: (scope, source, tenant) → items. */
interface SnapshotRow {
  id: string;
  scope: string;
  source: TrendSource;
  tenantId: string | null;
  items: unknown;
  fetchedAt: Date | null;
  error: string | null;
}

/**
 * Pulls the trend feeds and serves them to salons — the half that talks to
 * the network and the database. Every rule about WHAT comes back is in
 * ./trend-feed.ts, where it can be tested with a fixture.
 *
 * TENANT ISOLATION
 *
 * Shared rows (YouTube, Google) have no tenant: they are about the trade, not
 * about anyone's business, and every salon in the same trade and market reads
 * the same one. Instagram rows are per tenant and are fetched with THAT
 * tenant's own connected account; the read path filters them by the tenant on
 * the JWT, and a tenant's row is never read on another's behalf.
 *
 * KEYS
 *
 * Each feed switches itself off when its key is missing, and says so in the
 * payload, so a deployment without a YouTube key shows "not configured" in
 * the right place rather than an empty screen with no explanation.
 */
@Injectable()
export class TrendFeedService {
  private readonly log = new Logger(TrendFeedService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly content: ContentService,
  ) {}

  /** Loose access: the model exists on deploy but not in the local client. */
  private get rows() {
    return (this.prisma as unknown as Record<string, {
      findMany: (a: unknown) => Promise<unknown>;
      findFirst: (a: unknown) => Promise<unknown>;
      upsert: (a: unknown) => Promise<unknown>;
    }>).trendSnapshot;
  }

  private get youtubeKey() { return process.env.YOUTUBE_API_KEY || ''; }
  private get dfsAuth() {
    const login = process.env.DATAFORSEO_LOGIN || '';
    const pass = process.env.DATAFORSEO_PASSWORD || '';
    return login && pass ? Buffer.from(`${login}:${pass}`).toString('base64') : '';
  }
  private get pinterestConfigured() {
    return Boolean(process.env.PINTEREST_ACCESS_TOKEN
      || (process.env.PINTEREST_APP_ID && process.env.PINTEREST_APP_SECRET && process.env.PINTEREST_REFRESH_TOKEN));
  }

  /** A refreshed Pinterest token, exchanged at most once an hour. */
  private pinCache: { token: string; until: number } | null = null;
  private async pinterestToken(): Promise<string> {
    const direct = process.env.PINTEREST_ACCESS_TOKEN || '';
    if (direct) return direct;
    if (this.pinCache && Date.now() < this.pinCache.until) return this.pinCache.token;
    const id = process.env.PINTEREST_APP_ID || '';
    const secret = process.env.PINTEREST_APP_SECRET || '';
    const refresh = process.env.PINTEREST_REFRESH_TOKEN || '';
    if (!id || !secret || !refresh) throw new Error('not_configured');
    const r = await this.getJson(`${PIN}/oauth/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refresh)}`,
    });
    const token = (r.body as { access_token?: string })?.access_token;
    if (!r.ok || !token) throw new Error(`pinterest token ${r.status}: ${JSON.stringify(r.body).slice(0, 160)}`);
    const expires = Number((r.body as { expires_in?: number })?.expires_in ?? 3600);
    this.pinCache = { token, until: Date.now() + Math.min(expires - 300, 24 * 3600) * 1000 };
    return token;
  }

  // ---- storage ---------------------------------------------------------------

  /** The unique handle: shared rows say so instead of carrying a null. */
  private keyOf(scope: string, source: TrendSource, tenantId: string | null) {
    return `${scope}:${source}:${tenantId ?? 'shared'}`;
  }

  private async read(scope: string, source: TrendSource, tenantId: string | null): Promise<SnapshotRow | null> {
    return await this.rows?.findFirst({ where: { key: this.keyOf(scope, source, tenantId) } }).catch(() => null) as SnapshotRow | null;
  }

  private async write(scope: string, source: TrendSource, tenantId: string | null, items: unknown[] | null, error: string | null) {
    // A failed pull keeps yesterday's items and records the error beside them:
    // a screen that shows last night's trends with a warning is better than one
    // that goes blank because a quota ran out at 6am.
    const data = error
      ? { error: error.slice(0, 400) }
      : { items: items as never, fetchedAt: new Date(), error: null };
    await this.rows?.upsert({
      where: { key: this.keyOf(scope, source, tenantId) },
      create: { key: this.keyOf(scope, source, tenantId), scope, source, tenantId, items: (items ?? []) as never, fetchedAt: error ? null : new Date(), error: error ? error.slice(0, 400) : null },
      update: data,
    }).catch((e: unknown) => this.log.warn(`snapshot write failed ${scope}/${source}: ${String(e).slice(0, 120)}`));
  }

  // ---- the pulls -------------------------------------------------------------

  private async getJson(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<{ ok: boolean; status: number; body: unknown }> {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  }

  /** YouTube: last week's videos for each trade query, by views, with stats. */
  async pullYouTube(scope: string): Promise<TrendItem[]> {
    const key = this.youtubeKey;
    if (!key) throw new Error('not_configured');
    const [industry, market] = scope.split(':');
    const q = queriesFor(industry);
    const codes = marketCodes(market);
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const all: TrendItem[] = [];
    for (const term of q.youtube) {
      // 25, not 10: the relevance filter below throws away the comedy channel
      // and the light-ring unboxing that view-count search puts at the top,
      // and a list of ten leaves five.
      const s = await this.getJson(
        `${YT}/search?part=id&type=video&maxResults=25&order=viewCount&regionCode=${codes.region}`
        + `&relevanceLanguage=${codes.lang}&publishedAfter=${encodeURIComponent(since)}&q=${encodeURIComponent(term)}&key=${key}`,
      );
      if (!s.ok) throw new Error(`youtube search ${s.status}: ${JSON.stringify(s.body).slice(0, 160)}`);
      const ids = ((s.body as { items?: { id?: { videoId?: string } }[] })?.items ?? [])
        .map((i) => i.id?.videoId).filter((x): x is string => Boolean(x));
      if (!ids.length) continue;
      const v = await this.getJson(`${YT}/videos?part=snippet,statistics,contentDetails&id=${ids.join(',')}&key=${key}`);
      if (!v.ok) throw new Error(`youtube videos ${v.status}`);
      all.push(...parseYouTube((v.body as { items?: unknown })?.items, term));
    }
    return relevant(all, industry, market);
  }

  /** Google Trends via DataForSEO: what is rising around the trade's seed terms. */
  async pullGoogle(scope: string): Promise<RisingQuery[]> {
    const auth = this.dfsAuth;
    if (!auth) throw new Error('not_configured');
    const [industry, market] = scope.split(':');
    const q = queriesFor(industry);
    const codes = marketCodes(market);
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86_400_000);
    const day = (d: Date) => d.toISOString().slice(0, 10);
    const body = q.google.map((keyword) => ({
      keywords: [keyword],
      location_code: codes.dataforseoLocation,
      language_code: codes.lang,
      date_from: day(from),
      date_to: day(to),
      type: 'web',
      item_types: ['google_trends_queries_list'],
    }));
    const r = await this.getJson(`${DFS}/keywords_data/google_trends/explore/live`, {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, 30_000);
    if (!r.ok) throw new Error(`dataforseo ${r.status}`);
    const tasks = ((r.body as { tasks?: { status_code?: number; result?: unknown[] }[] })?.tasks ?? []);
    const out: RisingQuery[] = [];
    for (const t of tasks) {
      if (t.status_code !== 20000) continue;
      for (const res of t.result ?? []) out.push(...parseGoogleTrends(res));
    }
    return out;
  }

  /** Pinterest Trends: this week's growing keywords in the trade's corner of Pinterest. */
  async pullPinterest(scope: string): Promise<RisingQuery[]> {
    if (!this.pinterestConfigured) throw new Error('not_configured');
    const [industry, market] = scope.split(':');
    const region = marketCodes(market).pinterestRegion;
    if (!region) throw new Error('not_configured'); // market Pinterest Trends does not cover
    const token = await this.pinterestToken();
    const q = queriesFor(industry);
    const url = (withInterests: boolean) =>
      `${PIN}/trends/keywords/${region}/top/growing?limit=50`
      + (withInterests && q.pinterestInterests.length ? `&interests=${encodeURIComponent(q.pinterestInterests.join(','))}` : '');
    const auth = { headers: { authorization: `Bearer ${token}` } };
    let r = await this.getJson(url(true), auth);
    // An interest value Pinterest no longer recognises is their enum drifting,
    // not our morning failing: ask again for the whole market and let the
    // trade filter in parsePinterest do the narrowing.
    if (!r.ok && r.status === 400 && q.pinterestInterests.length) r = await this.getJson(url(false), auth);
    if (!r.ok) {
      const msg = (r.body as { message?: string })?.message ?? JSON.stringify(r.body)?.slice(0, 160);
      throw new Error(`pinterest ${r.status}: ${msg}`);
    }
    return parsePinterest(r.body, industry);
  }

  /** Instagram: top media on the trade's hashtags, as THIS tenant's connected account. */
  async pullInstagram(tenantId: string, scope: string): Promise<TrendItem[]> {
    const pg = await this.prisma.messengerPage.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: { igId: true, pageToken: true },
    }).catch(() => null);
    if (!pg?.igId || !pg.pageToken) throw new Error('not_connected');
    const [industry] = scope.split(':');
    const q = queriesFor(industry);
    const all: TrendItem[] = [];
    for (const tag of q.hashtags) {
      const s = await this.getJson(
        `${GRAPH}/ig_hashtag_search?user_id=${encodeURIComponent(pg.igId)}&q=${encodeURIComponent(tag)}&access_token=${encodeURIComponent(pg.pageToken)}`,
      );
      const hid = (s.body as { data?: { id?: string }[] })?.data?.[0]?.id;
      if (!s.ok || !hid) {
        const msg = (s.body as { error?: { message?: string } })?.error?.message ?? `hashtag search ${s.status}`;
        throw new Error(msg);
      }
      const m = await this.getJson(
        `${GRAPH}/${hid}/top_media?user_id=${encodeURIComponent(pg.igId)}`
        + `&fields=id,media_type,media_url,permalink,like_count,caption,timestamp&limit=15`
        + `&access_token=${encodeURIComponent(pg.pageToken)}`,
      );
      if (!m.ok) {
        const msg = (m.body as { error?: { message?: string } })?.error?.message ?? `top_media ${m.status}`;
        throw new Error(msg);
      }
      all.push(...parseInstagram((m.body as { data?: unknown })?.data, tag));
    }
    // Hashtag media is on-topic by construction, so only the script check
    // does any work here — and a caption that is all emoji passes it.
    return relevant(all, industry, null);
  }

  /**
   * Meta's hashtag errors, in one sentence the person fixing it can act on.
   * The raw text is kept behind it: paraphrase is for the screen, the exact
   * string is for the support ticket.
   */
  private explainIgError(raw: string): string {
    const e = raw.toLowerCase();
    if (/#100|supported fields|nonexisting field/.test(e)) {
      return 'Instagram đổi danh sách field cho hashtag media — báo đội Lumio cập nhật pullInstagram (bỏ field không hỗ trợ khỏi tham số fields). — ' + raw;
    }
    if (/public content access|\(#10\)|permission|instagram_basic/.test(e)) {
      return 'Instagram từ chối tìm hashtag: token Page thiếu quyền instagram_basic hoặc app chưa được cấp feature "Instagram Public Content Access" (App Review). Kết nối lại Page và tick đủ; với tiệm khách hàng cần xin duyệt feature này. — ' + raw;
    }
    if (/#190|expired|invalid/.test(e)) return 'Kết nối Facebook đã hết hạn — vào Cài đặt → Messenger kết nối lại Trang. — ' + raw;
    if (/#4|limit|rate/.test(e)) return 'Instagram giới hạn 30 hashtag/tuần cho mỗi tài khoản — chờ tới tuần sau. — ' + raw;
    return raw;
  }

  // ---- the daily job ---------------------------------------------------------

  /**
   * The previous pull's items, for the day-over-day percent — but only when
   * that pull is old enough to mean something. A forced re-pull an hour after
   * the last one would otherwise print "+1%" on every card, which is noise
   * dressed as a number.
   */
  private baseline(row: SnapshotRow | null): TrendItem[] {
    if (!row?.fetchedAt || !Array.isArray(row.items)) return [];
    const ageH = (Date.now() - new Date(row.fetchedAt).getTime()) / 3_600_000;
    return ageH >= 12 ? (row.items as TrendItem[]) : [];
  }

  /**
   * Refresh one shared scope's feeds, each only when older than a day —
   * unless forced, which the support team's "Pull again" does so a fix to a
   * key or a filter can be seen now rather than tomorrow.
   */
  async refreshShared(scope: string, opts: { force?: boolean } = {}): Promise<{ youtube: boolean; google: boolean; pinterest: boolean }> {
    const out = { youtube: false, google: false, pinterest: false };
    const yt = await this.read(scope, 'youtube', null);
    if (opts.force || needsRefresh(yt?.fetchedAt)) {
      try {
        // Yesterday's row is what makes today's percent honest.
        const items = withGrowth(await this.pullYouTube(scope), this.baseline(yt));
        await this.write(scope, 'youtube', null, items, null);
        out.youtube = true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg !== 'not_configured') this.log.warn(`youtube ${scope}: ${msg.slice(0, 160)}`);
        await this.write(scope, 'youtube', null, null, msg);
      }
    }
    const g = await this.read(scope, 'google', null);
    if (opts.force || needsRefresh(g?.fetchedAt)) {
      try {
        const items = await this.pullGoogle(scope);
        await this.write(scope, 'google', null, items, null);
        out.google = true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg !== 'not_configured') this.log.warn(`google trends ${scope}: ${msg.slice(0, 160)}`);
        await this.write(scope, 'google', null, null, msg);
      }
    }
    const pn = await this.read(scope, 'pinterest', null);
    if (opts.force || needsRefresh(pn?.fetchedAt)) {
      try {
        const items = await this.pullPinterest(scope);
        await this.write(scope, 'pinterest', null, items, null);
        out.pinterest = true;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg !== 'not_configured') this.log.warn(`pinterest ${scope}: ${msg.slice(0, 160)}`);
        await this.write(scope, 'pinterest', null, null, msg);
      }
    }
    return out;
  }

  /** Refresh one tenant's Instagram feed, only when older than a day. */
  async refreshInstagram(tenantId: string, scope: string, opts: { force?: boolean } = {}): Promise<boolean> {
    const cur = await this.read(scope, 'instagram', tenantId);
    if (!opts.force && !needsRefresh(cur?.fetchedAt)) return false;
    try {
      const items = withGrowth(await this.pullInstagram(tenantId, scope), this.baseline(cur));
      await this.write(scope, 'instagram', tenantId, items, null);
      return true;
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      if (raw !== 'not_connected') this.log.warn(`instagram ${tenantId}: ${raw.slice(0, 160)}`);
      await this.write(scope, 'instagram', tenantId, null, raw === 'not_connected' ? raw : this.explainIgError(raw));
      return false;
    }
  }

  /**
   * Called from the hourly planner tick. Idempotent: every pull checks its
   * own age first, so an extra tick after a Render restart costs a few reads
   * and no API calls.
   */
  async refreshAll(): Promise<{ scopes: number; pulls: number; instagram: number }> {
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'ACTIVE', deletedAt: null } as never,
      select: { id: true, businessType: true, market: true } as never,
      take: 500,
    }).catch(() => []) as { id: string; businessType?: string | null; market?: string | null }[];
    const scopes = new Map<string, string[]>();
    for (const t of tenants) {
      const s = scopeOf(t.businessType, t.market);
      scopes.set(s, [...(scopes.get(s) ?? []), t.id]);
    }
    let pulls = 0; let instagram = 0;
    for (const [scope, ids] of scopes) {
      const r = await this.refreshShared(scope).catch(() => ({ youtube: false, google: false, pinterest: false }));
      pulls += Number(r.youtube) + Number(r.google) + Number(r.pinterest);
      for (const id of ids) {
        if (await this.refreshInstagram(id, scope).catch(() => false)) instagram += 1;
      }
    }
    return { scopes: scopes.size, pulls, instagram };
  }

  // ---- what the salon reads --------------------------------------------------

  /** A refresh the support team can press. Forced: they press it to SEE a fix, not to wait for it. */
  async refreshFor(user: AuthenticatedUser) {
    // Forced pulls spend quota and paid calls, so the button is the team's,
    // not the salon's — and the API says so, not just the screen.
    if (user.role !== UserRole.SUPER_ADMIN && !user.supportSession) {
      throw new ForbiddenException('Chỉ đội Lumio kéo lại được — bảng tự cập nhật mỗi sáng.');
    }
    const tenantId = resolveTenantScope(user);
    if (!tenantId) return { ok: false };
    const ctx = await this.content.gather(tenantId);
    const scope = scopeOf(ctx.industry, ctx.region.market);
    await this.refreshShared(scope, { force: true });
    await this.refreshInstagram(tenantId, scope, { force: true });
    return { ok: true };
  }

  async feedFor(user: AuthenticatedUser) {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) return null;
    const ctx = await this.content.gather(tenantId);
    const scope = scopeOf(ctx.industry, ctx.region.market);

    const [yt, g, ig, pn] = await Promise.all([
      this.read(scope, 'youtube', null),
      this.read(scope, 'google', null),
      this.read(scope, 'instagram', tenantId),
      this.read(scope, 'pinterest', null),
    ]);
    const now = new Date();
    const items = (r: SnapshotRow | null) => (Array.isArray(r?.items) ? (r!.items as TrendItem[]) : []);
    const ranked = diversify(rankItems([...items(yt), ...items(ig)]), 4, 12);

    // The overlay: what THIS salon sells, and what its state is walking into.
    const services = ctx.signals.services.map((s) => s.name);
    const events = ctx.events.map((e) => ({ name: e.name, daysAway: e.daysAway }));
    const cards = overlay(ranked, { services, events }, now);
    const rising = overlayQueries(Array.isArray(g?.items) ? (g!.items as RisingQuery[]) : [], services).slice(0, 10);
    const pinterestRising = overlayQueries(Array.isArray(pn?.items) ? (pn!.items as RisingQuery[]) : [], services).slice(0, 10);

    // The team's hand-picked notes: the layer a person wrote.
    const notes = await this.prisma.trendNote.findMany({
      where: { industry: ctx.industry, active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      orderBy: { createdAt: 'desc' }, take: 4,
    }).catch(() => []) as { id: string; title: string; body: string; region: string | null; createdAt: Date }[];
    const picks = notes
      .filter((n) => !n.region || [ctx.region.region, ctx.region.city].filter(Boolean).some((r) => String(r).toLowerCase() === n.region!.toLowerCase()))
      .map((n) => ({ id: n.id, title: n.title, body: n.body, at: n.createdAt }));

    const ageHours = (r: SnapshotRow | null) => (r?.fetchedAt ? (now.getTime() - new Date(r.fetchedAt).getTime()) / 3_600_000 : null);
    const state = (r: SnapshotRow | null, configured: boolean): { configured: boolean; fetchedAt: Date | null; stale: boolean; error: Txt | null } => ({
      configured,
      fetchedAt: r?.fetchedAt ?? null,
      stale: (ageHours(r) ?? Infinity) > STALE_AFTER_HOURS,
      error: r?.error && r.error !== 'not_configured' && r.error !== 'not_connected'
        ? bi(`Lần kéo gần nhất lỗi: ${r.error}`, `Last pull failed: ${r.error}`)
        : null,
    });
    const igConnected = Boolean(await this.prisma.messengerPage.findFirst({
      where: { tenantId, igId: { not: null } }, select: { id: true },
    }).catch(() => null));

    const newest = [yt, g, ig, pn].map((r) => r?.fetchedAt).filter(Boolean).map((d) => new Date(d as Date).getTime());
    const fetchedAt = newest.length ? new Date(Math.max(...newest)) : null;

    const payload = {
      scope,
      fetchedAt,
      stale: fetchedAt ? (now.getTime() - fetchedAt.getTime()) / 3_600_000 > STALE_AFTER_HOURS : true,
      regionLabel: ctx.region.label,
      items: cards,
      rising,
      pinterestRising,
      picks,
      sources: {
        youtube: state(yt, Boolean(this.youtubeKey)),
        google: state(g, Boolean(this.dfsAuth)),
        instagram: { ...state(ig, igConnected), connected: igConnected },
        pinterest: state(pn, this.pinterestConfigured && Boolean(marketCodes(ctx.region.market).pinterestRegion)),
      },
      // The old link list, kept as the third layer: where to go and look for
      // yourself, with the salon's own topics shown once.
      links: trendLinks({
        industry: ctx.industry,
        market: ctx.region.market,
        region: ctx.region.region,
        city: ctx.region.city,
        services: ctx.signals.services.map((s) => ({ name: s.name, count: s.count })),
        keywords: ctx.signals.keywords.map((k) => ({ keyword: k.keyword, count: k.count })),
        events: ctx.events.map((e) => ({ name: e.name, daysAway: e.daysAway, note: e.note })),
      }),
    };
    return { ...localizeDeep(payload, 'vi'), en: localizeDeep(payload, 'en') };
  }
}
