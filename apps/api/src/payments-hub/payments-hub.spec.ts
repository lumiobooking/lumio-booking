import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PaymentOrchestrator } from './payment-orchestrator.service';
import { ProviderRegistry } from './provider-registry.service';
import { CredentialStore } from './credential-store.service';
import { MockConnector } from './connectors/mock.connector';
import { StripeTerminalConnector } from './connectors/stripe-terminal.connector';
import { SquareTerminalConnector } from './connectors/square-terminal.connector';
import { SumUpConnector } from './connectors/sumup.connector';
import { AuthenticatedUser } from '../common/tenant/tenant-context';

const adminA: AuthenticatedUser = { userId: 'ua', email: 'a@a.test', role: UserRole.SALON_ADMIN, tenantId: 'tenant-a' };
const adminB: AuthenticatedUser = { userId: 'ub', email: 'b@b.test', role: UserRole.SALON_ADMIN, tenantId: 'tenant-b' };
const staffB: AuthenticatedUser = { userId: 'sb', email: 's@b.test', role: UserRole.STAFF, tenantId: 'tenant-b' };

// Minimal in-memory Prisma covering exactly the shapes the orchestrator uses.
function makePrisma() {
  const db: any = { conn: [], dev: [], intent: [], refund: [], evt: [], audit: [] };
  let seq = 0;
  const id = () => `id_${++seq}`;
  const eq = (row: any, where: any) => Object.entries(where).every(([k, v]) => row[k] === v);
  return {
    _db: db,
    paymentConnection: {
      findUnique: async ({ where }: any) => { const { tenantId, provider } = where.tenantId_provider; return db.conn.find((c: any) => c.tenantId === tenantId && c.provider === provider) ?? null; },
      findMany: async ({ where }: any) => db.conn.filter((c: any) => eq(c, where)),
      upsert: async ({ where, create, update }: any) => { const { tenantId, provider } = where.tenantId_provider; const existing = db.conn.find((c: any) => c.tenantId === tenantId && c.provider === provider); if (existing) { Object.assign(existing, update); return existing; } const row = { id: id(), ...create }; db.conn.push(row); return row; },
      updateMany: async ({ where, data }: any) => { let n = 0; db.conn.filter((c: any) => eq(c, where)).forEach((c: any) => { Object.assign(c, data); n++; }); return { count: n }; },
    },
    paymentDevice: {
      findFirst: async ({ where }: any) => db.dev.find((d: any) => eq(d, where)) ?? null,
      findMany: async ({ where }: any) => db.dev.filter((d: any) => eq(d, where)),
      upsert: async ({ where, create, update }: any) => { const w = where.tenantId_provider_externalReaderId; const existing = db.dev.find((d: any) => d.tenantId === w.tenantId && d.provider === w.provider && d.externalReaderId === w.externalReaderId); if (existing) { Object.assign(existing, update); return existing; } const row = { id: id(), ...create }; db.dev.push(row); return row; },
    },
    paymentIntentRecord: {
      findUnique: async ({ where }: any) => { const { tenantId, clientRef } = where.tenantId_clientRef; return db.intent.find((i: any) => i.tenantId === tenantId && i.clientRef === clientRef) ?? null; },
      findFirst: async ({ where }: any) => db.intent.find((i: any) => eq(i, where)) ?? null,
      create: async ({ data }: any) => { const row = { id: id(), succeededAt: null, externalIntentId: null, ...data }; db.intent.push(row); return row; },
      update: async ({ where, data }: any) => { const row = db.intent.find((i: any) => i.id === where.id); Object.assign(row, data); return row; },
      updateMany: async ({ where, data }: any) => { let n = 0; db.intent.filter((i: any) => eq(i, where)).forEach((i: any) => { Object.assign(i, data); n++; }); return { count: n }; },
    },
    paymentRefund: {
      create: async ({ data }: any) => { const row = { id: id(), ...data }; db.refund.push(row); return row; },
      update: async ({ where, data }: any) => { const row = db.refund.find((r: any) => r.id === where.id); Object.assign(row, data); return row; },
      aggregate: async ({ where }: any) => ({ _sum: { amountCents: db.refund.filter((r: any) => eq(r, where)).reduce((s: number, r: any) => s + r.amountCents, 0) } }),
    },
    paymentWebhookEvent: {
      findUnique: async ({ where }: any) => { const w = where.provider_externalEventId; return db.evt.find((e: any) => e.provider === w.provider && e.externalEventId === w.externalEventId) ?? null; },
      upsert: async ({ where, create }: any) => { const w = where.provider_externalEventId; let e = db.evt.find((x: any) => x.provider === w.provider && x.externalEventId === w.externalEventId); if (!e) { e = { id: id(), processedAt: null, ...create }; db.evt.push(e); } return e; },
      update: async ({ where, data }: any) => { const w = where.provider_externalEventId; const e = db.evt.find((x: any) => x.provider === w.provider && x.externalEventId === w.externalEventId); Object.assign(e, data); return e; },
    },
    auditLog: { create: async ({ data }: any) => { db.audit.push(data); return data; } },
  };
}

describe('PaymentOrchestrator (Payment Hub)', () => {
  let prisma: any;
  let mock: MockConnector;
  let hub: PaymentOrchestrator;

  beforeAll(() => {
    process.env.PAYMENTS_HUB_ENABLED = 'true';
    process.env.PAYMENT_ENC_KEY = '0'.repeat(64); // 32 bytes hex
  });

  beforeEach(() => {
    prisma = makePrisma();
    mock = new MockConnector();
    const registry = new ProviderRegistry(mock, new StripeTerminalConnector(), new SquareTerminalConnector(), new SumUpConnector());
    hub = new PaymentOrchestrator(prisma, registry, new CredentialStore(prisma));
  });

  async function connect(user: AuthenticatedUser) {
    return hub.connect(user, { provider: 'mock', secret: 'mock_secret' });
  }

  it('rejects a charge when the feature flag is off', async () => {
    process.env.PAYMENTS_HUB_ENABLED = 'false';
    await expect(hub.charge(adminA, { provider: 'mock', amountCents: 100, clientRef: 'x' })).rejects.toBeInstanceOf(ServiceUnavailableException);
    process.env.PAYMENTS_HUB_ENABLED = 'true';
  });

  it('stores an encrypted credential on connect (never plaintext)', async () => {
    await connect(adminA);
    const row = prisma._db.conn[0];
    expect(row.status).toBe('ACTIVE');
    expect(row.credentialEnc).toMatch(/^v1:/);
    expect(JSON.stringify(row)).not.toContain('mock_secret'); // secret is encrypted at rest
    expect(row.keyHint).toContain('••••');
  });

  it('charges via the connector and persists a SUCCEEDED intent', async () => {
    await connect(adminA);
    const res: any = await hub.charge(adminA, { provider: 'mock', amountCents: 500, clientRef: 'r1' });
    expect(res.status).toBe('SUCCEEDED');
    expect(prisma._db.intent).toHaveLength(1);
    expect(prisma._db.intent[0].tenantId).toBe('tenant-a');
  });

  it('is idempotent: same clientRef never double-charges', async () => {
    await connect(adminA);
    const spy = jest.spyOn(mock, 'charge');
    const a: any = await hub.charge(adminA, { provider: 'mock', amountCents: 500, clientRef: 'dup' });
    const b: any = await hub.charge(adminA, { provider: 'mock', amountCents: 500, clientRef: 'dup' });
    expect(a.id).toBe(b.id);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(prisma._db.intent).toHaveLength(1);
  });

  it('prevents cross-tenant access to an intent (tenant B cannot read tenant A)', async () => {
    await connect(adminA);
    const intent: any = await hub.charge(adminA, { provider: 'mock', amountCents: 500, clientRef: 'r1' });
    await expect(hub.getIntent(adminB, intent.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(hub.refund(adminB, { intentId: intent.id })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('forbids refunds by STAFF (RBAC)', async () => {
    await connect(adminB);
    const intent: any = await hub.charge(adminB, { provider: 'mock', amountCents: 500, clientRef: 'r2' });
    await expect(hub.refund(staffB, { intentId: intent.id })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refunds a succeeded payment (admin) and marks the intent fully refunded', async () => {
    await connect(adminB);
    const intent: any = await hub.charge(adminB, { provider: 'mock', amountCents: 500, clientRef: 'r3' });
    const refund: any = await hub.refund(adminB, { intentId: intent.id });
    expect(refund.status).toBe('SUCCEEDED');
    const stored = prisma._db.intent.find((i: any) => i.id === intent.id);
    expect(stored.status).toBe('CANCELED'); // fully refunded
    expect(prisma._db.audit.some((a: any) => a.action === 'payment.refund')).toBe(true);
  });
});
