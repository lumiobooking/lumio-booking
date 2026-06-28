import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { StaffRole, TenantStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { verifySecret } from './password.util';
import { JwtPayload } from './strategies/jwt.strategy';
import { capabilitiesFor } from './capabilities';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

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
    if (user.role === UserRole.STAFF) {
      const sm = await this.prisma.staffMember.findFirst({ where: { userId: user.id }, select: { staffRole: true } });
      staffRole = sm?.staffRole ?? null;
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      staffRole,
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
        capabilities: capabilitiesFor(user.role, staffRole),
      },
    };
  }
}
