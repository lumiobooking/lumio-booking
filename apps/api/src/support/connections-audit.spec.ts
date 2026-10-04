import { connectionsByTenant, sharedConnections } from './connections-audit';

describe('which salon holds which account', () => {
  const rows = connectionsByTenant({
    pages: [
      { tenantId: 'glow', pageName: 'Glow Nails', pageId: 'p1', igUsername: 'glownails' },
      { tenantId: 'lily', pageName: null, pageId: 'p2', igUsername: null },
      { tenantId: 'lily', pageName: 'Lily Spa', pageId: 'p3', igUsername: 'lilyspa' },
    ],
    settings: [
      { tenantId: 'glow', key: 'googleReviews', value: { connected: true, locationTitle: 'Glow Nails & Spa', connectedEmail: 'owner@glow.com' } },
      { tenantId: 'lily', key: 'googleReviews', value: { connected: true, locationTitle: 'Glow Nails & Spa', connectedEmail: 'owner@glow.com' } },
      { tenantId: 'glow', key: 'tiktok', value: { connected: true, creator: { username: 'glow.nails' } } },
      { tenantId: 'glow', key: 'notifications', value: { mailService: 'gmail', gmail: { senderEmail: 'hello@glow.com', refreshToken: 'x' } } },
      { tenantId: 'lily', key: 'notifications', value: { mailService: 'auto', smtp: { user: 'lily@mail.com', fromEmail: '' } } },
      { tenantId: 'rose', key: 'tiktok', value: { connected: false } },
    ],
  });

  it('names every connection a salon holds, and lists two pages under one salon as the smell it is', () => {
    expect(rows.get('glow')).toEqual({ fbPage: 'Glow Nails', igUser: '@glownails', google: 'Glow Nails & Spa', googleEmail: 'owner@glow.com', tiktok: '@glow.nails', mail: 'hello@glow.com' });
    // A page with no name says "connected", never its raw id.
    expect(rows.get('lily')?.fbPage).toBe('connected, Lily Spa');
    expect(rows.get('lily')?.mail).toBe('lily@mail.com');
    expect(rows.get('rose')?.tiktok).toBeNull();
  });

  it('a location with no title is "connected", never its raw id', () => {
    const r = connectionsByTenant({ pages: [], settings: [{ tenantId: 'x', key: 'googleReviews', value: { connected: true, locationId: 'locations/2169' } }] });
    expect(r.get('x')?.google).toBe('connected');
  });

  it('a Google location under two salons is reported with both', () => {
    expect(sharedConnections(rows)).toEqual([{ kind: 'google', value: 'glow nails & spa', tenantIds: ['glow', 'lily'] }]);
  });
});
