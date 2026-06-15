import { Logger } from '@nestjs/common';
import {
  EmailMessage,
  EmailProvider,
  SendResult,
  SmsMessage,
  SmsProvider,
} from './notification-provider.interface';

const logger = new Logger('MockNotifications');

/** Logs the email instead of sending it. Used until a real provider is wired. */
export class MockEmailProvider implements EmailProvider {
  readonly name = 'mock';
  async sendEmail(message: EmailMessage): Promise<SendResult> {
    logger.log(`[email->${message.to}] ${message.subject}`);
    return { success: true, providerMessageId: `mock-${Date.now()}` };
  }
}

/** Logs the SMS instead of sending it. */
export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';
  async sendSms(message: SmsMessage): Promise<SendResult> {
    logger.log(`[sms->${message.to}] ${message.body.slice(0, 60)}`);
    return { success: true, providerMessageId: `mock-${Date.now()}` };
  }
}
