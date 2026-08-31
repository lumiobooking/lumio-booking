import { servicesAsked, isSameVisit, SAME_VISIT_GRACE_MS, type OpenVisit } from './one-visit';

const T = (h: number, m = 0) => Date.UTC(2026, 8, 3, h, m);
const iso = (ms: number) => new Date(ms).toISOString();

/** A visit booked at 3:00pm that currently runs to 3:15pm. */
const open: OpenVisit = { id: 'a1', phone: '022568996', url: 'https://x/a1', endMs: T(15, 15) };

describe('every service the customer named reaches the booking', () => {
  it('reads the list the tool now asks for', () => {
    const got = servicesAsked({
      services: [
        { serviceId: 'sv-wax', serviceName: 'Eyebrow waxing' },
        { serviceId: 'sv-acr', serviceName: 'Acrylic refill' },
      ],
    });
    expect(got).toEqual([
      { id: 'sv-wax', name: 'Eyebrow waxing' },
      { id: 'sv-acr', name: 'Acrylic refill' },
    ]);
  });

  it('still books a single-service call written the old way', () => {
    // A model working from a cached prompt, or retrying, should book rather
    // than fail on a shape it used yesterday.
    expect(servicesAsked({ serviceId: 'sv-gel', serviceName: 'Gel manicure' }))
      .toEqual([{ id: 'sv-gel', name: 'Gel manicure' }]);
  });

  it('drops empty entries and repeats instead of billing them twice', () => {
    const got = servicesAsked({
      services: [
        { serviceId: 'sv-wax', serviceName: 'Eyebrow waxing' },
        { serviceId: 'sv-wax', serviceName: 'eyebrow waxing' },
        { serviceId: '', serviceName: '' },
      ],
    });
    expect(got).toHaveLength(1);
  });

  it('returns nothing when the model named no service at all', () => {
    expect(servicesAsked({})).toEqual([]);
    expect(servicesAsked({ services: [] })).toEqual([]);
  });
});

describe('a second call for the same visit joins it instead of splitting the bill', () => {
  it('merges the service the model tried to book right after the first', () => {
    // The exact shape of the bug: 3:00pm eyebrow wax, then a second call at
    // 3:15pm for the acrylic refill. Two rows on the calendar, two bills, one
    // person in one chair.
    expect(isSameVisit(open, '022568996', iso(T(15, 15)))).toBe(true);
    expect(isSameVisit(open, '022568996', iso(T(15, 30)))).toBe(true);
  });

  it('merges a second call placed at the same start time', () => {
    expect(isSameVisit(open, '022568996', iso(T(15, 0)))).toBe(true);
  });

  it('does NOT merge two genuinely separate appointments', () => {
    // A customer booking 10am and then 3pm has booked twice. Joining those
    // would be the opposite mistake, and a worse one — it silently deletes an
    // appointment the customer thinks they have.
    expect(isSameVisit(open, '022568996', iso(T(10, 0)))).toBe(false);
    expect(isSameVisit(open, '022568996', iso(T(19, 0)))).toBe(false);
  });

  it('never merges across two different people', () => {
    // "now i wanna book for my friend" — same thread, different customer. This
    // is the case where merging would put one person's services on another
    // person's bill.
    expect(isSameVisit(open, '0999111222', iso(T(15, 15)))).toBe(false);
  });

  it('does nothing when no visit is open yet', () => {
    expect(isSameVisit(undefined, '022568996', iso(T(15, 0)))).toBe(false);
  });

  it('refuses an unparseable time rather than guessing', () => {
    expect(isSameVisit(open, '022568996', 'sometime Thursday')).toBe(false);
    expect(isSameVisit(open, '', iso(T(15, 0)))).toBe(false);
  });

  it('holds the grace window exactly where it says it does', () => {
    expect(isSameVisit(open, '022568996', iso(open.endMs + SAME_VISIT_GRACE_MS))).toBe(true);
    expect(isSameVisit(open, '022568996', iso(open.endMs + SAME_VISIT_GRACE_MS + 1))).toBe(false);
  });
});
