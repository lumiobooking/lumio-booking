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

import { bi, enOf, viOf, type Txt } from './i18n';

export type Cadence = 'weekly' | 'monthly';

/** One thing to look for on the page, and why it is worth the salon's time. */
export interface TrendTopic {
  /**
   * What to search for. An angle this product wrote is bilingual; a service
   * name or a search term the salon's own customers typed is left exactly as
   * typed — translating it would stop it matching anything on the page.
   */
  label: Txt;
  why: Txt;
  /** 'salon' = from this salon's own numbers. 'region' = its local calendar. */
  from: 'salon' | 'region' | 'trade';
}

export interface TrendLink {
  key: string;
  title: Txt;
  url: string;
  /** What the salon will be looking at when the page opens. */
  what: Txt;
  /** The step that turns looking into a post — the part usually left out. */
  how: Txt;
  /** Concrete things to search for, tailored to this salon. */
  topics: TrendTopic[];
  cadence: Cadence;
  /**
   * Whose page this is. Typed `Txt` like every other visible field, but the
   * values stay plain: "Google Trends" is called that on both screens, and a
   * translated product name is a name that no longer points at anything.
   */
  source: Txt;
}

export interface TrendQueryProfile {
  /** Google Trends search terms, most useful first. */
  terms: string[];
  /** Words to search the ad library with. */
  adTerms: string[];
  /** Plain-language label used in link titles, so it is shown and translated. */
  trade: Txt;
  /** The on-page category filter to point people at. Copied off the vendor's own UI, so not translated. */
  category: string;
  /** Evergreen angles, used when we know nothing else about this salon. */
  fallbackTopics: TrendTopic[];
}

const PROFILES: Record<string, TrendQueryProfile> = {
  SALON: {
    trade: bi('ngành nail', 'nail salons'),
    category: 'Beauty & Personal Care',
    terms: ['nail salon near me', 'nail designs', 'gel x nails', 'pedicure near me'],
    adTerms: ['nail salon'],
    fallbackTopics: [
      {
        label: bi('Mẫu móng theo mùa đang lên', 'Seasonal nail looks on the way up'),
        why: bi(
          'Màu và mẫu đổi theo mùa nhanh hơn mọi thứ khác trong nghề — bắt đúng mùa là đủ khác biệt',
          'Colors and shapes turn over with the seasons faster than anything else in this trade — catching the right season is enough to stand out'),
        from: 'trade',
      },
      {
        label: bi('Clip cận cảnh / ASMR khi làm', 'Close-up and ASMR clips of the work'),
        why: bi(
          'Dạng dễ quay nhất mà vẫn giữ người xem lâu: không cần lời thoại, không cần diễn',
          'The easiest thing to film that still holds people to the end: no script, no acting'),
        from: 'trade',
      },
      {
        label: bi('Trước và sau trên bộ móng hỏng', 'Before and after on a badly damaged set'),
        why: bi(
          'Người xem dừng lại vì tò mò, và đó là bằng chứng tay nghề rõ nhất tiệm có',
          'People stop out of curiosity, and it is the clearest proof of the work you have',
        ),
        from: 'trade',
      },
    ],
  },
  RESTAURANT: {
    trade: bi('ngành ăn uống', 'restaurants'),
    category: 'Food & Beverage',
    terms: ['restaurants near me', 'food near me', 'happy hour near me'],
    adTerms: ['restaurant'],
    fallbackTopics: [
      {
        label: bi('Món đang được quay nhiều', 'The dish people are filming'),
        why: bi(
          'Một món lên hình đẹp kéo khách hơn cả thực đơn đầy đủ',
          'One dish that films well brings more people in than a full menu does'),
        from: 'trade',
      },
      {
        label: bi('Cảnh bếp và người nấu', 'The kitchen and the people cooking'),
        why: bi(
          'Khách chọn quán vì tin người nấu, không vì ảnh món chỉnh sửa',
          'People pick a place because they trust whoever is cooking, not because of a retouched photo'),
        from: 'trade',
      },
    ],
  },
  REAL_ESTATE: {
    trade: bi('ngành bất động sản', 'real estate agents'),
    category: 'Business & Finance',
    terms: ['homes for sale', 'houses for sale near me', 'open house'],
    adTerms: ['real estate agent'],
    fallbackTopics: [
      {
        label: bi('Tour nhà quay dọc màn hình', 'Vertical home tours'),
        why: bi(
          'Dạng nội dung được xem hết nhiều nhất trong ngành này',
          'The format people watch all the way through more than any other in this business'),
        from: 'trade',
      },
      {
        label: bi('Giải thích một bước trong quy trình mua', 'Explain one step of the buying process'),
        why: bi(
          'Người mua lần đầu tìm câu trả lời trước khi tìm người môi giới',
          'First-time buyers look for answers before they look for an agent'),
        from: 'trade',
      },
    ],
  },
  SERVICE: {
    trade: bi('ngành dịch vụ', 'local service businesses'),
    category: 'Shopping',
    terms: ['near me open now'],
    adTerms: ['local service'],
    fallbackTopics: [
      {
        label: bi('Trước và sau của một ca thật', 'Before and after on a real job'),
        why: bi(
          'Bằng chứng cụ thể thuyết phục hơn mọi lời quảng cáo',
          'Concrete proof does what advertising copy cannot'),
        from: 'trade',
      },
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
  /** What its region is walking into. Bilingual, straight from region-events. */
  events?: { name: Txt; daysAway: number; note?: Txt }[];
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
      // The service name is what the salon typed into its own menu, so it is
      // shown as typed on both screens; only the reason around it is written.
      label: name,
      why: bi(
        `Dịch vụ tiệm đang bán chạy${s.count ? ` (${s.count} lượt đặt gần đây)` : ''} — tìm cách người khác quay đúng dịch vụ này`,
        `One of your best sellers${s.count ? ` (${s.count} bookings recently)` : ''} — look for how other people film this exact service`),
      from: 'salon',
    });
  }

  for (const k of (input.keywords ?? []).slice(0, 2)) {
    const kw = String(k?.keyword ?? '').trim();
    if (!kw) continue;
    out.push({
      // A search term is customer wording. Translated, it stops being the thing
      // to type into the box.
      label: kw,
      why: bi(
        `Cụm khách thật sự gõ trên Google để tìm tiệm${k.count ? ` (${k.count} lượt)` : ''} — nội dung nên nói đúng bằng chữ của khách`,
        `What customers really type into Google to find a shop${k.count ? ` (${k.count} searches)` : ''} — the content should use their words`),
      from: 'salon',
    });
  }

  for (const e of (input.events ?? []).filter((x) => x.daysAway <= 45).slice(0, 2)) {
    out.push({
      // A holiday has a real name in each language — "Lễ Lao động" is "Labor
      // Day", not a translation of it — so the event travels here bilingual and
      // each side of the sentence takes its own side of the name.
      label: e.name,
      why: e.daysAway <= 0
        ? bi(
          `Đang diễn ra ở khu vực tiệm — ${e.note ? viOf(e.note) : 'làm nội dung bám dịp này ngay'}`,
          `Happening in your area right now — ${e.note ? enOf(e.note) : 'post something tied to it today'}`)
        : bi(
          `Còn ${e.daysAway} ngày ở khu vực tiệm. Nội dung phải lên trước dịp, không phải đúng hôm đó`,
          `${e.daysAway} days out in your area. The post has to go up before the day, not on it`),
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
      title: bi('TikTok — hashtag & nhạc đang lên (7 ngày)', 'TikTok — rising hashtags and sounds (last 7 days)'),
      url: `https://ads.tiktok.com/creative/creativeCenter/trends?countryCode=${country}&period=7`,
      what: bi(
        `Bảng xếp hạng hashtag, bài nhạc và creator tăng mạnh nhất ở ${country} trong 7 ngày qua. Bộ lọc ngành nằm ngay trên trang — chọn ${p.category}.`,
        `The hashtags, sounds and creators rising fastest in ${country} over the last 7 days. The industry filter is right on the page — pick ${p.category}.`),
      how: bi(
        'Lấy 1 bài nhạc trong top 10 và quay lại đúng nội dung tiệm vẫn làm. Nhạc đang lên kéo lượt xem, nội dung vẫn là của tiệm.',
        'Take one sound from the top 10 and shoot the work you already do to it. The rising sound brings the views, the work stays yours.'),
      topics,
      cadence: 'weekly',
      source: 'TikTok Creative Center',
    },
    {
      key: 'tiktok-topads',
      title: bi(`Quảng cáo TikTok chạy tốt nhất ${viOf(p.trade)}`, `Top-performing TikTok ads for ${enOf(p.trade)}`),
      url: 'https://ads.tiktok.com/business/creativecenter/inspiration/topads/',
      what: bi(
        'Những quảng cáo có hiệu quả cao nhất trên TikTok, lọc được theo ngành và quốc gia. Đây là clip đã được tiền thật kiểm chứng, không phải clip may mắn viral.',
        'The highest-performing ads on TikTok, filtered by industry and country. These are clips real money has already tested, not clips that got lucky.'),
      how: bi(
        'Xem 3 giây đầu của 5 quảng cáo top. Ghi lại cách họ mở đầu — đó là phần quyết định người xem ở lại hay lướt qua.',
        'Watch the first 3 seconds of the top 5 ads. Write down how they open — that is the part that decides whether someone stays or scrolls past.'),
      topics: topics.slice(0, 3),
      cadence: 'weekly',
      source: 'TikTok Creative Center',
    },
    {
      key: 'gtrends-now',
      title: bi(`Google — đang thịnh hành tại ${where} (24 giờ)`, `Google — trending in ${where} (last 24 hours)`),
      url: `https://trends.google.com/trending?geo=${encodeURIComponent(geo)}&hl=vi`,
      what: bi(
        'Những cụm từ đang tăng vọt ngay lúc này. Trên trang có ô Vị trí và ô Danh mục — chọn bang của tiệm và danh mục "Làm đẹp và thời trang".',
        'The searches spiking right this minute. The page has a Location box and a Category box — set your state and the "Beauty and fashion" category.'),
      how: bi(
        'Chỉ dùng khi có thứ gì đó liên quan tới khách của tiệm. Bám tin nóng không liên quan là cách nhanh nhất để mất người theo dõi thật.',
        'Only use it when something up there actually touches your customers. Jumping on unrelated news is the fastest way to lose the followers you have.'),
      topics: only('region', 2),
      cadence: 'weekly',
      source: 'Google Trends',
    },
    {
      key: 'gtrends-7',
      title: bi(`Google Trends — khách ${where} đang tìm gì (7 ngày)`, `Google Trends — what ${where} is searching for (last 7 days)`),
      url: gtrends(ownTerm, geo, '7d'),
      what: bi(
        `Mức độ tìm kiếm "${ownTerm}" trong 7 ngày qua${region ? `, chỉ riêng ${region}` : ''}, kèm các truy vấn đang tăng đột biến bên dưới.`,
        `Search interest in "${ownTerm}" over the last 7 days${region ? `, ${region} only` : ''}, with the queries that are spiking listed underneath.`),
      how: bi(
        'Kéo xuống mục "Truy vấn liên quan → Đang tăng". Bất kỳ cụm nào tăng vọt là một tiêu đề bài đăng viết sẵn cho tuần này.',
        'Scroll down to "Related queries → Rising". Anything spiking there is a post headline already written for this week.'),
      topics,
      cadence: 'weekly',
      source: 'Google Trends',
    },
    {
      key: 'meta-ads',
      title: bi(`Đối thủ ${viOf(p.trade)} đang chạy quảng cáo gì`, `What other ${enOf(p.trade)} are advertising`),
      url: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&q=${encodeURIComponent(p.adTerms[0])}&search_type=keyword_unordered&media_type=all`,
      what: bi(
        'Thư viện quảng cáo của Meta — mọi quảng cáo đang chạy, công khai, kèm ngày bắt đầu.',
        'The Meta ad library — every ad running right now, out in the open, with the date it started.'),
      how: bi(
        'Quảng cáo nào chạy liên tục nhiều tuần là quảng cáo đang có lãi. Xem họ mời chào cái gì, rồi làm phiên bản của tiệm — đừng chép chữ.',
        'An ad that has run for weeks straight is an ad that is making money. Look at what they are offering, then make your own version — do not copy the words.'),
      topics: topics.slice(0, 3),
      cadence: 'weekly',
      source: 'Meta Ad Library',
    },
  ];

  const monthly: TrendLink[] = [
    {
      key: 'tiktok-30',
      title: bi('TikTok — xu hướng cả tháng (30 ngày)', 'TikTok — the whole month in trends (last 30 days)'),
      url: `https://ads.tiktok.com/creative/creativeCenter/trends?countryCode=${country}&period=30`,
      what: bi(
        'Cùng bảng xếp hạng nhưng khung 30 ngày — cái gì trụ được cả tháng mới là xu hướng thật, còn lại là sóng vài ngày.',
        'The same rankings on a 30-day window — what holds up for a month is a real trend, the rest is a few days of noise.'),
      how: bi(
        'Chọn 2 chủ đề trụ hạng cả tháng làm trục nội dung tháng sau, thay vì chạy theo từng trend lẻ.',
        'Pick the 2 themes that held all month and build next month around them, instead of chasing one trend at a time.'),
      topics,
      cadence: 'monthly',
      source: 'TikTok Creative Center',
    },
    {
      key: 'gtrends-compare',
      title: bi(`So sánh ${compare.length} dịch vụ của tiệm tại ${where}`, `Your ${compare.length} services side by side in ${where}`),
      url: gtrends(compare, geo, '30d'),
      what: bi(
        `Đặt cạnh nhau: ${compare.join(' · ')}. Cùng một biểu đồ, cùng một vùng, nên đọc được cái nào đang thắng.`,
        `Side by side: ${compare.join(' · ')}. One chart, one region, so you can read which one is winning.`),
      how: bi(
        'Dịch vụ nào đang lên mà tiệm chưa đẩy nội dung thì đó là khoảng trống rõ nhất trong tháng. Dịch vụ nào đi xuống thì đừng dồn tiền quảng cáo vào.',
        'A service on the way up that you are not posting about is the clearest gap you have this month. A service on the way down is not where the ad money should go.'),
      topics: only('salon', 3),
      cadence: 'monthly',
      source: 'Google Trends',
    },
    {
      key: 'gtrends-season',
      title: bi(`Nhịp cả năm của ${viOf(p.trade)} tại ${where}`, `The 12-month rhythm for ${enOf(p.trade)} in ${where}`),
      url: gtrends(p.terms[0], geo, '12m'),
      what: bi(
        '12 tháng nhu cầu, nên nhìn ra được mùa cao và mùa thấp của chính vùng này thay vì nghe truyền miệng.',
        'Twelve months of demand, so you can read the busy and slow seasons of this region itself instead of going by word of mouth.'),
      how: bi(
        'Nhìn xem tháng sau là đang lên hay đang xuống. Đang lên thì tăng nội dung; đang xuống thì đó mới là lúc đáng làm ưu đãi, không phải lúc đang đông.',
        'Look at whether next month is heading up or down. Heading up, post more; heading down, that is when a promotion is worth running, not while you are already busy.'),
      topics: only('region', 2),
      cadence: 'monthly',
      source: 'Google Trends',
    },
    {
      key: 'pinterest',
      title: bi('Pinterest Trends — mẫu khách sẽ mang tới tiệm', 'Pinterest Trends — the looks customers will bring in'),
      url: `https://trends.pinterest.com/?country=${country}`,
      what: bi(
        'Cái khách lưu lại trước khi đi làm móng. Pinterest đi trước tiệm khoảng vài tuần đến vài tháng.',
        'What customers save before they come in for an appointment. Pinterest runs a few weeks to a few months ahead of the shop.'),
      how: bi(
        'Tìm từ khoá theo mùa đang lên, lưu 3 mẫu, in ra để ở quầy làm bảng chọn mẫu.',
        'Search a seasonal keyword that is climbing, save 3 looks, print them and keep them at the counter as a pick-a-look board.'),
      topics,
      cadence: 'monthly',
      source: 'Pinterest Trends',
    },
    {
      key: 'meta-ads-local',
      title: bi(`Quảng cáo ${viOf(p.trade)} quanh khu vực tiệm`, `Ads from ${enOf(p.trade)} around you`),
      url: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&q=${encodeURIComponent(`${p.adTerms[0]}${input.city ? ` ${input.city}` : region ? ` ${region}` : ''}`)}&search_type=keyword_unordered&media_type=all`,
      what: input.city || region
        ? bi(
          'Cùng thư viện quảng cáo nhưng tìm kèm tên khu vực — ra đúng những tiệm đang tranh khách với mình.',
          'The same ad library, searched with your area name — the shops actually competing for your customers.')
        : bi(
          'Thư viện quảng cáo toàn quốc. Điền thành phố cho tiệm để lọc sát khu vực hơn.',
          'The nationwide ad library. Fill in your city in settings to narrow it down to your area.'),
      how: bi(
        'Mỗi tháng xem một lần. Nếu quanh đây ai cũng chào cùng một kiểu giảm giá, thì cách thắng là làm khác đi chứ không phải giảm sâu hơn.',
        'Look once a month. If everyone around you is offering the same discount, the way to win is to be different, not to cut deeper.'),
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
 *
 * This one stays Vietnamese in both directions: it is prompt text, not screen
 * text, and it interpolates none of the bilingual fields above — so there is no
 * `Bi` object that could reach a template literal and print as [object Object].
 */
export function trendLinksToPrompt(): string {
  return [
    'NGUỒN XU HƯỚNG: tiệm đã có sẵn link tới TikTok Creative Center, Google Trends,',
    'Meta Ad Library và Pinterest Trends ngay trên màn hình.',
    'TUYỆT ĐỐI KHÔNG tự bịa link, tên clip, tên bài nhạc hay số lượt xem.',
    'KHÔNG được khẳng định một hashtag/mẫu/màu nào "đang trending" nếu dữ liệu bên trên không nói vậy.',
  ].join('\n');
}
