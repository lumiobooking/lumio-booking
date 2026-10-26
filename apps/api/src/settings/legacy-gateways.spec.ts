import { brandsOnly, holdsKeys } from './legacy-gateways';

describe('card brand at the counter keeps no keys', () => {
  it('keeps the on/off, drops every key', () => {
    const out = brandsOnly({ stripe: { enabled: true, apiKey: 'support@lumiobooking.com', secret: 'owner-password' } });
    expect(out.stripe).toEqual({ enabled: true, apiKey: '', secret: '' });
    expect(out.helcim).toEqual({ enabled: false, apiKey: '', secret: '' });
  });
  it('knows a stored row still holds keys', () => {
    expect(holdsKeys({ stripe: { enabled: true, apiKey: 'x', secret: '' } })).toBe(true);
    expect(holdsKeys(brandsOnly({ stripe: { enabled: true } }))).toBe(false);
    expect(holdsKeys(null)).toBe(false);
  });
});
