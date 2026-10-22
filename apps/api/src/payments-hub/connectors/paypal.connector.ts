import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PaymentConnector } from './payment-connector.interface';
import { ChargeInput, ConnectResult, ConnectorCapabilities, IntentResult, ProviderId, ReaderInfo, RefundResult, WebhookResult } from './connector.types';
import { httpJson } from './http.util';
import { decimalAmount, pairOf, type PairSecret } from './pair-secret';

// Read at call time (not at load), so a test can stand in for the network.
const doFetch: any = (...a: unknown[]) => (globalThis as any).fetch(...a);

/**
 * PAYPAL — online only (booking deposits / pay-online), the salon's OWN
 * PayPal business account.
 *
 * The customer is sent to PayPal's page (PayPal balance, or a debit/credit
 * card as a guest), approves, and comes back. Nothing is charged until OUR
 * server captures the order — which it does only when the booking page asks
 * us to confirm, after reading the order from PayPal itself. The browser's
 * word is never the proof.
 *
 * Credentials: REST app Client ID + Secret (developer.paypal.com → Apps &
 * Credentials), sandbox or live. No card terminal.
 */
@Injectable()
export class PaypalConnector implements PaymentConnector {
  readonly id: ProviderId = 'paypal';

  capabilities(): ConnectorCapabilities {
    return { terminal: false, online: true, tapToPay: false, interac: false, partialRefund: true, currencies: ['USD', 'CAD'] };
  }

  private base(p: PairSecret) {
    return p.env === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
  }

  private async token(p: PairSecret): Promise<string> {
    if (!p.id || !p.secret) throw new Error('PayPal needs both the Client ID and the Secret');
    const res = await doFetch(`${this.base(p)}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${p.id}:${p.secret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
    });
    const j: any = await res.json().catch(() => null);
    if (!res.ok || !j?.access_token) throw new Error(j?.error_description || j?.error || `PayPal sign-in failed (${res.status})`);
    return String(j.access_token);
  }

  private async headers(p: PairSecret, extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${await this.token(p)}`, ...extra };
  }

  private err(r: { status: number; json: any }): string {
    const d = r.json?.details?.[0];
    return d?.description || d?.issue || r.json?.message || r.json?.name || `PayPal error ${r.status}`;
  }

  async verifyCredential(secret: string, opts?: Record<string, string | undefined>): Promise<ConnectResult> {
    try {
      await this.token(pairOf(secret, opts));
      const currency = (opts?.currency || 'USD').toUpperCase();
      const caps = this.capabilities();
      caps.currencies = [currency];
      return { ok: true, currency, capabilities: caps };
    } catch (e: any) {
      return { ok: false, capabilities: this.capabilities(), error: String(e?.message ?? e) };
    }
  }

  async listReaders(): Promise<ReaderInfo[]> { return []; }
  async registerReader(): Promise<ReaderInfo> { throw new Error('PayPal has no card terminal — it takes online payments only'); }
  async createConnectionToken(): Promise<string | null> { return null; }
  async charge(_secret: string, _input: ChargeInput): Promise<IntentResult> {
    return { status: 'FAILED', error: 'PayPal has no card terminal — use it for online deposits' };
  }
  async getIntent(): Promise<IntentResult> { return { status: 'FAILED', error: 'Not a terminal provider' }; }
  async cancelIntent(): Promise<IntentResult> { return { status: 'CANCELED' }; }
  async refund(secret: string, captureId: string, amountCents?: number): Promise<RefundResult> {
    return this.refundOnline(secret, { transactionId: captureId, reference: captureId, amountCents: amountCents ?? 0, currency: 'USD' });
  }
  verifyWebhook(): WebhookResult {
    throw new Error('PayPal payments are confirmed by reading the order, not by webhook');
  }

  async startOnlineCheckout(secret: string, amountCents: number, currency: string, reference: string, opts?: { returnUrl?: string; cancelUrl?: string; description?: string; brandName?: string }) {
    const p = pairOf(secret);
    const r = await httpJson('POST', `${this.base(p)}/v2/checkout/orders`, await this.headers(p, { 'PayPal-Request-Id': randomUUID() }), {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: reference.slice(0, 256),
        custom_id: reference.slice(0, 127),
        description: (opts?.description || 'Booking deposit').slice(0, 127),
        amount: { currency_code: currency.toUpperCase(), value: decimalAmount(amountCents) },
      }],
      payment_source: {
        paypal: {
          experience_context: {
            user_action: 'PAY_NOW',
            shipping_preference: 'NO_SHIPPING',
            ...(opts?.brandName ? { brand_name: opts.brandName.slice(0, 127) } : {}),
            ...(opts?.returnUrl ? { return_url: opts.returnUrl, cancel_url: opts.cancelUrl || opts.returnUrl } : {}),
          },
        },
      },
    });
    if (!r.ok) throw new Error(this.err(r));
    const links: any[] = Array.isArray(r.json?.links) ? r.json.links : [];
    const url = (links.find((l) => l?.rel === 'payer-action') ?? links.find((l) => l?.rel === 'approve'))?.href;
    if (!url) throw new Error('PayPal did not return a checkout link');
    return { url: String(url), externalRef: String(r.json.id) };
  }

  /**
   * Read the order from PayPal. APPROVED (the customer said yes) is captured
   * here — idempotently, the request id is the order's — and only a COMPLETED
   * capture counts as paid.
   */
  async lookupOnlinePaymentByOrder(secret: string, orderId: string): Promise<{ approved: boolean; amountCents?: number; transactionId?: string }> {
    const p = pairOf(secret);
    let r = await httpJson('GET', `${this.base(p)}/v2/checkout/orders/${encodeURIComponent(orderId)}`, await this.headers(p));
    if (!r.ok) return { approved: false };
    if (r.json?.status === 'APPROVED') {
      const c = await httpJson('POST', `${this.base(p)}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, await this.headers(p, { 'PayPal-Request-Id': `cap-${orderId}` }), {});
      if (c.ok) r = c;
      else return { approved: false };
    }
    const cap = r.json?.purchase_units?.[0]?.payments?.captures?.[0];
    if (r.json?.status !== 'COMPLETED' || !cap || cap.status !== 'COMPLETED') return { approved: false };
    const value = Number.parseFloat(String(cap.amount?.value ?? ''));
    return { approved: true, amountCents: Number.isFinite(value) ? Math.round(value * 100) : undefined, transactionId: String(cap.id) };
  }

  async refundOnline(secret: string, input: { transactionId?: string | null; reference: string; amountCents: number; currency: string }): Promise<RefundResult> {
    if (!input.transactionId) return { status: 'FAILED', error: 'No PayPal capture to refund' };
    const p = pairOf(secret);
    const r = await httpJson('POST', `${this.base(p)}/v2/payments/captures/${encodeURIComponent(input.transactionId)}/refund`, await this.headers(p, { 'PayPal-Request-Id': randomUUID() }),
      input.amountCents > 0 ? { amount: { value: decimalAmount(input.amountCents), currency_code: input.currency.toUpperCase() } } : {});
    if (!r.ok) return { status: 'FAILED', error: this.err(r) };
    const st = String(r.json?.status ?? '');
    return { externalId: r.json?.id, status: st === 'COMPLETED' ? 'SUCCEEDED' : st === 'FAILED' || st === 'CANCELLED' ? 'FAILED' : 'PENDING', raw: { status: st } };
  }
}
