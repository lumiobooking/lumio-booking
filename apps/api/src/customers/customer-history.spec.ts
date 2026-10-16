/**
 * The returning customer's card: visits, last visit, favourite technician,
 * top services — counted from her own rows only, no-shows set apart.
 */
import { appointmentServices, historiesOf, summarizeHistory, walkInServices, type VisitRow } from './customer-history';

const NOW = new Date('2026-10-16T12:00:00Z');
const row = (o: Partial<Omit<VisitRow, 'at'>> & { at: string }): VisitRow => ({
  customerId: 'c1', status: 'COMPLETED', staffId: 'elena', staffName: 'Elena', services: [{ id: 'gel', name: 'Gel Manicure' }], ...o, at: new Date(o.at),
});

describe('summarizeHistory', () => {
  it('counts the visits that happened, the no-shows apart, and reads the last one', () => {
    const h = summarizeHistory([
      row({ at: '2026-10-02T15:00:00Z', services: [{ id: 'gel', name: 'Gel Manicure' }, { id: 'art', name: 'Nail Art' }] }),
      row({ at: '2026-09-10T15:00:00Z', staffId: 'eric', staffName: 'Eric', services: [{ id: 'pedi', name: 'Spa Pedicure' }] }),
      row({ at: '2026-08-01T15:00:00Z', status: 'NO_SHOW' }),
      row({ at: '2026-07-01T15:00:00Z' }),
      // Already on the calendar for next week: not a visit yet.
      row({ at: '2026-10-20T15:00:00Z', status: 'CONFIRMED' }),
    ], NOW);
    expect(h.visits).toBe(3);
    expect(h.noShows).toBe(1);
    expect(h.upcomingAt?.toISOString()).toBe('2026-10-20T15:00:00.000Z');
    expect(h.last?.at.toISOString()).toBe('2026-10-02T15:00:00.000Z');
    expect(h.last?.services.map((s) => s.name)).toEqual(['Gel Manicure', 'Nail Art']);
    expect(h.favoriteStaff).toEqual({ id: 'elena', name: 'Elena' });
    expect(h.topServices.map((s) => `${s.id}:${s.n}`)).toEqual(['gel:2', 'art:1', 'pedi:1']);
  });

  it('breaks a technician tie by the most recent visit', () => {
    const h = summarizeHistory([
      row({ at: '2026-10-02T15:00:00Z', staffId: 'eric', staffName: 'Eric' }),
      row({ at: '2026-09-02T15:00:00Z', staffId: 'elena', staffName: 'Elena' }),
    ], NOW);
    expect(h.favoriteStaff?.id).toBe('eric');
  });

  it('a customer with nothing yet is empty, and one customer never reads another’s rows', () => {
    const m = historiesOf(['c1', 'c2'], [row({ at: '2026-10-02T15:00:00Z' }), row({ customerId: 'c9', at: '2026-10-03T15:00:00Z' })], NOW);
    expect(m.get('c1')?.visits).toBe(1);
    expect(m.get('c2')?.visits).toBe(0);
    expect(m.get('c2')?.last).toBeNull();
    expect(m.has('c9')).toBe(false);
  });
});

describe('reading the services off a visit', () => {
  it('appointment: the primary, then the extra services in addons (add-ons themselves left out)', () => {
    expect(appointmentServices({
      service: { id: 'gel', name: 'Gel Manicure' },
      addons: [{ id: 'art', name: 'Nail Art', kind: 'service' }, { id: 'x', name: 'Rhinestones', priceCents: 500 }, { id: 'gel', name: 'Gel Manicure', kind: 'service' }],
    }).map((s) => s.id)).toEqual(['gel', 'art']);
  });
  it('walk-in: its line items, else its primary service', () => {
    expect(walkInServices({ items: [{ serviceId: 'pedi', name: 'Spa Pedicure' }, { serviceId: 'pedi', name: 'Spa Pedicure' }] }).map((s) => s.id)).toEqual(['pedi']);
    expect(walkInServices({ service: { id: 'gel', name: 'Gel' }, items: [] }).map((s) => s.id)).toEqual(['gel']);
  });
});
