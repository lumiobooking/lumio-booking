import { Injectable, NotFoundException } from '@nestjs/common';
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

  list(user: AuthenticatedUser) {
    return this.prisma.service.findMany({
      where: { tenantId: this.tenantId(user) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(user: AuthenticatedUser, id: string) {
    // Filtering by BOTH id and tenantId means another tenant's id returns 404.
    const service = await this.prisma.service.findFirst({
      where: { id, tenantId: this.tenantId(user) },
    });
    if (!service) {
      throw new NotFoundException('Service not found');
    }
    return service;
  }

  async create(user: AuthenticatedUser, dto: CreateServiceDto) {
    const tenantId = this.tenantId(user);
    const service = await this.prisma.service.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description ?? null,
        durationMinutes: dto.durationMinutes,
        priceCents: dto.priceCents,
        discountPercent: dto.discountPercent ?? 0,
        currency: dto.currency ?? 'USD',
        isActive: dto.isActive ?? true,
      },
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

    const data: Prisma.ServiceUpdateInput = {
      name: dto.name,
      description: dto.description,
      durationMinutes: dto.durationMinutes,
      priceCents: dto.priceCents,
      discountPercent: dto.discountPercent,
      currency: dto.currency,
      isActive: dto.isActive,
    };

    // updateMany with tenantId in the filter is a second safety net so a forged
    // id can never update another tenant's row.
    await this.prisma.service.updateMany({ where: { id, tenantId }, data });

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
