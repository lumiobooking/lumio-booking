import { marketOf, presetFor, featureAvailableInMarket, marketList, isMarketCode, DEFAULT_MARKET, MARKETS } from './markets';
import { DEFAULT_BOOKING_RULES, DEFAULT_POS_SETTINGS, DEFAULT_COMPANY_EXTRA } from '../settings/settings.constants';

describe('every salon on the platform today is US, and must stay exactly as it is', () => {
  // This is the whole safety argument for adding a market column. Every
  // existing tenant gets 'US' by default, so if the US preset drifts from the
  // defaults the system already ships, it silently rewrites live salons.
  //
  // A failure here means the CHANGE is unsafe, not that the test is stale.
  it('defaults to US', () => {
    expect(DEFAULT_MARKET).toBe('US');
  });

  it('US money settings are byte-for-byte the shipped defaults', () => {
    const p = presetFor('US').bookingRules;
    expect(p.currency).toBe(DEFAULT_BOOKING_RULES.currency);
    expect(p.symbolPosition).toBe(DEFAULT_BOOKING_RULES.symbolPosition);
    expect(p.priceDecimals).toBe(DEFAULT_BOOKING_RULES.priceDecimals);
    // '' = derive from the currency code. Writing '$' would be a change to
    // every live salon rather than a preset, so it is asserted too.
    expect(p.currencySymbol).toBe(DEFAULT_BOOKING_RULES.currencySymbol);
    expect(p.currencySymbol).toBe('');
  });

  it('US keeps tips on, as the shipped default does', () => {
    expect(presetFor('US').posSettings.tipsEnabled).toBe(DEFAULT_POS_SETTINGS.tipsEnabled);
    expect(presetFor('US').posSettings.tipsEnabled).toBe(true);
  });

  it('US takes nothing away — no feature becomes unsellable', () => {
    expect(MARKETS.US.unavailableFeatures).toEqual([]);
    expect(MARKETS.CA.unavailableFeatures).toEqual([]);
  });

  it('US stays English', () => {
    expect(presetFor('US').lang).toBe('en');
  });
});

describe('an unrecognised or missing market is US, never a crash', () => {
  // Rows written before this column existed, a typo in a script, a value from
  // a future version rolled back — none of these should break a salon.
  it.each([null, undefined, '', '   ', 'ZZ', 'vietnam', '123'])('resolves %s to US', (code) => {
    expect(marketOf(code).code).toBe('US');
  });

  it('accepts a code however it was typed', () => {
    for (const written of ['vn', 'VN', ' Vn ', 'vN']) {
      expect(marketOf(written).code).toBe('VN');
    }
  });

  it('isMarketCode agrees with marketOf', () => {
    expect(isMarketCode('VN')).toBe(true);
    expect(isMarketCode('ZZ')).toBe(false);
    expect(isMarketCode(null)).toBe(false);
  });
});

describe('Vietnam — the four things that were wrong before', () => {
  const vn = presetFor('VN');

  // The bug that quoted a 200,000₫ manicure as ₫2,000: dong has no minor unit,
  // so anything that assumes two decimal places is off by a factor of a hundred.
  it('has no minor unit', () => {
    expect(vn.bookingRules.priceDecimals).toBe(0);
  });

  it('writes the symbol after the number, as Vietnamese does', () => {
    expect(vn.bookingRules.symbolPosition).toBe('after');
    expect(vn.bookingRules.currencySymbol).toBe('₫');
  });

  it('uses dong', () => {
    expect(vn.bookingRules.currency).toBe('VND');
  });

  it('starts in Vietnamese, in Vietnamese time', () => {
    expect(vn.lang).toBe('vi');
    expect(vn.tenant.timezone).toBe('Asia/Ho_Chi_Minh');
  });

  it('sets the country, which is what drives phone numbers and date formats', () => {
    expect(vn.companyExtra.country).toBe('VN');
  });

  it('starts with tips off', () => {
    expect(vn.posSettings.tipsEnabled).toBe(false);
  });
});

describe('features that do not exist in a market are not offered there', () => {
  // Not a security boundary — every feature already starts hidden and is handed
  // over one tick at a time. This only stops someone selling a Hanoi salon a
  // North American card terminal.
  it.each(['voiceAi', 'terminals'])('%s is not offered in Vietnam', (key) => {
    expect(featureAvailableInMarket('VN', key)).toBe(false);
  });

  it.each(['messengerAi', 'reviews', 'marketing', 'emailMarketing', 'payroll', 'chain', 'integrations'])(
    '%s is still offerable in Vietnam',
    (key) => {
      expect(featureAvailableInMarket('VN', key)).toBe(true);
    },
  );

  it('takes nothing away from the US', () => {
    for (const key of ['voiceAi', 'terminals', 'messengerAi', 'reviews', 'marketing']) {
      expect(featureAvailableInMarket('US', key)).toBe(true);
    }
  });

  it('an unknown market hides nothing, because it is treated as US', () => {
    expect(featureAvailableInMarket('ZZ', 'terminals')).toBe(true);
  });
});

describe('the dropdown', () => {
  it('offers US first, so the common case is the default', () => {
    expect(marketList()[0].code).toBe('US');
  });

  it('every entry has a label and a short code to tell them apart at a glance', () => {
    for (const m of marketList()) {
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.short.length).toBeGreaterThan(0);
    }
  });

  // Windows has no country-flag glyphs, so Chrome there renders one as its two
  // raw regional-indicator letters: the dropdown read "us US / Canada". Super
  // Admin work happens on Windows, so this is pinned rather than trusted.
  it('uses no flag emoji anywhere a Windows browser has to draw it', () => {
    for (const m of marketList()) {
      expect(`${m.label} ${m.short}`).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u);
    }
  });

  it('country defaults exist for the fields the settings screens read', () => {
    for (const m of marketList()) {
      expect(m.country).toBeTruthy();
      expect(m.timezone).toContain('/');
      expect(m.currency).toHaveLength(3);
    }
  });

  it('the company-extra shape matches what the settings service stores', () => {
    expect(Object.keys(presetFor('VN').companyExtra)).toEqual(
      Object.keys(presetFor('VN').companyExtra).filter((k) => k in DEFAULT_COMPANY_EXTRA),
    );
  });
});
