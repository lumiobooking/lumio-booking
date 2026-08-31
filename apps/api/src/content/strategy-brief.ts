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

export type Confidence = 'measured' | 'assumed' | 'unknown';

export interface BriefStep {
  key: string;
  /** Where this sits in the argument, 1-6. */
  order: number;
  title: string;
  /** The finding, with its number in it. */
  finding: string;
  /** Where the number came from. Empty when there is no number. */
  basis: string;
  confidence: Confidence;
  /** What follows from it — the link to the next step. */
  soWhat: string;
}

export interface MissingLink {
  key: string;
  what: string;
  /** What the chain could say once it exists. */
  unlocks: string;
  /** How to get it, concretely. */
  how: string;
}

export interface StrategyBrief {
  headline: string;
  steps: BriefStep[];
  missing: MissingLink[];
  /** True when the chain reaches a spending recommendation. */
  complete: boolean;
  /** The honest statement of scope. */
  limits: string[];
}

export interface BriefInput {
  businessLabel: string;
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
  segments: { key: string; label: string; count: number; avgTicketCents: number; medianGapDays: number | null; favouriteTime: string | null }[];
  lapsedCount: number;
  audienceThin: boolean;

  /** Behaviour. */
  leadDays: number | null;
  leadSample: number;
  quietLabels: string[];
  busyLabels: string[];

  /** Where bookings arrive from. */
  sourceCounts: Record<string, number>;

  /** Money. */
  grossMarginPct: number | null;
  cpaCeilingCents: number | null;
  budgetTotalCents: number | null;
  budgetDays: number;
  bookingsToBreakEven: number | null;

  /** Days. */
  runDayLabels: string[];
  pauseDayLabels: string[];

  money: (cents: number) => string;
}

const SOURCE_VI: Record<string, string> = {
  google: 'Google tìm kiếm', gbp: 'Google Maps', organic: 'tìm kiếm tự nhiên',
  website: 'website', facebook: 'Facebook', instagram: 'Instagram',
  messenger: 'Messenger', hotline: 'hotline AI', walkin: 'khách vãng lai',
  unknown: 'chưa ghi nhận nguồn',
};

export function buildStrategyBrief(i: BriefInput): StrategyBrief {
  const steps: BriefStep[] = [];
  const missing: MissingLink[] = [];

  // ---- 1. the market ------------------------------------------------------
  if (i.areaPopulation && i.regionKnown) {
    steps.push({
      key: 'market', order: 1, title: 'Thị trường quanh tiệm',
      finding: `Khoảng ${i.areaPopulation.toLocaleString('en-US')} người sống trong ${i.areaZipCount ?? 1} mã ZIP quanh ${i.regionLabel}`
        + (i.areaMedianIncome ? `, thu nhập hộ gia đình trung vị ${'$'}${i.areaMedianIncome.toLocaleString('en-US')}/năm.` : '.'),
      basis: `Cục Thống kê Mỹ, khảo sát ACS 5 năm${i.censusYear ? ` (${i.censusYear})` : ''}`,
      confidence: 'measured',
      soWhat: i.areaMedianIncome && i.areaMedianIncome >= 90_000
        ? 'Vùng này chịu được giá — nghĩa là cạnh tranh bằng giảm giá ở đây là bỏ tiền đi, và ngân sách nên mua sự chú ý chứ không mua giá rẻ.'
        : 'Mức thu nhập này định hình cách chào giá, nhưng chưa nói được ai trong số đó là khách của tiệm — bước sau mới trả lời.',
    });
  } else {
    missing.push({
      key: 'market',
      what: 'Quy mô dân cư quanh tiệm',
      unlocks: 'Biết được thị trường có bao nhiêu người thì mới nói được ngân sách này đang với tới bao nhiêu phần trăm trong đó.',
      how: i.regionKnown
        ? 'Điền mã ZIP của tiệm và các ZIP lân cận ở Super Admin, rồi bấm quét dân cư.'
        : 'Điền thành phố, bang và ZIP cho tiệm ở Super Admin.',
    });
  }

  // ---- 2. who is actually yours -------------------------------------------
  // Deliberately the salon's OWN customers, not a demographic slice. The people
  // in the book chose this business over the others within the same few miles,
  // which is a fact; "households aged 25-44" is a category, and the two get
  // confused constantly.
  if (!i.audienceThin && i.customerCount >= 20) {
    const biggest = [...i.segments].sort((a, b) => b.count - a.count)[0];
    const ticket = biggest ? i.money(biggest.avgTicketCents) : null;
    steps.push({
      key: 'audience', order: 2, title: 'Tệp khách thật của tiệm',
      finding: `${i.customerCount} khách có lịch sử. Nhóm đông nhất là "${biggest?.label ?? '—'}" với ${biggest?.count ?? 0} người`
        + (ticket ? `, trung bình ${ticket} mỗi lần` : '')
        + (biggest?.favouriteTime ? `, hay đi ${biggest.favouriteTime}` : '') + '.'
        + (i.declaredWhoWeServe ? ` Doanh nghiệp mô tả tệp mục tiêu: ${i.declaredWhoWeServe}.` : ''),
      basis: 'Sổ khách và lịch hẹn 12 tháng của chính tiệm',
      confidence: 'measured',
      soWhat: i.lapsedCount >= 20
        ? `${i.lapsedCount} người trong số đó đã lâu không quay lại. Đây là tệp rẻ nhất để nhắm quảng cáo, và nó tồn tại sẵn — không cần mua người lạ để có nó.`
        : 'Tệp này là nền để dựng nhóm nhắm quảng cáo, và cũng là nhóm cần loại trừ khỏi quảng cáo tìm khách mới.',
    });
  } else {
    missing.push({
      key: 'audience',
      what: 'Tệp khách đủ lớn để đọc',
      unlocks: 'Trên 20 khách có lịch sử thì mới chia nhóm được, và mới biết nên nhắm quảng cáo vào ai.',
      how: `Hiện có ${i.customerCount} khách trong sổ. Cần thêm lịch hẹn được ghi nhận.`,
    });
  }

  // ---- 3. how they behave -------------------------------------------------
  if (i.leadDays !== null) {
    steps.push({
      key: 'behaviour', order: 3, title: 'Hành vi đặt lịch',
      finding: `Khách đặt trước trung bình ${i.leadDays} ngày (đo trên ${i.leadSample} lịch hẹn).`
        + (i.quietLabels.length ? ` Khung trống nhất: ${i.quietLabels.slice(0, 2).join(', ')}.` : '')
        + (i.busyLabels.length ? ` Khung đông nhất: ${i.busyLabels.slice(0, 2).join(', ')}.` : ''),
      basis: 'Khoảng cách giữa lúc đặt và lúc làm, trên lịch hẹn thật',
      confidence: 'measured',
      soWhat: `Đây là con số quyết định NGÀY chạy quảng cáo: muốn lấp một khung trống thì phải xuất hiện trước nó ${i.leadDays} ngày, chứ không phải đúng hôm đó.`,
    });
  } else {
    missing.push({
      key: 'behaviour',
      what: 'Khoảng cách đặt-đến-làm',
      unlocks: 'Không có nó thì không suy ra được ngày bật quảng cáo, chỉ còn đoán.',
      how: `Cần ít nhất 10 lịch hẹn ghi được cả giờ đặt lẫn giờ làm; hiện có ${i.leadSample}.`,
    });
  }

  // ---- 4. which door they come through ------------------------------------
  const total = Object.values(i.sourceCounts ?? {}).reduce((a, b) => a + b, 0);
  const ranked = Object.entries(i.sourceCounts ?? {})
    .filter(([k]) => k !== 'unknown')
    .sort((a, b) => b[1] - a[1]);
  if (total >= 10 && ranked.length) {
    const [topKey, topN] = ranked[0];
    const pct = Math.round((topN / total) * 100);
    steps.push({
      key: 'channel', order: 4, title: 'Khách đến từ đâu',
      finding: `${pct}% booking đến từ ${SOURCE_VI[topKey] ?? topKey} (${topN}/${total})`
        + (ranked[1] ? `, kế tiếp là ${SOURCE_VI[ranked[1][0]] ?? ranked[1][0]} với ${ranked[1][1]}.` : '.'),
      basis: 'Nguồn được ghi trên từng booking',
      confidence: 'measured',
      soWhat: 'Kênh đang mang khách về miễn phí là kênh mua khách rẻ nhất khi trả tiền: ảnh, đánh giá và lời chào ở đó đã được chứng minh hợp với đúng tệp này. Đó là kênh chạy trước.',
    });
  } else {
    missing.push({
      key: 'channel',
      what: 'Nguồn của các booking',
      unlocks: 'Biết kênh nào đang tự mang khách về thì chọn được nơi tiêu tiền đầu tiên, thay vì rải đều.',
      how: `Mới có ${total} booking ghi nhận được nguồn. Cần vài chục để đọc được tỷ lệ thật.`,
    });
  }

  // ---- 5. what a customer is worth ---------------------------------------
  if (i.cpaCeilingCents && i.grossMarginPct) {
    steps.push({
      key: 'value', order: 5, title: 'Một khách mới đáng chi bao nhiêu',
      finding: `Tối đa ${i.money(i.cpaCeilingCents)} cho mỗi booking, tính từ hoá đơn trung bình và biên lãi ~${i.grossMarginPct}%.`,
      basis: 'Hoá đơn trung bình trong sổ × biên lãi do tiệm khai',
      confidence: 'measured',
      soWhat: 'Đây là ngưỡng dừng, không phải mục tiêu. Ngày thứ ba lấy tiền đã chi chia cho số booking; vượt ngưỡng thì tắt, đừng chờ hết tháng.',
    });
  } else {
    missing.push({
      key: 'value',
      what: 'Biên lãi của tiệm',
      unlocks: 'Không có nó thì không có ngưỡng dừng, và một chiến dịch không có ngưỡng dừng là một chiến dịch không biết mình lãi hay lỗ.',
      how: 'Nhập tỷ lệ ăn chia thợ ở Super Admin. Biên lãi gộp ≈ 100 trừ tỷ lệ đó.',
    });
  }

  // ---- 6. the recommendation ---------------------------------------------
  const complete = Boolean(i.cpaCeilingCents && i.budgetTotalCents && i.runDayLabels.length);
  if (complete) {
    steps.push({
      key: 'spend', order: 6, title: 'Chi bao nhiêu, ngày nào',
      finding: `${i.money(i.budgetTotalCents as number)} trong ${i.budgetDays} ngày`
        + (i.bookingsToBreakEven ? `, cần ${i.bookingsToBreakEven} booking để hoà vốn.` : '.')
        + ` Bật: ${i.runDayLabels.join(', ')}.`
        + (i.pauseDayLabels.length ? ` Tắt: ${i.pauseDayLabels.join(', ')}.` : ''),
      basis: 'Ngưỡng chi mỗi khách × số ngày, và ngày suy từ khoảng cách đặt-đến-làm',
      confidence: 'measured',
      soWhat: 'Chiến dịch đầu là một phép đo: thứ mua được là con số "mỗi booking tốn bao nhiêu" của chính tiệm. Có con số đó rồi mới nói tới việc tăng ngân sách.',
    });
  }

  // `complete` means the chain reaches a spending decision — which it can do
  // without a census, because the ceiling and the days come from the salon's
  // own book rather than from demographics. But saying "complete" while links
  // are missing would overstate it: the market context is what tells an owner
  // whether the plan is small or ambitious, and its absence deserves a sentence
  // rather than silence.
  const headline = complete
    ? missing.length
      ? `Đủ căn cứ để quyết mức chi cho ${i.businessLabel}, nhưng còn thiếu ${missing.length} mắt xích bối cảnh — đọc phần "còn thiếu" trước khi tăng ngân sách.`
      : `Chuỗi phân tích đã đủ để ra quyết định chi tiền cho ${i.businessLabel}.`
    : missing.length === 1
      ? `Còn thiếu một mắt xích: ${missing[0].what.toLowerCase()}. Chưa nên chi tiền quảng cáo cho tới khi có nó.`
      : `Còn thiếu ${missing.length} mắt xích trong chuỗi phân tích. Chưa đủ căn cứ để đề xuất mức chi.`;

  const limits = [
    'Số liệu dân cư theo mã ZIP, không phải một vòng tròn 5 dặm — ranh giới ZIP đi theo tuyến bưu điện.',
    'Hệ thống KHÔNG suy ra thành phần dân tộc, độ tuổi hay giới tính của khách hàng tiềm năng. Cục Thống kê nói một hộ kiếm được bao nhiêu, không nói họ là ai và muốn gì.',
    'Không có dự báo số booking từ ngân sách: điều đó cần tỷ lệ click và tỷ lệ chốt của chính tiệm, mà chỉ chiến dịch thật mới đo ra.',
  ];

  return { headline, steps: steps.sort((a, b) => a.order - b.order), missing, complete, limits };
}
