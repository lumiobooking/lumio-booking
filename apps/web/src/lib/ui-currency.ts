/**
 * The currency symbol written on money-entry LABELS.
 *
 * WHY THIS EXISTS
 *
 * Thirteen labels had a dollar sign typed straight into them — "Cash received
 * $", "Price $", "Tip $", "Unit cost ($)" — and crucially in BOTH translations,
 * so the Vietnamese text said it too. A salon in Hanoi counting dong was asked
 * for dollars at its own till.
 *
 * That is not cosmetic. On a money-entry field the symbol is the thing telling
 * the owner what scale to type in, and typing the wrong scale is precisely the
 * bug that turned a 200,000d manicure into d2,000 elsewhere in this codebase.
 *
 * WHY MODULE-LEVEL RATHER THAN A PARAMETER
 *
 * These labels are read from dozens of call sites as a plain t('po.cashReceived'),
 * and threading a currency through every one of them would be a large change to
 * screens that work today. Set once when the salon's settings load.
 *
 * WHY ITS OWN FILE
 *
 * i18n.tsx contains JSX, and a module with JSX in it cannot be imported by a
 * plain test — which is how this logic would have shipped untested. Same reason
 * defaultLangForMarket lives in markets.ts.
 */

/** Default is what every one of those labels used to hardcode, so an app that
 *  never calls the setter behaves exactly as it did before. */
let symbol = '$';

export function setUiCurrencySymbol(next: string): void {
  const s = String(next ?? '').trim();
  // An empty value would blank the symbol on every money field at once, which
  // is worse than a stale one. Ignore it.
  if (s) symbol = s;
}

export function uiCurrencySymbol(): string {
  return symbol;
}

/** Replace the {c} placeholder in a label with the salon's own symbol. */
export function applyCurrency(raw: string): string {
  return raw.includes('{c}') ? raw.split('{c}').join(symbol) : raw;
}
