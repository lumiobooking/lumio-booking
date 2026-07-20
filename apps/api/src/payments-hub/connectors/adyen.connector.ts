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

const SALE_ID = 'LumioPOS';

/**
 * Adyen Cloud connector — BYO model. The salon generates an API key with the
 * "Cloud Device API" role in THEIR OWN Adyen Customer Area and pastes it, plus
 * their merchant account and the terminal's POI/device id. Lumio registers nothing.
 *
 * Uses Adyen's Cloud device API with Nexo/Terminal API (SaleToPOIRequest) messages:
 *   POST {base}/v1/merchants/{merchantAccount}/devices/{deviceId}/async
 * We send the payment asynchronously and resolve the outcome with a
 * TransactionStatus request, which matches how the POS polls for the result.
 *
 * NOTE: written from the Adyen docs; verify against Adyen's sandbox (they publish
 * a mock Terminal API server) before enabling for a real salon.
 */
@Injectable()
export class AdyenConnector implements PaymentConnector {
  readonly id: ProviderId = 'adyen';

  private base(region?: string): string {
    switch ((region || 'test').toLowerCase()) {
      case 'live-us': return 'https://device-api-live-us.adyen.com';
      case 'live-eu':
      case 'live': return 'https://device-api-live.adyen.com';
      default: return 'https://device-api-test.adyen.com';
    }
  }
  private url(opts: Record<string, string | undefined> | undefined, deviceId: string, mode: 'sync' | 'async') {
    const merchant = opts?.locationId || '';
    return `${this.base(opts?.region)}/v1/merchants/${encodeURIComponent(merchant)}/devices/${encodeURIComponent(deviceId)}/${mode}`;
  }
  private headers(secret: string) {
    return { 'X-API-Key': secret, accept: 'application/json' };
  }
  /** Nexo ServiceID must be short (<=10 chars) and unique per request. */
  private serviceId(reference: string): string {
    const a = (reference || '').replace(/[^a-zA-Z0-9]/g, '');
    return (a.slice(-8) + Date.now().toString().slice(-2)).slice(0, 10);
  }
  private header(category: string, deviceId: string, serviceId: string) {
    return {
      ProtocolVersion: '3.0',
      MessageClass: 'Service',
      MessageCategory: category,
      MessageType: 'Request',
      SaleID: SALE_ID,
      ServiceID: serviceId,
      POIID: deviceId,
    };
  }
  private err(r: any): string {
    const resp = r?.json?.SaleToPOIResponse;
    const anyResp = resp && (Object.values(resp).find((v: any) => v?.Response) as any);
    return anyResp?.Response?.AdditionalResponse || anyResp?.Response?.ErrorCondition || r?.json?.message || `Adyen error (HTTP ${r?.status})`;
  }
  private resultOf(json: any, key: string): string | undefined {
    return json?.SaleToPOIResponse?.[key]?.Response?.Result;
  }

  capabilities(): ConnectorCapabilities {
    return { terminal: true, online: false, tapToPay: false, interac: true, partialRefund: true, currencies: ['USD', 'CAD'] };
  }

  async verifyCredential(secret: string, opts?: Record<string, string | undefined>): Promise<ConnectResult> {
    if (!secret?.trim()) return { ok: false, capabilities: this.capabilities(), error: 'API key is required' };
    if (!opts?.locationId) {
      return { ok: false, capabilities: this.capabilities(), error: 'Merchant account is required (enter it in the Location/Merchant field)' };
    }
    // Adyen's device endpoints are per-terminal, so real connectivity is checked
    // when a terminal is added (Diagnosis ping). Here we validate the inputs.
    const currency = (opts?.currency || 'USD').toUpperCase();
    const caps = this.capabilities();
    caps.currencies = [currency];
    caps.interac = currency === 'CAD';
    return { ok: true, accountId: opts.locationId, currency, capabilities: caps };
  }

  async listReaders(): Promise<ReaderInfo[]> {
    // Terminal inventory lives in Adyen's Management API (different scope);
    // the salon adds the terminal's POI id directly.
    return [];
  }

  /** `code` is the terminal's POI / device id (e.g. V400m-123456789). */
  async registerReader(secret: string, code: string, label?: string, locationId?: string): Promise<ReaderInfo> {
    const deviceId = code.trim();
    const opts = { locationId, region: undefined as string | undefined };
    const sid = this.serviceId('diag' + deviceId);
    const r = await httpJson('POST', this.url(opts, deviceId, 'sync'), this.headers(secret), {
      SaleToPOIRequest: {
        MessageHeader: this.header('Diagnosis', deviceId, sid),
        DiagnosisRequest: { HostDiagnosisFlag: false },
      },
    });
    const ok = r.ok && this.resultOf(r.json, 'DiagnosisResponse') === 'Success';
    return { externalId: deviceId, label: label ?? 'Adyen Terminal', status: ok ? 'ONLINE' : 'UNKNOWN', locationId };
  }

  async createConnectionToken(): Promise<string | null> {
    return null;
  }

  async charge(secret: string, input: ChargeInput): Promise<IntentResult> {
    const deviceId = input.readerExternalId;
    if (!deviceId) return { status: 'FAILED', error: 'Adyen requires the terminal POI/device id' };
    const sid = this.serviceId(input.reference);
    const opts = { locationId: (input as any).merchantAccount, region: (input as any).region };
    const body = {
      SaleToPOIRequest: {
        MessageHeader: this.header('Payment', deviceId, sid),
        PaymentRequest: {
          SaleData: {
            SaleTransactionID: { TransactionID: input.reference, TimeStamp: new Date().toISOString() },
          },
          PaymentTransaction: {
            AmountsReq: { Currency: input.currency.toUpperCase(), RequestedAmount: Math.round(input.amountCents) / 100 },
          },
        },
      },
    };
    const r = await httpJson('POST', this.url(opts, deviceId, 'async'), this.headers(secret), body);
    if (!r.ok) return { status: 'FAILED', error: this.err(r) };
    // Async: the terminal now prompts the customer. We resolve via TransactionStatus.
    return { externalId: `${sid}|${deviceId}`, status: 'PROCESSING', raw: { serviceId: sid, deviceId } };
  }

  async getIntent(secret: string, externalId: string): Promise<IntentResult> {
    const [sid, deviceId] = externalId.split('|');
    if (!sid || !deviceId) return { externalId, status: 'PROCESSING' };
    const r = await httpJson('POST', this.url({}, deviceId, 'sync'), this.headers(secret), {
      SaleToPOIRequest: {
        MessageHeader: this.header('TransactionStatus', deviceId, this.serviceId('ts' + sid)),
        TransactionStatusRequest: {
          MessageReference: { MessageCategory: 'Payment', SaleID: SALE_ID, ServiceID: sid },
        },
      },
    });
    if (!r.ok) return { externalId, status: 'PROCESSING' };
    const ts = r.json?.SaleToPOIResponse?.TransactionStatusResponse;
    const inner = ts?.RepeatedMessageResponse?.RepeatedResponseMessageBody?.PaymentResponse;
    const result = inner?.Response?.Result ?? ts?.Response?.Result;
    return { externalId, status: this.mapStatus(result, ts?.Response?.ErrorCondition), raw: { result } };
  }

  async cancelIntent(secret: string, externalId: string): Promise<IntentResult> {
    const [sid, deviceId] = externalId.split('|');
    if (!sid || !deviceId) return { externalId, status: 'CANCELED' };
    await httpJson('POST', this.url({}, deviceId, 'sync'), this.headers(secret), {
      SaleToPOIRequest: {
        MessageHeader: this.header('Abort', deviceId, this.serviceId('ab' + sid)),
        AbortRequest: { AbortReason: 'MerchantAbort', MessageReference: { MessageCategory: 'Payment', SaleID: SALE_ID, ServiceID: sid } },
      },
    }).catch(() => undefined);
    return { externalId, status: 'CANCELED' };
  }

  async refund(secret: string, intentExternalId: string, amountCents?: number): Promise<RefundResult> {
    const [sid, deviceId] = intentExternalId.split('|');
    if (!sid || !deviceId) return { status: 'FAILED', error: 'Missing Adyen transaction reference' };
    const r = await httpJson('POST', this.url({}, deviceId, 'sync'), this.headers(secret), {
      SaleToPOIRequest: {
        MessageHeader: this.header('Reversal', deviceId, this.serviceId('rv' + sid)),
        ReversalRequest: {
          OriginalPOITransaction: { POIID: deviceId, POITransactionID: { TransactionID: sid, TimeStamp: new Date().toISOString() } },
          ReversalReason: 'MerchantCancel',
          ...(amountCents !== undefined ? { ReversedAmount: Math.round(amountCents) / 100 } : {}),
        },
      },
    });
    const ok = r.ok && this.resultOf(r.json, 'ReversalResponse') === 'Success';
    return ok ? { status: 'SUCCEEDED', externalId: sid } : { status: 'FAILED', error: this.err(r) };
  }

  verifyWebhook(): WebhookResult {
    throw new Error('Adyen webhook verification is not enabled yet (status resolved via polling)');
  }

  private mapStatus(result?: string, errorCondition?: string): IntentStatus {
    switch ((result ?? '').toLowerCase()) {
      case 'success': return 'SUCCEEDED';
      case 'failure': return errorCondition === 'Cancel' ? 'CANCELED' : 'FAILED';
      case 'partial': return 'PROCESSING';
      default: return 'PROCESSING';
    }
  }
}
