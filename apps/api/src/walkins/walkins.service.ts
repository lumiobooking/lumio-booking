import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { AppointmentStatus, OrderStatus, Prisma, WalkInStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { SettingsService } from '../settings/settings.service';
import { PushService } from '../push/push.service';
import { normalizeSource } from '../common/source.util';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import {
  attachLines, busyTechs, canRunTogether, isStale, itemsOf as legItemsOf, LegItem, legsOf, minutesLeft, newLegId, overdueMinutes, partyTags, patchLeg, phaseOf, pickTech,
  planDispatch, syncTicket, TechInfo, TicketLike, turnsFromTickets, upgradeItems, Zone, zoneOf,
} from './walkin-legs';
import { tzPartsOf } from '../common/salon-time';
import { inPromoWindow, salonYmd } from '../settings/promo-window';

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
  customerName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  /** YYYY-MM-DD. Optional; feeds the birthday campaign. */
  birthDate?: string;
  serviceId?: string;
  /** Additional services picked in the same go (the walk-in norm). */
  serviceIds?: string[];
  /** Minutes to allow on top of the services. */
  extraMinutes?: number;
  note?: string;
  partySize?: number;
  assignedStaffId?: string;
  autoAssign?: boolean;
  station?: string;
  /** People who came in with the customer: a ticket each, one party. */
  guests?: { firstName?: string; serviceIds?: string[]; assignedStaffId?: string }[];
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
  ) {}

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
    type Row = { id: string; name: string; priceCents: number; discountPercent: number | null; durationMinutes: number; turnValue?: number | null; category?: { name: string } | null };
    const uniq = [...new Set(ids.filter(Boolean))];
    if (!uniq.length) return new Map<string, Row>();
    const select = { id: true, name: true, priceCents: true, discountPercent: true, durationMinutes: true, category: { select: { name: true } } };
    let rows: Row[];
    try {
      rows = await this.db.service.findMany({ where: { tenantId, id: { in: uniq } }, select: { ...select, turnValue: true } });
    } catch {
      // The column arrives with its migration; until then everything is worth 1.
      rows = await this.db.service.findMany({ where: { tenantId, id: { in: uniq } }, select });
    }
    return new Map((rows ?? []).map((r) => [r.id, r]));
  }

  /** Snapshot a service into a ticket line (net price after its own discount). */
  private async buildItem(tenantId: string, serviceId: string, staffId: string | null): Promise<LegItem & { zone: Zone }> {
    const svc = (await this.menuRows(tenantId, [serviceId])).get(serviceId);
    if (!svc) throw new BadRequestException('Service not found');
    const d = Math.min(90, Math.max(0, svc.discountPercent ?? 0));
    const net = d > 0 ? Math.round((svc.priceCents * (100 - d)) / 100) : svc.priceCents;
    return {
      lineId: randomUUID(), serviceId: svc.id, name: svc.name, priceCents: net, durationMinutes: svc.durationMinutes, staffId,
      zone: zoneOf(svc.name, svc.category?.name),
      turnValue: typeof svc.turnValue === 'number' ? svc.turnValue : 1,
    };
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
      select: { id: true, status: true, assignedStaffId: true, createdAt: true, assignedAt: true, doneAt: true, awaitingPayment: true, items: true },
    });
    if (!open.length) return [];
    const afterHours = await this.afterHours(tenantId, now);
    const stale = (open as unknown as TicketLike[]).filter((t) => afterHours || isStale(t, now)).map((t) => t.id);
    if (!stale.length) return [];
    await this.prisma.walkIn.updateMany({
      where: { id: { in: stale }, tenantId, status: WalkInStatus.SERVING, awaitingPayment: false },
      data: { awaitingPayment: true, stationId: null },
    });
    await this.settle(tenantId);
    return stale;
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
    const lines: (LegItem & { zone: Zone })[] = [];
    for (const sid of wanted) {
      try { lines.push(await this.buildItem(tenantId, sid, staffId)); } catch { /* removed from the menu */ }
    }
    const items = attachLines([], lines);
    // Find-or-create a CRM customer by phone/email so the walk-in earns loyalty
    // and is remarketable, with the birthday for the birthday campaign.
    const linked = (dto.phone?.trim() || dto.email?.trim())
      ? await this.customers.findOrCreateByContact(tenantId, {
          firstName: dto.customerName,
          lastName: dto.lastName,
          phone: dto.phone,
          email: dto.email,
          birthDate: dto.birthDate,
        })
      : null;
    // A PARTY is one ticket per person, linked by a groupId: each guest has
    // their own services, their own technician and their own line at the
    // till, and the board shows them side by side as one group.
    const guests = (Array.isArray(dto.guests) ? dto.guests : []).slice(0, 9);
    const groupId = guests.length ? `wk-${randomUUID()}` : null;
    const partySize = Math.max(1, Math.min(20, Math.round(Math.max(dto.partySize ?? 1, guests.length + 1))));
    const leaderName = dto.customerName?.trim().slice(0, 80) || null;
    const created = await this.prisma.walkIn.create({
      data: {
        tenantId,
        serviceId,
        customerId: linked?.id ?? null,
        customerName: leaderName,
        phone: dto.phone?.trim().slice(0, 40) || null,
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
    const guestIds: string[] = [];
    let anyRequested = !!staffId;
    for (let i = 0; i < guests.length; i++) {
      const g = guests[i] ?? {};
      const gStaff = g.assignedStaffId
        ? (await this.prisma.staffMember.findFirst({ where: { id: g.assignedStaffId, tenantId, takesAppointments: true }, select: { id: true } }))?.id ?? null
        : null;
      anyRequested = anyRequested || !!gStaff;
      const gLines: (LegItem & { zone: Zone })[] = [];
      for (const sid of [...new Set((g.serviceIds ?? []).filter(Boolean))]) {
        try { gLines.push(await this.buildItem(tenantId, sid, gStaff)); } catch { /* removed from the menu */ }
      }
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
          items: attachLines([], gLines) as unknown as Prisma.InputJsonValue,
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
    const [open, doneToday, staff, links, completedAppts] = await Promise.all([
      this.prisma.walkIn.findMany({ where: { tenantId, status: { in: [WalkInStatus.WAITING, WalkInStatus.SERVING] } }, include: INCLUDE, orderBy: { createdAt: 'asc' } }),
      this.prisma.walkIn.findMany({ where: { tenantId, status: WalkInStatus.DONE, doneAt: { gte: today } }, include: INCLUDE, orderBy: { doneAt: 'desc' } }),
      this.prisma.staffMember.findMany({
        where: { tenantId, isActive: true, takesAppointments: true },
        select: { id: true, firstName: true, lastName: true, avatarUrl: true, bookingPriority: true },
        orderBy: [{ bookingPriority: 'desc' }, { firstName: 'asc' }],
      }),
      this.prisma.staffService.findMany({ where: { tenantId }, select: { staffMemberId: true, serviceId: true } }).catch(() => [] as { staffMemberId: string; serviceId: string }[]),
      this.prisma.appointment.groupBy({ by: ['assignedStaffId'], where: { tenantId, status: AppointmentStatus.COMPLETED, completedAt: { gte: today }, assignedStaffId: { not: null } }, _count: { _all: true } }),
    ]);
    // Turns: each finished leg is worth its service's turn value (a ticket from
    // before legs keeps the old one-per-technician rule), plus completed bookings.
    const turns = turnsFromTickets([...open, ...doneToday] as unknown as TicketLike[], today);
    for (const r of completedAppts) if (r.assignedStaffId) turns.set(r.assignedStaffId, (turns.get(r.assignedStaffId) ?? 0) + r._count._all);
    const skills = new Map<string, string[]>();
    for (const l of links ?? []) skills.set(l.staffMemberId, [...(skills.get(l.staffMemberId) ?? []), l.serviceId]);
    const techs: TechInfo[] = staff.map((s) => ({
      id: s.id,
      name: `${s.firstName}${s.lastName ? ' ' + s.lastName : ''}`,
      priority: Number(s.bookingPriority) || 0,
      skills: skills.get(s.id) ?? [],
    }));
    const restricted = new Set((links ?? []).map((l) => l.serviceId));
    return { today, open, doneToday, staff, techs, skills, turns, restricted };
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
    const plan = planDispatch(tickets as unknown as TicketLike[], f.techs, f.turns, { restricted: f.restricted });
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
    const tagged = <T extends object>(w: T) => {
      const gid = (w as { groupId?: string | null }).groupId;
      const g = gid ? groups.get(gid) : undefined;
      return { ...this.view(w), group: g ?? null };
    };
    // Waiting-to-pay: the technician is finished, so she is free.
    const waiting = f.open.filter((w) => w.status === WalkInStatus.WAITING).map((w) => tagged(w));
    const serving = f.open.filter((w) => w.status === WalkInStatus.SERVING).sort((a, b) => +(a.assignedAt ?? a.createdAt) - +(b.assignedAt ?? b.createdAt)).map((w) => tagged(w));

    // Today's online bookings not yet arrived — shown in the floor's "Booked today"
    // strip so walk-ins and appointments live on one screen.
    const tomorrow = new Date(f.today.getTime() + 86400000);
    const bookedRaw = await this.prisma.appointment.findMany({
      where: { tenantId, startTime: { gte: f.today, lt: tomorrow }, status: { in: [AppointmentStatus.PENDING, AppointmentStatus.ASSIGNED, AppointmentStatus.ACCEPTED, AppointmentStatus.CONFIRMED] } },
      select: { id: true, startTime: true, source: true, groupId: true, customer: { select: { firstName: true, lastName: true } }, service: { select: { name: true } }, assignedStaff: { select: { id: true, firstName: true, lastName: true } } },
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
      source: normalizeSource(a.source),
      customerName: a.customer ? `${a.customer.firstName}${a.customer.lastName ? ' ' + a.customer.lastName : ''}`.trim() : null,
      serviceName: a.service?.name ?? null,
      staff: a.assignedStaff ? { id: a.assignedStaff.id, name: `${a.assignedStaff.firstName}${a.assignedStaff.lastName ? ' ' + a.assignedStaff.lastName : ''}` } : null,
    }));

    // Next up = the free technician the dispatcher would pick for a plain job.
    const free = f.techs.filter((t) => !busy.has(t.id));
    const nextUpStaffId = pickTech(free, [], f.turns)?.id ?? null;
    const staff = f.staff.map((s) => ({
      id: s.id,
      name: `${s.firstName}${s.lastName ? ' ' + s.lastName : ''}`,
      avatarUrl: s.avatarUrl,
      turns: f.turns.get(s.id) ?? 0,
      busy: busy.has(s.id),
      // Minutes left on what she is doing now (rough), for "free in ~10'".
      busyFor: busy.has(s.id) ? minutesLeft(open, s.id, now) : null,
      // Services she does; empty = everything (nobody ticked boxes yet).
      skills: f.skills.get(s.id) ?? [],
      nextUp: s.id === nextUpStaffId,
    }));

    // Finished today, most recent first: a ticket marked Done by mistake (or done
    // before the customer paid) has to be reachable again for checkout.
    const done = f.doneToday.slice(0, 20).map((w) => tagged(w));
    return { waiting, serving, booked, done, staff, nextUpStaffId, restricted: [...f.restricted] };
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
      this.groupPromoFor(tenantId, tickets.length),
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
        return { lineId: it.lineId, serviceId: it.serviceId, name: it.name, priceCents: it.priceCents, durationMinutes: it.durationMinutes ?? 0, staffId: it.staffId ?? null, paid: by !== null, orderNumber: by };
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
  private async groupPromoFor(tenantId: string, size: number): Promise<{ percent: number; minSize: number; message: string } | null> {
    try {
      if (size < 2) return null;
      const gr = await this.settings.getGroupDiscount(tenantId);
      if (!gr?.enabled || !Array.isArray(gr.tiers)) return null;
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

  /** Check in an online booking: place the customer on the floor as a ticket
   *  linked back to the appointment, and mark the appointment ARRIVED. Its
   *  booked technicians take their legs; the rest goes through the dispatcher,
   *  queued at the booked time rather than behind everyone who walked in since. */
  async seatAppointment(user: AuthenticatedUser, appointmentId: string) {
    const tenantId = this.tenantId(user);
    const appt = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId },
      select: {
        id: true, customerId: true, source: true, assignedStaffId: true, addons: true, startTime: true, groupId: true,
        customer: { select: { firstName: true, lastName: true, phone: true } },
        service: { select: { id: true, name: true } },
      },
    });
    if (!appt) throw new NotFoundException('Appointment not found');
    const custName = appt.customer ? `${appt.customer.firstName}${appt.customer.lastName ? ' ' + appt.customer.lastName : ''}`.trim() : null;
    // Every service of the booking, each with the technician it was booked with.
    const extraLines = (Array.isArray(appt.addons) ? (appt.addons as unknown as { id?: string; kind?: string; staffMemberId?: string | null }[]) : [])
      .filter((a) => a?.kind === 'service' && a?.id);
    const lines: (LegItem & { zone: Zone })[] = appt.service
      ? [await this.buildItem(tenantId, appt.service.id, appt.assignedStaffId ?? null)]
      : [];
    for (const line of extraLines) {
      try {
        lines.push(await this.buildItem(tenantId, line.id!, line.staffMemberId ?? appt.assignedStaffId ?? null));
      } catch {
        // A service deleted since the booking was taken shouldn't block check-in.
      }
    }
    const now = new Date();
    let items = attachLines([], lines);
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
  ) {
    const w = await this.mine(user, id);
    const ids = [...new Set([...(serviceId ? [serviceId] : []), ...(serviceIds ?? [])])].filter(Boolean);
    const tech = staffId ? await this.techOf(w.tenantId, staffId) : null;
    const lines: (LegItem & { zone: Zone })[] = [];
    for (const sid of ids) lines.push(await this.buildItem(w.tenantId, sid, tech));
    await serial(w.tenantId, async () => {
      const fresh = await this.mine(user, id);
      const t = fresh as unknown as TicketLike;
      const extra: Record<string, unknown> = {};
      // Sent explicitly (including 0) → replace the stored estimate.
      if (extraMinutes !== undefined) extra.extraMinutes = Math.max(0, Math.min(600, Math.round(extraMinutes)));
      if (!lines.length) {
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
        const svc = await this.buildItem(fresh.tenantId, dto.serviceId, line.staffId);
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
  private async staffOf(user: AuthenticatedUser): Promise<string | null> {
    const tenantId = this.tenantId(user);
    const staff = await this.prisma.staffMember.findFirst({ where: { tenantId, userId: user.userId }, select: { id: true } });
    return staff?.id ?? null;
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
    const sorted = [...f.techs].sort((a, b) => (turnsOf(a.id) - turnsOf(b.id)) || (b.priority - a.priority));
    const freeOrder = sorted.filter((t) => !busy.has(t.id));
    const nextUpStaffId = pickTech(freeOrder, [], f.turns)?.id ?? null;
    const techs = sorted.map((t, i) => ({
      id: t.id, name: t.name, rank: i + 1, turns: turnsOf(t.id),
      busy: busy.has(t.id), busyFor: busy.has(t.id) ? minutesLeft(open, t.id, now) : null,
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
    type OrderRow = { paidAt: Date | null; appointmentId: string | null; appointmentIds?: string[]; items: { kind: string; lineTotalCents: number; tipCents: number; quantity: number; staffMemberId: string | null }[] };
    const orders: OrderRow[] = await this.db.order.findMany({
      where: { tenantId, status: 'PAID', paidAt: { gte: weekStart } },
      select: {
        paidAt: true, appointmentId: true, appointmentIds: true,
        items: { where: { staffMemberId: me }, select: { kind: true, lineTotalCents: true, tipCents: true, quantity: true, staffMemberId: true } },
      },
    }).catch(() => []);
    const paidAppts = new Set<string>();
    for (const o of orders ?? []) {
      for (const a of [o.appointmentId, ...(o.appointmentIds ?? [])]) if (a) paidAppts.add(a);
      const w = slot(o.paidAt);
      if (!w) continue;
      for (const l of o.items ?? []) {
        if (l.staffMemberId !== me) continue;
        if (l.kind === 'SERVICE') { w.serviceCents += l.lineTotalCents; w.services += l.quantity || 1; }
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
      staffId: me, currency, turns: turnsOf(me), busy: busy.has(me),
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
  async assign(user: AuthenticatedUser, id: string, staffId: string) {
    const w = await this.mine(user, id);
    const tech = await this.techOf(w.tenantId, staffId);
    const t = w as unknown as TicketLike;
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
  async done(user: AuthenticatedUser, id: string) {
    const w = await this.mine(user, id);
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
