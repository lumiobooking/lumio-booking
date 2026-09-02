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
import { bi, join, viOf, enOf, type Txt } from './i18n';

export type JobKind = 'film' | 'post' | 'story' | 'offer' | 'winback' | 'engage' | 'rest';

export interface Job {
  kind: JobKind;
  /** The instruction itself, short enough to read on a phone at 7am. */
  text: Txt;
  /** Why this job is on this day — the part that earns trust. */
  why: Txt;
  /** Suggested clock time, when the timing is the point. A bare clock time
   *  ('19:00') reads the same in both languages and stays a plain string. */
  when?: Txt;
}

export interface DayPlan {
  weekday: number;
  label: Txt;
  jobs: Job[];
}

export interface WeekPlan {
  /** Seven days, starting from today. */
  days: DayPlan[];
  /** What the whole week is aiming at. */
  focus: Txt;
  /** Where the day choices came from — real data, or an admitted default. */
  basis: Txt;
  /**
   * Last week in one honest sentence, and whether this week was lightened
   * because of it. Null on the first week, when there is nothing to report.
   */
  report: Txt | null;
  /** Which stage of the shop's own path this week belongs to. */
  stage: RoadmapStage | null;
  /** Weeks since this shop's plan began — 0 for a brand-new salon. */
  week: number;
  /** Every-day habits, separate from the dated work. */
  daily: Job[];
  /** Where today's raw material comes from — the part usually left vague. */
  sources: ContentSource[];
  /** The trade's own name, bilingual since the playbook it comes from is. */
  trade: Txt;
  dataThin: boolean;
}

/**
 * The weekday names on screen.
 *
 * `WEEKDAY_VI` stays the Vietnamese source of truth over in revenue-signals —
 * the prompts and the slot labels are built from it. The English side is paired
 * with it here, in the file that actually puts a weekday on a screen.
 */
const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayTxt = (wd: number): Txt => bi(WEEKDAY_VI[wd], WEEKDAY_EN[wd]);

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
  /** The archived outcome of the previous week, if one exists. */
  lastWeek?: { planned: number; done: number; posted: number } | null;
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
    text: bi(
      'Quay gộp 3 clip trong một buổi (mỗi clip 15-30 giây)',
      'Film all 3 clips in one session (15-30 seconds each)'),
    why: film.fromData
      ? bi(
        `${WEEKDAY_VI[film.weekday]} là ngày vắng nhất của tiệm — thợ rảnh tay và phòng sạch, lên hình đẹp hơn ngày đông`,
        `${WEEKDAY_EN[film.weekday]} is your quietest day — the staff have their hands free and the room is clean, so it shoots better than a busy day`)
      : bi(
        'Chưa đủ dữ liệu đặt lịch để biết ngày nào tiệm vắng, tạm lấy thứ 3 — sửa lại khi tiệm chạy được vài tuần',
        'Not enough booking data yet to tell which day is quiet, so this is Tuesday for now — change it once the shop has run a few weeks'),
    when: bi('giờ vắng nhất trong ngày', 'the quietest hour of the day'),
  });

  // -- three posts, spaced, each with a job to do ---------------------------
  // Three posts, each doing a different job — taken from the trade's playbook,
  // because a restaurant's three posts are not a salon's three posts. Three
  // posts of the same kind is one post repeated.
  // The angles ROTATE by week. Three clips of the same kind is one clip
  // repeated, and the same three every week is one week repeated — which is
  // what this plan was doing before: a shop with a steady book and no holiday
  // coming saw the identical seven days forever.
  // -- the feedback loop: last week decides how heavy this week is ----------
  //
  // A plan that ignores whether last week's plan happened is a wish list. If
  // the salon finished under half of what was planned, this week asks for TWO
  // posts instead of three — a rhythm kept at two beats a week is worth more
  // than one abandoned at three — and the report line says so out loud.
  const lw = input.lastWeek ?? null;
  const struggled = Boolean(lw && lw.planned >= 3 && lw.done / lw.planned < 0.5);
  const postCount = struggled ? 2 : 3;
  const report: Txt | null = lw
    ? (struggled
      ? bi(
        `Tuần trước làm được ${lw.done}/${lw.planned} việc, đăng ${lw.posted} bài — tuần này rút còn ${postCount} bài để giữ nhịp cho chắc.`,
        `Last week: ${lw.done}/${lw.planned} jobs done, ${lw.posted} posted — this week is trimmed to ${postCount} posts so the rhythm holds.`)
      : bi(
        `Tuần trước làm được ${lw.done}/${lw.planned} việc, đăng ${lw.posted} bài — giữ nhịp ${postCount} bài/tuần.`,
        `Last week: ${lw.done}/${lw.planned} jobs done, ${lw.posted} posted — keeping the ${postCount}-post rhythm.`))
    : null;

  // Post an hour or two before the block where customers decide: a weekday
  // whose biggest block is the AFTERNOON gets the lunch-scroll window instead
  // of the evening one. Absent data, the evening window stays — it is when
  // beauty content is actually consumed.
  const postWindowOf = (wd: number): string => {
    const dayLoads = loads.filter((l) => l.weekday === wd);
    if (!dayLoads.length) return '18:30-20:00';
    const top = dayLoads.reduce((a, b) => (b.fillIndex > a.fillIndex ? b : a));
    return top.block === 'afternoon' ? '11:30-13:00' : '18:30-20:00';
  };

  const postDays = [(film.weekday + 1) % 7, (film.weekday + 3) % 7, (film.weekday + 5) % 7].slice(0, postCount);
  rotate(book.postTypes, week, postCount).forEach((pt, i) => {
    const last = i === postCount - 1;
    add(postDays[i], {
      kind: 'post',
      // The playbook now carries both languages, so each side of this sentence
      // takes its own: the English screen gets an English post title inside an
      // English sentence, instead of a Vietnamese one wearing English around it.
      text: bi(
        `Đăng clip ${i + 1} — ${viOf(pt.label)}`,
        `Post clip ${i + 1} — ${enOf(pt.label)}`),
      why: last && busiest
        ? bi(
          `${viOf(pt.job)}. Đăng trước ${WEEKDAY_VI[busiest.weekday]} — khung đông nhất của tiệm — để bài chạy đúng lúc khách đang quyết định`,
          `${enOf(pt.job)}. Post it before ${WEEKDAY_EN[busiest.weekday]} — the shop's busiest block — so it is running while customers are deciding`)
        : pt.job,
      when: postWindowOf(postDays[i]),
    });
  });

  // -- the offer, aimed at a real gap ---------------------------------------
  if (advice && advice.kind === 'fill-slot' && quietest) {
    add(offerDay, {
      kind: 'offer',
      // The slot label ('Thứ 7 buổi sáng' / 'Sat morning') and the protected
      // blocks come from revenue-signals bilingual, so each side takes its own.
      text: bi(
        `Đăng ưu đãi ${advice.discountPct}% CHỈ cho ${viOf(quietest.label)}`,
        `Post a ${advice.discountPct}% offer for ${enOf(quietest.label)} ONLY`),
      why: bi(
        `${viOf(quietest.label)} là khung trống nhất của tiệm. Đăng trước 2 ngày để khách kịp sắp lịch — đăng đúng hôm đó thì đã muộn. Không giảm các khung khác: ${advice.protect.map(viOf).join(', ') || 'khung đang đông'}`,
        `${enOf(quietest.label)} is the emptiest block on your book. Post it 2 days ahead so customers can plan around it — posting on the day itself is too late. Leave the other blocks at full price: ${advice.protect.map(enOf).join(', ') || 'the busy ones'}`),
      when: '19:00',
    });
  } else if (advice && advice.kind === 'raise-price') {
    add(offerDay, {
      kind: 'post',
      text: bi(
        'Không chạy giảm giá tuần này — đăng bài nâng giá trị thay vì hạ giá',
        'No discount this week — post something that builds value instead of cutting the price'),
      why: advice.detail || bi(
        'Lịch đang gần kín. Giảm giá lúc này là cho không phần lãi của những ghế vốn đã bán được',
        'The book is nearly full. Discounting now gives away the profit on chairs you had already sold'),
      when: '19:00',
    });
  }

  // -- the customers who quietly stopped coming -----------------------------
  if (lapsed && lapsed.count >= 3) {
    add((film.weekday + 4) % 7, {
      kind: 'winback',
      text: bi(
        `Nhắn tay ${Math.min(lapsed.count, 10)} khách lâu chưa quay lại`,
        `Text ${Math.min(lapsed.count, 10)} customers who have not been back in a while, by hand`),
      why: lapsed.medianDaysAway
        ? bi(
          `Trung bình ${lapsed.medianDaysAway} ngày chưa quay lại. Đây là khách đã từng trả tiền — rẻ hơn nhiều so với tìm khách mới`,
          `They have been away ${lapsed.medianDaysAway} days on average. These people have paid you before — much cheaper than finding new ones`)
        : bi(
          'Khách cũ quay lại rẻ hơn khách mới rất nhiều',
          'Bringing a past customer back costs far less than finding a new one'),
      when: bi('buổi tối', 'in the evening'),
    });
  }

  // -- the work this stage of the path asks for ----------------------------
  // Placed the day after filming: the shoot is the heaviest job of the week and
  // stacking anything on top of it is how a plan gets abandoned.
  if (stage) {
    stage.jobs.forEach((j, i) => {
      // The roadmap stage is bilingual and so is Job now, so the stage's work
      // travels through in both languages — it used to be unwrapped to
      // Vietnamese here, which is how an English screen got Vietnamese jobs.
      add((film.weekday + 2 + i) % 7, { kind: j.kind, text: j.text, why: j.why, ...(j.when ? { when: j.when } : {}) });
    });
  }

  // -- whatever the neighbourhood is about to celebrate ---------------------
  const soon = events.filter((e) => e.daysAway >= 0 && e.daysAway <= 21).slice(0, 2);
  for (const e of soon) {
    // Preparation lands on the filming day: it is the only day with slack.
    add(film.weekday, {
      kind: 'film',
      text: bi(
        `Quay thêm 1 clip cho ${viOf(e.name)} (còn ${e.daysAway} ngày)`,
        `Film one more clip for ${enOf(e.name)} (${e.daysAway} days out)`),
      why: bi(
        `${viOf(e.note)}. Quay sớm để đăng trước 5-7 ngày — đăng đúng hôm lễ là muộn, khách đã đặt chỗ khác rồi`,
        `${enOf(e.note)}. Film it early so it can go out 5-7 days ahead — posting on the day itself is too late, customers have already booked somewhere else`),
    });
  }

  // -- assemble seven days from today ---------------------------------------
  const days: DayPlan[] = [];
  for (let i = 0; i < 7; i++) {
    const wd = (input.todayWeekday + i) % 7;
    const list = jobs.get(wd) ?? [];
    days.push({
      weekday: wd,
      label: weekdayTxt(wd),
      jobs: list.length ? list : [{
        kind: 'rest',
        text: bi(
          'Không có việc nội dung — chỉ giữ 3 thói quen hằng ngày',
          'No content work today — just keep the 3 daily habits'),
        why: bi(
          'Ngày trống là có chủ ý. Lịch nào cũng kín thì tuần sau bỏ hết',
          'The empty day is on purpose. Fill every day and the whole plan gets dropped by next week'),
      }],
    });
  }

  // The stage names the week's aim when there is one — that is the whole point
  // of having a path. The old fallbacks stay for the shop that has no stage.
  // Both sides of the stage's own words, joined — not the Vietnamese side of
  // each glued together, which is what the screen used to get in English.
  const focus: Txt = stage
    ? join([stage.title, stage.goal], ' — ')
    : advice?.kind === 'fill-slot' && quietest
    ? bi(
      `Lấp ${viOf(quietest.label)} — khung trống nhất của tiệm`,
      `Fill ${enOf(quietest.label)} — the emptiest block on your book`)
    : advice?.kind === 'win-back'
      ? bi(
        'Kéo khách cũ quay lại, chưa cần giảm giá',
        'Bring past customers back, no discount needed yet')
      : advice?.kind === 'raise-price'
        ? bi(
          'Giữ giá và nâng giá trị — lịch đang gần kín',
          'Hold your prices and build value — the book is nearly full')
        : soon.length
          ? bi(
            `Chuẩn bị cho ${viOf(soon[0].name)}`,
            `Get ready for ${enOf(soon[0].name)}`)
          : bi(
            'Giữ nhịp đăng đều, gom kho nội dung',
            'Keep the posting rhythm steady and build up a bank of clips');

  const basis: Txt = dataThin
    ? bi(
      'Chưa đủ lịch hẹn để đọc nhịp của tiệm — đây là nhịp mặc định, sẽ tự chỉnh lại sau vài tuần tiệm chạy',
      'Not enough appointments yet to read the shop rhythm — this is a default one, and it corrects itself after the shop has run a few weeks')
    : bi(
      `Ngày quay và ngày đăng chọn theo sổ đặt lịch thật của tiệm (${loads.length} khung giờ có dữ liệu)`,
      `The filming day and the posting days come from the shop's own book (${loads.length} time blocks with data)`);

  return { days, focus, basis, report, stage, week, daily: book.habits, sources: book.dailySources, trade: book.trade, dataThin };
}

/** The week as prompt text, so the day's ideas match the week's plan. */
export function weekPlanToPrompt(p: WeekPlan): string {
  // The prompt library is Vietnamese on purpose: unwrap every bilingual phrase
  // here, or a {vi,en} pair prints as [object Object] inside the prompt.
  const L = [`TRỌNG TÂM TUẦN NÀY: ${viOf(p.focus)}`, `(căn cứ: ${viOf(p.basis)})`];
  if (p.stage) {
    L.push(`GIAI ĐOẠN ${p.stage.step}/5 — ${viOf(p.stage.title)}. Xong khi: ${viOf(p.stage.exitWhen)}`);
    L.push(`Tuần thứ ${p.week + 1} của kế hoạch. Ý tưởng hôm nay phải phục vụ giai đoạn này, không lạc sang việc khác.`);
  }
  L.push('LỊCH TUẦN:');
  for (const d of p.days) {
    for (const j of d.jobs) {
      if (j.kind === 'rest') continue;
      L.push(`- ${viOf(d.label)}: ${viOf(j.text)}`);
    }
  }
  return L.join('\n');
}
