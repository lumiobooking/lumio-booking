import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { CALLED_KEY, NOTIFIED_KEY, calledTooLong, pruneCalled, turnSoonSms, upcomingToNotify, yourTurnSms } from './desk-policy';
import { queueEstimates } from './wait-estimate';
import { dayReview, type ClosedUnpaid, type Override, type ReviewTicket } from './day-review';
import { NotificationsService } from '../notifications/notifications.service';
import { DESK_POLICY_KEY, NO_SERVICE_ERROR, OVERRIDE_REASON_ERROR, PAY_WARNED_KEY, cleanDeskPolicy, cleanOverrideReason, hasService, newlyUnpaidTooLong, payNudgeAlert, suggestFor, type DeskPolicy, type NamedTicket as PayTicket } from './desk-policy';
import { cleanCloseReason, frequentServices, nextBookingByStaff, todayTotals, turnOrder } from './desk-board';
import { AppointmentStatus, OrderStatus, Prisma, UserRole, WalkInStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { SettingsService } from '../settings/settings.service';
import { PushService } from '../push/push.service';
import { LATE_WARNED_KEY, NamedTicket, deskUserIds, lateAlert, newlyLate, parkedAlert, rememberWarned } from './overdue-alert';
import { normalizeSource } from '../common/source.util';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import {
  attachLines, busyTechs, canRunTogether, isStale, staleAfterHours, itemsOf as legItemsOf, LegItem, legsOf, minutesLeft, newLegId, overdueMinutes, partyTags, patchLeg, phaseOf, pickTech,
  planDispatch, syncTicket, TechInfo, TicketLike, turnsFromTickets, upgradeItems, Zone, zoneOf, lastDoneFromTickets, moneyFromTickets, legPrice,
} from './walkin-legs';
import { turnReport, weekOf } from './turn-report';
import { settledWalkIns, unpaidFromPastDays, UNPAID_LIST_DAYS } from './unpaid-sweep';
import { linkWalkInToBooking } from './booking-link';
import { allocate } from '../payroll/sales-ledger';
import { appointmentTurns, cleanTurnRules, DEFAULT_TURN_RULES, latePenalty, legTurns, minutesLate, tieCompare, toBottomDelta, TURN_RULES_KEY, TurnRules, newTechBoost } from './turn-rules';
import { AuditService } from '../audit/audit.service';
import { hasCapability } from '../auth/capabilities';
import { tzPartsOf } from '../common/salon-time';
import { inPromoWindow, salonYmd, type PromoWindow } from '../settings/promo-window';
import { DATE_DISCOUNTS_KEY, FIRST_VISIT_DISCOUNT_KEY, WEEKDAY_DISCOUNTS_KEY } from '../settings/settings.constants';
import { appliesOn, channelOfSource, dateRulesFor, programFor, type SaleChannel } from '../settings/promo-channel';
import { promoPct, type PromoSettings, type SalonDay } from '../display/checkin-pricing';

/**
 * One queue change at a time per salon. Two techs pressing "Xong" in the same
 * second each read the floor, each saw the same customer at the front, and
 * each sat them down: one customer, two technicians. Every read-modify-write
 * of a salon's tickets goes through here (one API instance, so in-process is
 * enough), so the second press sees what the first one did.
 */
const locks = new Map<string, Promise<unknown>>();
export function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  locks.set(key, tail);
  void tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
  return run;
}

/** The virtual leg of a ticket written before legs existed (see walkin-legs.ts). */
const TICKET_LEG = '_ticket';

export interface AddWalkInDto {
  /** A customer the desk picked from this salon's records — linked without retyping her phone. */
  customerId?: string;
  customerName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  /** YYYY-MM-DD. Optional; feeds the birthday campaign. */
  birthDate?: string;
  serviceId?: string;
  /** Additional services picked in the same go (the walk-in norm). */
  serviceIds?: string[];
  /** Add-ons of the services picked ("Vẽ móng"): their own line, on the service's leg. */
  addonIds?: string[];
  /** Minutes to allow on top of the services. */
  extraMinutes?: number;
  note?: string;
  partySize?: number;
  assignedStaffId?: string;
  autoAssign?: boolean;
  station?: string;
  /** People who came in with the customer: a ticket each, one party. */
  guests?: { firstName?: string; serviceIds?: string[]; addonIds?: string[]; assignedStaffId?: string }[];
}

const INCLUDE = {
  service: { select: { id: true, name: true } },
  assignedStaff: { select: { id: true, firstName: true, lastName: true } },
  stationRef: { select: { id: true, name: true, kind: true } },
};


/** A ticket line. The leg fields (legId, zone, legStatus…) are described in walkin-legs.ts. */
export type WalkInItem = LegItem;

/**
 * Walk-in queue + fair turn rotation ("lượt"). The front desk (or the
 * customer's own phone) adds walk-ins; their services are split into legs and
 * handed to technicians by the dispatcher — see walkin-legs.ts for the rules.
 * Turns are counted per tech per day (finished legs at their turn value +
 * completed appointments) so the next job goes to whoever is "up".
 */
@Injectable()
export class WalkinsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly settings: SettingsService,
    @Optional() private readonly push?: PushService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /** The salon's turn rules (turn-rules.ts); the defaults are the floor's old behaviour. */
  async turnRules(tenantId: string): Promise<TurnRules> {
    try {
      const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: TURN_RULES_KEY } } });
      return cleanTurnRules(row?.value ?? null);
    } catch { return DEFAULT_TURN_RULES; }
  }

  /** Today's date as it reads on the salon's wall clock. */
  private async todayKey(tenantId: string): Promise<string> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: t?.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
    catch { return new Date().toISOString().slice(0, 10); }
  }

  /**
   * Tell a technician she has a customer: a push to her phone (when push is
   * set up) on top of the live refresh of her chair screen. Best effort and
   * never awaited by the change that caused it.
   */
  private notifyStart(tenantId: string, staffId: string, customerName: string | null, legNames: string[]) {
    if (!this.push) return;
    void (async () => {
      const staff = await this.prisma.staffMember.findFirst({ where: { id: staffId, tenantId }, select: { userId: true } });
      if (!staff?.userId) return;
      const who = customerName?.trim() || 'Walk-in';
      await this.push!.sendToUser(tenantId, staff.userId, {
        title: `💺 Khách mới · New client: ${who}`,
        body: legNames.join(' · ') || who,
        url: '/staff/today',
        tag: 'lumio-chair',
      });
    })().catch(() => undefined);
  }

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  /**
   * Prisma seen without the generated types, for columns newer than the
   * locally built client (Service.turnValue). Production builds generate it.
   */
  private get db(): any { // eslint-disable-line @typescript-eslint/no-explicit-any
    return this.prisma as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  /** Menu rows with what the legs need: zone (name + category) and turn value. */
  private async menuRows(tenantId: string, ids: string[]) {
    type Row = { id: string; name: string; priceCents: number; discountPercent: number | null; durationMinutes: number; turnValue?: number | null; category?: { id?: string; name: string } | null };
    const uniq = [...new Set(ids.filter(Boolean))];
    if (!uniq.length) return new Map<string, Row>();
    const select = { id: true, name: true, priceCents: true, discountPercent: true, durationMinutes: true, category: { select: { id: true, name: true } } };
    let rows: Row[];
    try {
      rows = await this.db.service.findMany({ where: { tenantId, id: { in: uniq } }, select: { ...select, turnValue: true } });
    } catch {
      // The column arrives with its migration; until then everything is worth 1.
      rows = await this.db.service.findMany({ where: { tenantId, id: { in: uniq } }, select });
    }
    return new Map((rows ?? []).map((r) => [r.id, r]));
  }

  /**
   * Snapshot a service into a ticket line: its own discount first, then the
   * promotion this ticket gets today (ticketPromo) on what is left — the same
   * two steps, in the same order, as the booking page and the kiosk.
   */
  private async buildItem(tenantId: string, serviceId: string, staffId: string | null, promo?: (categoryId: string | null) => number): Promise<LegItem & { zone: Zone }> {
    const svc = (await this.menuRows(tenantId, [serviceId])).get(serviceId);
    if (!svc) throw new BadRequestException('Service not found');
    const d = Math.min(90, Math.max(0, svc.discountPercent ?? 0));
    const net = d > 0 ? Math.round((svc.priceCents * (100 - d)) / 100) : svc.priceCents;
    const p = promo ? Math.min(90, Math.max(0, Math.round(promo(svc.category?.id ?? null) || 0))) : 0;
    const price = p > 0 ? Math.round((net * (100 - p)) / 100) : net;
    return {
      lineId: randomUUID(), serviceId: svc.id, name: svc.name, priceCents: price, durationMinutes: svc.durationMinutes, staffId,
      zone: zoneOf(svc.name, svc.category?.name),
      turnValue: typeof svc.turnValue === 'number' ? svc.turnValue : 1,
    };
  }

  /**
   * The add-on lines of a ticket (walkin-legs.ts `kind: 'addon'`). Each rides
   * on the line of the service it is offered for — its own service, any
   * service of its category, or any service at all — so the board reads
   * "Take Off Only + Vẽ móng", the till bills $20 + $15 on two lines, and
   * the dispatcher never hands "Vẽ móng" to a second technician. Only THIS
   * salon's active add-ons count; an id from elsewhere, or one whose service
   * is not on the ticket, is dropped. List price: add-ons carry no promotion.
   */
  async addonLines(tenantId: string, addonIds: string[] | undefined, parents: LegItem[]): Promise<(LegItem & { zone: Zone })[]> {
    const ids = [...new Set((addonIds ?? []).filter((x) => typeof x === 'string' && x.length > 0))].slice(0, 20);
    const svcLines = parents.filter((p) => p.kind !== 'addon');
    if (!ids.length || !svcLines.length) return [];
    type AddonRow = { id: string; name: string; priceCents: number; durationMinutes: number; serviceId: string | null; categoryId: string | null };
    const rows = (await this.prisma.serviceAddon.findMany({
      where: { id: { in: ids }, tenantId, isActive: true } as never,
      select: { id: true, name: true, priceCents: true, durationMinutes: true, serviceId: true, categoryId: true } as never,
    }).catch(() => [])) as unknown as AddonRow[];
    if (!rows.length) return [];
    const cats = await this.prisma.service.findMany({
      where: { tenantId, id: { in: [...new Set(svcLines.map((p) => p.serviceId))] } }, select: { id: true, categoryId: true },
    }).catch(() => [] as { id: string; categoryId: string | null }[]);
    const catOf = new Map(cats.map((c) => [c.id, c.categoryId] as const));
    const out: (LegItem & { zone: Zone })[] = [];
    for (const id of ids) {
      const a = rows.find((r) => r.id === id);
      if (!a) continue;
      const parent = svcLines.find((p) => (a.serviceId ? p.serviceId === a.serviceId : a.categoryId ? catOf.get(p.serviceId) === a.categoryId : true));
      if (!parent) continue;
      out.push({
        lineId: randomUUID(), serviceId: a.id, kind: 'addon', forLineId: parent.lineId, name: a.name,
        priceCents: Math.max(0, Math.round(a.priceCents || 0)), durationMinutes: Math.max(0, Math.round(a.durationMinutes || 0)),
        staffId: parent.staffId ?? null, zone: (parent.zone ?? zoneOf(parent.name)) as Zone, turnValue: 0,
      });
    }
    return out;
  }

  /**
   * Fill in what a line written by older code (or the self check-in screen)
   * does not carry: its zone and its turn value, from the menu.
   */
  private async enrich(tenantId: string, items: LegItem[]): Promise<LegItem[]> {
    const missing = items.filter((it) => (!it.legId && !it.zone) || typeof it.turnValue !== 'number');
    if (!missing.length) return items;
    const menu = await this.menuRows(tenantId, missing.map((it) => it.serviceId)).catch(() => new Map());
    return items.map((it) => {
      const m = menu.get(it.serviceId);
      const out: LegItem = { ...it };
      if (!it.legId && !it.zone) out.zone = m ? zoneOf(m.name, m.category?.name) : zoneOf(it.name);
      if (typeof it.turnValue !== 'number') out.turnValue = typeof m?.turnValue === 'number' ? m.turnValue : 1;
      return out;
    });
  }

  /** A ticket as the board shows it: its legs and where the visit is at. */
  private view<T extends object>(w: T) {
    const t = w as unknown as TicketLike;
    // overdueMinutes: how far past its expected finish the visit is (the board
    // turns it amber); null when nothing is running or it is parked at the till.
    return { ...w, legs: legsOf(t), phase: phaseOf(t), overdueMinutes: overdueMinutes(t, new Date()) };
  }

  /**
   * Park the visits nobody closed. A ticket late by STALE_GRACE_MIN on every
   * running leg, or any ticket still in a chair an hour after the salon's
   * closing time, moves to "waiting to pay" exactly as the desk's own button
   * does: the bill stays open for the till, the technician is free, and the
   * dispatcher gives her the next customer. Returns the parked ticket ids.
   */
  async parkStale(tenantId: string, now = new Date()): Promise<string[]> {
    const open = await this.prisma.walkIn.findMany({
      where: { tenantId, status: WalkInStatus.SERVING, awaitingPayment: false },
      select: { id: true, status: true, assignedStaffId: true, createdAt: true, assignedAt: true, doneAt: true, awaitingPayment: true, items: true, customerName: true },
    });
    if (!open.length) return [];
    const afterHours = await this.afterHours(tenantId, now);
    const stale = (open as unknown as TicketLike[]).filter((t) => (afterHours ? staleAfterHours(t, now) : false) || isStale(t, now)).map((t) => t.id);
    // The desk's phones: visits that just ran +15′ late (once each), and the ones parked below.
    await this.alertDesk(tenantId, (open as unknown as NamedTicket[]).filter((t) => !stale.includes(t.id)), now,
      (open as unknown as NamedTicket[]).filter((t) => stale.includes(t.id)).map((t) => (t.customerName || '').trim() || 'Walk-in'));
    if (!stale.length) return [];
    await this.prisma.walkIn.updateMany({
      where: { id: { in: stale }, tenantId, status: WalkInStatus.SERVING, awaitingPayment: false },
      data: { awaitingPayment: true, stationId: null },
    });
    await this.settle(tenantId);
    return stale;
  }

  /**
   * Push to the people running the floor (walkins/overdue-alert.ts). Best
   * effort: no push set up, or any error, and the sweep carries on.
   */
  private async alertDesk(tenantId: string, running: NamedTicket[], now: Date, parkedNames: string[]): Promise<void> {
    if (!this.push) return;
    try {
      const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: LATE_WARNED_KEY } } });
      const warned = ((row?.value as { ids?: unknown } | null)?.ids ?? []) as string[];
      const late = newlyLate(running, now, Array.isArray(warned) ? warned : []);
      const late1 = lateAlert(late);
      const parked = parkedAlert(parkedNames);
      if (!late1 && !parked) return;
      const [admins, staff] = await Promise.all([
        this.prisma.user.findMany({ where: { tenantId, role: UserRole.SALON_ADMIN, isActive: true }, select: { id: true } }),
        this.prisma.staffMember.findMany({ where: { tenantId, userId: { not: null } }, select: { userId: true, staffRole: true, permissions: true } as never }) as unknown as Promise<{ userId: string | null; staffRole: string | null; permissions?: unknown }[]>,
      ]);
      const to = deskUserIds(admins, staff);
      if (late1) {
        const ids = rememberWarned(warned, late.map((l) => l.id));
        await this.prisma.setting.upsert({
          where: { tenantId_key: { tenantId, key: LATE_WARNED_KEY } },
          update: { value: { ids } as never }, create: { tenantId, key: LATE_WARNED_KEY, value: { ids } as never },
        });
        await this.push.sendToTenant(tenantId, late1, { onlyUserIds: to });
      }
      if (parked) await this.push.sendToTenant(tenantId, parked, { onlyUserIds: to });
    } catch { /* the board's badge is still there */ }
  }

  /** Every salon with someone still in a chair, one after another; one salon's error never stops the next. */
  async parkStaleEverywhere(now = new Date()): Promise<{ tenants: number; parked: number }> {
    const rows = await this.prisma.walkIn.findMany({
      where: { status: WalkInStatus.SERVING, awaitingPayment: false },
      select: { tenantId: true }, distinct: ['tenantId'],
    });
    let parked = 0;
    for (const r of rows) {
      try { parked += (await this.parkStale(r.tenantId, now)).length; } catch { /* next salon */ }
    }
    return { tenants: rows.length, parked };
  }

  /**
   * A new day starts with an empty "waiting to pay" (walkins/unpaid-sweep.ts).
   * Visits parked at the till on an earlier salon day close as Done on their
   * own day, without an order. Returns the closed ids.
   */
  async closeUnpaidPastDays(tenantId: string, now = new Date()): Promise<string[]> {
    const open = await this.prisma.walkIn.findMany({
      where: { tenantId, status: WalkInStatus.SERVING, awaitingPayment: true },
      select: { id: true, status: true, assignedStaffId: true, createdAt: true, assignedAt: true, doneAt: true, awaitingPayment: true, items: true },
    });
    if (!open.length) return [];
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
    const tz = t?.timezone || 'UTC';
    const todo = unpaidFromPastDays(open as unknown as TicketLike[], salonYmd(now, tz), (d) => salonYmd(d, tz));
    const closed: string[] = [];
    for (const c of todo) {
      // Guarded: a till that rang the visit up a second ago wins.
      const r = await this.prisma.walkIn.updateMany({
        where: { id: { in: [c.id] }, tenantId, status: WalkInStatus.SERVING, awaitingPayment: true },
        data: { status: WalkInStatus.DONE, doneAt: c.doneAt },
      });
      if (r.count) closed.push(c.id);
    }
    if (closed.length) {
      await this.audit?.log({ tenantId, action: 'walkin.unpaid_closed', resourceType: 'walk_in', resourceId: closed[0], metadata: { count: closed.length, ids: closed.slice(0, 200) } });
    }
    return closed;
  }

  /** Every salon with a visit parked at the till; one salon's error never stops the next. */
  async closeUnpaidEverywhere(now = new Date()): Promise<{ tenants: number; closed: number }> {
    const rows = await this.prisma.walkIn.findMany({
      where: { status: WalkInStatus.SERVING, awaitingPayment: true },
      select: { tenantId: true }, distinct: ['tenantId'],
    });
    let closed = 0;
    for (const r of rows) {
      try { closed += (await this.closeUnpaidPastDays(r.tenantId, now)).length; } catch { /* next salon */ }
    }
    return { tenants: rows.length, closed };
  }

  /**
   * Visits of the last UNPAID_LIST_DAYS days that were closed (by the sweep or
   * the desk's "Bỏ qua") while parked at the till and that no receipt settled —
   * the desk's "Chưa tính tiền ngày trước". Today's are in "done" already.
   */
  private async unpaidEarlier(tenantId: string, today: Date) {
    const since = new Date(today.getTime() - UNPAID_LIST_DAYS * 86400000);
    const rows = await this.prisma.walkIn.findMany({
      where: { tenantId, status: WalkInStatus.DONE, awaitingPayment: true, doneAt: { gte: since, lt: today } },
      include: INCLUDE, orderBy: { doneAt: 'desc' }, take: 100,
    });
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const orders = await this.prisma.order.findMany({
      where: { tenantId, OR: [{ walkInId: { in: ids } }, { walkInIds: { hasSome: ids } }, { items: { some: { walkInId: { in: ids } } } }] } as never,
      select: { walkInId: true, walkInIds: true, items: { select: { walkInId: true } } } as never,
    }) as unknown as { walkInId: string | null; walkInIds?: string[]; items?: { walkInId: string | null }[] }[];
    const paid = settledWalkIns(orders);
    return rows.filter((r) => !paid.has(r.id)).map((w) => ({ ...this.view(w), arrivedAt: (w as { createdAt: Date }).createdAt }));
  }

  /** True from an hour after the salon's closing time until the next day begins. A day marked
   *  closed says nothing (a salon that opens on its day off is still working), so only the
   *  late-by-grace rule applies then. */
  private async afterHours(tenantId: string, now: Date): Promise<boolean> {
    try {
      const [t, rules] = await Promise.all([
        this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }),
        this.settings.getBookingRules(tenantId),
      ]);
      const parts = tzPartsOf(now, t?.timezone || 'UTC');
      const day = rules.businessHours?.[parts.wd];
      if (!day || day.closed) return false;
      return parts.h * 60 + parts.mi >= day.closeMinutes + 60;
    } catch { return false; }
  }

  /** Re-read one ticket (after the dispatcher may have moved it on). */
  private async row(tenantId: string, id: string) {
    const w = await this.prisma.walkIn.findFirst({ where: { id, tenantId }, include: INCLUDE });
    if (!w) throw new NotFoundException('Walk-in not found');
    return this.view(w);
  }

  /** Run the dispatcher after a change, never failing the change itself. */
  private async settle(tenantId: string) {
    await this.seatWaitingQueue(tenantId).catch(() => []);
    // Walk-in 2.0: "your turn is coming" texts, when the salon turned them on. Never blocks the floor.
    await this.notifyUpcoming(tenantId).catch(() => 0);
  }

  /**
   * The ticket's items with real legIds, and the real id of `legId` — which
   * for a ticket written before legs is the virtual "_ticket" leg.
   * Returns legId null when the ticket has no lines at all (nothing to write).
   */
  private async legItems(tenantId: string, w: TicketLike, legId: string): Promise<{ items: LegItem[]; legId: string | null }> {
    const before = legItemsOf(w);
    const legacyIds = new Set(before.filter((it) => !it.legId).map((it) => it.lineId));
    const items = legacyIds.size ? upgradeItems({ ...w, items: await this.enrich(tenantId, before) }) : before.map((it) => ({ ...it }));
    if (legId !== TICKET_LEG) {
      if (!items.some((it) => it.legId === legId)) throw new NotFoundException('Leg not found');
      return { items, legId };
    }
    const real = items.find((it) => legacyIds.has(it.lineId))?.legId ?? null;
    return { items, legId: real };
  }

  /** Write items + what the ticket row says about them. */
  private async writeItems(w: TicketLike & { tenantId: string }, items: LegItem[], extra: Record<string, unknown> = {}) {
    const s = syncTicket(w, items, new Date());
    await this.prisma.walkIn.updateMany({
      where: { id: w.id, tenantId: w.tenantId },
      data: {
        items: items as unknown as Prisma.InputJsonValue,
        status: s.status as WalkInStatus,
        assignedStaffId: s.assignedStaffId,
        assignedAt: s.assignedAt,
        doneAt: s.doneAt,
        ...extra,
      },
    });
    return s;
  }

  /** An active technician of this salon, or a 400. */
  private async techOf(tenantId: string, staffId: string): Promise<string> {
    const staff = await this.prisma.staffMember.findFirst({ where: { id: staffId, tenantId, takesAppointments: true }, select: { id: true } });
    if (!staff) throw new BadRequestException('Technician not found');
    return staff.id;
  }

  /**
   * Midnight in the SALON'S timezone, not the server's. Render runs in UTC, so
   * the old server-local version rolled the day over at 5pm Pacific / 8pm
   * Eastern: the turn counters and "Finished today" reset in the middle of the
   * evening shift, right when techs care most about whose turn it is.
   */
  private async startOfToday(tenantId: string): Promise<Date> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
    const tz = t?.timezone || 'UTC';
    try {
      const now = new Date();
      // Today's date as it reads on the salon's wall clock.
      const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
      const utcGuess = new Date(`${ymd}T00:00:00Z`);
      // What that instant looks like in the salon's zone tells us the offset,
      // DST included — subtract it to land on real local midnight.
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(utcGuess);
      const num = (type: string) => Number(parts.find((x) => x.type === type)?.value ?? 0);
      const asUtc = Date.UTC(num('year'), num('month') - 1, num('day'), num('hour') % 24, num('minute'), num('second'));
      return new Date(utcGuess.getTime() - (asUtc - utcGuess.getTime()));
    } catch {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    }
  }

  /** Lowercased text used to route a service to a chair type (its name + category). */
  private svcMatchText(name?: string | null, category?: string | null): string {
    return `${name ?? ''} ${category ?? ''}`.toLowerCase();
  }

  /** True if the service text contains the type's name or any of its keywords. */
  private typeMatches(svcText: string, typeName: string, keywords?: string | null): boolean {
    const words = [typeName, ...(keywords ?? '').split(',')].map((w) => w.trim().toLowerCase()).filter(Boolean);
    return words.some((w) => svcText.includes(w));
  }

  /** A free chair for a new walk-in: an active station not currently held by a
   *  SERVING walk-in, preferring one whose TYPE matches the service (by the type's
   *  name or its editable keywords). Falls back to the first free chair. */
  private async freeStationId(tenantId: string, svcText: string): Promise<string | null> {
    const [stations, occupied] = await Promise.all([
      this.prisma.station.findMany({ where: { tenantId, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, stationType: { select: { name: true, keywords: true } } } }),
      this.prisma.walkIn.findMany({ where: { tenantId, status: WalkInStatus.SERVING, stationId: { not: null } }, select: { stationId: true } }),
    ]);
    if (stations.length === 0) return null;
    const busy = new Set(occupied.map((o) => o.stationId));
    const free = stations.filter((st) => !busy.has(st.id));
    if (free.length === 0) return null;
    const hit = svcText.trim()
      ? free.find((st) => st.stationType && this.typeMatches(svcText, st.stationType.name, st.stationType.keywords))
      : undefined;
    return (hit ?? free[0]).id;
  }

  /**
   * Add a walk-in. Every service the customer asked for goes on the ticket,
   * grouped into legs (hands, feet, anything else — see walkin-legs.ts), and
   * the dispatcher starts whatever it can: hands and feet together when two
   * technicians are free. A technician picked at the desk takes every leg
   * (the customer asked for her); the desk can move any leg afterwards.
   * "Add to waiting" only queues the ticket.
   */
  async add(user: AuthenticatedUser, dto: AddWalkInDto) {
    const tenantId = this.tenantId(user);
    const svcMeta = dto.serviceId
      ? await this.prisma.service.findFirst({ where: { id: dto.serviceId, tenantId }, select: { id: true } })
      : null;
    const serviceId = svcMeta?.id ?? null;
    const staffId = dto.assignedStaffId
      ? (await this.prisma.staffMember.findFirst({ where: { id: dto.assignedStaffId, tenantId, takesAppointments: true }, select: { id: true } }))?.id ?? null
      : null;
    // Every service the customer asked for, in the order picked. The first one
    // stays the ticket's headline service.
    const wanted = [...new Set([...(serviceId ? [serviceId] : []), ...(dto.serviceIds ?? [])])].filter(Boolean);
    // Find-or-create a CRM customer by phone/email so the walk-in earns loyalty
    // and is remarketable, with the birthday for the birthday campaign.
    // A customer picked from the records links by id — only one of THIS
    // salon's; an id from elsewhere is ignored and the contact path runs.
    const onFile = dto.customerId
      ? await this.prisma.customer.findFirst({ where: { id: dto.customerId, tenantId }, select: { id: true, firstName: true, phone: true } }).catch(() => null)
      : null;
    const linked = onFile ?? ((dto.phone?.trim() || dto.email?.trim())
      ? await this.customers.findOrCreateByContact(tenantId, {
          firstName: dto.customerName,
          lastName: dto.lastName,
          phone: dto.phone,
          email: dto.email,
          birthDate: dto.birthDate,
        })
      : null);
    // Priced once we know who she is: today's walk-in promotion, or her
    // first-visit tier when that is better (one best %, never both).
    const promo = await this.ticketPromo(tenantId, 'walkin', { customerId: linked?.id ?? null });
    const lines: (LegItem & { zone: Zone })[] = [];
    for (const sid of wanted) {
      try { lines.push(await this.buildItem(tenantId, sid, staffId, promo)); } catch { /* removed from the menu */ }
    }
    const base = attachLines([], lines);
    const items = attachLines(base, await this.addonLines(tenantId, dto.addonIds, base));
    // A PARTY is one ticket per person, linked by a groupId: each guest has
    // their own services, their own technician and their own line at the
    // till, and the board shows them side by side as one group.
    const guests = (Array.isArray(dto.guests) ? dto.guests : []).slice(0, 9);
    const groupId = guests.length ? `wk-${randomUUID()}` : null;
    const partySize = Math.max(1, Math.min(20, Math.round(Math.max(dto.partySize ?? 1, guests.length + 1))));
    const leaderName = dto.customerName?.trim().slice(0, 80) || onFile?.firstName || null;
    const created = await this.prisma.walkIn.create({
      data: {
        tenantId,
        serviceId,
        customerId: linked?.id ?? null,
        customerName: leaderName,
        phone: dto.phone?.trim().slice(0, 40) || onFile?.phone || null,
        note: dto.note?.trim().slice(0, 300) || null,
        partySize,
        extraMinutes: dto.extraMinutes ? Math.max(0, Math.min(600, Math.round(dto.extraMinutes))) : null,
        // A requested technician with no services yet: the ticket itself waits for her.
        assignedStaffId: staffId,
        items: items as unknown as Prisma.InputJsonValue,
        station: dto.station?.trim().slice(0, 24) || null,
        source: 'walkin',
        status: WalkInStatus.WAITING,
        ...({ groupId } as object),
      },
      select: { id: true },
    });
    // A customer with a booking near now, added as a walk-in: tie the ticket to
    // the booking, or the midnight sweep marks a customer who came as a no-show.
    await linkWalkInToBooking(this.prisma as never, tenantId, created.id, linked?.id ?? null).catch(() => null);
    const guestIds: string[] = [];
    let guestPromo: ((categoryId: string | null) => number) | undefined;
    let anyRequested = !!staffId;
    for (let i = 0; i < guests.length; i++) {
      const g = guests[i] ?? {};
      const gStaff = g.assignedStaffId
        ? (await this.prisma.staffMember.findFirst({ where: { id: g.assignedStaffId, tenantId, takesAppointments: true }, select: { id: true } }))?.id ?? null
        : null;
      anyRequested = anyRequested || !!gStaff;
      const gLines: (LegItem & { zone: Zone })[] = [];
      for (const sid of [...new Set((g.serviceIds ?? []).filter(Boolean))]) {
        // A guest has no record of her own: today's walk-in promotion only.
        try { gLines.push(await this.buildItem(tenantId, sid, gStaff, guestPromo ??= await this.ticketPromo(tenantId, 'walkin'))); } catch { /* removed from the menu */ }
      }
      const gBase = attachLines([], gLines);
      const gItems = attachLines(gBase, await this.addonLines(tenantId, g.addonIds, gBase));
      const row = await this.prisma.walkIn.create({
        data: {
          tenantId,
          serviceId: gLines[0]?.serviceId ?? null,
          customerId: null,
          customerName: (g.firstName ?? '').trim().slice(0, 80) || `Guest ${i + 2}`,
          phone: null,
          note: leaderName ? `With ${leaderName}` : null,
          partySize,
          assignedStaffId: gStaff,
          items: gItems as unknown as Prisma.InputJsonValue,
          source: 'walkin',
          status: WalkInStatus.WAITING,
          ...({ groupId } as object),
        },
        select: { id: true },
      });
      guestIds.push(row.id);
    }
    // Never ahead of anybody already waiting: the dispatcher serves the queue
    // in arrival order, so a newcomer only starts when nobody is before them
    // (or the technician they asked for is free).
    if (anyRequested || dto.autoAssign) await this.settle(tenantId);
    const lead = await this.row(tenantId, created.id);
    return guestIds.length ? { ...lead, guestIds } : lead;
  }

  /**
   * A customer who checked in on their own phone joins the queue and the
   * dispatcher runs, exactly as for the desk's "Auto". Returns the technician
   * now working on them, or null when they are waiting.
   */
  async seatSelfCheckIn(tenantId: string, walkInId: string): Promise<string | null> {
    await this.seatWaitingQueue(tenantId);
    const after = await this.prisma.walkIn.findFirst({
      where: { id: walkInId, tenantId },
      select: { status: true, assignedStaffId: true },
    });
    return after?.status === WalkInStatus.SERVING ? after.assignedStaffId : null;
  }

  /**
   * Everything the dispatcher and the board need about today's floor: open
   * tickets, today's finished ones, the team with their skills, and turns.
   */
  private async floor(tenantId: string) {
    const today = await this.startOfToday(tenantId);
    const rules = await this.turnRules(tenantId);
    const dayKey = await this.todayKey(tenantId);
    const dow = new Date(`${dayKey}T12:00:00Z`).getUTCDay();
    const [open, doneToday, staff, links, completedAppts, adjustments, clockIns, breaks, hours] = await Promise.all([
      this.prisma.walkIn.findMany({ where: { tenantId, status: { in: [WalkInStatus.WAITING, WalkInStatus.SERVING] } }, include: INCLUDE, orderBy: { createdAt: 'asc' } }),
      this.prisma.walkIn.findMany({ where: { tenantId, status: WalkInStatus.DONE, doneAt: { gte: today } }, include: INCLUDE, orderBy: { doneAt: 'desc' } }),
      this.prisma.staffMember.findMany({
        where: { tenantId, isActive: true, takesAppointments: true },
        select: { id: true, firstName: true, lastName: true, avatarUrl: true, bookingPriority: true, createdAt: true, user: { select: { role: true } } },
        orderBy: [{ bookingPriority: 'desc' }, { firstName: 'asc' }],
      }) as unknown as Promise<{ id: string; firstName: string; lastName: string | null; avatarUrl: string | null; bookingPriority: number; createdAt?: Date | null; user?: { role: string } | null }[]>,
      this.prisma.staffService.findMany({ where: { tenantId }, select: { staffMemberId: true, serviceId: true } }).catch(() => [] as { staffMemberId: string; serviceId: string }[]),
      this.prisma.appointment.findMany({
        where: { tenantId, status: AppointmentStatus.COMPLETED, completedAt: { gte: today }, assignedStaffId: { not: null } },
        select: { id: true, assignedStaffId: true, completedAt: true, priceCents: true, customer: { select: { firstName: true, lastName: true } }, service: { select: { name: true, turnValue: true } as never } } as never,
      }) as unknown as Promise<{ id: string; assignedStaffId: string | null; completedAt: Date | null; priceCents: number | null; customer: { firstName: string; lastName: string | null } | null; service: { name: string; turnValue?: number | null } | null }[]>,
      // Turns the owner added or took away by hand today (turn_adjustments).
      (this.db.turnAdjustment?.findMany({ where: { tenantId, day: dayKey }, orderBy: { createdAt: 'asc' } }).catch(() => []) ?? Promise.resolve([])) as Promise<{ id: string; staffId: string; delta: number; reason: string | null; createdAt: Date }[]>,
      // Who clocked in when (the CLOCK_IN tie-break); nothing when the salon has no clock.
      (this.db.timeEntry?.findMany({ where: { tenantId, clockIn: { gte: today } }, select: { staffId: true, clockIn: true }, orderBy: { clockIn: 'asc' } }).catch(() => []) ?? Promise.resolve([])) as Promise<{ staffId: string; clockIn: Date }[]>,
      this.breaks(tenantId),
      // Today's scheduled starts (the LATE rule compares the clock-in against them).
      (this.prisma.staffWorkingHour?.findMany({ where: { tenantId, isActive: true, dayOfWeek: dow }, select: { staffMemberId: true, startTime: true } }).catch(() => []) ?? Promise.resolve([])) as Promise<{ staffMemberId: string; startTime: string }[]>,
    ]);
    const tickets = [...open, ...doneToday] as unknown as TicketLike[];
    // Turns: each finished leg is worth its service's turn value under the
    // salon's rules (a ticket from before legs keeps the old one-per-technician
    // rule), plus completed bookings — EXCEPT a booking that was seated on the
    // floor: its ticket already counted, so the same visit is not two turns.
    const turns = turnsFromTickets(tickets, today, rules);
    const seatedApptIds = new Set([...open, ...doneToday].map((w) => (w as { appointmentId?: string | null }).appointmentId).filter((x): x is string => !!x));
    // A ticket closed on an earlier day and paid today: its turn stayed on its day.
    const unseen = completedAppts.map((a) => a.id).filter((id) => !seatedApptIds.has(id));
    if (unseen.length) {
      const rows = await (this.prisma.walkIn.findMany({ where: { tenantId, appointmentId: { in: unseen }, status: { not: WalkInStatus.CANCELLED } }, select: { appointmentId: true } }) as Promise<{ appointmentId: string | null }[]>).catch(() => [] as { appointmentId: string | null }[]);
      for (const r of rows) if (r.appointmentId) seatedApptIds.add(r.appointmentId);
    }
    const countedAppts = completedAppts.filter((a) => a.assignedStaffId && !seatedApptIds.has(a.id));
    for (const a of countedAppts) {
      const v = appointmentTurns(a.service?.turnValue, rules);
      if (v > 0) turns.set(a.assignedStaffId!, Math.round(((turns.get(a.assignedStaffId!) ?? 0) + v) * 100) / 100);
    }
    for (const adj of adjustments) turns.set(adj.staffId, Math.round(((turns.get(adj.staffId) ?? 0) + adj.delta) * 100) / 100);
    // MONEY mode: service money today, bookings included.
    const money = moneyFromTickets(tickets, today);
    for (const a of countedAppts) money.set(a.assignedStaffId!, (money.get(a.assignedStaffId!) ?? 0) + (a.priceCents ?? 0));
    const lastDone = lastDoneFromTickets(tickets, today);
    for (const a of countedAppts) if (a.completedAt && (lastDone.get(a.assignedStaffId!) ?? 0) < a.completedAt.getTime()) lastDone.set(a.assignedStaffId!, a.completedAt.getTime());
    const clockIn = new Map<string, number>();
    for (const c of clockIns) if (!clockIn.has(c.staffId)) clockIn.set(c.staffId, new Date(c.clockIn).getTime());
    // Late to the schedule (past the grace): the rule's ½ / 1 turn for the day — computed, never stored.
    const late = new Map<string, { minutes: number; value: number }>();
    if (rules.latePolicy !== 'NONE') {
      const firstStart = new Map<string, string>();
      for (const h of hours) if (!firstStart.has(h.staffMemberId) || h.startTime < firstStart.get(h.staffMemberId)!) firstStart.set(h.staffMemberId, h.startTime);
      for (const [staffId, at] of clockIn) {
        const min = minutesLate(at, today.getTime(), firstStart.get(staffId), rules.lateGraceMin);
        const value = latePenalty(rules, min);
        if (value > 0) { late.set(staffId, { minutes: min, value }); turns.set(staffId, Math.round(((turns.get(staffId) ?? 0) + value) * 100) / 100); }
      }
    }
    // A new technician's head start (newTechDays): read as turns behind, never stored.
    const boost = new Map<string, number>();
    const nowMs = new Date();
    for (const s of staff) {
      const b = newTechBoost(s.createdAt, nowMs, rules);
      if (b) { boost.set(s.id, b); turns.set(s.id, Math.round(((turns.get(s.id) ?? 0) + b) * 100) / 100); }
    }
    // The owner out of the rotation: only clients who asked for her by name.
    const manualOnly = new Set<string>(rules.ownerInRotation ? [] : staff.filter((s) => s.user?.role === 'SALON_ADMIN').map((s) => s.id));
    const onBreak = new Set(Object.keys(breaks));
    const pick = { rules, facts: { lastDone, clockIn }, money, manualOnly };
    const skills = new Map<string, string[]>();
    for (const l of links ?? []) skills.set(l.staffMemberId, [...(skills.get(l.staffMemberId) ?? []), l.serviceId]);
    const techs: TechInfo[] = staff.map((s) => ({
      id: s.id,
      name: `${s.firstName}${s.lastName ? ' ' + s.lastName : ''}`,
      priority: Number(s.bookingPriority) || 0,
      skills: skills.get(s.id) ?? [],
    }));
    const restricted = new Set((links ?? []).map((l) => l.serviceId));
    return { today, dayKey, open, doneToday, staff, techs, skills, turns, restricted, rules, money, lastDone, clockIn, pick, adjustments, countedAppts, late, breaks, onBreak, boost, manualOnly };
  }

  // ---------------------------------------------------------------- tạm nghỉ (breaks)

  private static readonly BREAKS_KEY = 'tech_breaks';

  /** Who is on a break right now: { staffId: { since } }. One salon's setting. */
  private async breaks(tenantId: string): Promise<Record<string, { since: string }>> {
    try {
      const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: WalkinsService.BREAKS_KEY } } });
      const v = (row?.value && typeof row.value === 'object' ? row.value : {}) as Record<string, { since?: string }>;
      const out: Record<string, { since: string }> = {};
      for (const [k, x] of Object.entries(v)) if (x && typeof x.since === 'string') out[k] = { since: x.since };
      return out;
    } catch { return {}; }
  }

  /**
   * TẠM NGHỈ. On a break she gets no customer; back from it she keeps her
   * place (HOLD) or goes to the end of the line (BOTTOM — a correction that
   * lifts her turns to the highest on the floor, written with its reason).
   * A technician sets her own; the desk / owner can set anyone's.
   */
  async setBreak(user: AuthenticatedUser, staffId: string, on: boolean) {
    const tenantId = this.tenantId(user);
    const st = await this.prisma.staffMember.findFirst({ where: { id: staffId, tenantId }, select: { id: true, firstName: true } });
    if (!st) throw new NotFoundException('Staff member not found');
    const cur = await this.breaks(tenantId);
    const was = !!cur[st.id];
    if (on === was) return { staffId: st.id, onBreak: on };
    if (on) cur[st.id] = { since: new Date().toISOString() }; else delete cur[st.id];
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: WalkinsService.BREAKS_KEY } },
      update: { value: cur as unknown as Prisma.InputJsonValue },
      create: { tenantId, key: WalkinsService.BREAKS_KEY, value: cur as unknown as Prisma.InputJsonValue },
    });
    if (!on) {
      const f = await this.floor(tenantId);
      if (f.rules.breakPolicy === 'BOTTOM') {
        const others = f.techs.filter((t) => t.id !== st.id).map((t) => f.turns.get(t.id) ?? 0);
        const delta = toBottomDelta(f.turns.get(st.id) ?? 0, others);
        if (delta > 0) await this.db.turnAdjustment.create({ data: { tenantId, staffId: st.id, day: f.dayKey, delta, reason: 'Quay lại sau giờ nghỉ (xuống cuối)', byUserId: user.userId } });
      }
      await this.settle(tenantId);
    }
    await this.audit?.log({ tenantId, userId: user.userId, action: on ? 'turn.break_started' : 'turn.break_ended', resourceType: 'staff_member', resourceId: st.id });
    return { staffId: st.id, onBreak: on };
  }

  /** The technician's own break (her login → her staff record). */
  async setMyBreak(user: AuthenticatedUser, on: boolean) {
    const me = await this.staffOf(user);
    if (!me) throw new NotFoundException('No staff profile for this login');
    return this.setBreak(user, me, on);
  }

  // ---------------------------------------------------------------- bỏ qua khách (skip)

  /**
   * BỎ QUA. A technician (or the desk, for her) passes a customer on: the leg
   * goes back to the queue for the next free technician — never back to her —
   * and the rule says what it costs: nothing, a turn anyway (so passing on a
   * small job never pays), or the end of the line.
   */
  async skipLeg(user: AuthenticatedUser, id: string, legId: string, reason?: string) {
    const w = await this.mine(user, id);
    const tenantId = w.tenantId;
    const me = user.role === UserRole.STAFF ? await this.staffOf(user) : null;
    let skipped: string | null = null;
    let legTurn = 1;
    let legName = '';
    await serial(tenantId, async () => {
      const fresh = await this.mine(user, id);
      const t = fresh as unknown as TicketLike;
      const { items, legId: real } = await this.legItems(tenantId, t, legId);
      if (!real) throw new BadRequestException('This ticket has no service lines to pass on.');
      const leg = legsOf({ ...t, items }).find((l) => l.legId === real);
      if (!leg || leg.status === 'DONE') throw new BadRequestException('This part of the visit is already finished.');
      if (!leg.staffId) throw new BadRequestException('Nobody is on this part of the visit yet.');
      if (me && leg.staffId !== me) throw new ForbiddenException('This customer is not with you.');
      skipped = leg.staffId;
      legTurn = leg.turnValue || 1;
      legName = leg.names.join(', ');
      const next = patchLeg(items, real, { staffId: null, pinned: false, legStatus: 'WAITING', startedAt: null, skippedBy: [...new Set([...leg.skippedBy, leg.staffId])] });
      await this.writeItems({ ...t, tenantId }, next);
    });
    const why = (reason ?? '').trim().slice(0, 200);
    const f = await this.floor(tenantId);
    if (skipped) {
      if (f.rules.skipPolicy === 'COUNT_AS_TURN') {
        await this.db.turnAdjustment.create({ data: { tenantId, staffId: skipped, day: f.dayKey, delta: Math.max(0.5, Math.round(legTurn * 2) / 2), reason: `Bỏ qua khách${why ? ` — ${why}` : ''}`, byUserId: user.userId } });
      } else if (f.rules.skipPolicy === 'BOTTOM') {
        const others = f.techs.filter((t) => t.id !== skipped).map((t) => f.turns.get(t.id) ?? 0);
        const delta = toBottomDelta(f.turns.get(skipped) ?? 0, others);
        if (delta > 0) await this.db.turnAdjustment.create({ data: { tenantId, staffId: skipped, day: f.dayKey, delta, reason: `Bỏ qua khách (xuống cuối)${why ? ` — ${why}` : ''}`, byUserId: user.userId } });
      }
      await this.audit?.log({ tenantId, userId: user.userId, action: 'turn.skipped', resourceType: 'walk_in', resourceId: id, metadata: { staffId: skipped, leg: legName, reason: why || null, policy: f.rules.skipPolicy } });
    }
    await this.settle(tenantId);
    return this.row(tenantId, w.id);
  }

  // ---------------------------------------------------------------- chia tua: the board, by hand, the rules

  /**
   * TUA HÔM NAY, line by line: every technician's turns and where each one
   * came from (a leg, a booking, a correction), so a dispute is settled by
   * reading, not by memory. This salon's floor only.
   */
  async turnsToday(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const f = await this.floor(tenantId);
    const busy = busyTechs(f.open as unknown as TicketLike[]);
    const free = f.techs.filter((t) => !busy.has(t.id) && !f.onBreak.has(t.id));
    const order: string[] = [];
    // The rotation as the dispatcher would run it from here: pick, remove, pick again.
    let pool = [...free];
    while (pool.length) { const t = pickTech(pool, [], f.turns, f.pick); if (!t) break; order.push(t.id); pool = pool.filter((x) => x.id !== t.id); }
    const name = (id: string) => f.techs.find((t) => t.id === id)?.name ?? '';
    type Entry = { at: Date; staffId: string; kind: 'leg' | 'appointment' | 'adjust' | 'late' | 'boost'; value: number; label: string; pinned: boolean; priceCents: number | null; byUserId?: string | null };
    const entries: Entry[] = [];
    for (const t of [...f.open, ...f.doneToday] as unknown as (TicketLike & { customerName?: string | null })[]) {
      const closed = t.status === 'DONE';
      for (const leg of legsOf(t)) {
        if (!leg.staffId) continue;
        const finished = leg.status === 'DONE' || (closed && leg.status !== 'WAITING') || (t.awaitingPayment && leg.status !== 'WAITING');
        if (!finished) continue;
        const when = leg.doneAt ? new Date(leg.doneAt) : t.doneAt ? new Date(t.doneAt) : null;
        if (!when || when < f.today) continue;
        const price = legPrice(t, leg);
        entries.push({ at: when, staffId: leg.staffId, kind: 'leg', value: legTurns({ turnValue: leg.turnValue, pinned: leg.pinned, priceCents: price }, f.rules), label: `${t.customerName || 'Walk-in'} · ${leg.names.join(', ')}`, pinned: leg.pinned, priceCents: price });
      }
    }
    for (const a of f.countedAppts) {
      entries.push({ at: a.completedAt ?? f.today, staffId: a.assignedStaffId!, kind: 'appointment', value: appointmentTurns(a.service?.turnValue, f.rules), label: `${a.customer ? `${a.customer.firstName}${a.customer.lastName ? ' ' + a.customer.lastName : ''}` : ''} · ${a.service?.name ?? ''}`.trim(), pinned: false, priceCents: a.priceCents ?? null });
    }
    for (const adj of f.adjustments) entries.push({ at: adj.createdAt, staffId: adj.staffId, kind: 'adjust', value: adj.delta, label: adj.reason || '', pinned: false, priceCents: null });
    for (const [staffId, l] of f.late) entries.push({ at: f.clockIn.has(staffId) ? new Date(f.clockIn.get(staffId)!) : f.today, staffId, kind: 'late', value: l.value, label: `Vào ca trễ ${l.minutes} phút`, pinned: false, priceCents: null });
    for (const [staffId, b] of f.boost) entries.push({ at: f.today, staffId, kind: 'boost', value: b, label: `Thợ mới (${f.rules.newTechDays} ngày đầu)`, pinned: false, priceCents: null });
    entries.sort((a, b) => a.at.getTime() - b.at.getTime());
    const techs = f.techs.map((t) => ({
      id: t.id, name: t.name, priority: t.priority,
      turns: f.turns.get(t.id) ?? 0, moneyCents: f.money.get(t.id) ?? 0,
      busy: busy.has(t.id), onBreak: f.onBreak.has(t.id), breakSince: f.breaks[t.id]?.since ?? null, rank: order.indexOf(t.id) + 1 || null,
      lastDoneAt: f.lastDone.has(t.id) ? new Date(f.lastDone.get(t.id)!) : null,
      clockInAt: f.clockIn.has(t.id) ? new Date(f.clockIn.get(t.id)!) : null,
      fromLegs: entries.filter((e) => e.staffId === t.id && e.kind === 'leg').reduce((s, e) => s + e.value, 0),
      fromAppointments: entries.filter((e) => e.staffId === t.id && e.kind === 'appointment').reduce((s, e) => s + e.value, 0),
      fromAdjustments: entries.filter((e) => e.staffId === t.id && e.kind === 'adjust').reduce((s, e) => s + e.value, 0),
      fromLate: entries.filter((e) => e.staffId === t.id && e.kind === 'late').reduce((s, e) => s + e.value, 0),
      fromBoost: f.boost.get(t.id) ?? 0,
      // false = requested clients only (the owner out of the rotation).
      inRotation: !f.manualOnly.has(t.id),
    }));
    return { day: f.dayKey, rules: f.rules, techs, entries: entries.map((e) => ({ ...e, name: name(e.staffId) })) };
  }

  /**
   * The week in numbers (any range up to 62 days, salon days): turns, money,
   * requests, skips and days worked per technician. Same counting as the live
   * floor; a booking seated on the floor is one turn, not two.
   */
  async turnReport(user: AuthenticatedUser, from?: string, to?: string) {
    const tenantId = this.tenantId(user);
    const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
    let range = isDay(from) && isDay(to) && from <= to ? { from, to } : weekOf(isDay(from) ? from : await this.todayKey(tenantId));
    if ((Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86400000 > 62) range = { from: range.from, to: new Date(Date.parse(`${range.from}T00:00:00Z`) + 62 * 86400000).toISOString().slice(0, 10) };
    const rules = await this.turnRules(tenantId);
    const tz = (await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }))?.timezone || 'UTC';
    let fmt: Intl.DateTimeFormat;
    try { fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }); }
    catch { fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }); }
    const dayOf = (d: Date) => fmt.format(d);
    // A day wider on both sides in UTC; the day keys do the exact cut.
    const lo = new Date(Date.parse(`${range.from}T00:00:00Z`) - 86400000);
    const hi = new Date(Date.parse(`${range.to}T00:00:00Z`) + 2 * 86400000);
    const [tickets, appts, adjustments, skipLogs, staff] = await Promise.all([
      this.prisma.walkIn.findMany({ where: { tenantId, status: WalkInStatus.DONE, doneAt: { gte: lo, lt: hi } }, select: { id: true, status: true, assignedStaffId: true, createdAt: true, doneAt: true, awaitingPayment: true, items: true, appointmentId: true } as never }) as unknown as Promise<(TicketLike & { appointmentId?: string | null })[]>,
      this.prisma.appointment.findMany({
        where: { tenantId, status: AppointmentStatus.COMPLETED, completedAt: { gte: lo, lt: hi }, assignedStaffId: { not: null } },
        select: { id: true, assignedStaffId: true, completedAt: true, priceCents: true, service: { select: { turnValue: true } as never } } as never,
      }) as unknown as Promise<{ id: string; assignedStaffId: string | null; completedAt: Date | null; priceCents: number | null; service: { turnValue?: number | null } | null }[]>,
      (this.db.turnAdjustment?.findMany({ where: { tenantId, day: { gte: range.from, lte: range.to } }, select: { staffId: true, delta: true, createdAt: true, day: true } }).catch(() => []) ?? Promise.resolve([])) as Promise<{ staffId: string; delta: number; createdAt: Date; day: string }[]>,
      (this.db.auditLog?.findMany({ where: { tenantId, action: 'turn.skipped', createdAt: { gte: lo, lt: hi } }, select: { metadata: true, createdAt: true } }).catch(() => []) ?? Promise.resolve([])) as Promise<{ metadata: unknown; createdAt: Date }[]>,
      this.prisma.staffMember.findMany({ where: { tenantId }, select: { id: true, firstName: true, lastName: true, isActive: true } }),
    ]);
    const seated = new Set(tickets.map((t) => t.appointmentId).filter((x): x is string => !!x));
    const report = turnReport(
      tickets, appts.map((a) => ({ assignedStaffId: a.assignedStaffId, completedAt: a.completedAt, priceCents: a.priceCents, turnValue: a.service?.turnValue, seated: seated.has(a.id) })),
      adjustments.map((a) => ({ staffId: a.staffId, delta: a.delta, day: a.day })),
      skipLogs.map((l) => ({ staffId: String((l.metadata as { staffId?: string } | null)?.staffId ?? ''), at: l.createdAt })).filter((x) => x.staffId),
      range, rules, dayOf,
    );
    const name = (id: string) => { const st = staff.find((x) => x.id === id); return st ? `${st.firstName}${st.lastName ? ' ' + st.lastName : ''}` : ''; };
    return { ...report, techs: report.techs.map((t) => ({ ...t, name: name(t.staffId), active: staff.find((x) => x.id === t.staffId)?.isActive ?? false })) };
  }

  /** The owner adds or takes away a turn by hand, with the reason — written to the log. */
  async adjustTurn(user: AuthenticatedUser, dto: { staffId: string; delta: number; reason?: string }) {
    const tenantId = this.tenantId(user);
    const st = await this.prisma.staffMember.findFirst({ where: { id: dto.staffId, tenantId }, select: { id: true, firstName: true } });
    if (!st) throw new NotFoundException('Staff member not found');
    const delta = Math.round(Number(dto.delta) * 2) / 2;
    if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 20) throw new BadRequestException('delta must be ±0.5 … ±20');
    const reason = (dto.reason ?? '').trim().slice(0, 200) || null;
    const day = await this.todayKey(tenantId);
    const row = await this.db.turnAdjustment.create({ data: { tenantId, staffId: st.id, day, delta, reason, byUserId: user.userId } });
    await this.audit?.log({ tenantId, userId: user.userId, action: 'turn.adjusted', resourceType: 'staff_member', resourceId: st.id, metadata: { day, delta, reason } });
    return { id: row.id, day, delta, reason };
  }

  async removeAdjustment(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const cur = await this.db.turnAdjustment.findFirst({ where: { id, tenantId } });
    if (!cur) throw new NotFoundException('Adjustment not found');
    await this.db.turnAdjustment.deleteMany({ where: { id, tenantId } });
    await this.audit?.log({ tenantId, userId: user.userId, action: 'turn.adjustment_removed', resourceType: 'staff_member', resourceId: cur.staffId, metadata: { day: cur.day, delta: cur.delta } });
    return { ok: true };
  }

  async getTurnRules(user: AuthenticatedUser) {
    return this.turnRules(this.tenantId(user));
  }

  async updateTurnRules(user: AuthenticatedUser, raw: unknown) {
    const tenantId = this.tenantId(user);
    const next = cleanTurnRules({ ...(await this.turnRules(tenantId)), ...((raw && typeof raw === 'object' ? raw : {}) as object) });
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: TURN_RULES_KEY } },
      update: { value: next as unknown as Prisma.InputJsonValue },
      create: { tenantId, key: TURN_RULES_KEY, value: next as unknown as Prisma.InputJsonValue },
    });
    await this.audit?.log({ tenantId, userId: user.userId, action: 'settings.turn_rules_updated', resourceType: 'tenant', resourceId: tenantId, metadata: { ...next } });
    return next;
  }

  /**
   * Start every leg that can start, fairly. Called wherever a technician frees
   * up or the queue changes: a leg or ticket finished, a ticket paid, a
   * customer added, a leg moved. The rules live in planDispatch (pure, tested):
   * customers part-way through first, then arrival order; fewest turns, then
   * priority; a technician only gets services she does; hands and feet run
   * together, nothing else does.
   *
   * Best effort by design — it runs after the change it follows has been
   * saved, so a failure leaves people in the queue rather than undoing the
   * change. Returns the ids of the tickets it started something on.
   */
  async seatWaitingQueue(tenantId: string): Promise<string[]> {
    return serial(tenantId, () => this.dispatchLocked(tenantId));
  }

  private async dispatchLocked(tenantId: string): Promise<string[]> {
    const f = await this.floor(tenantId);
    // A queued ticket written by older code (or the self check-in screen) is
    // split into legs now, so its hands and feet can go to two technicians.
    const upgraded = new Set<string>();
    const tickets: (Omit<(typeof f.open)[number], 'items'> & { items: LegItem[] })[] = [];
    for (const w of f.open) {
      const raw = legItemsOf(w as unknown as TicketLike);
      if (w.status === WalkInStatus.WAITING && raw.some((it) => !it.legId)) {
        const items = upgradeItems({ ...(w as unknown as TicketLike), items: await this.enrich(tenantId, raw) });
        tickets.push({ ...w, items });
        upgraded.add(w.id);
      } else {
        tickets.push({ ...w, items: raw });
      }
    }
    const policy = await this.deskPolicy(tenantId);
    const protect = policy.protectBooking ? { bookingAt: await this.bookingAt(tenantId), bookingBufferMin: policy.bookingBufferMin, now: Date.now() } : {};
    const plan = planDispatch(tickets as unknown as TicketLike[], f.techs.filter((t) => !f.onBreak.has(t.id)), f.turns, { restricted: f.restricted, ...f.pick, ...protect });
    const now = new Date();
    const seated: string[] = [];
    for (const t of tickets) {
      const mine = plan.filter((a) => a.ticketId === t.id);
      if (!mine.length && !upgraded.has(t.id)) continue;
      let items: LegItem[] = t.items;
      let ticketTech: string | null = null;
      for (const a of mine) {
        if (a.legId === TICKET_LEG) { ticketTech = a.staffId; continue; }
        items = patchLeg(items, a.legId, { legStatus: 'SERVING', staffId: a.staffId, startedAt: now.toISOString(), doneAt: null });
      }
      const extra: Record<string, unknown> = {};
      if (mine.length && !t.stationId) {
        const names = legsOf({ ...(t as unknown as TicketLike), items }).filter((l) => mine.some((a) => a.legId === l.legId)).flatMap((l) => l.names);
        extra.stationId = await this.freeStationId(tenantId, this.svcMatchText(names.join(' ') || t.service?.name, null)).catch(() => null);
      }
      if (ticketTech) {
        // A ticket with no service lines: the ticket itself is the job.
        await this.prisma.walkIn.updateMany({
          where: { id: t.id, tenantId },
          data: { status: WalkInStatus.SERVING, assignedStaffId: ticketTech, assignedAt: now, ...extra },
        });
      } else {
        await this.writeItems({ ...(t as unknown as TicketLike), tenantId }, items, extra);
      }
      if (mine.length) {
        seated.push(t.id);
        const started = legsOf({ ...(t as unknown as TicketLike), items });
        for (const a of mine) {
          const leg = started.find((l) => l.legId === a.legId);
          this.notifyStart(tenantId, a.staffId, t.customerName, leg?.names ?? []);
        }
      }
    }
    return seated;
  }

  /** The live board: queue, chairs, legs, and per-tech turns. */
  async board(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const f = await this.floor(tenantId);
    const now = new Date();
    const open = f.open as unknown as TicketLike[];
    const busy = busyTechs(open);
    // Parties: tickets that came in together wear one letter (A, B, C…) so
    // the desk sees at a glance who belongs with whom and how far along the
    // group is — "A · 2/3 in a chair, 1 waiting".
    const groups = partyTags([...f.open, ...f.doneToday] as unknown as (TicketLike & { groupId?: string | null })[]);
    // WHEN THE CUSTOMER CAME IN. A checked-in booking's ticket is queued at its
    // booked time (createdAt), so createdAt is not the arrival; the appointment's
    // arrivedAt is. A plain walk-in arrived when the ticket was made.
    const apptIds = [...f.open, ...f.doneToday].map((w) => (w as { appointmentId?: string | null }).appointmentId).filter((x): x is string => !!x);
    // Display only — a failed read never costs the desk its board.
    const [apptTimes, tenantRow] = await Promise.all([
      (async () => {
        if (!apptIds.length) return [] as { id: string; arrivedAt: Date | null; startTime: Date }[];
        try { return await this.prisma.appointment.findMany({ where: { tenantId, id: { in: apptIds } }, select: { id: true, arrivedAt: true, startTime: true } }); } catch { return []; }
      })(),
      (async () => { try { return await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }); } catch { return null; } })(),
    ]);
    const apptById = new Map(apptTimes.map((a) => [a.id, a]));
    const tagged = <T extends object>(w: T) => {
      const gid = (w as { groupId?: string | null }).groupId;
      const g = gid ? groups.get(gid) : undefined;
      const appt = apptById.get((w as { appointmentId?: string | null }).appointmentId ?? '');
      const createdAt = (w as { createdAt: Date }).createdAt;
      return {
        ...this.view(w), group: g ?? null,
        arrivedAt: appt?.arrivedAt ?? createdAt,
        bookedAt: appt?.startTime ?? null,
      };
    };
    // Waiting-to-pay: the technician is finished, so she is free.
    const policy = await this.deskPolicy(tenantId);
    const protect = policy.protectBooking ? { bookingAt: await this.bookingAt(tenantId), bookingBufferMin: policy.bookingBufferMin, now: now.getTime() } : {};
    const freeNow = f.techs.filter((t) => !busy.has(t.id) && !f.onBreak.has(t.id));
    // Walk-in 2.0: who the rules would give each waiting customer right now.
    const etas = this.queueEtas(f, busy, now);
    const called = await this.calledMap(tenantId);
    const waiting = f.open.filter((w) => w.status === WalkInStatus.WAITING).map((w) => ({
      ...tagged(w),
      suggestedStaffId: suggestFor(w as unknown as TicketLike, freeNow, f.techs, f.turns, { restricted: f.restricted, ...f.pick, ...protect }),
      eta: etas.get(w.id) ?? null,
      calledAt: called[w.id]?.at ?? null,
    }));
    const serving = f.open.filter((w) => w.status === WalkInStatus.SERVING).sort((a, b) => +(a.assignedAt ?? a.createdAt) - +(b.assignedAt ?? b.createdAt)).map((w) => tagged(w));

    // Today's online bookings not yet arrived — shown in the floor's "Booked today"
    // strip so walk-ins and appointments live on one screen.
    const tomorrow = new Date(f.today.getTime() + 86400000);
    const bookedRaw = await this.prisma.appointment.findMany({
      where: { tenantId, startTime: { gte: f.today, lt: tomorrow }, status: { in: [AppointmentStatus.PENDING, AppointmentStatus.ASSIGNED, AppointmentStatus.ACCEPTED, AppointmentStatus.CONFIRMED] } },
      select: { id: true, startTime: true, source: true, groupId: true, customerId: true, customer: { select: { firstName: true, lastName: true } }, service: { select: { name: true } }, assignedStaff: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { startTime: 'asc' }, take: 60,
    });
    // How many are booked together: the ones still to come plus the ones of
    // the same party already on the floor.
    const partyCount = (gid: string | null) => (gid
      ? bookedRaw.filter((x) => x.groupId === gid).length + f.open.filter((w) => (w as { groupId?: string | null }).groupId === gid).length
      : 1);
    const booked = bookedRaw.map((a) => ({
      id: a.id,
      groupId: a.groupId ?? null,
      groupSize: partyCount(a.groupId ?? null),
      startTime: a.startTime,
      customerId: a.customerId ?? null,
      source: normalizeSource(a.source),
      customerName: a.customer ? `${a.customer.firstName}${a.customer.lastName ? ' ' + a.customer.lastName : ''}`.trim() : null,
      serviceName: a.service?.name ?? null,
      staff: a.assignedStaff ? { id: a.assignedStaff.id, name: `${a.assignedStaff.firstName}${a.assignedStaff.lastName ? ' ' + a.assignedStaff.lastName : ''}` } : null,
    }));

    // Next up = the free technician the dispatcher would pick for a plain job.
    const free = f.techs.filter((t) => !busy.has(t.id) && !f.onBreak.has(t.id));
    const nextUpStaffId = pickTech(free, [], f.turns, f.pick)?.id ?? null;
    // Walk-in 2.0: the whole line in turn order, each technician's next booking,
    // what she usually does, and today's totals. Display only — dispatch is unchanged.
    const order = turnOrder(f.techs, f.turns, f.pick, f.onBreak);
    const rankOf = new Map(order.map((id, i) => [id, i + 1]));
    const nextBooking = nextBookingByStaff(bookedRaw.map((a) => ({ startTime: a.startTime, staffId: a.assignedStaff?.id ?? null })), now);
    const recent = await (this.prisma.walkIn.findMany({
      where: { tenantId, status: WalkInStatus.DONE, doneAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } },
      select: { assignedStaffId: true, items: true }, orderBy: { doneAt: 'desc' }, take: 600,
    }) as Promise<{ assignedStaffId: string | null; items: unknown }[]>).catch(() => [] as { assignedStaffId: string | null; items: unknown }[]);
    const frequent = frequentServices(recent, 4);
    const totals = todayTotals(f.doneToday as unknown as { items: unknown }[]);
    const staff = f.staff.map((s) => ({
      id: s.id,
      name: `${s.firstName}${s.lastName ? ' ' + s.lastName : ''}`,
      avatarUrl: s.avatarUrl,
      turns: f.turns.get(s.id) ?? 0,
      busy: busy.has(s.id),
      onBreak: f.onBreak.has(s.id),
      // Minutes left on what she is doing now (rough), for "free in ~10'".
      busyFor: busy.has(s.id) ? minutesLeft(open, s.id, now) : null,
      // Services she does; empty = everything (nobody ticked boxes yet).
      skills: f.skills.get(s.id) ?? [],
      nextUp: s.id === nextUpStaffId,
      rank: rankOf.get(s.id) ?? null,
      manualOnly: f.manualOnly.has(s.id),
      nextBookingAt: nextBooking.get(s.id) ?? null,
    }));

    // Finished today, most recent first: a ticket marked Done by mistake (or done
    // before the customer paid) has to be reachable again for checkout.
    const done = f.doneToday.slice(0, 20).map((w) => tagged(w));
    // Closed without a receipt on an earlier day — still reachable for the till.
    const unpaid = await this.unpaidEarlier(tenantId, f.today).catch(() => []);
    // The salon's timezone: every clock on the desk is read in it, never in
    // the browser's (a manager in Vietnam saw 10:00 AM bookings as 0:00).
    return { waiting, serving, booked, done, unpaid, staff, nextUpStaffId, restricted: [...f.restricted], timezone: tenantRow?.timezone ?? null, today: totals, frequent, policy };
  }

  /**
   * THE TILL'S VIEW OF A PARTY. Everyone who came in together, each with her
   * own lines, where she is (still in a chair / finished / paid), and which of
   * her lines a friend already paid for — read back from the paid orders'
   * rows, so a reload of the till, or a second till, sees the same thing.
   */
  async party(user: AuthenticatedUser, groupId: string) {
    const tenantId = this.tenantId(user);
    const tickets = await this.prisma.walkIn.findMany({
      where: { tenantId, ...({ groupId } as object), status: { not: WalkInStatus.CANCELLED } },
      include: INCLUDE, orderBy: { createdAt: 'asc' },
    });
    if (!tickets.length) throw new NotFoundException('Party not found');
    const ids = tickets.map((t) => t.id);
    const [f, orders, staff, groupPromo] = await Promise.all([
      this.floor(tenantId),
      this.prisma.order.findMany({
        where: { tenantId, status: OrderStatus.PAID, OR: [{ walkInId: { in: ids } }, { walkInIds: { hasSome: ids } }] } as never,
        select: { id: true, orderNumber: true, walkInId: true, walkInIds: true, items: { select: { walkInId: true, walkInLineId: true } } } as never,
      }) as unknown as Promise<{ id: string; orderNumber: number; walkInId: string | null; walkInIds?: string[]; items: { walkInId: string | null; walkInLineId: string | null }[] }[]>,
      this.prisma.staffMember.findMany({ where: { tenantId, isActive: true }, select: { id: true, firstName: true, lastName: true } }),
      // A party that BOOKED was priced with its group tier at booking (and keeps
      // that price at the till); only a party that walked in is offered it here.
      this.groupPromoFor(tenantId, tickets.length, tickets.some((t) => (t as { appointmentId?: string | null }).appointmentId) ? 'online' : 'walkin'),
    ]);
    const tag = partyTags([...f.open, ...f.doneToday] as unknown as (TicketLike & { groupId?: string | null })[]).get(groupId)?.tag ?? null;
    const now = new Date();
    // Which lines are paid, and by which receipt.
    const paidLine = new Map<string, number>(); // `${walkInId}:${lineId}` -> orderNumber
    const paidWhole = new Map<string, number>(); // walkInId -> orderNumber (settled in full)
    for (const o of orders) {
      for (const it of o.items) if (it.walkInId && it.walkInLineId) paidLine.set(`${it.walkInId}:${it.walkInLineId}`, o.orderNumber);
      for (const wid of [...(o.walkInIds ?? []), ...(o.walkInId ? [o.walkInId] : [])]) paidWhole.set(wid, o.orderNumber);
    }
    const members = tickets.map((w) => {
      const t = w as unknown as TicketLike;
      const legs = legsOf(t);
      const items = legItemsOf(t).map((it) => {
        const by = paidLine.get(`${w.id}:${it.lineId}`) ?? paidWhole.get(w.id) ?? null;
        return { lineId: it.lineId, serviceId: it.serviceId, name: it.name, priceCents: it.priceCents, durationMinutes: it.durationMinutes ?? 0, staffId: it.staffId ?? null, paid: by !== null, orderNumber: by, ...(it.kind === 'addon' ? { kind: 'addon' } : {}) };
      });
      const running = legs.filter((l) => l.status === 'SERVING' && l.startedAt);
      const minutesLeft = running.length
        ? Math.max(0, ...running.map((l) => Math.round((l.minutes || 60) - (now.getTime() - new Date(l.startedAt!).getTime()) / 60000)))
        : null;
      const finished = w.status === WalkInStatus.DONE || !!w.awaitingPayment || (w.status === WalkInStatus.SERVING && legs.length > 0 && legs.every((l) => l.status === 'DONE'));
      const paid = w.status === WalkInStatus.DONE || paidWhole.has(w.id) || (items.length > 0 && items.every((i) => i.paid));
      return {
        id: w.id, customerName: w.customerName, customerId: w.customerId, phone: w.phone, status: w.status, awaitingPayment: !!w.awaitingPayment,
        phase: phaseOf(t), minutesLeft, overdueMinutes: overdueMinutes(t, now), source: w.source ?? null, appointmentId: w.appointmentId ?? null,
        finished, paid, orderNumbers: [...new Set(items.map((i) => i.orderNumber).filter((n): n is number => n !== null))], items,
      };
    });
    const lead = members.find((m) => m.customerId) ?? members.find((m) => m.phone) ?? members[0];
    return {
      groupId, tag, leaderId: lead.id, phone: lead.phone, source: lead.source,
      // The salon's own "N or more people → X% off", when it applies today.
      groupPromo,
      members,
      staff: staff.map((s) => ({ id: s.id, name: `${s.firstName}${s.lastName ? ' ' + s.lastName : ''}` })),
    };
  }

  /**
   * The group programme the owner set up (Services → Khuyến mãi → Nhóm): the
   * best tier this party's size reaches, if the programme runs today. The same
   * rule the booking page quotes; here it is offered at the till, where a party
   * that walked in without booking would otherwise never get it.
   */
  private async groupPromoFor(tenantId: string, size: number, where: SaleChannel = 'walkin'): Promise<{ percent: number; minSize: number; message: string } | null> {
    try {
      if (size < 2 || where !== 'walkin') return null;
      const gr = await this.settings.getGroupDiscount(tenantId);
      // Online-only group deals are not for a party that walked in.
      if (!gr?.enabled || !Array.isArray(gr.tiers) || !appliesOn(gr, 'walkin')) return null;
      const tz = (await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }))?.timezone ?? null;
      if (!inPromoWindow(gr, salonYmd(new Date(), tz))) return null;
      let best: { percent: number; minSize: number } | null = null;
      for (const t of gr.tiers) {
        const min = Number(t?.minSize ?? 99); const pct = Number(t?.percent ?? 0);
        if (min <= size && pct > 0 && (!best || pct > best.percent)) best = { percent: Math.min(90, pct), minSize: min };
      }
      return best ? { ...best, message: gr.message || '' } : null;
    } catch { return null; }
  }

  /**
   * The promotion on a ticket line (Services → Khuyến mãi), ONE best %, never
   * stacked: today's weekday or date sale the salon runs for this channel
   * (walk-ins, or everywhere) and the first-visit tier once the customer is
   * known. Group deals are offered at the till (groupPromoFor). Best-effort:
   * a promotion that cannot be read never blocks a ticket.
   */
  private async ticketPromo(
    tenantId: string,
    where: SaleChannel,
    who: { customerId?: string | null; excludeWalkInId?: string | null; excludeAppointmentId?: string | null } = {},
  ): Promise<(categoryId: string | null) => number> {
    try {
      const rows = await this.prisma.setting.findMany({
        where: { tenantId, key: { in: [WEEKDAY_DISCOUNTS_KEY, DATE_DISCOUNTS_KEY, FIRST_VISIT_DISCOUNT_KEY] } },
        select: { key: true, value: true },
      });
      if (!Array.isArray(rows) || !rows.length) return () => 0;
      const byKey = new Map<string, unknown>(rows.map((r) => [r.key, r.value as unknown] as [string, unknown]));
      const tz = (await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }))?.timezone ?? null;
      const now = new Date();
      const wdName = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', weekday: 'short' }).format(now);
      const day: SalonDay = {
        dayKey: salonYmd(now, tz),
        weekday: ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[wdName] ?? now.getDay(),
      };
      const promos: PromoSettings = {
        weekday: (programFor(byKey.get(WEEKDAY_DISCOUNTS_KEY) as PromoSettings['weekday'], where) ?? null) as PromoSettings['weekday'],
        dates: (dateRulesFor(byKey.get(DATE_DISCOUNTS_KEY) as { rules?: { appliesTo?: unknown }[] } | null, where) ?? null) as unknown as PromoSettings['dates'],
      };
      const program = await this.visitTierPct(tenantId, byKey.get(FIRST_VISIT_DISCOUNT_KEY), where, day.dayKey, who);
      return (categoryId) => Math.max(promoPct(promos, day, categoryId), program);
    } catch {
      return () => 0;
    }
  }

  /** The promotion for a line added to an existing ticket: a seated booking keeps its booking's channel. */
  private ticketPromoFor(w: { id: string; tenantId: string; customerId?: string | null; appointmentId?: string | null; source?: string | null }) {
    const where: SaleChannel = w.appointmentId ? channelOfSource(w.source) : 'walkin';
    return this.ticketPromo(w.tenantId, where, { customerId: w.customerId ?? null, excludeWalkInId: w.id, excludeAppointmentId: w.appointmentId ?? null });
  }

  /**
   * The visit tier this customer reaches (Khuyến mãi → Khách mới / tri ân):
   * visit number = her finished visits (bookings that arrived or completed,
   * walk-ins that were done) + 1. Zero when the programme is off, not for this
   * channel, outside its dates, or she is not on file.
   */
  private async visitTierPct(
    tenantId: string,
    saved: unknown,
    where: SaleChannel,
    dayKey: string,
    who: { customerId?: string | null; excludeWalkInId?: string | null; excludeAppointmentId?: string | null },
  ): Promise<number> {
    const fv = saved as ({ enabled?: boolean; percent?: number; rules?: { visit?: number; percent?: number }[] } & PromoWindow) | undefined;
    if (!who.customerId || !fv?.enabled || !appliesOn(fv, where) || !inPromoWindow(fv, dayKey)) return 0;
    const rules = Array.isArray(fv.rules) && fv.rules.length ? fv.rules : ((fv.percent ?? 0) > 0 ? [{ visit: 1, percent: fv.percent }] : []);
    if (!rules.length) return 0;
    const [appts, walks] = await Promise.all([
      this.prisma.appointment.count({
        where: {
          tenantId, customerId: who.customerId, status: { in: [AppointmentStatus.ARRIVED, AppointmentStatus.COMPLETED] },
          ...(who.excludeAppointmentId ? { id: { not: who.excludeAppointmentId } } : {}),
        },
      }),
      // A walk-in that was a seated booking is already counted as that booking.
      this.prisma.walkIn.count({
        where: {
          tenantId, customerId: who.customerId, status: WalkInStatus.DONE, appointmentId: null,
          ...(who.excludeWalkInId ? { id: { not: who.excludeWalkInId } } : {}),
        } as never,
      }),
    ]);
    const hit = rules.find((r) => (r?.visit ?? 0) === appts + walks + 1);
    return hit && (hit.percent ?? 0) > 0 ? Math.min(90, Math.round(hit.percent!)) : 0;
  }

  /** The kiosk's first-visit tier for a customer it just identified (0 when none). */
  async walkInVisitTierPct(tenantId: string, customerId: string | null): Promise<number> {
    try {
      if (!customerId) return 0;
      const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: FIRST_VISIT_DISCOUNT_KEY } }, select: { value: true } });
      const tz = (await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }))?.timezone ?? null;
      return await this.visitTierPct(tenantId, row?.value, 'walkin', salonYmd(new Date(), tz), { customerId });
    } catch {
      return 0;
    }
  }

  /** Check in an online booking: place the customer on the floor as a ticket
   *  linked back to the appointment, and mark the appointment ARRIVED. Its
   *  booked technicians take their legs; the rest goes through the dispatcher,
   *  queued at the booked time rather than behind everyone who walked in since. */
  async seatAppointment(user: AuthenticatedUser, appointmentId: string) {
    const tenantId = this.tenantId(user);
    const appt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId },
      select: {
        id: true, customerId: true, source: true, assignedStaffId: true, addons: true, startTime: true, groupId: true, priceCents: true,
        customer: { select: { firstName: true, lastName: true, phone: true } },
        service: { select: { id: true, name: true } },
      },
    });
    if (!appt) throw new NotFoundException('Appointment not found');
    // Already on the floor (a double tap, two desks, the tech's own start):
    // the same ticket, never a second one and a second turn.
    const onFloor = await this.prisma.walkIn.findFirst({ where: { tenantId, appointmentId: appt.id, status: { not: WalkInStatus.CANCELLED } }, select: { id: true } });
    if (onFloor) return this.row(tenantId, onFloor.id);
    const custName = appt.customer ? `${appt.customer.firstName}${appt.customer.lastName ? ' ' + appt.customer.lastName : ''}`.trim() : null;
    // Every service of the booking, each with the technician it was booked with.
    type BookedLine = { id?: string; kind?: string; name?: string; priceCents?: number; durationMinutes?: number; staffMemberId?: string | null };
    const booked = Array.isArray(appt.addons) ? (appt.addons as unknown as BookedLine[]) : [];
    const extraLines = booked.filter((a) => a?.kind === 'service' && a?.id);
    // The price she was QUOTED is the price at the till — her booking's
    // promotion (online-only sale, first visit, group…) and its add-ons
    // included. Re-pricing from the menu here dropped every booking promotion
    // the moment the customer sat down.
    const cents = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
    // Booked add-ons keep their own line on the ticket (price as quoted), on
    // the headline service's leg — not folded into its name and price, where
    // the desk could not tell "Take Off Only $35" from a mis-priced service.
    const addOnBooked = booked.filter((a) => a && a.kind !== 'service' && String(a.name ?? '').trim());
    const extrasCents = extraLines.reduce((sum, a) => sum + (cents(a.priceCents) ?? 0), 0);
    const addOnCents = addOnBooked.reduce((sum, a) => sum + (cents(a.priceCents) ?? 0), 0);
    const totalCents = cents((appt as { priceCents?: unknown }).priceCents);
    const primaryCents = totalCents != null && totalCents >= extrasCents + addOnCents ? totalCents - extrasCents - addOnCents : null;
    const lines: (LegItem & { zone: Zone })[] = [];
    if (appt.service) {
      const it = await this.buildItem(tenantId, appt.service.id, appt.assignedStaffId ?? null);
      lines.push({
        ...it,
        ...(primaryCents != null ? { priceCents: primaryCents } : null),
      });
    }
    for (const line of extraLines) {
      try {
        const it = await this.buildItem(tenantId, line.id!, line.staffMemberId ?? appt.assignedStaffId ?? null);
        const c = cents(line.priceCents);
        lines.push(c != null ? { ...it, priceCents: c } : it);
      } catch {
        // A service deleted since the booking was taken shouldn't block check-in.
      }
    }
    const now = new Date();
    let items = attachLines([], lines);
    const headline = lines[0];
    if (headline && addOnBooked.length) {
      items = attachLines(items, addOnBooked.map((a) => ({
        lineId: randomUUID(), serviceId: String(a.id ?? ''), kind: 'addon' as const, forLineId: headline.lineId,
        name: String(a.name ?? '').trim().slice(0, 120), priceCents: cents(a.priceCents) ?? 0,
        durationMinutes: typeof a.durationMinutes === 'number' ? Math.max(0, Math.round(a.durationMinutes)) : 0,
        staffId: headline.staffId ?? null, zone: headline.zone, turnValue: 0,
      })));
    }
    // The booked technician is expecting this customer: her first leg starts now.
    const first = legsOf({ id: '', status: 'WAITING', assignedStaffId: null, createdAt: now, items }).find((l) => l.staffId);
    if (first) items = patchLeg(items, first.legId, { legStatus: 'SERVING', startedAt: now.toISOString() });
    const ticket: TicketLike = { id: '', status: 'WAITING', assignedStaffId: null, createdAt: now, items };
    const s = syncTicket(ticket, items, now);
    const stationId = first ? await this.freeStationId(tenantId, this.svcMatchText(first.names.join(' ') || appt.service?.name, null)) : null;
    const walkIn = await this.prisma.walkIn.create({
      data: {
        tenantId,
        appointmentId: appt.id,
        customerId: appt.customerId,
        customerName: custName,
        phone: appt.customer?.phone ?? null,
        assignedStaffId: s.assignedStaffId ?? appt.assignedStaffId ?? null,
        items: items as unknown as Prisma.InputJsonValue,
        source: normalizeSource(appt.source),
        stationId,
        status: s.status as WalkInStatus,
        assignedAt: s.assignedAt,
        // In the queue at the time they booked, not at the time they walked in.
        createdAt: appt.startTime && appt.startTime < now ? appt.startTime : now,
        // Friends booked together stay together on the floor.
        ...({ groupId: appt.groupId ?? null } as object),
      },
      select: { id: true },
    });
    await this.prisma.appointment.update({ where: { id: appt.id }, data: { status: AppointmentStatus.ARRIVED, arrivedAt: now } });
    await this.settle(tenantId);
    return this.row(tenantId, walkIn.id);
  }

  /**
   * "Check in the whole party": the booking named plus everyone booked in the
   * same group, in this salon, that is still open — each becomes a ticket,
   * exactly as if the desk had pressed Check-in on every one. A member already
   * on the floor is reused, not duplicated; one who cancelled is left alone.
   * Returns the named booking's ticket with the ids of the party's tickets.
   */
  async seatParty(user: AuthenticatedUser, appointmentId: string) {
    const tenantId = this.tenantId(user);
    const appt = await this.prisma.appointment.findFirst({ where: { id: appointmentId, tenantId }, select: { id: true, groupId: true } });
    if (!appt) throw new NotFoundException('Appointment not found');
    const open: AppointmentStatus[] = [AppointmentStatus.PENDING, AppointmentStatus.ASSIGNED, AppointmentStatus.ACCEPTED, AppointmentStatus.CONFIRMED, AppointmentStatus.ARRIVED];
    const members = appt.groupId
      ? await this.prisma.appointment.findMany({ where: { tenantId, groupId: appt.groupId, status: { in: open } }, select: { id: true }, orderBy: { createdAt: 'asc' } })
      : [{ id: appt.id }];
    const ids = [...new Set([appt.id, ...members.map((m) => m.id)])];
    const partyTickets: string[] = [];
    let lead: Awaited<ReturnType<typeof this.row>> | null = null;
    for (const id of ids) {
      const existing = await this.prisma.walkIn.findFirst({
        where: { tenantId, appointmentId: id, status: { in: [WalkInStatus.WAITING, WalkInStatus.SERVING] } },
        select: { id: true },
      });
      let ticket: Awaited<ReturnType<typeof this.row>>;
      try {
        ticket = existing ? await this.row(tenantId, existing.id) : await this.seatAppointment(user, id);
      } catch { continue; } // a member closed since the list was read
      partyTickets.push(ticket.id);
      if (id === appt.id) lead = ticket;
    }
    if (!lead) throw new NotFoundException('Appointment not found');
    return { ...lead, partyTickets };
  }

  private async mine(user: AuthenticatedUser, id: string) {
    const w = await this.prisma.walkIn.findFirst({ where: { id, tenantId: this.tenantId(user) } });
    if (!w) throw new NotFoundException('Walk-in not found');
    return w;
  }

  private itemsOf(w: unknown): WalkInItem[] {
    const raw = (w as { items?: unknown }).items;
    return Array.isArray(raw) ? (raw as WalkInItem[]) : [];
  }

  /** Distinct non-null technician ids that appear on a walk-in's ticket. */
  private lineTechs(w: unknown): string[] {
    const ids = new Set<string>();
    for (const it of this.itemsOf(w)) if (it.staffId) ids.add(it.staffId);
    return [...ids];
  }

  /** Set/clear the physical station a walk-in is currently at (front desk OR tech). */
  async setStation(user: AuthenticatedUser, id: string, station?: string) {
    const w = await this.mine(user, id);
    const val = (station ?? '').toString().trim().slice(0, 24) || null;
    return this.prisma.walkIn.update({ where: { id: w.id }, data: { station: val }, include: INCLUDE });
  }

  /**
   * The desk corrects the name / phone / email / note on a checked-in ticket.
   * The client record is corrected too (customers.correctVisitContact), and a
   * ticket checked in from a booking moves its booking along with it.
   */
  async updateContact(user: AuthenticatedUser, id: string, dto: { firstName: string; lastName?: string; phone?: string; email?: string; birthDate?: string; note?: string }) {
    const w = await this.mine(user, id);
    const tenantId = w.tenantId;
    const res = await this.customers.correctVisitContact(tenantId, w.customerId ?? null, dto);
    const name = [dto.firstName.trim(), (dto.lastName ?? '').trim()].filter(Boolean).join(' ').slice(0, 80);
    const phone = (dto.phone ?? '').trim().slice(0, 40);
    const data: Record<string, unknown> = { customerName: name, customerId: res.customerId ?? w.customerId ?? null };
    if (phone) data.phone = phone;
    if (dto.note !== undefined) data.note = dto.note.trim().slice(0, 300) || null;
    const row = await this.prisma.walkIn.update({ where: { id: w.id }, data: data as never, include: INCLUDE });
    const apptId = (w as { appointmentId?: string | null }).appointmentId;
    if (apptId && res.customerId) {
      await this.prisma.appointment.updateMany({ where: { id: apptId, tenantId }, data: { customerId: res.customerId } });
    }
    await this.audit?.log({ tenantId, userId: user.userId, action: 'walkin.contact_updated', resourceType: 'walk_in', resourceId: w.id, metadata: { switched: res.switched } });
    return { ...row, contact: { switched: res.switched, emailSkipped: res.emailSkipped } };
  }

  /** Move a walk-in to a managed chair (drag on the floor) — or clear it (empty id). */
  async moveToStation(user: AuthenticatedUser, id: string, stationId?: string) {
    const w = await this.mine(user, id);
    let sid: string | null = null;
    const wanted = (stationId ?? '').trim();
    if (wanted) {
      const st = await this.prisma.station.findFirst({ where: { id: wanted, tenantId: w.tenantId }, select: { id: true } });
      if (!st) throw new BadRequestException('Station not found');
      sid = st.id;
    }
    return this.prisma.walkIn.update({ where: { id: w.id }, data: { stationId: sid, awaitingPayment: false }, include: INCLUDE });
  }

  /** Move the customer off the chair to wait to pay (bill stays open; chair + tech free). */
  async waitPayment(user: AuthenticatedUser, id: string) {
    const w = await this.mine(user, id);
    await this.assertService(w);
    await this.prisma.walkIn.updateMany({ where: { id: w.id, tenantId: w.tenantId }, data: { awaitingPayment: true, stationId: null } });
    // Her technician is free now: someone waiting can have her.
    await this.settle(w.tenantId);
    return this.row(w.tenantId, w.id);
  }

  /**
   * "Ra quầy trả tiền" from the technician's own app. Sending the customer to
   * pay closes the visit for everyone on it, so it is refused while another
   * part is still going or still to do (her feet with Lisa, or waiting for a
   * pedicurist): that technician would be marked free mid-pedicure. The
   * technician finishes HER part instead and the customer stays on the floor.
   */
  async waitPaymentAsMe(user: AuthenticatedUser, id: string) {
    const w = await this.mine(user, id);
    const me = await this.staffOf(user);
    const open = legsOf(w as unknown as TicketLike).filter((l) => !l.legacy && l.status !== 'DONE' && l.staffId !== me);
    if (open.length) {
      const what = open.map((l) => (l.zone === 'HAND' ? 'tay' : l.zone === 'FOOT' ? 'chân' : l.names[0] ?? 'dịch vụ')).join(', ');
      throw new BadRequestException(`Khách còn phần ${what} chưa xong — bấm "Xong phần của tôi", khách sẽ ở lại cho thợ kế tiếp.`);
    }
    return this.waitPayment(user, id);
  }

  /**
   * Undo an accidental "Done": bring a finished walk-in back to being served.
   * With legs, the leg finished last goes back into the chair.
   */
  async reactivate(user: AuthenticatedUser, id: string) {
    const w = await this.mine(user, id);
    await serial(w.tenantId, async () => {
      const t = w as unknown as TicketLike;
      const items = legItemsOf(t);
      if (!items.some((it) => it.legId)) {
        await this.prisma.walkIn.updateMany({ where: { id: w.id, tenantId: w.tenantId }, data: { status: WalkInStatus.SERVING, doneAt: null } });
        return;
      }
      const last = legsOf(t).filter((l) => l.status === 'DONE').sort((a, b) => String(a.doneAt).localeCompare(String(b.doneAt))).pop();
      const next = last ? patchLeg(items, last.legId, { legStatus: 'SERVING', doneAt: null }) : items;
      await this.writeItems({ ...t, tenantId: w.tenantId, doneAt: null }, next);
    });
    return this.row(w.tenantId, w.id);
  }

  /**
   * Add service lines to a running ticket (front desk OR the tech). A line
   * joins the leg already open for its part of the body (nail art on a
   * manicure in progress is the same job) or becomes a new leg for the
   * dispatcher. A line sent with a technician lands on her leg.
   */
  async addService(
    user: AuthenticatedUser,
    id: string,
    serviceId?: string,
    staffId?: string,
    serviceIds?: string[],
    extraMinutes?: number,
    addonIds?: string[],
  ) {
    const w = await this.mine(user, id);
    const ids = [...new Set([...(serviceId ? [serviceId] : []), ...(serviceIds ?? [])])].filter(Boolean);
    const wantAddons = (addonIds ?? []).filter(Boolean);
    const tech = staffId ? await this.techOf(w.tenantId, staffId) : null;
    const lines: (LegItem & { zone: Zone })[] = [];
    const promo = await this.ticketPromoFor(w);
    for (const sid of ids) lines.push(await this.buildItem(w.tenantId, sid, tech, promo));
    await serial(w.tenantId, async () => {
      const fresh = await this.mine(user, id);
      const t = fresh as unknown as TicketLike;
      const extra: Record<string, unknown> = {};
      // Sent explicitly (including 0) → replace the stored estimate.
      if (extraMinutes !== undefined) extra.extraMinutes = Math.max(0, Math.min(600, Math.round(extraMinutes)));
      if (!lines.length && !wantAddons.length) {
        if (Object.keys(extra).length) await this.prisma.walkIn.updateMany({ where: { id: fresh.id, tenantId: fresh.tenantId }, data: extra });
        return;
      }
      const before = legItemsOf(t);
      const base = before.some((it) => !it.legId) ? upgradeItems({ ...t, items: await this.enrich(fresh.tenantId, before) }) : before;
      // A line added to a ticket that has nothing else and is already with a
      // technician (no lines yet, "Giao"-ed) belongs to her.
      const owner = !base.length && fresh.status === WalkInStatus.SERVING ? fresh.assignedStaffId : null;
      // A technician logging what she did while she has the customer: it is
      // part of the leg she is on, whatever part of the body it is.
      const live = tech ? legsOf({ ...t, items: base }).find((l) => l.staffId === tech && l.status === 'SERVING') : undefined;
      let items: LegItem[] = live
        ? [...base, ...lines.map((l) => ({
            ...l, legId: live.legId, zone: base.find((b) => b.legId === live.legId)?.zone ?? live.zone,
            legStatus: 'SERVING' as const, pinned: live.pinned, startedAt: live.startedAt, doneAt: null, staffId: tech,
          }))]
        : attachLines(base, lines.map((l) => ({ ...l, staffId: l.staffId ?? owner })));
      // Add-ons ride on the service lines now on the ticket (new or already there).
      if (wantAddons.length) items = attachLines(items, await this.addonLines(fresh.tenantId, wantAddons, items));
      if (owner) {
        for (const leg of legsOf({ ...t, items })) if (leg.staffId === owner && leg.status === 'WAITING') {
          items = patchLeg(items, leg.legId, { legStatus: 'SERVING', startedAt: (fresh.assignedAt ?? new Date()).toISOString() });
          break;
        }
      }
      await this.writeItems({ ...t, tenantId: fresh.tenantId }, items, extra);
    });
    await this.settle(w.tenantId);
    return this.row(w.tenantId, w.id);
  }

  /**
   * Edit one line of a running ticket. Any subset: swap the service, correct the
   * price the customer was quoted, change how long it takes, or hand that line
   * to another tech. Swapping the service re-seeds name/price/minutes from the
   * catalogue unless the caller sends its own values.
   */
  async updateService(
    user: AuthenticatedUser,
    id: string,
    lineId: string,
    dto: { serviceId?: string; priceCents?: number; durationMinutes?: number; staffId?: string | null },
  ) {
    const w = await this.mine(user, id);
    const tech = dto.staffId ? await this.techOf(w.tenantId, dto.staffId) : null;
    await serial(w.tenantId, async () => {
      const fresh = await this.mine(user, id);
      const t = fresh as unknown as TicketLike;
      let items = legItemsOf(t).map((it) => ({ ...it }));
      const idx = items.findIndex((x) => x.lineId === lineId);
      if (idx < 0) throw new NotFoundException('Line not found');
      let line = { ...items[idx] };
      if (dto.serviceId && dto.serviceId !== line.serviceId) {
        const svc = await this.buildItem(fresh.tenantId, dto.serviceId, line.staffId, await this.ticketPromoFor(fresh));
        // Keep the line's identity and its place in its leg.
        line = { ...line, serviceId: svc.serviceId, name: svc.name, priceCents: svc.priceCents, durationMinutes: svc.durationMinutes, turnValue: svc.turnValue };
        if (!line.legId) line.zone = svc.zone;
      }
      if (dto.priceCents !== undefined) line.priceCents = Math.max(0, Math.round(dto.priceCents));
      if (dto.durationMinutes !== undefined) line.durationMinutes = Math.max(0, Math.min(600, Math.round(dto.durationMinutes)));
      items[idx] = line;
      if (dto.staffId !== undefined && (dto.staffId || null) !== line.staffId) {
        if (!line.legId) {
          items[idx] = { ...line, staffId: tech };
        } else {
          const leg = legsOf({ ...t, items }).find((l) => l.legId === line.legId)!;
          if (leg.lineIds.length === 1) {
            // The line is the whole leg: the leg changes hands.
            items = patchLeg(items, leg.legId, { staffId: tech, pinned: !!tech });
          } else {
            // One line of a bigger leg done by someone else: it becomes its own
            // leg, in the same state, with that technician.
            items[idx] = { ...line, legId: newLegId(), staffId: tech, pinned: !!tech };
          }
        }
      }
      await this.writeItems({ ...t, tenantId: fresh.tenantId }, items);
    });
    await this.settle(w.tenantId);
    return this.row(w.tenantId, w.id);
  }

  /** Remove one service line from a walk-in's ticket. */
  async removeService(user: AuthenticatedUser, id: string, lineId: string) {
    const w = await this.mine(user, id);
    await serial(w.tenantId, async () => {
      const fresh = await this.mine(user, id);
      const t = fresh as unknown as TicketLike;
      const items = legItemsOf(t).filter((x) => x.lineId !== lineId);
      if (!items.some((it) => it.legId)) {
        // A ticket from before legs: just the line, as before.
        await this.prisma.walkIn.updateMany({ where: { id: fresh.id, tenantId: fresh.tenantId }, data: { items: items as unknown as Prisma.InputJsonValue } });
        return;
      }
      await this.writeItems({ ...t, tenantId: fresh.tenantId }, items);
    });
    await this.settle(w.tenantId);
    return this.row(w.tenantId, w.id);
  }

  /**
   * Move one leg. The desk can do this at any moment:
   *   - waiting leg + a technician  → reserved for her; starts when she is free
   *     (or right now with `start`, even if she is still finishing someone);
   *   - waiting leg + null          → back to "whoever is up next";
   *   - leg in progress + a tech    → the customer changed technician mid-way:
   *     the leg (and its turn) moves to the new one, the clock keeps running;
   *   - leg in progress + null      → stop it and put it back in the queue;
   *   - finished leg + a tech       → correct who did it (and who gets the turn).
   */
  async assignLeg(user: AuthenticatedUser, id: string, legId: string, staffId: string | null, start = false) {
    const w = await this.mine(user, id);
    const tech = staffId ? await this.techOf(w.tenantId, staffId) : null;
    await serial(w.tenantId, async () => {
      const fresh = await this.mine(user, id);
      const t = fresh as unknown as TicketLike;
      const { items, legId: real } = await this.legItems(fresh.tenantId, t, legId);
      if (!real) {
        // A ticket with no lines: the ticket itself moves.
        const startNow = !!tech && (start || fresh.status === WalkInStatus.SERVING);
        await this.prisma.walkIn.updateMany({
          where: { id: fresh.id, tenantId: fresh.tenantId },
          data: tech
            ? { assignedStaffId: tech, ...(startNow ? { status: WalkInStatus.SERVING, assignedAt: fresh.assignedAt ?? new Date() } : {}) }
            : { assignedStaffId: null, status: WalkInStatus.WAITING, assignedAt: null },
        });
        return;
      }
      const leg = legsOf({ ...t, items }).find((l) => l.legId === real)!;
      const now = new Date().toISOString();
      let next: LegItem[];
      if (!tech) {
        next = patchLeg(items, real, leg.status === 'DONE'
          ? { staffId: null, pinned: false }
          : { staffId: null, pinned: false, legStatus: 'WAITING', startedAt: null });
      } else if (leg.status === 'WAITING') {
        next = patchLeg(items, real, start
          ? { staffId: tech, pinned: true, legStatus: 'SERVING', startedAt: now }
          : { staffId: tech, pinned: true });
      } else {
        next = patchLeg(items, real, { staffId: tech, pinned: true });
      }
      await this.writeItems({ ...t, tenantId: fresh.tenantId }, next);
      // She is on the customer now (started, or took over mid-service).
      const startsNow = leg.status === 'WAITING' && start;
      const takesOver = leg.status === 'SERVING' && tech !== leg.staffId;
      if (tech && (startsNow || takesOver)) this.notifyStart(fresh.tenantId, tech, fresh.customerName, leg.names);
    });
    await this.settle(w.tenantId);
    return this.row(w.tenantId, w.id);
  }

  /**
   * One leg is finished (hands done, feet still to do). Its technician is
   * free and gets the turn; the ticket stays open until every leg is done,
   * and the dispatcher immediately looks for someone for the next leg.
   */
  async doneLeg(user: AuthenticatedUser, id: string, legId: string) {
    const w = await this.mine(user, id);
    await this.assertService(w);
    await serial(w.tenantId, async () => {
      const fresh = await this.mine(user, id);
      const t = fresh as unknown as TicketLike;
      const { items, legId: real } = await this.legItems(fresh.tenantId, t, legId);
      if (!real) {
        await this.prisma.walkIn.updateMany({ where: { id: fresh.id, tenantId: fresh.tenantId }, data: { status: WalkInStatus.DONE, doneAt: new Date() } });
        return;
      }
      const leg = legsOf({ ...t, items }).find((l) => l.legId === real)!;
      if (leg.status === 'DONE') return;
      if (!leg.staffId) throw new BadRequestException('Chặng này chưa có thợ — chọn thợ trước.');
      const now = new Date().toISOString();
      await this.writeItems({ ...t, tenantId: fresh.tenantId }, patchLeg(items, real, { legStatus: 'DONE', doneAt: now, startedAt: leg.startedAt ?? now }));
    });
    await this.settle(w.tenantId);
    return this.row(w.tenantId, w.id);
  }

  /** One walk-in with its ticket (used by POS to prefill every service line). */
  async getOne(user: AuthenticatedUser, id: string) {
    return this.row(this.tenantId(user), id);
  }

  /** The staff member row for the signed-in user (null for a salon admin without one). */
  /**
   * THE TECHNICIAN'S OWN VISITS THAT ARE NOT BOOKINGS.
   *
   * Her app listed only appointments assigned to her and the client in her
   * chair right now. A walk-in she served, or a sale the till credited to her,
   * vanished from her phone the moment it ended — "khách walk-in / tính tiền ở
   * POS thì bên thợ không hiện dịch vụ". This lists, for a day range:
   *   · walk-in tickets she worked a part of (only HER lines and her money);
   *   · paid sales with a line credited to her that belong to no ticket of hers
   *     and no booking of hers (those already show as bookings).
   * Never another technician's lines, never the salon's totals, never another
   * salon's rows (every query is scoped by the signed-in tenant).
   */
  async myVisits(user: AuthenticatedUser, q: { from?: string; to?: string } = {}) {
    const tenantId = this.tenantId(user);
    const me = await this.staffOf(user);
    if (!me) return [];
    const start = q.from && !Number.isNaN(Date.parse(q.from)) ? new Date(q.from) : await this.startOfToday(tenantId);
    let end = q.to && !Number.isNaN(Date.parse(q.to)) ? new Date(q.to) : new Date(start.getTime() + 86400000);
    if (end.getTime() - start.getTime() > 42 * 86400000) end = new Date(start.getTime() + 42 * 86400000);
    if (end <= start) return [];

    type Line = { lineId?: string; serviceId?: string; name?: string; priceCents?: number; staffId?: string | null; legId?: string; kind?: string };
    type Ticket = { id: string; customerName: string | null; status: string; createdAt: Date; assignedAt: Date | null; doneAt: Date | null; awaitingPayment?: boolean; assignedStaffId: string | null; appointmentId?: string | null; items: unknown };
    type OItem = { kind: string; name: string; lineTotalCents: number; tipCents: number; quantity: number; staffMemberId: string | null; serviceId: string | null; walkInId: string | null; guestName: string | null };
    type ORow = { id: string; paidAt: Date | null; customerId: string | null; walkInId: string | null; walkInIds?: string[]; appointmentId: string | null; appointmentIds?: string[]; items: OItem[] };

    const tickets = (await this.prisma.walkIn.findMany({
      where: { tenantId, status: { not: WalkInStatus.CANCELLED }, createdAt: { gte: start, lt: end } },
      select: { id: true, customerName: true, status: true, createdAt: true, assignedAt: true, doneAt: true, awaitingPayment: true, assignedStaffId: true, appointmentId: true, items: true } as never,
      orderBy: { createdAt: 'asc' },
    }).catch(() => [])) as unknown as Ticket[];
    const linesOf = (t: Ticket): Line[] => (Array.isArray(t.items) ? (t.items as Line[]) : []);
    const myLinesOf = (t: Ticket): Line[] | null => {
      const all = linesOf(t);
      const legacy = all.length > 0 && all.every((it) => !it.legId);
      const mine = all.filter((it) => it.staffId === me || (legacy && !it.staffId && t.assignedStaffId === me));
      if (mine.length) return mine;
      return !all.length && t.assignedStaffId === me ? [] : null;
    };
    const myTickets = tickets.map((t) => ({ t, lines: myLinesOf(t) })).filter((x): x is { t: Ticket; lines: Line[] } => x.lines !== null);

    const orders = ((await this.db.order.findMany({
      where: { tenantId, status: 'PAID', paidAt: { gte: start, lt: end }, items: { some: { staffMemberId: me } } },
      select: {
        id: true, paidAt: true, customerId: true, walkInId: true, walkInIds: true, appointmentId: true, appointmentIds: true,
        items: { select: { kind: true, name: true, lineTotalCents: true, tipCents: true, quantity: true, staffMemberId: true, serviceId: true, walkInId: true, guestName: true } },
      },
      orderBy: { paidAt: 'asc' },
    }).catch(() => [])) ?? []) as ORow[];
    // Which of her tickets were paid, and her tips on them (orders of ANY day: a ticket can be settled after midnight).
    const ticketIds = myTickets.map((x) => x.t.id);
    const ticketOrders = ticketIds.length ? (((await this.db.order.findMany({
      where: { tenantId, status: 'PAID', OR: [{ walkInId: { in: ticketIds } }, { walkInIds: { hasSome: ticketIds } }] },
      select: { id: true, walkInId: true, walkInIds: true, items: { select: { tipCents: true, staffMemberId: true, walkInId: true } } },
    }).catch(() => [])) ?? []) as { id: string; walkInId: string | null; walkInIds?: string[]; items: { tipCents: number; staffMemberId: string | null; walkInId: string | null }[] }[]) : [];
    const paidTicket = new Set<string>();
    const tipsByTicket = new Map<string, number>();
    for (const o of ticketOrders) {
      const ids = [o.walkInId, ...(o.walkInIds ?? [])].filter((x): x is string => !!x);
      for (const id of ids) paidTicket.add(id);
      for (const it of o.items ?? []) {
        if (it.staffMemberId !== me) continue;
        const wid = it.walkInId ?? (ids.length === 1 ? ids[0] : null);
        if (wid) tipsByTicket.set(wid, (tipsByTicket.get(wid) ?? 0) + (it.tipCents || 0));
      }
    }
    // Bookings that are hers already show in her calendar: never twice.
    const apptIds = [...new Set([
      ...myTickets.map((x) => x.t.appointmentId).filter((x): x is string => !!x),
      ...orders.flatMap((o) => [o.appointmentId, ...(o.appointmentIds ?? [])]).filter((x): x is string => !!x),
    ])];
    const hersBooked = new Set(apptIds.length
      ? (await this.prisma.appointment.findMany({ where: { tenantId, id: { in: apptIds }, assignedStaffId: me }, select: { id: true } }).catch(() => [])).map((a) => a.id)
      : []);

    const out: { id: string; kind: 'walkin' | 'sale'; at: string; customer: string | null; services: string[]; cents: number; tipsCents: number; status: 'waiting' | 'serving' | 'to_pay' | 'paid' }[] = [];
    const shownTickets = new Set<string>();
    for (const { t, lines } of myTickets) {
      if (t.appointmentId && hersBooked.has(t.appointmentId)) continue;
      shownTickets.add(t.id);
      const paid = paidTicket.has(t.id);
      out.push({
        id: `w:${t.id}`, kind: 'walkin', at: (t.assignedAt ?? t.createdAt).toISOString(), customer: t.customerName,
        services: lines.map((it) => (it.kind === 'addon' ? `+ ${it.name ?? ''}` : String(it.name ?? ''))).filter((n) => n.trim()),
        cents: lines.reduce((s, it) => s + Math.max(0, Math.round(Number(it.priceCents) || 0)), 0),
        tipsCents: tipsByTicket.get(t.id) ?? 0,
        status: paid ? 'paid' : t.status === 'WAITING' ? 'waiting' : t.status === 'SERVING' && !t.awaitingPayment ? 'serving' : 'to_pay',
      });
    }
    const custIds = [...new Set(orders.map((o) => o.customerId).filter((x): x is string => !!x))];
    const names = new Map((custIds.length
      ? await this.prisma.customer.findMany({ where: { tenantId, id: { in: custIds } }, select: { id: true, firstName: true, lastName: true } }).catch(() => [])
      : []).map((c) => [c.id, `${c.firstName ?? ''}${c.lastName ? ' ' + c.lastName : ''}`.trim()] as const));
    for (const o of orders) {
      const wids = [o.walkInId, ...(o.walkInIds ?? [])].filter((x): x is string => !!x);
      if (wids.some((w) => shownTickets.has(w))) continue;
      if ([o.appointmentId, ...(o.appointmentIds ?? [])].some((a) => !!a && hersBooked.has(a))) continue;
      const mine = (o.items ?? []).filter((it) => it.staffMemberId === me && it.kind === 'SERVICE');
      if (!mine.length) continue;
      out.push({
        id: `o:${o.id}`, kind: 'sale', at: (o.paidAt ?? new Date()).toISOString(),
        customer: (o.customerId ? names.get(o.customerId) : null) || mine.find((it) => it.guestName)?.guestName || null,
        services: mine.map((it) => `${it.serviceId ? '' : '+ '}${it.name}${it.quantity > 1 ? ` ×${it.quantity}` : ''}`),
        cents: mine.reduce((s, it) => s + (it.lineTotalCents || 0), 0),
        tipsCents: (o.items ?? []).filter((it) => it.staffMemberId === me).reduce((s, it) => s + (it.tipCents || 0), 0),
        status: 'paid',
      });
    }
    const currency = (await Promise.resolve().then(() => this.settings.getBookingRules(tenantId)).catch(() => null))?.currency ?? 'USD';
    return out.sort((a, b) => a.at.localeCompare(b.at)).map((v) => ({ ...v, currency }));
  }

  private async staffOf(user: AuthenticatedUser): Promise<string | null> {
    const tenantId = this.tenantId(user);
    const staff = await this.prisma.staffMember.findFirst({ where: { tenantId, userId: user.userId }, select: { id: true } });
    return staff?.id ?? null;
  }

  /**
   * A technician (without the front desk's walk-in screen) acts only on a
   * ticket she works on, and removes only her own lines. Owners and desk staff
   * are not limited here — they run the whole floor.
   */
  private async assertMyTicket(user: AuthenticatedUser, w: { assignedStaffId?: string | null; items?: unknown }, lineId?: string) {
    if (user.role !== UserRole.STAFF) return;
    if (hasCapability(user.role, user.staffRole ?? null, 'walkins', user.staffCaps ?? undefined)) return;
    const me = await this.staffOf(user);
    const items = legItemsOf(w as unknown as TicketLike) as unknown as { lineId?: string; staffId?: string | null }[];
    const onTicket = !!me && (w.assignedStaffId === me || items.some((it) => it.staffId === me));
    if (!onTicket) throw new ForbiddenException('Đây không phải khách của bạn.');
    if (lineId) {
      const line = items.find((it) => it.lineId === lineId);
      if (line && line.staffId && line.staffId !== me) throw new ForbiddenException('Bạn chỉ xoá được dịch vụ do mình làm.');
    }
  }

  async removeServiceAsMe(user: AuthenticatedUser, id: string, lineId: string) {
    await this.assertMyTicket(user, await this.mine(user, id), lineId);
    return this.removeService(user, id, lineId);
  }

  async moveToStationAsMe(user: AuthenticatedUser, id: string, stationId?: string) {
    await this.assertMyTicket(user, await this.mine(user, id));
    return this.moveToStation(user, id, stationId);
  }

  async reactivateAsMe(user: AuthenticatedUser, id: string) {
    await this.assertMyTicket(user, await this.mine(user, id));
    return this.reactivate(user, id);
  }

  /** Add a service line and ALWAYS credit it to the signed-in technician — a tech
   *  can never (accidentally or otherwise) put their work on someone else's turn count. */
  async addServiceAsMe(user: AuthenticatedUser, id: string, serviceId: string) {
    const mine = await this.staffOf(user);
    return this.addService(user, id, serviceId, mine ?? undefined);
  }

  /** The salon's price list, trimmed to what the staff app needs. */
  async servicesForChair(user: AuthenticatedUser) {
    return this.prisma.service.findMany({
      where: { tenantId: this.tenantId(user), isActive: true },
      select: { id: true, name: true, priceCents: true, durationMinutes: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /** Every chair in the salon + who is sitting in it right now (for the tech's chair picker). */
  async chairsForChair(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const [stations, serving] = await Promise.all([
      this.prisma.station.findMany({
        where: { tenantId, isActive: true },
        select: { id: true, name: true, sortOrder: true, stationType: { select: { name: true } } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.walkIn.findMany({
        where: { tenantId, status: WalkInStatus.SERVING, awaitingPayment: false, stationId: { not: null } },
        select: { stationId: true, customerName: true },
      }),
    ]);
    const busy = new Map(serving.map((w) => [w.stationId as string, w.customerName]));
    return stations.map((st) => ({
      id: st.id,
      name: st.name,
      type: st.stationType?.name ?? '',
      takenBy: busy.get(st.id) ?? null,
    }));
  }

  /** The signed-in tech's own in-service clients (their chair) — for the staff app. */
  async myChair(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const staff = await this.prisma.staffMember.findFirst({ where: { tenantId, userId: user.userId }, select: { id: true } });
    const currency = (await this.settings.getBookingRules(tenantId).catch(() => null))?.currency ?? 'USD';
    if (!staff) return { staffId: null, currency, serving: [] as unknown[], salon: [] as unknown[] };
    const allServing = await this.prisma.walkIn.findMany({ where: { tenantId, status: WalkInStatus.SERVING }, include: INCLUDE, orderBy: { assignedAt: 'asc' } });
    // "Mine" = I am working on a leg of it right now. A ticket from before legs
    // keeps the old rule: I am its tech, or I have a service line on it.
    const isMine = (w: (typeof allServing)[number]) => {
      const t = w as unknown as TicketLike;
      if (legItemsOf(t).some((it) => it.legId)) return legsOf(t).some((l) => l.status === 'SERVING' && l.staffId === staff.id);
      return w.assignedStaffId === staff.id || this.lineTechs(w).includes(staff.id);
    };
    const serving = allServing.filter(isMine).map((w) => this.view(w));
    // Names of everyone working on my customers, so the chair can say
    // "Chân — Lisa đang làm" next to my own part.
    const ids = [...new Set(serving.flatMap((w) => w.legs.map((l) => l.staffId)).filter((x): x is string => !!x))];
    const team = ids.length
      ? await this.prisma.staffMember.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const techNames: Record<string, string> = {};
    for (const s of team) techNames[s.id] = `${s.firstName}${s.lastName ? ' ' + s.lastName : ''}`;
    // Everyone else currently in the salon (for the "a client moved to my chair" picker).
    const mineIds = new Set(serving.map((w) => w.id));
    const salon = allServing
      .filter((w) => !mineIds.has(w.id))
      .map((w) => ({ id: w.id, customerName: w.customerName, station: (w as { station?: string | null }).station ?? null }));
    return { staffId: staff.id, currency, serving, salon, techNames };
  }

  /**
   * The technician's day at a glance, for her phone: her turns and her place
   * in the rotation, who else is free or busy, how many customers are waiting,
   * and her OWN money today and this week — her service lines and her tips,
   * never the salon's totals or another technician's.
   */
  async myDay(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const me = await this.staffOf(user);
    const currency = (await this.settings.getBookingRules(tenantId).catch(() => null))?.currency ?? 'USD';
    const blank = { serviceCents: 0, services: 0, tipsCents: 0, directTipsCents: 0 };
    if (!me) {
      return { staffId: null, currency, turns: 0, busy: false, freeRank: null, nextUpStaffId: null, queue: 0, techs: [], today: blank, week: [], todayIndex: 0 };
    }
    const f = await this.floor(tenantId);
    const open = f.open as unknown as TicketLike[];
    const busy = busyTechs(open);
    const now = new Date();
    const turnsOf = (id: string) => f.turns.get(id) ?? 0;
    // The rotation as the dispatcher reads it: fewest turns, then priority, then
    // the salon's own list order (a stable sort keeps it).
    const scoreOf = (id: string) => (f.rules.mode === 'MONEY' ? (f.money.get(id) ?? 0) : turnsOf(id));
    const sorted = [...f.techs].sort((a, b) => (scoreOf(a.id) - scoreOf(b.id)) || tieCompare(a, b, f.rules, f.pick.facts));
    const freeOrder = sorted.filter((t) => !busy.has(t.id) && !f.onBreak.has(t.id) && !f.manualOnly.has(t.id));
    const nextUpStaffId = pickTech(freeOrder, [], f.turns, f.pick)?.id ?? null;
    const techs = sorted.map((t, i) => ({
      id: t.id, name: t.name, rank: i + 1, turns: turnsOf(t.id),
      busy: busy.has(t.id), busyFor: busy.has(t.id) ? minutesLeft(open, t.id, now) : null, onBreak: f.onBreak.has(t.id),
      inRotation: !f.manualOnly.has(t.id),
      me: t.id === me, nextUp: t.id === nextUpStaffId,
    }));
    const queue = open.filter((t) => { const p = phaseOf(t); return p === 'WAITING' || p === 'BETWEEN'; }).length;

    // ---- her money: this week, Monday to today, in the salon's calendar ----
    const tz = (await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }))?.timezone || 'UTC';
    let todayIndex = 0;
    try {
      const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
      todayIndex = Math.max(0, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(wd));
    } catch { /* unknown zone: the week starts today */ }
    const weekStart = new Date(f.today.getTime() - todayIndex * 86400000);
    const week = Array.from({ length: 7 }, (_, day) => ({ day, serviceCents: 0, services: 0, tipsCents: 0, directTipsCents: 0 }));
    const slot = (d: Date | string | null | undefined) => {
      if (!d) return null;
      const i = Math.floor((new Date(d).getTime() - weekStart.getTime()) / 86400000);
      return i >= 0 && i < 7 ? week[i] : null;
    };
    type OrderRow = { paidAt: Date | null; appointmentId: string | null; appointmentIds?: string[]; discountCents?: number | null; items: { kind: string; lineTotalCents: number; tipCents: number; quantity: number; staffMemberId: string | null }[] };
    const orders: OrderRow[] = await this.db.order.findMany({
      where: { tenantId, status: 'PAID', paidAt: { gte: weekStart }, items: { some: { staffMemberId: me } } },
      select: {
        paidAt: true, appointmentId: true, appointmentIds: true, discountCents: true,
        items: { select: { kind: true, lineTotalCents: true, tipCents: true, quantity: true, staffMemberId: true } },
      },
    }).catch(() => []);
    const paidAppts = new Set<string>();
    for (const o of orders ?? []) {
      for (const a of [o.appointmentId, ...(o.appointmentIds ?? [])]) if (a) paidAppts.add(a);
      const w = slot(o.paidAt);
      if (!w) continue;
      // The ticket's discount is shared over its lines exactly as the payslip does (payroll/sales-ledger.ts).
      const items = o.items ?? [];
      const disc = allocate(o.discountCents ?? 0, items.map((l) => l.lineTotalCents));
      for (const [i, l] of items.entries()) {
        if (l.staffMemberId !== me) continue;
        if (l.kind === 'SERVICE') { w.serviceCents += Math.max(0, l.lineTotalCents - (disc[i] ?? 0)); w.services += l.quantity || 1; }
        w.tipsCents += l.tipCents || 0;
      }
    }
    // A booking closed without the till still counts (same rule as the POS report).
    const done: { id: string; priceCents: number; completedAt: Date | null }[] = await this.db.appointment.findMany({
      where: { tenantId, assignedStaffId: me, status: AppointmentStatus.COMPLETED, completedAt: { gte: weekStart } },
      select: { id: true, priceCents: true, completedAt: true },
    }).catch(() => []);
    for (const a of done ?? []) {
      if (paidAppts.has(a.id)) continue;
      const w = slot(a.completedAt);
      if (w) { w.serviceCents += a.priceCents || 0; w.services += 1; }
    }
    // Tips paid straight to her (QR, cash in hand): hers, logged for visibility.
    const direct: { amountCents: number; createdAt: Date }[] = await this.db.tipLog.findMany({
      where: { tenantId, staffMemberId: me, createdAt: { gte: weekStart } },
      select: { amountCents: true, createdAt: true },
    }).catch(() => []);
    for (const t of direct ?? []) { const w = slot(t.createdAt); if (w) w.directTipsCents += t.amountCents || 0; }

    const today = week[todayIndex];
    return {
      staffId: me, currency, turns: turnsOf(me), busy: busy.has(me), onBreak: f.onBreak.has(me),
      // Her place among the technicians who are free right now (null while busy).
      freeRank: busy.has(me) ? null : freeOrder.findIndex((t) => t.id === me) + 1,
      nextUpStaffId, queue, techs,
      today: { serviceCents: today.serviceCents, services: today.services, tipsCents: today.tipsCents, directTipsCents: today.directTipsCents },
      week, todayIndex,
    };
  }

  /**
   * "Khách đã đến — bắt đầu làm" on the technician's own booking. Same as the
   * desk checking the customer in (the booking becomes a floor ticket and her
   * part starts), but only for a booking that is hers. Pressing it twice, or
   * after the desk already checked the customer in, returns the same ticket.
   */
  async startMyAppointment(user: AuthenticatedUser, appointmentId: string) {
    const tenantId = this.tenantId(user);
    const me = await this.staffOf(user);
    if (!me) throw new ForbiddenException('Tài khoản này không phải thợ của tiệm.');
    const appt = await this.prisma.appointment.findFirst({ where: { id: appointmentId, tenantId }, select: { id: true, assignedStaffId: true, status: true } });
    if (!appt) throw new NotFoundException('Appointment not found');
    if (appt.assignedStaffId !== me) throw new ForbiddenException('Lịch này không phải của bạn.');
    const closed: string[] = [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW, AppointmentStatus.COMPLETED, AppointmentStatus.REJECTED];
    if (closed.includes(appt.status)) throw new BadRequestException('Lịch này đã đóng.');
    const existing = await this.prisma.walkIn.findFirst({
      where: { tenantId, appointmentId: appt.id, status: { in: [WalkInStatus.WAITING, WalkInStatus.SERVING] } },
      select: { id: true },
    });
    if (existing) return this.row(tenantId, existing.id);
    return this.seatAppointment(user, appt.id);
  }

  /**
   * "Giao" on a waiting ticket: the desk hands the customer to this
   * technician now. Her leg is the first one that can start (the leg already
   * reserved for her, else the first in order); the ticket's other legs stay
   * with the dispatcher.
   */
  async assign(user: AuthenticatedUser, id: string, staffId: string, reason?: unknown) {
    const w = await this.mine(user, id);
    const tech = await this.techOf(w.tenantId, staffId);
    const t = w as unknown as TicketLike;
    // Walk-in 2.0: seating a waiting customer with someone other than the
    // technician the rules suggest is allowed — and remembered (suggestion,
    // choice, reason). With the salon's "overrideReason" rule the reason is required.
    if (w.status === WalkInStatus.WAITING) {
      const policy = await this.deskPolicy(w.tenantId);
      const f = await this.floor(w.tenantId);
      const busy = busyTechs(f.open as unknown as TicketLike[]);
      const protect = policy.protectBooking ? { bookingAt: await this.bookingAt(w.tenantId), bookingBufferMin: policy.bookingBufferMin, now: Date.now() } : {};
      const suggested = suggestFor(t, f.techs.filter((x) => !busy.has(x.id) && !f.onBreak.has(x.id)), f.techs, f.turns, { restricted: f.restricted, ...f.pick, ...protect });
      if (suggested && suggested !== tech) {
        const why = cleanOverrideReason(reason);
        if (policy.overrideReason && !why) throw new BadRequestException(OVERRIDE_REASON_ERROR);
        await this.audit?.log({ tenantId: w.tenantId, userId: user.userId, action: 'turn.override', resourceType: 'walk_in', resourceId: w.id, metadata: { suggested, chosen: tech, reason: why } });
      }
    }
    const legs = legsOf(t);
    const running = legs.filter((l) => l.status === 'SERVING').map((l) => l.zone);
    const startable = legs.filter((l) => l.status === 'WAITING' && running.every((z) => canRunTogether(z, l.zone)));
    const leg = startable.find((l) => l.staffId === tech) ?? startable.find((l) => !l.pinned) ?? startable[0] ?? legs.find((l) => l.status === 'WAITING');
    if (!leg) {
      // Nothing left waiting on it: hand over the leg in progress (or the ticket).
      const live = legs.find((l) => l.status === 'SERVING');
      return this.assignLeg(user, id, live?.legId ?? TICKET_LEG, tech, true);
    }
    return this.assignLeg(user, id, leg.legId, tech, true);
  }

  /** Mark the whole visit finished (every leg), then fill the chairs it freed. */
  async done(user: AuthenticatedUser, id: string, force = false) {
    const w = await this.mine(user, id);
    // "Đóng không thu" (force) closes a visit whatever it carries; everything else follows the salon's rule.
    if (!force) await this.assertService(w);
    await serial(w.tenantId, async () => {
      const fresh = await this.mine(user, id);
      const t = fresh as unknown as TicketLike;
      const items = legItemsOf(t);
      if (!items.some((it) => it.legId)) {
        await this.prisma.walkIn.updateMany({ where: { id: fresh.id, tenantId: fresh.tenantId }, data: { status: WalkInStatus.DONE, doneAt: new Date() } });
        return;
      }
      const now = new Date().toISOString();
      let next = items;
      for (const leg of legsOf(t)) {
        if (leg.status === 'DONE') continue;
        next = patchLeg(next, leg.legId, { legStatus: 'DONE', doneAt: now, startedAt: leg.startedAt ?? now });
      }
      await this.writeItems({ ...t, tenantId: fresh.tenantId }, next);
    });
    // After the save, and swallowing its own failure: finishing a customer must
    // succeed even if the queue cannot be drained this second.
    await this.settle(w.tenantId);
    return this.row(w.tenantId, w.id);
  }

  // ---------------------------------------------------------------- Walk-in 2.0, step 3

  /** Each waiting customer's wait, as a range (wait-estimate.ts), from this floor. */
  private queueEtas(f: Awaited<ReturnType<WalkinsService['floor']>>, busy: Set<string>, now: Date): Map<string, { min: number; max: number } | null> {
    const open = f.open as unknown as TicketLike[];
    const techFreeIn = f.techs
      .filter((t) => !f.onBreak.has(t.id) && !f.manualOnly.has(t.id))
      .map((t) => (busy.has(t.id) ? (minutesLeft(open, t.id, now) ?? 15) : 0));
    const queue = (f.open as unknown as TicketLike[]).filter((w) => w.status === WalkInStatus.WAITING);
    const minutes = queue.map((w) => {
      const legs = legsOf(w).filter((l) => l.status === 'WAITING');
      return legs.length ? Math.max(...legs.map((l) => l.minutes || 30)) : 30;
    });
    const est = queueEstimates(techFreeIn, minutes);
    return new Map(queue.map((w, i) => [w.id, est[i]]));
  }

  /** "About how long?" for one waiting customer (the self check-in thank-you screen). */
  async etaFor(tenantId: string, id: string): Promise<{ min: number; max: number } | null> {
    const f = await this.floor(tenantId);
    return this.queueEtas(f, busyTechs(f.open as unknown as TicketLike[]), new Date()).get(id) ?? null;
  }

  private async calledMap(tenantId: string): Promise<Record<string, { at: string; by?: string | null }>> {
    try {
      const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: CALLED_KEY } } });
      return ((row?.value && typeof row.value === 'object') ? row.value : {}) as Record<string, { at: string; by?: string | null }>;
    } catch { return {}; }
  }

  private async saveSetting(tenantId: string, key: string, value: unknown) {
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key } },
      update: { value: value as never }, create: { tenantId, key, value: value as never },
    });
  }

  /** The salon's name and language for a text. */
  private async smsVoice(tenantId: string): Promise<{ salon: string; vi: boolean }> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, market: true, timezone: true } as never }).catch(() => null) as { name?: string; market?: string | null; timezone?: string | null } | null;
    const vi = String(t?.market ?? '').toUpperCase() === 'VN' || String(t?.timezone ?? '').startsWith('Asia/Ho_Chi_Minh');
    return { salon: (t?.name ?? '').trim() || 'Salon', vi };
  }

  /** One transactional text about this visit. Best effort: a failed text never fails the desk. */
  private async textCustomer(tenantId: string, phone: string | null, body: string, walkInId: string): Promise<boolean> {
    if (!phone || !this.notifications) return false;
    try {
      const r = await this.notifications.send({ tenantId, channel: 'SMS' as never, recipient: phone, body, relatedType: 'walk_in', relatedId: walkInId }) as unknown as { status?: string } | null;
      return !r || r.status !== 'FAILED';
    } catch { return false; }
  }

  /** "Gọi khách": the desk calls a waiting customer (a text when there is a phone), and the board shows since when. */
  async callCustomer(user: AuthenticatedUser, id: string) {
    const w = await this.mine(user, id);
    if (w.status !== WalkInStatus.WAITING) throw new BadRequestException('Khách không còn trong hàng chờ · Not waiting any more');
    const at = new Date().toISOString();
    const waitingIds = (await this.prisma.walkIn.findMany({ where: { tenantId: w.tenantId, status: WalkInStatus.WAITING }, select: { id: true } })).map((r) => r.id);
    const called = pruneCalled(await this.calledMap(w.tenantId), waitingIds);
    called[w.id] = { at, by: user.userId };
    await this.saveSetting(w.tenantId, CALLED_KEY, called);
    const v = await this.smsVoice(w.tenantId);
    const sms = await this.textCustomer(w.tenantId, w.phone, yourTurnSms(v.salon, v.vi), w.id);
    await this.audit?.log({ tenantId: w.tenantId, userId: user.userId, action: 'walkin.called', resourceType: 'walk_in', resourceId: w.id, metadata: { sms } });
    return { id: w.id, calledAt: at, sms };
  }

  /** "Vắng mặt": the called customer is not here — the ticket leaves the queue, kept as a no-show. */
  async noShow(user: AuthenticatedUser, id: string) {
    const w = await this.mine(user, id);
    if (w.status !== WalkInStatus.WAITING) throw new BadRequestException('Khách không còn trong hàng chờ · Not waiting any more');
    await this.prisma.walkIn.updateMany({ where: { id: w.id, tenantId: w.tenantId, status: WalkInStatus.WAITING }, data: { status: WalkInStatus.CANCELLED } });
    await this.audit?.log({ tenantId: w.tenantId, userId: user.userId, action: 'walkin.no_show', resourceType: 'walk_in', resourceId: w.id, metadata: { auto: false } });
    return this.row(w.tenantId, w.id);
  }

  /** "Sắp tới lượt": one text to each customer with N or fewer people ahead (rule off unless notifyAhead > 0). */
  async notifyUpcoming(tenantId: string): Promise<number> {
    const policy = await this.deskPolicy(tenantId);
    if (!(policy.notifyAhead > 0) || !this.notifications) return 0;
    const queue = await this.prisma.walkIn.findMany({
      where: { tenantId, status: WalkInStatus.WAITING }, select: { id: true, phone: true }, orderBy: { createdAt: 'asc' }, take: 50,
    });
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: NOTIFIED_KEY } } }).catch(() => null);
    const notified = (((row?.value as { ids?: unknown } | null)?.ids ?? []) as string[]).filter((x) => typeof x === 'string');
    const ids = upcomingToNotify(queue, policy.notifyAhead, notified);
    if (!ids.length) return 0;
    await this.saveSetting(tenantId, NOTIFIED_KEY, { ids: rememberWarned(notified, ids) });
    const v = await this.smsVoice(tenantId);
    for (const id of ids) await this.textCustomer(tenantId, queue.find((q) => q.id === id)?.phone ?? null, turnSoonSms(v.salon, v.vi), id);
    return ids.length;
  }

  /** Called and still not here after the salon's minutes: a no-show (rule off unless noShowMin > 0). */
  async autoNoShow(tenantId: string, now = new Date()): Promise<number> {
    const policy = await this.deskPolicy(tenantId);
    if (!(policy.noShowMin > 0)) return 0;
    const waitingIds = (await this.prisma.walkIn.findMany({ where: { tenantId, status: WalkInStatus.WAITING }, select: { id: true } })).map((r) => r.id);
    const gone = calledTooLong(await this.calledMap(tenantId), waitingIds, now, policy.noShowMin);
    for (const id of gone) {
      await this.prisma.walkIn.updateMany({ where: { id, tenantId, status: WalkInStatus.WAITING }, data: { status: WalkInStatus.CANCELLED } });
      await this.audit?.log({ tenantId, action: 'walkin.no_show', resourceType: 'walk_in', resourceId: id, metadata: { auto: true, minutes: policy.noShowMin } });
    }
    return gone.length;
  }

  /** Every salon with someone waiting; one salon's error never stops the next. */
  async autoNoShowEverywhere(now = new Date()): Promise<number> {
    const rows = await this.prisma.walkIn.findMany({ where: { status: WalkInStatus.WAITING }, select: { tenantId: true }, distinct: ['tenantId'] });
    let n = 0;
    for (const r of rows) { try { n += await this.autoNoShow(r.tenantId, now); } catch { /* next salon */ } }
    return n;
  }

  /** ĐỐI SOÁT CUỐI NGÀY (day-review.ts): one salon, one salon day. */
  async dayReview(user: AuthenticatedUser, day?: string) {
    const tenantId = this.tenantId(user);
    const key = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : await this.todayKey(tenantId);
    const tz = (await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }))?.timezone || 'UTC';
    let fmt: Intl.DateTimeFormat;
    try { fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }); }
    catch { fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }); }
    const lo = new Date(Date.parse(`${key}T00:00:00Z`) - 86400000);
    const hi = new Date(Date.parse(`${key}T00:00:00Z`) + 2 * 86400000);
    const inDay = (d: Date | string | null | undefined) => !!d && fmt.format(new Date(d)) === key;
    const rows = (await this.prisma.walkIn.findMany({
      where: { tenantId, createdAt: { gte: lo, lt: hi } },
      select: { id: true, status: true, customerName: true, awaitingPayment: true, createdAt: true, assignedAt: true, doneAt: true, assignedStaffId: true, serviceId: true, items: true },
      orderBy: { createdAt: 'asc' }, take: 1000,
    })).filter((r) => inDay(r.createdAt)) as unknown as ReviewTicket[];
    const ids = rows.map((r) => r.id);
    const orders = ids.length ? await this.prisma.order.findMany({
      where: { tenantId, OR: [{ walkInId: { in: ids } }, { walkInIds: { hasSome: ids } }, { items: { some: { walkInId: { in: ids } } } }] } as never,
      select: { walkInId: true, walkInIds: true, items: { select: { walkInId: true } } } as never,
    }).catch(() => []) as unknown as { walkInId: string | null; walkInIds?: string[]; items?: { walkInId: string | null }[] }[] : [];
    const audits = ((this.db.auditLog?.findMany({
      where: { tenantId, action: { in: ['walkin.closed_unpaid', 'turn.override', 'walkin.no_show'] }, createdAt: { gte: lo, lt: hi } },
      select: { action: true, resourceId: true, metadata: true, createdAt: true, userId: true }, orderBy: { createdAt: 'asc' }, take: 2000,
    }).catch(() => [])) ?? Promise.resolve([])) as Promise<{ action: string; resourceId: string | null; metadata: unknown; createdAt: Date; userId: string | null }[]>;
    const logs = (await audits).filter((a) => inDay(a.createdAt));
    const meta = (a: { metadata: unknown }) => ((a.metadata && typeof a.metadata === 'object') ? a.metadata : {}) as Record<string, unknown>;
    const closedUnpaid: ClosedUnpaid[] = logs.filter((a) => a.action === 'walkin.closed_unpaid' && a.resourceId && ids.includes(a.resourceId)).map((a) => ({
      walkInId: a.resourceId!, reason: (meta(a).reason as string) ?? null, note: (meta(a).note as string) ?? null, at: a.createdAt, userId: a.userId,
    }));
    const overrides: Override[] = logs.filter((a) => a.action === 'turn.override').map((a) => ({
      walkInId: a.resourceId ?? '', suggested: (meta(a).suggested as string) ?? null, chosen: (meta(a).chosen as string) ?? null, reason: (meta(a).reason as string) ?? null, at: a.createdAt, userId: a.userId,
    }));
    const noShowIds = new Set(logs.filter((a) => a.action === 'walkin.no_show' && a.resourceId).map((a) => a.resourceId!));
    const review = dayReview({ tickets: rows, settledIds: settledWalkIns(orders), closedUnpaid, overrides, noShowIds });
    const report = await this.turnReport(user, key, key);
    const staff = await this.prisma.staffMember.findMany({ where: { tenantId }, select: { id: true, firstName: true, lastName: true } });
    const userIds = [...new Set([...closedUnpaid, ...overrides].map((x) => x.userId).filter((x): x is string => !!x))];
    // Ids come from this salon's own audit rows (a support session's user has no tenant).
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, email: true } }).catch(() => []) : [];
    const closedRow = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: 'walkin_day_closed' } } }).catch(() => null);
    const closed = ((closedRow?.value ?? {}) as Record<string, { at: string; by: string | null; note: string | null }>)[key] ?? null;
    const overrideCount = new Map<string, number>();
    for (const o of overrides) if (o.chosen) overrideCount.set(o.chosen, (overrideCount.get(o.chosen) ?? 0) + 1);
    return {
      day: key, timezone: tz, closed,
      ...review,
      staff: staff.map((s) => ({ id: s.id, name: `${s.firstName}${s.lastName ? ' ' + s.lastName : ''}`.trim() })),
      users: users.map((u) => ({ id: u.id, name: ([u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || '').trim() })),
      techs: report.techs.map((t) => ({ ...t, overrides: overrideCount.get(t.staffId) ?? 0 })),
    };
  }

  /** "Chốt ngày": the owner signs the day off (with an optional note), audited. Re-closing overwrites the note. */
  async closeDay(user: AuthenticatedUser, day: string, note?: string) {
    const tenantId = this.tenantId(user);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) throw new BadRequestException('day must be YYYY-MM-DD');
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: 'walkin_day_closed' } } }).catch(() => null);
    const all = { ...((row?.value ?? {}) as Record<string, unknown>) };
    const entry = { at: new Date().toISOString(), by: user.userId, note: String(note ?? '').slice(0, 300) || null };
    all[day] = entry;
    // Keep the last 120 days.
    const keys = Object.keys(all).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 120))) delete all[k];
    await this.saveSetting(tenantId, 'walkin_day_closed', all);
    await this.audit?.log({ tenantId, userId: user.userId, action: 'walkin.day_closed', resourceType: 'tenant', resourceId: tenantId, metadata: { day, note: entry.note } });
    return { day, closed: entry };
  }

  // ---------------------------------------------------------------- desk policy (Walk-in 2.0, step 2)

  /** The salon's optional desk rules; all off unless the owner turned them on. */
  async deskPolicy(tenantId: string): Promise<DeskPolicy> {
    try {
      const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: DESK_POLICY_KEY } } });
      return cleanDeskPolicy(row?.value ?? null);
    } catch { return cleanDeskPolicy(null); }
  }

  async getDeskPolicy(user: AuthenticatedUser): Promise<DeskPolicy> {
    return this.deskPolicy(this.tenantId(user));
  }

  async setDeskPolicy(user: AuthenticatedUser, body: unknown): Promise<DeskPolicy> {
    const tenantId = this.tenantId(user);
    const next = cleanDeskPolicy({ ...(await this.deskPolicy(tenantId)), ...((body && typeof body === 'object') ? body as object : {}) });
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: DESK_POLICY_KEY } },
      update: { value: next as never }, create: { tenantId, key: DESK_POLICY_KEY, value: next as never },
    });
    await this.audit?.log({ tenantId, userId: user.userId, action: 'settings.desk_policy_updated', resourceType: 'tenant', resourceId: tenantId, metadata: { ...next } });
    return next;
  }

  /** "Phải có dịch vụ": refuse to finish / send to the till a visit with no service, when the salon asks for it. */
  private async assertService(w: { tenantId: string; items: unknown; serviceId?: string | null }): Promise<void> {
    if (hasService(w.items) || w.serviceId) return;
    const policy = await this.deskPolicy(w.tenantId);
    if (policy.requireService) throw new BadRequestException(NO_SERVICE_ERROR);
  }

  /** Each technician's next booking today that has not started (epoch ms) — this salon's only. */
  private async bookingAt(tenantId: string): Promise<Map<string, number>> {
    const now = new Date();
    const today = await this.startOfToday(tenantId);
    const rows = await this.prisma.appointment.findMany({
      where: { tenantId, startTime: { gte: now, lt: new Date(today.getTime() + 86_400_000) }, assignedStaffId: { not: null },
        status: { in: [AppointmentStatus.PENDING, AppointmentStatus.ASSIGNED, AppointmentStatus.ACCEPTED, AppointmentStatus.CONFIRMED] } },
      select: { assignedStaffId: true, startTime: true }, orderBy: { startTime: 'asc' }, take: 200,
    }).catch(() => [] as { assignedStaffId: string | null; startTime: Date }[]);
    const out = new Map<string, number>();
    for (const r of rows) if (r.assignedStaffId && !out.has(r.assignedStaffId)) out.set(r.assignedStaffId, new Date(r.startTime).getTime());
    return out;
  }

  /** "Báo quầy khi chờ tính tiền quá lâu": one push per visit, to the people running the floor. */
  async nudgeUnpaid(tenantId: string, now = new Date()): Promise<number> {
    if (!this.push) return 0;
    const policy = await this.deskPolicy(tenantId);
    if (!policy.payNudge) return 0;
    const open = await this.prisma.walkIn.findMany({
      where: { tenantId, status: WalkInStatus.SERVING, awaitingPayment: true },
      select: { id: true, status: true, createdAt: true, assignedAt: true, doneAt: true, awaitingPayment: true, items: true, customerName: true, assignedStaffId: true },
    });
    if (!open.length) return 0;
    const row = await this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: PAY_WARNED_KEY } } }).catch(() => null);
    const warned = ((row?.value as { ids?: unknown } | null)?.ids ?? []) as string[];
    const late = newlyUnpaidTooLong(open as unknown as PayTicket[], now, policy.payNudgeMin, Array.isArray(warned) ? warned : []);
    const msg = payNudgeAlert(late);
    if (!msg) return 0;
    const ids = rememberWarned(warned, late.map((x) => x.id));
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: PAY_WARNED_KEY } },
      update: { value: { ids } as never }, create: { tenantId, key: PAY_WARNED_KEY, value: { ids } as never },
    });
    const [admins, staff] = await Promise.all([
      this.prisma.user.findMany({ where: { tenantId, role: UserRole.SALON_ADMIN, isActive: true }, select: { id: true } }),
      this.prisma.staffMember.findMany({ where: { tenantId, userId: { not: null } }, select: { userId: true, staffRole: true, permissions: true } as never }) as unknown as Promise<{ userId: string | null; staffRole: string | null; permissions?: unknown }[]>,
    ]);
    await this.push.sendToTenant(tenantId, msg, { onlyUserIds: deskUserIds(admins, staff) }).catch(() => undefined);
    return late.length;
  }

  /** Every salon with someone waiting to pay; one salon's error never stops the next. */
  async nudgeUnpaidEverywhere(now = new Date()): Promise<number> {
    const rows = await this.prisma.walkIn.findMany({ where: { status: WalkInStatus.SERVING, awaitingPayment: true }, select: { tenantId: true }, distinct: ['tenantId'] });
    let n = 0;
    for (const r of rows) { try { n += await this.nudgeUnpaid(r.tenantId, now); } catch { /* next salon */ } }
    return n;
  }

  /**
   * ĐÓNG KHÔNG THU TIỀN. The visit happened but no receipt will be rung up in
   * Lumio (paid on another machine, pays later, a free redo, a mistake): every
   * part is finished (so the turn counts as it would have), the bill is closed
   * so it stops sitting at the till, and the reason is kept for the end-of-day
   * check. This salon's ticket only.
   */
  async closeUnpaid(user: AuthenticatedUser, id: string, reason: unknown, note?: string) {
    const why = cleanCloseReason(reason);
    const w = await this.mine(user, id);
    if (w.status === WalkInStatus.CANCELLED) throw new BadRequestException('This visit was cancelled');
    if (w.status !== WalkInStatus.DONE) await this.done(user, id, true);
    await this.prisma.walkIn.updateMany({
      where: { id: w.id, tenantId: w.tenantId },
      data: { status: WalkInStatus.DONE, awaitingPayment: false, ...(w.doneAt ? {} : { doneAt: new Date() }) },
    });
    await this.audit?.log({ tenantId: w.tenantId, userId: user.userId, action: 'walkin.closed_unpaid', resourceType: 'walk_in', resourceId: w.id, metadata: { reason: why, note: String(note ?? '').slice(0, 200) || null } });
    await this.settle(w.tenantId);
    return this.row(w.tenantId, w.id);
  }

  /**
   * "Xong" in the technician's own app: finishes HER part. A customer whose
   * feet are still to do stays on the floor for the next technician; when hers
   * was the last leg, the visit is done. A ticket from before legs closes as
   * it always did.
   */
  async doneAsMe(user: AuthenticatedUser, id: string) {
    const w = await this.mine(user, id);
    const me = await this.staffOf(user);
    const t = w as unknown as TicketLike;
    const myLegs = me ? legsOf(t).filter((l) => !l.legacy && l.staffId === me && l.status === 'SERVING') : [];
    if (!myLegs.length) return this.done(user, id);
    let out: Awaited<ReturnType<WalkinsService['doneLeg']>> | null = null;
    for (const leg of myLegs) out = await this.doneLeg(user, id, leg.legId);
    return out!;
  }

  /** Remove from the queue (left / mistake). */
  async cancel(user: AuthenticatedUser, id: string) {
    const w = await this.mine(user, id);
    const out = await this.prisma.walkIn.update({ where: { id: w.id }, data: { status: WalkInStatus.CANCELLED }, include: INCLUDE });
    // A customer who left mid-visit frees her technician.
    if (w.status === WalkInStatus.SERVING) await this.settle(w.tenantId);
    return out;
  }

  /**
   * Delete a walk-in outright — a test ticket, a double entry, somebody who
   * walked back out before anything happened.
   *
   * REFUSED THE MOMENT MONEY EXISTS. An Order carries walkInId, and an order is
   * revenue that has already been counted, printed on a receipt and possibly
   * settled on a card terminal. Deleting the visit under it would leave that
   * money with nothing to explain it: the day's takings and the day's visits
   * would disagree, and the only person who could say which was right is
   * whoever happened to press this button. So the invoice goes first, from the
   * Orders screen, where the person doing it can see what they are deleting.
   *
   * Cancelling stays the normal move for a real customer who left — it keeps
   * the row and the history. This is for rows that should never have existed.
   */
  async remove(user: AuthenticatedUser, id: string) {
    const w = await this.mine(user, id);
    const invoices = await this.prisma.order
      .count({ where: { tenantId: w.tenantId, walkInId: w.id } })
      .catch(() => 0);
    if (invoices > 0) {
      throw new ConflictException(
        'Lượt khách này đã có hoá đơn. Xoá hoá đơn ở mục Đơn hàng trước, rồi mới xoá được lượt khách.',
      );
    }
    await this.prisma.walkIn.delete({ where: { id: w.id } });
    return { ok: true };
  }
}
