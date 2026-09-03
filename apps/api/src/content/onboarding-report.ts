/**
 * The first thing a new salon is told about itself.
 *
 * WHY THIS FILE EXISTS
 *
 * The platform could already build a complete plan for a shop it had never
 * looked at: sixty-seven roadmap tasks, a keyword map, a content calendar. What
 * it could not do was say how much of that plan rested on anything real. So a
 * salon that had connected nothing got a full plan and a green line reading
 * "local SEO is in good shape" — a verdict produced entirely by the absence of
 * data. The plan looked identical whether we knew everything about the shop or
 * nothing at all, and that is the failure this file is built to prevent.
 *
 * THE ONE RULE
 *
 * Every statement here is filed under `known` or under `unknowns`, and nothing
 * sits in between. A fact goes in `known` only with the source that produced
 * it. Everything else goes in `unknowns` with what it would take to see it.
 * There is no third pile for "probably" — that pile is where a report starts
 * lying to the person who trusts it.
 *
 * `confidence` exists so the reader knows, before reading anything else, how
 * much of this is measurement and how much is a catalog. A thin report is not
 * a failure of the system; a thin report that reads like a thorough one is.
 */

import { bi, type Txt } from './i18n';
import type { Tier } from './seo-roadmap';

/** How much of this report rests on something we actually looked at. */
export type Confidence = 'thin' | 'partial' | 'solid';

export interface KnownFact {
  label: Txt;
  /** The fact itself, in the shop's own words or numbers. */
  value: string;
  /** Where it came from. A fact with no provenance is an opinion. */
  source: Txt;
}

export interface UnknownFact {
  label: Txt;
  /** What we cannot say because of it. */
  cost: Txt;
  /** The single action that would make it knowable. */
  unlock: Txt;
}

export interface PlannedWeek {
  week: number;
  focus: Txt;
  tasks: { id: string; title: Txt; minutes: number; track: string }[];
  minutes: number;
}

export interface OnboardingReport {
  shopName: string;
  trade: Txt;
  where: Txt;
  confidence: Confidence;
  confidenceNote: Txt;
  known: KnownFact[];
  unknowns: UnknownFact[];
  /** The starting score, stated as coverage rather than as a grade. */
  start: { measured: number; unknown: number; failing: number; verdict: Txt };
  keywords: { primary: string[]; pages: number };
  firstMonth: PlannedWeek[];
  /** What can honestly be promised at this competition tier. */
  promise: Txt;
  /** What this report is not. Read before quoting any of it to a client. */
  caveat: Txt;
}

export interface OnboardingInput {
  shopName: string;
  tradeLabel: Txt;
  region: { label: string; city: string | null; regionKnown: boolean };
  identity: {
    declared: boolean;
    filled: number;
    profile: { whatWeDo?: string; whoWeServe?: string; languages?: string; serviceArea?: string; edge?: string };
  };
  services: { name: string }[];
  website: string | null;
  facebookConnected: boolean;
  gbpConnected: boolean;
  /** When the automatic read of the website and page last ran, and what it read. */
  scan: { at: string | null; ok: boolean } | null;
  seo: { measured: number; unknown: number; failing: number };
  tier: Tier;
  /** Weeks to clear each track at this tier, from the roadmap. */
  weeksToGoal: { map: [number, number]; web: [number, number] };
  /** The one-off jobs still to do, already in roadmap order. */
  todo: { id: string; title: Txt; minutes: number; track: string }[];
  keywords: { primary: string[]; pages: number };
}

/** Minutes a shop can absorb in one week without the plan being fiction. */
const WEEK_BUDGET = 200;

const monthsOf = ([lo, hi]: [number, number]) => {
  const m = (w: number) => Math.round((w / 4.35) * 10) / 10;
  return [m(lo), m(hi)] as [number, number];
};

export function buildOnboardingReport(input: OnboardingInput): OnboardingReport {
  const known: KnownFact[] = [];
  const unknowns: UnknownFact[] = [];

  // ---- what we could actually see -----------------------------------------

  if (input.identity.profile.whatWeDo) {
    known.push({
      label: bi('Tiệm này làm gì', 'What this shop does'),
      value: input.identity.profile.whatWeDo,
      source: input.scan?.ok
        ? bi('đọc từ website và fanpage của tiệm', 'read from the shop\'s own website and page')
        : bi('do người của tiệm khai', 'stated by the shop'),
    });
  }
  if (input.identity.profile.whoWeServe) {
    known.push({
      label: bi('Phục vụ ai', 'Who it serves'),
      value: input.identity.profile.whoWeServe,
      source: bi('từ hồ sơ tiệm', 'from the shop profile'),
    });
  }
  if (input.identity.profile.edge) {
    known.push({
      label: bi('Điểm mạnh tiệm tự nói', 'The edge the shop claims'),
      value: input.identity.profile.edge,
      source: bi('từ hồ sơ tiệm', 'from the shop profile'),
    });
  }
  if (input.region.regionKnown) {
    known.push({
      label: bi('Khu vực', 'Where it trades'),
      value: input.region.label,
      source: bi('từ địa chỉ tiệm', 'from the shop address'),
    });
  }
  if (input.services.length) {
    known.push({
      label: bi('Dịch vụ đang bán', 'Services on sale'),
      value: `${input.services.length}: ${input.services.slice(0, 6).map((s) => s.name).join(', ')}${input.services.length > 6 ? '…' : ''}`,
      // The strongest fact in the report: not a claim about the business, but
      // the list it takes bookings against every day.
      source: bi('bảng dịch vụ trong hệ thống — số liệu thật', 'the service table in the system — hard data'),
    });
  }
  if (input.website) {
    known.push({
      label: bi('Website', 'Website'),
      value: input.website,
      source: bi('từ cài đặt tiệm', 'from the shop settings'),
    });
  }

  // ---- what we cannot see, and what it costs ------------------------------

  if (!input.gbpConnected) {
    unknowns.push({
      label: bi('Hồ sơ Google Business Profile chưa nối', 'The Google Business Profile is not connected'),
      cost: bi('Không đọc được đánh giá, không đọc được khách gõ từ khoá gì để tìm ra tiệm, và không chấm được 4 trong 5 mục SEO địa phương. Đây là chỗ thiếu tốn nhất.',
               'No reviews, no report of what people typed to find the shop, and four of the five local SEO checks cannot be graded at all. This is the most expensive gap on the list.'),
      unlock: bi('Chủ tiệm cấp quyền hồ sơ Google cho Lumio — khoảng 10 phút, làm một lần.',
                 'The owner grants Lumio access to the Google profile — about ten minutes, once.'),
    });
  }
  if (!input.region.regionKnown) {
    unknowns.push({
      label: bi('Chưa biết tiệm nằm ở đâu', 'We do not know where the shop is'),
      cost: bi('Mọi từ khoá địa phương thiếu tên thành phố, lịch sự kiện rơi về lịch toàn quốc, và không tính được dân cư quanh tiệm.',
               'Every local keyword is missing its city, the calendar falls back to nationwide dates, and the neighbourhood figures cannot be pulled.'),
      unlock: bi('Điền địa chỉ trong cài đặt tiệm.', 'Fill the address in the shop settings.'),
    });
  }
  if (!input.website) {
    unknowns.push({
      label: bi('Tiệm chưa có website trong hệ thống', 'No website on file'),
      cost: bi('Không tự đọc được tiệm làm gì, và cả nhánh SEO từ khoá không có chỗ để đứng — bài viết lên top phải nằm trên một trang nào đó.',
               'Nothing can be read automatically about the shop, and the whole keyword track has nowhere to stand: a page that ranks has to live somewhere.'),
      unlock: bi('Thêm địa chỉ website vào cài đặt tiệm, hoặc quyết định làm trang mới.',
                 'Add the website in the shop settings, or decide to build one.'),
    });
  }
  if (!input.facebookConnected) {
    unknowns.push({
      label: bi('Chưa nối fanpage Facebook', 'No Facebook page connected'),
      cost: bi('Không đọc được cách tiệm tự giới thiệu, và không đăng bài hộ được.',
               'We cannot read how the shop describes itself, and cannot post on its behalf.'),
      unlock: bi('Nối fanpage trong phần kết nối.', 'Connect the page in the connections screen.'),
    });
  }
  if (!input.services.length) {
    unknowns.push({
      label: bi('Chưa khai dịch vụ nào', 'No services entered'),
      cost: bi('Không đối chiếu được từ khoá khách tìm với dịch vụ tiệm bán, và bảng giá không có gì để dựa vào.',
               'Search terms cannot be matched against what the shop sells, and there is no price list to build on.'),
      unlock: bi('Nhập bảng dịch vụ — việc này tiệm phải làm để nhận đặt lịch nên sớm muộn cũng có.',
                 'Enter the service list — the shop needs it to take bookings anyway.'),
    });
  }
  // Named last on purpose: it is the only gap on this list that no amount of
  // connecting fixes. Time is the input.
  unknowns.push({
    label: bi('Chưa có lịch sử hoạt động', 'No operating history yet'),
    cost: bi('Chưa biết khách đến từ đâu, chưa biết mỗi khách mới đáng bao nhiêu, nên chưa đặt được trần chi phí quảng cáo.',
             'We do not yet know where customers come from or what a new one is worth, so no advertising ceiling can be set.'),
    unlock: bi('Không nối được — cần khoảng 10 lịch hẹn có nguồn và 5 khách mới. Tự đến theo thời gian.',
               'Nothing to connect — it needs roughly ten sourced bookings and five first visits. It arrives with time.'),
  });

  // ---- how much of this is real -------------------------------------------

  const solidGround = [
    input.identity.declared,
    input.region.regionKnown,
    input.services.length > 0,
    Boolean(input.website) || input.facebookConnected,
    input.gbpConnected,
  ].filter(Boolean).length;

  const confidence: Confidence = solidGround >= 4 ? 'solid' : solidGround >= 2 ? 'partial' : 'thin';
  const confidenceNote: Txt = confidence === 'solid'
    ? bi('Bản này dựa trên dữ liệu thật của tiệm. Đọc và dùng được.',
         'This rests on the shop\'s real data. It can be read and used as it stands.')
    : confidence === 'partial'
      ? bi(`Biết ${solidGround}/5 thứ cần biết. Phần kế hoạch là thật, phần đánh giá hiện trạng còn thiếu — đọc mục "chưa nhìn thấy được" trước khi hứa gì với khách.`,
           `${solidGround} of the five things worth knowing are known. The plan is real; the assessment of where the shop stands is not complete — read the "cannot see" list before promising anything.`)
      : bi('Gần như chưa biết gì về tiệm này. Lộ trình dưới đây là bộ khung chuẩn của ngành, KHÔNG phải bản phân tích riêng cho tiệm. Đừng gửi cho khách như một bản đánh giá.',
           'Almost nothing is known about this shop yet. What follows is the standard framework for the trade, NOT an analysis of this business. Do not send it to a client as an assessment.');

  // ---- the starting point, stated as coverage ------------------------------

  const total = input.seo.measured + input.seo.unknown;
  const verdict: Txt = input.seo.failing
    ? bi(`${input.seo.failing} mục đang hỏng trong ${input.seo.measured} mục đo được.`,
         `${input.seo.failing} of the ${input.seo.measured} checks that could be graded are failing.`)
    : input.seo.measured === 0
      ? bi(`Chưa chấm được mục nào trong ${total}. Chưa có điểm khởi đầu để so.`,
           `None of the ${total} checks could be graded. There is no starting score to compare against.`)
      : bi(`${input.seo.measured}/${total} mục đo được, không mục nào hỏng. Còn ${input.seo.unknown} mục chưa nhìn thấy.`,
           `${input.seo.measured} of ${total} checks graded, none failing. ${input.seo.unknown} still cannot be seen.`);

  // ---- the first month, in weeks somebody can actually work ---------------

  const firstMonth: PlannedWeek[] = [];
  const queue = [...input.todo];
  const FOCUS: Txt[] = [
    bi('Mở khoá dữ liệu — nối những thứ đang che mắt hệ thống', 'Unlock the data — connect what is blinding the system'),
    bi('Dọn hồ sơ bản đồ', 'Tidy the map profile'),
    bi('Chốt từ khoá và trang đích', 'Settle keywords and landing pages'),
    bi('Bắt đầu vòng lặp: đánh giá, bài đăng, đo', 'Start the loop: reviews, posts, measurement'),
  ];
  for (let w = 1; w <= 4; w += 1) {
    const tasks: PlannedWeek['tasks'] = [];
    let minutes = 0;
    // Fill to the budget, but never leave a week empty — a plan with a blank
    // week reads as "nothing to do", which is the one thing it never means.
    while (queue.length && (minutes < WEEK_BUDGET || tasks.length === 0)) {
      const t = queue.shift()!;
      tasks.push(t);
      minutes += t.minutes;
    }
    firstMonth.push({ week: w, focus: FOCUS[w - 1], tasks, minutes });
  }

  // ---- the promise -------------------------------------------------------

  const [mapLo, mapHi] = monthsOf(input.weeksToGoal.map);
  const [webLo, webHi] = monthsOf(input.weeksToGoal.web);
  const promise: Txt = bi(
    `Nhánh bản đồ: khoảng ${mapLo}–${mapHi} tháng để làm hết việc. Nhánh từ khoá và website: khoảng ${webLo}–${webHi} tháng. Hai con số này là thời gian LÀM XONG VIỆC, không phải lời hứa thứ hạng — thứ hạng còn phụ thuộc đối thủ và khoảng cách từ khách tới tiệm, và không ai điều khiển được khoảng cách.`,
    `Map track: roughly ${mapLo}-${mapHi} months of work. Keyword and website track: roughly ${webLo}-${webHi} months. Both numbers are how long the WORK takes, not a promise about position — position also depends on rivals and on how far the searcher is standing from the door, and nobody controls the distance.`);

  const caveat: Txt = bi(
    'Bản này không kiểm website (tốc độ, thẻ mô tả, cấu trúc, backlink) và không đọc được thứ hạng thật trên Google. Những thứ đó có thật, hệ thống không nhìn thấy, nên không chấm. Ai nói với khách rằng đã kiểm đủ là nói sai.',
    'This does not inspect the website itself — speed, meta tags, structure, backlinks — and cannot read real Google positions. Those are real factors this system cannot see, so it does not grade them. Telling a client the audit was complete would be false.');

  return {
    shopName: input.shopName,
    trade: input.tradeLabel,
    where: input.region.regionKnown
      ? bi(input.region.label, input.region.label)
      : bi('chưa rõ khu vực', 'location unknown'),
    confidence,
    confidenceNote,
    known,
    unknowns,
    start: { ...input.seo, verdict },
    keywords: input.keywords,
    firstMonth,
    promise,
    caveat,
  };
}
