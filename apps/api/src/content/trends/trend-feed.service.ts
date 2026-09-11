import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentService } from '../content.service';
import { AuthenticatedUser, resolveTenantScope } from '../../common/tenant/tenant-context';
import { localizeDeep, bi, type Txt } from '../i18n';
import { trendLinks } from '../trend-sources';
import { TRADE_PROFILE_KEY, cleanTradeProfile, customScope, customTenantOf, queriesOf } from '../trade-profile';
import {
  queriesFor, scopeOf, knownTrades, marketCodes, parseYouTube, parseInstagram, parseGoogleTrends, parsePinterest, minePhrases,
  rankItems, diversify, overlay, overlayQueries, needsRefresh, relevant, withGrowth, STALE_AFTER_HOURS,
  type TrendItem, type RisingQuery, type TrendSource, type TradeQueries,
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
/** The two fields a hashtag lookup needs from a connected Page. */
interface IgPage { igId: string; pageToken: string }

/**
 * A hashtag as Instagram will accept it.
 *
 * Letters, digits and underscore only — Instagram's own rule — with the # and
 * any whitespace stripped, because that is what people type. Returns null
 * rather than a guess when nothing usable is left: sending a junk tag spends
 * one of the account's thirty unique tags for the week.
 */
export function cleanHashtag(raw: unknown): string | null {
  const t = String(raw ?? '').trim().replace(/^#+/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9_]{2,60}$/.test(t)) return null;
  return t.toLowerCase();
}

/** Both languages, because the same message is read by a Vietnamese staffer
 *  and by an English-speaking App Review reviewer. */
const ERR = {
  noTenant: { code: 'no_tenant', en: 'No salon is selected.', vi: 'Chưa chọn tiệm.' },
  badTag: {
    code: 'bad_tag',
    en: 'Use letters, numbers and underscore only — for example nailart or gelmanicure.',
    vi: 'Chỉ dùng chữ, số và gạch dưới — ví dụ nailart hoặc gelmanicure.',
  },
  notConnected: {
    code: 'not_connected',
    en: 'No Instagram Business account is connected. Connect the Facebook Page that has Instagram linked, then try again.',
    vi: 'Chưa nối tài khoản Instagram Business. Kết nối Trang Facebook có liên kết Instagram rồi thử lại.',
  },
} as const;

/**
 * Meta's hashtag errors, in one sentence somebody can act on — in both
 * languages, and with Meta's own words kept behind them for the support
 * ticket. A paraphrase is for the screen; the exact string is evidence.
 */
export function igSearchError(raw: string): { code: string; en: string; vi: string } {
  const e = String(raw ?? '').toLowerCase();
  if (/public content access|\(#10\)|permission|instagram_basic/.test(e)) {
    return {
      code: 'permission',
      en: 'Instagram refused the hashtag search: this app has not been granted the Instagram Public Content Access feature yet, or the Page token is missing instagram_basic. Reconnect the Page and grant both.',
      vi: 'Instagram từ chối tìm hashtag: app chưa được cấp feature "Instagram Public Content Access", hoặc token Trang thiếu quyền instagram_basic. Kết nối lại Trang và tick đủ.',
    };
  }
  if (/#4|limit|rate/.test(e)) {
    return {
      code: 'rate_limit',
      en: 'Instagram allows 30 unique hashtags per 7 days for each account, and this one has reached it. The limit rolls off as the week passes.',
      vi: 'Instagram cho tối đa 30 hashtag khác nhau trong 7 ngày cho mỗi tài khoản — tài khoản này đã dùng hết. Hạn mức sẽ tự nhả dần theo tuần.',
    };
  }
  if (/#190|expired|invalid/.test(e)) {
    return {
      code: 'expired',
      en: 'The Facebook connection has expired. Reconnect the Page under Channels.',
      vi: 'Kết nối Facebook đã hết hạn — vào mục Kết nối kênh social để nối lại Trang.',
    };
  }
  if (/no results|not found|#803/.test(e)) {
    return {
      code: 'not_found',
      en: 'Instagram has no public posts for that hashtag. Try a more common one.',
      vi: 'Instagram không có bài công khai nào cho hashtag đó. Thử một hashtag phổ biến hơn.',
    };
  }
  return { code: 'unknown', en: `Instagram refused the request: ${raw}`, vi: `Instagram từ chối yêu cầu: ${raw}` };
}

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

  /**
   * The search vocabulary for a scope. A trade scope reads the built-in
   * table; a business's own scope (CUSTOM-<tenant>:<market>, see
   * trade-profile) reads the profile written for it — falling back to the
   * catch-all trade if that profile is gone, so a pull never throws for
   * want of words.
   */
  private async queriesForScope(scope: string): Promise<TradeQueries> {
    const [industry, market] = scope.split(':');
    const tenantId = customTenantOf(scope);
    if (!tenantId) return queriesFor(industry, market);
    const row = await this.prisma.setting.findFirst({ where: { tenantId, key: TRADE_PROFILE_KEY }, select: { value: true } }).catch(() => null);
    const p = cleanTradeProfile(row?.value);
    return p ? queriesOf(p) : queriesFor('SERVICE', market);
  }

  /** Where a business's trends live: its own scope when it has a profile, else its trade's. */
  private scopeFor(tenantId: string, ctx: { industry: string; tradeProfile: unknown; region: { market?: string | null } }): string {
    return ctx.tradeProfile ? customScope(tenantId, ctx.region.market) : scopeOf(ctx.industry, ctx.region.market);
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
    const q = await this.queriesForScope(scope);
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
    return relevant(all, industry, market, q);
  }

  /** Google Trends via DataForSEO: what is rising around the trade's seed terms. */
  async pullGoogle(scope: string): Promise<RisingQuery[]> {
    const auth = this.dfsAuth;
    if (!auth) throw new Error('not_configured');
    const [, market] = scope.split(':');
    const q = await this.queriesForScope(scope);
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
    const q = await this.queriesForScope(scope);
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
    return parsePinterest(r.body, industry, 10, q);
  }

  /** Instagram: top media on the trade's hashtags, as THIS tenant's connected account. */
  async pullInstagram(tenantId: string, scope: string): Promise<TrendItem[]> {
    // The page we ask THROUGH must be one that actually has Instagram linked.
    // Selecting the tenant's oldest row and hoping was wrong twice over: a
    // salon that connected a second Page later, and now any salon with a Zalo
    // OA (which lives in this same table with no igId), would resolve to a row
    // without Instagram and report 'not_connected' — a status the screen
    // suppresses, so the panel went quietly empty while the salon's Instagram
    // was connected and fine. Ask the same question feedFor asks.
    const pg = await this.prisma.messengerPage.findFirst({
      where: { tenantId, igId: { not: null } },
      orderBy: { createdAt: 'asc' },
      select: { igId: true, pageToken: true },
    }).catch(() => null);
    if (!pg?.igId || !pg.pageToken) throw new Error('not_connected');
    const q = await this.queriesForScope(scope);
    const all: TrendItem[] = [];
    for (const tag of q.hashtags) all.push(...await this.igTag(pg as IgPage, tag));
    // Hashtag media is on-topic by construction, so only the script check
    // does any work here — and a caption that is all emoji passes it.
    return relevant(all, scope.split(':')[0], null, q);
  }

  /**
   * One hashtag, as this salon's own Instagram account sees it.
   *
   * Two calls, because Instagram splits them: a hashtag has to be resolved to
   * an id before its media can be read, and both are charged against the same
   * account. Pulled out of pullInstagram so a person can ask for a single tag
   * on demand — which is also the only way the feature can be SHOWN to
   * somebody, rather than merely running overnight.
   */
  private async igTag(pg: IgPage, tag: string): Promise<TrendItem[]> {
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
    return parseInstagram((m.body as { data?: unknown })?.data, tag);
  }

  /**
   * Look up one hashtag the salon typed, now.
   *
   * WHY THIS EXISTS AT ALL
   *
   * The overnight pull already reads Instagram hashtags, but nobody can WATCH
   * it: a feed simply appears, and from the outside there is no way to tell
   * that Instagram's public content is where it came from. Meta's App Review
   * asks to see the end-to-end experience of the use case — a person doing the
   * thing the permission is for — and an overnight job is not something a
   * person does.
   *
   * So the same capability gets a front door: the salon types a hashtag, sees
   * the top public posts on it, and turns one into a post of their own. That
   * is the use case, in three visible steps, with the permission plainly doing
   * the work in the middle.
   *
   * The 30-hashtags-per-7-days cap is Instagram's, per account, and counts
   * UNIQUE tags rather than calls — so the count is reported back and the
   * screen can say it before somebody burns the week's allowance on typos.
   */
  async searchHashtag(user: AuthenticatedUser, rawTag: unknown): Promise<{
    ok: boolean;
    tag: string;
    items: unknown[];
    /** The same cards with every bilingual label resolved to English. Mirrors
     *  the `en` side of the nightly feed envelope — see the note on the return. */
    en?: { items: unknown[] };
    error: { code: string; en: string; vi: string } | null;
  }> {
    const tenantId = resolveTenantScope(user);
    const tag = cleanHashtag(rawTag);
    if (!tenantId) {
      return { ok: false, tag: '', items: [], error: ERR.noTenant };
    }
    if (!tag) {
      return { ok: false, tag: '', items: [], error: ERR.badTag };
    }

    const pg = await this.prisma.messengerPage.findFirst({
      where: { tenantId, igId: { not: null } },
      orderBy: { createdAt: 'asc' },
      select: { igId: true, pageToken: true },
    }).catch(() => null);
    if (!pg?.igId || !pg.pageToken) {
      return { ok: false, tag, items: [], error: ERR.notConnected };
    }

    try {
      const found = await this.igTag({ igId: pg.igId, pageToken: pg.pageToken }, tag);
      // The same shaping the nightly feed gets, so a searched card and a fed
      // card are the same object on screen and in the composer.
      const cards = overlay(rankItems(found), { services: [], events: [] }, new Date());
      // Resolve the bilingual labels before the cards leave the server.
      //
      // WHAT THIS COST
      //
      // growthLabel, perDayLabel and ageLabel each return a Txt — `{ vi, en }`,
      // not a string. Every other endpoint in this module ends with the
      // localizeDeep envelope that flattens those; this one did not, so a
      // successful hashtag search handed React an object where it expected
      // text. React refuses to render an object and throws #31 — "object with
      // keys {vi, en}" — which does not break the panel, it kills the WHOLE
      // /salon/content route. Pressing Search took the screen down.
      //
      // Shaped exactly like the feed (vi inline, en beside it) so the client
      // picks a side the same way for both.
      return {
        ok: true,
        tag,
        items: localizeDeep(cards, 'vi') as unknown[],
        en: { items: localizeDeep(cards, 'en') as unknown[] },
        error: null,
      };
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      return { ok: false, tag, items: [], error: igSearchError(raw) };
    }
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
    // The scope a business READS is decided by the trade it declared and by
    // whether it has a profile of its own — the same answer feedFor gives.
    // Grouping by the enum alone pulled nail feeds for a restaurant that had
    // declared itself one, and pulled nothing at all for its real scope.
    const [profiles, owned] = await Promise.all([
      this.prisma.setting.findMany({ where: { key: 'business_profile' }, select: { tenantId: true, value: true }, take: 2000 }).catch(() => []) as Promise<{ tenantId: string; value: unknown }[]>,
      this.prisma.setting.findMany({ where: { key: TRADE_PROFILE_KEY }, select: { tenantId: true, value: true }, take: 2000 }).catch(() => []) as Promise<{ tenantId: string; value: unknown }[]>,
    ]);
    const declared = new Map(profiles.map((p) => [p.tenantId, String(((p.value ?? {}) as { trade?: string }).trade ?? '').toUpperCase()]));
    const hasOwn = new Set(owned.filter((o) => cleanTradeProfile(o.value)).map((o) => o.tenantId));
    const scopes = new Map<string, string[]>();
    for (const t of tenants) {
      const trade = declared.get(t.id);
      const industry = trade && knownTrades().includes(trade) ? trade : t.businessType;
      const s = hasOwn.has(t.id) ? customScope(t.id, t.market) : scopeOf(industry, t.market);
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
    const scope = this.scopeFor(tenantId, ctx);
    await this.refreshShared(scope, { force: true });
    await this.refreshInstagram(tenantId, scope, { force: true });
    return { ok: true };
  }

  async feedFor(user: AuthenticatedUser) {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) return null;
    const ctx = await this.content.gather(tenantId);
    const scope = this.scopeFor(tenantId, ctx);

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

    // The free layer: the trade's live vocabulary, mined from the titles and
    // captions already pulled this morning. Costs no API call and needs no
    // key, so it is the one keyword list every salon has from day one —
    // Google Trends and Pinterest add to it, they do not replace it. Our own
    // search terms are excluded, or the list would just read them back.
    const q = await this.queriesForScope(scope);
    const mined = overlayQueries(
      minePhrases([...items(yt), ...items(ig)], { seeds: [...q.youtube, ...q.hashtags] }),
      services,
    ) as (RisingQuery & { posts: number })[];

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
      mined,
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
