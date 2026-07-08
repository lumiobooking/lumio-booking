import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { createHmac } from 'crypto';
import { signingSecret } from '../common/secret.util';
import { publicWebBase } from '../common/public-url.util';
import { AppointmentStatus, NotificationChannel, PaymentStatus, Prisma, RejectionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AssignmentService } from '../assignment/assignment.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  BookingTemplateData,
  ReferralInvite,
  fill,
  fillPct,
  htmlToText,
  referralBlockHtml,
  referralBlockText,
  renderBookingEmailHtml,
  renderBookingEmailText,
  renderTemplatedEmailHtml,
} from '../notifications/email-template';
import { SettingsService } from '../settings/settings.service';
import { ReminderSettings } from '../settings/settings.constants';
import { PaymentsService } from '../payments/payments.service';
import { ReferralService } from '../referral/referral.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ListBookingsDto } from './dto/list-bookings.dto';
import { addMinutes, parseStartTime, BLOCKING_STATUSES } from './booking.util';

const BOOKING_INCLUDE = {
  customer: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
  service: { select: { id: true, name: true, durationMinutes: true } },
  assignedStaff: { select: { id: true, firstName: true, lastName: true } },
  preferredStaff: { select: { id: true, firstName: true, lastName: true } },
  // Lightweight payment summary so the calendar/list can show "paid / unpaid".
  payments: { select: { status: true, amountCents: true } },
} satisfies Prisma.AppointmentInclude;

// Minimal shape of the Prisma transaction client we rely on (keeps the file
// testable with a lightweight mock).
type Tx = Prisma.TransactionClient;

function fmtTimeOf(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Same rule as the booking form: digits/()+-. only, 8–15 digits. */
function isValidPhoneNumber(v: string): boolean {
  const digits = v.replace(/\D/g, '');
  return /^\+?[0-9\s().-]+$/.test(v) && digits.length >= 8 && digits.length <= 15;
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly assignment: AssignmentService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly payments: PaymentsService,
    private readonly referral: ReferralService,
  ) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) {
      throw new NotFoundException('No tenant context');
    }
    return id;
  }

  /**
   * Throws ConflictException if the staff member already has a blocking
   * appointment overlapping [start, end). Half-open intervals: existingStart <
   * newEnd AND existingEnd > newStart.
   */
  private async assertNoOverlap(
    tx: Tx,
    tenantId: string,
    staffId: string,
    start: Date,
    end: Date,
    ignoreAppointmentId?: string,
  ): Promise<void> {
    const conflict = await tx.appointment.findFirst({
      where: {
        tenantId,
        assignedStaffId: staffId,
        status: { in: BLOCKING_STATUSES },
        startTime: { lt: end },
        endTime: { gt: start },
        ...(ignoreAppointmentId ? { id: { not: ignoreAppointmentId } } : {}),
      },
      select: { id: true },
    });
    if (conflict) {
      throw new ConflictException('Staff member is already booked for this time slot');
    }
  }

  /**
   * Serialize concurrent bookings for the same (tenant, staff) so two requests
   * cannot both pass the overlap check and double-book. The transaction-scoped
   * advisory lock is released automatically when the transaction ends.
   */
  private lockStaffSlot(tx: Tx, tenantId: string, staffId: string) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:${staffId}`}))`;
  }

  private async assertStaffActive(tenantId: string, staffId: string) {
    const staff = await this.prisma.staffMember.findFirst({
      where: { id: staffId, tenantId, isActive: true, takesAppointments: true },
      select: { id: true },
    });
    if (!staff) {
      throw new BadRequestException('Staff member not found or not bookable for this tenant');
    }
  }

  /**
   * Best promo % a service gets on the booking's date: the HIGHER of the
   * recurring weekday-discount rules and the specific-date rules (a sale on exact
   * dates / date ranges), matched by the service's category. Returns 0 when
   * nothing applies. Read straight from the settings rows to avoid a cross-module
   * dependency.
   */
  private async promoDiscountPercent(tenantId: string, start: Date, categoryId: string | null): Promise<number> {
    try {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
      const tz = tenant?.timezone || 'UTC';
      const [wdRow, dtRow] = await Promise.all([
        this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: 'weekday_discounts' } } }),
        this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: 'date_discounts' } } }),
      ]);
      let best = 0;

      // Recurring weekday rules (matched by salon-local weekday).
      const wd = wdRow?.value as { enabled?: boolean; rules?: Array<{ day: number; categoryId: string | null; percent: number }> } | undefined;
      if (wd?.enabled && Array.isArray(wd.rules)) {
        const wdName = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(start);
        const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        const weekday = map[wdName] ?? start.getDay();
        for (const r of wd.rules) {
          if (r.day !== weekday) continue;
          if (r.categoryId && r.categoryId !== categoryId) continue;
          if (r.percent > best) best = r.percent;
        }
      }

      // Specific-date rules (exact dates / ranges) — take the higher of the two.
      const dt = dtRow?.value as { enabled?: boolean; rules?: Array<{ startDate: string; endDate: string | null; categoryId: string | null; percent: number }> } | undefined;
      if (dt?.enabled && Array.isArray(dt.rules)) {
        const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(start);
        for (const r of dt.rules) {
          if (!r?.startDate) continue;
          if (r.categoryId && r.categoryId !== categoryId) continue;
          const end = r.endDate || r.startDate;
          if (r.startDate <= localDate && localDate <= end && r.percent > best) best = r.percent;
        }
      }

      return Math.min(90, Math.max(0, best));
    } catch {
      return 0;
    }
  }

  private async upsertCustomer(tx: Tx, tenantId: string, dto: CreateBookingDto) {
    // Only ever upgrade consent to true (never silently revoke a prior opt-in
    // just because a returning customer left the box unchecked this time).
    const consent = dto.smsConsent === true ? { smsConsent: true, smsConsentAt: new Date() } : {};
    // Optional birthday the customer shared. Only set it when given (and valid) —
    // a returning customer who leaves it blank keeps the birthday we already have.
    const birth = (() => {
      if (!dto.customerBirthDate) return undefined;
      const d = new Date(dto.customerBirthDate);
      return isNaN(d.getTime()) ? undefined : d;
    })();
    const birthData = birth ? { birthDate: birth } : {};
    // Referral attribution applies to NEW customers only (the `create` branches),
    // so a returning customer is never re-attributed.
    const referredById = await this.referral.resolveReferrerId(tx, tenantId, dto.referralCode);
    const referredBy = referredById ? { referredById } : {};
    if (dto.customerEmail) {
      const email = dto.customerEmail.toLowerCase();
      return tx.customer.upsert({
        where: { tenantId_email: { tenantId, email } },
        update: {
          firstName: dto.customerFirstName,
          lastName: dto.customerLastName ?? null,
          phone: dto.customerPhone ?? null,
          ...consent,
          ...birthData,
        },
        create: {
          tenantId,
          email,
          firstName: dto.customerFirstName,
          lastName: dto.customerLastName ?? null,
          phone: dto.customerPhone ?? null,
          ...consent,
          ...birthData,
          ...referredBy,
        },
      });
    }
    return tx.customer.create({
      data: {
        tenantId,
        firstName: dto.customerFirstName,
        lastName: dto.customerLastName ?? null,
        phone: dto.customerPhone ?? null,
        ...consent,
        ...birthData,
        ...referredBy,
      },
    });
  }

  // Salon Admin create (tenant from the JWT).
  create(user: AuthenticatedUser, dto: CreateBookingDto) {
    return this.createForTenant(this.tenantId(user), dto, user.userId);
  }

  /**
   * Core booking creation, scoped to an explicit tenantId. Used both by the
   * Salon Admin flow and by the public/WordPress flow (where the tenant comes
   * from the API key, not a logged-in user). Race-safe when a staff is given.
   */
  async createForTenant(tenantId: string, dto: CreateBookingDto, actorUserId: string | null, source?: string) {
    // Contact rules. Online (public) customer bookings MUST include a phone number
    // — it is the salon's primary way to reach the client and it cuts down on spam
    // bookings. Admin-created bookings only need at least one contact (email OR
    // phone) so staff aren't blocked. Receiving marketing texts is never required
    // (that opt-in is separate), so requiring a phone stays TCPA-compliant.
    const contactEmail = dto.customerEmail?.trim();
    const contactPhone = dto.customerPhone?.trim();
    const isPublicBooking = actorUserId === null;
    if (isPublicBooking) {
      if (!contactPhone) {
        throw new BadRequestException('A phone number is required to book.');
      }
    } else if (!contactEmail && !contactPhone) {
      throw new BadRequestException('Please provide an email address or a phone number.');
    }
    if (contactPhone && !isValidPhoneNumber(contactPhone)) {
      throw new BadRequestException('Please enter a valid phone number (8–15 digits).');
    }

    const service = await this.prisma.service.findFirst({
      where: { id: dto.serviceId, tenantId, isActive: true },
    });
    if (!service) {
      throw new NotFoundException('Service not found or inactive');
    }

    // Validate + load selected add-ons (must belong to this service & tenant).
    const addonIds = [...new Set(dto.addonIds ?? [])];
    const addons = addonIds.length
      ? await this.prisma.serviceAddon.findMany({
          where: { id: { in: addonIds }, serviceId: service.id, tenantId, isActive: true },
          select: { id: true, name: true, priceCents: true, durationMinutes: true },
        })
      : [];
    if (addons.length !== addonIds.length) {
      throw new BadRequestException('One or more add-ons are invalid for this service');
    }

    const start = parseStartTime(dto.startTime);
    if (start.getTime() < Date.now()) {
      throw new BadRequestException('startTime is in the past');
    }

    // ---- Pricing ----
    const addonPrice = addons.reduce((s, a) => s + a.priceCents, 0);
    const addonDuration = addons.reduce((s, a) => s + a.durationMinutes, 0);

    // Primary service: its own discount, then the weekday promo for its category.
    const primaryDisc = Math.min(90, Math.max(0, service.discountPercent ?? 0));
    const primaryNet = Math.round((service.priceCents * (100 - primaryDisc)) / 100);
    const primaryWd = await this.promoDiscountPercent(tenantId, start, service.categoryId);
    const primaryFinal = Math.round((primaryNet * (100 - primaryWd)) / 100);

    // Extra services in the SAME visit (multi-service). The first service stays
    // the primary (in serviceId); the rest become priced line items. Each gets
    // its own service discount + the weekday promo for its own category.
    const extraIds = [...new Set(dto.serviceIds ?? [])].filter((id) => id && id !== service.id);
    const extraServices = extraIds.length
      ? await this.prisma.service.findMany({ where: { id: { in: extraIds }, tenantId, isActive: true } })
      : [];
    const extraItems: { id: string; name: string; priceCents: number; durationMinutes: number; kind: 'service' }[] = [];
    for (const s of extraServices) {
      const disc = Math.min(90, Math.max(0, s.discountPercent ?? 0));
      const net = Math.round((s.priceCents * (100 - disc)) / 100);
      const wd = await this.promoDiscountPercent(tenantId, start, s.categoryId);
      extraItems.push({ id: s.id, name: s.name, priceCents: Math.round((net * (100 - wd)) / 100), durationMinutes: s.durationMinutes, kind: 'service' });
    }
    const extraPrice = extraItems.reduce((sum, x) => sum + x.priceCents, 0);
    const extraDuration = extraItems.reduce((sum, x) => sum + x.durationMinutes, 0);

    const totalDuration = service.durationMinutes + extraDuration + addonDuration;
    const totalPrice = primaryFinal + extraPrice + addonPrice;
    // Snapshot stored on the appointment: extra services first, then add-ons.
    const lineItems = [...extraItems, ...addons];
    const end = addMinutes(start, totalDuration);

    if (dto.staffId) {
      await this.assertStaffActive(tenantId, dto.staffId);
    }

    const appointment = await this.prisma.$transaction(async (tx) => {
      const customer = await this.upsertCustomer(tx, tenantId, dto);

      if (dto.staffId) {
        await this.lockStaffSlot(tx, tenantId, dto.staffId);
        await this.assertNoOverlap(tx, tenantId, dto.staffId, start, end);
      }

      return tx.appointment.create({
        data: {
          tenantId,
          customerId: customer.id,
          serviceId: service.id,
          assignedStaffId: dto.staffId ?? null,
          preferredStaffId: dto.preferredStaffId ?? dto.staffId ?? null,
          status: dto.staffId ? AppointmentStatus.ASSIGNED : AppointmentStatus.PENDING,
          startTime: start,
          endTime: end,
          priceCents: totalPrice,
          currency: service.currency,
          addons: lineItems as unknown as Prisma.InputJsonValue,
          notes: dto.notes ?? null,
          source: source ?? (actorUserId ? 'admin' : 'online'),
          partySize: dto.partySize ?? 1,
          assignedAt: dto.staffId ? new Date() : null,
          responseDeadline: dto.staffId ? addMinutes(new Date(), 30) : null,
        },
        include: BOOKING_INCLUDE,
      });
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'booking.created',
      resourceType: 'appointment',
      resourceId: appointment.id,
      metadata: {
        serviceId: service.id,
        startTime: start.toISOString(),
        staffId: dto.staffId,
        source: actorUserId ? 'admin' : 'public',
      },
    });

    // Fire-and-forget confirmation; never block/fail the booking on it.
    this.sendBookingConfirmation(tenantId, appointment).catch(() => undefined);
    // If a technician was assigned at creation, email them too.
    if (appointment.assignedStaffId) {
      this.sendStaffAssignmentEmail(tenantId, appointment.id).catch(() => undefined);
    }

    return appointment;
  }

  /**
   * Notifies the customer and/or the salon admin about a new booking with a
   * polished, branded HTML email and/or SMS, using the salon's templates.
   */
  private async sendBookingConfirmation(
    tenantId: string,
    appointment: {
      id: string;
      startTime: Date;
      endTime: Date;
      priceCents: number;
      currency: string;
      addons?: unknown;
      customer: { id?: string; firstName?: string; email: string | null; phone: string | null } | null;
      service: { name: string } | null;
      assignedStaff?: { firstName: string; lastName: string | null } | null;
    },
  ) {
    const n = await this.settings.getNotificationSettings(tenantId);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, contactEmail: true, contactPhone: true, branding: true, timezone: true },
    });

    const tz = tenant?.timezone || 'America/New_York';
    const fmtT = (dd: Date) => dd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
    const fmtD = (dd: Date) => dd.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric', timeZone: tz });
    const start = appointment.startTime;
    const end = appointment.endTime;
    const durationMin = Math.round((end.getTime() - start.getTime()) / 60_000);
    const addonNames = Array.isArray(appointment.addons)
      ? (appointment.addons as { name?: string }[]).map((a) => a.name).filter(Boolean).join(', ')
      : '';
    let total: string;
    try {
      total = new Intl.NumberFormat('en-US', { style: 'currency', currency: appointment.currency }).format(appointment.priceCents / 100);
    } catch {
      total = `${(appointment.priceCents / 100).toFixed(2)} ${appointment.currency}`;
    }

    const d: BookingTemplateData = {
      salon: tenant?.name ?? 'Our salon',
      customer: appointment.customer?.firstName ?? 'there',
      service: appointment.service?.name ?? 'your appointment',
      date: fmtD(start),
      time: `${fmtT(start)} – ${fmtT(end)}`,
      technician: appointment.assignedStaff ? `${appointment.assignedStaff.firstName} ${appointment.assignedStaff.lastName ?? ''}`.trim() : 'To be assigned',
      total,
      duration: `${durationMin} min`,
      addons: addonNames,
      accent: this.settings.brandingFrom(tenant?.branding).accentColor,
      contact: tenant?.contactEmail ?? tenant?.contactPhone ?? '',
    };

    const custEmail = appointment.customer?.email;
    const custPhone = appointment.customer?.phone;
    const related = { relatedType: 'appointment', relatedId: appointment.id };
    // Self-service link so the customer can view / confirm / cancel without login.
    const manageUrl = `${publicWebBase()}/appt/${this.apptToken(appointment.id)}`;

    // Refer-a-friend invite in the confirmation email — only when the program is
    // ON. Best-effort: any failure here must never block the confirmation.
    let referralBlock: ReferralInvite | null = null;
    try {
      const custId = appointment.customer?.id;
      if (custId) {
        const rs = await this.referral.getForTenant(tenantId);
        if (rs.enabled) {
          const linked = await this.referral.ensureLinkForCustomer(tenantId, custId);
          if (linked) {
            const parts: string[] = [];
            if (rs.referrerPoints > 0) parts.push(`you'll earn ${rs.referrerPoints} points`);
            if (rs.refereePoints > 0) parts.push(`they'll get ${rs.refereePoints} to start`);
            const sub = parts.length
              ? `Share your personal link. When a friend books their first visit, ${parts.join(' and ')}.`
              : 'Share your personal link with friends who would love this salon.';
            referralBlock = { link: linked.link, headline: `Love ${d.salon}? Refer a friend`, sub };
          }
        }
      }
    } catch {
      // referral invite is optional — ignore and send the confirmation anyway
    }
    const smtp =
      n.smtp.user && n.smtp.pass
        ? { host: n.smtp.host, port: n.smtp.port, user: n.smtp.user, pass: n.smtp.pass, secure: n.smtp.secure, replyTo: n.replyTo || undefined, from: `${n.senderName || d.salon} <${n.senderEmail || n.smtp.user}>` }
        : undefined;
    const brevo =
      n.brevo.apiKey && n.senderEmail
        ? { apiKey: n.brevo.apiKey, senderEmail: n.senderEmail, replyTo: n.replyTo || undefined, senderName: n.brevo.senderName || n.senderName || d.salon }
        : undefined;
    // Used when sending via the platform email (Auto): show the SALON's name and
    // route replies to the salon, so the customer never sees a generic sender.
    const senderName = n.senderName || d.salon;
    const replyTo = n.replyTo || n.senderEmail || undefined;
    const gmail =
      n.gmail.clientId && n.gmail.clientSecret && n.gmail.refreshToken && n.gmail.senderEmail
        ? { clientId: n.gmail.clientId, clientSecret: n.gmail.clientSecret, refreshToken: n.gmail.refreshToken, senderEmail: n.gmail.senderEmail, senderName, replyTo }
        : undefined;

    const jobs: Promise<unknown>[] = [];

    // The "booking confirmed" customer message is driven by the editable template
    // catalog when that event is enabled; otherwise we fall back to the legacy
    // inline templates in NotificationSettings.
    const templates = await this.settings.getNotificationTemplates(tenantId);
    const confirmTpl = templates['customer_booking_confirmed'];
    // Narrowable nullable: when present + enabled, drive the message from it.
    const tpl = confirmTpl && confirmTpl.enabled ? confirmTpl : null;
    const pct: Record<string, string> = {
      salon_name: d.salon,
      customer_name: d.customer,
      service_name: d.service,
      staff_name: d.technician,
      appointment_date: d.date,
      appointment_time: d.time,
      duration: d.duration,
      total_price: d.total,
      add_ons: d.addons,
      salon_contact: d.contact,
      booking_id: appointment.id,
    };

    const emailCustomer = tpl ? tpl.email : n.emailCustomerOnBooking;
    const smsCustomer = tpl ? tpl.sms : n.smsCustomerOnBooking;

    if (emailCustomer && custEmail) {
      if (tpl) {
        const refHtml = referralBlock ? referralBlockHtml(referralBlock, d.accent) : '';
        const manageHtml = `<p style="margin:16px 0 0"><a href="${manageUrl}" style="color:${d.accent};font-weight:600">Manage or cancel your appointment →</a></p>`;
        const bodyFilled = fillPct(tpl.body, pct) + manageHtml + refHtml; // HTML
        jobs.push(this.notifications.send({
          tenantId, channel: NotificationChannel.EMAIL, recipient: custEmail,
          subject: fillPct(tpl.subject, pct),
          body: htmlToText(bodyFilled),
          html: renderTemplatedEmailHtml({ salon: d.salon, accent: d.accent, contact: d.contact, bodyText: bodyFilled }),
          smtp, brevo, gmail, mailService: n.mailService, senderName, replyTo, ...related,
        }));
      } else {
        const intro = fill(n.emailIntroCustomer, d);
        const footer = `${fill(n.emailFooter, d)}\n\nManage or cancel your appointment: ${manageUrl}`;
        jobs.push(this.notifications.send({
          tenantId, channel: NotificationChannel.EMAIL, recipient: custEmail,
          subject: fill(n.emailSubjectCustomer, d),
          body: renderBookingEmailText('Booking confirmed', intro, footer, d, referralBlock),
          html: renderBookingEmailHtml({ heading: 'Booking confirmed', intro, footer, d, referral: referralBlock }),
          smtp, brevo, gmail, mailService: n.mailService, senderName, replyTo, ...related,
        }));
      }
    }
    if (smsCustomer && custPhone) {
      const smsText = `${tpl ? fillPct(tpl.smsBody, pct) : fill(n.smsCustomer, d)}\nManage/cancel: ${manageUrl}`;
      jobs.push(this.notifications.send({ tenantId, channel: NotificationChannel.SMS, recipient: custPhone, body: smsText, twilio: n.twilio, ...related }));
    }
    // Admin notification: who gets it = the Admin email, falling back to the
    // sender email so the salon is never left un-notified.
    const adminTo = n.adminEmail || n.senderEmail || n.gmail.senderEmail || '';
    if (n.emailAdminOnBooking && adminTo) {
      const intro = fill(n.emailIntroAdmin, d);
      jobs.push(this.notifications.send({
        tenantId, channel: NotificationChannel.EMAIL, recipient: adminTo,
        subject: fill(n.emailSubjectAdmin, d),
        body: renderBookingEmailText('New booking', intro, '', d),
        html: renderBookingEmailHtml({ heading: 'New booking', intro, footer: '', d }),
        smtp, brevo, gmail, mailService: n.mailService, senderName, replyTo, ...related,
      }));
    }
    if (n.smsAdminOnBooking && n.adminPhone) {
      jobs.push(this.notifications.send({ tenantId, channel: NotificationChannel.SMS, recipient: n.adminPhone, body: fill(n.smsAdmin, d), twilio: n.twilio, ...related }));
    }
    await Promise.allSettled(jobs);
  }

  /**
   * Emails the assigned technician about a booking (the `staff_new_booking`
   * template). Fire-and-forget; safe no-op when the staff has no email or the
   * template is disabled. Uses the salon's SMTP connection.
   */
  /**
   * Scan upcoming appointments and send any due automated reminders (no-show
   * reduction). Safe to call repeatedly: each window's reminder fires at most
   * once (guarded by remind1SentAt / remind2SentAt). Only runs for salons that
   * have turned reminders ON. Called on an interval by ReminderService.
   */
  async processDueReminders(): Promise<{ sent: number }> {
    const now = new Date();
    const maxAhead = new Date(now.getTime() + 26 * 3600 * 1000);
    const appts = await this.prisma.appointment.findMany({
      where: {
        status: { in: [AppointmentStatus.ASSIGNED, AppointmentStatus.ACCEPTED, AppointmentStatus.CONFIRMED, AppointmentStatus.PENDING] },
        startTime: { gt: now, lt: maxAhead },
        OR: [{ remind1SentAt: null }, { remind2SentAt: null }],
      },
      include: {
        customer: { select: { id: true, firstName: true, email: true, phone: true } },
        service: { select: { name: true } },
        assignedStaff: { select: { firstName: true, lastName: true } },
      },
      take: 300,
    });
    if (appts.length === 0) return { sent: 0 };

    const cache = new Map<string, ReminderSettings>();
    let sent = 0;
    for (const a of appts) {
      let rs = cache.get(a.tenantId);
      if (!rs) { rs = await this.settings.getReminderSettings(a.tenantId); cache.set(a.tenantId, rs); }
      if (!rs.enabled) continue;
      const hoursToStart = (a.startTime.getTime() - now.getTime()) / 3_600_000;
      // Earlier reminder: between the two windows (so a last-minute booking gets
      // only the later one, not both at once).
      if (!a.remind1SentAt && rs.hoursBefore1 > 0 && hoursToStart <= rs.hoursBefore1 && hoursToStart > rs.hoursBefore2) {
        await this.sendReminderFor(a.tenantId, a, rs).catch(() => undefined);
        await this.prisma.appointment.updateMany({ where: { id: a.id, tenantId: a.tenantId }, data: { remind1SentAt: new Date() } });
        sent++;
      } else if (!a.remind2SentAt && rs.hoursBefore2 > 0 && hoursToStart <= rs.hoursBefore2) {
        await this.sendReminderFor(a.tenantId, a, rs).catch(() => undefined);
        await this.prisma.appointment.updateMany({ where: { id: a.id, tenantId: a.tenantId }, data: { remind2SentAt: new Date() } });
        sent++;
      }
    }
    return { sent };
  }

  /** Send a single reminder (email + SMS, per the salon's reminder channels). */
  private async sendReminderFor(
    tenantId: string,
    appt: { id: string; startTime: Date; customer: { id?: string; firstName: string | null; email: string | null; phone: string | null } | null; service: { name: string } | null },
    rs: ReminderSettings,
  ) {
    const custEmail = appt.customer?.email;
    const custPhone = appt.customer?.phone;
    if (!custEmail && !custPhone) return;
    const n = await this.settings.getNotificationSettings(tenantId);
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, contactEmail: true, contactPhone: true, timezone: true } });
    const tz = tenant?.timezone || 'America/New_York';
    const fmtT = (dd: Date) => dd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
    const fmtD = (dd: Date) => dd.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', timeZone: tz });
    const salon = tenant?.name ?? 'Our salon';
    const cust = appt.customer?.firstName ?? 'there';
    const svc = appt.service?.name ?? 'your appointment';
    const when = `${fmtD(appt.startTime)} at ${fmtT(appt.startTime)}`;
    const contact = tenant?.contactPhone || tenant?.contactEmail || '';
    // One-tap self-service link (Confirm / Cancel) — no login needed.
    const actionUrl = `${publicWebBase()}/appt/${this.apptToken(appt.id)}`;
    const subject = `Reminder: your ${svc} at ${salon} — ${when}`;
    const text = `Hi ${cust}, a friendly reminder of your ${svc} at ${salon} on ${when}. Confirm or cancel: ${actionUrl}` + (contact ? ` — or call ${contact}.` : '') + ' See you soon!';
    const html = `<p>Hi ${cust},</p><p>This is a friendly reminder of your <strong>${svc}</strong> at <strong>${salon}</strong>:</p><p style="font-size:16px"><strong>${when}</strong></p>`
      + `<p style="margin:18px 0"><a href="${actionUrl}" style="background:#16a34a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;margin-right:8px">✓ Confirm</a> <a href="${actionUrl}" style="background:#fff;color:#dc2626;border:1px solid #dc2626;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Can't make it?</a></p>`
      + (contact ? `<p style="color:#64748b;font-size:13px">Or call us at ${contact}.</p>` : '') + '<p>See you soon! 💅</p>';
    const smsText = `${salon}: reminder — ${svc} on ${when}. Confirm/cancel: ${actionUrl}. Reply STOP to opt out.`;

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
    const related = { relatedType: 'appointment', relatedId: appt.id };

    // Refer-a-friend footer — EMAIL ONLY (never the SMS, which stays transactional
    // to keep 10DLC/toll-free traffic clean). Best-effort + only when the program is on.
    let refHtml = '';
    let refText = '';
    try {
      const custId = appt.customer?.id;
      if (custId) {
        const refs = await this.referral.getForTenant(tenantId);
        if (refs.enabled) {
          const linked = await this.referral.ensureLinkForCustomer(tenantId, custId);
          if (linked) {
            const parts: string[] = [];
            if (refs.referrerPoints > 0) parts.push(`you'll earn ${refs.referrerPoints} points`);
            if (refs.refereePoints > 0) parts.push(`they'll get ${refs.refereePoints} to start`);
            const sub = parts.length
              ? `Share your personal link. When a friend books their first visit, ${parts.join(' and ')}.`
              : 'Share your personal link with friends who would love this salon.';
            const invite = { link: linked.link, headline: `Love ${salon}? Refer a friend`, sub };
            refHtml = referralBlockHtml(invite, '#4f46e5');
            refText = `\n\n${referralBlockText(invite)}`;
          }
        }
      }
    } catch { /* referral is optional — never block a reminder */ }

    const jobs: Promise<unknown>[] = [];
    if (rs.channelEmail && custEmail) {
      jobs.push(this.notifications.send({ tenantId, channel: NotificationChannel.EMAIL, recipient: custEmail, subject, body: text + refText, html: html + refHtml, smtp, brevo, gmail, mailService: n.mailService, senderName, replyTo, ...related }));
    }
    if (rs.channelSms && custPhone) {
      jobs.push(this.notifications.send({ tenantId, channel: NotificationChannel.SMS, recipient: custPhone, body: smsText, twilio: n.twilio, ...related }));
    }
    await Promise.allSettled(jobs);
  }

  private async sendStaffAssignmentEmail(tenantId: string, appointmentId: string) {
    const appt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId },
      select: {
        id: true, startTime: true, endTime: true, priceCents: true, currency: true, addons: true,
        customer: { select: { firstName: true, lastName: true } },
        service: { select: { name: true } },
        assignedStaff: {
          select: { firstName: true, lastName: true, email: true, user: { select: { email: true } } },
        },
      },
    });
    if (!appt || !appt.assignedStaff) return;
    const staffEmail = appt.assignedStaff.email || appt.assignedStaff.user?.email;
    if (!staffEmail) return;

    const templates = await this.settings.getNotificationTemplates(tenantId);
    const tpl = templates['staff_new_booking'];
    if (!tpl || !tpl.enabled || !tpl.email) return;

    const n = await this.settings.getNotificationSettings(tenantId);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, contactEmail: true, contactPhone: true, branding: true, timezone: true },
    });

    const tz = tenant?.timezone || 'America/New_York';
    const fmtT = (dd: Date) => dd.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
    const fmtD = (dd: Date) => dd.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric', timeZone: tz });
    const start = appt.startTime;
    const end = appt.endTime;
    const durationMin = Math.round((end.getTime() - start.getTime()) / 60_000);
    const addonNames = Array.isArray(appt.addons)
      ? (appt.addons as { name?: string }[]).map((a) => a.name).filter(Boolean).join(', ')
      : '';
    let total: string;
    try {
      total = new Intl.NumberFormat('en-US', { style: 'currency', currency: appt.currency }).format(appt.priceCents / 100);
    } catch {
      total = `${(appt.priceCents / 100).toFixed(2)} ${appt.currency}`;
    }
    const salon = tenant?.name ?? 'Our salon';
    const accent = this.settings.brandingFrom(tenant?.branding).accentColor;
    const contact = tenant?.contactEmail ?? tenant?.contactPhone ?? '';
    const customerName = `${appt.customer?.firstName ?? ''} ${appt.customer?.lastName ?? ''}`.trim() || 'A customer';
    const staffName = `${appt.assignedStaff.firstName} ${appt.assignedStaff.lastName ?? ''}`.trim();

    const pct: Record<string, string> = {
      salon_name: salon,
      customer_name: customerName,
      service_name: appt.service?.name ?? 'a service',
      staff_name: staffName,
      appointment_date: fmtD(start),
      appointment_time: `${fmtT(start)} – ${fmtT(end)}`,
      duration: `${durationMin} min`,
      total_price: total,
      add_ons: addonNames,
      salon_contact: contact,
      booking_id: appt.id,
    };

    const smtp =
      n.smtp.user && n.smtp.pass
        ? { host: n.smtp.host, port: n.smtp.port, user: n.smtp.user, pass: n.smtp.pass, secure: n.smtp.secure, replyTo: n.replyTo || undefined, from: `${n.senderName || salon} <${n.senderEmail || n.smtp.user}>` }
        : undefined;
    const brevo =
      n.brevo.apiKey && n.senderEmail
        ? { apiKey: n.brevo.apiKey, senderEmail: n.senderEmail, replyTo: n.replyTo || undefined, senderName: n.brevo.senderName || n.senderName || salon }
        : undefined;
    const gmail =
      n.gmail.clientId && n.gmail.clientSecret && n.gmail.refreshToken && n.gmail.senderEmail
        ? { clientId: n.gmail.clientId, clientSecret: n.gmail.clientSecret, refreshToken: n.gmail.refreshToken, senderEmail: n.gmail.senderEmail, senderName: n.senderName || salon, replyTo: n.replyTo || n.senderEmail || undefined }
        : undefined;

    const bodyFilled = fillPct(tpl.body, pct);
    await this.notifications.send({
      tenantId,
      channel: NotificationChannel.EMAIL,
      recipient: staffEmail,
      subject: fillPct(tpl.subject, pct),
      body: htmlToText(bodyFilled),
      html: renderTemplatedEmailHtml({ salon, accent, contact, bodyText: bodyFilled }),
      smtp,
      brevo,
      gmail,
      mailService: n.mailService,
      senderName: n.senderName || salon,
      replyTo: n.replyTo || n.senderEmail || undefined,
      relatedType: 'appointment',
      relatedId: appt.id,
    });
  }

  /** Active services for a tenant, with their active add-ons (public flow). */
  publicServices(tenantId: string) {
    return this.prisma.service.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        name: true,
        description: true,
        durationMinutes: true,
        priceCents: true,
        discountPercent: true,
        currency: true,
        categoryId: true,
        isFeatured: true,
        priceFrom: true,
        sortOrder: true,
        addons: {
          where: { isActive: true },
          select: { id: true, name: true, durationMinutes: true, priceCents: true, currency: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /** Active menu categories for the public booking page (ordered). */
  publicCategories(tenantId: string) {
    return this.prisma.serviceCategory.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true, icon: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Availability for the public booking page: which technicians can do this
   * service, and each one's already-booked (blocking) time ranges around the
   * given date — so the UI can grey out slots a technician is already taken.
   */
  async publicAvailability(tenantId: string, serviceId: string, dateStr: string) {
    // Skills are an OPTIONAL restriction. If at least one technician is explicitly
    // linked to this service, only those are eligible; if NONE are linked (service
    // left unconfigured), every active technician can perform it — otherwise an
    // unconfigured service would block all bookings.
    const linkedCount = await this.prisma.staffMember.count({
      where: { tenantId, isActive: true, takesAppointments: true, staffServices: { some: { serviceId } } },
    });
    const eligible = await this.prisma.staffMember.findMany({
      where: {
        tenantId,
        isActive: true,
        takesAppointments: true,
        ...(linkedCount > 0 ? { staffServices: { some: { serviceId } } } : {}),
      },
      select: { id: true },
    });
    const ids = eligible.map((s) => s.id);
    if (ids.length === 0) {
      return { eligibleStaffIds: [], staffBusy: {} as Record<string, { start: string; end: string }[]> };
    }

    // Wide window around the date so we catch the whole local day regardless of
    // timezone; the frontend does exact overlap by absolute time.
    const day = new Date(`${dateStr}T00:00:00`);
    const from = new Date(day.getTime() - 24 * 3_600_000);
    const to = new Date(day.getTime() + 48 * 3_600_000);

    const appts = await this.prisma.appointment.findMany({
      where: {
        tenantId,
        assignedStaffId: { in: ids },
        status: { in: BLOCKING_STATUSES },
        startTime: { lt: to },
        endTime: { gt: from },
      },
      select: { assignedStaffId: true, startTime: true, endTime: true },
    });

    const staffBusy: Record<string, { start: string; end: string }[]> = {};
    for (const id of ids) staffBusy[id] = [];
    for (const a of appts) {
      if (a.assignedStaffId) {
        staffBusy[a.assignedStaffId].push({ start: a.startTime.toISOString(), end: a.endTime.toISOString() });
      }
    }
    return { eligibleStaffIds: ids, staffBusy };
  }

  /**
   * Active staff for a tenant, ordered FAIRLY for the booking page:
   *  1) Admin-pinned staff first (bookingPriority > 0, highest first).
   *  2) Everyone else by a WEIGHTED RANDOM shuffle — more reward points gives
   *     better odds of a top spot, but base weight + randomness guarantee every
   *     technician still gets a fair chance to appear first on each visit.
   * This rotates exposure so walk-in/"first choice" bookings spread across the
   * team, while still rewarding high performers and honoring admin priority.
   */
  async publicStaff(tenantId: string) {
    const staff = await this.prisma.staffMember.findMany({
      where: { tenantId, isActive: true, takesAppointments: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        bookingPriority: true,
        rewardPoints: true,
        staffServices: { select: { serviceId: true } },
      },
    });

    const pinned = staff.filter((s) => (s.bookingPriority ?? 0) > 0)
      .sort((a, b) => (b.bookingPriority ?? 0) - (a.bookingPriority ?? 0));

    // Weighted random: weight = 1 + capped points bonus (max ~4x). Each render
    // gives a fresh random key so the order rotates fairly per customer/visit.
    const auto = staff.filter((s) => (s.bookingPriority ?? 0) <= 0)
      .map((s) => {
        const weight = 1 + Math.min(s.rewardPoints ?? 0, 300) / 100; // 1x → 4x
        return { s, key: Math.random() * weight };
      })
      .sort((a, b) => b.key - a.key)
      .map((x) => x.s);

    // Strip the internal ordering fields before returning to the public.
    return [...pinned, ...auto].map(({ bookingPriority, rewardPoints, ...rest }) => rest);
  }

  async list(user: AuthenticatedUser, filters: ListBookingsDto) {
    const tenantId = this.tenantId(user);
    const where: Prisma.AppointmentWhereInput = { tenantId };
    if (filters.status) where.status = filters.status;
    if (filters.staffId) where.assignedStaffId = filters.staffId;
    if (filters.from || filters.to) {
      where.startTime = {};
      if (filters.from) where.startTime.gte = new Date(filters.from);
      if (filters.to) where.startTime.lte = new Date(filters.to);
    }
    return this.prisma.appointment.findMany({
      where,
      include: BOOKING_INCLUDE,
      orderBy: { startTime: 'asc' },
    });
  }

  async getById(user: AuthenticatedUser, id: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id, tenantId: this.tenantId(user) },
      include: BOOKING_INCLUDE,
    });
    if (!appointment) {
      throw new NotFoundException('Booking not found');
    }
    return appointment;
  }

  /** Assign (or re-assign) a booking to a staff member, race-safe. */
  async assign(user: AuthenticatedUser, id: string, staffId: string) {
    const tenantId = this.tenantId(user);
    const booking = await this.getById(user, id);
    await this.assertStaffActive(tenantId, staffId);

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockStaffSlot(tx, tenantId, staffId);
      await this.assertNoOverlap(tx, tenantId, staffId, booking.startTime, booking.endTime, id);
      await tx.appointment.updateMany({
        where: { id, tenantId },
        data: {
          assignedStaffId: staffId,
          status: AppointmentStatus.ASSIGNED,
          assignedAt: new Date(),
          responseDeadline: addMinutes(new Date(), 30),
          rejectedAt: null,
        },
      });
      return tx.appointment.findFirst({ where: { id, tenantId }, include: BOOKING_INCLUDE });
    });

    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: 'booking.assigned',
      resourceType: 'appointment',
      resourceId: id,
      metadata: { staffId },
    });

    // Notify the assigned technician (fire-and-forget).
    this.sendStaffAssignmentEmail(tenantId, id).catch(() => undefined);

    return updated;
  }

  /** Status transitions that don't need slot locking. */
  private async transition(
    user: AuthenticatedUser,
    id: string,
    status: AppointmentStatus,
    action: string,
    timestampField: keyof Prisma.AppointmentUpdateInput,
  ) {
    const tenantId = this.tenantId(user);
    await this.getById(user, id);
    await this.prisma.appointment.updateMany({
      where: { id, tenantId },
      data: { status, [timestampField]: new Date() },
    });
    await this.audit.log({
      tenantId,
      userId: user.userId,
      action,
      resourceType: 'appointment',
      resourceId: id,
    });
    return this.getById(user, id);
  }

  /**
   * Cancel a booking AND settle its money so it never inflates revenue:
   *  - already-collected (PAID) -> REFUNDED (drops out of revenue)
   *  - not-yet-collected (PENDING) -> FAILED (voided, can't be marked paid)
   * (No-show keeps its money — that path uses noShow(), not cancel().)
   */
  async cancel(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    await this.getById(user, id); // enforces tenant ownership / 404
    return this.cancelForTenant(tenantId, id, user.userId);
  }

  /** Cancel + settle money, scoped to a tenant (admin or token-based customer cancel). */
  async cancelForTenant(tenantId: string, id: string, actorUserId: string | null) {
    await this.prisma.$transaction(async (tx) => {
      await tx.appointment.updateMany({
        where: { id, tenantId },
        data: { status: AppointmentStatus.CANCELLED, cancelledAt: new Date() },
      });
      await tx.payment.updateMany({
        where: { tenantId, appointmentId: id, status: PaymentStatus.PAID },
        data: { status: PaymentStatus.REFUNDED },
      });
      await tx.payment.updateMany({
        where: { tenantId, appointmentId: id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.FAILED },
      });
    });
    await this.audit.log({ tenantId, userId: actorUserId, action: 'booking.cancelled', resourceType: 'appointment', resourceId: id });
    return this.prisma.appointment.findFirst({ where: { id, tenantId }, include: BOOKING_INCLUDE });
  }

  // ---- Customer self-service via signed reminder links (no login) ----------

  private apptToken(appointmentId: string): string {
    const payload = Buffer.from(JSON.stringify({ a: appointmentId, exp: Date.now() + 30 * 86400 * 1000 })).toString('base64url');
    const sig = createHmac('sha256', signingSecret()).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }

  /** Public signed self-service URL for an appointment (view / confirm / cancel,
   *  no login). Used by confirmations and the Messenger bot. */
  buildApptManageUrl(appointmentId: string): string {
    return `${publicWebBase()}/appt/${this.apptToken(appointmentId)}`;
  }

  private verifyApptToken(token: string): string | null {
    const [payload, sig] = (token || '').split('.');
    if (!payload || !sig) return null;
    const expect = createHmac('sha256', signingSecret()).update(payload).digest('base64url');
    if (sig !== expect) return null;
    try {
      const d = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { a: string; exp: number };
      if (!d.exp || Date.now() > d.exp) return null;
      return d.a;
    } catch {
      return null;
    }
  }

  private static readonly ACTIONABLE: AppointmentStatus[] = [AppointmentStatus.PENDING, AppointmentStatus.ASSIGNED, AppointmentStatus.ACCEPTED, AppointmentStatus.CONFIRMED];

  /** Appointment summary for the customer self-service page (token-authenticated). */
  async apptSummaryByToken(token: string) {
    const id = this.verifyApptToken(token);
    if (!id) throw new NotFoundException('This link has expired or is invalid.');
    const a = await this.prisma.appointment.findUnique({
      where: { id },
      include: { service: { select: { name: true } }, tenant: { select: { name: true, slug: true, timezone: true, branding: true } }, customer: { select: { id: true, firstName: true } } },
    });
    if (!a) throw new NotFoundException('Appointment not found');
    const tz = a.tenant?.timezone || 'America/New_York';
    // Referral: when the program is on, surface THIS customer's own share link so
    // they can invite friends straight from their appointment page. Purely a
    // bonus — never let it break the page.
    let referral: { link: string; message: string; referrerPoints: number; refereePoints: number } | null = null;
    try {
      if (a.customer?.id) {
        const s = await this.referral.getForTenant(a.tenantId);
        if (s.enabled) {
          const l = await this.referral.ensureLinkForCustomer(a.tenantId, a.customer.id);
          if (l) referral = { link: l.link, message: s.message, referrerPoints: s.referrerPoints, refereePoints: s.refereePoints };
        }
      }
    } catch { /* ignore — referral is optional */ }
    return {
      salon: a.tenant?.name ?? 'Our salon',
      slug: a.tenant?.slug ?? '',
      service: a.service?.name ?? 'your appointment',
      customer: a.customer?.firstName ?? 'there',
      date: a.startTime.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz }),
      time: a.startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }),
      status: a.status,
      confirmed: !!a.customerConfirmedAt,
      canAct: BookingsService.ACTIONABLE.includes(a.status),
      referral,
    };
  }

  /** Customer taps "Confirm" in a reminder. */
  async confirmByToken(token: string) {
    const id = this.verifyApptToken(token);
    if (!id) throw new NotFoundException('This link has expired or is invalid.');
    const a = await this.prisma.appointment.findUnique({ where: { id }, select: { id: true, tenantId: true, status: true } });
    if (!a) throw new NotFoundException('Appointment not found');
    if (!BookingsService.ACTIONABLE.includes(a.status)) return { ok: false, status: a.status };
    await this.prisma.appointment.update({ where: { id }, data: { customerConfirmedAt: new Date(), status: AppointmentStatus.CONFIRMED, confirmedAt: new Date() } });
    await this.audit.log({ tenantId: a.tenantId, userId: null, action: 'booking.customer_confirmed', resourceType: 'appointment', resourceId: id });
    return { ok: true, status: AppointmentStatus.CONFIRMED };
  }

  /** Customer taps "Cancel" in a reminder. */
  async cancelByToken(token: string) {
    const id = this.verifyApptToken(token);
    if (!id) throw new NotFoundException('This link has expired or is invalid.');
    const a = await this.prisma.appointment.findUnique({ where: { id }, select: { id: true, tenantId: true, status: true } });
    if (!a) throw new NotFoundException('Appointment not found');
    if (!BookingsService.ACTIONABLE.includes(a.status)) return { ok: false, status: a.status };
    await this.cancelForTenant(a.tenantId, id, null);
    return { ok: true, status: AppointmentStatus.CANCELLED };
  }

  async complete(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const result = await this.transition(user, id, AppointmentStatus.COMPLETED, 'booking.completed', 'completedAt');
    // Completing a visit means the money was collected — settle payment automatically.
    await this.payments.settleOnComplete(tenantId, id, user.userId);
    // Referral reward: if this customer was referred, reward both on their first
    // completed visit (no-op otherwise; never throws).
    const appt = await this.prisma.appointment.findFirst({ where: { id, tenantId }, select: { customerId: true } });
    await this.referral.rewardOnCompletion(tenantId, appt?.customerId, id);
    return result;
  }

  noShow(user: AuthenticatedUser, id: string) {
    return this.transition(user, id, AppointmentStatus.NO_SHOW, 'booking.no_show', 'updatedAt');
  }

  /** Front desk marks the customer as checked-in (in the salon). */
  async arrive(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const a = await this.prisma.appointment.findFirst({ where: { id, tenantId }, select: { status: true } });
    if (!a) throw new NotFoundException('Booking not found');
    if (!BookingsService.ACTIONABLE.includes(a.status)) {
      throw new BadRequestException('Only an upcoming booking can be checked in.');
    }
    return this.transition(user, id, AppointmentStatus.ARRIVED, 'booking.arrived', 'arrivedAt');
  }

  /**
   * Permanently delete a booking (admin cleanup). Its payments are deleted too so
   * the booking's revenue is removed from reports (no orphaned PAID rows left).
   */
  async remove(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    await this.getById(user, id); // 404 + tenant ownership
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.deleteMany({ where: { tenantId, appointmentId: id } });
      await tx.appointment.deleteMany({ where: { id, tenantId } });
    });
    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: 'booking.deleted',
      resourceType: 'appointment',
      resourceId: id,
    });
    return { id, deleted: true };
  }

  // =========================================================================
  // Step 7: staff accept/reject workflow + assignment engine integration
  // =========================================================================

  /** Resolves the StaffMember linked to a STAFF user account (or throws). */
  private async staffMemberIdForUser(user: AuthenticatedUser): Promise<string> {
    const tenantId = this.tenantId(user);
    const staff = await this.prisma.staffMember.findFirst({
      where: { tenantId, userId: user.userId },
      select: { id: true },
    });
    if (!staff) {
      throw new ForbiddenException('No staff profile is linked to this account');
    }
    return staff.id;
  }

  /** Bookings assigned to the signed-in staff member (their work queue). */
  async listMyAssignments(user: AuthenticatedUser, filters: ListBookingsDto) {
    const tenantId = this.tenantId(user);
    const staffId = await this.staffMemberIdForUser(user);
    const where: Prisma.AppointmentWhereInput = { tenantId, assignedStaffId: staffId };
    if (filters.status) where.status = filters.status;
    if (filters.from || filters.to) {
      where.startTime = {};
      if (filters.from) where.startTime.gte = new Date(filters.from);
      if (filters.to) where.startTime.lte = new Date(filters.to);
    }
    return this.prisma.appointment.findMany({
      where,
      include: BOOKING_INCLUDE,
      orderBy: { startTime: 'asc' },
    });
  }

  /** Staff accepts a booking that is assigned to them. */
  async accept(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const staffId = await this.staffMemberIdForUser(user);
    const booking = await this.getById(user, id);

    if (booking.assignedStaffId !== staffId) {
      throw new ForbiddenException('This booking is not assigned to you');
    }
    if (booking.status !== AppointmentStatus.ASSIGNED) {
      throw new BadRequestException(`Cannot accept a booking in status ${booking.status}`);
    }

    await this.prisma.appointment.updateMany({
      where: { id, tenantId },
      data: { status: AppointmentStatus.ACCEPTED, acceptedAt: new Date() },
    });
    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: 'booking.accepted',
      resourceType: 'appointment',
      resourceId: id,
      metadata: { staffId },
    });
    return this.getById(user, id);
  }

  /**
   * Staff rejects a booking assigned to them. The rejection is recorded and the
   * engine tries to reassign to the next best staff (excluding everyone who has
   * already rejected this booking). If nobody qualifies the booking returns to
   * PENDING for manual handling.
   */
  async reject(user: AuthenticatedUser, id: string, reason?: string) {
    const tenantId = this.tenantId(user);
    const staffId = await this.staffMemberIdForUser(user);
    const booking = await this.getById(user, id);

    if (booking.assignedStaffId !== staffId) {
      throw new ForbiddenException('This booking is not assigned to you');
    }
    if (booking.status !== AppointmentStatus.ASSIGNED) {
      throw new BadRequestException(`Cannot reject a booking in status ${booking.status}`);
    }

    await this.prisma.bookingRejection.create({
      data: {
        tenantId,
        appointmentId: id,
        staffMemberId: staffId,
        type: RejectionType.REJECTED,
        reason: reason ?? null,
      },
    });
    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: 'booking.rejected',
      resourceType: 'appointment',
      resourceId: id,
      metadata: { staffId, reason },
    });

    return this.reassign(tenantId, id, user.userId);
  }

  /** Super/Salon admin asks the engine to assign a PENDING booking. */
  async autoAssign(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    await this.getById(user, id); // tenant ownership / 404
    return this.reassign(tenantId, id, user.userId);
  }

  /**
   * Auto-assign for the public booking flow (no acting user). Runs the engine
   * (fair round-robin + skill/availability/history rules) for a tenant booking.
   */
  autoAssignForTenant(tenantId: string, bookingId: string) {
    return this.reassign(tenantId, bookingId, null);
  }

  /**
   * Core reassignment: ask the engine for the best eligible staff (excluding
   * everyone already in this booking's rejection log) and assign them race-safe,
   * or fall back to PENDING/unassigned.
   */
  private async reassign(tenantId: string, id: string, actorUserId: string | null) {
    const booking = await this.prisma.appointment.findFirst({
      where: { id, tenantId },
      select: { id: true, serviceId: true, startTime: true, endTime: true, preferredStaffId: true },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    const rejecters = await this.prisma.bookingRejection.findMany({
      where: { tenantId, appointmentId: id },
      select: { staffMemberId: true },
    });
    const excludeStaffIds = [...new Set(rejecters.map((r) => r.staffMemberId))];

    const { orderedStaffIds } = await this.assignment.rankEligibleStaff(
      tenantId,
      {
        id: booking.id,
        serviceId: booking.serviceId,
        startTime: booking.startTime,
        endTime: booking.endTime,
        preferredStaffId: booking.preferredStaffId,
      },
      excludeStaffIds,
    );

    const nextStaffId = orderedStaffIds[0] ?? null;

    if (!nextStaffId) {
      // No one available -> leave it PENDING and unassigned for manual handling.
      await this.prisma.appointment.updateMany({
        where: { id, tenantId },
        data: {
          status: AppointmentStatus.PENDING,
          assignedStaffId: null,
          assignedAt: null,
          responseDeadline: null,
        },
      });
      await this.audit.log({
        tenantId,
        userId: actorUserId,
        action: 'booking.unassigned_no_candidate',
        resourceType: 'appointment',
        resourceId: id,
      });
      const result = await this.prisma.appointment.findFirst({
        where: { id, tenantId },
        include: BOOKING_INCLUDE,
      });
      return { reassigned: false, booking: result };
    }

    const assigned = await this.assignStaff(tenantId, booking, nextStaffId, actorUserId);
    return { reassigned: true, booking: assigned };
  }

  /** Race-safe assignment used by reassign / processTimeouts. */
  private async assignStaff(
    tenantId: string,
    booking: { id: string; startTime: Date; endTime: Date },
    staffId: string,
    actorUserId: string | null,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.lockStaffSlot(tx, tenantId, staffId);
      await this.assertNoOverlap(tx, tenantId, staffId, booking.startTime, booking.endTime, booking.id);
      await tx.appointment.updateMany({
        where: { id: booking.id, tenantId },
        data: {
          assignedStaffId: staffId,
          status: AppointmentStatus.ASSIGNED,
          assignedAt: new Date(),
          responseDeadline: addMinutes(new Date(), 30),
          rejectedAt: null,
        },
      });
      return tx.appointment.findFirst({ where: { id: booking.id, tenantId }, include: BOOKING_INCLUDE });
    });
    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'booking.assigned',
      resourceType: 'appointment',
      resourceId: booking.id,
      metadata: { staffId, via: 'engine' },
    });
    // Notify the newly-assigned technician (fire-and-forget).
    this.sendStaffAssignmentEmail(tenantId, booking.id).catch(() => undefined);
    return updated;
  }

  /**
   * Finds ASSIGNED bookings whose response deadline has passed, records a
   * NO_RESPONSE for the silent staff, and reassigns each. In production this is
   * triggered by a scheduled job/queue; for the MVP an admin can call it.
   */
  async processTimeouts(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const now = new Date();
    const expired = await this.prisma.appointment.findMany({
      where: {
        tenantId,
        status: AppointmentStatus.ASSIGNED,
        responseDeadline: { lt: now },
        assignedStaffId: { not: null },
      },
      select: { id: true, assignedStaffId: true },
    });

    let reassigned = 0;
    for (const appt of expired) {
      if (appt.assignedStaffId) {
        await this.prisma.bookingRejection.create({
          data: {
            tenantId,
            appointmentId: appt.id,
            staffMemberId: appt.assignedStaffId,
            type: RejectionType.NO_RESPONSE,
          },
        });
      }
      const result = await this.reassign(tenantId, appt.id, user.userId);
      if (result.reassigned) reassigned += 1;
    }

    return { processed: expired.length, reassigned };
  }
}
