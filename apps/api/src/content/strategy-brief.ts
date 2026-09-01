/**
 * The consultant's brief: one argument, in order, built only from real numbers.
 *
 * WHY THIS EXISTS
 *
 * The screen was showing correct modules and no analysis. A ceiling here, a
 * budget there, a list of days somewhere else — each defensible on its own, and
 * together not an argument. What a marketing consultant delivers is a CHAIN:
 * this many people live here, this many of them are yours to win, they behave
 * like this, they arrive through that door, therefore spend this much on those
 * days and stop on these. Break the chain anywhere and the recommendation at
 * the end is just a number someone asserted.
 *
 * So this assembles the chain, in that order, and every link carries the figure
 * it rests on and where the figure came from. A reader who disagrees can point
 * at the exact step.
 *
 * WHAT IT WILL NOT DO
 *
 * It will not complete the chain with estimates when a link is missing. A brief
 * that says "roughly 12,000 potential customers" without a census behind it
 * reads exactly like one that has a census behind it, and the owner cannot tell
 * them apart — which makes the invented version worse than silence. Missing
 * links are printed as missing, with what each one would unlock, because
 * "we cannot say yet, and here is how to find out" is a real consulting answer
 * and a fabricated market size is not.
 *
 * Every number in the output is passed in already computed. Nothing here
 * multiplies two guesses together and calls the product a finding.
 */

import { money0 } from './plain';
// Every line below is read on the plan screen, so each one carries both
// languages. The labels that arrive from the other modules are already
// bilingual and are kept that way: unwrapping them on arrival is what put
// Vietnamese day names and segment names inside an English brief.
import { bi, enOf, viOf, type Txt } from './i18n';

export type Confidence = 'measured' | 'assumed' | 'unknown';

export interface BriefStep {
  key: string;
  /** Where this sits in the argument, 1-6. */
  order: number;
  title: Txt;
  /** The finding, with its number in it. */
  finding: Txt;
  /** Where the number came from. Empty when there is no number. */
  basis: Txt;
  confidence: Confidence;
  /** What follows from it — the link to the next step. */
  soWhat: Txt;
}

export interface MissingLink {
  key: string;
  what: Txt;
  /** What the chain could say once it exists. */
  unlocks: Txt;
  /** How to get it, concretely. */
  how: Txt;
}

export interface StrategyBrief {
  headline: Txt;
  steps: BriefStep[];
  missing: MissingLink[];
  /** True when the chain reaches a spending recommendation. */
  complete: boolean;
  /** The honest statement of scope. */
  limits: Txt[];
}

export interface BriefInput {
  /** The business's own sentence when it has one, so it is passed through whole. */
  businessLabel: Txt;
  declaredWhoWeServe?: string | null;
  serviceArea?: string | null;
  regionLabel: string;
  regionKnown: boolean;

  /** Census, when it has been fetched. */
  areaPopulation?: number | null;
  areaMedianIncome?: number | null;
  areaZipCount?: number;
  censusYear?: number | null;

  /** The salon's own book. */
  customerCount: number;
  segments: { key: string; label: Txt; count: number; avgTicketCents: number; medianGapDays: number | null; favouriteTime: Txt | null }[];
  lapsedCount: number;
  audienceThin: boolean;

  /** Behaviour. */
  leadDays: number | null;
  leadSample: number;
  quietLabels: Txt[];
  busyLabels: Txt[];

  /** Where bookings arrive from. */
  sourceCounts: Record<string, number>;

  /** Money. */
  grossMarginPct: number | null;
  /** Where the margin came from — it changes what this step may claim. */
  marginSource?: 'entered' | 'staff' | 'assumed' | 'unknown';
  cpaCeilingCents: number | null;
  budgetTotalCents: number | null;
  budgetDays: number;
  bookingsToBreakEven: number | null;

  /** Days. */
  runDayLabels: Txt[];
  pauseDayLabels: Txt[];

  money: (cents: number) => string;
}

// The keys the booking table writes — see common/booking-channel.ts. The old
// map listed 'google', 'gbp' and 'organic', none of which are ever written, and
// omitted 'gmap', which is the biggest channel most salons have. A missing key
// printed the raw string, so the brief's channel step read "gmap: 60 booking".
const SOURCE_LABEL: Record<string, Txt> = {
  gmap: bi('Google Maps / Tìm kiếm', 'Google Maps / Search'),
  facebook: 'Facebook', instagram: 'Instagram', messenger: 'Messenger', zalo: 'Zalo',
  hotline: bi('gọi điện', 'phone calls'),
  website: bi('website tiệm', 'the shop website'),
  lumiolink: bi('link đặt lịch Lumio', 'the Lumio booking link'),
  walkin: bi('khách vãng lai', 'walk-ins'),
  staff: bi('nhân viên tạo tại tiệm', 'booked by staff in the shop'),
  online: bi('đặt online chưa rõ nguồn', 'booked online, source unknown'),
};

// An unknown key still prints as itself, in both languages, rather than
// disappearing from the ranking.
const sourceVi = (k: string): string => viOf(SOURCE_LABEL[k] ?? k);
const sourceEn = (k: string): string => enOf(SOURCE_LABEL[k] ?? k);

// The slot labels arrive bilingual, so each language is joined on its own side.
const viList = (xs: Txt[]): string => xs.map(viOf).join(', ');
const enList = (xs: Txt[]): string => xs.map(enOf).join(', ');

export function buildStrategyBrief(i: BriefInput): StrategyBrief {
  const steps: BriefStep[] = [];
  const missing: MissingLink[] = [];

  // ---- 1. the market ------------------------------------------------------
  if (i.areaPopulation && i.regionKnown) {
    const people = i.areaPopulation.toLocaleString('en-US');
    const zips = i.areaZipCount ?? 1;
    const income = i.areaMedianIncome ? i.areaMedianIncome.toLocaleString('en-US') : null;
    steps.push({
      key: 'market', order: 1, title: bi('Thị trường quanh tiệm', 'The market around the shop'),
      // Sentences carrying a figure are written out whole in each language:
      // the number sits in a different place in the English clause.
      finding: bi(
        `Khoảng ${people} người sống trong ${zips} mã ZIP quanh ${i.regionLabel}`
          + (income ? `, thu nhập hộ gia đình trung vị ${'$'}${income}/năm.` : '.'),
        `About ${people} people live in the ${zips} ZIP codes around ${i.regionLabel}`
          + (income ? `, on a median household income of ${'$'}${income} a year.` : '.'),
      ),
      basis: bi(
        `Cục Thống kê Mỹ, khảo sát ACS 5 năm${i.censusYear ? ` (${i.censusYear})` : ''}`,
        `US Census Bureau, 5-year ACS${i.censusYear ? ` (${i.censusYear})` : ''}`,
      ),
      confidence: 'measured',
      soWhat: i.areaMedianIncome && i.areaMedianIncome >= 90_000
        ? bi('Vùng này trả nổi giá cao hơn. Đừng cạnh tranh bằng giảm giá ở đây.',
             'This area can afford a higher price. Do not compete on discounts here.')
        : bi('Mức thu nhập này định hình cách chào giá. Ai trong số đó là khách của tiệm thì bước sau mới trả lời.',
             'That income level shapes how you price. Which of those people are yours is the next step’s job.'),
    });
  } else {
    missing.push({
      key: 'market',
      what: bi('Quy mô dân cư quanh tiệm', 'How many people live around the shop'),
      unlocks: bi(
        'Biết được thị trường có bao nhiêu người thì mới nói được ngân sách này đang với tới bao nhiêu phần trăm trong đó.',
        'Once you know how many people the market holds, you can say what share of it this budget actually reaches.'),
      // Addressed to the shop, in the shop's own screens. The old copy pointed
      // at Super Admin — a screen the shop cannot open — for a ZIP the shop had
      // already typed into its address.
      how: i.regionKnown
        ? bi('Hệ thống đang tự lấy số liệu theo mã ZIP của tiệm, chạy nền mỗi giờ. Muốn rộng hơn thì thêm ZIP lân cận trong cài đặt.',
             'The system pulls these figures for the shop’s own ZIP code, in the background every hour. For a wider area, add nearby ZIP codes in settings.')
        : bi('Thêm địa chỉ có mã ZIP ở Cài đặt tiệm → Thông tin công ty, hoặc bấm "Quét & học tự động" để lấy từ website/fanpage.',
             'Add an address with a ZIP code under Salon settings → Company info, or press "Scan & learn" to pull it from the website or Facebook page.'),
    });
  }

  // ---- 2. who is actually yours -------------------------------------------
  // Deliberately the salon's OWN customers, not a demographic slice. The people
  // in the book chose this business over the others within the same few miles,
  // which is a fact; "households aged 25-44" is a category, and the two get
  // confused constantly.
  if (!i.audienceThin && i.customerCount >= 20) {
    const biggest = [...i.segments].sort((a, b) => b.count - a.count)[0];
    const ticket = biggest ? money0(biggest.avgTicketCents, i.money) : null;
    steps.push({
      key: 'audience', order: 2, title: bi('Tệp khách thật của tiệm', 'Who the shop’s customers really are'),
      finding: bi(
        `${i.customerCount} khách có lịch sử. Nhóm đông nhất là "${biggest ? viOf(biggest.label) : '—'}" với ${biggest?.count ?? 0} người`
          + (ticket ? `, trung bình ${ticket} mỗi lần` : '')
          + (biggest?.favouriteTime ? `, hay đi ${viOf(biggest.favouriteTime)}` : '') + '.'
          // What the business wrote about its own customers is quoted as it was
          // written, in both renderings — it is the salon's sentence, not ours.
          + (i.declaredWhoWeServe ? ` Doanh nghiệp mô tả tệp mục tiêu: ${i.declaredWhoWeServe}.` : ''),
        `${i.customerCount} customers with a history. The biggest group is "${biggest ? enOf(biggest.label) : '—'}", ${biggest?.count ?? 0} people`
          + (ticket ? `, averaging ${ticket} a visit` : '')
          + (biggest?.favouriteTime ? `, usually in on ${enOf(biggest.favouriteTime)}` : '') + '.'
          + (i.declaredWhoWeServe ? ` The business describes its target customers as: ${i.declaredWhoWeServe}.` : ''),
      ),
      basis: bi('Sổ khách và lịch hẹn 12 tháng của chính tiệm',
                'The shop’s own customer book and 12 months of appointments'),
      confidence: 'measured',
      soWhat: i.lapsedCount >= 20
        ? bi(`${i.lapsedCount} người trong số đó đã lâu không quay lại. Đây là tệp rẻ nhất để nhắm quảng cáo, và nó tồn tại sẵn — không cần mua người lạ để có nó.`,
             `${i.lapsedCount} of them have not been back in a long time. That is the cheapest list to advertise to, and you already have it — no strangers to buy.`)
        : bi('Tệp này là nền để dựng nhóm nhắm quảng cáo, và cũng là nhóm cần loại trừ khỏi quảng cáo tìm khách mới.',
             'This list is what ad audiences are built from, and it is also the list to exclude from ads that go looking for new customers.'),
    });
  } else {
    missing.push({
      key: 'audience',
      what: bi('Tệp khách đủ lớn để đọc', 'Enough customers to read anything from'),
      unlocks: bi(
        'Trên 20 khách có lịch sử thì mới chia nhóm được, và mới biết nên nhắm quảng cáo vào ai.',
        'Past 20 customers with a history the book can be split into groups, and only then is there an answer to who the ads should go to.'),
      how: bi(
        `Hiện có ${i.customerCount} khách trong sổ. Cần thêm lịch hẹn được ghi nhận.`,
        `There are ${i.customerCount} customers in the book. More appointments need to be recorded.`),
    });
  }

  // ---- 3. how they behave -------------------------------------------------
  if (i.leadDays !== null) {
    const quiet = i.quietLabels.slice(0, 2);
    const busy = i.busyLabels.slice(0, 2);
    steps.push({
      key: 'behaviour', order: 3, title: bi('Hành vi đặt lịch', 'How people book'),
      finding: bi(
        `Khách đặt trước trung bình ${i.leadDays} ngày (đo trên ${i.leadSample} lịch hẹn).`
          + (quiet.length ? ` Khung trống nhất: ${viList(quiet)}.` : '')
          + (busy.length ? ` Khung đông nhất: ${viList(busy)}.` : ''),
        `Customers book ${i.leadDays} days ahead on average (measured on ${i.leadSample} appointments).`
          + (quiet.length ? ` Emptiest blocks: ${enList(quiet)}.` : '')
          + (busy.length ? ` Busiest blocks: ${enList(busy)}.` : ''),
      ),
      basis: bi('Khoảng cách giữa lúc đặt và lúc làm, trên lịch hẹn thật',
                'The gap between when a booking is made and when it happens, on real appointments'),
      confidence: 'measured',
      soWhat: bi(
        `Đây là con số quyết định NGÀY chạy quảng cáo: muốn lấp một khung trống thì phải xuất hiện trước nó ${i.leadDays} ngày, chứ không phải đúng hôm đó.`,
        `This is the number that sets WHICH DAYS the ads run: to fill an empty block you have to show up ${i.leadDays} days ahead of it, not on the day itself.`),
    });
  } else {
    missing.push({
      key: 'behaviour',
      what: bi('Khoảng cách đặt-đến-làm', 'The gap between booking and visit'),
      unlocks: bi('Không có nó thì không suy ra được ngày bật quảng cáo, chỉ còn đoán.',
                  'Without it there is no way to work out which day to switch the ads on — only guessing.'),
      how: bi(
        `Cần ít nhất 10 lịch hẹn ghi được cả giờ đặt lẫn giờ làm; hiện có ${i.leadSample}.`,
        `At least 10 appointments need both the booking time and the visit time recorded; there are ${i.leadSample}.`),
    });
  }

  // ---- 4. which door they come through ------------------------------------
  const total = Object.values(i.sourceCounts ?? {}).reduce((a, b) => a + b, 0);
  // 'online' is a booking that came through a web door carrying no utm and no
  // referrer — a real booking whose channel is genuinely unknown. It must not
  // rank as a channel, and the shares must be taken against the bookings we can
  // actually attribute: a percentage of the whole book, computed from a third
  // of it, is a smaller number wearing a bigger one's clothes.
  const ranked = Object.entries(i.sourceCounts ?? {})
    .filter(([k]) => k !== 'unknown' && k !== 'online')
    .sort((a, b) => b[1] - a[1]);
  const attributed = ranked.reduce((s, [, n]) => s + n, 0);
  if (attributed >= 10 && ranked.length) {
    const [topKey, topN] = ranked[0];
    const pct = Math.round((topN / attributed) * 100);
    const coveragePct = total ? Math.round((attributed / total) * 100) : 0;
    steps.push({
      key: 'channel', order: 4, title: bi('Khách đến từ đâu', 'Which door the customers come through'),
      finding: bi(
        `${pct}% booking đến từ ${sourceVi(topKey)} (${topN}/${attributed})`
          + (ranked[1] ? `, kế tiếp là ${sourceVi(ranked[1][0])} với ${ranked[1][1]}.` : '.'),
        `${pct}% of bookings come from ${sourceEn(topKey)} (${topN} of ${attributed})`
          + (ranked[1] ? `, next is ${sourceEn(ranked[1][0])} with ${ranked[1][1]}.` : '.'),
      ),
      basis: coveragePct >= 95
        ? bi('Nguồn được ghi trên từng booking', 'The source recorded on each booking')
        : bi(`Nguồn được ghi trên từng booking — đọc được ${attributed}/${total} booking (${coveragePct}%), phần còn lại không mang theo nguồn`,
             `The source recorded on each booking — readable on ${attributed} of ${total} bookings (${coveragePct}%); the rest arrived carrying no source`),
      confidence: 'measured',
      soWhat: bi('Kênh đang tự mang khách về miễn phí cũng là kênh mua khách rẻ nhất. Chạy kênh đó trước.',
                 'The channel already bringing customers in for free is also the cheapest one to buy from. Run that one first.'),
    });
  } else {
    missing.push({
      key: 'channel',
      what: bi('Nguồn của các booking', 'Where the bookings came from'),
      unlocks: bi(
        'Biết kênh nào đang tự mang khách về thì chọn được nơi tiêu tiền đầu tiên, thay vì rải đều.',
        'Knowing which channel already brings customers in tells you where to spend first, instead of spreading it thin.'),
      how: total >= 10
        ? bi(`Có ${total} booking nhưng chỉ ${attributed} ghi nhận được kênh. Gắn UTM vào mọi link đặt lịch chia sẻ ra ngoài, và chọn nguồn khi tạo lịch cho khách gọi điện hoặc vãng lai.`,
             `There are ${total} bookings but only ${attributed} carry a channel. Put a UTM on every booking link you share, and pick the source when you book a phone or walk-in customer in.`)
        : bi(`Mới có ${total} booking. Cần vài chục để đọc được tỷ lệ thật.`,
             `Only ${total} bookings so far. It takes a few dozen before the shares mean anything.`),
    });
  }

  // ---- 5. what a customer is worth ---------------------------------------
  if (i.cpaCeilingCents && i.grossMarginPct) {
    const ceiling = money0(i.cpaCeilingCents, i.money);
    steps.push({
      key: 'value', order: 5, title: bi('Một khách mới đáng chi bao nhiêu', 'What a new customer is worth spending'),
      finding: bi(
        `Tối đa ${ceiling} cho mỗi booking, tính từ hoá đơn trung bình và biên lãi ~${i.grossMarginPct}%.`
          + (i.marginSource === 'assumed' ? ' Biên lãi này là ƯỚC TÍNH theo mặt bằng ngành, chưa phải số của tiệm.' : ''),
        `At most ${ceiling} per booking, from the average ticket and a gross margin of about ${i.grossMarginPct}%.`
          + (i.marginSource === 'assumed' ? ' That margin is an ESTIMATE off industry norms, not this shop’s own figure.' : ''),
      ),
      basis: i.marginSource === 'staff'
        ? bi('Hoá đơn trung bình trong sổ × biên lãi suy từ tỷ lệ ăn chia trên hồ sơ thợ',
             'Average ticket in the book × a margin worked out from the commission rates on the staff records')
        : i.marginSource === 'assumed'
          ? bi('Hoá đơn trung bình trong sổ × biên lãi ƯỚC TÍNH theo ngành',
               'Average ticket in the book × an ESTIMATED industry margin')
          : bi('Hoá đơn trung bình trong sổ × biên lãi do tiệm khai',
               'Average ticket in the book × the margin the shop entered'),
      // An estimate must not be labelled the same as a measurement, even when
      // the arithmetic on top of it is identical.
      confidence: i.marginSource === 'assumed' ? 'assumed' : 'measured',
      soWhat: bi('Đây là ngưỡng DỪNG, không phải mục tiêu. Ngày thứ 3: tiền đã chi ÷ số booking. Vượt ngưỡng thì tắt ngay.',
                 'This is a STOP line, not a target. On day 3: money spent ÷ bookings. Over the line, switch it off.'),
    });
  } else {
    missing.push({
      key: 'value',
      what: bi('Biên lãi của tiệm', 'The shop’s gross margin'),
      unlocks: bi(
        'Không có nó thì không có ngưỡng dừng, và một chiến dịch không có ngưỡng dừng là một chiến dịch không biết mình lãi hay lỗ.',
        'Without it there is no stop line, and a campaign with no stop line is a campaign that cannot tell whether it is making money or losing it.'),
      how: bi('Điền tỷ lệ ăn chia trong hồ sơ từng thợ (Nhân sự → sửa thợ). Biên lãi gộp ≈ 100 trừ tỷ lệ đó.',
              'Fill in the commission rate on each technician’s record (Staff → edit technician). Gross margin ≈ 100 minus that rate.'),
    });
  }

  // ---- 6. the recommendation ---------------------------------------------
  const complete = Boolean(i.cpaCeilingCents && i.budgetTotalCents && i.runDayLabels.length);
  if (complete) {
    const budget = money0(i.budgetTotalCents as number, i.money);
    const breakEven = i.bookingsToBreakEven;
    steps.push({
      key: 'spend', order: 6, title: bi('Chi bao nhiêu, ngày nào', 'How much to spend, and on which days'),
      finding: bi(
        `${budget} trong ${i.budgetDays} ngày`
          + (breakEven ? `, cần ${breakEven} booking để hoà vốn.` : '.')
          + ` Bật: ${viList(i.runDayLabels)}.`
          + (i.pauseDayLabels.length ? ` Tắt: ${viList(i.pauseDayLabels)}.` : ''),
        `${budget} over ${i.budgetDays} days`
          + (breakEven ? `, and it takes ${breakEven} bookings to break even.` : '.')
          + ` On: ${enList(i.runDayLabels)}.`
          + (i.pauseDayLabels.length ? ` Off: ${enList(i.pauseDayLabels)}.` : ''),
      ),
      basis: bi('Ngưỡng chi mỗi khách × số ngày, và ngày suy từ khoảng cách đặt-đến-làm',
                'The per-booking ceiling × the number of days, with the days taken from the booking-to-visit gap'),
      confidence: 'measured',
      soWhat: bi('Chiến dịch đầu là một phép đo: thứ mua được là con số "mỗi booking tốn bao nhiêu" của chính tiệm. Có con số đó rồi mới nói tới việc tăng ngân sách.',
                 'The first campaign is a measurement: what it buys is this shop’s own "cost per booking" figure. Get that, then talk about raising the budget.'),
    });
  }

  // `complete` means the chain reaches a spending decision — which it can do
  // without a census, because the ceiling and the days come from the salon's
  // own book rather than from demographics. But saying "complete" while links
  // are missing would overstate it: the market context is what tells an owner
  // whether the plan is small or ambitious, and its absence deserves a sentence
  // rather than silence.
  const gapCount = missing.length;
  // The business label is the salon's own sentence when it has written one, so
  // it is carried through whole into whichever language is being rendered.
  const headline: Txt = complete
    ? gapCount
      ? bi(`Đủ căn cứ để quyết mức chi cho ${viOf(i.businessLabel)}, nhưng còn thiếu ${gapCount} mắt xích bối cảnh — đọc phần "còn thiếu" trước khi tăng ngân sách.`,
           `Enough to decide what to spend for ${enOf(i.businessLabel)}, but ${gapCount} context link${gapCount === 1 ? ' is' : 's are'} still missing — read the "missing" list before raising the budget.`)
      : bi(`Chuỗi phân tích đã đủ để ra quyết định chi tiền cho ${viOf(i.businessLabel)}.`,
           `The chain is complete enough to decide what to spend for ${enOf(i.businessLabel)}.`)
    : gapCount === 1
      ? bi(`Còn thiếu một mắt xích: ${viOf(missing[0].what).toLowerCase()}. Chưa nên chi tiền quảng cáo cho tới khi có nó.`,
           `One link is missing: ${enOf(missing[0].what).toLowerCase()}. Do not spend on ads until it is there.`)
      : bi(`Còn thiếu ${gapCount} mắt xích trong chuỗi phân tích. Chưa đủ căn cứ để đề xuất mức chi.`,
           `${gapCount} links in the chain are missing. Not enough to recommend a spend yet.`);

  const limits: Txt[] = [
    bi('Số liệu dân cư theo mã ZIP, không phải một vòng tròn 5 dặm — ranh giới ZIP đi theo tuyến bưu điện.',
       'The population figures follow ZIP codes, not a 5-mile circle — ZIP boundaries follow postal routes.'),
    bi('Hệ thống KHÔNG suy ra thành phần dân tộc, độ tuổi hay giới tính của khách hàng tiềm năng. Cục Thống kê nói một hộ kiếm được bao nhiêu, không nói họ là ai và muốn gì.',
       'The system does NOT infer the ethnicity, age or gender of prospective customers. The Census says what a household earns; it does not say who they are or what they want.'),
    bi('Không có dự báo số booking từ ngân sách: điều đó cần tỷ lệ click và tỷ lệ chốt của chính tiệm, mà chỉ chiến dịch thật mới đo ra.',
       'No forecast of bookings from a budget: that needs this shop’s own click and close rates, and only a real campaign measures those.'),
  ];

  return { headline, steps: steps.sort((a, b) => a.order - b.order), missing, complete, limits };
}
