/**
 * Plain-text SMS: keep every text on the cheap GSM-7 alphabet.
 *
 * WHY
 *
 * A text is billed per segment. On the GSM-7 alphabet a segment holds 160
 * characters, or 153 each once a text is split. ONE character outside that
 * alphabet (an emoji, a curly ’ typed on an iPhone, an em dash —) switches
 * the WHOLE text to UCS-2, where a segment holds 70, or 67 each once split.
 * A 300-character confirmation is then 5 segments instead of 2, for exactly
 * the same words.
 *
 * WHAT CHANGES
 *
 *   ’ ‘ ´ `   → '         “ ” « »  → "         – — −  → -
 *   …         → ...       · •      → -         → ⇒    → ->
 *   emoji, ™ ® ©, invisible joiners  → removed, spaces tidied after them
 *   é è à ü ñ (already GSM)           → kept as they are
 *   other accented Latin (ễ ç ő ł)    → the plain letter (e c o l)
 *
 * Anything else outside GSM-7 — a name in Chinese, Thai, Arabic — is KEPT.
 * The text then goes out as UCS-2, which is what it needs to stay correct;
 * a cheaper text that mangles a customer's name is not a saving.
 *
 * COPY of apps/api/src/notifications/sms-text.ts — what the API does to every
 * text before it is sent. The template editor uses it to show the real cost.
 * Change both together.
 */

const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
/** Allowed, but each costs two characters (an escape plus the character). */
const GSM_EXTENDED = '^{}\\[~]|€\f';

const BASIC = new Set(Array.from(GSM_BASIC));
const EXTENDED = new Set(Array.from(GSM_EXTENDED));

export const isGsmChar = (ch: string): boolean => BASIC.has(ch) || EXTENDED.has(ch);

/** Single characters with a plain-text twin that reads the same. */
const SWAP: Array<[RegExp, string]> = [
  [/[‘’‚‛′`´ʼ]/g, "'"],
  [/[“”„‟″«»]/g, '"'],
  [/[‐-―−⸺⸻]/g, '-'],
  [/…/g, '...'],
  [/[·•‧∙●▪◦]/g, '-'],
  [/[→⇒➡➔]/g, '->'],
  [/[←⇐⬅]/g, '<-'],
  [/×/g, 'x'],
  [/÷/g, '/'],
  [/¢/g, 'c'],
  [/[   -   　\t]/g, ' '],
  // Ligatures and letters NFD cannot take apart.
  [/œ/g, 'oe'], [/Œ/g, 'OE'],
  [/đ/g, 'd'], [/Đ/g, 'D'],
  [/ł/g, 'l'], [/Ł/g, 'L'],
  [/ı/g, 'i'],
  [/þ/g, 'th'], [/Þ/g, 'Th'],
  [/ð/g, 'd'],
];

/** Emoji and the pieces emoji are built from, plus marks that only decorate. */
const DECORATION =
  /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}\u{E0020}-\u{E007F}⃣︎️​-‍⁠﻿™®©✓✔★☆♥♡]/gu;

/** The plain letter under an accented one, when that letter is GSM. */
function foldLetter(ch: string): string {
  if (isGsmChar(ch)) return ch;
  const base = ch.normalize('NFD').replace(/\p{M}+/gu, '');
  if (base && base !== ch && Array.from(base).every(isGsmChar)) return base;
  return ch;
}

/**
 * The same message, on the GSM-7 alphabet wherever that does not change what
 * it says. Idempotent: running it twice gives the same text.
 */
export function toGsm7(text: string): string {
  if (!text) return '';
  let s = String(text).replace(/\r\n?/g, '\n');
  for (const [re, to] of SWAP) s = s.replace(re, to);
  s = s.replace(DECORATION, ' ');
  s = Array.from(s).map(foldLetter).join('');
  // Tidy what removing an emoji leaves behind: "Brows 💕 your" must read
  // "Brows your", and "then ✨!" must read "then!".
  s = s
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').replace(/ +([,.!?;])/g, '$1').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s;
}

export interface SmsSize {
  encoding: 'GSM-7' | 'UCS-2';
  /** Characters as the network counts them (an extended GSM char is 2). */
  units: number;
  segments: number;
}

/** How many billable segments a text is, as the carrier counts them. */
export function smsSegments(text: string): SmsSize {
  const chars = Array.from(text ?? '');
  if (chars.every(isGsmChar)) {
    const units = chars.reduce((n, ch) => n + (EXTENDED.has(ch) ? 2 : 1), 0);
    return { encoding: 'GSM-7', units, segments: units === 0 ? 0 : units <= 160 ? 1 : Math.ceil(units / 153) };
  }
  // UCS-2 counts UTF-16 code units: an emoji outside the BMP is two.
  const units = (text ?? '').length;
  return { encoding: 'UCS-2', units, segments: units <= 70 ? 1 : Math.ceil(units / 67) };
}
