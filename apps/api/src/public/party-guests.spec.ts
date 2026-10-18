import { partyGuests } from './party-guests';

describe('"People: N" on the online form', () => {
  it('turns the others into guests with the booker\'s services', () => {
    const g = partyGuests({ partySize: 3, serviceId: 'gel', serviceIds: ['gel', 'pedi'] }, false);
    expect(g).toEqual([{ firstName: '', serviceIds: ['gel', 'pedi'] }, { firstName: '', serviceIds: ['gel', 'pedi'] }]);
    expect(g[0].serviceIds).not.toBe(g[1].serviceIds);
  });

  it('leaves named guests, a party of one and a restaurant table alone', () => {
    const named = [{ firstName: 'Lisa', serviceIds: ['pedi'] }];
    expect(partyGuests({ partySize: 4, serviceId: 'gel', guests: named }, false)).toEqual(named);
    expect(partyGuests({ partySize: 1, serviceId: 'gel' }, false)).toEqual([]);
    expect(partyGuests({ serviceId: 'gel' }, false)).toEqual([]);
    expect(partyGuests({ partySize: 6, serviceId: 'table' }, true)).toEqual([]);
  });

  it('caps the party at ten people', () => {
    expect(partyGuests({ partySize: 50, serviceId: 'gel' }, false)).toHaveLength(9);
    expect(partyGuests({ partySize: Number.NaN, serviceId: 'gel' }, false)).toEqual([]);
  });
});
