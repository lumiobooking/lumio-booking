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
  businessType: true,
  contactEmail: true,
  planId: true,
  subscriptionStatus: true,
  billingExempt: true,
  accessUntil: true,
  accountGroupId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TenantSelect;

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---- Multi-branch (chain) account groups -------------------------------

  /** All chain groups with their branches + linked chain users (grouping UI). */
  async listGroups() {
    return this.prisma.accountGroup.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        createdAt: true,
        tenants: { where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' } },
        users: { select: { id: true, email: true, role: true }, orderBy: { email: 'asc' } },
      },
    });
  }

  /** Create a chain group. */
  async createGroup(user: AuthenticatedUser, name: string) {
    const clean = (name ?? '').trim();
    if (!clean) throw new BadRequestException('Group name is required');
    const group = await this.prisma.accountGroup.create({ data: { name: clean }, select: { id: true, name: true } });
    await this.audit.log({ tenantId: null, userId: user.userId, action: 'group.created', resourceType: 'account_group', resourceId: group.id });
    return group;
  }

  /** Rename a chain group. */
  async renameGroup(user: AuthenticatedUser, groupId: string, name: string) {
    const clean = (name ?? '').trim();
    if (!clean) throw new BadRequestException('Group name is required');
    const g = await this.prisma.accountGroup.findUnique({ where: { id: groupId }, select: { id: true } });
    if (!g) throw new NotFoundException('Group not found');
    await this.prisma.accountGroup.update({ where: { id: groupId }, data: { name: clean } });
    await this.audit.log({ tenantId: null, userId: user.userId, action: 'group.renamed', resourceType: 'account_group', resourceId: groupId });
    return { id: groupId, name: clean };
  }

  /** Assign (or clear, with null) a salon's chain group. */
  async setTenantGroup(user: AuthenticatedUser, tenantId: string, accountGroupId: string | null) {
    const tenant = await this.prisma.tenant.findFirst({ where: { id: tenantId, deletedAt: null }, select: { id: true } });
    if (!tenant) throw new NotFoundException('Salon not found');
    if (accountGroupId) {
      const g = await this.prisma.accountGroup.findUnique({ where: { id: accountGroupId }, select: { id: true } });
      if (!g) throw new NotFoundException('Group not found');
    }
    await this.prisma.tenant.update({ where: { id: tenantId }, data: { accountGroupId: accountGroupId || null } });
    await this.audit.log({ tenantId, userId: user.userId, action: 'group.tenant_set', resourceType: 'tenant', resourceId: tenantId });
    return { id: tenantId, accountGroupId: accountGroupId || null };
  }

  /** Link a user (by login email) to a chain group → that login can switch all its branches. */
  async linkUserToGroup(user: AuthenticatedUser, groupId: string, email: string) {
    const g = await this.prisma.accountGroup.findUnique({ where: { id: groupId }, select: { id: true } });
    if (!g) throw new NotFoundException('Group not found');
    const target = await this.prisma.user.findUnique({
      where: { email: (email ?? '').trim().toLowerCase() },
      select: { id: true, email: true },
    });
    if (!target) throw new NotFoundException('No user with that email');
    await this.prisma.user.update({ where: { id: target.id }, data: { accountGroupId: groupId } });
    await this.audit.log({ tenantId: null, userId: user.userId, action: 'group.user_linked', resourceType: 'user', resourceId: target.id });
    return { userId: target.id, email: target.email, accountGroupId: groupId };
  }

  /** Remove a user from their chain group. */
  async unlinkUserFromGroup(user: AuthenticatedUser, userId: string) {
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!target) throw new NotFoundException('User not found');
    await this.prisma.user.update({ where: { id: userId }, data: { accountGroupId: null } });
    await this.audit.log({ tenantId: null, userId: user.userId, action: 'group.user_unlinked', resourceType: 'user', resourceId: userId });
    return { userId, accountGroupId: null };
  }

  /** Delete a chain group. Branches + linked users are simply unlinked (their own
   * data is untouched). */
  async deleteGroup(user: AuthenticatedUser, groupId: string) {
    const g = await this.prisma.accountGroup.findUnique({ where: { id: groupId }, select: { id: true } });
    if (!g) throw new NotFoundException('Group not found');
    await this.prisma.tenant.updateMany({ where: { accountGroupId: groupId }, data: { accountGroupId: null } });
    await this.prisma.user.updateMany({ where: { accountGroupId: groupId }, data: { accountGroupId: null } });
    await this.prisma.accountGroup.delete({ where: { id: groupId } });
    await this.audit.log({ tenantId: null, userId: user.userId, action: 'group.deleted', resourceType: 'account_group', resourceId: groupId });
    return { id: groupId, deleted: true };
  }

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
      select: {
        ...TENANT_PUBLIC_SELECT,
        _count: { select: { users: true, staffMembers: true } },
        // The salon's admin login email (first SALON_ADMIN) so the UI can show it.
        users: { where: { role: UserRole.SALON_ADMIN }, select: { email: true }, orderBy: { createdAt: 'asc' }, take: 1 },
        // Assigned AI-hotline number so the Super Admin can manage it inline.
        voiceLine: { select: { lumioNumber: true, enabled: true } },
      },
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
        businessType: dto.businessType,
      },
      select: TENANT_PUBLIC_SELECT,
    });

    // A restaurant needs at least one "reservation service" so the booking core
    // (which requires a serviceId) works. Seed a default one the first time.
    if (dto.businessType === 'RESTAURANT') {
      const svcCount = await this.prisma.service.count({ where: { tenantId: id } });
      if (svcCount === 0) {
        await this.prisma.service.create({
          data: { tenantId: id, name: 'Table reservation', durationMinutes: 90, priceCents: 0, currency: 'USD', isActive: true },
        });
      }
    }

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
    // passwordChangedAt forces the salon admin to sign in again (old tokens die).
    await this.prisma.user.update({ where: { id: adminUser.id }, data: { passwordHash, passwordChangedAt: new Date() } });
    await this.audit.log({
      tenantId: id,
      userId: actor.userId,
      action: 'tenant.admin_password_reset',
      resourceType: 'user',
      resourceId: adminUser.id,
    });
    return { ok: true, email: adminUser.email };
  }

  /**
   * Super Admin sets manual access for a salon, independent of billing:
   *  - billingExempt: free salon (always open).
   *  - accessUntil: lock the salon after this date (null = no expiry).
   * Status is recalculated immediately so the change takes effect at once.
   */
  async setAccess(id: string, dto: { billingExempt?: boolean; accessUntil?: string | null }, actor: AuthenticatedUser) {
    const tenant = await this.prisma.tenant.findFirst({ where: { id, deletedAt: null }, select: { id: true, billingExempt: true, accessUntil: true } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const billingExempt = typeof dto.billingExempt === 'boolean' ? dto.billingExempt : tenant.billingExempt;
    let accessUntil: Date | null = tenant.accessUntil;
    if (dto.accessUntil !== undefined) accessUntil = dto.accessUntil ? new Date(dto.accessUntil) : null;

    // Decide the resulting status: open unless a non-exempt salon is past its date.
    const expired = !billingExempt && !!accessUntil && accessUntil.getTime() < Date.now();
    const status = expired ? TenantStatus.SUSPENDED : TenantStatus.ACTIVE;

    await this.prisma.tenant.update({ where: { id }, data: { billingExempt, accessUntil, status } });
    await this.audit.log({ tenantId: id, userId: actor.userId, action: 'tenant.access_updated', resourceType: 'tenant', resourceId: id, metadata: { billingExempt, accessUntil: accessUntil?.toISOString() ?? null, status } });
    return { id, billingExempt, accessUntil: accessUntil?.toISOString() ?? null, status };
  }

  /** Super Admin changes a salon's admin LOGIN email. */
  async updateAdminEmail(id: string, newEmail: string, actor: AuthenticatedUser) {
    await this.getById(id);
    const email = (newEmail ?? '').trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new BadRequestException('Please enter a valid email address');
    }
    const adminUser = await this.prisma.user.findFirst({
      where: { tenantId: id, role: UserRole.SALON_ADMIN },
      orderBy: { createdAt: 'asc' },
    });
    if (!adminUser) {
      throw new BadRequestException('This salon has no admin user');
    }
    if (email === adminUser.email) {
      return { ok: true, email };
    }
    const clash = await this.prisma.user.findUnique({ where: { email } });
    if (clash) {
      throw new ConflictException('That email is already used by another account');
    }
    await this.prisma.user.update({ where: { id: adminUser.id }, data: { email } });
    await this.audit.log({
      tenantId: id,
      userId: actor.userId,
      action: 'tenant.admin_email_changed',
      resourceType: 'user',
      resourceId: adminUser.id,
      metadata: { from: adminUser.email, to: email },
    });
    return { ok: true, email };
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
        priceMonthlyCents: true,
        priceYearlyCents: true,
        trialDays: true,
        tagline: true,
        featuresJson: true,
        publicVisible: true,
        highlighted: true,
        sortOrder: true,
        stripePriceMonthlyId: true,
        stripePriceYearlyId: true,
        paypalPlanMonthlyId: true,
        paypalPlanYearlyId: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { priceMonthlyCents: 'asc' }],
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
    // Keep legacy priceCents in sync with the monthly price for older readers.
    const monthly = dto.priceMonthlyCents ?? dto.priceCents ?? 0;
    return {
      name: dto.name,
      description: dto.description ?? null,
      priceCents: monthly,
      currency: dto.currency ?? 'USD',
      maxStaff: dto.maxStaff ?? null,
      maxBookingsPerMonth: dto.maxBookingsPerMonth ?? null,
      posEnabled: dto.posEnabled ?? false,
      onlinePaymentEnabled: dto.onlinePaymentEnabled ?? false,
      multiLocationEnabled: dto.multiLocationEnabled ?? false,
      whiteLabelEnabled: dto.whiteLabelEnabled ?? false,
      isActive: dto.isActive ?? true,
      priceMonthlyCents: monthly,
      priceYearlyCents: dto.priceYearlyCents ?? 0,
      trialDays: dto.trialDays ?? 14,
      tagline: dto.tagline ?? null,
      featuresJson: Array.isArray(dto.features) ? dto.features : [],
      publicVisible: dto.publicVisible ?? false,
      highlighted: dto.highlighted ?? false,
      sortOrder: dto.sortOrder ?? 0,
      // Note: Stripe/PayPal provider IDs are NOT set here — they're auto-managed
      // by the billing service (PayPal plans are cached on first checkout), so
      // editing a plan must never overwrite them.
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
  priceMonthlyCents?: number;
  priceYearlyCents?: number;
  trialDays?: number;
  tagline?: string | null;
  features?: string[];
  publicVisible?: boolean;
  highlighted?: boolean;
  sortOrder?: number;
  stripePriceMonthlyId?: string | null;
  stripePriceYearlyId?: string | null;
  paypalPlanMonthlyId?: string | null;
  paypalPlanYearlyId?: string | null;
}
