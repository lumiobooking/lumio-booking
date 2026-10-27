import { seoTrade } from './seo-trade';

describe('the trade a booking link advertises', () => {
  it('a hair salon, a massage spa and a lash studio are not called nail salons', () => {
    expect(seoTrade({ businessType: 'SALON', storedIndustry: null, tenantName: 'Studio Tóc Mai', serviceNames: ['Haircut', 'Balayage', 'Keratin treatment'] })).toBe('HAIR');
    expect(seoTrade({ businessType: 'SALON', storedIndustry: null, tenantName: 'An Sen Massage & Wellness', serviceNames: ['Deep Tissue Massage 60 min', 'Hot Stone Massage', 'Reflexology'] })).toBe('MASSAGE');
    expect(seoTrade({ businessType: 'SALON', storedIndustry: { key: 'LASH' }, tenantName: 'Glow', serviceNames: [] })).toBe('LASH');
  });
  it('nail only when something says nail', () => {
    expect(seoTrade({ businessType: 'SALON', storedIndustry: null, tenantName: 'Lux Nail Spa', serviceNames: ['Pedicure', 'Gel-X full set', 'Manicure'] })).toBe('NAIL');
    expect(seoTrade({ businessType: 'SALON', storedIndustry: null, tenantName: 'Glow Studio', serviceNames: [] })).toBe('BEAUTY');
  });
  it("the owner's choice wins, but only inside its own business type", () => {
    expect(seoTrade({ businessType: 'SALON', storedIndustry: 'HAIR', tenantName: 'X', serviceNames: ['Pedicure'] })).toBe('HAIR');
    expect(seoTrade({ businessType: 'SALON', storedIndustry: 'CAFE', tenantName: 'X', serviceNames: [] })).toBe('BEAUTY');
    expect(seoTrade({ businessType: 'SERVICE', storedIndustry: 'DENTAL', tenantName: 'Smile', serviceNames: [] })).toBe('DENTAL');
  });
  it('restaurants are restaurants (or the café/bakery their menu says), never a salon', () => {
    expect(seoTrade({ businessType: 'RESTAURANT', storedIndustry: null, tenantName: "Kin's Restaurant", serviceNames: [] })).toBe('RESTAURANT');
    expect(seoTrade({ businessType: 'RESTAURANT', storedIndustry: { key: 'CAFE' }, tenantName: 'Bobami', serviceNames: [] })).toBe('CAFE');
    expect(seoTrade({ businessType: 'RESTAURANT', storedIndustry: null, tenantName: 'Lux Nail Bar & Grill', serviceNames: ['Pedicure'] })).toBe('RESTAURANT');
  });
  it('a SERVICE shop books appointments: neither nails nor a table', () => {
    expect(seoTrade({ businessType: 'SERVICE', storedIndustry: null, tenantName: 'Happy Cafe', serviceNames: ['Latte'] })).toBe('SERVICE');
    expect(seoTrade({ businessType: 'REAL_ESTATE', storedIndustry: null, tenantName: 'Family Smart Homes' })).toBe('REAL_ESTATE');
  });
});
