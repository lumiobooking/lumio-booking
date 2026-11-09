import { socialLinks, googleMapsUrl } from './social-links';

describe('salon channel links (Social channels + booking page)', () => {
  it('builds each platform link from what the salon connected', () => {
    expect(socialLinks({
      pages: [{ pageId: '102938475610293', pageName: 'Ongles Saint-Eustache', igUsername: 'onglessteustache', enabled: true }],
      google: { connected: true, placeId: 'ChIJnfuYZrdX24gRfJrAtAbFeSU' },
      tiktok: { connected: true, username: '@onglessteustache' },
    })).toEqual([
      { channel: 'facebook', url: 'https://www.facebook.com/102938475610293', handle: 'Ongles Saint-Eustache' },
      { channel: 'instagram', url: 'https://www.instagram.com/onglessteustache/', handle: '@onglessteustache' },
      { channel: 'google', url: 'https://www.google.com/maps/place/?q=place_id:ChIJnfuYZrdX24gRfJrAtAbFeSU' },
      { channel: 'tiktok', url: 'https://www.tiktok.com/@onglessteustache', handle: '@onglessteustache' },
    ]);
  });
  it('nothing connected, switched off or disconnected → no button', () => {
    expect(socialLinks({})).toEqual([]);
    expect(socialLinks({ pages: [{ pageId: '102938475610293', enabled: false }] })).toEqual([]);
    expect(socialLinks({ google: { connected: false, placeId: 'ChIJnfuYZrdX24gRfJrAtAbFeSU' }, tiktok: { connected: false, username: 'x1' } })).toEqual([]);
  });
  it('a stored value can never become a link elsewhere', () => {
    expect(socialLinks({ pages: [{ pageId: 'evil.com/x', igUsername: 'a/../../evil.com' }] })).toEqual([]);
    expect(googleMapsUrl('x"><script>')).toBeNull();
    expect(socialLinks({ tiktok: { connected: true, username: 'a b' } })).toEqual([]);
  });
});
