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

/**
 * Which Twilio sender a salon's SMS goes out from — the second decision,
 * after routeSmsFor has said "not eSMS".
 *
 * The platform's +1 number is right for the US and Canada and wrong
 * everywhere else: Vietnamese carriers block it outright (Twilio error 21408
 * or a silent drop), and an Australian customer gets a text from an American
 * number they cannot reply STOP to for free. So:
 *
 *   US / CA / unknown → exactly what happens today (platform default).
 *   AU → the platform's shared Australian number (TWILIO_FROM_NUMBER_AU),
 *        the same one-number-for-everyone model the US runs on. Only if that
 *        is not set, the salon's own +61 hotline number. Else refuse with a
 *        reason the salon can act on.
 *   VN without eSMS → refuse with a reason, instead of paying Twilio to
 *        send a message the carrier will drop.
 *
 * A salon that brought its OWN Twilio credentials is never re-routed here:
 * that path is checked before this one and stays the salon's choice.
 */
export type TwilioSender =
  | { kind: 'default' }
  | { kind: 'from'; from: string }
  | { kind: 'refuse'; error: string };

export function twilioSenderFor(args: {
  market: string | null | undefined;
  /** The salon's hotline number (VoiceLine.lumioNumber), if any. */
  lineNumber?: string | null;
  /** Platform-wide Australian sender (env TWILIO_FROM_NUMBER_AU). */
  auFallback?: string | null;
}): TwilioSender {
  const market = String(args.market ?? '').trim().toUpperCase();
  if (market === 'AU') {
    const shared = String(args.auFallback ?? '').trim();
    if (/^\+61\d{9}$/.test(shared)) return { kind: 'from', from: shared };
    const line = String(args.lineNumber ?? '').trim();
    if (/^\+61\d{9}$/.test(line)) return { kind: 'from', from: line };
    return {
      kind: 'refuse',
      error: 'Chưa gửi: chưa có số SMS Úc (+61) — đặt TWILIO_FROM_NUMBER_AU trên Render. / Not sent: no Australian (+61) SMS number is configured (TWILIO_FROM_NUMBER_AU).',
    };
  }
  if (market === 'VN') {
    return {
      kind: 'refuse',
      error: 'Chưa gửi: tiệm ở Việt Nam cần brandname eSMS (Cài đặt → SMS). Nhà mạng VN chặn tin từ số nước ngoài. / Not sent: a Vietnamese salon needs an eSMS brandname — VN carriers block foreign numbers.',
    };
  }
  return { kind: 'default' };
}

/**
 * Which eSMS account a Vietnamese salon's messages go out through.
 *
 * Two sources, the same shape as the US/AU "one number for everyone" model:
 *
 *   1. The salon's OWN eSMS keys + brandname (Cài đặt → SMS), when complete.
 *      A salon that set this up keeps exactly what it has today.
 *   2. Otherwise Lumio's SHARED account from the environment — one Zalo OA
 *      and one brandname sending for every VN salon (the salon's name rides
 *      in the ZNS salon_name parameter):
 *        ESMS_API_KEY, ESMS_SECRET_KEY            — required
 *        ESMS_ZNS_OAID + ESMS_ZNS_BOOKING_TEMP_ID / ESMS_ZNS_REMINDER_TEMP_ID
 *        ESMS_BRANDNAME                            — optional SMS fallback
 *      The shared account counts only when it can deliver SOMETHING: a
 *      brandname, or an OA with at least one ZNS template. Keys alone are
 *      not a channel.
 *
 * Never for a salon outside VN, whatever the environment holds.
 */
export interface VnEsmsSource {
  apiKey?: string | null;
  secretKey?: string | null;
  brandname?: string | null;
  oaid?: string | null;
  znsBookingTempId?: string | null;
  znsReminderTempId?: string | null;
}

export interface VnEsmsConfig {
  apiKey: string;
  secretKey: string;
  /** Empty for a ZNS-only shared account: SMS fallback is then refused, not sent to error 104. */
  brandname: string;
  oaid: string;
  znsBookingTempId: string;
  znsReminderTempId: string;
  source: 'salon' | 'platform';
}

const s = (v: unknown) => String(v ?? '').trim();

function pack(c: VnEsmsSource, source: VnEsmsConfig['source']): VnEsmsConfig {
  return {
    apiKey: s(c.apiKey), secretKey: s(c.secretKey), brandname: s(c.brandname),
    oaid: s(c.oaid), znsBookingTempId: s(c.znsBookingTempId), znsReminderTempId: s(c.znsReminderTempId),
    source,
  };
}

/** Lumio's shared eSMS/ZNS account, read from the environment. */
export function platformEsmsFromEnv(env: Record<string, string | undefined> = process.env): VnEsmsSource {
  return {
    apiKey: env.ESMS_API_KEY, secretKey: env.ESMS_SECRET_KEY, brandname: env.ESMS_BRANDNAME,
    oaid: env.ESMS_ZNS_OAID, znsBookingTempId: env.ESMS_ZNS_BOOKING_TEMP_ID, znsReminderTempId: env.ESMS_ZNS_REMINDER_TEMP_ID,
  };
}

export function vnEsmsFor(args: {
  market: string | null | undefined;
  salon?: VnEsmsSource | null;
  platform?: VnEsmsSource | null;
}): VnEsmsConfig | null {
  if (s(args.market).toUpperCase() !== 'VN') return null;
  if (args.salon && hasESmsCredentials(args.salon)) return pack(args.salon, 'salon');
  const p = args.platform;
  if (!p || !s(p.apiKey) || !s(p.secretKey)) return null;
  const canZns = !!s(p.oaid) && (!!s(p.znsBookingTempId) || !!s(p.znsReminderTempId));
  if (!s(p.brandname) && !canZns) return null;
  return pack(p, 'platform');
}
