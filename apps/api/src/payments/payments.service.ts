import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus, PaymentType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentProvider } from './providers/payment-provider.interface';
import { createPaymentProvider } from './providers/payment-provider.factory';

@Injectable()
export class PaymentsService {
  private readonly provider: PaymentProvider = createPaymentProvider();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly loyalty: LoyaltyService,
  ) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  list(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    return this.prisma.payment.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /**
   * Salon Admin: create a payment for a booking (tenant from the JWT).
   */
  createForBooking(user: AuthenticatedUser, dto: CreatePaymentDto) {
    return this.createForBookingTenant(this.tenantId(user), dto.appointmentId, dto.type, user.userId);
  }

  /**
   * Core: create a payment for a booking, scoped to an explicit tenantId. Used
   * by the admin flow and the public (online booking link) flow. PAY_ONLINE
   * attempts an immediate charge via the provider (mock) and is marked
   * PAID/FAILED; PAY_LATER is recorded PENDING for in-salon settlement.
   */
  async createForBookingTenant(
    tenantId: string,
    appointmentId: string,
    type: PaymentType,
    actorUserId: string | null,
  ) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId },
      select: { id: true, priceCents: true, currency: true },
    });
    if (!appointment) {
      throw new NotFoundException('Booking not found');
    }

    let status: PaymentStatus = PaymentStatus.PENDING;
    let providerReference: string | null = null;
    let paidAt: Date | null = null;

    if (type === PaymentType.PAY_ONLINE) {
      const result = await this.provider.charge({
        amountCents: appointment.priceCents,
        currency: appointment.currency,
        reference: appointment.id,
        description: `Booking ${appointment.id}`,
      });
      status = result.success ? PaymentStatus.PAID : PaymentStatus.FAILED;
      providerReference = result.providerReference ?? null;
      paidAt = result.success ? new Date() : null;
    }

    const payment = await this.prisma.payment.create({
      data: {
        tenantId,
        appointmentId: appointment.id,
        amountCents: appointment.priceCents,
        currency: appointment.currency,
        type,
        status,
        provider: this.provider.name,
        providerReference,
        paidAt,
      },
    });

    await this.audit.log({
      tenantId,
      userId: actorUserId,
      action: 'payment.created',
      resourceType: 'payment',
      resourceId: payment.id,
      metadata: { appointmentId: appointment.id, type, status, source: actorUserId ? 'admin' : 'public' },
    });

    return payment;
  }

  /** Settle a PAY_LATER (or retry) payment as PAID. */
  async markPaid(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const existing = await this.prisma.payment.findFirst({
      where: { id, tenantId },
      select: { id: true, status: true, amountCents: true, appointment: { select: { customerId: true } } },
    });
    if (!existing) {
      throw new NotFoundException('Payment not found');
    }
    await this.prisma.payment.updateMany({
      where: { id, tenantId },
      data: { status: PaymentStatus.PAID, paidAt: new Date() },
    });
    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: 'payment.marked_paid',
      resourceType: 'payment',
      resourceId: id,
    });
    // Award loyalty points to the booking's customer (only on the PENDING→PAID transition).
    if (existing.status !== PaymentStatus.PAID && existing.appointment?.customerId) {
      await this.loyalty.award(this.prisma, tenantId, existing.appointment.customerId, existing.amountCents, 'appointment', id);
    }
    return this.prisma.payment.findFirst({ where: { id, tenantId } });
  }

  /**
   * Auto-settle money when a booking is marked Complete (fewer clicks for the salon).
   * Balance-aware so it works with partial deposits:
   *  - mark any PENDING payment PAID (+ loyalty),
   *  - then if the total PAID so far is still less than the booking price (e.g. only
   *    a deposit was taken), record a PAID "balance at salon" payment for the rest
   *    (+ loyalty on the rest) — UNLESS a paid POS order already covers it.
   * Never charges No-show/Cancel — those don't call this.
   */
  async settleOnComplete(tenantId: string, appointmentId: string, actorUserId: string | null) {
    const appt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId },
      select: { id: true, priceCents: true, currency: true, customerId: true },
    });
    if (!appt) return;

    const pays = await this.prisma.payment.findMany({ where: { tenantId, appointmentId }, select: { id: true, status: true, amountCents: true } });
    let paidSoFar = pays.filter((p) => p.status === PaymentStatus.PAID).reduce((s, p) => s + p.amountCents, 0);

    // 1) Any PENDING (pay-at-salon) becomes PAID now (+ loyalty per payment).
    for (const p of pays.filter((x) => x.status === PaymentStatus.PENDING)) {
      await this.prisma.payment.updateMany({ where: { id: p.id, tenantId }, data: { status: PaymentStatus.PAID, paidAt: new Date() } });
      await this.audit.log({ tenantId, userId: actorUserId, action: 'payment.marked_paid', resourceType: 'payment', resourceId: p.id, metadata: { via: 'complete' } });
      if (appt.customerId) await this.loyalty.award(this.prisma, tenantId, appt.customerId, p.amountCents, 'appointment', p.id);
      paidSoFar += p.amountCents;
    }

    if (paidSoFar >= appt.priceCents) return; // fully covered (incl. deposit + balance)

    // A paid POS order may already cover the rest — don't double-charge.
    const paidOrder = await this.prisma.order.count({ where: { tenantId, appointmentId, status: 'PAID' } });
    if (paidOrder > 0) return;

    // 2) Collect the remaining balance as an at-salon payment.
    const remainder = appt.priceCents - paidSoFar;
    if (remainder <= 0) return;
    const payment = await this.prisma.payment.create({
      data: {
        tenantId, appointmentId: appt.id, amountCents: remainder, currency: appt.currency,
        type: PaymentType.PAY_LATER, status: PaymentStatus.PAID, provider: this.provider.name, paidAt: new Date(),
      },
    });
    await this.audit.log({ tenantId, userId: actorUserId, action: 'payment.created', resourceType: 'payment', resourceId: payment.id, metadata: { appointmentId: appt.id, status: 'PAID', source: 'complete', balance: true } });
    if (appt.customerId) await this.loyalty.award(this.prisma, tenantId, appt.customerId, remainder, 'appointment', payment.id);
  }

  /** Required deposit (cents) for a booking, per the salon's deposit policy + customer history. */
  async requiredDeposit(tenantId: string, customerId: string | null, priceCents: number, d: { enabled: boolean; type: 'percent' | 'fixed'; percent: number; fixedCents: number; scope: 'all' | 'new' | 'repeat_noshow'; noShowThreshold: number }): Promise<number> {
    if (!d.enabled || priceCents <= 0) return 0;
    if (customerId) {
      if (d.scope === 'new') {
        const prior = await this.prisma.appointment.count({ where: { tenantId, customerId, status: 'COMPLETED' } });
        if (prior > 0) return 0;
      } else if (d.scope === 'repeat_noshow') {
        const ns = await this.prisma.appointment.count({ where: { tenantId, customerId, status: 'NO_SHOW' } });
        if (ns < (d.noShowThreshold ?? 2)) return 0;
      }
    }
    const cents = d.type === 'fixed' ? d.fixedCents : Math.round((priceCents * d.percent) / 100);
    return Math.min(Math.max(0, cents), priceCents);
  }

  /** Take a partial DEPOSIT online for a booking (runs through the PaymentProvider). */
  async createDepositForBookingTenant(tenantId: string, appointmentId: string, amountCents: number, actorUserId: string | null) {
    const appt = await this.prisma.appointment.findFirst({ where: { id: appointmentId, tenantId }, select: { id: true, currency: true, customerId: true } });
    if (!appt) throw new NotFoundException('Booking not found');
    const result = await this.provider.charge({ amountCents, currency: appt.currency, reference: appt.id, description: `Deposit ${appt.id}` });
    const payment = await this.prisma.payment.create({
      data: {
        tenantId, appointmentId: appt.id, amountCents, currency: appt.currency,
        type: PaymentType.PAY_ONLINE, status: result.success ? PaymentStatus.PAID : PaymentStatus.FAILED,
        provider: this.provider.name, providerReference: result.providerReference ?? null, paidAt: result.success ? new Date() : null,
      },
    });
    await this.audit.log({ tenantId, userId: actorUserId, action: 'payment.deposit', resourceType: 'payment', resourceId: payment.id, metadata: { appointmentId: appt.id, amountCents, status: payment.status } });
    if (result.success && appt.customerId) await this.loyalty.award(this.prisma, tenantId, appt.customerId, amountCents, 'appointment', payment.id);
    return payment;
  }

  /** Permanently delete a payment record (admin cleanup of stray/orphaned rows). */
  async remove(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const existing = await this.prisma.payment.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!existing) throw new NotFoundException('Payment not found');
    await this.prisma.payment.deleteMany({ where: { id, tenantId } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'payment.deleted', resourceType: 'payment', resourceId: id });
    return { id, deleted: true };
  }
}
