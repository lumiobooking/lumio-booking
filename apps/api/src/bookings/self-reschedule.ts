/**
 * May this customer move this appointment themselves, right now?
 *
 * WHY THE RULE LIVES ALONE, IN A PURE FUNCTION
 *
 * Two front doors ask it — Messenger and the AI hotline — and a third (the
 * self-service link in the confirmation email) will. A rule copied into each
 * of them is a rule that will disagree with itself: the version that lets a
 * customer move an appointment ten minutes before it starts is the one nobody
 * remembered to update, and the salon finds out when a technician is standing
 * in an empty chair.
 *
 * So the decision is made once, here, from numbers, and returns a REASON as
 * well as a verdict. The bots do not get to improvise an explanation — they
 * are handed the sentence, because "I'm sorry, that's too close to your
 * appointment" and "I'm sorry, our policy doesn't allow that" are different
 * promises and only one of them is true.
 *
 * WHAT IS A POLICY AND WHAT IS ARITHMETIC
 *
 * Two of the three limits are arithmetic: the appointment must still be live,
 * and the new time must be far enough ahead that the salon could have accepted
 * it as a fresh booking (`minLeadHours`, which the salon already set).
 *
 * The third is a policy — how close to the ORIGINAL time a customer may still
 * change it — and there is no number in any data set that decides it. Booking
 * into an empty slot an hour from now costs the salon nothing; vacating a
 * committed slot an hour from now leaves a hole they cannot fill, so the two
 * are not symmetric and `minLeadHours` cannot be reused for it. It defaults to
 * 24 hours because that is the common convention in the trade, it is labelled
 * as a convention rather than dressed as a finding, and one number in settings
 * changes it.
 */

export interface RescheduleWindow {
  /** Salon setting: is customer self-service rescheduling on at all? */
  enabled: boolean;
  /** Policy: hours of notice before the ORIGINAL time. */
  noticeHours: number;
  /** The salon's normal booking lead time, applied to the NEW time. */
  minLeadHours: number;
  /** Policy: how many times one appointment may be self-moved. */
  maxMoves: number;
}

export interface RescheduleAsk {
  now: number;
  /** Current appointment start, epoch ms. */
  currentStartMs: number;
  /** Requested new start, epoch ms. NaN when unparseable. */
  newStartMs: number;
  /** How far ahead the salon takes bookings at all. */
  maxAdvanceDays: number;
  /** Self-moves already made on this appointment. */
  movesSoFar: number;
  /** False for cancelled, completed, no-show. */
  live: boolean;
}

export type RefusalCode =
  | 'disabled' | 'not-live' | 'bad-time' | 'too-late' | 'too-soon'
  | 'too-far' | 'too-many' | 'same-time';

export interface RescheduleDecision {
  allowed: boolean;
  code: RefusalCode | 'ok';
  /** Said to the customer, in Vietnamese, already written. */
  say: string;
  /** For the log and the staff-facing note. */
  detail: string;
}

const HOUR = 3_600_000;
const hrs = (ms: number) => Math.max(1, Math.round(ms / HOUR));

export function canSelfReschedule(w: RescheduleWindow, a: RescheduleAsk): RescheduleDecision {
  if (!w.enabled) {
    return {
      allowed: false, code: 'disabled',
      say: 'Tiệm đang để việc đổi lịch cho nhân viên xử lý. Em báo lại để nhân viên gọi cho anh/chị sắp xếp nhé.',
      detail: 'self-reschedule disabled for this tenant',
    };
  }
  if (!a.live) {
    return {
      allowed: false, code: 'not-live',
      say: 'Lịch hẹn này đã kết thúc hoặc đã huỷ nên không đổi được. Anh/chị muốn đặt một lịch mới không ạ?',
      detail: 'appointment is not in an actionable state',
    };
  }
  if (!Number.isFinite(a.newStartMs)) {
    return {
      allowed: false, code: 'bad-time',
      say: 'Em chưa rõ anh/chị muốn dời sang ngày giờ nào ạ?',
      detail: 'new start time could not be parsed',
    };
  }
  if (a.newStartMs === a.currentStartMs) {
    return {
      allowed: false, code: 'same-time',
      say: 'Giờ đó chính là giờ hẹn hiện tại của anh/chị rồi ạ. Anh/chị muốn đổi sang giờ nào khác không?',
      detail: 'requested time equals the current time',
    };
  }

  // Notice before the ORIGINAL time. Checked before the new time, because a
  // customer who has already missed the window cannot fix it by picking a
  // later slot, and telling them the wrong reason wastes their next message.
  const noticeMs = a.currentStartMs - a.now;
  if (noticeMs < w.noticeHours * HOUR) {
    const left = noticeMs > 0 ? `còn ${hrs(noticeMs)} tiếng nữa là tới giờ hẹn` : 'giờ hẹn đã qua';
    return {
      allowed: false, code: 'too-late',
      say: `Lịch này ${left}, sát quá nên em không tự đổi được (tiệm cần báo trước ${w.noticeHours} tiếng). Em nhắn nhân viên gọi lại cho anh/chị ngay để sắp xếp nhé.`,
      detail: `only ${hrs(noticeMs)}h notice; salon requires ${w.noticeHours}h`,
    };
  }

  if (a.movesSoFar >= w.maxMoves) {
    return {
      allowed: false, code: 'too-many',
      say: `Lịch này đã đổi ${a.movesSoFar} lần rồi ạ. Để chắc chắn, em nhờ nhân viên gọi xác nhận trực tiếp với anh/chị nhé.`,
      detail: `already moved ${a.movesSoFar} times; limit ${w.maxMoves}`,
    };
  }

  // The new time must clear the same lead the salon requires of a fresh
  // booking. Anything less would let a reschedule buy a slot the booking page
  // would have refused a minute earlier.
  const leadMs = a.newStartMs - a.now;
  if (leadMs < w.minLeadHours * HOUR) {
    return {
      allowed: false, code: 'too-soon',
      say: `Tiệm nhận lịch sớm nhất là trước ${w.minLeadHours} tiếng, nên giờ đó gấp quá ạ. Anh/chị chọn giúp em một khung muộn hơn nhé?`,
      detail: `new time is ${hrs(leadMs)}h away; salon requires ${w.minLeadHours}h lead`,
    };
  }
  if (leadMs > a.maxAdvanceDays * 24 * HOUR) {
    return {
      allowed: false, code: 'too-far',
      say: `Tiệm chỉ nhận lịch trước tối đa ${a.maxAdvanceDays} ngày thôi ạ. Anh/chị chọn giúp em ngày gần hơn nhé?`,
      detail: `new time is beyond the ${a.maxAdvanceDays}-day booking horizon`,
    };
  }

  return {
    allowed: true, code: 'ok',
    say: '', // the confirmation is written by the caller, with the real time in it
    detail: `allowed: ${hrs(noticeMs)}h notice, new time ${hrs(leadMs)}h away, move ${a.movesSoFar + 1}/${w.maxMoves}`,
  };
}
