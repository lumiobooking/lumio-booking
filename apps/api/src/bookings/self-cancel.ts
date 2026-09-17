/**
 * May this customer cancel this appointment themselves, right now?
 *
 * WHY A SECOND FILE AND NOT A FLAG ON canSelfReschedule
 *
 * Moving and cancelling look alike and are not. A move hands the slot back
 * and takes another one, so the salon keeps the customer and the revenue; a
 * cancellation hands the slot back and keeps nothing. The salon may well want
 * to allow one and not the other, and a salon that allows both may want
 * different notice for each. One function with a boolean would have forced
 * the two policies to share every number they have.
 *
 * What is carried over deliberately: the rule is a pure function, decided from
 * numbers, and it returns the SENTENCE as well as the verdict — because the
 * bots must not improvise a reason. "That's too close to your appointment",
 * "our policy doesn't allow that" and "you paid a deposit" are three different
 * promises to a customer, and only one of them is ever true.
 *
 * THE DEPOSIT IS A HARD STOP, ON PURPOSE
 *
 * Cancelling an appointment refunds what was paid on it. A no-show deposit
 * exists precisely so that a late cancellation costs something — so a bot that
 * cancels and refunds on request, from a phone conversation, quietly undoes
 * the policy the salon set up. Those go to a person. The bot says so and
 * offers a callback; it does not decide who keeps the money.
 */

export interface CancelWindow {
  /** Salon setting: is customer self-service cancelling on at all? */
  enabled: boolean;
  /** Policy: hours of notice before the appointment. */
  noticeHours: number;
}

export interface CancelAsk {
  now: number;
  /** Appointment start, epoch ms. */
  startMs: number;
  /** False for cancelled, completed, no-show. */
  live: boolean;
  /** True when money has actually been taken for this appointment. */
  hasPaidDeposit: boolean;
}

export type CancelRefusalCode = 'disabled' | 'not-live' | 'too-late' | 'deposit';

export interface CancelDecision {
  allowed: boolean;
  code: CancelRefusalCode | 'ok';
  /** Said to the customer, in Vietnamese, already written. */
  say: string;
  /** For the log and the staff-facing note. */
  detail: string;
}

const HOUR = 3_600_000;
const hrs = (ms: number) => Math.max(1, Math.round(ms / HOUR));

export function canSelfCancel(w: CancelWindow, a: CancelAsk): CancelDecision {
  if (!w.enabled) {
    return {
      allowed: false, code: 'disabled',
      say: 'Tiệm đang để việc huỷ lịch cho nhân viên xử lý. Em ghi nhận và báo nhân viên gọi lại cho anh/chị ngay nhé.',
      detail: 'self-cancel disabled for this tenant',
    };
  }
  if (!a.live) {
    return {
      allowed: false, code: 'not-live',
      say: 'Lịch hẹn này đã kết thúc hoặc đã huỷ trước đó rồi ạ, nên không cần huỷ nữa. Anh/chị cần em hỗ trợ gì thêm không?',
      detail: 'appointment is not in an actionable state',
    };
  }
  // Money first: a customer who paid deserves the deposit answer, not the
  // notice answer, even when both would refuse. Telling them "too close to
  // your appointment" when the real subject is their money sends them back to
  // the salon angry about the wrong thing.
  if (a.hasPaidDeposit) {
    return {
      allowed: false, code: 'deposit',
      say: 'Lịch này đã thanh toán/đặt cọc nên phần hoàn tiền phải do nhân viên xác nhận ạ. Em ghi nhận yêu cầu huỷ và nhân viên sẽ gọi lại cho anh/chị ngay để xử lý nhé.',
      detail: 'appointment has a paid payment; refund is a human decision',
    };
  }
  const noticeMs = a.startMs - a.now;
  if (noticeMs < w.noticeHours * HOUR) {
    const left = noticeMs > 0 ? `còn ${hrs(noticeMs)} tiếng nữa là tới giờ hẹn` : 'giờ hẹn đã qua';
    return {
      allowed: false, code: 'too-late',
      say: `Lịch này ${left}, sát quá nên em không tự huỷ được (tiệm cần báo trước ${w.noticeHours} tiếng). Em báo nhân viên gọi lại cho anh/chị ngay nhé.`,
      detail: `only ${hrs(noticeMs)}h notice; salon requires ${w.noticeHours}h`,
    };
  }
  return {
    allowed: true, code: 'ok',
    say: '', // the confirmation is written by the caller, with the real appointment in it
    detail: `allowed: ${hrs(noticeMs)}h notice`,
  };
}
