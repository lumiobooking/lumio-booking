import { isGbpPath, gbpAttribution, gbpSearch, GBP_CAMPAIGN } from './gbp-source';

/**
 * Every customer who tapped "Book online" on Google Maps was filed as "Lumio
 * link". The /gbp link stamped its campaign with an inline script that was in
 * the page and never executed — React inserts nested-layout markup, and an
 * inserted <script> does not run — so the booking arrived with no utm at all
 * and was classified, correctly by its own rules, as an untagged hosted link.
 *
 * The path is now the evidence, because the path cannot be lost.
 */
describe('recognising the Google Business Profile link', () => {
  it('knows the route, with or without a trailing slash', () => {
    expect(isGbpPath('/model-nails-salon/gbp')).toBe(true);
    expect(isGbpPath('/model-nails-salon/gbp/')).toBe(true);
    expect(isGbpPath('/book/model-nails-salon/gbp')).toBe(true);
  });

  it('does not claim the plain booking link', () => {
    // The whole point of a separate route: /{slug} must stay unattributed, or
    // every walk-in typing the link becomes a Google booking.
    for (const p of ['/model-nails-salon', '/book/model-nails-salon', '/gbpsomething', '', null]) {
      expect(isGbpPath(p)).toBe(false);
    }
  });
});

describe('what gets recorded against the booking', () => {
  it('records Google for a booking that came through /gbp', () => {
    expect(gbpAttribution('/model-nails-salon/gbp', {})).toEqual(GBP_CAMPAIGN);
  });

  it('records nothing extra for the plain link', () => {
    expect(gbpAttribution('/model-nails-salon', {})).toEqual({});
  });

  it('never overwrites a campaign somebody built by hand', () => {
    // A tracked link is a decision. Replacing its campaign with ours would make
    // the /gbp route lie about a booking it merely happened to serve.
    const mine = { utmSource: 'facebook', utmMedium: 'cpc', utmCampaign: 'tet_sale' };
    expect(gbpAttribution('/model-nails-salon/gbp', mine)).toEqual(mine);
  });

  it('fills only the gaps when a link is partly tagged', () => {
    const partial = { utmCampaign: 'flyer_qr' };
    const out = gbpAttribution('/model-nails-salon/gbp', partial);
    expect(out.utmCampaign).toBe('flyer_qr');
    expect(out.utmSource).toBe('google');
  });
});

describe('the url the /gbp page shows', () => {
  it('adds the campaign so analytics tags see it too', () => {
    const s = gbpSearch('');
    expect(s).toContain('utm_source=google');
    expect(s).toContain('utm_campaign=gbp_booking');
  });

  it('keeps whatever was already on the link', () => {
    expect(gbpSearch('?ref=ANNA')).toContain('ref=ANNA');
  });

  it('leaves a link that already has a campaign alone', () => {
    expect(gbpSearch('?utm_campaign=tet_sale')).toBeNull();
  });
});
