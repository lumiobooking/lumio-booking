import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PaymentConnector } from './payment-connector.interface';
import {
  ChargeInput,
  ConnectResult,
  ConnectorCapabilities,
  IntentResult,
  IntentStatus,
  ProviderId,
  ReaderInfo,
  RefundResult,
  WebhookResult,
} from './connector.types';

const API_VERSION = '2024-06-20';

/**
 * Stripe Terminal connector — BYO model. The tenant creates a RESTRICTED key
 * (rk_live_...) in their OWN Stripe account and pastes it into Lumio; we pass it
 * in per call. No Stripe Connect, no Lumio-side registration. Server-driven:
 * we create a card_present PaymentIntent and push it to the tenant's reader.
 * Card data is captured on the P2PE reader, never on our servers (PCI SAQ A).
 */
@Injectable()
export class StripeTerminalConnector implements PaymentConnector {
  readonly id: ProviderId = 'stripe';
  private readonly logger = new Logger('StripeTerminalConnector');

  private client(secret: string): Stripe {
    return new Stripe(secret, { apiVersion: API_VERSION as any });
  }

  capabilities(): ConnectorCapabilities {
    return { terminal: true, online: true, tapToPay: true, interac: true, partialRefund: true, currencies: ['USD', 'CAD'] };
  }

  async verifyCredential(secret: string, opts?: Record<string, string | undefined>): Promise<ConnectResult> {
    try {
      // Creating a connection token validates the key AND that it has Terminal
      // permission — the exact capability we need — and moves no money.
      // A key with Terminal permission does both; one without (an online-only
      // salon) is still a valid key for deposits — checked against the balance.
      let terminal = true;
      try { await this.client(secret).terminal.connectionTokens.create(); }
      catch { terminal = false; await this.client(secret).balance.retrieve(); }
      const currency = (opts?.currency || 'USD').toUpperCase();
      const caps = this.capabilities();
      caps.terminal = terminal;
      caps.tapToPay = terminal;
      caps.currencies = currency === 'CAD' ? ['CAD'] : ['USD'];
      caps.interac = currency === 'CAD';
      return { ok: true, currency, capabilities: caps };
    } catch (e: any) {
      return { ok: false, capabilities: this.capabilities(), error: this.msg(e) };
    }
  }

  async listReaders(secret: string): Promise<ReaderInfo[]> {
    const res = await this.client(secret).terminal.readers.list({ limit: 100 });
    return res.data.map((r: Stripe.Terminal.Reader) => this.reader(r));
  }

  async registerReader(secret: string, code: string, label?: string, locationId?: string): Promise<ReaderInfo> {
    const r = await this.client(secret).terminal.readers.create({ registration_code: code, label, location: locationId });
    return this.reader(r);
  }

  async createConnectionToken(secret: string): Promise<string | null> {
    const tok = await this.client(secret).terminal.connectionTokens.create();
    return tok.secret ?? null;
  }

  async charge(secret: string, input: ChargeInput): Promise<IntentResult> {
    const stripe = this.client(secret);
    try {
      const pi = await stripe.paymentIntents.create(
        {
          amount: input.amountCents,
          currency: input.currency.toLowerCase(),
          payment_method_types: ['card_present'],
          capture_method: 'automatic',
          description: input.description,
        },
        { idempotencyKey: input.reference },
      );
      if (input.readerExternalId) {
        const reader = await stripe.terminal.readers.processPaymentIntent(input.readerExternalId, { payment_intent: pi.id });
        return { externalId: pi.id, status: this.mapStatus(pi.status, reader), raw: { pi: pi.id, reader: reader.id } };
      }
      return { externalId: pi.id, status: this.mapStatus(pi.status), clientSecret: pi.client_secret ?? undefined };
    } catch (e: any) {
      return { status: 'FAILED', error: this.msg(e) };
    }
  }

  async getIntent(secret: string, externalId: string): Promise<IntentResult> {
    const pi = await this.client(secret).paymentIntents.retrieve(externalId);
    return { externalId: pi.id, status: this.mapStatus(pi.status) };
  }

  async cancelIntent(secret: string, externalId: string): Promise<IntentResult> {
    const pi = await this.client(secret).paymentIntents.cancel(externalId);
    return { externalId: pi.id, status: this.mapStatus(pi.status) };
  }

  async refund(secret: string, intentExternalId: string, amountCents?: number): Promise<RefundResult> {
    try {
      const re = await this.client(secret).refunds.create({ payment_intent: intentExternalId, amount: amountCents });
      return {
        externalId: re.id,
        status: re.status === 'succeeded' ? 'SUCCEEDED' : re.status === 'pending' ? 'PENDING' : 'FAILED',
        raw: { id: re.id },
      };
    } catch (e: any) {
      return { status: 'FAILED', error: this.msg(e) };
    }
  }

  verifyWebhook(rawBody: Buffer, signature: string, webhookSecret: string): WebhookResult {
    // constructEvent verifies the HMAC locally; the API key is irrelevant here.
    const stripe = new Stripe('sk_webhook_verify_only', { apiVersion: API_VERSION as any });
    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    let intentExternalId: string | undefined;
    let status: IntentStatus | undefined;
    let paymentId: string | undefined;
    if (event.type.startsWith('payment_intent.')) {
      const pi = event.data.object as Stripe.PaymentIntent;
      intentExternalId = pi.id;
      status = this.mapStatus(pi.status);
    } else if (event.type.startsWith('checkout.session.')) {
      // An online deposit (Stripe Checkout): the session id is what the booking's
      // intent row holds. "Paid" settles it even if the customer closed the page
      // before coming back (payment-orchestrator → onOnlinePaid).
      const cs = event.data.object as Stripe.Checkout.Session;
      intentExternalId = cs.id;
      paymentId = typeof cs.payment_intent === 'string' ? cs.payment_intent : cs.payment_intent?.id ?? undefined;
      status = event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed' ? 'CANCELED'
        : cs.payment_status === 'paid' ? 'SUCCEEDED' : 'PROCESSING';
    }
    return { id: event.id, type: event.type, intentExternalId, status, raw: { type: event.type, ...(paymentId ? { paymentId } : {}) } };
  }

  // ---- ONLINE: Stripe Checkout (booking deposits / pay online) ----

  /** A Stripe-hosted payment page for a server-computed amount; card data never touches Lumio. */
  async startOnlineCheckout(secret: string, amountCents: number, currency: string, reference: string, opts?: { returnUrl?: string; cancelUrl?: string; description?: string }) {
    if (!opts?.returnUrl) throw new Error('Stripe Checkout needs a return address');
    const session = await this.client(secret).checkout.sessions.create({
      mode: 'payment',
      client_reference_id: reference.slice(0, 200),
      metadata: { lumio_ref: reference },
      line_items: [{
        quantity: 1,
        price_data: { currency: currency.toLowerCase(), unit_amount: Math.round(amountCents), product_data: { name: (opts.description || 'Booking deposit').slice(0, 200) } },
      }],
      payment_intent_data: { metadata: { lumio_ref: reference }, description: (opts.description || 'Booking deposit').slice(0, 200) },
      success_url: opts.returnUrl,
      cancel_url: opts.cancelUrl || opts.returnUrl,
    });
    if (!session.url) throw new Error('Stripe did not return a checkout page');
    return { url: session.url, externalRef: session.id };
  }

  /** Read the Checkout Session back from Stripe: paid means paid. */
  async lookupOnlinePaymentByOrder(secret: string, sessionId: string): Promise<{ approved: boolean; amountCents?: number; transactionId?: string }> {
    try {
      const s = await this.client(secret).checkout.sessions.retrieve(sessionId);
      const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
      return { approved: s.payment_status === 'paid', amountCents: s.amount_total ?? undefined, transactionId: pi ?? undefined };
    } catch {
      return { approved: false };
    }
  }

  async refundOnline(secret: string, input: { transactionId?: string | null; reference: string; amountCents: number; currency: string }): Promise<RefundResult> {
    if (!input.transactionId) return { status: 'FAILED', error: 'No Stripe payment to refund' };
    try {
      const r = await this.client(secret).refunds.create({ payment_intent: input.transactionId, ...(input.amountCents > 0 ? { amount: Math.round(input.amountCents) } : {}) });
      return { externalId: r.id, status: r.status === 'succeeded' ? 'SUCCEEDED' : r.status === 'failed' || r.status === 'canceled' ? 'FAILED' : 'PENDING', raw: { status: r.status } };
    } catch (e: any) {
      return { status: 'FAILED', error: this.msg(e) };
    }
  }

  private reader(r: Stripe.Terminal.Reader): ReaderInfo {
    return {
      externalId: r.id,
      label: r.label ?? undefined,
      status: r.status === 'online' ? 'ONLINE' : r.status === 'offline' ? 'OFFLINE' : 'UNKNOWN',
      locationId: typeof r.location === 'string' ? r.location : undefined,
    };
  }

  private mapStatus(piStatus?: string | null, reader?: unknown): IntentStatus {
    switch (piStatus) {
      case 'succeeded':
        return 'SUCCEEDED';
      case 'processing':
      case 'requires_capture':
      case 'requires_action':
      case 'requires_confirmation':
        return 'PROCESSING';
      case 'requires_payment_method':
        return reader ? 'PROCESSING' : 'REQUIRES_PAYMENT';
      case 'canceled':
        return 'CANCELED';
      default:
        return piStatus ? 'PROCESSING' : 'REQUIRES_PAYMENT';
    }
  }

  private msg(e: any): string {
    if (e?.type && e?.message) return `${e.type}: ${e.message}`;
    return e?.message ?? 'Stripe error';
  }
}
