export type ProviderId =
  | 'helcim'
  | 'stripe'
  | 'mock'
  | 'square'
  | 'sumup'
  | 'adyen'
  | 'dejavoo'
  // Placeholder ids for the USB / Bluetooth adapters (phases 2 and 3).
  | 'usb'
  | 'bluetooth';

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
  /** Tip entered on the POS, charged together with the sale. */
  tipCents?: number;
  currency: string;
  readerExternalId?: string;
  /** Idempotency key. Re-sending the same reference must never charge twice. */
  reference: string;
  /** Salon-facing invoice/ticket number printed on the terminal receipt. */
  invoiceNumber?: string;
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
