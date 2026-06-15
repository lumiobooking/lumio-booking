import { Logger } from '@nestjs/common';
import { EmailProvider, SmsProvider } from './notification-provider.interface';
import { MockEmailProvider, MockSmsProvider } from './mock.providers';

const logger = new Logger('NotificationProviderFactory');

/**
 * Chooses providers from env (EMAIL_PROVIDER / SMS_PROVIDER). Only "mock" is
 * implemented today; the switch is where sendgrid/resend/ses/twilio plug in
 * later. Unknown values fall back to mock with a warning.
 */
export function createEmailProvider(): EmailProvider {
  const choice = (process.env.EMAIL_PROVIDER ?? 'mock').toLowerCase();
  switch (choice) {
    case 'mock':
      return new MockEmailProvider();
    // case 'sendgrid': return new SendgridEmailProvider(process.env.SENDGRID_API_KEY);
    default:
      logger.warn(`Unknown EMAIL_PROVIDER "${choice}", falling back to mock`);
      return new MockEmailProvider();
  }
}

export function createSmsProvider(): SmsProvider {
  const choice = (process.env.SMS_PROVIDER ?? 'mock').toLowerCase();
  switch (choice) {
    case 'mock':
      return new MockSmsProvider();
    // case 'twilio': return new TwilioSmsProvider(process.env.TWILIO_*);
    default:
      logger.warn(`Unknown SMS_PROVIDER "${choice}", falling back to mock`);
      return new MockSmsProvider();
  }
}
