import { chargeAmounts } from './tip-fold';

describe('a card tip is always charged', () => {
  it('Stripe, Square, Helcim, SumUp: one total, tip included', () => {
    for (const p of ['stripe', 'square', 'helcim', 'sumup', 'mock']) expect(chargeAmounts(p, 5000, 1000)).toEqual({ amountCents: 6000 });
  });
  it('Dejavoo itemises the tip itself', () => {
    expect(chargeAmounts('dejavoo', 5000, 1000)).toEqual({ amountCents: 5000, tipCents: 1000 });
  });
  it('no tip: the amount as it is', () => {
    expect(chargeAmounts('stripe', 5000, 0)).toEqual({ amountCents: 5000 });
    expect(chargeAmounts('dejavoo', 5000, undefined)).toEqual({ amountCents: 5000 });
  });
});
