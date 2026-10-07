import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { cleanLayout, tableStates, withDefaults } from './floor';

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
        where: { tenantId, tableId: { not: null }, startTime: { lt: dayEnd }, endTime: { gt: dayStart } },
        select: { id: true, tableId: true, startTime: true, endTime: true, status: true, partySize: true, customer: { select: { firstName: true } } },
      }),
    ]);
    const layout = withDefaults(tables, cleanLayout(row?.value ?? {}, tables.map((t) => t.id)));
    const states = tableStates(tables, res.map((r) => ({
      id: r.id, tableId: r.tableId, startTime: r.startTime, endTime: r.endTime, status: String(r.status), partySize: r.partySize ?? 1, customerName: r.customer?.firstName ?? null,
    })), at);
    return { at: at.toISOString(), tables, layout, states };
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
