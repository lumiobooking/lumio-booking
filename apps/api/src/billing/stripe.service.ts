import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PlatformConfigService } from './platform-config.service';

/**
 * Thin wrapper around the Stripe SDK. Keys come from PlatformConfig (DB, set in
 * the Super Admin UI) with env fallback, resolved per call so changes in the UI
 * take effect immediately without a redeploy.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger('StripeService');

  constructor(private readonly platform: PlatformConfigService) {}

  async isEnabled(): Promise<boolean> {
    return !!(await this.platform.get('stripe_secret_key'));
  }

  private async client(): Promise<Stripe> {
    const key = await this.platform.get('stripe_secret_key');
    if (!key) throw new BadRequestException('Stripe is not configured');
    return new Stripe(key, { apiVersion: '2024-06-20' as any });
  }

  /** Hosted Checkout in subscription mode with inline pricing + free trial. */
  async createCheckoutSession(params: {
    amountCents: number; currency: string; interval: 'month' | 'year'; productName: string;
    trialDays: number; customerEmail: string; successUrl: string; cancelUrl: string; metadata: Record<string, string>;
  }): Promise<{ url: string }> {
    const stripe = await this.client();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: (params.currency || 'USD').toLowerCase(),
          product_data: { name: params.productName },
          unit_amount: params.amountCents,
          recurring: { interval: params.interval },
        },
      }],
      customer_email: params.customerEmail,
      subscription_data: {
        trial_period_days: params.trialDays > 0 ? params.trialDays : undefined,
        metadata: params.metadata,
      },
      allow_promotion_codes: true,
      metadata: params.metadata,
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
    if (!session.url) throw new BadRequestException('Could not start Stripe checkout');
    return { url: session.url };
  }

  /** Hosted Checkout for a ONE-TIME charge (a usage-overage or renewal invoice). */
  async createPaymentSession(params: {
    amountCents: number; currency: string; productName: string;
    customerEmail?: string; successUrl: string; cancelUrl: string; metadata: Record<string, string>;
  }): Promise<{ url: string }> {
    const stripe = await this.client();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: (params.currency || 'USD').toLowerCase(),
          product_data: { name: params.productName },
          unit_amount: params.amountCents,
        },
      }],
      customer_email: params.customerEmail || undefined,
      metadata: params.metadata,
      payment_intent_data: { metadata: params.metadata },
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
    if (!session.url) throw new BadRequestException('Could not start Stripe checkout');
    return { url: session.url };
  }

  /** Read a Checkout Session to confirm payment on return from Stripe. */
  async getCheckoutSession(id: string): Promise<{ paymentStatus: string; metadata: Record<string, string> }> {
    const stripe = await this.client();
    const s = await stripe.checkout.sessions.retrieve(id);
    return { paymentStatus: s.payment_status ?? 'unpaid', metadata: (s.metadata ?? {}) as Record<string, string> };
  }

  /** Verify a webhook payload signature and return the parsed event. */
  async constructEvent(rawBody: Buffer, signature: string): Promise<Stripe.Event> {
    const secret = await this.platform.get('stripe_webhook_secret');
    if (!secret) throw new BadRequestException('Stripe webhook secret not configured');
    const stripe = await this.client();
    return stripe.webhooks.constructEvent(rawBody, signature, secret);
  }

  /** Validates the secret key by making a trivial authenticated call. */
  async ping(): Promise<void> {
    const stripe = await this.client();
    await stripe.balance.retrieve();
  }

  async getSubscription(id: string): Promise<Stripe.Subscription> {
    const stripe = await this.client();
    return stripe.subscriptions.retrieve(id);
  }

  /**
   * Charge the card a customer saved with their subscription — the month-end
   * usage overage — without the customer present. Uses the subscription's
   * default payment method, else the customer's. Stripe may decline or ask
   * for authentication; either throws with Stripe's own words and the
   * caller leaves the invoice open (the hosted page still takes a card).
   */
  async chargeCustomer(params: { customerId: string; amountCents: number; currency: string; description: string; metadata: Record<string, string> }): Promise<{ paymentIntentId: string; status: string }> {
    const stripe = await this.client();
    const customer = await stripe.customers.retrieve(params.customerId, { expand: ['subscriptions'] }) as Stripe.Customer | Stripe.DeletedCustomer;
    if ((customer as Stripe.DeletedCustomer).deleted) throw new BadRequestException('Stripe customer no longer exists');
    const c = customer as Stripe.Customer;
    const live = c.subscriptions?.data.find((x) => x.status === 'active' || x.status === 'trialing');
    const pm = (live?.default_payment_method as string | null) ?? (c.invoice_settings?.default_payment_method as string | null) ?? null;
    if (!pm) throw new BadRequestException('No card on file for this customer');
    const pi = await stripe.paymentIntents.create({
      amount: params.amountCents, currency: (params.currency || 'USD').toLowerCase(),
      customer: params.customerId, payment_method: pm, off_session: true, confirm: true,
      description: params.description, metadata: params.metadata,
    }, { idempotencyKey: `inv-${params.metadata.invoiceId ?? params.description}-${params.amountCents}` });
    if (pi.status !== 'succeeded') throw new BadRequestException(`Stripe payment ${pi.status}`);
    return { paymentIntentId: pi.id, status: pi.status };
  }

  // ---- cards saved in Lumio's own page (SetupIntent + Payment Element) ----

  /** A Stripe customer for the salon, so the card has somewhere to live. */
  async ensureCustomer(p: { email?: string; name?: string; tenantId: string }): Promise<string> {
    const stripe = await this.client();
    const c = await stripe.customers.create({ email: p.email, name: p.name, metadata: { tenantId: p.tenantId } });
    return c.id;
  }

  /** What the browser's Payment Element needs to collect a card for later charges. */
  async createSetupIntent(customerId: string): Promise<{ id: string; clientSecret: string }> {
    const stripe = await this.client();
    const si = await stripe.setupIntents.create({ customer: customerId, usage: 'off_session', payment_method_types: ['card'] });
    if (!si.client_secret) throw new BadRequestException('Stripe did not return a client secret');
    return { id: si.id, clientSecret: si.client_secret };
  }

  /** After the browser confirmed the SetupIntent: the card, made the customer's default. */
  async confirmSetupIntent(id: string): Promise<{ paymentMethodId: string; customerId: string; paymentMethod: unknown }> {
    const stripe = await this.client();
    const si = await stripe.setupIntents.retrieve(id);
    if (si.status !== 'succeeded' || !si.payment_method) throw new BadRequestException(`Stripe setup ${si.status}`);
    const pmId = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method.id;
    const customerId = typeof si.customer === 'string' ? si.customer : si.customer?.id;
    if (!customerId) throw new BadRequestException('Stripe setup has no customer');
    await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pmId } });
    const pm = await stripe.paymentMethods.retrieve(pmId);
    return { paymentMethodId: pmId, customerId, paymentMethod: pm };
  }

  /** Charge a saved card off-session. */
  async chargePaymentMethod(p: { customerId: string; paymentMethodId: string; amountCents: number; currency: string; description: string; metadata: Record<string, string> }): Promise<{ paymentIntentId: string }> {
    const stripe = await this.client();
    const pi = await stripe.paymentIntents.create({
      amount: p.amountCents, currency: (p.currency || 'USD').toLowerCase(),
      customer: p.customerId, payment_method: p.paymentMethodId, off_session: true, confirm: true,
      description: p.description, metadata: p.metadata,
    }, { idempotencyKey: `inv-${p.metadata.invoiceId ?? p.description}-${p.amountCents}` });
    if (pi.status !== 'succeeded') throw new BadRequestException(`Stripe payment ${pi.status}`);
    return { paymentIntentId: pi.id };
  }

  async detachPaymentMethod(id: string): Promise<void> {
    const stripe = await this.client();
    await stripe.paymentMethods.detach(id).catch(() => undefined);
  }

  /** Cancel a subscription at Stripe (a salon moved to another gateway). */
  async cancelSubscription(id: string): Promise<void> {
    const stripe = await this.client();
    await stripe.subscriptions.cancel(id);
  }

  /** Customer-facing billing portal link (upgrade/downgrade/cancel/update card). */
  async billingPortalUrl(customerId: string, returnUrl: string): Promise<string> {
    const stripe = await this.client();
    const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    return session.url;
  }
}
