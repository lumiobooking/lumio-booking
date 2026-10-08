/**
 * One Google location, one salon — and no guessing. The old auto-detect took
 * the first profile of the agency's Google login, which tied a bonsai garden
 * to a nail salon's profile (its report printed "spa 1 nails").
 */
import { bareLocation, nameTokens, namesMatch, pickLocation, takenLocations } from './location-match';

describe('business names', () => {
  it('compare distinctive words only, accent-folded', () => {
    expect(nameTokens('Vườn Tùng Nhật Bản AKITA')).toEqual(['vuon', 'tung', 'nhat', 'ban', 'akita']);
    expect(nameTokens('Happy Nails & Spa')).toEqual(['happy']);
    expect(nameTokens('501 Nails & Spa')).toEqual(['501']);
    expect(namesMatch('Spa 1 Nails', 'Vườn Tùng Nhật Bản AKITA')).toBe(false);
    expect(namesMatch('Top Nails', 'Happy Nails & Spa')).toBe(false); // "nails" is not a name
    expect(namesMatch('Nail & Spa at Alamo Ranch - Nail Salon San Antonio Tx', 'Alamo Ranch - Nail Salon')).toBe(true);
    expect(namesMatch('5 Points Nails & Spa', '5 Points Nails & Spa')).toBe(true);
    expect(namesMatch('', 'Lux')).toBe(false);
  });
});

describe('picking a location after Google is connected', () => {
  const agency = [
    { name: 'locations/1', title: 'Spa 1 Nails' },
    { name: 'locations/2', title: 'Lux Nail Spa' },
    { name: 'locations/3', title: 'Vườn Tùng AKITA' },
  ];
  it('never the first one by default: a many-profile login with no name match asks a person', () => {
    expect(pickLocation(agency, 'Rose Nail Spa', new Set())).toEqual({ pick: null, why: 'ambiguous' });
  });
  it('the one whose name is the salon’s', () => {
    expect(pickLocation(agency, 'Vườn Tùng Nhật Bản AKITA', new Set())).toEqual({ pick: agency[2], why: 'name-match' });
    expect(pickLocation(agency, 'Lux Nail Spa', new Set())).toEqual({ pick: agency[1], why: 'name-match' });
  });
  it('never a location another salon holds, even when the name matches', () => {
    expect(pickLocation(agency, 'Lux Nail Spa', new Set(['locations/2']))).toEqual({ pick: null, why: 'ambiguous' });
    expect(pickLocation([agency[0]], 'X', new Set(['locations/1']))).toEqual({ pick: null, why: 'all-taken' });
  });
  it('a login with exactly one profile links it', () => {
    expect(pickLocation([agency[0]], 'Whatever', new Set())).toEqual({ pick: agency[0], why: 'only-one' });
    expect(pickLocation([], 'X', new Set())).toEqual({ pick: null, why: 'none' });
  });
});

describe('locations taken by other salons', () => {
  it('reads connected links of OTHER tenants, any id spelling', () => {
    const rows = [
      { tenantId: 'a', value: { connected: true, locationId: 'accounts/9/locations/1' } },
      { tenantId: 'b', value: { connected: true, locationId: 'locations/2' } },
      { tenantId: 'c', value: { connected: false, locationId: 'locations/3' } },
      { tenantId: 'me', value: { connected: true, locationId: 'locations/4' } },
      { tenantId: 'd', value: { connected: true, locationId: '' } },
    ];
    expect([...takenLocations(rows, 'me')].sort()).toEqual(['locations/1', 'locations/2']);
    expect(bareLocation('accounts/9/locations/1')).toBe('locations/1');
    expect(bareLocation('123')).toBe('locations/123');
    expect(bareLocation('')).toBe('');
  });
});
