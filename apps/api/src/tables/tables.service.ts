import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { cleanLayout, tableStates, waitingForTable, withDefaults, type Layout } from './floor';
import { planTableImport, type TableImportRow } from './table-import';

/** Per restaurant: where each table stands on the floor map (tables/floor.ts). */
const LAYOUT_KEY = 'table_layout';

/**
 * Restaurant tables — the bookable resource for RESTAURANT tenants (the
 * counterpart to StaffMember for salons). Every query is scoped to the caller's
 * own tenantId so one restaurant can never see or touch another's tables.
 */
@Injectable()
export class TablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) throw new NotFoundException('No tenant context');
    return id;
  }

  /**
   * The floor map: tables, their spots (settings `table_layout`) and their
   * state at `at` (default now). One restaurant's rows only.
   */
  async floor(user: AuthenticatedUser, atIso?: string) {
    const tenantId = this.tenantId(user);
    const at = atIso && !Number.isNaN(Date.parse(atIso)) ? new Date(atIso) : new Date();
    const dayStart = new Date(at.getTime() - 12 * 3600_000);
    const dayEnd = new Date(at.getTime() + 12 * 3600_000);
    const [tables, row, res] = await Promise.all([
      this.prisma.restaurantTable.findMany({ where: { tenantId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: LAYOUT_KEY } } }),
      this.prisma.appointment.findMany({
        where: { tenantId, startTime: { lt: dayEnd }, endTime: { gt: dayStart } },
        select: { id: true, tableId: true, startTime: true, endTime: true, status: true, partySize: true, notes: true, customer: { select: { firstName: true } } },
      }),
    ]);
    const layout = withDefaults(tables, cleanLayout(row?.value ?? {}, tables.map((t) => t.id)));
    const rows = res.map((r) => ({
      id: r.id, tableId: r.tableId, startTime: r.startTime, endTime: r.endTime, status: String(r.status), partySize: r.partySize ?? 1, customerName: r.customer?.firstName ?? null, notes: r.notes,
    }));
    const states = tableStates(tables, rows, at);
    // Only a restaurant with tables seats anyone; a salon's bookings never show here.
    const waiting = tables.length ? waitingForTable(rows, at) : [];
    return { at: at.toISOString(), tables, layout, states, waiting };
  }

  /** Save where the tables stand. Owner only (class @Roles). Unknown ids are dropped. */
  async saveLayout(user: AuthenticatedUser, layout: unknown) {
    const tenantId = this.tenantId(user);
    const tables = await this.prisma.restaurantTable.findMany({ where: { tenantId }, select: { id: true } });
    const clean = cleanLayout(layout, tables.map((t) => t.id));
    await this.prisma.setting.upsert({
      where: { tenantId_key: { tenantId, key: LAYOUT_KEY } },
      update: { value: clean as never }, create: { tenantId, key: LAYOUT_KEY, value: clean as never },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'tables.layout_updated', resourceType: 'tenant', resourceId: tenantId });
    return { layout: clean };
  }

  /**
   * Tables and where they stand, from the floor-plan sheet (table-import.ts):
   * created or updated by name, row / column turned into the map's spots.
   * One restaurant only — its tables, its layout row.
   */
  async importMany(user: AuthenticatedUser, rows: unknown[]) {
    const tenantId = this.tenantId(user);
    const [existing, layoutRow] = await Promise.all([
      this.prisma.restaurantTable.findMany({ where: { tenantId }, select: { id: true, name: true, seats: true, area: true, sortOrder: true } }),
      this.prisma.setting.findUnique({ where: { tenantId_key: { tenantId, key: LAYOUT_KEY } } }),
    ]);
    const current = withDefaults(existing.map((t) => ({ ...t, isActive: true })), cleanLayout(layoutRow?.value ?? {}, existing.map((t) => t.id)));
    const plan = planTableImport(existing, (Array.isArray(rows) ? rows : []) as TableImportRow[], current);
    const placed: Layout = {};
    for (const c of plan.create) {
      const t = await this.prisma.restaurantTable.create({ data: { tenantId, name: c.name, seats: c.seats, area: c.area, sortOrder: c.sortOrder } });
      if (c.spot) placed[t.id] = { x: c.spot.x ?? 0, y: c.spot.y ?? 0, shape: c.spot.shape ?? 'round', ...(c.spot.x === undefined ? { auto: true } : {}) } as never;
    }
    for (const u of plan.update) {
      if (Object.keys(u.data).length) await this.prisma.restaurantTable.updateMany({ where: { id: u.id, tenantId }, data: u.data });
      if (u.spot) placed[u.id] = { ...current[u.id], ...u.spot } as never;
    }
    if (Object.keys(placed).length) {
      const all = await this.prisma.restaurantTable.findMany({ where: { tenantId }, select: { id: true, name: true, seats: true, area: true, isActive: true, sortOrder: true } });
      const base = withDefaults(all, cleanLayout(layoutRow?.value ?? {}, all.map((t) => t.id)));
      // A new table given only a shape keeps the spot the map would give it.
      for (const [id, s] of Object.entries(placed) as Array<[string, { auto?: boolean; shape: Layout[string]['shape'] }]>) {
        if (s.auto) placed[id] = { ...base[id], shape: s.shape };
      }
      const merged = cleanLayout({ ...base, ...placed }, all.map((t) => t.id));
      await this.prisma.setting.upsert({
        where: { tenantId_key: { tenantId, key: LAYOUT_KEY } },
        update: { value: merged as never }, create: { tenantId, key: LAYOUT_KEY, value: merged as never },
      });
    }
    const result = { created: plan.create.length, updated: plan.update.length, unchanged: plan.same, skipped: plan.duplicate, errors: plan.error, placed: Object.keys(placed).length };
    await this.audit.log({ tenantId, userId: user.userId, action: 'tables.imported', resourceType: 'tenant', resourceId: tenantId, metadata: result });
    return result;
  }

  list(user: AuthenticatedUser) {
    return this.prisma.restaurantTable.findMany({
      where: { tenantId: this.tenantId(user) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async create(user: AuthenticatedUser, dto: CreateTableDto) {
    const tenantId = this.tenantId(user);
    const table = await this.prisma.restaurantTable.create({
      data: {
        tenantId,
        name: dto.name,
        seats: dto.seats,
        area: dto.area ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'table.created', resourceType: 'table', resourceId: table.id });
    return table;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateTableDto) {
    const tenantId = this.tenantId(user);
    const existing = await this.prisma.restaurantTable.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Table not found');
    const table = await this.prisma.restaurantTable.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        seats: dto.seats ?? undefined,
        area: dto.area ?? undefined,
        isActive: dto.isActive ?? undefined,
        sortOrder: dto.sortOrder ?? undefined,
      },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'table.updated', resourceType: 'table', resourceId: id });
    return table;
  }

  async remove(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const existing = await this.prisma.restaurantTable.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Table not found');
    await this.prisma.restaurantTable.delete({ where: { id } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'table.deleted', resourceType: 'table', resourceId: id });
    return { ok: true };
  }
}
