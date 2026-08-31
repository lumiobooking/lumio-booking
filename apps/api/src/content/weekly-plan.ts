/**
 * The week, laid out as work — not as advice.
 *
 * "Đăng đều đặn, bắt trend, tương tác với khách" is the kind of guidance that
 * costs nothing to write and cannot be acted on. A salon owner finishing a
 * ten-hour day needs to know which day to film, what to say on Thursday, and
 * which hour to press post. So every entry here is one concrete job, on one
 * named day, with the reason attached.
 *
 * Two things keep it from becoming a generic content calendar:
 *
 *   1. The days come from the salon's own book. The filming day is its own
 *      quietest day — staff have hands free and the room photographs clean.
 *      The offer post lands two days before its own emptiest block, because a
 *      Saturday-morning gap is filled on Thursday evening, not on Saturday.
 *   2. When the book is too thin to say any of that, it says so and falls back
 *      to a plain rhythm, rather than dressing a default up as analysis.
 *
 * The volume is deliberately modest — three posts and a few stories a week.
 * A schedule a busy salon abandons in week two is worth less than a small one
 * it actually keeps.
 */

import { WEEKDAY_VI, type SlotLoad, type OfferAdvice, type LapsedSignal } from './revenue-signals';
import type { DatedEvent } from './region-events';
import { playbookFor, type ContentSource } from './industry-playbook';
import { rotate, type RoadmapStage } from './roadmap';

export type JobKind = 'film' | 'post' | 'story' | 'offer' | 'winback' | 'engage' | 'rest';

export interface Job {
  kind: JobKind;
  /** The instruction itself, short enough to read on a phone at 7am. */
  text: string;
  /** Why this job is on this day — the part that earns trust. */
  why: string;
  /** Suggested clock time, when the timing is the point. */
  when?: string;
}

export interface DayPlan {
  weekday: number;
  label: string;
  jobs: Job[];
}

export interface WeekPlan {
  /** Seven days, starting from today. */
  days: DayPlan[];
  /** What the whole week is aiming at. */
  focus: string;
  /** Where the day choices came from — real data, or an admitted default. */
  basis: string;
  /** Which stage of the shop's own path this week belongs to. */
  stage: RoadmapStage | null;
  /** Weeks since this shop's plan began — 0 for a brand-new salon. */
  week: number;
  /** Every-day habits, separate from the dated work. */
  daily: Job[];
  /** Where today's raw material comes from — the part usually left vague. */
  sources: ContentSource[];
  trade: string;
  dataThin: boolean;
}

// ---- 1. Reading the salon's own rhythm -------------------------------------

/** Total fill across a weekday, so we can find the day with room to work. */
function byWeekday(loads: SlotLoad[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const l of loads) m.set(l.weekday, (m.get(l.weekday) ?? 0) + l.fillIndex);
  return m;
}

/**
 * The best day to film: quiet, but not closed.
 *
 * A day with no bookings at all is usually a day the salon is shut, and
 * scheduling a shoot into a locked building is the sort of confident nonsense
 * that makes owners stop reading. So closed days are skipped, and if the book
 * cannot tell us anything we say Tuesday and admit it is a default.
 */
export function filmDay(loads: SlotLoad[]): { weekday: number; fromData: boolean } {
  const totals = byWeekday(loads);
  if (!totals.size) return { weekday: 2, fromData: false };
  const open = Array.from(totals.entries()).filter(([, v]) => v > 0);
  if (!open.length) return { weekday: 2, fromData: false };
  open.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return { weekday: open[0][0], fromData: true };
}

/** The day to publish an offer aimed at a given slot: two days ahead. */
export function leadDay(targetWeekday: number): number {
  return (targetWeekday + 5) % 7;
}

// ---- 2. The week ------------------------------------------------------------

export function buildWeekPlan(input: {
  today: Date;
  /** 0-6 local weekday; pass it in because the salon's timezone decides. */
  todayWeekday: number;
  industry?: string | null;
  loads?: SlotLoad[];
  advice?: OfferAdvice | null;
  lapsed?: LapsedSignal | null;
  events?: DatedEvent[];
  /** Where the shop is on its path. Its jobs join this week's work. */
  stage?: RoadmapStage | null;
  /** Weeks since the plan began — rotates the filming angles, nothing else. */
  week?: number;
}): WeekPlan {
  const industry = (input.industry || 'SALON').toUpperCase();
  const book = playbookFor(industry);
  const loads = input.loads ?? [];
  const events = input.events ?? [];
  const advice = input.advice ?? null;
  const lapsed = input.lapsed ?? null;

  const stage = input.stage ?? null;
  const week = Math.max(0, Math.floor(input.week ?? 0));
  const film = filmDay(loads);
  const quietest = loads.length ? loads[0] : null; // slotLoads sorts quietest first
  const busiest = loads.length ? loads[loads.length - 1] : null;
  const offerDay = quietest ? leadDay(quietest.weekday) : (film.weekday + 2) % 7;
  const dataThin = !loads.length;

  const jobs = new Map<number, Job[]>();
  const add = (wd: number, j: Job) => {
    const list = jobs.get(wd) ?? [];
    list.push(j);
    jobs.set(wd, list);
  };

  // -- the filming block: one session, three clips, done for the week --------
  add(film.weekday, {
    kind: 'film',
    text: 'Quay gộp 3 clip trong một buổi (mỗi clip 15-30 giây)',
    why: film.fromData
      ? `${WEEKDAY_VI[film.weekday]} là ngày vắng nhất của tiệm — thợ rảnh tay và phòng sạch, lên hình đẹp hơn ngày đông`
      : 'Chưa đủ dữ liệu đặt lịch để biết ngày nào tiệm vắng, tạm lấy thứ 3 — sửa lại khi tiệm chạy được vài tuần',
    when: 'giờ vắng nhất trong ngày',
  });

  // -- three posts, spaced, each with a job to do ---------------------------
  // Three posts, each doing a different job — taken from the trade's playbook,
  // because a restaurant's three posts are not a salon's three posts. Three
  // posts of the same kind is one post repeated.
  // The angles ROTATE by week. Three clips of the same kind is one clip
  // repeated, and the same three every week is one week repeated — which is
  // what this plan was doing before: a shop with a steady book and no holiday
  // coming saw the identical seven days forever.
  const postDays = [(film.weekday + 1) % 7, (film.weekday + 3) % 7, (film.weekday + 5) % 7];
  rotate(book.postTypes, week, 3).forEach((pt, i) => {
    const last = i === 2;
    add(postDays[i], {
      kind: 'post',
      text: `Đăng clip ${i + 1} — ${pt.label}`,
      why: last && busiest
        ? `${pt.job}. Đăng trước ${WEEKDAY_VI[busiest.weekday]} — khung đông nhất của tiệm — để bài chạy đúng lúc khách đang quyết định`
        : pt.job,
      when: '18:30-20:00',
    });
  });

  // -- the offer, aimed at a real gap ---------------------------------------
  if (advice && advice.kind === 'fill-slot' && quietest) {
    add(offerDay, {
      kind: 'offer',
      text: `Đăng ưu đãi ${advice.discountPct}% CHỈ cho ${quietest.label}`,
      why: `${quietest.label} là khung trống nhất của tiệm. Đăng trước 2 ngày để khách kịp sắp lịch — đăng đúng hôm đó thì đã muộn. Không giảm các khung khác: ${advice.protect.join(', ') || 'khung đang đông'}`,
      when: '19:00',
    });
  } else if (advice && advice.kind === 'raise-price') {
    add(offerDay, {
      kind: 'post',
      text: 'Không chạy giảm giá tuần này — đăng bài nâng giá trị thay vì hạ giá',
      why: advice.detail || 'Lịch đang gần kín. Giảm giá lúc này là cho không phần lãi của những ghế vốn đã bán được',
      when: '19:00',
    });
  }

  // -- the customers who quietly stopped coming -----------------------------
  if (lapsed && lapsed.count >= 3) {
    add((film.weekday + 4) % 7, {
      kind: 'winback',
      text: `Nhắn tay ${Math.min(lapsed.count, 10)} khách lâu chưa quay lại`,
      why: lapsed.medianDaysAway
        ? `Trung bình ${lapsed.medianDaysAway} ngày chưa quay lại. Đây là khách đã từng trả tiền — rẻ hơn nhiều so với tìm khách mới`
        : 'Khách cũ quay lại rẻ hơn khách mới rất nhiều',
      when: 'buổi tối',
    });
  }

  // -- the work this stage of the path asks for ----------------------------
  // Placed the day after filming: the shoot is the heaviest job of the week and
  // stacking anything on top of it is how a plan gets abandoned.
  if (stage) {
    stage.jobs.forEach((j, i) => {
      add((film.weekday + 2 + i) % 7, { kind: j.kind, text: j.text, why: j.why, ...(j.when ? { when: j.when } : {}) });
    });
  }

  // -- whatever the neighbourhood is about to celebrate ---------------------
  const soon = events.filter((e) => e.daysAway >= 0 && e.daysAway <= 21).slice(0, 2);
  for (const e of soon) {
    // Preparation lands on the filming day: it is the only day with slack.
    add(film.weekday, {
      kind: 'film',
      text: `Quay thêm 1 clip cho ${e.name} (còn ${e.daysAway} ngày)`,
      why: `${e.note}. Quay sớm để đăng trước 5-7 ngày — đăng đúng hôm lễ là muộn, khách đã đặt chỗ khác rồi`,
    });
  }

  // -- assemble seven days from today ---------------------------------------
  const days: DayPlan[] = [];
  for (let i = 0; i < 7; i++) {
    const wd = (input.todayWeekday + i) % 7;
    const list = jobs.get(wd) ?? [];
    days.push({
      weekday: wd,
      label: WEEKDAY_VI[wd],
      jobs: list.length ? list : [{ kind: 'rest', text: 'Không có việc nội dung — chỉ giữ 3 thói quen hằng ngày', why: 'Ngày trống là có chủ ý. Lịch nào cũng kín thì tuần sau bỏ hết' }],
    });
  }

  // The stage names the week's aim when there is one — that is the whole point
  // of having a path. The old fallbacks stay for the shop that has no stage.
  const focus = stage
    ? `${stage.title} — ${stage.goal}`
    : advice?.kind === 'fill-slot' && quietest
    ? `Lấp ${quietest.label} — khung trống nhất của tiệm`
    : advice?.kind === 'win-back'
      ? 'Kéo khách cũ quay lại, chưa cần giảm giá'
      : advice?.kind === 'raise-price'
        ? 'Giữ giá và nâng giá trị — lịch đang gần kín'
        : soon.length
          ? `Chuẩn bị cho ${soon[0].name}`
          : 'Giữ nhịp đăng đều, gom kho nội dung';

  const basis = dataThin
    ? 'Chưa đủ lịch hẹn để đọc nhịp của tiệm — đây là nhịp mặc định, sẽ tự chỉnh lại sau vài tuần tiệm chạy'
    : `Ngày quay và ngày đăng chọn theo sổ đặt lịch thật của tiệm (${loads.length} khung giờ có dữ liệu)`;

  return { days, focus, basis, stage, week, daily: book.habits, sources: book.dailySources, trade: book.trade, dataThin };
}

/** The week as prompt text, so the day's ideas match the week's plan. */
export function weekPlanToPrompt(p: WeekPlan): string {
  const L = [`TRỌNG TÂM TUẦN NÀY: ${p.focus}`, `(căn cứ: ${p.basis})`];
  if (p.stage) {
    L.push(`GIAI ĐOẠN ${p.stage.step}/5 — ${p.stage.title}. Xong khi: ${p.stage.exitWhen}`);
    L.push(`Tuần thứ ${p.week + 1} của kế hoạch. Ý tưởng hôm nay phải phục vụ giai đoạn này, không lạc sang việc khác.`);
  }
  L.push('LỊCH TUẦN:');
  for (const d of p.days) {
    for (const j of d.jobs) {
      if (j.kind === 'rest') continue;
      L.push(`- ${d.label}: ${j.text}`);
    }
  }
  return L.join('\n');
}
