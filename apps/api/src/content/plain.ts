/**
 * Numbers a salon owner can read at a glance.
 *
 * WHAT WAS WRONG WITH THE OLD ONES
 *
 * The screen was showing "$180.88", "$22.61", "$45.21" and "0.15% của tệp mục
 * tiêu". Every one of those is a problem of a different kind:
 *
 *   - Cents on an estimate. $22.61 is the product of an assumed margin and an
 *     averaged ticket. Printing it to the cent tells the reader it was
 *     measured to the cent, which is a claim the arithmetic cannot support.
 *     Rounding is not sloppiness here; it is accuracy about precision.
 *
 *   - A percentage nobody can picture. "0.15% of your target audience" is a
 *     true statement that produces no mental image at all. "8 người trong
 *     5.457" is the same fact and can be understood without arithmetic.
 *
 * The rule this file follows: give the reader the number they would repeat to
 * somebody else. Nobody repeats "nought point one five percent".
 */

import type { Txt } from './i18n';

/**
 * Money, rounded to something a person would say out loud.
 *
 * Under $10 keeps its cents — the difference between $6.30 and $6 matters on a
 * service price. Above that it does not, and the false precision costs more
 * than the accuracy is worth.
 */
export function money0(cents: number, fmt: (c: number) => string): string {
  if (!Number.isFinite(cents)) return fmt(0);
  const abs = Math.abs(cents);
  if (abs < 1_000) return fmt(Math.round(cents));
  if (abs < 100_000) return fmt(Math.round(cents / 100) * 100);
  // Above a thousand units, round to the nearest ten — $1,847 reads as $1,850.
  return fmt(Math.round(cents / 1_000) * 1_000);
}

/** A count with thousands separators. */
export const count = (n: number): string => Math.round(n).toLocaleString('en-US');

/**
 * A small share of a big group, said the way a person would say it.
 *
 * Below 1% a percentage stops meaning anything, so it becomes "8 trong 5.457".
 * Above that the percentage is the clearer form and is kept.
 */
// Deliberately one language: this returns a FRAGMENT, and a sentence with a
// number in it has to be written out whole in each language (word order moves
// the number). The caller assembling the sentence is the place that splits it.
export function share(part: number, whole: number): string {
  if (!whole || whole <= 0 || part < 0) return '';
  const pct = (part / whole) * 100;
  if (pct < 1) return `${count(part)} người trong ${count(whole)}`;
  return `${Math.round(pct)}% (${count(part)} trong ${count(whole)})`;
}

/**
 * Cut a sentence at the last full stop that fits.
 *
 * Used as a seatbelt, not as a style: any line that needs this is a line that
 * should have been written shorter. The tests assert on the writing, and this
 * only stops an unexpected input from producing a wall of text on a phone.
 */
export function firstSentence(text: string, max = 150): string {
  const s = String(text ?? '').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return stop > 40 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`;
}

/**
 * One block of advice, in the order a person reads it.
 *
 * `line` is the finding — short enough to take in without stopping. `action`
 * is what to do about it, always a verb, because a dashboard that only
 * describes is a dashboard nobody opens twice. `why` is the derivation, and it
 * is hidden behind a toggle: the owner who wants to check the arithmetic can,
 * and the one who does not is not made to read it first.
 */
export interface PlainStep {
  key: string;
  /** Emoji, so the eye finds the block before reading a word. */
  icon: string;
  // The four fields below are read off a screen, so each one carries both
  // languages; `key` and `icon` are not words and stay as they are. `Txt`
  // still accepts a plain string, so a builder that has not been translated
  // yet keeps compiling and simply reads the same in either language.
  title: Txt;
  line: Txt;
  /** Imperative. Null when there is genuinely nothing to do yet. */
  action: Txt | null;
  /** Shown only when the reader asks. May be empty. */
  why: Txt;
}
