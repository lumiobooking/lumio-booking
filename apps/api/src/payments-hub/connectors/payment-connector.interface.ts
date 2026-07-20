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
 * Stateless provider connector. The orchestrator decrypts the tenant's OWN API
 * key and passes it in on every call, so connectors never touch the DB or the
 * crypto layer and are trivial to unit-test. No card data is ever handled here;
 * card capture happens on the P2PE reader / provider SDK (PCI SAQ A).
 */
export interface PaymentConnector {
  readonly id: ProviderId;
  capabilities(): ConnectorCapabilities;
  verifyCredential(secret: string, opts?: Record<string, string | undefined>): Promise<ConnectResult>;
  listReaders(secret: string): Promise<ReaderInfo[]>;
  registerReader(secret: string, code: string, label?: string, locationId?: string): Promise<ReaderInfo>;
  createConnectionToken(secret: string): Promise<string | null>;
  charge(secret: string, input: ChargeInput): Promise<IntentResult>;
  getIntent(secret: string, externalId: string): Promise<IntentResult>;
  cancelIntent(secret: string, externalId: string): Promise<IntentResult>;
  refund(secret: string, intentExternalId: string, amountCents?: number): Promise<RefundResult>;
  verifyWebhook(rawBody: Buffer, signature: string, webhookSecret: string): WebhookResult;
}
