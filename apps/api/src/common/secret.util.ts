/**
 * The app's signing secret for HMAC-signed tokens (one-tap confirm/cancel links,
 * Gmail OAuth state, etc.). Throws if unset so we never silently fall back to a
 * weak default key — a weak key would let an attacker forge those tokens. In
 * production JWT_SECRET is always configured (login depends on it), so this only
 * ever fires in a misconfigured environment, failing safe instead of insecure.
 */
export function signingSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 8) {
    throw new Error('JWT_SECRET is not configured (required for signing tokens)');
  }
  return s;
}
