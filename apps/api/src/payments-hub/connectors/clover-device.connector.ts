import { Injectable, Logger } from '@nestjs/common';
import { PaymentConnector } from './payment-connector.interface';
import { ChargeInput, ConnectResult, ConnectorCapabilities, IntentResult, ProviderId, ReaderInfo, RefundResult, WebhookResult } from './connector.types';
import {
  CloverOutcome, cloverHosts, externalPaymentIdOf, friendlyCloverError, packIntentId, payBody, readDeviceSecret,
  readDevices, readIntentId, readPayResult, type CloverDeviceSecret,
} from './clover-device';

const doFetch: any = (...a: unknown[]) => (globalThis as any).fetch(...a);

/** One JSON call with a deadline (a sale waits for the customer's card). */
async function call(method: string, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await doFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { ok: res.status >= 200 && res.status < 300, status: res.status, json };
}

/**
 * rt233 — CLOVER DEVICE: the salon's Clover Flex / Mini / Compact at the
 * counter, driven through Clover's cloud (REST Pay Display + Cloud Pay
 * Display). See ./clover-device.ts for what Clover requires.
 *
 * Clover answers a sale only when the customer has paid or it was
 * cancelled (up to a couple of minutes). The till must not hang on that, so
 * the sale runs in the background: charge() returns PROCESSING within a few
 * seconds and getIntent() reports the outcome — from memory, or, after a
 * restart, by asking Clover for the payment with our externalPaymentId.
 */
@Injectable()
export class CloverDeviceConnector implements PaymentConnector {
  readonly id: ProviderId = 'clover_device';
  private readonly logger = new Logger('CloverDevice');
  /** reference → outcome (or still running). Bounded. */
  private readonly running = new Map<string, { done: boolean; out?: CloverOutcome; at: number }>();

  capabilities(): ConnectorCapabilities {
    return { terminal: true, online: false, tapToPay: false, interac: true, partialRefund: true, currencies: ['USD', 'CAD'] };
  }

  private posId(): string { return (process.env.CLOVER_POS_ID || 'LumioBooking').slice(0, 64); }
  private headers(s: CloverDeviceSecret, serial?: string): Record<string, string> {
    return {
      Authorization: `Bearer ${s.token}`,
      'User-Agent': 'LumioBooking/1.0',
      'X-POS-Id': this.posId(),
      ...(serial ? { 'X-Clover-Device-Id': serial } : {}),
    };
  }

  async verifyCredential(secret: string, opts?: Record<string, string | undefined>): Promise<ConnectResult> {
    const s = readDeviceSecret(secret, opts);
    if (!s.mid || !s.token) return { ok: false, capabilities: this.capabilities(), error: 'Connect with Clover first (merchant and sign-in missing)' };
    const r = await call('GET', `${cloverHosts(s.env).api}/v3/merchants/${encodeURIComponent(s.mid)}`, this.headers(s), undefined, 10_000).catch(() => null);
    if (!r?.ok) return { ok: false, capabilities: this.capabilities(), error: r ? friendlyCloverError(String(r.json?.message ?? `HTTP ${r.status}`), r.json) : 'Could not reach Clover' };
    const currency = String(opts?.currency || r.json?.defaultCurrency || 'USD').toUpperCase();
    return { ok: true, accountId: s.mid, currency, capabilities: { ...this.capabilities(), currencies: [currency] } };
  }

  async listReaders(secret: string): Promise<ReaderInfo[]> {
    const s = readDeviceSecret(secret);
    const r = await call('GET', `${cloverHosts(s.env).api}/v3/merchants/${encodeURIComponent(s.mid)}/devices`, this.headers(s), undefined, 10_000).catch(() => null);
    if (!r?.ok) return [];
    return readDevices(r.json).map((d) => ({ externalId: d.serial, label: d.label, status: 'UNKNOWN' as const }));
  }

  /** "Add card reader" = the device's serial number (Settings → About on the device, or the Clover dashboard). */
  async registerReader(secret: string, code: string, label?: string): Promise<ReaderInfo> {
    const serial = String(code ?? '').trim().toUpperCase();
    if (!serial) throw new Error('Enter the serial number of the Clover device');
    const list = await this.listReaders(secret);
    const found = list.find((d) => d.externalId.toUpperCase() === serial);
    if (list.length && !found) throw new Error('This serial number is not one of this Clover merchant\'s devices');
    return { externalId: found?.externalId ?? serial, label: label || found?.label || 'Clover', status: 'UNKNOWN' };
  }

  async checkReader(secret: string, externalId: string): Promise<{ online: boolean; message?: string }> {
    const s = readDeviceSecret(secret);
    const r = await call('POST', `${cloverHosts(s.env).connect}/v1/device/ping`, this.headers(s, externalId), {}, 10_000).catch(() => null);
    return r?.ok ? { online: true } : { online: false, message: friendlyCloverError(String(r?.json?.message ?? 'not reachable'), r?.json) };
  }

  async createConnectionToken(): Promise<string | null> { return null; }

  async charge(secret: string, input: ChargeInput): Promise<IntentResult> {
    const s = readDeviceSecret(secret);
    const serial = String(input.readerExternalId ?? '').trim();
    if (!serial) return { status: 'FAILED', error: 'Pick the Clover device to charge on' };
    const id = packIntentId(serial, input.reference);
    const prior = this.running.get(input.reference);
    if (prior) return this.view(id, prior);
    const slot: { done: boolean; out?: CloverOutcome; at: number } = { done: false, at: Date.now() };
    this.running.set(input.reference, slot);
    if (this.running.size > 500) this.running.delete(this.running.keys().next().value as string);
    const headers = { ...this.headers(s, serial), 'Idempotency-Key': externalPaymentIdOf(input.reference) };
    const sale = call('POST', `${cloverHosts(s.env).connect}/v1/payments`, headers, payBody(input), 180_000)
      .then((r) => readPayResult(r.ok, r.json))
      .catch((e) => ({ status: 'FAILED' as const, error: friendlyCloverError(String((e as Error)?.message ?? e)) }))
      .then((out) => {
        slot.done = true; slot.out = out;
        // Back to the welcome screen whatever happened (best effort).
        void call('POST', `${cloverHosts(s.env).connect}/v1/device/welcome`, this.headers(s, serial), {}, 8_000).catch(() => undefined);
        return out;
      });
    // Wait a moment: a device that is off or busy answers at once.
    await Promise.race([sale, new Promise((r) => setTimeout(r, 4_000))]);
    return this.view(id, slot);
  }

  private view(id: string, slot: { done: boolean; out?: CloverOutcome }): IntentResult {
    if (!slot.done || !slot.out) return { externalId: id, status: 'PROCESSING' };
    const o = slot.out;
    return { externalId: id, status: o.status, error: o.error, raw: { paymentId: o.paymentId, amountCents: o.amountCents, tipCents: o.tipCents, last4: o.last4 } };
  }

  async getIntent(secret: string, externalId: string): Promise<IntentResult> {
    const { reference } = readIntentId(externalId);
    const slot = this.running.get(reference);
    if (slot) return this.view(externalId, slot);
    // After a restart: ask Clover whether a payment with our id exists.
    const found = await this.findPayment(secret, reference);
    if (found) return { externalId, status: 'SUCCEEDED', raw: found };
    return { externalId, status: 'PROCESSING' };
  }

  private async findPayment(secret: string, reference: string): Promise<{ paymentId: string; amountCents?: number; tipCents?: number } | null> {
    const s = readDeviceSecret(secret);
    const ext = externalPaymentIdOf(reference);
    const url = `${cloverHosts(s.env).api}/v3/merchants/${encodeURIComponent(s.mid)}/payments?filter=${encodeURIComponent(`externalPaymentId=${ext}`)}&limit=1`;
    const r = await call('GET', url, this.headers(s), undefined, 10_000).catch(() => null);
    const p = r?.ok && Array.isArray(r.json?.elements) ? r.json.elements[0] : null;
    if (!p?.id || String(p.result ?? 'SUCCESS').toUpperCase() !== 'SUCCESS') return null;
    return { paymentId: String(p.id), amountCents: p.amount, tipCents: p.tipAmount };
  }

  async cancelIntent(secret: string, externalId: string): Promise<IntentResult> {
    const s = readDeviceSecret(secret);
    const { serial, reference } = readIntentId(externalId);
    if (serial) await call('POST', `${cloverHosts(s.env).connect}/v1/device/cancel`, this.headers(s, serial), {}, 10_000).catch(() => undefined);
    const slot = this.running.get(reference);
    if (slot?.done && slot.out?.status === 'SUCCEEDED') return this.view(externalId, slot);
    return { externalId, status: 'CANCELED' };
  }

  /** Refund on the device the sale was made on (Clover shows it there). */
  async refund(secret: string, intentExternalId: string, amountCents?: number): Promise<RefundResult> {
    const s = readDeviceSecret(secret);
    const { serial, reference } = readIntentId(intentExternalId);
    const slot = this.running.get(reference);
    const paymentId = slot?.out?.paymentId ?? (await this.findPayment(secret, reference))?.paymentId;
    if (!paymentId) return { status: 'FAILED', error: 'Clover payment not found for this sale' };
    if (!serial) return { status: 'FAILED', error: 'Unknown Clover device for this sale' };
    const body = amountCents && amountCents > 0 ? { amount: Math.round(amountCents) } : { fullRefund: true };
    const r = await call('POST', `${cloverHosts(s.env).connect}/v1/payments/${encodeURIComponent(paymentId)}/refunds`, this.headers(s, serial), body, 120_000).catch((e) => ({ ok: false, status: 0, json: { message: String(e) } }));
    if (!r.ok) return { status: 'FAILED', error: friendlyCloverError(String(r.json?.message ?? `HTTP ${r.status}`), r.json) };
    return { status: 'SUCCEEDED', externalId: String(r.json?.refund?.id ?? paymentId), raw: r.json };
  }

  verifyWebhook(): WebhookResult {
    // Results come back on the sale call itself; Clover sends no webhook here.
    return { id: '', type: 'ignored' };
  }
}
