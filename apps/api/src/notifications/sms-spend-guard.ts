/**
 * rt239 — SMS spend guard: stop spam and "SMS pumping" from running up the
 * platform Twilio bill (26/11/2026).
 *
 * Lumio pays for every text sent on the platform account. Three ways a bad
 * actor (or a bug) can make that bill explode:
 *
 *  1. Pumping: a bot books online with premium-rate numbers (often Caribbean
 *     +1 area codes or far-away countries) so each confirmation text earns the
 *     fraudster a cut. → only send to the countries Lumio serves, and inside
 *     +1 only to the US, Canada and US territories.
 *  2. One number flooded: the same phone gets text after text (repeated fake
 *     bookings, a loop). → a daily cap per number at one salon, and across all
 *     salons. Salon staff / owners are exempt (they get an alert per booking).
 *  3. A salon (or a bug) suddenly sends hundreds an hour. → an hourly cap per
 *     salon and a daily ceiling for the whole platform; above it texts are held
 *     (recorded as `sms-guard`, nothing billed) and the team is warned.
 *
 * All limits can be tuned with env vars without a deploy of new code.
 * Pure: no database, no clock.
 */

export interface SpendLimits {
  /** Dial codes texts may go to (digits, no +). */
  allowedDial: string[];
  /** Max texts to one number per 24h at one salon. */
  perNumberPerSalon: number;
  /** Max texts to one number per 24h across every salon. */
  perNumberPlatform: number;
  /** Max texts per salon per hour. */
  perSalonHour: number;
  /** Max texts on the platform account per 24h. */
  platformDay: number;
}

const num = (v: unknown, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : d;
};

export function spendLimits(env: Record<string, string | undefined>): SpendLimits {
  const dial = String(env.SMS_ALLOWED_DIAL ?? '1,61').split(',').map((s) => s.replace(/\D/g, '')).filter(Boolean);
  return {
    allowedDial: dial.length ? dial : ['1', '61'],
    perNumberPerSalon: num(env.SMS_CAP_PER_NUMBER_SALON, 8),
    perNumberPlatform: num(env.SMS_CAP_PER_NUMBER_PLATFORM, 15),
    perSalonHour: num(env.SMS_CAP_PER_SALON_HOUR, 80),
    platformDay: num(env.SMS_CAP_PLATFORM_DAY, 800),
  };
}

/**
 * +1 area codes that are NOT the US, Canada or a US territory: Caribbean and
 * Atlantic countries share +1 and are the classic pumping destinations (a text
 * there costs many times a US one).
 */
export const NANP_FOREIGN = new Set([
  '242', '246', '264', '268', '284', '345', '441', '473', '649', '658', '664', '721',
  '758', '767', '784', '809', '829', '849', '868', '869', '876',
]);

/** Why a number may not be texted on the platform account, or null when it may. */
export function blockedDestination(e164: string | null | undefined, allowedDial: string[]): string | null {
  const n = String(e164 ?? '').trim();
  if (!/^\+\d{8,15}$/.test(n)) return 'Blocked: not a valid phone number';
  const digits = n.slice(1);
  const dial = [...allowedDial].sort((a, b) => b.length - a.length).find((d) => digits.startsWith(d));
  if (!dial) return `Blocked: texts to +${digits.slice(0, 3)}… are not sent (country not served)`;
  if (dial === '1') {
    if (digits.length !== 11) return 'Blocked: not a valid North American number';
    const area = digits.slice(1, 4);
    if (NANP_FOREIGN.has(area)) return `Blocked: +1 ${area} is outside the US/Canada (premium-rate risk)`;
    // 900 = premium rate.
    if (area === '900' || area === '976') return `Blocked: +1 ${area} is a premium-rate number`;
  }
  return null;
}

export interface SpendCounts {
  /** Texts to this number from this salon in the last 24h. */
  numberAtSalon24h: number;
  /** Texts to this number from every salon in the last 24h. */
  numberPlatform24h: number;
  /** Texts sent by this salon in the last hour. */
  salonHour: number;
  /** Texts on the platform account in the last 24h. */
  platform24h: number;
}

/**
 * The hold reason, or null to send. `staffNumber` = the recipient is one of the
 * salon's own users / staff (owner alerts), who are exempt from the per-number caps.
 * `kind` receipts and adverts are capped alike: a flood is a flood.
 */
export function spendHold(c: SpendCounts, l: SpendLimits, opts: { staffNumber?: boolean } = {}): string | null {
  if (c.platform24h >= l.platformDay) return `Held: platform daily SMS ceiling reached (${l.platformDay}/24h) — possible abuse, team alerted`;
  if (c.salonHour >= l.perSalonHour) return `Held: this salon sent ${c.salonHour} texts in the last hour (limit ${l.perSalonHour}) — possible spam`;
  if (!opts.staffNumber) {
    if (c.numberAtSalon24h >= l.perNumberPerSalon) return `Held: ${c.numberAtSalon24h} texts to this number today (limit ${l.perNumberPerSalon}) — possible spam`;
    if (c.numberPlatform24h >= l.perNumberPlatform) return `Held: this number got ${c.numberPlatform24h} texts from Lumio today (limit ${l.perNumberPlatform}) — possible spam`;
  }
  return null;
}

/** The last digits that identify a phone across formats (+1 (512) 555-0101 = 5125550101). */
export function phoneTail(p: string | null | undefined): string {
  const d = String(p ?? '').replace(/\D/g, '');
  return d.length > 9 ? d.slice(-9) : d;
}

/** rt239: online bookings one phone may make at one salon per 24h (env ONLINE_BOOKINGS_PER_PHONE_DAY, default 5). */
export function onlineBookingsPerPhoneDay(env: Record<string, string | undefined> = process.env): number {
  return num(env.ONLINE_BOOKINGS_PER_PHONE_DAY, 5);
}
