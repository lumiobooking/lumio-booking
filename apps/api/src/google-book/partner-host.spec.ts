import { partnerLinkHost } from './partner-host';
import { buildUpload } from './feed';

describe('partner feed links on their own host', () => {
  it('reads RWG_LINK_HOST as a plain https origin, or nothing', () => {
    expect(partnerLinkHost({})).toBeNull();
    expect(partnerLinkHost({ RWG_LINK_HOST: '  ' })).toBeNull();
    expect(partnerLinkHost({ RWG_LINK_HOST: 'https://book.lumiobooking.com/' })).toBe('https://book.lumiobooking.com');
    expect(partnerLinkHost({ RWG_LINK_HOST: 'book.lumiobooking.com' })).toBe('https://book.lumiobooking.com');
    expect(partnerLinkHost({ RWG_LINK_HOST: 'http://book.lumiobooking.com' })).toBeNull();
    expect(partnerLinkHost({ RWG_LINK_HOST: 'localhost' })).toBeNull();
  });

  it('every link in the feed uses the host it is given — never the main domain when a partner host is set', () => {
    const t = {
      id: 't1', name: 'Lux Nail Spa', slug: 'lux-nail-spa', currency: 'USD', timezone: 'America/Chicago', locale: 'en',
      services: [{ id: 's1', name: 'Gel Manicure', priceCents: 3500, durationMinutes: 40, isActive: true, category: 'Manicure' }],
    };
    const files = buildUpload([t as never], 'https://book.lumiobooking.com', new Date('2026-11-08T03:00:00Z'));
    const all = files.map((f) => f.body).join('\n');
    const links = all.match(/https:\/\/[a-z.]+lumiobooking\.com[^"]*/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l.startsWith('https://book.lumiobooking.com/')).toBe(true);
  });
});
