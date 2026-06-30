import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AppointmentStatus,
  OrderItemKind,
  OrderStatus,
  PaymentStatus,
  PaymentType,
  Prisma,
  WalkInStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { GiftCardsService } from '../gift-cards/gift-cards.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { CreateOrderDto, CreateProductDto, RecordTipDto, UpdateProductDto } from './dto/pos.dto';

const ORDER_INCLUDE = {
  items: { orderBy: { createdAt: 'asc' as const } },
  tenders: { orderBy: { createdAt: 'asc' as const } },
};

@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly loyalty: LoyaltyService,
    private readonly giftCards: GiftCardsService,
  ) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  // ===================== Products (retail catalog) =====================

  listProducts(user: AuthenticatedUser) {
    return this.prisma.product.findMany({
      where: { tenantId: this.tenantId(user) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createProduct(user: AuthenticatedUser, dto: CreateProductDto) {
    const tenantId = this.tenantId(user);
    const product = await this.prisma.product.create({
      data: {
        tenantId,
        name: dto.name,
        sku: dto.sku ?? null,
        barcode: dto.barcode?.trim() || null,
        priceCents: dto.priceCents,
        discountPercent: dto.discountPercent ?? 0,
        currency: dto.currency ?? 'USD',
        taxable: dto.taxable ?? true,
        trackStock: dto.trackStock ?? false,
        stockQty: dto.stockQty ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'product.created', resourceType: 'product', resourceId: product.id });
    return product;
  }

  async updateProduct(user: AuthenticatedUser, id: string, dto: UpdateProductDto) {
    const tenantId = this.tenantId(user);
    const existing = await this.prisma.product.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Product not found');
    await this.prisma.product.updateMany({
      where: { id, tenantId },
      data: {
        name: dto.name,
        sku: dto.sku,
        barcode: dto.barcode === undefined ? undefined : (dto.barcode.trim() || null),
        priceCents: dto.priceCents,
        discountPercent: dto.discountPercent,
        currency: dto.currency,
        taxable: dto.taxable,
        trackStock: dto.trackStock,
        stockQty: dto.stockQty,
        isActive: dto.isActive,
      },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'product.updated', resourceType: 'product', resourceId: id });
    return this.prisma.product.findFirst({ where: { id, tenantId } });
  }

  async removeProduct(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const existing = await this.prisma.product.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Product not found');
    await this.prisma.product.deleteMany({ where: { id, tenantId } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'product.deleted', resourceType: 'product', resourceId: id });
    return { id, deleted: true };
  }

  // ===================== Orders (tickets) =====================

  listOrders(user: AuthenticatedUser, fromStr?: string, toStr?: string, status?: string) {
    const tenantId = this.tenantId(user);
    const where: Prisma.OrderWhereInput = { tenantId };
    if (status) where.status = status as OrderStatus;
    if (fromStr || toStr) {
      where.createdAt = {};
      if (fromStr) where.createdAt.gte = new Date(`${fromStr}T00:00:00`);
      if (toStr) where.createdAt.lte = new Date(`${toStr}T23:59:59.999`);
    }
    return this.prisma.order.findMany({ where, include: ORDER_INCLUDE, orderBy: { createdAt: 'desc' } });
  }

  async getOrder(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const order = await this.prisma.order.findFirst({ where: { id, tenantId }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  /**
   * Create a ticket and (if fully tendered) close it as PAID in one shot — the
   * typical counter flow: ring it up, take payment, print. Tax applies to retail
   * product lines only (per-salon rate); services are tax-exempt.
   */
  async createOrder(user: AuthenticatedUser, dto: CreateOrderDto) {
    const tenantId = this.tenantId(user);
    // Idempotency for offline checkout: a queued sale carries a client ref. If it
    // was already synced, return the existing order instead of duplicating it.
    if (dto.clientRef) {
      const existing = await this.prisma.order.findFirst({
        where: { tenantId, clientRef: dto.clientRef },
        include: ORDER_INCLUDE,
      });
      if (existing) return existing;
    }
    const pos = await this.settings.getPosSettings(tenantId);
    const taxRate = Math.max(0, pos.taxRatePercent || 0);

    // --- Compute line totals + order money ---
    const lines = dto.items.map((it) => {
      const qty = it.quantity && it.quantity > 0 ? it.quantity : 1;
      const gross = it.unitPriceCents * qty;
      const discount = Math.min(it.discountCents ?? 0, gross);
      const lineTotal = Math.max(0, gross - discount);
      return {
        kind: it.kind,
        serviceId: it.serviceId ?? null,
        productId: it.productId ?? null,
        name: it.name,
        unitPriceCents: it.unitPriceCents,
        quantity: qty,
        discountCents: discount,
        tipCents: it.tipCents ?? 0,
        lineTotalCents: lineTotal,
        staffMemberId: it.staffMemberId ?? null,
      };
    });

    const subtotal = lines.reduce((s, l) => s + l.lineTotalCents, 0);
    const manualDiscount = Math.min(dto.discountCents ?? 0, subtotal);
    const productBase = lines
      .filter((l) => l.kind === OrderItemKind.PRODUCT)
      .reduce((s, l) => s + l.lineTotalCents, 0);
    const taxCents = Math.round((productBase * taxRate) / 100);
    const tipCents = lines.reduce((s, l) => s + l.tipCents, 0);

    // Loyalty redemption: validate + value the points as an extra discount.
    const redeemPoints = dto.customerId && dto.redeemPoints && dto.redeemPoints > 0 ? dto.redeemPoints : 0;
    let redeemDiscount = 0;
    if (redeemPoints > 0) {
      const preview = await this.loyalty.previewRedeem(tenantId, dto.customerId!, redeemPoints);
      // Never let the redemption push the order below the tip (tips are owed to staff).
      redeemDiscount = Math.min(preview.discountCents, Math.max(0, subtotal - manualDiscount + taxCents));
    }
    const orderDiscount = manualDiscount + redeemDiscount;
    const totalCents = Math.max(0, subtotal - orderDiscount + taxCents + tipCents);

    // Gift card redemption: read the usable balance now to size the amount due;
    // the authoritative, race-safe deduction happens inside the transaction.
    let giftApplied = 0;
    const giftCode = dto.giftCardCode?.trim();
    if (giftCode) {
      const gp = await this.giftCards.redeemableBalance(tenantId, giftCode);
      if (!gp) throw new BadRequestException('Gift card not found');
      if (gp.applicable <= 0) throw new BadRequestException('Gift card has no usable balance');
      giftApplied = Math.min(gp.applicable, totalCents);
    }
    const amountDue = Math.max(0, totalCents - giftApplied);

    const tenderSum = (dto.tenders ?? []).reduce((s, t) => s + t.amountCents, 0);
    const hasTenders = (dto.tenders ?? []).length > 0;
    if (hasTenders && tenderSum < amountDue) {
      throw new BadRequestException('Tendered amount is less than the amount due');
    }
    // A gift card can close the ticket on its own; otherwise the tenders must
    // cover the remaining amount due.
    const paid = (giftApplied > 0 || hasTenders) && giftApplied + tenderSum >= totalCents;
    const changeCents = paid ? Math.max(0, tenderSum - amountDue) : 0;
    const rules = await this.settings.getBookingRules(tenantId);
    const currency = rules.currency || 'USD';

    const order = await this.prisma.$transaction(async (tx) => {
      // Next order number for this tenant.
      const last = await tx.order.findFirst({
        where: { tenantId },
        orderBy: { orderNumber: 'desc' },
        select: { orderNumber: true },
      });
      const orderNumber = (last?.orderNumber ?? 0) + 1;

      const created = await tx.order.create({
        data: {
          tenantId,
          orderNumber,
          status: paid ? OrderStatus.PAID : OrderStatus.OPEN,
          customerId: dto.customerId ?? null,
          appointmentId: dto.appointmentId ?? null,
          createdByUserId: user.userId,
          subtotalCents: subtotal,
          discountCents: orderDiscount,
          taxCents,
          tipCents,
          totalCents,
          paidCents: paid ? giftApplied + tenderSum : 0,
          changeCents,
          currency,
          giftCardCode: paid && giftApplied > 0 ? giftCode ?? null : null,
          giftCardAppliedCents: paid ? giftApplied : 0,
          note: dto.note ?? null,
          clientRef: dto.clientRef ?? null,
        },
      });

      // Line items + tenders via createMany (carries the scalar tenantId/orderId).
      await tx.orderItem.createMany({
        data: lines.map((l) => ({ ...l, tenantId, orderId: created.id })),
      });
      if (paid && (dto.tenders ?? []).length > 0) {
        await tx.orderPayment.createMany({
          data: (dto.tenders ?? []).map((t) => ({ tenantId, orderId: created.id, method: t.method, amountCents: t.amountCents })),
        });
      }

      if (paid) {
        // Deduct stock for tracked products.
        for (const l of lines) {
          if (l.kind === OrderItemKind.PRODUCT && l.productId) {
            await tx.product.updateMany({
              where: { id: l.productId, tenantId, trackStock: true },
              data: { stockQty: { decrement: l.quantity } },
            });
          }
        }
        // Redeem the gift card (authoritative, race-safe) now that we have an
        // order id. Throws and rolls the whole sale back if the balance changed.
        if (giftApplied > 0 && giftCode) {
          const applied = await this.giftCards.redeemInTx(tx, tenantId, giftCode, giftApplied, created.id, user.userId);
          if (applied !== giftApplied) throw new BadRequestException('Gift card balance changed, please retry');
        }
        // Mirror NEW cash into the Payment ledger so dashboard revenue includes POS
        // sales. The gift-card portion is excluded — it was already counted as
        // revenue when the card was sold, so counting it again would double-count.
        if (amountDue > 0) {
          const m = dto.tenders?.[0]?.method;
          const provider = m === 'CASH' ? 'pos-cash' : m === 'CARD' ? 'pos-card' : 'pos-transfer';
          await tx.payment.create({
            data: {
              tenantId,
              appointmentId: dto.appointmentId ?? null,
              amountCents: amountDue,
              currency: created.currency,
              type: PaymentType.PAY_LATER,
              status: PaymentStatus.PAID,
              provider,
              providerReference: `order:${created.id}`,
              paidAt: new Date(),
            },
          });
        }
        // Checking out a booking completes it.
        if (dto.appointmentId) {
          await tx.appointment.updateMany({
            where: { id: dto.appointmentId, tenantId },
            data: { status: AppointmentStatus.COMPLETED, completedAt: new Date() },
          });
        }
        // Checking out a walk-in marks it Done (front desk doesn't need a second step).
        if (dto.walkInId) {
          await tx.walkIn.updateMany({
            where: { id: dto.walkInId, tenantId },
            data: { status: WalkInStatus.DONE, doneAt: new Date() },
          });
        }
        // Loyalty: redeem the points used, then award points on the amount paid.
        if (dto.customerId && redeemPoints > 0) {
          await this.loyalty.redeem(tx, tenantId, dto.customerId, redeemPoints, 'order', created.id);
        }
        if (dto.customerId) {
          // Earn on NET service/product spend (subtotal minus discounts), EXCLUDING
          // tax and tips — the standard for salon/retail loyalty. Tips belong to
          // staff, and payment method (cash/card/gift card) doesn't change what's
          // earned. Buying a gift card earns nothing (handled in its own endpoint).
          await this.loyalty.award(tx, tenantId, dto.customerId, Math.max(0, subtotal - orderDiscount), 'order', created.id);
        }
      }

      return tx.order.findFirst({ where: { id: created.id, tenantId }, include: ORDER_INCLUDE });
    });

    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: paid ? 'order.paid' : 'order.created',
      resourceType: 'order',
      resourceId: order?.id,
      metadata: { orderNumber: order?.orderNumber, totalCents },
    });

    return order;
  }

  /** Void an order: no revenue. Refunds the mirrored payment and restocks. */
  async voidOrder(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const order = await this.prisma.order.findFirst({ where: { id, tenantId }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === OrderStatus.VOID) return order;

    await this.prisma.$transaction(async (tx) => {
      await tx.order.updateMany({ where: { id, tenantId }, data: { status: OrderStatus.VOID } });
      // Reverse the revenue mirror.
      await tx.payment.updateMany({
        where: { tenantId, providerReference: `order:${id}`, status: PaymentStatus.PAID },
        data: { status: PaymentStatus.REFUNDED },
      });
      // Restock + re-credit any redeemed gift card if it had been a live paid sale.
      if (order.status === OrderStatus.PAID) {
        for (const l of order.items) {
          if (l.kind === OrderItemKind.PRODUCT && l.productId) {
            await tx.product.updateMany({
              where: { id: l.productId, tenantId, trackStock: true },
              data: { stockQty: { increment: l.quantity } },
            });
          }
        }
        await this.recreditGiftCards(tx, tenantId, id, user.userId);
        await this.loyalty.reverseForRef(tx, tenantId, 'order', id, 'Order reversed');
      }
    });

    await this.audit.log({ tenantId, userId: user.userId, action: 'order.voided', resourceType: 'order', resourceId: id });
    return this.getOrder(user, id);
  }

  /** Permanently delete an order (admin cleanup): reverses revenue, restocks if it
   *  was a live paid sale, then removes the order (items + tenders cascade). */
  async removeOrder(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const order = await this.prisma.order.findFirst({ where: { id, tenantId }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('Order not found');

    await this.prisma.$transaction(async (tx) => {
      // Restock + re-credit gift cards only if it was still a live PAID sale
      // (a VOID order was already restocked/re-credited).
      if (order.status === OrderStatus.PAID) {
        for (const l of order.items) {
          if (l.kind === OrderItemKind.PRODUCT && l.productId) {
            await tx.product.updateMany({
              where: { id: l.productId, tenantId, trackStock: true },
              data: { stockQty: { increment: l.quantity } },
            });
          }
        }
        await this.recreditGiftCards(tx, tenantId, id, user.userId);
        await this.loyalty.reverseForRef(tx, tenantId, 'order', id, 'Order reversed');
      }
      // Remove the revenue mirror so the deleted sale never counts.
      await tx.payment.deleteMany({ where: { tenantId, providerReference: `order:${id}` } });
      // Delete the order; order_items + order_payments cascade via FK.
      await tx.order.deleteMany({ where: { id, tenantId } });
    });

    await this.audit.log({ tenantId, userId: user.userId, action: 'order.deleted', resourceType: 'order', resourceId: id });
    return { id, deleted: true };
  }

  /**
   * Reverse any gift-card redemptions made on an order (called on void/delete of
   * a paid sale) so the customer's balance is restored. Writes a compensating
   * ADJUST ledger entry per card. Guarded by the caller to a live PAID sale so it
   * runs at most once per order.
   */
  private async recreditGiftCards(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderId: string,
    userId?: string,
  ): Promise<void> {
    const redemptions = await tx.giftCardTransaction.findMany({
      where: { tenantId, orderId, kind: 'REDEEM' },
    });
    for (const r of redemptions) {
      const credit = -r.amountCents; // REDEEM amounts are stored negative
      if (credit <= 0) continue;
      await tx.giftCard.updateMany({
        where: { id: r.giftCardId, tenantId },
        data: { balanceCents: { increment: credit }, status: 'ACTIVE' },
      });
      await tx.giftCardTransaction.create({
        data: { tenantId, giftCardId: r.giftCardId, kind: 'ADJUST', amountCents: credit, orderId, createdByUserId: userId ?? null },
      });
    }
  }

  /**
   * Per-technician POS report over a date range: service revenue, product
   * revenue, tips and commission (service revenue × the tech's commission %).
   */
  // ===================== Direct tips (paid straight to the tech) =====================
  // Customer tips the technician directly (scans the tech's QR, hands cash, etc.).
  // The salon never holds this money — we only log it so payroll/reports show it.
  async recordTip(user: AuthenticatedUser, dto: RecordTipDto) {
    const tenantId = this.tenantId(user);
    const staff = await this.prisma.staffMember.findFirst({
      where: { id: dto.staffMemberId, tenantId },
      select: { id: true },
    });
    if (!staff) throw new NotFoundException('Staff member not found');
    const amountCents = Math.round(dto.amountCents);
    if (amountCents <= 0) throw new BadRequestException('Tip amount must be positive');
    const tip = await this.prisma.tipLog.create({
      data: {
        tenantId,
        staffMemberId: dto.staffMemberId,
        amountCents,
        method: (dto.method || 'DIRECT').toUpperCase(),
        note: dto.note?.trim() || null,
        orderId: dto.orderId ?? null,
        createdByUserId: user.userId,
      },
    });
    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: 'tip.logged',
      resourceType: 'tip',
      resourceId: tip.id,
      metadata: { staffMemberId: dto.staffMemberId, amountCents, method: tip.method },
    });
    return tip;
  }

  async report(user: AuthenticatedUser, fromStr?: string, toStr?: string) {
    const tenantId = this.tenantId(user);
    const now = new Date();
    const to = toStr ? new Date(`${toStr}T23:59:59.999`) : now;
    const from = fromStr ? new Date(`${fromStr}T00:00:00`) : new Date(to.getTime() - 29 * 86400000);

    const orders = await this.prisma.order.findMany({
      where: { tenantId, status: OrderStatus.PAID, paidAt: { gte: from, lte: to } },
      select: { id: true, items: true, appointmentId: true },
    });
    const staff = await this.prisma.staffMember.findMany({
      where: { tenantId },
      select: { id: true, firstName: true, lastName: true, commissionPercent: true, baseCents: true },
    });
    const staffMap = new Map(staff.map((s) => [s.id, s]));

    type Row = { staffId: string; name: string; commissionPercent: number; serviceCount: number; serviceRevenueCents: number; productRevenueCents: number; tipsCents: number; commissionCents: number; baseCents: number; totalPayCents: number; directTipsCents: number };
    const rows = new Map<string, Row>();
    const ensure = (id: string | null) => {
      const key = id ?? 'unassigned';
      if (!rows.has(key)) {
        const s = id ? staffMap.get(id) : null;
        rows.set(key, {
          staffId: key,
          name: s ? `${s.firstName} ${s.lastName ?? ''}`.trim() : 'Unassigned',
          commissionPercent: s?.commissionPercent ?? 0,
          serviceCount: 0,
          serviceRevenueCents: 0,
          productRevenueCents: 0,
          tipsCents: 0,
          commissionCents: 0,
          baseCents: 0,
          totalPayCents: 0,
          directTipsCents: 0,
        });
      }
      return rows.get(key)!;
    };

    let totalRevenue = 0;
    let totalTips = 0;
    let totalCommission = 0;
    let totalPay = 0;
    for (const o of orders) {
      for (const l of o.items) {
        const row = ensure(l.staffMemberId);
        if (l.kind === OrderItemKind.SERVICE) { row.serviceRevenueCents += l.lineTotalCents; row.serviceCount += l.quantity; }
        else row.productRevenueCents += l.lineTotalCents;
        row.tipsCents += l.tipCents;
        totalRevenue += l.lineTotalCents;
        totalTips += l.tipCents;
      }
    }
    // Completed bookings NOT collected through POS still count toward revenue
    // and the assigned tech's commission (tips only come from POS). Skip any
    // booking already paid via a POS order so nothing is double-counted.
    const posPaidApptIds = new Set(
      orders.map((o) => o.appointmentId).filter((x): x is string => !!x),
    );
    const completedAppts = await this.prisma.appointment.findMany({
      where: { tenantId, status: AppointmentStatus.COMPLETED, completedAt: { gte: from, lte: to } },
      select: { id: true, priceCents: true, assignedStaffId: true },
    });
    let extraTxns = 0;
    for (const a of completedAppts) {
      if (posPaidApptIds.has(a.id)) continue;
      const row = ensure(a.assignedStaffId);
      row.serviceRevenueCents += a.priceCents;
      row.serviceCount += 1;
      totalRevenue += a.priceCents;
      extraTxns += 1;
    }

    // Commission on service revenue using each tech's rate; pay = commission + tips.
    for (const row of rows.values()) {
      const s = row.staffId !== 'unassigned' ? staffMap.get(row.staffId) : null;
      const pct = s?.commissionPercent ?? 0;
      row.commissionCents = Math.round((row.serviceRevenueCents * pct) / 100);
      row.totalPayCents = row.commissionCents + row.tipsCents;
      totalCommission += row.commissionCents;
      totalPay += row.totalPayCents;
    }

    // Fixed base pay per period: every tech with a base gets it (even with no
    // sales this period). Total pay = base + commission + tips.
    let totalBase = 0;
    for (const s of staff) {
      const base = s.baseCents ?? 0;
      if (base <= 0) continue;
      const row = ensure(s.id);
      row.baseCents = base;
      row.totalPayCents += base;
      totalBase += base;
      totalPay += base;
    }

    // Direct tips (paid straight to the tech via QR/cash — logged for visibility
    // only). NOT added to totalPay: the salon never holds this money.
    const directTipGroups = await this.prisma.tipLog.groupBy({
      by: ['staffMemberId'],
      where: { tenantId, createdAt: { gte: from, lte: to } },
      _sum: { amountCents: true },
    });
    let totalDirectTips = 0;
    for (const g of directTipGroups) {
      const amt = g._sum.amountCents ?? 0;
      if (amt === 0) continue;
      const row = ensure(g.staffMemberId);
      row.directTipsCents += amt;
      totalDirectTips += amt;
    }

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      totals: { revenueCents: totalRevenue, tipsCents: totalTips, commissionCents: totalCommission, baseCents: totalBase, payCents: totalPay, directTipsCents: totalDirectTips, orders: orders.length + extraTxns },
      staff: [...rows.values()].sort(
        (a, b) =>
          b.serviceRevenueCents + b.productRevenueCents - (a.serviceRevenueCents + a.productRevenueCents),
      ),
    };
  }
}
