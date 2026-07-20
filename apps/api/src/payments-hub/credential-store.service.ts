import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret, maskHint } from './crypto.util';
import { ConnectResult, ProviderId } from './connectors/connector.types';

/** Decrypted credential object stored (encrypted) per tenant+provider. */
export interface Credential {
  secret: string;
  webhookSecret?: string;
  locationId?: string;
  /** Provider environment/region (e.g. Adyen: test | live-us | live-eu). */
  region?: string;
}

/**
 * Stores each tenant's OWN provider credential encrypted at rest (AES-256-GCM).
 * The raw key never leaves this layer; callers get either a decrypted Credential
 * (server-side use) or a masked public view (UI). Revocable.
 */
@Injectable()
export class CredentialStore {
  constructor(private readonly prisma: PrismaService) {}

  async save(tenantId: string, provider: ProviderId, cred: Credential, result: ConnectResult, label?: string) {
    const data = {
      status: 'ACTIVE',
      label: label ?? null,
      credentialEnc: encryptSecret(JSON.stringify(cred)),
      keyHint: maskHint(cred.secret),
      externalAccountId: result.accountId ?? null,
      currency: result.currency ?? 'USD',
      capabilities: result.capabilities as any,
      lastCheckedAt: new Date(),
    };
    return this.prisma.paymentConnection.upsert({
      where: { tenantId_provider: { tenantId, provider } },
      create: { tenantId, provider, ...data },
      update: data,
    });
  }

  async loadCred(tenantId: string, provider: ProviderId): Promise<Credential> {
    const conn = await this.prisma.paymentConnection.findUnique({ where: { tenantId_provider: { tenantId, provider } } });
    if (!conn || conn.status !== 'ACTIVE' || !conn.credentialEnc) {
      throw new NotFoundException('No active payment connection for this provider');
    }
    return JSON.parse(decryptSecret(conn.credentialEnc)) as Credential;
  }

  findConnection(tenantId: string, provider: ProviderId) {
    return this.prisma.paymentConnection.findUnique({ where: { tenantId_provider: { tenantId, provider } } });
  }

  listConnections(tenantId: string) {
    return this.prisma.paymentConnection.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
  }

  revoke(tenantId: string, provider: ProviderId) {
    return this.prisma.paymentConnection.updateMany({ where: { tenantId, provider }, data: { status: 'REVOKED', credentialEnc: null } });
  }

  /** UI-safe view: never includes the encrypted credential. */
  publicView(conn: any) {
    return {
      provider: conn.provider,
      status: conn.status,
      label: conn.label,
      keyHint: conn.keyHint,
      currency: conn.currency,
      capabilities: conn.capabilities,
      externalAccountId: conn.externalAccountId,
      lastCheckedAt: conn.lastCheckedAt,
    };
  }
}
