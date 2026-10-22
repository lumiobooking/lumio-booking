/**
 * The providers that can take a card ONLINE (a booking deposit, or the whole
 * visit paid in advance) and give it back. A connection to one of these, live
 * on the payment hub, is the only thing that makes "pay online" or "deposit"
 * real; without one, nothing may be recorded as paid. Pure.
 */
export const ONLINE_PROVIDERS = ['stripe', 'square', 'helcim', 'paypal', 'clover'] as const;
export type OnlineProvider = (typeof ONLINE_PROVIDERS)[number];
export const isOnlineProvider = (p: unknown): p is OnlineProvider => typeof p === 'string' && (ONLINE_PROVIDERS as readonly string[]).includes(p);

/** Is the payment hub switched on for this deploy? */
export const hubEnabled = () => process.env.PAYMENTS_HUB_ENABLED === 'true';
