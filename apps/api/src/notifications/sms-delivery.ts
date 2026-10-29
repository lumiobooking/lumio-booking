/**
 * What the carrier said about a text — and when to stop paying to repeat it.
 *
 * Twilio bills a text the moment it accepts it. When the carrier then cannot
 * deliver it (a landline, a dead number, a phone switched off) the message
 * comes back "undelivered" — and is still billed. A salon that rebooks the
 * same customer three times in half an hour pays three times for nothing.
 *
 * Platform-account texts carry a StatusCallback; the callback writes the
 * outcome onto the notification row (see NotificationsService
 * .applyTwilioStatus). Before the next text to the same number at the same
 * salon, undeliveredHold() reads the last two outcomes:
 *
 *   both undelivered, landline / unknown number (30005, 30006)
 *       → hold, until the salon fixes the number (a different number is a
 *         different recipient, so it goes straight out)
 *   both undelivered for any other reason (phone off, carrier filter…)
 *       → hold for 24 hours after the latest one, then try again
 *   anything delivered, or not yet reported
 *       → send
 *
 * Pure: no database, no clock of its own — pinned by tests.
 */

export const UNDELIVERED_PREFIX = 'Undelivered (Twilio';

/** Twilio error codes that mean "this number cannot take a text at all". */
export const PERMANENT_CODES = new Set(['30005', '30006']);

export const SOFT_HOLD_MS = 24 * 60 * 60 * 1000;
export const HOLD_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

/** The row error a carrier failure is stored as — undeliveredHold reads it back. */
export function undeliveredError(code: string | null | undefined, status: string): string {
  const c = String(code ?? '').trim() || '?';
  const why = PERMANENT_CODES.has(c)
    ? 'landline or unknown number'
    : c === '30003' ? 'phone off or out of reach'
      : c === '30007' ? 'blocked by the carrier'
        : status === 'failed' ? 'not sent' : 'not delivered';
  return `${UNDELIVERED_PREFIX} ${c}) — ${why}`;
}

export function carrierCode(error: string | null | undefined): string | null {
  const m = String(error ?? '').match(/^Undelivered \(Twilio (\w+|\?)\)/);
  return m ? m[1] : null;
}

export type TwilioOutcome = 'delivered' | 'undelivered' | 'pending';

/** Twilio MessageStatus → what we record. Only final states change a row. */
export function twilioOutcome(status: string | null | undefined): TwilioOutcome {
  const s = String(status ?? '').trim().toLowerCase();
  if (s === 'delivered' || s === 'read') return 'delivered';
  if (s === 'undelivered' || s === 'failed') return 'undelivered';
  return 'pending';
}

export interface PriorText {
  createdAt: Date;
  error: string | null;
  deliveredAt: Date | null;
}

/**
 * Why the next text to this number should not go out, or null to send it.
 * `recent` = the latest texts to the number at this salon, newest first.
 */
export function undeliveredHold(recent: PriorText[], nowMs: number): string | null {
  if (!recent || recent.length < 2) return null;
  const last = recent.slice(0, 2);
  const codes = last.map((r) => (r.deliveredAt ? null : carrierCode(r.error)));
  if (codes.some((c) => c == null)) return null;
  const permanent = codes.every((c) => PERMANENT_CODES.has(c as string));
  if (!permanent && nowMs - last[0].createdAt.getTime() > SOFT_HOLD_MS) return null;
  return permanent
    ? `Not sent: the last 2 texts to this number never reached a phone (Twilio ${codes[0]} — landline or unknown number). Check the customer's phone number.`
    : `Not sent: the last 2 texts to this number were not delivered (Twilio ${codes[0]}). Paused for 24 hours instead of paying for more texts that do not arrive.`;
}
