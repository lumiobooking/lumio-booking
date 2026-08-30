/**
 * Where this week's trends actually come from.
 *
 * A hard rule for this file: it never invents a link to a specific video, and
 * it never states that a particular thing IS trending. A fabricated TikTok URL
 * is worse than no link at all — the salon clicks it, lands on nothing, and
 * stops trusting every other suggestion on the screen. A fabricated claim
 * ("nail chrome đang lên 300%") is worse still, because it cannot be clicked
 * and therefore cannot be caught.
 *
 * So there are exactly three honest layers here:
 *
 *   1. Deep links into real trend tools, pre-filtered to the salon's country,
 *      state and trade. Every base URL was opened and checked, and the query
 *      parameters survive the vendor's own redirects. The salon sees today's
 *      real data because the tool computes it, not because we cached a guess.
 *   2. Topics to look FOR on each of those pages. These are instructions, not
 *      claims — "tìm hashtag gắn với tựu trường" is honest in a way that
 *      "#backtoschoolnails đang trending" is not. They are built from things
 *      this platform genuinely knows: the salon's own top services, the search
 *      terms Google reported for it, and the events its region is walking into.
 *   3. Links a human on the Lumio team actually watched and pasted in, which
 *      travel through TrendNote and expire on a date.
 *
 * Nothing else. If a model ever produces a URL, it does not belong on this
 * screen.
 */

export type Cadence = 'weekly' | 'monthly';

/** One thing to look for on the page, and why it is worth the salon's time. */
export interface TrendTopic {
  label: string;
  why: string;
  /** 'salon' = from this salon's own numbers. 'region' = its local calendar. */
  from: 'salon' | 'region' | 'trade';
}

export interface TrendLink {
  key: string;
  title: string;
  url: string;
  /** What the salon will be looking at when the page opens. */
  what: string;
  /** The step that turns looking into a post — the part usually left out. */
  how: string;
  /** Concrete things to search for, tailored to this salon. */
  topics: TrendTopic[];
  cadence: Cadence;
  source: string;
}

export interface TrendQueryProfile {
  /** Google Trends search terms, most useful first. */
  terms: string[];
  /** Words to search the ad library with. */
  adTerms: string[];
  /** Plain-language label used in link titles. */
  trade: string;
  /** The on-page category filter to point people at. */
  category: string;
  /** Evergreen angles, used when we know nothing else about this salon. */
  fallbackTopics: TrendTopic[];
}

const PROFILES: Record<string, TrendQueryProfile> = {
  SALON: {
    trade: 'ngành nail',
    category: 'Beauty & Personal Care',
    terms: ['nail salon near me', 'nail designs', 'gel x nails', 'pedicure near me'],
    adTerms: ['nail salon'],
    fallbackTopics: [
      { label: 'Mẫu móng theo mùa đang lên', why: 'Màu và mẫu đổi theo mùa nhanh hơn mọi thứ khác trong nghề — bắt đúng mùa là đủ khác biệt', from: 'trade' },
      { label: 'Clip cận cảnh / ASMR khi làm', why: 'Dạng dễ quay nhất mà vẫn giữ người xem lâu: không cần lời thoại, không cần diễn', from: 'trade' },
      { label: 'Trước và sau trên bộ móng hỏng', why: 'Người xem dừng lại vì tò mò, và đó là bằng chứng tay nghề rõ nhất tiệm có', from: 'trade' },
    ],
  },
  RESTAURANT: {
    trade: 'ngành ăn uống',
    category: 'Food & Beverage',
    terms: ['restaurants near me', 'food near me', 'happy hour near me'],
    adTerms: ['restaurant'],
    fallbackTopics: [
      { label: 'Món đang được quay nhiều', why: 'Một món lên hình đẹp kéo khách hơn cả thực đơn đầy đủ', from: 'trade' },
      { label: 'Cảnh bếp và người nấu', why: 'Khách chọn quán vì tin người nấu, không vì ảnh món chỉnh sửa', from: 'trade' },
    ],
  },
  REAL_ESTATE: {
    trade: 'ngành bất động sản',
    category: 'Business & Finance',
    terms: ['homes for sale', 'houses for sale near me', 'open house'],
    adTerms: ['real estate agent'],
    fallbackTopics: [
      { label: 'Tour nhà quay dọc màn hình', why: 'Dạng nội dung được xem hết nhiều nhất trong ngành này', from: 'trade' },
      { label: 'Giải thích một bước trong quy trình mua', why: 'Người mua lần đầu tìm câu trả lời trước khi tìm người môi giới', from: 'trade' },
    ],
  },
  SERVICE: {
    trade: 'ngành dịch vụ',
    category: 'Shopping',
    terms: ['near me open now'],
    adTerms: ['local service'],
    fallbackTopics: [
      { label: 'Trước và sau của một ca thật', why: 'Bằng chứng cụ thể thuyết phục hơn mọi lời quảng cáo', from: 'trade' },
    ],
  },
};

export function profileFor(industry?: string | null): TrendQueryProfile {
  return PROFILES[(industry || 'SALON').toUpperCase()] ?? PROFILES.SALON;
}

/**
 * Google Trends geography code.
 *
 * A trap worth naming: "CA" means California inside the United States and
 * Canada at the top level. A salon in Toronto asking for US-CA would be shown
 * California's search interest and never know. Market decides first.
 */
export function trendsGeo(market: string, region: string | null): string {
  if (market === 'VN') return 'VN';
  if (market === 'CA') return region ? `CA-${region}` : 'CA';
  return region ? `US-${region}` : 'US';
}

function gtrends(terms: string | string[], geo: string, window: '7d' | '30d' | '12m'): string {
  const date = window === '7d' ? 'now 7-d' : window === '30d' ? 'today 1-m' : 'today 12-m';
  // Google Trends compares up to five terms from one q parameter, comma-joined.
  const q = Array.isArray(terms) ? terms.slice(0, 5).join(',') : terms;
  return `https://trends.google.com/trends/explore?date=${encodeURIComponent(date)}&geo=${encodeURIComponent(geo)}&q=${encodeURIComponent(q)}&hl=vi`;
}

export interface TrendInput {
  industry?: string | null;
  market?: string | null;
  region?: string | null;
  city?: string | null;
  /** The salon's own most-booked services, busiest first. */
  services?: { name: string; count?: number }[];
  /** Search terms Google reported for this salon's profile. */
  keywords?: { keyword: string; count?: number }[];
  /** What its region is walking into. */
  events?: { name: string; daysAway: number; note?: string }[];
}

/**
 * Topics built from what this platform genuinely knows about this salon.
 *
 * Ordered by how specific the evidence is: its own booking book first, then the
 * search terms Google reported for it, then its local calendar, and only then
 * the trade's evergreen angles. A salon with three months of data should not be
 * reading the same generic list as one that opened on Monday.
 */
export function topicsFor(input: TrendInput, limit = 4): TrendTopic[] {
  const p = profileFor(input.industry);
  const out: TrendTopic[] = [];

  for (const s of (input.services ?? []).slice(0, 2)) {
    const name = String(s?.name ?? '').trim();
    if (!name) continue;
    out.push({
      label: name,
      why: `Dịch vụ tiệm đang bán chạy${s.count ? ` (${s.count} lượt đặt gần đây)` : ''} — tìm cách người khác quay đúng dịch vụ này`,
      from: 'salon',
    });
  }

  for (const k of (input.keywords ?? []).slice(0, 2)) {
    const kw = String(k?.keyword ?? '').trim();
    if (!kw) continue;
    out.push({
      label: kw,
      why: `Cụm khách thật sự gõ trên Google để tìm tiệm${k.count ? ` (${k.count} lượt)` : ''} — nội dung nên nói đúng bằng chữ của khách`,
      from: 'salon',
    });
  }

  for (const e of (input.events ?? []).filter((x) => x.daysAway <= 45).slice(0, 2)) {
    out.push({
      label: e.name,
      why: e.daysAway <= 0
        ? `Đang diễn ra ở khu vực tiệm — ${e.note ?? 'làm nội dung bám dịp này ngay'}`
        : `Còn ${e.daysAway} ngày ở khu vực tiệm. Nội dung phải lên trước dịp, không phải đúng hôm đó`,
      from: 'region',
    });
  }

  for (const t of p.fallbackTopics) {
    if (out.length >= limit) break;
    out.push(t);
  }
  return out.slice(0, limit);
}

/**
 * The week's and the month's sources for one salon.
 *
 * `region` may be null — the links still work, they just cover the whole
 * country, and the caller is expected to say so on screen rather than let the
 * salon think it is looking at its own neighbourhood.
 */
export function trendLinks(input: TrendInput): {
  weekly: TrendLink[]; monthly: TrendLink[]; regionKnown: boolean;
} {
  const market = input.market === 'VN' ? 'VN' : input.market === 'CA' ? 'CA' : 'US';
  const region = input.region?.trim().toUpperCase() || null;
  const p = profileFor(input.industry);
  const geo = trendsGeo(market, region);
  const where = region ?? market;
  const country = market;
  const topics = topicsFor(input);
  // Some links want only one kind of topic — the local-events one, say. When a
  // salon has none of that kind, fall back to the full list rather than render
  // an empty section: a heading with nothing under it reads like a bug.
  const only = (kind: TrendTopic['from'] | 'not-trade', n: number): TrendTopic[] => {
    const picked = kind === 'not-trade'
      ? topics.filter((t) => t.from !== 'trade')
      : topics.filter((t) => t.from === kind);
    return (picked.length ? picked : topics).slice(0, n);
  };

  // The salon's own busiest service is a better Google Trends query than any
  // generic term we could pick for it.
  const ownTerm = input.services?.[0]?.name?.trim() || input.keywords?.[0]?.keyword?.trim() || p.terms[1] || p.terms[0];
  const compare = [p.terms[0], ...(input.services ?? []).slice(0, 3).map((s) => s.name).filter(Boolean)].slice(0, 4);

  const weekly: TrendLink[] = [
    {
      key: 'tiktok-7',
      title: 'TikTok — hashtag & nhạc đang lên (7 ngày)',
      url: `https://ads.tiktok.com/creative/creativeCenter/trends?countryCode=${country}&period=7`,
      what: `Bảng xếp hạng hashtag, bài nhạc và creator tăng mạnh nhất ở ${country} trong 7 ngày qua. Bộ lọc ngành nằm ngay trên trang — chọn ${p.category}.`,
      how: 'Lấy 1 bài nhạc trong top 10 và quay lại đúng nội dung tiệm vẫn làm. Nhạc đang lên kéo lượt xem, nội dung vẫn là của tiệm.',
      topics,
      cadence: 'weekly',
      source: 'TikTok Creative Center',
    },
    {
      key: 'tiktok-topads',
      title: `Quảng cáo TikTok chạy tốt nhất ${p.trade}`,
      url: 'https://ads.tiktok.com/business/creativecenter/inspiration/topads/',
      what: `Những quảng cáo có hiệu quả cao nhất trên TikTok, lọc được theo ngành và quốc gia. Đây là clip đã được tiền thật kiểm chứng, không phải clip may mắn viral.`,
      how: 'Xem 3 giây đầu của 5 quảng cáo top. Ghi lại cách họ mở đầu — đó là phần quyết định người xem ở lại hay lướt qua.',
      topics: topics.slice(0, 3),
      cadence: 'weekly',
      source: 'TikTok Creative Center',
    },
    {
      key: 'gtrends-now',
      title: `Google — đang thịnh hành tại ${where} (24 giờ)`,
      url: `https://trends.google.com/trending?geo=${encodeURIComponent(geo)}&hl=vi`,
      what: 'Những cụm từ đang tăng vọt ngay lúc này. Trên trang có ô Vị trí và ô Danh mục — chọn bang của tiệm và danh mục "Làm đẹp và thời trang".',
      how: 'Chỉ dùng khi có thứ gì đó liên quan tới khách của tiệm. Bám tin nóng không liên quan là cách nhanh nhất để mất người theo dõi thật.',
      topics: only('region', 2),
      cadence: 'weekly',
      source: 'Google Trends',
    },
    {
      key: 'gtrends-7',
      title: `Google Trends — khách ${where} đang tìm gì (7 ngày)`,
      url: gtrends(ownTerm, geo, '7d'),
      what: `Mức độ tìm kiếm "${ownTerm}" trong 7 ngày qua${region ? `, chỉ riêng ${region}` : ''}, kèm các truy vấn đang tăng đột biến bên dưới.`,
      how: 'Kéo xuống mục "Truy vấn liên quan → Đang tăng". Bất kỳ cụm nào tăng vọt là một tiêu đề bài đăng viết sẵn cho tuần này.',
      topics,
      cadence: 'weekly',
      source: 'Google Trends',
    },
    {
      key: 'meta-ads',
      title: `Đối thủ ${p.trade} đang chạy quảng cáo gì`,
      url: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&q=${encodeURIComponent(p.adTerms[0])}&search_type=keyword_unordered&media_type=all`,
      what: 'Thư viện quảng cáo của Meta — mọi quảng cáo đang chạy, công khai, kèm ngày bắt đầu.',
      how: 'Quảng cáo nào chạy liên tục nhiều tuần là quảng cáo đang có lãi. Xem họ mời chào cái gì, rồi làm phiên bản của tiệm — đừng chép chữ.',
      topics: topics.slice(0, 3),
      cadence: 'weekly',
      source: 'Meta Ad Library',
    },
  ];

  const monthly: TrendLink[] = [
    {
      key: 'tiktok-30',
      title: 'TikTok — xu hướng cả tháng (30 ngày)',
      url: `https://ads.tiktok.com/creative/creativeCenter/trends?countryCode=${country}&period=30`,
      what: 'Cùng bảng xếp hạng nhưng khung 30 ngày — cái gì trụ được cả tháng mới là xu hướng thật, còn lại là sóng vài ngày.',
      how: 'Chọn 2 chủ đề trụ hạng cả tháng làm trục nội dung tháng sau, thay vì chạy theo từng trend lẻ.',
      topics,
      cadence: 'monthly',
      source: 'TikTok Creative Center',
    },
    {
      key: 'gtrends-compare',
      title: `So sánh ${compare.length} dịch vụ của tiệm tại ${where}`,
      url: gtrends(compare, geo, '30d'),
      what: `Đặt cạnh nhau: ${compare.join(' · ')}. Cùng một biểu đồ, cùng một vùng, nên đọc được cái nào đang thắng.`,
      how: 'Dịch vụ nào đang lên mà tiệm chưa đẩy nội dung thì đó là khoảng trống rõ nhất trong tháng. Dịch vụ nào đi xuống thì đừng dồn tiền quảng cáo vào.',
      topics: only('salon', 3),
      cadence: 'monthly',
      source: 'Google Trends',
    },
    {
      key: 'gtrends-season',
      title: `Nhịp cả năm của ${p.trade} tại ${where}`,
      url: gtrends(p.terms[0], geo, '12m'),
      what: '12 tháng nhu cầu, nên nhìn ra được mùa cao và mùa thấp của chính vùng này thay vì nghe truyền miệng.',
      how: 'Nhìn xem tháng sau là đang lên hay đang xuống. Đang lên thì tăng nội dung; đang xuống thì đó mới là lúc đáng làm ưu đãi, không phải lúc đang đông.',
      topics: only('region', 2),
      cadence: 'monthly',
      source: 'Google Trends',
    },
    {
      key: 'pinterest',
      title: 'Pinterest Trends — mẫu khách sẽ mang tới tiệm',
      url: `https://trends.pinterest.com/?country=${country}`,
      what: 'Cái khách lưu lại trước khi đi làm móng. Pinterest đi trước tiệm khoảng vài tuần đến vài tháng.',
      how: 'Tìm từ khoá theo mùa đang lên, lưu 3 mẫu, in ra để ở quầy làm bảng chọn mẫu.',
      topics,
      cadence: 'monthly',
      source: 'Pinterest Trends',
    },
    {
      key: 'meta-ads-local',
      title: `Quảng cáo ${p.trade} quanh khu vực tiệm`,
      url: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&q=${encodeURIComponent(`${p.adTerms[0]}${input.city ? ` ${input.city}` : region ? ` ${region}` : ''}`)}&search_type=keyword_unordered&media_type=all`,
      what: input.city || region
        ? `Cùng thư viện quảng cáo nhưng tìm kèm tên khu vực — ra đúng những tiệm đang tranh khách với mình.`
        : 'Thư viện quảng cáo toàn quốc. Điền thành phố cho tiệm để lọc sát khu vực hơn.',
      how: 'Mỗi tháng xem một lần. Nếu quanh đây ai cũng chào cùng một kiểu giảm giá, thì cách thắng là làm khác đi chứ không phải giảm sâu hơn.',
      topics: only('not-trade', 3),
      cadence: 'monthly',
      source: 'Meta Ad Library',
    },
  ];

  return { weekly, monthly, regionKnown: Boolean(region) };
}

/**
 * Trend links as prompt text.
 *
 * Deliberately terse, and it never hands the model a URL to repeat. The model
 * gets to know that these tools exist so its reasoning is not blind; the links
 * themselves reach the salon through the UI, where they cannot be garbled.
 */
export function trendLinksToPrompt(): string {
  return [
    'NGUỒN XU HƯỚNG: tiệm đã có sẵn link tới TikTok Creative Center, Google Trends,',
    'Meta Ad Library và Pinterest Trends ngay trên màn hình.',
    'TUYỆT ĐỐI KHÔNG tự bịa link, tên clip, tên bài nhạc hay số lượt xem.',
    'KHÔNG được khẳng định một hashtag/mẫu/màu nào "đang trending" nếu dữ liệu bên trên không nói vậy.',
  ].join('\n');
}
