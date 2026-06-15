import { Logger } from '@nestjs/common';
import { PaymentProvider } from './payment-provider.interface';
import { MockPaymentProvider } from './mock-payment.provider';

const logger = new Logger('PaymentProviderFactory');

/**
 * Chooses the payment provider from env (PAYMENT_PROVIDER). Only "mock" exists
 * today; this switch is where Stripe plugs in (reading STRIPE_SECRET_KEY from
 * the environment). Unknown values fall back to mock with a warning.
 */
export function createPaymentProvider(): PaymentProvider {
  const choice = (process.env.PAYMENT_PROVIDER ?? 'mock').toLowerCase();
  switch (choice) {
    case 'mock':
      return new MockPaymentProvider();
    // case 'stripe': return new StripePaymentProvider(process.env.STRIPE_SECRET_KEY);
    default:
      logger.warn(`Unknown PAYMENT_PROVIDER "${choice}", falling back to mock`);
      return new MockPaymentProvider();
  }
}
