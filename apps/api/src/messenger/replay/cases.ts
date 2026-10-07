/**
 * THE REPLAY SUITE — phase 4 of "the bot learns over time".
 *
 * Every time the bot said something wrong to a real customer, the exchange
 * goes here — ANONYMISED (first names changed, phone numbers and emails
 * replaced, no salon names) — with what the guard rails must do with it.
 * replay.spec.ts runs all of them on every change (it is in test:guards, which
 * Render runs on every deploy), so a mistake that once reached a customer can
 * never reach one again unnoticed. Good replies are here too: a guard that
 * starts blocking correct answers is a failure as well.
 *
 * TO ADD A CASE: copy the customer's message and the bot's reply from the
 * inbox, replace names/phones/emails/salon, set `expect`, note where it came
 * from. Nothing else to wire.
 */
import type { GateVerdict } from '../booking-guards';

export interface ReplayCase {
  id: string;
  /** Where it was seen (date · channel · what went wrong). */
  source: string;
  customer: string;
  reply: string;
  bookedNow?: boolean;
  upcoming?: number;
  toolsUsed?: string[];
  expect: GateVerdict;
}

export const CASES: ReplayCase[] = [
  // --- claimed a booking that did not exist ---------------------------------
  {
    id: 'ig-booked-before-name', source: 'Oct 5 2026 · Instagram · "booked in" before name/phone',
    customer: 'Monday 11', reply: 'Perfect, Monday at 11:00 AM is booked in! What’s your first name?', expect: 'booked',
  },
  {
    id: 'vi-booked-before-phone', source: 'Oct 2026 · Messenger · VI, chốt lịch khi chưa có SĐT',
    customer: 'thứ 7 3h chiều nha', reply: 'Dạ em đã đặt lịch cho chị thứ Bảy lúc 3h chiều rồi ạ. Chị cho em xin tên nhé?', expect: 'booked',
  },
  {
    id: 'booked-after-create', source: 'good · after create_booking succeeded',
    customer: 'yes', reply: 'You’re all set — Saturday 3:00 PM, gel manicure with Ivy. See you then!', bookedNow: true, expect: 'ok',
  },
  {
    id: 'existing-appointment', source: 'good · customer already on the calendar',
    customer: 'thanks!', reply: 'You’re all set for Friday at 2:00 PM. See you then!', upcoming: 1, expect: 'ok',
  },
  {
    id: 'time-works-ask-contact', source: 'good · the corrected reply from the IG case',
    customer: 'Monday 11', reply: 'Great — 11:00 AM Monday works 👍 What name and phone number should I put it under?', expect: 'ok',
  },
  // --- recap over an unanswered question ------------------------------------
  {
    id: 'recap-skips-question', source: 'Oct 6 2026 · Messenger · asked about the grand opening, got the recap',
    customer: 'When is your grand opening?',
    reply: 'Just to confirm: Saturday Oct 10 at 3:00 PM, gel manicure for Anna, 512-000-0000. Shall I book it?', expect: 'answer-first',
  },
  {
    id: 'answer-then-recap', source: 'good · answer first, then the recap, one message',
    customer: 'Do you have parking?',
    reply: 'Yes — free parking right in front of the salon. Saturday 3:00 PM, gel manicure for Anna, 512-000-0000 — shall I book it?', expect: 'ok',
  },
  {
    id: 'booking-question-answered-by-recap', source: 'good · "can I come at 3pm?" IS answered by the recap',
    customer: 'Can I come at 3pm Saturday?',
    reply: 'Just to confirm: Saturday 3:00 PM, gel manicure for Anna, 512-000-0000. Shall I book it?', expect: 'ok',
  },
  // --- dead-end endings -------------------------------------------------------
  {
    id: 'any-other-questions', source: 'Oct 6 2026 · Messenger · answer ended on "any other questions?"',
    customer: 'how much is a gel full set', reply: 'A gel full set is $55. Any other questions?', expect: 'filler',
  },
  {
    id: 'vi-filler', source: 'Oct 2026 · Messenger · VI, kết bằng "còn thắc mắc gì không"',
    customer: 'giá sơn gel bao nhiêu', reply: 'Dạ sơn gel 35$ ạ. Chị còn thắc mắc gì không ạ?', expect: 'filler',
  },
  {
    id: 'customer-not-ready', source: 'good · customer is wrapping up, "message us any time" is right',
    customer: 'ok thanks, I’ll think about it', reply: 'Of course! Feel free to reach out any time.', expect: 'ok',
  },
  {
    id: 'answer-plus-next-step', source: 'good · answer + the next step',
    customer: 'how much is a gel full set', reply: 'A gel full set is $55 😊 Which day works best for you?', expect: 'ok',
  },
  // --- vague availability ------------------------------------------------------
  {
    id: 'plenty-of-slots', source: 'Oct 5 2026 · Instagram · "plenty of slots" with no time',
    customer: 'any time tomorrow?', reply: 'Yes, we have plenty of slots tomorrow!', expect: 'vague',
  },
  {
    id: 'vi-con-nhieu-cho', source: 'Oct 2026 · Messenger · VI "còn nhiều chỗ" không nêu giờ',
    customer: 'mai còn chỗ không em', reply: 'Dạ mai tiệm còn nhiều chỗ lắm ạ!', expect: 'vague',
  },
  {
    id: 'concrete-times', source: 'good · 2–3 concrete times',
    customer: 'any time tomorrow?', reply: 'Tomorrow I have 10:00 AM, 1:30 PM or 4:00 PM — which suits you?', expect: 'ok',
  },
];
