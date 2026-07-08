import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';

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
