import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
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
import { normalizeSource } from '../common/source.util';
import { AuditService } from '../audit/audit.service';
import { CashShiftsService } from './cash-shifts.service';
import { FeedbackService } from '../feedback/feedback.service';
import { SettingsService } from '../settings/settings.service';
import { ledgerProviderFor, bucketFor, methodsForSalon, isPaymentMethod } from './payment-methods';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { TrashService } from '../maintenance/trash.service';
import { WalkinsService } from '../walkins/walkins.service';
import { GiftCardsService } from '../gift-cards/gift-cards.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { cleanStaffCaps, hasCapability } from '../auth/capabilities';
import { addDaysToKey, dayKeyTz, startOfDayTz } from '../common/salon-time';
import { CreateOrderDto, CreateProductDto, RecordTipDto, UpdateProductDto } from './dto/pos.dto';

const ORDER_INCLUDE = {
  items: { orderBy: { createdAt: 'asc' as const } },
  tenders: { orderBy: { createdAt: 'asc' as const } },
};

import { loadLedger } from '../payroll/ledger-loader';
import { UNASSIGNED, allocate } from '../payroll/sales-ledger';
import { settledWalkIns } from '../walkins/unpaid-sweep';
import { commissionOnly, sanitizeSettings } from '../payroll/pay-calc';
import { PAYROLL_SETTINGS_KEY } from '../payroll/payroll.service';

/** Wrong approval PINs per salon (this API process): 5 in 10 minutes locks PIN entry. */
const PIN_FAILS = new Map<string, { n: number; until: number }>();

@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly shifts: CashShiftsService,
    private readonly settings: SettingsService,
    private readonly loyalty: LoyaltyService,
    private readonly giftCards: GiftCardsService,
    private readonly trash: TrashService,
    // Optional so the unit tests can build the service without the walk-in
    // board. Used only to fill the chair a checkout just freed.
    @Optional() private readonly walkins?: WalkinsService,
    // Optional for the same reason: asks "how was your visit?" after a paid sale.
    @Optional() private readonly feedback?: FeedbackService,
  ) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  /** What the till prints: the salon's header and the owner's bill design. */
  receiptProfile(user: AuthenticatedUser) {
    return this.settings.receiptProfile(this.tenantId(user));
  }

  /** The tenant's own timezone: a till report's "day" is the salon's day. */
  private async tzOf(tenantId: string): Promise<string> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }).catch(() => null);
    return t?.timezone || 'UTC';
  }

  /**
   * A range argument as an instant. Accepts a full ISO instant (a caller that
   * already anchored its window, like staff performance) or a "YYYY-MM-DD"
   * salon day, whose edge is that day's start or end AT THE SALON. The old
   * string-concatenation parse produced Invalid Date for ISO input — which a
   * caller's catch then read as "POS has no money", zeros in a payroll table.
   */
  private edgeOf(x: string, tz: string, edge: 'start' | 'end'): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(x)) {
      return edge === 'start'
        ? startOfDayTz(x, tz)
        : new Date(startOfDayTz(addDaysToKey(x, 1), tz).getTime() - 1);
    }
    const d = new Date(x);
    return Number.isNaN(d.getTime()) ? new Date(NaN) : d;
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

  async listOrders(user: AuthenticatedUser, fromStr?: string, toStr?: string, status?: string) {
    const tenantId = this.tenantId(user);
    const where: Prisma.OrderWhereInput = { tenantId };
    if (status) where.status = status as OrderStatus;
    if (fromStr || toStr) {
      // A bill belongs to the day it was paid (what the reports count); a bill
      // never paid, to the day it was opened.
      const tz = await this.tzOf(tenantId);
      const span: { gte?: Date; lte?: Date } = {};
      if (fromStr) span.gte = this.edgeOf(fromStr, tz, 'start');
      if (toStr) span.lte = this.edgeOf(toStr, tz, 'end');
      where.OR = [{ paidAt: span }, { paidAt: null, createdAt: span }];
    }
    const orders = await this.prisma.order.findMany({ where, include: ORDER_INCLUDE, orderBy: { createdAt: 'desc' } });
    // Who each bill was for, and what has already gone back — the two things
    // the list was missing. Both read this salon's rows only.
    const custIds = [...new Set(orders.map((o) => o.customerId).filter((x): x is string => !!x))] as string[];
    const [customers, refunded] = await Promise.all([
      custIds.length
        ? this.prisma.customer.findMany({ where: { tenantId, id: { in: custIds } }, select: { id: true, firstName: true, lastName: true, phone: true } })
        : Promise.resolve([] as { id: string; firstName: string; lastName: string | null; phone: string | null }[]),
      this.refundedByOrder(tenantId, orders.map((o) => o.id)),
    ]);
    const byId = new Map(customers.map((c) => [c.id, c]));
    return orders.map((o) => ({
      ...o,
      customer: o.customerId ? byId.get(o.customerId) ?? null : null,
      refundedCents: refunded.get(o.id) ?? 0,
    }));
  }

  /** Money handed back per bill: its negative ledger rows (till refunds and card-terminal refunds alike). */
  private async refundedByOrder(tenantId: string, ids: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!ids.length) return out;
    const rows = await this.prisma.payment.findMany({
      where: { tenantId, status: PaymentStatus.PAID, amountCents: { lt: 0 }, providerReference: { in: ids.map((id) => `order:${id}`) } },
      select: { providerReference: true, amountCents: true },
    }).catch(() => [] as { providerReference: string | null; amountCents: number }[]);
    for (const r of rows) {
      const id = String(r.providerReference ?? '').slice('order:'.length);
      out.set(id, (out.get(id) ?? 0) - r.amountCents);
    }
    return out;
  }

  /**
   * One bill, everything about it: the client, the technicians by name, the
   * money in and back, the booking it settled, and its history (who rang it
   * up, who voided or refunded it and why). Read-only; tenant-scoped.
   */
  async orderDetail(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const order = await this.getOrder(user, id);
    const ref = `order:${id}`;
    const apptIds = [...new Set([order.appointmentId, ...(order.appointmentIds ?? [])].filter((x): x is string => !!x))];
    const staffIds = [...new Set(order.items.map((l) => l.staffMemberId).filter((x): x is string => !!x))] as string[];
    const [customer, stats, ledger, logs, appts, staff] = await Promise.all([
      order.customerId
        ? this.prisma.customer.findFirst({ where: { id: order.customerId, tenantId }, select: { id: true, firstName: true, lastName: true, phone: true, email: true } })
        : Promise.resolve(null),
      order.customerId
        ? this.prisma.order.aggregate({ where: { tenantId, customerId: order.customerId, status: OrderStatus.PAID }, _count: { _all: true }, _sum: { totalCents: true } }).catch(() => null)
        : Promise.resolve(null),
      this.prisma.payment.findMany({ where: { tenantId, providerReference: ref }, select: { amountCents: true, status: true, provider: true, paidAt: true, createdAt: true } }),
      this.prisma.auditLog.findMany({ where: { tenantId, resourceType: 'order', resourceId: id }, orderBy: { createdAt: 'asc' }, select: { action: true, metadata: true, createdAt: true, userId: true }, take: 50 }).catch(() => [] as { action: string; metadata: unknown; createdAt: Date; userId: string | null }[]),
      apptIds.length
        ? this.prisma.appointment.findMany({ where: { tenantId, id: { in: apptIds } }, select: { id: true, startTime: true } })
        : Promise.resolve([] as { id: string; startTime: Date }[]),
      staffIds.length
        ? this.prisma.staffMember.findMany({ where: { tenantId, id: { in: staffIds } }, select: { id: true, firstName: true, lastName: true } })
        : Promise.resolve([] as { id: string; firstName: string; lastName: string | null }[]),
    ]);
    const voidLock = order.status === OrderStatus.PAID ? await this.voidWindow(user, tenantId, order) : null;
    const userIds = [...new Set([order.createdByUserId, ...logs.map((l) => l.userId)].filter((x): x is string => !!x))];
    const people = userIds.length ? await this.namesOfUsers(tenantId, userIds) : new Map<string, string>();
    const paidRows = ledger.filter((r) => r.status === PaymentStatus.PAID);
    const refunds = paidRows.filter((r) => r.amountCents < 0)
      .map((r) => ({ amountCents: -r.amountCents, provider: r.provider, at: new Date(r.paidAt ?? r.createdAt ?? Date.now()).toISOString() }));
    const refundedCents = refunds.reduce((n, r) => n + r.amountCents, 0);
    const collectedCents = paidRows.reduce((n, r) => n + r.amountCents, 0);
    return {
      ...order,
      customer: customer ? { ...customer, visits: stats?._count?._all ?? 0, spentCents: stats?._sum?.totalCents ?? 0 } : null,
      staffNames: Object.fromEntries(staff.map((s) => [s.id, `${s.firstName} ${s.lastName ?? ''}`.trim()])),
      appointments: appts.map((a) => ({ id: a.id, startTime: a.startTime.toISOString() })),
      cashierName: order.createdByUserId ? people.get(order.createdByUserId) ?? null : null,
      refunds, refundedCents, collectedCents,
      history: logs.map((l) => ({ action: l.action, at: l.createdAt.toISOString(), by: l.userId ? people.get(l.userId) ?? null : null, meta: l.metadata ?? {} })),
      // What may be done next (the server checks again on every action).
      canRefund: order.status === OrderStatus.PAID && collectedCents > 0,
      canVoid: order.status === OrderStatus.PAID && refundedCents === 0 && !voidLock,
      voidLock,
      canDelete: this.isDraft(order),
    };
  }

  /** People named the way the salon knows them: their staff card, else their own name, else the e-mail's first half. */
  private async namesOfUsers(tenantId: string, ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const [cards, users] = await Promise.all([
      this.prisma.staffMember.findMany({ where: { tenantId, userId: { in: ids } }, select: { userId: true, firstName: true, lastName: true } }).catch(() => [] as { userId: string | null; firstName: string; lastName: string | null }[]),
      this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, email: true } }).catch(() => [] as { id: string; firstName: string | null; lastName: string | null; email: string }[]),
    ]);
    for (const u of users) out.set(u.id, `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email.split('@')[0]);
    for (const c of cards) if (c.userId) out.set(c.userId, `${c.firstName} ${c.lastName ?? ''}`.trim());
    return out;
  }

  /**
   * Split a part refund over the bill's lines: first the chosen lines' sales
   * (each line net of its share of the bill discount, less what earlier
   * refunds already took off it), then their tips. No lines chosen = every
   * line. Anything beyond (tax) belongs to no technician.
   */
  private async refundSplit(tenantId: string, order: { id: string; discountCents: number; items: { id: string; kind: string; lineTotalCents: number; tipCents: number; staffMemberId: string | null }[] }, amount: number, itemIds: string[]) {
    type Line = { itemId: string; staffMemberId: string | null; kind: string; netCents: number; tipCents: number };
    const earlier = await ((this.prisma as unknown as { orderRefund?: { findMany: (a: unknown) => Promise<{ lines: unknown }[]> } }).orderRefund
      ?.findMany({ where: { tenantId, orderId: order.id }, select: { lines: true } }).catch(() => []) ?? Promise.resolve([] as { lines: unknown }[]));
    const taken = new Map<string, { net: number; tip: number }>();
    for (const r of earlier) for (const l of (Array.isArray(r.lines) ? r.lines : []) as Line[]) {
      const t = taken.get(l.itemId) ?? { net: 0, tip: 0 };
      t.net += Number(l.netCents) || 0; t.tip += Number(l.tipCents) || 0; taken.set(l.itemId, t);
    }
    const disc = allocate(order.discountCents ?? 0, order.items.map((l) => l.lineTotalCents));
    const chosen = order.items.map((l, i) => ({ l, i })).filter(({ l }) => !itemIds.length || itemIds.includes(l.id));
    const netLeft = chosen.map(({ l, i }) => Math.max(0, l.lineTotalCents - disc[i] - (taken.get(l.id)?.net ?? 0)));
    const tipLeft = chosen.map(({ l }) => Math.max(0, (l.tipCents ?? 0) - (taken.get(l.id)?.tip ?? 0)));
    const netPart = allocate(Math.min(amount, netLeft.reduce((a, b) => a + b, 0)), netLeft);
    const rest = amount - netPart.reduce((a, b) => a + b, 0);
    const tipPart = allocate(Math.min(rest, tipLeft.reduce((a, b) => a + b, 0)), tipLeft);
    return chosen.map(({ l }, k) => ({ itemId: l.id, staffMemberId: l.staffMemberId, kind: String(l.kind), netCents: netPart[k], tipCents: tipPart[k] }))
      .filter((x) => x.netCents || x.tipCents);
  }

  /**
   * Who allows this refund / void. Someone who may do it alone (the owner, a
   * manager, anyone the owner gave "refund & void") is their own approval.
   * Anyone else at the till needs an approver's PIN — an active owner or
   * manager OF THIS SALON whose PIN it is. Five wrong PINs lock the salon's
   * PIN entry for ten minutes.
   */
  async approverFor(user: AuthenticatedUser, tenantId: string, pin?: string): Promise<string> {
    if (hasCapability(user.role, user.staffRole, 'pos.void', user.staffCaps)) return user.userId;
    const clean = String(pin ?? '').trim();
    if (!clean) throw new ForbiddenException('APPROVAL_PIN_REQUIRED: cần PIN của chủ tiệm hoặc quản lý.');
    const now = Date.now();
    const lock = PIN_FAILS.get(tenantId);
    if (lock && lock.until > now && lock.n >= 5) throw new ForbiddenException('Sai PIN quá nhiều lần — thử lại sau 10 phút.');
    const people = await this.prisma.user.findMany({
      where: { tenantId, isActive: true, approvalPinHash: { not: null } } as never,
      select: { id: true, role: true, approvalPinHash: true } as never,
    }) as unknown as { id: string; role: string; approvalPinHash: string }[];
    const cards = people.length
      ? await this.prisma.staffMember.findMany({ where: { tenantId, userId: { in: people.map((p) => p.id) } }, select: { userId: true, staffRole: true, permissions: true } as never }) as unknown as { userId: string; staffRole: string | null; permissions: unknown }[]
      : [];
    // Loaded here, not at the top: bcrypt is a native module, and the till's
    // other paths (and their tests) should not need it.
    const { verifySecret } = await import('../auth/password.util');
    for (const p of people) {
      const sm = cards.find((c) => c.userId === p.id);
      const may = p.role === 'SALON_ADMIN' || (p.role === 'STAFF' && hasCapability('STAFF' as never, (sm?.staffRole ?? null) as never, 'pos.void', cleanStaffCaps(sm?.permissions) ?? undefined));
      if (may && await verifySecret(clean, p.approvalPinHash)) { PIN_FAILS.delete(tenantId); return p.id; }
    }
    const prev = lock && lock.until > now ? lock : { n: 0, until: now + 10 * 60_000 };
    PIN_FAILS.set(tenantId, { n: prev.n + 1, until: prev.until });
    throw new ForbiddenException('PIN không đúng.');
  }

  /** A bill nobody has paid a cent on yet — the only kind that may be deleted. */
  private isDraft(order: { status: string; paidCents?: number | null; tenders?: { amountCents: number }[] }) {
    return order.status === OrderStatus.OPEN && !(order.paidCents ?? 0) && !(order.tenders ?? []).some((t) => t.amountCents > 0);
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
    // Cashier shift: the sale is tagged with the drawer it goes into. A salon
    // that requires a shift cannot ring up a live sale without one — except a
    // queued offline sale, whose money is already in the drawer.
    const shiftId = await this.shifts.openShiftId(tenantId);
    if (!shiftId && (pos as { requireShift?: boolean }).requireShift && !dto.offline) {
      throw new BadRequestException('SHIFT_REQUIRED');
    }

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
        // Whose appointment this line belongs to on a group ticket. Not stored
        // on the order row — it only has to survive until the write-back below.
        appointmentId: it.appointmentId ?? null,
        // Party checkout: where the line came from on the floor. Stored.
        walkInId: it.walkInId ?? null,
        walkInLineId: it.walkInLineId ?? null,
        guestName: it.guestName?.trim().slice(0, 80) || null,
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
    // Money the customer already paid online for the booking(s) on this ticket
    // (a deposit, or the whole visit): it is credited, never charged again.
    const namedAppts = [...new Set([...(dto.appointmentId ? [dto.appointmentId] : []), ...(dto.appointmentIds ?? [])].filter(Boolean))];
    const depositApplied = namedAppts.length ? Math.min(Math.max(0, totalCents - giftApplied), await this.prepaidCents(tenantId, namedAppts)) : 0;
    const amountDue = Math.max(0, totalCents - giftApplied - depositApplied);

    const tenderSum = (dto.tenders ?? []).reduce((s, t) => s + t.amountCents, 0);
    const hasTenders = (dto.tenders ?? []).length > 0;
    if (hasTenders && tenderSum < amountDue) {
      throw new BadRequestException('Tendered amount is less than the amount due');
    }
    // A gift card can close the ticket on its own; otherwise the tenders must
    // cover the remaining amount due.
    const paid = (giftApplied > 0 || depositApplied > 0 || hasTenders) && giftApplied + depositApplied + tenderSum >= totalCents;
    // Change is cash handed back. Anything over the due on a card is the card
    // surcharge (kept in the card's ledger row), never "change".
    const cashIn = (dto.tenders ?? []).some((t) => t.method === 'CASH');
    const changeCents = paid && cashIn ? Math.max(0, tenderSum - amountDue) : 0;
    // A sale rung up offline is dated when it was sold, not when it synced
    // (bounded: the last 7 days, never the future).
    const soldAt = (() => {
      if (!dto.offline || !dto.soldAt) return null;
      const d = new Date(dto.soldAt);
      const now = Date.now();
      return Number.isNaN(d.getTime()) || d.getTime() > now || d.getTime() < now - 7 * 86400000 ? null : d;
    })();
    const rules = await this.settings.getBookingRules(tenantId);
    const currency = rules.currency || 'USD';

    // Denormalize the sale's channel so reports can split revenue by source.
    // Appointment sale -> the booking's channel; otherwise it is an in-person
    // walk-in / counter sale.
    let orderSource: string = 'walkin';
    if (dto.appointmentId) {
      const appt = await this.prisma.appointment.findFirst({ where: { id: dto.appointmentId, tenantId }, select: { source: true } });
      orderSource = normalizeSource(appt?.source);
    }
    // A checked-in booking is paid through its floor ticket, and the till's
    // links often carry only the ticket. Read the booking off the ticket so the
    // order names it (payroll then never counts that visit twice) and a booking
    // still at ARRIVED is completed like any other checkout.
    let seatedIds: string[] = [];
    let seatedToClose: string[] = [];
    const ticketIds = [...new Set([...(dto.walkInId ? [dto.walkInId] : []), ...(dto.walkInIds ?? [])].filter(Boolean))];
    if (paid && ticketIds.length) {
      try {
        const named = new Set([...(dto.appointmentId ? [dto.appointmentId] : []), ...(dto.appointmentIds ?? [])]);
        const linked = await this.prisma.walkIn.findMany({ where: { tenantId, id: { in: ticketIds }, appointmentId: { not: null } }, select: { appointmentId: true } });
        seatedIds = [...new Set(linked.map((w) => w.appointmentId).filter((x): x is string => !!x && !named.has(x)))];
        if (seatedIds.length) {
          const open = await this.prisma.appointment.findMany({ where: { tenantId, id: { in: seatedIds }, status: AppointmentStatus.ARRIVED }, select: { id: true } });
          seatedToClose = open.map((a) => a.id);
        }
      } catch { seatedIds = []; seatedToClose = []; }
    }
    const order = await this.prisma.$transaction(async (tx) => {
      // Next order number for this tenant.
      const last = await tx.order.findFirst({
        where: { tenantId },
        orderBy: { orderNumber: 'desc' },
        select: { orderNumber: true },
      });
      const orderNumber = (last?.orderNumber ?? 0) + 1;

      // Every appointment this ticket closes. A solo checkout is just the one;
      // a party paying together lists all of them, and the first stays in
      // appointmentId so reports written before groups existed keep working.
      const apptIds = [...new Set([
        ...(dto.appointmentId ? [dto.appointmentId] : []),
        ...(dto.appointmentIds ?? []),
        ...seatedToClose,
      ].filter(Boolean))];
      const linkedApptIds = [...new Set([...apptIds, ...seatedIds])];
      // Every floor ticket this sale settles; the first stays in walkInId.
      const walkInIds = [...new Set([
        ...(dto.walkInId ? [dto.walkInId] : []),
        ...(dto.walkInIds ?? []),
      ].filter(Boolean))];
      const created = await tx.order.create({
        data: {
          tenantId,
          orderNumber,
          status: paid ? OrderStatus.PAID : OrderStatus.OPEN,
          customerId: dto.customerId ?? null,
          appointmentId: dto.appointmentId ?? linkedApptIds[0] ?? null,
          appointmentIds: linkedApptIds,
          walkInId: dto.walkInId ?? walkInIds[0] ?? null,
          walkInIds,
          source: orderSource,
          createdByUserId: user.userId,
          subtotalCents: subtotal,
          discountCents: orderDiscount,
          taxCents,
          tipCents,
          totalCents,
          paidCents: paid ? giftApplied + depositApplied + tenderSum : 0,
          // Payroll, the sales report and performance read sales by paidAt.
          paidAt: paid ? (soldAt ?? new Date()) : null,
          ...(soldAt ? { createdAt: soldAt } : {}),
          changeCents,
          currency,
          giftCardCode: paid && giftApplied > 0 ? giftCode ?? null : null,
          giftCardAppliedCents: paid ? giftApplied : 0,
          note: dto.note ?? null,
          clientRef: dto.clientRef ?? null,
          ...(shiftId ? { shiftId } : {}),
        } as never,
      });

      // Line items + tenders via createMany (carries the scalar tenantId/orderId).
      await tx.orderItem.createMany({
        // appointmentId is a checkout-time hint, not a column on the row.
        data: lines.map(({ appointmentId: _owner, ...l }) => ({ ...l, tenantId, orderId: created.id })) as never,
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
        // Mirror NEW money into the Payment ledger so dashboard revenue includes POS
        // sales — ONE ledger row PER tender method, so a split bill (part cash, part
        // card) is reported accurately instead of lumping the whole ticket under the
        // first method. The gift-card portion is excluded (already counted as revenue
        // when the card was sold), and cash change is subtracted from the cash line so
        // the ledger reflects money actually kept, not money handed over.
        if (amountDue > 0) {
          // Shared with the report and the till, so the three can never
          // disagree about what a tender is. MoMo and ZaloPay get their own
          // provider string; the original three are unchanged because revenue
          // queries elsewhere match on them.
          const providerFor = ledgerProviderFor;
          // Collapse tenders by method (a cashier might add two cash notes).
          const byMethod = new Map<string, number>();
          for (const t of dto.tenders ?? []) byMethod.set(t.method, (byMethod.get(t.method) ?? 0) + t.amountCents);
          // Cash change reduces the cash kept. If there was no cash tender the change
          // is 0 anyway (card/transfer are charged exact).
          if (changeCents > 0 && byMethod.has('CASH')) byMethod.set('CASH', (byMethod.get('CASH') ?? 0) - changeCents);
          for (const [method, gross] of byMethod) {
            const kept = Math.max(0, gross);
            if (kept <= 0) continue;
            await tx.payment.create({
              data: {
                tenantId,
                appointmentId: dto.appointmentId ?? null,
                amountCents: kept,
                currency: created.currency,
                type: PaymentType.PAY_LATER,
                status: PaymentStatus.PAID,
                provider: providerFor(method),
                providerReference: `order:${created.id}`,
                paidAt: soldAt ?? new Date(),
              },
            });
          }
        }
        // Checking out a booking completes it — and writes the till's version of
        // the visit back onto the appointment. A cashier who adds a service at
        // checkout used to leave the calendar showing the old price and the old
        // finish time; now the two agree. The first service line stays the
        // primary (it is what serviceId points at); the rest become stored
        // lines, exactly as the booking form records them.
        // A party settling on one ticket closes EVERY appointment on it, and
        // each person's own lines are written back to their own appointment.
        // Piling the group's total onto the first one would leave the others
        // pending, show three people as zero revenue, and count them twice the
        // day someone marked them done by hand.
        for (const targetApptId of apptIds) {
          const appt = await tx.appointment.findFirst({
            where: { id: targetApptId, tenantId },
            select: { serviceId: true, startTime: true, endTime: true },
          });
          const apptData: Prisma.AppointmentUpdateManyMutationInput = {
            status: AppointmentStatus.COMPLETED,
            completedAt: new Date(),
          };
          if (appt) {
            // Lines tagged for this person; when nothing is tagged (a normal
            // single checkout) the whole ticket belongs to them.
            const mine = apptIds.length > 1
              ? lines.filter((l) => l.appointmentId === targetApptId)
              : lines;
            const svcLines = mine.filter((l) => l.kind === OrderItemKind.SERVICE);
            if (svcLines.length > 0) {
              // Durations come from the catalogue; a product line adds no time.
              const ids = [...new Set(svcLines.map((l) => l.serviceId).filter((x): x is string => !!x))];
              const svcs = ids.length
                ? await tx.service.findMany({ where: { id: { in: ids }, tenantId }, select: { id: true, durationMinutes: true } })
                : [];
              const mins = new Map(svcs.map((x) => [x.id, x.durationMinutes]));
              const primaryIdx = svcLines.findIndex((l) => l.serviceId === appt.serviceId);
              const rest = svcLines.filter((_, i) => i !== (primaryIdx >= 0 ? primaryIdx : 0));
              const extraLines = rest.map((l) => ({
                id: l.serviceId ?? undefined,
                name: l.name,
                priceCents: l.lineTotalCents,
                durationMinutes: l.serviceId ? (mins.get(l.serviceId) ?? 0) : 0,
                kind: (l.serviceId ? 'service' : 'addon') as 'service' | 'addon',
                staffMemberId: l.staffMemberId,
              }));
              const totalMinutes = svcLines.reduce(
                (sum, l) => sum + (l.serviceId ? (mins.get(l.serviceId) ?? 0) : 0) * l.quantity, 0,
              );
              // Never shrink a visit that already ran long; only extend it.
              const currentMinutes = Math.round((appt.endTime.getTime() - appt.startTime.getTime()) / 60000);
              const minutes = Math.max(5, Math.max(currentMinutes, totalMinutes));
              apptData.priceCents = svcLines.reduce((sum, l) => sum + l.lineTotalCents, 0);
              apptData.addons = extraLines as unknown as Prisma.InputJsonValue;
              apptData.endTime = new Date(appt.startTime.getTime() + minutes * 60000);
            }
          }
          await tx.appointment.updateMany({ where: { id: targetApptId, tenantId }, data: apptData });
        }
        // "Complete" pressed before the checkout wrote a balance row (and points)
        // for the booking; the till's own rows are the real money now.
        if (paid && linkedApptIds.length) {
          const balance = await tx.payment.findMany({
            where: { tenantId, appointmentId: { in: linkedApptIds }, status: PaymentStatus.PAID, type: PaymentType.PAY_LATER, providerReference: null },
            select: { id: true },
          });
          for (const b of balance) {
            await tx.payment.updateMany({ where: { id: b.id, tenantId }, data: { status: PaymentStatus.REFUNDED, providerReference: `superseded:order:${created.id}` } });
            await this.loyalty.reverseForRef(tx, tenantId, 'appointment', b.id, 'Paid at the till');
          }
        }
        // Checking out a walk-in marks it Done (front desk doesn't need a second
        // step); a party on one bill closes every ticket it settled.
        if (walkInIds.length) {
          // A visit already Done (closed unpaid on an earlier day, or "Xong" before
          // paying) keeps its doneAt: its turn stays on the day the work was done.
          await tx.walkIn.updateMany({
            where: { id: { in: walkInIds }, tenantId, status: { not: WalkInStatus.DONE } },
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

    // Paying for a walk-in ends its turn, which frees a chair — so the person
    // who has waited longest goes into it now, not when somebody at the desk
    // notices. After the transaction and swallowing its own failure: a payment
    // that is taken must stay taken.
    if (dto.walkInId || dto.walkInIds?.length) await this.walkins?.seatWaitingQueue(tenantId).catch(() => []);

    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: paid ? 'order.paid' : 'order.created',
      resourceType: 'order',
      resourceId: order?.id,
      metadata: { orderNumber: order?.orderNumber, totalCents },
    });

    // "How was your visit?" — one per paid sale, when the salon has it on. The
    // token rides back to the till so the customer iPad can ask right now.
    // createForOrder never throws; a sale that is taken stays taken.
    let feedback: { token: string | null; status: string; receiptQr?: boolean } | null = null;
    if (paid && order && this.feedback) {
      feedback = await this.feedback.createForOrder(tenantId, order as never);
    }

    return feedback && order ? { ...order, feedback } : order;
  }

  /** Void an order: no revenue. Refunds the mirrored payment and restocks. */
  /**
   * WHO GETS THE CREDIT, FIXED AFTER THE FACT.
   *
   * A line rung up with no technician (or the wrong one) used to be
   * uncorrectable: the only way out was voiding the bill and ringing it again,
   * which loses the tender, the receipt number and the client's loyalty
   * points — so nobody did it, and payroll quietly paid the wrong person or
   * no one. This changes ONLY the credited technician on chosen lines; money,
   * tax, tips and tenders are untouched. Refused once the bill's day is in a
   * finalised payroll, logged every time.
   */
  async setLineStaff(user: AuthenticatedUser, id: string, items: { itemId: string; staffMemberId: string | null }[]) {
    const tenantId = this.tenantId(user);
    const order = await this.prisma.order.findFirst({ where: { id, tenantId }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === OrderStatus.VOID) throw new BadRequestException('Bill này đã huỷ.');
    await this.assertOpenPayroll(tenantId, order);
    const wanted = (items ?? []).filter((x) => x && typeof x.itemId === 'string').slice(0, 50);
    if (!wanted.length) throw new BadRequestException('Chưa chọn dòng nào.');
    const staffIds = Array.from(new Set(wanted.map((x) => x.staffMemberId).filter((x): x is string => typeof x === 'string' && x.length > 0)));
    const staff = staffIds.length
      ? await this.prisma.staffMember.findMany({ where: { tenantId, id: { in: staffIds } }, select: { id: true } })
      : [];
    const known = new Set(staff.map((x) => x.id));
    const changes: { itemId: string; from: string | null; to: string | null }[] = [];
    for (const w of wanted) {
      const line = order.items.find((it) => it.id === w.itemId);
      if (!line) throw new NotFoundException('Dòng không thuộc bill này.');
      const to = w.staffMemberId || null;
      if (to && !known.has(to)) throw new BadRequestException('Thợ không thuộc tiệm này.');
      if ((line.staffMemberId ?? null) === to) continue;
      changes.push({ itemId: line.id, from: line.staffMemberId ?? null, to });
    }
    if (changes.length) {
      await this.prisma.$transaction(changes.map((c) =>
        this.prisma.orderItem.updateMany({ where: { id: c.itemId, orderId: order.id }, data: { staffMemberId: c.to } }),
      ));
      await this.audit.log({ tenantId, userId: user.userId, action: 'pos.order_staff_changed', resourceType: 'order', resourceId: order.id, metadata: { orderNumber: order.orderNumber, changes } });
    }
    return this.getOrder(user, id);
  }

  /**
   * Re-split the tip of a paid bill between its lines (the client said "the
   * tip is for both of them", the cashier put it all on one). The tip the
   * client paid does not change — the new split must add up to it — only who
   * gets it. Owner only (controller); refused inside a closed payroll.
   */
  async setLineTips(user: AuthenticatedUser, id: string, items: { itemId: string; tipCents: number }[]) {
    const tenantId = this.tenantId(user);
    const order = await this.prisma.order.findFirst({ where: { id, tenantId }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.PAID) throw new BadRequestException('Chỉ chia lại tip trên bill đã thu.');
    await this.assertOpenPayroll(tenantId, order);
    const next = new Map(order.items.map((l) => [l.id, l.tipCents ?? 0]));
    for (const w of (items ?? []).slice(0, 50)) {
      if (!next.has(String(w?.itemId))) throw new NotFoundException('Dòng không thuộc bill này.');
      const v = Math.round(Number(w.tipCents));
      if (!Number.isFinite(v) || v < 0) throw new BadRequestException('Tip không hợp lệ.');
      next.set(String(w.itemId), v);
    }
    const before = order.items.reduce((n, l) => n + (l.tipCents ?? 0), 0);
    const after = [...next.values()].reduce((n, v) => n + v, 0);
    if (after !== before) throw new BadRequestException(`Tổng tip phải giữ nguyên ${(before / 100).toFixed(2)} — chỉ chia lại giữa các thợ.`);
    const changes = order.items.filter((l) => (l.tipCents ?? 0) !== next.get(l.id)).map((l) => ({ itemId: l.id, staffMemberId: l.staffMemberId, from: l.tipCents ?? 0, to: next.get(l.id) ?? 0 }));
    if (changes.length) {
      await this.prisma.$transaction(changes.map((c) =>
        this.prisma.orderItem.updateMany({ where: { id: c.itemId, orderId: order.id }, data: { tipCents: c.to } }),
      ));
      await this.audit.log({ tenantId, userId: user.userId, action: 'pos.order_tips_changed', resourceType: 'order', resourceId: order.id, metadata: { orderNumber: order.orderNumber, changes } });
    }
    return this.getOrder(user, id);
  }

  /**
   * May this bill still be voided by this person? A void says the sale never
   * happened, so it belongs to the shift it was rung up in: once that shift
   * is closed (or, for a salon without shifts, once its day is over) only the
   * owner may void it — anyone else refunds instead, which leaves the closed
   * count alone.
   */
  private async voidWindow(user: AuthenticatedUser, tenantId: string, order: { shiftId?: string | null; paidAt?: Date | null; createdAt?: Date | null }): Promise<string | null> {
    if (user.role === 'SALON_ADMIN' || user.role === 'SUPER_ADMIN') return null;
    if (order.shiftId) {
      const db = this.prisma as unknown as { cashShift: { findFirst: (a: unknown) => Promise<{ status: string } | null> } };
      const s = await db.cashShift.findFirst({ where: { id: order.shiftId, tenantId }, select: { status: true } }).catch(() => null);
      return s && s.status !== 'OPEN' ? 'Ca của bill này đã chốt — dùng Hoàn tiền (chỉ chủ tiệm huỷ được bill của ca đã chốt).' : null;
    }
    const tz = await this.tzOf(tenantId);
    const at = order.paidAt ?? order.createdAt;
    return at && dayKeyTz(new Date(at), tz) !== dayKeyTz(new Date(), tz) ? 'Bill của ngày đã qua — dùng Hoàn tiền (chỉ chủ tiệm huỷ được).' : null;
  }

  /**
   * Paid service lines with no technician, newest first — the payroll screen's
   * fix-it list. Limited to a window so the query stays small; the ledger's
   * "unassigned" total is the number that says whether to look.
   */
  async unassignedLines(user: AuthenticatedUser, from?: string, to?: string) {
    const tenantId = this.tenantId(user);
    const tz = await this.tzOf(tenantId);
    const dayKey = (d: Date) => dayKeyTz(d, tz);
    const since = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? new Date(`${from}T00:00:00Z`).getTime() - 86_400_000 : Date.now() - 45 * 86_400_000;
    const orders = await this.prisma.order.findMany({
      where: { tenantId, status: OrderStatus.PAID, paidAt: { gte: new Date(since) }, items: { some: { kind: 'SERVICE', staffMemberId: null } } },
      include: ORDER_INCLUDE,
      orderBy: { paidAt: 'desc' },
      take: 200,
    });
    type Row = { o: (typeof orders)[number]; day: string };
    const rows: Row[] = orders
      .map((o): Row => ({ o, day: dayKey(o.paidAt ?? o.createdAt) }))
      .filter((r: Row) => (!from || r.day >= from) && (!to || r.day <= to));
    const custIds: string[] = Array.from(new Set(rows.map((r: Row) => r.o.customerId as string | null).filter((x): x is string => Boolean(x))));
    const customers = custIds.length
      ? await this.prisma.customer.findMany({ where: { tenantId, id: { in: custIds } }, select: { id: true, firstName: true, lastName: true } }).catch(() => [])
      : [];
    const cname = new Map(customers.map((c) => [c.id, [c.firstName, c.lastName].filter(Boolean).join(' ')]));
    return {
      orders: rows.map(({ o, day }: Row) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        day,
        paidAt: (o.paidAt ?? o.createdAt).toISOString(),
        customerName: o.customerId ? (cname.get(o.customerId) ?? null) : null,
        items: o.items
          .filter((it) => it.kind === 'SERVICE' && !it.staffMemberId)
          .map((it) => ({ id: it.id, name: it.name, lineTotalCents: it.lineTotalCents })),
      })),
    };
  }

  /**
   * THE END-OF-DAY CHECK — what today still owes the books.
   *
   * Three things leak revenue, and each one leaks silently: a walk-in that
   * was served and never rung up (closed at midnight with no sale), a paid
   * line nobody is credited with (no commission), and a booking that was
   * completed by hand instead of at the till (counts at list price only). The
   * till's "chốt ca" step reads this and shows the three lists with their
   * one-tap fixes. Nothing here blocks closing: it is a checklist, not a gate.
   */
  async dayCheck(user: AuthenticatedUser, dayStr?: string, now: Date = new Date()) {
    const tenantId = this.tenantId(user);
    const tz = await this.tzOf(tenantId);
    const day = dayStr && /^\d{4}-\d{2}-\d{2}$/.test(dayStr) ? dayStr : dayKeyTz(now, tz);
    const from = startOfDayTz(day, tz);
    const to = startOfDayTz(addDaysToKey(day, 1), tz);
    const dayOf = (d: Date) => dayKeyTz(d, tz);

    const [walkIns, orders, appts] = await Promise.all([
      // Served, waiting to be paid: still in the chair-queue (SERVING) or
      // finished today (DONE) — either way no sale has closed the ticket.
      this.prisma.walkIn.findMany({
        where: { tenantId, awaitingPayment: true, OR: [{ status: WalkInStatus.SERVING }, { status: WalkInStatus.DONE, doneAt: { gte: from, lt: to } }] },
        select: { id: true, customerName: true, status: true, createdAt: true, assignedAt: true, doneAt: true, items: true, assignedStaffId: true },
        orderBy: { createdAt: 'asc' }, take: 100,
      }),
      this.prisma.order.findMany({
        where: { tenantId, status: OrderStatus.PAID, paidAt: { gte: from, lt: to } },
        select: { id: true, orderNumber: true, paidAt: true, walkInId: true, walkInIds: true, appointmentId: true, appointmentIds: true, items: { select: { id: true, kind: true, name: true, lineTotalCents: true, staffMemberId: true, walkInId: true } } },
        take: 500,
      }),
      this.prisma.appointment.findMany({
        where: { tenantId, startTime: { gte: from, lt: to }, status: { in: [AppointmentStatus.ASSIGNED, AppointmentStatus.ACCEPTED, AppointmentStatus.CONFIRMED, AppointmentStatus.ARRIVED, AppointmentStatus.COMPLETED] } },
        select: { id: true, startTime: true, status: true, completedAt: true, priceCents: true, customer: { select: { firstName: true, lastName: true } } },
        orderBy: { startTime: 'asc' }, take: 300,
      }),
    ]);

    const settled = settledWalkIns(orders);
    const unpaid = walkIns
      .filter((w) => !settled.has(w.id))
      .map((w) => ({
        id: w.id, customerName: w.customerName ?? null, status: w.status,
        at: (w.doneAt ?? w.assignedAt ?? w.createdAt).toISOString(),
        services: (Array.isArray(w.items) ? (w.items as { name?: string }[]) : []).map((i) => i?.name).filter((n): n is string => typeof n === 'string').slice(0, 4),
      }));

    const unassigned = orders
      .map((o) => ({ orderId: o.id, orderNumber: o.orderNumber, items: o.items.filter((it) => it.kind === 'SERVICE' && !it.staffMemberId).map((it) => ({ id: it.id, name: it.name, lineTotalCents: it.lineTotalCents })) }))
      .filter((o) => o.items.length > 0);

    const paidAppt = new Set<string>();
    for (const o of orders) { if (o.appointmentId) paidAppt.add(o.appointmentId); for (const x of o.appointmentIds ?? []) paidAppt.add(x); }
    const name = (a: { customer?: { firstName?: string | null; lastName?: string | null } | null }) => [a.customer?.firstName, a.customer?.lastName].filter(Boolean).join(' ') || null;
    // Bookings whose time has come and gone with nothing recorded: no sale,
    // not completed, not cancelled. Tomorrow they are simply forgotten.
    const openBookings = appts
      .filter((a) => a.status !== AppointmentStatus.COMPLETED && !paidAppt.has(a.id) && a.startTime.getTime() < now.getTime())
      .map((a) => ({ id: a.id, customerName: name(a), startTime: a.startTime.toISOString(), status: a.status }));
    // Completed by hand, never rung up: counted at list price only (no
    // discount, tip, tax or payment method) — "ước tính" in every report.
    const estimated = appts
      .filter((a) => a.status === AppointmentStatus.COMPLETED && !paidAppt.has(a.id))
      .filter((a) => !a.completedAt || dayOf(a.completedAt) === day || dayOf(a.startTime) === day)
      .map((a) => ({ id: a.id, customerName: name(a), startTime: a.startTime.toISOString(), priceCents: a.priceCents }));

    return {
      day, tz,
      unpaid, unassigned, openBookings, estimated,
      counts: { unpaid: unpaid.length, unassigned: unassigned.reduce((n, o) => n + o.items.length, 0), openBookings: openBookings.length, estimated: estimated.length },
    };
  }

  async voidOrder(user: AuthenticatedUser, id: string, opts: { reason?: string; note?: string; approvalPin?: string } = {}) {
    const tenantId = this.tenantId(user);
    const approvedBy = await this.approverFor(user, tenantId, opts.approvalPin);
    const order = await this.prisma.order.findFirst({ where: { id, tenantId }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status === OrderStatus.VOID) return order;
    if (order.status === OrderStatus.REFUNDED) throw new BadRequestException('Bill này đã hoàn tiền toàn bộ.');
    await this.assertOpenPayroll(tenantId, order);
    const closed = await this.voidWindow(user, tenantId, order);
    if (closed) throw new BadRequestException(closed);
    // Part of it already went back: voiding now would say the sale never
    // happened while the drawer is short the refund. Refund the rest instead.
    if (((await this.refundedByOrder(tenantId, [id])).get(id) ?? 0) > 0) {
      throw new BadRequestException('Bill đã có hoàn tiền — hoàn tiếp phần còn lại thay vì huỷ.');
    }
    const reason = String(opts.reason ?? '').trim().slice(0, 120) || null;
    const note = String(opts.note ?? '').trim().slice(0, 300) || null;

    await this.prisma.$transaction(async (tx) => {
      await tx.order.updateMany({ where: { id, tenantId }, data: { status: OrderStatus.VOID } });
      if (order.status === OrderStatus.PAID) await this.reopenBookingsOf(tx, tenantId, order);
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

    await this.audit.log({ tenantId, userId: user.userId, action: 'order.voided', resourceType: 'order', resourceId: id, metadata: { reason, note, totalCents: order.totalCents, approvedByUserId: approvedBy } });
    return this.getOrder(user, id);
  }

  /**
   * Give money back on a paid bill.
   *
   * The sale is not rewritten. Big tills (Square, Toast, Clover) record a
   * refund as its own movement of money tied to the sale, on the day it went
   * back — this follows them and the card-terminal refund already here:
   *  - PART of it: one negative ledger row on today's date. Revenue and the
   *    money collected drop today; the bill, its technicians' sales and the
   *    closed days stay as they were.
   *  - ALL of it, in one go: the sale is taken off the books like a void
   *    (revenue, commission and tips, stock, gift card, points reverse) but
   *    the visit still happened, so its booking is NOT reopened. The bill
   *    shows "Refunded" instead of "Voided".
   * Cash handed back from the drawer is written into the open cashier shift
   * as cash out, so the count at closing still matches.
   * A charge taken on Lumio's own card terminal goes back through the
   * terminal (Orders › Card terminal), which records itself — refused here so
   * it can never be counted twice.
   */
  async refundOrder(user: AuthenticatedUser, id: string, dto: { amountCents?: number; method?: string; reason?: string; note?: string; itemIds?: string[]; approvalPin?: string }) {
    const tenantId = this.tenantId(user);
    const approvedBy = await this.approverFor(user, tenantId, dto.approvalPin);
    const order = await this.prisma.order.findFirst({ where: { id, tenantId }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('Order not found');
    if (order.status !== OrderStatus.PAID) throw new BadRequestException('Chỉ hoàn được bill đã thu tiền.');
    const reason = String(dto.reason ?? '').trim().slice(0, 120);
    if (!reason) throw new BadRequestException('Chọn lý do hoàn tiền.');
    const note = String(dto.note ?? '').trim().slice(0, 300) || null;
    const method = String(dto.method ?? '').trim().toUpperCase();
    if (!isPaymentMethod(method)) throw new BadRequestException('Chọn cách hoàn tiền.');
    const amount = Math.round(Number(dto.amountCents));
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Số tiền hoàn phải lớn hơn 0.');

    const ref = `order:${id}`;
    const rows = await this.prisma.payment.findMany({ where: { tenantId, providerReference: ref, status: PaymentStatus.PAID }, select: { amountCents: true } });
    const collected = rows.reduce((n, r) => n + r.amountCents, 0);
    const alreadyBack = -rows.filter((r) => r.amountCents < 0).reduce((n, r) => n + r.amountCents, 0);
    if (collected <= 0) throw new BadRequestException('Bill này không còn tiền để hoàn.');
    if (amount > collected) throw new BadRequestException(`Tối đa hoàn được ${(collected / 100).toFixed(2)} ${order.currency}.`);
    if (method === 'CARD') {
      const viaTerminal = await this.prisma.paymentIntentRecord.findFirst({
        where: { tenantId, status: 'SUCCEEDED', OR: [{ orderId: id }, ...(order.clientRef ? [{ clientRef: `${order.clientRef}-card` }] : [])] },
        select: { id: true },
      }).catch(() => null);
      if (viaTerminal) throw new BadRequestException('Bill này quẹt qua máy thẻ nối với Lumio — hoàn ở Đơn hàng › Máy quẹt thẻ để tiền về đúng thẻ của khách.');
    }
    const itemIds = (Array.isArray(dto.itemIds) ? dto.itemIds : []).map(String).filter((x) => order.items.some((l) => l.id === x)).slice(0, 50);
    const full = amount === collected && alreadyBack === 0;
    if (full) await this.assertOpenPayroll(tenantId, order);
    // Which technician's lines the money came off (part refunds only — a full
    // refund takes the whole bill off the books).
    const lines = full ? [] : await this.refundSplit(tenantId, order, amount, itemIds);
    const openShift = await this.shifts.openShiftId(tenantId).catch(() => null);

    await this.prisma.$transaction(async (tx) => {
      if (full) {
        await tx.order.updateMany({ where: { id, tenantId }, data: { status: OrderStatus.REFUNDED } });
        await tx.payment.updateMany({ where: { tenantId, providerReference: ref, status: PaymentStatus.PAID }, data: { status: PaymentStatus.REFUNDED } });
        for (const l of order.items) {
          if (l.kind === OrderItemKind.PRODUCT && l.productId) {
            await tx.product.updateMany({ where: { id: l.productId, tenantId, trackStock: true }, data: { stockQty: { increment: l.quantity } } });
          }
        }
        await this.recreditGiftCards(tx, tenantId, id, user.userId);
        await this.loyalty.reverseForRef(tx, tenantId, 'order', id, 'Order refunded');
      } else {
        await tx.payment.create({
          data: {
            tenantId, appointmentId: null, amountCents: -amount, currency: order.currency || 'USD',
            type: PaymentType.PAY_LATER, status: PaymentStatus.PAID, provider: ledgerProviderFor(method),
            providerReference: ref, paidAt: new Date(),
          },
        });
      }
      const rdb = tx as unknown as { orderRefund: { create: (a: unknown) => Promise<unknown> } };
      await rdb.orderRefund.create({
        data: { tenantId, orderId: id, amountCents: amount, method, reason, note, lines: lines as never, full, createdByUserId: user.userId },
      });
      // Cash out of the drawer. A full refund of a sale rung up in THIS shift
      // already leaves the shift's totals (the sale is off the books), so only
      // the other cases need the movement.
      if (method === 'CASH' && openShift && !(full && order.shiftId === openShift)) {
        const db = tx as unknown as { cashMovement: { create: (a: unknown) => Promise<unknown> } };
        await db.cashMovement.create({ data: { tenantId, shiftId: openShift, kind: 'OUT', amountCents: amount, reason: `Hoàn tiền bill #${order.orderNumber}`.slice(0, 200), source: 'refund', byUserId: user.userId, byName: null } });
      }
    });

    await this.audit.log({
      tenantId, userId: user.userId, action: 'order.refunded', resourceType: 'order', resourceId: id,
      metadata: { amountCents: amount, method, reason, note, itemIds, full, approvedByUserId: approvedBy },
    });
    return this.orderDetail(user, id);
  }

  /** Permanently delete an order (admin cleanup): reverses revenue, restocks if it
   *  was a live paid sale, then removes the order (items + tenders cascade). */
  async removeOrder(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const order = await this.prisma.order.findFirst({ where: { id, tenantId }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('Order not found');
    // Money is never deleted. A bill that took payment keeps its number in
    // the list — voided or refunded, with the reason — so the books never
    // have a hole in them. Only a draft nobody paid on can go.
    if (!this.isDraft(order)) {
      throw new BadRequestException('Bill đã thu tiền không xoá được — dùng Huỷ bill hoặc Hoàn tiền. Bill vẫn ở lại danh sách để sổ sách không mất số.');
    }

    await this.assertOpenPayroll(tenantId, order);
    // Snapshot the whole receipt (header + lines) before anything is undone, so
    // a deleted sale can be reconstructed from the bin.
    const mirrored = await this.prisma.payment.findMany({ where: { tenantId, providerReference: `order:${id}` } });
    const label = `#${order.orderNumber} · ${(order.totalCents / 100).toFixed(2)} ${order.currency}`;

    await this.prisma.$transaction(async (tx) => {
      await this.trash.capture(tx, {
        tenantId, entity: 'order', entityId: id, label,
        snapshot: { order, payments: mirrored },
        deletedByUserId: user.userId,
      });
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
      if (order.status === OrderStatus.PAID) await this.reopenBookingsOf(tx, tenantId, order);
      // Remove the revenue mirror so the deleted sale never counts.
      await tx.payment.deleteMany({ where: { tenantId, providerReference: `order:${id}` } });
      // Delete the order; order_items + order_payments cascade via FK.
      await tx.order.deleteMany({ where: { id, tenantId } });
    });

    await this.audit.log({ tenantId, userId: user.userId, action: 'order.deleted', resourceType: 'order', resourceId: id });
    return { id, deleted: true };
  }

  /** A paid sale inside a closed (FINAL) payroll is frozen: reopen the payroll first. */
  private async assertOpenPayroll(tenantId: string, order: { status: string; paidAt?: Date | null; createdAt?: Date | null }) {
    if (order.status !== OrderStatus.PAID) return;
    const at = order.paidAt ?? order.createdAt;
    if (!at) return;
    const runs = await this.prisma.payrollRun.findMany({ where: { tenantId, status: 'FINAL' }, select: { periodFrom: true, periodTo: true } }).catch(() => [] as { periodFrom: string; periodTo: string }[]);
    if (!runs.length) return;
    const day = dayKeyTz(new Date(at), await this.tzOf(tenantId));
    if (runs.some((r) => day >= String(r.periodFrom) && day <= String(r.periodTo))) {
      throw new BadRequestException('Bill này nằm trong kỳ lương đã chốt — mở lại kỳ lương trước khi huỷ hoặc xoá.');
    }
  }

  /** What was already paid online (deposits, prepaid visits) for these bookings. */
  private async prepaidCents(tenantId: string, appointmentIds: string[]): Promise<number> {
    try {
      const rows = await this.prisma.payment.findMany({
        where: { tenantId, appointmentId: { in: appointmentIds }, status: PaymentStatus.PAID, type: PaymentType.PAY_ONLINE },
        select: { amountCents: true },
      });
      return rows.reduce((s, r) => s + (r.amountCents ?? 0), 0);
    } catch { return 0; }
  }

  /** The till's view of a booking's prepaid money, for the cart. */
  async prepaid(user: AuthenticatedUser, idsCsv: string) {
    const tenantId = this.tenantId(user);
    const ids = String(idsCsv ?? '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20);
    if (!ids.length) return { prepaidCents: 0 };
    return { prepaidCents: await this.prepaidCents(tenantId, ids) };
  }

  /**
   * A voided or deleted sale no longer pays for its bookings: they go back to
   * ARRIVED (the customer did come) so payroll stops paying commission on a
   * sale that no longer exists — unless another paid ticket still covers them.
   */
  private async reopenBookingsOf(tx: Prisma.TransactionClient, tenantId: string, order: { id: string; appointmentId?: string | null; appointmentIds?: string[] | null }) {
    const ids = [...new Set([...(order.appointmentId ? [order.appointmentId] : []), ...(order.appointmentIds ?? [])])];
    if (!ids.length) return;
    const others = await tx.order.findMany({
      where: { tenantId, status: OrderStatus.PAID, id: { not: order.id }, OR: [{ appointmentId: { in: ids } }, { appointmentIds: { hasSome: ids } }] },
      select: { appointmentId: true, appointmentIds: true },
    });
    const covered = new Set(others.flatMap((o) => [o.appointmentId, ...(o.appointmentIds ?? [])]).filter(Boolean) as string[]);
    const reopen = ids.filter((x) => !covered.has(x));
    if (reopen.length) {
      await tx.appointment.updateMany({ where: { tenantId, id: { in: reopen }, status: AppointmentStatus.COMPLETED }, data: { status: AppointmentStatus.ARRIVED, completedAt: null } });
    }
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

  /**
   * The sales summary of a period, the way big tills print it:
   *
   *   Gross sales (list price × qty) − discounts − refunds = NET SALES
   *   + tax + tips = TOTAL, and the money actually taken by payment method.
   *
   * From the bills (PAID, and REFUNDED ones whose sale went back in full) by
   * the day they were paid in the salon's own timezone; part refunds on the
   * day the money went back. A voided bill never happened and is in no line.
   * Every query names the caller's salon.
   */
  async salesSummary(user: AuthenticatedUser, fromStr?: string, toStr?: string, cmpFromStr?: string, cmpToStr?: string) {
    const tenantId = this.tenantId(user);
    const tz = await this.tzOf(tenantId);
    const to = toStr ? this.edgeOf(toStr, tz, 'end') : new Date();
    const from = fromStr ? this.edgeOf(fromStr, tz, 'start') : new Date(to.getTime() - 29 * 86400000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw new BadRequestException('Khoảng ngày không hợp lệ.');
    // What it is compared with: the range the screen chose (like-for-like:
    // Oct 1–21 against Sep 1–21), else the same number of days just before.
    const span = to.getTime() - from.getTime() + 1;
    let cFrom = new Date(from.getTime() - span), cTo = new Date(from.getTime() - 1);
    if (cmpFromStr && cmpToStr) {
      const a = this.edgeOf(cmpFromStr, tz, 'start'), b = this.edgeOf(cmpToStr, tz, 'end');
      if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime()) && a <= b) { cFrom = a; cTo = b; }
    }
    const [cur, prev] = await Promise.all([
      this.summaryOf(tenantId, tz, from, to),
      this.summaryOf(tenantId, tz, cFrom, cTo),
    ]);
    return {
      from: dayKeyTz(from, tz), to: dayKeyTz(to, tz),
      ...cur,
      previous: {
        from: dayKeyTz(cFrom, tz), to: dayKeyTz(cTo, tz),
        netCents: prev.totals.netCents, bills: prev.totals.bills, totalCents: prev.totals.totalCents, tipsCents: prev.totals.tipsCents, refundCents: prev.totals.refundCents,
      },
    };
  }

  private async summaryOf(tenantId: string, tz: string, from: Date, to: Date) {
    const [orders, money] = await Promise.all([
      this.prisma.order.findMany({
        where: { tenantId, status: { in: [OrderStatus.PAID, OrderStatus.REFUNDED] }, paidAt: { gte: from, lte: to } },
        select: { status: true, paidAt: true, discountCents: true, taxCents: true, tipCents: true, currency: true, items: { select: { kind: true, unitPriceCents: true, quantity: true, discountCents: true, lineTotalCents: true } } },
      }),
      this.prisma.payment.findMany({
        where: { tenantId, status: PaymentStatus.PAID, paidAt: { gte: from, lte: to } },
        select: { amountCents: true, provider: true, paidAt: true },
      }),
    ]);
    type Day = { day: string; bills: number; grossCents: number; discountCents: number; refundCents: number; netCents: number; taxCents: number; tipsCents: number; totalCents: number };
    const days = new Map<string, Day>();
    const dayOf = (d: Date | null) => {
      const k = dayKeyTz(d ?? from, tz);
      if (!days.has(k)) days.set(k, { day: k, bills: 0, grossCents: 0, discountCents: 0, refundCents: 0, netCents: 0, taxCents: 0, tipsCents: 0, totalCents: 0 });
      return days.get(k)!;
    };
    let serviceCents = 0, productCents = 0, refundedBills = 0;
    let currency: string | null = null;
    for (const o of orders) {
      currency = currency ?? o.currency;
      const gross = o.items.reduce((n, l) => n + l.unitPriceCents * (l.quantity || 1), 0);
      const disc = o.items.reduce((n, l) => n + (l.discountCents ?? 0), 0) + (o.discountCents ?? 0);
      const d = dayOf(o.paidAt);
      d.grossCents += gross; d.discountCents += disc;
      if (o.status === OrderStatus.REFUNDED) { d.refundCents += Math.max(0, gross - disc); refundedBills += 1; continue; }
      d.bills += 1; d.taxCents += o.taxCents ?? 0; d.tipsCents += o.tipCents ?? 0;
      for (const l of o.items) { if (String(l.kind) === 'PRODUCT') productCents += l.lineTotalCents; else serviceCents += l.lineTotalCents; }
    }
    const byMethod = { cash: 0, card: 0, transfer: 0, online: 0 };
    for (const p of money) {
      // Money that went back (a part refund) leaves the day it went back.
      if (p.amountCents < 0) dayOf(p.paidAt).refundCents += -p.amountCents;
      const k = p.provider === 'pos-cash' ? 'cash' : p.provider === 'pos-card' ? 'card' : (p.provider === 'pos-transfer' || p.provider === 'pos-wallet') ? 'transfer' : 'online';
      byMethod[k] += p.amountCents;
    }
    const list = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
    for (const d of list) { d.netCents = d.grossCents - d.discountCents - d.refundCents; d.totalCents = d.netCents + d.taxCents + d.tipsCents; }
    const sum = (k: keyof Omit<Day, 'day'>) => list.reduce((n, d) => n + d[k], 0);
    return {
      currency,
      totals: {
        bills: sum('bills'), refundedBills,
        grossCents: sum('grossCents'), discountCents: sum('discountCents'), refundCents: sum('refundCents'), netCents: sum('netCents'),
        taxCents: sum('taxCents'), tipsCents: sum('tipsCents'), totalCents: sum('totalCents'),
        serviceCents, productCents,
        collectedCents: byMethod.cash + byMethod.card + byMethod.transfer + byMethod.online,
      },
      byMethod,
      days: list,
    };
  }

  async report(user: AuthenticatedUser, fromStr?: string, toStr?: string) {
    const tenantId = this.tenantId(user);
    const tz = await this.tzOf(tenantId);
    const now = new Date();
    const to = toStr ? this.edgeOf(toStr, tz, 'end') : now;
    const from = fromStr ? this.edgeOf(fromStr, tz, 'start') : new Date(to.getTime() - 29 * 86400000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new Error('report range must be YYYY-MM-DD or an ISO instant');
    }

    // Sales per technician come from the shared ledger (payroll/sales-ledger):
    // net of the ticket's discount, tips apart, till-less bookings once. The
    // commission shown here is computed by the same function payroll uses, so
    // the sales report and the payslip can never disagree.
    const [{ ledger, orderCount, extraVisits, orders }, staff, payrollRow] = await Promise.all([
      loadLedger(this.prisma, tenantId, tz, from, to),
      this.prisma.staffMember.findMany({
        where: { tenantId },
        select: { id: true, firstName: true, lastName: true, commissionPercent: true, productCommissionPercent: true } as never,
      }) as unknown as Promise<{ id: string; firstName: string; lastName: string | null; commissionPercent: number; productCommissionPercent?: number }[]>,
      this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: PAYROLL_SETTINGS_KEY } } }),
    ]);
    const paySettings = sanitizeSettings((payrollRow?.value as never) ?? null);
    const staffMap = new Map(staff.map((s) => [s.id, s]));

    type Row = { staffId: string; name: string; commissionPercent: number; serviceCount: number; visits: number; serviceRevenueCents: number; productRevenueCents: number; tipsCents: number; commissionCents: number; baseCents: number; totalPayCents: number; directTipsCents: number };
    const rows = new Map<string, Row>();
    const ensure = (id: string | null) => {
      const key = id ?? 'unassigned';
      if (!rows.has(key)) {
        const s = id ? staffMap.get(id) : null;
        rows.set(key, {
          staffId: key,
          name: s ? `${s.firstName} ${s.lastName ?? ''}`.trim() : 'Unassigned',
          commissionPercent: s?.commissionPercent ?? 0,
          serviceCount: 0, visits: 0,
          serviceRevenueCents: 0, productRevenueCents: 0, tipsCents: 0,
          commissionCents: 0, baseCents: 0, totalPayCents: 0, directTipsCents: 0,
        });
      }
      return rows.get(key)!;
    };

    let totalRevenue = 0, totalTips = 0, totalCommission = 0, totalPay = 0;
    const totalBase = 0;
    for (const led of ledger.values()) {
      const s = led.staffId !== UNASSIGNED ? staffMap.get(led.staffId) : null;
      const row = ensure(led.staffId === UNASSIGNED ? null : led.staffId);
      row.serviceCount = led.serviceCount;
      row.visits = led.visits;
      row.serviceRevenueCents = led.serviceCents;
      row.productRevenueCents = led.productCents;
      row.tipsCents = led.tipsCents;
      row.commissionCents = s ? commissionOnly({ commissionPercent: s.commissionPercent ?? 0, productCommissionPercent: s.productCommissionPercent ?? 0 }, led, paySettings) : 0;
      row.totalPayCents = row.commissionCents + row.tipsCents;
      totalRevenue += led.serviceCents + led.productCents;
      totalTips += led.tipsCents;
      totalCommission += row.commissionCents;
      totalPay += row.totalPayCents;
    }
    const extraTxns = extraVisits;

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

    // How the money actually came in, split by tender method — accurate even when a
    // single bill was paid part cash + part card. Cash change is netted off the cash
    // line; the gift-card portion is shown on its own (it is not new counter money).
    const byMethod = { cashCents: 0, cardCents: 0, otherCents: 0, giftCardCents: 0 };
    // Per-method detail ALONGSIDE the three original lines, never instead of
    // them. A Vietnamese owner needs to know MoMo from a bank transfer; a US
    // owner reads the same three totals they read last night, unmoved.
    const byTender: Record<string, number> = {};
    for (const o of orders) {
      byMethod.giftCardCents += o.giftCardAppliedCents ?? 0;
      let cashInThisOrder = false;
      for (const tn of o.tenders ?? []) {
        const bucket = bucketFor(tn.method);
        if (bucket === 'cash') { byMethod.cashCents += tn.amountCents; cashInThisOrder = true; }
        else if (bucket === 'card') byMethod.cardCents += tn.amountCents;
        else byMethod.otherCents += tn.amountCents;
        byTender[tn.method] = (byTender[tn.method] ?? 0) + tn.amountCents;
      }
      if (cashInThisOrder) byMethod.cashCents -= o.changeCents ?? 0;
    }
    byMethod.cashCents = Math.max(0, byMethod.cashCents);

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      byMethod,
      byTender,
      totals: { revenueCents: totalRevenue, tipsCents: totalTips, commissionCents: totalCommission, baseCents: totalBase, payCents: totalPay, directTipsCents: totalDirectTips, orders: orderCount + extraTxns },
      staff: [...rows.values()].sort(
        (a, b) =>
          b.serviceRevenueCents + b.productRevenueCents - (a.serviceRevenueCents + a.productRevenueCents),
      ),
    };
  }
}
