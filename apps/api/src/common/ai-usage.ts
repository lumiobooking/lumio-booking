/**
 * WHERE THE API MONEY GOES — counted per call, per salon, per hour.
 *
 * WHY THIS EXISTS
 *
 * The Anthropic console shows one number for the whole platform: "$22.86 this
 * month". It cannot say which salon, which feature, or which hour, and it
 * cannot answer the question that actually gets asked — "the system looks
 * idle, so why is the balance going down?" The honest answer usually is that
 * something runs on a timer whether or not a person is at a screen: the
 * content planner drafts ideas for every active salon once a day, the profile
 * scanner reads a few shops an hour, the trade-profile writer clears its
 * backlog. None of that is visible from a screen nobody opened.
 *
 * So every model call reports what it cost, and this file is the arithmetic
 * that turns those reports into an answer. It is deliberately pure: no
 * database, no clock, no Nest. ai-usage.service.ts does the storing.
 *
 * WHAT IS STORED, AND WHY IT IS SHAPED LIKE THIS
 *
 * One record per day, holding TOKENS, not dollars. Prices change; a day
 * recorded in September must re-price correctly when the table is edited in
 * November, and a stored dollar figure could not. Cost is computed at read
 * time, from PRICES, every time.
 *
 * Counts are tuples rather than objects — `[in, out, cacheRead, cacheWrite,
 * calls, errors]` — because this blob is written every minute and read as one
 * string. Fifty-five salons times a dozen features times six named fields is
 * a quarter of a megabyte of punctuation; as tuples it is a few kilobytes.
 */

/** What asked for the tokens. One id per thing a person could switch off. */
export const AI_FEATURES = [
  /** The Messenger bot answering a customer. Per incoming message. */
  'messenger',
  /** The daily idea drafts — the planner, once per salon per local day. */
  'content-ideas',
  /** Writing a business its own playbook, when no built-in trade fits. */
  'trade-profile',
  /** Reading a new shop's website/profile to learn what it sells. */
  'profile-scan',
  /** The Google Business policy screen on a post's photo and caption. */
  'gbp-screen',
  /** Drafting a reply to a Google review. */
  'review-reply',
  /** Squeezing a long chat into a summary so the next turn stays cheap. */
  'chat-summary',
  /** Pulling facts out of what the salon typed into the bot's knowledge. */
  'bot-facts',
  /** The "suggest a greeting" button. */
  'greeting',
  /** Anything not yet named. Should stay at zero; if it does not, name it. */
  'other',
] as const;
export type AiFeature = typeof AI_FEATURES[number];

export const FEATURE_LABEL: Record<AiFeature, { vi: string; en: string }> = {
  'messenger': { vi: 'Chatbot Messenger trả lời khách', en: 'Messenger bot replies' },
  'content-ideas': { vi: 'Gợi ý ý tưởng hằng ngày', en: 'Daily content ideas' },
  'trade-profile': { vi: 'Viết hồ sơ ngành cho tiệm', en: 'Trade profile writing' },
  'profile-scan': { vi: 'Quét hồ sơ tiệm mới', en: 'New shop profile scan' },
  'gbp-screen': { vi: 'Kiểm duyệt bài Google Business', en: 'Google Business policy screen' },
  'review-reply': { vi: 'Soạn trả lời đánh giá Google', en: 'Google review replies' },
  'chat-summary': { vi: 'Tóm tắt hội thoại dài', en: 'Long chat summaries' },
  'bot-facts': { vi: 'Học kiến thức cho chatbot', en: 'Bot knowledge learning' },
  'greeting': { vi: 'Gợi ý lời chào', en: 'Greeting suggestions' },
  'other': { vi: 'Khác', en: 'Other' },
};

/** True when the feature runs on a timer rather than because somebody pressed something. */
export const AUTOMATIC: Record<AiFeature, boolean> = {
  'messenger': false,
  'content-ideas': true,
  'trade-profile': true,
  'profile-scan': true,
  'gbp-screen': true,
  'review-reply': false,
  'chat-summary': false,
  'bot-facts': false,
  'greeting': false,
  'other': false,
};

export function isFeature(v: unknown): v is AiFeature {
  return typeof v === 'string' && (AI_FEATURES as readonly string[]).includes(v);
}

// ---- prices ------------------------------------------------------------------

/** US dollars per MILLION tokens, as the provider bills them. */
export interface Price { input: number; output: number; cacheWrite: number; cacheRead: number }

/**
 * The published list prices. A model this table does not know is priced with
 * FALLBACK_PRICE and shown as an estimate — an unknown model must never make
 * the whole report read as zero.
 */
export const PRICES: Record<string, Price> = {
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  'claude-opus-4-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'gpt-5.6-luna': { input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.125 },
};

export const FALLBACK_PRICE: Price = { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 };

/**
 * The price for a model id as the API returns it — "claude-haiku-4-5-20251001"
 * is priced as "claude-haiku-4-5". Dated snapshots of one model cost the same,
 * and a new date must not silently fall back.
 */
export function priceOf(model: string): { price: Price; known: boolean } {
  const id = String(model ?? '').trim();
  if (PRICES[id]) return { price: PRICES[id], known: true };
  const undated = id.replace(/-\d{8}$/, '');
  if (PRICES[undated]) return { price: PRICES[undated], known: true };
  const prefix = Object.keys(PRICES).find((k) => undated.startsWith(k));
  if (prefix) return { price: PRICES[prefix], known: true };
  return { price: FALLBACK_PRICE, known: false };
}

// ---- the counters --------------------------------------------------------------

/** `[input, output, cacheRead, cacheWrite, calls, errors]`. */
export type Counts = [number, number, number, number, number, number];

export const zero = (): Counts => [0, 0, 0, 0, 0, 0];

export function addInto(a: Counts, b: Counts): Counts {
  for (let i = 0; i < 6; i += 1) a[i] += b[i] || 0;
  return a;
}

/** A stored tuple, validated. Junk reads as zero rather than poisoning a total. */
export function cleanCounts(raw: unknown): Counts {
  const a = Array.isArray(raw) ? raw : [];
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? Math.round(x) : 0;
  };
  return [n(a[0]), n(a[1]), n(a[2]), n(a[3]), n(a[4]), n(a[5])];
}

/** One model call, as a call site reports it. */
export interface AiCall {
  feature: AiFeature;
  /** The salon it was for. Null for platform-wide work that belongs to no shop. */
  tenantId: string | null;
  model: string;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** True when the call failed — it still cost latency, and a retry storm is worth seeing. */
  failed?: boolean;
  /** Hour of the day, salon-agnostic: the platform's own UTC hour, 0-23. */
  hour: number;
}

/** A day's worth, as it is stored. Keys are short because this is written as one string. */
export interface DayUsage {
  /** "YYYY-MM-DD", UTC. */
  d: string;
  /** feature -> model -> counts */
  f: Record<string, Record<string, Counts>>;
  /** tenantId (or "" for platform work) -> feature -> counts */
  t: Record<string, Record<string, Counts>>;
  /** "0".."23" -> counts */
  h: Record<string, Counts>;
}

export const emptyDay = (d: string): DayUsage => ({ d, f: {}, t: {}, h: {} });

const bump = (m: Record<string, Counts>, k: string, c: Counts) => {
  m[k] = addInto(m[k] ?? zero(), c);
};

/** Record one call into a day. Mutates and returns it — this runs on every model call. */
export function addCall(day: DayUsage, call: AiCall): DayUsage {
  const feature = isFeature(call.feature) ? call.feature : 'other';
  const c: Counts = [
    Math.max(0, Math.round(call.input || 0)),
    Math.max(0, Math.round(call.output || 0)),
    Math.max(0, Math.round(call.cacheRead || 0)),
    Math.max(0, Math.round(call.cacheWrite || 0)),
    1,
    call.failed ? 1 : 0,
  ];
  day.f[feature] = day.f[feature] ?? {};
  bump(day.f[feature], String(call.model || 'unknown'), c);
  const tid = call.tenantId ?? '';
  day.t[tid] = day.t[tid] ?? {};
  bump(day.t[tid], feature, c);
  const h = Number.isFinite(call.hour) ? Math.min(23, Math.max(0, Math.round(call.hour))) : 0;
  bump(day.h, String(h), c);
  return day;
}

/** A stored day, validated. */
export function cleanDay(raw: unknown, d: string): DayUsage {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<DayUsage>;
  const two = (v: unknown): Record<string, Record<string, Counts>> => {
    const out: Record<string, Record<string, Counts>> = {};
    for (const [k, inner] of Object.entries((v ?? {}) as Record<string, unknown>)) {
      const m: Record<string, Counts> = {};
      for (const [k2, c] of Object.entries((inner ?? {}) as Record<string, unknown>)) m[k2.slice(0, 80)] = cleanCounts(c);
      out[k.slice(0, 80)] = m;
    }
    return out;
  };
  const one: Record<string, Counts> = {};
  for (const [k, c] of Object.entries((o.h ?? {}) as Record<string, unknown>)) one[k.slice(0, 2)] = cleanCounts(c);
  return { d, f: two(o.f), t: two(o.t), h: one };
}

/**
 * Add b into a. Four Render services each keep their own row for the same
 * day — one process must never read-modify-write another's — so a day is
 * always the sum of several rows.
 */
export function mergeDay(a: DayUsage, b: DayUsage): DayUsage {
  const twoInto = (x: Record<string, Record<string, Counts>>, y: Record<string, Record<string, Counts>>) => {
    for (const [k, inner] of Object.entries(y)) {
      x[k] = x[k] ?? {};
      for (const [k2, c] of Object.entries(inner)) bump(x[k], k2, c);
    }
  };
  twoInto(a.f, b.f);
  twoInto(a.t, b.t);
  for (const [k, c] of Object.entries(b.h)) bump(a.h, k, c);
  return a;
}

export function mergeDays(days: DayUsage[], d: string): DayUsage {
  return days.reduce((acc, x) => mergeDay(acc, x), emptyDay(d));
}

// ---- reading it back -------------------------------------------------------------

/** What a set of counts cost, in US dollars. */
export function costOf(c: Counts, model: string): number {
  const { price } = priceOf(model);
  return (c[0] * price.input + c[1] * price.output + c[2] * price.cacheRead + c[3] * price.cacheWrite) / 1_000_000;
}

export interface FeatureRow {
  feature: AiFeature;
  label: { vi: string; en: string };
  automatic: boolean;
  calls: number;
  errors: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  usd: number;
  /** True when a model in this row is not in the price table — the figure is an estimate. */
  estimated: boolean;
  models: { model: string; calls: number; usd: number }[];
}

/** Every feature that spent anything, dearest first. */
export function byFeature(day: DayUsage): FeatureRow[] {
  const out: FeatureRow[] = [];
  for (const [feature, models] of Object.entries(day.f)) {
    const f = isFeature(feature) ? feature : 'other';
    const row: FeatureRow = {
      feature: f, label: FEATURE_LABEL[f], automatic: AUTOMATIC[f],
      calls: 0, errors: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0, estimated: false, models: [],
    };
    for (const [model, c] of Object.entries(models)) {
      const usd = costOf(c, model);
      row.input += c[0]; row.output += c[1]; row.cacheRead += c[2]; row.cacheWrite += c[3];
      row.calls += c[4]; row.errors += c[5]; row.usd += usd;
      if (!priceOf(model).known) row.estimated = true;
      row.models.push({ model, calls: c[4], usd });
    }
    row.models.sort((a, b) => b.usd - a.usd);
    out.push(row);
  }
  return out.sort((a, b) => b.usd - a.usd);
}

export interface TenantRow {
  tenantId: string;
  calls: number;
  usd: number;
  /** What this salon spent it on, dearest first. */
  features: { feature: AiFeature; calls: number; usd: number }[];
}

/**
 * Every salon that spent anything, dearest first.
 *
 * A tenant's tokens are counted under whichever model the feature used; the
 * feature's own model mix is the best available guess, so a tenant row is
 * priced with the models that feature actually ran on that day.
 */
export function byTenant(day: DayUsage): TenantRow[] {
  const modelOf = (feature: string): string => {
    const models = day.f[feature] ?? {};
    let best = 'unknown'; let most = -1;
    for (const [m, c] of Object.entries(models)) if (c[4] > most) { most = c[4]; best = m; }
    return best;
  };
  const out: TenantRow[] = [];
  for (const [tenantId, features] of Object.entries(day.t)) {
    const row: TenantRow = { tenantId, calls: 0, usd: 0, features: [] };
    for (const [feature, c] of Object.entries(features)) {
      const usd = costOf(c, modelOf(feature));
      row.calls += c[4]; row.usd += usd;
      row.features.push({ feature: isFeature(feature) ? feature : 'other', calls: c[4], usd });
    }
    row.features.sort((a, b) => b.usd - a.usd);
    out.push(row);
  }
  return out.sort((a, b) => b.usd - a.usd);
}

/** Twenty-four buckets, always all of them, so a chart has no gaps. */
export function byHour(day: DayUsage): { hour: number; calls: number; usd: number }[] {
  const modelMix = Object.entries(day.f).flatMap(([, models]) => Object.entries(models));
  const totalCalls = modelMix.reduce((a, [, c]) => a + c[4], 0) || 1;
  // One blended price for the day: the hour buckets hold no model breakdown,
  // and inventing one per hour would be a guess dressed as a fact.
  const dayUsd = modelMix.reduce((a, [m, c]) => a + costOf(c, m), 0);
  const perCall = dayUsd / totalCalls;
  return Array.from({ length: 24 }, (_, hour) => {
    const c = day.h[String(hour)] ?? zero();
    return { hour, calls: c[4], usd: c[4] * perCall };
  });
}

/** The day's bottom line. */
export function totals(day: DayUsage): { calls: number; errors: number; tokens: number; usd: number; estimated: boolean } {
  let calls = 0; let errors = 0; let tokens = 0; let usd = 0; let estimated = false;
  for (const [, models] of Object.entries(day.f)) {
    for (const [model, c] of Object.entries(models)) {
      calls += c[4]; errors += c[5];
      tokens += c[0] + c[1] + c[2] + c[3];
      usd += costOf(c, model);
      if (!priceOf(model).known) estimated = true;
    }
  }
  return { calls, errors, tokens, usd, estimated };
}

/**
 * How much of the input was served from cache. The console's "1% hit rate"
 * is the whole account; this is the same number per feature, which is what
 * says WHERE caching is not working.
 */
export function cacheHitRate(day: DayUsage, feature?: AiFeature): number {
  let fresh = 0; let cached = 0;
  for (const [f, models] of Object.entries(day.f)) {
    if (feature && f !== feature) continue;
    for (const [, c] of Object.entries(models)) { fresh += c[0] + c[3]; cached += c[2]; }
  }
  const all = fresh + cached;
  return all ? cached / all : 0;
}

/** "YYYY-MM-DD" for an instant, in UTC — the day a usage row is filed under. */
export const dayKeyUtc = (at: Date): string => at.toISOString().slice(0, 10);

/** The last n day keys ending today, oldest first. */
export function recentDays(today: Date, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) out.push(dayKeyUtc(new Date(today.getTime() - i * 86_400_000)));
  return out;
}
