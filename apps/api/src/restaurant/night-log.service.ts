import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, addAuditListener, type AuditLogInput } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { PushService } from '../push/push.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { cleanStaffCaps, hasCapability } from '../auth/capabilities';
import { cleanSettings, langFor, moneyText } from './check-logic';
import {
  ALERT_KEYS, AlertKey, AlertSettings, LOG_ACTIONS, LogKind, alertKeyOf, alertText, businessDayKey, cleanAlerts,
  isBigDiscount, logKindOf, nightlyText, recipientsFor, varianceMatters,
} from './night-alerts';

/** `hour`:00 local time on `ymd` in zone `tz`, as an instant. */
export function zonedInstant(ymd: string, hour: number, tz: string): Date {
  const guess = Date.parse(`${ymd}T${String(hour).padStart(2, '0')}:00:00Z`);
  const offsetAt = (t: number) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t));
    const g = (k: string) => Number(p.find((x) => x.type === k)?.value ?? 0);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - t;
  };
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first));
}

export const ALERTS_KEY = 'restaurant.alerts';
const RESTAURANT_KEY = 'restaurant';
const FOOD = new Set(['RESTAURANT', 'CAFE', 'BAKERY', 'BUBBLE_TEA', 'FAST_FOOD']);
const SENT_KEY = 'restaurant.alerts.sent';

type Ctx = { tenantId: string; vi: boolean; currency: string; tz: string; dayStartHour: number; alerts: AlertSettings; on: boolean };
type Person = { id: string; kind: 'owner' | 'manager'; name: string };
type Meta = Record<string, unknown>;

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The restaurant's night log and its alerts to the owner's and the managers'
 * phones (19/11/2026). See night-alerts.ts for the rules; this is the wiring.
 *
 *  - Alerts: listens to audit_logs as they are written (addAuditListener), so
 *    every till action that is already logged can alert without touching its
 *    code. Only food businesses (or a salon that saved alert settings), only
 *    the people the owner ticked, never the person who did it.
 *  - Log: a reading of audit_logs for one night, tenant-scoped; staff without
 *    reports see only their own actions.
 *  - A ten-minute sweep sends the night summary once per business day and
 *    warns about a shift left open too long.
 */
@Injectable()
export class NightLogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('NightLog');
  private off: (() => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly ctxCache = new Map<string, { at: number; ctx: Ctx }>();
  private readonly voidAlertAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    @Optional() private readonly push?: PushService,
  ) {}

  onModuleInit() {
    if (process.env.JEST_WORKER_ID) return;
    this.off = addAuditListener((input, at) => this.onAudit(input, at));
    const enabled = process.env.HOUSEKEEPING_ENABLED ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false');
    if (enabled !== 'true') return;
    this.timer = setInterval(() => void this.sweep().catch((e) => this.logger.warn(`sweep: ${(e as Error).message}`)), 10 * 60_000);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    this.off?.();
    if (this.timer) clearInterval(this.timer);
  }

  private tenantOf(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('NO_TENANT');
    return id;
  }

  // ---------------------------------------------------------------- context
  async context(tenantId: string, fresh = false): Promise<Ctx> {
    const hit = this.ctxCache.get(tenantId);
    if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.ctx;
    const [rules, tenant, rows, industry] = await Promise.all([
      this.settings.getBookingRules(tenantId).catch(() => ({ currency: 'USD' } as { currency?: string })),
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }).catch(() => null),
      this.prisma.setting.findMany({ where: { tenantId, key: { in: [ALERTS_KEY, RESTAURANT_KEY] } } }).catch(() => []),
      this.settings.getIndustry(tenantId).catch(() => ''),
    ]);
    const currency = (rules as { currency?: string }).currency || 'USD';
    const saved = (rows as { key: string; value: unknown }[]).find((r) => r.key === ALERTS_KEY);
    const rest = (rows as { key: string; value: unknown }[]).find((r) => r.key === RESTAURANT_KEY);
    const ctx: Ctx = {
      tenantId,
      vi: langFor(currency) === 'vi',
      currency,
      tz: tenant?.timezone || 'UTC',
      dayStartHour: cleanSettings(rest?.value ?? {}).dayStartHour,
      alerts: cleanAlerts(saved?.value ?? {}),
      on: FOOD.has(String(industry)) || !!saved,
    };
    this.ctxCache.set(tenantId, { at: Date.now(), ctx });
    return ctx;
  }

  /** Owners and managers (staff who may void) of this salon — the people alerts can go to. */
  async people(tenantId: string): Promise<Person[]> {
    const users = await this.prisma.user.findMany({
      where: { tenantId, isActive: true, role: { in: [UserRole.SALON_ADMIN, UserRole.STAFF] } },
      select: { id: true, role: true, firstName: true, lastName: true, email: true },
      take: 300,
    }) as { id: string; role: UserRole; firstName: string | null; lastName: string | null; email: string }[];
    const staff = users.filter((u) => u.role === UserRole.STAFF);
    const cards = staff.length
      ? await this.prisma.staffMember.findMany({ where: { tenantId, userId: { in: staff.map((u) => u.id) } }, select: { userId: true, staffRole: true, permissions: true } as never }) as unknown as { userId: string; staffRole: string | null; permissions: unknown }[]
      : [];
    const nameOf = (u: { firstName: string | null; lastName: string | null; email: string }) => [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email.split('@')[0];
    return users.flatMap((u): Person[] => {
      if (u.role === UserRole.SALON_ADMIN) return [{ id: u.id, kind: 'owner', name: nameOf(u) }];
      const sm = cards.find((c) => c.userId === u.id);
      const may = sm?.staffRole === 'MANAGER' || hasCapability(UserRole.STAFF, (sm?.staffRole ?? null) as never, 'pos.void', cleanStaffCaps(sm?.permissions) ?? undefined);
      return may ? [{ id: u.id, kind: 'manager', name: nameOf(u) }] : [];
    });
  }

  private async names(tenantId: string, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const uniq = [...new Set(ids.filter((x): x is string => !!x))];
    if (!uniq.length) return new Map();
    const rows = await this.prisma.user.findMany({ where: { tenantId, id: { in: uniq } }, select: { id: true, firstName: true, email: true } }).catch(() => []) as { id: string; firstName: string | null; email: string }[];
    return new Map(rows.map((u) => [u.id, (u.firstName ?? '').trim() || u.email.split('@')[0]]));
  }

  private async checks(tenantId: string, ids: string[]) {
    const uniq = [...new Set(ids)];
    const rows = uniq.length
      ? await this.prisma.tableCheck.findMany({ where: { tenantId, id: { in: uniq } }, select: { id: true, number: true, tableIds: true } }).catch(() => []) as { id: string; number: number; tableIds: string[] }[]
      : [];
    const tableIds = [...new Set(rows.flatMap((r) => r.tableIds))];
    const tables = tableIds.length
      ? await this.prisma.restaurantTable.findMany({ where: { tenantId, id: { in: tableIds } }, select: { id: true, name: true } }).catch(() => []) as { id: string; name: string }[]
      : [];
    const tname = new Map(tables.map((t) => [t.id, t.name]));
    return new Map(rows.map((r) => [r.id, { number: r.number, table: r.tableIds.map((t) => tname.get(t)).filter(Boolean).join(' + ') || null }]));
  }

  private async orders(tenantId: string, ids: string[]) {
    const uniq = [...new Set(ids)];
    const rows = uniq.length
      ? await this.prisma.order.findMany({
        where: { tenantId, id: { in: uniq } },
        select: { id: true, orderNumber: true, totalCents: true, subtotalCents: true, discountCents: true, note: true, tenders: { select: { method: true, amountCents: true } } },
      }).catch(() => []) as unknown as { id: string; orderNumber: number; totalCents: number; subtotalCents: number; discountCents: number; note: string | null; tenders: { method: string; amountCents: number }[] }[]
      : [];
    return new Map(rows.map((o) => [o.id, o]));
  }

  private methodLabel(vi: boolean, tenders: { method: string; amountCents: number }[] | undefined): string | null {
    if (!tenders?.length) return null;
    const top = [...tenders].sort((a, b) => b.amountCents - a.amountCents)[0].method;
    if (top === 'CASH') return vi ? 'Tiền mặt' : 'Cash';
    if (top === 'CARD') return vi ? 'Thẻ' : 'Card';
    return vi ? 'Chuyển khoản' : 'Transfer';
  }

  // ---------------------------------------------------------------- alerts
  async onAudit(input: AuditLogInput, at: Date): Promise<void> {
    const tenantId = input.tenantId;
    if (!tenantId || !this.push) return;
    const key = alertKeyOf(input.action);
    if (!key) return;
    const ctx = await this.context(tenantId);
    if (!ctx.on) return;
    const meta = (input.metadata && typeof input.metadata === 'object' ? input.metadata : {}) as Meta;
    const money = (c: number) => moneyText(c, ctx.currency);
    const people = await this.people(tenantId);
    const send = async (k: AlertKey, t: { title: string; body: string }, url: string) => {
      const to = recipientsFor(ctx.alerts.notify[k], people, input.userId);
      if (!to.length || !t.title) return;
      await this.push!.sendToTenant(tenantId, { title: t.title, body: t.body, url, tag: `rt-${k}-${input.resourceId ?? at.getTime()}` }, { onlyUserIds: to });
    };
    const nm = await this.names(tenantId, [input.userId, str(meta.approvedBy), str(meta.approvedByUserId), str(meta.witnessUserId)]);
    const who = input.userId ? nm.get(input.userId) ?? null : null;
    const approver = nm.get(str(meta.approvedBy) ?? str(meta.approvedByUserId) ?? '') ?? null;
    const base = { vi: ctx.vi, money, who, approver };
    const log = '/salon/pos/log';

    if (key === 'shiftOpen') return send(key, alertText(key, input.action, { ...base, openingCents: num(meta.openingCents) }), log);
    if (key === 'shiftClose') {
      return send(key, alertText(key, input.action, {
        ...base, expectedCents: num(meta.expectedCashCents), countedCents: num(meta.countedCents), varianceCents: num(meta.varianceCents),
        witness: nm.get(str(meta.witnessUserId) ?? '') ?? null,
      }), log);
    }
    if (key === 'tableOpen') {
      const c = input.resourceId ? (await this.checks(tenantId, [input.resourceId])).get(input.resourceId) : undefined;
      return send(key, alertText(key, input.action, { ...base, table: c?.table ?? (meta.takeaway ? (ctx.vi ? 'Mang về' : 'Takeaway') : null), checkNumber: c?.number, guests: num(meta.guests) }), log);
    }
    if (key === 'checkVoid') {
      if (input.action === 'order.voided' || input.action === 'order.refunded') {
        const o = input.resourceId ? (await this.orders(tenantId, [input.resourceId])).get(input.resourceId) : undefined;
        return send(key, alertText(key, input.action, { ...base, orderNumber: o?.orderNumber, table: o?.note ? o.note.split('·')[0].trim() : null, amountCents: num(meta.amountCents) ?? num(meta.totalCents) ?? o?.totalCents, reason: str(meta.reason) }), log);
      }
      // rt234: an edit after the guest check alerts only when it lowered the bill.
      if (input.action === 'restaurant.after_prebill_change' && meta.lowered !== true) return;
      if (input.action === 'restaurant.after_prebill_change' || input.action === 'restaurant.paid_below_prebill') {
        const c2 = input.resourceId ? (await this.checks(tenantId, [input.resourceId])).get(input.resourceId) : undefined;
        return send(key, alertText(key, input.action, { ...base, table: c2?.table, checkNumber: c2?.number, orderNumber: num(meta.orderNumber), amountCents: num(meta.minusCents) ?? num(meta.amountCents), reason: str(meta.reason) }), log);
      }
      const c = input.resourceId ? (await this.checks(tenantId, [input.resourceId])).get(input.resourceId) : undefined;
      let amount: number | null = null;
      if (input.action === 'restaurant.check_voided' && input.resourceId) {
        const lines = await this.prisma.tableCheckLine.findMany({ where: { tenantId, checkId: input.resourceId }, select: { unitPriceCents: true, quantity: true } }).catch(() => []) as { unitPriceCents: number; quantity: number }[];
        amount = lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0) || null;
      }
      const o = input.action === 'restaurant.check_reopened' && str(meta.orderId) ? (await this.orders(tenantId, [str(meta.orderId)!])).get(str(meta.orderId)!) : undefined;
      return send(key, alertText(key, input.action, { ...base, table: c?.table, checkNumber: c?.number, orderNumber: o?.orderNumber, amountCents: amount, reason: str(meta.reason) }), log);
    }
    if (key === 'itemVoids') {
      const since = new Date(at.getTime() - ctx.alerts.voidWindowMin * 60_000);
      const last = this.voidAlertAt.get(tenantId) ?? 0;
      if (at.getTime() - last < ctx.alerts.voidWindowMin * 60_000) return;
      const lines = await this.prisma.tableCheckLine.findMany({
        where: { tenantId, state: 'VOID', voidedAt: { gte: since, lte: new Date(at.getTime() + 1000) }, sentAt: { not: null }, NOT: { voidReason: 'MERGED' } },
        select: { quantity: true, unitPriceCents: true },
        take: 2000,
      }).catch(() => []) as { quantity: number; unitPriceCents: number }[];
      const items = lines.reduce((s, l) => s + l.quantity, 0);
      if (items < ctx.alerts.voidItems) return;
      this.voidAlertAt.set(tenantId, at.getTime());
      const c = input.resourceId ? (await this.checks(tenantId, [input.resourceId])).get(input.resourceId) : undefined;
      return send(key, alertText(key, input.action, { ...base, items, windowMin: ctx.alerts.voidWindowMin, amountCents: lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0), table: c?.table, checkNumber: c?.number }), log);
    }
    if (key === 'paid') {
      const orderId = str(meta.orderId);
      const o = orderId ? (await this.orders(tenantId, [orderId])).get(orderId) : undefined;
      const c = input.resourceId ? (await this.checks(tenantId, [input.resourceId])).get(input.resourceId) : undefined;
      const facts = { ...base, table: c?.table, checkNumber: c?.number, orderNumber: o?.orderNumber ?? num(meta.orderNumber), amountCents: o?.totalCents ?? null, method: this.methodLabel(ctx.vi, o?.tenders) };
      if (o && isBigDiscount(o.discountCents, o.subtotalCents, ctx.alerts.discountPct)) {
        const pct = Math.round((o.discountCents * 100) / Math.max(1, o.subtotalCents));
        await send('bigDiscount', alertText('bigDiscount', input.action, { ...facts, discountCents: o.discountCents, pct }), log);
      }
      return send('paid', alertText('paid', input.action, facts), log);
    }
  }

  // ---------------------------------------------------------------- the log
  async log(user: AuthenticatedUser, fromStr?: string, toStr?: string) {
    const tenantId = this.tenantOf(user);
    const from = new Date(String(fromStr ?? ''));
    const to = new Date(String(toStr ?? ''));
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw new BadRequestException('BAD_RANGE');
    if (to.getTime() - from.getTime() > 3 * 86_400_000) throw new BadRequestException('RANGE_TOO_LONG');
    const all = hasCapability(user.role, user.staffRole ?? null, 'reports', user.staffCaps);
    const rows = await this.prisma.auditLog.findMany({
      where: { tenantId, action: { in: Object.keys(LOG_ACTIONS) }, createdAt: { gte: from, lt: to }, ...(all ? {} : { userId: user.userId }) },
      orderBy: { createdAt: 'desc' },
      take: 1501,
      select: { id: true, action: true, userId: true, resourceType: true, resourceId: true, metadata: true, createdAt: true },
    }) as { id: string; action: string; userId: string | null; resourceType: string | null; resourceId: string | null; metadata: unknown; createdAt: Date }[];
    const truncated = rows.length > 1500;
    const list = rows.slice(0, 1500);
    const metaOf = (r: { metadata: unknown }) => (r.metadata && typeof r.metadata === 'object' ? r.metadata : {}) as Meta;
    const ctx = await this.context(tenantId);
    const [nm, checks, orders] = await Promise.all([
      this.names(tenantId, list.flatMap((r) => [r.userId, str(metaOf(r).approvedBy), str(metaOf(r).approvedByUserId), str(metaOf(r).witnessUserId)])),
      this.checks(tenantId, list.filter((r) => r.resourceType === 'table_check' && r.resourceId).map((r) => r.resourceId!)),
      this.orders(tenantId, list.flatMap((r) => [r.resourceType === 'order' ? r.resourceId : null, str(metaOf(r).orderId)]).filter((x): x is string => !!x)),
    ]);
    const events = list.map((r) => {
      const m = metaOf(r);
      const kind = logKindOf(r.action) as LogKind;
      const c = r.resourceType === 'table_check' && r.resourceId ? checks.get(r.resourceId) : undefined;
      const o = orders.get(str(m.orderId) ?? (r.resourceType === 'order' ? r.resourceId ?? '' : '')) ?? undefined;
      const approverId = str(m.approvedBy) ?? str(m.approvedByUserId);
      let amountCents: number | null = null;
      if (r.action === 'restaurant.check_paid') amountCents = o?.totalCents ?? null;
      else if (r.action === 'restaurant.item_voided' || r.action === 'order.refunded' || r.action === 'pos.cash_in' || r.action === 'pos.cash_out') amountCents = num(m.amountCents);
      else if (r.action === 'order.voided') amountCents = num(m.totalCents);
      else if (r.action === 'restaurant.paid_below_prebill') amountCents = num(m.amountCents);
      else if (r.action === 'pos.held_discarded') amountCents = num(m.amountCents);
      else if (r.action === 'restaurant.after_prebill_change') amountCents = num(m.minusCents);
      else if (r.action === 'restaurant.check_voided') amountCents = num(m.printedCents);
      else if (r.action === 'pos.shift_opened') amountCents = num(m.openingCents);
      else if (r.action === 'pos.shift_closed') amountCents = num(m.varianceCents);
      else if (r.action === 'restaurant.bank_credit') amountCents = num(m.amount);
      return {
        id: r.id,
        at: r.createdAt.toISOString(),
        action: r.action,
        kind,
        by: r.userId ? nm.get(r.userId) ?? null : null,
        approvedBy: approverId && approverId !== r.userId ? nm.get(approverId) ?? null : null,
        witness: nm.get(str(m.witnessUserId) ?? '') ?? null,
        table: c?.table ?? null,
        checkNumber: c?.number ?? null,
        orderNumber: o?.orderNumber ?? num(m.orderNumber) ?? num(m.fromNumber),
        amountCents,
        discountCents: r.action === 'restaurant.check_paid' && o?.discountCents ? o.discountCents : null,
        discountPct: r.action === 'restaurant.check_paid' && o?.discountCents && o.subtotalCents ? Math.round((o.discountCents * 100) / o.subtotalCents) : null,
        method: r.action === 'restaurant.check_paid' ? this.methodLabel(ctx.vi, o?.tenders) : null,
        reason: str(m.reason),
        name: str(m.name) ?? str(m.label),
        quantity: num(m.quantity),
        guests: num(m.guests),
        expectedCents: num(m.expectedCashCents),
        countedCents: num(m.countedCents),
        takeaway: m.takeaway === true,
        // rt234
        afterPrebill: m.afterPrebill === true || r.action === 'restaurant.paid_below_prebill' || (r.action === 'restaurant.after_prebill_change' && m.lowered === true),
        printedCents: num(m.printedCents),
        what: str(m.what),
      };
    });
    const counts = { all: events.length, void: 0, money: 0, shift: 0, table: 0, cash: 0, discount: 0 } as Record<string, number>;
    for (const e of events) { counts[e.kind] = (counts[e.kind] ?? 0) + 1; if (e.discountPct && e.discountPct >= ctx.alerts.discountPct) counts.discount += 1; }
    return { from: from.toISOString(), to: to.toISOString(), mine: !all, truncated, discountPct: ctx.alerts.discountPct, counts, events };
  }

  // ---------------------------------------------------------------- settings
  async readAlerts(user: AuthenticatedUser) {
    const tenantId = this.tenantOf(user);
    const ctx = await this.context(tenantId, true);
    const people = await this.people(tenantId);
    const devices = await Promise.all(people.map((p) => this.push?.countForUser(tenantId, p.id).catch(() => ({ web: 0, native: 0 })) ?? { web: 0, native: 0 }));
    return {
      settings: ctx.alerts,
      keys: ALERT_KEYS,
      pushReady: !!this.push,
      people: people.map((p, i) => ({ id: p.id, name: p.name, kind: p.kind, devices: devices[i].web + devices[i].native })),
    };
  }

  /** Owner only (controller). */
  async saveAlerts(user: AuthenticatedUser, raw: unknown) {
    const tenantId = this.tenantOf(user);
    const clean = cleanAlerts(raw);
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: ALERTS_KEY } },
      update: { value: clean as never },
      create: { tenantId, key: ALERTS_KEY, value: clean as never },
    });
    this.ctxCache.delete(tenantId);
    await this.audit.log({ tenantId, userId: user.userId, action: 'restaurant.alerts_updated', resourceType: 'tenant', resourceId: tenantId });
    return clean;
  }

  /** A test alert to the person asking, on their own devices. */
  async testAlert(user: AuthenticatedUser) {
    const tenantId = this.tenantOf(user);
    const ctx = await this.context(tenantId);
    const n = (await this.push?.sendToUser(tenantId, user.userId, {
      title: ctx.vi ? 'Lumio · thông báo thử' : 'Lumio · test alert',
      body: ctx.vi ? 'Điện thoại này sẽ nhận thông báo vào ca, huỷ bill, đóng ca.' : 'This phone will get shift, void and close alerts.',
      url: '/salon/pos/log',
      tag: 'rt-test',
    })) ?? 0;
    return { devices: n };
  }

  // ---------------------------------------------------------------- sweep
  /** Night summary once per business day, and a shift left open too long. */
  async sweep(now = new Date()) {
    const since = new Date(now.getTime() - 30 * 3_600_000);
    const recent = await this.prisma.tableCheck.findMany({ where: { openedAt: { gte: since } }, select: { tenantId: true }, distinct: ['tenantId'], take: 2000 }).catch(() => []) as { tenantId: string }[];
    const shifts = await this.prisma.cashShift.findMany({ where: { status: 'OPEN' }, select: { tenantId: true }, take: 2000 }).catch(() => []) as { tenantId: string }[];
    const tenants = [...new Set([...recent, ...shifts].map((r) => r.tenantId))];
    for (const t of tenants) {
      try { await this.sweepOne(t, now); } catch (e) { this.logger.warn(`sweep ${t}: ${(e as Error).message}`); }
    }
  }

  async sweepOne(tenantId: string, now: Date) {
    const ctx = await this.context(tenantId);
    if (!ctx.on || !this.push) return;
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: SENT_KEY } } }).catch(() => null);
    const sent = (row?.value && typeof row.value === 'object' ? row.value : {}) as { nightly?: string; longShift?: string };
    const people = await this.people(tenantId);
    const money = (c: number) => moneyText(c, ctx.currency);
    const today = businessDayKey(now, ctx.tz, ctx.dayStartHour);
    let changed = false;

    const open = await this.prisma.cashShift.findFirst({ where: { tenantId, status: 'OPEN' }, select: { id: true, openedAt: true, openedByName: true } }).catch(() => null) as { id: string; openedAt: Date; openedByName: string | null } | null;
    if (open && now.getTime() - open.openedAt.getTime() > ctx.alerts.shiftMaxHours * 3_600_000 && sent.longShift !== open.id) {
      const to = recipientsFor(ctx.alerts.notify.shiftClose, people, null);
      const hours = Math.floor((now.getTime() - open.openedAt.getTime()) / 3_600_000);
      if (to.length) {
        await this.push.sendToTenant(tenantId, {
          title: ctx.vi ? `Ca chưa đóng · đã mở ${hours} giờ` : `Shift still open · ${hours} hours`,
          body: ctx.vi ? `${open.openedByName ?? 'Ca'} mở từ lâu mà chưa đếm két. Đóng ca để biết thiếu hay đủ.` : `${open.openedByName ?? 'A shift'} has not been counted. Close it to see if the drawer balances.`,
          url: '/salon/pos/shifts', tag: `rt-longshift-${open.id}`,
        }, { onlyUserIds: to });
      }
      sent.longShift = open.id; changed = true;
    }

    // The summary of the night that just ended, once, after the day starts.
    if (sent.nightly !== today) {
      const end = this.dayStart(today, ctx);
      const start = new Date(end.getTime() - 24 * 3_600_000);
      // Sent only in the first hours of the new day, never for a night long gone.
      if (now >= end && now.getTime() - end.getTime() < 6 * 3_600_000) {
        const to = recipientsFor(ctx.alerts.notify.nightly, people, null);
        const [orders, voidLines] = await Promise.all([
          this.prisma.order.findMany({ where: { tenantId, paidAt: { gte: start, lt: end } }, select: { status: true, totalCents: true }, take: 5000 }).catch(() => []) as Promise<{ status: string; totalCents: number }[]>,
          this.prisma.tableCheckLine.findMany({ where: { tenantId, state: 'VOID', voidedAt: { gte: start, lt: end }, NOT: { voidReason: 'MERGED' } }, select: { quantity: true, unitPriceCents: true }, take: 5000 }).catch(() => []) as Promise<{ quantity: number; unitPriceCents: number }[]>,
        ]);
        const paid = orders.filter((o) => o.status === 'PAID');
        const voided = orders.filter((o) => o.status === 'VOID');
        if (to.length && (orders.length || voidLines.length)) {
          const d = new Date(`${businessDayKey(start, 'UTC', 0)}T12:00:00Z`);
          const label = ctx.vi ? `Đêm ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}` : `Night of ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
          const t = nightlyText({
            vi: ctx.vi, money, label,
            netCents: paid.reduce((s, o) => s + o.totalCents, 0), bills: paid.length,
            voidedBills: voided.length, voidedCents: voided.reduce((s, o) => s + o.totalCents, 0),
            voidItems: voidLines.reduce((s, l) => s + l.quantity, 0), voidItemCents: voidLines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0),
            openShift: !!open,
          });
          await this.push.sendToTenant(tenantId, { ...t, url: '/salon/pos/report', tag: `rt-nightly-${today}` }, { onlyUserIds: to });
        }
        sent.nightly = today; changed = true;
      }
    }
    if (changed) {
      await this.prisma.setting.upsert({
        where: { tenantId_key: { tenantId, key: SENT_KEY } },
        update: { value: sent as never },
        create: { tenantId, key: SENT_KEY, value: sent as never },
      }).catch(() => undefined);
    }
  }

  /** The instant the business day `key` starts, in the salon's zone. */
  private dayStart(key: string, ctx: Ctx): Date {
    return zonedInstant(key, ctx.dayStartHour, ctx.tz);
  }

  /** Is a variance big enough to need a written reason? (cash-shifts uses it too.) */
  async varianceNeedsNote(tenantId: string, varianceCents: number): Promise<boolean> {
    const ctx = await this.context(tenantId);
    return ctx.on && varianceMatters(varianceCents, ctx.alerts.varianceCents);
  }
}
