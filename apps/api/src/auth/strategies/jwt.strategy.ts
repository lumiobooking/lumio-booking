import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { StaffRole, UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../../common/tenant/tenant-context';

/** Shape of the signed JWT payload. */
export interface JwtPayload {
  sub: string; // userId
  email: string;
  role: UserRole;
  tenantId: string | null;
  staffRole?: StaffRole | null; // STAFF sub-role (optional; absent on older tokens)
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') ?? 'insecure_dev_secret_change_me',
    });
  }

  /**
   * Passport calls this after verifying the signature/expiry. The returned
   * object becomes `request.user`. We trust tenantId from the signed token so
   * the tenant scope cannot be forged by the client.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload?.sub || !payload?.role) {
      throw new UnauthorizedException('Invalid token');
    }
    return {
      userId: payload.sub,
      email: payload.email,
      role: payload.role,
      tenantId: payload.tenantId ?? null,
      staffRole: payload.staffRole ?? null,
    };
  }
}
