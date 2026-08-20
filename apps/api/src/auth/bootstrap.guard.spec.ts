/**
 * The door that lets the first Super Admin in — and must let nobody else
 * through, ever again.
 *
 * Worth testing exhaustively rather than carefully: it is a small rule, it
 * guards an account that can see every salon on the platform, and it lives in
 * code that will be deployed to systems that already have users.
 */
import { canBootstrap, passwordProblem } from './bootstrap.guard';

const GOOD_TOKEN = 'a'.repeat(32);

describe('canBootstrap — the two locks', () => {
  it('opens only when both locks are satisfied', () => {
    expect(canBootstrap({ userCount: 0, expectedToken: GOOD_TOKEN, givenToken: GOOD_TOKEN }))
      .toEqual({ allowed: true });
  });

  describe('lock 1 — the database must be empty', () => {
    it('refuses once a single account exists', () => {
      expect(canBootstrap({ userCount: 1, expectedToken: GOOD_TOKEN, givenToken: GOOD_TOKEN }))
        .toEqual({ allowed: false, reason: 'already-set-up' });
    });

    // This is the property that matters most: the US system is full of users,
    // so this endpoint is closed there no matter what anyone sets or leaks.
    it('refuses on a busy system even with the right token', () => {
      expect(canBootstrap({ userCount: 5000, expectedToken: GOOD_TOKEN, givenToken: GOOD_TOKEN }).allowed)
        .toBe(false);
    });
  });

  describe('lock 2 — the token', () => {
    it('refuses a wrong token on an empty database', () => {
      expect(canBootstrap({ userCount: 0, expectedToken: GOOD_TOKEN, givenToken: 'b'.repeat(32) }))
        .toEqual({ allowed: false, reason: 'bad-token' });
    });

    it.each([undefined, null, '', '   '])('is OFF when BOOTSTRAP_TOKEN is %s', (value) => {
      expect(canBootstrap({ userCount: 0, expectedToken: value, givenToken: 'anything' }))
        .toEqual({ allowed: false, reason: 'disabled' });
    });

    // A short token is not a lock. Refusing is safer than pretending it is one.
    it('refuses a token too short to be worth guessing at', () => {
      const short = 'abc123';
      expect(canBootstrap({ userCount: 0, expectedToken: short, givenToken: short }))
        .toEqual({ allowed: false, reason: 'disabled' });
    });

    it.each([undefined, null, ''])('refuses when the caller presents %s', (given) => {
      expect(canBootstrap({ userCount: 0, expectedToken: GOOD_TOKEN, givenToken: given }).allowed)
        .toBe(false);
    });

    it('refuses a token that merely starts correctly', () => {
      expect(canBootstrap({ userCount: 0, expectedToken: GOOD_TOKEN, givenToken: 'a'.repeat(31) }).allowed)
        .toBe(false);
    });
  });

  it('checks the database BEFORE the token, so a used system never reveals whether a guess was close', () => {
    expect(canBootstrap({ userCount: 1, expectedToken: GOOD_TOKEN, givenToken: 'wrong' }).allowed).toBe(false);
    expect(canBootstrap({ userCount: 1, expectedToken: GOOD_TOKEN, givenToken: 'wrong' }))
      .toEqual({ allowed: false, reason: 'already-set-up' });
  });
});

describe('passwordProblem — this account can see every salon', () => {
  it('accepts a reasonable password', () => {
    expect(passwordProblem('Lumio2026vietnam')).toBeNull();
  });

  it.each([
    ['too short', 'Short1aa'],
    ['no upper case', 'lumio2026vietnam'],
    ['no lower case', 'LUMIO2026VIETNAM'],
    ['no digit', 'LumioVietnamPassword'],
  ])('rejects one that is %s', (_name, password) => {
    expect(passwordProblem(password)).not.toBeNull();
  });

  // It is printed in this repository's seed script, so it is public.
  it('rejects the demo password by name', () => {
    expect(passwordProblem('Password123!')).toMatch(/demo password/i);
  });

  it.each([undefined, null, ''])('rejects %s', (value) => {
    expect(passwordProblem(value as unknown as string)).not.toBeNull();
  });
});
