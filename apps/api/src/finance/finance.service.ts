import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, PaymentStatus, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PosService } from '../pos/pos.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { addDaysToKey, dayKeyTz, startOfDayTz } from '../common/salon-time';
import {
  DEFAULT_CATEGORIES, GROUPS, advanceDue, assembleLedger, buildPnl, drawerLines, dueDaysUpTo, entryLines, isRefundMovement,
  payrollFigures, refundLines, salesLines, shiftDiffLines, voucherBlocked, voucherCode,
  type CatGroup, type Cadence, type CategoryMeta, type Direction, type EntryRow, type FundRow, type LedgerLine, type PnlResult,
} from './finance-calc';
import { cashFundOf, defaultBankOf, ensureFinanceSetup, type CategoryDb, type FundDb } from './finance-setup';

/**
 * Thu & Chi: the salon's cash book, its profit & loss, and the vouchers only
 * a person can write (rent, power, the owner's own money). The arithmetic
 * lives in ./finance-calc; this file loads the facts — every query pinned to
 * the caller's salon — and guards the writes.
 */

interface EntryDb extends EntryRow { tenantId: string; sourceRef: string | null; createdAt: Date; createdByUserId: string | null; approvedByUserId: string | null }
interface RecurringDb { id: string; tenantId: string; name: string; categoryId: string; fundId: string; amountCents: number | null; cadence: Cadence; anchorDay: string; nextDue: string; mode: 'REMIND' | 'AUTO'; payee: string | null; active: boolean; createdAt: Date }
interface Delegate<T> {
  findMany(args: unknown): Promise<T[]>;
  findFirst(args: unknown): Promise<T | null>;
  create(args: unknown): Promise<T>;
  update(args: unknown): Promise<T>;
  updateMany(args: unknown): Promise<{ count: number }>;
}
interface FinDb {
  cashFund: Delegate<FundDb>;
  cashCategory: Delegate<CategoryDb>;
  cashEntry: Delegate<EntryDb>;
  recurringExpense: Delegate<RecurringDb>;
  cashMovement: Delegate<{ id: string; tenantId: string; shiftId: string; kind: string; amountCents: number; reason: string | null; byName: string | null; createdAt: Date; categoryId: string | null; source: string | null }>;
  cashShift: Delegate<{ id: string; closedAt: Date | null; varianceCents: number | null; closedByName: string | null }>;
  orderRefund: Delegate<{ id: string; orderId: string; amountCents: number; method: string; reason: string | null; createdAt: Date; full: boolean }>;
  supplyMovement: Delegate<{ id: string; supplyItemId: string; delta: number; reason: string; unitCostCents: number | null; note: string | null; createdAt: Date }>;
  supplyItem: Delegate<{ id: string; name: string; supplier: string | null }>;
  payrollRun: Delegate<{ id: string; periodFrom: string; periodTo: string; status: string; totals: unknown; finalizedAt: Date | null }>;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CENTS = 100_000_000_00; // $100M — a typo guard, not a business rule
const SETTINGS_KEY = 'finance_settings';
const DEFAULT_APPROVAL_OVER = 50_000; // $500.00

export interface EntryInput {
  direction?: string; amountCents?: number; fundId?: string; categoryId?: string | null; day?: string;
  payee?: string | null; note?: string | null; receiptUrl?: string | null; countsInPl?: boolean; approvalPin?: string;
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pos: PosService,
  ) {}

  private get db(): FinDb { return this.prisma as unknown as FinDb; }

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  private async ctx(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true, market: true } as never }).catch(() => null) as { timezone?: string; market?: string } | null;
    const tz = t?.timezone || 'UTC';
    const vi = String(t?.market ?? '').toUpperCase() === 'VN';
    const today = dayKeyTz(new Date(), tz);
    await ensureFinanceSetup(this.db, tenantId, vi, today);
    return { tenantId, tz, vi, today };
  }

  private async nameOf(user: AuthenticatedUser): Promise<string | null> {
    const u = await this.prisma.user.findFirst({ where: { id: user.userId }, select: { firstName: true, lastName: true, email: true } as never }).catch(() => null) as { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
    const n = `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim();
    return n || u?.email || null;
  }

  private async funds(tenantId: string): Promise<FundDb[]> {
    return this.db.cashFund.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
  }
  private async categories(tenantId: string): Promise<CategoryDb[]> {
    return this.db.cashCategory.findMany({ where: { tenantId }, orderBy: [{ sort: 'asc' }, { name: 'asc' }] });
  }

  private fundRows(funds: FundDb[]): FundRow[] {
    return funds.map((f) => ({ id: f.id, kind: f.kind, name: f.name, openingCents: f.openingCents, openingDate: f.openingDate, isDefault: f.isDefault, archived: !!f.archivedAt }));
  }

  private range(from: string | undefined, to: string | undefined, today: string): { from: string; to: string } {
    const f = from && DAY.test(from) ? from : `${today.slice(0, 7)}-01`;
    const t = to && DAY.test(to) ? to : today;
    if (f > t) throw new BadRequestException('Khoảng ngày không hợp lệ.');
    return { from: f, to: t };
  }

  private edges(from: string, to: string, tz: string): { start: Date; end: Date } {
    return { start: startOfDayTz(from, tz), end: new Date(startOfDayTz(addDaysToKey(to, 1), tz).getTime() - 1) };
  }

  // ===================== facts → lines =====================

  /**
   * Every cash-book line dated [fromDay, toDay] for this salon: read live from
   * payments, refunds, drawer movements, closed shifts and stored vouchers.
   */
  private async lines(tenantId: string, tz: string, funds: FundDb[], cats: CategoryDb[], fromDay: string, toDay: string): Promise<LedgerLine[]> {
    const cash = cashFundOf(funds);
    const bank = defaultBankOf(funds);
    if (!cash || !bank) return [];
    const { start, end } = this.edges(fromDay, toDay, tz);
    const dayOf = (d: Date) => dayKeyTz(d, tz);
    const [payments, refunds, moves, shifts, entries] = await Promise.all([
      this.prisma.payment.findMany({
        where: { tenantId, status: { in: [PaymentStatus.PAID, PaymentStatus.REFUNDED] }, paidAt: { gte: start, lte: end } },
        select: { id: true, amountCents: true, provider: true, status: true, paidAt: true, providerReference: true },
      }),
      this.db.orderRefund.findMany({ where: { tenantId, full: true, createdAt: { gte: start, lte: end } } }),
      this.db.cashMovement.findMany({ where: { tenantId, createdAt: { gte: start, lte: end } } }),
      this.db.cashShift.findMany({ where: { tenantId, status: 'CLOSED', closedAt: { gte: start, lte: end }, NOT: { varianceCents: null } }, select: { id: true, closedAt: true, varianceCents: true, closedByName: true } }),
      this.db.cashEntry.findMany({ where: { tenantId, day: { gte: fromDay, lte: toDay } } }),
    ]);
    // A bill whose payments were flipped to REFUNDED was either refunded (the
    // money came in, and went back later — both are real) or voided (it never
    // happened). Only the bill itself knows which.
    const refundedRefs = payments.filter((p) => p.status === PaymentStatus.REFUNDED && p.providerReference?.startsWith('order:')).map((p) => p.providerReference!.slice(6));
    const orderIds = [...new Set([...refundedRefs, ...refunds.map((r) => r.orderId)])];
    const orders = orderIds.length
      ? await this.prisma.order.findMany({ where: { tenantId, id: { in: orderIds } }, select: { id: true, status: true, orderNumber: true } as never }) as unknown as { id: string; status: string; orderNumber: string | number | null }[]
      : [];
    const fully = new Set(orders.filter((o) => o.status === OrderStatus.REFUNDED).map((o) => o.id));
    const numberOf = new Map(orders.map((o) => [o.id, o.orderNumber == null ? null : String(o.orderNumber)]));
    const catById = new Map(cats.map((c) => [c.id, c]));
    return [
      ...salesLines(payments.filter((p) => p.paidAt).map((p) => ({ ...p, paidAt: p.paidAt as Date, status: String(p.status) })), dayOf, cash.id, bank.id, fully),
      ...refundLines(refunds.map((r) => ({ ...r, orderNumber: numberOf.get(r.orderId) ?? null })), dayOf, cash.id, bank.id),
      ...drawerLines(moves, dayOf, cash.id, bank.id, (id) => { const c = catById.get(id); return c ? { countsInPl: c.countsInPl, systemKey: c.systemKey } : null; }),
      ...shiftDiffLines(shifts.filter((s) => s.closedAt && s.varianceCents).map((s) => ({ id: s.id, closedAt: s.closedAt as Date, varianceCents: s.varianceCents as number, closedByName: s.closedByName })), dayOf, cash.id),
      ...entryLines(entries, (id) => (id ? catById.get(id)?.name ?? null : null)),
    ];
  }

  // ===================== cash book =====================

  async ledger(user: AuthenticatedUser, q: { from?: string; to?: string; fundId?: string }) {
    const { tenantId, tz, today } = await this.ctx(user);
    await this.materializeAuto(user, tenantId, tz, today);
    const { from, to } = this.range(q.from, q.to, today);
    const [funds, cats] = await Promise.all([this.funds(tenantId), this.categories(tenantId)]);
    const fundId = q.fundId ? (funds.find((f) => f.id === q.fundId)?.id ?? null) : null;
    if (q.fundId && !fundId) throw new NotFoundException('Không thấy quỹ này.');
    const startDay = funds.reduce((m, f) => (f.openingDate < m ? f.openingDate : m), from);
    const all = await this.lines(tenantId, tz, funds, cats, startDay, to);
    const result = assembleLedger(this.fundRows(funds), all, from, to, fundId);
    return { ...result, today, fundList: this.fundView(funds, result.funds), categories: this.categoryView(cats) };
  }

  /** The bills behind one "sales" line of the cash book. */
  async salesDay(user: AuthenticatedUser, day: string, fundId: string) {
    const { tenantId, tz } = await this.ctx(user);
    if (!DAY.test(day ?? '')) throw new BadRequestException('Ngày không hợp lệ.');
    const funds = await this.funds(tenantId);
    const fund = funds.find((f) => f.id === fundId);
    if (!fund) throw new NotFoundException('Không thấy quỹ này.');
    const cash = cashFundOf(funds);
    const { start, end } = this.edges(day, day, tz);
    const rows = await this.prisma.payment.findMany({
      where: { tenantId, status: { in: [PaymentStatus.PAID, PaymentStatus.REFUNDED] }, paidAt: { gte: start, lte: end }, amountCents: { gt: 0 } },
      select: { id: true, amountCents: true, provider: true, status: true, paidAt: true, providerReference: true },
      orderBy: { paidAt: 'asc' },
    });
    const wantCash = fund.id === cash?.id;
    const mine = rows.filter((p) => (p.provider === 'pos-cash') === wantCash);
    const ids = mine.map((p) => p.providerReference?.startsWith('order:') ? p.providerReference.slice(6) : null).filter(Boolean) as string[];
    const orders = ids.length
      ? await this.prisma.order.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, status: true, orderNumber: true } as never }) as unknown as { id: string; status: string; orderNumber: string | number | null }[]
      : [];
    const byId = new Map(orders.map((o) => [o.id, o]));
    return mine
      .map((p) => {
        const oid = p.providerReference?.startsWith('order:') ? p.providerReference.slice(6) : null;
        const o = oid ? byId.get(oid) : undefined;
        return { id: p.id, at: p.paidAt, amountCents: p.amountCents, provider: p.provider, status: p.status, orderId: oid, orderNumber: o?.orderNumber ?? null, orderStatus: o?.status ?? null };
      })
      // Same rule as the cash book: a voided bill's money never came in.
      .filter((r) => r.status === PaymentStatus.PAID || r.orderStatus === OrderStatus.REFUNDED);
  }

  private fundView(funds: FundDb[], balances: { id: string; closingCents: number }[]) {
    const bal = new Map(balances.map((b) => [b.id, b.closingCents]));
    return funds.map((f) => ({ id: f.id, kind: f.kind, name: f.name, last4: f.last4, openingCents: f.openingCents, openingDate: f.openingDate, isDefault: f.isDefault, archived: !!f.archivedAt, balanceCents: bal.get(f.id) ?? 0 }));
  }

  private categoryView(cats: CategoryDb[]) {
    const sys = new Set(DEFAULT_CATEGORIES.filter((c) => c.system).map((c) => c.key));
    return cats.map((c) => ({ id: c.id, direction: c.direction, group: c.group, name: c.name, countsInPl: c.countsInPl, systemKey: c.systemKey, system: !!c.systemKey && sys.has(c.systemKey), budgetCents: c.budgetCents, hidden: c.hidden }));
  }

  // ===================== profit & loss =====================

  private async pnlFor(user: AuthenticatedUser, tenantId: string, tz: string, funds: FundDb[], cats: CategoryDb[], from: string, to: string): Promise<PnlResult> {
    const { start, end } = this.edges(from, to, tz);
    const [summary, runs, purchases, lines] = await Promise.all([
      // The SAME numbers the sales screens show — one formula, one answer.
      this.pos.salesSummary(user, from, to) as Promise<{ totals: { grossCents: number; discountCents: number; refundCents: number; netCents: number; tipsCents: number; taxCents: number; serviceCents: number; productCents: number } }>,
      this.db.payrollRun.findMany({ where: { tenantId, status: 'FINAL', periodTo: { gte: from, lte: to } }, select: { id: true, periodFrom: true, periodTo: true, totals: true } }),
      this.db.supplyMovement.findMany({ where: { tenantId, reason: { in: ['PURCHASE', 'RETURN'] }, createdAt: { gte: start, lte: end }, NOT: { unitCostCents: null } }, select: { delta: true, reason: true, unitCostCents: true } }),
      this.lines(tenantId, tz, funds, cats, from, to),
    ]);
    // Bought in at cost; sent back at cost.
    const supplyCents = purchases.reduce((n, m) => n + Math.round(m.delta * (m.unitCostCents ?? 0)), 0);
    const meta: CategoryMeta[] = cats.map((c) => ({ id: c.id, name: c.name, group: c.group, direction: c.direction, systemKey: c.systemKey, budgetCents: c.budgetCents }));
    return buildPnl({
      sales: summary.totals,
      payroll: runs.map(payrollFigures),
      supplyPurchaseCents: Math.max(0, supplyCents),
      lines: lines.filter((l) => l.day >= from && l.day <= to),
      categories: meta,
    });
  }

  async pnl(user: AuthenticatedUser, q: { from?: string; to?: string; cmpFrom?: string; cmpTo?: string }) {
    const { tenantId, tz, today } = await this.ctx(user);
    await this.materializeAuto(user, tenantId, tz, today);
    const { from, to } = this.range(q.from, q.to, today);
    const [funds, cats] = await Promise.all([this.funds(tenantId), this.categories(tenantId)]);
    const cmp = q.cmpFrom && q.cmpTo && DAY.test(q.cmpFrom) && DAY.test(q.cmpTo) && q.cmpFrom <= q.cmpTo ? { from: q.cmpFrom, to: q.cmpTo } : null;
    const [current, previous] = await Promise.all([
      this.pnlFor(user, tenantId, tz, funds, cats, from, to),
      cmp ? this.pnlFor(user, tenantId, tz, funds, cats, cmp.from, cmp.to) : Promise.resolve(null),
    ]);
    return { from, to, current, previous, compare: cmp, categories: this.categoryView(cats) };
  }

  /** Income, cost and profit of each of the last `months` calendar months (this one so far included). */
  async trend(user: AuthenticatedUser, months = 6) {
    const { tenantId, tz, today } = await this.ctx(user);
    const n = Math.min(12, Math.max(1, Math.floor(months) || 6));
    const [funds, cats] = await Promise.all([this.funds(tenantId), this.categories(tenantId)]);
    const ranges: { key: string; from: string; to: string }[] = [];
    let y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
    for (let i = 0; i < n; i++) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const to = `${key}-${String(last).padStart(2, '0')}`;
      ranges.unshift({ key, from: `${key}-01`, to: to > today ? today : to });
      m -= 1; if (m === 0) { m = 12; y -= 1; }
    }
    const res = await Promise.all(ranges.map((r) => this.pnlFor(user, tenantId, tz, funds, cats, r.from, r.to)));
    return ranges.map((r, i) => ({ month: r.key, from: r.from, to: r.to, netSalesCents: res[i].revenue.netCents, incomeCents: res[i].incomeCents, expenseCents: res[i].expenseCents, profitCents: res[i].profitCents }));
  }

  // ===================== what still needs a hand =====================

  async pending(user: AuthenticatedUser) {
    const { tenantId, tz, today } = await this.ctx(user);
    await this.materializeAuto(user, tenantId, tz, today);
    const funds = await this.funds(tenantId);
    // The books start on the earliest opening day: older payroll runs and
    // purchases were settled before Lumio kept the books, not left unpaid.
    const since = funds.reduce((m, f) => (f.openingDate < m ? f.openingDate : m), today);
    const sinceAt = startOfDayTz(since, tz);
    const [runs, buys, paid, recs, moves] = await Promise.all([
      this.db.payrollRun.findMany({ where: { tenantId, status: 'FINAL', periodTo: { gte: since } }, select: { id: true, periodFrom: true, periodTo: true, totals: true, finalizedAt: true }, orderBy: { periodTo: 'asc' } }),
      this.db.supplyMovement.findMany({ where: { tenantId, reason: 'PURCHASE', createdAt: { gte: sinceAt }, NOT: { unitCostCents: null } }, orderBy: { createdAt: 'asc' } }),
      this.db.cashEntry.findMany({ where: { tenantId, source: { in: ['PAYROLL', 'STOCK'] }, voidedAt: null }, select: { source: true, sourceRef: true } }),
      this.db.recurringExpense.findMany({ where: { tenantId, active: true, mode: 'REMIND', nextDue: { lte: addDaysToKey(today, 14) } }, orderBy: { nextDue: 'asc' } }),
      this.db.cashMovement.findMany({ where: { tenantId, categoryId: null, createdAt: { gte: sinceAt } }, select: { id: true, kind: true, amountCents: true, reason: true, source: true } }),
    ]);
    const paidRuns = new Set(paid.filter((p) => p.source === 'PAYROLL').map((p) => String(p.sourceRef ?? '').split(':')[0]));
    const paidBuys = new Set(paid.filter((p) => p.source === 'STOCK').map((p) => String(p.sourceRef ?? '')));
    const items = buys.filter((b) => !paidBuys.has(b.id));
    const names = items.length ? await this.db.supplyItem.findMany({ where: { tenantId, id: { in: [...new Set(items.map((b) => b.supplyItemId))] } }, select: { id: true, name: true, supplier: true } }) : [];
    const nameOf = new Map(names.map((x) => [x.id, x]));
    const unreviewed = moves.filter((m) => !isRefundMovement(m));
    return {
      today,
      payroll: runs.filter((r) => !paidRuns.has(r.id)).map((r) => {
        const t = (r.totals ?? {}) as Record<string, number>;
        return { runId: r.id, periodFrom: r.periodFrom, periodTo: r.periodTo, netPayCents: t.netPayCents ?? 0, cashCents: t.cashCents ?? 0, bankCents: t.checkCents ?? 0 };
      }),
      stock: items.map((b) => ({ movementId: b.id, at: b.createdAt, item: nameOf.get(b.supplyItemId)?.name ?? '', supplier: nameOf.get(b.supplyItemId)?.supplier ?? null, qty: b.delta, unitCostCents: b.unitCostCents ?? 0, amountCents: Math.round(b.delta * (b.unitCostCents ?? 0)) })),
      recurring: recs.map((r) => ({ id: r.id, name: r.name, nextDue: r.nextDue, amountCents: r.amountCents, overdue: r.nextDue < today, categoryId: r.categoryId, fundId: r.fundId })),
      drawerToReview: { count: unreviewed.length, cents: unreviewed.reduce((n, m) => n + m.amountCents, 0) },
    };
  }

  // ===================== vouchers =====================

  private async settingsOf(tenantId: string): Promise<{ approvalOverCents: number }> {
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: SETTINGS_KEY } } }).catch(() => null);
    const v = (row?.value ?? {}) as { approvalOverCents?: unknown };
    const n = Number(v.approvalOverCents);
    return { approvalOverCents: Number.isFinite(n) && n >= 0 ? Math.round(n) : DEFAULT_APPROVAL_OVER };
  }

  async getSettings(user: AuthenticatedUser) {
    const { tenantId } = await this.ctx(user);
    return this.settingsOf(tenantId);
  }

  async saveSettings(user: AuthenticatedUser, dto: { approvalOverCents?: number }) {
    const { tenantId } = await this.ctx(user);
    this.ownerOnly(user);
    const n = Math.round(Number(dto.approvalOverCents));
    if (!Number.isFinite(n) || n < 0 || n > MAX_CENTS) throw new BadRequestException('Mức duyệt không hợp lệ.');
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: SETTINGS_KEY } },
      update: { value: { approvalOverCents: n } as never },
      create: { tenantId, key: SETTINGS_KEY, value: { approvalOverCents: n } as never },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'finance.settings_changed', resourceType: 'setting', resourceId: SETTINGS_KEY, metadata: { approvalOverCents: n } });
    return { approvalOverCents: n };
  }

  private ownerOnly(user: AuthenticatedUser) {
    if (user.role !== UserRole.SALON_ADMIN && user.role !== UserRole.SUPER_ADMIN) throw new ForbiddenException('Chỉ chủ tiệm làm được việc này.');
  }

  private cents(v: unknown, what: string): number {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n <= 0) throw new BadRequestException(`${what} phải lớn hơn 0.`);
    if (n > MAX_CENTS) throw new BadRequestException(`${what} quá lớn.`);
    return n;
  }

  private text(v: unknown, max: number): string | null {
    const s = String(v ?? '').trim().slice(0, max);
    return s || null;
  }

  /** The instant to file a voucher under: now for today, midday for an earlier day. */
  private occurredAt(day: string, today: string, tz: string): Date {
    if (day === today) return new Date();
    return new Date(startOfDayTz(day, tz).getTime() + 12 * 3_600_000);
  }

  private async fundFor(tenantId: string, fundId: unknown, day: string): Promise<FundDb> {
    const f = await this.db.cashFund.findFirst({ where: { id: String(fundId ?? ''), tenantId } });
    if (!f) throw new BadRequestException('Chọn quỹ.');
    if (f.archivedAt) throw new BadRequestException(`Quỹ "${f.name}" đã đóng.`);
    if (day < f.openingDate) throw new BadRequestException(`Sổ của quỹ "${f.name}" bắt đầu từ ${f.openingDate} — không ghi được ngày trước đó.`);
    return f;
  }

  private async categoryFor(tenantId: string, id: unknown, direction: Direction): Promise<CategoryDb> {
    const c = await this.db.cashCategory.findFirst({ where: { id: String(id ?? ''), tenantId } });
    if (!c) throw new BadRequestException(direction === 'IN' ? 'Chọn loại thu.' : 'Chọn loại chi.');
    if (c.direction !== direction) throw new BadRequestException('Loại này không dùng cho chiều thu/chi đã chọn.');
    const blocked = voucherBlocked(c.systemKey);
    if (blocked === 'system') throw new BadRequestException(`"${c.name}" do hệ thống tự ghi — chọn loại khác.`);
    if (blocked === 'transfer') throw new BadRequestException('Tiền chuyển giữa các quỹ: dùng "Chuyển quỹ".');
    return c;
  }

  private dayOrToday(day: unknown, today: string): string {
    const d = String(day ?? '').trim();
    if (!d) return today;
    if (!DAY.test(d)) throw new BadRequestException('Ngày không hợp lệ.');
    if (d > today) throw new BadRequestException('Không ghi phiếu cho ngày trong tương lai.');
    return d;
  }

  /** PT / PC / CQ numbers run per salon. A clash (two at once) takes the next number. */
  private async createWithCode(tenantId: string, prefix: 'PT' | 'PC' | 'CQ', data: Record<string, unknown>, suffix = ''): Promise<EntryDb> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const last = await this.db.cashEntry.findMany({ where: { tenantId, code: { startsWith: `${prefix}-` } }, select: { code: true }, orderBy: { code: 'desc' }, take: 1 });
      const m = /^[A-Z]{2}-(\d+)/.exec(last[0]?.code ?? '');
      const code = voucherCode(prefix, (m ? parseInt(m[1], 10) : 0) + 1 + attempt) + suffix;
      try {
        return await this.db.cashEntry.create({ data: { ...data, tenantId, code } });
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002' && String((e as { meta?: { target?: unknown } }).meta?.target ?? '').includes('code')) continue;
        throw e;
      }
    }
    throw new BadRequestException('Không cấp được số phiếu — thử lại.');
  }

  /** A paid-for item (a payroll run, a purchase, a due day) can be paid once; a voided voucher frees it. */
  private isDuplicateSource(e: unknown): boolean {
    const err = e as { code?: string; meta?: { target?: unknown } };
    return err.code === 'P2002' && !String(err.meta?.target ?? '').includes('code');
  }

  async createEntry(user: AuthenticatedUser, dto: EntryInput) {
    const { tenantId, tz, today } = await this.ctx(user);
    const direction: Direction = dto.direction === 'IN' ? 'IN' : dto.direction === 'OUT' ? 'OUT' : (() => { throw new BadRequestException('Chọn phiếu thu hay phiếu chi.'); })();
    const amount = this.cents(dto.amountCents, 'Số tiền');
    const day = this.dayOrToday(dto.day, today);
    const fund = await this.fundFor(tenantId, dto.fundId, day);
    const cat = await this.categoryFor(tenantId, dto.categoryId, direction);
    // Big money out needs a second person when the one typing may not refund
    // or void alone (the same PIN that guards a refund).
    let approvedBy: string | null = null;
    const { approvalOverCents } = await this.settingsOf(tenantId);
    if (direction === 'OUT' && approvalOverCents > 0 && amount > approvalOverCents) {
      approvedBy = await this.pos.approverFor(user, tenantId, dto.approvalPin);
    }
    const name = await this.nameOf(user);
    const e = await this.createWithCode(tenantId, direction === 'IN' ? 'PT' : 'PC', {
      direction, fundId: fund.id, categoryId: cat.id, amountCents: amount,
      // The category decides; the person may take one voucher off the P&L
      // (a refund from a supplier, say) but never put a NON_PL one on it.
      countsInPl: cat.group === 'NON_PL' ? false : dto.countsInPl === false ? false : cat.countsInPl,
      occurredAt: this.occurredAt(day, today, tz), day,
      payee: this.text(dto.payee, 120), note: this.text(dto.note, 300), receiptUrl: this.text(dto.receiptUrl, 500),
      source: 'MANUAL', createdByUserId: user.userId, createdByName: name, approvedByUserId: approvedBy,
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'finance.entry_created', resourceType: 'cash_entry', resourceId: e.id, metadata: { code: e.code, direction, amountCents: amount, fundId: fund.id, categoryId: cat.id, day, approvedByUserId: approvedBy } });
    return e;
  }

  /** A typed voucher can be corrected on the day it was written; after that it can only be voided. */
  async updateEntry(user: AuthenticatedUser, id: string, dto: EntryInput) {
    const { tenantId, tz, today } = await this.ctx(user);
    const e = await this.db.cashEntry.findFirst({ where: { id, tenantId } });
    if (!e) throw new NotFoundException('Không thấy phiếu này.');
    if (e.voidedAt) throw new BadRequestException('Phiếu đã huỷ.');
    if (e.source !== 'MANUAL') throw new BadRequestException('Phiếu này do hệ thống ghi — huỷ rồi ghi lại.');
    if (dayKeyTz(e.createdAt, tz) !== today) throw new BadRequestException('Chỉ sửa được trong ngày lập phiếu — sau đó hãy huỷ và lập phiếu mới.');
    const direction = e.direction as Direction;
    const amount = dto.amountCents !== undefined ? this.cents(dto.amountCents, 'Số tiền') : e.amountCents;
    const day = dto.day !== undefined ? this.dayOrToday(dto.day, today) : e.day;
    const fund = await this.fundFor(tenantId, dto.fundId ?? e.fundId, day);
    const cat = dto.categoryId !== undefined ? await this.categoryFor(tenantId, dto.categoryId, direction) : await this.categoryFor(tenantId, e.categoryId, direction);
    let approvedBy = e.approvedByUserId ?? null;
    const { approvalOverCents } = await this.settingsOf(tenantId);
    if (direction === 'OUT' && approvalOverCents > 0 && amount > approvalOverCents && amount > e.amountCents) {
      approvedBy = await this.pos.approverFor(user, tenantId, dto.approvalPin);
    }
    const data = {
      amountCents: amount, day, fundId: fund.id, categoryId: cat.id,
      occurredAt: day === e.day ? e.occurredAt : this.occurredAt(day, today, tz),
      countsInPl: cat.group === 'NON_PL' ? false
        : dto.countsInPl === false ? false
        : dto.countsInPl === true || cat.id !== e.categoryId ? cat.countsInPl
        : e.countsInPl,
      payee: dto.payee !== undefined ? this.text(dto.payee, 120) : e.payee,
      note: dto.note !== undefined ? this.text(dto.note, 300) : e.note,
      receiptUrl: dto.receiptUrl !== undefined ? this.text(dto.receiptUrl, 500) : e.receiptUrl,
      approvedByUserId: approvedBy,
    };
    const res = await this.db.cashEntry.updateMany({ where: { id, tenantId, voidedAt: null }, data });
    if (!res.count) throw new NotFoundException('Không thấy phiếu này.');
    await this.audit.log({ tenantId, userId: user.userId, action: 'finance.entry_updated', resourceType: 'cash_entry', resourceId: id, metadata: { code: e.code, before: { amountCents: e.amountCents, day: e.day, fundId: e.fundId, categoryId: e.categoryId }, after: { amountCents: amount, day, fundId: fund.id, categoryId: cat.id } } });
    return this.db.cashEntry.findFirst({ where: { id, tenantId } });
  }

  /** Never deleted: crossed out with who, when and why. Both halves of a transfer go together. */
  async voidEntry(user: AuthenticatedUser, id: string, dto: { reason?: string }) {
    const { tenantId } = await this.ctx(user);
    const reason = this.text(dto.reason, 300);
    if (!reason) throw new BadRequestException('Ghi lý do huỷ phiếu.');
    const e = await this.db.cashEntry.findFirst({ where: { id, tenantId } });
    if (!e) throw new NotFoundException('Không thấy phiếu này.');
    if (e.voidedAt) return e;
    const name = await this.nameOf(user);
    const data = { voidedAt: new Date(), voidedByUserId: user.userId, voidedByName: name, voidReason: reason };
    if (e.transferId) await this.db.cashEntry.updateMany({ where: { tenantId, transferId: e.transferId, voidedAt: null }, data });
    else await this.db.cashEntry.updateMany({ where: { id, tenantId, voidedAt: null }, data });
    // A reminder that was marked paid by mistake comes back as due.
    if (e.source === 'RECURRING' && e.sourceRef) {
      const [recId, due] = e.sourceRef.split(':');
      const rec = await this.db.recurringExpense.findFirst({ where: { id: recId, tenantId } });
      if (rec && rec.mode === 'REMIND' && due && rec.nextDue === advanceDue(due, rec.cadence, rec.anchorDay)) {
        await this.db.recurringExpense.updateMany({ where: { id: rec.id, tenantId }, data: { nextDue: due } });
      }
    }
    await this.audit.log({ tenantId, userId: user.userId, action: 'finance.entry_voided', resourceType: 'cash_entry', resourceId: id, metadata: { code: e.code, amountCents: e.amountCents, source: e.source, transferId: e.transferId, reason } });
    return this.db.cashEntry.findFirst({ where: { id, tenantId } });
  }

  /** Money that only changes place (cash banked, an e-wallet withdrawn): two halves, never income or cost. */
  async transfer(user: AuthenticatedUser, dto: { fromFundId?: string; toFundId?: string; amountCents?: number; day?: string; note?: string }) {
    const { tenantId, tz, today } = await this.ctx(user);
    const amount = this.cents(dto.amountCents, 'Số tiền');
    const day = this.dayOrToday(dto.day, today);
    if (!dto.fromFundId || dto.fromFundId === dto.toFundId) throw new BadRequestException('Chọn hai quỹ khác nhau.');
    const a = await this.fundFor(tenantId, dto.fromFundId, day);
    const b = await this.fundFor(tenantId, dto.toFundId, day);
    const transferId = randomUUID();
    const name = await this.nameOf(user);
    const base = { amountCents: amount, countsInPl: false, occurredAt: this.occurredAt(day, today, tz), day, note: this.text(dto.note, 300), source: 'TRANSFER', transferId, createdByUserId: user.userId, createdByName: name, categoryId: null };
    const out = await this.createWithCode(tenantId, 'CQ', { ...base, direction: 'OUT', fundId: a.id, payee: b.name });
    let inn: EntryDb;
    try {
      inn = await this.db.cashEntry.create({ data: { ...base, tenantId, code: `${out.code}-N`, direction: 'IN', fundId: b.id, payee: a.name } });
    } catch (e) {
      // Never half a transfer: the out half is withdrawn if the in half fails.
      await this.db.cashEntry.updateMany({ where: { id: out.id, tenantId }, data: { voidedAt: new Date(), voidedByUserId: user.userId, voidReason: 'system: transfer incomplete' } });
      throw e;
    }
    await this.audit.log({ tenantId, userId: user.userId, action: 'finance.transfer', resourceType: 'cash_entry', resourceId: out.id, metadata: { code: out.code, from: a.id, to: b.id, amountCents: amount, day } });
    return { out, in: inn };
  }

  /** A closed payroll run, marked paid: from the drawer (cash part) and/or the bank (cheque / transfer part). */
  async payPayroll(user: AuthenticatedUser, runId: string, dto: { day?: string; cashCents?: number; bankCents?: number; bankFundId?: string }) {
    const { tenantId, tz, today } = await this.ctx(user);
    const run = await this.db.payrollRun.findFirst({ where: { id: runId, tenantId } });
    if (!run) throw new NotFoundException('Không thấy kỳ lương này.');
    if (run.status !== 'FINAL') throw new BadRequestException('Chốt kỳ lương trước khi ghi đã trả.');
    const day = this.dayOrToday(dto.day, today);
    const cashC = Math.round(Number(dto.cashCents ?? 0));
    const bankC = Math.round(Number(dto.bankCents ?? 0));
    if (!Number.isFinite(cashC) || !Number.isFinite(bankC) || cashC < 0 || bankC < 0 || cashC + bankC <= 0 || cashC + bankC > MAX_CENTS) throw new BadRequestException('Số tiền không hợp lệ.');
    const already = await this.db.cashEntry.findMany({ where: { tenantId, source: 'PAYROLL', voidedAt: null, sourceRef: { startsWith: `${runId}:` } }, select: { id: true } });
    if (already.length) throw new BadRequestException('Kỳ lương này đã ghi trả rồi. Huỷ phiếu cũ nếu cần ghi lại.');
    const funds = await this.funds(tenantId);
    const cash = cashFundOf(funds);
    const bank = dto.bankFundId ? funds.find((f) => f.id === dto.bankFundId && !f.archivedAt) : defaultBankOf(funds);
    if (!cash || (bankC > 0 && !bank)) throw new BadRequestException('Chọn quỹ trả lương.');
    if (cashC > 0) await this.fundFor(tenantId, cash.id, day);
    if (bankC > 0) await this.fundFor(tenantId, bank!.id, day);
    const cats = await this.categories(tenantId);
    const cat = cats.find((c) => c.systemKey === 'payroll');
    const name = await this.nameOf(user);
    const made: EntryDb[] = [];
    const base = { direction: 'OUT', categoryId: cat?.id ?? null, countsInPl: false, occurredAt: this.occurredAt(day, today, tz), day, note: `${run.periodFrom} → ${run.periodTo}`, source: 'PAYROLL', createdByUserId: user.userId, createdByName: name };
    try {
      if (cashC > 0) made.push(await this.createWithCode(tenantId, 'PC', { ...base, fundId: cash.id, amountCents: cashC, sourceRef: `${runId}:cash` }));
      if (bankC > 0) made.push(await this.createWithCode(tenantId, 'PC', { ...base, fundId: bank!.id, amountCents: bankC, sourceRef: `${runId}:bank` }));
    } catch (e) {
      for (const m of made) await this.db.cashEntry.updateMany({ where: { id: m.id, tenantId }, data: { voidedAt: new Date(), voidedByUserId: user.userId, voidReason: 'system: payroll payment incomplete' } });
      if (this.isDuplicateSource(e)) throw new BadRequestException('Kỳ lương này đã ghi trả rồi.');
      throw e;
    }
    await this.audit.log({ tenantId, userId: user.userId, action: 'finance.payroll_paid', resourceType: 'payroll_run', resourceId: runId, metadata: { cashCents: cashC, bankCents: bankC, day, entries: made.map((m) => m.code) } });
    return made;
  }

  /** A stock purchase (bought in at cost in Inventory) marked paid from one fund. */
  async payStock(user: AuthenticatedUser, movementId: string, dto: { fundId?: string; day?: string }) {
    const { tenantId, tz, today } = await this.ctx(user);
    const mv = await this.db.supplyMovement.findFirst({ where: { id: movementId, tenantId } });
    if (!mv || mv.reason !== 'PURCHASE' || !mv.unitCostCents) throw new NotFoundException('Không thấy lần nhập kho có giá này.');
    const amount = Math.round(mv.delta * mv.unitCostCents);
    if (amount <= 0) throw new BadRequestException('Lần nhập này không có số tiền.');
    const day = this.dayOrToday(dto.day, today);
    const fund = await this.fundFor(tenantId, dto.fundId, day);
    const item = await this.db.supplyItem.findFirst({ where: { id: mv.supplyItemId, tenantId } });
    const cats = await this.categories(tenantId);
    const name = await this.nameOf(user);
    try {
      const e = await this.createWithCode(tenantId, 'PC', {
        direction: 'OUT', fundId: fund.id, categoryId: cats.find((c) => c.systemKey === 'stock_paid')?.id ?? null, amountCents: amount, countsInPl: false,
        occurredAt: this.occurredAt(day, today, tz), day, payee: item?.supplier ?? null, note: `${item?.name ?? ''} × ${mv.delta}`.trim(),
        source: 'STOCK', sourceRef: mv.id, createdByUserId: user.userId, createdByName: name,
      });
      await this.audit.log({ tenantId, userId: user.userId, action: 'finance.stock_paid', resourceType: 'supply_movement', resourceId: mv.id, metadata: { code: e.code, amountCents: amount, fundId: fund.id, day } });
      return e;
    } catch (e) {
      if (this.isDuplicateSource(e)) throw new BadRequestException('Lần nhập này đã ghi trả rồi.');
      throw e;
    }
  }

  /** Say what a drawer movement was for. Its amount and time stay the shift's. */
  async categorizeDrawer(user: AuthenticatedUser, movementId: string, dto: { categoryId?: string | null }) {
    const { tenantId } = await this.ctx(user);
    const m = await this.db.cashMovement.findFirst({ where: { id: movementId, tenantId } });
    if (!m) throw new NotFoundException('Không thấy khoản thu/chi ngăn kéo này.');
    if (isRefundMovement(m)) throw new BadRequestException('Khoản này là tiền hoàn bill — đã nằm trong sổ.');
    let categoryId: string | null = null;
    if (dto.categoryId) {
      const c = await this.db.cashCategory.findFirst({ where: { id: String(dto.categoryId), tenantId } });
      if (!c) throw new BadRequestException('Chọn loại.');
      if (c.direction !== (m.kind === 'IN' ? 'IN' : 'OUT')) throw new BadRequestException('Loại này không dùng cho chiều thu/chi đã chọn.');
      if (voucherBlocked(c.systemKey) === 'system') throw new BadRequestException(`"${c.name}" do hệ thống tự ghi — chọn loại khác.`);
      categoryId = c.id;
    }
    await this.db.cashMovement.updateMany({ where: { id: m.id, tenantId }, data: { categoryId } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'finance.drawer_categorized', resourceType: 'cash_movement', resourceId: m.id, metadata: { from: m.categoryId, to: categoryId } });
    return { id: m.id, categoryId };
  }

  // ===================== funds & categories =====================

  async listFunds(user: AuthenticatedUser) {
    const { tenantId, tz, today } = await this.ctx(user);
    const [funds, cats] = await Promise.all([this.funds(tenantId), this.categories(tenantId)]);
    const startDay = funds.reduce((m, f) => (f.openingDate < m ? f.openingDate : m), today);
    const lines = await this.lines(tenantId, tz, funds, cats, startDay, today);
    const res = assembleLedger(this.fundRows(funds), lines, today, today, null);
    return this.fundView(funds, res.funds);
  }

  async createFund(user: AuthenticatedUser, dto: { kind?: string; name?: string; last4?: string | null; openingCents?: number; openingDate?: string; isDefault?: boolean }) {
    const { tenantId, today } = await this.ctx(user);
    this.ownerOnly(user);
    const kind = dto.kind === 'BANK' ? 'BANK' : dto.kind === 'OTHER' ? 'OTHER' : (() => { throw new BadRequestException('Quỹ mới là Ngân hàng hoặc Khác — tiền mặt đã có sẵn.'); })();
    const name = this.text(dto.name, 60);
    if (!name) throw new BadRequestException('Đặt tên quỹ.');
    const opening = Math.round(Number(dto.openingCents ?? 0));
    if (!Number.isFinite(opening) || Math.abs(opening) > MAX_CENTS) throw new BadRequestException('Số dư đầu không hợp lệ.');
    const openingDate = this.dayOrToday(dto.openingDate, today);
    if (dto.isDefault && kind === 'BANK') await this.db.cashFund.updateMany({ where: { tenantId, kind: 'BANK' }, data: { isDefault: false } });
    const f = await this.db.cashFund.create({ data: { tenantId, kind, name, last4: this.text(dto.last4, 4), openingCents: opening, openingDate, isDefault: !!dto.isDefault && kind === 'BANK' } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'finance.fund_created', resourceType: 'cash_fund', resourceId: f.id, metadata: { kind, name, openingCents: opening, openingDate } });
    return f;
  }

  async updateFund(user: AuthenticatedUser, id: string, dto: { name?: string; last4?: string | null; openingCents?: number; openingDate?: string; isDefault?: boolean; archived?: boolean }) {
    const { tenantId, today } = await this.ctx(user);
    this.ownerOnly(user);
    const f = await this.db.cashFund.findFirst({ where: { id, tenantId } });
    if (!f) throw new NotFoundException('Không thấy quỹ này.');
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) { const n = this.text(dto.name, 60); if (!n) throw new BadRequestException('Đặt tên quỹ.'); data.name = n; }
    if (dto.last4 !== undefined) data.last4 = this.text(dto.last4, 4);
    if (dto.openingCents !== undefined) {
      const o = Math.round(Number(dto.openingCents));
      if (!Number.isFinite(o) || Math.abs(o) > MAX_CENTS) throw new BadRequestException('Số dư đầu không hợp lệ.');
      data.openingCents = o;
    }
    if (dto.openingDate !== undefined) {
      const d = this.dayOrToday(dto.openingDate, today);
      // Moving the start later would silently drop vouchers already written.
      if (d > f.openingDate) {
        const earlier = await this.db.cashEntry.findMany({ where: { tenantId, fundId: f.id, voidedAt: null, day: { lt: d } }, select: { id: true }, take: 1 });
        if (earlier.length) throw new BadRequestException('Đã có phiếu trước ngày này — không dời ngày bắt đầu sổ về sau được.');
      }
      data.openingDate = d;
    }
    if (dto.archived !== undefined) {
      if (f.kind === 'CASH' && dto.archived) throw new BadRequestException('Không đóng được quỹ tiền mặt.');
      if (dto.archived && f.isDefault) throw new BadRequestException('Chọn quỹ ngân hàng khác làm mặc định trước khi đóng quỹ này.');
      data.archivedAt = dto.archived ? new Date() : null;
    }
    if (dto.isDefault) {
      if (f.kind !== 'BANK') throw new BadRequestException('Chỉ quỹ ngân hàng làm mặc định nhận tiền thẻ được.');
      await this.db.cashFund.updateMany({ where: { tenantId, kind: 'BANK', NOT: { id: f.id } }, data: { isDefault: false } });
      data.isDefault = true;
    }
    await this.db.cashFund.updateMany({ where: { id: f.id, tenantId }, data });
    await this.audit.log({ tenantId, userId: user.userId, action: 'finance.fund_updated', resourceType: 'cash_fund', resourceId: f.id, metadata: { before: { name: f.name, openingCents: f.openingCents, openingDate: f.openingDate, isDefault: f.isDefault }, change: data as never } });
    return this.db.cashFund.findFirst({ where: { id: f.id, tenantId } });
  }

  async listCategories(user: AuthenticatedUser) {
    const { tenantId } = await this.ctx(user);
    return this.categoryView(await this.categories(tenantId));
  }

  private groupFor(direction: Direction, group: unknown): CatGroup {
    const g = String(group ?? '') as CatGroup;
    if (!GROUPS.includes(g)) throw new BadRequestException('Chọn nhóm.');
    if (direction === 'IN' && g !== 'INCOME' && g !== 'NON_PL') throw new BadRequestException('Loại thu chỉ thuộc nhóm Thu nhập hoặc Ngoài lãi lỗ.');
    if (direction === 'OUT' && g === 'INCOME') throw new BadRequestException('Loại chi không thuộc nhóm Thu nhập.');
    return g;
  }

  async createCategory(user: AuthenticatedUser, dto: { direction?: string; group?: string; name?: string; budgetCents?: number | null }) {
    const { tenantId } = await this.ctx(user);
    const direction: Direction = dto.direction === 'IN' ? 'IN' : 'OUT';
    const group = this.groupFor(direction, dto.group);
    const name = this.text(dto.name, 60);
    if (!name) throw new BadRequestException('Đặt tên loại.');
    const budget = dto.budgetCents == null ? null : this.cents(dto.budgetCents, 'Ngân sách');
    const c = await this.db.cashCategory.create({ data: { tenantId, direction, group, name, countsInPl: group !== 'NON_PL', budgetCents: budget, sort: 1000 } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'finance.category_created', resourceType: 'cash_category', resourceId: c.id, metadata: { direction, group, name } });
    return c;
  }

  async updateCategory(user: AuthenticatedUser, id: string, dto: { name?: string; group?: string; budgetCents?: number | null; hidden?: boolean }) {
    const { tenantId } = await this.ctx(user);
    const c = await this.db.cashCategory.findFirst({ where: { id, tenantId } });
    if (!c) throw new NotFoundException('Không thấy loại này.');
    const system = !!DEFAULT_CATEGORIES.find((d) => d.key === c.systemKey && d.system);
    const data: Record<string, unknown> = {};
    if (dto.budgetCents !== undefined) data.budgetCents = dto.budgetCents === null ? null : this.cents(dto.budgetCents, 'Ngân sách');
    if (!system) {
      if (dto.name !== undefined) { const n = this.text(dto.name, 60); if (!n) throw new BadRequestException('Đặt tên loại.'); data.name = n; }
      if (dto.group !== undefined) { const g = this.groupFor(c.direction, dto.group); data.group = g; data.countsInPl = g !== 'NON_PL'; }
      if (dto.hidden !== undefined) data.hidden = !!dto.hidden;
    } else if (dto.name !== undefined || dto.group !== undefined || dto.hidden !== undefined) {
      throw new BadRequestException(`"${c.name}" do hệ thống tự ghi — chỉ đặt được ngân sách.`);
    }
    await this.db.cashCategory.updateMany({ where: { id, tenantId }, data });
    await this.audit.log({ tenantId, userId: user.userId, action: 'finance.category_updated', resourceType: 'cash_category', resourceId: id, metadata: { before: { name: c.name, group: c.group, budgetCents: c.budgetCents, hidden: c.hidden }, change: data as never } });
    return this.db.cashCategory.findFirst({ where: { id, tenantId } });
  }

  // ===================== recurring costs =====================

  async listRecurring(user: AuthenticatedUser) {
    const { tenantId, tz, today } = await this.ctx(user);
    await this.materializeAuto(user, tenantId, tz, today);
    return this.db.recurringExpense.findMany({ where: { tenantId, active: true }, orderBy: { nextDue: 'asc' } });
  }

  async createRecurring(user: AuthenticatedUser, dto: { name?: string; categoryId?: string; fundId?: string; amountCents?: number | null; cadence?: string; anchorDay?: string; mode?: string; payee?: string }) {
    const { tenantId, today } = await this.ctx(user);
    const name = this.text(dto.name, 80);
    if (!name) throw new BadRequestException('Đặt tên khoản định kỳ.');
    const cat = await this.categoryFor(tenantId, dto.categoryId, 'OUT');
    const fund = await this.db.cashFund.findFirst({ where: { id: String(dto.fundId ?? ''), tenantId } });
    if (!fund || fund.archivedAt) throw new BadRequestException('Chọn quỹ trả.');
    const cadence: Cadence = dto.cadence === 'WEEKLY' ? 'WEEKLY' : dto.cadence === 'YEARLY' ? 'YEARLY' : 'MONTHLY';
    const anchor = String(dto.anchorDay ?? '');
    if (!DAY.test(anchor)) throw new BadRequestException('Chọn ngày đến hạn đầu tiên.');
    const amount = dto.amountCents == null ? null : this.cents(dto.amountCents, 'Số tiền');
    const mode = dto.mode === 'AUTO' ? 'AUTO' : 'REMIND';
    if (mode === 'AUTO' && amount === null) throw new BadRequestException('Tự lập phiếu cần số tiền cố định.');
    // A start date in the past for an AUTO cost would back-fill vouchers the
    // owner has likely already typed: AUTO starts no earlier than today.
    const nextDue = mode === 'AUTO' && anchor < today ? dueDaysUpTo(anchor, addDaysToKey(today, -1), cadence, anchor).next : anchor;
    if (mode === 'AUTO' && nextDue < fund.openingDate) throw new BadRequestException(`Sổ của quỹ "${fund.name}" bắt đầu từ ${fund.openingDate}.`);
    const r = await this.db.recurringExpense.create({ data: { tenantId, name, categoryId: cat.id, fundId: fund.id, amountCents: amount, cadence, anchorDay: anchor, nextDue, mode, payee: this.text(dto.payee, 120), active: true } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'finance.recurring_created', resourceType: 'recurring_expense', resourceId: r.id, metadata: { name, cadence, mode, amountCents: amount, nextDue } });
    return r;
  }

  async updateRecurring(user: AuthenticatedUser, id: string, dto: { name?: string; categoryId?: string; fundId?: string; amountCents?: number | null; mode?: string; payee?: string; nextDue?: string; active?: boolean }) {
    const { tenantId, today } = await this.ctx(user);
    const r = await this.db.recurringExpense.findFirst({ where: { id, tenantId } });
    if (!r) throw new NotFoundException('Không thấy khoản định kỳ này.');
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) { const n = this.text(dto.name, 80); if (!n) throw new BadRequestException('Đặt tên khoản định kỳ.'); data.name = n; }
    if (dto.categoryId !== undefined) data.categoryId = (await this.categoryFor(tenantId, dto.categoryId, 'OUT')).id;
    if (dto.fundId !== undefined) {
      const f = await this.db.cashFund.findFirst({ where: { id: String(dto.fundId), tenantId } });
      if (!f || f.archivedAt) throw new BadRequestException('Chọn quỹ trả.');
      data.fundId = f.id;
    }
    if (dto.amountCents !== undefined) data.amountCents = dto.amountCents === null ? null : this.cents(dto.amountCents, 'Số tiền');
    if (dto.payee !== undefined) data.payee = this.text(dto.payee, 120);
    if (dto.mode !== undefined) data.mode = dto.mode === 'AUTO' ? 'AUTO' : 'REMIND';
    if (dto.nextDue !== undefined) { if (!DAY.test(dto.nextDue)) throw new BadRequestException('Ngày không hợp lệ.'); data.nextDue = dto.nextDue; }
    if (dto.active !== undefined) data.active = !!dto.active;
    const amount = data.amountCents !== undefined ? data.amountCents : r.amountCents;
    const mode = data.mode ?? r.mode;
    if (mode === 'AUTO' && amount == null) throw new BadRequestException('Tự lập phiếu cần số tiền cố định.');
    // Switching to AUTO never back-fills: the next due day is today at the earliest.
    if (mode === 'AUTO' && r.mode !== 'AUTO') {
      const due = String(data.nextDue ?? r.nextDue);
      if (due < today) data.nextDue = dueDaysUpTo(due, addDaysToKey(today, -1), r.cadence, r.anchorDay).next;
    }
    await this.db.recurringExpense.updateMany({ where: { id, tenantId }, data });
    await this.audit.log({ tenantId, userId: user.userId, action: 'finance.recurring_updated', resourceType: 'recurring_expense', resourceId: id, metadata: { change: data as never } });
    return this.db.recurringExpense.findFirst({ where: { id, tenantId } });
  }

  /** "Paid" on a reminder: one voucher for its due day, and the next due day. */
  async payRecurring(user: AuthenticatedUser, id: string, dto: { amountCents?: number; day?: string; fundId?: string; note?: string; approvalPin?: string }) {
    const { tenantId, tz, today } = await this.ctx(user);
    const r = await this.db.recurringExpense.findFirst({ where: { id, tenantId } });
    if (!r || !r.active) throw new NotFoundException('Không thấy khoản định kỳ này.');
    const amount = this.cents(dto.amountCents ?? r.amountCents, 'Số tiền');
    const day = this.dayOrToday(dto.day, today);
    const fund = await this.fundFor(tenantId, dto.fundId ?? r.fundId, day);
    const cat = await this.db.cashCategory.findFirst({ where: { id: r.categoryId, tenantId } });
    let approvedBy: string | null = null;
    const { approvalOverCents } = await this.settingsOf(tenantId);
    if (approvalOverCents > 0 && amount > approvalOverCents) approvedBy = await this.pos.approverFor(user, tenantId, dto.approvalPin);
    const name = await this.nameOf(user);
    let e: EntryDb;
    try {
      e = await this.createWithCode(tenantId, 'PC', {
        direction: 'OUT', fundId: fund.id, categoryId: cat?.id ?? null, amountCents: amount, countsInPl: cat ? cat.countsInPl : true,
        occurredAt: this.occurredAt(day, today, tz), day, payee: r.payee, note: this.text(dto.note, 300) ?? r.name,
        source: 'RECURRING', sourceRef: `${r.id}:${r.nextDue}`, createdByUserId: user.userId, createdByName: name, approvedByUserId: approvedBy,
      });
    } catch (err) {
      if (this.isDuplicateSource(err)) throw new BadRequestException('Kỳ này đã ghi trả rồi.');
      throw err;
    }
    await this.db.recurringExpense.updateMany({ where: { id: r.id, tenantId, nextDue: r.nextDue }, data: { nextDue: advanceDue(r.nextDue, r.cadence, r.anchorDay) } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'finance.recurring_paid', resourceType: 'recurring_expense', resourceId: r.id, metadata: { code: e.code, due: r.nextDue, amountCents: amount, day } });
    return e;
  }

  async skipRecurring(user: AuthenticatedUser, id: string) {
    const { tenantId } = await this.ctx(user);
    const r = await this.db.recurringExpense.findFirst({ where: { id, tenantId } });
    if (!r) throw new NotFoundException('Không thấy khoản định kỳ này.');
    const next = advanceDue(r.nextDue, r.cadence, r.anchorDay);
    await this.db.recurringExpense.updateMany({ where: { id, tenantId, nextDue: r.nextDue }, data: { nextDue: next } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'finance.recurring_skipped', resourceType: 'recurring_expense', resourceId: id, metadata: { due: r.nextDue, next } });
    return { id, nextDue: next };
  }

  /**
   * AUTO costs write their own voucher on each due day that has come. Run on
   * every read of the books, so nothing depends on a timer: the voucher is
   * there the first time anyone looks. The unique (source, sourceRef) index
   * makes a second reader at the same moment a no-op.
   */
  private async materializeAuto(user: AuthenticatedUser, tenantId: string, tz: string, today: string): Promise<void> {
    // Reading the books must never fail because a reminder could not be written.
    await this.writeAutoVouchers(user, tenantId, tz, today).catch(() => undefined);
  }

  private async writeAutoVouchers(user: AuthenticatedUser, tenantId: string, tz: string, today: string): Promise<void> {
    const recs = await this.db.recurringExpense.findMany({ where: { tenantId, active: true, mode: 'AUTO', nextDue: { lte: today } } });
    for (const r of recs) {
      if (r.amountCents == null || r.amountCents <= 0) continue;
      const fund = await this.db.cashFund.findFirst({ where: { id: r.fundId, tenantId } });
      const cat = await this.db.cashCategory.findFirst({ where: { id: r.categoryId, tenantId } });
      const { due, next } = dueDaysUpTo(r.nextDue, today, r.cadence, r.anchorDay, 24);
      for (const d of due) {
        if (!fund || fund.archivedAt || d < fund.openingDate) continue;
        try {
          const e = await this.createWithCode(tenantId, 'PC', {
            direction: 'OUT', fundId: fund.id, categoryId: cat?.id ?? null, amountCents: r.amountCents, countsInPl: cat ? cat.countsInPl : true,
            occurredAt: this.occurredAt(d, today, tz), day: d, payee: r.payee, note: r.name,
            source: 'RECURRING', sourceRef: `${r.id}:${d}`, createdByUserId: null, createdByName: 'Tự động',
          });
          await this.audit.log({ tenantId, userId: user.userId, action: 'finance.recurring_auto', resourceType: 'recurring_expense', resourceId: r.id, metadata: { code: e.code, due: d, amountCents: r.amountCents } });
        } catch (err) {
          if (!this.isDuplicateSource(err)) throw err;
        }
      }
      await this.db.recurringExpense.updateMany({ where: { id: r.id, tenantId, nextDue: r.nextDue }, data: { nextDue: next } });
    }
  }
}
