/**
 * THE AD CARD WHEN THE SHOP HAS ALMOST NO DATA — which is every first meeting.
 *
 * WHAT WAS WRONG
 *
 * With no measured ticket and no priced menu, the budget card rendered one
 * sentence and nothing else: "Chưa tính được ngân sách quảng cáo cho tiệm.
 * Tiệm nhập bảng giá dịch vụ vào hệ thống là bên em tính được ngân sách ngay."
 *
 * True, and useless at the exact moment it matters most. A salon owner is
 * shown this screen on the first call — before setup, before a single booking
 * — and asking for an ad plan is usually the FIRST thing she asks for. What she
 * read was a dead end with homework attached, and the agency had nothing to
 * talk about on the call it was trying to win.
 *
 * The mistake was treating one missing number as a missing plan. It is not.
 * Without the ticket the card cannot state a break-even, and a break-even is
 * one line of a plan with six:
 *
 *   - WHERE the money goes            — from the trade and the shop's channels
 *   - WHAT the ad sells               — from the menu, or from the trade's book
 *   - WHICH DAYS it runs              — from booking lead time, or the default
 *   - HOW LONG before it can be read  — structural: a fortnight, 8 bookings
 *   - WHEN TO STOP                    — the rule works before the number does
 *   - WHAT IS MISSING, and what each missing thing unlocks
 *
 * Five of those six are available with no data whatsoever. So the card now
 * always carries a plan, and the missing ticket becomes the LAST step of a
 * roadmap rather than a locked door in front of the first.
 *
 * THE LINE THIS FILE WILL NOT CROSS
 *
 * It still does not invent this salon's economics. The starter budget is the
 * smallest measurable spend — a structural floor, not a number derived from a
 * made-up ticket — and any figure that depends on the ticket stays absent
 * until the ticket exists. Where a published price band for the trade exists it
 * is offered as a HINT BESIDE AN INPUT, sourced and leaning low, so the owner
 * can confirm or correct it in one tap. It is never silently substituted for
 * her own number, because a fabricated break-even is the one output of this
 * whole system that could lose her real money.
 */

import { bi, viOf, enOf, type Txt } from './i18n';

// ---- what one visit costs, per trade: a hint, never a substitute -----------

/**
 * Published mid-market US price bands for the service a first-time customer
 * most often books in each trade, as of 2026.
 *
 * WHERE THESE COME FROM, AND WHY SO FEW TRADES ARE LISTED
 *
 * Only trades with a defensible published band for a WHOLE TYPICAL VISIT are
 * here. Compiled from per-service cost guides citing the Professional Beauty
 * Association and booking-platform rate data (salonsrated.com/guides/
 * salon-prices-2026, airtasker.com/us/costs/manicure — median manicure $37,
 * gel $30-70, basic $20-55; women's cut $35-90, single-process colour
 * $60-120).
 *
 * `lowCents` is the number the hint shows, and it is the BOTTOM of the band on
 * purpose. The ticket sets the ceiling on what a customer may cost, so an
 * over-stated ticket licenses over-spending — exactly the failure this system
 * exists to prevent. Under-stating it only makes the first campaign smaller
 * than it had to be, which costs a fortnight and no money.
 *
 * A trade absent from this table gets NO number. Lash refills, facials,
 * massage packages and PMU touch-ups all have a real typical visit and this
 * file has no sourced figure for it, so the card asks instead of guessing.
 * Adding a trade here means finding the citation first and putting it in this
 * comment — not estimating from the ones above.
 */
export const TICKET_BAND: Record<string, { lowCents: number; highCents: number; service: Txt }> = {
  SALON: { lowCents: 3000, highCents: 7000, service: bi('một lần làm nail (gel/bột)', 'one nail visit (gel or acrylic)') },
  NAIL: { lowCents: 3000, highCents: 7000, service: bi('một lần làm nail (gel/bột)', 'one nail visit (gel or acrylic)') },
  HAIR: { lowCents: 3500, highCents: 9000, service: bi('một lần cắt (nữ)', "one women's cut") },
};

export interface TicketHint {
  lowCents: number;
  highCents: number;
  service: Txt;
  /** Said out loud on the screen, so the band can never read as measured. */
  note: Txt;
}

/** The published band for this trade, or null when there is no sourced one. */
export function ticketHint(industry: string | null | undefined, money: (c: number) => string): TicketHint | null {
  const band = TICKET_BAND[String(industry ?? 'SALON').toUpperCase()];
  if (!band) return null;
  return {
    lowCents: band.lowCents,
    highCents: band.highCents,
    service: band.service,
    note: bi(
      `Tiệm cùng ngành ở Mỹ thường thu ${money(band.lowCents)}–${money(band.highCents)} cho ${viOf(band.service)}. Đây là mức chung của thị trường, KHÔNG phải số của tiệm — tiệm sửa lại cho đúng là mọi con số bên dưới thành số thật của tiệm.`,
      `Shops in your trade in the US usually take ${money(band.lowCents)}–${money(band.highCents)} for ${enOf(band.service)}. That is a market band, NOT your number — correct it and every figure below becomes yours.`),
  };
}

// ---- the one thing the card asks for ---------------------------------------

export interface TicketAsk {
  /** The question, as a person would ask it out loud. */
  question: Txt;
  /** What it unlocks, in one line — the reason to bother answering. */
  unlocks: Txt;
  /** The published band, when there is one to offer. */
  hint: TicketHint | null;
  /** Where the number lives once typed, so the owner can change it later. */
  where: Txt;
}

export function ticketAsk(hint: TicketHint | null): TicketAsk {
  return {
    question: bi(
      'Một lần khách tới tiệm, tiệm thu khoảng bao nhiêu?',
      'What does one customer visit usually bring in?'),
    unlocks: bi(
      'Có con số này là bên em tính được ngay: mỗi khách mới tối đa được phép tốn bao nhiêu, và bao nhiêu khách là huề vốn. Không cần chờ có lịch hẹn.',
      'With that one number we can say straight away what a new customer may cost at most, and how many of them pay the campaign back. No need to wait for bookings.'),
    hint,
    where: bi(
      'Nhập bảng giá dịch vụ (Dịch vụ → thêm giá) là bên em tự tính, không phải khai tay lần nào nữa.',
      'Enter your service prices (Services → add a price) and we work it out ourselves from then on.'),
  };
}

// ---- the roadmap -----------------------------------------------------------

/**
 * ONE STEP PER MISSING FACT, IN THE ORDER THAT BUYS THE MOST PER MINUTE.
 *
 * Not a settings checklist. Each step says what it UNLOCKS on this card, so
 * the owner is choosing between outcomes rather than being handed chores — and
 * the agency can read the same list as "what to ask for on the call".
 *
 * Steps already satisfied stay on the list, marked done. A roadmap that hides
 * what is finished cannot show progress, and progress is the only reason
 * anybody returns to a list like this.
 */
export interface DataStep {
  key: string;
  /** What to do, imperative, in the shop's words. */
  title: Txt;
  /** Which screen, so nobody has to hunt. */
  where: Txt;
  /** What this one turns on. The point of the step. */
  unlocks: Txt;
  minutes: number;
  done: boolean;
  /** Who does it. The shop types its own prices; we connect the profiles. */
  who: 'shop' | 'lumio';
}

export function dataRoadmap(input: {
  hasTicket: boolean;
  ticketMeasured: boolean;
  hasMenuPrices: boolean;
  marginEntered: boolean;
  hasHours: boolean;
  hasStaff: boolean;
  googleConnected: boolean;
  pageConnected: boolean;
}): DataStep[] {
  const steps: DataStep[] = [
    {
      key: 'menu-prices',
      title: bi('Nhập bảng giá dịch vụ', 'Enter your service prices'),
      where: bi('Dịch vụ → sửa từng dịch vụ, điền giá và thời gian làm', 'Services → edit each one, fill in price and duration'),
      unlocks: bi(
        'Ngân sách quảng cáo và ngưỡng hoà vốn mỗi khách mới — đây là bước mở khoá nhiều nhất.',
        'The ad budget and the break-even limit per new customer — this one unlocks the most.'),
      minutes: 15,
      done: input.hasMenuPrices,
      who: 'shop',
    },
    {
      key: 'commission',
      title: bi('Khai tỷ lệ ăn chia thợ', 'Set the tech commission split'),
      where: bi('Nhân sự → sửa thợ → tỷ lệ hoa hồng', 'Staff → edit a tech → commission rate'),
      unlocks: bi(
        'Lãi thật mỗi khách để lại. Chưa khai thì bên em đang tạm tính theo mức chung của ngành.',
        'The real profit a visit leaves behind. Until then we are using the trade average.'),
      minutes: 5,
      done: input.marginEntered,
      who: 'shop',
    },
    {
      key: 'hours',
      title: bi('Điền giờ mở cửa từng ngày', 'Fill in opening hours for each day'),
      where: bi('Cài đặt → giờ mở cửa', 'Settings → opening hours'),
      unlocks: bi(
        'Số chỗ trống hai tuần tới — để biết tiệm có ghế cho khách mới ngồi hay không.',
        'How many free visits the next fortnight holds — whether there are chairs for the new customers.'),
      minutes: 3,
      done: input.hasHours,
      who: 'shop',
    },
    {
      key: 'staff',
      title: bi('Thêm danh sách thợ', 'Add your techs'),
      where: bi('Nhân sự → thêm thợ', 'Staff → add a tech'),
      unlocks: bi(
        'Số chỗ trống tính đúng theo số ghế thật thay vì suy từ ngày đông nhất.',
        'Free capacity counted from real chairs instead of inferred from the busiest day.'),
      minutes: 5,
      done: input.hasStaff,
      who: 'shop',
    },
    {
      key: 'google',
      title: bi('Nối Google Business Profile', 'Connect the Google Business Profile'),
      where: bi('Kết nối → Google — bên em làm, tiệm chỉ cần bấm cho phép', 'Connections → Google — we do it, you just approve'),
      unlocks: bi(
        'Biết khách đang tìm tiệm bằng từ gì, và đo được thứ hạng trên bản đồ.',
        'What people are searching to find you, and where you stand on the map.'),
      minutes: 2,
      done: input.googleConnected,
      who: 'lumio',
    },
    {
      key: 'page',
      title: bi('Nối Fanpage / Instagram', 'Connect the Page and Instagram'),
      where: bi('Kết nối → Facebook — bên em làm', 'Connections → Facebook — we do it'),
      unlocks: bi(
        'Đăng bài và chạy quảng cáo Meta ngay trong hệ thống, không phải đưa qua lại.',
        'Posting and Meta ads run from here instead of being handed back and forth.'),
      minutes: 2,
      done: input.pageConnected,
      who: 'lumio',
    },
  ];
  // Done first would bury the work. Undone first, original order within each
  // half, so the top of the list is always the next thing to do.
  return [...steps.filter((s) => !s.done), ...steps.filter((s) => s.done)];
}

/** How near the card is to a fully measured recommendation. */
export function roadmapProgress(steps: DataStep[]): { done: number; total: number; minutesLeft: number } {
  const done = steps.filter((s) => s.done).length;
  return {
    done,
    total: steps.length,
    minutesLeft: steps.filter((s) => !s.done).reduce((sum, s) => sum + s.minutes, 0),
  };
}

// ---- how sure the card is --------------------------------------------------

/**
 * WHAT THE OWNER IS LOOKING AT, IN ONE WORD.
 *
 * Three tiers, and the card shows which one it is on rather than presenting
 * all three with the same confidence. An estimate dressed as a measurement is
 * how a screen loses an owner permanently — she finds out later, by being
 * wrong with her own money, and then nothing else on the screen is believed.
 */
export type AdsConfidence = 'measured' | 'estimated' | 'starter';

export function confidenceOf(input: { ticketMeasured: boolean; hasTicket: boolean }): AdsConfidence {
  if (input.ticketMeasured) return 'measured';
  if (input.hasTicket) return 'estimated';
  return 'starter';
}

export function confidenceLabel(c: AdsConfidence): Txt {
  if (c === 'measured') return bi('Tính từ lịch hẹn thật của tiệm', 'Worked out from your real bookings');
  if (c === 'estimated') return bi('Tạm tính từ bảng giá của tiệm', 'Estimated from your own price list');
  return bi('Đề xuất khởi động — chưa có số của tiệm', 'Starter plan — none of your numbers yet');
}
