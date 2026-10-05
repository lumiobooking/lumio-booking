/**
 * Which phone number a hotline booking goes under — and the rule that the
 * caller hears it before anything is booked.
 *
 * WHY
 *
 * The hotline used to take the caller ID and book with it, silently: the
 * prompt said "you already have their number — do NOT ask for it". Fast, but
 * a caller on the salon-next-door's landline, an office switchboard or her
 * mother's phone was booked under a number that is not hers, and the text
 * confirmation went to someone else. Nobody on the call knew.
 *
 * The owner's rule (Oct 2026): the caller is not made to read a number out,
 * but the read-back before booking says "under the number ending in 0, 1,
 * 4, 7". They confirm it or give another, and only then is the booking made.
 *
 * A second, quieter bug lived here too: a different number the caller gave
 * that speech recognition garbled (too few digits) was dropped without a word
 * and the caller ID used instead. Now a garbled number is asked for again.
 */

/** The last four digits, or '' when there are not four. */
export function last4(phone: string | null | undefined): string {
  const d = String(phone ?? '').replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : '';
}

/**
 * The four digits as a voice should say them: one at a time. Written "0147",
 * text-to-speech reads "one hundred forty-seven", which nobody recognises as
 * the end of their own phone number.
 */
export function spokenLast4(phone: string | null | undefined): string {
  return last4(phone).split('').join(', ');
}

export type PhoneDecision = { ok: true; phone: string } | { ok: false; say: string };

/**
 * Decide the booking's number, or say what the assistant must do first.
 *
 * @param given      customerPhone from the tool call — a number the caller said.
 * @param callerPhone the caller ID.
 * @param confirmed  phoneConfirmed from the tool call — the model's statement
 *                   that the caller said yes to a read-back that included the
 *                   last four digits of THIS number.
 * @param norm       the salon's E.164 normaliser ('' when not a full number).
 */
export function bookingPhone(o: {
  given: unknown;
  callerPhone: string | null | undefined;
  confirmed: unknown;
  norm: (raw: string) => string;
}): PhoneDecision {
  const raw = String(o.given ?? '').trim();
  const given = raw ? o.norm(raw) : '';
  if (raw && !given) {
    return {
      ok: false,
      say: `NOT BOOKED: "${raw.slice(0, 30)}" is not a complete phone number — it may have been misheard. Ask the caller to say the number again slowly, digit by digit. Do not fall back to the number they are calling from unless they say to.`,
    };
  }
  const phone = given || o.norm(String(o.callerPhone ?? ''));
  if (!phone) {
    return { ok: false, say: 'NOT BOOKED: no phone number yet (the caller ID is hidden). Ask for a good callback number, then read everything back including its last four digits and wait for a yes.' };
  }
  if (o.confirmed !== true) {
    return {
      ok: false,
      say: `NOT BOOKED YET: before booking, read everything back in ONE sentence including "under the number ending in ${spokenLast4(phone)}", and wait for a clear yes. If they give a different number, pass it as customerPhone and read back ITS last four digits. Then call create_booking again with phoneConfirmed: true.`,
    };
  }
  return { ok: true, phone };
}
