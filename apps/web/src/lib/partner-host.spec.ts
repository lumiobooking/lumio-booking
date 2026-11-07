import { partnerHostVerdict } from './partner-host';

const P = 'https://book.lumiobooking.com';
const M = 'https://lumiobooking.com';

describe('the Google partner host serves booking pages only', () => {
  it('does nothing at all while it is not configured, or on the main domain', () => {
    expect(partnerHostVerdict('book.lumiobooking.com', '/salon', undefined, M)).toEqual({ kind: 'pass' });
    expect(partnerHostVerdict('lumiobooking.com', '/salon', P, M)).toEqual({ kind: 'pass' });
    expect(partnerHostVerdict('lumiobooking.com', '/amys-lash-and-brows/gbp', P, M)).toEqual({ kind: 'pass' });
  });
  it('serves a salon’s booking page, its /gbp link and the payment pages', () => {
    for (const p of ['/amys-lash-and-brows', '/amys-lash-and-brows/gbp', '/book/amys-lash-and-brows', '/pay/done', '/privacy']) {
      expect(partnerHostVerdict('book.lumiobooking.com', p, P, M)).toEqual({ kind: 'booking' });
    }
    expect(partnerHostVerdict('book.lumiobooking.com:443', '/lux-nail-spa', P, M)).toEqual({ kind: 'booking' });
  });
  it('sends sign-in, the salon admin, the agency and the home page to the main domain', () => {
    expect(partnerHostVerdict('book.lumiobooking.com', '/', P, M)).toEqual({ kind: 'redirect', to: 'https://lumiobooking.com/' });
    for (const p of ['/login', '/salon', '/salon/calendar', '/agency/google-book', '/super-admin', '/staff/inbox', '/signup', '/amys/other']) {
      expect(partnerHostVerdict('book.lumiobooking.com', p, P, M)).toEqual({ kind: 'redirect', to: `https://lumiobooking.com${p}` });
    }
  });
  it('lets Next’s files and icons through', () => {
    expect(partnerHostVerdict('book.lumiobooking.com', '/_next/data/x.json', P, M)).toEqual({ kind: 'pass' });
    expect(partnerHostVerdict('book.lumiobooking.com', '/logo/lumio-mark.png', P, M)).toEqual({ kind: 'pass' });
    expect(partnerHostVerdict('book.lumiobooking.com', '/api/build', P, M)).toEqual({ kind: 'pass' });
  });
});
