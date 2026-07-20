import { Injectable } from '@nestjs/common';
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

const BASE = 'https://api.sumup.com';

/**
 * SumUp connector — BYO model. The salon creates an API key in THEIR OWN SumUp
 * Dashboard and pastes it. Card-present via the Cloud API + Solo reader (paired
 * to the salon's account). Status resolved by polling. merchant_code is fetched
 * from /me and cached briefly (connectors are otherwise stateless).
 */
@Injectable()
export class SumUpConnector implements PaymentConnector {
  readonly id: ProviderId = 'sumup';
  private meCache = new Map<string, { code: string; currency: string; at: number }>();

  private headers(secret: string) {
    return { Authorization: `Bearer ${secret}` };
  }
  private err(r: any): string {
    return r?.json?.message ?? r?.json?.error_message ?? r?.json?.error_code ?? `SumUp error (HTTP ${r?.status})`;
  }
  private async me(secret: string): Promise<{ code: string; currency: string }> {
    const cached = this.meCache.get(secret);
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached;
    const r = await httpJson('GET', `${BASE}/v0.1/me`, this.headers(secret));
    if (!r.ok) throw new Error(this.err(r));
    const mp = r.json?.merchant_profile ?? {};
    const val = { code: mp.merchant_code, currency: (mp.default_currency ?? 'USD').toUpperCase(), at: Date.now() };
    this.meCache.set(secret, val);
    return val;
  }

  capabilities(): ConnectorCapabilities {
    return { terminal: true, online: false, tapToPay: false, interac: false, partialRefund: true, currencies: ['USD', 'EUR', 'GBP'] };
  }

  async verifyCredential(secret: string): Promise<ConnectResult> {
    const r = await httpJson('GET', `${BASE}/v0.1/me`, this.headers(secret));
    if (!r.ok) return { ok: false, capabilities: this.capabilities(), error: this.err(r) };
    const mp = r.json?.merchant_profile ?? {};
    const currency = (mp.default_currency ?? 'USD').toUpperCase();
    const caps = this.capabilities();
    caps.currencies = [currency];
    return { ok: true, accountId: mp.merchant_code, currency, capabilities: caps };
  }

  async registerReader(secret: string, code: string, label?: string): Promise<ReaderInfo> {
    const { code: merchant } = await this.me(secret);
    const r = await httpJson('POST', `${BASE}/v0.1/merchants/${merchant}/readers`, this.headers(secret), { pairing_code: code, name: label ?? 'Lumio Reader' });
    if (!r.ok) throw new Error(this.err(r));
    const rd = r.json ?? {};
    return { externalId: rd.id, label: rd.name ?? label, status: rd.status === 'paired' ? 'ONLINE' : 'UNKNOWN' };
  }

  async listReaders(secret: string): Promise<ReaderInfo[]> {
    const { code: merchant } = await this.me(secret);
    const r = await httpJson('GET', `${BASE}/v0.1/merchants/${merchant}/readers`, this.headers(secret));
    if (!r.ok) return [];
    const items = r.json?.items ?? r.json ?? [];
    return (Array.isArray(items) ? items : []).map((rd: any) => ({
      externalId: rd.id,
      label: rd.name,
      status: rd.status === 'paired' ? 'ONLINE' : rd.status === 'expired' ? 'OFFLINE' : 'UNKNOWN',
    }));
  }

  async createConnectionToken(): Promise<string | null> {
    return null;
  }

  async charge(secret: string, input: ChargeInput): Promise<IntentResult> {
    if (!input.readerExternalId) return { status: 'FAILED', error: 'SumUp requires a paired reader id' };
    const { code: merchant } = await this.me(secret);
    const r = await httpJson('POST', `${BASE}/v0.1/merchants/${merchant}/readers/${input.readerExternalId}/checkout`, this.headers(secret), {
      total_amount: { value: input.amountCents, currency: input.currency.toUpperCase(), minor_unit: 2 },
      description: input.description,
    });
    if (!r.ok) return { status: 'FAILED', error: this.err(r) };
    const clientTxn = r.json?.data?.client_transaction_id ?? r.json?.client_transaction_id;
    // Async: the reader now prompts the customer. Status resolved via polling.
    return { externalId: clientTxn, status: clientTxn ? 'PROCESSING' : 'REQUIRES_PAYMENT', raw: { clientTxn } };
  }

  async getIntent(secret: string, externalId: string): Promise<IntentResult> {
    const r = await httpJson('GET', `${BASE}/v0.1/me/transactions?client_transaction_id=${encodeURIComponent(externalId)}`, this.headers(secret));
    if (!r.ok) return { externalId, status: 'PROCESSING', error: this.err(r) };
    const txn = Array.isArray(r.json?.items) ? r.json.items[0] : r.json;
    return { externalId, status: this.mapStatus(txn?.status), raw: { status: txn?.status, id: txn?.id ?? txn?.transaction_id } };
  }

  async cancelIntent(secret: string, externalId: string): Promise<IntentResult> {
    // Best-effort: SumUp cancels via reader terminate; without the reader id here
    // we simply report canceled. The reader auto-times-out if untouched.
    return { externalId, status: 'CANCELED' };
  }

  async refund(secret: string, intentExternalId: string, amountCents?: number): Promise<RefundResult> {
    // Resolve the SumUp transaction id from the client_transaction_id, then refund.
    const look = await httpJson('GET', `${BASE}/v0.1/me/transactions?client_transaction_id=${encodeURIComponent(intentExternalId)}`, this.headers(secret));
    const txn = Array.isArray(look.json?.items) ? look.json.items[0] : look.json;
    const txnId = txn?.id ?? txn?.transaction_id;
    if (!txnId) return { status: 'FAILED', error: 'Transaction not found to refund' };
    const body = amountCents !== undefined ? { amount: amountCents / 100 } : undefined;
    const r = await httpJson('POST', `${BASE}/v0.1/me/refund/${txnId}`, this.headers(secret), body);
    if (!r.ok) return { status: 'FAILED', error: this.err(r) };
    return { status: 'SUCCEEDED', externalId: String(txnId), raw: { refunded: true } };
  }

  verifyWebhook(): WebhookResult {
    throw new Error('SumUp webhook verification is not enabled in Phase 2 (status via polling)');
  }

  private mapStatus(s?: string): IntentStatus {
    switch ((s ?? '').toUpperCase()) {
      case 'SUCCESSFUL': return 'SUCCEEDED';
      case 'PENDING':
      case 'PROCESSING': return 'PROCESSING';
      case 'CANCELLED':
      case 'CANCELED': return 'CANCELED';
      case 'FAILED': return 'FAILED';
      default: return s ? 'PROCESSING' : 'REQUIRES_PAYMENT';
    }
  }
}
