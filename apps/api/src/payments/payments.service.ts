import { Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus, PaymentType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
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
      select: { id: true },
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
    return this.prisma.payment.findFirst({ where: { id, tenantId } });
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
