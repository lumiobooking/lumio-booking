import { keyFormatProblem } from './key-format';

describe('payment key format', () => {
  it('refuses an email the browser filled into the key field', () => {
    expect(keyFormatProblem('stripe', 'support@lumiobooking.com')).toMatch(/email/);
    expect(keyFormatProblem('helcim', 'owner@salon.com')).toMatch(/email/);
  });
  it('Stripe: the publishable key is not the one Lumio needs', () => {
    expect(keyFormatProblem('stripe', 'pk_live_abc123')).toMatch(/Publishable/);
  });
  it('Stripe: secret and restricted keys pass, live or test', () => {
    for (const k of ['sk_live_abc', 'rk_live_abc', 'sk_test_abc', 'rk_test_abc']) expect(keyFormatProblem('stripe', k)).toBeNull();
    expect(keyFormatProblem('stripe', 'hunter2password')).toMatch(/rk_live_/);
  });
  it('Stripe: a webhook secret starts with whsec_', () => {
    expect(keyFormatProblem('stripe', 'rk_live_abc', 'whsec_abc')).toBeNull();
    expect(keyFormatProblem('stripe', 'rk_live_abc', 'abc')).toMatch(/whsec_/);
  });
  it('other providers keep their own formats', () => {
    expect(keyFormatProblem('helcim', 'aBcD1234-token')).toBeNull();
  });
});
