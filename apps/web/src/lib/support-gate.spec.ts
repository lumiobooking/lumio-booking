import { isSupportOnly, isHidden, canSee, SUPPORT_ONLY, DEFAULT_HIDDEN, gateText } from './support-gate';

/** The nine "Marketing & AI" routes, each of which now has its own switch. */
const AGENCY_ROUTES = [
  '/salon/content',
  '/salon/marketing',
  '/salon/marketing/monthly',
  '/salon/email',
  '/salon/reviews',
  '/salon/reviews-replies',
  '/salon/inbox',
  '/salon/messenger',
  '/salon/voice',
];

describe('a salon nobody has decided about sees exactly what it saw before', () => {
  // This is the regression that matters: switches ship OFF, so a deploy must
  // not reveal a single screen to a single salon already running.
  it.each(AGENCY_ROUTES)('%s stays hidden by default', (p) => {
    expect(canSee(p, false)).toBe(false);
  });

  it('the staff inbox belongs to Lumio outright — no switch hands it over', () => {
    expect(isSupportOnly('/staff/inbox')).toBe(true);
    expect(canSee('/staff/inbox', false, [])).toBe(false);
  });

  it('everything the salon runs day-to-day is untouched', () => {
    for (const p of ['/salon', '/salon/calendar', '/salon/bookings', '/salon/pos', '/salon/customers', '/salon/settings', '/salon/billing', '/staff/bookings']) {
      expect(canSee(p, false)).toBe(true);
    }
  });

  it('a query string cannot sneak past the gate', () => {
    expect(canSee('/salon/messenger?tab=facts', false)).toBe(false);
  });
});

describe('a salon that has been handed a screen can open it', () => {
  it('shows only what the policy left out of the hidden list', () => {
    // Super Admin turned "Marketing plan & posts" on for this salon and nothing
    // else: the plan opens, the phone bot does not.
    const hidden = DEFAULT_HIDDEN.filter((h) => h !== '/salon/content');
    expect(canSee('/salon/content', false, hidden)).toBe(true);
    expect(canSee('/salon/voice', false, hidden)).toBe(false);
  });

  it('grants the sub-route with the screen it belongs to', () => {
    const hidden = DEFAULT_HIDDEN.filter((h) => h !== '/salon/reviews');
    expect(canSee('/salon/reviews/settings', false, hidden)).toBe(true);
  });

  it('never hands over the staff portal, whatever the policy says', () => {
    expect(canSee('/staff/inbox', false, [])).toBe(false);
  });
});

describe('the boundary is a path segment, not a string prefix', () => {
  it('one screen is not decided by another screen’s spelling', () => {
    // '/salon/reviews' and '/salon/reviews-replies' have separate switches, so
    // one must never claim the other by accident of spelling.
    const onlyRewards = ['/salon/reviews'];
    expect(isHidden('/salon/reviews-replies', onlyRewards)).toBe(false);
    expect(isHidden('/salon/reviews/settings', onlyRewards)).toBe(true);
    expect(isHidden('/salon/emailing-else', ['/salon/email'])).toBe(false);
  });
});

describe('what the Lumio support session sees', () => {
  it('everything — this is who sets it all up', () => {
    for (const p of [...SUPPORT_ONLY, ...AGENCY_ROUTES]) expect(canSee(p, true)).toBe(true);
    expect(canSee('/salon/calendar', true)).toBe(true);
  });
});

describe('the wording on the door', () => {
  it('names the agency and reads as service, not as denial', () => {
    expect(gateText(true).title).toContain('Lumio');
    expect(gateText(true).body).toContain('Lumio');
    expect(gateText(false).title).toContain('Lumio');
  });
});
