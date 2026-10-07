/**
 * Runs every real failure (and every known-good reply) in replay/cases.ts
 * through the booking guard rails. See cases.ts for how to add one.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { CASES } from './cases';
import { gateVerdict } from '../booking-guards';
import { isUnknownReply } from '../knowledge-gaps';
import { nudgeKindFor } from '../followup';

describe('replay: real conversations through the guard rails', () => {
  it.each(CASES.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    expect(gateVerdict({ customerText: c.customer, reply: c.reply, bookedNow: c.bookedNow, upcoming: c.upcoming, toolsUsed: c.toolsUsed })).toBe(c.expect);
  });

  it('every case is anonymised (no real-looking phone numbers or emails)', () => {
    for (const c of CASES) {
      expect(`${c.customer} ${c.reply}`).not.toMatch(/[\w.+-]+@[\w-]+\.\w+/);
      expect(`${c.customer} ${c.reply}`.replace(/512-000-0000/g, '')).not.toMatch(/\d{3}[-. ]\d{3}[-. ]\d{4}/);
    }
  });

  it('covers every gate, and good replies too', () => {
    const seen = new Set(CASES.map((c) => c.expect));
    for (const v of ['ok', 'booked', 'answer-first', 'filler', 'vague']) expect(seen.has(v as never)).toBe(true);
  });
});

describe('replay: the other learning hooks', () => {
  it('"I’ll check with the salon" is recorded as a question the bot could not answer', () => {
    expect(isUnknownReply('Let me check with the salon and get back to you.')).toBe(true);
    expect(isUnknownReply('Dạ để em hỏi lại tiệm rồi báo chị nhé')).toBe(true);
    expect(isUnknownReply('A gel full set is $55.')).toBe(false);
  });
  it('a quiet customer is nudged for the step they stopped at', () => {
    expect(nudgeKindFor('Saturday 3:00 PM, gel manicure for Anna — shall I book it?')).toBe('confirm');
    expect(nudgeKindFor('What name and phone number should I put it under?')).toBe('contact');
    expect(nudgeKindFor('Tomorrow I have 10:00, 1:30 or 4:00 — which works for you?')).toBe('time');
  });
});

describe('replay: the verdict matches the live agent', () => {
  // gateVerdict mirrors runAgent's first-pass gates. If runAgent's conditions
  // change, this fails so both are updated together.
  const src = readFileSync(join(__dirname, '..', 'messenger.service.ts'), 'utf8');
  it('same conditions, same order', () => {
    const i1 = src.indexOf('&& claimsBooked(text)');
    const i2 = src.indexOf('asksQuestion(userText) && !aboutTheBooking(userText) && isBookingRecap(text) && !answersBeforeRecap(text)');
    const i3 = src.indexOf('!customerWrappingUp(userText) && endsOnFiller(text)');
    const i4 = src.indexOf('!vagueRetried && vagueAvailability(text)');
    expect([i1, i2, i3, i4].every((i) => i > 0)).toBe(true);
    expect(i1 < i2 && i2 < i3 && i3 < i4).toBe(true);
  });
});
