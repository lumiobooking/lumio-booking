import { guestBrand } from './restaurant.service';

/** The guest's QR page shows the restaurant's own colour and logo — only safe values pass. */
describe('guest page branding', () => {
  it('a hex accent and an https or site logo pass', () => {
    expect(guestBrand({ accentColor: '#C2410C', logoUrl: 'https://cdn.x.test/logo.png' })).toEqual({ accent: '#C2410C', logoUrl: 'https://cdn.x.test/logo.png' });
    expect(guestBrand({ logoUrl: '/uploads/a.png' }).logoUrl).toBe('/uploads/a.png');
  });
  it('anything else falls back to the page\'s own look', () => {
    expect(guestBrand({ accentColor: 'red;background:url(x)', logoUrl: 'javascript:alert(1)' })).toEqual({ accent: null, logoUrl: null });
    expect(guestBrand({ logoUrl: 'data:text/html;base64,AAA' }).logoUrl).toBeNull();
    expect(guestBrand({ logoUrl: 'data:image/png;base64,AAAA' }).logoUrl).toBe('data:image/png;base64,AAAA');
    expect(guestBrand(null)).toEqual({ accent: null, logoUrl: null });
  });
});
