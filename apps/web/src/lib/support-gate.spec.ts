import { isSupportOnly, canSee, SUPPORT_ONLY, gateText } from './support-gate';

describe('what the salon account may see', () => {
  it.each([
    '/salon/marketing',
    '/salon/marketing/monthly',
    '/salon/email',
    '/salon/reviews',
    '/salon/inbox',
    '/salon/messenger',
    '/salon/voice',
    '/staff/inbox',
  ])('%s is Lumio-only', (p) => {
    expect(isSupportOnly(p)).toBe(true);
    expect(canSee(p, false)).toBe(false);
  });

  // The single exception, by explicit instruction: replying to their own
  // Google reviews is the SALON's voice, and it stays with them.
  it('Google reviews stays with the salon', () => {
    expect(isSupportOnly('/salon/reviews-replies')).toBe(false);
    expect(canSee('/salon/reviews-replies', false)).toBe(true);
  });

  it('the boundary is a path segment, not a string prefix', () => {
    // '/salon/reviews' must not swallow its sibling by accident of spelling.
    expect(isSupportOnly('/salon/reviews-replies')).toBe(false);
    expect(isSupportOnly('/salon/reviews/settings')).toBe(true);
    expect(isSupportOnly('/salon/emailing-else')).toBe(false);
  });

  it('everything the salon runs day-to-day is untouched', () => {
    for (const p of ['/salon', '/salon/calendar', '/salon/bookings', '/salon/pos', '/salon/customers', '/salon/settings', '/salon/billing', '/staff/bookings']) {
      expect(canSee(p, false)).toBe(true);
    }
  });

  it('a query string cannot sneak past the gate', () => {
    expect(isSupportOnly('/salon/messenger?tab=facts')).toBe(true);
  });
});

describe('what the Lumio support session sees', () => {
  it('everything — this is who sets it all up', () => {
    for (const p of SUPPORT_ONLY) expect(canSee(p, true)).toBe(true);
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
