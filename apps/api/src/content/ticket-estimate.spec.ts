import { estimateTicket, menuTicket, medianCents, MIN_VISIT_MINUTES } from './ticket-estimate';

const svc = (priceCents: number, durationMinutes = 45) => ({ priceCents, durationMinutes });

/** A real nail menu: add-ons at the bottom, a full set at the top. */
const NAIL_MENU = [
  svc(1500, 10),   // polish change — an add-on, not a visit
  svc(1000, 10),   // nail art per finger
  svc(3500),       // classic manicure
  svc(4500),       // gel manicure
  svc(5500),       // gel + art
  svc(6500),       // dip powder
  svc(12000, 90),  // full set with art
];

describe('what a new customer spends, before we have any of their bookings', () => {
  it('uses what first-time customers actually paid, when we have it', () => {
    const t = estimateTicket({ firstVisitCents: 4800, firstVisitCount: 31, services: NAIL_MENU });
    expect(t).toEqual({ cents: 4800, source: 'first-visits', basis: 31 });
  });

  it('falls back to the wider average before it falls back to a guess', () => {
    const t = estimateTicket({ firstVisitCents: 0, anySegmentCents: 5200, anySegmentCount: 120, services: NAIL_MENU });
    expect(t.source).toBe('all-visits');
    expect(t.cents).toBe(5200);
  });

  it('answers on day one from the salon’s own menu — the reported gap', () => {
    // A salon that joined last week, or has not opened yet, or came from
    // another system. No appointments here, a full price list.
    const t = estimateTicket({ firstVisitCents: null, anySegmentCents: null, services: NAIL_MENU });
    expect(t.source).toBe('menu');
    // visits only: 3500 4500 5500 6500 12000 → the middle one
    expect(t.cents).toBe(5500);
  });

  it('throws away add-ons, which are lines on a bill and not visits', () => {
    // Without the duration filter the two 10-minute rows drag the middle down.
    const withAddons = menuTicket(NAIL_MENU).cents!;
    const addonsOnlyPool = menuTicket(NAIL_MENU.map((s) => ({ ...s, durationMinutes: 10 }))).cents!;
    expect(withAddons).toBeGreaterThan(addonsOnlyPool);
  });

  it('uses the median, so one $400 bridal package cannot move the budget', () => {
    const sane = menuTicket(NAIL_MENU).cents!;
    const withWhale = menuTicket([...NAIL_MENU, svc(40000, 180)]).cents!;
    expect(withWhale).toBe(sane);
  });

  it('still answers for a menu that is nothing but short services', () => {
    const t = menuTicket([svc(2000, 10), svc(3000, 15), svc(2500, 10)]);
    expect(t.source).toBe('menu');
    expect(t.cents).toBe(2500);
  });

  it('says nothing rather than zero when there is no menu at all', () => {
    for (const m of [undefined, null, [], [svc(0), svc(0)]]) {
      expect(estimateTicket({ services: m }).source).toBe('none');
      expect(estimateTicket({ services: m }).cents).toBeNull();
    }
  });

  it('never reports a measured source for an estimated number', () => {
    const t = estimateTicket({ services: NAIL_MENU });
    expect(['first-visits', 'all-visits']).not.toContain(t.source);
  });

  it('leans to the lower middle on an even count — an estimate must not overspend', () => {
    expect(medianCents([100, 200, 300, 400])).toBe(200);
  });

  it('treats a service exactly at the threshold as a visit', () => {
    const t = menuTicket([svc(9900, MIN_VISIT_MINUTES), svc(100, 5)]);
    expect(t.cents).toBe(9900);
  });
});
