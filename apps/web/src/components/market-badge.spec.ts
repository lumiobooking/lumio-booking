/**
 * The badge must be invisible on the system that is already running.
 *
 * Adding a label to the US dashboard would be a visible change to the thing
 * this whole arrangement exists to leave alone, so "no badge unless the
 * deployment says otherwise" is a rule worth holding down.
 */

/** Same reading the component does, kept here so the rule can be tested
 *  without a DOM. */
function badgeVisible(envValue: string | undefined): boolean {
  const code = (envValue || '').trim().toUpperCase();
  return !!code && code !== 'US';
}

describe('market badge visibility', () => {
  it.each([undefined, '', '   ', 'US', 'us'])('stays hidden when the market is %s', (value) => {
    expect(badgeVisible(value)).toBe(false);
  });

  it.each(['VN', 'vn', ' vn '])('appears for %s', (value) => {
    expect(badgeVisible(value)).toBe(true);
  });

  it('appears for a market nobody has designed a colour for yet', () => {
    // Better an unstyled label than silence: an unknown deployment is exactly
    // the one you must not confuse with production.
    expect(badgeVisible('AU')).toBe(true);
  });
});
