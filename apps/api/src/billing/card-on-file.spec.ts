import { cardLabel, cardMetaFromPaypal, cardMetaFromStripe, declineText, gatewayForNewCard, nextPeriod, prorateCents, renewalDue } from './card-on-file';

describe('a card the salon saved', () => {
  it('reads what a receipt prints from either gateway, and prints it one way', () => {
    const pp = cardMetaFromPaypal({ id: 'tok', payment_source: { card: { brand: 'VISA', last_digits: '4242', expiry: '2027-12', name: 'A' } } });
    expect(pp).toEqual({ brand: 'VISA', last4: '4242', expMonth: 12, expYear: 2027 });
    const st = cardMetaFromStripe({ id: 'pm_1', card: { brand: 'mastercard', last4: '4444', exp_month: 3, exp_year: 2028 } });
    expect(st).toEqual({ brand: 'mastercard', last4: '4444', expMonth: 3, expYear: 2028 });
    expect(cardLabel(pp)).toBe('VISA •••• 4242 · 12/27');
    expect(cardLabel(st)).toBe('Mastercard •••• 4444 · 03/28');
    expect(cardLabel({ brand: null, last4: null, expMonth: null, expYear: null })).toBe('Card');
    expect(cardMetaFromPaypal(null).last4).toBeNull();
  });

  it('a new card goes to the preferred gateway that has BOTH its keys', () => {
    expect(gatewayForNewCard({ stripe: true, paypal: true, stripePublic: true, paypalClient: true })).toBe('stripe');
    expect(gatewayForNewCard({ stripe: true, paypal: true, stripePublic: false, paypalClient: true })).toBe('paypal'); // no publishable key yet
    expect(gatewayForNewCard({ stripe: false, paypal: true, stripePublic: false, paypalClient: true }, 'stripe')).toBe('paypal');
    expect(gatewayForNewCard({ stripe: false, paypal: false, stripePublic: false, paypalClient: false })).toBeNull();
  });

  it('an upgrade is charged for the days left, a downgrade is not', () => {
    const now = new Date('2026-10-15T00:00:00Z');
    const until = new Date('2026-10-30T00:00:00Z'); // 15 days left
    expect(prorateCents(2900, 6900, until, now)).toBe(2000); // (6900-2900) * 15 / 30
    expect(prorateCents(6900, 2900, until, now)).toBe(0);
    expect(prorateCents(2900, 6900, null, now)).toBe(0);
    expect(prorateCents(2900, 6900, new Date('2026-10-01T00:00:00Z'), now)).toBe(0);
  });

  it('the first charge after adding a card is due when access is over or about to be', () => {
    const now = new Date('2026-10-15T00:00:00Z');
    expect(renewalDue(null, now)).toBe(true);
    expect(renewalDue(new Date('2026-10-01T00:00:00Z'), now)).toBe(true);
    expect(renewalDue(new Date('2026-10-17T00:00:00Z'), now)).toBe(true); // within 3 days
    expect(renewalDue(new Date('2026-11-10T00:00:00Z'), now)).toBe(false);
    expect(nextPeriod(new Date('2026-10-17T00:00:00Z'), now)).toEqual({ start: new Date('2026-10-17T00:00:00Z'), end: new Date('2026-11-17T00:00:00Z') });
    expect(nextPeriod(new Date('2026-10-01T00:00:00Z'), now).start).toEqual(now);
  });

  it('declines are said in the salon\'s language', () => {
    expect(declineText('INSUFFICIENT_FUNDS', true)).toBe('Thẻ không đủ tiền.');
    expect(declineText('Your card has expired.', false)).toMatch(/expired/);
    expect(declineText('', true)).toBe('Thẻ bị từ chối.');
  });
});
