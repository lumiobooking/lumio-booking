import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { PlatformConfigService } from '../billing/platform-config.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { CampaignContent, renderCampaignHtml, renderCampaignText, safeUrl } from './email-template';

export interface CampaignInput {
  name?: string;
  subject?: string;
  fromName?: string;
  replyTo?: string;
  preheader?: string;
  heading?: string;
  body?: string;
  imageUrl?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote?: string;
  recipients?: string; // raw pasted list
}

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;
const MAX_RECIPIENTS = 2000;

function webBase(): string {
  return (process.env.PUBLIC_WEB_URL || 'https://lumiobooking.com').replace(/\/$/, '');
}

/**
 * Bulk "hello, this is what we do" email.
 *
 * One engine, two scopes:
 *   tenantId = null  → Lumio pitching salons (Super Admin), sent on the platform's
 *                      own Brevo account.
 *   tenantId = <id>  → a salon emailing its own customers, sent on THAT salon's
 *                      email connection (their Brevo / Gmail / SMTP), so the mail
 *                      comes from their address and their reputation, not ours.
 *
 * Every address is written to email_campaign_recipients before we try to send —
 * that row is the outbox line, and it is updated with sent / failed + the error.
 */
@Injectable()
export class EmailCampaignsService {
  private readonly logger = new Logger('EmailCampaigns');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly platform: PlatformConfigService,
  ) {}

  private tid(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }
  private scopeKey(tenantId: string | null): string {
    return tenantId ?? 'platform';
  }

  /** Split a pasted blob into clean, de-duplicated addresses. */
  parseRecipients(raw: string): { emails: string[]; invalid: string[] } {
    const parts = String(raw || '')
      .split(/[\s,;]+/)
      .map((x) => x.trim().replace(/^[<"']+|[>"']+$/g, '').toLowerCase())
      .filter(Boolean);
    const seen = new Set<string>();
    const emails: string[] = [];
    const invalid: string[] = [];
    for (const p of parts) {
      if (!EMAIL_RE.test(p)) { invalid.push(p); continue; }
      if (seen.has(p)) continue;
      seen.add(p);
      emails.push(p);
    }
    return { emails, invalid };
  }

  // ---- content -------------------------------------------------------------
  private async brandFor(tenantId: string | null): Promise<{ brandName: string; brandColor: string; logoUrl: string | null }> {
    if (!tenantId) {
      return { brandName: 'Lumio Booking', brandColor: '#6366f1', logoUrl: null };
    }
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, branding: true } });
    const b = this.settings.brandingFrom(t?.branding) as { primaryColor?: string; logoUrl?: string };
    return {
      brandName: t?.name || 'Our salon',
      brandColor: b?.primaryColor || '#6366f1',
      logoUrl: b?.logoUrl || null,
    };
  }

  private async content(tenantId: string | null, c: {
    subject: string; preheader?: string | null; heading?: string | null; body?: string | null;
    imageUrl?: string | null; ctaLabel?: string | null; ctaUrl?: string | null; footerNote?: string | null;
  }, opts: { recipientName?: string | null; unsubscribeUrl?: string | null } = {}): Promise<CampaignContent> {
    const brand = await this.brandFor(tenantId);
    return {
      subject: c.subject,
      preheader: c.preheader ?? null,
      heading: c.heading ?? null,
      body: c.body ?? null,
      imageUrl: c.imageUrl ?? null,
      ctaLabel: c.ctaLabel ?? null,
      ctaUrl: c.ctaUrl ?? null,
      footerNote: c.footerNote ?? null,
      brandName: brand.brandName,
      brandColor: brand.brandColor,
      logoUrl: brand.logoUrl,
      recipientName: opts.recipientName ?? null,
      unsubscribeUrl: opts.unsubscribeUrl ?? null,
    };
  }

  /** Live preview for the composer (never sent, never stored). */
  async preview(tenantId: string | null, dto: CampaignInput) {
    const c = await this.content(tenantId, {
      subject: dto.subject || '(no subject)',
      preheader: dto.preheader, heading: dto.heading, body: dto.body,
      imageUrl: dto.imageUrl, ctaLabel: dto.ctaLabel, ctaUrl: dto.ctaUrl, footerNote: dto.footerNote,
    }, { recipientName: 'Anna', unsubscribeUrl: `${webBase()}/unsubscribe/preview` });
    return { html: renderCampaignHtml(c) };
  }

  // ---- how this scope actually sends mail -----------------------------------
  private async mailerFor(tenantId: string | null, fromName: string, replyTo?: string | null) {
    if (!tenantId) {
      const [apiKey, senderEmail, senderName] = await Promise.all([
        this.platform.get('brevo_api_key'),
        this.platform.get('brevo_sender_email'),
        this.platform.get('brevo_sender_name'),
      ]);
      if (!apiKey || !senderEmail) {
        throw new BadRequestException('Platform email is not configured yet. Add the Brevo API key + sender in Super Admin → Billing settings.');
      }
      return {
        brevo: { apiKey, senderEmail, senderName: fromName || senderName || 'Lumio Booking', replyTo: replyTo || senderEmail },
        senderName: fromName || senderName || 'Lumio Booking',
        replyTo: replyTo || senderEmail,
      };
    }
    // Exactly the shapes the notification providers expect (same mapping the
    // booking-confirmation emails use), so a campaign goes out on the salon's own
    // Brevo / Gmail / SMTP connection — their address, their reputation.
    const n = await this.settings.getNotificationSettings(tenantId);
    const brand = await this.brandFor(tenantId);
    const sender = fromName || n.senderName || brand.brandName;
    const reply = replyTo || n.replyTo || n.senderEmail || undefined;

    const smtp = n.smtp.user && n.smtp.pass
      ? { host: n.smtp.host, port: n.smtp.port, user: n.smtp.user, pass: n.smtp.pass, secure: n.smtp.secure,
          replyTo: reply, from: `${sender} <${n.senderEmail || n.smtp.user}>` }
      : undefined;
    const brevo = n.brevo.apiKey && n.senderEmail
      ? { apiKey: n.brevo.apiKey, senderEmail: n.senderEmail, senderName: n.brevo.senderName || sender, replyTo: reply }
      : undefined;
    const gmail = n.gmail.clientId && n.gmail.clientSecret && n.gmail.refreshToken && n.gmail.senderEmail
      ? { clientId: n.gmail.clientId, clientSecret: n.gmail.clientSecret, refreshToken: n.gmail.refreshToken,
          senderEmail: n.gmail.senderEmail, senderName: sender, replyTo: reply }
      : undefined;

    if (!smtp && !brevo && !gmail) {
      throw new BadRequestException('No email connection for this salon yet. Connect Brevo, Gmail or SMTP in Settings → Notifications first.');
    }
    return { brevo, smtp, gmail, mailService: n.mailService, senderName: sender, replyTo: reply };
  }

  // ---- CRUD ----------------------------------------------------------------
  private clean(dto: CampaignInput) {
    const subject = (dto.subject || '').trim();
    if (!subject) throw new BadRequestException('Give the email a subject line.');
    const fromName = (dto.fromName || '').trim();
    if (!fromName) throw new BadRequestException('Fill in the sender name your customers will see.');
    const url = safeUrl(dto.ctaUrl);
    if (dto.ctaUrl && !url) throw new BadRequestException('The button link must start with http:// or https://');
    const img = safeUrl(dto.imageUrl);
    if (dto.imageUrl && !img) throw new BadRequestException('The image link must start with http:// or https://');
    return {
      name: (dto.name || subject).trim().slice(0, 120),
      subject: subject.slice(0, 200),
      fromName: fromName.slice(0, 80),
      replyTo: (dto.replyTo || '').trim().slice(0, 160) || null,
      preheader: (dto.preheader || '').trim().slice(0, 200) || null,
      heading: (dto.heading || '').trim().slice(0, 200) || null,
      body: (dto.body || '').slice(0, 8000) || null,
      imageUrl: img || null,
      ctaLabel: (dto.ctaLabel || '').trim().slice(0, 60) || null,
      ctaUrl: url || null,
      footerNote: (dto.footerNote || '').trim().slice(0, 300) || null,
    };
  }

  async list(tenantId: string | null) {
    const rows = await this.prisma.emailCampaign.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, name: true, subject: true, status: true, total: true, sent: true, failed: true,
        skipped: true, sentAt: true, createdAt: true,
      },
    });
    return rows;
  }

  async getOne(tenantId: string | null, id: string) {
    const c = await this.prisma.emailCampaign.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException('Campaign not found');
    const recipients = await this.prisma.emailCampaignRecipient.findMany({
      where: { campaignId: c.id },
      orderBy: [{ status: 'asc' }, { email: 'asc' }],
      take: 500,
      select: { id: true, email: true, status: true, error: true, sentAt: true },
    });
    return { ...c, recipients };
  }

  /** Send one copy to the person composing it, before they blast 500 customers. */
  async sendTest(tenantId: string | null, userId: string | undefined, dto: CampaignInput & { to?: string }) {
    const to = String(dto.to || '').trim().toLowerCase();
    if (!EMAIL_RE.test(to)) throw new BadRequestException('Enter a valid address to send the test to.');
    const data = this.clean(dto);
    const mailer = await this.mailerFor(tenantId, data.fromName, data.replyTo);
    const c = await this.content(tenantId, data, { recipientName: 'Anna', unsubscribeUrl: `${webBase()}/unsubscribe/preview` });
    const r = await this.notifications.sendEmailRaw({
      tenantId: tenantId ?? '',
      channel: NotificationChannel.EMAIL,
      recipient: to,
      subject: `[TEST] ${data.subject}`,
      body: renderCampaignText(c),
      html: renderCampaignHtml(c),
      ...mailer,
    });
    if (!r.success) throw new BadRequestException(`Could not send the test: ${r.error || 'unknown error'}`);
    return { sent: true, provider: r.provider };
  }

  /**
   * Create the campaign, write every recipient to the outbox, then send in the
   * background (small batches, so a 500-address blast doesn't hold the request
   * open or trip the provider's rate limit).
   */
  async send(tenantId: string | null, userId: string | undefined, dto: CampaignInput) {
    const data = this.clean(dto);
    const { emails, invalid } = this.parseRecipients(dto.recipients || '');
    if (emails.length === 0) throw new BadRequestException('Paste at least one valid email address.');
    if (emails.length > MAX_RECIPIENTS) throw new BadRequestException(`Too many addresses (${emails.length}). The limit per send is ${MAX_RECIPIENTS}.`);

    // Fail fast if this scope has no working mail connection — before we create
    // a campaign that could never go out.
    await this.mailerFor(tenantId, data.fromName, data.replyTo);

    // Anyone who unsubscribed is dropped here, permanently. Never negotiable.
    const suppressed = new Set(
      (await this.prisma.emailSuppression.findMany({
        where: { scope: this.scopeKey(tenantId), email: { in: emails } },
        select: { email: true },
      })).map((r: { email: string }) => r.email),
    );

    const campaign = await this.prisma.emailCampaign.create({
      data: {
        ...data,
        tenantId,
        status: 'sending',
        total: emails.length,
        skipped: suppressed.size,
        createdByUserId: userId ?? null,
      },
    });

    await this.prisma.emailCampaignRecipient.createMany({
      data: emails.map((email) => ({
        campaignId: campaign.id,
        tenantId,
        email,
        status: suppressed.has(email) ? 'skipped' : 'pending',
        error: suppressed.has(email) ? 'Unsubscribed' : null,
      })),
    });

    // Fire and forget: the UI polls the campaign for progress.
    void this.run(campaign.id).catch((e) => this.logger.error(`campaign ${campaign.id} failed: ${String(e).slice(0, 200)}`));

    return { id: campaign.id, queued: emails.length - suppressed.size, skipped: suppressed.size, invalid: invalid.length };
  }

  /** The actual sending loop. */
  private async run(campaignId: string) {
    const c = await this.prisma.emailCampaign.findUnique({ where: { id: campaignId } });
    if (!c) return;
    const mailer = await this.mailerFor(c.tenantId, c.fromName, c.replyTo);
    const pending = await this.prisma.emailCampaignRecipient.findMany({
      where: { campaignId, status: 'pending' },
      select: { id: true, email: true, name: true },
    });

    let sent = 0;
    let failed = 0;
    const BATCH = 5;
    for (let i = 0; i < pending.length; i += BATCH) {
      const slice = pending.slice(i, i + BATCH);
      await Promise.all(slice.map(async (r: { id: string; email: string; name: string | null }) => {
        const content = await this.content(c.tenantId, c, {
          recipientName: r.name,
          unsubscribeUrl: `${webBase()}/unsubscribe/${r.id}`,
        });
        const res = await this.notifications.sendEmailRaw({
          tenantId: c.tenantId ?? '',
          channel: NotificationChannel.EMAIL,
          recipient: r.email,
          subject: c.subject,
          body: renderCampaignText(content),
          html: renderCampaignHtml(content),
          ...mailer,
        });
        if (res.success) sent++; else failed++;
        await this.prisma.emailCampaignRecipient.update({
          where: { id: r.id },
          data: {
            status: res.success ? 'sent' : 'failed',
            error: res.success ? null : (res.error || 'send failed').slice(0, 300),
            sentAt: res.success ? new Date() : null,
          },
        }).catch(() => undefined);
      }));
      await this.prisma.emailCampaign.update({ where: { id: campaignId }, data: { sent, failed } }).catch(() => undefined);
      if (i + BATCH < pending.length) await new Promise((r) => setTimeout(r, 400)); // be a good citizen
    }

    // Store what was actually sent, so the history can show the real thing later.
    const snapshot = await this.content(c.tenantId, c, { recipientName: null, unsubscribeUrl: null });
    await this.prisma.emailCampaign.update({
      where: { id: campaignId },
      data: {
        status: failed > 0 && sent === 0 ? 'failed' : 'sent',
        sent, failed, sentAt: new Date(), html: renderCampaignHtml(snapshot),
      },
    }).catch(() => undefined);
  }

  async remove(tenantId: string | null, id: string) {
    const c = await this.prisma.emailCampaign.findFirst({ where: { id, tenantId }, select: { id: true, status: true } });
    if (!c) throw new NotFoundException('Campaign not found');
    if (c.status === 'sending') throw new BadRequestException('This campaign is still sending.');
    await this.prisma.emailCampaign.delete({ where: { id: c.id } });
    return { ok: true };
  }

  // ---- public unsubscribe ---------------------------------------------------
  /** One click, no login, no questions — the law and basic decency both require it. */
  async unsubscribe(recipientId: string) {
    const r = await this.prisma.emailCampaignRecipient.findUnique({
      where: { id: recipientId },
      select: { email: true, tenantId: true },
    });
    if (!r) return { ok: false, brand: 'Lumio' };
    const scope = this.scopeKey(r.tenantId);
    await this.prisma.emailSuppression.upsert({
      where: { scope_email: { scope, email: r.email } },
      update: {},
      create: { scope, email: r.email },
    }).catch(() => undefined);
    const brand = (await this.brandFor(r.tenantId)).brandName;
    return { ok: true, email: r.email, brand };
  }
}
