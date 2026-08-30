/**
 * What a salon's own numbers are trying to say — turned into content signals.
 *
 * This module is the difference between Lumio and every "AI writes your
 * captions" tool on the market. Those tools guess from a niche label. This one
 * reads what people in THIS neighbourhood actually typed into Google to find
 * THIS salon, which of THIS salon's services are rising, and which formats
 * THIS salon's followers actually watched — then hands the generator evidence
 * instead of vibes.
 *
 * It is deliberately pure: every input is plain data the platform already
 * stores, so the whole "why did you suggest this?" chain can be pinned by
 * tests and audited months later from the saved snapshot.
 *
 * A note on honesty. Every function here returns evidence WITH its basis, and
 * refuses to invent a trend out of one data point. A confident-sounding reason
 * built on two impressions would poison the one thing that makes an owner
 * trust the system: that the numbers are real.
 */

export type Trend = 'up' | 'down' | 'flat' | 'new';

export interface KeywordRow { keyword: string; count: number | null }
export interface PostRow {
  type?: string | null;
  caption?: string | null;
  views?: number | null;
  reach?: number | null;
  likes?: number | null;
  comments?: number | null;
  timestamp?: string | null;
}

// ---- 1. Local search demand ------------------------------------------------

export interface KeywordSignal {
  keyword: string;
  count: number;
  prev: number | null;
  trend: Trend;
  /** Percent change, only when there is a real basis for one. */
  pct: number | null;
}

/**
 * What the neighbourhood is searching for, and which way it is moving.
 *
 * Google reports these monthly, so this compares two months — the resolution
 * is "direction", never "what is hot today". Keywords below `floor` are
 * dropped: at three impressions a 200% rise is noise wearing a suit.
 */
export function keywordSignals(
  current: KeywordRow[] | null | undefined,
  previous: KeywordRow[] | null | undefined,
  opts: { floor?: number; limit?: number } = {},
): KeywordSignal[] {
  const floor = opts.floor ?? 5;
  const limit = opts.limit ?? 8;
  const prevMap = new Map<string, number>();
  for (const r of previous ?? []) {
    if (r?.keyword) prevMap.set(r.keyword.trim().toLowerCase(), Number(r.count ?? 0));
  }
  const out: KeywordSignal[] = [];
  for (const r of current ?? []) {
    const kw = String(r?.keyword ?? '').trim();
    const count = Number(r?.count ?? 0);
    if (!kw || count < floor) continue;
    const key = kw.toLowerCase();
    const had = prevMap.has(key);
    const prev = had ? (prevMap.get(key) as number) : null;
    let trend: Trend = 'flat';
    let pct: number | null = null;
    if (!had) {
      trend = 'new';
    } else if (prev !== null && prev >= floor) {
      // A percentage needs a denominator worth dividing by.
      pct = Math.round(((count - prev) / prev) * 100);
      trend = pct >= 15 ? 'up' : pct <= -15 ? 'down' : 'flat';
    } else {
      trend = count > (prev ?? 0) ? 'up' : 'flat';
    }
    out.push({ keyword: kw, count, prev, trend, pct });
  }
  // Rising first, then by volume: a big steady term still deserves content,
  // but a climbing one deserves it today.
  const rank = (s: KeywordSignal) => (s.trend === 'up' ? 0 : s.trend === 'new' ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || b.count - a.count).slice(0, limit);
}

// ---- 2. Which services are actually selling --------------------------------

export interface ServiceCount { name: string; count: number }
export interface ServiceSignal { name: string; count: number; prev: number; trend: Trend; pct: number | null }

/**
 * Demand the salon can see in its own book. A service climbing here is the
 * safest content bet there is: the content sells what people are already
 * walking in for.
 */
export function serviceSignals(
  current: ServiceCount[] | null | undefined,
  previous: ServiceCount[] | null | undefined,
  opts: { floor?: number; limit?: number } = {},
): ServiceSignal[] {
  const floor = opts.floor ?? 3;
  const limit = opts.limit ?? 6;
  const prevMap = new Map<string, number>();
  for (const s of previous ?? []) if (s?.name) prevMap.set(s.name.trim().toLowerCase(), Number(s.count ?? 0));
  const out: ServiceSignal[] = [];
  for (const s of current ?? []) {
    const name = String(s?.name ?? '').trim();
    const count = Number(s?.count ?? 0);
    if (!name || count < floor) continue;
    const prev = prevMap.get(name.toLowerCase()) ?? 0;
    let trend: Trend = 'flat';
    let pct: number | null = null;
    if (prev === 0) trend = 'new';
    else if (prev >= floor) {
      pct = Math.round(((count - prev) / prev) * 100);
      trend = pct >= 20 ? 'up' : pct <= -20 ? 'down' : 'flat';
    } else trend = count > prev ? 'up' : 'flat';
    out.push({ name, count, prev, trend, pct });
  }
  const rank = (s: ServiceSignal) => (s.trend === 'up' ? 0 : s.trend === 'new' ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || b.count - a.count).slice(0, limit);
}

// ---- 3. What this audience actually watches --------------------------------

export interface FormatPerformance {
  kind: 'reel' | 'photo';
  posts: number;
  avgViews: number;
  avgEngagement: number;
}
export interface PostSignal {
  reel: FormatPerformance;
  photo: FormatPerformance;
  /** Only stated when both kinds have enough posts to compare honestly. */
  verdict: 'reel-wins' | 'photo-wins' | 'too-close' | 'not-enough-data';
  multiple: number | null;
  topPosts: { caption: string; views: number }[];
}

const REEL_TYPES = new Set(['reel', 'video', 'igtv', 'clips']);

/**
 * Reels vs photos for THIS salon's followers — the most actionable format fact
 * available, and one every owner immediately believes because it is their own
 * feed. Needs at least two of each kind before it will call a winner.
 */
export function postSignals(posts: PostRow[] | null | undefined, minPerKind = 2): PostSignal {
  const rows = (posts ?? []).filter(Boolean);
  const split = { reel: [] as PostRow[], photo: [] as PostRow[] };
  for (const p of rows) {
    const t = String(p.type ?? '').toLowerCase();
    (REEL_TYPES.has(t) ? split.reel : split.photo).push(p);
  }
  const perf = (list: PostRow[], kind: 'reel' | 'photo'): FormatPerformance => {
    const views = list.map((p) => Number(p.views ?? 0)).filter((n) => Number.isFinite(n));
    const eng = list.map((p) => Number(p.likes ?? 0) + Number(p.comments ?? 0));
    const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
    return { kind, posts: list.length, avgViews: avg(views), avgEngagement: avg(eng) };
  };
  const reel = perf(split.reel, 'reel');
  const photo = perf(split.photo, 'photo');

  let verdict: PostSignal['verdict'] = 'not-enough-data';
  let multiple: number | null = null;
  if (reel.posts >= minPerKind && photo.posts >= minPerKind && (reel.avgViews > 0 || photo.avgViews > 0)) {
    const hi = Math.max(reel.avgViews, photo.avgViews);
    const lo = Math.min(reel.avgViews, photo.avgViews);
    const m = lo > 0 ? hi / lo : null;
    if (m !== null && m < 1.3) verdict = 'too-close';
    else {
      verdict = reel.avgViews >= photo.avgViews ? 'reel-wins' : 'photo-wins';
      multiple = m === null ? null : Math.round(m * 10) / 10;
    }
  }
  const topPosts = rows
    .filter((p) => Number(p.views ?? 0) > 0)
    .sort((a, b) => Number(b.views ?? 0) - Number(a.views ?? 0))
    .slice(0, 3)
    .map((p) => ({ caption: String(p.caption ?? '').slice(0, 80), views: Number(p.views ?? 0) }));

  return { reel, photo, verdict, multiple, topPosts };
}

// ---- 4. Who is actually following ------------------------------------------

export interface AudienceSignal { topAgeBand: string | null; topAgePct: number | null; femalePct: number | null; basis: 'instagram' | 'none' }

export function audienceSignal(aud: { gender?: Record<string, number>; age?: Record<string, number> } | null | undefined): AudienceSignal {
  const age = aud?.age ?? {};
  const gender = aud?.gender ?? {};
  const ageEntries = Object.entries(age).filter(([, v]) => Number(v) > 0);
  const genderTotal = Object.values(gender).reduce((a, b) => a + Number(b || 0), 0);
  if (!ageEntries.length && !genderTotal) return { topAgeBand: null, topAgePct: null, femalePct: null, basis: 'none' };
  const ageTotal = ageEntries.reduce((a, [, v]) => a + Number(v), 0) || 1;
  const top = ageEntries.sort((a, b) => Number(b[1]) - Number(a[1]))[0];
  return {
    topAgeBand: top ? top[0] : null,
    topAgePct: top ? Math.round((Number(top[1]) / ageTotal) * 100) : null,
    femalePct: genderTotal ? Math.round((Number(gender.F || 0) / genderTotal) * 100) : null,
    basis: 'instagram',
  };
}

// ---- 5. (removed) ----------------------------------------------------------
//
// The seasonal calendar used to live here, as one hardcoded list shown to every
// salon on the platform — and with Tết written as a fixed 17 February, which is
// correct for 2026 and wrong for every year after. It now lives in
// region-events.ts, where the dates are computed or read from a real table and
// the answer depends on which state the salon is actually in.
//
// It is not re-exported from here on purpose. Two calendars in one prompt is
// how a model ends up quoting the wrong date for Tết with complete confidence.

// ---- 6. The whole picture, ready for a prompt ------------------------------

export interface SignalProfile {
  keywords: KeywordSignal[];
  services: ServiceSignal[];
  posts: PostSignal;
  audience: AudienceSignal;
  /** True when there is genuinely nothing to reason from — say so, don't bluff. */
  thin: boolean;
}

export function buildSignalProfile(input: {
  keywordsNow?: KeywordRow[] | null;
  keywordsPrev?: KeywordRow[] | null;
  servicesNow?: ServiceCount[] | null;
  servicesPrev?: ServiceCount[] | null;
  posts?: PostRow[] | null;
  audience?: { gender?: Record<string, number>; age?: Record<string, number> } | null;
  today?: Date;
  country?: string;
}): SignalProfile {
  const keywords = keywordSignals(input.keywordsNow, input.keywordsPrev);
  const services = serviceSignals(input.servicesNow, input.servicesPrev);
  const posts = postSignals(input.posts);
  const audience = audienceSignal(input.audience);
  const thin = !keywords.length && !services.length && posts.verdict === 'not-enough-data' && audience.basis === 'none';
  return { keywords, services, posts, audience, thin };
}

/**
 * The profile as prompt text.
 *
 * Written so the model can quote it back as the "vì sao gợi ý" line without
 * inventing anything: every number here is real, and a thin profile says so
 * out loud rather than letting the model fill the silence.
 */
export function signalsToPrompt(p: SignalProfile): string {
  const L: string[] = [];
  if (p.keywords.length) {
    L.push('TỪ KHOÁ KHÁCH GÕ TRÊN GOOGLE ĐỂ TÌM TIỆM (tháng này so tháng trước):');
    for (const k of p.keywords) {
      const move = k.trend === 'new' ? 'mới xuất hiện'
        : k.pct !== null ? `${k.pct >= 0 ? 'tăng' : 'giảm'} ${Math.abs(k.pct)}%`
        : 'ổn định';
      L.push(`- "${k.keyword}": ${k.count} lượt, ${move}`);
    }
  }
  if (p.services.length) {
    L.push('DỊCH VỤ ĐƯỢC ĐẶT (30 ngày qua so 30 ngày trước đó):');
    for (const s of p.services) {
      const move = s.trend === 'new' ? 'mới có khách đặt'
        : s.pct !== null ? `${s.pct >= 0 ? 'tăng' : 'giảm'} ${Math.abs(s.pct)}%`
        : 'ổn định';
      L.push(`- ${s.name}: ${s.count} lượt, ${move}`);
    }
  }
  if (p.posts.verdict !== 'not-enough-data') {
    const v = p.posts;
    const who = v.verdict === 'reel-wins' ? 'Reel/video ăn hơn bài ảnh'
      : v.verdict === 'photo-wins' ? 'Bài ảnh ăn hơn reel'
      : 'Reel và ảnh ngang nhau';
    L.push(`HIỆU SUẤT BÀI CỦA CHÍNH TIỆM: ${who}${v.multiple ? ` (gấp ${v.multiple} lần)` : ''} — reel trung bình ${v.reel.avgViews} view/${v.reel.posts} bài, ảnh ${v.photo.avgViews} view/${v.photo.posts} bài.`);
    if (v.topPosts.length) L.push(`Bài nhiều view nhất: ${v.topPosts.map((t) => `"${t.caption}" (${t.views})`).join(' · ')}`);
  }
  if (p.audience.basis === 'instagram') {
    const a = p.audience;
    const bits = [a.topAgeBand ? `đông nhất nhóm ${a.topAgeBand} (${a.topAgePct}%)` : '', a.femalePct !== null ? `${a.femalePct}% nữ` : ''].filter(Boolean);
    if (bits.length) L.push(`NGƯỜI THEO DÕI: ${bits.join(', ')}.`);
  }
  // Upcoming events are appended separately by eventsToPrompt(), because they
  // depend on where the salon is and this file only knows what it does.
  if (p.thin) {
    L.push('LƯU Ý: tiệm này chưa có đủ dữ liệu. Gợi ý nội dung nền tảng cho ngành, và NÓI THẲNG trong phần lý do rằng đây là gợi ý chung vì chưa đủ số liệu — tuyệt đối không bịa ra con số.');
  }
  return L.join('\n');
}
