import { Logger } from '@nestjs/common';
import { ChargeInput, ChargeResult, PaymentProvider } from './payment-provider.interface';

const logger = new Logger('MockPayment');

/** Pretends to charge/refund. Always succeeds. Replace with Stripe later. */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock';

  async charge(input: ChargeInput): Promise<ChargeResult> {
    logger.log(`[charge] ${input.amountCents} ${input.currency} ref=${input.reference}`);
    return { success: true, providerReference: `mock_ch_${Date.now()}` };
  }

  async refund(providerReference: string): Promise<ChargeResult> {
    logger.log(`[refund] ${providerReference}`);
    return { success: true, providerReference: `mock_re_${Date.now()}` };
  }
}
