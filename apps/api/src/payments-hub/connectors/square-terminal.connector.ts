import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
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
import { httpJson } from './http.util';

const BASE = 'https://connect.squareup.com';
const SQUARE_VERSION = '2025-01-23';

/**
 * Square Terminal connector — BYO model. The salon creates an application in
 * THEIR OWN Square Developer account and pastes a Production Access Token (PAT)
 * plus a Location ID. No OAuth (that would need a Lumio app). Server-driven:
 * we push a Terminal Checkout to the salon's paired Square Terminal. Status is
 * resolved by polling (getIntent); no webhook secret required in Phase 2.
 */
@Injectable()
export class SquareTerminalConnector implements PaymentConnector {
  readonly id: ProviderId = 'square';

  private headers(secret: string) {
    return { Authorization: `Bearer ${secret}`, 'Square-Version': SQUARE_VERSION };
  }
  private err(r: any): string {
    return r?.json?.errors?.[0]?.detail ?? r?.json?.message ?? `Square error (HTTP ${r?.status})`;
  }

  capabilities(): ConnectorCapabilities {
    return { terminal: true, online: true, tapToPay: false, interac: true, partialRefund: true, currencies: ['USD', 'CAD'] };
  }

  async verifyCredential(secret: string, opts?: Record<string, string | undefined>): Promise<ConnectResult> {
    const r = await httpJson('GET', `${BASE}/v2/locations`, this.headers(secret));
    if (!r.ok) return { ok: false, capabilities: this.capabilities(), error: this.err(r) };
    const locs = r.json?.locations ?? [];
    const want = opts?.locationId;
    const loc = (want && locs.find((l: any) => l.id === want)) || locs[0];
    const currency = (opts?.currency || loc?.currency || 'USD').toUpperCase();
    const caps = this.capabilities();
    caps.interac = currency === 'CAD';
    caps.currencies = [currency];
    return { ok: true, accountId: loc?.id, currency, capabilities: caps };
  }

  // Square pairs a physical Terminal via a device code the salon types on the
  // device. We create one and return the human code in the label; once paired,
  // listReaders() resolves the usable device_id.
  async registerReader(secret: string, _code: string, label?: string, locationId?: string): Promise<ReaderInfo> {
    const r = await httpJson('POST', `${BASE}/v2/devices/codes`, this.headers(secret), {
      idempotency_key: randomUUID(),
      device_code: { product_type: 'TERMINAL_API', location_id: locationId, name: label ?? 'Lumio Terminal' },
    });
    if (!r.ok) throw new Error(this.err(r));
    const dc = r.json?.device_code ?? {};
    // The device_id does NOT exist yet — it appears only after the salon signs
    // in on the Terminal with this code (within 5 minutes / pair_by). We save
    // the row under the code id; listReaders() migrates it to the real
    // device_id via replacesExternalId once PAIRED.
    return { externalId: dc.device_id || dc.id, label: `Pair code: ${dc.code} (nhập trên máy trong 5 phút)`, status: dc.device_id ? 'ONLINE' : 'UNKNOWN', locationId };
  }

  async listReaders(secret: string): Promise<ReaderInfo[]> {
    const r = await httpJson('GET', `${BASE}/v2/devices/codes?product_type=TERMINAL_API`, this.headers(secret));
    if (!r.ok) return [];
    const codes = r.json?.device_codes ?? [];
    return codes
      .filter((dc: any) => dc.status !== 'EXPIRED')
      .map((dc: any) => ({
        // Once paired, expose the REAL device_id and tell the orchestrator to
        // migrate the row that was saved under the code id at register time.
        externalId: dc.device_id || dc.id,
        replacesExternalId: dc.device_id ? dc.id : undefined,
        label: dc.device_id ? (dc.name || 'Square Terminal') : `Pair code: ${dc.code} (chưa ghép)` ,
        status: dc.status === 'PAIRED' ? 'ONLINE' : 'UNKNOWN',
        locationId: dc.location_id,
      }));
  }

  /** Health of ONE terminal = its device code is PAIRED (not just a valid token). */
  async checkReader(secret: string, externalId: string): Promise<{ online: boolean; message?: string }> {
    const r = await httpJson('GET', `${BASE}/v2/devices/codes?product_type=TERMINAL_API`, this.headers(secret));
    if (!r.ok) return { online: false, message: this.err(r) };
    const codes = r.json?.device_codes ?? [];
    const hit = codes.find((dc: any) => dc.device_id === externalId || dc.id === externalId);
    if (!hit) return { online: false, message: 'Terminal not found in this Square account' };
    if (hit.status === 'PAIRED' && hit.device_id) return { online: true };
    return { online: false, message: hit.status === 'EXPIRED' ? 'Pair code expired — create a new reader' : 'Terminal not paired yet — sign in on the device with the pair code' };
  }

  async createConnectionToken(): Promise<string | null> {
    return null; // Not used for the server-driven Terminal Checkout flow.
  }

  /**
   * ONLINE (card-not-present) — Square-hosted Payment Link. Returns a URL the
   * customer opens to pay; card data never touches Lumio. We keep the created
   * order_id (externalRef) so the server can verify the payment later.
   */
  async startOnlineCheckout(secret: string, amountCents: number, currency: string, reference: string, opts?: { locationId?: string }) {
    let locationId = opts?.locationId;
    if (!locationId) {
      const lr = await httpJson('GET', `${BASE}/v2/locations`, this.headers(secret));
      locationId = lr.json?.locations?.[0]?.id;
    }
    if (!locationId) throw new Error('Square: no location available for online checkout');
    const r = await httpJson('POST', `${BASE}/v2/online-checkout/payment-links`, this.headers(secret), {
      idempotency_key: randomUUID(),
      description: `Lumio booking ${reference}`,
      payment_note: `Booking ${reference}`,
      quick_pay: {
        name: 'Booking deposit',
        price_money: { amount: amountCents, currency: currency.toUpperCase() },
        location_id: locationId,
      },
    });
    if (!r.ok) throw new Error(this.err(r));
    const pl = r.json?.payment_link ?? {};
    return { url: pl.url || pl.long_url, externalRef: pl.order_id as string };
  }

  /**
   * Server-side verification by the order we created for the payment link:
   * order -> tender -> payment must be COMPLETED. The browser is never trusted.
   */
  async lookupOnlinePaymentByOrder(secret: string, orderId: string): Promise<{ approved: boolean; amountCents?: number; transactionId?: string }> {
    const or = await httpJson('GET', `${BASE}/v2/orders/${orderId}`, this.headers(secret));
    if (!or.ok) return { approved: false };
    const tender = (or.json?.order?.tenders ?? [])[0];
    const paymentId = tender?.payment_id || tender?.id;
    if (!paymentId) return { approved: false };
    const pr = await httpJson('GET', `${BASE}/v2/payments/${paymentId}`, this.headers(secret));
    if (!pr.ok) return { approved: false };
    const p = pr.json?.payment ?? {};
    return {
      approved: p.status === 'COMPLETED' || p.status === 'APPROVED',
      amountCents: p.amount_money?.amount,
      transactionId: p.id,
    };
  }

  async charge(secret: string, input: ChargeInput): Promise<IntentResult> {
    if (!input.readerExternalId) return { status: 'FAILED', error: 'Square requires a paired device_id' };
    const r = await httpJson('POST', `${BASE}/v2/terminals/checkouts`, this.headers(secret), {
      idempotency_key: input.reference,
      checkout: {
        amount_money: { amount: input.amountCents, currency: input.currency.toUpperCase() },
        device_options: { device_id: input.readerExternalId },
        reference_id: input.reference,
        note: input.description,
      },
    });
    if (!r.ok) return { status: 'FAILED', error: this.err(r) };
    const co = r.json?.checkout ?? {};
    return { externalId: co.id, status: this.mapStatus(co.status), raw: { status: co.status } };
  }

  async getIntent(secret: string, externalId: string): Promise<IntentResult> {
    const r = await httpJson('GET', `${BASE}/v2/terminals/checkouts/${externalId}`, this.headers(secret));
    if (!r.ok) return { externalId, status: 'PROCESSING', error: this.err(r) };
    const co = r.json?.checkout ?? {};
    return { externalId, status: this.mapStatus(co.status), raw: { status: co.status } };
  }

  async cancelIntent(secret: string, externalId: string): Promise<IntentResult> {
    const r = await httpJson('POST', `${BASE}/v2/terminals/checkouts/${externalId}/cancel`, this.headers(secret), {});
    const co = r.json?.checkout ?? {};
    return { externalId, status: r.ok ? 'CANCELED' : this.mapStatus(co.status) };
  }

  async refund(secret: string, intentExternalId: string, amountCents?: number): Promise<RefundResult> {
    // Resolve the payment id from the completed checkout, then refund it.
    const co = await httpJson('GET', `${BASE}/v2/terminals/checkouts/${intentExternalId}`, this.headers(secret));
    const paymentId = co.json?.checkout?.payment_ids?.[0];
    const currency = (co.json?.checkout?.amount_money?.currency ?? 'USD').toUpperCase();
    const amount = amountCents ?? co.json?.checkout?.amount_money?.amount;
    if (!paymentId) return { status: 'FAILED', error: 'No captured payment to refund yet' };
    const r = await httpJson('POST', `${BASE}/v2/refunds`, this.headers(secret), {
      idempotency_key: randomUUID(),
      payment_id: paymentId,
      amount_money: { amount, currency },
    });
    if (!r.ok) return { status: 'FAILED', error: this.err(r) };
    const st = r.json?.refund?.status;
    return { externalId: r.json?.refund?.id, status: st === 'COMPLETED' ? 'SUCCEEDED' : st === 'PENDING' ? 'PENDING' : 'PENDING', raw: { status: st } };
  }

  verifyWebhook(): WebhookResult {
    // Phase 2 resolves status via polling; no per-tenant webhook secret needed.
    throw new Error('Square webhook verification is not enabled in Phase 2 (status via polling)');
  }

  private mapStatus(s?: string): IntentStatus {
    switch (s) {
      case 'COMPLETED': return 'SUCCEEDED';
      case 'PENDING':
      case 'IN_PROGRESS': return 'PROCESSING';
      case 'CANCELED':
      case 'CANCEL_REQUESTED': return 'CANCELED';
      default: return s ? 'PROCESSING' : 'REQUIRES_PAYMENT';
    }
  }
}
