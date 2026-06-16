import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AppointmentStatus,
  OrderItemKind,
  OrderStatus,
  PaymentStatus,
  PaymentType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { CreateOrderDto, CreateProductDto, UpdateProductDto } from './dto/pos.dto';

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

    const paidCents = (dto.tenders ?? []).reduce((s, t) => s + t.amountCents, 0);
    const hasTenders = (dto.tenders ?? []).length > 0;
    if (hasTenders && paidCents < totalCents) {
      throw new BadRequestException('Tendered amount is less than the total due');
    }
    const paid = hasTenders && paidCents >= totalCents;
    const changeCents = paid ? paidCents - totalCents : 0;
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
          paidCents: paid ? paidCents : 0,
          changeCents,
          currency,
          note: dto.note ?? null,
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
        // Mirror into the Payment ledger so dashboard revenue includes POS sales.
        // Encode the tender method in `provider` so reports can split Cash/Card/Transfer.
        const m = dto.tenders?.[0]?.method;
        const provider = m === 'CASH' ? 'pos-cash' : m === 'CARD' ? 'pos-card' : 'pos-transfer';
        await tx.payment.create({
          data: {
            tenantId,
            appointmentId: dto.appointmentId ?? null,
            amountCents: totalCents,
            currency: created.currency,
            type: PaymentType.PAY_LATER,
            status: PaymentStatus.PAID,
            provider,
            providerReference: `order:${created.id}`,
            paidAt: new Date(),
          },
        });
        // Checking out a booking completes it.
        if (dto.appointmentId) {
          await tx.appointment.updateMany({
            where: { id: dto.appointmentId, tenantId },
            data: { status: AppointmentStatus.COMPLETED, completedAt: new Date() },
          });
        }
        // Loyalty: redeem the points used, then award points on the amount paid.
        if (dto.customerId && redeemPoints > 0) {
          await this.loyalty.redeem(tx, tenantId, dto.customerId, redeemPoints, 'order', created.id);
        }
        if (dto.customerId) {
          await this.loyalty.award(tx, tenantId, dto.customerId, totalCents, 'order', created.id);
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
      // Restock if it had been paid.
      if (order.status === OrderStatus.PAID) {
        for (const l of order.items) {
          if (l.kind === OrderItemKind.PRODUCT && l.productId) {
            await tx.product.updateMany({
              where: { id: l.productId, tenantId, trackStock: true },
              data: { stockQty: { increment: l.quantity } },
            });
          }
        }
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
      // Restock only if it was still a live PAID sale (a VOID order was already restocked).
      if (order.status === OrderStatus.PAID) {
        for (const l of order.items) {
          if (l.kind === OrderItemKind.PRODUCT && l.productId) {
            await tx.product.updateMany({
              where: { id: l.productId, tenantId, trackStock: true },
              data: { stockQty: { increment: l.quantity } },
            });
          }
        }
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
   * Per-technician POS report over a date range: service revenue, product
   * revenue, tips and commission (service revenue × the tech's commission %).
   */
  async report(user: AuthenticatedUser, fromStr?: string, toStr?: string) {
    const tenantId = this.tenantId(user);
    const now = new Date();
    const to = toStr ? new Date(`${toStr}T23:59:59.999`) : now;
    const from = fromStr ? new Date(`${fromStr}T00:00:00`) : new Date(to.getTime() - 29 * 86400000);

    const orders = await this.prisma.order.findMany({
      where: { tenantId, status: OrderStatus.PAID, paidAt: { gte: from, lte: to } },
      select: { id: true, items: true },
    });
    const staff = await this.prisma.staffMember.findMany({
      where: { tenantId },
      select: { id: true, firstName: true, lastName: true, commissionPercent: true },
    });
    const staffMap = new Map(staff.map((s) => [s.id, s]));

    type Row = { staffId: string; name: string; serviceRevenueCents: number; productRevenueCents: number; tipsCents: number; commissionCents: number };
    const rows = new Map<string, Row>();
    const ensure = (id: string | null) => {
      const key = id ?? 'unassigned';
      if (!rows.has(key)) {
        const s = id ? staffMap.get(id) : null;
        rows.set(key, {
          staffId: key,
          name: s ? `${s.firstName} ${s.lastName ?? ''}`.trim() : 'Unassigned',
          serviceRevenueCents: 0,
          productRevenueCents: 0,
          tipsCents: 0,
          commissionCents: 0,
        });
      }
      return rows.get(key)!;
    };

    let totalRevenue = 0;
    let totalTips = 0;
    let totalCommission = 0;
    for (const o of orders) {
      for (const l of o.items) {
        const row = ensure(l.staffMemberId);
        if (l.kind === OrderItemKind.SERVICE) row.serviceRevenueCents += l.lineTotalCents;
        else row.productRevenueCents += l.lineTotalCents;
        row.tipsCents += l.tipCents;
        totalRevenue += l.lineTotalCents;
        totalTips += l.tipCents;
      }
    }
    // Commission on service revenue using each tech's rate.
    for (const row of rows.values()) {
      const s = row.staffId !== 'unassigned' ? staffMap.get(row.staffId) : null;
      const pct = s?.commissionPercent ?? 0;
      row.commissionCents = Math.round((row.serviceRevenueCents * pct) / 100);
      totalCommission += row.commissionCents;
    }

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      totals: { revenueCents: totalRevenue, tipsCents: totalTips, commissionCents: totalCommission, orders: orders.length },
      staff: [...rows.values()].sort(
        (a, b) =>
          b.serviceRevenueCents + b.productRevenueCents - (a.serviceRevenueCents + a.productRevenueCents),
      ),
    };
  }
}
