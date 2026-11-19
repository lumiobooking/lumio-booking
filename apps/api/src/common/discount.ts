/**
 * Giá gạch & giảm giá (19/11/2026): a service, product or dish may be on sale
 * by a PERCENT (−20%) or by an AMOUNT (−50.000đ / −$5). Pure; mirrored at the top of
 * apps/web/src/lib/discount.ts (a spec keeps them the same).
 *
 * One rule everywhere: an amount, when set, wins; otherwise the percent
 * (0–90, as before). The sale price never goes below 0, and an amount off can
 * never be more than the price. A row with neither is simply full price.
 */

export type Discountable = { priceCents: number; discountPercent?: number | null; discountCents?: number | null };

export function pctOf(v: unknown): number {
  const n = Math.round(Number(v ?? 0));
  return Number.isFinite(n) ? Math.min(90, Math.max(0, n)) : 0;
}

/** The amount off, in cents, for this price (0 when not on sale). */
export function offCents(row: Discountable): number {
  const price = Math.max(0, Math.round(Number(row.priceCents ?? 0)));
  const fixed = Math.max(0, Math.round(Number(row.discountCents ?? 0)));
  if (fixed > 0) return Math.min(price, fixed);
  const p = pctOf(row.discountPercent);
  return p > 0 ? price - Math.round((price * (100 - p)) / 100) : 0;
}

/** What the customer pays. */
export function salePrice(row: Discountable): number {
  return Math.max(0, Math.round(Number(row.priceCents ?? 0))) - offCents(row);
}

export function onSale(row: Discountable): boolean {
  return offCents(row) > 0;
}

/** The percent to SHOW for the badge: exact for a percent sale, rounded for an amount (never 0 when on sale). */
export function shownPercent(row: Discountable): number {
  const price = Math.max(0, Math.round(Number(row.priceCents ?? 0)));
  const off = offCents(row);
  if (!off || !price) return 0;
  if (!(Number(row.discountCents ?? 0) > 0)) return pctOf(row.discountPercent);
  return Math.max(1, Math.round((off * 100) / price));
}

/**
 * What a save stores: exactly one kind of discount. `kind` 'percent' keeps the
 * percent and clears the amount; 'amount' keeps the amount (capped at the
 * price) and clears the percent; 'none' clears both. Without a kind the two
 * fields are read as sent, and an amount wins over a percent.
 */
export function cleanDiscount(input: { kind?: unknown; discountPercent?: unknown; discountCents?: unknown }, priceCents: number): { discountPercent: number; discountCents: number } {
  const price = Math.max(0, Math.round(Number(priceCents ?? 0)));
  const amount = Math.min(price, Math.max(0, Math.round(Number(input.discountCents ?? 0)) || 0));
  const pct = pctOf(input.discountPercent);
  if (input.kind === 'none') return { discountPercent: 0, discountCents: 0 };
  if (input.kind === 'percent') return { discountPercent: pct, discountCents: 0 };
  if (input.kind === 'amount') return { discountPercent: 0, discountCents: amount };
  return amount > 0 ? { discountPercent: 0, discountCents: amount } : { discountPercent: pct, discountCents: 0 };
}
