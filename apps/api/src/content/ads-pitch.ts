import { bi, type Txt } from './i18n';

/**
 * The ad budget, offered to the SALON in the salon's own words.
 *
 * WHY THE CLIENT SEES THIS AT ALL
 *
 * The owner asks for customers now and cannot follow the content argument.
 * The one thing that answers her directly is money: this much a day, for this
 * long, and here is the line under which each customer is profitable. Put on
 * her screen it stops being a pitch and becomes arithmetic she can check —
 * and arithmetic she can check is what makes a yes stick.
 *
 * WHAT IS TRANSLATED OUT
 *
 * The team's version of this carries the vocabulary of the trade: break-even
 * CPA, feasibility, lifetime ceilings, "a first campaign is a measurement".
 * None of that survives here. What survives is the shop's own numbers in the
 * shop's own sentences — what a new customer is worth after paying the tech,
 * how many are needed to get the money back, and whether there are chairs
 * free to seat them.
 *
 * THE STATE THAT MATTERS MOST IS THE ONE THAT SAYS NO
 *
 * When the smallest measurable budget needs more customers than the empty
 * hours can hold, this offers nothing and says why. An agency that answers
 * "yes, advertise" to every salon in every month is an agency whose
 * recommendation carries no information — and the shop finds that out with
 * its own money.
 */

export type PitchState = 'offer' | 'not-yet' | 'unknown';

export interface AdsPitch {
  state: PitchState;
  /** The three numbers, already in money. Empty for the states with no offer. */
  figures: { value: string; label: Txt }[];
  headline: Txt;
  why: Txt;
  /** The text of the button, when there is something to say yes to. */
  cta: Txt | null;
  /** What the team reads when the shop says yes. */
  request: string | null;
}

const fmt = (c: number) => `$${Math.round(c / 100)}`;

export function adsPitch(input: {
  ceilingCents: number | null;
  dailyCents: number;
  days: number;
  totalCents: number;
  bookingsToBreakEven: number | null;
  openSlots: number | null;
  feasible: 'yes' | 'tight' | 'no' | 'unknown';
  /** Which of the two figures is missing, so "unknown" can name it. */
  missing?: 'ticket' | 'margin' | null;
}): AdsPitch {
  const { ceilingCents: ceiling, dailyCents: daily, days, totalCents: total } = input;

  if (!ceiling) {
    return {
      state: 'unknown',
      figures: [],
      headline: bi('Chưa tính được ngân sách quảng cáo cho tiệm', 'We cannot size an ad budget for you yet'),
      why: input.missing === 'margin'
        ? bi(
          'Bên em cần biết tiệm trả công thợ bao nhiêu phần trăm thì mới tính được một khách mới để lại bao nhiêu lãi. Chưa có con số đó thì mọi mức chi đều là đoán — bên em không đề xuất kiểu đó.',
          'We need to know what share of a ticket goes to the tech before we can say what a new customer leaves you. Without it any budget is a guess, and we do not put guesses on this screen.')
        : bi(
          'Tiệm chưa đủ lịch hẹn để biết hoá đơn trung bình của khách mới. Chạy vài tuần nữa là bên em tính được, còn bây giờ mọi mức chi đều là đoán.',
          'There are not enough appointments yet to know what a new customer spends. A few more weeks and we can work it out; until then any budget is a guess.'),
      cta: null,
      request: null,
    };
  }

  if (input.feasible === 'no') {
    const need = input.bookingsToBreakEven ?? 0;
    const room = input.openSlots ?? 0;
    return {
      state: 'not-yet',
      figures: [],
      headline: bi('Lúc này chưa nên chạy quảng cáo', 'Now is not the moment to advertise'),
      why: bi(
        `Đợt nhỏ nhất mà còn đo được cần ${need} khách mới hoà vốn, trong khi khung giờ trống của tiệm chỉ còn chỗ cho ${room}. Bỏ tiền lúc này là mua khách không có ghế ngồi. Bên em lấp chỗ trống bằng khách cũ trước — không tốn tiền quảng cáo — rồi mở lại sau.`,
        `The smallest campaign that can still be measured needs ${need} new customers to break even, and your quiet hours only hold ${room}. Spending now buys customers with nowhere to sit. We will fill those gaps with your past customers first — which costs nothing — and come back to ads after.`),
      cta: null,
      request: null,
    };
  }

  const need = input.bookingsToBreakEven;
  const room = input.openSlots;
  return {
    state: 'offer',
    figures: [
      { value: fmt(daily), label: bi('mỗi ngày', 'per day') },
      { value: fmt(total), label: bi(`cả đợt ${days} ngày`, `for ${days} days`) },
      { value: fmt(ceiling), label: bi('tối đa mỗi khách mới', 'max per new customer') },
    ],
    headline: bi('Muốn có khách ngay? Bên em đề xuất chạy thử', 'Want customers now? Here is what we suggest'),
    why: bi(
      `Một khách mới, sau khi trả công thợ, để lại cho tiệm khoảng ${fmt(ceiling)}. Nên chừng nào mỗi khách tốn dưới ${fmt(ceiling)} thì tiệm lãi ngay từ lần đầu họ tới.`
      + (need ? ` Đợt này cần ${need} khách để lấy lại tiền${room ? `, mà khung giờ trống của tiệm còn chỗ cho ${room}` : ''}.` : '')
      + ' Bên em chạy, theo dõi từng ngày, và tự tắt nếu vượt ngưỡng.',
      `A new customer leaves you about ${fmt(ceiling)} after the tech is paid. So as long as one costs less than ${fmt(ceiling)}, you are ahead on their very first visit.`
      + (need ? ` This run needs ${need} of them to get the money back${room ? `, and your quiet hours have room for ${room}` : ''}.` : '')
      + ' We run it, watch it daily, and switch it off ourselves if it goes over the line.'),
    cta: bi(`Đồng ý — chạy thử ${days} ngày`, `Yes — run the ${days}-day test`),
    request: `Tiệm đồng ý chạy quảng cáo thử: ${fmt(daily)}/ngày × ${days} ngày (~${fmt(total)}) · ngưỡng ${fmt(ceiling)}/khách mới`,
  };
}
