import { clientVisits } from './client-visits';

const svc = [{ id: 's-gel', name: 'Gel manicure' }, { id: 's-pedi', name: 'Spa pedicure' }, { id: 's-old', name: 'Old service', isActive: false }];
const ap = (id: string, at: string, status: string, serviceId: string, name: string, staffId: string | null, paid = 0) => ({
  id, status, startTime: at, serviceId, assignedStaffId: staffId, service: { name }, assignedStaff: staffId ? { firstName: 'Lisa', lastName: null } : null,
  payments: paid ? [{ amountCents: paid, status: 'PAID' }] : [],
});

describe('a client’s visits', () => {
  it('puts the appointments of one day together and books them again with the same tech', () => {
    const v = clientVisits([
      ap('a1', '2026-10-10T17:00:00Z', 'COMPLETED', 's-gel', 'Gel manicure', 'st1', 4500),
      ap('a2', '2026-10-10T18:00:00Z', 'COMPLETED', 's-pedi', 'Spa pedicure', 'st1', 5500),
      ap('a3', '2026-09-01T17:00:00Z', 'NO_SHOW', 's-gel', 'Gel manicure', null),
    ], [], svc, new Date('2026-11-05T00:00:00Z'), 'America/New_York');
    expect(v).toHaveLength(2);
    expect(v[0]).toMatchObject({ kind: 'done', paidCents: 10000, rebook: [{ serviceId: 's-gel', staffId: 'st1' }, { serviceId: 's-pedi', staffId: 'st1' }] });
    expect(v[0].lines.map((l) => l.name)).toEqual(['Gel manicure', 'Spa pedicure']);
    expect(v[1].kind).toBe('missed');
  });

  it('skips services no longer on the menu, shows upcoming visits, and turns a walk-in sale into a visit', () => {
    const v = clientVisits([
      ap('a1', '2026-12-01T17:00:00Z', 'CONFIRMED', 's-old', 'Old service', 'st2'),
    ], [{ id: 'o1', createdAt: '2026-10-20T20:00:00Z', totalCents: 3000, appointmentId: null, items: [{ name: 'gel  MANICURE', quantity: 1, staffMemberId: 'st3' }] }], svc, new Date('2026-11-05T00:00:00Z'), 'America/New_York');
    expect(v[0]).toMatchObject({ kind: 'upcoming', rebook: [] });
    expect(v[1]).toMatchObject({ kind: 'done', paidCents: 3000, rebook: [{ serviceId: 's-gel', staffId: 'st3' }] });
  });
});
