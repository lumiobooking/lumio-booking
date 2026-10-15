/**
 * WHICH GATEWAY HOLDS A SALON'S CARD — decided in one place.
 *
 * The platform may have PayPal today and Stripe tomorrow. Nothing else in
 * the code is allowed to know which: a salon's money goes to whichever
 * gateway its ACTIVE subscription lives on, new sign-ups go to the gateway
 * this file prefers among the ones configured, and the month-end usage
 * charge is dispatched by the same rule. Adding a gateway means adding a
 * name here and a service that implements `charge` — not touching the
 * screens, the scheduler or the invoice.
 *
 * Pure: no network, no database. The services pass in what they know.
 */

export type Gateway = 'stripe' | 'paypal';

/** Preference order for NEW subscriptions. Stripe first: a real card form,
 *  no account to create, a self-serve portal for the card. PayPal second. */
export const GATEWAY_PREFERENCE: Gateway[] = ['stripe', 'paypal'];

export interface GatewaysEnabled { stripe: boolean; paypal: boolean }

/** The gateways a salon may sign up on right now, in preference order. */
export function enabledGateways(g: GatewaysEnabled): Gateway[] {
  return GATEWAY_PREFERENCE.filter((k) => g[k]);
}

/**
 * The gateway a new subscription goes to. The caller's explicit choice wins
 * when that gateway is on; otherwise the first configured one; null when
 * nothing is configured (the screen then says "not available").
 */
export function pickGateway(g: GatewaysEnabled, asked?: Gateway | null): Gateway | null {
  if (asked && g[asked]) return asked;
  return enabledGateways(g)[0] ?? null;
}

export interface SubscriptionFacts {
  provider: string | null;
  status: string | null;
  /** Provider subscription id (PayPal I-… / Stripe sub_…). */
  externalReference: string | null;
  /** Stripe customer id; PayPal has none. */
  externalCustomerId: string | null;
}

/** Only these two are gateways; anything else on the row is "manual". */
export function gatewayOf(provider: string | null | undefined): Gateway | null {
  return provider === 'stripe' || provider === 'paypal' ? provider : null;
}

/** Live enough to be charged: ACTIVE or TRIALING, never PAST_DUE/CANCELLED. */
export function subscriptionLive(status: string | null | undefined): boolean {
  return status === 'ACTIVE' || status === 'TRIALING';
}

/**
 * Can month-end usage charges be taken from this subscription by itself?
 * PayPal: needs the subscription id (outstanding-balance capture).
 * Stripe: needs the customer id (off-session charge on the card on file).
 */
export function canAutoCharge(sub: SubscriptionFacts | null | undefined): boolean {
  if (!sub) return false;
  const g = gatewayOf(sub.provider);
  if (!g || !subscriptionLive(sub.status)) return false;
  if (g === 'paypal') return !!sub.externalReference;
  return !!sub.externalCustomerId;
}

/**
 * Where the salon manages its card. Stripe has a portal the server mints a
 * link for (handled by the caller); PayPal's automatic payments live in the
 * payer's own account, same page for everyone.
 */
export function manageCardUrl(g: Gateway | null): string | null {
  if (g === 'paypal') return 'https://www.paypal.com/myaccount/autopay/';
  return null; // stripe: the caller mints a Billing Portal link
}

/**
 * When a NEW subscription becomes live, every OTHER live subscription of the
 * same salon must be cancelled at its gateway — a salon that moved from
 * PayPal to Stripe must not pay twice. Returns the rows to retire.
 */
export function subscriptionsToRetire<T extends { externalReference: string | null; status: string | null }>(rows: T[], keepRef: string): T[] {
  return rows.filter((r) => r.externalReference && r.externalReference !== keepRef && subscriptionLive(r.status));
}
