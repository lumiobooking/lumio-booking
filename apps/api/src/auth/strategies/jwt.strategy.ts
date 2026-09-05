import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { StaffRole, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../../common/tenant/tenant-context';
import { PrismaService } from '../../prisma/prisma.service';
import { refusalMessage, sessionRefusal, type UserLookup } from '../session-check';

/** Shape of the signed JWT payload (iat/exp added by passport-jwt on verify). */
export interface JwtPayload {
  sub: string; // userId
  email: string;
  role: UserRole;
  tenantId: string | null;
  staffRole?: StaffRole | null; // STAFF sub-role (optional; absent on older tokens)
  supportSession?: boolean;
  /** SUPPORT sessions: the level baked in when the employee entered the salon. */
  supportLevel?: string; // short-lived per-salon session for Lumio SUPPORT staff
  iat?: number; // issued-at (seconds) — used to invalidate tokens after a password change
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  // userId -> the last answer about that account, and when we got it. A short
  // cache keeps the per-request DB cost near zero while still ending a session
  // within ~10s of the account being deleted, switched off, or having its
  // password changed. A failed lookup is never cached: the next request asks
  // again rather than living for ten seconds on a non-answer.
  private readonly userCache = new Map<string, { look: UserLookup; cachedAt: number }>();

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
    // Does this token still stand for a real, allowed person? A signature only
    // proves the token was issued; everything that happened since — the account
    // deleted, switched off, its password changed — lives in the row.
    const refusal = sessionRefusal(await this.lookup(payload.sub), payload.iat);
    if (refusal) throw new UnauthorizedException(refusalMessage(refusal));
    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      tenantId: payload.tenantId ?? null,
      staffRole: payload.staffRole ?? null,
      supportSession: payload.supportSession === true,
    // Carried through verbatim. The level is decided once, at enter-salon time,
    // from the employee's own row — so changing somebody's level takes effect
    // on their next entry, not mid-session, which is also what makes it
    // auditable: the token that did the work says what it was allowed to do.
    supportLevel: payload.supportLevel ?? null,
    };
  }

  /**
   * The account behind a token, cached for ten seconds.
   *
   * `failed` and `found` are kept apart all the way down to the decision: a
   * query that threw is not evidence that the row is gone, and conflating the
   * two would sign every salon out on a database blip. See session-check.ts.
   */
  private async lookup(userId: string): Promise<UserLookup> {
    const now = Date.now();
    const hit = this.userCache.get(userId);
    if (hit && now - hit.cachedAt < 10_000) return hit.look;

    let look: UserLookup;
    try {
      const u = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { isActive: true, passwordChangedAt: true },
      });
      look = {
        failed: false,
        found: Boolean(u),
        isActive: u?.isActive !== false,
        changedAt: u?.passwordChangedAt ? u.passwordChangedAt.getTime() : 0,
      };
    } catch {
      // Not an answer. Not cached either — the next request asks again.
      return { failed: true, found: false, isActive: true, changedAt: 0 };
    }

    this.userCache.set(userId, { look, cachedAt: now });
    // Bound memory on a long-lived process.
    if (this.userCache.size > 5000) this.userCache.clear();
    return look;
  }
}
