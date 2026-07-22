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
// A service photo is EITHER a public https URL, OR an inline compressed image the
// salon uploaded (a small data: URL — the browser resizes it to ~640px first, so it
// is only tens of KB). Anything else is rejected so we never store a broken value.
const MAX_IMAGE_LEN = 700_000; // ~700KB — comfortably fits a compressed thumbnail
function cleanImageUrl(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  if (/^https:\/\/\S+$/.test(s)) return s.slice(0, 600);
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s) && s.length <= MAX_IMAGE_LEN) return s;
  return null;
}

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

  // A service photo must be a public https:// URL or nothing at all — an http or
  // junk value would render as a broken image on every customer's phone.
  private cleanImageUrl = cleanImageUrl;

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
          imageUrl: cleanImageUrl(dto.imageUrl),
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
    if (dto.imageUrl !== undefined) data.imageUrl = cleanImageUrl(dto.imageUrl);
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
  /**
   * Demo helper: give every service a relevant real photo (nail / spa) pulled by
   * keyword from a free stock service, so a fresh demo shop looks polished without
   * the owner uploading anything. Category + name decide the subject; a stable per-
   * service "lock" keeps the same photo each load while varying across services.
   * By default only fills services that have NO image; pass overwrite to replace all.
   */
  /** Build a category-themed gradient tile (self-drawn SVG data URL) — always on-topic,
   *  attractive, and 100% reliable (no external stock service returning random photos). */
  private sampleImageFor(name: string, category: string): string {
    const t = `${category} ${name}`.toLowerCase();
    const bottle = "<g fill='#fff' opacity='0.92'><rect x='222' y='118' width='36' height='18' rx='4'/><rect x='231' y='136' width='18' height='10'/><rect x='208' y='146' width='64' height='92' rx='16'/></g>";
    const stones = "<g fill='#fff'><ellipse cx='240' cy='212' rx='62' ry='20' opacity='0.95'/><ellipse cx='240' cy='182' rx='48' ry='16' opacity='0.85'/><ellipse cx='240' cy='157' rx='34' ry='12' opacity='0.78'/></g>";
    const leaf = "<g><path d='M240 108 C302 150 302 212 240 244 C178 212 178 150 240 108 Z' fill='#fff' opacity='0.92'/><path d='M240 120 L240 238' stroke='#0d9488' stroke-width='6' stroke-linecap='round'/></g>";
    const eye = "<g fill='none' stroke='#fff' stroke-width='9' stroke-linecap='round' opacity='0.95'><path d='M176 182 Q240 128 304 182 Q240 236 176 182 Z'/><circle cx='240' cy='182' r='16' fill='#fff'/><path d='M240 122 L240 100'/><path d='M206 134 L196 112'/><path d='M274 134 L284 112'/></g>";
    const flower = "<g fill='#fff' opacity='0.9'><ellipse cx='240' cy='138' rx='16' ry='30'/><ellipse cx='240' cy='222' rx='16' ry='30'/><ellipse cx='198' cy='180' rx='30' ry='16'/><ellipse cx='282' cy='180' rx='30' ry='16'/><ellipse cx='210' cy='150' rx='24' ry='15' transform='rotate(-45 210 150)'/><ellipse cx='270' cy='150' rx='24' ry='15' transform='rotate(45 270 150)'/><circle cx='240' cy='180' r='20'/></g>";
    const pick =
      /lash|brow/.test(t) ? { a: '#818cf8', b: '#4338ca', i: eye }
      : /facial|face|skin/.test(t) ? { a: '#34d399', b: '#047857', i: leaf }
      : /massage|body|stone|reflex/.test(t) ? { a: '#a78bfa', b: '#6d28d9', i: stones }
      : /pedi|toe|foot|feet/.test(t) ? { a: '#2dd4bf', b: '#0f766e', i: bottle }
      : /wax/.test(t) ? { a: '#fb7185', b: '#be123c', i: flower }
      : /nail|gel|acrylic|mani|polish|colour|color|shellac|ombre|french|design|dip|powder/.test(t) ? { a: '#f472b6', b: '#be185d', i: bottle }
      : { a: '#c084fc', b: '#7c2d92', i: flower };
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='480' height='360' viewBox='0 0 480 360'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${pick.a}'/><stop offset='1' stop-color='${pick.b}'/></linearGradient></defs><rect width='480' height='360' fill='url(#g)'/><circle cx='96' cy='72' r='150' fill='#fff' opacity='0.12'/><circle cx='430' cy='340' r='130' fill='#000' opacity='0.06'/>${pick.i}</svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  /** Fill sample photos for the current tenant's services (demo convenience). */
  async fillSampleImages(user: AuthenticatedUser, overwrite = false) {
    const tenantId = this.tenantId(user);
    const services = await this.prisma.service.findMany({
      where: { tenantId },
      select: { id: true, name: true, imageUrl: true, category: { select: { name: true } } },
    });
    // "Sample" = empty, an old loremflickr placeholder, or one of our own tiles. Those
    // get (re)filled; a real photo the salon uploaded is kept unless overwrite is set.
    const isSample = (u?: string | null) => {
      const v = (u ?? '').trim();
      return !v || v.includes('loremflickr.com') || v.startsWith('data:image/svg');
    };
    let updated = 0, skipped = 0;
    for (const svc of services) {
      if (!overwrite && !isSample(svc.imageUrl)) { skipped++; continue; }
      const url = this.sampleImageFor(svc.name, svc.category?.name ?? '');
      await this.prisma.service.update({ where: { id: svc.id }, data: { imageUrl: url } });
      updated++;
    }
    await this.audit.log({ tenantId, userId: user.userId, action: 'service.fill_sample_images', resourceType: 'tenant', resourceId: tenantId, metadata: { updated, skipped, overwrite } });
    return { updated, skipped };
  }

  async bulkImport(
    user: AuthenticatedUser,
    items: Array<{ category?: string; name: string; priceCents: number; durationMinutes?: number; priceFrom?: boolean; description?: string; imageUrl?: string }>,
    targetTenantId?: string,
  ) {
    // Super admin may aim at any salon; a salon admin is pinned to their own by
    // resolveTenantScope (a mismatched tenantId throws rather than leaking).
    const tenantId = resolveTenantScope(user, targetTenantId);
    if (!tenantId) throw new BadRequestException('A target salon is required');
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
          imageUrl: cleanImageUrl(raw.imageUrl),
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
