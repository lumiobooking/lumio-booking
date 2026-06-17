import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * PayPal Subscriptions via the REST API (no SDK needed — Node's global fetch).
 * Lazily uses credentials so the API boots fine when PayPal isn't configured.
 */
@Injectable()
export class PaypalService {
  private readonly logger = new Logger('PaypalService');

  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return !!(this.config.get<string>('PAYPAL_CLIENT_ID') && this.config.get<string>('PAYPAL_SECRET'));
  }

  private base(): string {
    const env = (this.config.get<string>('PAYPAL_ENV') ?? 'live').toLowerCase();
    return env === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
  }

  private async token(): Promise<string> {
    const id = this.config.get<string>('PAYPAL_CLIENT_ID');
    const secret = this.config.get<string>('PAYPAL_SECRET');
    if (!id || !secret) throw new BadRequestException('PayPal is not configured');
    const res = await fetch(`${this.base()}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new BadRequestException('PayPal auth failed');
    const json = (await res.json()) as { access_token: string };
    return json.access_token;
  }

  /**
   * Create a subscription against an existing PayPal billing plan and return the
   * approval URL the customer is redirected to. custom_id carries our tenantId.
   */
  async createSubscription(params: {
    planId: string;
    tenantId: string;
    email: string;
    brandName: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string; subscriptionId: string }> {
    const access = await this.token();
    const res = await fetch(`${this.base()}/v1/billing/subscriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan_id: params.planId,
        custom_id: params.tenantId,
        subscriber: { email_address: params.email },
        application_context: {
          brand_name: params.brandName,
          user_action: 'SUBSCRIBE_NOW',
          shipping_preference: 'NO_SHIPPING',
          return_url: params.returnUrl,
          cancel_url: params.cancelUrl,
        },
      }),
    });
    const json = (await res.json()) as { id?: string; links?: { rel: string; href: string }[]; message?: string };
    if (!res.ok || !json.id) throw new BadRequestException(`PayPal subscription failed: ${json.message ?? 'unknown'}`);
    const approve = json.links?.find((l) => l.rel === 'approve')?.href;
    if (!approve) throw new BadRequestException('PayPal did not return an approval link');
    return { url: approve, subscriptionId: json.id };
  }

  /**
   * Create a PayPal product + billing plan from a plain amount, and return the
   * plan id. Used to auto-provision plans so the admin never pastes PayPal IDs.
   */
  async createPlan(params: { name: string; amountCents: number; currency: string; interval: 'month' | 'year' }): Promise<string> {
    const access = await this.token();
    const base = this.base();
    // 1) Product (idempotent enough for our use; PayPal allows duplicates).
    const prodRes = await fetch(`${base}/v1/catalogs/products`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: params.name, type: 'SERVICE', category: 'SOFTWARE' }),
    });
    const prod = (await prodRes.json()) as { id?: string; message?: string };
    if (!prodRes.ok || !prod.id) throw new BadRequestException(`PayPal product failed: ${prod.message ?? 'unknown'}`);

    // 2) Plan with a single regular billing cycle (infinite).
    const value = (params.amountCents / 100).toFixed(2);
    const planRes = await fetch(`${base}/v1/billing/plans`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: prod.id,
        name: `${params.name} (${params.interval}ly)`,
        billing_cycles: [{
          frequency: { interval_unit: params.interval === 'year' ? 'YEAR' : 'MONTH', interval_count: 1 },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: { fixed_price: { value, currency_code: (params.currency || 'USD').toUpperCase() } },
        }],
        payment_preferences: { auto_bill_outstanding: true, setup_fee_failure_action: 'CONTINUE', payment_failure_threshold: 3 },
      }),
    });
    const plan = (await planRes.json()) as { id?: string; message?: string };
    if (!planRes.ok || !plan.id) throw new BadRequestException(`PayPal plan failed: ${plan.message ?? 'unknown'}`);
    return plan.id;
  }

  async getSubscription(id: string): Promise<any> {
    const access = await this.token();
    const res = await fetch(`${this.base()}/v1/billing/subscriptions/${id}`, {
      headers: { Authorization: `Bearer ${access}` },
    });
    if (!res.ok) throw new BadRequestException('Could not read PayPal subscription');
    return res.json();
  }

  /** Verify a webhook signature using PayPal's verification endpoint. */
  async verifyWebhook(headers: Record<string, string | undefined>, body: unknown): Promise<boolean> {
    const webhookId = this.config.get<string>('PAYPAL_WEBHOOK_ID');
    if (!webhookId) return false;
    const access = await this.token();
    const res = await fetch(`${this.base()}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: webhookId,
        webhook_event: body,
      }),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { verification_status: string };
    return json.verification_status === 'SUCCESS';
  }
}
