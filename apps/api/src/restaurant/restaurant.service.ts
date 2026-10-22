import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderItemKind, PaymentMethod, PrintJobStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { PosService } from '../pos/pos.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { hasCapability } from '../auth/capabilities';
import { cleanLayout, withDefaults } from '../tables/floor';
import {
  DEFAULT_SETTINGS, Lang, LineLike, RestaurantSettings, SETTINGS_KEY, checkLabel, checkTotals, chosenOf, cleanNote, cleanOptionGroups,
  cleanSettings, clockText, groupForSend, langFor, moneyText, optionsKey, pickOptions, prebillText, qty, soldOutNow, stationFor,
  stationName, stationsCooking, ticketText,
} from './check-logic';

const LIVE = ['OPEN', 'PAYING'];
const MAX_TABLES = 6;

/**
 * Table service for restaurants: open a bill on a table (or a to-go bill),
 * add dishes with their options, send the new ones to the kitchen (one ticket
 * per prep station), take a sent dish back with a reason, print the guest
 * check, move, merge and split bills, and pay — the payment is the till's
 * ordinary checkout (PosService.createOrder), so shifts, tenders, the ledger,
 * loyalty and reports work exactly as for any other sale.
 *
 * Every read and write is scoped to the caller's tenantId, and every table,
 * dish, bill and line id from the request is looked up under that tenantId
 * first: another restaurant's id is simply "not found". Refusals are codes
 * (CHECK_NOT_FOUND, LINE_SENT…) that the till puts into the cashier's language.
 */
@Injectable()
export class RestaurantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly pos: PosService,
  ) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('NO_TENANT');
    return id;
  }

  async getSettings(tenantId: string): Promise<RestaurantSettings> {
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: SETTINGS_KEY } } }).catch(() => null);
    return cleanSettings(row?.value ?? DEFAULT_SETTINGS);
  }

  async readSettings(user: AuthenticatedUser) {
    return this.getSettings(this.tenantId(user));
  }

  /** Owner only (controller). Unknown keys and junk are dropped by cleanSettings; cashiers must be this restaurant's people. */
  async saveSettings(user: AuthenticatedUser, raw: unknown) {
    const tenantId = this.tenantId(user);
    const clean = cleanSettings(raw);
    if (clean.cashierUserIds.length) {
      const mine = await this.prisma.user.findMany({ where: { tenantId, id: { in: clean.cashierUserIds } }, select: { id: true } });
      const ok = new Set(mine.map((u) => u.id));
      clean.cashierUserIds = clean.cashierUserIds.filter((id) => ok.has(id));
    }
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: SETTINGS_KEY } },
      update: { value: clean as never },
      create: { tenantId, key: SETTINGS_KEY, value: clean as never },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'restaurant.settings_updated', resourceType: 'tenant', resourceId: tenantId });
    return clean;
  }

  /** The people the owner can name as cashiers: this restaurant's staff logins. */
  async people(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const rows = await this.prisma.user.findMany({
      where: { tenantId, role: UserRole.STAFF, isActive: true } as never,
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: { firstName: 'asc' },
    });
    return rows.map((u) => ({ id: u.id, name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email }));
  }

  private async nameOf(user: AuthenticatedUser): Promise<string | null> {
    const u = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { firstName: true, email: true } }).catch(() => null);
    if (!u) return null;
    return (u.firstName ?? '').trim() || (u.email ? u.email.split('@')[0] : null);
  }

  private async context(tenantId: string) {
    const [rules, tenant] = await Promise.all([
      this.settings.getBookingRules(tenantId).catch(() => ({ currency: 'USD' } as { currency?: string })),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }).catch(() => null),
    ]);
    const currency = (rules as { currency?: string }).currency || 'USD';
    return { currency, tz: tenant?.timezone || 'UTC', lang: langFor(currency) as Lang };
  }

  private async tableNames(tenantId: string): Promise<Map<string, string>> {
    const rows = await this.prisma.restaurantTable.findMany({ where: { tenantId }, select: { id: true, name: true } });
    return new Map(rows.map((t) => [t.id, t.name]));
  }

  /** The caller's bill, or 404 — never another restaurant's. */
  private async loadCheck(tenantId: string, id: string) {
    const check = await this.prisma.tableCheck.findFirst({
      where: { id, tenantId },
      include: { lines: { where: { tenantId }, orderBy: { createdAt: 'asc' } } },
    });
    if (!check) throw new NotFoundException('CHECK_NOT_FOUND');
    return check;
  }

  private assertOpen(check: { status: string }) {
    if (check.status !== 'OPEN') throw new ConflictException(check.status === 'PAYING' ? 'CHECK_PAYING' : 'CHECK_CLOSED');
  }

  private view(check: Awaited<ReturnType<RestaurantService['loadCheck']>>, names: Map<string, string>, lang: Lang) {
    const totals = checkTotals(check.lines as LineLike[]);
    return {
      id: check.id,
      number: check.number,
      status: check.status,
      tableIds: check.tableIds,
      takeaway: check.tableIds.length === 0,
      tables: checkLabel(check.tableIds, names, check.number, lang),
      guests: check.guests,
      serverName: check.serverName,
      customerId: check.customerId,
      note: check.note,
      openedAt: check.openedAt,
      sendCount: check.sendCount,
      preBilledAt: check.preBilledAt,
      preBillCount: check.preBillCount,
      changedAfterPrebill: check.changedAfterPrebill,
      payRequestedAt: check.payRequestedAt,
      orderId: check.orderId,
      ...totals,
      lines: check.lines.map((l) => ({
        id: l.id, menuItemId: l.menuItemId, name: l.name, unitPriceCents: l.unitPriceCents, quantity: l.quantity,
        note: l.note, options: chosenOf(l.options).map((o) => o.name), station: l.station, state: l.state, batch: l.batch,
        sentAt: l.sentAt, sentByName: l.sentByName, voidReason: l.voidReason, voidedAt: l.voidedAt,
      })),
    };
  }

  /** Tables, their spots, the bills on them right now (to-go bills too), the stations and timers. */
  async floor(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const [tables, layoutRow, checks, settings, ctx] = await Promise.all([
      this.prisma.restaurantTable.findMany({ where: { tenantId, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: 'table_layout' } } }).catch(() => null),
      this.prisma.tableCheck.findMany({
        where: { tenantId, status: { in: LIVE } },
        include: { lines: { where: { tenantId }, select: { state: true, quantity: true, unitPriceCents: true } } },
        orderBy: { openedAt: 'asc' },
      }),
      this.getSettings(tenantId),
      this.context(tenantId),
    ]);
    const layout = withDefaults(tables, cleanLayout(layoutRow?.value ?? {}, tables.map((t) => t.id)));
    const names = new Map(tables.map((t) => [t.id, t.name]));
    return {
      currency: ctx.currency,
      settings,
      canPay: this.canPay(user, settings),
      tables: tables.map((t) => ({ id: t.id, name: t.name, seats: t.seats, area: t.area })),
      layout,
      checks: checks.map((c) => ({
        id: c.id, number: c.number, status: c.status, tableIds: c.tableIds, takeaway: c.tableIds.length === 0,
        tables: checkLabel(c.tableIds, names, c.number, ctx.lang),
        guests: c.guests, serverName: c.serverName, openedAt: c.openedAt, preBilledAt: c.preBilledAt, payRequestedAt: c.payRequestedAt,
        ...checkTotals(c.lines.map((l, i) => ({ id: String(i), name: '', station: '', ...l }))),
      })),
    };
  }

  /** The dishes the till can sell: station, options, and whether they are sold out today. */
  async menu(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const [items, settings, ctx] = await Promise.all([
      this.prisma.menuItem.findMany({ where: { tenantId, isActive: true }, orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }] }),
      this.getSettings(tenantId),
      this.context(tenantId),
    ]);
    const now = new Date();
    return items.map((m) => ({
      id: m.id, name: m.name, category: m.category, priceCents: m.priceCents, imageUrl: m.imageUrl,
      station: stationFor(m.category, settings), options: cleanOptionGroups(m.options),
      soldOut: soldOutNow(m.soldOutAt, settings.soldOutReset, ctx.tz, now),
    }));
  }

  /** Mark a dish sold out (86) or back. Anyone at the till; every change is logged. */
  async setSoldOut(user: AuthenticatedUser, itemId: string, soldOut: boolean) {
    const tenantId = this.tenantId(user);
    const r = await this.prisma.menuItem.updateMany({ where: { id: itemId, tenantId }, data: { soldOutAt: soldOut ? new Date() : null } });
    if (r.count === 0) throw new NotFoundException('DISH_NOT_FOUND');
    await this.audit.log({ tenantId, userId: user.userId, action: soldOut ? 'restaurant.sold_out' : 'restaurant.back_in_stock', resourceType: 'menu_item', resourceId: itemId });
    return this.menu(user);
  }

  async getCheck(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const [check, names, ctx] = await Promise.all([this.loadCheck(tenantId, id), this.tableNames(tenantId), this.context(tenantId)]);
    return this.view(check, names, ctx.lang);
  }

  /** Checks a set of table ids: all this restaurant's, active, and free. */
  private async freeTables(tenantId: string, raw: unknown, exceptCheckId?: string): Promise<string[]> {
    const ids = [...new Set((Array.isArray(raw) ? raw : []).map((x) => String(x ?? '').trim()).filter(Boolean))];
    if (!ids.length) throw new BadRequestException('TABLE_REQUIRED');
    if (ids.length > MAX_TABLES) throw new BadRequestException('TOO_MANY_TABLES');
    const found = await this.prisma.restaurantTable.findMany({ where: { tenantId, id: { in: ids }, isActive: true }, select: { id: true } });
    if (found.length !== ids.length) throw new NotFoundException('TABLE_NOT_FOUND');
    const busy = await this.prisma.tableCheck.findFirst({
      where: { tenantId, status: { in: LIVE }, tableIds: { hasSome: ids }, ...(exceptCheckId ? { id: { not: exceptCheckId } } : {}) },
      select: { id: true, number: true },
    });
    if (busy) throw new ConflictException(`TABLE_BUSY:${busy.id}`);
    return ids;
  }

  private async nextNumber(tenantId: string): Promise<number> {
    const last = await this.prisma.tableCheck.findFirst({ where: { tenantId }, orderBy: { number: 'desc' }, select: { number: true } });
    return (last?.number ?? 0) + 1;
  }

  /** A new bill: on free tables, or a to-go bill with no table. */
  async openCheck(user: AuthenticatedUser, dto: { tableIds?: unknown; guests?: unknown; note?: unknown; takeaway?: unknown }) {
    const tenantId = this.tenantId(user);
    const takeaway = dto.takeaway === true;
    const tableIds = takeaway ? [] : await this.freeTables(tenantId, dto.tableIds);
    const guests = qty(dto.guests ?? 1) ?? 1;
    const serverName = await this.nameOf(user);
    let created: { id: string } | null = null;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        created = await this.prisma.tableCheck.create({
          data: { tenantId, number: await this.nextNumber(tenantId), tableIds, guests, serverUserId: user.userId, serverName, note: cleanNote(dto.note) },
          select: { id: true },
        });
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002' || attempt === 2) throw e;
      }
    }
    await this.audit.log({ tenantId, userId: user.userId, action: 'restaurant.check_opened', resourceType: 'table_check', resourceId: created!.id, metadata: { tableIds, guests, takeaway } });
    return this.getCheck(user, created!.id);
  }

  async updateCheck(user: AuthenticatedUser, id: string, dto: { guests?: unknown; note?: unknown; customerId?: unknown }) {
    const tenantId = this.tenantId(user);
    const check = await this.loadCheck(tenantId, id);
    this.assertOpen(check);
    const data: Record<string, unknown> = {};
    if (dto.guests !== undefined) {
      const g = qty(dto.guests);
      if (!g) throw new BadRequestException('BAD_GUESTS');
      data.guests = g;
    }
    if (dto.note !== undefined) data.note = cleanNote(dto.note);
    if (dto.customerId !== undefined) {
      const cid = dto.customerId ? String(dto.customerId) : null;
      if (cid) {
        const c = await this.prisma.customer.findFirst({ where: { id: cid, tenantId }, select: { id: true } });
        if (!c) throw new NotFoundException('CUSTOMER_NOT_FOUND');
      }
      data.customerId = cid;
    }
    await this.prisma.tableCheck.updateMany({ where: { id, tenantId }, data });
    return this.getCheck(user, id);
  }

  /** A change after the guest check was printed is allowed, and remembered. */
  private async touchAfterPrebill(tenantId: string, user: AuthenticatedUser, check: { id: string; preBilledAt: Date | null; changedAfterPrebill: boolean }, what: string) {
    if (!check.preBilledAt) return;
    if (!check.changedAfterPrebill) await this.prisma.tableCheck.updateMany({ where: { id: check.id, tenantId }, data: { changedAfterPrebill: true } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'restaurant.after_prebill_change', resourceType: 'table_check', resourceId: check.id, metadata: { what } });
  }

  async addLine(user: AuthenticatedUser, id: string, dto: { menuItemId?: unknown; quantity?: unknown; note?: unknown; options?: unknown }) {
    const tenantId = this.tenantId(user);
    const check = await this.loadCheck(tenantId, id);
    this.assertOpen(check);
    const n = qty(dto.quantity ?? 1);
    if (!n) throw new BadRequestException('BAD_QUANTITY');
    const item = await this.prisma.menuItem.findFirst({ where: { id: String(dto.menuItemId ?? ''), tenantId, isActive: true } });
    if (!item) throw new NotFoundException('DISH_NOT_FOUND');
    const [settings, ctx] = await Promise.all([this.getSettings(tenantId), this.context(tenantId)]);
    if (soldOutNow(item.soldOutAt, settings.soldOutReset, ctx.tz)) throw new ConflictException('SOLD_OUT');
    let picked: ReturnType<typeof pickOptions>;
    try { picked = pickOptions(cleanOptionGroups(item.options), dto.options); } catch (e) { throw new BadRequestException((e as Error).message); }
    const note = cleanNote(dto.note);
    const unit = item.priceCents + picked.extraCents;
    const key = optionsKey(picked.chosen);
    const same = check.lines.find((l) => l.state === 'UNSENT' && l.menuItemId === item.id && (l.note ?? null) === note && l.unitPriceCents === unit && optionsKey(chosenOf(l.options)) === key);
    if (same) {
      await this.prisma.tableCheckLine.updateMany({ where: { id: same.id, tenantId, state: 'UNSENT' }, data: { quantity: Math.min(99, same.quantity + n) } });
    } else {
      await this.prisma.tableCheckLine.create({
        data: {
          tenantId, checkId: check.id, menuItemId: item.id, name: item.name, unitPriceCents: unit, quantity: n, note,
          options: picked.chosen as never, station: stationFor(item.category, settings), createdByUserId: user.userId,
        },
      });
    }
    await this.touchAfterPrebill(tenantId, user, check, `add ${n} x ${item.name}`);
    return this.getCheck(user, id);
  }

  private async unsentLine(tenantId: string, checkId: string, lineId: string) {
    const line = await this.prisma.tableCheckLine.findFirst({ where: { id: lineId, checkId, tenantId } });
    if (!line) throw new NotFoundException('LINE_NOT_FOUND');
    if (line.state !== 'UNSENT') throw new ConflictException('LINE_SENT');
    return line;
  }

  /** Only a dish the kitchen has not seen can be edited. Quantity 0 removes it. */
  async updateLine(user: AuthenticatedUser, id: string, lineId: string, dto: { quantity?: unknown; note?: unknown }) {
    const tenantId = this.tenantId(user);
    const check = await this.loadCheck(tenantId, id);
    this.assertOpen(check);
    const line = await this.unsentLine(tenantId, id, lineId);
    if (dto.quantity !== undefined && Math.round(Number(dto.quantity)) === 0) {
      await this.prisma.tableCheckLine.deleteMany({ where: { id: line.id, tenantId, state: 'UNSENT' } });
    } else {
      const data: Record<string, unknown> = {};
      if (dto.quantity !== undefined) {
        const n = qty(dto.quantity);
        if (!n) throw new BadRequestException('BAD_QUANTITY');
        data.quantity = n;
      }
      if (dto.note !== undefined) data.note = cleanNote(dto.note);
      await this.prisma.tableCheckLine.updateMany({ where: { id: line.id, tenantId, state: 'UNSENT' }, data });
    }
    await this.touchAfterPrebill(tenantId, user, check, `edit ${line.name}`);
    return this.getCheck(user, id);
  }

  async removeLine(user: AuthenticatedUser, id: string, lineId: string) {
    return this.updateLine(user, id, lineId, { quantity: 0 });
  }

  /**
   * Send the new dishes to the kitchen. Only UNSENT lines go, one ticket per
   * station; the bill's send counter moves with a compare-and-set, so two
   * phones pressing at once print each dish once.
   */
  async send(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const check = await this.loadCheck(tenantId, id);
    this.assertOpen(check);
    const settings = await this.getSettings(tenantId);
    const groups = groupForSend(check.lines as LineLike[], settings);
    if (!groups.length) return { sent: 0, batch: null, stations: [], check: await this.getCheck(user, id) };
    const [ctx, names, by] = await Promise.all([this.context(tenantId), this.tableNames(tenantId), this.nameOf(user)]);
    const batch = check.sendCount + 1;
    const now = new Date();
    const ids = groups.flatMap((g) => g.lines.map((l) => l.id));
    const label = checkLabel(check.tableIds, names, check.number, ctx.lang);
    const optionsOf = new Map(check.lines.map((l) => [l.id, chosenOf(l.options).map((o) => o.name)]));
    const sent = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.tableCheck.updateMany({ where: { id, tenantId, status: 'OPEN', sendCount: check.sendCount }, data: { sendCount: batch } });
      if (moved.count === 0) return 0;
      const res = await tx.tableCheckLine.updateMany({ where: { tenantId, checkId: id, id: { in: ids }, state: 'UNSENT' }, data: { state: 'SENT', batch, sentAt: now, sentByName: by } });
      for (const g of groups) {
        const text = ticketText({
          kind: 'NEW', lang: ctx.lang, stationName: stationName(g.station, settings), tables: label, takeaway: check.tableIds.length === 0,
          checkNumber: check.number, batch, guests: check.guests, server: check.serverName, at: clockText(now, ctx.tz, ctx.lang),
          lines: g.lines.map((l) => ({ quantity: l.quantity, name: l.name, note: l.note, options: optionsOf.get(l.id) })),
        });
        await tx.printJob.create({ data: { tenantId, station: g.station, title: `${stationName(g.station, settings)} · ${label} · #${check.number}/${batch}`, text, createdById: user.userId } });
      }
      return res.count;
    });
    if (!sent) return { sent: 0, batch: null, stations: [], check: await this.getCheck(user, id) };
    await this.audit.log({ tenantId, userId: user.userId, action: 'restaurant.sent_to_kitchen', resourceType: 'table_check', resourceId: id, metadata: { batch, lines: ids.length } });
    return { sent, batch, stations: groups.map((g) => g.station), check: await this.getCheck(user, id) };
  }

  /** Who approves taking back a sent dish: the caller with pos.void, or a manager's PIN. */
  private async approval(user: AuthenticatedUser, tenantId: string, settings: RestaurantSettings, pin?: unknown): Promise<string> {
    if (!settings.voidNeedsApproval) return user.userId;
    return this.pos.approverFor(user, tenantId, pin == null ? undefined : String(pin));
  }

  private async userName(tenantId: string, userId: string): Promise<string | null> {
    const u = await this.prisma.user.findFirst({ where: { id: userId, tenantId }, select: { firstName: true, email: true } }).catch(() => null);
    return u ? ((u.firstName ?? '').trim() || (u.email ? u.email.split('@')[0] : null)) : null;
  }

  /**
   * Take back a dish the kitchen already has. A reason is required, approval
   * per the restaurant's rule, and the station gets a CANCEL ticket. Part of a
   * line can be taken back: the rest stays sent.
   */
  async voidLine(user: AuthenticatedUser, id: string, lineId: string, dto: { quantity?: unknown; reason?: unknown; approvalPin?: unknown }) {
    const tenantId = this.tenantId(user);
    const check = await this.loadCheck(tenantId, id);
    this.assertOpen(check);
    const line = check.lines.find((l) => l.id === lineId);
    if (!line) throw new NotFoundException('LINE_NOT_FOUND');
    if (line.state === 'UNSENT') throw new ConflictException('LINE_NOT_SENT');
    if (line.state !== 'SENT') throw new ConflictException('LINE_VOID');
    const n = qty(dto.quantity ?? line.quantity);
    if (!n || n > line.quantity) throw new BadRequestException('BAD_QUANTITY');
    const reason = cleanNote(dto.reason);
    if (!reason || reason.length < 2) throw new BadRequestException('VOID_REASON_REQUIRED');
    const settings = await this.getSettings(tenantId);
    const approverId = await this.approval(user, tenantId, settings, dto.approvalPin);
    const [ctx, names, by, approver] = await Promise.all([
      this.context(tenantId), this.tableNames(tenantId), this.nameOf(user),
      approverId === user.userId ? Promise.resolve(null) : this.userName(tenantId, approverId),
    ]);
    const now = new Date();
    const label = checkLabel(check.tableIds, names, check.number, ctx.lang);
    await this.prisma.$transaction(async (tx) => {
      if (n === line.quantity) {
        const r = await tx.tableCheckLine.updateMany({ where: { id: line.id, tenantId, state: 'SENT' }, data: { state: 'VOID', voidReason: reason, voidByUserId: user.userId, voidApprovedBy: approverId, voidedAt: now } });
        if (r.count === 0) throw new ConflictException('LINE_CHANGED');
      } else {
        const r = await tx.tableCheckLine.updateMany({ where: { id: line.id, tenantId, state: 'SENT', quantity: line.quantity }, data: { quantity: line.quantity - n } });
        if (r.count === 0) throw new ConflictException('LINE_CHANGED');
        await tx.tableCheckLine.create({
          data: {
            tenantId, checkId: check.id, menuItemId: line.menuItemId, name: line.name, unitPriceCents: line.unitPriceCents, quantity: n, note: line.note,
            options: (line.options ?? []) as never, station: line.station, state: 'VOID', batch: line.batch, sentAt: line.sentAt, sentByName: line.sentByName,
            voidReason: reason, voidByUserId: user.userId, voidApprovedBy: approverId, voidedAt: now, createdByUserId: line.createdByUserId,
          },
        });
      }
      if (settings.printVoid) {
        const text = ticketText({
          kind: 'VOID', lang: ctx.lang, stationName: stationName(line.station, settings), tables: label, takeaway: check.tableIds.length === 0,
          checkNumber: check.number, at: clockText(now, ctx.tz, ctx.lang), reason, by, approver,
          lines: [{ quantity: n, name: line.name, note: line.note, options: chosenOf(line.options).map((o) => o.name), sentAt: line.sentAt ? clockText(line.sentAt, ctx.tz, ctx.lang) : null }],
        });
        await tx.printJob.create({ data: { tenantId, station: line.station, title: `VOID · ${label} · #${check.number}`, text, createdById: user.userId } });
      }
    });
    await this.audit.log({
      tenantId, userId: user.userId, action: 'restaurant.item_voided', resourceType: 'table_check', resourceId: id,
      metadata: { lineId: line.id, name: line.name, quantity: n, amountCents: n * line.unitPriceCents, reason, approvedBy: approverId },
    });
    await this.touchAfterPrebill(tenantId, user, check, `void ${n} x ${line.name}`);
    return this.getCheck(user, id);
  }

  /** The guest check (tạm tính), to the counter printer. Not a receipt. */
  async prebill(user: AuthenticatedUser, id: string, dto: { print?: unknown } = {}) {
    const tenantId = this.tenantId(user);
    const check = await this.loadCheck(tenantId, id);
    this.assertOpen(check);
    const totals = checkTotals(check.lines as LineLike[]);
    if (totals.itemCount === 0) throw new BadRequestException('EMPTY_CHECK');
    const [ctx, names, profile, cashier] = await Promise.all([
      this.context(tenantId), this.tableNames(tenantId), this.settings.receiptProfile(tenantId).catch(() => null), this.nameOf(user),
    ]);
    const now = new Date();
    const count = check.preBillCount + 1;
    const live = check.lines.filter((l) => l.state !== 'VOID');
    const label = checkLabel(check.tableIds, names, check.number, ctx.lang);
    const text = prebillText({
      lang: ctx.lang, business: profile?.shop.name ?? '', address: profile?.shop.address, phone: profile?.shop.phone,
      tables: label, takeaway: check.tableIds.length === 0, checkNumber: check.number, count, at: clockText(now, ctx.tz, ctx.lang), cashier,
      lines: live.map((l) => ({ quantity: l.quantity, name: l.name, amountCents: l.quantity * l.unitPriceCents, options: chosenOf(l.options).map((o) => o.name) })),
      totalCents: totals.subtotalCents, money: (c) => moneyText(c, ctx.currency),
    });
    await this.prisma.tableCheck.updateMany({ where: { id, tenantId }, data: { preBilledAt: now, preBillCount: count, changedAfterPrebill: false } });
    if (dto.print !== false) {
      await this.prisma.printJob.create({ data: { tenantId, station: null, title: `${ctx.lang === 'vi' ? 'Tạm tính' : 'Guest check'} · ${label} · #${check.number}`, text, createdById: user.userId } });
    }
    await this.audit.log({ tenantId, userId: user.userId, action: 'restaurant.prebill_printed', resourceType: 'table_check', resourceId: id, metadata: { count, totalCents: totals.subtotalCents } });
    return { text, check: await this.getCheck(user, id) };
  }

  /** Print MOVED tickets for a bill's cooking dishes, now under a new name. */
  private async printMoved(tx: Pick<PrismaService, 'printJob'>, tenantId: string, user: AuthenticatedUser, lines: LineLike[], from: string, to: string, number: number, settings: RestaurantSettings, ctx: { lang: Lang; tz: string }, by: string | null) {
    if (!settings.printMove) return;
    const now = new Date();
    for (const station of stationsCooking(lines)) {
      const text = ticketText({
        kind: 'MOVE', lang: ctx.lang, stationName: stationName(station, settings), tables: to, fromTables: from, checkNumber: number,
        server: by, at: clockText(now, ctx.tz, ctx.lang),
        lines: lines.filter((l) => l.state === 'SENT' && l.station === station).map((l) => ({ quantity: l.quantity, name: l.name })),
      });
      await tx.printJob.create({ data: { tenantId, station, title: `MOVE · ${from} → ${to}`, text, createdById: user.userId } });
    }
  }

  /** Move the bill to other (free) tables; stations still cooking are told. */
  async move(user: AuthenticatedUser, id: string, dto: { tableIds?: unknown }) {
    const tenantId = this.tenantId(user);
    const check = await this.loadCheck(tenantId, id);
    this.assertOpen(check);
    const to = await this.freeTables(tenantId, dto.tableIds, id);
    const [settings, ctx, names, by] = await Promise.all([this.getSettings(tenantId), this.context(tenantId), this.tableNames(tenantId), this.nameOf(user)]);
    const from = checkLabel(check.tableIds, names, check.number, ctx.lang);
    const toLabel = checkLabel(to, names, check.number, ctx.lang);
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.tableCheck.updateMany({ where: { id, tenantId, status: 'OPEN' }, data: { tableIds: to } });
      if (r.count === 0) throw new ConflictException('CHECK_CLOSED');
      await this.printMoved(tx, tenantId, user, check.lines as LineLike[], from, toLabel, check.number, settings, ctx, by);
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'restaurant.check_moved', resourceType: 'table_check', resourceId: id, metadata: { from: check.tableIds, to } });
    return this.getCheck(user, id);
  }

  /**
   * Merge another open bill into this one (two tables pushed together, or a
   * party that joined its friends). Its dishes, tables and guests come over;
   * it closes as MERGED. Neither bill may be being paid.
   */
  async merge(user: AuthenticatedUser, id: string, dto: { fromCheckId?: unknown }) {
    const tenantId = this.tenantId(user);
    const fromId = String(dto.fromCheckId ?? '');
    if (!fromId || fromId === id) throw new BadRequestException('MERGE_SAME');
    const [into, from] = await Promise.all([this.loadCheck(tenantId, id), this.loadCheck(tenantId, fromId)]);
    this.assertOpen(into);
    this.assertOpen(from);
    const [settings, ctx, names, by] = await Promise.all([this.getSettings(tenantId), this.context(tenantId), this.tableNames(tenantId), this.nameOf(user)]);
    const tableIds = [...new Set([...into.tableIds, ...from.tableIds])].slice(0, MAX_TABLES * 2);
    const fromLabel = checkLabel(from.tableIds, names, from.number, ctx.lang);
    const toLabel = checkLabel(tableIds, names, into.number, ctx.lang);
    await this.prisma.$transaction(async (tx) => {
      const closed = await tx.tableCheck.updateMany({ where: { id: from.id, tenantId, status: 'OPEN' }, data: { status: 'VOID', closedAt: new Date(), voidReason: 'MERGED', mergedInto: into.id } });
      if (closed.count === 0) throw new ConflictException('CHECK_CLOSED');
      const kept = await tx.tableCheck.updateMany({ where: { id: into.id, tenantId, status: 'OPEN' }, data: { tableIds, guests: Math.min(99, into.guests + from.guests) } });
      if (kept.count === 0) throw new ConflictException('CHECK_CLOSED');
      await tx.tableCheckLine.updateMany({ where: { tenantId, checkId: from.id }, data: { checkId: into.id } });
      await this.printMoved(tx, tenantId, user, from.lines as LineLike[], fromLabel, toLabel, into.number, settings, ctx, by);
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'restaurant.checks_merged', resourceType: 'table_check', resourceId: into.id, metadata: { from: from.id, fromNumber: from.number } });
    return this.getCheck(user, into.id);
  }

  /**
   * Split some dishes onto a new bill on the same tables (separate payers).
   * Part of a line can move ("1 of the 2 beers"). The new bill is paid on its
   * own; the kitchen is not told — nothing changes for it.
   */
  async split(user: AuthenticatedUser, id: string, dto: { lines?: { lineId?: unknown; quantity?: unknown }[] }) {
    const tenantId = this.tenantId(user);
    const check = await this.loadCheck(tenantId, id);
    this.assertOpen(check);
    const picks = new Map<string, number>();
    for (const p of Array.isArray(dto.lines) ? dto.lines : []) {
      const line = check.lines.find((l) => l.id === String(p?.lineId ?? ''));
      if (!line) throw new NotFoundException('LINE_NOT_FOUND');
      if (line.state === 'VOID') throw new ConflictException('LINE_VOID');
      const n = qty(p?.quantity ?? line.quantity);
      if (!n || n > line.quantity) throw new BadRequestException('BAD_QUANTITY');
      picks.set(line.id, n);
    }
    if (!picks.size) throw new BadRequestException('SPLIT_EMPTY');
    const left = check.lines.filter((l) => l.state !== 'VOID').reduce((s, l) => s + l.quantity - (picks.get(l.id) ?? 0), 0);
    if (left <= 0) throw new BadRequestException('SPLIT_ALL');
    const serverName = await this.nameOf(user);
    let newId = '';
    for (let attempt = 0; attempt < 3 && !newId; attempt++) {
      try {
        newId = await this.prisma.$transaction(async (tx) => {
          const still = await tx.tableCheck.updateMany({ where: { id, tenantId, status: 'OPEN' }, data: { guests: check.guests } });
          if (still.count === 0) throw new ConflictException('CHECK_CLOSED');
          const created = await tx.tableCheck.create({
            data: { tenantId, number: await this.nextNumber(tenantId), tableIds: check.tableIds, guests: 1, serverUserId: user.userId, serverName, note: check.note, splitFrom: check.id },
            select: { id: true },
          });
          for (const [lineId, n] of picks) {
            const line = check.lines.find((l) => l.id === lineId)!;
            if (n === line.quantity) {
              const r = await tx.tableCheckLine.updateMany({ where: { id: lineId, tenantId, checkId: id, quantity: line.quantity }, data: { checkId: created.id } });
              if (r.count === 0) throw new ConflictException('LINE_CHANGED');
            } else {
              const r = await tx.tableCheckLine.updateMany({ where: { id: lineId, tenantId, checkId: id, quantity: line.quantity }, data: { quantity: line.quantity - n } });
              if (r.count === 0) throw new ConflictException('LINE_CHANGED');
              await tx.tableCheckLine.create({
                data: {
                  tenantId, checkId: created.id, menuItemId: line.menuItemId, name: line.name, unitPriceCents: line.unitPriceCents, quantity: n, note: line.note,
                  options: (line.options ?? []) as never, station: line.station, state: line.state, batch: line.batch, sentAt: line.sentAt, sentByName: line.sentByName,
                  createdByUserId: line.createdByUserId,
                },
              });
            }
          }
          return created.id;
        });
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002' || attempt === 2) throw e;
      }
    }
    await this.audit.log({ tenantId, userId: user.userId, action: 'restaurant.check_split', resourceType: 'table_check', resourceId: id, metadata: { newCheckId: newId, lines: [...picks.entries()] } });
    return { from: await this.getCheck(user, id), to: await this.getCheck(user, newId) };
  }

  /** A server says the table wants to pay; the cashier's floor shows it. */
  async requestPay(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const check = await this.loadCheck(tenantId, id);
    this.assertOpen(check);
    await this.prisma.tableCheck.updateMany({ where: { id, tenantId }, data: { payRequestedAt: new Date() } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'restaurant.pay_requested', resourceType: 'table_check', resourceId: id });
    return this.getCheck(user, id);
  }

  /**
   * Cancel the whole bill (a table opened by mistake, guests who left). A
   * bill with dishes the kitchen has needs a reason and approval, and each
   * station gets a CANCEL ticket.
   */
  async voidCheck(user: AuthenticatedUser, id: string, dto: { reason?: unknown; approvalPin?: unknown }) {
    const tenantId = this.tenantId(user);
    const check = await this.loadCheck(tenantId, id);
    this.assertOpen(check);
    const cooking = check.lines.filter((l) => l.state === 'SENT');
    const reason = cleanNote(dto.reason);
    const settings = await this.getSettings(tenantId);
    let approverId: string | null = null;
    if (cooking.length) {
      if (!reason || reason.length < 2) throw new BadRequestException('VOID_REASON_REQUIRED');
      approverId = await this.approval(user, tenantId, settings, dto.approvalPin);
    }
    const [ctx, names, by] = await Promise.all([this.context(tenantId), this.tableNames(tenantId), this.nameOf(user)]);
    const now = new Date();
    const label = checkLabel(check.tableIds, names, check.number, ctx.lang);
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.tableCheck.updateMany({ where: { id, tenantId, status: 'OPEN' }, data: { status: 'VOID', closedAt: now, voidReason: reason } });
      if (r.count === 0) throw new ConflictException('CHECK_CLOSED');
      await tx.tableCheckLine.deleteMany({ where: { tenantId, checkId: id, state: 'UNSENT' } });
      if (cooking.length) {
        await tx.tableCheckLine.updateMany({ where: { tenantId, checkId: id, state: 'SENT' }, data: { state: 'VOID', voidReason: reason, voidByUserId: user.userId, voidApprovedBy: approverId, voidedAt: now } });
        if (settings.printVoid) {
          for (const station of stationsCooking(check.lines as LineLike[])) {
            const text = ticketText({
              kind: 'VOID', lang: ctx.lang, stationName: stationName(station, settings), tables: label, takeaway: check.tableIds.length === 0, checkNumber: check.number,
              at: clockText(now, ctx.tz, ctx.lang), reason, by,
              lines: cooking.filter((l) => l.station === station).map((l) => ({ quantity: l.quantity, name: l.name, note: l.note, options: chosenOf(l.options).map((o) => o.name) })),
            });
            await tx.printJob.create({ data: { tenantId, station, title: `VOID · ${label} · #${check.number}`, text, createdById: user.userId } });
          }
        }
      }
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'restaurant.check_voided', resourceType: 'table_check', resourceId: id, metadata: { reason, approvedBy: approverId, sentLines: cooking.length } });
    return this.getCheck(user, id);
  }

  /** The owner may name who takes money; everyone else at the till asks for payment instead. */
  private canPay(user: AuthenticatedUser, settings: RestaurantSettings): boolean {
    if (user.role !== UserRole.STAFF) return true;
    return settings.cashierUserIds.length === 0 || settings.cashierUserIds.includes(user.userId);
  }

  /**
   * Pay the bill. The sale is rung up through the till's own checkout, so the
   * shift, tenders, change, the ledger, loyalty and the receipt number work as
   * for any sale. The bill is locked (PAYING) while that runs, so two cashiers
   * cannot take the same table's money twice; a failed payment unlocks it.
   */
  async pay(user: AuthenticatedUser, id: string, dto: {
    tenders?: { method: PaymentMethod; amountCents: number }[]; discountCents?: number; manualDiscountCents?: number;
    customerId?: string; allowUnsent?: boolean; note?: string;
  }) {
    const tenantId = this.tenantId(user);
    const check = await this.loadCheck(tenantId, id);
    this.assertOpen(check);
    const settings = await this.getSettings(tenantId);
    if (!this.canPay(user, settings)) throw new ForbiddenException('PAY_NOT_ALLOWED');
    const live = check.lines.filter((l) => l.state !== 'VOID' && l.quantity > 0);
    if (!live.length) throw new BadRequestException('EMPTY_CHECK');
    if (!dto.allowUnsent && live.some((l) => l.state === 'UNSENT')) throw new ConflictException('UNSENT_LINES');
    const tenders = Array.isArray(dto.tenders) ? dto.tenders.filter((t) => t && Number(t.amountCents) >= 0) : [];
    if (!tenders.length) throw new BadRequestException('TENDER_REQUIRED');
    if ((dto.manualDiscountCents ?? 0) > 0 && !hasCapability(user.role, user.staffRole, 'pos.discount', user.staffCaps)) {
      throw new ForbiddenException('DISCOUNT_NOT_ALLOWED');
    }
    const customerId = dto.customerId ?? check.customerId ?? undefined;
    if (customerId) {
      const c = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true } });
      if (!c) throw new NotFoundException('CUSTOMER_NOT_FOUND');
    }
    const locked = await this.prisma.tableCheck.updateMany({ where: { id, tenantId, status: 'OPEN' }, data: { status: 'PAYING' } });
    if (locked.count === 0) throw new ConflictException('CHECK_PAYING');
    const [names, ctx] = await Promise.all([this.tableNames(tenantId), this.context(tenantId)]);
    const label = checkLabel(check.tableIds, names, check.number, ctx.lang);
    let order: { id: string; status?: string; orderNumber?: number } | null = null;
    try {
      order = await this.pos.createOrder(user, {
        items: live.map((l) => {
          const extra = [...chosenOf(l.options).map((o) => o.name), ...(l.note ? [l.note] : [])].join(', ');
          return {
            kind: OrderItemKind.PRODUCT,
            name: (extra ? `${l.name} (${extra})` : l.name).slice(0, 160),
            unitPriceCents: l.unitPriceCents,
            quantity: l.quantity,
          };
        }),
        tenders: tenders.map((t) => ({ method: t.method, amountCents: Math.round(Number(t.amountCents)) })),
        discountCents: dto.discountCents,
        manualDiscountCents: dto.manualDiscountCents,
        customerId,
        note: [`${label} · #${check.number}`, check.note, dto.note].filter(Boolean).join(' · ').slice(0, 500),
      } as never) as unknown as { id: string; status?: string; orderNumber?: number };
      if (!order || order.status !== 'PAID') throw new BadRequestException('NOT_PAID');
    } catch (e) {
      await this.prisma.tableCheck.updateMany({ where: { id, tenantId, status: 'PAYING' }, data: { status: 'OPEN' } });
      throw e;
    }
    await this.prisma.tableCheck.updateMany({ where: { id, tenantId, status: 'PAYING' }, data: { status: 'PAID', orderId: order.id, closedAt: new Date() } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'restaurant.check_paid', resourceType: 'table_check', resourceId: id, metadata: { orderId: order.id, orderNumber: order.orderNumber } });
    return { order, check: await this.getCheck(user, id) };
  }

  /** Print jobs that did not come out, so the till can say so and reprint. */
  async failedPrints(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const since = new Date(Date.now() - 12 * 3600_000);
    return this.prisma.printJob.findMany({
      where: { tenantId, createdAt: { gte: since }, status: PrintJobStatus.FAILED },
      select: { id: true, title: true, station: true, error: true, createdAt: true },
      orderBy: { createdAt: 'desc' }, take: 20,
    });
  }

  /** Put a failed ticket back in the queue. */
  async reprint(user: AuthenticatedUser, jobId: string) {
    const tenantId = this.tenantId(user);
    const r = await this.prisma.printJob.updateMany({ where: { id: jobId, tenantId }, data: { status: PrintJobStatus.PENDING, error: null } });
    if (r.count === 0) throw new NotFoundException('PRINT_NOT_FOUND');
    return { ok: true };
  }
}
