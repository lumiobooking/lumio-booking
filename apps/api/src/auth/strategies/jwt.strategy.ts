import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { StaffRole, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../../common/tenant/tenant-context';
import { PrismaService } from '../../prisma/prisma.service';

/** Shape of the signed JWT payload (iat/exp added by passport-jwt on verify). */
export interface JwtPayload {
  sub: string; // userId
  email: string;
  role: UserRole;
  tenantId: string | null;
  staffRole?: StaffRole | null; // STAFF sub-role (optional; absent on older tokens)
  iat?: number; // issued-at (seconds) — used to invalidate tokens after a password change
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  // userId -> { changedAt(ms, 0 = never), cachedAt(ms) }. A short cache keeps the
  // per-request DB cost near zero while still forcing re-login within ~10s of a
  // password change (the user's own change also logs them out instantly client-side).
  private readonly pwCache = new Map<string, { changedAt: number; cachedAt: number }>();

  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') ?? 'insecure_dev_secret_change_me',
    });
  }

  /**
   * Passport calls this after verifying the signature/expiry. The returned
   * object becomes `request.user`. We trust tenantId from the signed token so
   * the tenant scope cannot be forged by the client. We also reject any token
   * issued before the user's last password change (forces re-login).
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload?.sub || !payload?.role) {
      throw new UnauthorizedException('Invalid token');
    }
    if (payload.iat) {
      const changedAt = await this.passwordChangedAt(payload.sub);
      // 2s grace for clock skew between the token issuer and the DB timestamp.
      if (changedAt && payload.iat * 1000 < changedAt - 2000) {
        throw new UnauthorizedException('Password changed — please sign in again');
      }
    }
    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      tenantId: payload.tenantId ?? null,
      staffRole: payload.staffRole ?? null,
    };
  }

  /** Cached lookup of the user's passwordChangedAt (ms since epoch; 0 = never). */
  private async passwordChangedAt(userId: string): Promise<number> {
    const now = Date.now();
    const hit = this.pwCache.get(userId);
    if (hit && now - hit.cachedAt < 10_000) return hit.changedAt;
    const u = await this.prisma.user
      .findUnique({ where: { id: userId }, select: { passwordChangedAt: true } })
      .catch(() => null);
    const changedAt = u?.passwordChangedAt ? u.passwordChangedAt.getTime() : 0;
    this.pwCache.set(userId, { changedAt, cachedAt: now });
    // Bound memory on a long-lived process.
    if (this.pwCache.size > 5000) this.pwCache.clear();
    return changedAt;
  }
}
