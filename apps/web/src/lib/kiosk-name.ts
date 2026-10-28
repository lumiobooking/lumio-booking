/**
 * Text helpers for the self check-in kiosk (app/checkin). Kept out of the page
 * file: a Next.js page may export only its component.
 */

/** Longest name the kiosk accepts — the server keeps 80, a person needs far less. */
export const NAME_MAX = 40;

/**
 * "Friendly Nails – Sylvan Lake" → the name, and the branch on its own line.
 * One long line wrapped mid-dash under a WELCOME TO label and looked broken.
 * Splits at a spaced dash (– — -) or bar; a hyphen inside a word stays.
 */
export function splitSalonName(full: string): { name: string; place: string | null } {
  const s = String(full ?? '').trim();
  const m = s.match(/^(.*?\S)\s+[–—|-]\s+(\S.*)$/);
  return m ? { name: m[1], place: m[2] } : { name: s, place: null };
}

/**
 * One key on the salon keyboard applied to a name, capitalised at the start
 * of each word: "mary-jane o'neil" → "Mary-Jane O'Neil". No double spaces, no
 * leading space or punctuation, capped at NAME_MAX. "del" removes one letter.
 */
export function typeInto(value: string, key: string): string {
  if (key === 'del') return value.slice(0, -1);
  if (value.length >= NAME_MAX) return value;
  if (key === ' ' || key === '-' || key === "'") return value && !/[\s'-]$/.test(value) ? value + key : value;
  if (!/^[a-zA-Z]$/.test(key)) return value;
  const startOfWord = !value || /[\s'-]$/.test(value);
  return value + (startOfWord ? key.toUpperCase() : key.toLowerCase());
}
