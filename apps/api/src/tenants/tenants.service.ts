import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, TenantStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { hashSecret } from '../auth/password.util';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { ListTenantsDto } from './dto/list-tenants.dto';
import { uniqueSlug } from './slug.util';

const TENANT_PUBLIC_SELECT = {
  id: true,
  name: true,
  slug: true,
  status: true,
  timezone: true,
  contactEmail: true,
  planId: true,
  subscriptionStatus: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TenantSelect;

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** List tenants (platform-wide). SUPER_ADMIN only. */
  async list(filters: ListTenantsDto) {
    const where: Prisma.TenantWhereInput = { deletedAt: null };
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { slug: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.tenant.findMany({
      where,
      select: { ...TENANT_PUBLIC_SELECT, _count: { select: { users: true, staffMembers: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(id: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id, deletedAt: null },
      select: TENANT_PUBLIC_SELECT,
    });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return tenant;
  }

  /**
   * Creates a tenant + its first Salon Admin in a single transaction so we
   * never end up with a salon that has no way to log in.
   */
  async create(dto: CreateTenantDto, actor: AuthenticatedUser) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.adminEmail.toLowerCase() },
    });
    if (existingUser) {
      throw new ConflictException('A user with this email already exists');
    }

    if (dto.planId) {
      const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
      if (!plan) {
        throw new BadRequestException('Invalid planId');
      }
    }

    // Build a unique slug from the name against existing slugs.
    const existingSlugs = await this.prisma.tenant.findMany({ select: { slug: true } });
    const slug = uniqueSlug(dto.name, new Set(existingSlugs.map((t) => t.slug)));

    const passwordHash = await hashSecret(dto.adminPassword);

    const tenant = await this.prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          name: dto.name,
          slug,
          timezone: dto.timezone ?? 'UTC',
          contactEmail: dto.contactEmail ?? dto.adminEmail.toLowerCase(),
          planId: dto.planId ?? null,
          subscriptions: dto.planId
            ? { create: { planId: dto.planId, status: 'TRIALING' } }
            : undefined,
        },
        select: TENANT_PUBLIC_SELECT,
      });

      await tx.user.create({
        data: {
          tenantId: created.id,
          role: UserRole.SALON_ADMIN,
          email: dto.adminEmail.toLowerCase(),
          passwordHash,
          firstName: dto.adminFirstName ?? null,
          lastName: dto.adminLastName ?? null,
        },
      });

      return created;
    });

    await this.audit.log({
      tenantId: tenant.id,
      userId: actor.userId,
      action: 'tenant.created',
      resourceType: 'tenant',
      resourceId: tenant.id,
      metadata: { name: tenant.name, slug: tenant.slug, adminEmail: dto.adminEmail.toLowerCase() },
    });

    return tenant;
  }

  async update(id: string, dto: UpdateTenantDto, actor: AuthenticatedUser) {
    await this.getById(id); // 404 if missing

    if (dto.planId) {
      const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
      if (!plan) {
        throw new BadRequestException('Invalid planId');
      }
    }

    const updated = await this.prisma.tenant.update({
      where: { id },
      data: {
        name: dto.name,
        timezone: dto.timezone,
        planId: dto.planId,
        contactEmail: dto.contactEmail,
      },
      select: TENANT_PUBLIC_SELECT,
    });

    await this.audit.log({
      tenantId: id,
      userId: actor.userId,
      action: 'tenant.updated',
      resourceType: 'tenant',
      resourceId: id,
      metadata: { ...dto },
    });

    return updated;
  }

  /** Change tenant status (suspend / reactivate / cancel) with audit trail. */
  private async setStatus(
    id: string,
    status: TenantStatus,
    action: string,
    actor: AuthenticatedUser,
  ) {
    await this.getById(id);
    const updated = await this.prisma.tenant.update({
      where: { id },
      data: { status, subscriptionStatus: status === 'ACTIVE' ? undefined : 'PAST_DUE' },
      select: TENANT_PUBLIC_SELECT,
    });
    await this.audit.log({
      tenantId: id,
      userId: actor.userId,
      action,
      resourceType: 'tenant',
      resourceId: id,
      metadata: { status },
    });
    return updated;
  }

  suspend(id: string, actor: AuthenticatedUser) {
    return this.setStatus(id, TenantStatus.SUSPENDED, 'tenant.suspended', actor);
  }

  reactivate(id: string, actor: AuthenticatedUser) {
    return this.setStatus(id, TenantStatus.ACTIVE, 'tenant.reactivated', actor);
  }

  /** Soft delete: mark cancelled + set deletedAt. Data is retained. */
  async remove(id: string, actor: AuthenticatedUser) {
    await this.getById(id);
    const updated = await this.prisma.tenant.update({
      where: { id },
      data: { status: TenantStatus.CANCELLED, deletedAt: new Date() },
      select: { id: true, status: true },
    });
    await this.audit.log({
      tenantId: id,
      userId: actor.userId,
      action: 'tenant.deleted',
      resourceType: 'tenant',
      resourceId: id,
    });
    return updated;
  }

  /** Plans list for the create/edit forms. */
  listPlans() {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        priceCents: true,
        currency: true,
        billingInterval: true,
        maxStaff: true,
        maxBookingsPerMonth: true,
      },
      orderBy: { priceCents: 'asc' },
    });
  }
}
