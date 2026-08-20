/**
 * Whether the very first Super Admin may be created right now.
 *
 * A brand-new deployment has an empty database and no way in: the API only
 * offers login, and the seed script is for local development — it writes demo
 * salons and a password printed in a public repository, which must never touch
 * a system real salons will use.
 *
 * So there is one narrow door, and it is held shut by two independent locks.
 * Either one alone would be too weak:
 *
 *   1. NO USERS AT ALL. The moment one account exists the door is closed
 *      forever, by a fact about the database rather than a flag someone has to
 *      remember to flip. This is what makes the endpoint safe to leave in the
 *      code permanently.
 *
 *   2. A SECRET the caller must present, from BOOTSTRAP_TOKEN. Without lock 2,
 *      anyone who found a fresh deployment before its owner did could claim it.
 *      Unset means the door does not exist — so it is shut by default, and on
 *      every system that is already running.
 *
 * Both locks are checked here, in one place, with no database access, so the
 * rule can be tested exhaustively and read in one sitting.
 */
export type BootstrapVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'disabled' | 'already-set-up' | 'bad-token' };

export function canBootstrap(args: {
  /** How many user accounts exist in this database. */
  userCount: number;
  /** BOOTSTRAP_TOKEN from the environment. Empty/undefined = feature off. */
  expectedToken: string | undefined | null;
  /** What the caller presented. */
  givenToken: string | undefined | null;
}): BootstrapVerdict {
  const expected = String(args.expectedToken ?? '').trim();
  // Off by default. Every deployment that never sets this is untouched.
  if (!expected) return { allowed: false, reason: 'disabled' };

  // A token short enough to guess is not a lock. Refuse rather than pretend.
  if (expected.length < 16) return { allowed: false, reason: 'disabled' };

  // The database itself closes the door, permanently, after the first account.
  if (args.userCount > 0) return { allowed: false, reason: 'already-set-up' };

  const given = String(args.givenToken ?? '');
  if (!timingSafeEqual(given, expected)) return { allowed: false, reason: 'bad-token' };

  return { allowed: true };
}

/**
 * Compare without leaking WHERE two strings diverge.
 *
 * A plain `===` returns as soon as it finds a difference, so the time it takes
 * reveals how many characters were right — enough, over many attempts, to walk
 * a secret out one character at a time. Comparing every character costs
 * nothing here and removes that.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Passwords for an account that can see every salon on the platform. */
export function passwordProblem(password: string): string | null {
  const p = String(password ?? '');
  if (p.length < 12) return 'Password must be at least 12 characters.';
  if (!/[a-z]/.test(p) || !/[A-Z]/.test(p)) return 'Password must contain both lower and upper case letters.';
  if (!/\d/.test(p)) return 'Password must contain a number.';
  // The seed script's password is published in this repository, so it is the
  // one string that must never become a real login.
  if (p === 'Password123!') return 'That is the demo password from the seed script. Choose another.';
  return null;
}
