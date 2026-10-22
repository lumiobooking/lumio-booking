import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PartyDeposit, partyDepositCents } from './party-deposit';
import { PaymentStatus, PaymentType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentProvider } from './providers/payment-provider.interface';
import { createPaymentProvider } from './providers/payment-provider.factory';
import { PaymentOrchestrator } from '../payments-hub/payment-orchestrator.service';
import { isOnlineProvider } from '../payments-hub/online-providers';
import { allocateRefund } from '../bookings/deposit-policy';

@Injectable()
export class PaymentsService {
  private readonly provider: PaymentProvider = createPaymentProvider();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly loyalty: LoyaltyService,
    // Real refunds of money taken online. Optional so the unit tests build it bare.
    @Optional() private readonly hub?: PaymentOrchestrator,
  ) {}

  private readonly log = new Logger('PaymentsService');

  /**
   * The mock provider "charges" anything. On a real deploy that is a payment
   * recorded as made that never was — so in production a mock charge is never
   * PAID: it stays PENDING (payable at the salon).
   */
  private mockForbidden(): boolean {
    return this.provider.name === 'mock' && process.env.NODE_ENV === 'production';
  }

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

    if (type === PaymentType.PAY_ONLINE && !this.mockForbidden()) {
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
    // Paid at the till already: the ticket is the money; touching the booking's
    // pay-at-salon rows here would count the visit twice.
    const coveredByTicket = await this.prisma.order.count({ where: { tenantId, status: 'PAID', OR: [{ appointmentId }, { appointmentIds: { has: appointmentId } }] } as never });
    if (coveredByTicket > 0) return;

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
    const paidOrder = await this.prisma.order.count({ where: { tenantId, status: 'PAID', OR: [{ appointmentId }, { appointmentIds: { has: appointmentId } }] } as never });
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

  /**
   * Undo settleOnComplete when a finished booking is reopened: the at-salon
   * money goes back to PENDING (so it leaves revenue) and the points it earned
   * are taken back. Pressing Complete again re-collects and re-awards.
   *
   * Only PAY_LATER payments are touched — an online/deposit charge really was
   * taken from the customer, and a POS order is settled on its own ticket.
   */
  async unsettleOnUncomplete(tenantId: string, appointmentId: string, actorUserId: string | null) {
    const pays = await this.prisma.payment.findMany({
      // The till's rows (providerReference order:<id>) belong to its ticket, which stays paid.
      where: { tenantId, appointmentId, status: PaymentStatus.PAID, type: PaymentType.PAY_LATER, OR: [{ providerReference: null }, { NOT: { providerReference: { startsWith: 'order:' } } }] },
      select: { id: true },
    });
    for (const p of pays) {
      await this.prisma.payment.updateMany({
        where: { id: p.id, tenantId },
        data: { status: PaymentStatus.PENDING, paidAt: null },
      });
      await this.loyalty.reverseForRef(this.prisma, tenantId, 'appointment', p.id, 'Booking reopened');
      await this.audit.log({
        tenantId, userId: actorUserId, action: 'payment.unsettled',
        resourceType: 'payment', resourceId: p.id, metadata: { appointmentId, via: 'reopen' },
      });
    }
    return pays.length;
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

  /**
   * The deposit a booking needs: the salon's deposit rule, or the per-guest
   * party deposit (payments/party-deposit.ts), whichever is larger. The ONE
   * place the amount is decided, so booking, online checkout and confirm agree.
   */
  async depositFor(
    tenantId: string,
    appt: { customerId: string | null; priceCents: number; partySize?: number | null },
    d: Parameters<PaymentsService['requiredDeposit']>[3],
    party: PartyDeposit,
  ): Promise<number> {
    const base = await this.requiredDeposit(tenantId, appt.customerId, appt.priceCents, d);
    return Math.max(base, partyDepositCents(appt.partySize, party));
  }

  /** Take a partial DEPOSIT online for a booking (runs through the PaymentProvider). */
  async createDepositForBookingTenant(tenantId: string, appointmentId: string, amountCents: number, actorUserId: string | null) {
    const appt = await this.prisma.appointment.findFirst({ where: { id: appointmentId, tenantId }, select: { id: true, currency: true, customerId: true } });
    if (!appt) throw new NotFoundException('Booking not found');
    // Production never records a mock deposit as paid (see mockForbidden).
    const result = this.mockForbidden()
      ? { success: false, providerReference: null as string | null }
      : await this.provider.charge({ amountCents, currency: appt.currency, reference: appt.id, description: `Deposit ${appt.id}` });
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

  /**
   * The customer chose to pay the whole visit online, on a salon with a real
   * online provider: a PENDING row says so, the hosted checkout charges the
   * price, and the confirm turns this very row PAID. Nothing is charged here.
   */
  async markPayOnlinePending(tenantId: string, appointmentId: string, provider: string) {
    const appt = await this.prisma.appointment.findFirst({ where: { id: appointmentId, tenantId }, select: { id: true, priceCents: true, currency: true } });
    if (!appt) throw new NotFoundException('Booking not found');
    return this.prisma.payment.create({
      data: { tenantId, appointmentId: appt.id, amountCents: appt.priceCents, currency: appt.currency, type: PaymentType.PAY_ONLINE, status: PaymentStatus.PENDING, provider },
    });
  }

  /**
   * Give `refundCents` of what was PAID on a booking back. Money taken online
   * goes back through the provider that took it — for real; a row is marked
   * REFUNDED only when the provider accepted the refund. A row refunded in
   * part is split: what stays (PAID) and what went back (REFUNDED). Anything
   * that was not taken online (old mock rows) is only re-labelled, as before.
   */
  async refundPaid(tenantId: string, appointmentId: string, refundCents: number): Promise<{ refundedCents: number; failed: { provider: string; amountCents: number; error: string }[] }> {
    const rows = await this.prisma.payment.findMany({ where: { tenantId, appointmentId, status: PaymentStatus.PAID } });
    const plan = allocateRefund(rows.map((r) => ({ id: r.id, amountCents: r.amountCents })), refundCents);
    let refundedCents = 0;
    const failed: { provider: string; amountCents: number; error: string }[] = [];
    for (const step of plan) {
      const row = rows.find((r) => r.id === step.id);
      if (!row) continue;
      const online = row.type === PaymentType.PAY_ONLINE && isOnlineProvider(row.provider);
      if (online) {
        const res = this.hub
          ? await this.hub.onlineRefund(tenantId, row.provider, { transactionId: row.providerReference, reference: appointmentId, amountCents: step.refundCents, currency: row.currency })
          : { ok: false, error: 'Payment hub not available' };
        if (!res.ok) {
          failed.push({ provider: row.provider, amountCents: step.refundCents, error: res.error ?? 'Refund failed' });
          await this.audit.log({ tenantId, userId: null, action: 'payment.refund_failed', resourceType: 'payment', resourceId: row.id, metadata: { appointmentId, amountCents: step.refundCents, provider: row.provider, error: res.error ?? null } });
          continue;
        }
      }
      if (step.whole) {
        await this.prisma.payment.updateMany({ where: { id: row.id, tenantId }, data: { status: PaymentStatus.REFUNDED } });
      } else {
        await this.prisma.payment.updateMany({ where: { id: row.id, tenantId }, data: { amountCents: row.amountCents - step.refundCents } });
        await this.prisma.payment.create({
          data: { tenantId, appointmentId, amountCents: step.refundCents, currency: row.currency, type: row.type, status: PaymentStatus.REFUNDED, provider: row.provider, providerReference: row.providerReference, paidAt: row.paidAt },
        });
      }
      refundedCents += step.refundCents;
      await this.audit.log({ tenantId, userId: null, action: 'payment.refunded', resourceType: 'payment', resourceId: row.id, metadata: { appointmentId, amountCents: step.refundCents, provider: row.provider, online } });
    }
    if (failed.length) this.log.warn(`refund failed for ${appointmentId}: ${failed.map((f) => `${f.provider} ${f.error}`).join('; ').slice(0, 300)}`);
    return { refundedCents, failed };
  }

  /** Permanently delete a payment record (admin cleanup of stray/orphaned rows). */
  async remove(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const existing = await this.prisma.payment.findFirst({ where: { id, tenantId }, select: { id: true, status: true } });
    if (!existing) throw new NotFoundException('Payment not found');
    // Money that was taken (or given back) stays in the books: deleting it
    // made revenue disappear with no trace. Only an attempt that never took
    // money (pending, failed) may be cleared away.
    if (existing.status === PaymentStatus.PAID || existing.status === PaymentStatus.REFUNDED) {
      throw new BadRequestException('Khoản đã thu không xoá được — huỷ hoặc hoàn tiền ở Đơn hàng để sổ sách không mất số.');
    }
    await this.prisma.payment.deleteMany({ where: { id, tenantId } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'payment.deleted', resourceType: 'payment', resourceId: id });
    return { id, deleted: true };
  }
}
