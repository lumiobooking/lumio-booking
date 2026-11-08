/**
 * Whether a booking page offers "Pay with Venmo" for a deposit, and with what.
 *
 * Venmo is taken through the salon's OWN PayPal business account (Venmo is a
 * PayPal funding source), so it needs: PayPal as the salon's online provider,
 * PayPal's public client id, and US dollars — Venmo is US-only. Anything else
 * (Square, Stripe, Helcim, a Canadian salon) gets no Venmo button.
 */
export interface VenmoOption { clientId: string; env: 'sandbox' | 'live'; currency: 'USD' }

export function venmoOption(cfg: { provider?: string; paypal?: { clientId: string; env: 'sandbox' | 'live' } } | null | undefined, currency: string): VenmoOption | null {
  if (!cfg || cfg.provider !== 'paypal' || !cfg.paypal?.clientId) return null;
  if (String(currency || '').toUpperCase() !== 'USD') return null;
  return { clientId: cfg.paypal.clientId, env: cfg.paypal.env, currency: 'USD' };
}
