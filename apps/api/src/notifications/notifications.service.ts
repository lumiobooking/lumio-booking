import { Injectable } from '@nestjs/common';
import { NotificationChannel, NotificationStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { EmailProvider, SmsProvider } from './providers/notification-provider.interface';
import { createEmailProvider, createSmsProvider } from './providers/notification-provider.factory';
import { SmtpConfig, SmtpEmailProvider } from './providers/smtp.provider';
import { BrevoConfig, BrevoEmailProvider } from './providers/brevo.provider';

/** Extracts the display name from a "Name <email>" string. */
function parseSenderName(from?: string): string {
  if (!from) return '';
  const m = from.match(/^\s*(.+?)\s*</);
  return m ? m[1] : '';
}

export interface SendNotificationInput {
  tenantId: string;
  channel: NotificationChannel;
  recipient: string;
  subject?: string;
  body: string;
  html?: string;
  relatedType?: string;
  relatedId?: string;
  // When provided for an EMAIL, deliver over the salon's own SMTP (real email)
  // instead of the mock provider.
  smtp?: SmtpConfig;
  // The salon's own Brevo HTTPS config (preferred over SMTP when present).
  brevo?: BrevoConfig;
}

/**
 * Sends notifications via the configured provider AND records every one in the
 * notifications table (tenant-scoped), so a salon has a full delivery history.
 * Sending never throws to the caller: failures are recorded with FAILED status.
 */
@Injectable()
export class NotificationsService {
  private readonly email: EmailProvider = createEmailProvider();
  private readonly sms: SmsProvider = createSmsProvider();

  constructor(private readonly prisma: PrismaService) {}

  async send(input: SendNotificationInput) {
    let status: NotificationStatus = NotificationStatus.PENDING;
    let error: string | null = null;

    // Email provider preference (per salon): the salon's own Brevo (HTTPS, works
    // from the cloud) > the salon's own SMTP > an optional platform-wide Brevo
    // (env) fallback > mock.
    const emailProvider: EmailProvider = ((): EmailProvider => {
      if (input.channel !== NotificationChannel.EMAIL) return this.email;
      if (input.brevo?.apiKey && input.brevo?.senderEmail) return new BrevoEmailProvider(input.brevo);
      if (input.smtp?.user && input.smtp?.pass) return new SmtpEmailProvider(input.smtp);
      const envKey = process.env.BREVO_API_KEY;
      const envSender = process.env.BREVO_SENDER_EMAIL;
      if (envKey && envSender) {
        const name = parseSenderName(input.smtp?.from) || process.env.BREVO_SENDER_NAME || 'Lumio Booking';
        return new BrevoEmailProvider({ apiKey: envKey, senderEmail: envSender, senderName: name });
      }
      return this.email;
    })();
    const provider = input.channel === NotificationChannel.EMAIL ? emailProvider : this.sms;

    try {
      const result =
        input.channel === NotificationChannel.EMAIL
          ? await emailProvider.sendEmail({
              to: input.recipient,
              subject: input.subject ?? '',
              body: input.body,
              html: input.html,
            })
          : await this.sms.sendSms({ to: input.recipient, body: input.body });
      status = result.success ? NotificationStatus.SENT : NotificationStatus.FAILED;
      error = result.error ?? null;
    } catch (err) {
      status = NotificationStatus.FAILED;
      error = String(err);
    }

    return this.prisma.notification.create({
      data: {
        tenantId: input.tenantId,
        channel: input.channel,
        recipient: input.recipient,
        subject: input.subject ?? null,
        body: input.body,
        status,
        provider: provider.name,
        error,
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
        sentAt: status === NotificationStatus.SENT ? new Date() : null,
      },
    });
  }

  /** List a tenant's notification history (Salon Admin). */
  list(user: AuthenticatedUser) {
    const tenantId = resolveTenantScope(user);
    const where: Prisma.NotificationWhereInput = tenantId ? { tenantId } : {};
    return this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
}
