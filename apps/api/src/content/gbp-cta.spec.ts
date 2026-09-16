import { cleanGbpOptions, resolveGbpCta, gbpCtaProblem, defaultGbpUrl, usableCtaUrl, DEFAULT_GBP_BUTTON } from './gbp-cta';

const shop = { bookingUrl: 'https://lumiobooking.com/book/hana-nails', website: 'https://hananails.com' };
const bare = { bookingUrl: null, website: null };

describe('the button on a Google post', () => {
  it('defaults to Book on the shop\'s own booking page — what every old post had', () => {
    // Rows written before the button existed carry no options at all and must
    // keep publishing exactly as before.
    expect(DEFAULT_GBP_BUTTON).toBe('book');
    expect(resolveGbpCta(null, shop)).toEqual({ actionType: 'BOOK', url: shop.bookingUrl });
  });

  it('NEVER sends a Book button without a link — the failure Google reported', () => {
    // "A link is required for this button." A post with no button goes out;
    // a post with a linkless button never does.
    expect(resolveGbpCta({ button: 'book', url: null }, bare)).toBeNull();
    expect(resolveGbpCta(null, bare)).toBeNull();
  });

  it('NEVER sends a link with a Call button — Google rejects the pair', () => {
    expect(resolveGbpCta({ button: 'call', url: 'https://x.com' }, shop)).toEqual({ actionType: 'CALL' });
  });

  it('lets the writer override the default link', () => {
    expect(resolveGbpCta({ button: 'book', url: 'https://booksy.com/hana' }, shop))
      .toEqual({ actionType: 'BOOK', url: 'https://booksy.com/hana' });
  });

  it('Learn more prefers the website, then the booking page', () => {
    expect(resolveGbpCta({ button: 'learn', url: null }, shop)).toEqual({ actionType: 'LEARN_MORE', url: shop.website });
    expect(resolveGbpCta({ button: 'learn', url: null }, { ...shop, website: null })).toEqual({ actionType: 'LEARN_MORE', url: shop.bookingUrl });
    expect(defaultGbpUrl('learn', bare)).toBeNull();
  });

  it('none means none', () => {
    expect(resolveGbpCta({ button: 'none', url: null }, shop)).toBeNull();
    expect(gbpCtaProblem({ button: 'none', url: null }, bare)).toBeNull();
  });
});

describe('what counts as a link', () => {
  it('accepts absolute https only', () => {
    expect(usableCtaUrl('https://lumiobooking.com/book/x')).toBe(true);
    expect(usableCtaUrl('http://lumiobooking.com/book/x')).toBe(false);
    expect(usableCtaUrl('lumiobooking.com/book/x')).toBe(false);
    expect(usableCtaUrl('https://lumiobooking.com/book/x y')).toBe(false);
    expect(usableCtaUrl('')).toBe(false);
    expect(usableCtaUrl(null)).toBe(false);
  });

  it('cleans a stored row: bad button or bad link read as "never said"', () => {
    expect(cleanGbpOptions({ button: 'book', url: 'https://a.com/b' })).toEqual({ button: 'book', url: 'https://a.com/b', ack: [] });
    expect(cleanGbpOptions({ button: 'book', url: 'not a link' })).toEqual({ button: 'book', url: null, ack: [] });
    // an accepted policy risk survives the round trip; junk in that list does not
    expect(cleanGbpOptions({ button: 'call', url: null, ack: ['medical', 'medical', 'drop tables', 7] })).toEqual({ button: 'call', url: null, ack: ['medical'] });
    expect(cleanGbpOptions({ button: 'delete', url: null })).toBeNull();
    expect(cleanGbpOptions('BOOK')).toBeNull();
    expect(cleanGbpOptions(null)).toBeNull();
  });
});

describe('telling the writer at write time', () => {
  it('names the fix when Book has nowhere to point', () => {
    const p = gbpCtaProblem({ button: 'book', url: null }, bare)!;
    expect(p.vi).toMatch(/Gọi ngay/);
    expect(p.en).toMatch(/Call now/);
  });

  it('rejects a malformed typed link rather than silently dropping the button', () => {
    const p = gbpCtaProblem({ button: 'book', url: 'www.hana.com' }, shop)!;
    expect(p.vi).toMatch(/https:\/\//);
  });

  it('is quiet when the default link exists', () => {
    expect(gbpCtaProblem({ button: 'book', url: null }, shop)).toBeNull();
    expect(gbpCtaProblem(null, shop)).toBeNull();
  });
});
