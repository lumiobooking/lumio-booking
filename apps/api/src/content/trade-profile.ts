import { createHash } from 'crypto';
import { bi, type Txt } from './i18n';
import type { Playbook, ContentSource, PostType, FeedLink } from './industry-playbook';
import type { TradeQueries } from './trends/trend-feed';

/**
 * A trade the engine was never written for.
 *
 * The built-in playbooks cover salons (and their sub-trades), restaurants and
 * estate agents; everything else — a marketing agency, a furniture store, a
 * tutoring centre, a dentist — fell into SERVICE, a generic "home repairs"
 * playbook, and got a plan about plumbers. This is the alternative: the model
 * reads what the business wrote about itself and its Facebook page, and
 * writes the same four things a built-in playbook has — where content comes
 * from, what kinds of post do what job, the habits, and the search terms the
 * trends board pulls with — for THIS business. Stored per tenant, rebuilt
 * only when the description changes.
 *
 * Everything the model returns passes through cleanTradeProfile before it is
 * trusted: shapes, lengths, and the hashtag/search-term rules the trend
 * pulls depend on (Instagram's 30-unique-tags-a-week budget in particular).
 */

export const TRADE_PROFILE_KEY = 'trade_profile';

/** The trades whose built-in playbook is the real thing, not a stand-in. */
const BUILT_IN = new Set(['SALON', 'NAIL', 'HAIR', 'LASH', 'BROW', 'SPA', 'MASSAGE', 'PMU', 'RESTAURANT', 'REAL_ESTATE']);

/** Does this trade want a profile of its own? SERVICE is the catch-all. */
export function wantsTradeProfile(industry: string | null | undefined): boolean {
  return !BUILT_IN.has(String(industry ?? '').toUpperCase());
}

export interface TradeProfile {
  trade: { vi: string; en: string };
  dailySources: { label: { vi: string; en: string }; when: { vi: string; en: string }; why: { vi: string; en: string } }[];
  postTypes: { label: { vi: string; en: string }; job: { vi: string; en: string }; shots: { vi: string; en: string } }[];
  habits: { kind: 'engage' | 'story'; text: { vi: string; en: string }; why: { vi: string; en: string }; when: { vi: string; en: string } }[];
  /** YouTube search terms (≤6) and the title words a result must carry (≤12). */
  youtube: string[];
  mustMatch: string[];
  /** Instagram hashtags without '#', ≤7 — see TradeQueries.hashtags for why. */
  hashtags: string[];
  /** Google Trends seeds, ≤4. */
  google: string[];
  /** Hash of the description this was written from; a changed description rewrites it. */
  generatedFrom: string;
  generatedAt: string;
}

export function profileFingerprint(p: { whatWeDo?: string; whoWeServe?: string; edge?: string }, serviceNames: string[] = []): string {
  const text = [p.whatWeDo, p.whoWeServe, p.edge, ...serviceNames.slice(0, 20)].map((x) => String(x ?? '').trim().toLowerCase()).join('|');
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const bil = (v: unknown, max: number): { vi: string; en: string } | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as { vi?: unknown; en?: unknown };
  const vi = str(o.vi, max); const en = str(o.en, max);
  if (!vi && !en) return null;
  return { vi: vi || en, en: en || vi };
};
const words = (v: unknown, max: number, clean: (s: string) => string): string[] => {
  const out: string[] = [];
  for (const x of Array.isArray(v) ? v : []) {
    const s = clean(str(x, 60));
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
};

/** Validate what the model returned. Null = not usable; keep the built-in. */
export function cleanTradeProfile(raw: unknown): TradeProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const trade = bil(r.trade, 60);
  if (!trade) return null;
  const dailySources = (Array.isArray(r.dailySources) ? r.dailySources : []).map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const label = bil(o.label, 90); const when = bil(o.when, 90); const why = bil(o.why, 220);
    return label && when && why ? { label, when, why } : null;
  }).filter((x): x is NonNullable<typeof x> => Boolean(x)).slice(0, 6);
  const postTypes = (Array.isArray(r.postTypes) ? r.postTypes : []).map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const label = bil(o.label, 90); const job = bil(o.job, 220); const shots = bil(o.shots, 220);
    return label && job && shots ? { label, job, shots } : null;
  }).filter((x): x is NonNullable<typeof x> => Boolean(x)).slice(0, 6);
  const habits = (Array.isArray(r.habits) ? r.habits : []).map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const kind = o.kind === 'story' ? 'story' as const : 'engage' as const;
    const text = bil(o.text, 120); const why = bil(o.why, 220); const when = bil(o.when, 90);
    return text && why && when ? { kind, text, why, when } : null;
  }).filter((x): x is NonNullable<typeof x> => Boolean(x)).slice(0, 4);
  const plain = (s: string) => s.replace(/[#"'`]/g, '').trim();
  const tag = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]/g, '');
  const youtube = words(r.youtube, 6, plain);
  const mustMatch = words(r.mustMatch, 12, (s) => plain(s).toLowerCase());
  const hashtags = words(r.hashtags, 7, tag).filter((t) => t.length >= 3);
  const google = words(r.google, 4, plain);
  if (dailySources.length < 3 || postTypes.length < 3 || habits.length < 1) return null;
  if (youtube.length < 2 || mustMatch.length < 2 || hashtags.length < 2) return null;
  return {
    trade, dailySources, postTypes, habits, youtube, mustMatch, hashtags, google,
    generatedFrom: str(r.generatedFrom, 32),
    generatedAt: str(r.generatedAt, 40) || new Date().toISOString(),
  };
}

/** The profile in the shape every playbook reader already takes. */
export function playbookOf(p: TradeProfile): Playbook {
  const t = (x: { vi: string; en: string }): Txt => bi(x.vi, x.en);
  return {
    trade: t(p.trade),
    dailySources: p.dailySources.map((s): ContentSource => ({ label: t(s.label), when: t(s.when), why: t(s.why) })),
    postTypes: p.postTypes.map((s): PostType => ({ label: t(s.label), job: t(s.job), shots: t(s.shots) })),
    habits: p.habits.map((h) => ({ kind: h.kind, text: t(h.text), why: t(h.why), when: t(h.when) })),
  };
}

/** The profile in the shape the trend pulls take. */
export function queriesOf(p: TradeProfile): TradeQueries {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    mustMatch: new RegExp(p.mustMatch.map(esc).join('|'), 'i'),
    youtube: p.youtube,
    hashtags: p.hashtags,
    google: p.google.length ? p.google : p.youtube.slice(0, 3),
    pinterestInterests: [],
  };
}

/** Hashtag feeds for the Trends screen, from the profile's own tags. */
export function feedsOf(p: TradeProfile): FeedLink[] {
  return p.hashtags.slice(0, 3).map((tag, i) => ({
    key: `tt-tag-${tag}`,
    title: `TikTok #${tag}`,
    url: `https://www.tiktok.com/tag/${encodeURIComponent(tag)}`,
    what: i === 0
      ? bi(`Feed hashtag lớn nhất của ${p.trade.vi} — mở ra là thấy cái gì đang chạy tốt ngay lúc này.`, `The biggest hashtag feed for ${p.trade.en} — open it and you can see what is working right now.`)
      : bi('Feed hashtag phụ, thường ít cạnh tranh hơn và dễ lên hơn.', 'A second-tier hashtag feed: usually less competition, and easier to get seen on.'),
    how: bi('Xem 10 clip đầu, đếm xem bao nhiêu clip mở đầu bằng cận cảnh hay bằng một câu hỏi. Cách mở đầu lặp lại nhiều nhất là cách đang hiệu quả — làm theo cách mở, không chép nội dung.',
      'Watch the first 10 clips and count how many open on a close-up or a question. The opening that repeats most is the one that is working — copy the opening, not the content.'),
    source: 'TikTok',
  }));
}

/** Trend snapshots for a profiled business are its own, not a trade's. */
export function customScope(tenantId: string, market: string | null | undefined): string {
  const mk = ['US', 'CA', 'VN'].includes(String(market ?? '').toUpperCase()) ? String(market).toUpperCase() : 'US';
  return `CUSTOM-${tenantId}:${mk}`;
}
export function customTenantOf(scope: string): string | null {
  const m = /^CUSTOM-([^:]+):/.exec(scope);
  return m ? m[1] : null;
}

/** What the model is asked, in one place. */
export function tradeProfilePrompt(args: { whatWeDo: string; whoWeServe?: string; edge?: string; services: string[]; market: string; tenantName: string }): { system: string; user: string } {
  const vn = args.market.toUpperCase() === 'VN';
  const system = `Bạn là trưởng phòng nội dung của một agency, viết "sổ tay nội dung" cho MỘT doanh nghiệp cụ thể — không phải mẫu chung.

Đọc mô tả doanh nghiệp rồi trả về JSON THUẦN, đúng cấu trúc:
{
 "trade": {"vi":"tên ngành ngắn (vd: agency marketing địa phương)","en":"..."},
 "dailySources": [ {"label":{"vi":"...","en":"..."},"when":{"vi":"lúc nào trong ngày/tuần","en":"..."},"why":{"vi":"vì sao chất liệu này ăn khách","en":"..."}} ],   // 4-6 chất liệu quay/chụp CÓ SẴN trong ngày làm việc của chính họ
 "postTypes":    [ {"label":{"vi":"...","en":"..."},"job":{"vi":"bài này làm việc gì cho doanh thu","en":"..."},"shots":{"vi":"3-4 cảnh cụ thể theo thứ tự","en":"..."}} ],   // 4-5 dạng bài, mỗi dạng một việc khác nhau
 "habits":       [ {"kind":"engage"|"story","text":{"vi":"...","en":"..."},"why":{"vi":"...","en":"..."},"when":{"vi":"...","en":"..."}} ],   // 2-3 thói quen 5 phút
 "youtube":   ["4-6 cụm từ tìm YouTube mà KHÁCH của họ hoặc người trong ngành thật sự gõ"],
 "mustMatch": ["6-12 từ/cụm mà tiêu đề video phải chứa để coi là đúng ngành (thường, chữ thường, không dấu # )"],
 "hashtags":  ["5-7 hashtag Instagram không dấu #, chữ thường, đang có nhiều bài trong ngành này"],
 "google":    ["2-4 từ khóa gốc cho Google Trends"]
}

LUẬT:
1. Viết cho ĐÚNG doanh nghiệp này: khách hàng của họ là ai, họ bán gì, bằng chứng nào thuyết phục được khách đó. Một agency marketing thì chất liệu là kết quả của khách, màn hình số liệu, buổi làm việc với chủ tiệm — KHÔNG phải cảnh làm móng.
2. Cụ thể, quay được, làm được trong ngày — không khẩu hiệu, không "tăng nhận diện thương hiệu".
3. Phân biệt doanh nghiệp này với khách hàng của họ (agency phục vụ tiệm nail KHÔNG PHẢI tiệm nail).
4. Từ khóa/hashtag: ${vn ? 'tiếng Việt là chính, kèm 1-2 tiếng Anh nếu ngành hay dùng' : 'tiếng Anh là chính (thị trường Mỹ/Canada), kèm 1-2 tiếng Việt nếu khách của họ là người Việt'}.
5. Mỗi ô có cả "vi" và "en". Không markdown, không giải thích ngoài JSON.`;
  const user = [
    `Doanh nghiệp: ${args.tenantName}`,
    `Mô tả: ${args.whatWeDo}`,
    args.whoWeServe ? `Phục vụ: ${args.whoWeServe}` : '',
    args.edge ? `Điểm mạnh: ${args.edge}` : '',
    args.services.length ? `Dịch vụ/sản phẩm đã khai: ${args.services.slice(0, 25).join('; ')}` : '',
    `Thị trường: ${args.market}`,
  ].filter(Boolean).join('\n');
  return { system, user };
}
