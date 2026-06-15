/**
 * Provider abstraction for payments. Business logic depends only on this
 * interface so Stripe (or another PSP) drops in later without touching the
 * services. Secret keys always come from environment variables, never code.
 */

export interface ChargeInput {
  amountCents: number;
  currency: string;
  /** Idempotency / correlation reference, e.g. the appointment id. */
  reference: string;
  description?: string;
}

export interface ChargeResult {
  success: boolean;
  providerReference?: string;
  error?: string;
}

export interface PaymentProvider {
  readonly name: string;
  charge(input: ChargeInput): Promise<ChargeResult>;
  refund(providerReference: string): Promise<ChargeResult>;
}
