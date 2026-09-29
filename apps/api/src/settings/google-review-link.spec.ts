import { SettingsService } from './settings.service';

/**
 * The review QR on the customer screen needs a "write a Google review" link.
 * Salons used to have to paste a Place ID by hand even after connecting their
 * Google Business Profile — the connection already knows the location. Now the
 * typed value wins, and the connected profile fills the gap.
 */
function makeService(rows: Record<string, Record<string, unknown>>) {
  const prisma: any = {
    setting: {
      findUnique: jest.fn(async ({ where }: any) => {
        const { tenantId, key } = where.tenantId_key;
        const v = rows[`${tenantId}:${key}`];
        return v ? { tenantId, key, value: v } : null;
      }),
    },
  };
  return new SettingsService(prisma, {} as any);
}

describe('the Google review link a salon actually uses', () => {
  it('uses what the owner typed first (a Place ID becomes the official write-review link)', async () => {
    const svc = makeService({ 'A:googleReviews': { connected: true, locationId: 'locations/1', newReviewUri: 'https://g.page/r/xyz/review' } });
    const url = await svc.effectiveGoogleReviewUrl('A', { googlePlaceId: 'ChIJabc', googleReviewUrl: '' });
    expect(url).toBe('https://search.google.com/local/writereview?placeid=ChIJabc');
  });

  it('falls back to the connected Business Profile when nothing was typed', async () => {
    const svc = makeService({ 'A:googleReviews': { connected: true, locationId: 'locations/1', locationTitle: 'Zb Nails', newReviewUri: 'https://g.page/r/xyz/review' } });
    expect(await svc.effectiveGoogleReviewUrl('A', { googlePlaceId: '', googleReviewUrl: '' })).toBe('https://g.page/r/xyz/review');
    expect(await svc.googleProfileReviewLink('A')).toEqual({ url: 'https://g.page/r/xyz/review', placeId: '', locationTitle: 'Zb Nails' });
  });

  it('builds the link from the profile Place ID when Google gave no review URI', async () => {
    const svc = makeService({ 'A:googleReviews': { connected: true, locationId: 'locations/1', placeId: 'ChIJ999' } });
    expect(await svc.effectiveGoogleReviewUrl('A', {})).toBe('https://search.google.com/local/writereview?placeid=ChIJ999');
  });

  it('gives nothing when the profile is disconnected or has no location', async () => {
    const off = makeService({ 'A:googleReviews': { connected: false, locationId: 'locations/1', placeId: 'ChIJ999' } });
    expect(await off.effectiveGoogleReviewUrl('A', {})).toBeNull();
    const noLoc = makeService({ 'A:googleReviews': { connected: true, locationId: '', placeId: 'ChIJ999' } });
    expect(await noLoc.effectiveGoogleReviewUrl('A', {})).toBeNull();
  });

  it('never reads another salon\'s Google connection (cross-tenant isolation)', async () => {
    const svc = makeService({ 'A:googleReviews': { connected: true, locationId: 'locations/1', placeId: 'ChIJ999' } });
    expect(await svc.effectiveGoogleReviewUrl('B', {})).toBeNull();
    expect(await svc.googleProfileReviewLink('B')).toBeNull();
  });
});
