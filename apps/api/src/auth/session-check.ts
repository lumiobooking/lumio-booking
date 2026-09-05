/**
 * Whether a signed token still stands for a real, allowed person.
 *
 * WHY THIS IS NOT DECIDED WHERE THE TOKEN IS SIGNED
 *
 * A signature only proves the token was issued. It says nothing about what has
 * happened since — and "since" is where the whole problem lives. Turning an
 * account off, or deleting it, used to change nothing at all for a session
 * already in someone's browser: a Lumio setup session runs for eight hours, so
 * an employee let go at nine in the morning kept full access to every salon
 * they were inside until dinner. Nobody presses Disable and means that.
 *
 * So the token is re-checked against the row on every request (behind a short
 * cache in the strategy). This function is the decision, kept pure so the one
 * case that must never happen can be written down as a test.
 *
 * THAT CASE: A DATABASE HICCUP MUST NOT LOG THE PLATFORM OUT
 *
 * "The row is gone" and "the query failed" arrive at the caller looking almost
 * identical, and treating the second as the first would sign every salon out
 * of every till the moment the database blinks — during a Saturday rush, with
 * customers at the counter. A failed lookup therefore means "carry on": the
 * token's own expiry is still the backstop, and being briefly generous to a
 * disabled account is a smaller harm than closing every salon at once.
 */
export interface UserLookup {
  /** The query itself failed — not an answer, and never read as one. */
  failed: boolean;
  /** A row came back. */
  found: boolean;
  isActive: boolean;
  /** ms since epoch of the last password change; 0 = never changed. */
  changedAt: number;
}

export type SessionRefusal = 'gone' | 'disabled' | 'password-changed';

/** 2s of slack for clock skew between whoever signed the token and the DB. */
const SKEW_MS = 2000;

/** Null when the session stands; otherwise why it does not. */
export function sessionRefusal(lookup: UserLookup, iat?: number): SessionRefusal | null {
  if (lookup.failed) return null;
  if (!lookup.found) return 'gone';
  if (!lookup.isActive) return 'disabled';
  if (iat && lookup.changedAt && iat * 1000 < lookup.changedAt - SKEW_MS) return 'password-changed';
  return null;
}

/** What the person reads. Vague on purpose about which account is meant. */
export function refusalMessage(reason: SessionRefusal): string {
  if (reason === 'gone') return 'Tài khoản này không còn — vui lòng đăng nhập lại.';
  if (reason === 'disabled') return 'Tài khoản đã bị khoá — liên hệ quản trị viên.';
  return 'Password changed — please sign in again';
}
