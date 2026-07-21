import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret, maskHint } from './crypto.util';
import { ConnectResult, ProviderId } from './connectors/connector.types';
import { packDejavooSecret } from './adapters/dejavoo-spin-cloud.adapter';

/** Decrypted credential object stored (encrypted) per tenant+provider. */
export interface Credential {
  secret: string;
  webhookSecret?: string;
  locationId?: string;
  /** Provider environment/region (e.g. Adyen: test | live-us | live-eu). */
  region?: string;
  /** Dejavoo: Terminal Profile Number of the default terminal. */
  tpn?: string;
  /** Dejavoo: legacy Register ID, only for older merchant setups. */
  registerId?: string;
  /** Dejavoo: which SPIn host to talk to. */
  environment?: 'sandbox' | 'production';
  /** Dejavoo: does the terminal expect Amount to already include the tip? */
  amountIncludesTip?: boolean;
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
    const cred = JSON.parse(decryptSecret(conn.credentialEnc)) as Credential;
    // Dejavoo needs TPN + environment alongside the Authkey on every call, but
    // PaymentConnector only carries a single `secret` string. Packing them here
    // keeps that one-string contract intact for all the other providers.
    if (provider === 'dejavoo') {
      cred.secret = packDejavooSecret({
        secret: cred.secret,
        tpn: cred.tpn,
        registerId: cred.registerId,
        environment: cred.environment,
        amountIncludesTip: cred.amountIncludesTip,
      });
    }
    return cred;
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

  /**
   * Per-terminal credential. iPOSpays mints one Auth Key per TPN, so a salon
   * running two locations legitimately has two different keys under one
   * connection. Stored encrypted on the device row; null means "use the
   * connection-level key".
   */
  /** The single `secret` string a PaymentConnector expects for this provider. */
  packForConnector(provider: ProviderId, cred: Credential): string {
    return provider === 'dejavoo'
      ? packDejavooSecret({ secret: cred.secret, tpn: cred.tpn, registerId: cred.registerId, environment: cred.environment, amountIncludesTip: cred.amountIncludesTip })
      : cred.secret;
  }

  packDeviceCredential(provider: ProviderId, cred: Credential): { credentialEnc: string; keyHint: string } {
    const secret = provider === 'dejavoo'
      ? packDejavooSecret({ secret: cred.secret, tpn: cred.tpn, registerId: cred.registerId, environment: cred.environment, amountIncludesTip: cred.amountIncludesTip })
      : cred.secret;
    return { credentialEnc: encryptSecret(JSON.stringify({ ...cred, secret })), keyHint: maskHint(cred.secret) };
  }

  /** Credential to use for one terminal: its own if it has one, else the connection's. */
  async credentialForDevice(tenantId: string, provider: ProviderId, deviceId?: string | null): Promise<Credential> {
    if (deviceId) {
      const device = await this.prisma.paymentDevice.findFirst({ where: { id: deviceId, tenantId } });
      // Tenant scoping is enforced by the query above: a device belonging to
      // another salon simply is not found, so its key can never be loaded.
      if (device?.credentialEnc) return JSON.parse(decryptSecret(device.credentialEnc)) as Credential;
    }
    return this.loadCred(tenantId, provider);
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
