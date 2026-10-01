import { matchesQuery, fold } from '../lib/search-fold';

describe('list search', () => {
  it('ignores case and Vietnamese accents both ways', () => {
    expect(matchesQuery('Tiệm Nail Đẹp', 'tiem nail dep')).toBe(true);
    expect(matchesQuery('tiem nail dep', 'Tiệm')).toBe(true);
    expect(fold('Đà Nẵng')).toBe('da nang');
  });
  it('an empty query matches everything; a miss is a miss', () => {
    expect(matchesQuery('Happy Nails', '  ')).toBe(true);
    expect(matchesQuery('Happy Nails', 'lumio')).toBe(false);
  });
});
