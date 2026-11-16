import { isDeadToken, poolKey, tokenCandidates } from './account-tokens';

describe('google account token pool', () => {
  it('one key per Google account, case-insensitive; nothing for a blank or odd email', () => {
    expect(poolKey('Partners@LumioBooking.com ')).toBe('gbp_token:partners@lumiobooking.com');
    expect(poolKey('')).toBeNull();
    expect(poolKey(null)).toBeNull();
    expect(poolKey('nobody')).toBeNull();
  });
  it('tries the account\'s newest token first, then the salon\'s own, without repeats', () => {
    expect(tokenCandidates('new', 'old')).toEqual(['new', 'old']);
    expect(tokenCandidates('same', 'same')).toEqual(['same']);
    expect(tokenCandidates(null, 'own')).toEqual(['own']);
    expect(tokenCandidates('', '')).toEqual([]);
  });
  it('only invalid_grant is a dead token; a 5xx or a quota answer is not', () => {
    expect(isDeadToken(400, '{"error":"invalid_grant","error_description":"Token has been expired or revoked."}')).toBe(true);
    expect(isDeadToken(500, 'backend error')).toBe(false);
    expect(isDeadToken(429, 'rate')).toBe(false);
  });
});
