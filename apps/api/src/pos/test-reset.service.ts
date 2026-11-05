/**
 * XOÁ DỮ LIỆU BÁN HÀNG THỬ — the database half (rules in test-reset.ts).
 *
 * Lumio Support only (a support session inside the salon, or a super admin
 * scoped to it) — never the salon's own owner: a wipe of every bill is a
 * handover step. One salon only (the tenant comes from the token, never the
 * request), typed confirmation, refused inside a closed payroll. In one
 * transaction, for this tenant and the chosen days:
 *   - bills (orders + their lines/tenders by cascade) and their revenue rows,
 *     refunds, tips logged on them;
 *   - restaurant table bills (open ones too, so the floor is free again),
 *     cashier shifts (+ drawer movements), parked carts, print jobs;
 *   - stock sold on those bills goes back, loyalty points and gift-card
 *     money they moved are undone, and their ledger rows go.
 * Kept: menu, tables, staff, products, clients, bookings, settings, the
 * Thu & Chi book. Bill numbers carry on from the last bill kept (1 if none).
 */
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { confirmed, giftCardCredit, lockedPayroll, loyaltyNet, resetWindow, restock, type ResetWindow } from './test-reset';

@Injectable()
export class TestResetService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private async scope(user: AuthenticatedUser, from: unknown): Promise<{ tenantId: string; w: ResetWindow }> {
    if (!user.supportSession && user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Xoá toàn bộ dữ liệu thử chỉ dành cho Lumio Support. Chủ tiệm xoá bill bằng cách chọn bill trong danh sách.');
    }
    const tenantId = resolveTenantScope(user);
    if (!tenantId) throw new BadRequestException('No salon in scope');
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
    const w = resetWindow(from, t?.timezone || 'UTC');
    if (!w) throw new BadRequestException('Ngày bắt đầu không hợp lệ');
    return { tenantId, w };
  }

  private since(w: ResetWindow, field: string) {
    return w.fromUtc ? { [field]: { gte: w.fromUtc } } : {};
  }

  /** What would go, so the owner sees it before typing XOA. */
  async preview(user: AuthenticatedUser, from: unknown) {
    const { tenantId, w } = await this.scope(user, from);
    const [orders, checks, shifts, held, prints, runs, kept] = await Promise.all([
      this.prisma.order.findMany({ where: { tenantId, ...this.since(w, 'createdAt') }, select: { status: true, totalCents: true, currency: true, createdAt: true } }),
      this.prisma.tableCheck.count({ where: { tenantId, ...this.since(w, 'openedAt') } }),
      this.prisma.cashShift.count({ where: { tenantId, ...this.since(w, 'openedAt') } }),
      this.prisma.heldBill.count({ where: { tenantId, ...this.since(w, 'createdAt') } }),
      this.prisma.printJob.count({ where: { tenantId, ...this.since(w, 'createdAt') } }),
      this.prisma.payrollRun.findMany({ where: { tenantId, status: 'FINAL' }, select: { periodFrom: true, periodTo: true } }),
      w.fromUtc ? this.prisma.order.count({ where: { tenantId, createdAt: { lt: w.fromUtc } } }) : Promise.resolve(0),
    ]);
    const paid = orders.filter((o) => o.status === 'PAID');
    const first = orders.reduce<Date | null>((m, o) => (!m || o.createdAt < m ? o.createdAt : m), null);
    return {
      fromDay: w.fromDay, today: w.today,
      bills: orders.length,
      paidBills: paid.length,
      revenueCents: paid.reduce((n, o) => n + (o.totalCents || 0), 0),
      currency: orders[0]?.currency ?? null,
      firstAt: first,
      tableBills: checks, shifts, heldBills: held, printJobs: prints,
      billsKept: kept,
      lockedPayroll: lockedPayroll(runs, w),
    };
  }

  async run(user: AuthenticatedUser, body: { from?: unknown; confirm?: unknown }) {
    if (!confirmed(body?.confirm)) throw new BadRequestException('Gõ XOA để xác nhận');
    const { tenantId, w } = await this.scope(user, body?.from);
    const runs = await this.prisma.payrollRun.findMany({ where: { tenantId, status: 'FINAL' }, select: { periodFrom: true, periodTo: true } });
    const lock = lockedPayroll(runs, w);
    if (lock) throw new BadRequestException(`Kỳ lương ${lock.periodFrom} → ${lock.periodTo} đã chốt nằm trong những ngày này — mở lại kỳ lương trước khi xoá.`);

    const orders = await this.prisma.order.findMany({
      where: { tenantId, ...this.since(w, 'createdAt') },
      select: { id: true, status: true, items: { select: { kind: true, productId: true, quantity: true } } },
    });
    const ids = orders.map((o) => o.id);
    const refs = ids.map((id) => `order:${id}`);

    const done = await this.prisma.$transaction(async (tx) => {
      // Stock sold on live sales goes back on the shelf.
      for (const [productId, qty] of restock(orders)) {
        await tx.product.updateMany({ where: { id: productId, tenantId, trackStock: true }, data: { stockQty: { increment: qty } } });
      }
      // Loyalty points still held from these bills come off; their ledger rows go.
      const lt = ids.length
        ? await tx.loyaltyTransaction.findMany({ where: { tenantId, refId: { in: ids }, refType: { in: ['order', 'order-reversal'] } }, select: { id: true, customerId: true, points: true } })
        : [];
      for (const [customerId, net] of loyaltyNet(lt)) {
        const c = await tx.customer.findFirst({ where: { id: customerId, tenantId }, select: { loyaltyPoints: true } });
        if (c) await tx.customer.updateMany({ where: { id: customerId, tenantId }, data: { loyaltyPoints: Math.max(0, c.loyaltyPoints - net) } });
      }
      if (lt.length) await tx.loyaltyTransaction.deleteMany({ where: { tenantId, id: { in: lt.map((t) => t.id) } } });
      // Gift-card money spent on these bills goes back on the card.
      const gt = ids.length
        ? await tx.giftCardTransaction.findMany({ where: { tenantId, orderId: { in: ids }, kind: { in: ['REDEEM', 'ADJUST'] } }, select: { id: true, giftCardId: true, kind: true, amountCents: true } })
        : [];
      for (const [giftCardId, cents] of giftCardCredit(gt)) {
        await tx.giftCard.updateMany({ where: { id: giftCardId, tenantId }, data: { balanceCents: { increment: cents }, status: 'ACTIVE' } });
      }
      if (gt.length) await tx.giftCardTransaction.deleteMany({ where: { tenantId, id: { in: gt.map((t) => t.id) } } });

      const payments = ids.length ? await tx.payment.deleteMany({ where: { tenantId, providerReference: { in: refs } } }) : { count: 0 };
      const refunds = ids.length ? await tx.orderRefund.deleteMany({ where: { tenantId, orderId: { in: ids } } }) : { count: 0 };
      const tips = ids.length ? await tx.tipLog.deleteMany({ where: { tenantId, orderId: { in: ids } } }) : { count: 0 };
      const bills = ids.length ? await tx.order.deleteMany({ where: { tenantId, id: { in: ids } } }) : { count: 0 };
      const checks = await tx.tableCheck.deleteMany({
        where: { tenantId, OR: [this.since(w, 'openedAt'), ...(ids.length ? [{ orderId: { in: ids } }] : [])] },
      });
      const shifts = await tx.cashShift.deleteMany({ where: { tenantId, ...this.since(w, 'openedAt') } });
      const held = await tx.heldBill.deleteMany({ where: { tenantId, ...this.since(w, 'createdAt') } });
      const prints = await tx.printJob.deleteMany({ where: { tenantId, ...this.since(w, 'createdAt') } });
      return {
        bills: bills.count, payments: payments.count, refunds: refunds.count, tips: tips.count,
        tableBills: checks.count, shifts: shifts.count, heldBills: held.count, printJobs: prints.count,
        loyaltyRows: lt.length, giftCardRows: gt.length,
      };
    }, { timeout: 120_000, maxWait: 20_000 });

    await this.audit.log({
      tenantId, userId: user.userId, action: 'pos.test_data_reset', resourceType: 'tenant', resourceId: tenantId,
      metadata: { fromDay: w.fromDay, today: w.today, ...done },
    });
    return { fromDay: w.fromDay, today: w.today, ...done };
  }
}
