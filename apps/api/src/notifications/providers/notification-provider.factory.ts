import { Logger } from '@nestjs/common';
import { EmailProvider, SmsProvider } from './notification-provider.interface';
import { MockEmailProvider, MockSmsProvider } from './mock.providers';
import { TwilioSmsProvider } from './twilio.provider';

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
  const accountSid = (process.env.TWILIO_ACCOUNT_SID ?? '').trim();
  const authToken = (process.env.TWILIO_AUTH_TOKEN ?? '').trim();
  const messagingServiceSid = (process.env.TWILIO_MESSAGING_SERVICE_SID ?? '').trim() || undefined;
  const fromNumber = (process.env.TWILIO_FROM_NUMBER ?? '').trim() || undefined;

  // Explicit override (SMS_PROVIDER=mock forces mock even if creds exist).
  const choice = (process.env.SMS_PROVIDER ?? '').toLowerCase();
  if (choice === 'mock') return new MockSmsProvider();

  // Auto-enable Twilio as soon as platform credentials + a sender are present.
  if (accountSid && authToken && (messagingServiceSid || fromNumber)) {
    logger.log('SMS provider: Twilio (live)');
    return new TwilioSmsProvider({ accountSid, authToken, messagingServiceSid, fromNumber });
  }

  if (choice === 'twilio') {
    logger.warn('SMS_PROVIDER=twilio but TWILIO_* env vars are incomplete — falling back to mock');
  }
  return new MockSmsProvider();
}
