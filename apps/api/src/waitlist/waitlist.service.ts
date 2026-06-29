import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationChannel, TenantStatus, WaitlistStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';

interface JoinDto { customerName: string; phone?: string; email?: string; serviceId?: string; preferredDate?: string; note?: string }

@Injectable()
export class WaitlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  /** Public: a customer joins the waitlist for a salon (by slug). */
  async joinBySlug(slug: string, dto: JoinDto) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug, deletedAt: null, status: TenantStatus.ACTIVE },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Salon not found');
    const name = (dto.customerName ?? '').trim();
    if (!name) throw new BadRequestException('Please enter your name.');
    if (!dto.phone && !dto.email) throw new BadRequestException('Please give a phone or email so we can reach you.');
    const svc = dto.serviceId
      ? await this.prisma.service.findFirst({ where: { id: dto.serviceId, tenantId: tenant.id }, select: { id: true } })
      : null;
    await this.prisma.waitlistEntry.create({
      data: {
        tenantId: tenant.id,
        serviceId: svc?.id ?? null,
        customerName: name.slice(0, 80),
        phone: dto.phone?.slice(0, 40) || null,
        email: dto.email?.slice(0, 120) || null,
        preferredDate: dto.preferredDate?.slice(0, 10) || null,
        note: dto.note?.slice(0, 300) || null,
      },
    });
    return { ok: true };
  }

  /** Salon admin: list waitlist entries (newest first). */
  list(user: AuthenticatedUser) {
    return this.prisma.waitlistEntry.findMany({
      where: { tenantId: this.tenantId(user) },
      include: { service: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  }

  /** Salon admin: tell a waiting customer a slot opened (email + SMS, booking link). */
  async notify(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const e = await this.prisma.waitlistEntry.findFirst({ where: { id, tenantId }, include: { service: { select: { name: true } } } });
    if (!e) throw new NotFoundException('Waitlist entry not found');

    const n = await this.settings.getNotificationSettings(tenantId);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, slug: true, contactPhone: true, contactEmail: true } });
    const salon = tenant?.name ?? 'Our salon';
    const webBase = (process.env.PUBLIC_WEB_URL || process.env.KEEPALIVE_WEB_URL || 'https://lumio-web-1xqk.onrender.com').replace(/\/$/, '');
    const bookUrl = `${webBase}/book/${tenant?.slug ?? ''}`;
    const svc = e.service?.name ? ` for ${e.service.name}` : '';
    const subject = `A spot just opened at ${salon}!`;
    const text = `Hi ${e.customerName}, good news — a spot${svc} just opened up at ${salon}. Book now: ${bookUrl}`;
    const html = `<p>Hi ${e.customerName},</p><p>Good news — a spot${svc} just opened up at <strong>${salon}</strong>.</p><p style="margin:16px 0"><a href="${bookUrl}" style="background:#16a34a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600">Book your spot</a></p><p style="color:#64748b;font-size:13px">First to book gets it — these fill fast!</p>`;
    const smsText = `${salon}: a spot${svc} just opened! Book now: ${bookUrl}. Reply STOP to opt out.`;

    const senderName = n.senderName || salon;
    const replyTo = n.replyTo || n.senderEmail || undefined;
    const smtp = n.smtp.user && n.smtp.pass
      ? { host: n.smtp.host, port: n.smtp.port, user: n.smtp.user, pass: n.smtp.pass, secure: n.smtp.secure, replyTo: n.replyTo || undefined, from: `${senderName} <${n.senderEmail || n.smtp.user}>` }
      : undefined;
    const brevo = n.brevo.apiKey && n.senderEmail
      ? { apiKey: n.brevo.apiKey, senderEmail: n.senderEmail, replyTo: n.replyTo || undefined, senderName: n.brevo.senderName || senderName }
      : undefined;
    const gmail = n.gmail.clientId && n.gmail.clientSecret && n.gmail.refreshToken && n.gmail.senderEmail
      ? { clientId: n.gmail.clientId, clientSecret: n.gmail.clientSecret, refreshToken: n.gmail.refreshToken, senderEmail: n.gmail.senderEmail, senderName, replyTo }
      : undefined;
    const related = { relatedType: 'waitlist', relatedId: e.id };

    const jobs: Promise<unknown>[] = [];
    if (e.email) jobs.push(this.notifications.send({ tenantId, channel: NotificationChannel.EMAIL, recipient: e.email, subject, body: text, html, smtp, brevo, gmail, mailService: n.mailService, senderName, replyTo, ...related }));
    if (e.phone) jobs.push(this.notifications.send({ tenantId, channel: NotificationChannel.SMS, recipient: e.phone, body: smsText, ...related }));
    await Promise.allSettled(jobs);

    await this.prisma.waitlistEntry.updateMany({ where: { id, tenantId }, data: { status: WaitlistStatus.NOTIFIED, notifiedAt: new Date() } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'waitlist.notified', resourceType: 'waitlist', resourceId: id });
    return { ok: true };
  }

  /** Salon admin: change an entry's status (e.g. mark Converted). */
  async setStatus(user: AuthenticatedUser, id: string, status: string) {
    const tenantId = this.tenantId(user);
    const valid = ['WAITING', 'NOTIFIED', 'CONVERTED', 'CANCELLED'];
    if (!valid.includes(status)) throw new BadRequestException('Invalid status');
    const e = await this.prisma.waitlistEntry.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!e) throw new NotFoundException('Waitlist entry not found');
    await this.prisma.waitlistEntry.updateMany({ where: { id, tenantId }, data: { status: status as WaitlistStatus } });
    return { ok: true };
  }

  /** Salon admin: delete an entry. */
  async remove(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    await this.prisma.waitlistEntry.deleteMany({ where: { id, tenantId } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'waitlist.deleted', resourceType: 'waitlist', resourceId: id });
    return { ok: true };
  }
}
