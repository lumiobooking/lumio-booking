import { isVN, isNorthAmerica, marketOption, marketTag, defaultLangForMarket } from './markets';

/**
 * One question, one answer, from one field.
 *
 * These helpers exist because screens were deciding "is this salon Vietnamese?"
 * by reading `company.country` — the dropdown an owner uses to set their
 * currency format — while SMS routing, feature policy and money all read
 * `tenant.market`. The two are synced when a salon is created and never again,
 * which produced two silent failures in opposite directions: a shop moved to
 * Vietnam by support had its messages switched to the Vietnamese carrier while
 * the screen that configures that carrier stayed hidden, and a US shop whose
 * owner idly picked "Việt Nam" in the country dropdown was shown the whole
 * Vietnamese setup, which then did nothing at all.
 */
describe('which market is this salon in', () => {
  it('recognises Vietnam however it is written', () => {
    for (const v of ['VN', 'vn', ' Vn ']) expect(isVN(v)).toBe(true);
  });

  it('treats anything it does not recognise as NOT Vietnam', () => {
    // The safe direction. Guessing "Vietnamese" for an unknown value would show
    // a US salon a Vietnamese carrier panel; guessing the other way shows a
    // Vietnamese salon one screen too many, which someone will notice and say.
    for (const v of [null, undefined, '', 'US', 'CA', 'VNM', 'Vietnam']) expect(isVN(v)).toBe(false);
  });

  it('counts an unset market as North America, because every existing salon is', () => {
    // Twilio, the US card gateways and the Census figures were all built for
    // that market, and every salon on the platform before Vietnam was in it.
    // A missing value must not hide the screens they use every day.
    for (const v of ['US', 'CA', 'us', '', null, undefined]) expect(isNorthAmerica(v)).toBe(true);
    expect(isNorthAmerica('VN')).toBe(false);
  });

  it('never says a salon is in both places at once', () => {
    for (const v of ['US', 'CA', 'VN', 'ZZ', '', null]) {
      expect(isVN(v) && isNorthAmerica(v)).toBe(false);
    }
  });
});

describe('the market labels', () => {
  it('falls back to US for anything unrecognised', () => {
    expect(marketOption('nope').code).toBe('US');
    expect(marketTag(null)).toBe('US');
    expect(marketTag('vn')).toBe('VN');
  });

  it('opens a Vietnamese salon in Vietnamese, unless someone has chosen', () => {
    expect(defaultLangForMarket('VN', null)).toBe('vi');
    expect(defaultLangForMarket('VN', 'en')).toBeNull(); // a stored choice wins
    expect(defaultLangForMarket('US', null)).toBeNull();
  });
});
