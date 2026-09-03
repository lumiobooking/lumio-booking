import { tradeKeywordsFor, fillKeyword } from './trade-keywords';
import { knownTrades } from './trend-feed';

describe('the keyword map each trade gets', () => {
  it('gives a lash studio lash keywords, not nail ones', () => {
    const lash = tradeKeywordsFor('LASH', 'US');
    const all = lash.adGroups.flatMap((g) => g.keywords).join(' ');
    expect(all).toContain('lash');
    expect(all).not.toContain('nail');
  });

  it('phrases Vietnamese groups the way people actually type', () => {
    // "near me" after a noun is English word order. A VN group built from the
    // US template reads as machine translation and matches nothing.
    const vn = tradeKeywordsFor('NAIL', 'VN');
    const kws = vn.adGroups.flatMap((g) => g.keywords);
    expect(kws.some((k) => k.includes('gần đây'))).toBe(true);
    expect(kws.every((k) => !k.includes('near me'))).toBe(true);
  });

  it('leads with the group that has a customer at the end of it', () => {
    for (const t of knownTrades()) {
      expect(tradeKeywordsFor(t, 'US').adGroups[0].intent).toBe('book-now');
    }
  });

  it('always holds the shop\'s own name', () => {
    for (const t of knownTrades()) {
      const brand = tradeKeywordsFor(t, 'US').adGroups.find((g) => g.intent === 'brand');
      expect(brand?.keywords).toContain('{brand}');
    }
  });

  it('gives every trade something to publish, in both markets', () => {
    for (const t of knownTrades()) {
      for (const mk of ['US', 'VN']) {
        const k = tradeKeywordsFor(t, mk);
        expect(k.seoTopics.length).toBeGreaterThan(0);
        expect(k.adGroups.length).toBeGreaterThan(0);
        // Every topic must name the queries it is written to answer, or it is
        // a title with no brief behind it.
        for (const topic of k.seoTopics) expect(topic.targets.length).toBeGreaterThan(0);
      }
    }
  });

  it('falls back to SALON for a trade it does not know', () => {
    expect(tradeKeywordsFor('CAR_WASH', 'US')).toEqual(tradeKeywordsFor('SALON', 'US'));
    expect(tradeKeywordsFor(null, 'US')).toEqual(tradeKeywordsFor('SALON', 'US'));
  });

  it('serves the US list to a market with no material rather than an empty panel', () => {
    // An empty panel reads as broken; an English starter list reads as
    // "edit me", which is what it is.
    expect(tradeKeywordsFor('HAIR', 'CA').seoTopics).toEqual(tradeKeywordsFor('HAIR', 'US').seoTopics);
  });
});

describe('fillKeyword', () => {
  it('puts the salon\'s own city and name into the template', () => {
    expect(fillKeyword('nail salon {city}', { city: 'Kerrville', brand: 'Lumio Nails' })).toBe('nail salon Kerrville');
    expect(fillKeyword('{brand} {city}', { city: 'Kerrville', brand: 'Lumio Nails' })).toBe('Lumio Nails Kerrville');
    expect(fillKeyword('Prices {year}', { year: 2026 })).toBe('Prices 2026');
  });

  it('leaves an unfilled placeholder VISIBLE', () => {
    // A blank gap tells the operator nothing; "{city}" on screen tells them
    // the shop's location is missing and the keyword is not usable yet.
    expect(fillKeyword('nail salon {city}', {})).toBe('nail salon {city}');
    expect(fillKeyword('nail salon {city}', { city: '   ' })).toBe('nail salon {city}');
  });
});
