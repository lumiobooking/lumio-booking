import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { StaffRole, TenantStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashSecret, verifySecret } from './password.util';
import { canBootstrap, passwordProblem } from './bootstrap.guard';
import { JwtPayload } from './strategies/jwt.strategy';
import { capabilitiesFor, cleanStaffCaps } from './capabilities';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Create the very first Super Admin, once, on an empty deployment.
   *
   * A new market means a new database with nobody in it, and this API only
   * offers login — so without this there is no way in at all. The seed script
   * is not an answer: it writes demo salons and a password published in this
   * repository.
   *
   * Two locks, checked in canBootstrap(): BOOTSTRAP_TOKEN must be set and
   * presented, and the database must contain zero users. The second one closes
   * the door permanently the moment this succeeds — a fact about the data, not
   * a flag anyone has to remember to turn off — which is what makes it safe to
   * leave this endpoint in the code.
   */
  async bootstrapSuperAdmin(input: {
    email: string; password: string; token: string; firstName: string; lastName: string;
  }) {
    const userCount = await this.prisma.user.count();
    const verdict = canBootstrap({
      userCount,
      expectedToken: this.config.get<string>('BOOTSTRAP_TOKEN'),
      givenToken: input.token,
    });
    if (!verdict.allowed) {
      // Deliberately vague to a caller who should not be here: a wrong token
      // and an already-claimed system look the same from outside.
      if (verdict.reason === 'already-set-up') {
        throw new ForbiddenException('This system already has an account. Sign in instead.');
      }
      throw new ForbiddenException('Setup is not available.');
    }

    const problem = passwordProblem(input.password);
    if (problem) throw new BadRequestException(problem);

    const email = input.email.trim().toLowerCase();
    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash: await hashSecret(input.password),
        role: UserRole.SUPER_ADMIN,
        firstName: input.firstName.trim() || 'Lumio',
        lastName: input.lastName.trim() || 'Admin',
        tenantId: null,
      },
      select: { id: true, email: true },
    });
    return { created: true, email: user.email };
  }

  /**
   * Validates credentials and issues an access token. The token carries the
   * user's tenantId so all downstream tenant scoping is derived from a signed,
   * tamper-proof source rather than client input.
   */
  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { tenant: true },
    });

    // Generic message to avoid leaking which part failed.
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordOk = await verifySecret(password, user.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Access control (super admin has no tenant). Free salons always pass.
    if (user.tenant && !user.tenant.billingExempt) {
      const t = user.tenant;
      if (t.status !== TenantStatus.ACTIVE) {
        if (t.status === TenantStatus.PENDING) {
          throw new UnauthorizedException('Your account is awaiting payment. Please complete checkout to activate it.');
        }
        throw new UnauthorizedException('This salon account is not active. Please contact support.');
      }
      // Hard expiry set by the platform admin.
      if (t.accessUntil && new Date(t.accessUntil).getTime() < Date.now()) {
        throw new UnauthorizedException('Your access period has ended. Please renew to continue.');
      }
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // A STAFF login carries its feature-permission sub-role (cashier/tech/manager).
    let staffRole: StaffRole | null = null;
    // …and, when the owner adjusted this person, their own list of screens.
    let staffCaps: string[] | undefined;
    if (user.role === UserRole.STAFF) {
      const sm = await this.prisma.staffMember.findFirst({ where: { userId: user.id }, select: { staffRole: true, permissions: true } as never }) as { staffRole: StaffRole | null; permissions?: unknown } | null;
      staffRole = sm?.staffRole ?? null;
      staffCaps = cleanStaffCaps(sm?.permissions) ?? undefined;
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      staffRole,
      ...(staffCaps ? { staffCaps } : {}),
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('JWT_SECRET') ?? 'insecure_dev_secret_change_me',
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m',
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
        firstName: user.firstName,
        lastName: user.lastName,
        staffRole,
        capabilities: capabilitiesFor(user.role, staffRole, staffCaps),
      },
    };
  }

  /**
   * "Đổi mật khẩu" — anyone signed in changes their OWN password, proving the
   * current one. Support sessions cannot (they are not the account's owner).
   */
  async changeOwnPassword(user: { userId: string; supportSession?: boolean }, current: string, next: string) {
    if (user.supportSession) throw new UnauthorizedException('A support session cannot change this password.');
    if (typeof next !== 'string' || next.length < 8) throw new BadRequestException('The new password must be at least 8 characters.');
    if (next === current) throw new BadRequestException('The new password must be different.');
    const row = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { id: true, passwordHash: true, isActive: true } });
    if (!row || !row.isActive) throw new UnauthorizedException();
    if (!(await verifySecret(String(current ?? ''), row.passwordHash))) throw new BadRequestException('The current password is not right.');
    await this.prisma.user.update({ where: { id: row.id }, data: { passwordHash: await hashSecret(next) } });
    return { ok: true };
  }
}
