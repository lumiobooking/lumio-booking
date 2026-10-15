import { canAutoCharge, enabledGateways, gatewayOf, manageCardUrl, pickGateway, subscriptionsToRetire } from './gateway-choice';

describe('which gateway holds the card', () => {
  it('prefers Stripe when both are on, falls back to PayPal, honours an explicit ask only when that gateway is on', () => {
    expect(enabledGateways({ stripe: true, paypal: true })).toEqual(['stripe', 'paypal']);
    expect(pickGateway({ stripe: true, paypal: true })).toBe('stripe');
    expect(pickGateway({ stripe: false, paypal: true })).toBe('paypal');
    expect(pickGateway({ stripe: true, paypal: true }, 'paypal')).toBe('paypal');
    expect(pickGateway({ stripe: false, paypal: true }, 'stripe')).toBe('paypal'); // asked for what is not there
    expect(pickGateway({ stripe: false, paypal: false })).toBeNull();
  });

  it('auto-charge needs a live subscription and the id the gateway charges by', () => {
    const pp = { provider: 'paypal', status: 'ACTIVE', externalReference: 'I-ABC', externalCustomerId: null };
    const st = { provider: 'stripe', status: 'ACTIVE', externalReference: 'sub_1', externalCustomerId: 'cus_1' };
    expect(canAutoCharge(pp)).toBe(true);
    expect(canAutoCharge(st)).toBe(true);
    expect(canAutoCharge({ ...st, externalCustomerId: null })).toBe(false);
    expect(canAutoCharge({ ...pp, status: 'PAST_DUE' })).toBe(false);
    expect(canAutoCharge({ ...pp, provider: 'manual' })).toBe(false);
    expect(canAutoCharge(null)).toBe(false);
    expect(gatewayOf('wise')).toBeNull();
  });

  it('a salon that moved gateways has its old subscription retired, never the new one', () => {
    const rows = [
      { externalReference: 'I-OLD', status: 'ACTIVE' },
      { externalReference: 'sub_new', status: 'ACTIVE' },
      { externalReference: 'I-DEAD', status: 'CANCELLED' },
      { externalReference: null, status: 'ACTIVE' },
    ];
    expect(subscriptionsToRetire(rows, 'sub_new').map((r) => r.externalReference)).toEqual(['I-OLD']);
  });

  it('PayPal cards are managed at PayPal; Stripe through a minted portal link', () => {
    expect(manageCardUrl('paypal')).toMatch(/paypal\.com\/myaccount\/autopay/);
    expect(manageCardUrl('stripe')).toBeNull();
    expect(manageCardUrl(null)).toBeNull();
  });
});
