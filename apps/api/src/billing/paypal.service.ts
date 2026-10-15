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

  /** Validates the credentials by fetching an OAuth token. */
  async ping(): Promise<void> {
    await this.token();
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

  /**
   * Charge an extra amount to an ACTIVE subscription — the month-end usage
   * overage — without ever holding a card: the amount is written to the
   * subscription's outstanding balance, then captured from the subscriber's
   * PayPal funding source. Plans are created with auto_bill_outstanding, so a
   * capture PayPal declines today is still collected with the next cycle.
   *
   * Returns the capture id on success; throws with PayPal's own words otherwise.
   */
  async chargeOutstanding(params: { subscriptionId: string; amountCents: number; currency: string; note: string }): Promise<{ captureId: string; status: string }> {
    const { access, base } = await this.token();
    const currency = (params.currency || 'USD').toUpperCase();
    const value = (params.amountCents / 100).toFixed(2);
    const h = { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' };
    const patch = await fetch(`${base}/v1/billing/subscriptions/${encodeURIComponent(params.subscriptionId)}`, {
      method: 'PATCH', headers: h,
      body: JSON.stringify([{ op: 'replace', path: '/billing_info/outstanding_balance', value: { currency_code: currency, value } }]),
    });
    if (!patch.ok) {
      const j = (await patch.json().catch(() => ({}))) as { message?: string; details?: { description?: string }[] };
      throw new BadRequestException(`PayPal balance update failed: ${j.details?.[0]?.description ?? j.message ?? patch.status}`);
    }
    const cap = await fetch(`${base}/v1/billing/subscriptions/${encodeURIComponent(params.subscriptionId)}/capture`, {
      method: 'POST', headers: { ...h, 'PayPal-Request-Id': `cap-${params.subscriptionId}-${params.amountCents}-${Date.now()}` },
      body: JSON.stringify({ note: params.note.slice(0, 127), capture_type: 'OUTSTANDING_BALANCE', amount: { currency_code: currency, value } }),
    });
    const j = (await cap.json().catch(() => ({}))) as { id?: string; status?: string; message?: string; details?: { description?: string }[] };
    if (!cap.ok || !j.id) throw new BadRequestException(`PayPal capture failed: ${j.details?.[0]?.description ?? j.message ?? cap.status}`);
    return { captureId: j.id, status: j.status ?? 'COMPLETED' };
  }

  // ---- cards saved in Lumio's own page (Vault v3 + Advanced Card Payments) ----

  /** A setup token the browser's Card Fields fill in. Nothing sensitive here. */
  async createSetupToken(): Promise<{ id: string }> {
    const { access, base } = await this.token();
    const res = await fetch(`${base}/v3/vault/setup-tokens`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `setup-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      body: JSON.stringify({ payment_source: { card: {} } }),
    });
    const j = (await res.json().catch(() => ({}))) as { id?: string; message?: string; details?: { description?: string }[] };
    if (!res.ok || !j.id) throw new BadRequestException(`PayPal setup token failed: ${j.details?.[0]?.description ?? j.message ?? res.status}`);
    return { id: j.id };
  }

  /** The approved setup token becomes a permanent payment token (the vault id we charge). */
  async createPaymentToken(setupTokenId: string): Promise<{ id: string; customerId: string | null; raw: unknown }> {
    const { access, base } = await this.token();
    const res = await fetch(`${base}/v3/vault/payment-tokens`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `pt-${setupTokenId}` },
      body: JSON.stringify({ payment_source: { token: { id: setupTokenId, type: 'SETUP_TOKEN' } } }),
    });
    const j = (await res.json().catch(() => ({}))) as { id?: string; customer?: { id?: string }; message?: string; details?: { description?: string }[] };
    if (!res.ok || !j.id) throw new BadRequestException(`PayPal could not save the card: ${j.details?.[0]?.description ?? j.message ?? res.status}`);
    return { id: j.id, customerId: j.customer?.id ?? null, raw: j };
  }

  /** Charge a saved card: an order paid with the vault id, captured at once. Merchant-initiated. */
  async chargeVault(p: { vaultId: string; amountCents: number; currency: string; description: string; invoiceId: string }): Promise<{ captureId: string; orderId: string }> {
    const { access, base } = await this.token();
    const currency = (p.currency || 'USD').toUpperCase();
    const res = await fetch(`${base}/v2/checkout/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': `inv-${p.invoiceId}-${p.amountCents}` },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: currency, value: (p.amountCents / 100).toFixed(2) }, description: p.description.slice(0, 127), custom_id: p.invoiceId, invoice_id: p.invoiceId }],
        payment_source: { card: { vault_id: p.vaultId, stored_credential: { payment_initiator: 'MERCHANT', payment_type: 'UNSCHEDULED', usage: 'SUBSEQUENT' } } },
      }),
    });
    const j = (await res.json().catch(() => ({}))) as {
      id?: string; status?: string; message?: string; details?: { description?: string; issue?: string }[];
      purchase_units?: { payments?: { captures?: { id: string; status: string; processor_response?: { response_code?: string } }[] } }[];
    };
    const cap = j.purchase_units?.[0]?.payments?.captures?.[0];
    if (!res.ok || j.status !== 'COMPLETED' || !cap?.id || cap.status !== 'COMPLETED') {
      throw new BadRequestException(j.details?.[0]?.description ?? j.details?.[0]?.issue ?? j.message ?? `PayPal ${j.status ?? res.status}`);
    }
    return { captureId: cap.id, orderId: j.id ?? '' };
  }

  /** Forget a saved card at PayPal. 404 = already gone. */
  async deletePaymentToken(id: string): Promise<void> {
    const { access, base } = await this.token();
    const res = await fetch(`${base}/v3/vault/payment-tokens/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${access}` } });
    if (!res.ok && res.status !== 404) throw new BadRequestException(`PayPal could not remove the card (${res.status})`);
  }

  /** Cancel a subscription at PayPal (a salon moved to another gateway). */
  async cancelSubscription(id: string, reason = 'Replaced by a new subscription'): Promise<void> {
    const { access, base } = await this.token();
    const res = await fetch(`${base}/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, {
      method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.slice(0, 127) }),
    });
    // 204 = cancelled; 422 UNPROCESSABLE on one already cancelled/expired is fine too.
    if (!res.ok && res.status !== 422) {
      const j = (await res.json().catch(() => ({}))) as { message?: string };
      throw new BadRequestException(`PayPal cancel failed: ${j.message ?? res.status}`);
    }
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
