import { createHmac } from 'crypto';
import { packPair, pairOf } from './connectors/pair-secret';
import { CloverConnector } from './connectors/clover.connector';
import { PaypalConnector } from './connectors/paypal.connector';
import { HelcimConnector } from './connectors/helcim.connector';
import { ONLINE_PROVIDERS, isOnlineProvider } from './online-providers';

describe('two-part credentials in one secret', () => {
  it('round-trips id + secret + environment', () => {
    const s = packPair({ id: 'CLIENT', secret: 'S3CR3T', env: 'sandbox' });
    expect(pairOf(s)).toEqual({ id: 'CLIENT', secret: 'S3CR3T', env: 'sandbox' });
  });
  it('at connect time the parts come separately', () => {
    expect(pairOf(' S ', { publicId: ' ID ', environment: 'production' })).toEqual({ id: 'ID', secret: 'S', env: 'production' });
  });
});

describe('Clover webhook: only a correctly signed APPROVED counts', () => {
  const c = new CloverConnector();
  const body = Buffer.from(JSON.stringify({ type: 'PAYMENT', id: 'PAY1', status: 'APPROVED', merchantId: 'M1', data: 'SESSION1' }));
  const sig = (secret: string, t = '1700000000') => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body.toString()}`).digest('hex')}`;
  it('maps the checkout session to SUCCEEDED and keeps the payment id', () => {
    const e = c.verifyWebhook(body, sig('whsec'), 'whsec');
    expect(e).toMatchObject({ id: 'PAY1', intentExternalId: 'SESSION1', status: 'SUCCEEDED', raw: { paymentId: 'PAY1' } });
  });
  it('a wrong secret is refused', () => {
    expect(() => c.verifyWebhook(body, sig('other'), 'whsec')).toThrow();
    expect(() => c.verifyWebhook(body, '', 'whsec')).toThrow();
  });
});

describe('PayPal: approved is captured by us; only a completed capture is paid', () => {
  const real = (globalThis as any).fetch;
  afterEach(() => { (globalThis as any).fetch = real; });
  const secret = packPair({ id: 'cid', secret: 'sec', env: 'sandbox' });
  const res = (status: number, json: unknown) => ({ ok: status < 300, status, json: async () => json, text: async () => JSON.stringify(json) });

  it('APPROVED → capture → COMPLETED', async () => {
    const seen: string[] = [];
    (globalThis as any).fetch = async (url: string, init: { method: string }) => {
      seen.push(`${init.method} ${url.replace('https://api-m.sandbox.paypal.com', '')}`);
      if (url.endsWith('/v1/oauth2/token')) return res(200, { access_token: 'tok' });
      if (init.method === 'GET') return res(200, { id: 'O1', status: 'APPROVED' });
      return res(201, { id: 'O1', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { value: '20.00', currency_code: 'USD' } }] } }] });
    };
    const r = await new PaypalConnector().lookupOnlinePaymentByOrder(secret, 'O1');
    expect(r).toEqual({ approved: true, amountCents: 2000, transactionId: 'CAP1' });
    expect(seen).toContain('POST /v2/checkout/orders/O1/capture');
  });

  it('an order the customer never approved is not paid', async () => {
    (globalThis as any).fetch = async (url: string) => (url.endsWith('/v1/oauth2/token') ? res(200, { access_token: 'tok' }) : res(200, { id: 'O1', status: 'PAYER_ACTION_REQUIRED' }));
    expect((await new PaypalConnector().lookupOnlinePaymentByOrder(secret, 'O1')).approved).toBe(false);
  });
});

describe('which providers can take a card online', () => {
  it('the five with a hosted checkout, nothing else', () => {
    expect([...ONLINE_PROVIDERS].sort()).toEqual(['clover', 'helcim', 'paypal', 'square', 'stripe']);
    expect(isOnlineProvider('mock')).toBe(false);
    expect(isOnlineProvider('dejavoo')).toBe(false);
  });
});

describe('Helcim online deposit: the checkout creates its own invoice', () => {
  const real = (globalThis as any).fetch;
  afterEach(() => { (globalThis as any).fetch = real; });
  const res = (status: number, json: unknown) => ({ ok: status < 300, status, json: async () => json, text: async () => JSON.stringify(json) });

  it('sends invoiceRequest (not a bare invoiceNumber) with one line equal to the amount', async () => {
    const bodies: any[] = [];
    (globalThis as any).fetch = async (_url: string, init: { body: string }) => { bodies.push(JSON.parse(init.body)); return res(200, { checkoutToken: 'CT', secretToken: 'ST' }); };
    const r = await new HelcimConnector().startOnlineCheckout('tok', 300, 'usd', 'appt-123', { description: 'Booking deposit' });
    expect(r.checkoutToken).toBe('CT');
    expect(bodies).toHaveLength(1);
    const b = bodies[0];
    expect(b).toMatchObject({ paymentType: 'purchase', amount: 3, currency: 'USD' });
    expect(b.invoiceNumber).toBeUndefined();
    expect(b.invoiceRequest.invoiceNumber).toBe('LUMAPPT123');
    expect(b.invoiceRequest.lineItems).toEqual([{ sku: 'DEPOSIT', description: 'Booking deposit', quantity: 1, price: 3, total: 3 }]);
  });

  it('falls back to the plain shape once, then reports Helcim\'s own error', async () => {
    const bodies: any[] = [];
    (globalThis as any).fetch = async (_url: string, init: { body: string }) => { bodies.push(JSON.parse(init.body)); return res(400, { errors: 'Invalid invoice' }); };
    await expect(new HelcimConnector().startOnlineCheckout('tok', 300, 'USD', 'appt-123')).rejects.toThrow('Invalid invoice');
    expect(bodies).toHaveLength(2);
    expect(bodies[1].invoiceNumber).toBe('LUMAPPT123');
  });
});
