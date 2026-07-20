import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/tenant/tenant-context';
import { ProviderRegistry } from './provider-registry.service';
import { CredentialStore } from './credential-store.service';
import { ProviderId } from './connectors/connector.types';
import { AgentPairDto, AgentRegisterReaderDto, AgentResultDto, CreateAgentDto } from './dto/payments-hub.dto';

/**
 * Relay for USB (Bridge) + Bluetooth (Companion) agents. An agent is a small app
 * running next to the terminal; it pairs to a tenant with a one-time code, then
 * polls for QUEUED payment commands and posts back results. The backend never
 * talks to a USB/BT terminal directly — the agent does, via the provider SDK.
 * No card data or provider secrets pass through the agent transport.
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger('AgentService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistry,
    private readonly creds: CredentialStore,
  ) {}

  private enabled() {
    return process.env.PAYMENTS_HUB_ENABLED === 'true';
  }
  private tid(user: AuthenticatedUser): string {
    if (!user.tenantId) throw new ForbiddenException('No active salon');
    return user.tenantId;
  }
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
  private pairingCode(): string {
    // 6-char human code, unambiguous alphabet.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const b = randomBytes(6);
    return Array.from(b, (x) => alphabet[x % alphabet.length]).join('');
  }

  // ---- Salon-admin management ----
  async createAgent(user: AuthenticatedUser, dto: CreateAgentDto) {
    const tenantId = this.tid(user);
    const code = this.pairingCode();
    const agent = await this.prisma.paymentAgent.create({
      data: {
        tenantId,
        kind: dto.kind,
        label: dto.label ?? null,
        platform: dto.platform ?? null,
        locationId: dto.locationId ?? null,
        pairingCode: code,
        pairingExpiresAt: new Date(Date.now() + 15 * 60_000),
        status: 'UNPAIRED',
      },
    });
    // pairingCode returned ONCE for the operator to type into the Bridge/Companion.
    return { ...this.publicView(agent), pairingCode: code };
  }

  async listAgents(user: AuthenticatedUser) {
    const tenantId = this.tid(user);
    const rows = await this.prisma.paymentAgent.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
    return rows.map((a) => this.publicView(a));
  }

  async unpair(user: AuthenticatedUser, id: string) {
    const tenantId = this.tid(user);
    // Detach any readers this agent was driving, then remove the agent entirely
    // so it disappears from the list (its token stops working immediately).
    await this.prisma.paymentDevice.updateMany({ where: { tenantId, agentId: id }, data: { agentId: null, status: 'OFFLINE' } });
    await this.prisma.paymentAgent.deleteMany({ where: { id, tenantId } });
    return { ok: true };
  }

  // ---- Agent runtime (bearer agent-token, not a user JWT) ----
  async pair(dto: AgentPairDto) {
    if (!this.enabled()) throw new BadRequestException('Payment hub disabled');
    const agent = await this.prisma.paymentAgent.findFirst({ where: { pairingCode: dto.pairingCode.trim().toUpperCase() } });
    if (!agent || !agent.pairingExpiresAt || agent.pairingExpiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired pairing code');
    }
    const token = randomBytes(24).toString('hex');
    await this.prisma.paymentAgent.update({
      where: { id: agent.id },
      data: { tokenHash: this.hash(token), pairingCode: null, pairingExpiresAt: null, status: 'ONLINE', lastSeenAt: new Date(), platform: dto.platform ?? agent.platform, label: dto.label ?? agent.label },
    });
    return { agentToken: token, agentId: agent.id, tenantId: agent.tenantId, kind: agent.kind };
  }

  async authAgent(authHeader?: string) {
    const token = (authHeader ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) throw new UnauthorizedException('Missing agent token');
    const agent = await this.prisma.paymentAgent.findFirst({ where: { tokenHash: this.hash(token) } });
    if (!agent) throw new UnauthorizedException('Invalid agent token');
    return agent;
  }

  async poll(agent: any) {
    await this.prisma.paymentAgent.update({ where: { id: agent.id }, data: { status: 'ONLINE', lastSeenAt: new Date() } });
    const intent = await this.prisma.paymentIntentRecord.findFirst({ where: { agentId: agent.id, status: 'QUEUED' }, orderBy: { createdAt: 'asc' } });
    if (!intent) return { command: null };
    // Claim it so it is dispatched only once.
    await this.prisma.paymentIntentRecord.update({ where: { id: intent.id }, data: { status: 'PROCESSING' } });

    let clientSecret: string | undefined;
    // For Stripe the SDK needs a PaymentIntent clientSecret; create it now (no
    // reader push) and return it once. Not persisted.
    if (intent.provider === 'stripe') {
      try {
        const cred = await this.creds.loadCred(intent.tenantId, 'stripe' as ProviderId);
        const res = await this.registry.get('stripe').charge(cred.secret, {
          amountCents: intent.amountCents,
          currency: intent.currency,
          reference: intent.clientRef ?? intent.id,
          description: 'Lumio POS (agent)',
        });
        clientSecret = res.clientSecret;
        if (res.externalId) {
          await this.prisma.paymentIntentRecord.update({ where: { id: intent.id }, data: { externalIntentId: res.externalId } });
        }
      } catch (e) {
        await this.prisma.paymentIntentRecord.update({ where: { id: intent.id }, data: { status: 'FAILED', lastError: String(e) } });
        return { command: null };
      }
    }
    return {
      command: {
        intentId: intent.id,
        action: 'collect',
        provider: intent.provider,
        amountCents: intent.amountCents,
        currency: intent.currency,
        externalReaderId: intent.deviceId ? (await this.prisma.paymentDevice.findUnique({ where: { id: intent.deviceId } }))?.externalReaderId : undefined,
        clientSecret,
      },
    };
  }

  async result(agent: any, dto: AgentResultDto) {
    const intent = await this.prisma.paymentIntentRecord.findFirst({ where: { id: dto.intentId, agentId: agent.id } });
    if (!intent) throw new NotFoundException('Intent not found for this agent');
    await this.prisma.paymentIntentRecord.update({
      where: { id: intent.id },
      data: {
        status: dto.status,
        externalIntentId: dto.providerReference ?? intent.externalIntentId,
        lastError: dto.error ?? null,
        succeededAt: dto.status === 'SUCCEEDED' ? new Date() : null,
      },
    });
    return { ok: true };
  }

  // Agent links a discovered USB/BT reader to the tenant (under an existing
  // provider connection). The reader then appears in the POS device list.
  async registerReader(agent: any, dto: AgentRegisterReaderDto) {
    const conn = await this.creds.findConnection(agent.tenantId, dto.provider as ProviderId);
    if (!conn) throw new BadRequestException('Connect the provider account first');
    const connectionType = agent.kind === 'BRIDGE' ? 'USB' : 'BLUETOOTH';
    return this.prisma.paymentDevice.upsert({
      where: { tenantId_provider_externalReaderId: { tenantId: agent.tenantId, provider: dto.provider, externalReaderId: dto.externalReaderId } },
      create: { tenantId: agent.tenantId, provider: dto.provider, connectionId: conn.id, connectionType, agentId: agent.id, externalReaderId: dto.externalReaderId, label: dto.label ?? null, status: 'ONLINE', lastSeenAt: new Date() },
      update: { connectionType, agentId: agent.id, status: 'ONLINE', lastSeenAt: new Date(), label: dto.label ?? null },
    });
  }

  // Stripe Terminal SDK connection token, for a Companion (agent-auth, no user JWT).
  async connectionToken(agent: any) {
    const cred = await this.creds.loadCred(agent.tenantId, 'stripe' as ProviderId);
    const secret = await this.registry.get('stripe').createConnectionToken(cred.secret);
    return { secret };
  }

  publicView(a: any) {
    return {
      id: a.id, kind: a.kind, label: a.label, platform: a.platform, locationId: a.locationId,
      status: a.status, paired: !!a.tokenHash, lastSeenAt: a.lastSeenAt, createdAt: a.createdAt,
    };
  }
}
