/**
 * NHẬP DOANH THU CŨ — the database half. Rules in sales-import.ts.
 *
 * Every imported bill becomes an ordinary PAID ticket (orders + order_items +
 * order_payments) dated on the day it was sold, plus its Payment ledger rows —
 * exactly what the till writes — so the sales report, payroll, staff
 * performance, the dashboard and the client's history read it with no special
 * case. What an imported bill never does: touch stock, loyalty points, gift
 * cards, a cashier shift, an appointment, or send anyone a message.
 *
 * Tickets carry `clientRef = imp:<batch>:<hash>` (unique per salon): the hash
 * makes a second import of the same file add nothing, and the batch lets the
 * owner take one import back out in one go. `source = 'import'`.
 *
 * Tenant: always from the token (salon admin) — never from the file.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { OrderItemKind, OrderStatus, PaymentStatus, PaymentType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { minorUnitDigits } from '../common/money';
import { dayKeyTz, wallTimeToUtcTz } from '../common/salon-time';
import { dialCodeFor, toE164 } from '../common/phone';
import { phoneTail } from '../customers/import-rows';
import { ledgerProviderFor } from './payment-methods';
import { buildTickets, fold, summarize, type SaleRowIn, type Ticket } from './sales-import';

export const IMPORT_PREFIX = 'imp:';
const MAX_ROWS = 5000;

interface Ctx {
  tenantId: string;
  tz: string;
  currency: string;
  digits: number;
  dayFirst: boolean;
  dialCode: string;
  staff: { id: string; firstName: string; lastName: string | null }[];
  services: { id: string; name: string }[];
  locked: { from: string; to: string }[];
}

const hashOf = (signature: string) => createHash('sha1').update(signature).digest('hex').slice(0, 20);
const hm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

@Injectable()
export class SalesImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private async ctx(user: AuthenticatedUser): Promise<Ctx> {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) throw new BadRequestException('No salon in scope');
    const [tenant, rules, staff, services, runs] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true, market: true } }),
      this.settings.getBookingRules(tenantId),
      this.prisma.staffMember.findMany({ where: { tenantId }, select: { id: true, firstName: true, lastName: true } }),
      this.prisma.service.findMany({ where: { tenantId }, select: { id: true, name: true } }),
      this.prisma.payrollRun.findMany({ where: { tenantId, status: 'FINAL' }, select: { periodFrom: true, periodTo: true } }),
    ]);
    const currency = rules.currency || 'USD';
    const market = String(tenant?.market ?? 'US').toUpperCase();
    return {
      tenantId,
      tz: tenant?.timezone || 'UTC',
      currency,
      digits: minorUnitDigits(currency),
      dayFirst: market === 'VN' || currency === 'VND',
      dialCode: dialCodeFor(market === 'VN' ? 'VN' : market, tenant?.timezone),
      staff,
      services,
      locked: runs.map((r) => ({ from: r.periodFrom, to: r.periodTo })),
    };
  }

  private rowsOf(rows: unknown): SaleRowIn[] {
    if (!Array.isArray(rows)) throw new BadRequestException('rows must be an array');
    if (rows.length > MAX_ROWS) throw new BadRequestException(`At most ${MAX_ROWS} rows per import — split the file`);
    return rows.map((r) => (r && typeof r === 'object' ? (r as SaleRowIn) : {}));
  }

  private build(c: Ctx, rows: SaleRowIn[], staffMap?: Record<string, string>) {
    // An answer for an unknown name must be one of THIS salon's technicians (or '' = unassigned).
    const ids = new Set(c.staff.map((s) => s.id));
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(staffMap ?? {})) {
      const key = fold(String(k));
      if (!key) continue;
      map[key] = typeof v === 'string' && ids.has(v) ? v : '';
    }
    return buildTickets(rows, {
      digits: c.digits, dayFirst: c.dayFirst, todayKey: dayKeyTz(new Date(), c.tz),
      staff: c.staff, services: c.services, locked: c.locked, staffMap: map,
    });
  }

  /** Hashes already imported for this salon (any batch). */
  private async importedHashes(tenantId: string): Promise<Set<string>> {
    const rows = await this.prisma.order.findMany({ where: { tenantId, clientRef: { startsWith: IMPORT_PREFIX } }, select: { clientRef: true } });
    return new Set(rows.map((r) => String(r.clientRef).split(':')[2]).filter(Boolean));
  }

  /** Read the file, change nothing: what would be imported, and what needs an answer. */
  async preview(user: AuthenticatedUser, dto: { rows?: unknown; staffMap?: Record<string, string> }) {
    const c = await this.ctx(user);
    const rows = this.rowsOf(dto.rows);
    const built = this.build(c, rows, dto.staffMap);
    const done = await this.importedHashes(c.tenantId);
    const fresh = built.tickets.filter((t) => !done.has(hashOf(t.signature)));
    return {
      currency: c.currency,
      dayFirst: c.dayFirst,
      rows: rows.length,
      summary: summarize(fresh, c.staff),
      duplicates: built.tickets.length - fresh.length,
      unknownStaff: built.unknownStaff,
      staff: c.staff.map((s) => ({ id: s.id, name: `${s.firstName}${s.lastName ? ` ${s.lastName}` : ''}` })),
      errors: built.errors.slice(0, 200),
      errorCount: built.errors.length,
      lockedRows: built.lockedRows,
      sample: fresh.slice(0, 8).map((t) => ({ day: t.day, time: hm(t.minutes), bill: t.bill, customer: t.customer, method: t.method, discount: t.discount, lines: t.lines.map((l) => ({ name: l.name, kind: l.kind, amount: l.amount, tip: l.tip, staff: l.staffName, staffId: l.staffId })) })),
    };
  }

  /** Write the bills. Re-running with the same file adds nothing. */
  async commit(user: AuthenticatedUser, dto: { rows?: unknown; staffMap?: Record<string, string>; label?: string }) {
    const c = await this.ctx(user);
    const rows = this.rowsOf(dto.rows);
    const built = this.build(c, rows, dto.staffMap);
    // Names nobody answered for would silently become "unassigned" sales —
    // and a tech's pay would be short. The owner answers first (even if the
    // answer is "leave unassigned").
    if (built.unknownStaff.length) {
      throw new BadRequestException({ message: 'Some technician names match nobody — choose who each one is first', unknownStaff: built.unknownStaff });
    }
    const done = await this.importedHashes(c.tenantId);
    const fresh = built.tickets.filter((t) => !done.has(hashOf(t.signature)));
    const batch = `${new Date().toISOString().slice(2, 10).replace(/-/g, '')}${randomBytes(3).toString('hex')}`;
    const label = String(dto.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || null;

    // Clients by phone (last 9 digits), found or created once per import.
    const customers = await this.prisma.customer.findMany({ where: { tenantId: c.tenantId, phone: { not: null } }, select: { id: true, phone: true } });
    const byPhone = new Map<string, string>();
    for (const cu of customers) { const t = phoneTail(cu.phone); if (t && !byPhone.has(t)) byPhone.set(t, cu.id); }
    const customerFor = async (t: Ticket): Promise<string | null> => {
      const tail = phoneTail(t.phone);
      if (!tail) return null;
      const hit = byPhone.get(tail);
      if (hit) return hit;
      const phone = toE164(t.phone, c.dialCode) ?? t.phone;
      const [first, ...rest] = (t.customer ?? '').split(' ');
      const created = await this.prisma.customer.create({
        data: { tenantId: c.tenantId, firstName: first || 'Khách', lastName: rest.join(' ') || null, phone, importSource: 'sales-import', importedAt: new Date() } as never,
        select: { id: true },
      });
      byPhone.set(tail, created.id);
      return created.id;
    };

    let created = 0;
    let failed = 0;
    const CHUNK = 100;
    for (let i = 0; i < fresh.length; i += CHUNK) {
      const chunk = fresh.slice(i, i + CHUNK);
      const withCustomers = [] as Array<{ t: Ticket; customerId: string | null }>;
      for (const t of chunk) withCustomers.push({ t, customerId: await customerFor(t).catch(() => null) });
      // The order number is shared with the live till: take the next numbers
      // inside the transaction, and try the chunk once more if the till took
      // one at the same moment.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await this.prisma.$transaction(async (tx) => {
            const last = await tx.order.findFirst({ where: { tenantId: c.tenantId }, orderBy: { orderNumber: 'desc' }, select: { orderNumber: true } });
            let n = last?.orderNumber ?? 0;
            for (const { t, customerId } of withCustomers) {
              const at = wallTimeToUtcTz(t.day, hm(t.minutes), c.tz);
              const subtotal = t.lines.reduce((s, l) => s + l.amount, 0);
              const tip = t.lines.reduce((s, l) => s + l.tip, 0);
              const total = Math.max(0, subtotal - t.discount) + tip;
              const order = await tx.order.create({
                data: {
                  tenantId: c.tenantId,
                  orderNumber: ++n,
                  status: OrderStatus.PAID,
                  customerId,
                  source: 'import',
                  createdByUserId: user.userId,
                  subtotalCents: subtotal,
                  discountCents: t.discount,
                  taxCents: 0,
                  tipCents: tip,
                  totalCents: total,
                  paidCents: total,
                  changeCents: 0,
                  currency: c.currency,
                  note: `Nhập doanh thu cũ${label ? ` · ${label}` : ''}${t.bill ? ` · bill ${t.bill}` : ''}${t.customer && !customerId ? ` · ${t.customer}` : ''}`.slice(0, 500),
                  clientRef: `${IMPORT_PREFIX}${batch}:${hashOf(t.signature)}`,
                  createdAt: at,
                  paidAt: at,
                },
                select: { id: true },
              });
              await tx.orderItem.createMany({
                data: t.lines.map((l) => ({
                  tenantId: c.tenantId, orderId: order.id,
                  kind: l.kind === 'PRODUCT' ? OrderItemKind.PRODUCT : OrderItemKind.SERVICE,
                  serviceId: l.serviceId, productId: null, name: l.name,
                  unitPriceCents: l.amount, quantity: 1, discountCents: 0, taxCents: 0, tipCents: l.tip,
                  lineTotalCents: l.amount, staffMemberId: l.staffId, createdAt: at,
                })),
              });
              if (total > 0) {
                await tx.orderPayment.create({ data: { tenantId: c.tenantId, orderId: order.id, method: t.method as never, amountCents: total, createdAt: at } });
                // The Payment ledger the dashboard reads — one row, the bill's method.
                await tx.payment.create({
                  data: {
                    tenantId: c.tenantId, appointmentId: null, amountCents: total, currency: c.currency,
                    type: PaymentType.PAY_LATER, status: PaymentStatus.PAID,
                    provider: ledgerProviderFor(t.method), providerReference: `order:${order.id}`,
                    paidAt: at, createdAt: at,
                  },
                });
              }
            }
          }, { timeout: 60_000 });
          created += withCustomers.length;
          break;
        } catch (e) {
          if (attempt === 1) failed += withCustomers.length;
        }
      }
    }
    await this.audit.log({
      tenantId: c.tenantId, userId: user.userId, action: 'pos.sales_imported', resourceType: 'tenant', resourceId: c.tenantId,
      metadata: { batch, label, rows: rows.length, created, failed, duplicates: built.tickets.length - fresh.length, errors: built.errors.length },
    });
    return {
      batch, created, failed,
      duplicates: built.tickets.length - fresh.length,
      errors: built.errors.slice(0, 200), errorCount: built.errors.length,
      summary: summarize(fresh, c.staff),
    };
  }

  /** Every import this salon made: when, how many bills, which days, how much. */
  async batches(user: AuthenticatedUser) {
    const tenantId = resolveTenantScope(user);
    if (!tenantId) throw new BadRequestException('No salon in scope');
    const rows = await this.prisma.order.findMany({
      where: { tenantId, clientRef: { startsWith: IMPORT_PREFIX } },
      select: { clientRef: true, totalCents: true, tipCents: true, paidAt: true, note: true },
    });
    const by = new Map<string, { batch: string; label: string | null; tickets: number; totalCents: number; tipsCents: number; firstAt: Date | null; lastAt: Date | null }>();
    for (const r of rows) {
      const batch = String(r.clientRef).split(':')[1] ?? '';
      const b = by.get(batch) ?? { batch, label: null, tickets: 0, totalCents: 0, tipsCents: 0, firstAt: null, lastAt: null };
      b.tickets += 1; b.totalCents += r.totalCents; b.tipsCents += r.tipCents;
      if (r.paidAt && (!b.firstAt || r.paidAt < b.firstAt)) b.firstAt = r.paidAt;
      if (r.paidAt && (!b.lastAt || r.paidAt > b.lastAt)) b.lastAt = r.paidAt;
      if (!b.label && r.note) { const m = /^Nhập doanh thu cũ · ([^·]+?)(?: · |$)/.exec(r.note); if (m && !/^bill /.test(m[1])) b.label = m[1].trim(); }
      by.set(batch, b);
    }
    return [...by.values()].sort((a, b) => (a.batch < b.batch ? 1 : -1));
  }

  /** Take one import back out. Refused when any of its days sits in a closed payroll. */
  async undo(user: AuthenticatedUser, batch: string) {
    const c = await this.ctx(user);
    if (!/^[0-9a-f]{6,20}$/i.test(batch || '')) throw new BadRequestException('Unknown import');
    const orders = await this.prisma.order.findMany({
      where: { tenantId: c.tenantId, clientRef: { startsWith: `${IMPORT_PREFIX}${batch}:` } },
      select: { id: true, paidAt: true },
    });
    if (!orders.length) throw new BadRequestException('Unknown import');
    const days = orders.map((o) => (o.paidAt ? dayKeyTz(o.paidAt, c.tz) : '')).filter(Boolean);
    if (days.some((d) => c.locked.some((p) => d >= p.from && d <= p.to))) {
      throw new BadRequestException('Part of this import is inside a closed payroll — reopen that payroll first');
    }
    const ids = orders.map((o) => o.id);
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.deleteMany({ where: { tenantId: c.tenantId, providerReference: { in: ids.map((id) => `order:${id}`) } } });
      await tx.order.deleteMany({ where: { tenantId: c.tenantId, id: { in: ids } } });
    }, { timeout: 60_000 });
    await this.audit.log({ tenantId: c.tenantId, userId: user.userId, action: 'pos.sales_import_undone', resourceType: 'tenant', resourceId: c.tenantId, metadata: { batch, tickets: ids.length } });
    return { batch, removed: ids.length };
  }
}
