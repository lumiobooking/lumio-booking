/**
 * Local SEO, scored from this salon's own numbers.
 *
 * A generic SEO checklist is worth almost nothing to a nail salon: it will talk
 * about backlinks and meta descriptions while the thing that actually decides
 * whether the shop appears in the local map results sits untouched. For a
 * business people search for with "near me", the ranking is dominated by a
 * small number of things, and this platform can already measure most of them:
 *
 *   - how many Google reviews there are, and whether new ones are still
 *     arriving. A profile with 200 reviews and none this year looks abandoned
 *     to the ranking and to the person reading it;
 *   - whether reviews get replied to;
 *   - which search terms Google reports for the profile, and whether the
 *     services the shop actually sells appear among them;
 *   - whether the profile has anything to send a searcher to.
 *
 * Every check below is computed from data the platform holds. Nothing is
 * asserted about the shop's website HTML, page speed or backlinks — those are
 * real factors and this cannot see them, so it says so instead of guessing.
 *
 * The scoring is deliberately blunt: pass, warn, fail. A 73/100 invites an
 * argument about the 73; "no review in 41 days" invites someone to go and ask
 * a customer for one.
 */

import { bi, type Txt } from './i18n';

export type CheckState = 'pass' | 'warn' | 'fail' | 'unknown';

export interface SeoCheck {
  key: string;
  title: Txt;
  state: CheckState;
  /** What was measured, with the number in it. */
  finding: Txt;
  /** The single next action. Empty when there is nothing to do. */
  action: Txt;
  /** Why this one matters more than the tidy-looking things. */
  why: Txt;
}

export interface SeoReport {
  checks: SeoCheck[];
  /** How many of the things that matter are failing. */
  failing: number;
  /**
   * How many checks could not be graded at all, and how many could.
   *
   * These two numbers exist because of a real bug this file shipped with: a
   * brand-new salon has connected nothing, so every check returns 'unknown',
   * so `failing` is 0 and `warning` is 0 — and the verdict read "local SEO is
   * in good shape". Every new salon was told its SEO was fine, by a report
   * that had measured precisely nothing. Absence of evidence was being
   * rendered as evidence of health, in the first sentence they read.
   */
  unknown: number;
  measured: number;
  headline: Txt;
  /** Said out loud: what this report cannot see. */
  blindSpots: Txt[];
}

export interface SeoInput {
  reviews?: { starRating: number; createdAt: number; repliedAt?: number | null }[];
  /** Search terms Google reported for the profile this month. */
  keywords?: { keyword: string; count: number }[];
  /** The services the salon sells. */
  services?: { name: string }[];
  /** Bookings by source, to see whether search delivers at all. */
  sources?: Record<string, number>;
  city?: string | null;
  region?: string | null;
  now?: number;
}

const DAY = 86_400_000;

export function buildSeoReport(input: SeoInput): SeoReport {
  const now = input.now ?? Date.now();
  const checks: SeoCheck[] = [];
  const reviews = input.reviews ?? [];
  const recent = reviews.filter((r) => now - r.createdAt <= 90 * DAY);

  // ---- 1. review volume ----------------------------------------------------
  checks.push((() => {
    const n = reviews.length;
    if (!n) {
      return {
        key: 'review-count', title: bi('Số lượng đánh giá Google', 'Google review count'), state: 'unknown' as const,
        finding: bi('Chưa đồng bộ được đánh giá nào từ Google.', 'No reviews have come across from Google yet.'),
        action: bi(
          'Kết nối hồ sơ Google Business để hệ thống đọc được đánh giá.',
          'Connect the Google Business profile so the system can read your reviews.'),
        why: bi(
          'Không đọc được đánh giá thì không đo được thứ quan trọng nhất của SEO địa phương.',
          'With no reviews to read, the biggest factor in local SEO cannot be measured at all.'),
      };
    }
    const state: CheckState = n >= 50 ? 'pass' : n >= 20 ? 'warn' : 'fail';
    return {
      key: 'review-count', title: bi('Số lượng đánh giá Google', 'Google review count'), state,
      finding: bi(`${n} đánh giá.`, `${n} reviews.`),
      action: state === 'pass' ? '' : bi(
        `Xin thêm đánh giá cho tới khi vượt ${n < 20 ? 20 : 50}. Mỗi ngày xin một khách vui vẻ nhất là đủ.`,
        `Keep asking until you are past ${n < 20 ? 20 : 50}. One happy customer a day is enough.`),
      why: bi(
        'Số đánh giá là yếu tố nặng nhất quyết định tiệm có lọt vào ba kết quả bản đồ hay không — nặng hơn mọi thứ trên website.',
        'Review count carries more weight than anything else in whether you land among the three map results — more than anything on your website.'),
    };
  })());

  // ---- 2. are they still arriving? ----------------------------------------
  checks.push((() => {
    if (!reviews.length) {
      return {
        key: 'review-velocity', title: bi('Đánh giá mới', 'New reviews'), state: 'unknown' as const,
        finding: bi('Chưa có dữ liệu.', 'No data yet.'), action: '', why: '',
      };
    }
    const newest = Math.max(...reviews.map((r) => r.createdAt));
    const sinceDays = Math.floor((now - newest) / DAY);
    const state: CheckState = sinceDays <= 30 ? 'pass' : sinceDays <= 60 ? 'warn' : 'fail';
    return {
      key: 'review-velocity', title: bi('Nhịp đánh giá mới', 'How fast new reviews come in'), state,
      finding: bi(
        `${recent.length} đánh giá trong 90 ngày qua; cái gần nhất cách đây ${sinceDays} ngày.`,
        `${recent.length} reviews in the last 90 days; the newest one is ${sinceDays} days old.`),
      action: state === 'pass' ? '' : bi(
        'Đặt việc xin đánh giá vào lúc thanh toán, mỗi ngày một khách.',
        'Make asking for the review part of checkout, one customer a day.'),
      why: bi(
        'Một hồ sơ 200 đánh giá mà cả năm không có cái nào mới trông như đã đóng cửa — với thuật toán lẫn với người đang đọc.',
        'A profile with 200 reviews and not one new all year reads as closed for business — to the ranking and to the person looking at it.'),
    };
  })());

  // ---- 3. replies ----------------------------------------------------------
  checks.push((() => {
    if (!reviews.length) {
      return {
        key: 'review-replies', title: bi('Trả lời đánh giá', 'Replying to reviews'), state: 'unknown' as const,
        finding: bi('Chưa có dữ liệu.', 'No data yet.'), action: '', why: '',
      };
    }
    const replied = reviews.filter((r) => r.repliedAt).length;
    const pct = Math.round((replied / reviews.length) * 100);
    const lowUnreplied = reviews.filter((r) => r.starRating <= 3 && !r.repliedAt).length;
    const state: CheckState = lowUnreplied > 0 ? 'fail' : pct >= 80 ? 'pass' : pct >= 40 ? 'warn' : 'fail';
    return {
      key: 'review-replies', title: bi('Trả lời đánh giá', 'Replying to reviews'), state,
      finding: lowUnreplied > 0
        ? bi(
          `${pct}% đã trả lời, nhưng còn ${lowUnreplied} đánh giá thấp CHƯA trả lời.`,
          `${pct}% answered, but ${lowUnreplied} low-star reviews are STILL sitting there with no reply.`)
        : bi(`${pct}% đánh giá đã được trả lời.`, `${pct}% of reviews have been answered.`),
      action: lowUnreplied > 0
        ? bi(
          `Trả lời ${lowUnreplied} đánh giá thấp trước tiên, hôm nay.`,
          `Answer those ${lowUnreplied} low-star reviews first, today.`)
        : state === 'pass' ? '' : bi(
          'Trả lời hết phần còn lại, kể cả những đánh giá 5 sao chỉ có sao không có chữ.',
          'Answer the rest, including the 5-star ones that are just a rating with no words.'),
      why: bi(
        'Người đọc đánh giá xấu quan tâm cách tiệm phản hồi hơn nội dung phàn nàn. Một lời phàn nàn không ai trả lời là lời cuối cùng về tiệm.',
        'Someone reading a bad review cares more about how you answered it than about the complaint. A complaint nobody answered is the last word on your shop.'),
    };
  })());

  // ---- 4. do the search terms match what the shop sells? -------------------
  checks.push((() => {
    const kws = input.keywords ?? [];
    const services = (input.services ?? []).map((s) => s.name.toLowerCase()).filter(Boolean);
    if (!kws.length) {
      return {
        key: 'keyword-match', title: bi('Từ khoá khách dùng để tìm tiệm', 'The words people search to find you'),
        state: 'unknown' as const,
        finding: bi(
          'Google chưa trả về từ khoá nào cho hồ sơ này.',
          'Google has not reported any search terms for this profile.'),
        action: bi(
          'Kết nối Google Business Profile để lấy báo cáo từ khoá.',
          'Connect the Google Business Profile to pull the search-terms report.'),
        why: bi(
          'Không biết khách gõ gì thì mọi việc tối ưu chỉ là phỏng đoán.',
          'Not knowing what people type means every bit of tuning is guesswork.'),
      };
    }
    const joined = kws.map((k) => k.keyword.toLowerCase()).join(' | ');
    const missing = services.filter((s) => {
      const head = s.split(/[^a-zà-ỹ0-9]+/i)[0];
      return head.length > 3 && !joined.includes(head);
    });
    const state: CheckState = missing.length === 0 ? 'pass' : missing.length <= 2 ? 'warn' : 'fail';
    return {
      key: 'keyword-match', title: bi('Dịch vụ tiệm bán vs từ khoá khách gõ', 'What you sell vs. what people search for'), state,
      // The service names inside the sentence are the salon's own and stay as
      // typed; only the sentence around them has two languages.
      finding: missing.length
        ? bi(
          `${missing.length} dịch vụ chưa xuất hiện trong từ khoá nào: ${missing.slice(0, 4).join(', ')}.`,
          `${missing.length} services turn up in no search term at all: ${missing.slice(0, 4).join(', ')}.`)
        : bi(
          `Mọi dịch vụ chính đều xuất hiện trong từ khoá khách gõ.`,
          `Every main service turns up in the terms people are searching.`),
      action: missing.length
        ? bi(
          `Thêm đúng tên các dịch vụ đó vào mô tả hồ sơ Google và đăng một bài Google Post cho mỗi cái.`,
          `Put those exact service names in your Google profile description and publish one Google Post for each of them.`)
        : '',
      why: bi(
        'Dịch vụ có bán mà không ai tìm ra bằng tên của nó là doanh thu bị chặn ngay ở bước tìm kiếm.',
        'A service you sell that nobody can find by its own name is revenue stopped at the search box.'),
    };
  })());

  // ---- 5. is search delivering anything at all? ---------------------------
  checks.push((() => {
    const s = input.sources ?? {};
    const total = Object.values(s).reduce((a, b) => a + b, 0);
    const fromSearch = (s.google ?? 0) + (s.gbp ?? 0) + (s.organic ?? 0);
    if (total < 10) {
      return {
        key: 'search-share', title: bi('Bao nhiêu khách đến từ tìm kiếm', 'How many customers come from search'),
        state: 'unknown' as const,
        finding: bi(
          `Mới có ${total} booking ghi nhận được nguồn — chưa đủ để đọc.`,
          `Only ${total} bookings have a source on them — not enough to read anything into.`),
        action: '',
        why: bi(
          'Cần vài chục booking mới thấy được tỷ lệ thật.',
          'It takes a few dozen bookings before the real share shows up.'),
      };
    }
    const pct = Math.round((fromSearch / total) * 100);
    const state: CheckState = pct >= 30 ? 'pass' : pct >= 10 ? 'warn' : 'fail';
    return {
      key: 'search-share', title: bi('Bao nhiêu khách đến từ tìm kiếm', 'How many customers come from search'), state,
      finding: bi(
        `${pct}% booking đến từ Google/bản đồ (${fromSearch}/${total}).`,
        `${pct}% of bookings come from Google or the map (${fromSearch}/${total}).`),
      action: state === 'pass' ? '' : bi(
        'Sửa ba mục trên trước khi nghĩ tới website hay backlink — chúng là thứ đang chặn dòng khách này.',
        'Fix the three items above before you think about the website or backlinks — those are what is choking this off.'),
      why: bi(
        'Đây là thước đo cuối cùng của SEO địa phương: không phải thứ hạng, mà số người thật sự bước vào.',
        'This is the last word on local SEO: not where you rank, but how many people actually walk in.'),
    };
  })());

  const failing = checks.filter((c) => c.state === 'fail').length;
  const warning = checks.filter((c) => c.state === 'warn').length;
  const unknown = checks.filter((c) => c.state === 'unknown').length;
  const measured = checks.length - unknown;

  // Order matters, and "nothing measured" has to outrank "nothing wrong".
  // A real fault is still the loudest thing; but with no faults and no data,
  // the honest verdict is that there is no verdict yet.
  const headline: Txt = failing
    ? bi(
      `${failing} việc đang chặn tiệm xuất hiện trên bản đồ.`,
      `${failing} things are keeping you off the map.`)
    : measured === 0
      ? bi(
        'Chưa chấm được mục nào — hệ thống chưa nhìn thấy dữ liệu của tiệm. Nối Google Business Profile để bắt đầu đo.',
        'Nothing could be graded yet — this cannot see the shop\'s data. Connect the Google Business Profile to start measuring.')
      : warning
        ? bi(
          `Không có lỗi nặng, còn ${warning} chỗ nên siết lại.`,
          `Nothing badly broken, but ${warning} things are worth tightening up.`)
        : unknown
          ? bi(
            `${measured} mục đo được đang ổn, nhưng còn ${unknown} mục chưa đo được — chưa đủ cơ sở để kết luận SEO địa phương đang ổn.`,
            `The ${measured} checks that could be graded look fine, but ${unknown} could not be graded — not yet enough to call local SEO healthy.`)
          : bi(
            'Phần SEO địa phương đang ổn — tập trung vào nội dung và quảng cáo.',
            'Local SEO is in good shape — put the effort into content and ads instead.');

  return {
    checks,
    failing,
    unknown,
    measured,
    headline,
    blindSpots: [
      bi(
        'Không kiểm được website: tốc độ tải, thẻ mô tả, cấu trúc trang, backlink. Những thứ đó có thật nhưng hệ thống này không nhìn thấy, nên không chấm.',
        'This does not check the website itself: load speed, meta tags, page structure, backlinks. Those are real factors, this system cannot see them, so it does not grade them.'),
      bi(
        'Không đọc được thứ hạng thực tế trên Google — chỉ đọc được số khách đến từ tìm kiếm, vốn là thứ đáng quan tâm hơn.',
        'It cannot read where you actually sit on Google — only how many customers came from search, which is the thing worth watching anyway.'),
    ],
  };
}
