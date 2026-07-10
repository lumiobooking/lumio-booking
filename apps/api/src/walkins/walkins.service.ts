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
}

const INCLUDE = {
  service: { select: { id: true, name: true } },
  assignedStaff: { select: { id: true, firstName: true, lastName: true } },
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

  /** Add a walk-in. If a technician is passed (or auto-assign is on and a tech is
   * free) it starts in SERVING; otherwise it waits. */
  async add(user: AuthenticatedUser, dto: AddWalkInDto) {
    const tenantId = this.tenantId(user);
    const serviceId = dto.serviceId
      ? (await this.prisma.service.findFirst({ where: { id: dto.serviceId, tenantId }, select: { id: true } }))?.id ?? null
      : null;
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
      this.prisma.walkIn.groupBy({ by: ['assignedStaffId'], where: { tenantId, status: WalkInStatus.DONE, doneAt: { gte: today }, assignedStaffId: { not: null } }, _count: { _all: true } }),
      this.prisma.appointment.groupBy({ by: ['assignedStaffId'], where: { tenantId, status: AppointmentStatus.COMPLETED, completedAt: { gte: today }, assignedStaffId: { not: null } }, _count: { _all: true } }),
    ]);

    const turns = new Map<string, number>();
    for (const r of doneWalkIns) if (r.assignedStaffId) turns.set(r.assignedStaffId, (turns.get(r.assignedStaffId) ?? 0) + r._count._all);
    for (const r of completedAppts) if (r.assignedStaffId) turns.set(r.assignedStaffId, (turns.get(r.assignedStaffId) ?? 0) + r._count._all);

    const busy = new Set(serving.map((s) => s.assignedStaffId).filter((x): x is string => !!x));

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
    if (!staff) return { staffId: null, currency, serving: [] as unknown[] };
    const serving = await this.prisma.walkIn.findMany({ where: { tenantId, status: WalkInStatus.SERVING, assignedStaffId: staff.id }, include: INCLUDE, orderBy: { assignedAt: 'asc' } });
    return { staffId: staff.id, currency, serving };
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
