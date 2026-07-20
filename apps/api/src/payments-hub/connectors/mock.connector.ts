import { Injectable } from '@nestjs/common';
import { PaymentConnector } from './payment-connector.interface';
import {
  ChargeInput,
  ConnectResult,
  ConnectorCapabilities,
  IntentResult,
  ProviderId,
  ReaderInfo,
  RefundResult,
  WebhookResult,
} from './connector.types';

/**
 * Mock connector for dev/sandbox. Accepts any secret starting with "mock_" and
 * settles instantly, so the full connect -> charge -> refund -> webhook flow can
 * be tested without a real PSP or network. Never handles real money.
 */
@Injectable()
export class MockConnector implements PaymentConnector {
  readonly id: ProviderId = 'mock';

  capabilities(): ConnectorCapabilities {
    return { terminal: true, online: true, tapToPay: true, interac: true, partialRefund: true, currencies: ['USD', 'CAD'] };
  }

  async verifyCredential(secret: string): Promise<ConnectResult> {
    if (!secret || !secret.startsWith('mock_')) {
      return { ok: false, capabilities: this.capabilities(), error: 'Mock key must start with "mock_"' };
    }
    return { ok: true, accountId: 'acct_mock', currency: 'USD', capabilities: this.capabilities() };
  }

  async listReaders(): Promise<ReaderInfo[]> {
    return [{ externalId: 'mock_reader_1', label: 'Mock Reader', status: 'ONLINE' }];
  }

  async registerReader(_secret: string, code: string, label?: string, locationId?: string): Promise<ReaderInfo> {
    return { externalId: `mock_reader_${code}`, label: label ?? 'Mock Reader', status: 'ONLINE', locationId };
  }

  async createConnectionToken(): Promise<string | null> {
    return 'mock_connection_token';
  }

  async charge(_secret: string, input: ChargeInput): Promise<IntentResult> {
    return { externalId: `mock_pi_${input.reference}`, status: 'SUCCEEDED', raw: { simulated: true } };
  }

  async getIntent(_secret: string, externalId: string): Promise<IntentResult> {
    return { externalId, status: 'SUCCEEDED' };
  }

  async cancelIntent(_secret: string, externalId: string): Promise<IntentResult> {
    return { externalId, status: 'CANCELED' };
  }

  async refund(_secret: string, intentExternalId: string, amountCents?: number): Promise<RefundResult> {
    return { externalId: `mock_re_${intentExternalId}`, status: 'SUCCEEDED', raw: { amountCents } };
  }

  verifyWebhook(rawBody: Buffer): WebhookResult {
    const evt = JSON.parse(rawBody.toString('utf8') || '{}');
    return { id: evt.id ?? 'mock_evt', type: evt.type ?? 'mock.event', intentExternalId: evt.intentExternalId, status: evt.status, raw: evt };
  }
}
