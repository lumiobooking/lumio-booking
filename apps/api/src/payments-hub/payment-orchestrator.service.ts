import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, assertTenantAccess } from '../common/tenant/tenant-context';
import { ProviderRegistry } from './provider-registry.service';
import { Credential, CredentialStore } from './credential-store.service';
import { encConfigured } from './crypto.util';
import { ProviderId } from './connectors/connector.types';
import { ChargeDto, ConnectDto, RefundDto, RegisterReaderDto } from './dto/payments-hub.dto';

/**
 * Central payment coordinator. Enforces the feature flag, tenant isolation,
 * idempotency, and RBAC; delegates the provider-specific work to connectors.
 * All money paths go through here so every provider behaves the same.
 */
@Injectable()
export class PaymentOrchestrator {
  private readonly logger = new Logger('PaymentOrchestrator');

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
    private readonly creds: CredentialStore,
  ) {}

  private enabled(): boolean {
    return process.env.PAYMENTS_HUB_ENABLED === 'true';
  }
  private ensureEnabled() {
    if (!this.enabled()) throw new ServiceUnavailableException('Payment hub is disabled');
  }
  private tid(user: AuthenticatedUser): string {
    if (!user.tenantId) throw new ForbiddenException('No active salon for this user');
    return user.tenantId;
  }

  status() {
    return { enabled: this.enabled(), encryption: encConfigured(), providers: this.registry.supported() };
  }

  async listConnections(user: AuthenticatedUser) {
    const conns = await this.creds.listConnections(this.tid(user));
    return conns.map((c: any) => this.creds.publicView(c));
  }

  async connect(user: AuthenticatedUser, dto: ConnectDto) {
    this.ensureEnabled();
    if (!encConfigured()) throw new ServiceUnavailableException('PAYMENT_ENC_KEY not configured');
    const tenantId = this.tid(user);
    const connector = this.registry.get(dto.provider);
    const cred: Credential = {
      secret: dto.secret.trim(),
      webhookSecret: dto.webhookSecret?.trim() || undefined,
      locationId: dto.locationId?.trim() || undefined,
    };
    const result = await connector.verifyCredential(cred.secret, { currency: dto.currency, locationId: cred.locationId });
    if (!result.ok) throw new BadRequestException(result.error ?? 'Could not verify the API key with the provider');
    const conn = await this.creds.save(tenantId, dto.provider as ProviderId, cred, result, dto.label);
    await this.audit(tenantId, user.userId, 'payment.connect', { provider: dto.provider });
    return this.creds.publicView(conn);
  }

  async test(user: AuthenticatedUser, provider: string) {
    this.ensureEnabled();
    const tenantId = this.tid(user);
    const cred = await this.creds.loadCred(tenantId, provider as ProviderId);
    const result = await this.registry.get(provider).verifyCredential(cred.secret, { locationId: cred.locationId });
    await this.prisma.paymentConnection.updateMany({
      where: { tenantId, provider },
      data: { lastCheckedAt: new Date(), status: result.ok ? 'ACTIVE' : 'ERROR' },
    });
    return { ok: result.ok, error: result.error, capabilities: result.capabilities };
  }

  async revoke(user: AuthenticatedUser, provider: string) {
    this.ensureEnabled();
    const tenantId = this.tid(user);
    await this.creds.revoke(tenantId, provider as ProviderId);
    await this.audit(tenantId, user.userId, 'payment.revoke', { provider });
    return { ok: true };
  }

  async listReaders(user: AuthenticatedUser, provider: string) {
    this.ensureEnabled();
    const tenantId = this.tid(user);
    const cred = await this.creds.loadCred(tenantId, provider as ProviderId);
    const conn = await this.creds.findConnection(tenantId, provider as ProviderId);
    if (!conn) throw new NotFoundException('No connection');
    const readers = await this.registry.get(provider).listReaders(cred.secret);
    for (const r of readers) {
      await this.prisma.paymentDevice.upsert({
        where: { tenantId_provider_externalReaderId: { tenantId, provider, externalReaderId: r.externalId } },
        create: { tenantId, provider, connectionId: conn.id, externalReaderId: r.externalId, label: r.label ?? null, locationId: r.locationId ?? null, status: r.status, lastSeenAt: new Date() },
        update: { label: r.label ?? null, locationId: r.locationId ?? null, status: r.status, lastSeenAt: new Date() },
      });
    }
    return this.prisma.paymentDevice.findMany({ where: { tenantId, provider }, orderBy: { createdAt: 'asc' } });
  }

  async registerReader(user: AuthenticatedUser, provider: string, dto: RegisterReaderDto) {
    this.ensureEnabled();
    const tenantId = this.tid(user);
    const cred = await this.creds.loadCred(tenantId, provider as ProviderId);
    const conn = await this.creds.findConnection(tenantId, provider as ProviderId);
    if (!conn) throw new NotFoundException('No connection');
    const r = await this.registry.get(provider).registerReader(cred.secret, dto.code, dto.label, dto.locationId ?? cred.locationId);
    return this.prisma.paymentDevice.upsert({
      where: { tenantId_provider_externalReaderId: { tenantId, provider, externalReaderId: r.externalId } },
      create: { tenantId, provider, connectionId: conn.id, externalReaderId: r.externalId, label: r.label ?? null, locationId: r.locationId ?? null, status: r.status, lastSeenAt: new Date() },
      update: { label: r.label ?? null, status: r.status, lastSeenAt: new Date() },
    });
  }

  async connectionToken(user: AuthenticatedUser, provider: string) {
    this.ensureEnabled();
    const tenantId = this.tid(user);
    const cred = await this.creds.loadCred(tenantId, provider as ProviderId);
    return { secret: await this.registry.get(provider).createConnectionToken(cred.secret) };
  }

  async charge(user: AuthenticatedUser, dto: ChargeDto) {
    this.ensureEnabled();
    const tenantId = this.tid(user);
    const provider = dto.provider;
    // Idempotency: one intent per (tenant, clientRef).
    const existing = await this.prisma.paymentIntentRecord.findUnique({ where: { tenantId_clientRef: { tenantId, clientRef: dto.clientRef } } });
    if (existing) return this.intentView(existing);

    const conn = await this.creds.findConnection(tenantId, provider as ProviderId);
    const currency = (dto.currency || conn?.currency || 'USD').toUpperCase();
    const device = dto.deviceId ? await this.prisma.paymentDevice.findFirst({ where: { id: dto.deviceId, tenantId } }) : null;
    const connectionType = device?.connectionType ?? 'CLOUD';

    // USB / BLUETOOTH: queue the command for the paired Bridge/Companion agent,
    // which executes it on the terminal via the provider SDK and posts the result.
    if (connectionType === 'USB' || connectionType === 'BLUETOOTH') {
      if (!device?.agentId) throw new BadRequestException('This reader is not linked to a Bridge/Companion');
      const agent = await this.prisma.paymentAgent.findFirst({ where: { id: device.agentId, tenantId } });
      if (!agent || agent.status !== 'ONLINE') throw new BadRequestException('Device offline — open the Bridge/Companion app');
      const rec = await this.prisma.paymentIntentRecord.create({
        data: {
          tenantId, provider, connectionId: conn?.id ?? null, orderId: dto.orderId ?? null,
          amountCents: dto.amountCents, currency, status: 'QUEUED', connectionType,
          agentId: device.agentId, deviceId: device.id, clientRef: dto.clientRef, createdByUserId: user.userId,
        },
      });
      await this.audit(tenantId, user.userId, 'payment.charge.queued', { intentId: rec.id, amountCents: dto.amountCents, via: connectionType });
      return this.intentView(rec); // status QUEUED; POS polls getIntent until the agent finishes
    }

    // CLOUD (server-driven): backend calls the provider API directly.
    const cred = await this.creds.loadCred(tenantId, provider as ProviderId);
    let readerExternalId = dto.readerExternalId;
    if (!readerExternalId && device) readerExternalId = device.externalReaderId;

    const record = await this.prisma.paymentIntentRecord.create({
      data: {
        tenantId, provider, connectionId: conn?.id ?? null, orderId: dto.orderId ?? null,
        amountCents: dto.amountCents, currency, status: 'REQUIRES_PAYMENT', connectionType: 'CLOUD',
        deviceId: dto.deviceId ?? null, clientRef: dto.clientRef, createdByUserId: user.userId,
      },
    });
    const res = await this.registry.get(provider).charge(cred.secret, {
      amountCents: dto.amountCents, currency, readerExternalId, reference: dto.clientRef, description: dto.description,
    });
    const updated = await this.prisma.paymentIntentRecord.update({
      where: { id: record.id },
      data: {
        externalIntentId: res.externalId ?? null,
        status: res.status,
        lastError: res.error ?? null,
        providerRaw: (res.raw as any) ?? undefined,
        succeededAt: res.status === 'SUCCEEDED' ? new Date() : null,
      },
    });
    await this.audit(tenantId, user.userId, 'payment.charge', { intentId: updated.id, amountCents: dto.amountCents, status: res.status });
    // clientSecret returned ONLY here (never persisted) for the mobile SDK path.
    return { ...this.intentView(updated), clientSecret: res.clientSecret };
  }

  async getIntent(user: AuthenticatedUser, id: string) {
    this.ensureEnabled();
    const tenantId = this.tid(user);
    const record = await this.prisma.paymentIntentRecord.findFirst({ where: { id, tenantId } });
    if (!record) throw new NotFoundException('Intent not found');
    assertTenantAccess(user, record.tenantId);
    if (record.externalIntentId && record.status !== 'SUCCEEDED' && record.status !== 'CANCELED') {
      try {
        const cred = await this.creds.loadCred(tenantId, record.provider as ProviderId);
        const res = await this.registry.get(record.provider).getIntent(cred.secret, record.externalIntentId);
        if (res.status !== record.status) {
          const u = await this.prisma.paymentIntentRecord.update({
            where: { id: record.id },
            data: { status: res.status, succeededAt: res.status === 'SUCCEEDED' ? new Date() : record.succeededAt },
          });
          return this.intentView(u);
        }
      } catch (e) {
        this.logger.warn(`getIntent refresh failed: ${String(e)}`);
      }
    }
    return this.intentView(record);
  }

  async refund(user: AuthenticatedUser, dto: RefundDto) {
    this.ensureEnabled();
    if (user.role !== UserRole.SALON_ADMIN && user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only a salon admin can issue refunds');
    }
    const tenantId = this.tid(user);
    const intent = await this.prisma.paymentIntentRecord.findFirst({ where: { id: dto.intentId, tenantId } });
    if (!intent) throw new NotFoundException('Intent not found');
    assertTenantAccess(user, intent.tenantId);
    if (intent.status !== 'SUCCEEDED') throw new BadRequestException('Only a succeeded payment can be refunded');
    if (!intent.externalIntentId) throw new BadRequestException('Intent has no provider reference');

    const cred = await this.creds.loadCred(tenantId, intent.provider as ProviderId);
    const refund = await this.prisma.paymentRefund.create({
      data: { tenantId, intentId: intent.id, provider: intent.provider, amountCents: dto.amountCents ?? intent.amountCents, reason: dto.reason ?? null, status: 'PENDING', createdByUserId: user.userId },
    });
    const res = await this.registry.get(intent.provider).refund(cred.secret, intent.externalIntentId, dto.amountCents);
    const updated = await this.prisma.paymentRefund.update({
      where: { id: refund.id },
      data: { status: res.status, externalRefundId: res.externalId ?? null, providerRaw: (res.raw as any) ?? undefined },
    });
    if (res.status === 'SUCCEEDED') {
      const agg = await this.prisma.paymentRefund.aggregate({ where: { intentId: intent.id, status: 'SUCCEEDED' }, _sum: { amountCents: true } });
      if ((agg._sum.amountCents ?? 0) >= intent.amountCents) {
        await this.prisma.paymentIntentRecord.update({ where: { id: intent.id }, data: { status: 'CANCELED' } });
      }
    }
    await this.audit(tenantId, user.userId, 'payment.refund', { intentId: intent.id, amountCents: updated.amountCents, status: res.status });
    return updated;
  }

  async handleWebhook(provider: string, tenantId: string, rawBody: Buffer, signature: string) {
    if (!this.enabled()) return { received: true, skipped: 'disabled' };
    const cred = await this.creds.loadCred(tenantId, provider as ProviderId).catch(() => null);
    if (!cred?.webhookSecret) return { received: true, skipped: 'no-webhook-secret' };
    let evt;
    try {
      evt = this.registry.get(provider).verifyWebhook(rawBody, signature, cred.webhookSecret);
    } catch {
      throw new BadRequestException('Webhook signature verification failed');
    }
    const key = { provider_externalEventId: { provider, externalEventId: evt.id } };
    const dupe = await this.prisma.paymentWebhookEvent.findUnique({ where: key });
    if (dupe?.processedAt) return { received: true, duplicate: true };
    await this.prisma.paymentWebhookEvent.upsert({
      where: key,
      create: { provider, externalEventId: evt.id, tenantId, type: evt.type, payload: (evt.raw as any) ?? undefined },
      update: {},
    });
    if (evt.intentExternalId && evt.status) {
      await this.prisma.paymentIntentRecord.updateMany({
        where: { tenantId, externalIntentId: evt.intentExternalId },
        data: { status: evt.status, succeededAt: evt.status === 'SUCCEEDED' ? new Date() : undefined },
      });
    }
    await this.prisma.paymentWebhookEvent.update({ where: key, data: { processedAt: new Date() } });
    return { received: true };
  }

  private intentView(r: any) {
    return {
      id: r.id, provider: r.provider, status: r.status, amountCents: r.amountCents, currency: r.currency,
      externalIntentId: r.externalIntentId, orderId: r.orderId, clientRef: r.clientRef, error: r.lastError,
      succeededAt: r.succeededAt, createdAt: r.createdAt,
    };
  }

  private async audit(tenantId: string, userId: string | null, action: string, meta: any) {
    try {
      await this.prisma.auditLog.create({ data: { tenantId, userId: userId ?? undefined, action, resourceType: 'payment', metadata: meta as any } });
    } catch (e) {
      this.logger.warn(`audit failed: ${String(e)}`);
    }
  }
}
