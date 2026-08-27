/**
 * Which SMS network a salon's messages go out on.
 *
 * WHY THIS IS A SEPARATE, PURE FUNCTION
 *
 * The decision is one `if`, and it is the single most dangerous `if` in the
 * notification path: get it wrong in one direction and 25 live US salons stop
 * texting their customers; get it wrong in the other and a Vietnamese salon
 * sends through a route its carriers silently drop. Neither failure announces
 * itself. So the rule lives here, with no network and no database, and is
 * pinned by tests instead of trusted.
 *
 * THE RULE
 *
 *   VN  → eSMS, and only when that salon's eSMS credentials are complete.
 *   everything else → exactly what it does today. Untouched.
 *
 * Note the shape of the fallback. A VN salon with no eSMS credentials falls
 * back to the existing Twilio path — the same thing that happens today — rather
 * than to an error, because a half-configured Vietnamese salon should behave
 * like an unconfigured one, not like a broken one.
 */

export type SmsRoute =
  | { provider: 'esms'; reason: 'vn-salon-with-credentials' }
  | { provider: 'twilio-or-existing'; reason: 'non-vn-market' | 'vn-missing-credentials' };

export interface ESmsCredentials {
  apiKey?: string | null;
  secretKey?: string | null;
  brandname?: string | null;
}

/** All three are required. A brandname without keys cannot send, and keys
 *  without a registered brandname are eSMS error 104 on every attempt. */
export function hasESmsCredentials(c: ESmsCredentials | null | undefined): boolean {
  return Boolean(
    String(c?.apiKey ?? '').trim()
    && String(c?.secretKey ?? '').trim()
    && String(c?.brandname ?? '').trim(),
  );
}

export function routeSmsFor(args: {
  market: string | null | undefined;
  esms?: ESmsCredentials | null;
}): SmsRoute {
  const market = String(args.market ?? '').trim().toUpperCase();

  // Anything that is not explicitly VN keeps the behaviour it has today. This
  // is written as a positive test for 'VN' rather than a negative test against
  // a list of known markets, so that adding AU, UK or anything else later can
  // never accidentally route a new market through a Vietnamese aggregator.
  if (market !== 'VN') return { provider: 'twilio-or-existing', reason: 'non-vn-market' };

  if (!hasESmsCredentials(args.esms)) {
    return { provider: 'twilio-or-existing', reason: 'vn-missing-credentials' };
  }
  return { provider: 'esms', reason: 'vn-salon-with-credentials' };
}
