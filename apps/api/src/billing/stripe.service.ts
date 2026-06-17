import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * Thin wrapper around the Stripe SDK. Lazily initialised so the API still boots
 * when Stripe keys are not configured yet (the feature is simply disabled).
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger('StripeService');
  private client: Stripe | null = null;

  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return !!this.config.get<string>('STRIPE_SECRET_KEY');
  }

  private stripe(): Stripe {
    if (!this.client) {
      const key = this.config.get<string>('STRIPE_SECRET_KEY');
      if (!key) throw new BadRequestException('Stripe is not configured');
      // apiVersion cast keeps this compiling across stripe SDK minor versions.
      this.client = new Stripe(key, { apiVersion: '2024-06-20' as any });
    }
    return this.client;
  }

  /**
   * Create a hosted Checkout Session in subscription mode with a free trial.
   * metadata carries our tenant/plan context back through the webhook.
   */
  async createCheckoutSession(params: {
    amountCents: number;
    currency: string;
    interval: 'month' | 'year';
    productName: string;
    trialDays: number;
    customerEmail: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
  }): Promise<{ url: string }> {
    // Inline price_data — no pre-created Stripe Price needed. The amount comes
    // straight from the plan the admin configured, so every tier "just works".
    const session = await this.stripe().checkout.sessions.create({
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

  /** Verify a webhook payload signature and return the parsed event. */
  constructEvent(rawBody: Buffer, signature: string): Stripe.Event {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) throw new BadRequestException('Stripe webhook secret not configured');
    return this.stripe().webhooks.constructEvent(rawBody, signature, secret);
  }

  /** Fetch a subscription (used to read period end / status on checkout completion). */
  async getSubscription(id: string): Promise<Stripe.Subscription> {
    return this.stripe().subscriptions.retrieve(id);
  }

  /** A customer-facing billing portal link so salons can manage/cancel their plan. */
  async billingPortalUrl(customerId: string, returnUrl: string): Promise<string> {
    const session = await this.stripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url;
  }
}
