import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';

/**
 * Restaurant menu (dish catalog) — tenant-scoped like tables/staff. Every query
 * is scoped to the caller's own tenantId so no restaurant can read or touch
 * another's menu.
 */
@Injectable()
export class MenuService {
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
    return this.prisma.menuItem.findMany({
      where: { tenantId: this.tenantId(user) },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async create(user: AuthenticatedUser, dto: CreateMenuItemDto) {
    const tenantId = this.tenantId(user);
    const item = await this.prisma.menuItem.create({
      data: {
        tenantId,
        name: dto.name,
        category: dto.category ?? null,
        priceCents: dto.priceCents,
        description: dto.description ?? null,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'menu.created', resourceType: 'menu_item', resourceId: item.id });
    return item;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateMenuItemDto) {
    const tenantId = this.tenantId(user);
    const existing = await this.prisma.menuItem.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Menu item not found');
    const item = await this.prisma.menuItem.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        category: dto.category ?? undefined,
        priceCents: dto.priceCents ?? undefined,
        description: dto.description ?? undefined,
        isActive: dto.isActive ?? undefined,
        sortOrder: dto.sortOrder ?? undefined,
      },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'menu.updated', resourceType: 'menu_item', resourceId: id });
    return item;
  }

  async remove(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const existing = await this.prisma.menuItem.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Menu item not found');
    await this.prisma.menuItem.delete({ where: { id } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'menu.deleted', resourceType: 'menu_item', resourceId: id });
    return { ok: true };
  }
}
