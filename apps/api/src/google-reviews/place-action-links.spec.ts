import { isOwnLink, normUri, otherBookingLinks, placeActionsError, planBookingLink, type PlaceLink } from './place-action-links';

const HOSTS = ['lumiobooking.com'];
const URI = 'https://lumiobooking.com/lux-nail-spa/gbp';
const L = (p: Partial<PlaceLink> & { uri: string }): PlaceLink => ({ placeActionType: 'APPOINTMENT', isEditable: true, ...p });

describe('the Book link on a salon\'s Google profile', () => {
  it('adds the salon\'s booking page as the preferred appointment link when there is none', () => {
    expect(planBookingLink([], URI, HOSTS)).toEqual([{ op: 'create', uri: URI }]);
  });

  it('does nothing when the link is already there and preferred (the daily run is idempotent)', () => {
    expect(planBookingLink([L({ name: 'locations/1/placeActionLinks/a', uri: `${URI}/`, isPreferred: true })], URI, HOSTS)).toEqual([]);
  });

  it('marks it preferred when the owner had preferred another link', () => {
    const steps = planBookingLink([
      L({ name: 'locations/1/placeActionLinks/a', uri: URI, isPreferred: false }),
      L({ name: 'locations/1/placeActionLinks/b', uri: 'https://booksy.com/x', isPreferred: true }),
    ], URI, HOSTS);
    expect(steps).toEqual([{ op: 'prefer', name: 'locations/1/placeActionLinks/a' }]);
  });

  it('replaces an old Lumio link (renamed slug) and never touches anybody else\'s', () => {
    const steps = planBookingLink([
      L({ name: 'locations/1/placeActionLinks/old', uri: 'https://www.lumiobooking.com/old-slug' }),
      L({ name: 'locations/1/placeActionLinks/owner', uri: 'https://salon-site.com/book' }),
      L({ name: 'locations/1/placeActionLinks/partner', uri: 'https://lumiobooking.com/x', isEditable: false, providerType: 'AGGREGATOR_3P' }),
      { name: 'locations/1/placeActionLinks/food', uri: 'https://lumiobooking.com/menu', placeActionType: 'FOOD_ORDERING' },
    ], URI, HOSTS);
    expect(steps).toEqual([{ op: 'delete', name: 'locations/1/placeActionLinks/old' }, { op: 'create', uri: URI }]);
  });

  it('takes only Lumio\'s own links off when the salon is switched off', () => {
    const steps = planBookingLink([
      L({ name: 'locations/1/placeActionLinks/a', uri: URI, isPreferred: true }),
      L({ name: 'locations/1/placeActionLinks/owner', uri: 'https://salon-site.com/book' }),
    ], URI, HOSTS, false);
    expect(steps).toEqual([{ op: 'delete', name: 'locations/1/placeActionLinks/a' }]);
  });

  it('compares links by host and path only', () => {
    expect(normUri('https://LumioBooking.com/Lux/gbp/?utm=1')).toBe(normUri('https://lumiobooking.com/lux/gbp'));
    expect(isOwnLink('https://www.lumiobooking.com/a', HOSTS)).toBe(true);
    expect(isOwnLink('https://lumiobooking.com.evil.io/a', HOSTS)).toBe(false);
    expect(otherBookingLinks([L({ uri: URI }), L({ uri: 'https://booksy.com/x' })], HOSTS)).toBe(1);
  });

  it('turns Google errors into what to do', () => {
    expect(placeActionsError(403, '{"error":{"status":"PERMISSION_DENIED","details":[{"reason":"SERVICE_DISABLED"}]}}')).toMatch(/Place Actions API/);
    expect(placeActionsError(401, '')).toMatch(/nối lại/);
    expect(placeActionsError(500, '{"error":{"message":"boom"}}')).toBe('Google 500: boom');
  });
});

/** Tenant isolation: a plan is built from ONE location's links and only ever names links of that location. */
describe('one salon\'s profile only', () => {
  it('never plans a change on a link it was not given', () => {
    const a = planBookingLink([L({ name: 'locations/A/placeActionLinks/1', uri: 'https://lumiobooking.com/old-a' })], 'https://lumiobooking.com/salon-a/gbp', HOSTS);
    for (const s of a) if (s.op !== 'create') expect(s.name.startsWith('locations/A/')).toBe(true);
    const b = planBookingLink([], 'https://lumiobooking.com/salon-b/gbp', HOSTS);
    expect(b).toEqual([{ op: 'create', uri: 'https://lumiobooking.com/salon-b/gbp' }]);
  });
});
