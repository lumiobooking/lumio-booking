import { createHash, randomBytes } from 'crypto';

/**
 * API / license keys for the WordPress plugin.
 *
 * The plaintext key is shown to the salon exactly once at creation and is never
 * stored. We store a SHA-256 hash of it: API keys are high-entropy random
 * strings (unlike passwords), so a fast one-way hash is appropriate and lets us
 * look a key up in O(1) by its hash. `keyPrefix` + `lastFour` are kept only to
 * help the salon recognise a key in the UI.
 */

const KEY_PREFIX = 'lumio_sk_';

export interface GeneratedApiKey {
  /** The full plaintext key — return to the user ONCE, then discard. */
  plaintext: string;
  /** SHA-256 hash stored in the database. */
  hash: string;
  /** Public, non-secret prefix shown in the UI, e.g. "lumio_sk_1a2b3c4d". */
  keyPrefix: string;
  /** Last 4 chars for display, e.g. "9f0a". */
  lastFour: string;
}

/** SHA-256 hex hash of a key (used for storage and lookup). */
export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/** Generates a new random API key and its derived storage fields. */
export function generateApiKey(): GeneratedApiKey {
  const random = randomBytes(24).toString('hex'); // 48 hex chars
  const plaintext = `${KEY_PREFIX}${random}`;
  return {
    plaintext,
    hash: hashApiKey(plaintext),
    keyPrefix: plaintext.slice(0, KEY_PREFIX.length + 8),
    lastFour: plaintext.slice(-4),
  };
}
