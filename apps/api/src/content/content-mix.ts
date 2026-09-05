import { bi, viOf, enOf, type Txt } from './i18n';
import type { Playbook } from './industry-playbook';
import type { Job, JobKind } from './weekly-plan';

/**
 * The half of the week that was missing.
 *
 * WHAT THE PLAN USED TO BE
 *
 * One filming session, three posts — all three of them clips — an offer, a
 * message to lapsed customers, and whatever the roadmap stage asked for. That
 * is a shooting schedule, not a marketing plan. A shop working it produced
 * video and nothing else: no photographs, no stories tied to anything actually
 * happening, no post on the Google profile that decides where it sits on the
 * map, and nothing at all that happens in the room the customers are standing
 * in. The `story` job kind was even declared and then never emitted by any code
 * path, which is a fair summary of the problem.
 *
 * WHAT IS HERE, AND WHY IT IS NOT WRITTEN OUT TEN TIMES
 *
 * Four things: a photo session, a job on the Google profile, a story tied to
 * the week's own work, and one long-game move every other week.
 *
 * None of them is copied per trade. The SUBJECTS a shop photographs are already
 * written down per trade — `dailySources` and `postTypes[].shots` in the
 * playbook — so the photo session is built from those rather than from a second
 * list that would drift away from the first within a month. The Google work and
 * the long game are genuinely the same for any local business with a shopfront;
 * where the trade shows through, it is filled in from `playbook.trade`.
 *
 * THE BUDGET IS PART OF THE DESIGN
 *
 * Adding four kinds of work to a week is how a plan becomes a wish list. So the
 * week ends at ten jobs and `trimToBudget` decides what falls off, cheapest
 * last. A plan nobody finishes teaches the shop that plans are optional, which
 * is more expensive than the posts it lost.
 */

/** The most a week may ask for. Chosen to be finishable, not to look thorough. */
export const WEEK_BUDGET = 10;

/**
 * What gets dropped first when a week runs long.
 *
 * Lower survives. The order is an argument: the shoot comes first because
 * everything else consumes what it produces; the offer outranks the long game
 * because it fills a chair this week; the story outranks nothing, because it is
 * the one job that also exists as a daily habit and so is never truly lost.
 */
export const PRIORITY: Record<string, number> = {
  film: 1, photo: 2, post: 3, offer: 4, gbp: 5, engage: 6, winback: 7, event: 8, story: 9, rest: 99,
};

export interface Budgeted extends Job {
  /** 0-6 weekday this job sits on. */
  day: number;
  /** Lower is kept. Defaults from PRIORITY when a job does not say. */
  keep?: number;
}

/**
 * Cut a long week down to something a shop finishes.
 *
 * Ties are broken by the order the jobs were added, so a week is trimmed the
 * same way twice and the plan does not reshuffle itself between two reads of
 * the same page.
 */
export function trimToBudget(jobs: Budgeted[], max = WEEK_BUDGET): Budgeted[] {
  const real = jobs.filter((j) => j.kind !== 'rest');
  if (real.length <= max) return real;
  return real
    .map((j, i) => ({ j, i, k: j.keep ?? PRIORITY[j.kind] ?? 50 }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.j);
}

// ---- the photo session -----------------------------------------------------

/** How many stills one session should come home with. */
export const PHOTO_COUNT = 6;

/**
 * A photo session, built from the trade's own list of what is worth shooting.
 *
 * Photographs are not cheaper video. They carry the jobs video is bad at: a
 * before-and-after read in one glance, a price list somebody can screenshot,
 * a room a stranger wants to sit in — and they are what fills a Google profile,
 * where a video does almost nothing.
 */
export function photoJob(book: Playbook, week: number): Budgeted & { day: number } {
  const pool = book.dailySources;
  const pick = [0, 1, 2].map((i) => pool[(week * 2 + i) % pool.length]).filter(Boolean);
  const viList = pick.map((s) => viOf(s.label)).join(' · ');
  const enList = pick.map((s) => enOf(s.label)).join(' · ');
  return {
    day: 0, // set by the caller
    kind: 'photo',
    text: bi(
      `Chụp ${PHOTO_COUNT} ảnh trong cùng buổi quay — ${viList}`,
      `Take ${PHOTO_COUNT} photos in the same session — ${enList}`),
    why: bi(
      'Ảnh làm được ba việc clip không làm nổi: trước/sau nhìn một phát là hiểu, bảng giá khách chụp màn hình được, và hồ sơ Google — nơi video gần như vô dụng. Chụp cùng buổi quay để khỏi dựng cảnh hai lần',
      'Stills do three jobs video cannot: a before-and-after understood at a glance, a price list somebody can screenshot, and the Google profile, where video does almost nothing. Shoot them in the same session so nothing has to be set up twice'),
    when: bi('ngay sau khi quay xong', 'right after the filming'),
  };
}

// ---- the Google profile ----------------------------------------------------

/**
 * One job a week on the thing that decides where the shop sits on the map.
 *
 * Rotating rather than repeating: "post on Google" every week for a year is a
 * line people stop reading in three weeks. Each of these is a different job on
 * the same profile.
 */
const MAP_JOBS: { kind: JobKind; text: Txt; why: Txt }[] = [
  {
    kind: 'gbp',
    text: bi('Đăng 1 bài lên hồ sơ Google của tiệm (ảnh + 2 câu + nút Đặt lịch)',
      'Post once to the shop’s Google profile (a photo, two lines, and the Book button)'),
    why: bi('Bài trên hồ sơ Google hiện ngay trong kết quả bản đồ — nơi người ta đang chọn tiệm, chứ không phải nơi người ta đang lướt cho vui',
      'A post on the Google profile shows inside the map result — where people are choosing a shop, not where they are scrolling for fun'),
  },
  {
    kind: 'photo',
    text: bi('Thêm 3 ảnh mới vào hồ sơ Google — 1 ảnh mặt tiền, 1 ảnh bên trong, 1 ảnh thành phẩm',
      'Add 3 new photos to the Google profile — the storefront, the room inside, and finished work'),
    why: bi('Hồ sơ có ảnh mới đều đặn được Google ưu tiên hơn hồ sơ đứng yên, và ảnh mặt tiền là thứ khách nhìn để biết có đúng chỗ không',
      'A profile with fresh photos outranks one that sits still, and the storefront shot is how a customer knows they are at the right door'),
  },
  {
    kind: 'engage',
    text: bi('Trả lời hết đánh giá Google chưa trả lời — kể cả đánh giá xấu',
      'Reply to every unanswered Google review, the bad ones included'),
    why: bi('Người đọc đánh giá xấu quan tâm cách tiệm trả lời hơn nội dung phàn nàn. Một câu trả lời điềm tĩnh cứu được nhiều khách hơn là xoá được đánh giá',
      'People reading a bad review care more about the reply than the complaint. One calm answer saves more customers than deleting it ever could'),
  },
  {
    kind: 'post',
    text: bi('Đăng lại 1 đánh giá 5 sao đẹp nhất tháng, kèm ảnh bộ đó',
      'Repost the best 5-star review of the month with a photo of that work'),
    why: bi('Lời khách nói mạnh hơn mọi câu tiệm tự viết — và đây là nội dung không tốn công sản xuất',
      'A customer’s words beat anything the shop writes about itself — and this one costs nothing to produce'),
  },
];

export function mapJob(week: number): { kind: JobKind; text: Txt; why: Txt } {
  return MAP_JOBS[week % MAP_JOBS.length];
}

// ---- the long game ---------------------------------------------------------

/**
 * One move every other week that is not a post.
 *
 * Every other week on purpose. These take a conversation, a date, or another
 * business saying yes, and a plan that asks for one every week is a plan whose
 * ninth line is always unfinished. They are also the only items here that
 * produce something a competitor cannot copy by watching the feed.
 */
const LONG_GAME: { text: (t: Txt) => Txt; why: Txt }[] = [
  {
    text: () => bi('Bắt tay 1 tiệm hàng xóm không cạnh tranh — đổi voucher cho khách của nhau',
      'Team up with one neighbouring shop you do not compete with — swap vouchers for each other’s customers'),
    why: bi('Tiệm tóc, spa, quán cà phê cùng dãy đã có sẵn đúng tệp khách của mình và không giành khách với mình. Đây là kênh khách mới rẻ nhất, và không ai mua đứt được nó',
      'The hair place, the spa, the coffee shop on the same block already have your customers and are not competing for them. Cheapest new-customer channel there is, and nobody can outbid you for it'),
  },
  {
    text: (t) => bi(`Mời 1 người có tiếng ở khu vực tới trải nghiệm, đổi lấy 1 bài đăng thật về ${viOf(t)}`,
      `Invite one locally-known person in, in exchange for one honest post about ${enOf(t)}`),
    why: bi('Người ở ngay khu đó có 5.000 người theo dõi đáng giá hơn người nổi tiếng có 500.000 người ở tỉnh khác. Chọn theo khoảng cách, không theo số',
      'Somebody from the neighbourhood with 5,000 followers is worth more than a star with 500,000 in another state. Pick by distance, not by the number'),
  },
  {
    text: () => bi('Mở 1 mini game trong tuần — khách chụp ảnh thành phẩm, gắn tên tiệm, rút 1 phần thưởng',
      'Run one giveaway this week — customers post a photo of their result, tag the shop, one prize drawn'),
    why: bi('Cái được không phải lượt thích mà là kho ảnh do khách tự chụp, và nó xuất hiện trên trang cá nhân của họ, nơi bạn bè họ đang xem',
      'What you get is not likes but a bank of photos customers took themselves, appearing on their own profiles where their friends are looking'),
  },
  {
    text: () => bi('Chọn 1 ngày trong tuần làm ngày tri ân khách quen — ưu tiên giờ đẹp cho khách cũ, báo trước 3 ngày',
      'Pick one day this week for regulars — give them the good hours, and tell them three days ahead'),
    why: bi('Khách quen là doanh thu chắc chắn nhất và là nhóm ít được nói lời cảm ơn nhất. Một ngày dành riêng rẻ hơn mọi chương trình tích điểm',
      'Regulars are the surest revenue and the least thanked. One day set aside for them costs less than any points scheme'),
  },
  {
    text: (t) => bi(`Ra mắt 1 thứ mới và làm cho nó thành sự kiện — màu mới, dịch vụ mới, hoặc combo mới của ${viOf(t)}`,
      `Launch one new thing and make an event of it — a new colour, a new service, or a new package for ${enOf(t)}`),
    why: bi('Ra mắt là cái cớ hợp lý duy nhất để nhắc lại tiệm với người đã biết tiệm mà chưa quay lại — và nó tự sinh ra nội dung cho cả tuần',
      'A launch is the one honest excuse to speak again to people who know the shop and have not come back — and it produces a week of content by itself'),
  },
  {
    text: () => bi('Quay 1 clip giới thiệu tiệm dài 60 giây để ghim đầu trang và gửi cho khách mới',
      'Film one 60-second introduction to the shop, to pin at the top and send to new customers'),
    why: bi('Bài ghim là thứ người lạ xem đầu tiên và là thứ duy nhất còn nguyên giá trị sau sáu tháng. Đáng làm kỹ một lần',
      'The pinned post is the first thing a stranger watches and the only one still worth having in six months. Worth doing properly once'),
  },
];

export function longGameJob(book: Playbook, week: number): { kind: JobKind; text: Txt; why: Txt } {
  const g = LONG_GAME[Math.floor(week / 2) % LONG_GAME.length];
  return { kind: 'event', text: g.text(book.trade), why: g.why };
}

/** Long-game work lands on alternate weeks. */
export function longGameWeek(week: number): boolean {
  return week % 2 === 0;
}

// ---- stories that are about something --------------------------------------

/**
 * Two stories a week, each attached to work that is really happening.
 *
 * The daily habit already says "post a story". This is different on purpose: a
 * story with a job — the shoot going on behind the scenes, a poll that decides
 * next week's post — is a story somebody can actually make, and the poll is the
 * cheapest customer research a shop will ever run.
 */
export function storyJobs(hasOffer: boolean): { kind: JobKind; text: Txt; why: Txt }[] {
  const out: { kind: JobKind; text: Txt; why: Txt }[] = [
    {
      kind: 'story',
      text: bi('Story hậu trường buổi quay — 3-4 khung, không cần dựng',
        'Behind-the-scenes stories from the shoot — 3 or 4 frames, nothing produced'),
      why: bi('Người xem tin hậu trường hơn thành phẩm, vì thành phẩm thì tiệm nào cũng đăng. Đây cũng là cách hâm nóng trước khi bài chính lên',
        'People trust the backstage more than the finished shot, because every shop posts the finished shot. It also warms the audience up before the real post lands'),
    },
    {
      kind: 'story',
      text: hasOffer
        ? bi('Story đếm ngược ưu đãi — đăng sáng ngày cuối, kèm ô nhắn tin',
          'Countdown story for the offer — the morning of the last day, with a message sticker')
        : bi('Story bình chọn: 2 mẫu, khách chọn mẫu nào tuần sau tiệm làm',
          'Poll story: two designs, and customers pick which one the shop does next week'),
      why: hasOffer
        ? bi('Ưu đãi không có hạn chót thì không ai vội. Ô nhắn tin biến người xem thành cuộc trò chuyện ngay trong story',
          'An offer with no deadline makes nobody hurry. The message sticker turns a viewer into a conversation without leaving the story')
        : bi('Bình chọn vừa là nội dung vừa là khảo sát: tuần sau tiệm biết chắc khách muốn xem gì, thay vì đoán',
          'A poll is content and market research at once: next week the shop knows what customers want to see instead of guessing'),
    },
  ];
  return out;
}

// ---- what the week needs, and what it is for -------------------------------

/**
 * The shopping list for the week, read off the week itself.
 *
 * Written because of a specific failure: a staff member covering eight salons
 * reads seven days of instructions, closes the tab, walks into the shop and
 * has to reconstruct from memory how many clips to shoot and what of. The plan
 * knew the answer the whole time — it is the sum of its own jobs — and never
 * said it in one place.
 *
 * Everything here is DERIVED. Nothing is a second copy of the week that can
 * disagree with the first one.
 */
export interface PrepLine { label: Txt; detail: Txt }

export function buildPrep(input: {
  /** Clips the week actually asks for, counted by the caller that knows. */
  clips: number;
  photos: boolean;
  posts: number;
  book: Playbook;
  week: number;
  /** Google reviews still needed to clear the current stage, if that is the stage. */
  reviewsNeeded?: number | null;
}): PrepLine[] {
  const out: PrepLine[] = [];

  if (input.clips > 0) {
    out.push({
      label: bi(`Quay ${input.clips} clip`, `Film ${input.clips} clips`),
      detail: bi('Mỗi clip 15-30 giây. Quay hết trong một buổi — dựng cảnh hai lần là lần thứ hai không xảy ra',
        'Each 15-30 seconds. Shoot them all in one session — setting up twice means the second time does not happen'),
    });
  }
  if (input.photos) {
    const src = input.book.dailySources;
    const pick = [0, 1, 2].map((i) => src[(input.week * 2 + i) % src.length]).filter(Boolean);
    out.push({
      label: bi(`Chụp ${PHOTO_COUNT} ảnh`, `Take ${PHOTO_COUNT} photos`),
      detail: bi(pick.map((s) => viOf(s.label)).join(' · '), pick.map((s) => enOf(s.label)).join(' · ')),
    });
  }
  if (input.posts > 0) {
    out.push({
      label: bi(`Viết ${input.posts} caption`, `Write ${input.posts} captions`),
      detail: bi('Bấm "Bài mới" ở tab Lịch đăng bài — phần liên hệ và hashtag đã có sẵn, chỉ cần viết nội dung',
        'Press “New post” on the Post schedule tab — the contact block and hashtags are already there, so only the words are left'),
    });
  }
  if (input.reviewsNeeded && input.reviewsNeeded > 0) {
    const weekly = Math.min(7, input.reviewsNeeded);
    out.push({
      label: bi(`Xin ${weekly} đánh giá Google`, `Ask for ${weekly} Google reviews`),
      detail: bi('Xin lúc thanh toán, khi khách vừa nhìn tay xong. Xin qua tin nhắn sau đó thì tỉ lệ rớt hẳn',
        'Ask at checkout, right after she has looked at her hands. Asking by message later converts far worse'),
    });
  }
  out.push({
    label: bi('Xin phép trước khi đăng mặt khách', 'Get permission before posting a face'),
    detail: bi('Một câu lúc đang làm là đủ. Đăng rồi mới hỏi là cách nhanh nhất mất một khách quen',
      'One sentence while you work is enough. Posting first and asking after is the quickest way to lose a regular'),
  });
  return out;
}

/**
 * What this week is supposed to move, in numbers next week can check.
 *
 * Kept deliberately few and deliberately countable. "Tăng nhận diện" is not a
 * target, it is a mood; a target is a number that is either reached or not, and
 * the archive already stores what actually happened so the comparison is real
 * rather than rhetorical.
 */
export interface WeekTarget { label: Txt; target: number; unit: Txt }

export function buildTargets(input: {
  jobs: { kind: JobKind }[];
  reviewsNeeded?: number | null;
  /** The empty block an offer is aimed at, when there is one. */
  quietSlot?: Txt | null;
}): WeekTarget[] {
  const out: WeekTarget[] = [];
  const posts = input.jobs.filter((j) => j.kind === 'post').length;
  if (posts) out.push({ label: bi('Bài đã đăng', 'Posts published'), target: posts, unit: bi('bài', 'posts') });
  const stories = input.jobs.filter((j) => j.kind === 'story').length;
  if (stories) out.push({ label: bi('Story đã đăng', 'Stories posted'), target: stories, unit: bi('story', 'stories') });
  if (input.reviewsNeeded && input.reviewsNeeded > 0) {
    out.push({ label: bi('Đánh giá Google mới', 'New Google reviews'), target: Math.min(7, input.reviewsNeeded), unit: bi('đánh giá', 'reviews') });
  }
  if (input.quietSlot) {
    out.push({
      label: bi(`Ghế lấp thêm ở ${viOf(input.quietSlot)}`, `Extra chairs filled in ${enOf(input.quietSlot)}`),
      target: 4,
      unit: bi('lượt', 'bookings'),
    });
  }
  return out;
}
