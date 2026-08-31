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

export type CheckState = 'pass' | 'warn' | 'fail' | 'unknown';

export interface SeoCheck {
  key: string;
  title: string;
  state: CheckState;
  /** What was measured, with the number in it. */
  finding: string;
  /** The single next action. Empty when there is nothing to do. */
  action: string;
  /** Why this one matters more than the tidy-looking things. */
  why: string;
}

export interface SeoReport {
  checks: SeoCheck[];
  /** How many of the things that matter are failing. */
  failing: number;
  headline: string;
  /** Said out loud: what this report cannot see. */
  blindSpots: string[];
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
        key: 'review-count', title: 'Số lượng đánh giá Google', state: 'unknown' as const,
        finding: 'Chưa đồng bộ được đánh giá nào từ Google.',
        action: 'Kết nối hồ sơ Google Business để hệ thống đọc được đánh giá.',
        why: 'Không đọc được đánh giá thì không đo được thứ quan trọng nhất của SEO địa phương.',
      };
    }
    const state: CheckState = n >= 50 ? 'pass' : n >= 20 ? 'warn' : 'fail';
    return {
      key: 'review-count', title: 'Số lượng đánh giá Google', state,
      finding: `${n} đánh giá.`,
      action: state === 'pass' ? '' : `Xin thêm đánh giá cho tới khi vượt ${n < 20 ? 20 : 50}. Mỗi ngày xin một khách vui vẻ nhất là đủ.`,
      why: 'Số đánh giá là yếu tố nặng nhất quyết định tiệm có lọt vào ba kết quả bản đồ hay không — nặng hơn mọi thứ trên website.',
    };
  })());

  // ---- 2. are they still arriving? ----------------------------------------
  checks.push((() => {
    if (!reviews.length) {
      return {
        key: 'review-velocity', title: 'Đánh giá mới', state: 'unknown' as const,
        finding: 'Chưa có dữ liệu.', action: '', why: '',
      };
    }
    const newest = Math.max(...reviews.map((r) => r.createdAt));
    const sinceDays = Math.floor((now - newest) / DAY);
    const state: CheckState = sinceDays <= 30 ? 'pass' : sinceDays <= 60 ? 'warn' : 'fail';
    return {
      key: 'review-velocity', title: 'Nhịp đánh giá mới', state,
      finding: `${recent.length} đánh giá trong 90 ngày qua; cái gần nhất cách đây ${sinceDays} ngày.`,
      action: state === 'pass' ? '' : 'Đặt việc xin đánh giá vào lúc thanh toán, mỗi ngày một khách.',
      why: 'Một hồ sơ 200 đánh giá mà cả năm không có cái nào mới trông như đã đóng cửa — với thuật toán lẫn với người đang đọc.',
    };
  })());

  // ---- 3. replies ----------------------------------------------------------
  checks.push((() => {
    if (!reviews.length) {
      return { key: 'review-replies', title: 'Trả lời đánh giá', state: 'unknown' as const, finding: 'Chưa có dữ liệu.', action: '', why: '' };
    }
    const replied = reviews.filter((r) => r.repliedAt).length;
    const pct = Math.round((replied / reviews.length) * 100);
    const lowUnreplied = reviews.filter((r) => r.starRating <= 3 && !r.repliedAt).length;
    const state: CheckState = lowUnreplied > 0 ? 'fail' : pct >= 80 ? 'pass' : pct >= 40 ? 'warn' : 'fail';
    return {
      key: 'review-replies', title: 'Trả lời đánh giá', state,
      finding: lowUnreplied > 0
        ? `${pct}% đã trả lời, nhưng còn ${lowUnreplied} đánh giá thấp CHƯA trả lời.`
        : `${pct}% đánh giá đã được trả lời.`,
      action: lowUnreplied > 0
        ? `Trả lời ${lowUnreplied} đánh giá thấp trước tiên, hôm nay.`
        : state === 'pass' ? '' : 'Trả lời hết phần còn lại, kể cả những đánh giá 5 sao chỉ có sao không có chữ.',
      why: 'Người đọc đánh giá xấu quan tâm cách tiệm phản hồi hơn nội dung phàn nàn. Một lời phàn nàn không ai trả lời là lời cuối cùng về tiệm.',
    };
  })());

  // ---- 4. do the search terms match what the shop sells? -------------------
  checks.push((() => {
    const kws = input.keywords ?? [];
    const services = (input.services ?? []).map((s) => s.name.toLowerCase()).filter(Boolean);
    if (!kws.length) {
      return {
        key: 'keyword-match', title: 'Từ khoá khách dùng để tìm tiệm', state: 'unknown' as const,
        finding: 'Google chưa trả về từ khoá nào cho hồ sơ này.',
        action: 'Kết nối Google Business Profile để lấy báo cáo từ khoá.',
        why: 'Không biết khách gõ gì thì mọi việc tối ưu chỉ là phỏng đoán.',
      };
    }
    const joined = kws.map((k) => k.keyword.toLowerCase()).join(' | ');
    const missing = services.filter((s) => {
      const head = s.split(/[^a-zà-ỹ0-9]+/i)[0];
      return head.length > 3 && !joined.includes(head);
    });
    const state: CheckState = missing.length === 0 ? 'pass' : missing.length <= 2 ? 'warn' : 'fail';
    return {
      key: 'keyword-match', title: 'Dịch vụ tiệm bán vs từ khoá khách gõ', state,
      finding: missing.length
        ? `${missing.length} dịch vụ chưa xuất hiện trong từ khoá nào: ${missing.slice(0, 4).join(', ')}.`
        : `Mọi dịch vụ chính đều xuất hiện trong từ khoá khách gõ.`,
      action: missing.length
        ? `Thêm đúng tên các dịch vụ đó vào mô tả hồ sơ Google và đăng một bài Google Post cho mỗi cái.`
        : '',
      why: 'Dịch vụ có bán mà không ai tìm ra bằng tên của nó là doanh thu bị chặn ngay ở bước tìm kiếm.',
    };
  })());

  // ---- 5. is search delivering anything at all? ---------------------------
  checks.push((() => {
    const s = input.sources ?? {};
    const total = Object.values(s).reduce((a, b) => a + b, 0);
    const fromSearch = (s.google ?? 0) + (s.gbp ?? 0) + (s.organic ?? 0);
    if (total < 10) {
      return {
        key: 'search-share', title: 'Bao nhiêu khách đến từ tìm kiếm', state: 'unknown' as const,
        finding: `Mới có ${total} booking ghi nhận được nguồn — chưa đủ để đọc.`,
        action: '', why: 'Cần vài chục booking mới thấy được tỷ lệ thật.',
      };
    }
    const pct = Math.round((fromSearch / total) * 100);
    const state: CheckState = pct >= 30 ? 'pass' : pct >= 10 ? 'warn' : 'fail';
    return {
      key: 'search-share', title: 'Bao nhiêu khách đến từ tìm kiếm', state,
      finding: `${pct}% booking đến từ Google/bản đồ (${fromSearch}/${total}).`,
      action: state === 'pass' ? '' : 'Sửa ba mục trên trước khi nghĩ tới website hay backlink — chúng là thứ đang chặn dòng khách này.',
      why: 'Đây là thước đo cuối cùng của SEO địa phương: không phải thứ hạng, mà số người thật sự bước vào.',
    };
  })());

  const failing = checks.filter((c) => c.state === 'fail').length;
  const warning = checks.filter((c) => c.state === 'warn').length;
  const headline = failing
    ? `${failing} việc đang chặn tiệm xuất hiện trên bản đồ.`
    : warning
      ? `Không có lỗi nặng, còn ${warning} chỗ nên siết lại.`
      : 'Phần SEO địa phương đang ổn — tập trung vào nội dung và quảng cáo.';

  return {
    checks,
    failing,
    headline,
    blindSpots: [
      'Không kiểm được website: tốc độ tải, thẻ mô tả, cấu trúc trang, backlink. Những thứ đó có thật nhưng hệ thống này không nhìn thấy, nên không chấm.',
      'Không đọc được thứ hạng thực tế trên Google — chỉ đọc được số khách đến từ tìm kiếm, vốn là thứ đáng quan tâm hơn.',
    ],
  };
}
