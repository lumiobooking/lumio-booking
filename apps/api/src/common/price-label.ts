/**
 * How a service's price is SAID — to the customer, the AI and in messages.
 *
 * Price 0 is not "free": salons leave the price empty when the tech quotes
 * after seeing the nails (a Solar full set, nail art per nail). Shown as
 * "$0.00" a customer reads it as free and is upset at the counter (VN Nails,
 * 6 Nov 2026). So 0 is "priced at the salon", unless the salon marked the
 * service free (a consultation). Pure.
 */
export type PriceMode = 'fixed' | 'from' | 'salon' | 'free';

export interface PricedLike { priceCents: number; priceFrom?: boolean | null; isFree?: boolean | null }

export function priceMode(s: PricedLike): PriceMode {
  if ((s.priceCents ?? 0) > 0) return s.priceFrom ? 'from' : 'fixed';
  return s.isFree ? 'free' : 'salon';
}

/**
 * The price as the AI may read it out (chat and phone menus). A service
 * priced at the salon carries the instruction never to invent a number.
 */
export function aiPriceText(s: PricedLike, money: (cents: number) => string): string {
  switch (priceMode(s)) {
    case 'fixed': return money(s.priceCents);
    case 'from': return `${money(s.priceCents)} and up (a starting price — say it that way)`;
    case 'free': return 'free';
    default: return 'price quoted at the salon after the tech sees the nails (no set price — never invent or guess one; never say free)';
  }
}

/** A booking total for a message: 0 → "priced at the salon", never "$0.00". */
export function totalText(cents: number, money: (cents: number) => string, vi: boolean): string {
  return cents > 0 ? money(cents) : (vi ? 'Báo giá tại tiệm' : 'Priced at the salon');
}
