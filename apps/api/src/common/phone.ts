/**
 * Turning whatever a person typed into an E.164 number.
 *
 * The old rule was "ten digits means the United States", which held for as long
 * as every salon was in the US or Canada. A Vietnamese mobile written the normal
 * way — 0912 345 678 — is also ten digits, so it came out as +10912345678: a
 * plausible-looking US number that silently fails to deliver. The salon believes
 * the reminder went out, the customer never hears anything, and nobody finds out
 * until the no-show.
 *
 * So the country has to come from the salon, not from the length of the string.
 * There is no country column on a tenant, but every tenant already carries a
 * timezone, and that is enough to tell Ho Chi Minh City from Los Angeles.
 *
 * `defaultDialCode` stays '1' so every existing call site behaves exactly as it
 * did before this file existed.
 */

/** Rules for turning a LOCAL number (no country code) into E.164. */
interface DialRule {
  /** Country calling code, digits only. */
  code: string;
  /** Local numbers are written with this trunk prefix, dropped before dialling. */
  trunkPrefix?: string;
  /** Valid national number lengths AFTER the trunk prefix is removed. */
  nationalLengths: number[];
}

const RULES: Record<string, DialRule> = {
  // North America: no trunk prefix, 10 national digits.
  '1': { code: '1', nationalLengths: [10] },
  // Vietnam: local form starts with 0. Mobiles are 9 national digits
  // (0912 345 678 → 912345678); landlines are 10, because the area code is two
  // digits plus an eight-digit subscriber number (028 3823 4567 → 2838234567).
  '84': { code: '84', trunkPrefix: '0', nationalLengths: [9, 10] },
};

/** Which dial code a salon's numbers should default to, read from its timezone. */
export function dialCodeForTimezone(timezone?: string | null): string {
  const tz = String(timezone || '');
  if (tz === 'Asia/Ho_Chi_Minh' || tz === 'Asia/Saigon') return '84';
  return '1'; // every existing salon keeps today's behaviour
}

/**
 * Normalise to E.164, or null when the input cannot be one.
 * Already-E.164 input is returned untouched, whatever the default.
 */
export function toE164(raw: string | null | undefined, defaultDialCode = '1'): string | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;

  // Already E.164 — trust it and do not second-guess the country.
  if (/^\+\d{8,15}$/.test(trimmed)) return trimmed;

  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  const rule = RULES[defaultDialCode] ?? RULES['1'];

  // Local form, e.g. 0912345678 (VN) or 5128868189 (US).
  let national = digits;
  if (rule.trunkPrefix && national.startsWith(rule.trunkPrefix)) {
    national = national.slice(rule.trunkPrefix.length);
  }
  if (rule.nationalLengths.includes(national.length)) return `+${rule.code}${national}`;

  // Already carries its own country code, e.g. 84912345678 or 15128868189.
  if (digits.startsWith(rule.code)) {
    const rest = digits.slice(rule.code.length);
    const restLocal = rule.trunkPrefix && rest.startsWith(rule.trunkPrefix)
      ? rest.slice(rule.trunkPrefix.length)
      : rest;
    if (rule.nationalLengths.includes(restLocal.length)) return `+${rule.code}${restLocal}`;
  }

  // Some other country, typed without a plus. Same fallback as before.
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}
