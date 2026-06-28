import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { CreateServiceAddonDto } from './dto/create-addon.dto';

/**
 * Services (treatments) belong to exactly one tenant. Every method resolves the
 * caller's tenantId from the signed token and filters by it, so a salon can
 * only ever read/modify its own services.
 */
@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Helper: the tenantId the current request is locked to (never null here
  // because these routes are restricted to SALON_ADMIN).
  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) {
      throw new NotFoundException('No tenant context');
    }
    return id;
  }

  /** Returns the categoryId if it belongs to this tenant, else null. */
  private async validCategoryId(tenantId: string, categoryId?: string | null): Promise<string | null> {
    if (!categoryId) return null;
    const cat = await this.prisma.serviceCategory.findFirst({ where: { id: categoryId, tenantId }, select: { id: true } });
    return cat ? cat.id : null;
  }

  /** Guards that every staffId belongs to this tenant before we link them. */
  private async assertStaffBelongToTenant(tenantId: string, staffIds: string[]) {
    if (staffIds.length === 0) return;
    const count = await this.prisma.staffMember.count({ where: { tenantId, id: { in: staffIds } } });
    if (count !== new Set(staffIds).size) {
      throw new BadRequestException('One or more staffIds are invalid for this tenant');
    }
  }

  list(user: AuthenticatedUser) {
    return this.prisma.service.findMany({
      where: { tenantId: this.tenantId(user) },
      include: {
        category: { select: { id: true, name: true } },
        staffServices: { select: { staffMemberId: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  // ---- Categories (menu groups) ------------------------------------------

  listCategories(user: AuthenticatedUser) {
    return this.prisma.serviceCategory.findMany({
      where: { tenantId: this.tenantId(user) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createCategory(user: AuthenticatedUser, dto: { name: string; icon?: string; sortOrder?: number }) {
    const tenantId = this.tenantId(user);
    const cat = await this.prisma.serviceCategory.create({
      data: { tenantId, name: dto.name, icon: dto.icon ?? null, sortOrder: dto.sortOrder ?? 0 },
    });
    await this.audit.log({ tenantId, userId: user.userId, action: 'service_category.created', resourceType: 'service_category', resourceId: cat.id, metadata: { name: cat.name } });
    return cat;
  }

  async updateCategory(user: AuthenticatedUser, id: string, dto: { name?: string; icon?: string; sortOrder?: number; isActive?: boolean }) {
    const tenantId = this.tenantId(user);
    const exists = await this.prisma.serviceCategory.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Category not found');
    await this.prisma.serviceCategory.updateMany({
      where: { id, tenantId },
      data: { name: dto.name, icon: dto.icon, sortOrder: dto.sortOrder, isActive: dto.isActive },
    });
    return this.prisma.serviceCategory.findFirst({ where: { id, tenantId } });
  }

  async removeCategory(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const exists = await this.prisma.serviceCategory.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Category not found');
    // Services keep existing but become uncategorised (FK is SET NULL).
    await this.prisma.serviceCategory.deleteMany({ where: { id, tenantId } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'service_category.deleted', resourceType: 'service_category', resourceId: id });
    return { id, deleted: true };
  }

  async getById(user: AuthenticatedUser, id: string) {
    // Filtering by BOTH id and tenantId means another tenant's id returns 404.
    const service = await this.prisma.service.findFirst({
      where: { id, tenantId: this.tenantId(user) },
      include: { staffServices: { select: { staffMemberId: true } } },
    });
    if (!service) {
      throw new NotFoundException('Service not found');
    }
    return service;
  }

  async create(user: AuthenticatedUser, dto: CreateServiceDto) {
    const tenantId = this.tenantId(user);
    const staffIds = dto.staffIds ?? [];
    await this.assertStaffBelongToTenant(tenantId, staffIds);
    const categoryId = await this.validCategoryId(tenantId, dto.categoryId);
    const service = await this.prisma.$transaction(async (tx) => {
      const created = await tx.service.create({
        data: {
          tenantId,
          name: dto.name,
          description: dto.description ?? null,
          durationMinutes: dto.durationMinutes,
          priceCents: dto.priceCents,
          discountPercent: dto.discountPercent ?? 0,
          currency: dto.currency ?? 'USD',
          isActive: dto.isActive ?? true,
          categoryId,
          sortOrder: dto.sortOrder ?? 0,
          isFeatured: dto.isFeatured ?? false,
          priceFrom: dto.priceFrom ?? false,
        },
      });
      if (staffIds.length > 0) {
        await tx.staffService.createMany({
          data: staffIds.map((staffMemberId) => ({ tenantId, staffMemberId, serviceId: created.id })),
          skipDuplicates: true,
        });
      }
      return created;
    });
    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: 'service.created',
      resourceType: 'service',
      resourceId: service.id,
      metadata: { name: service.name },
    });
    return service;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateServiceDto) {
    const tenantId = this.tenantId(user);
    await this.getById(user, id); // enforces tenant ownership / 404

    if (dto.staffIds !== undefined) {
      await this.assertStaffBelongToTenant(tenantId, dto.staffIds);
    }

    const data: Prisma.ServiceUncheckedUpdateInput = {
      name: dto.name,
      description: dto.description,
      durationMinutes: dto.durationMinutes,
      priceCents: dto.priceCents,
      discountPercent: dto.discountPercent,
      currency: dto.currency,
      isActive: dto.isActive,
      sortOrder: dto.sortOrder,
      isFeatured: dto.isFeatured,
      priceFrom: dto.priceFrom,
    };
    // categoryId: only touch when provided (null clears it).
    if (dto.categoryId !== undefined) {
      data.categoryId = dto.categoryId ? await this.validCategoryId(tenantId, dto.categoryId) : null;
    }

    // updateMany with tenantId in the filter is a second safety net so a forged
    // id can never update another tenant's row. The staff sync runs in the same
    // transaction so the service and its team always change together.
    await this.prisma.$transaction(async (tx) => {
      await tx.service.updateMany({ where: { id, tenantId }, data });
      if (dto.staffIds !== undefined) {
        await tx.staffService.deleteMany({ where: { tenantId, serviceId: id } });
        if (dto.staffIds.length > 0) {
          await tx.staffService.createMany({
            data: dto.staffIds.map((staffMemberId) => ({ tenantId, staffMemberId, serviceId: id })),
            skipDuplicates: true,
          });
        }
      }
    });

    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: 'service.updated',
      resourceType: 'service',
      resourceId: id,
      metadata: { ...dto },
    });

    return this.getById(user, id);
  }

  async remove(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    await this.getById(user, id);
    await this.prisma.service.deleteMany({ where: { id, tenantId } });
    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: 'service.deleted',
      resourceType: 'service',
      resourceId: id,
    });
    return { id, deleted: true };
  }

  /**
   * Bulk-create a whole menu in one call (used by the in-app "Import menu" tool).
   * Categories are created on demand (matched by name), services are deduped by
   * name within the tenant so re-running is safe. Tenant-scoped throughout.
   */
  async bulkImport(
    user: AuthenticatedUser,
    items: Array<{ category?: string; name: string; priceCents: number; durationMinutes?: number; priceFrom?: boolean; description?: string }>,
  ) {
    const tenantId = this.tenantId(user);
    if (!Array.isArray(items) || items.length === 0) throw new BadRequestException('Nothing to import');
    if (items.length > 500) throw new BadRequestException('Too many rows (max 500)');

    const [cats, svcs] = await Promise.all([
      this.prisma.serviceCategory.findMany({ where: { tenantId }, select: { id: true, name: true } }),
      this.prisma.service.findMany({ where: { tenantId }, select: { name: true } }),
    ]);
    const catByName = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]));
    const have = new Set(svcs.map((s) => s.name.toLowerCase()));
    let sort = cats.length;
    let createdCategories = 0, createdServices = 0, skipped = 0;
    const orderByCat = new Map<string, number>();

    for (const raw of items) {
      const name = (raw?.name ?? '').trim();
      if (!name) { skipped++; continue; }
      if (have.has(name.toLowerCase())) { skipped++; continue; }

      let categoryId: string | null = null;
      const catName = (raw.category ?? '').trim();
      if (catName) {
        const key = catName.toLowerCase();
        let id = catByName.get(key);
        if (!id) {
          const cat = await this.prisma.serviceCategory.create({ data: { tenantId, name: catName.slice(0, 60), sortOrder: sort++ } });
          id = cat.id; catByName.set(key, id); createdCategories++;
        }
        categoryId = id;
      }
      const order = orderByCat.get(categoryId ?? '') ?? 0;
      orderByCat.set(categoryId ?? '', order + 1);

      await this.prisma.service.create({
        data: {
          tenantId,
          name: name.slice(0, 120),
          description: raw.description?.slice(0, 500) || null,
          durationMinutes: Math.min(600, Math.max(5, Math.round(Number(raw.durationMinutes) || 30))),
          priceCents: Math.max(0, Math.round(Number(raw.priceCents) || 0)),
          priceFrom: !!raw.priceFrom,
          categoryId, sortOrder: order, isActive: true, currency: 'USD',
        },
      });
      have.add(name.toLowerCase());
      createdServices++;
    }
    await this.audit.log({ tenantId, userId: user.userId, action: 'service.bulk_import', resourceType: 'tenant', resourceId: tenantId, metadata: { createdCategories, createdServices, skipped } });
    return { createdCategories, createdServices, skipped };
  }

  // ---- Service add-ons (extras) ------------------------------------------

  /** All active add-ons for the tenant, with parent service name (POS catalog). */
  listAllAddons(user: AuthenticatedUser) {
    return this.prisma.serviceAddon.findMany({
      where: { tenantId: this.tenantId(user), isActive: true },
      select: {
        id: true,
        name: true,
        priceCents: true,
        durationMinutes: true,
        currency: true,
        serviceId: true,
        service: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listAddons(user: AuthenticatedUser, serviceId: string) {
    await this.getById(user, serviceId); // ensures the service is in this tenant
    return this.prisma.serviceAddon.findMany({
      where: { serviceId, tenantId: this.tenantId(user) },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createAddon(user: AuthenticatedUser, serviceId: string, dto: CreateServiceAddonDto) {
    const tenantId = this.tenantId(user);
    await this.getById(user, serviceId);
    const addon = await this.prisma.serviceAddon.create({
      data: {
        tenantId,
        serviceId,
        name: dto.name,
        durationMinutes: dto.durationMinutes,
        priceCents: dto.priceCents,
        isActive: dto.isActive ?? true,
      },
    });
    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: 'service_addon.created',
      resourceType: 'service_addon',
      resourceId: addon.id,
      metadata: { serviceId, name: dto.name },
    });
    return addon;
  }

  async removeAddon(user: AuthenticatedUser, serviceId: string, addonId: string) {
    const tenantId = this.tenantId(user);
    await this.getById(user, serviceId);
    await this.prisma.serviceAddon.deleteMany({ where: { id: addonId, serviceId, tenantId } });
    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: 'service_addon.deleted',
      resourceType: 'service_addon',
      resourceId: addonId,
    });
    return { id: addonId, deleted: true };
  }
}
