import { CredentialStore } from './credential-store.service';

/**
 * One salon must never be able to reach another salon's terminal credentials,
 * even by guessing a device id. The guard is that every lookup is filtered by
 * tenantId as well as id, so another salon's device simply does not exist.
 */
describe('CredentialStore — tenant isolation', () => {
  const OLD = process.env.PAYMENT_ENC_KEY;
  beforeAll(() => { process.env.PAYMENT_ENC_KEY = 'a'.repeat(64); });
  afterAll(() => { process.env.PAYMENT_ENC_KEY = OLD; });

  const devices: any = {
    devA: { id: 'devA', tenantId: 'salonA', credentialEnc: null },
    devB: { id: 'devB', tenantId: 'salonB', credentialEnc: null },
  };
  const conns: any = {
    salonA: { tenantId: 'salonA', provider: 'dejavoo', status: 'ACTIVE', credentialEnc: null },
  };
  const prisma: any = {
    paymentDevice: {
      findFirst: async ({ where }: any) =>
        Object.values(devices).find((d: any) => d.id === where.id && d.tenantId === where.tenantId) ?? null,
    },
    paymentConnection: {
      findUnique: async ({ where }: any) => conns[where.tenantId_provider.tenantId] ?? null,
    },
  };

  let store: CredentialStore;
  beforeAll(() => {
    store = new CredentialStore(prisma);
    devices.devA.credentialEnc = store.packDeviceCredential('dejavoo', { secret: 'AAAAAAAAAA', tpn: 'TPNAAA00001' }).credentialEnc;
    devices.devB.credentialEnc = store.packDeviceCredential('dejavoo', { secret: 'BBBBBBBBBB', tpn: 'TPNBBB00002' }).credentialEnc;
    conns.salonA.credentialEnc = store.packDeviceCredential('dejavoo', { secret: 'FALLBACKAA', tpn: 'TPNFALLBACK' }).credentialEnc;
  });

  it('gives each salon its own terminal key', async () => {
    const a = await store.credentialForDevice('salonA', 'dejavoo', 'devA');
    expect(JSON.parse(a.secret).t).toBe('TPNAAA00001');
  });

  it('never hands salon A the key belonging to salon B', async () => {
    const cross = await store.credentialForDevice('salonA', 'dejavoo', 'devB');
    const dump = JSON.stringify(cross);
    expect(dump).not.toContain('BBBBBBBBBB');
    expect(dump).not.toContain('TPNBBB00002');
    // Falls back to salon A's own connection instead.
    expect(JSON.parse(cross.secret).t).toBe('TPNFALLBACK');
  });

  it('falls back to the account key when a terminal has none of its own', async () => {
    const saved = devices.devA.credentialEnc;
    devices.devA.credentialEnc = null;
    const fb = await store.credentialForDevice('salonA', 'dejavoo', 'devA');
    expect(JSON.parse(fb.secret).t).toBe('TPNFALLBACK');
    devices.devA.credentialEnc = saved;
  });

  it('keeps the encrypted blob out of the UI payload', () => {
    const view = store.publicView({ provider: 'dejavoo', status: 'ACTIVE', keyHint: '****AAAA', credentialEnc: 'SECRET_BLOB' });
    expect(JSON.stringify(view)).not.toContain('SECRET_BLOB');
  });
});
