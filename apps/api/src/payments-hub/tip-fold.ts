/**
 * THE TIP IS ON THE CARD, WHATEVER THE TERMINAL.
 *
 * The till sends a card charge as amount + tip (separate, so a terminal that
 * itemises tips can print them on its slip). Only Dejavoo / iPOSpays does
 * anything with the separate tip; Stripe, Square, Helcim, SumUp… charged the
 * amount alone — a customer who added a $10 tip and paid by card was charged
 * $10 less than the sale Lumio recorded. Every other provider now gets one
 * total. Pure.
 */
export const ITEMIZES_TIP: ReadonlySet<string> = new Set(['dejavoo']);

export function chargeAmounts(provider: string, amountCents: number, tipCents?: number | null): { amountCents: number; tipCents?: number } {
  const tip = typeof tipCents === 'number' && tipCents > 0 ? Math.round(tipCents) : 0;
  if (ITEMIZES_TIP.has(provider)) return { amountCents, ...(tip ? { tipCents: tip } : {}) };
  return { amountCents: amountCents + tip };
}
