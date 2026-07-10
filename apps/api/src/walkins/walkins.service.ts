import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus, Prisma, WalkInStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { SettingsService } from '../settings/settings.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';

export interface AddWalkInDto {
  customerName?: string;
  phone?: string;
  serviceId?: string;
  note?: string;
  partySize?: number;
  assignedStaffId?: string;
  autoAssign?: boolean;
  station?: string;
}

const INCLUDE = {
  service: { select: { id: true, name: true } },
  assignedStaff: { select: { id: true, firstName: true, lastName: true } },
  stationRef: { select: { id: true, name: true, kind: true } },
};

export interface WalkInItem { lineId: string; serviceId: string; name: string; priceCents: number; staffId: string | null }

/**
 * Walk-in queue + fair turn rotation ("lượt"). The front desk adds walk-in
 * clients; each is handed to a technician. Turns are counted per tech per day
 * (done walk-ins + completed appointments) so the next client goes to whoever
 * is "up" — removing the daily fights over turn order.
 */
@Injectable()
export class WalkinsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
    private readonly settings: SettingsService,
  ) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  /** Snapshot a service into a ticket line (net price after its own discount). */
  private async buildItem(tenantId: string, serviceId: string, staffId: string | null): Promise<WalkInItem> {
    const svc = await this.prisma.service.findFirst({ where: { id: serviceId, tenantId }, select: { id: true, name: true, priceCents: true, discountPercent: true } });
    if (!svc) throw new BadRequestException('Service not found');
    const d = Math.min(90, Math.max(0, svc.discountPercent ?? 0));
    const net = d > 0 ? Math.round((svc.priceCents * (100 - d)) / 100) : svc.priceCents;
    return { lineId: randomUUID(), serviceId: svc.id, name: svc.name, priceCents: net, staffId };
  }

  private startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** Keyword hint for the chair type a service belongs at (matched against the
   *  salon's own type names, e.g. "Pedi"). Null = no strong hint. */
  private detectHint(name?: string | null, category?: string | null): string | null {
    const s = `${name ?? ''} ${category ?? ''}`.toLowerCase();
    if (/pedi|pedicure|foot|spa|chân|chan/.test(s)) return 'pedi';
    if (/mani|manicure|hand|tay/.test(s)) return 'mani';
    if (/nail|acrylic|dip|gel|powder|bột|bot|full set|fill|tip|shellac/.test(s)) return 'nail';
    return null;
  }

  /** A free chair for a new walk-in: an active station not currently held by a
   *  SERVING walk-in, preferring one whose TYPE name matches the service hint. */
  private async freeStationId(tenantId: string, hint: string | null): Promise<string | null> {
    const [stations, occupied] = await Promise.all([
      this.prisma.station.findMany({ where: { tenantId, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, stationType: { select: { name: true } } } }),
      this.prisma.walkIn.findMany({ where: { tenantId, status: WalkInStatus.SERVING, stationId: { not: null } }, select: { stationId: true } }),
    ]);
    if (stations.length === 0) return null;
    const busy = new Set(occupied.map((o) => o.stationId));
    const free = stations.filter((st) => !busy.has(st.id));
    if (free.length === 0) return null;
    const match = hint ? free.find((st) => (st.stationType?.name || '').toLowerCase().includes(hint)) : undefined;
    return (match ?? free[0]).id;
  }

  /** Add a walk-in. If a technician is passed (or auto-assign is on and a tech is
   * free) it starts in SERVING; otherwise it waits. */
  async add(user: AuthenticatedUser, dto: AddWalkInDto) {
    const tenantId = this.tenantId(user);
    const svcMeta = dto.serviceId
      ? await this.prisma.service.findFirst({ where: { id: dto.serviceId, tenantId }, select: { id: true, name: true, category: { select: { name: true } } } })
      : null;
    const serviceId = svcMeta?.id ?? null;
    const staff = dto.assignedStaffId
      ? await this.prisma.staffMember.findFirst({ where: { id: dto.assignedStaffId, tenantId, takesAppointments: true }, select: { id: true } })
      : null;
    // Turn rotation: when no specific tech is requested and auto-assign is on, give
    // the walk-in to the "up next" tech (fewest turns today AND currently free). If
    // every tech is busy, nobody can start it -> it waits (front desk assigns when
    // a tech frees up). A specific requested tech always wins over auto.
    let assignedStaffId: string | null = staff?.id ?? null;
    if (!assignedStaffId && dto.autoAssign) {
      assignedStaffId = await this.nextUpStaffId(tenantId);
    }
    const assigned = !!assignedStaffId;
    const items = serviceId ? [await this.buildItem(tenantId, serviceId, assignedStaffId)] : [];
    // A customer takes a chair once a tech starts. Auto-pick a free chair, preferring
    // one whose kind matches the service (pedi service -> pedi chair). Front desk can
    // drag them to another chair on the floor view.
    const stationId = assigned
      ? await this.freeStationId(tenantId, this.detectHint(svcMeta?.name, svcMeta?.category?.name))
      : null;
    // Find-or-create a CRM customer by phone so the walk-in earns loyalty and is
    // remarketable. Skips when no phone is given (no key to dedupe on).
    const linked = dto.phone?.trim()
      ? await this.customers.findOrCreateByContact(tenantId, { firstName: dto.customerName, phone: dto.phone })
      : null;
    return this.prisma.walkIn.create({
      data: {
        tenantId,
        serviceId,
        customerId: linked?.id ?? null,
        customerName: dto.customerName?.trim().slice(0, 80) || null,
        phone: dto.phone?.trim().slice(0, 40) || null,
        note: dto.note?.trim().slice(0, 300) || null,
        partySize: Math.max(1, Math.min(20, Math.round(dto.partySize ?? 1))),
        assignedStaffId,
        items: items as unknown as Prisma.InputJsonValue,
        station: dto.station?.trim().slice(0, 24) || null,
        stationId,
        status: assigned ? WalkInStatus.SERVING : WalkInStatus.WAITING,
        assignedAt: assigned ? new Date() : null,
      },
      include: INCLUDE,
    });
  }

  /** The tech "up next" = currently free (not serving) with the fewest turns today. */
  private async nextUpStaffId(tenantId: string): Promise<string | null> {
    const today = this.startOfToday();
    const [serving, staff, doneWalkIns, completedAppts] = await Promise.all([
      this.prisma.walkIn.findMany({ where: { tenantId, status: WalkInStatus.SERVING }, select: { assignedStaffId: true } }),
      this.prisma.staffMember.findMany({ where: { tenantId, isActive: true, takesAppointments: true }, select: { id: true }, orderBy: [{ bookingPriority: 'desc' }, { firstName: 'asc' }] }),
      this.prisma.walkIn.groupBy({ by: ['assignedStaffId'], where: { tenantId, status: WalkInStatus.DONE, doneAt: { gte: today }, assignedStaffId: { not: null } }, _count: { _all: true } }),
      this.prisma.appointment.groupBy({ by: ['assignedStaffId'], where: { tenantId, status: AppointmentStatus.COMPLETED, completedAt: { gte: today }, assignedStaffId: { not: null } }, _count: { _all: true } }),
    ]);
    const turns = new Map<string, number>();
    for (const r of doneWalkIns) if (r.assignedStaffId) turns.set(r.assignedStaffId, (turns.get(r.assignedStaffId) ?? 0) + r._count._all);
    for (const r of completedAppts) if (r.assignedStaffId) turns.set(r.assignedStaffId, (turns.get(r.assignedStaffId) ?? 0) + r._count._all);
    const busy = new Set(serving.map((x) => x.assignedStaffId).filter((v): v is string => !!v));
    const available = staff.filter((x) => !busy.has(x.id));
    if (!available.length) return null;
    return available.reduce((a, b) => ((turns.get(b.id) ?? 0) < (turns.get(a.id) ?? 0) ? b : a)).id;
  }

  /** The live board: waiting queue, in-service, and per-tech turn counts. */
  async board(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const today = this.startOfToday();
    const [waiting, serving, staff, doneWalkIns, completedAppts] = await Promise.all([
      this.prisma.walkIn.findMany({ where: { tenantId, status: WalkInStatus.WAITING }, include: INCLUDE, orderBy: { createdAt: 'asc' } }),
      this.prisma.walkIn.findMany({ where: { tenantId, status: WalkInStatus.SERVING }, include: INCLUDE, orderBy: { assignedAt: 'asc' } }),
      this.prisma.staffMember.findMany({
        where: { tenantId, isActive: true, takesAppointments: true },
        select: { id: true, firstName: true, lastName: true, avatarUrl: true, bookingPriority: true },
        orderBy: [{ bookingPriority: 'desc' }, { firstName: 'asc' }],
      }),
      // DONE walk-ins today WITH their ticket, so a turn credits EVERY tech who did a
      // service on the visit (a customer who moved to a 2nd tech gives both a turn) —
      // not only the tech the walk-in was first assigned to.
      this.prisma.walkIn.findMany({ where: { tenantId, status: WalkInStatus.DONE, doneAt: { gte: today } }, select: { assignedStaffId: true, items: true } }),
      this.prisma.appointment.groupBy({ by: ['assignedStaffId'], where: { tenantId, status: AppointmentStatus.COMPLETED, completedAt: { gte: today }, assignedStaffId: { not: null } }, _count: { _all: true } }),
    ]);

    const turns = new Map<string, number>();
    const bump = (id: string | null | undefined) => { if (id) turns.set(id, (turns.get(id) ?? 0) + 1); };
    for (const w of doneWalkIns) {
      const techs = this.lineTechs(w);
      if (techs.length) techs.forEach(bump);
      else bump(w.assignedStaffId); // no lines logged -> credit the assigned tech
    }
    for (const r of completedAppts) if (r.assignedStaffId) turns.set(r.assignedStaffId, (turns.get(r.assignedStaffId) ?? 0) + r._count._all);

    // A tech is "busy" if they are the assigned tech OR actively on any current ticket.
    const busy = new Set<string>();
    for (const sv of serving) {
      if (sv.assignedStaffId) busy.add(sv.assignedStaffId);
      for (const tech of this.lineTechs(sv)) busy.add(tech);
    }

    const board = staff.map((s) => ({
      id: s.id,
      name: `${s.firstName}${s.lastName ? ' ' + s.lastName : ''}`,
      avatarUrl: s.avatarUrl,
      turns: turns.get(s.id) ?? 0,
      busy: busy.has(s.id),
    }));

    // Next up = an available (not busy) tech with the fewest turns today.
    const available = board.filter((s) => !s.busy);
    const nextUpStaffId = available.length
      ? available.reduce((a, b) => (b.turns < a.turns ? b : a)).id
      : null;

    return { waiting, serving, staff: board.map((s) => ({ ...s, nextUp: s.id === nextUpStaffId })), nextUpStaffId };
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
    return this.prisma.walkIn.update({ where: { id: w.id }, data: { stationId: sid }, include: INCLUDE });
  }

  /** Add a service line to a walk-in's running ticket (front desk OR the tech). */
  async addService(user: AuthenticatedUser, id: string, serviceId: string, staffId?: string) {
    const w = await this.mine(user, id);
    const line = await this.buildItem(w.tenantId, serviceId, staffId ?? w.assignedStaffId ?? null);
    return this.prisma.walkIn.update({ where: { id: w.id }, data: { items: [...this.itemsOf(w), line] as unknown as Prisma.InputJsonValue }, include: INCLUDE });
  }

  /** Remove one service line from a walk-in's ticket. */
  async removeService(user: AuthenticatedUser, id: string, lineId: string) {
    const w = await this.mine(user, id);
    return this.prisma.walkIn.update({ where: { id: w.id }, data: { items: this.itemsOf(w).filter((x) => x.lineId !== lineId) as unknown as Prisma.InputJsonValue }, include: INCLUDE });
  }

  /** One walk-in with its ticket (used by POS to prefill every service line). */
  async getOne(user: AuthenticatedUser, id: string) {
    const w = await this.prisma.walkIn.findFirst({ where: { id, tenantId: this.tenantId(user) }, include: INCLUDE });
    if (!w) throw new NotFoundException('Walk-in not found');
    return w;
  }

  /** The signed-in tech's own in-service clients (their chair) — for the staff app. */
  async myChair(user: AuthenticatedUser) {
    const tenantId = this.tenantId(user);
    const staff = await this.prisma.staffMember.findFirst({ where: { tenantId, userId: user.userId }, select: { id: true } });
    const currency = (await this.settings.getBookingRules(tenantId).catch(() => null))?.currency ?? 'USD';
    if (!staff) return { staffId: null, currency, serving: [] as unknown[], salon: [] as unknown[] };
    const allServing = await this.prisma.walkIn.findMany({ where: { tenantId, status: WalkInStatus.SERVING }, include: INCLUDE, orderBy: { assignedAt: 'asc' } });
    // "Mine" = the tech is the assigned tech OR already has a service line on the
    // ticket. So when a customer moves to a 2nd tech and that tech adds their
    // service, the ticket appears in THEIR chair too.
    const serving = allServing.filter((w) => w.assignedStaffId === staff.id || this.lineTechs(w).includes(staff.id));
    // Everyone else currently in the salon (for the "a client moved to my chair" picker).
    const mineIds = new Set(serving.map((w) => w.id));
    const salon = allServing
      .filter((w) => !mineIds.has(w.id))
      .map((w) => ({ id: w.id, customerName: w.customerName, station: (w as { station?: string | null }).station ?? null }));
    return { staffId: staff.id, currency, serving, salon };
  }

  /** Hand a waiting walk-in to a technician (→ SERVING). */
  async assign(user: AuthenticatedUser, id: string, staffId: string) {
    const w = await this.mine(user, id);
    const staff = await this.prisma.staffMember.findFirst({ where: { id: staffId, tenantId: w.tenantId, takesAppointments: true }, select: { id: true } });
    if (!staff) throw new BadRequestException('Technician not found');
    return this.prisma.walkIn.update({
      where: { id: w.id },
      data: { assignedStaffId: staff.id, status: WalkInStatus.SERVING, assignedAt: w.assignedAt ?? new Date() },
      include: INCLUDE,
    });
  }

  /** Mark finished (counts as a completed turn). */
  async done(user: AuthenticatedUser, id: string) {
    const w = await this.mine(user, id);
    return this.prisma.walkIn.update({ where: { id: w.id }, data: { status: WalkInStatus.DONE, doneAt: new Date() }, include: INCLUDE });
  }

  /** Remove from the queue (left / mistake). */
  async cancel(user: AuthenticatedUser, id: string) {
    const w = await this.mine(user, id);
    return this.prisma.walkIn.update({ where: { id: w.id }, data: { status: WalkInStatus.CANCELLED }, include: INCLUDE });
  }

  async remove(user: AuthenticatedUser, id: string) {
    const w = await this.mine(user, id);
    await this.prisma.walkIn.delete({ where: { id: w.id } });
    return { ok: true };
  }
}
