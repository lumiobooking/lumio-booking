/**
 * Where this shop is on its own path — and what has to be true to move on.
 *
 * WHAT WAS MISSING
 *
 * The week plan was a pure function of (quiet slots, lapsed count, events).
 * Nothing in it knew which week it was or what had happened in the last one, so
 * a shop with a steady book and no holiday coming got the SAME seven days,
 * forever: film Saturday, post clips 1-2-3, message the lapsed list, repeat.
 * That is a template, not a plan. A plan goes somewhere.
 *
 * HOW THE STAGE MOVES, AND HOW IT DOES NOT
 *
 * It does NOT move on the calendar. A shop that has done nothing for three
 * weeks must not be told to start buying ads because three weeks passed —
 * that is how an owner ends up paying for reach into a Google profile with two
 * photos on it. The stage moves when its EXIT CONDITION is met, every
 * condition is a number the shop can see, and the number is on screen with the
 * work.
 *
 * The order is the cheapest-first order a local business should actually spend
 * effort in:
 *
 *   1. Nền móng      — the profile a paid click would land on. Free to fix,
 *                      and everything after it is wasted without it.
 *   2. Khách cũ      — people who already paid once. Cheapest customers there
 *                      are, and they need no budget at all.
 *   3. Lấp khung trống — the empty hours the shop is already staffing.
 *   4. Khách mới     — paid reach. Last, because it is the only one that
 *                      costs money and the only one the others make cheaper.
 *   5. Giữ nhịp      — nothing urgent: protect what works, keep filming.
 *
 * WHAT ROTATES INSTEAD OF THE STAGE
 *
 * The filming angles. Those SHOULD differ week to week — three clips of the
 * same kind is one clip repeated — so they rotate on the week number, which is
 * the one thing that legitimately changes without anybody doing anything.
 */

export type StageKey = 'foundation' | 'reactivate' | 'fill-gap' | 'acquire' | 'keep';

export interface StageProgress {
  done: number;
  need: number;
  label: string;
}

export interface RoadmapStage {
  key: StageKey;
  /** 1-5, so the screen can draw the path. */
  step: number;
  title: string;
  /** One line: what this stage is for. */
  goal: string;
  /** Why this one comes before the others. */
  why: string;
  /** The measurable thing that ends this stage. */
  exitWhen: string;
  /** Countable progress toward it. Null when the exit is not a count. */
  progress: StageProgress | null;
  /** Extra jobs this stage puts into the week, on top of the filming rhythm. */
  jobs: { kind: 'engage' | 'winback' | 'offer' | 'post' | 'film'; text: string; why: string; when?: string }[];
}

export interface RoadmapSignals {
  /** Google reviews on file. A paid click lands on this. */
  reviewCount: number | null;
  /** Content jobs the salon marked done in the last 30 days. */
  postedLast30: number;
  /** Customers who have not been back in a while. */
  lapsedCount: number;
  /** Customers with any history at all. */
  customerCount: number;
  /** True when the book shows a genuinely empty block worth filling. */
  hasQuietSlot: boolean;
  /** True once the margin is known — without it no budget can be sized. */
  marginKnown: boolean;
  /** Bookings that carry a channel. Below this, ad spend cannot be read. */
  attributedBookings: number;
}

/** Enough reviews that a stranger checking the shop finds a real profile. */
export const REVIEWS_FLOOR = 20;
/** Roughly two posts a week for a month — the rhythm before anything else. */
export const POSTS_FLOOR = 8;
/** Below this the lapsed list is a handful of messages, not a campaign. */
export const LAPSED_FLOOR = 10;

export function pickStage(s: RoadmapSignals): RoadmapStage {
  const reviews = s.reviewCount ?? 0;

  // 1. The profile a paid click would land on.
  if (reviews < REVIEWS_FLOOR || s.postedLast30 < POSTS_FLOOR) {
    const needReviews = Math.max(0, REVIEWS_FLOOR - reviews);
    return {
      key: 'foundation', step: 1,
      title: 'Nền móng',
      goal: 'Làm cho hồ sơ tiệm đủ dày trước khi bỏ tiền kéo người tới xem nó.',
      why: 'Quảng cáo chỉ đưa người lạ tới hồ sơ của tiệm. Đổ tiền vào một hồ sơ mỏng là đổ qua lỗ thủng — và bước này miễn phí.',
      exitWhen: `${REVIEWS_FLOOR} đánh giá Google và ${POSTS_FLOOR} bài đã đăng trong 30 ngày.`,
      progress: needReviews > 0
        ? { done: reviews, need: REVIEWS_FLOOR, label: 'đánh giá Google' }
        : { done: s.postedLast30, need: POSTS_FLOOR, label: 'bài đã đăng trong 30 ngày' },
      jobs: [
        ...(needReviews > 0 ? [{
          kind: 'engage' as const,
          text: `Xin đánh giá Google — còn thiếu ${needReviews} cái nữa`,
          why: 'Mỗi ngày xin một khách vui vẻ nhất. Đây là thứ đưa tiệm lên trước đối thủ trên bản đồ nhanh hơn mọi thứ khác, và không tốn đồng nào',
          when: 'lúc thanh toán',
        }] : []),
        {
          kind: 'engage' as const,
          text: 'Kiểm tra hồ sơ Google: ảnh, giờ mở cửa, bảng giá, trả lời đánh giá cũ',
          why: 'Đây là trang người lạ nhìn thấy trước khi quyết định. Sửa một lần, dùng mãi',
          when: 'một lần trong tuần',
        },
      ],
    };
  }

  // 2. People who already paid once.
  if (s.lapsedCount >= LAPSED_FLOOR) {
    return {
      key: 'reactivate', step: 2,
      title: 'Kéo khách cũ quay lại',
      goal: `Nhắn hết ${s.lapsedCount} khách đã lâu không quay lại.`,
      why: 'Họ biết tiệm, biết đường, đã từng trả tiền. Đây là tệp rẻ nhất trên đời và nó không cần một đồng quảng cáo nào.',
      exitWhen: `Danh sách khách cũ xuống dưới ${LAPSED_FLOOR} người.`,
      progress: { done: Math.max(0, s.customerCount - s.lapsedCount), need: s.customerCount, label: 'khách còn đang đi đều' },
      jobs: [{
        kind: 'winback',
        text: `Nhắn tay ${Math.min(s.lapsedCount, 10)} khách cũ trong tuần này`,
        why: 'Nhắn tay, không giảm giá. Hỏi thăm và mời đặt lại đúng khung giờ họ vẫn hay đi — tỷ lệ trả lời cao hơn hẳn một tin nhắn hàng loạt',
        when: 'buổi tối',
      }],
    };
  }

  // 3. The hours already being staffed.
  if (s.hasQuietSlot) {
    return {
      key: 'fill-gap', step: 3,
      title: 'Lấp khung giờ trống',
      goal: 'Đẩy khách vào đúng những giờ tiệm đang mở mà không có ai.',
      why: 'Giờ đó tiệm đã trả tiền thuê và tiền thợ rồi. Một khách vào giờ trống gần như lãi trọn, còn một khách vào giờ đông chỉ là đổi chỗ.',
      exitWhen: 'Khung trống nhất không còn thấp hơn hẳn các khung khác.',
      progress: null,
      jobs: [{
        kind: 'offer',
        text: 'Chỉ ưu đãi cho khung trống — không giảm các khung đang đông',
        why: 'Giảm giá ở khung vốn đã đầy là cho không phần lãi của những ghế đã bán được',
        when: 'đăng trước 2 ngày',
      }],
    };
  }

  // 4. The only stage that costs money.
  if (s.marginKnown) {
    return {
      key: 'acquire', step: 4,
      title: 'Tìm khách mới',
      goal: 'Bắt đầu chạy quảng cáo nhỏ để đo giá mỗi khách mới của tiệm.',
      why: 'Ba bước trước đã xong nên tiền quảng cáo giờ mới rẻ: người lạ bấm vào sẽ thấy một hồ sơ dày, và tiệm đã biết mình trả bao nhiêu một khách là còn lãi.',
      exitWhen: 'Biết được chi phí thật cho mỗi booking, đo trên ít nhất 8 lượt.',
      progress: { done: Math.min(s.attributedBookings, 8), need: 8, label: 'booking đọc được nguồn' },
      jobs: [{
        kind: 'engage',
        text: 'Mở tab "Quảng cáo & SEO" và làm theo kế hoạch nền tảng số 1',
        why: 'Ngân sách, ngày bật/tắt và cách nhắm đã tính sẵn ở đó từ số liệu của chính tiệm',
        when: 'đầu tuần',
      }],
    };
  }

  // 5. Nothing urgent left.
  return {
    key: 'keep', step: 5,
    title: 'Giữ nhịp',
    goal: 'Giữ đều việc đăng bài và bảo vệ những gì đang chạy tốt.',
    why: 'Không có việc gấp nào đang mở. Nhịp đều là thứ giữ tiệm ở trước mắt khách khi họ cần.',
    exitWhen: 'Khi có khung trống mới, khách cũ nguội đi, hoặc sắp tới dịp lễ.',
    progress: null,
    jobs: [{
      kind: 'engage',
      text: 'Điền tỷ lệ ăn chia trong hồ sơ thợ để mở phần ngân sách quảng cáo',
      why: 'Đây là mảnh cuối còn thiếu để hệ thống tính được tiệm trả bao nhiêu một khách mới thì còn lãi',
      when: 'một lần',
    }],
  };
}

/**
 * Which week of the shop's plan this is.
 *
 * Counted from the first day the shop had a content plan at all, so week 1 is
 * week 1 for a shop that joined yesterday and week 30 for one that joined last
 * summer. Used ONLY to rotate the filming angles — never to advance the stage.
 */
export function weekIndex(startedAt: Date | null, now: Date): number {
  if (!startedAt) return 0;
  const days = Math.floor((now.getTime() - startedAt.getTime()) / 86_400_000);
  return Math.max(0, Math.floor(days / 7));
}

/**
 * Pick this week's three angles out of the trade's pool.
 *
 * Deterministic, not random: the same week shows the same plan however many
 * times it is opened, and next week shows a different one. With five angles
 * and three picked, a shop sees five different weeks before anything repeats.
 */
export function rotate<T>(pool: T[], week: number, take = 3): T[] {
  if (pool.length <= take) return pool.slice(0, take);
  const out: T[] = [];
  for (let i = 0; i < take; i += 1) out.push(pool[(week * take + i) % pool.length]);
  return out;
}
