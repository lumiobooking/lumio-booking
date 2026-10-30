/**
 * THE HOTLINE MAY ONLY SAY WHAT THE BOOK SAYS.
 *
 * Read off the test calls of 30 Oct 2026 (Oakville Nice One Nails, Saigon
 * Spa & Tattoo):
 *  - "Tenny's all set for Thursday November 5th at 7 PM, and a text
 *    confirmation is on the way!" — and nothing was booked. The model said
 *    it; no tool had succeeded.
 *  - A new number heard in pieces ("604", "77", "911 8") was read back as
 *    "604-279-1188" — digits that were never said — and once only as
 *    "ending in 7, 7". The booking went under a number that is not the
 *    customer's, so nobody could find it on the next call.
 *
 * Pure (booking-guards.spec.ts).
 */

/** Did the assistant tell the caller something is booked / moved / cancelled / changed? */
export function claimsDone(reply: string): boolean {
  const s = String(reply ?? '');
  return /\b(you(?:'|’| a)re (?:all )?set|(?:is|are|has been|have been|got you|now) (?:booked|rescheduled|moved|cancell?ed)|i(?:'|’)?(?:ve| have) (?:booked|moved|rescheduled|cancell?ed|added|changed)|all set for|confirmation (?:is |text is )?on (?:the|its) way|booking is (?:confirmed|done|made)|(?:is|will be) now (?:with|on) )/i.test(s)
    || /(đã đặt (?:xong|lịch|cho)|đặt xong|đã (?:dời|đổi|huỷ|hủy) (?:lịch|xong|sang)|tin nhắn xác nhận (?:sẽ|đang)|đã xếp (?:thợ|cho))/i.test(s);
}

/** Every digit in what was said, in order ("6, 0, 4 — 2 7 9" → "604279"). */
export function digitsOf(text: string): string {
  return String(text ?? '').replace(/\D/g, '');
}

/** The national digits of a number (+1 604 279 8777 → 6042798777). */
export function nationalDigits(e164: string, dial = '1'): string {
  const d = digitsOf(e164);
  return dial && d.startsWith(dial) && d.length > 10 ? d.slice(dial.length) : d;
}

/**
 * Was the number this booking goes under actually read back to the caller?
 *  - the caller's own number (caller ID): its last four digits;
 *  - ANY OTHER number (one the caller said): every digit of it, because that
 *    is the number speech recognition gets wrong.
 */
export function readBackOk(o: { said: string; phone: string; callerPhone: string; dial?: string }): boolean {
  const said = digitsOf(o.said);
  const mine = nationalDigits(o.phone, o.dial);
  const caller = nationalDigits(o.callerPhone ?? '', o.dial);
  if (!mine) return false;
  if (caller && caller.slice(-10) === mine.slice(-10)) return said.includes(mine.slice(-4));
  return said.includes(mine.slice(-10));
}

/** "6, 0, 4 — 2, 7, 9 — 8, 7, 7, 7": how a whole number is read back (groups of 3-3-4 for North America). */
export function spokenNumber(phone: string, dial = '1'): string {
  const d = nationalDigits(phone, dial);
  const one = (x: string) => x.split('').join(', ');
  if (d.length === 10) return `${one(d.slice(0, 3))} — ${one(d.slice(3, 6))} — ${one(d.slice(6))}`;
  return one(d);
}

/**
 * A North-American number that cannot exist (area code or exchange starting
 * with 0 or 1, an N9X area code): a mis-heard number, asked for again.
 */
export function impossibleNanp(phone: string, dial = '1'): boolean {
  if (dial !== '1') return false;
  const d = nationalDigits(phone, dial);
  if (d.length !== 10) return true;
  return /^[01]/.test(d) || d[1] === '9' || /^[01]/.test(d.slice(3));
}

/** Words the caller can type a number with, said when asking for it. */
export function keypadHint(lang: string): string {
  return /^vi/i.test(lang)
    ? 'đọc từng số, hoặc bấm số trên bàn phím rồi bấm dấu thăng (#)'
    : 'say it digit by digit, or type it on your keypad and press the pound key';
}

/** The polite goodbye when the model ended the call without saying one. */
export function goodbyeLine(lang: string, name?: string | null): string {
  const n = String(name ?? '').trim();
  if (/^vi/i.test(lang)) return `Dạ em cảm ơn ${n ? n : 'anh chị'} đã gọi. Chào ${n ? n : 'anh chị'} ạ!`;
  return `Thank you for calling${n ? `, ${n}` : ''}. Goodbye!`;
}

/** Keypad digits as a caller turn the model reads ("(typed on the keypad) 6047798777"); '' when none. */
export function keypadLine(digits: string): string {
  const d = String(digits ?? '').replace(/[^0-9]/g, '');
  return d ? `(typed on the keypad) ${d}` : '';
}

/** Is the assistant asking for a phone number? Then the line listens longer (people pause between digit groups). */
export function asksForNumber(text: string): boolean {
  return /(phone number|the number|your number|her number|his number|digit by digit|keypad|số điện thoại|đọc từng số|bàn phím)/i.test(String(text ?? ''));
}
