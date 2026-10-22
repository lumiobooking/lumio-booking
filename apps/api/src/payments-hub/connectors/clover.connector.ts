import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PaymentConnector } from './payment-connector.interface';
import { ChargeInput, ConnectResult, ConnectorCapabilities, IntentResult, ProviderId, ReaderInfo, RefundResult, WebhookResult } from './connector.types';
import { httpJson } from './http.util';
import { pairOf, type PairSecret } from './pair-secret';

/**
 * CLOVER — Hosted Checkout for online deposits, on the salon's own Clover
 * merchant account.
 *
 * The customer pays on Clover's page. Clover does not let us read a checkout
 * session back, so the proof is Clover's own signed webhook (APPROVED, with
 * the checkout session id) — the orchestrator marks the session paid when it
 * arrives and the booking page's confirm reads that. A webhook signing
 * secret is therefore REQUIRED for deposits with Clover.
 *
 * Credentials: Merchant ID + an Ecommerce private token (Clover Dashboard →
 * Account & Setup → Ecommerce API Tokens), and the Hosted Checkout webhook
 * signing secret. Clover's in-store devices are not driven from Lumio yet:
 * the desk rings card sales on the Clover device as usual.
 */
@Injectable()
export class CloverConnector implements PaymentConnector {
  readonly id: ProviderId = 'clover';

  capabilities(): ConnectorCapabilities {
    return { terminal: false, online: true, tapToPay: false, interac: false, partialRefund: true, currencies: ['USD', 'CAD'] };
  }

  private api(p: PairSecret) { return p.env === 'sandbox' ? 'https://apisandbox.dev.clover.com' : 'https://api.clover.com'; }
  private ecom(p: PairSecret) { return p.env === 'sandbox' ? 'https://scl-sandbox.dev.clover.com' : 'https://scl.clover.com'; }
  private headers(p: PairSecret) {
    return { Authorization: `Bearer ${p.secret}`, 'X-Clover-Merchant-Id': p.id, 'User-Agent': 'LumioBooking/1.0' };
  }
  private err(r: { status: number; json: any }): string {
    return r.json?.message || r.json?.error?.message || r.json?.raw || `Clover error ${r.status}`;
  }

  async verifyCredential(secret: string, opts?: Record<string, string | undefined>): Promise<ConnectResult> {
    const p = pairOf(secret, opts);
    if (!p.id || !p.secret) return { ok: false, capabilities: this.capabilities(), error: 'Clover needs the Merchant ID and the private token' };
    // The ecommerce key service answers only to a valid private token.
    const r = await httpJson('GET', `${this.ecom(p)}/pakms/apikey`, this.headers(p)).catch(() => null);
    if (!r?.ok) return { ok: false, capabilities: this.capabilities(), error: r ? this.err(r) : 'Could not reach Clover' };
    const currency = (opts?.currency || 'USD').toUpperCase();
    const caps = this.capabilities();
    caps.currencies = [currency];
    return { ok: true, accountId: p.id, currency, capabilities: caps };
  }

  async listReaders(): Promise<ReaderInfo[]> { return []; }
  async registerReader(): Promise<ReaderInfo> { throw new Error('Clover devices are not driven from Lumio yet — ring the card sale on the Clover device'); }
  async createConnectionToken(): Promise<string | null> { return null; }
  async charge(_secret: string, _input: ChargeInput): Promise<IntentResult> {
    return { status: 'FAILED', error: 'Clover devices are not driven from Lumio yet' };
  }
  async getIntent(): Promise<IntentResult> { return { status: 'FAILED', error: 'Not a terminal provider' }; }
  async cancelIntent(): Promise<IntentResult> { return { status: 'CANCELED' }; }
  async refund(secret: string, chargeId: string, amountCents?: number): Promise<RefundResult> {
    return this.refundOnline(secret, { transactionId: chargeId, reference: chargeId, amountCents: amountCents ?? 0, currency: 'USD' });
  }

  async startOnlineCheckout(secret: string, amountCents: number, _currency: string, reference: string, opts?: { returnUrl?: string; description?: string; customerName?: string }) {
    const p = pairOf(secret);
    const name = (opts?.customerName || 'Guest').trim().slice(0, 60) || 'Guest';
    const r = await httpJson('POST', `${this.api(p)}/invoicingcheckoutservice/v1/checkouts`, this.headers(p), {
      customer: { firstName: name },
      shoppingCart: {
        lineItems: [{ name: (opts?.description || 'Booking deposit').slice(0, 120), price: Math.round(amountCents), unitQty: 1, note: `Booking ${reference}`.slice(0, 250) }],
      },
      ...(opts?.returnUrl ? { redirectUrls: { success: opts.returnUrl, failure: opts.returnUrl } } : {}),
    });
    if (!r.ok || !r.json?.href) throw new Error(this.err(r));
    return { url: String(r.json.href), externalRef: String(r.json.checkoutSessionId) };
  }

  /** Clover cannot be asked; the signed webhook is the proof (see the class note). */
  async lookupOnlinePaymentByOrder(): Promise<{ approved: boolean; amountCents?: number; transactionId?: string }> {
    return { approved: false };
  }

  async refundOnline(secret: string, input: { transactionId?: string | null; reference: string; amountCents: number; currency: string }): Promise<RefundResult> {
    if (!input.transactionId) return { status: 'FAILED', error: 'No Clover payment to refund' };
    const p = pairOf(secret);
    const r = await httpJson('POST', `${this.ecom(p)}/v1/refunds`, this.headers(p), {
      charge: input.transactionId,
      ...(input.amountCents > 0 ? { amount: Math.round(input.amountCents) } : {}),
    });
    if (!r.ok) return { status: 'FAILED', error: this.err(r) };
    const st = String(r.json?.status ?? '');
    return { externalId: r.json?.id, status: st === 'succeeded' ? 'SUCCEEDED' : st === 'failed' ? 'FAILED' : 'PENDING', raw: { status: st } };
  }

  /**
   * Clover-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">. Body:
   * { type: 'PAYMENT', id: <payment uuid>, status: APPROVED|DECLINED,
   *   merchantId, data: <checkout session id>, ... } (keys in either case).
   */
  verifyWebhook(rawBody: Buffer, signature: string, webhookSecret: string): WebhookResult {
    const parts = Object.fromEntries(String(signature || '').split(',').map((kv) => kv.trim().split('=') as [string, string]));
    const t = parts.t;
    const v1 = parts.v1;
    if (!t || !v1) throw new Error('missing Clover-Signature');
    const want = createHmac('sha256', webhookSecret).update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
    const a = Buffer.from(want, 'utf8');
    const b = Buffer.from(String(v1), 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('bad Clover signature');
    const body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    const get = (k: string) => body[k] ?? body[k.charAt(0).toUpperCase() + k.slice(1)];
    const paymentId = String(get('id') ?? '');
    const status = String(get('status') ?? '').toUpperCase();
    const session = String(get('data') ?? '');
    return {
      id: paymentId || `${session}:${t}`,
      type: String(get('type') ?? 'PAYMENT'),
      intentExternalId: session || undefined,
      status: status === 'APPROVED' ? 'SUCCEEDED' : status === 'DECLINED' ? 'FAILED' : undefined,
      raw: { paymentId, status },
    };
  }
}
