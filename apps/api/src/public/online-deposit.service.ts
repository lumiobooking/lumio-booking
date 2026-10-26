import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BookingsService } from '../bookings/bookings.service';
import { PaymentsService } from '../payments/payments.service';
import { SettingsService } from '../settings/settings.service';
import { PaymentOrchestrator } from '../payments-hub/payment-orchestrator.service';
import { amountCovers, HOLD_CANCELLABLE, HOLD_REF, holdExpired, holdMinutesOf, RECONCILE_HOURS } from '../payments/deposit-hold';

type Appt = { id: string; priceCents: number; currency: string; customerId: string | null; partySize?: number | null; status?: string };
export type SettleResult = { ok: boolean; alreadyPaid?: boolean; reason?: string; payment?: unknown; refunded?: boolean };

/**
 * A BOOKING'S ONLINE PAYMENT, RECORDED WHEREVER THE NEWS COMES FROM.
 *
 * The provider's word reaches Lumio three ways, and all three land here:
 *  - the customer comes back to the booking / "paid" page (online-confirm);
 *  - the provider's signed webhook (payment-orchestrator → onOnlinePaid);
 *  - a sweep every 2 minutes that asks the provider about every online
 *    payment still open — for the customer who paid and closed the page in a
 *    salon that has not set up the webhook.
 * The same sweep lets a deposit hold run out (payments/deposit-hold.ts): not
 * paid in time → the booking is cancelled, the slot freed, the customer told.
 * Everything is read under the booking's own salon; the amount is always the
 * server's, never the browser's.
 */
@Injectable()
export class OnlineDepositService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('OnlineDeposit');
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly payments: PaymentsService,
    private readonly settings: SettingsService,
    private readonly hub: PaymentOrchestrator,
    @Optional() private readonly audit?: AuditService,
  ) {}

  onModuleInit() {
    this.hub.onOnlinePaid((tenantId, reference) => this.settle(tenantId, reference, 'webhook'));
    const on = (process.env.HOUSEKEEPING_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false')) === 'true';
    if (!on) return;
    this.timer = setInterval(() => { void this.sweep(); }, 120_000);
    this.timer.unref?.();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** The salon's card surcharge on a card-not-present amount (0% leaves it). */
  async withCardSurcharge(tenantId: string, baseCents: number): Promise<number> {
    if (baseCents <= 0) return baseCents;
    const pos = await this.settings.getPosSettings(tenantId).catch(() => null);
    const pct = pos?.cardSurchargePercent ?? 0;
    if (!pos?.cardSurchargeEnabled || !pct || pct <= 0) return baseCents;
    return baseCents + Math.round((baseCents * pct) / 100);
  }

  /** What a booking owes online, decided on the server: the deposit, or the whole price for "pay now". */
  async onlineDue(tenantId: string, appt: Appt): Promise<{ base: number; kind: 'deposit' | 'full' }> {
    const deposit = await this.settings.getDepositSettings(tenantId);
    const dep = await this.payments.depositFor(tenantId, appt, deposit, await this.settings.getPartyDeposit(tenantId));
    if (dep > 0) return { base: dep, kind: 'deposit' };
    const pending = await this.prisma.payment.findFirst({ where: { tenantId, appointmentId: appt.id, type: 'PAY_ONLINE', status: 'PENDING' }, select: { id: true } });
    return pending ? { base: appt.priceCents, kind: 'full' } : { base: 0, kind: 'deposit' };
  }

  /**
   * Ask the provider about this booking's online payment and, when it is paid,
   * record it — once. Paid AFTER the hold ran out (the booking is already
   * cancelled): recorded, then given straight back, so no customer is ever
   * charged for a slot she no longer has.
   */
  async settle(tenantId: string, appointmentId: string, via: 'return' | 'webhook' | 'sweep' = 'return'): Promise<SettleResult> {
    const appt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId },
      select: { id: true, priceCents: true, currency: true, customerId: true, partySize: true, status: true },
    }) as Appt | null;
    if (!appt) return { ok: false, reason: 'not_found' };

    const already = await this.prisma.payment.findFirst({ where: { tenantId, appointmentId: appt.id, status: 'PAID' } });
    if (already) return { ok: true, alreadyPaid: true };

    const res = await this.hub.onlineLookup(tenantId, appt.id);
    if (!res.approved) return { ok: false, reason: 'not_approved' };

    const { base } = await this.onlineDue(tenantId, appt);
    const expected = await this.withCardSurcharge(tenantId, base);
    if (!amountCovers(res.amountCents, expected)) return { ok: false, reason: 'amount_mismatch' };

    // What the provider actually took is what is recorded; the open row the
    // booking left for it (deposit hold or "pay now") is the one filled.
    const amount = res.amountCents ?? expected;
    const open = await this.prisma.payment.findFirst({
      where: { tenantId, appointmentId: appt.id, type: 'PAY_ONLINE', status: { in: ['PENDING', 'FAILED'] } },
      orderBy: { createdAt: 'desc' }, select: { id: true },
    });
    const data = {
      amountCents: amount, currency: appt.currency, type: 'PAY_ONLINE' as const, status: 'PAID' as const, provider: res.provider,
      providerReference: res.transactionId ?? null, paidAt: new Date(),
    };
    const payment = open
      ? await this.prisma.payment.update({ where: { id: open.id }, data })
      : await this.prisma.payment.create({ data: { tenantId, appointmentId: appt.id, ...data } });
    await this.audit?.log({ tenantId, action: 'payment.online_settled', resourceType: 'appointment', resourceId: appt.id, metadata: { via, amountCents: amount, provider: res.provider } });

    if (appt.status === 'CANCELLED') {
      const back = await this.payments.refundPaid(tenantId, appt.id, amount).catch(() => ({ refundedCents: 0, failed: [{ provider: String(res.provider), amountCents: amount, error: 'refund threw' }] }));
      await this.audit?.log({ tenantId, action: 'payment.paid_after_hold', resourceType: 'appointment', resourceId: appt.id, metadata: { amountCents: amount, refundedCents: back.refundedCents, failed: back.failed } });
      return { ok: true, payment, refunded: back.refundedCents > 0 };
    }
    return { ok: true, payment };
  }

  /** Every 2 minutes: settle what was paid, then let the holds that ran out go. */
  async sweep(now = new Date()): Promise<{ settled: number; released: number }> {
    if (this.running) return { settled: 0, released: 0 };
    this.running = true;
    let settled = 0, released = 0;
    try {
      // Open online rows, plus holds released in the last 2 hours (a customer
      // who paid just after her hold ran out gets her money back).
      const open = await this.prisma.payment.findMany({
        where: {
          type: 'PAY_ONLINE', appointmentId: { not: null },
          OR: [
            { status: 'PENDING', createdAt: { gte: new Date(now.getTime() - RECONCILE_HOURS * 3_600_000) } },
            { status: 'FAILED', providerReference: HOLD_REF, updatedAt: { gte: new Date(now.getTime() - 2 * 3_600_000) } },
          ],
        },
        select: { tenantId: true, appointmentId: true, providerReference: true, createdAt: true, status: true },
        orderBy: { createdAt: 'asc' }, take: 500,
      });
      const holdOf = new Map<string, number>();
      for (const p of open) {
        const tenantId = p.tenantId, apptId = p.appointmentId as string;
        try {
          // Only a checkout the customer actually opened can have been paid.
          // The first hour every sweep; after that every ~10 minutes.
          const fresh = now.getTime() - p.createdAt.getTime() < 3_600_000 || now.getMinutes() % 10 < 2;
          const started = fresh && await this.prisma.paymentIntentRecord.findFirst({ where: { tenantId, clientRef: `online:${apptId}` }, select: { id: true } });
          if (started) {
            const r = await this.settle(tenantId, apptId, 'sweep');
            if (r.ok && !r.alreadyPaid) { settled++; continue; }
            if (r.ok) continue;
          }
          if (p.status !== 'PENDING' || p.providerReference !== HOLD_REF) continue;
          if (!holdOf.has(tenantId)) holdOf.set(tenantId, holdMinutesOf(await this.settings.getDepositSettings(tenantId)));
          if (!holdExpired(p.createdAt, holdOf.get(tenantId) ?? 0, now)) continue;
          const appt = await this.prisma.appointment.findFirst({ where: { id: apptId, tenantId }, select: { status: true } });
          if (!appt || !HOLD_CANCELLABLE.includes(String(appt.status))) continue;
          await this.bookings.cancelForTenant(tenantId, apptId, null, 'system', 'Chưa đặt cọc · Deposit not paid');
          await this.audit?.log({ tenantId, action: 'booking.deposit_hold_expired', resourceType: 'appointment', resourceId: apptId, metadata: { holdMinutes: holdOf.get(tenantId) } });
          released++;
        } catch (e) {
          this.log.warn(`deposit sweep ${apptId}: ${(e as Error).message}`);
        }
      }
      if (settled || released) this.log.log(`Online deposits: ${settled} payment(s) recorded, ${released} unpaid hold(s) released.`);
    } finally {
      this.running = false;
    }
    return { settled, released };
  }
}
