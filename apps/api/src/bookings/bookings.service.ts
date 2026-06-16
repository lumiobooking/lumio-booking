import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AppointmentStatus, NotificationChannel, PaymentStatus, Prisma, RejectionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AssignmentService } from '../assignment/assignment.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  BookingTemplateData,
  fill,
  fillPct,
  htmlToText,
  renderBookingEmailHtml,
  renderBookingEmailText,
  renderTemplatedEmailHtml,
} from '../notifications/email-template';
import { SettingsService } from '../settings/settings.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ListBookingsDto } from './dto/list-bookings.dto';
import { addMinutes, parseStartTime, BLOCKING_STATUSES } from './booking.util';

const BOOKING_INCLUDE = {
  customer: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
  service: { select: { id: true, name: true, durationMinutes: true } },
  assignedStaff: { select: { id: true, firstName: true, lastName: true } },
  preferredStaff: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.AppointmentInclude;

// Minimal shape of the Prisma transaction client we rely on (keeps the file
// testable with a lightweight mock).
type Tx = Prisma.TransactionClient;

function fmtTimeOf(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly assignment: AssignmentService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
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
      where: { id: staffId, tenantId, isActive: true },
      select: { id: true },
    });
    if (!staff) {
      throw new BadRequestException('Staff member not found or inactive for this tenant');
    }
  }

  private async upsertCustomer(tx: Tx, tenantId: string, dto: CreateBookingDto) {
    if (dto.customerEmail) {
      const email = dto.customerEmail.toLowerCase();
      return tx.customer.upsert({
        where: { tenantId_email: { tenantId, email } },
        update: {
          firstName: dto.customerFirstName,
          lastName: dto.customerLastName ?? null,
          phone: dto.customerPhone ?? null,
        },
        create: {
          tenantId,
          email,
          firstName: dto.customerFirstName,
          lastName: dto.customerLastName ?? null,
          phone: dto.customerPhone ?? null,
        },
      });
    }
    return tx.customer.create({
      data: {
        tenantId,
        firstName: dto.customerFirstName,
        lastName: dto.customerLastName ?? null,
        phone: dto.customerPhone ?? null,
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
  async createForTenant(tenantId: string, dto: CreateBookingDto, actorUserId: string | null) {
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

    // Totals = discounted service price + add-ons (add-ons are not discounted).
    const addonPrice = addons.reduce((s, a) => s + a.priceCents, 0);
    const addonDuration = addons.reduce((s, a) => s + a.durationMinutes, 0);
    const discountPct = Math.min(90, Math.max(0, service.discountPercent ?? 0));
    const discountedServiceCents = Math.round((service.priceCents * (100 - discountPct)) / 100);
    const totalPrice = discountedServiceCents + addonPrice;
    const totalDuration = service.durationMinutes + addonDuration;

    const start = parseStartTime(dto.startTime);
    if (start.getTime() < Date.now()) {
      throw new BadRequestException('startTime is in the past');
    }
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
          addons: addons as unknown as Prisma.InputJsonValue,
          notes: dto.notes ?? null,
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
      customer: { firstName?: string; email: string | null; phone: string | null } | null;
      service: { name: string } | null;
      assignedStaff?: { firstName: string; lastName: string | null } | null;
    },
  ) {
    const n = await this.settings.getNotificationSettings(tenantId);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, contactEmail: true, contactPhone: true, branding: true },
    });

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
      date: start.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }),
      time: `${fmtTimeOf(start)} – ${fmtTimeOf(end)}`,
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
        const bodyFilled = fillPct(tpl.body, pct); // HTML
        jobs.push(this.notifications.send({
          tenantId, channel: NotificationChannel.EMAIL, recipient: custEmail,
          subject: fillPct(tpl.subject, pct),
          body: htmlToText(bodyFilled),
          html: renderTemplatedEmailHtml({ salon: d.salon, accent: d.accent, contact: d.contact, bodyText: bodyFilled }),
          smtp, brevo, gmail, mailService: n.mailService, senderName, replyTo, ...related,
        }));
      } else {
        const intro = fill(n.emailIntroCustomer, d);
        const footer = fill(n.emailFooter, d);
        jobs.push(this.notifications.send({
          tenantId, channel: NotificationChannel.EMAIL, recipient: custEmail,
          subject: fill(n.emailSubjectCustomer, d),
          body: renderBookingEmailText('Booking confirmed', intro, footer, d),
          html: renderBookingEmailHtml({ heading: 'Booking confirmed', intro, footer, d }),
          smtp, brevo, gmail, mailService: n.mailService, senderName, replyTo, ...related,
        }));
      }
    }
    if (smsCustomer && custPhone) {
      const smsText = tpl ? fillPct(tpl.smsBody, pct) : fill(n.smsCustomer, d);
      jobs.push(this.notifications.send({ tenantId, channel: NotificationChannel.SMS, recipient: custPhone, body: smsText, ...related }));
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
      jobs.push(this.notifications.send({ tenantId, channel: NotificationChannel.SMS, recipient: n.adminPhone, body: fill(n.smsAdmin, d), ...related }));
    }
    await Promise.allSettled(jobs);
  }

  /**
   * Emails the assigned technician about a booking (the `staff_new_booking`
   * template). Fire-and-forget; safe no-op when the staff has no email or the
   * template is disabled. Uses the salon's SMTP connection.
   */
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
      select: { name: true, contactEmail: true, contactPhone: true, branding: true },
    });

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
      appointment_date: start.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }),
      appointment_time: `${fmtTimeOf(start)} – ${fmtTimeOf(end)}`,
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
        addons: {
          where: { isActive: true },
          select: { id: true, name: true, durationMinutes: true, priceCents: true, currency: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
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
      where: { tenantId, isActive: true, staffServices: { some: { serviceId } } },
    });
    const eligible = await this.prisma.staffMember.findMany({
      where: {
        tenantId,
        isActive: true,
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

  /** Active staff for a tenant, with avatar + the services they can perform. */
  publicStaff(tenantId: string) {
    return this.prisma.staffMember.findMany({
      where: { tenantId, isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        staffServices: { select: { serviceId: true } },
      },
      orderBy: { firstName: 'asc' },
    });
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
    await this.getById(user, id);
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
    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: 'booking.cancelled',
      resourceType: 'appointment',
      resourceId: id,
    });
    return this.getById(user, id);
  }

  complete(user: AuthenticatedUser, id: string) {
    return this.transition(user, id, AppointmentStatus.COMPLETED, 'booking.completed', 'completedAt');
  }

  noShow(user: AuthenticatedUser, id: string) {
    return this.transition(user, id, AppointmentStatus.NO_SHOW, 'booking.no_show', 'updatedAt');
  }

  /** Permanently delete a booking (admin cleanup). Payments are kept (unlinked). */
  async remove(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    await this.getById(user, id); // 404 + tenant ownership
    await this.prisma.appointment.deleteMany({ where: { id, tenantId } });
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
