import { resolveShopLocation } from './shop-location';
import { viOf, enOf } from './i18n';
import { stateFromZip, parseAddress } from './region-events';

describe('a ZIP names its own state', () => {
  it('resolves the states the platform actually has shops in', () => {
    expect(stateFromZip('78028')).toBe('TX');  // Kerrville
    expect(stateFromZip('92840')).toBe('CA');  // Garden Grove
    expect(stateFromZip('02108')).toBe('MA');  // Boston
    expect(stateFromZip('77002')).toBe('TX');  // Houston
    expect(stateFromZip('30303')).toBe('GA');
    expect(stateFromZip('98101')).toBe('WA');
  });

  it('gets the awkward boundaries right', () => {
    expect(stateFromZip('88901')).toBe('NV');  // Las Vegas, outside NM's block
    expect(stateFromZip('88510')).toBe('TX');  // El Paso sits inside NM's range
    expect(stateFromZip('20001')).toBe('DC');
    expect(stateFromZip('20101')).toBe('VA');  // 201 is VA, not DC
    expect(stateFromZip('96813')).toBe('HI');
    expect(stateFromZip('99501')).toBe('AK');
  });

  it('returns null rather than forcing military and territory ZIPs into a state', () => {
    // 09xxx is APO Europe, 006xx is Puerto Rico, 969xx is Guam. A shop there is
    // not in New Jersey, Massachusetts or Hawaii, and saying so would be worse
    // than admitting we do not know.
    for (const z of ['09123', '00601', '96910', 'not a zip', '', null]) {
      expect(stateFromZip(z)).toBeNull();
    }
  });

  it('finds the ZIP inside a longer string', () => {
    expect(stateFromZip('1234 Main St, Kerrville, TX 78028')).toBe('TX');
  });
});

describe('the address parser stops losing addresses to spelling', () => {
  it('reads a trailing country instead of giving up on the whole address', () => {
    // This is how a careful person types an address, and it used to parse to
    // nothing at all — every pattern anchors on the end, and "USA" was there.
    for (const a of [
      '1234 Main St, Kerrville, TX 78028, USA',
      '1234 Main St, Kerrville, TX 78028 USA',
      '1234 Main St, Kerrville, TX 78028, United States',
      '1234 Main St, Kerrville, TX 78028, Hoa Kỳ',
    ]) {
      expect(parseAddress(a)).toEqual({ city: 'Kerrville', region: 'TX', postalCode: '78028' });
    }
  });

  it('accepts a state spelled out', () => {
    expect(parseAddress('1234 Main St, Kerrville, Texas 78028').region).toBe('TX');
    expect(parseAddress('45 Beacon St, Boston, Massachusetts 02108').region).toBe('MA');
    expect(parseAddress('9 Elm, Charleston, West Virginia').region).toBe('WV');
    // Longest name wins: this is Virginia, not West Virginia.
    expect(parseAddress('9 Elm, Richmond, Virginia').region).toBe('VA');
  });

  it('handles a comma between the state and the ZIP', () => {
    expect(parseAddress('1234 Main St, Kerrville, TX, 78028')).toEqual({
      city: 'Kerrville', region: 'TX', postalCode: '78028',
    });
  });

  it('still refuses two capital letters that are not a state', () => {
    // The whole reason this parser is strict. "IN" here is a preposition.
    expect(parseAddress('NAILS IN THE CITY').region).toBeNull();
    expect(parseAddress('Beauty Bar, Suite A').region).toBeNull();
  });

  it('hands back a bare ZIP so the state can be looked up from it', () => {
    expect(parseAddress('1234 Main St 78028')).toEqual({ city: null, region: null, postalCode: '78028' });
  });
});

describe('the shop is placed from what the shop already gave us', () => {
  it('prefers the record someone filled in', () => {
    const r = resolveShopLocation({
      tenantCity: 'Garden Grove', tenantRegion: 'ca',
      address: '1234 Main St, Kerrville, TX 78028',
    });
    expect(r).toMatchObject({ city: 'Garden Grove', region: 'CA', source: 'tenant' });
  });

  it('falls back to the address in the shop settings, and says so', () => {
    const r = resolveShopLocation({ address: '1234 Main St, Kerrville, TX 78028' });
    expect(r).toMatchObject({ city: 'Kerrville', region: 'TX', postalCode: '78028', source: 'address' });
    expect(viOf(r.sourceLabel)).toMatch(/cài đặt tiệm/);
    expect(r.fix).toBeNull();
  });

  it('uses the service area the scan read off the website', () => {
    const r = resolveShopLocation({ serviceArea: 'Phục vụ khu vực Houston, TX' });
    expect(r).toMatchObject({ region: 'TX', source: 'serviceArea' });
  });

  it('gets the state from the ZIP alone when nothing else says it', () => {
    // A shop that only ever typed a ZIP still knows which state it trades in,
    // and the state is what every regional calendar runs on.
    const r = resolveShopLocation({ tenantPostal: '78028' });
    expect(r).toMatchObject({ region: 'TX', city: null, postalCode: '78028', source: 'zip' });
    expect(viOf(r.sourceLabel)).toContain('78028');
  });

  it('reaches the ZIP inside an address that has no readable state', () => {
    const r = resolveShopLocation({ address: '1234 Main St 92840' });
    expect(r).toMatchObject({ region: 'CA', source: 'zip' });
  });

  it('reads the first of the nearby ZIPs when that is all there is', () => {
    expect(resolveShopLocation({ nearbyZips: '02108, 02109' }).region).toBe('MA');
  });

  it('never sends the shop to a screen the shop cannot open', () => {
    // The bug this file exists for: the salon was told to fill in its city in
    // Super Admin — our staff's screen — for data it had already given us.
    const all = [
      resolveShopLocation({}),
      resolveShopLocation({ address: 'Beauty Bar, Suite A' }),
      resolveShopLocation({ tenantRegion: 'TX' }),
      resolveShopLocation({ tenantPostal: '78028' }),
    ];
    for (const r of all) expect(JSON.stringify(r)).not.toMatch(/Super Admin/i);
  });

  it('tells a placeless shop what IT can do, in its own settings', () => {
    const r = resolveShopLocation({ address: 'Beauty Bar, Suite A' });
    expect(r.region).toBeNull();
    expect(r.source).toBe('none');
    expect(viOf(r.fix)).toMatch(/Cài đặt tiệm/);
    expect(viOf(r.fix)).toMatch(/Quét & học tự động/);
  });

  it('keeps a city it found even when no state came with it', () => {
    // Half a location is still worth showing back to the owner, as long as
    // nothing regional is built on it.
    const r = resolveShopLocation({ tenantCity: 'Houston' });
    expect(r).toMatchObject({ city: 'Houston', region: null, source: 'none' });
  });

  it('says where it got the location, and the fix, in both languages', () => {
    // The EN switch used to leave Vietnamese provenance inside an English
    // frame. Both sides carry the ZIP itself: that is the shop's own datum,
    // not a phrase we translate.
    const zip = resolveShopLocation({ tenantPostal: '78028' });
    expect(enOf(zip.sourceLabel)).not.toBe(viOf(zip.sourceLabel));
    expect(enOf(zip.sourceLabel)).toMatch(/ZIP 78028/);

    const placeless = resolveShopLocation({ address: 'Beauty Bar, Suite A' });
    expect(enOf(placeless.fix)).not.toBe(viOf(placeless.fix));
    expect(enOf(placeless.fix)).toMatch(/Salon settings/);
    expect(enOf(placeless.fix)).toMatch(/Scan & learn/);
  });

  it('does not read US addresses for a Vietnamese shop', () => {
    const r = resolveShopLocation({ market: 'VN', address: '12 Nguyễn Huệ, Q1, TP HCM' });
    expect(r.region).toBeNull();
  });
});
