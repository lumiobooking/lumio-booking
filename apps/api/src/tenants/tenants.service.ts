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

  /** Super Admin resets a salon's admin login password. */
  async resetAdminPassword(id: string, password: string, actor: AuthenticatedUser) {
    await this.getById(id);
    if (!password || password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters');
    }
    const adminUser = await this.prisma.user.findFirst({
      where: { tenantId: id, role: UserRole.SALON_ADMIN },
      orderBy: { createdAt: 'asc' },
    });
    if (!adminUser) {
      throw new BadRequestException('This salon has no admin user to reset');
    }
    const passwordHash = await hashSecret(password);
    await this.prisma.user.update({ where: { id: adminUser.id }, data: { passwordHash } });
    await this.audit.log({
      tenantId: id,
      userId: actor.userId,
      action: 'tenant.admin_password_reset',
      resourceType: 'user',
      resourceId: adminUser.id,
    });
    return { ok: true, email: adminUser.email };
  }

  /** Plans list for the create/edit forms + plan management. */
  listPlans() {
    return this.prisma.plan.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        priceCents: true,
        currency: true,
        billingInterval: true,
        maxStaff: true,
        maxBookingsPerMonth: true,
        posEnabled: true,
        onlinePaymentEnabled: true,
        multiLocationEnabled: true,
        whiteLabelEnabled: true,
        isActive: true,
      },
      orderBy: { priceCents: 'asc' },
    });
  }

  async createPlan(user: AuthenticatedUser, dto: PlanInput) {
    const plan = await this.prisma.plan.create({ data: this.planData(dto) });
    await this.audit.log({ tenantId: null, userId: user.userId, action: 'plan.created', resourceType: 'plan', resourceId: plan.id });
    return plan;
  }

  async updatePlan(user: AuthenticatedUser, id: string, dto: PlanInput) {
    const exists = await this.prisma.plan.findUnique({ where: { id } });
    if (!exists) throw new BadRequestException('Plan not found');
    const plan = await this.prisma.plan.update({ where: { id }, data: this.planData(dto) });
    await this.audit.log({ tenantId: null, userId: user.userId, action: 'plan.updated', resourceType: 'plan', resourceId: id });
    return plan;
  }

  private planData(dto: PlanInput) {
    return {
      name: dto.name,
      description: dto.description ?? null,
      priceCents: dto.priceCents ?? 0,
      currency: dto.currency ?? 'USD',
      maxStaff: dto.maxStaff ?? null,
      maxBookingsPerMonth: dto.maxBookingsPerMonth ?? null,
      posEnabled: dto.posEnabled ?? false,
      onlinePaymentEnabled: dto.onlinePaymentEnabled ?? false,
      multiLocationEnabled: dto.multiLocationEnabled ?? false,
      whiteLabelEnabled: dto.whiteLabelEnabled ?? false,
      isActive: dto.isActive ?? true,
    };
  }

}

export interface PlanInput {
  name: string;
  description?: string;
  priceCents?: number;
  currency?: string;
  maxStaff?: number | null;
  maxBookingsPerMonth?: number | null;
  posEnabled?: boolean;
  onlinePaymentEnabled?: boolean;
  multiLocationEnabled?: boolean;
  whiteLabelEnabled?: boolean;
  isActive?: boolean;
}
