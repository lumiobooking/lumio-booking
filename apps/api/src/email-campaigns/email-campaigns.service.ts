import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { PlatformConfigService } from '../billing/platform-config.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { CampaignContent, fillTokens, renderCampaignHtml, renderCampaignText, safeUrl } from './email-template';

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

  /**
   * One line = one person. A name may ride along, because "Chào anh Tuấn" opens far
   * more mail than "Chào bạn". All of these work:
   *     a@b.com
   *     Anh Tuấn <a@b.com>
   *     a@b.com, Anh Tuấn
   *     Anh Tuấn, a@b.com
   */
  parseRecipients(raw: string): { people: { email: string; name: string | null }[]; invalid: string[] } {
    const lines = String(raw || '').split(/[\n;]+/);
    const seen = new Set<string>();
    const people: { email: string; name: string | null }[] = [];
    const invalid: string[] = [];

    const push = (email: string, name: string | null) => {
      const e = email.trim().replace(/^[<"']+|[>"']+$/g, '').toLowerCase();
      if (!EMAIL_RE.test(e)) { if (e) invalid.push(e); return; }
      if (seen.has(e)) return;
      seen.add(e);
      people.push({ email: e, name: (name || '').trim().replace(/^["']|["']$/g, '') || null });
    };

    for (const line of lines) {
      const l = line.trim();
      if (!l) continue;
      // "Anh Tuấn <a@b.com>"
      const angled = /^(.*?)<([^>]+)>$/.exec(l);
      if (angled) { push(angled[2], angled[1]); continue; }
      // comma / tab separated — whichever side looks like an email wins
      const cells = l.split(/[,\t]/).map((x) => x.trim()).filter(Boolean);
      if (cells.length >= 2) {
        const emailCell = cells.find((c) => c.includes('@'));
        const nameCell = cells.find((c) => c !== emailCell);
        if (emailCell) { push(emailCell, nameCell ?? null); continue; }
      }
      // a bare list of addresses on one line
      for (const chunk of l.split(/\s+/)) push(chunk, null);
    }
    return { people, invalid };
  }

  // ---- content -------------------------------------------------------------
  private async brandFor(tenantId: string | null): Promise<{ brandName: string; brandColor: string; logoUrl: string | null }> {
    if (!tenantId) {
      // Lumio's own campaigns: a TEXT wordmark in the header, never an image.
      // Logo files get squashed by the fixed width, blocked by default in Outlook /
      // Gmail's "images off" mode, and render as a broken box on retina — the header
      // looked wrong in the inbox. Text renders identically in every mail client.
      return { brandName: 'Lumio Agency', brandColor: '#2563eb', logoUrl: null };
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

  /**
   * The return address for ONE letter to ONE person.
   *
   * If an inbound domain is configured, every email gets its own reply address —
   * `reply+<recipientId>@reply.lumioagency.com`. When the prospect hits Reply, the
   * answer lands on our side: we know exactly WHO replied, mark them, and the
   * follow-up robot goes quiet for them forever. The message is then forwarded to
   * the real inbox, so nothing is lost.
   *
   * Without the inbound domain, we fall back to the plain reply-to and replies are
   * invisible to the system — which is why they have to be ticked by hand today.
   */
  private async replyAddressFor(recipientId: string, fallback?: string | null): Promise<string | undefined> {
    const domain = (await this.platform.get('inbound_domain'))?.trim().toLowerCase();
    if (!domain) return fallback || undefined;
    return `reply+${recipientId}@${domain}`;
  }

  // ---- how this scope actually sends mail -----------------------------------
  private async mailerFor(tenantId: string | null, fromName: string, replyTo?: string | null) {
    if (!tenantId) {
      const [apiKey, senderEmail, senderName, defaultReplyTo] = await Promise.all([
        this.platform.get('brevo_api_key'),
        this.platform.get('brevo_sender_email'),
        this.platform.get('brevo_sender_name'),
        this.platform.get('reply_to'),
      ]);
      if (!apiKey || !senderEmail) {
        throw new BadRequestException('Platform email is not configured yet. Add the Brevo API key + sender in Super Admin → Billing settings.');
      }
      // Leave the Reply-to box empty and replies still reach the inbox we actually
      // read — the platform default. Only then do we fall back to the sender address.
      const reply = replyTo || defaultReplyTo || senderEmail;
      return {
        brevo: { apiKey, senderEmail, senderName: fromName || senderName || 'Lumio Booking', replyTo: reply },
        senderName: fromName || senderName || 'Lumio Booking',
        replyTo: reply,
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
      subject: `[TEST] ${fillTokens(data.subject, { name: 'Anna', brand: c.brandName })}`,
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
    const { people, invalid } = this.parseRecipients(dto.recipients || '');
    const emails = people.map((p) => p.email);
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
      data: people.map((p) => ({
        campaignId: campaign.id,
        tenantId,
        email: p.email,
        name: p.name,
        status: suppressed.has(p.email) ? 'skipped' : 'pending',
        error: suppressed.has(p.email) ? 'Unsubscribed' : null,
      })),
    });

    // Whoever we email becomes a contact — that list is what the follow-up runs on.
    await this.upsertContacts(tenantId, people);

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
        const replyTo = await this.replyAddressFor(r.id, c.replyTo);
        const res = await this.notifications.sendEmailRaw({
          tenantId: c.tenantId ?? '',
          channel: NotificationChannel.EMAIL,
          recipient: r.email,
          subject: fillTokens(c.subject, { name: r.name, brand: content.brandName }),
          body: renderCampaignText(content),
          html: renderCampaignHtml(content),
          ...mailer,
          ...(replyTo ? { replyTo, brevo: mailer.brevo ? { ...mailer.brevo, replyTo } : undefined } : {}),
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

    // Keep the address book honest: how many letters has this person had, and when.
    const okEmails = (await this.prisma.emailCampaignRecipient.findMany({
      where: { campaignId, status: 'sent' },
      select: { email: true },
    })).map((r: { email: string }) => r.email);
    if (okEmails.length) {
      await this.prisma.emailContact.updateMany({
        where: { scope: this.scopeKey(c.tenantId), email: { in: okEmails } },
        data: { sends: { increment: 1 }, lastSentAt: new Date() },
      }).catch(() => undefined);
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

  // =========================================================================
  // Templates the user saved themselves
  // =========================================================================

  async templates(tenantId: string | null) {
    return this.prisma.emailTemplate.findMany({
      where: { scope: this.scopeKey(tenantId) },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  /** Save the letter currently in the composer. Overwrites when the name matches,
   *  so "save" behaves the way people expect it to. */
  async saveTemplate(tenantId: string | null, dto: CampaignInput & { id?: string }) {
    const scope = this.scopeKey(tenantId);
    const data = this.clean(dto);
    const name = (dto.name || data.subject).trim().slice(0, 120);

    const existing = dto.id
      ? await this.prisma.emailTemplate.findFirst({ where: { id: dto.id, scope }, select: { id: true } })
      : await this.prisma.emailTemplate.findFirst({ where: { scope, name }, select: { id: true } });

    const payload = {
      name,
      subject: data.subject,
      fromName: data.fromName,
      replyTo: data.replyTo,
      preheader: data.preheader,
      heading: data.heading,
      body: data.body,
      imageUrl: data.imageUrl,
      ctaLabel: data.ctaLabel,
      ctaUrl: data.ctaUrl,
      footerNote: data.footerNote,
    };
    if (existing) await this.prisma.emailTemplate.update({ where: { id: existing.id }, data: payload });
    else await this.prisma.emailTemplate.create({ data: { scope, tenantId, ...payload } });
    return this.templates(tenantId);
  }

  async deleteTemplate(tenantId: string | null, id: string) {
    await this.prisma.emailTemplate.deleteMany({ where: { id, scope: this.scopeKey(tenantId) } });
    return this.templates(tenantId);
  }

  // =========================================================================
  // The address book
  // =========================================================================

  private async upsertContacts(tenantId: string | null, people: { email: string; name: string | null }[]) {
    const scope = this.scopeKey(tenantId);
    for (const p of people) {
      await this.prisma.emailContact.upsert({
        where: { scope_email: { scope, email: p.email } },
        // never overwrite a name we already have with a blank one
        update: p.name ? { name: p.name } : {},
        create: { scope, tenantId, email: p.email, name: p.name },
      }).catch(() => undefined);
    }
  }

  /** One row per PERSON: name, how many letters they've had, where they are in the
   *  follow-up, and whether they replied (which stops the robot). */
  async contacts(tenantId: string | null) {
    const scope = this.scopeKey(tenantId);
    const [rows, supp] = await Promise.all([
      this.prisma.emailContact.findMany({
        where: { scope },
        orderBy: [{ replied: 'asc' }, { lastSentAt: 'desc' }],
        take: 5000,
      }),
      this.prisma.emailSuppression.findMany({ where: { scope }, select: { email: true } }),
    ]);
    const unsub = new Set(supp.map((r: { email: string }) => r.email));

    // last outcome per address, so a bounce is visible in the list
    const last = await this.prisma.emailCampaignRecipient.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 20000,
      select: { email: true, status: true, error: true, campaign: { select: { name: true, subject: true } } },
    });
    const lastBy = new Map<string, { status: string; error: string | null; campaign: string }>();
    for (const r of last as { email: string; status: string; error: string | null; campaign: { name: string; subject: string } | null }[]) {
      if (!lastBy.has(r.email)) {
        lastBy.set(r.email, { status: r.status, error: r.error, campaign: r.campaign?.name || r.campaign?.subject || '—' });
      }
    }

    return (rows as {
      id: string; email: string; name: string | null; company: string | null; note: string | null;
      replied: boolean; repliedAt: Date | null; sends: number; lastSentAt: Date | null; lastStep: number;
    }[]).map((c) => {
      const l = lastBy.get(c.email);
      return {
        id: c.id,
        email: c.email,
        name: c.name,
        company: c.company,
        note: c.note,
        replied: c.replied,
        repliedAt: c.repliedAt?.toISOString() ?? null,
        sends: c.sends,
        lastStep: c.lastStep,
        lastSentAt: c.lastSentAt?.toISOString() ?? null,
        lastStatus: l?.status ?? (c.sends > 0 ? 'sent' : 'new'),
        lastError: l?.error ?? null,
        lastCampaign: l?.campaign ?? '—',
        unsubscribed: unsub.has(c.email),
      };
    });
  }

  /** Paste or upload a list — "Anh Tuấn <a@b.com>", "a@b.com, Anh Tuấn", or a CSV. */
  async importContacts(tenantId: string | null, raw: string) {
    const { people, invalid } = this.parseRecipients(raw || '');
    if (!people.length) throw new BadRequestException('No valid email address found in that list.');
    const before = await this.prisma.emailContact.count({ where: { scope: this.scopeKey(tenantId) } });
    await this.upsertContacts(tenantId, people);
    const after = await this.prisma.emailContact.count({ where: { scope: this.scopeKey(tenantId) } });
    return { added: after - before, updated: people.length - (after - before), invalid: invalid.length };
  }

  async updateContact(tenantId: string | null, id: string, dto: { name?: string; company?: string; note?: string; replied?: boolean }) {
    const scope = this.scopeKey(tenantId);
    const c = await this.prisma.emailContact.findFirst({ where: { id, scope }, select: { id: true, replied: true } });
    if (!c) throw new NotFoundException('Contact not found');
    const data: Record<string, unknown> = {};
    if (typeof dto.name === 'string') data.name = dto.name.slice(0, 80) || null;
    if (typeof dto.company === 'string') data.company = dto.company.slice(0, 120) || null;
    if (typeof dto.note === 'string') data.note = dto.note.slice(0, 300) || null;
    if (typeof dto.replied === 'boolean') {
      data.replied = dto.replied;
      data.repliedAt = dto.replied ? new Date() : null;
    }
    await this.prisma.emailContact.update({ where: { id: c.id }, data });
    return this.contacts(tenantId);
  }

  async deleteContact(tenantId: string | null, id: string) {
    await this.prisma.emailContact.deleteMany({ where: { id, scope: this.scopeKey(tenantId) } });
    return { ok: true };
  }

  // =========================================================================
  // The follow-up automation
  // =========================================================================

  async getAutomation(tenantId: string | null) {
    const scope = this.scopeKey(tenantId);
    const a = await this.prisma.emailAutomation.findUnique({ where: { scope } });
    const due = await this.dueContacts(tenantId, a);
    return {
      enabled: a?.enabled ?? false,
      name: a?.name ?? 'Follow-up',
      everyDays: a?.everyDays ?? 30,
      dailyCap: a?.dailyCap ?? 100,
      fromName: a?.fromName ?? '',
      replyTo: a?.replyTo ?? '',
      steps: (a?.steps as unknown as CampaignInput[]) ?? [],
      lastRunAt: a?.lastRunAt?.toISOString() ?? null,
      sentTotal: a?.sentTotal ?? 0,
      dueNow: due.length,
    };
  }

  async saveAutomation(tenantId: string | null, dto: {
    enabled?: boolean; name?: string; everyDays?: number; dailyCap?: number;
    fromName?: string; replyTo?: string; steps?: CampaignInput[];
  }) {
    const scope = this.scopeKey(tenantId);
    const steps = Array.isArray(dto.steps) ? dto.steps.slice(0, 5).map((x) => this.clean(x)) : undefined;
    if (dto.enabled && (!steps || steps.length === 0)) {
      throw new BadRequestException('Add at least one letter before switching the follow-up on.');
    }
    if (dto.enabled) await this.mailerFor(tenantId, (dto.fromName || '').trim(), dto.replyTo);

    const data = {
      name: (dto.name || 'Follow-up').slice(0, 80),
      enabled: !!dto.enabled,
      everyDays: Math.min(180, Math.max(7, Math.round(dto.everyDays ?? 30))),
      dailyCap: Math.min(500, Math.max(10, Math.round(dto.dailyCap ?? 100))),
      fromName: (dto.fromName || '').slice(0, 80),
      replyTo: (dto.replyTo || '').slice(0, 160) || null,
      ...(steps ? { steps: steps as unknown as Prisma.InputJsonValue } : {}),
    };
    await this.prisma.emailAutomation.upsert({
      where: { scope },
      update: data,
      create: { scope, tenantId, ...data, steps: (steps ?? []) as unknown as Prisma.InputJsonValue },
    });
    return this.getAutomation(tenantId);
  }

  /**
   * Who is due a letter today?
   *   · never replied            — the moment someone answers, the robot shuts up
   *   · never unsubscribed
   *   · still has a letter left in the sequence
   *   · and the gap since their last letter has passed
   */
  private async dueContacts(tenantId: string | null, a: { everyDays: number; dailyCap: number; steps: unknown } | null) {
    if (!a) return [];
    const steps = Array.isArray(a.steps) ? (a.steps as CampaignInput[]) : [];
    if (!steps.length) return [];
    const scope = this.scopeKey(tenantId);
    const cutoff = new Date(Date.now() - a.everyDays * 86400_000);

    const supp = await this.prisma.emailSuppression.findMany({ where: { scope }, select: { email: true } });
    const unsub = new Set(supp.map((r: { email: string }) => r.email));

    const rows = await this.prisma.emailContact.findMany({
      where: {
        scope,
        replied: false,
        lastStep: { lt: steps.length },
        OR: [{ lastSentAt: null }, { lastSentAt: { lt: cutoff } }],
      },
      orderBy: { lastSentAt: 'asc' },
      take: a.dailyCap,
    });
    return (rows as { id: string; email: string; name: string | null; lastStep: number }[])
      .filter((c) => !unsub.has(c.email));
  }

  /** The daily run. Safe to call twice — a contact who just got a letter is no longer due. */
  async runAutomation(tenantId: string | null): Promise<{ sent: number; failed: number; due: number }> {
    const scope = this.scopeKey(tenantId);
    const a = await this.prisma.emailAutomation.findUnique({ where: { scope } });
    if (!a || !a.enabled) return { sent: 0, failed: 0, due: 0 };

    const steps = Array.isArray(a.steps) ? (a.steps as unknown as CampaignInput[]) : [];
    const due = await this.dueContacts(tenantId, a);
    if (!due.length) {
      await this.prisma.emailAutomation.update({ where: { scope }, data: { lastRunAt: new Date() } }).catch(() => undefined);
      return { sent: 0, failed: 0, due: 0 };
    }

    const mailer = await this.mailerFor(tenantId, a.fromName || '', a.replyTo);
    let sent = 0;
    let failed = 0;

    for (const c of due) {
      const step = steps[Math.min(c.lastStep, steps.length - 1)];
      if (!step) continue;
      const campaign = await this.prisma.emailCampaign.create({
        data: {
          tenantId,
          name: `${a.name} · ${step.subject ?? ''}`.slice(0, 120),
          subject: step.subject ?? '',
          fromName: a.fromName || '',
          replyTo: a.replyTo,
          preheader: step.preheader ?? null,
          heading: step.heading ?? null,
          body: step.body ?? null,
          imageUrl: step.imageUrl ?? null,
          ctaLabel: step.ctaLabel ?? null,
          ctaUrl: step.ctaUrl ?? null,
          footerNote: step.footerNote ?? null,
          status: 'sending',
          total: 1,
        },
      });
      const rec = await this.prisma.emailCampaignRecipient.create({
        data: { campaignId: campaign.id, tenantId, email: c.email, name: c.name, status: 'pending' },
      });

      const content = await this.content(tenantId, {
        subject: step.subject ?? '',
        preheader: step.preheader, heading: step.heading, body: step.body,
        imageUrl: step.imageUrl, ctaLabel: step.ctaLabel, ctaUrl: step.ctaUrl, footerNote: step.footerNote,
      }, { recipientName: c.name, unsubscribeUrl: `${webBase()}/unsubscribe/${rec.id}` });

      const replyTo = await this.replyAddressFor(rec.id, a.replyTo);
      const res = await this.notifications.sendEmailRaw({
        tenantId: tenantId ?? '',
        channel: NotificationChannel.EMAIL,
        recipient: c.email,
        subject: fillTokens(step.subject ?? '', { name: c.name, brand: content.brandName }),
        body: renderCampaignText(content),
        html: renderCampaignHtml(content),
        ...mailer,
        ...(replyTo ? { replyTo, brevo: mailer.brevo ? { ...mailer.brevo, replyTo } : undefined } : {}),
      });

      if (res.success) sent++; else failed++;
      await this.prisma.emailCampaignRecipient.update({
        where: { id: rec.id },
        data: {
          status: res.success ? 'sent' : 'failed',
          error: res.success ? null : (res.error || 'send failed').slice(0, 300),
          sentAt: res.success ? new Date() : null,
        },
      }).catch(() => undefined);
      await this.prisma.emailCampaign.update({
        where: { id: campaign.id },
        data: {
          status: res.success ? 'sent' : 'failed',
          sent: res.success ? 1 : 0,
          failed: res.success ? 0 : 1,
          sentAt: new Date(),
          html: renderCampaignHtml(content),
        },
      }).catch(() => undefined);

      if (res.success) {
        await this.prisma.emailContact.update({
          where: { id: c.id },
          data: { sends: { increment: 1 }, lastSentAt: new Date(), lastStep: { increment: 1 } },
        }).catch(() => undefined);
      }
      await new Promise((r) => setTimeout(r, 300)); // be a good citizen with the provider
    }

    await this.prisma.emailAutomation.update({
      where: { scope },
      data: { lastRunAt: new Date(), sentTotal: { increment: sent } },
    }).catch(() => undefined);

    this.logger.log(`automation ${scope}: sent ${sent}, failed ${failed}`);
    return { sent, failed, due: due.length };
  }

  /** Every enabled automation across the platform — called by the daily cron. */
  async runAllAutomations() {
    const rows = await this.prisma.emailAutomation.findMany({
      where: { enabled: true },
      select: { scope: true, tenantId: true },
    });
    for (const r of rows as { scope: string; tenantId: string | null }[]) {
      await this.runAutomation(r.tenantId).catch((e) =>
        this.logger.error(`automation ${r.scope} failed: ${String(e).slice(0, 160)}`));
    }
  }

  async remove(tenantId: string | null, id: string) {
    const c = await this.prisma.emailCampaign.findFirst({ where: { id, tenantId }, select: { id: true, status: true } });
    if (!c) throw new NotFoundException('Campaign not found');
    if (c.status === 'sending') throw new BadRequestException('This campaign is still sending.');
    await this.prisma.emailCampaign.delete({ where: { id: c.id } });
    return { ok: true };
  }

  // ---- inbound replies ------------------------------------------------------
  /**
   * A reply came back. Two ways to know who it was from:
   *   1. the address it was sent TO — reply+<recipientId>@… — which is exact
   *   2. failing that, the address it came FROM, matched against the contact list
   *
   * Marking them 'replied' is the whole point: an automated "just following up"
   * landing after a real conversation is the fastest way to lose a prospect.
   * Then we forward the message to the real inbox, so the reply is never trapped
   * inside the software.
   */
  async handleInboundReply(payload: unknown): Promise<{ matched: number }> {
    const items = this.inboundItems(payload);
    let matched = 0;

    for (const it of items) {
      const from = (it.from || '').toLowerCase().trim();
      const to = (it.to || '').toLowerCase();

      // 1 — the exact recipient row, from the reply+<id>@ address
      let contactEmail: string | null = null;
      let tenantId: string | null | undefined;
      const m = /reply\+([a-z0-9-]{8,})@/i.exec(to);
      if (m) {
        const rec = await this.prisma.emailCampaignRecipient.findUnique({
          where: { id: m[1] },
          select: { email: true, tenantId: true },
        });
        if (rec) { contactEmail = rec.email; tenantId = rec.tenantId; }
      }
      // 2 — fall back to matching the sender against the address book
      if (!contactEmail && from) {
        const c = await this.prisma.emailContact.findFirst({
          where: { email: from },
          select: { email: true, tenantId: true },
        });
        if (c) { contactEmail = c.email; tenantId = c.tenantId; }
      }
      if (!contactEmail) continue;

      const scope = this.scopeKey(tenantId ?? null);
      await this.prisma.emailContact.updateMany({
        where: { scope, email: contactEmail, replied: false },
        data: { replied: true, repliedAt: new Date() },
      }).catch(() => undefined);
      matched++;
      this.logger.log(`reply from ${contactEmail} → follow-up stopped`);

      // Forward it on, so the reply lands in a human's inbox too.
      await this.forwardReply(contactEmail, it).catch(() => undefined);
    }
    return { matched };
  }

  /** Brevo's inbound parsing posts { items: [{ From, To, Subject, RawTextBody, … }] }.
   *  Different providers shape this differently, so be forgiving about it. */
  private inboundItems(payload: unknown): { from: string; to: string; subject: string; text: string }[] {
    const p = payload as Record<string, unknown>;
    const raw = Array.isArray(p?.items) ? p.items : Array.isArray(payload) ? payload : [payload];
    const one = (x: unknown) => {
      const o = (x ?? {}) as Record<string, unknown>;
      const addr = (v: unknown): string => {
        if (typeof v === 'string') return v;
        if (Array.isArray(v)) return v.map(addr).join(', ');
        const oo = (v ?? {}) as Record<string, unknown>;
        return String(oo.Address ?? oo.address ?? oo.email ?? '');
      };
      return {
        from: addr(o.From ?? o.from ?? o.sender),
        to: addr(o.To ?? o.to ?? o.recipient),
        subject: String(o.Subject ?? o.subject ?? ''),
        text: String(o.RawTextBody ?? o.text ?? o.TextBody ?? o.RawHtmlBody ?? ''),
      };
    };
    return raw.map(one).filter((x) => x.from || x.to);
  }

  private async forwardReply(contactEmail: string, it: { from: string; subject: string; text: string }) {
    const [apiKey, senderEmail, senderName, forwardTo] = await Promise.all([
      this.platform.get('brevo_api_key'),
      this.platform.get('brevo_sender_email'),
      this.platform.get('brevo_sender_name'),
      this.platform.get('inbound_forward_to'),
    ]);
    if (!apiKey || !senderEmail || !forwardTo) return;
    await this.notifications.sendEmailRaw({
      tenantId: '',
      channel: NotificationChannel.EMAIL,
      recipient: forwardTo,
      subject: `[Trả lời] ${it.subject || '(no subject)'} — ${contactEmail}`,
      body: `${contactEmail} vừa trả lời email của bạn.\n\n${it.text}`,
      html: `<p style="font-family:Arial;font-size:14px;color:#334155">
               <b>${contactEmail}</b> vừa trả lời email của bạn — hệ thống đã đánh dấu “đã phản hồi” và <b>ngừng gửi nhắc tự động</b> cho người này.
             </p>
             <pre style="font-family:ui-monospace,monospace;font-size:13px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;white-space:pre-wrap">${
               String(it.text).replace(/[<>&]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch] as string))
             }</pre>`,
      brevo: { apiKey, senderEmail, senderName: senderName || 'Lumio', replyTo: it.from || undefined },
      senderName: senderName || 'Lumio',
      replyTo: it.from || undefined,
    });
  }

  /** Bulk "these people answered me" — for replies that arrived before the inbound
   *  domain was set up, or that came in by phone. */
  async markRepliedBulk(tenantId: string | null, raw: string) {
    const { people } = this.parseRecipients(raw || '');
    if (!people.length) throw new BadRequestException('No valid email address in that list.');
    const r = await this.prisma.emailContact.updateMany({
      where: { scope: this.scopeKey(tenantId), email: { in: people.map((p) => p.email) } },
      data: { replied: true, repliedAt: new Date() },
    });
    return { marked: r.count };
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
