import { linkedMetaSocial, linkedGbp, linkedCredsFor } from './linked-channels';

const messenger = { pageId: '389340827603190', pageToken: 'EAAG...page', pageName: 'Lumio Agency' };
const gbr = {
  connected: true, refreshToken: '1//0g...', locationId: '17202153832315858041',
  locationTitle: 'Lumio Nails Q7', clientId: 'abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-x',
};

describe('reusing the Messenger AI connection for Facebook/Instagram organic', () => {
  it('turns the page token + page id into connector credentials', () => {
    const l = linkedMetaSocial(messenger);
    expect(l).not.toBeNull();
    expect(l!.creds.token).toBe('EAAG...page');
    expect(l!.creds.externalAccountId).toBe('389340827603190');
    expect(l!.source).toBe('messenger');
  });

  it('names the Page so the green tick explains itself', () => {
    expect(linkedMetaSocial(messenger)!.accountName).toBe('Lumio Agency');
    expect(linkedMetaSocial({ ...messenger, pageName: '' })!.accountName).toBe('389340827603190');
  });

  // The dangerous half-state. An id without its token would make verify() fall
  // back to the AGENCY token, which can read different assets than the salon's
  // own — a green tick earned with the wrong identity.
  it('refuses a page id without its token, and a token without its page', () => {
    expect(linkedMetaSocial({ pageId: '123', pageToken: '' })).toBeNull();
    expect(linkedMetaSocial({ pageId: '', pageToken: 'tok' })).toBeNull();
    expect(linkedMetaSocial({ pageId: '   ', pageToken: '  ' })).toBeNull();
  });

  it('answers null, not an exception, when messenger was never connected', () => {
    expect(linkedMetaSocial(null)).toBeNull();
    expect(linkedMetaSocial(undefined)).toBeNull();
    expect(linkedMetaSocial({})).toBeNull();
  });
});

describe('reusing the Google Reviews OAuth for Business Profile stats', () => {
  it('turns the stored refresh token + location into connector credentials', () => {
    const l = linkedGbp(gbr);
    expect(l).not.toBeNull();
    expect(l!.creds.refreshToken).toBe('1//0g...');
    expect(l!.creds.externalAccountId).toBe('locations/17202153832315858041');
    expect(l!.source).toBe('google-reviews');
    expect(l!.accountName).toBe('Lumio Nails Q7');
  });

  it('leaves an already-prefixed location id alone', () => {
    expect(linkedGbp({ ...gbr, locationId: 'locations/99' })!.creds.externalAccountId).toBe('locations/99');
  });

  it('requires the OAuth to actually be connected, not merely configured', () => {
    expect(linkedGbp({ ...gbr, connected: false })).toBeNull();
  });

  it.each([
    ['refreshToken', { ...gbr, refreshToken: '' }],
    ['locationId', { ...gbr, locationId: '' }],
    ['clientId', { ...gbr, clientId: '' }],
    ['clientSecret', { ...gbr, clientSecret: '' }],
  ])('refuses when %s is missing — a partial credential set is "no", not "try"', (_name, link) => {
    expect(linkedGbp(link)).toBeNull();
  });

  it('answers null when reviews were never connected', () => {
    expect(linkedGbp(null)).toBeNull();
    expect(linkedGbp({})).toBeNull();
  });
});

describe('which platforms may ride on an existing connection at all', () => {
  it('meta_social rides on messenger; gbp rides on reviews', () => {
    expect(linkedCredsFor('meta_social', { messenger })!.source).toBe('messenger');
    expect(linkedCredsFor('gbp', { gbr })!.source).toBe('google-reviews');
  });

  // The one that must NEVER link. A Page token cannot read an ad account, but
  // it would VERIFY fine — a green tick over a report that stays empty forever.
  it('meta (Ads) never links, even with a perfectly good messenger connection', () => {
    expect(linkedCredsFor('meta', { messenger, gbr })).toBeNull();
  });

  it('tiktok never links — nothing else has ever connected TikTok', () => {
    expect(linkedCredsFor('tiktok', { messenger, gbr })).toBeNull();
  });

  it('an unknown platform answers null rather than throwing', () => {
    expect(linkedCredsFor('myspace', { messenger, gbr })).toBeNull();
  });
});
