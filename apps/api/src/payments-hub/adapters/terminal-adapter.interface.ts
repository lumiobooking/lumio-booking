import { ConnectorCapabilities, ProviderId } from '../connectors/connector.types';

/**
 * Canonical card-terminal adapter contract.
 *
 * Every physical-terminal integration implements this, regardless of how the
 * terminal is reached (cloud REST, USB serial, Bluetooth SDK). Adding a new
 * terminal family = adding one adapter; nothing else in the system changes.
 *
 * Phase 1 ships exactly one fully working adapter (Dejavoo SPIn Cloud). The
 * USB / Bluetooth adapters exist as typed placeholders so the architecture is
 * proven, but they are `enabled: false` and hidden from the salon UI.
 *
 * No cardholder data ever crosses this boundary — the terminal captures and
 * encrypts the card itself (P2PE), so Lumio stays in PCI SAQ A scope.
 */

export type ConnectionType = 'CLOUD' | 'USB' | 'BLUETOOTH';

/** Outcome of a card-present operation, normalised across providers. */
export type PaymentOutcome =
  | 'APPROVED'
  | 'DECLINED'
  | 'CANCELED'
  /** Terminal is still working — keep polling. */
  | 'PENDING'
  /**
   * We do NOT know whether the card was charged (network timeout, proxy
   * timeout, crashed request). NEVER retry a charge in this state: call
   * getPaymentStatus() with the same reference first.
   */
  | 'UNKNOWN'
  /** The request itself failed (bad credentials, terminal offline, ...). */
  | 'ERROR';

/**
 * Per-tenant credentials, already decrypted by CredentialStore. Adapters are
 * stateless: they never read the DB and never touch the crypto layer, which
 * makes them trivial to unit-test with a fake fetch.
 */
export interface AdapterCredentials {
  /** Primary secret. Dejavoo: `Authkey`. Stripe: secret key. Square: access token. */
  secret: string;
  /** Dejavoo `Tpn` — identifies one physical terminal. Default when no terminalId is passed. */
  tpn?: string;
  /** Dejavoo `RegisterId` — marked [Obsolete] upstream; kept for older merchant setups. */
  registerId?: string;
  /** Which provider environment to hit. Defaults to 'production'. */
  environment?: 'sandbox' | 'production';
  locationId?: string;
  region?: string;
  /**
   * Whether the provider expects `Amount` to already include the tip.
   *
   * Dejavoo's docs call the field "Total amount of the transaction", which reads
   * as tip-inclusive, but they never say so outright. Getting it wrong
   * overcharges every tipped sale by exactly the tip, so this is a setting a
   * salon can correct in seconds rather than a constant needing a redeploy.
   * Undefined = use the adapter's documented default.
   */
  amountIncludesTip?: boolean;
}

export interface CreatePaymentInput {
  amountCents: number;
  /** Tip captured on the POS before sending to the terminal. */
  tipCents?: number;
  currency: string;
  /**
   * Lumio-side idempotency key. The adapter derives a stable provider
   * reference from it, so re-sending the same input can never double-charge.
   */
  reference: string;
  /** Which terminal to ring it up on (Dejavoo: TPN). Falls back to cred.tpn. */
  terminalId?: string;
  invoiceNumber?: string;
  description?: string;
}

export interface VoidPaymentInput {
  /** Reference of the ORIGINAL transaction being voided. */
  reference: string;
  /** Total amount of the original transaction (Dejavoo requires it). */
  amountCents: number;
  terminalId?: string;
}

export interface RefundPaymentInput {
  /** Reference of the original sale, for our own records / receipts. */
  originalReference?: string;
  /** A NEW unique reference for the refund itself. */
  reference: string;
  /** Partial refunds: pass less than the original amount. */
  amountCents: number;
  terminalId?: string;
}

/** Normalised result of any card-present operation. */
export interface PaymentResult {
  outcome: PaymentOutcome;
  /** Provider-side id of the transaction (Dejavoo: ReferenceId echoed back). */
  externalId?: string;
  /** Authorization / approval code from the processor. */
  approvalCode?: string;
  /** Card brand, e.g. Visa. Never a full PAN. */
  cardBrand?: string;
  /** Last 4 only. Lumio never stores or logs a full card number. */
  last4?: string;
  entryType?: string;
  amountCents?: number;
  tipCents?: number;
  totalCents?: number;
  batchNumber?: string;
  transactionNumber?: string;
  /** Processor retrieval reference number, for disputes. */
  rrn?: string;
  /** Provider status code, kept verbatim for support tickets. */
  code?: string;
  message?: string;
  /** When the terminal is busy: seconds the provider asks us to wait. */
  retryAfterSeconds?: number;
  raw?: unknown;
}

export interface TerminalHealth {
  online: boolean;
  terminalId?: string;
  message?: string;
  raw?: unknown;
}

export interface TerminalAdapter {
  readonly id: ProviderId;
  readonly connectionType: ConnectionType;
  /**
   * False for adapters that are scaffolded but not finished. The registry
   * refuses to hand these out and the salon UI never lists them, so a
   * half-built integration can never reach a paying customer.
   */
  readonly enabled: boolean;

  /** Validate credentials and learn what this merchant account can do. */
  connect(cred: AdapterCredentials): Promise<import('../connectors/connector.types').ConnectResult>;
  /** Release any adapter-held resources. Cloud adapters are stateless: no-op. */
  disconnect(cred: AdapterCredentials): Promise<void>;
  /** Is this specific terminal reachable right now? */
  testConnection(cred: AdapterCredentials, terminalId?: string): Promise<TerminalHealth>;
  getCapabilities(): ConnectorCapabilities;

  createPayment(cred: AdapterCredentials, input: CreatePaymentInput): Promise<PaymentResult>;
  /** Look up a transaction by reference. The double-charge guard depends on this. */
  getPaymentStatus(cred: AdapterCredentials, reference: string, terminalId?: string): Promise<PaymentResult>;
  /** Tell the terminal to stop waiting for a card. */
  cancelPayment(cred: AdapterCredentials, reference: string, terminalId?: string): Promise<PaymentResult>;
  voidPayment(cred: AdapterCredentials, input: VoidPaymentInput): Promise<PaymentResult>;
  refundPayment(cred: AdapterCredentials, input: RefundPaymentInput): Promise<PaymentResult>;
}
