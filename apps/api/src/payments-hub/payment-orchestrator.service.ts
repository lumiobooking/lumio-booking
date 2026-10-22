import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ConflictException,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PaymentStatus, PaymentType, UserRole } from '@prisma/client';
import { ledgerProviderFor } from '../pos/payment-methods';
import { addDaysToKey, startOfDayTz } from '../common/salon-time';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser, assertTenantAccess } from '../common/tenant/tenant-context';
import { ProviderRegistry } from './provider-registry.service';
import { Credential, CredentialStore } from './credential-store.service';
import { encConfigured } from './crypto.util';
import { ProviderId } from './connectors/connector.types';
import { OnlineCheckoutOpts } from './connectors/payment-connector.interface';
import { oauthBase } from '../common/public-url.util';
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
    // Resolves the till lazily (no module import cycle) to void a fully refunded sale.
    @Optional() private readonly moduleRef?: ModuleRef,
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

  status(user?: AuthenticatedUser) {
    // Clover (deposits) and Stripe (terminal events) sign webhooks to a per-salon
    // address; the settings screen shows it so the owner can paste it there.
    const tid = user?.tenantId ?? null;
    const webhookBase = tid ? `${oauthBase()}/api/payments-hub/webhook/{provider}/${tid}` : null;
    return { enabled: this.enabled(), encryption: encConfigured(), providers: this.registry.supported(), webhookBase };
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
      region: dto.region?.trim() || undefined,
      tpn: (dto as any).tpn?.trim() || undefined,
      registerId: (dto as any).registerId?.trim() || undefined,
      environment: ((dto as any).environment?.trim() as 'sandbox' | 'production') || undefined,
      amountIncludesTip: (dto as any).amountIncludesTip,
      publicId: dto.publicId?.trim() || undefined,
    };
    const result = await connector.verifyCredential(cred.secret, {
      currency: dto.currency,
      locationId: cred.locationId,
      region: cred.region,
      tpn: cred.tpn,
      registerId: cred.registerId,
      environment: cred.environment,
      publicId: cred.publicId,
    });
    if (!result.ok) throw new BadRequestException(result.error ?? 'Could not verify the API key with the provider');
    const conn = await this.creds.save(tenantId, dto.provider as ProviderId, cred, result, dto.label);
    await this.audit(tenantId, user.userId, 'payment.connect', { provider: dto.provider });
    return this.creds.publicView(conn);
  }

  async test(user: AuthenticatedUser, provider: string) {
    this.ensureEnabled();
    const tenantId = this.tid(user);
    const cred = await this.creds.loadCred(tenantId, provider as ProviderId);
    const result = await this.registry.get(provider).verifyCredential(cred.secret, {
      locationId: cred.locationId,
      region: cred.region,
      tpn: cred.tpn,
      registerId: cred.registerId,
      environment: cred.environment,
      publicId: cred.publicId,
    });
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
      // Square-style pairing: the row was first saved under the device-CODE id;
      // once paired the provider reports the real device_id. Migrate the old
      // row in place (keeps its id, so existing intents/links stay valid)
      // instead of leaving a phantom "Pair code" device behind.
      if (r.replacesExternalId && r.replacesExternalId !== r.externalId) {
        const stale = await this.prisma.paymentDevice.findUnique({
          where: { tenantId_provider_externalReaderId: { tenantId, provider, externalReaderId: r.replacesExternalId } },
        }).catch(() => null);
        if (stale) {
          const already = await this.prisma.paymentDevice.findUnique({
            where: { tenantId_provider_externalReaderId: { tenantId, provider, externalReaderId: r.externalId } },
          }).catch(() => null);
          if (already) await this.prisma.paymentDevice.delete({ where: { id: stale.id } });
          else await this.prisma.paymentDevice.update({ where: { id: stale.id }, data: { externalReaderId: r.externalId } });
        }
      }
      await this.prisma.paymentDevice.upsert({
        where: { tenantId_provider_externalReaderId: { tenantId, provider, externalReaderId: r.externalId } },
        create: { tenantId, provider, connectionId: conn.id, externalReaderId: r.externalId, label: r.label ?? null, locationId: r.locationId ?? null, status: r.status, lastSeenAt: new Date() },
        update: { label: r.label ?? null, locationId: r.locationId ?? null, status: r.status, lastSeenAt: new Date() },
      });
    }
    const devices = await this.prisma.paymentDevice.findMany({ where: { tenantId, provider }, orderBy: { createdAt: 'asc' } });
    return devices.map((d) => this.deviceView(d));
  }

  async registerReader(user: AuthenticatedUser, provider: string, dto: RegisterReaderDto) {
    this.ensureEnabled();
    const tenantId = this.tid(user);
    const connCred = await this.creds.loadCred(tenantId, provider as ProviderId);
    const conn = await this.creds.findConnection(tenantId, provider as ProviderId);
    if (!conn) throw new NotFoundException('No connection');

    // A terminal may carry its own Auth Key (iPOSpays issues one per TPN, so a
    // second location needs a second key). When one is supplied we validate it
    // against THAT terminal and store it encrypted on the device row.
    const ownKey = dto.authKey?.trim();
    const deviceCred: Credential | null = ownKey
      ? {
          secret: ownKey,
          tpn: provider === 'dejavoo' ? dto.code.trim() : undefined,
          registerId: dto.registerId?.trim() || undefined,
          environment: connCred.environment,
          locationId: dto.locationId?.trim() || connCred.locationId,
        }
      : null;

    const effectiveSecret = deviceCred
      ? this.creds.packForConnector(provider as ProviderId, deviceCred)
      : connCred.secret;

    const r = await this.registry.get(provider).registerReader(effectiveSecret, dto.code, dto.label, dto.locationId ?? connCred.locationId);
    const enc = deviceCred ? this.creds.packDeviceCredential(provider as ProviderId, deviceCred) : null;

    const device = await this.prisma.paymentDevice.upsert({
      where: { tenantId_provider_externalReaderId: { tenantId, provider, externalReaderId: r.externalId } },
      create: {
        tenantId, provider, connectionId: conn.id, externalReaderId: r.externalId,
        label: r.label ?? null, locationId: r.locationId ?? null, status: r.status, lastSeenAt: new Date(),
        credentialEnc: enc?.credentialEnc ?? null, keyHint: enc?.keyHint ?? null,
      },
      update: {
        label: r.label ?? null, status: r.status, lastSeenAt: new Date(),
        locationId: r.locationId ?? dto.locationId ?? undefined,
        // Only overwrite the stored key when a new one was actually supplied.
        ...(enc ? { credentialEnc: enc.credentialEnc, keyHint: enc.keyHint } : {}),
      },
    });
    await this.audit(tenantId, user.userId, 'payment.reader.register', { provider, terminal: r.externalId, ownKey: !!enc, locationId: device.locationId });
    return this.deviceView(device);
  }

  /**
   * Health-check one specific terminal. With several terminals across
   * locations, "is the connection OK?" is not a useful question — the salon
   * needs to know which machine is down.
   */
  async testDevice(user: AuthenticatedUser, deviceId: string) {
    this.ensureEnabled();
    const tenantId = this.tid(user);
    const device = await this.prisma.paymentDevice.findFirst({ where: { id: deviceId, tenantId } });
    if (!device) throw new NotFoundException('Terminal not found');
    assertTenantAccess(user, device.tenantId);

    const adapter = this.registry.adapter(device.provider);
    const cred = await this.creds.credentialForDevice(tenantId, device.provider as ProviderId, device.id);
    const health = await adapter.testConnection(
      { secret: cred.secret, tpn: cred.tpn, registerId: cred.registerId, environment: cred.environment, locationId: cred.locationId, region: cred.region },
      device.externalReaderId,
    );
    const updated = await this.prisma.paymentDevice.update({
      where: { id: device.id },
      data: { status: health.online ? 'ONLINE' : 'OFFLINE', lastSeenAt: health.online ? new Date() : device.lastSeenAt },
    });
    return { ...this.deviceView(updated), ok: health.online, message: health.message };
  }

  /** Device row without the encrypted credential. */
  private deviceView(d: any) {
    return {
      id: d.id, provider: d.provider, externalReaderId: d.externalReaderId, label: d.label,
      locationId: d.locationId, status: d.status, connectionType: d.connectionType,
      lastSeenAt: d.lastSeenAt, hasOwnKey: !!d.credentialEnc, keyHint: d.keyHint ?? null,
    };
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

    // Double-charge guard. `clientRef` already makes an identical retry a no-op,
    // but the dangerous case is a POS that times out and retries with a FRESH
    // clientRef: to the DB that looks like a brand new sale. So before charging,
    // any unresolved intent on the same order is re-checked against the provider
    // and, if it is still unresolved, this charge is refused rather than risking
    // the customer being billed twice.
    if (dto.orderId) {
      const openIntent = await this.prisma.paymentIntentRecord.findFirst({
        where: { tenantId, orderId: dto.orderId, status: { in: ['REQUIRES_PAYMENT', 'PROCESSING', 'QUEUED'] } },
        orderBy: { createdAt: 'desc' },
      });
      if (openIntent && openIntent.clientRef !== dto.clientRef) {
        const settled = await this.reconcileIntent(tenantId, openIntent);
        if (settled.status === 'SUCCEEDED') {
          throw new ConflictException('This ticket was already paid on the terminal. Refresh before charging again.');
        }
        if (settled.status === 'PROCESSING' || settled.status === 'QUEUED' || settled.status === 'REQUIRES_PAYMENT') {
          throw new ConflictException(
            'A previous charge for this ticket has not finished. Check the terminal screen, then retry — charging now could bill the customer twice.',
          );
        }
      }
    }

    // CLOUD (server-driven): backend calls the provider API directly, using
    // this terminal's own key when it has one (multi-location salons).
    const cred = await this.creds.credentialForDevice(tenantId, provider as ProviderId, device?.id);
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
      amountCents: dto.amountCents,
      tipCents: (dto as any).tipCents,
      currency,
      readerExternalId,
      reference: dto.clientRef,
      invoiceNumber: (dto as any).invoiceNumber ?? dto.orderId ?? undefined,
      description: dto.description,
    });
    const updated = await this.prisma.paymentIntentRecord.update({
      where: { id: record.id },
      data: {
        // Keep a reference even on an aborted call: without it we could never
        // ask the provider what actually happened to the card.
        externalIntentId: res.externalId ?? dto.clientRef,
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

  /**
   * Ask the provider what really happened to an unresolved intent and persist
   * the answer. This is the single source of truth for "was the card charged?"
   * and is what makes timeout recovery safe.
   */
  private async reconcileIntent(tenantId: string, record: { id: string; provider: string; externalIntentId: string | null; status: string; succeededAt: Date | null }) {
    if (!record.externalIntentId) return record;
    try {
      const cred = await this.creds.loadCred(tenantId, record.provider as ProviderId);
      const res = await this.registry.get(record.provider).getIntent(cred.secret, record.externalIntentId);
      if (res.status === record.status) return record;
      return await this.prisma.paymentIntentRecord.update({
        where: { id: record.id },
        data: {
          status: res.status,
          lastError: res.error ?? null,
          providerRaw: (res.raw as any) ?? undefined,
          succeededAt: res.status === 'SUCCEEDED' ? (record.succeededAt ?? new Date()) : record.succeededAt,
        },
      });
    } catch (e) {
      this.logger.warn(`reconcileIntent failed for ${record.id}: ${String(e)}`);
      return record; // Stay unresolved rather than guessing.
    }
  }

  /**
   * Card-terminal transactions for this salon. Unresolved ones are re-checked
   * against the provider on the way out, so the list a salon admin looks at is
   * never stale about whether a customer was actually charged.
   */
  async listIntents(user: AuthenticatedUser, opts: { limit?: number; status?: string; from?: string; to?: string } = {}) {
    this.ensureEnabled();
    const tenantId = this.tid(user);
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const ranged = (opts.from && day.test(opts.from)) || (opts.to && day.test(opts.to));
    // A period (the money screens' filter) may hold more than the latest 50.
    const take = Math.min(Math.max(opts.limit ?? (ranged ? 500 : 50), 1), ranged ? 1000 : 200);
    const where: any = { tenantId };
    if (opts.status) where.status = opts.status;
    if (ranged) {
      // The salon's days, not the server's.
      const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }).catch(() => null);
      const tz = t?.timezone || 'America/New_York';
      where.createdAt = {};
      if (opts.from && day.test(opts.from)) where.createdAt.gte = startOfDayTz(opts.from, tz);
      if (opts.to && day.test(opts.to)) where.createdAt.lt = startOfDayTz(addDaysToKey(opts.to, 1), tz);
    }

    let rows = await this.prisma.paymentIntentRecord.findMany({
      where, orderBy: { createdAt: 'desc' }, take,
      include: { refunds: { orderBy: { createdAt: 'desc' } } },
    });

    // Refresh anything still in flight, oldest first, capped so one slow
    // provider cannot stall the whole page.
    const unresolved = rows.filter((r) => r.status === 'PROCESSING' || r.status === 'REQUIRES_PAYMENT').slice(0, 5);
    for (const r of unresolved) await this.reconcileIntent(tenantId, r);
    if (unresolved.length) {
      rows = await this.prisma.paymentIntentRecord.findMany({
        where, orderBy: { createdAt: 'desc' }, take,
        include: { refunds: { orderBy: { createdAt: 'desc' } } },
      });
    }
    return rows.map((r) => this.intentRow(r));
  }

  /** One transaction, shaped for the salon UI. Never exposes credentials. */
  private intentRow(r: any) {
    const raw = (r.providerRaw ?? {}) as any;
    const card = raw.CardData ?? {};
    const refunded = (r.refunds ?? []).filter((x: any) => x.status === 'SUCCEEDED').reduce((s: number, x: any) => s + x.amountCents, 0);
    return {
      id: r.id,
      provider: r.provider,
      status: r.status,
      amountCents: r.amountCents,
      currency: r.currency,
      reference: r.externalIntentId,
      orderId: r.orderId,
      // Receipt details, straight from the terminal. Card data is brand + last 4
      // only — a full card number never reaches Lumio.
      approvalCode: raw.AuthCode ?? null,
      cardBrand: card.CardBrand ?? card.CardType ?? null,
      last4: card.Last4 ?? null,
      entryType: card.EntryType ?? null,
      tipCents: raw.Amounts?.TipAmount != null ? Math.round(Number(raw.Amounts.TipAmount) * 100) : null,
      batchNumber: raw.BatchNumber ?? null,
      rrn: raw.RRN ?? raw.PNReferenceId ?? null,
      refundedCents: refunded,
      canVoid: r.status === 'SUCCEEDED' && refunded === 0,
      canRefund: r.status === 'SUCCEEDED' && refunded < r.amountCents,
      /** True while we do not know whether the customer was charged. */
      unresolved: r.status === 'PROCESSING' || r.status === 'REQUIRES_PAYMENT',
      lastError: r.lastError,
      createdAt: r.createdAt,
      succeededAt: r.succeededAt,
      refunds: (r.refunds ?? []).map((x: any) => ({ id: x.id, amountCents: x.amountCents, status: x.status, reason: x.reason, createdAt: x.createdAt })),
    };
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

  /**
   * Void the original transaction. Unlike a refund this reverses the sale
   * outright, so nothing ever hits the customer's statement — but it only works
   * while the batch is still open (same business day, before settlement).
   */
  async voidPayment(user: AuthenticatedUser, dto: { intentId: string; reason?: string }) {
    this.ensureEnabled();
    if (user.role !== UserRole.SALON_ADMIN && user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Only a salon admin can void a payment');
    }
    const tenantId = this.tid(user);
    const intent = await this.prisma.paymentIntentRecord.findFirst({ where: { id: dto.intentId, tenantId } });
    if (!intent) throw new NotFoundException('Intent not found');
    assertTenantAccess(user, intent.tenantId);
    if (intent.status !== 'SUCCEEDED') throw new BadRequestException('Only a succeeded payment can be voided');
    if (!intent.externalIntentId) throw new BadRequestException('Intent has no provider reference');

    const adapter = this.registry.adapter(intent.provider);
    const cred = await this.creds.credentialForDevice(tenantId, intent.provider as ProviderId, intent.deviceId);
    const device = intent.deviceId ? await this.prisma.paymentDevice.findFirst({ where: { id: intent.deviceId, tenantId } }) : null;

    const res = await adapter.voidPayment(
      { secret: cred.secret, locationId: cred.locationId, region: cred.region },
      { reference: intent.externalIntentId, amountCents: intent.amountCents, terminalId: device?.externalReaderId },
    );
    const ok = res.outcome === 'APPROVED';

    // Recorded as a full-value refund so reporting and payroll see one
    // consistent shape whether the salon voided or refunded.
    const record = await this.prisma.paymentRefund.create({
      data: {
        tenantId, intentId: intent.id, provider: intent.provider, amountCents: intent.amountCents,
        reason: dto.reason ?? 'void', status: ok ? 'SUCCEEDED' : 'FAILED',
        externalRefundId: res.externalId ?? null, providerRaw: (res.raw as any) ?? undefined,
        createdByUserId: user.userId,
      },
    });
    if (ok) {
      await this.prisma.paymentIntentRecord.update({ where: { id: intent.id }, data: { status: 'CANCELED' } });
      await this.settleRefund(user, tenantId, intent, intent.amountCents, record.id, true);
    }
    await this.audit(tenantId, user.userId, 'payment.void', { intentId: intent.id, ok, code: res.code });
    if (!ok) throw new BadRequestException(res.message || 'Void was declined by the terminal');
    return { id: record.id, status: record.status, approvalCode: res.approvalCode, code: res.code };
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

    const cred = await this.creds.credentialForDevice(tenantId, intent.provider as ProviderId, intent.deviceId);
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
      const full = (agg._sum.amountCents ?? 0) >= intent.amountCents;
      if (full) {
        await this.prisma.paymentIntentRecord.update({ where: { id: intent.id }, data: { status: 'CANCELED' } });
      }
      await this.settleRefund(user, tenantId, intent, updated.amountCents, updated.id, full);
    }
    await this.audit(tenantId, user.userId, 'payment.refund', { intentId: intent.id, amountCents: updated.amountCents, status: res.status });
    return updated;
  }

  /** The till's sale a card charge paid for: by orderId, else by the till's own clientRef ("<sale ref>-card"). */
  private async orderOfIntent(tenantId: string, intent: { orderId?: string | null; clientRef?: string | null }) {
    const select = { id: true, status: true, tenders: { select: { method: true, amountCents: true } } } as const;
    if (intent.orderId) return this.prisma.order.findFirst({ where: { id: intent.orderId, tenantId }, select });
    const ref = String(intent.clientRef ?? '');
    if (!ref.endsWith('-card') || ref.length <= 5) return null;
    return this.prisma.order.findFirst({ where: { tenantId, clientRef: ref.slice(0, -5) }, select });
  }

  /**
   * A card refund or void reaches the books.
   *  - The WHOLE card payment of a sale paid by card alone goes back: the sale is
   *    voided exactly as the till's Void does — revenue, the technicians'
   *    commission and tips, stock, gift cards and points all reverse, and a
   *    checked-out booking goes back to "arrived".
   *  - Anything less (part of it, or a sale also paid in cash): one negative card
   *    row on the day of the refund; the sale itself stands.
   * A sale inside a closed payroll cannot be voided — it gets the negative row.
   */
  private async settleRefund(user: AuthenticatedUser, tenantId: string, intent: { id?: string; orderId?: string | null; clientRef?: string | null; currency?: string | null }, amountCents: number, refundId: string, full: boolean) {
    const order = await this.orderOfIntent(tenantId, intent).catch(() => null);
    const cardOnly = !!order && order.status === 'PAID' && order.tenders.length > 0 && order.tenders.every((t) => t.method === 'CARD');
    if (full && cardOnly && this.moduleRef) {
      try {
        const { PosService } = await import('../pos/pos.service');
        const pos = this.moduleRef.get(PosService, { strict: false });
        await pos.voidOrder(user, order!.id);
        await this.audit(tenantId, user.userId, 'payment.refund_order_voided', { intentId: intent.id, orderId: order!.id });
        return;
      } catch (e) {
        await this.audit(tenantId, user.userId, 'payment.refund_order_not_voided', { intentId: intent.id, orderId: order!.id, reason: String((e as Error)?.message ?? e).slice(0, 200) });
      }
    }
    await this.refundToLedger(tenantId, { orderId: order?.id ?? intent.orderId, currency: intent.currency }, amountCents, refundId);
  }

  /**
   * Money handed back on the terminal leaves revenue on the day it went back:
   * one negative card row in the ledger the dashboard and reports read. Tied to
   * the sale's order when the charge named one (a later void of that order
   * then neutralises this row with the rest of the order's rows).
   */
  private async refundToLedger(tenantId: string, intent: { orderId?: string | null; currency?: string | null }, amountCents: number, refundId: string) {
    if (!(amountCents > 0)) return;
    try {
      await this.prisma.payment.create({
        data: {
          tenantId, appointmentId: null, amountCents: -amountCents, currency: intent.currency || 'USD',
          type: PaymentType.PAY_LATER, status: PaymentStatus.PAID, provider: ledgerProviderFor('CARD'),
          providerReference: intent.orderId ? `order:${intent.orderId}` : `refund:${refundId}`, paidAt: new Date(),
        },
      });
    } catch (e) {
      this.logger.warn(`refund ledger row failed: ${String(e)}`);
    }
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
        data: { status: evt.status, succeededAt: evt.status === 'SUCCEEDED' ? new Date() : undefined, ...(provider === 'clover' && evt.raw ? { providerRaw: evt.raw as any } : {}) },
      });
    }
    await this.prisma.paymentWebhookEvent.update({ where: key, data: { processedAt: new Date() } });
    return { received: true };
  }

  // ---- ONLINE (card-not-present) — booking deposits ----

  /**
   * The tenant's active connection whose connector supports online checkout.
   * `preferred` is the salon's pick (deposit settings) when it has several.
   */
  async onlineProviderFor(tenantId: string, preferred?: string | null): Promise<string | null> {
    if (!this.enabled()) return null;
    const conns = await this.creds.listConnections(tenantId);
    const ok: string[] = [];
    for (const c of conns as any[]) {
      if (c.status !== 'ACTIVE') continue;
      try {
        const connector: any = this.registry.get(c.provider);
        if (typeof connector.startOnlineCheckout !== 'function') continue;
        // A Stripe key without Terminal permission is still an online key; a
        // connection that told us it cannot take online payments is skipped.
        if (c.capabilities && (c.capabilities as any).online === false) continue;
        ok.push(c.provider);
      } catch {
        /* provider not registered */
      }
    }
    if (preferred && ok.includes(preferred)) return preferred;
    return ok[0] ?? null;
  }

  /** Start a hosted online checkout for a server-computed amount. */
  async onlineStart(tenantId: string, amountCents: number, currency: string, reference: string, opts: OnlineCheckoutOpts & { preferred?: string | null } = {}) {
    const provider = await this.onlineProviderFor(tenantId, opts.preferred);
    if (!provider) throw new BadRequestException('No online payment provider connected');
    const cred = await this.creds.loadCred(tenantId, provider as ProviderId);
    const connector: any = this.registry.get(provider);
    const { preferred: _p, ...pass } = opts;
    const session = await connector.startOnlineCheckout(cred.secret, amountCents, currency, reference, { locationId: (cred as any).locationId, ...pass });
    // Providers that cannot search by our reference (Square, Stripe, PayPal,
    // Clover) hand back their own id. Persist the mapping so onlineLookup can
    // verify later — UPSERT, because a customer who closes the page and tries
    // again gets a new session, and the old id would never show it paid.
    if (session?.externalRef) {
      const conn = await this.creds.findConnection(tenantId, provider as ProviderId).catch(() => null);
      const clientRef = `online:${reference}`;
      await this.prisma.paymentIntentRecord.upsert({
        where: { tenantId_clientRef: { tenantId, clientRef } },
        create: {
          tenantId, provider, connectionId: conn?.id ?? null,
          externalIntentId: String(session.externalRef), clientRef,
          amountCents, currency, status: 'REQUIRES_PAYMENT', connectionType: 'CLOUD',
        },
        update: {
          provider, connectionId: conn?.id ?? null, externalIntentId: String(session.externalRef),
          amountCents, currency, status: 'REQUIRES_PAYMENT', succeededAt: null, providerRaw: { paymentId: null } as any,
        },
      }).catch(() => undefined);
    }
    const pub = { ...(session ?? {}) } as Record<string, unknown>;
    delete pub.externalRef; // internal mapping only — the browser never needs it
    delete pub.secretToken; // Helcim's response-hash key stays on the server
    return { provider, amountCents, currency, ...pub };
  }

  /** Verify an online payment directly with the provider (never trust the client). */
  async onlineLookup(tenantId: string, reference: string) {
    const row = await this.prisma.paymentIntentRecord.findFirst({
      where: { tenantId, clientRef: `online:${reference}` },
      orderBy: { createdAt: 'desc' },
    }).catch(() => null);
    // The provider the checkout was STARTED with — the salon may have changed
    // its pick since, and the money is where the customer paid it.
    const provider = row?.provider ?? (await this.onlineProviderFor(tenantId));
    if (!provider) throw new BadRequestException('No online payment provider connected');
    // A provider that answered by signed webhook (Clover) has already settled the row.
    const raw = (row?.providerRaw ?? null) as { paymentId?: string } | null;
    if (row?.status === 'SUCCEEDED' && raw?.paymentId) {
      return { provider, approved: true, amountCents: row.amountCents, transactionId: raw.paymentId };
    }
    const cred = await this.creds.loadCred(tenantId, provider as ProviderId);
    const connector: any = this.registry.get(provider);
    let res: { approved: boolean; amountCents?: number; transactionId?: string };
    if (typeof connector.lookupOnlinePaymentByOrder === 'function') {
      if (!row?.externalIntentId) return { provider, approved: false };
      res = await connector.lookupOnlinePaymentByOrder(cred.secret, row.externalIntentId);
      if (res.approved && row.status !== 'SUCCEEDED') {
        await this.prisma.paymentIntentRecord.update({
          where: { id: row.id },
          data: { status: 'SUCCEEDED', succeededAt: new Date(), providerRaw: { paymentId: res.transactionId ?? null } as any },
        }).catch(() => undefined);
      }
    } else {
      res = await connector.lookupOnlinePayment(cred.secret, reference);
    }
    return { provider, ...res };
  }

  /**
   * Give money taken ONLINE back through the provider that took it (a booking
   * cancelled in time). Never throws: the caller records what happened.
   */
  async onlineRefund(tenantId: string, provider: string, input: { transactionId?: string | null; reference: string; amountCents: number; currency: string }): Promise<{ ok: boolean; pending?: boolean; error?: string }> {
    if (!this.enabled()) return { ok: false, error: 'Payment hub is disabled' };
    let connector: any;
    try { connector = this.registry.get(provider); } catch { return { ok: false, error: `Unknown provider ${provider}` }; }
    if (typeof connector.refundOnline !== 'function') return { ok: false, error: `${provider} cannot refund online payments from Lumio` };
    const cred = await this.creds.loadCred(tenantId, provider as ProviderId).catch(() => null);
    if (!cred) return { ok: false, error: 'The payment connection is no longer active' };
    try {
      const r = await connector.refundOnline(cred.secret, input);
      await this.audit(tenantId, null, 'payment.online_refund', { provider, reference: input.reference, amountCents: input.amountCents, status: r.status, error: r.error ?? null });
      return r.status === 'FAILED' ? { ok: false, error: r.error ?? 'Refund failed' } : { ok: true, pending: r.status === 'PENDING' };
    } catch (e) {
      return { ok: false, error: String((e as Error)?.message ?? e) };
    }
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
