import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeyStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hashApiKey } from '../../api-keys/api-key.util';

export const API_KEY_HEADER = 'x-lumio-api-key';

/**
 * Authenticates requests from the WordPress plugin using a tenant-specific API
 * key sent in the `X-Lumio-Api-Key` header. On success it attaches the resolved
 * tenantId to the request (`req.apiTenantId`) so plugin endpoints are scoped to
 * exactly one salon. No backend user/JWT is involved.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const headerValue = req.headers[API_KEY_HEADER] ?? req.headers[API_KEY_HEADER.toUpperCase()];
    const presented = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!presented || typeof presented !== 'string') {
      throw new UnauthorizedException('Missing API key');
    }

    const record = await this.prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(presented) },
      include: { tenant: { select: { status: true } } },
    });

    if (!record || record.status !== ApiKeyStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid or revoked API key');
    }
    if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('API key has expired');
    }
    if (record.tenant.status !== TenantStatus.ACTIVE) {
      throw new UnauthorizedException('This salon account is not active');
    }

    // Best-effort usage timestamp; never blocks the request.
    this.prisma.apiKey
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    req.apiTenantId = record.tenantId;
    req.apiKeyId = record.id;
    return true;
  }
}
