import { marketOption, marketTag, MARKET_OPTIONS, defaultLangForMarket } from './markets';

describe('a salon with no market is a US salon', () => {
  // Every tenant row created before the market column existed comes back with
  // `market` undefined. The Super Admin list must show and filter those as US,
  // not as blank or unknown — they are the salons paying for this today.
  it.each([null, undefined, '', '   ', 'ZZ', 'vietnam'])('shows %s as US', (code) => {
    expect(marketOption(code).code).toBe('US');
  });

  it('tags them US so a row is never blank', () => {
    expect(marketTag(undefined)).toBe('US');
  });
});

describe('reading a market off a row', () => {
  it.each(['vn', 'VN', ' Vn '])('resolves %s to Vietnam', (code) => {
    expect(marketOption(code).code).toBe('VN');
    expect(marketOption(code).label).toBe('Việt Nam');
  });

  it('gives a compact tag for a table cell', () => {
    expect(marketTag('VN')).toBe('VN');
    expect(marketTag('CA')).toBe('CA');
  });
});

describe('the dropdown', () => {
  it('lists US first, so the common case needs no thought', () => {
    expect(MARKET_OPTIONS[0].code).toBe('US');
  });

  it('has a distinct code, label and flag for each entry', () => {
    const codes = MARKET_OPTIONS.map((m) => m.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const m of MARKET_OPTIONS) {
      expect(m.label).toBeTruthy();
      expect(m.short).toBeTruthy();
      expect(m.timezone).toContain('/');
    }
  });

  // Deliberately NOT asserted here: currency, decimals, tipping. Those live on
  // the server (apps/api/src/common/markets.ts) and duplicating them would give
  // two places to disagree about what a Vietnamese salon's currency is.
  it('carries only a timezone hint, never money', () => {
    for (const m of MARKET_OPTIONS) {
      expect(Object.keys(m).sort()).toEqual(['code', 'label', 'short', 'timezone']);
    }
  });
});

describe('a Vietnamese salon opens in Vietnamese', () => {
  // Its owner should not have to find a language menu written in English on
  // their first sign-in.
  it('defaults a VN salon to Vietnamese', () => {
    expect(defaultLangForMarket('VN', null)).toBe('vi');
  });

  it.each(['US', 'CA', '', null, undefined, 'ZZ'])('leaves %s alone', (market) => {
    expect(defaultLangForMarket(market, null)).toBeNull();
  });

  // The half that matters more: never overrule someone who chose. A Vietnamese
  // owner who prefers the English labels must not be switched back on every
  // page load.
  it.each(['en', 'vi'])('never overrides a stored choice of %s', (stored) => {
    expect(defaultLangForMarket('VN', stored)).toBeNull();
  });

  it('ignores a junk stored value and still applies the market default', () => {
    expect(defaultLangForMarket('VN', 'klingon')).toBe('vi');
  });
});

describe('nothing here relies on a glyph Windows does not have', () => {
  // Chrome on Windows draws a country-flag emoji as its two raw
  // regional-indicator letters, which is how the Market column came out
  // reading "us US" and the dropdown "us US / Canada".
  it('emits no flag emoji from any market tag', () => {
    for (const code of ['US', 'CA', 'VN', 'ZZ', undefined]) {
      expect(marketTag(code)).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u);
    }
  });

  it('emits no flag emoji from any dropdown label', () => {
    for (const m of MARKET_OPTIONS) {
      expect(`${m.label} ${m.short}`).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u);
    }
  });
});
