import { bi, type Txt } from './i18n';

/**
 * The one card that answers "what am I paying you for" — on the SALON's screen.
 *
 * WHY IT IS ON THE CLIENT'S SIDE AT ALL
 *
 * A shop that hires an agency for ads wants results now and cannot follow the
 * long argument about compounding content. Handing it the arithmetic instead
 * ends the argument: this is what went out, this is what came back, this is
 * the line under which the money makes sense. An owner who can see that line
 * stops asking whether the ads work, because she can see it herself — and an
 * agency that shows it is an agency whose invoice does not need defending.
 *
 * THE LINE THAT IS NOT CROSSED, AGAIN
 *
 * The customers counted here are the ones whose FIRST visit was booked
 * through a paid channel — Google or Meta — not every new customer of the
 * month. Dividing the ad spend by every new face in the shop would produce a
 * flattering number that includes the sign outside and the friend who
 * recommended them, and the client would make a spending decision on it. The
 * whole-shop figure travels beside it, clearly labelled as the wider picture,
 * so nobody has to choose between honesty and context.
 *
 * The channel itself comes from what the customer picked when booking, which
 * is imperfect and stated as imperfect. A number with its weakness printed on
 * it is a number a client can trust; the same number presented as certainty
 * is the one that ends the relationship in month four.
 */

export type AdsVerdict = 'good' | 'tight' | 'over' | 'early' | 'no-ceiling';

export interface AdsReceipt {
  spendCents: number;
  /** New customers whose first booking came through a paid channel. */
  fromAds: number;
  /** Every new customer this month — context, never the divisor. */
  newTotal: number;
  /** Spend ÷ fromAds. Null until there is something to divide by. */
  perCustomerCents: number | null;
  /** The most one may cost before the campaign burns money. */
  ceilingCents: number | null;
  verdict: AdsVerdict;
  headline: Txt;
  /** The honest footnote about where the channel figure comes from. */
  caveat: Txt;
}

const fmt = (c: number) => `$${Math.round(c / 100)}`;
/** Below this many attributed customers, a cost-per-customer is noise. */
const READABLE = 3;

export function adsReceipt(input: {
  spendCents: number;
  fromAds: number;
  newTotal: number;
  ceilingCents: number | null;
}): AdsReceipt | null {
  const spend = Math.max(0, Math.round(input.spendCents || 0));
  // No spend, no card. A month with no ads is not a month with a bad result,
  // and an empty receipt on the client's screen invites exactly that reading.
  if (spend <= 0) return null;

  const fromAds = Math.max(0, Math.round(input.fromAds || 0));
  const newTotal = Math.max(0, Math.round(input.newTotal || 0));
  const ceiling = input.ceilingCents && input.ceilingCents > 0 ? Math.round(input.ceilingCents) : null;
  const per = fromAds >= READABLE ? Math.round(spend / fromAds) : null;

  let verdict: AdsVerdict;
  let headline: Txt;
  if (per === null) {
    verdict = 'early';
    headline = bi(
      `Đã chi ${fmt(spend)} tháng này. Mới ${fromAds} khách đặt qua kênh quảng cáo — chưa đủ để nói mỗi khách tốn bao nhiêu, bên em đang theo.`,
      `${fmt(spend)} spent this month. Only ${fromAds} bookings have come through a paid channel so far — too few to say what a customer costs yet. We are watching it.`);
  } else if (ceiling === null) {
    verdict = 'no-ceiling';
    headline = bi(
      `${fmt(spend)} cho ${fromAds} khách mới — ${fmt(per)} mỗi khách. Chưa có tỷ lệ ăn chia thợ nên chưa tính được ngưỡng lãi/lỗ.`,
      `${fmt(spend)} for ${fromAds} new customers — ${fmt(per)} each. The tech pay split has not been entered, so there is no break-even line to compare it against yet.`);
  } else if (per <= ceiling) {
    verdict = 'good';
    headline = bi(
      `${fmt(spend)} cho ${fromAds} khách mới — ${fmt(per)} mỗi khách, dưới ngưỡng ${fmt(ceiling)}. Mỗi khách mới còn lãi khoảng ${fmt(ceiling - per)} ngay lần đầu.`,
      `${fmt(spend)} for ${fromAds} new customers — ${fmt(per)} each, under the ${fmt(ceiling)} line. Each one still leaves about ${fmt(ceiling - per)} in profit on the first visit alone.`);
  } else if (per <= Math.round(ceiling * 1.15)) {
    verdict = 'tight';
    headline = bi(
      `${fmt(spend)} cho ${fromAds} khách mới — ${fmt(per)} mỗi khách, sát ngưỡng ${fmt(ceiling)}. Vẫn lãi nếu khách quay lại, bên em đang siết lại tệp.`,
      `${fmt(spend)} for ${fromAds} new customers — ${fmt(per)} each, right on the ${fmt(ceiling)} line. Still worth it if they come back; we are tightening the targeting.`);
  } else {
    verdict = 'over';
    headline = bi(
      `${fmt(spend)} cho ${fromAds} khách mới — ${fmt(per)} mỗi khách, trên ngưỡng ${fmt(ceiling)}. Bên em đang chỉnh; nếu không kéo xuống được thì sẽ tắt chứ không để chạy tiếp.`,
      `${fmt(spend)} for ${fromAds} new customers — ${fmt(per)} each, above the ${fmt(ceiling)} line. We are fixing it; if it will not come down we switch it off rather than let it run.`);
  }

  return {
    spendCents: spend,
    fromAds,
    newTotal,
    perCustomerCents: per,
    ceilingCents: ceiling,
    verdict,
    headline,
    caveat: bi(
      `Cả tiệm có ${newTotal} khách mới tháng này. Con số ${fromAds} ở trên chỉ tính khách đặt qua kênh quảng cáo — lấy theo nguồn khách chọn lúc đặt lịch, nên có thể thiếu vài người.`,
      `The shop took ${newTotal} new customers this month in total. The ${fromAds} above counts only those who booked through a paid channel — read from the source they picked when booking, so a few will be missed.`),
  };
}
