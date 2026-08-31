/**
 * Promotions that pull customers without giving away the margin.
 *
 * Almost every promotion a local business runs is a price cut, and almost every
 * price cut is priced by feel: "giảm 30%, nghe hấp dẫn". The arithmetic that
 * would tell them whether 30% is survivable takes one line, and nobody does it,
 * so this file does it for them.
 *
 * THE ONE FORMULA THAT MATTERS
 *
 * To hold gross profit flat while cutting price by d (as a fraction) on work
 * whose gross margin is m, the extra volume needed is:
 *
 *     lift = d / (m - d)
 *
 * It comes straight out of setting old and new profit equal:
 *
 *     Q · P · m  =  Q' · P(1-d) · ((m - d) / (1 - d))   →   Q'/Q = m / (m - d)
 *
 * The consequences are brutal and worth stating plainly:
 *   - at 50% margin, a 20% discount needs +67% more customers to break even;
 *   - at 50% margin, a 30% discount needs +150%;
 *   - a discount at or above the margin can NEVER break even. No volume saves
 *     it. This is the case that gets salons into trouble, and the reason this
 *     module refuses rather than warns.
 *
 * In a salon paying techs a share of revenue, that share IS most of the cost,
 * so gross margin ≈ 100% minus the commission rate. A shop on 60/40 has a 40%
 * margin, which makes a "30% off" campaign a plan to work far harder for less
 * money. Nobody is inventing that number here: the rate is entered per salon,
 * and when it has not been entered the module says so instead of guessing.
 *
 * WHY MOST OF THE PLAYS ARE NOT DISCOUNTS
 *
 * A discount gives away margin on customers who would have paid full price —
 * usually the majority. The alternatives below cost less per customer bought:
 * an added service costs its supply cost, not its menu price; an off-peak-only
 * offer is fenced to hours that were producing nothing; prepaid credit is cash
 * today and breakage tomorrow. Ranked by what they actually cost, a plain
 * percentage off the whole menu is close to the worst tool available, and it is
 * the one everybody reaches for first.
 */

export type PromoCost = 'low' | 'medium' | 'high';

export interface PromoPlay {
  key: string;
  name: string;
  /** What the customer is offered, in one line. */
  offer: string;
  /** Why it protects margin — the part that makes it different from "sale". */
  why: string;
  /** When it is the right tool. */
  useWhen: string;
  /** When it will lose money, said plainly. */
  avoidWhen: string;
  /** Roughly what it costs the business per customer bought. */
  cost: PromoCost;
}

export interface MarginBasis {
  /** Share of revenue paid to the technician, 0-100. Null = not entered. */
  commissionPct: number | null;
  /** Gross margin implied by it, 0-100. Null when unknown. */
  grossMarginPct: number | null;
  source: 'entered' | 'unknown';
}

/**
 * Gross margin from the commission rate.
 *
 * Deliberately refuses to default. A made-up margin produces a made-up
 * break-even, and a made-up break-even is worse than no number at all: it looks
 * like arithmetic, so it gets believed.
 */
export function marginBasis(commissionPct?: number | null): MarginBasis {
  const c = typeof commissionPct === 'number' && commissionPct > 0 && commissionPct < 100
    ? Math.round(commissionPct)
    : null;
  return c === null
    ? { commissionPct: null, grossMarginPct: null, source: 'unknown' }
    : { commissionPct: c, grossMarginPct: 100 - c, source: 'entered' };
}

export interface BreakEven {
  discountPct: number;
  /** Percent more customers needed to end up where you started. Null if impossible. */
  liftNeededPct: number | null;
  /** True when the discount is at or above the margin — no volume can save it. */
  impossible: boolean;
  verdict: 'safe' | 'steep' | 'impossible' | 'unknown';
  plain: string;
}

/**
 * How much extra volume a discount has to buy to pay for itself.
 *
 * Rounds the lift UP. Rounding a break-even down flatters the promotion, and
 * the whole point of this number is to be the unflattering one.
 */
export function breakEven(discountPct: number, grossMarginPct: number | null): BreakEven {
  const d = Math.max(0, Math.min(95, Math.round(discountPct)));
  if (grossMarginPct === null) {
    return {
      discountPct: d, liftNeededPct: null, impossible: false, verdict: 'unknown',
      plain: 'Chưa biết biên lãi của tiệm nên chưa tính được cần thêm bao nhiêu khách. Nhập tỷ lệ ăn chia thợ ở Super Admin.',
    };
  }
  const m = Math.max(1, Math.min(99, Math.round(grossMarginPct)));
  if (d >= m) {
    return {
      discountPct: d, liftNeededPct: null, impossible: true, verdict: 'impossible',
      plain: `Giảm ${d}% trong khi biên lãi chỉ ${m}% thì mỗi khách thêm vào lại lỗ thêm. Không có lượng khách nào cứu được — đây là mức phải từ chối, không phải mức cần cân nhắc.`,
    };
  }
  const lift = Math.ceil((d / (m - d)) * 100);
  return {
    discountPct: d, liftNeededPct: lift, impossible: false,
    verdict: lift <= 50 ? 'safe' : 'steep',
    plain: lift <= 50
      ? `Giảm ${d}% cần thêm ${lift}% lượt khách để hoà vốn — mức này khả thi nếu ưu đãi chỉ áp cho khung giờ đang trống.`
      : `Giảm ${d}% cần thêm ${lift}% lượt khách mới hoà vốn. Đó là gần gấp ${(1 + lift / 100).toFixed(1)} lần lượng khách hiện tại của khung đó — hiếm khi xảy ra. Cân nhắc mức thấp hơn hoặc đổi sang tặng thêm dịch vụ.`,
  };
}

/**
 * The deepest discount that still breaks even at a plausible lift.
 *
 * "Plausible" is capped at +40%: an off-peak promotion that fills a genuinely
 * empty block can do that; one that needs the shop to double is a wish. Solving
 * lift = d/(m-d) for d at lift = L gives d = m·L/(1+L).
 */
export function safeDiscount(grossMarginPct: number | null, maxLiftPct = 40): number | null {
  if (grossMarginPct === null) return null;
  const m = Math.max(1, Math.min(99, grossMarginPct));
  const L = maxLiftPct / 100;
  return Math.max(5, Math.floor((m * L) / (1 + L)));
}

// ---- the plays, per trade ---------------------------------------------------

const SALON_PLAYS: PromoPlay[] = [
  {
    key: 'offpeak',
    name: 'Ưu đãi giờ vàng (chỉ khung trống)',
    offer: 'Giảm giá CHỈ cho một khung giờ vắng cố định, ví dụ thứ 3 và thứ 4 trước 2 giờ chiều',
    why: 'Chỉ nhường lãi ở những giờ vốn không sinh ra gì. Khách sẵn sàng trả đủ vào cuối tuần vẫn trả đủ, vì ưu đãi không áp cho họ',
    useWhen: 'Có khung giờ trống rõ ràng và thợ vẫn phải có mặt',
    avoidWhen: 'Lịch đã gần kín — lúc đó ưu đãi chỉ dời khách từ giờ trả đủ sang giờ giảm giá',
    cost: 'low',
  },
  {
    key: 'addon',
    name: 'Tặng thêm dịch vụ, không giảm giá',
    offer: 'Giữ nguyên giá, tặng kèm một dịch vụ nhỏ: vẽ nét, đắp dưỡng, massage thêm 10 phút',
    why: 'Món tặng tốn chi phí vật tư chứ không tốn giá bán. Tặng thêm thứ bán 15 đô nhưng tốn 2 đô là mất 2 đô; giảm 15 đô là mất đúng 15 đô lãi',
    useWhen: 'Muốn hấp dẫn mà không muốn dạy khách chờ đợt giảm giá',
    avoidWhen: 'Thợ đã kín tay — thêm thời gian mỗi ca sẽ ăn vào số ca làm được',
    cost: 'low',
  },
  {
    key: 'prepay',
    name: 'Thẻ trả trước / gift card',
    offer: 'Mua 100 đô nhận 115 đô giá trị dùng dần',
    why: 'Tiền về ngay, khách bị neo lại tiệm, và phần thưởng chỉ trả ra khi khách quay lại. Chi phí thực tế thấp hơn con số 15% vì luôn có phần không dùng hết',
    useWhen: 'Trước mùa cao điểm và các dịp tặng quà',
    avoidWhen: 'Tiệm đang thiếu thợ — bán trước dịch vụ mà không có người làm là tạo nợ',
    cost: 'medium',
  },
  {
    key: 'referral',
    name: 'Khách cũ giới thiệu khách mới',
    offer: 'Cả người giới thiệu và người được giới thiệu cùng nhận ưu đãi cho lần sau',
    why: 'Chỉ trả tiền khi thật sự có khách mới, và trả bằng lần hẹn sau chứ không phải tiền mặt. Khách do người quen giới thiệu quay lại nhiều hơn hẳn khách đến vì giảm giá',
    useWhen: 'Lúc nào cũng chạy được — đây là nền, không phải chiến dịch',
    avoidWhen: 'Không có gì để tránh, nhưng phải nhắc thợ mời thì mới có người tham gia',
    cost: 'low',
  },
  {
    key: 'bundle',
    name: 'Gói combo có giới hạn thời gian',
    offer: 'Bộ tay + chân trong cùng một lần, giá gói thấp hơn tổng hai dịch vụ riêng',
    why: 'Nâng giá trị mỗi lượt khách thay vì hạ giá. Cùng một ghế, cùng một lần đón khách, doanh thu cao hơn',
    useWhen: 'Muốn tăng giá trị hoá đơn trung bình',
    avoidWhen: 'Gói khiến một ca chiếm chỗ hai ca vào đúng giờ cao điểm',
    cost: 'medium',
  },
  {
    key: 'firsttime',
    name: 'Ưu đãi lần đầu, một lần duy nhất',
    offer: 'Giảm cho lần đầu tiên, kèm điều kiện đặt lịch trước',
    why: 'Chi phí này mua một khách mới chứ không phải một lần bán rẻ. Chỉ đáng nếu tiệm giữ được khách — hãy so với số tiền một khách mang lại trong một năm',
    useWhen: 'Tiệm mới mở hoặc vừa chuyển địa điểm',
    avoidWhen: 'Tỷ lệ khách quay lại thấp — lúc đó đây là chiếc xô thủng, càng đổ càng mất',
    cost: 'high',
  },
  {
    key: 'winback',
    name: 'Nhắn tay khách lâu chưa quay lại',
    offer: 'Một tin nhắn cá nhân, không giảm giá, chỉ hỏi thăm và mời quay lại',
    why: 'Rẻ nhất trong tất cả. Đây là người đã từng trả tiền và đã biết đường tới tiệm — phần lớn không rời đi vì giá',
    useWhen: 'Luôn thử cái này TRƯỚC khi nghĩ tới giảm giá',
    avoidWhen: 'Danh sách quá ít người thì không đủ để thành chiến dịch, nhưng vẫn nên nhắn tay',
    cost: 'low',
  },
  {
    key: 'blanket',
    name: 'Giảm giá toàn menu (nên tránh)',
    offer: 'Giảm x% cho mọi dịch vụ, mọi khung giờ',
    why: 'Nhường lãi trên cả những khách vốn sẵn sàng trả đủ — thường là đa số. Và dạy khách chờ đợt giảm tiếp theo, nên lần sau bán giá gốc khó hơn',
    useWhen: 'Gần như không bao giờ. Nếu buộc phải, hãy giới hạn ngày kết thúc rõ ràng',
    avoidWhen: 'Mặc định là tránh — đây là công cụ đắt nhất và là công cụ ai cũng chọn đầu tiên',
    cost: 'high',
  },
];

const RESTAURANT_PLAYS: PromoPlay[] = [
  { key: 'offpeak', name: 'Khung giờ vắng', offer: 'Ưu đãi chỉ áp cho khung 2-5 giờ chiều hoặc đầu tuần', why: 'Bếp và nhân viên vẫn phải trực — doanh thu thêm ở giờ đó gần như toàn bộ là phần bù chi phí cố định', useWhen: 'Có khung giờ vắng cố định', avoidWhen: 'Giờ cao điểm đã phải xếp hàng', cost: 'low' },
  { key: 'addon', name: 'Tặng kèm món chi phí thấp', offer: 'Tặng đồ uống hoặc món khai vị khi gọi món chính', why: 'Món tặng tốn giá vốn, không tốn giá bán — thường chênh nhau ba tới bốn lần', useWhen: 'Muốn tăng sức hấp dẫn mà giữ giá thực đơn', avoidWhen: 'Bếp đang quá tải', cost: 'low' },
  { key: 'bundle', name: 'Set phần ăn', offer: 'Món chính + đồ uống + tráng miệng theo giá gói', why: 'Nâng giá trị mỗi bàn thay vì hạ giá từng món', useWhen: 'Muốn tăng hoá đơn trung bình', avoidWhen: 'Set làm bàn ngồi lâu hơn vào giờ cao điểm', cost: 'medium' },
  { key: 'blanket', name: 'Giảm toàn thực đơn (nên tránh)', offer: 'Giảm x% mọi món mọi giờ', why: 'Biên lãi ngành ăn uống mỏng — giảm đại trà ăn thẳng vào phần lãi vốn đã ít', useWhen: 'Gần như không bao giờ', avoidWhen: 'Mặc định là tránh', cost: 'high' },
];

const REAL_ESTATE_PLAYS: PromoPlay[] = [
  { key: 'value', name: 'Định giá miễn phí', offer: 'Báo cáo định giá nhà miễn phí, không ràng buộc', why: 'Tốn thời gian chứ không tốn phí hoa hồng. Người nhận báo cáo là người đang cân nhắc bán', useWhen: 'Muốn có nguồn khách bán nhà', avoidWhen: 'Không đủ người theo đuổi các đầu mối thu về', cost: 'low' },
  { key: 'referral', name: 'Thưởng giới thiệu', offer: 'Cảm ơn bằng quà cho khách cũ giới thiệu người mua/bán', why: 'Chỉ trả khi giao dịch thật sự chốt', useWhen: 'Luôn chạy được', avoidWhen: 'Kiểm tra quy định của bang về việc thưởng giới thiệu trước khi công bố', cost: 'low' },
  { key: 'commission', name: 'Giảm phí hoa hồng (nên rất thận trọng)', offer: 'Hạ tỷ lệ hoa hồng để giành hợp đồng', why: 'Đây là cắt thẳng vào thu nhập, và một khi đã hạ thì rất khó nâng lại với khách đó', useWhen: 'Chỉ khi giá trị giao dịch đủ lớn để bù', avoidWhen: 'Mặc định là tránh — cạnh tranh bằng dịch vụ dễ giữ hơn cạnh tranh bằng phí', cost: 'high' },
];

const PLAYS: Record<string, PromoPlay[]> = {
  SALON: SALON_PLAYS, RESTAURANT: RESTAURANT_PLAYS, REAL_ESTATE: REAL_ESTATE_PLAYS, SERVICE: SALON_PLAYS,
};

export function playsFor(industry?: string | null): PromoPlay[] {
  return PLAYS[(industry || 'SALON').toUpperCase()] ?? SALON_PLAYS;
}

// ---- putting it together ----------------------------------------------------

export interface PromoAdvice {
  margin: MarginBasis;
  /** The deepest defensible discount, or null when margin is unknown. */
  ceiling: number | null;
  /** Break-even for the discount actually being proposed. */
  proposed: BreakEven | null;
  plays: PromoPlay[];
  /** Ordered cheapest-first, so the expensive tool is never the first suggestion. */
  tryFirst: string[];
  note: string;
}

export function promoAdvice(input: {
  industry?: string | null;
  commissionPct?: number | null;
  /** The discount the revenue engine wants to run, if any. */
  proposedDiscountPct?: number | null;
}): PromoAdvice {
  const margin = marginBasis(input.commissionPct);
  const ceiling = safeDiscount(margin.grossMarginPct);
  const proposed = typeof input.proposedDiscountPct === 'number' && input.proposedDiscountPct > 0
    ? breakEven(input.proposedDiscountPct, margin.grossMarginPct)
    : null;
  const plays = playsFor(input.industry);
  const order: PromoCost[] = ['low', 'medium', 'high'];
  const tryFirst = [...plays]
    .sort((a, b) => order.indexOf(a.cost) - order.indexOf(b.cost))
    .slice(0, 3)
    .map((p) => p.name);

  const note = margin.source === 'unknown'
    ? 'Chưa nhập tỷ lệ ăn chia thợ nên chưa tính được điểm hoà vốn. Một con số biên lãi bịa ra sẽ tạo ra một điểm hoà vốn bịa ra — mà cái đó trông giống phép tính nên rất dễ bị tin.'
    : `Biên lãi gộp ước tính ${margin.grossMarginPct}% (thợ ăn ${margin.commissionPct}%). Mọi con số hoà vốn bên dưới tính từ đây.`;

  return { margin, ceiling, proposed, plays, tryFirst, note };
}

/**
 * Bring a proposed discount down to something the margin can survive.
 *
 * The revenue engine picks a depth from how empty a slot is, which is the right
 * question about demand and the wrong question about money: 20% off is generous
 * at a 60% margin and ruinous at a 30% one. This runs at the source, before the
 * number reaches a prompt or a screen — capping later would put two figures in
 * circulation, and the wrong one would eventually be the one a salon read.
 *
 * Mutation is deliberate: the advice object is the single copy everything else
 * reads, and handing back a corrected duplicate is how the uncorrected original
 * survives to be displayed somewhere.
 */
export function capAdvice(
  advice: { kind: string; discountPct: number; headline: string; detail: string },
  promo: Pick<PromoAdvice, 'ceiling' | 'margin'>,
): { changed: boolean; from: number | null } {
  if (advice.kind !== 'fill-slot' || !advice.discountPct) return { changed: false, from: null };

  if (promo.margin.source === 'unknown') {
    advice.detail += ' Chưa nhập tỷ lệ ăn chia thợ nên chưa kiểm được mức giảm này có còn lãi không.';
    return { changed: false, from: null };
  }
  if (promo.ceiling === null || advice.discountPct <= promo.ceiling) return { changed: false, from: null };

  const was = advice.discountPct;
  advice.discountPct = promo.ceiling;
  advice.headline = advice.headline.replace(`${was}%`, `${promo.ceiling}%`);
  advice.detail += ` Mức giảm đã hạ từ ${was}% xuống ${promo.ceiling}%: với biên lãi ~${promo.margin.grossMarginPct}%, giảm ${was}% cần thêm ${breakEven(was, promo.margin.grossMarginPct).liftNeededPct ?? '—'}% lượt khách mới hoà vốn.`;
  return { changed: true, from: was };
}

/** For the prompt: the rules the model must not talk its way around. */
export function promoToPrompt(a: PromoAdvice): string {
  const L = ['LUẬT KHUYẾN MÃI:'];
  if (a.margin.source === 'unknown') {
    L.push('- Chưa biết biên lãi của tiệm. TUYỆT ĐỐI không đề xuất mức giảm cụ thể nào.');
  } else {
    L.push(`- Biên lãi gộp ~${a.margin.grossMarginPct}%. Không bao giờ đề xuất giảm quá ${a.ceiling}%.`);
    L.push(`- Giảm bằng hoặc hơn ${a.margin.grossMarginPct}% là lỗ dù bán bao nhiêu — không được đề xuất.`);
  }
  L.push(`- Ưu tiên theo thứ tự rẻ nhất trước: ${a.tryFirst.join(' → ')}.`);
  L.push('- Giảm giá toàn menu là lựa chọn cuối cùng, không phải lựa chọn đầu tiên.');
  return L.join('\n');
}
