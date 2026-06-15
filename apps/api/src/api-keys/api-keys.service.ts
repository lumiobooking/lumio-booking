import { Injectable, NotFoundException } from '@nestjs/common';
import { ApiKeyStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser, resolveTenantScope } from '../common/tenant/tenant-context';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { generateApiKey } from './api-key.util';

// Fields safe to expose to the UI (never the hash).
const API_KEY_PUBLIC_SELECT = {
  id: true,
  name: true,
  keyPrefix: true,
  lastFour: true,
  status: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  wordpressSiteId: true,
} satisfies Prisma.ApiKeySelect;

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private tenantId(user: AuthenticatedUser): string {
    const id = resolveTenantScope(user);
    if (!id) {
      throw new NotFoundException('No tenant context');
    }
    return id;
  }

  list(user: AuthenticatedUser) {
    return this.prisma.apiKey.findMany({
      where: { tenantId: this.tenantId(user) },
      select: API_KEY_PUBLIC_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Creates a key. Returns the PLAINTEXT key exactly once (it is never stored
   * and cannot be retrieved again). Optionally links/creates a WordpressSite.
   */
  async create(user: AuthenticatedUser, dto: CreateApiKeyDto) {
    const tenantId = this.tenantId(user);
    const generated = generateApiKey();

    let wordpressSiteId: string | null = null;
    if (dto.siteUrl) {
      const site = await this.prisma.wordpressSite.upsert({
        where: { tenantId_siteUrl: { tenantId, siteUrl: dto.siteUrl } },
        update: { name: dto.name ?? undefined },
        create: { tenantId, siteUrl: dto.siteUrl, name: dto.name ?? null },
        select: { id: true },
      });
      wordpressSiteId = site.id;
    }

    const created = await this.prisma.apiKey.create({
      data: {
        tenantId,
        wordpressSiteId,
        name: dto.name ?? null,
        keyHash: generated.hash,
        keyPrefix: generated.keyPrefix,
        lastFour: generated.lastFour,
        status: ApiKeyStatus.ACTIVE,
      },
      select: API_KEY_PUBLIC_SELECT,
    });

    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: 'api_key.created',
      resourceType: 'api_key',
      resourceId: created.id,
      metadata: { name: dto.name, siteUrl: dto.siteUrl },
    });

    // The plaintext is returned ONCE here and nowhere else.
    return { ...created, plaintextKey: generated.plaintext };
  }

  async revoke(user: AuthenticatedUser, id: string) {
    const tenantId = this.tenantId(user);
    const existing = await this.prisma.apiKey.findFirst({
      where: { id, tenantId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('API key not found');
    }
    await this.prisma.apiKey.updateMany({
      where: { id, tenantId },
      data: { status: ApiKeyStatus.REVOKED, revokedAt: new Date() },
    });
    await this.audit.log({
      tenantId,
      userId: user.userId,
      action: 'api_key.revoked',
      resourceType: 'api_key',
      resourceId: id,
    });
    return { id, revoked: true };
  }
}
