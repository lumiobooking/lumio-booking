import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PlatformConfigService } from './platform-config.service';

/**
 * PayPal Subscriptions via REST. Credentials come from PlatformConfig (DB, set
 * in the Super Admin UI) with env fallback.
 */
@Injectable()
export class PaypalService {
  private readonly logger = new Logger('PaypalService');

  constructor(private readonly platform: PlatformConfigService) {}

  async isEnabled(): Promise<boolean> {
    const [id, secret] = await Promise.all([this.platform.get('paypal_client_id'), this.platform.get('paypal_secret')]);
    return !!(id && secret);
  }

  private async base(): Promise<string> {
    const env = ((await this.platform.get('paypal_env')) ?? 'live').toLowerCase();
    return env === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
  }

  private async token(): Promise<{ access: string; base: string }> {
    const [id, secret] = await Promise.all([this.platform.get('paypal_client_id'), this.platform.get('paypal_secret')]);
    if (!id || !secret) throw new BadRequestException('PayPal is not configured');
    const base = await this.base();
    const res = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new BadRequestException('PayPal auth failed');
    const json = (await res.json()) as { access_token: string };
    return { access: json.access_token, base };
  }

  /** Create a PayPal product + billing plan from an amount; returns the plan id. */
  async createPlan(params: { name: string; amountCents: number; currency: string; interval: 'month' | 'year' }): Promise<string> {
    const { access, base } = await this.token();
    const prodRes = await fetch(`${base}/v1/catalogs/products`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: params.name, type: 'SERVICE', category: 'SOFTWARE' }),
    });
    const prod = (await prodRes.json()) as { id?: string; message?: string };
    if (!prodRes.ok || !prod.id) throw new BadRequestException(`PayPal product failed: ${prod.message ?? 'unknown'}`);

    const value = (params.amountCents / 100).toFixed(2);
    const planRes = await fetch(`${base}/v1/billing/plans`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: prod.id,
        name: `${params.name} (${params.interval}ly)`,
        billing_cycles: [{
          frequency: { interval_unit: params.interval === 'year' ? 'YEAR' : 'MONTH', interval_count: 1 },
          tenure_type: 'REGULAR', sequence: 1, total_cycles: 0,
          pricing_scheme: { fixed_price: { value, currency_code: (params.currency || 'USD').toUpperCase() } },
        }],
        payment_preferences: { auto_bill_outstanding: true, setup_fee_failure_action: 'CONTINUE', payment_failure_threshold: 3 },
      }),
    });
    const plan = (await planRes.json()) as { id?: string; message?: string };
    if (!planRes.ok || !plan.id) throw new BadRequestException(`PayPal plan failed: ${plan.message ?? 'unknown'}`);
    return plan.id;
  }

  /** Create a subscription against a plan; returns the approval URL. */
  async createSubscription(params: { planId: string; tenantId: string; email: string; brandName: string; returnUrl: string; cancelUrl: string }): Promise<{ url: string; subscriptionId: string }> {
    const { access, base } = await this.token();
    const res = await fetch(`${base}/v1/billing/subscriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan_id: params.planId,
        custom_id: params.tenantId,
        subscriber: { email_address: params.email },
        application_context: {
          brand_name: params.brandName, user_action: 'SUBSCRIBE_NOW', shipping_preference: 'NO_SHIPPING',
          return_url: params.returnUrl, cancel_url: params.cancelUrl,
        },
      }),
    });
    const json = (await res.json()) as { id?: string; links?: { rel: string; href: string }[]; message?: string };
    if (!res.ok || !json.id) throw new BadRequestException(`PayPal subscription failed: ${json.message ?? 'unknown'}`);
    const approve = json.links?.find((l) => l.rel === 'approve')?.href;
    if (!approve) throw new BadRequestException('PayPal did not return an approval link');
    return { url: approve, subscriptionId: json.id };
  }

  async getSubscription(id: string): Promise<any> {
    const { access, base } = await this.token();
    const res = await fetch(`${base}/v1/billing/subscriptions/${id}`, { headers: { Authorization: `Bearer ${access}` } });
    if (!res.ok) throw new BadRequestException('Could not read PayPal subscription');
    return res.json();
  }

  /** Verify a webhook signature via PayPal's verification endpoint. */
  async verifyWebhook(headers: Record<string, string | undefined>, body: unknown): Promise<boolean> {
    const webhookId = await this.platform.get('paypal_webhook_id');
    if (!webhookId) return false;
    const { access, base } = await this.token();
    const res = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
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
