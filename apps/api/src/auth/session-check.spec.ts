import { sessionRefusal, refusalMessage } from './session-check';

const ok = { failed: false, found: true, isActive: true, changedAt: 0 };
const NOW_S = Math.floor(Date.parse('2026-09-05T10:00:00Z') / 1000);

describe('whether a signed token still stands for a real, allowed person', () => {
  it('lets a normal session through', () => {
    expect(sessionRefusal(ok, NOW_S)).toBeNull();
  });

  it('ends a session whose account was deleted', () => {
    // The reason the delete button is worth having: an eight-hour setup
    // session used to outlive the account by a whole working day.
    expect(sessionRefusal({ ...ok, found: false }, NOW_S)).toBe('gone');
  });

  it('ends a session whose account was switched off', () => {
    expect(sessionRefusal({ ...ok, isActive: false }, NOW_S)).toBe('disabled');
  });

  it('still ends a session issued before the password changed', () => {
    const changedAt = Date.parse('2026-09-05T11:00:00Z');
    expect(sessionRefusal({ ...ok, changedAt }, NOW_S)).toBe('password-changed');
  });

  it('forgives two seconds of clock skew, as it always did', () => {
    const changedAt = NOW_S * 1000 + 1500;
    expect(sessionRefusal({ ...ok, changedAt }, NOW_S)).toBeNull();
  });

  it('A DATABASE HICCUP DOES NOT LOG THE PLATFORM OUT', () => {
    // The one that matters. A failed lookup is not evidence of anything, and
    // reading it as "deleted" would sign every salon out of every till the
    // moment the database blinks — on a Saturday, with customers waiting.
    const blip = { failed: true, found: false, isActive: false, changedAt: Date.now() + 60_000 };
    expect(sessionRefusal(blip, NOW_S)).toBeNull();
  });

  it('says something a person can act on, for each way it can end', () => {
    expect(refusalMessage('gone')).toContain('đăng nhập lại');
    expect(refusalMessage('disabled')).toContain('khoá');
    expect(refusalMessage('password-changed')).toContain('sign in again');
  });
});
