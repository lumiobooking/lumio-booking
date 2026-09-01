/**
 * What is trending in this trade, pulled every morning — the pure half.
 *
 * WHAT THIS REPLACES
 *
 * The Trends tab used to be ten links and a list of search terms. Nothing on it
 * changed from one day to the next, and the sentence at the top ("live data,
 * not a snapshot") was true only of the pages on the other side of the links.
 * For a nail salon a trend is a PICTURE of a set, not the name of a tool to go
 * and look one up in; the tab was asking the owner to do the research it was
 * supposed to have done.
 *
 * WHAT THIS IS
 *
 * Three feeds, each an official API, each turned into the same small shape so
 * one screen can rank them together:
 *
 *   - YouTube Data API      — videos published in the last week, by views
 *   - Google Trends         — searches rising in the salon's state (via DataForSEO)
 *   - Instagram Graph API   — top media on the trade's hashtags
 *
 * SHARED BY TRADE AND MARKET, NOT BY SALON
 *
 * "What is trending for nail salons in the US" is the same question for every
 * nail salon in the US, so the YouTube and Google pulls run once per (industry,
 * market) and every salon reads the same snapshot. What differs per salon is
 * the overlay: which items match a service THIS salon sells, and which holiday
 * is coming up in ITS state. That overlay is computed at read time from the
 * salon's own data and never stored in the shared row.
 *
 * Instagram is the exception, and the reason is the token: hashtag search runs
 * as a specific Instagram business account, with a cap of 30 hashtags a week
 * per account. So each salon's Instagram pull uses that salon's own connected
 * account and lands in that salon's own row — one tenant's token never fetches
 * on another's behalf.
 *
 * NOTHING HERE TOUCHES THE NETWORK
 *
 * This file knows the query for each trade, how to read each API's answer, and
 * how to rank and annotate what came back. The fetching lives in the service so
 * that every rule in here can be tested with a fixture and no key.
 */

import { bi, type Txt } from '../i18n';

export type TrendSource = 'youtube' | 'instagram' | 'google';

/** One trending thing, whichever feed it came from. */
export interface TrendItem {
  /** Stable within a source: video id, media id, or the query text. */
  id: string;
  source: TrendSource;
  /** What to print. A video title, a caption's first line, or the query. */
  title: string;
  url: string;
  /** A picture when the source has one. Google searches do not. */
  thumbUrl: string | null;
  /** Views for YouTube, likes for Instagram, null for a search term. */
  count: number | null;
  /**
   * Count per day since publish — the pace. This is what the feed ranks on: a
   * clip with 200K views posted yesterday is hotter than one with 400K posted
   * a month ago, and raw views would rank them the other way round.
   */
  perDay: number | null;
  /**
   * Change since the previous pull, in percent, for the SAME item. Null until
   * the item has been seen twice — one snapshot cannot say how fast a thing is
   * moving, and the first version of this screen printed "+100% this week" on
   * every card because it pretended otherwise.
   */
  growthPct: number | null;
  breakout: boolean;
  /** ISO time the item was published, when the source says. */
  publishedAt: string | null;
  /** Seconds, video only. */
  durationSec: number | null;
  /** The hashtag or query that surfaced it. */
  via: string | null;
}

/** A trend item as the screen receives it: the shared item plus this salon's overlay. */
export interface TrendCard extends TrendItem {
  /** A service this salon sells that the item is about, if any. */
  matchesService: string | null;
  /** A regional event this item is about, if any. */
  matchesEvent: Txt | null;
  /** Printable, short. */
  countLabel: string | null;
  perDayLabel: Txt | null;
  growthLabel: Txt | null;
  ageLabel: Txt | null;
}

/** One rising search, for the chip row. */
export interface RisingQuery {
  query: string;
  growthPct: number | null;
  breakout: boolean;
  matchesService: string | null;
}

// ---- what to ask each feed, per trade ---------------------------------------

export interface TradeQueries {
  /**
   * A result is about this trade only if its title says so. YouTube's search
   * ranks by views across everything the words appear in — a comedy channel's
   * "I didn't expect this" with #nailart in the tags outranks every real set —
   * so the title has to carry one of these before the item is kept.
   */
  mustMatch: RegExp;
  /** YouTube search terms — each is one search.list call, so keep it to two or three. */
  youtube: string[];
  /** Instagram hashtags, without '#'. Three at most: the cap is 30 a week per account. */
  hashtags: string[];
  /** Google Trends seed terms. Related rising queries come back for each. */
  google: string[];
}

const QUERIES: Record<string, TradeQueries> = {
  SALON: {
    mustMatch: /\b(nails?|manicure|pedicure|gel[- ]?x|acrylics?|nail ?art|chrome|french tips?|press[- ]ons?)\b/i,
    youtube: ['nail art', 'nail design ideas', 'nail trends'],
    hashtags: ['nailart', 'nailsofinstagram', 'naildesign'],
    google: ['nails', 'nail salon'],
  },
  RESTAURANT: {
    mustMatch: /\b(food|restaurant|recipe|dish|cook|chef|menu|eat|kitchen|pho|bbq|taco|sushi|noodle)\b/i,
    youtube: ['restaurant food', 'viral food recipe', 'street food'],
    hashtags: ['foodie', 'foodporn', 'restaurant'],
    google: ['restaurant near me', 'food'],
  },
  REAL_ESTATE: {
    mustMatch: /\b(house|home|real estate|realtor|listing|mortgage|apartment|condo|property|buyers?|sellers?)\b/i,
    youtube: ['house tour', 'real estate tips', 'home buying'],
    hashtags: ['realestate', 'hometour', 'realtor'],
    google: ['homes for sale', 'real estate'],
  },
  SERVICE: {
    mustMatch: /\b(before|after|small business|local|repair|clean|install|service|customer|shop)\b/i,
    youtube: ['home service before and after', 'small business marketing', 'local business'],
    hashtags: ['smallbusiness', 'beforeandafter', 'localbusiness'],
    google: ['near me', 'local services'],
  },
};

export function queriesFor(industry: string | null | undefined): TradeQueries {
  return QUERIES[String(industry ?? '').toUpperCase()] ?? QUERIES.SALON;
}

/** The shared-snapshot key: one row per trade per market. */
export function scopeOf(industry: string | null | undefined, market: string | null | undefined): string {
  const ind = QUERIES[String(industry ?? '').toUpperCase()] ? String(industry).toUpperCase() : 'SALON';
  const mk = ['US', 'CA', 'VN'].includes(String(market ?? '').toUpperCase()) ? String(market).toUpperCase() : 'US';
  return `${ind}:${mk}`;
}

/** YouTube's regionCode / DataForSEO's location for a market. */
export function marketCodes(market: string | null | undefined): { region: string; dataforseoLocation: number; lang: string } {
  switch (String(market ?? '').toUpperCase()) {
    case 'CA': return { region: 'CA', dataforseoLocation: 2124, lang: 'en' };
    case 'VN': return { region: 'VN', dataforseoLocation: 2704, lang: 'vi' };
    default: return { region: 'US', dataforseoLocation: 2840, lang: 'en' };
  }
}

// ---- reading each API's answer ----------------------------------------------

/** ISO-8601 duration ("PT1M42S") to seconds. */
export function isoDurationSec(s: string | null | undefined): number | null {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(s ?? ''));
  if (!m) return null;
  return (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
}

/** Count per day since publish. Half a day at minimum, so a fresh upload is not infinite. */
export function perDayOf(count: number | null, publishedAt: string | null, now: Date): number | null {
  if (count == null || !publishedAt) return null;
  const ageDays = Math.max(0.5, (now.getTime() - Date.parse(publishedAt)) / 86_400_000);
  if (!Number.isFinite(ageDays)) return null;
  return Math.round(count / ageDays);
}

/**
 * Share of letters that are Latin. A US or Canadian salon's feed is in
 * English; a Japanese short with #ジェルネイル is real and trending and of no
 * use to a shop in Austin. Vietnamese is Latin script, so it passes — which
 * is right for this product.
 */
export function latinShare(text: string): number {
  const letters = Array.from(text).filter((ch) => /\p{L}/u.test(ch));
  if (!letters.length) return 1;
  const latin = letters.filter((ch) => /\p{Script=Latin}/u.test(ch)).length;
  return latin / letters.length;
}

/**
 * Keep only what is about the trade, in a script the market reads.
 *
 * Every market this product serves (US, CA, VN) reads Latin script, so the
 * script check is unconditional for now; the parameter is here so a market
 * that does not can switch it off without touching the callers.
 */
export function relevant(items: TrendItem[], industry: string | null | undefined, market?: string | null): TrendItem[] {
  const q = queriesFor(industry);
  void market;
  return items.filter((it) => {
    // The TITLE has to say it. `via` is our own search term, and testing it
    // would pass everything the search returned — which is the whole problem.
    // Hashtag media is on-topic by construction (the tag IS the topic), so
    // only the script check applies to Instagram.
    if (it.source === 'youtube' && !q.mustMatch.test(it.title)) return false;
    if (latinShare(it.title) < 0.6) return false;
    return true;
  });
}

/**
 * Real growth: the same item, seen in the previous pull, compared.
 *
 * Only this deserves a percent on the card. Everything without a previous
 * reading keeps growthPct null and the screen prints the pace instead.
 */
export function withGrowth(items: TrendItem[], previous: TrendItem[] | null | undefined): TrendItem[] {
  const before = new Map((previous ?? []).map((p) => [`${p.source}:${p.id}`, p.count]));
  return items.map((it) => {
    const old = before.get(`${it.source}:${it.id}`);
    if (old == null || it.count == null || old <= 0) return { ...it, growthPct: null };
    return { ...it, growthPct: Math.round(((it.count - old) / old) * 100) };
  });
}

interface YtVideo {
  id?: string;
  snippet?: { title?: string; publishedAt?: string; thumbnails?: Record<string, { url?: string }> };
  statistics?: { viewCount?: string };
  contentDetails?: { duration?: string };
}

/** `videos.list` items (with snippet, statistics, contentDetails) into trend items. */
export function parseYouTube(items: unknown, via: string, now = new Date()): TrendItem[] {
  const list = Array.isArray(items) ? (items as YtVideo[]) : [];
  return list.flatMap((v) => {
    const id = String(v.id ?? '');
    const title = String(v.snippet?.title ?? '').trim();
    if (!id || !title) return [];
    const count = v.statistics?.viewCount != null ? Number(v.statistics.viewCount) : null;
    const publishedAt = v.snippet?.publishedAt ?? null;
    const t = v.snippet?.thumbnails ?? {};
    const thumb = t.medium?.url ?? t.high?.url ?? t.default?.url ?? null;
    return [{
      id, source: 'youtube' as const, title,
      url: `https://www.youtube.com/watch?v=${id}`,
      thumbUrl: thumb ?? null,
      count: Number.isFinite(count as number) ? count : null,
      perDay: perDayOf(Number.isFinite(count as number) ? count : null, publishedAt, now),
      growthPct: null,
      breakout: false,
      publishedAt,
      durationSec: isoDurationSec(v.contentDetails?.duration),
      via,
    }];
  });
}

interface IgMedia {
  id?: string; media_type?: string; media_url?: string; thumbnail_url?: string;
  permalink?: string; like_count?: number; caption?: string; timestamp?: string;
}

/** `/{hashtag}/top_media` items into trend items. */
export function parseInstagram(items: unknown, hashtag: string, now = new Date()): TrendItem[] {
  const list = Array.isArray(items) ? (items as IgMedia[]) : [];
  return list.flatMap((m) => {
    const id = String(m.id ?? '');
    if (!id || !m.permalink) return [];
    const caption = String(m.caption ?? '').split('\n')[0].trim();
    const title = caption ? caption.slice(0, 120) : `#${hashtag}`;
    const thumb = m.media_type === 'VIDEO' ? (m.thumbnail_url ?? m.media_url ?? null) : (m.media_url ?? null);
    const count = typeof m.like_count === 'number' ? m.like_count : null;
    const publishedAt = m.timestamp ?? null;
    return [{
      id, source: 'instagram' as const, title,
      url: m.permalink, thumbUrl: thumb, count,
      perDay: perDayOf(count, publishedAt, now),
      growthPct: null,
      breakout: false, publishedAt, durationSec: null,
      via: `#${hashtag}`,
    }];
  });
}

interface DfsQuery { query?: string; value?: number | string | null }
interface DfsItem { type?: string; data?: { top?: DfsQuery[]; rising?: DfsQuery[] } }

/**
 * DataForSEO's Google Trends "explore" answer into rising queries.
 *
 * The rising list is what matters: "top" is the queries that are always big
 * (the salon's own name of the trade), "rising" is what changed this week.
 * Google marks a query with no meaningful baseline as "Breakout" rather than a
 * number; that is the strongest signal on the list, not a missing value.
 */
export function parseGoogleTrends(result: unknown): RisingQuery[] {
  const items = ((result as { items?: DfsItem[] } | null)?.items ?? []) as DfsItem[];
  const out: RisingQuery[] = [];
  for (const it of items) {
    if (it.type !== 'google_trends_queries_list') continue;
    for (const q of it.data?.rising ?? []) {
      const query = String(q.query ?? '').trim();
      if (!query) continue;
      const raw = q.value;
      const breakout = typeof raw === 'string' && /breakout/i.test(raw);
      const pct = typeof raw === 'number' ? raw : (typeof raw === 'string' && /^\d+/.test(raw) ? Number(raw.replace(/\D/g, '')) : null);
      out.push({ query, growthPct: breakout ? null : pct, breakout, matchesService: null });
    }
  }
  // Dedupe on the query text; keep the strongest reading.
  const byQuery = new Map<string, RisingQuery>();
  for (const r of out) {
    const k = r.query.toLowerCase();
    const cur = byQuery.get(k);
    if (!cur || r.breakout || (r.growthPct ?? 0) > (cur.growthPct ?? 0)) byQuery.set(k, r);
  }
  return Array.from(byQuery.values());
}

// ---- ranking and the per-salon overlay --------------------------------------

/**
 * Words that decide whether a trend is ABOUT a service, for matching.
 *
 * A service is named by the salon ("Luxury Manicure", "Colour (add-on)"), so
 * the match has to be on the meaningful words in that name, not on the whole
 * string. Generic words that appear in every service name are dropped; a match
 * on "add-on" would tag everything.
 */
const STOP = new Set(['add', 'on', 'add-on', 'the', 'and', 'with', 'for', 'of', 'a', 'an', 'set', 'full', 'basic', 'regular', 'classic', 'deluxe', 'luxury', 'premium', 'service', 'services', 'combo', 'package', 'special']);

export function serviceKeywords(name: string): string[] {
  return name.toLowerCase()
    .replace(/[()\[\],.:;!?/&+]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/** The first service whose meaningful words appear in the text. */
export function matchService(text: string, services: string[]): string | null {
  const hay = ` ${text.toLowerCase().replace(/[#_]/g, ' ')} `;
  for (const s of services) {
    const kws = serviceKeywords(s);
    if (!kws.length) continue;
    if (kws.some((k) => hay.includes(` ${k}`) || hay.includes(`${k} `))) return s;
  }
  return null;
}

/** Short count for a card: 412K, 1.2M, 980. */
export function shortCount(n: number | null): string | null {
  if (n == null) return null;
  // One decimal only while it carries information: 28.4K, but 96K and 1.2M,
  // never 96.0K.
  const trim = (x: number, digits: number) => x.toFixed(digits).replace(/\.0$/, '');
  if (n >= 1_000_000) return `${trim(n / 1_000_000, n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${trim(n / 1_000, n >= 100_000 ? 0 : 1)}K`;
  return String(n);
}

export function growthLabel(pct: number | null, breakout: boolean): Txt | null {
  if (breakout) return bi('đột biến', 'breakout');
  if (pct == null) return null;
  const sign = pct >= 0 ? '+' : '';
  return bi(`${sign}${pct}% so với hôm qua`, `${sign}${pct}% since yesterday`);
}

export function perDayLabel(perDay: number | null, source: TrendSource): Txt | null {
  if (perDay == null) return null;
  const n = shortCount(perDay);
  return source === 'youtube'
    ? bi(`${n} lượt xem/ngày`, `${n} views/day`)
    : bi(`${n} lượt thích/ngày`, `${n} likes/day`);
}

export function ageLabel(publishedAt: string | null, now: Date): Txt | null {
  if (!publishedAt) return null;
  const days = Math.floor((now.getTime() - Date.parse(publishedAt)) / 86_400_000);
  if (!Number.isFinite(days)) return null;
  if (days <= 0) return bi('hôm nay', 'today');
  if (days === 1) return bi('hôm qua', 'yesterday');
  return bi(`${days} ngày trước`, `${days}d ago`);
}

/**
 * Rank across sources so the top of the screen is what is moving fastest,
 * whichever feed it came from. Pace (count per day) first, then raw count as
 * the tie-break; a picture beats no picture at the same score because a card
 * without one is a line of text the owner has to imagine.
 */
export function rankItems(items: TrendItem[]): TrendItem[] {
  return [...items].sort((a, b) => {
    const g = (b.perDay ?? -1) - (a.perDay ?? -1);
    if (g) return g;
    const c = (b.count ?? -1) - (a.count ?? -1);
    if (c) return c;
    return (b.thumbUrl ? 1 : 0) - (a.thumbUrl ? 1 : 0);
  });
}

/**
 * Keep the feed from being one creator's whole channel: at most two items per
 * `via` (search term / hashtag), and no two with the same title.
 */
export function diversify(items: TrendItem[], perVia = 4, limit = 12): TrendItem[] {
  const seenTitle = new Set<string>();
  const viaCount = new Map<string, number>();
  const out: TrendItem[] = [];
  for (const it of items) {
    const t = it.title.toLowerCase();
    if (seenTitle.has(t)) continue;
    const n = viaCount.get(it.via ?? '') ?? 0;
    if (n >= perVia) continue;
    seenTitle.add(t);
    viaCount.set(it.via ?? '', n + 1);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

export interface OverlayInput {
  /** The salon's own service names, busiest first. */
  services: string[];
  /** Upcoming regional events, bilingual name, with how far out. */
  events: { name: Txt; daysAway: number }[];
}

/** The shared items, annotated with what this salon sells and what is coming up. */
export function overlay(items: TrendItem[], input: OverlayInput, now = new Date()): TrendCard[] {
  const soon = input.events.filter((e) => e.daysAway >= -1 && e.daysAway <= 21);
  return items.map((it) => {
    const svc = matchService(it.title + ' ' + (it.via ?? ''), input.services);
    const ev = soon.find((e) => {
      const en = typeof e.name === 'string' ? e.name : e.name.en;
      const vi = typeof e.name === 'string' ? e.name : e.name.vi;
      const hay = it.title.toLowerCase();
      return hay.includes(en.toLowerCase()) || hay.includes(vi.toLowerCase());
    });
    return {
      ...it,
      matchesService: svc,
      matchesEvent: ev ? ev.name : null,
      countLabel: shortCount(it.count),
      perDayLabel: perDayLabel(it.perDay, it.source),
      growthLabel: growthLabel(it.growthPct, it.breakout),
      ageLabel: ageLabel(it.publishedAt, now),
    };
  });
}

export function overlayQueries(qs: RisingQuery[], services: string[]): RisingQuery[] {
  return qs.map((q) => ({ ...q, matchesService: matchService(q.query, services) }));
}

/** A snapshot older than this is shown with a warning rather than as today's. */
export const STALE_AFTER_HOURS = 36;

/** True when a pull for this scope should run now: never today yet, or older than a day. */
export function needsRefresh(fetchedAt: Date | string | null | undefined, now = new Date()): boolean {
  if (!fetchedAt) return true;
  const t = typeof fetchedAt === 'string' ? Date.parse(fetchedAt) : fetchedAt.getTime();
  if (!Number.isFinite(t)) return true;
  return now.getTime() - t >= 20 * 3_600_000;
}
