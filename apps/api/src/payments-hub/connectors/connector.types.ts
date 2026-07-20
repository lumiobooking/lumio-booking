export type ProviderId = 'stripe' | 'mock' | 'square' | 'sumup' | 'adyen';

export type IntentStatus = 'REQUIRES_PAYMENT' | 'PROCESSING' | 'SUCCEEDED' | 'CANCELED' | 'FAILED';

export interface ConnectorCapabilities {
  terminal: boolean;
  online: boolean;
  tapToPay: boolean;
  interac: boolean;
  partialRefund: boolean;
  currencies: string[];
}

export interface ConnectResult {
  ok: boolean;
  accountId?: string;
  currency?: string;
  capabilities: ConnectorCapabilities;
  error?: string;
}

export interface ReaderInfo {
  externalId: string;
  label?: string;
  status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  locationId?: string;
}

export interface ChargeInput {
  amountCents: number;
  currency: string;
  readerExternalId?: string;
  reference: string;
  description?: string;
}

export interface IntentResult {
  externalId?: string;
  status: IntentStatus;
  clientSecret?: string;
  error?: string;
  raw?: unknown;
}

export interface RefundResult {
  externalId?: string;
  status: 'SUCCEEDED' | 'PENDING' | 'FAILED';
  error?: string;
  raw?: unknown;
}

export interface WebhookResult {
  id: string;
  type: string;
  intentExternalId?: string;
  status?: IntentStatus;
  raw?: unknown;
}
