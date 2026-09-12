import { hasAgencyWork, weekTouched } from './agency-work';

describe('hasAgencyWork', () => {
  it('is false for a salon that only bought a booking system', () => {
    // No card sent, no post scheduled, no offer, and a week nobody has touched —
    // the plan was generated for every tenant, and it is not evidence of anything.
    expect(hasAgencyWork({})).toBe(false);
    expect(hasAgencyWork({ weeks: [{ edited: null, approvedAt: null, ticks: {} }] })).toBe(false);
    expect(hasAgencyWork({ weeks: [{}, {}] })).toBe(false);
  });

  it('is true on the old evidence: a card the team sent, or a post scheduled', () => {
    expect(hasAgencyWork({ teamSuggestion: true })).toBe(true);
    expect(hasAgencyWork({ scheduledPost: true })).toBe(true);
  });

  it('is true once the team has WORKED ON THE PLAN — the case the first version missed', () => {
    // A salon whose week has been rewritten is a salon being run. It used to
    // sit on "nothing to do yet" until the first clip request went out.
    expect(hasAgencyWork({ weeks: [{ edited: { days: [] } }] })).toBe(true);
    expect(hasAgencyWork({ weeks: [{ approvedAt: new Date() }] })).toBe(true);
    expect(hasAgencyWork({ weeks: [{ ticks: { '0at0sja': [0, 1] } }] })).toBe(true);
    expect(hasAgencyWork({ offerSet: true })).toBe(true);
  });

  it('reads an empty edit as untouched, so a stray empty object does not open the screen', () => {
    expect(weekTouched({ edited: {} })).toBe(false);
    expect(weekTouched({ edited: { focus: 'x' } })).toBe(true);
    expect(weekTouched(null)).toBe(false);
  });

  it('opens the shop screen as soon as a staff member has set the salon up', () => {
    // The reported gap: an afternoon of setup, then the shop opens its own
    // screen and reads "chưa có việc nào cho tiệm".
    expect(hasAgencyWork({ staffSetup: true })).toBe(true);
  });

  it('still shows nothing to a shop that signed up on its own', () => {
    // No suggestion, no scheduled post, no offer, no touched week, and nobody
    // from Lumio ever inside it — a booking-only customer. This is the case the
    // whole rule exists to protect, so it must survive the widening.
    expect(hasAgencyWork({
      staffSetup: false, teamSuggestion: false, scheduledPost: false,
      offerSet: false, weeks: [{}, {}],
    })).toBe(false);
    expect(hasAgencyWork({})).toBe(false);
  });

  it('is not a setting: absent evidence reads as absent, never as yes', () => {
    expect(hasAgencyWork({ staffSetup: undefined })).toBe(false);
  });
});
