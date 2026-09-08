import { bi, type Txt } from './i18n';

/**
 * Where this salon actually stands among the shops a customer sees beside it.
 *
 * WHY A NUMBER HERE IS WORTH MORE THAN A PARAGRAPH
 *
 * "The area is competitive" is something every agency says and no owner can
 * act on. "The three shops above you on the map have 180, 240 and 310 reviews;
 * you have 34" is the same fact with a decision attached, and the decision is
 * arithmetic: at two reviews a week that is a year, at one a day it is three
 * months. The review count is also the single strongest local-search signal an
 * owner can move without spending anything, which makes the gap both the most
 * honest diagnosis and the cheapest prescription.
 *
 * WHAT IT REFUSES TO SAY
 *
 * Nothing here forecasts a click price. Ad auction cost depends on who is
 * bidding this week in this postcode, which no count of shops can tell you.
 * What crowding honestly implies is narrower and still useful: how far the
 * shop has to climb before a paid click lands somewhere convincing, because a
 * profile with 34 reviews converts worse than one with 300 no matter what the
 * click cost. So crowding is read as a statement about the LANDING, not about
 * the auction.
 */

export interface NearbyPlace {
  name: string;
  /** Google's star rating, 1-5. Null when the place has none. */
  rating: number | null;
  /** How many people left one. This is the number that matters. */
  reviews: number;
  /** True for the salon itself, when the scan found it. */
  isMine?: boolean;
}

export interface CompetitionPicture {
  /** Shops in the same trade the scan found nearby, excluding this one. */
  rivals: number;
  /** This salon's own count, when the scan matched it. */
  myReviews: number | null;
  myRating: number | null;
  /** The three best-reviewed rivals, in order. */
  top: NearbyPlace[];
  /** Reviews between this shop and the third-best rival. Null when unknown. */
  gapToTop3: number | null;
  medianRivalReviews: number | null;
  /** 'quiet' | 'busy' | 'crowded' — how many shops are competing at all. */
  density: 'quiet' | 'busy' | 'crowded';
  /** Weeks to close the gap at a stated pace, so the plan has a deadline. */
  weeksAtTwoADay: number | null;
  headline: Txt;
  soWhat: Txt;
}

const CROWDED = 12;
const BUSY = 5;

function median(ns: number[]): number | null {
  if (!ns.length) return null;
  const s = [...ns].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export function competitionPicture(places: NearbyPlace[]): CompetitionPicture | null {
  const all = (places ?? []).filter((p) => p && typeof p.reviews === 'number');
  if (!all.length) return null;
  const mine = all.find((p) => p.isMine) ?? null;
  const rivals = all.filter((p) => !p.isMine);
  const ranked = [...rivals].sort((a, b) => b.reviews - a.reviews);
  const top = ranked.slice(0, 3);
  const density = rivals.length >= CROWDED ? 'crowded' : rivals.length >= BUSY ? 'busy' : 'quiet';
  const med = median(rivals.map((p) => p.reviews));
  const third = top.length === 3 ? top[2].reviews : top[top.length - 1]?.reviews ?? null;
  const gap = mine && third !== null ? Math.max(0, third - mine.reviews) : null;
  // Two a day is the pace a busy salon can hold if it asks at the counter —
  // the habit the shop's own plan already carries. Stated as the assumption
  // it is, so a slower shop can halve it in their head.
  const weeks = gap !== null && gap > 0 ? Math.ceil(gap / 14) : gap === 0 ? 0 : null;

  const headline: Txt = mine && third !== null
    ? (gap && gap > 0
      ? bi(
        `${rivals.length} tiệm cùng ngành quanh đây. Top 3 có ${top.map((t) => t.reviews).join(', ')} đánh giá — tiệm mình ${mine.reviews}.`,
        `${rivals.length} shops in the same trade nearby. The top three have ${top.map((t) => t.reviews).join(', ')} reviews — you have ${mine.reviews}.`)
      : bi(
        `${rivals.length} tiệm cùng ngành quanh đây, và tiệm mình đang nằm trong nhóm dẫn đầu về đánh giá (${mine.reviews}).`,
        `${rivals.length} shops in the same trade nearby, and you are already among the leaders on reviews (${mine.reviews}).`))
    : bi(
      `${rivals.length} tiệm cùng ngành quanh đây, nhiều nhất là ${top[0]?.reviews ?? 0} đánh giá. Chưa tìm thấy hồ sơ của tiệm mình trong danh sách.`,
      `${rivals.length} shops in the same trade nearby, the busiest with ${top[0]?.reviews ?? 0} reviews. Your own profile was not found among them.`);

  const soWhat: Txt = gap && gap > 0 && weeks
    ? bi(
      `Cần thêm ${gap} đánh giá để đứng ngang top 3 — khoảng ${weeks} tuần nếu mỗi ngày xin được 2 khách. Đây là việc rẻ nhất và cũng là thứ quyết định người lạ có bấm vào tiệm hay không, kể cả khi họ tới từ quảng cáo trả tiền.`,
      `You need ${gap} more reviews to sit level with the top three — about ${weeks} weeks at two a day asked at the counter. It is the cheapest thing on the list and it decides whether a stranger clicks you at all, including a stranger you paid for.`)
    : mine
      ? bi(
        'Hồ sơ đã đủ dày để chịu được lượt click trả tiền — tiền quảng cáo lúc này đáng chi hơn hẳn so với một hồ sơ mỏng.',
        'The profile is thick enough to carry paid clicks — ad money spent now works far harder than it would against a thin one.')
      : bi(
        'Chưa xác định được hồ sơ Google của tiệm trong khu vực. Việc đầu tiên là dựng và xác minh hồ sơ, trước khi bỏ tiền chạy quảng cáo.',
        'The salon\'s own Google profile could not be identified nearby. Claiming and verifying it comes before any money goes into ads.');

  return {
    rivals: rivals.length,
    myReviews: mine?.reviews ?? null,
    myRating: mine?.rating ?? null,
    top,
    gapToTop3: gap,
    medianRivalReviews: med,
    density,
    weeksAtTwoADay: weeks,
    headline,
    soWhat,
  };
}
