import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TenantStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { hashSecret } from '../auth/password.util';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { capsForLevel, levelOf, type SupportLevel } from './support-scope';

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

    /**
     * How much of this salon this particular employee may see.
     *
     * Read from their own row at the moment they step in, and then frozen into
     * the token: the session that did the work carries, in itself, the answer
     * to what it was allowed to do. Changing somebody's level therefore takes
     * effect the next time they enter a salon — which is a minute away and is
     * the price of an audit trail that cannot be rewritten after the fact.
     *
     * A SUPER_ADMIN entering a salon is not a setup employee and is not
     * narrowed: `levelOf` is only asked about a stored SUPPORT row.
     */
    const level: SupportLevel = user.role === UserRole.SUPER_ADMIN
      ? 'full'
      : levelOf(await this.levelOfAccount(user.userId));

    const payload: JwtPayload = {
      sub: user.userId, // the EMPLOYEE — audit logs stay honest
      email: user.email,
      role: UserRole.SALON_ADMIN, // borrow the salon admin scope: all guards just work
      tenantId: tenant.id,
      supportSession: true,
      supportLevel: level,
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
      metadata: { by: user.email, sessionHours: SESSION_HOURS, level },
    });

    return {
      accessToken,
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      // The screen stores these on the session so the salon menu draws the
      // right shape immediately, without a second round trip and without
      // guessing. The server does not trust them back — every request is
      // checked against the level inside the token (see SupportScopeGuard).
      level,
      capabilities: capsForLevel(level),
    };
  }

  /** The stored level for one SUPPORT row, or null when there is no such row. */
  private async levelOfAccount(userId: string): Promise<string | null> {
    const row = await this.prisma.user.findFirst({
      where: { id: userId, role: SUPPORT_ROLE },
      select: { supportLevel: true } as never,
    }).catch(() => null) as { supportLevel?: string | null } | null;
    return row?.supportLevel ?? null;
  }

  // ---- For the Super Admin (account management) ---------------------------

  async listAccounts() {
    const rows = await this.prisma.user.findMany({
      where: { role: SUPPORT_ROLE },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        isActive: true, lastLoginAt: true, createdAt: true, supportLevel: true,
      } as never,
      orderBy: { createdAt: 'desc' },
    }) as unknown as { supportLevel?: string | null }[];
    // Normalised on the way out, so the screen never has to decide what a null
    // means — and shows the same word the guard will act on.
    return rows.map((r) => ({ ...r, supportLevel: levelOf(r.supportLevel) }));
  }

  async createAccount(dto: { email?: string; password?: string; firstName?: string; lastName?: string; supportLevel?: string }) {
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
        supportLevel: levelOf(dto.supportLevel),
      } as never,
      select: { id: true, email: true, firstName: true, lastName: true, isActive: true, createdAt: true, supportLevel: true } as never,
    });
    return u;
  }

  /**
   * Change what one employee may see.
   *
   * Scoped to SUPPORT rows for the same reason as `setAccountActive`: this
   * endpoint must never become a way to re-level a salon owner. Takes effect
   * the next time they enter a salon — an open session keeps the level it was
   * minted with, which is stated on the screen rather than left to be
   * discovered.
   */
  async setAccountLevel(id: string, supportLevel: unknown) {
    const level = levelOf(supportLevel);
    const r = await this.prisma.user.updateMany({
      where: { id, role: SUPPORT_ROLE },
      data: { supportLevel: level } as never,
    });
    if (r.count === 0) throw new NotFoundException('Support account not found');
    return { id, supportLevel: level };
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
