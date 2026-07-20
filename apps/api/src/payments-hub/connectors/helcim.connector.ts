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

const BASE = 'https://api.helcim.com/v2';

/**
 * Helcim connector — BYO model. The salon creates an API Access Configuration
 * token in THEIR OWN Helcim account and pastes it. One account covers BOTH:
 *   • in-person  → Payments Hardware API (Smart Terminal, Cloud/WiFi, Interac)
 *   • online     → Payment API / HelcimPay.js
 * Lumio registers nothing. Card data stays on the terminal / HelcimPay (PCI SAQ A).
 *
 * Notes from the Helcim docs that shape this implementation:
 *  - Amounts are DOLLARS with 2 decimals (not minor units).
 *  - Terminal purchase returns 202 Accepted (async) — the result is resolved by
 *    polling the card-transactions list via the invoiceNumber we set.
 *  - Refund applies to a CLOSED batch; an open batch needs Reverse — we try
 *    refund first and fall back to reverse.
 */
@Injectable()
export class HelcimConnector implements PaymentConnector {
  readonly id: ProviderId = 'helcim';

  private headers(secret: string, idempotencyKey?: string) {
    const h: Record<string, string> = { 'api-token': secret, accept: 'application/json' };
    if (idempotencyKey) h['idempotency-key'] = idempotencyKey;
    return h;
  }
  private err(r: any): string {
    const e = r?.json?.errors ?? r?.json?.message ?? r?.json?.error;
    if (!e) return `Helcim error (HTTP ${r?.status})`;
    return typeof e === 'string' ? e : JSON.stringify(e);
  }
  /** Helcim requires a unique 25-char alphanumeric idempotency key. */
  private idem(reference: string): string {
    const base = (reference || '').replace(/[^a-zA-Z0-9]/g, '');
    return (base + 'lumio000000000000000000000').slice(0, 25);
  }
  /** Invoice number we can later poll by to find the resulting transaction. */
  private invoiceNo(reference: string): string {
    return 'LUM' + (reference || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 17).toUpperCase();
  }
  private money(amountCents: number): number {
    return Math.round(amountCents) / 100;
  }

  capabilities(): ConnectorCapabilities {
    return { terminal: true, online: true, tapToPay: false, interac: true, partialRefund: true, currencies: ['USD', 'CAD'] };
  }

  async verifyCredential(secret: string, opts?: Record<string, string | undefined>): Promise<ConnectResult> {
    // Devices endpoint first (in-person scope); fall back to transactions (payments scope).
    let ok = false;
    let lastErr = '';
    const dev = await httpJson('GET', `${BASE}/devices`, this.headers(secret));
    if (dev.ok) ok = true;
    else {
      lastErr = this.err(dev);
      const tx = await httpJson('GET', `${BASE}/card-transactions?limit=1`, this.headers(secret));
      if (tx.ok) ok = true;
      else lastErr = this.err(tx);
    }
    if (!ok) return { ok: false, capabilities: this.capabilities(), error: lastErr };
    // Helcim processes in the account's core currency (CAD for CA, USD for US).
    const currency = (opts?.currency || 'USD').toUpperCase();
    const caps = this.capabilities();
    caps.currencies = [currency];
    caps.interac = currency === 'CAD';
    return { ok: true, currency, capabilities: caps };
  }

  async listReaders(secret: string): Promise<ReaderInfo[]> {
    const r = await httpJson('GET', `${BASE}/devices`, this.headers(secret));
    if (!r.ok) return [];
    const items = Array.isArray(r.json) ? r.json : r.json?.devices ?? r.json?.data ?? [];
    return (items as any[]).map((d) => ({
      externalId: String(d.deviceCode ?? d.code ?? d.id),
      label: d.deviceName ?? d.name ?? 'Helcim Smart Terminal',
      status: 'ONLINE' as const,
    }));
  }

  /** For Helcim the "code" is the 4-char device code shown on the Smart Terminal. */
  async registerReader(secret: string, code: string, label?: string): Promise<ReaderInfo> {
    const c = code.trim();
    // Best-effort connectivity check; the device may simply be asleep.
    const ping = await httpJson('POST', `${BASE}/devices/${encodeURIComponent(c)}/ping`, this.headers(secret), {});
    return { externalId: c, label: label ?? 'Helcim Smart Terminal', status: ping.ok ? 'ONLINE' : 'UNKNOWN' };
  }

  async createConnectionToken(): Promise<string | null> {
    return null; // Not applicable — Helcim terminals are driven server-side.
  }

  async charge(secret: string, input: ChargeInput): Promise<IntentResult> {
    if (!input.readerExternalId) {
      return { status: 'FAILED', error: 'Helcim in-person payment needs a Smart Terminal device code (online payments use HelcimPay.js)' };
    }
    const invoiceNumber = this.invoiceNo(input.reference);
    const r = await httpJson(
      'POST',
      `${BASE}/devices/${encodeURIComponent(input.readerExternalId)}/payment/purchase`,
      this.headers(secret, this.idem(input.reference)),
      { currency: input.currency.toUpperCase(), transactionAmount: this.money(input.amountCents), invoiceNumber },
    );
    // 202 Accepted = the terminal was asked to prompt the customer; not yet paid.
    if (!r.ok) return { status: 'FAILED', error: this.err(r) };
    return { externalId: invoiceNumber, status: 'PROCESSING', raw: { accepted: true, invoiceNumber } };
  }

  async getIntent(secret: string, externalId: string): Promise<IntentResult> {
    const txn = await this.findTransaction(secret, externalId);
    if (!txn) return { externalId, status: 'PROCESSING' };
    return { externalId, status: this.mapStatus(txn.status), raw: { transactionId: txn.transactionId, status: txn.status } };
  }

  async cancelIntent(_secret: string, externalId: string): Promise<IntentResult> {
    // The customer cancels on the device itself; nothing to call server-side.
    return { externalId, status: 'CANCELED' };
  }

  async refund(secret: string, intentExternalId: string, amountCents?: number): Promise<RefundResult> {
    const txn = await this.findTransaction(secret, intentExternalId);
    if (!txn) return { status: 'FAILED', error: 'Original transaction not found' };
    const idem = this.idem('rf' + intentExternalId + Date.now());
    const amount = amountCents !== undefined ? this.money(amountCents) : txn.amount;

    // Closed batch -> refund. Open batch -> reverse (full amount only).
    const rf = await httpJson('POST', `${BASE}/payment/refund`, this.headers(secret, idem), {
      originalTransactionId: txn.transactionId,
      amount,
    });
    if (rf.ok) return { externalId: String(rf.json?.transactionId ?? ''), status: 'SUCCEEDED', raw: { via: 'refund' } };

    const rv = await httpJson('POST', `${BASE}/payment/reverse`, this.headers(secret, this.idem('rv' + intentExternalId + Date.now())), {
      originalTransactionId: txn.transactionId,
    });
    if (rv.ok) return { externalId: String(rv.json?.transactionId ?? ''), status: 'SUCCEEDED', raw: { via: 'reverse' } };

    return { status: 'FAILED', error: this.err(rf) };
  }

  /**
   * Starts a HelcimPay.js checkout session for ONLINE (card-not-present)
   * payments — e.g. booking deposits. The frontend renders the returned
   * checkoutToken in the HelcimPay modal; no card data touches Lumio.
   */
  async initializeOnlineCheckout(secret: string, amountCents: number, currency: string, reference: string) {
    const r = await httpJson('POST', `${BASE}/helcim-pay/initialize`, this.headers(secret), {
      paymentType: 'purchase',
      amount: this.money(amountCents),
      currency: currency.toUpperCase(),
      invoiceNumber: this.invoiceNo(reference),
    });
    if (!r.ok) throw new Error(this.err(r));
    return { checkoutToken: r.json?.checkoutToken, secretToken: r.json?.secretToken };
  }

  verifyWebhook(): WebhookResult {
    throw new Error('Helcim webhook verification is not enabled yet (status resolved via polling)');
  }

  private async findTransaction(secret: string, invoiceNumber: string): Promise<any | null> {
    const r = await httpJson('GET', `${BASE}/card-transactions?invoiceNumber=${encodeURIComponent(invoiceNumber)}`, this.headers(secret));
    if (!r.ok) return null;
    const items = Array.isArray(r.json) ? r.json : r.json?.data ?? [];
    return (items as any[])[0] ?? null;
  }

  private mapStatus(s?: string): IntentStatus {
    switch ((s ?? '').toUpperCase()) {
      case 'APPROVED': return 'SUCCEEDED';
      case 'DECLINED': return 'FAILED';
      default: return s ? 'PROCESSING' : 'PROCESSING';
    }
  }
}
