import {
  externalPaymentIdOf, packDeviceSecret, packIntentId, payBody, readDeviceSecret, readDevices, readIntentId, readPayResult,
} from './connectors/clover-device';
import { authorizeUrl, cloverAppConfig, needsRefresh, readTokens, signState, verifyState } from './clover-oauth';
import { CloverDeviceConnector } from './connectors/clover-device.connector';
import { CredentialStore } from './credential-store.service';
import { chargeAmounts } from './tip-fold';

describe('rt233 — Clover device: pure pieces', () => {
  it('packs and reads the secret; connect-time parts work too', () => {
    const p = packDeviceSecret({ mid: 'M1', token: 'tok', env: 'sandbox' });
    expect(readDeviceSecret(p)).toEqual({ mid: 'M1', token: 'tok', env: 'sandbox' });
    expect(readDeviceSecret('tok2', { publicId: 'M2' })).toEqual({ mid: 'M2', token: 'tok2', env: 'production' });
  });

  it('externalPaymentId fits Clover’s 32 characters and is stable', () => {
    const ref = 'pos-1f64f10e-91f4-5577-ba62-da915b529fa6';
    expect(externalPaymentIdOf(ref)).toHaveLength(32);
    expect(externalPaymentIdOf(ref)).toBe(externalPaymentIdOf(ref));
    expect(externalPaymentIdOf('ABC123')).toBe('ABC123');
  });

  it('a closed sale with the tip as a tip', () => {
    expect(payBody({ amountCents: 4500, tipCents: 800, reference: 'R1', invoiceNumber: 'T-0042' })).toEqual({
      amount: 4500, externalPaymentId: 'R1', final: true, tipAmount: 800, externalReferenceId: 'T-0042',
    });
    expect(chargeAmounts('clover_device', 4500, 800)).toEqual({ amountCents: 4500, tipCents: 800 });
  });

  it('reads success, cancel and errors in words a cashier can use', () => {
    expect(readPayResult(true, { payment: { id: 'P1', result: 'SUCCESS', amount: 4500, tipAmount: 800, cardTransaction: { last4: '4242' } } }))
      .toEqual({ status: 'SUCCEEDED', paymentId: 'P1', amountCents: 4500, tipCents: 800, last4: '4242' });
    expect(readPayResult(false, { code: 'processing_error', message: 'The payment request was canceled.' }).status).toBe('CANCELED');
    expect(readPayResult(false, { message: 'Device is not connected' }).error).toMatch(/Cloud Pay Display/);
    expect(readPayResult(false, { message: '401 Unauthorized' }).error).toMatch(/Connect with Clover/);
  });

  it('device list and intent ids', () => {
    expect(readDevices({ elements: [{ serial: 'C046', model: 'Clover_C406' }, { serial: '' }] })).toEqual([{ serial: 'C046', label: 'Clover_C406', model: 'Clover_C406' }]);
    expect(readIntentId(packIntentId('C046', 'ref|x'))).toEqual({ serial: 'C046', reference: 'ref|x' });
  });
});

describe('rt233 — Connect with Clover (OAuth)', () => {
  const cfg = cloverAppConfig({ CLOVER_APP_ID: 'app', CLOVER_APP_SECRET: 's', CLOVER_ENV: 'sandbox' } as never, 'https://api.lumio.test')!;
  it('stays off until the app keys exist', () => {
    expect(cloverAppConfig({} as never, 'x')).toBeNull();
    expect(cfg.redirectUri).toBe('https://api.lumio.test/api/payments-hub/clover/callback');
    expect(authorizeUrl(cfg, 'ST')).toMatch(/^https:\/\/sandbox\.dev\.clover\.com\/oauth\/v2\/authorize\?client_id=app&/);
  });
  it('the state names one salon, is signed and expires', () => {
    const now = 1_800_000_000_000;
    const st = signState({ tenantId: 'A', userId: 'u1' }, 'k', now);
    expect(verifyState(st, 'k', now + 1000)).toEqual({ tenantId: 'A', userId: 'u1' });
    expect(verifyState(st, 'other-key', now)).toBeNull();
    expect(verifyState(st.replace(/^[^.]+/, Buffer.from(JSON.stringify({ t: 'B', u: 'u1', at: now })).toString('base64url')), 'k', now)).toBeNull();
    expect(verifyState(st, 'k', now + 16 * 60_000)).toBeNull();
  });
  it('tokens and refresh timing', () => {
    const t = readTokens({ access_token: 'a', refresh_token: 'r', access_token_expiration: 1_800_000_000, refresh_token_expiration: 1_900_000_000 })!;
    expect(t.accessExp).toBe(1_800_000_000_000);
    expect(needsRefresh(Date.now() + 60_000)).toBe(true);
    expect(needsRefresh(Date.now() + 60 * 60_000)).toBe(false);
  });
});

describe('rt233 — the connector drives the device and never hangs the till', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });
  const secret = packDeviceSecret({ mid: 'M1', token: 'tok', env: 'sandbox' });

  it('sends the sale to the named device with the POS id, and reports the result', async () => {
    const calls: { url: string; init: any }[] = [];
    global.fetch = jest.fn(async (url: string, init: any) => {
      calls.push({ url, init });
      const body = url.endsWith('/v1/payments') ? { payment: { id: 'P9', result: 'SUCCESS', amount: 4500, tipAmount: 800 } } : {};
      return { status: 200, text: async () => JSON.stringify(body) } as never;
    }) as never;
    const c = new CloverDeviceConnector();
    const r = await c.charge(secret, { amountCents: 4500, tipCents: 800, currency: 'USD', readerExternalId: 'C046', reference: 'R1' });
    expect(r).toMatchObject({ status: 'SUCCEEDED', externalId: 'C046|R1' });
    const sale = calls.find((x) => x.url === 'https://apisandbox.dev.clover.com/connect/v1/payments')!;
    expect(sale.init.headers['X-Clover-Device-Id']).toBe('C046');
    expect(sale.init.headers['X-POS-Id']).toBeTruthy();
    expect(JSON.parse(sale.init.body)).toMatchObject({ amount: 4500, tipAmount: 800, final: true });
  });

  it('a customer still paying = PROCESSING now, the outcome later', async () => {
    let finish: (v: unknown) => void = () => undefined;
    global.fetch = jest.fn((url: string) => url.endsWith('/v1/payments')
      ? new Promise((res) => { finish = res; })
      : Promise.resolve({ status: 200, text: async () => '{}' })) as never;
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const c = new CloverDeviceConnector();
    const p = c.charge(secret, { amountCents: 1000, currency: 'USD', readerExternalId: 'C046', reference: 'R2' });
    await jest.advanceTimersByTimeAsync(4_100);
    expect((await p).status).toBe('PROCESSING');
    finish({ status: 200, text: async () => JSON.stringify({ payment: { id: 'P2', result: 'SUCCESS', amount: 1000 } }) });
    jest.useRealTimers();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect((await c.getIntent(secret, 'C046|R2')).status).toBe('SUCCEEDED');
  });

  it('no device picked: refused at once', async () => {
    expect((await new CloverDeviceConnector().charge(secret, { amountCents: 1, currency: 'USD', reference: 'R3' })).status).toBe('FAILED');
  });
});

describe('rt233 — tokens are refreshed for the calling salon only', () => {
  it('the credential store hands the refresher this salon’s own credential', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { encryptSecret } = require('./crypto.util');
    process.env.PAYMENT_ENC_KEY = process.env.PAYMENT_ENC_KEY || 'a'.repeat(64);
    const enc = encryptSecret(JSON.stringify({ secret: 'old', publicId: 'MA', environment: 'sandbox', accessExp: 1 }));
    const seen: unknown[] = [];
    const prisma = { paymentConnection: { findUnique: jest.fn(async (a: any) => { seen.push(a.where); return { status: 'ACTIVE', credentialEnc: enc }; }) } };
    const store = new CredentialStore(prisma as never);
    const asked: string[] = [];
    store.setRefresher('clover_device', async (tenantId, cred) => { asked.push(tenantId); return { ...cred, secret: 'new' }; });
    const cred = await store.loadCred('A', 'clover_device');
    expect(asked).toEqual(['A']);
    expect(JSON.stringify(seen)).toContain('"tenantId":"A"');
    expect(readDeviceSecret(cred.secret)).toEqual({ mid: 'MA', token: 'new', env: 'sandbox' });
  });
});
