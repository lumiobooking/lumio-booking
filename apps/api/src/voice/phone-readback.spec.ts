/**
 * The owner's rule for the AI hotline (Oct 2026): the caller is not made to
 * read out a phone number, but the read-back before booking says "under the
 * number ending in 0, 1, 4, 7" — they confirm it or give another — and only
 * then is the booking made.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { bookingPhone, last4, spokenLast4 } from './phone-readback';

const norm = (raw: string) => {
  const d = raw.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return '';
};

describe('last four digits, said one at a time', () => {
  it('reads digits singly so nobody hears "one hundred forty-seven"', () => {
    expect(last4('+15125550147')).toBe('0147');
    expect(spokenLast4('+15125550147')).toBe('0, 1, 4, 7');
    expect(spokenLast4('')).toBe('');
    expect(spokenLast4('12')).toBe('');
  });
});

describe('bookingPhone', () => {
  it('caller ID, confirmed → booked under the caller ID', () => {
    expect(bookingPhone({ given: '', callerPhone: '+15125550147', confirmed: true, norm })).toEqual({ ok: true, phone: '+15125550147' });
  });

  it('not confirmed → not booked, and told to read back the last four digits', () => {
    const d = bookingPhone({ given: undefined, callerPhone: '+15125550147', confirmed: undefined, norm });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.say).toContain('ending in 0, 1, 4, 7');
    // "yes" as a string is not the boolean the tool asks for
    expect(bookingPhone({ given: '', callerPhone: '+15125550147', confirmed: 'yes', norm }).ok).toBe(false);
  });

  it('a different number the caller gave wins, and its own digits are the ones read back', () => {
    const d = bookingPhone({ given: '(469) 555-0199', callerPhone: '+15125550147', confirmed: false, norm });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.say).toContain('ending in 0, 1, 9, 9');
    expect(bookingPhone({ given: '(469) 555-0199', callerPhone: '+15125550147', confirmed: true, norm })).toEqual({ ok: true, phone: '+14695550199' });
  });

  it('a garbled number is asked for again, never replaced by the caller ID', () => {
    const d = bookingPhone({ given: '469 55', callerPhone: '+15125550147', confirmed: true, norm });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.say).toMatch(/not a complete phone number/);
  });

  it('hidden caller ID and no number given → ask for a callback number', () => {
    const d = bookingPhone({ given: '', callerPhone: '', confirmed: true, norm });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.say).toMatch(/callback number/);
  });
});

describe('the hotline prompt and tools', () => {
  const src = readFileSync(join(__dirname, 'voice.service.ts'), 'utf8');

  it('no longer tells the assistant to skip the number', () => {
    expect(src).not.toContain('The caller\'s phone number is already known — do not ask for it.');
    expect(src).not.toContain('You already have it — do NOT ask for their phone number; use it when booking.');
  });

  it('the read-back includes the last four digits, in both booking scripts', () => {
    expect(src).toMatch(/under the number ending in 0, 1, 4, 7 — is that right\?/);
    expect(src).toMatch(/INCLUDING "under the number ending in" and the phone's last four digits/);
  });

  it('both create_booking tools require phoneConfirmed and both paths go through bookingPhone', () => {
    expect((src.match(/'phoneConfirmed'\]/g) || []).length).toBe(2);
    expect((src.match(/bookingPhone\(\{ given: input\.customerPhone, callerPhone, confirmed: input\.phoneConfirmed/g) || []).length).toBe(2);
  });
});
