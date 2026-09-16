/**
 * WHAT A SALON IS CHARGED PER UNIT, AND WHAT THE SCREEN IS ALLOWED TO SAY.
 *
 * THE BUG THIS FILE EXISTS TO KILL
 *
 * The SMS overage price lived in exactly one place: `VoiceLine.overageCentsPerSms`.
 * A VoiceLine row only exists once the AI Hotline has been provisioned. So a
 * salon on SMS alone — most of them — had NO price for an SMS at all. The rate
 * read as 0, overage was billed as nothing, and the invoice screen filled its
 * sentence template with the word "free":
 *
 *     "SMS — each message beyond your 100 included is charged FREE."
 *
 * Two failures in one line. The salon was not billed for what it used, and it
 * was told in writing that overage costs nothing — which is the sentence it
 * will quote back when an invoice finally arrives.
 *
 * So: a rate now falls back from the salon's own override to a platform
 * default, and a MISSING rate is a distinct state from a rate of zero. The
 * screen is given that state and a sentence for each, instead of being handed
 * a number and left to improvise.
 */

/** Where a rate came from. The screen says different things for each. */
export type RateSource =
  /** This salon has its own agreed price. */
  | 'tenant'
  /** No per-salon price; the platform default applies. */
  | 'platform'
  /** Deliberately free — somebody set zero on purpose. */
  | 'free'
  /** Nobody has ever set a price. NOT the same as free, and never said to be. */
  | 'unset';

export interface Rate {
  centsPerUnit: number;
  source: RateSource;
  /** True when the salon may be charged for going over. */
  billable: boolean;
}

/**
 * Resolve one rate.
 *
 * `tenantCents` is the salon's own agreed price and wins whenever it was
 * actually set — including when it was set to zero, which is a real decision
 * ("this client's SMS are on us") and must not be overwritten by a default.
 * `null`/`undefined` means "never said", which is what falls through.
 */
export function resolveRate(
  tenantCents: number | null | undefined,
  platformCents: number | null | undefined,
): Rate {
  const t = num(tenantCents);
  if (t !== null) {
    return t > 0
      ? { centsPerUnit: t, source: 'tenant', billable: true }
      : { centsPerUnit: 0, source: 'free', billable: false };
  }
  const p = num(platformCents);
  if (p !== null && p > 0) return { centsPerUnit: p, source: 'platform', billable: true };
  // No price anywhere. Nothing may be billed, and the screen must say "not
  // priced yet" rather than promising it is free for ever.
  return { centsPerUnit: 0, source: 'unset', billable: false };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/** Platform defaults, read from config strings. Missing stays missing. */
export interface PlatformRates {
  smsCents: number | null;
  minuteCents: number | null;
  chatReplyCents: number | null;
}

export function cleanPlatformRates(raw: Record<string, string | undefined>): PlatformRates {
  return {
    smsCents: num(raw.sms_overage_cents),
    minuteCents: num(raw.hotline_overage_cents_per_min),
    chatReplyCents: num(raw.chat_overage_cents_per_reply),
  };
}

/** One billable line as the invoice screen draws it. */
export interface UsageLine {
  /** 'sms' | 'minutes' | 'chat' — the screen maps this to a label. */
  kind: string;
  included: number;
  used: number;
  over: number;
  rate: Rate;
  overageCents: number;
  /**
   * What the explanation should say. The screen picks a whole sentence by this
   * key instead of substituting a number into "charged {rate}" — which is how
   * "charged free" got printed in the first place.
   */
  wording: 'priced' | 'free' | 'unset' | 'unlimited';
}

/**
 * Build one line. `included <= 0` means the allowance is unlimited (or not
 * metered), in which case nothing is ever over and nothing is ever charged.
 */
export function usageLine(kind: string, used: number, included: number, rate: Rate): UsageLine {
  const u = Math.max(0, Math.round(Number(used) || 0));
  const inc = Math.max(0, Math.round(Number(included) || 0));
  const over = inc > 0 ? Math.max(0, u - inc) : 0;
  const overageCents = rate.billable ? over * rate.centsPerUnit : 0;
  const wording: UsageLine['wording'] = inc <= 0
    ? 'unlimited'
    : rate.source === 'free' ? 'free'
      : rate.source === 'unset' ? 'unset'
        : 'priced';
  return { kind, included: inc, used: u, over, rate, overageCents, wording };
}

/**
 * The month-end projection.
 *
 * Straight-line from what has been used so far. Deliberately NOT applied to
 * the fixed fee — that is already the whole month's fee, and projecting it
 * would show a salon on day 3 a figure ten times its real bill.
 */
export function projectOverage(overageCents: number, dayOfMonth: number, daysInMonth: number): number {
  const d = Math.max(1, Math.round(Number(dayOfMonth) || 1));
  const n = Math.max(d, Math.round(Number(daysInMonth) || d));
  return Math.round((Math.max(0, Math.round(Number(overageCents) || 0)) / d) * n);
}
