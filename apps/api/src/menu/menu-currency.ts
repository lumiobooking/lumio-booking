/**
 * A dish's price is in the restaurant's own currency.
 *
 * Dishes used to be saved as USD whatever the restaurant counted in, and the
 * menu page read that label to turn "85000" into minor units — so a đồng
 * restaurant's phở was stored as 8,500,000 (×100) and every screen that reads
 * prices in the restaurant's currency (the till, the bill, the booking page)
 * showed it a hundred times too dear. This puts each dish back in the
 * restaurant's currency, converting minor units when the decimals differ.
 */

const ZERO_DECIMAL = new Set(['VND', 'JPY', 'KRW', 'CLP', 'ISK', 'UGX', 'PYG', 'XAF', 'XOF']);
export const decimalsOf = (code: string | null | undefined) => (ZERO_DECIMAL.has(String(code || '').toUpperCase()) ? 0 : 2);

/** The price a dish should carry once relabelled from `from` to `to` (same amount in the units a person typed). */
export function convertMinor(priceCents: number, from: string | null | undefined, to: string | null | undefined): number {
  const diff = decimalsOf(from) - decimalsOf(to);
  if (diff === 0) return priceCents;
  return diff > 0 ? Math.round(priceCents / 10 ** diff) : Math.round(priceCents * 10 ** -diff);
}

/** The dishes whose label does not match the restaurant's currency, and what they become. */
export function currencyFixes(items: { id: string; priceCents: number; currency: string | null }[], tenantCurrency: string): { id: string; priceCents: number }[] {
  const to = String(tenantCurrency || 'USD').toUpperCase();
  return items
    .filter((i) => String(i.currency || 'USD').toUpperCase() !== to)
    .map((i) => ({ id: i.id, priceCents: convertMinor(i.priceCents, i.currency, to) }));
}
