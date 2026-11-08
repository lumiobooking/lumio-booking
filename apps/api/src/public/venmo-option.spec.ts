import { venmoOption } from './venmo-option';
import { PaypalConnector } from '../payments-hub/connectors/paypal.connector';

describe('Venmo on the booking page', () => {
  const pp = { provider: 'paypal', paypal: { clientId: 'AbC-public', env: 'live' as const } };
  it('is offered only for PayPal salons charging US dollars', () => {
    expect(venmoOption(pp, 'USD')).toEqual({ clientId: 'AbC-public', env: 'live', currency: 'USD' });
    expect(venmoOption(pp, 'usd')).not.toBeNull();
    expect(venmoOption(pp, 'CAD')).toBeNull();
    expect(venmoOption({ provider: 'square' }, 'USD')).toBeNull();
    expect(venmoOption({ provider: 'paypal' }, 'USD')).toBeNull();
    expect(venmoOption(null, 'USD')).toBeNull();
  });

  it('the page gets the PUBLIC client id only — never the secret', () => {
    const secret = 'pair:' + Buffer.from(JSON.stringify({ id: 'client-id-123', secret: 'TOP-SECRET', env: 'sandbox' })).toString('base64url');
    const c = new PaypalConnector().publicConfig(secret);
    expect(c).toEqual({ clientId: 'client-id-123', env: 'sandbox' });
    expect(JSON.stringify(c)).not.toContain('TOP-SECRET');
  });

  it('an order for the on-page button carries no payment source and returns its id', async () => {
    const calls: { url: string; body: any }[] = [];
    const g = globalThis as any;
    const old = g.fetch;
    g.fetch = async (url: string, init: any) => {
      calls.push({ url, body: init?.body ? (typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body) : null });
      if (url.endsWith('/v1/oauth2/token')) return { ok: true, status: 200, json: async () => ({ access_token: 't' }), text: async () => '' };
      return { ok: true, status: 201, json: async () => ({ id: 'ORDER-9' }), text: async () => JSON.stringify({ id: 'ORDER-9' }) };
    };
    try {
      const secret = 'pair:' + Buffer.from(JSON.stringify({ id: 'cid', secret: 's', env: 'sandbox' })).toString('base64url');
      const out = await new PaypalConnector().startOnlineCheckout(secret, 2500, 'USD', 'appt-1', { sdk: true, brandName: 'Saigon Spa' });
      expect(out).toEqual({ orderId: 'ORDER-9', externalRef: 'ORDER-9' });
      const order = calls.find((c) => c.url.endsWith('/v2/checkout/orders'));
      expect(order?.body?.payment_source).toBeUndefined();
      expect(order?.body?.purchase_units?.[0]?.amount).toEqual({ currency_code: 'USD', value: '25.00' });
    } finally { g.fetch = old; }
  });
});
