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

/**
 * The currency this salon counts in.
 *
 * Not just for labels. formatPrice() defaults to it, and that default is what
 * 43 call sites across the dashboard rely on — Tong quan, sales report,
 * payroll, inventory all call formatPrice(cents) with no second argument. They
 * were therefore all printing US dollars for a Vietnamese salon, and worse,
 * dividing by 100 on the way: a 200,000d day showed as US$2,000.00. Wrong
 * currency and wrong magnitude, on the screen an owner uses to decide things.
 *
 * Fixing the default fixes all 43 without touching any of them. 'USD' until
 * told otherwise, so nothing about a US salon changes.
 */
let code = 'USD';

export function setUiCurrency(next: string): void {
  const c = String(next ?? '').trim().toUpperCase();
  if (!c || c === code) return;
  code = c;
  notify();
}

export function uiCurrency(): string {
  return code;
}

/**
 * Anyone who needs to redraw when the symbol arrives.
 *
 * Without this the fix worked BY COINCIDENCE: React does not re-render because
 * a module-level variable changed, and the labels only corrected themselves
 * because setUiCurrencySymbol happened to be called next to some setState calls
 * in the same function. Move that line, or set the symbol from somewhere with
 * no state change, and every money label silently keeps the stale symbol.
 *
 * "Works because of where the line happens to sit" is not a property to leave
 * in a money field.
 */
const listeners = new Set<() => void>();

export function onUiCurrencyChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* a broken listener must not stop the others */ }
  }
}

export function setUiCurrencySymbol(next: string): void {
  const s = String(next ?? '').trim();
  // An empty value would blank the symbol on every money field at once, which
  // is worse than a stale one. Ignore it.
  if (!s || s === symbol) return;
  symbol = s;
  notify();
}

export function uiCurrencySymbol(): string {
  return symbol;
}

/** Replace the {c} placeholder in a label with the salon's own symbol. */
export function applyCurrency(raw: string): string {
  return raw.includes('{c}') ? raw.split('{c}').join(symbol) : raw;
}
