/**
 * Where this week's trends actually come from.
 *
 * A hard rule for this file: it never invents a link to a specific video. A
 * fabricated TikTok URL is worse than no link at all — the salon clicks it,
 * lands on nothing, and stops trusting every other suggestion on the screen.
 *
 * So there are exactly two honest kinds of trend link in this product:
 *
 *   1. Deep links into real trend tools, pre-filtered to the salon's country,
 *      state and trade. Every base URL here was opened and checked, and the
 *      query parameters survive the vendor's own redirects. The salon sees
 *      today's real data because the tool computes it, not because we cached a
 *      guess.
 *   2. Links a human on the Lumio team actually watched and pasted in, which
 *      travel through TrendNote and expire on a date.
 *
 * Nothing else. If a model ever produces a URL, it does not belong on this
 * screen.
 */

export type Cadence = 'weekly' | 'monthly';

export interface TrendLink {
  key: string;
  title: string;
  url: string;
  /** What the salon will be looking at when the page opens. */
  what: string;
  /** The step that turns looking into a post — the part usually left out. */
  how: string;
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
}

const PROFILES: Record<string, TrendQueryProfile> = {
  SALON: {
    trade: 'ngành nail',
    terms: ['nail salon near me', 'nail designs', 'gel x nails', 'pedicure'],
    adTerms: ['nail salon'],
  },
  RESTAURANT: {
    trade: 'ngành ăn uống',
    terms: ['restaurants near me', 'food near me', 'happy hour'],
    adTerms: ['restaurant'],
  },
  REAL_ESTATE: {
    trade: 'ngành bất động sản',
    terms: ['homes for sale', 'houses for sale near me', 'open house'],
    adTerms: ['real estate agent'],
  },
  SERVICE: {
    trade: 'ngành dịch vụ',
    terms: ['near me open now'],
    adTerms: ['local service'],
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

function gtrends(term: string, geo: string, days: 7 | 30): string {
  const date = days === 7 ? 'now 7-d' : 'today 1-m';
  return `https://trends.google.com/trends/explore?date=${encodeURIComponent(date)}&geo=${encodeURIComponent(geo)}&q=${encodeURIComponent(term)}&hl=vi`;
}

/**
 * The week's and the month's sources for one salon.
 *
 * `region` may be null — the links still work, they just cover the whole
 * country, and the caller is expected to say so on screen rather than let the
 * salon think it is looking at its own neighbourhood.
 */
export function trendLinks(input: {
  industry?: string | null;
  market?: string | null;
  region?: string | null;
  city?: string | null;
}): { weekly: TrendLink[]; monthly: TrendLink[]; regionKnown: boolean } {
  const market = input.market === 'VN' ? 'VN' : input.market === 'CA' ? 'CA' : 'US';
  const region = input.region?.trim().toUpperCase() || null;
  const p = profileFor(input.industry);
  const geo = trendsGeo(market, region);
  const where = region ? `${region}` : market;
  const country = market;

  const weekly: TrendLink[] = [
    {
      key: 'tiktok-7',
      title: 'TikTok — hashtag & nhạc đang lên (7 ngày)',
      url: `https://ads.tiktok.com/creative/creativeCenter/trends?countryCode=${country}&period=7`,
      what: `Bảng xếp hạng hashtag, bài nhạc và creator đang tăng mạnh ở ${country} trong 7 ngày qua. Có bộ lọc ngành ngay trên trang — chọn Beauty & Personal Care.`,
      how: 'Lấy 1 bài nhạc trong top 10 và quay lại đúng nội dung tiệm vẫn làm. Nhạc đang lên kéo lượt xem, nội dung vẫn là của tiệm.',
      cadence: 'weekly',
      source: 'TikTok Creative Center',
    },
    {
      key: 'gtrends-7',
      title: `Google Trends — khách ${where} đang tìm gì (7 ngày)`,
      url: gtrends(p.terms[0], geo, 7),
      what: `Mức độ tìm kiếm "${p.terms[0]}" trong 7 ngày qua${region ? `, chỉ riêng ${region}` : ''}, kèm các truy vấn đang tăng đột biến bên dưới.`,
      how: 'Kéo xuống mục "Truy vấn liên quan → Đang tăng". Bất kỳ cụm nào tăng vọt là một tiêu đề bài đăng viết sẵn cho tuần này.',
      cadence: 'weekly',
      source: 'Google Trends',
    },
    {
      key: 'meta-ads',
      title: `Đối thủ ${p.trade} đang chạy quảng cáo gì`,
      url: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=${country}&q=${encodeURIComponent(p.adTerms[0])}&search_type=keyword_unordered&media_type=all`,
      what: 'Thư viện quảng cáo của Meta — mọi quảng cáo đang chạy, công khai, kèm ngày bắt đầu.',
      how: 'Quảng cáo nào chạy liên tục nhiều tuần là quảng cáo đang có lãi. Xem họ mời chào cái gì, rồi làm phiên bản của tiệm — đừng chép chữ.',
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
      cadence: 'monthly',
      source: 'TikTok Creative Center',
    },
    {
      key: 'gtrends-30',
      title: `Google Trends — nhu cầu tháng này tại ${where}`,
      url: gtrends(p.terms[1] ?? p.terms[0], geo, 30),
      what: `Đường nhu cầu 30 ngày cho "${p.terms[1] ?? p.terms[0]}"${region ? ` ở ${region}` : ''}.`,
      how: 'So đỉnh và đáy với sổ đặt lịch của tiệm. Nếu nhu cầu vùng đang lên mà tiệm không lên, vấn đề nằm ở chỗ tiệm chứ không phải ở thị trường.',
      cadence: 'monthly',
      source: 'Google Trends',
    },
    {
      key: 'pinterest',
      title: 'Pinterest Trends — mẫu khách sẽ mang tới tiệm',
      url: `https://trends.pinterest.com/?country=${country}`,
      what: 'Cái khách lưu lại trước khi đi làm móng. Pinterest đi trước tiệm khoảng vài tuần đến vài tháng.',
      how: 'Tìm từ khoá theo mùa đang lên, lưu 3 mẫu, in ra để ở quầy làm bảng chọn mẫu.',
      cadence: 'monthly',
      source: 'Pinterest Trends',
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
  ].join('\n');
}
