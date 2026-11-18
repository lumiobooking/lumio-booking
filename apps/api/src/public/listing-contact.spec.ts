import { listingAddressLine, pageContact } from './listing-contact';

const allure = { street: '2420 Atlanta Road Southeast #300', locality: 'Smyrna', region: 'Georgia', postalCode: '30080-2118', country: 'US' };

describe('the address a booking page shows', () => {
  it('writes the salon\'s Google listing address on one line', () => {
    expect(listingAddressLine(allure)).toBe('2420 Atlanta Road Southeast #300, Smyrna, Georgia 30080-2118');
    expect(listingAddressLine({ street: '257 Dundas St E #6', locality: 'Mississauga', region: null, postalCode: 'L5A 1W8' })).toBe('257 Dundas St E #6, Mississauga, L5A 1W8');
  });
  it('half an address is not shown', () => {
    expect(listingAddressLine({ locality: 'Smyrna', region: 'Georgia' })).toBe('');
    expect(listingAddressLine({ street: '1 Main St' })).toBe('');
    expect(listingAddressLine(null)).toBe('');
    expect(listingAddressLine('x' as never)).toBe('');
  });
  it('what the salon typed always wins; the listing only fills a gap', () => {
    expect(pageContact({ address: '5900 Balcones Dr', phone: '+15125550100' }, { address: allure, phone: '+14703080680' })).toEqual({ address: '5900 Balcones Dr', phone: '+15125550100' });
    expect(pageContact({ address: ' ', phone: null }, { address: allure, phone: '+14703080680' })).toEqual({ address: '2420 Atlanta Road Southeast #300, Smyrna, Georgia 30080-2118', phone: '+14703080680' });
    expect(pageContact({ address: '', phone: '' }, null)).toEqual({ address: null, phone: null });
    expect(pageContact({}, { address: null, phone: 'call us <script>' })).toEqual({ address: null, phone: null });
  });
});
