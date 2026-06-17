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

  /** Verify a webhook payload signature and return the parsed event. */
  async constructEvent(rawBody: Buffer, signature: string): Promise<Stripe.Event> {
    const secret = await this.platform.get('stripe_webhook_secret');
    if (!secret) throw new BadRequestException('Stripe webhook secret not configured');
    const stripe = await this.client();
    return stripe.webhooks.constructEvent(rawBody, signature, secret);
  }

  async getSubscription(id: string): Promise<Stripe.Subscription> {
    const stripe = await this.client();
    return stripe.subscriptions.retrieve(id);
  }

  /** Customer-facing billing portal link (upgrade/downgrade/cancel/update card). */
  async billingPortalUrl(customerId: string, returnUrl: string): Promise<string> {
    const stripe = await this.client();
    const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    return session.url;
  }
}
