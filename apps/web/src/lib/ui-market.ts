/**
 * The market this salon trades in, for screens that must show different things
 * in different countries.
 *
 * WHY MODULE-LEVEL RATHER THAN A CONTEXT
 *
 * The same reason `ui-currency.ts` next door is: the screens that need this
 * read it from deep inside render functions that already work, and threading a
 * prop through every one of them would be a large edit to code that is not
 * broken. Set once when the salon's own record loads.
 *
 * WHY IT IS CACHED
 *
 * Because the alternative is a flash of the wrong country. `/me/tenant` resolves
 * a moment after the first paint, so without a cached answer a Vietnamese salon
 * would render the US Census panel and the American card gateways for that
 * moment, every single load. The shell already caches the POS flag, the hidden
 * menu items and the restaurant flag for exactly this reason.
 *
 * WHY THE DEFAULT IS NOT VIETNAM
 *
 * An unknown market resolves to North America, because every salon on this
 * platform before Vietnam is there and because of which way the two mistakes
 * cut. Guessing "Vietnamese" hides Twilio and the card gateways from a US shop
 * that needs them daily — a working salon suddenly missing its own settings.
 * Guessing the other way shows a Vietnamese shop one screen too many, which
 * someone notices and mentions. Only one of those is an outage.
 *
 * WHY ITS OWN FILE
 *
 * i18n.tsx contains JSX, and a module with JSX cannot be imported by a plain
 * test — which is how this logic would have shipped untested.
 */

const KEY = 'lumio_market';

let market = '';

/** Read the cached answer once, so the first paint is already right. */
export function initUiMarket(): void {
  if (market) return;
  try {
    market = String(window.localStorage.getItem(KEY) ?? '').toUpperCase();
  } catch {
    // A browser refusing storage is not an error worth surfacing; the value
    // arrives from the network a moment later either way.
  }
}

/** Called when the salon's own record loads. */
export function setUiMarket(next: string | null | undefined): void {
  const v = String(next ?? '').trim().toUpperCase();
  if (!v) return; // never downgrade a known market to "unknown"
  market = v;
  try { window.localStorage.setItem(KEY, v); } catch { /* ignore */ }
}

export function uiMarket(): string {
  return market;
}
