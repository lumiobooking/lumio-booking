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

import { bi, enOf, viOf, type Bi, type Txt } from './i18n';

export type PromoCost = 'low' | 'medium' | 'high';

export interface PromoPlay {
  key: string;
  // Every line of a play is printed on the Customers & offers tab, so each one
  // carries both languages. `key` and `cost` are machine values, not phrases.
  name: Txt;
  /** What the customer is offered, in one line. */
  offer: Txt;
  /** Why it protects margin — the part that makes it different from "sale". */
  why: Txt;
  /** When it is the right tool. */
  useWhen: Txt;
  /** When it will lose money, said plainly. */
  avoidWhen: Txt;
  /** Roughly what it costs the business per customer bought. */
  cost: PromoCost;
}

export interface MarginBasis {
  /** Share of revenue paid to the technician, 0-100. Null = not known. */
  commissionPct: number | null;
  /** Gross margin implied by it, 0-100. Null when unknown. */
  grossMarginPct: number | null;
  /**
   * Where the rate came from, and it travels with every number derived from it.
   *
   *   'entered' — someone typed it for this business. Authoritative.
   *   'staff'   — averaged from the commission rates already on the staff
   *               records, which the shop set up for payroll. Measured, not
   *               guessed: the salon is paying these rates every week.
   *   'assumed' — a trade default, because nothing else was available. Every
   *               figure computed from it is labelled, on screen and in the
   *               brief, so nobody mistakes it for arithmetic about their shop.
   */
  source: 'entered' | 'staff' | 'assumed' | 'unknown';
  /** One line naming the origin, for the screen. */
  note: Txt;
}

/**
 * The trade default, used only when the shop's own data cannot answer.
 *
 * 55% is the middle of the range commonly paid to nail technicians in the US
 * (roughly 50-60). Naming a number at all is a change of position: I argued
 * before that a made-up margin produces a break-even that looks like arithmetic
 * and is not. That objection is answered not by refusing to help, but by making
 * the assumption impossible to mistake for a measurement — the source travels
 * with the number, the screen says "ước tính", and a shop that disagrees has one
 * field to correct.
 */
export const ASSUMED_COMMISSION_PCT = 55;

/**
 * Gross margin from the commission rate.
 *
 * Deliberately refuses to default. A made-up margin produces a made-up
 * break-even, and a made-up break-even is worse than no number at all: it looks
 * like arithmetic, so it gets believed.
 */
export function marginBasis(
  commissionPct?: number | null,
  opts: { staffAvgPct?: number | null; allowAssumed?: boolean } = {},
): MarginBasis {
  const ok = (v?: number | null) => typeof v === 'number' && v > 0 && v < 100;

  if (ok(commissionPct)) {
    const c = Math.round(commissionPct as number);
    return {
      commissionPct: c, grossMarginPct: 100 - c, source: 'entered',
      note: bi(
        `Tỷ lệ ăn chia ${c}% do đội Lumio nhập cho tiệm này.`,
        `Commission split of ${c}%, entered for this business by the Lumio team.`),
    };
  }
  // The shop already set a rate per technician for payroll. It is paying those
  // rates every week, which makes it a measurement rather than an estimate —
  // and it means nobody has to type the number a second time.
  if (ok(opts.staffAvgPct)) {
    const c = Math.round(opts.staffAvgPct as number);
    return {
      commissionPct: c, grossMarginPct: 100 - c, source: 'staff',
      note: bi(
        `Tỷ lệ ăn chia ${c}% lấy trung bình từ hồ sơ thợ đang làm (dùng cho tính lương).`,
        `Commission split of ${c}%, averaged from the records of the techs currently working (the ones payroll uses).`),
    };
  }
  if (opts.allowAssumed) {
    const c = ASSUMED_COMMISSION_PCT;
    return {
      commissionPct: c, grossMarginPct: 100 - c, source: 'assumed',
      note: bi(
        `ƯỚC TÍNH ${c}% — hồ sơ thợ chưa khai tỷ lệ ăn chia. Mọi con số tiền bên dưới đều dựa trên ước tính này; điền tỷ lệ trong Nhân sự → sửa thợ là có số đúng.`,
        `ESTIMATE ${c}% — no commission split is on file for your techs. Every dollar figure below rests on that estimate; fill the rate in under Staff → edit a tech and the numbers become yours.`),
    };
  }
  return {
    commissionPct: null, grossMarginPct: null, source: 'unknown',
    note: bi('Chưa biết biên lãi.', 'Gross margin not known.'),
  };
}

export interface BreakEven {
  discountPct: number;
  /** Percent more customers needed to end up where you started. Null if impossible. */
  liftNeededPct: number | null;
  /** True when the discount is at or above the margin — no volume can save it. */
  impossible: boolean;
  verdict: 'safe' | 'steep' | 'impossible' | 'unknown';
  plain: Txt;
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
      plain: bi(
        'Chưa biết biên lãi của tiệm nên chưa tính được cần thêm bao nhiêu khách. Điền tỷ lệ ăn chia trong hồ sơ thợ (Nhân sự → sửa thợ).',
        'We do not know your gross margin yet, so there is no way to work out how many extra customers a discount would need. Fill the commission split in on the staff records (Staff → edit a tech).'),
    };
  }
  const m = Math.max(1, Math.min(99, Math.round(grossMarginPct)));
  if (d >= m) {
    return {
      discountPct: d, liftNeededPct: null, impossible: true, verdict: 'impossible',
      plain: bi(
        `Giảm ${d}% trong khi biên lãi chỉ ${m}% thì mỗi khách thêm vào lại lỗ thêm. Không có lượng khách nào cứu được — đây là mức phải từ chối, không phải mức cần cân nhắc.`,
        `${d}% off on a ${m}% margin means every extra customer loses you more money. No amount of volume saves it — this is a discount to turn down, not one to weigh up.`),
    };
  }
  const lift = Math.ceil((d / (m - d)) * 100);
  // Pulled out of the sentence because both languages quote the same multiple.
  const times = (1 + lift / 100).toFixed(1);
  return {
    discountPct: d, liftNeededPct: lift, impossible: false,
    verdict: lift <= 50 ? 'safe' : 'steep',
    plain: lift <= 50
      ? bi(
        `Giảm ${d}% cần thêm ${lift}% lượt khách để hoà vốn — mức này khả thi nếu ưu đãi chỉ áp cho khung giờ đang trống.`,
        `${d}% off needs ${lift}% more visits to break even — doable if the offer is fenced to the hours that are sitting empty.`)
      : bi(
        `Giảm ${d}% cần thêm ${lift}% lượt khách mới hoà vốn. Đó là gần gấp ${times} lần lượng khách hiện tại của khung đó — hiếm khi xảy ra. Cân nhắc mức thấp hơn hoặc đổi sang tặng thêm dịch vụ.`,
        `${d}% off needs ${lift}% more visits just to break even. That is about ${times} times the traffic that block gets today, which almost never happens. Go shallower, or give away an add-on service instead.`),
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
    name: bi('Ưu đãi giờ vàng (chỉ khung trống)', 'Off-peak offer (quiet hours only)'),
    offer: bi(
      'Giảm giá CHỈ cho một khung giờ vắng cố định, ví dụ thứ 3 và thứ 4 trước 2 giờ chiều',
      'A discount on ONE fixed quiet block only — say Tuesday and Wednesday before 2pm'),
    why: bi(
      'Chỉ nhường lãi ở những giờ vốn không sinh ra gì. Khách sẵn sàng trả đủ vào cuối tuần vẫn trả đủ, vì ưu đãi không áp cho họ',
      'You only give up margin in hours that were producing nothing. The weekend customers who would pay full price still pay it, because the offer never reaches them'),
    useWhen: bi(
      'Có khung giờ trống rõ ràng và thợ vẫn phải có mặt',
      'There is a clearly empty block and the techs have to be there anyway'),
    avoidWhen: bi(
      'Lịch đã gần kín — lúc đó ưu đãi chỉ dời khách từ giờ trả đủ sang giờ giảm giá',
      'The book is nearly full — then the offer just moves customers out of full-price hours into discounted ones'),
    cost: 'low',
  },
  {
    key: 'addon',
    name: bi('Tặng thêm dịch vụ, không giảm giá', 'Add a service instead of cutting the price'),
    offer: bi(
      'Giữ nguyên giá, tặng kèm một dịch vụ nhỏ: vẽ nét, đắp dưỡng, massage thêm 10 phút',
      'Same price, plus something small: a hand-painted accent, a strengthening coat, ten extra minutes of massage'),
    why: bi(
      'Món tặng tốn chi phí vật tư chứ không tốn giá bán. Tặng thêm thứ bán 15 đô nhưng tốn 2 đô là mất 2 đô; giảm 15 đô là mất đúng 15 đô lãi',
      'The add-on costs you supplies, not menu price. Giving away something that sells for $15 and costs $2 costs you $2; taking $15 off costs you the whole $15 of profit'),
    useWhen: bi(
      'Muốn hấp dẫn mà không muốn dạy khách chờ đợt giảm giá',
      'You want the pull of an offer without teaching people to wait for the next sale'),
    avoidWhen: bi(
      'Thợ đã kín tay — thêm thời gian mỗi ca sẽ ăn vào số ca làm được',
      'The techs are already flat out — extra minutes on each visit come out of how many visits they can take'),
    cost: 'low',
  },
  {
    key: 'prepay',
    name: bi('Thẻ trả trước / gift card', 'Prepaid credit / gift card'),
    offer: bi('Mua 100 đô nhận 115 đô giá trị dùng dần', 'Pay $100, get $115 of credit to spend over time'),
    why: bi(
      'Tiền về ngay, khách bị neo lại tiệm, và phần thưởng chỉ trả ra khi khách quay lại. Chi phí thực tế thấp hơn con số 15% vì luôn có phần không dùng hết',
      'Cash today, the customer is tied to you, and the bonus is only paid out when they come back in. The real cost lands under that 15% because some of the credit is never spent'),
    useWhen: bi('Trước mùa cao điểm và các dịp tặng quà', 'Ahead of your busy season and around gift-giving holidays'),
    avoidWhen: bi(
      'Tiệm đang thiếu thợ — bán trước dịch vụ mà không có người làm là tạo nợ',
      'You are short on techs — selling work in advance that nobody can do is just taking on debt'),
    cost: 'medium',
  },
  {
    key: 'referral',
    name: bi('Khách cũ giới thiệu khách mới', 'Regulars bring in new customers'),
    offer: bi(
      'Cả người giới thiệu và người được giới thiệu cùng nhận ưu đãi cho lần sau',
      'Both the customer who refers and the one who comes get something off their next visit'),
    why: bi(
      'Chỉ trả tiền khi thật sự có khách mới, và trả bằng lần hẹn sau chứ không phải tiền mặt. Khách do người quen giới thiệu quay lại nhiều hơn hẳn khách đến vì giảm giá',
      'You only pay when a new customer actually turns up, and you pay in a future visit rather than in cash. Someone who came because a friend sent them comes back far more often than someone who came for a discount'),
    useWhen: bi(
      'Lúc nào cũng chạy được — đây là nền, không phải chiến dịch',
      'Runs all year — this is a standing offer, not a campaign'),
    avoidWhen: bi(
      'Không có gì để tránh, nhưng phải nhắc thợ mời thì mới có người tham gia',
      'Nothing to avoid, but the techs have to ask or nobody takes it up'),
    cost: 'low',
  },
  {
    key: 'bundle',
    name: bi('Gói combo có giới hạn thời gian', 'Combo package with an end date'),
    offer: bi(
      'Bộ tay + chân trong cùng một lần, giá gói thấp hơn tổng hai dịch vụ riêng',
      'Hands and feet in one visit, priced under the two booked separately'),
    why: bi(
      'Nâng giá trị mỗi lượt khách thay vì hạ giá. Cùng một ghế, cùng một lần đón khách, doanh thu cao hơn',
      'Raises what a visit is worth instead of lowering the price. Same chair, same customer, more revenue'),
    useWhen: bi('Muốn tăng giá trị hoá đơn trung bình', 'You want a bigger average ticket'),
    avoidWhen: bi(
      'Gói khiến một ca chiếm chỗ hai ca vào đúng giờ cao điểm',
      'The package turns one appointment into two slots during your busiest hours'),
    cost: 'medium',
  },
  {
    key: 'firsttime',
    name: bi('Ưu đãi lần đầu, một lần duy nhất', 'First-visit offer, once per customer'),
    offer: bi('Giảm cho lần đầu tiên, kèm điều kiện đặt lịch trước', 'Money off the first visit, booked ahead'),
    why: bi(
      'Chi phí này mua một khách mới chứ không phải một lần bán rẻ. Chỉ đáng nếu tiệm giữ được khách — hãy so với số tiền một khách mang lại trong một năm',
      'This money buys a customer, not a cheap sale. It only pays off if you keep them — measure it against what a customer is worth to you over a year'),
    useWhen: bi('Tiệm mới mở hoặc vừa chuyển địa điểm', 'You have just opened, or just moved'),
    avoidWhen: bi(
      'Tỷ lệ khách quay lại thấp — lúc đó đây là chiếc xô thủng, càng đổ càng mất',
      'Your repeat rate is low — then this is a bucket with a hole in it, and the more you pour the more you lose'),
    cost: 'high',
  },
  {
    key: 'winback',
    name: bi('Nhắn tay khách lâu chưa quay lại', 'Text your lapsed customers by hand'),
    offer: bi(
      'Một tin nhắn cá nhân, không giảm giá, chỉ hỏi thăm và mời quay lại',
      'One personal message, no discount — just checking in and inviting them back'),
    why: bi(
      'Rẻ nhất trong tất cả. Đây là người đã từng trả tiền và đã biết đường tới tiệm — phần lớn không rời đi vì giá',
      'The cheapest play there is. These people have paid you before and know where you are — most of them did not leave over price'),
    useWhen: bi('Luôn thử cái này TRƯỚC khi nghĩ tới giảm giá', 'Always try this BEFORE you think about discounting'),
    avoidWhen: bi(
      'Danh sách quá ít người thì không đủ để thành chiến dịch, nhưng vẫn nên nhắn tay',
      'Too few names on the list to call it a campaign — send the messages by hand anyway'),
    cost: 'low',
  },
  {
    key: 'blanket',
    name: bi('Giảm giá toàn menu (nên tránh)', 'Percent off the whole menu (avoid)'),
    offer: bi('Giảm x% cho mọi dịch vụ, mọi khung giờ', 'x% off every service, every hour'),
    why: bi(
      'Nhường lãi trên cả những khách vốn sẵn sàng trả đủ — thường là đa số. Và dạy khách chờ đợt giảm tiếp theo, nên lần sau bán giá gốc khó hơn',
      'You hand over margin on the customers who would have paid full price — usually most of them. It also teaches everyone to wait for the next sale, so full price gets harder to hold'),
    useWhen: bi(
      'Gần như không bao giờ. Nếu buộc phải, hãy giới hạn ngày kết thúc rõ ràng',
      'Almost never. If you have to, put a hard end date on it'),
    avoidWhen: bi(
      'Mặc định là tránh — đây là công cụ đắt nhất và là công cụ ai cũng chọn đầu tiên',
      'Avoid by default — it is the most expensive tool there is, and the one everybody reaches for first'),
    cost: 'high',
  },
];

const RESTAURANT_PLAYS: PromoPlay[] = [
  {
    key: 'offpeak',
    name: bi('Khung giờ vắng', 'Quiet hours'),
    offer: bi('Ưu đãi chỉ áp cho khung 2-5 giờ chiều hoặc đầu tuần', 'The offer runs only from 2-5pm, or early in the week'),
    why: bi(
      'Bếp và nhân viên vẫn phải trực — doanh thu thêm ở giờ đó gần như toàn bộ là phần bù chi phí cố định',
      'The kitchen and the floor are staffed either way — almost every dollar earned in those hours goes straight against fixed costs'),
    useWhen: bi('Có khung giờ vắng cố định', 'There is a quiet stretch you can count on'),
    avoidWhen: bi('Giờ cao điểm đã phải xếp hàng', 'People already queue at peak'),
    cost: 'low',
  },
  {
    key: 'addon',
    name: bi('Tặng kèm món chi phí thấp', 'Throw in a low-cost item'),
    offer: bi('Tặng đồ uống hoặc món khai vị khi gọi món chính', 'A free drink or starter with any main'),
    why: bi(
      'Món tặng tốn giá vốn, không tốn giá bán — thường chênh nhau ba tới bốn lần',
      'The freebie costs you food cost, not menu price — usually three to four times apart'),
    useWhen: bi('Muốn tăng sức hấp dẫn mà giữ giá thực đơn', 'You want the pull without touching menu prices'),
    avoidWhen: bi('Bếp đang quá tải', 'The kitchen is already overloaded'),
    cost: 'low',
  },
  {
    key: 'bundle',
    name: bi('Set phần ăn', 'Set meal'),
    offer: bi('Món chính + đồ uống + tráng miệng theo giá gói', 'Main + drink + dessert at one bundled price'),
    why: bi(
      'Nâng giá trị mỗi bàn thay vì hạ giá từng món',
      'Raises what each table is worth instead of cutting the price of every dish'),
    useWhen: bi('Muốn tăng hoá đơn trung bình', 'You want a bigger average check'),
    avoidWhen: bi('Set làm bàn ngồi lâu hơn vào giờ cao điểm', 'The set keeps tables sitting longer through the rush'),
    cost: 'medium',
  },
  {
    key: 'blanket',
    name: bi('Giảm toàn thực đơn (nên tránh)', 'Percent off the whole menu (avoid)'),
    offer: bi('Giảm x% mọi món mọi giờ', 'x% off every dish, every hour'),
    why: bi(
      'Biên lãi ngành ăn uống mỏng — giảm đại trà ăn thẳng vào phần lãi vốn đã ít',
      'Margins in food are thin — an across-the-board cut comes straight out of the little profit there is'),
    useWhen: bi('Gần như không bao giờ', 'Almost never'),
    avoidWhen: bi('Mặc định là tránh', 'Avoid by default'),
    cost: 'high',
  },
];

const REAL_ESTATE_PLAYS: PromoPlay[] = [
  {
    key: 'value',
    name: bi('Định giá miễn phí', 'Free home valuation'),
    offer: bi('Báo cáo định giá nhà miễn phí, không ràng buộc', 'A free valuation report, no strings attached'),
    why: bi(
      'Tốn thời gian chứ không tốn phí hoa hồng. Người nhận báo cáo là người đang cân nhắc bán',
      'It costs your time, not your commission. Anyone who asks for one is thinking about selling'),
    useWhen: bi('Muốn có nguồn khách bán nhà', 'You want a pipeline of sellers'),
    avoidWhen: bi('Không đủ người theo đuổi các đầu mối thu về', 'There is nobody free to work the leads it brings in'),
    cost: 'low',
  },
  {
    key: 'referral',
    name: bi('Thưởng giới thiệu', 'Referral thank-you'),
    offer: bi(
      'Cảm ơn bằng quà cho khách cũ giới thiệu người mua/bán',
      'A thank-you gift for past clients who send a buyer or a seller your way'),
    why: bi('Chỉ trả khi giao dịch thật sự chốt', 'You only pay when a deal actually closes'),
    useWhen: bi('Luôn chạy được', 'Runs all year'),
    avoidWhen: bi(
      'Kiểm tra quy định của bang về việc thưởng giới thiệu trước khi công bố',
      'Check your state rules on paying for referrals before you advertise it'),
    cost: 'low',
  },
  {
    key: 'commission',
    name: bi('Giảm phí hoa hồng (nên rất thận trọng)', 'Cutting your commission (be very careful)'),
    offer: bi('Hạ tỷ lệ hoa hồng để giành hợp đồng', 'Drop your commission rate to win the listing'),
    why: bi(
      'Đây là cắt thẳng vào thu nhập, và một khi đã hạ thì rất khó nâng lại với khách đó',
      'This comes straight out of your income, and once you have gone down it is very hard to go back up with that client'),
    useWhen: bi('Chỉ khi giá trị giao dịch đủ lớn để bù', 'Only when the deal is big enough to make up for it'),
    avoidWhen: bi(
      'Mặc định là tránh — cạnh tranh bằng dịch vụ dễ giữ hơn cạnh tranh bằng phí',
      'Avoid by default — competing on service is easier to keep up than competing on fee'),
    cost: 'high',
  },
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
  tryFirst: Txt[];
  note: Txt;
}

export function promoAdvice(input: {
  industry?: string | null;
  commissionPct?: number | null;
  /** Average commission across active staff — the shop's own payroll setup. */
  staffAvgPct?: number | null;
  allowAssumed?: boolean;
  /** The discount the revenue engine wants to run, if any. */
  proposedDiscountPct?: number | null;
}): PromoAdvice {
  const margin = marginBasis(input.commissionPct, { staffAvgPct: input.staffAvgPct, allowAssumed: input.allowAssumed });
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

  // `margin.note` is itself bilingual now, so each side of this sentence is
  // built from the matching side of it rather than from one language twice.
  const note: Txt = margin.source === 'unknown'
    ? bi(
      'Chưa có tỷ lệ ăn chia thợ ở bất kỳ đâu trong hệ thống nên chưa tính được điểm hoà vốn.',
      'There is no staff commission split anywhere in the system, so there is no break-even to work out yet.')
    : bi(
      `${viOf(margin.note)} Biên lãi gộp ${margin.grossMarginPct}%; mọi con số hoà vốn bên dưới tính từ đây.`,
      `${enOf(margin.note)} Gross margin ${margin.grossMarginPct}%; every break-even figure below is worked out from it.`);

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
 *
 * WHY THE ADVICE IT MUTATES IS PLAIN STRINGS AND NOT `Txt`
 *
 * The offer advice on screen is bilingual (see revenue-signals), but this
 * function is not a screen: it is the arithmetic, and it takes a VIETNAMESE
 * VIEW of the advice — content.service builds one with `viOf`, caps it here,
 * and `applyCapToOffer` folds the result back onto both languages. Keeping the
 * view flat means the cap rule stays testable without a bilingual fixture.
 *
 * The sentence it appends is the one part a screen really does read, so it is
 * ALSO returned bilingually as `appended`. The Vietnamese half is what gets
 * pushed onto `advice.detail`; the English half is what `applyCapToOffer` puts
 * on the English side, so an owner reading EN gets the same arithmetic — the
 * same lift figure, not a vaguer sentence — rather than a Vietnamese tail glued
 * onto an English line.
 */
export function capAdvice(
  advice: { kind: string; discountPct: number; headline: string; detail: string },
  promo: Pick<PromoAdvice, 'ceiling' | 'margin'>,
): { changed: boolean; from: number | null; appended: Bi | null } {
  if (advice.kind !== 'fill-slot' || !advice.discountPct) return { changed: false, from: null, appended: null };

  if (promo.margin.source === 'unknown') {
    const appended = bi(
      ' Chưa nhập tỷ lệ ăn chia thợ nên chưa kiểm được mức giảm này có còn lãi không.',
      ' No staff commission split has been entered, so there is no way to check whether this discount still leaves a profit.');
    advice.detail += appended.vi;
    return { changed: false, from: null, appended };
  }
  if (promo.ceiling === null || advice.discountPct <= promo.ceiling) return { changed: false, from: null, appended: null };

  const was = advice.discountPct;
  const lift = breakEven(was, promo.margin.grossMarginPct).liftNeededPct ?? '—';
  const appended = bi(
    ` Mức giảm đã hạ từ ${was}% xuống ${promo.ceiling}%: với biên lãi ~${promo.margin.grossMarginPct}%, giảm ${was}% cần thêm ${lift}% lượt khách mới hoà vốn.`,
    ` The discount was brought down from ${was}% to ${promo.ceiling}%: at a gross margin of about ${promo.margin.grossMarginPct}%, a ${was}% cut needs ${lift}% more visits just to break even.`);
  advice.discountPct = promo.ceiling;
  advice.headline = advice.headline.replace(`${was}%`, `${promo.ceiling}%`);
  advice.detail += appended.vi;
  return { changed: true, from: was, appended };
}

/**
 * For the prompt: the rules the model must not talk its way around.
 *
 * Stays Vietnamese whatever language the screen is in — the prompt library is
 * one language on purpose — so the bilingual play names are unwrapped with
 * `viOf` on the way in. A `{vi, en}` pair dropped into a template literal
 * prints `[object Object]`, and the model would read exactly that.
 */
export function promoToPrompt(a: PromoAdvice): string {
  const L = ['LUẬT KHUYẾN MÃI:'];
  if (a.margin.source === 'unknown') {
    L.push('- Chưa biết biên lãi của tiệm. TUYỆT ĐỐI không đề xuất mức giảm cụ thể nào.');
  } else {
    if (a.margin.source === 'assumed') {
      L.push(`- LƯU Ý: biên lãi ${a.margin.grossMarginPct}% là ƯỚC TÍNH theo mặt bằng ngành, chưa phải số của tiệm. Khi nhắc tới mức giảm, phải ghi rõ đây là ước tính.`);
    }
    L.push(`- Biên lãi gộp ~${a.margin.grossMarginPct}%. Không bao giờ đề xuất giảm quá ${a.ceiling}%.`);
    L.push(`- Giảm bằng hoặc hơn ${a.margin.grossMarginPct}% là lỗ dù bán bao nhiêu — không được đề xuất.`);
  }
  L.push(`- Ưu tiên theo thứ tự rẻ nhất trước: ${a.tryFirst.map(viOf).join(' → ')}.`);
  L.push('- Giảm giá toàn menu là lựa chọn cuối cùng, không phải lựa chọn đầu tiên.');
  return L.join('\n');
}
