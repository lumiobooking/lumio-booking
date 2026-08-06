import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TenantStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { hashSecret } from '../auth/password.util';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

/**
 * Lumio SUPPORT staff: one login that can set up ANY salon — without being a
 * platform admin and without punching holes in tenant isolation.
 *
 * The trick: a SUPPORT account by itself can read no salon data at all. To
 * work, it "enters" ONE salon and receives a short-lived token whose role and
 * tenantId are exactly those of a normal SALON_ADMIN. Every existing guard,
 * scope check and audit path then behaves as if a salon admin were acting —
 * except the userId stays the employee's (so audit names the real person) and
 * a supportSession flag unlocks the platform-managed setup screens.
 */

// The generated Prisma client in this sandbox may predate the SUPPORT enum
// value; the runtime value is just a string, and the migration adds it to the
// DB type. Keep one cast, here.
export const SUPPORT_ROLE = 'SUPPORT' as UserRole;

/** Long enough for a working day at one salon, short enough to expire by itself. */
const SESSION_HOURS = 8;

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  // ---- For the setup staff -------------------------------------------------

  /**
   * The salon list a SUPPORT user may pick from. Deliberately thin: name, slug
   * and status only — no revenue, no counts, no settings. Everything else
   * requires entering the salon (which is audited).
   */
  async listTenants() {
    return this.prisma.tenant.findMany({
      select: { id: true, name: true, slug: true, status: true, createdAt: true },
      orderBy: { name: 'asc' },
      take: 500,
    });
  }

  /**
   * Step into one salon: mint an 8-hour token scoped to that tenant with the
   * powers of its salon admin. Tenant isolation is untouched — inside the
   * session, cross-tenant requests fail exactly as they do for a real admin.
   */
  async enterSalon(user: AuthenticatedUser, tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, slug: true, status: true },
    });
    if (!tenant) throw new NotFoundException('Salon not found');
    if (tenant.status === TenantStatus.SUSPENDED) {
      throw new ForbiddenException('This salon is suspended — reactivate it first.');
    }

    const payload: JwtPayload = {
      sub: user.userId, // the EMPLOYEE — audit logs stay honest
      email: user.email,
      role: UserRole.SALON_ADMIN, // borrow the salon admin scope: all guards just work
      tenantId: tenant.id,
      supportSession: true,
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('JWT_SECRET') ?? 'insecure_dev_secret_change_me',
      expiresIn: `${SESSION_HOURS}h`,
    });

    await this.audit.log({
      tenantId: tenant.id,
      userId: user.userId,
      action: 'support.entered_salon',
      resourceType: 'tenant',
      resourceId: tenant.id,
      metadata: { by: user.email, sessionHours: SESSION_HOURS },
    });

    return { accessToken, tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug } };
  }

  // ---- For the Super Admin (account management) ---------------------------

  async listAccounts() {
    return this.prisma.user.findMany({
      where: { role: SUPPORT_ROLE },
      select: { id: true, email: true, firstName: true, lastName: true, isActive: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createAccount(dto: { email?: string; password?: string; firstName?: string; lastName?: string }) {
    const email = (dto.email || '').trim().toLowerCase();
    const password = dto.password || '';
    if (!/.+@.+\..+/.test(email)) throw new BadRequestException('Enter a valid email.');
    if (password.length < 8) throw new BadRequestException('Password must be at least 8 characters.');
    const exists = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (exists) throw new BadRequestException('An account with this email already exists.');
    const u = await this.prisma.user.create({
      data: {
        email,
        passwordHash: await hashSecret(password),
        role: SUPPORT_ROLE,
        tenantId: null, // no home salon — access happens only via audited sessions
        firstName: (dto.firstName || 'Support').slice(0, 60),
        lastName: (dto.lastName || '').slice(0, 60) || null,
        isActive: true,
      },
      select: { id: true, email: true, firstName: true, lastName: true, isActive: true, createdAt: true },
    });
    return u;
  }

  /**
   * Turn an account on/off. Restricted to role SUPPORT rows so this endpoint
   * can never be used to disable an owner or another platform admin.
   */
  async setAccountActive(id: string, isActive: boolean) {
    const r = await this.prisma.user.updateMany({
      where: { id, role: SUPPORT_ROLE },
      data: { isActive },
    });
    if (r.count === 0) throw new NotFoundException('Support account not found');
    return { id, isActive };
  }
}
