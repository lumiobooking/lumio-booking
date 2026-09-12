import { bi, type Txt } from './i18n';

/**
 * One reading of a salon, from every source at once.
 *
 * WHAT WAS WRONG, AND IT WAS A HABIT RATHER THAN A BUG
 *
 * Each screen picked ONE number and gated itself on it. The ad budget asked
 * for the average ticket and refused to speak without it. The roadmap asked
 * for review count and post count and nothing else. The filming day asked the
 * booking book. Every one of them was defensible on its own, and together they
 * produced a product that says "we cannot tell you anything" to a business
 * about which a great deal is known.
 *
 * Worse, a single-source gate cannot tell apart two salons that need opposite
 * advice. Two hundred Google reviews and steady bookings, versus two hundred
 * Google reviews and no bookings at all, are the same salon to `pickStage` —
 * it reads reviews and posts, and both pass. They are not the same salon. The
 * second one is being FOUND and not BOOKED, which is a different problem with
 * a different fix, and the more urgent of the two.
 *
 * SO: READ EVERYTHING, ALWAYS ANSWER, AND SAY WHAT YOU COULD NOT SEE
 *
 * Every source is read. A source that has nothing to say is recorded as silent
 * rather than skipped, because "we have no website for this salon" is itself a
 * finding — it is not the absence of one. The assessment always comes back;
 * what varies is its confidence, and the confidence is stated rather than
 * implied by a screen that has gone quiet.
 *
 * Nothing here is a score out of ten. A number like that hides which source
 * moved it and cannot be argued with. What comes out is FINDINGS — each one a
 * sentence about this salon, carrying the evidence that produced it, ordered by
 * what to fix first.
 */

// ---- what we can look at ---------------------------------------------------

/** Every source, whether or not it had anything to say. */
export interface SalonSignals {
  /** Google Business Profile is connected and a location is chosen. */
  googleConnected?: boolean;
  googleReviews?: number | null;
  googleRating?: number | null;
  /** Photos on the Google profile. Null when we have not read the profile. */
  googlePhotos?: number | null;
  /** Opening hours filled in on Google. Null when unread. */
  googleHours?: boolean | null;
  /** A Facebook Page or Instagram account is connected. */
  fanpageConnected?: boolean;
  /** The salon has a website on file. */
  websiteUrl?: string | null;
  /** Content jobs published in the last 30 days. */
  postedLast30?: number | null;
  /** Priced services on the menu — the salon's own statement of what it sells. */
  menuSize?: number | null;
  /** Appointments in this system over the last 90 days. */
  bookings90?: number | null;
  /** Customers with any history here. */
  customers?: number | null;
  /** Days since this salon joined us. Separates "new to us" from "quiet". */
  daysWithUs?: number | null;
  /** True when the area's demographics are known (ZIP matched). */
  areaKnown?: boolean;
}

export type FindingKey =
  | 'no-google'
  | 'thin-google'
  | 'found-not-booked'
  | 'silent-online'
  | 'no-menu'
  | 'no-fanpage'
  | 'no-website'
  | 'too-early-to-judge'
  | 'healthy';

export type Severity = 'stop' | 'fix' | 'watch' | 'good';

export interface Finding {
  key: FindingKey;
  severity: Severity;
  title: Txt;
  /** The evidence, in the salon's own numbers. Never an adjective on its own. */
  because: Txt;
  /** The next physical action. Null only for 'healthy'. */
  doNext: Txt | null;
}

export interface Assessment {
  findings: Finding[];
  /** How much of the picture we actually saw, 0-1. */
  confidence: number;
  /** Which sources answered, and which were silent — always both. */
  read: { source: string; answered: boolean }[];
}

// ---- the thresholds, in one place so they can be argued with ---------------

/** Below this a stranger checking the shop finds nothing to trust. */
export const REVIEWS_THIN = 20;
/** Roughly two posts a week for a month. */
export const POSTS_THIN = 8;
/** Below this in 90 days, the booking system is not carrying real traffic. */
export const BOOKINGS_QUIET = 10;
/** A salon newer than this has not had time to show us anything. */
export const SETTLING_DAYS = 21;

const n = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const known = (v: unknown): boolean => v !== null && v !== undefined;

/**
 * The whole picture, in the order somebody should act on it.
 *
 * Ordering is not severity alphabetised — it is dependency. A salon with no
 * Google profile cannot be helped by posting more, because the posts point at
 * nothing; a salon being found and not booked is not helped by more reviews,
 * because the reviews are already working. Each finding sits where fixing it
 * unblocks the ones below.
 */
export function assessSalon(s: SalonSignals): Assessment {
  const findings: Finding[] = [];
  const reviews = n(s.googleReviews);
  const posts = n(s.postedLast30);
  const bookings = n(s.bookings90);
  const days = n(s.daysWithUs);

  const read: { source: string; answered: boolean }[] = [
    { source: 'google', answered: Boolean(s.googleConnected) && known(s.googleReviews) },
    { source: 'google-profile', answered: known(s.googlePhotos) || known(s.googleHours) },
    { source: 'fanpage', answered: known(s.fanpageConnected) },
    { source: 'website', answered: Boolean(s.websiteUrl) },
    { source: 'menu', answered: n(s.menuSize) > 0 },
    { source: 'bookings', answered: known(s.bookings90) },
    { source: 'area', answered: Boolean(s.areaKnown) },
  ];
  const confidence = read.filter((r) => r.answered).length / read.length;

  // 1. Invisible on the map. Everything else points at a place that cannot be
  //    found, so nothing below this is worth doing first.
  if (!s.googleConnected) {
    findings.push({
      key: 'no-google', severity: 'stop',
      title: bi('Tiệm chưa có hồ sơ Google Maps nối vào hệ thống',
        'No Google Business Profile connected'),
      because: bi(
        'Người tìm "nail salon gần đây" tìm trên Google Maps trước tiên. Chưa nối thì bên em không đọc được đánh giá, không trả lời được, và mọi đồng quảng cáo đều đổ về một chỗ không ai tra cứu được.',
        'People looking for a salon near them start on Google Maps. Without it we cannot read or answer reviews, and any ad spend points at a place nobody can look up.'),
      doNext: bi('Nối hồ sơ Google Maps của tiệm — việc đầu tiên, trước mọi thứ khác',
        'Connect the salon’s Google Business Profile — before anything else'),
    });
  } else if (reviews < REVIEWS_THIN) {
    findings.push({
      key: 'thin-google', severity: 'fix',
      title: bi(`Hồ sơ Google mới có ${reviews} đánh giá`, `Only ${reviews} Google reviews so far`),
      because: bi(
        `Khách lạ đọc đánh giá trước khi bấm gọi. Dưới ${REVIEWS_THIN} cái thì hồ sơ đọc như tiệm mới, dù tiệm mở lâu rồi. Vẫn chạy quảng cáo được — nhưng cho khách bấm vào thẳng tin nhắn hoặc link đặt lịch, đừng đổ về trang Google, và xin đánh giá song song.`,
        `Strangers read reviews before they call. Under ${REVIEWS_THIN} the profile reads as brand new even for a long-established shop. Still worth advertising — just land the click on Messenger or the booking link rather than the map, and grow the reviews alongside.`),
      doNext: bi(`Xin đánh giá từng khách làm xong — cần thêm ${Math.max(0, REVIEWS_THIN - reviews)} cái`,
        `Ask each finished customer — ${Math.max(0, REVIEWS_THIN - reviews)} to go`),
    });
  }

  // 2. THE CASE A SINGLE-SOURCE READING CANNOT SEE.
  //    Found and not booked: the profile is doing its job and nothing catches
  //    what it brings. More reviews will not help; a booking link will.
  if (s.googleConnected && reviews >= REVIEWS_THIN && known(s.bookings90)
      && bookings < BOOKINGS_QUIET && days >= SETTLING_DAYS) {
    findings.push({
      key: 'found-not-booked', severity: 'stop',
      title: bi('Khách tìm thấy tiệm, nhưng không đặt được lịch qua hệ thống',
        'People find the salon and nothing captures them'),
      because: bi(
        `Hồ sơ Google có ${reviews} đánh giá — người ta đang tìm ra tiệm. Nhưng 90 ngày qua chỉ có ${bookings} lịch hẹn vào hệ thống. Chỗ rò không nằm ở chỗ được tìm thấy, mà ở chặng từ lúc thấy tới lúc đặt.`,
        `${reviews} Google reviews means people are finding the shop. But only ${bookings} appointments came through in 90 days. The leak is not in being found — it is between being found and booking.`),
      doNext: bi('Gắn link đặt lịch lên Google Maps, fanpage và website — trước khi tiêu thêm đồng nào cho quảng cáo',
        'Put the booking link on Maps, the Page and the website — before any more ad spend'),
    });
  }

  // 3. Silent. Checked after the profile, because posting into a void is the
  //    second problem, never the first.
  if (s.googleConnected && known(s.postedLast30) && posts < POSTS_THIN) {
    findings.push({
      key: 'silent-online', severity: 'fix',
      title: bi(`Chỉ ${posts} bài trong 30 ngày qua`, `Only ${posts} posts in the last 30 days`),
      because: bi(
        'Khách xem trang trước khi tới. Một trang im lặng đọc như một tiệm đã đóng cửa.',
        'People check the page before they come. A silent page reads like a shop that closed.'),
      doNext: bi(`Đăng đều — mục tiêu ${POSTS_THIN} bài mỗi 30 ngày`, `Post steadily — ${POSTS_THIN} every 30 days`),
    });
  }

  // 4. The cheap, one-afternoon gaps.
  if (n(s.menuSize) === 0) {
    findings.push({
      key: 'no-menu', severity: 'fix',
      title: bi('Tiệm chưa nhập bảng giá dịch vụ', 'No priced service list yet'),
      because: bi(
        'Không có bảng giá thì bên em không tính được một lần khách tới đáng bao nhiêu — và không tính được ngân sách quảng cáo.',
        'Without prices we cannot say what a visit is worth, and cannot size an ad budget.'),
      doNext: bi('Nhập bảng giá vào hệ thống — một buổi là xong', 'Enter the price list — one afternoon’s work'),
    });
  }
  if (known(s.fanpageConnected) && !s.fanpageConnected) {
    findings.push({
      key: 'no-fanpage', severity: 'watch',
      title: bi('Chưa nối fanpage', 'No Page connected'),
      because: bi('Tin nhắn khách gửi vào fanpage không vào được hộp thư chung.',
        'Messages sent to the Page never reach the shared inbox.'),
      doNext: bi('Nối fanpage Facebook / Instagram', 'Connect the Facebook / Instagram Page'),
    });
  }
  if (!s.websiteUrl) {
    findings.push({
      key: 'no-website', severity: 'watch',
      title: bi('Tiệm chưa có website', 'No website on file'),
      because: bi('Website là nơi duy nhất tiệm tự quyết khách thấy gì — Google và Facebook đều không cho.',
        'A website is the one place the salon decides what a visitor sees; Google and Facebook do not.'),
      doNext: bi('Dựng một trang đơn giản có bảng giá và nút đặt lịch',
        'A simple page with prices and a booking button'),
    });
  }

  // 5. Too new to read as quiet. Said explicitly, so an empty book on day four
  //    is never mistaken for a failing salon.
  if (days > 0 && days < SETTLING_DAYS && bookings < BOOKINGS_QUIET) {
    findings.push({
      key: 'too-early-to-judge', severity: 'watch',
      title: bi(`Tiệm mới vào hệ thống ${days} ngày`, `${days} days with us so far`),
      because: bi(
        'Chưa đủ thời gian để đọc lượng khách qua hệ thống. Những con số về booking ở dưới là chưa kết luận được, không phải là xấu.',
        'Not long enough to read booking volume. The booking numbers below are inconclusive, not bad.'),
      doNext: null,
    });
  }

  if (!findings.some((f) => f.severity === 'stop' || f.severity === 'fix')) {
    findings.push({
      key: 'healthy', severity: 'good',
      title: bi('Nền móng của tiệm đang ổn', 'The foundations are in good shape'),
      because: bi(
        `${reviews} đánh giá Google, ${posts} bài trong 30 ngày, ${bookings} lịch hẹn trong 90 ngày.`,
        `${reviews} Google reviews, ${posts} posts in 30 days, ${bookings} appointments in 90 days.`),
      doNext: null,
    });
  }

  return { findings, confidence, read };
}

/**
 * WHERE THE PAID CLICK SHOULD LAND — NOT WHETHER TO BUY IT.
 *
 * THE MISTAKE THIS REPLACES.
 *
 * These three findings used to BLOCK the ad plan: the screen showed "not the
 * moment to put money into ads" and no budget at all. That was wrong twice
 * over, and an agency owner running fifty-five salons said so.
 *
 *   1. It is circular. Reviews come from customers, customers come from
 *      traffic, and advertising IS traffic. "Get to twenty reviews, then
 *      advertise" tells a shop to wait for the thing advertising produces. For
 *      a salon opening next month it is not merely unhelpful — there are no
 *      customers yet by definition, and being known is the entire job.
 *   2. It answered a question nobody asked. Ads also buy AWARENESS: people
 *      within a few miles learning the salon exists. A review count says
 *      nothing about whether that is worth doing.
 *
 * WHAT SURVIVES, BECAUSE IT IS STILL TRUE.
 *
 * A stranger who taps an ad and lands on a Google profile with four reviews
 * reads the profile, not the ad. That is a real cost — and it is an argument
 * about the DESTINATION, never about the budget. So each finding now picks
 * where the money points instead of refusing to spend it:
 *
 *   no-google        there is no profile to send anyone to → send the click to
 *                    Messenger or the booking link, where a person answers
 *   thin-google      the profile is thin → same: skip the map, land the click
 *                    somewhere the review count is not the first thing seen,
 *                    and thicken the profile in parallel rather than first
 *   found-not-booked people already arrive and nothing takes the booking →
 *                    point every click at the booking link; this is the one
 *                    where the fix pays for itself the same day
 *
 * The evidence behind "thin": BrightLocal's Local Consumer Review Survey finds
 * that most consumers expect a local business to carry 20-99 reviews before
 * they trust its star rating. That is a survey of shoppers, not a measurement
 * of these fifty-five salons, and it is quoted here as what it is — a reason to
 * choose a landing page, not a reason to hold a budget.
 */
export const ADS_AIM: FindingKey[] = ['no-google', 'thin-google', 'found-not-booked'];

/** The finding that should decide where this salon's ads point, if any. */
export function adsAim(a: Assessment): Finding | null {
  return a.findings.find((f) => ADS_AIM.includes(f.key)) ?? null;
}

/** The one thing to do next — the first finding that asks for an action. */
export function firstAction(a: Assessment): Finding | null {
  return a.findings.find((f) => f.doNext !== null) ?? null;
}
