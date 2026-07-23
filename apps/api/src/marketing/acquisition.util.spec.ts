import { deriveAcquisition } from './acquisition.util';

describe('deriveAcquisition — first-party acquisition classification', () => {
  it('gclid wins over everything (paid click is the strongest proof)', () => {
    expect(deriveAcquisition({ gclid: 'abc', utmCampaign: 'gbp_booking', source: 'plugin' })).toBe('google_ads');
    expect(deriveAcquisition({ gbraid: 'x' })).toBe('google_ads');
    expect(deriveAcquisition({ wbraid: 'y' })).toBe('google_ads');
  });

  it('GBP campaign -> google_maps_organic (new + both legacy stamped links)', () => {
    expect(deriveAcquisition({ utmCampaign: 'gbp_booking' })).toBe('google_maps_organic');
    expect(deriveAcquisition({ utmSource: 'google', utmMedium: 'gbp' })).toBe('google_maps_organic');
    expect(deriveAcquisition({ utmSource: 'google', utmCampaign: 'business_profile' })).toBe('google_maps_organic');
  });

  it('embedded form with no stronger signal -> website', () => {
    expect(deriveAcquisition({ source: 'plugin' })).toBe('website');
  });

  it('other tagged campaigns / external referrer -> referral', () => {
    expect(deriveAcquisition({ utmSource: 'facebook', utmMedium: 'cpc', source: 'hosted' })).toBe('referral');
    expect(deriveAcquisition({ attrReferrer: 'https://yelp.com/biz/x', source: 'hosted' })).toBe('referral');
  });

  it('no data at all -> direct; self-referrer is NOT referral', () => {
    expect(deriveAcquisition({ source: 'hosted' })).toBe('direct');
    expect(deriveAcquisition({ source: 'hosted', attrReferrer: 'https://lumiobooking.com/x' })).toBe('direct');
  });

  it('completely unknown record -> unknown', () => {
    expect(deriveAcquisition({})).toBe('unknown');
  });

  it('case/whitespace insensitive', () => {
    expect(deriveAcquisition({ utmCampaign: ' GBP_Booking ' })).toBe('google_maps_organic');
  });
});
