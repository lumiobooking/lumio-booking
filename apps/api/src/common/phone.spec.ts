/**
 * Phone normalisation, locked.
 *
 * The old rule was "ten digits means the United States". A Vietnamese mobile is
 * written 0912 345 678 — also ten digits — so it became +10912345678: a
 * plausible US number that fails to deliver silently. The salon believes the
 * reminder went out and nobody finds out until the no-show.
 *
 * Every US and Canadian assertion here is the behaviour that existed before the
 * country rules were added, kept verbatim.
 */
import { toE164, dialCodeFor, dialCodeForTimezone } from './phone';

/** The rule as it was written inside voice.service.ts, before it was shared. */
const legacyToE164 = (raw: string): string => {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (t[0] === '+') { const dd = t.slice(1).replace(/\D/g, ''); return dd.length >= 10 ? '+' + dd : ''; }
  const digits = t.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  if (digits.length >= 11) return '+' + digits;
  return '';
};

describe('US and Canadian numbers — unchanged, character for character', () => {
  it.each([
    '5128868189',
    '(512) 886-8189',
    '512-886-8189',
    '+15128868189',
    '15128868189',
    '+14035550123',
    '403 555 0123',
    '',
    '   ',
    'abc',
    '123',
  ])('%s reads the same as it always did', (input) => {
    expect(toE164(input, '1') ?? '').toBe(legacyToE164(input));
  });
});

describe('Vietnamese numbers', () => {
  it('reads a mobile as Vietnamese, not as a fake US number', () => {
    expect(legacyToE164('0912345678')).toBe('+10912345678'); // the bug, for the record
    expect(toE164('0912345678', '84')).toBe('+84912345678');
  });

  it('accepts the spellings one person uses across several visits', () => {
    for (const written of ['0912345678', '0912 345 678', '+84912345678', '84912345678', '912345678']) {
      expect(toE164(written, '84')).toBe('+84912345678');
    }
  });

  it('handles a landline, where the area code is two digits', () => {
    expect(toE164('028 3823 4567', '84')).toBe('+842838234567');
  });

  it('leaves an already-E.164 number alone whatever the default', () => {
    expect(toE164('+15128868189', '84')).toBe('+15128868189');
    expect(toE164('+84912345678', '1')).toBe('+84912345678');
  });

  it('returns null rather than inventing a number', () => {
    expect(toE164('', '84')).toBeNull();
    expect(toE164('abc', '84')).toBeNull();
    expect(toE164(null, '84')).toBeNull();
  });
});

describe('which dial code a salon gets', () => {
  it('uses the country it chose', () => {
    expect(dialCodeFor('VN', null)).toBe('84');
    expect(dialCodeFor('US', null)).toBe('1');
    expect(dialCodeFor('CA', null)).toBe('1');
  });

  it('falls back to the timezone when no country is stated', () => {
    expect(dialCodeForTimezone('Asia/Ho_Chi_Minh')).toBe('84');
    expect(dialCodeForTimezone('America/Los_Angeles')).toBe('1');
  });

  it('defaults to 1, so every salon predating the setting is unaffected', () => {
    expect(dialCodeFor('', '')).toBe('1');
    expect(dialCodeFor(null, null)).toBe('1');
    expect(dialCodeForTimezone(undefined)).toBe('1');
  });
});
