import { detectIndustry, configGaps } from './industry-detect';

describe('a shop is read from what it sells, not from what it is called', () => {
  it('recognises a nail salon from its service list', () => {
    const d = detectIndustry({
      tenantName: 'Lux Nail Spa',
      serviceNames: ['Gel X Full Set', 'Dipping Powder', 'Deluxe Pedicure'],
      currentIndustry: 'SALON',
    });
    expect(d.detected).toBe('SALON');
    expect(d.confidence).toBe('high');
    expect(d.agrees).toBe(true);
    expect(d.evidence.join(' ')).toMatch(/Gel X|Dipping|Pedicure/i);
  });

  it('recognises an estate agency and flags that the stored trade is wrong', () => {
    const d = detectIndustry({
      tenantName: 'Family Smart Homes',
      serviceNames: ['Home Valuation', 'Property Tour', 'Buyer Consultation'],
      website: 'https://www.familysmarthomes.com',
      currentIndustry: 'SALON',
    });
    expect(d.detected).toBe('REAL_ESTATE');
    expect(d.confidence).toBe('high');
    expect(d.agrees).toBe(false);
    expect(d.summary).toMatch(/dữ liệu của tiệm chỉ rõ ngành bất động sản/);
  });

  it('recognises a restaurant from its tables and menu, before any keyword', () => {
    // Structure is a fact about how the business runs. A generically named
    // place with 20 tables is a restaurant whatever it calls itself.
    const d = detectIndustry({
      tenantName: 'The Corner',
      tableCount: 20,
      menuItemCount: 42,
      menuItemNames: ['Phở tái', 'Bún bò', 'Cà phê sữa'],
      currentIndustry: 'SALON',
    });
    expect(d.detected).toBe('RESTAURANT');
    expect(d.confidence).toBe('high');
  });

  it('is not fooled by a misleading NAME', () => {
    // "Home" would drag this into real estate if names counted for much. The
    // services are what the business actually sells.
    const d = detectIndustry({
      tenantName: 'Home Nails & Spa',
      serviceNames: ['Acrylic Full Set', 'Gel Manicure', 'Spa Pedicure'],
      currentIndustry: 'SALON',
    });
    expect(d.detected).toBe('SALON');
  });

  it('is not fooled by a domain either', () => {
    const d = detectIndustry({
      tenantName: 'Sunrise',
      website: 'https://sunrisehomes.example.com',
      serviceNames: ['Gel X Full Set', 'Dipping Powder', 'Pedicure'],
      currentIndustry: 'SALON',
    });
    expect(d.detected).toBe('SALON');
  });
});

describe('it refuses to guess when the shop has told it nothing', () => {
  it('returns no detection for an empty tenant', () => {
    const d = detectIndustry({ tenantName: 'ABC', currentIndustry: 'SALON' });
    expect(d.detected).toBeNull();
    expect(d.confidence).toBe('none');
    expect(d.summary).toMatch(/Chưa đủ dữ liệu/);
  });

  it('says "weak" rather than "wrong" when two trades are close', () => {
    // 12 to 11 has told us nothing, and saying so is more useful than picking
    // the 12 and dressing it up as a finding.
    const d = detectIndustry({
      tenantName: 'Beauty & Bistro',
      serviceNames: ['Spa day'],
      currentIndustry: 'SALON',
    });
    expect(d.confidence).not.toBe('high');
  });

  it('never returns a detection it cannot show evidence for', () => {
    const d = detectIndustry({
      tenantName: 'Lux Nail Spa',
      serviceNames: ['Gel X', 'Pedicure'],
      currentIndustry: 'SALON',
    });
    expect(d.evidence.length).toBeGreaterThan(0);
    for (const e of d.evidence) expect(e.length).toBeGreaterThan(5);
  });

  it('quotes the matched text verbatim so a person can check it', () => {
    const d = detectIndustry({
      serviceNames: ['Deluxe Pedicure with callus treatment'],
      currentIndustry: 'SALON',
    });
    expect(d.evidence.some((e) => e.includes('Deluxe Pedicure'))).toBe(true);
  });
});

describe('nothing here writes anything', () => {
  it('returns a suggestion, and the caller decides', () => {
    // Applying a wrong guess silently across a hundred tenants would change
    // what the AI hotline says to real customers of every one of them.
    const d = detectIndustry({ serviceNames: ['Home Valuation'], currentIndustry: 'SALON' });
    expect(d).toHaveProperty('detected');
    expect(d).toHaveProperty('confidence');
    expect(d).toHaveProperty('evidence');
    expect(Object.keys(d)).not.toContain('applied');
  });
});

describe('the gap list is ordered by consequence, not by effort', () => {
  const wrong = detectIndustry({
    tenantName: 'Family Smart Homes',
    serviceNames: ['Home Valuation', 'Open House', 'Listing Consultation'],
    currentIndustry: 'SALON',
  });

  it('calls a wrong industry blocking, and says what it breaks', () => {
    const g = configGaps({ detection: wrong, formatCount: 5, commissionPct: 60, region: 'CA', postalCode: '92840' });
    expect(g[0].key).toBe('industry');
    expect(g[0].severity).toBe('blocking');
    expect(g[0].message).toMatch(/hotline/);
  });

  it('calls an empty format library blocking, because an empty library invents', () => {
    const ok = detectIndustry({ serviceNames: ['Gel X', 'Pedicure'], currentIndustry: 'SALON' });
    const g = configGaps({ detection: ok, formatCount: 0, commissionPct: 60, region: 'CA', postalCode: '92840' });
    expect(g.find((x) => x.key === 'formats')?.severity).toBe('blocking');
    expect(g.find((x) => x.key === 'formats')?.message).toMatch(/ứng biến/);
  });

  it('calls a missing commission blocking, since discounts stop entirely', () => {
    const ok = detectIndustry({ serviceNames: ['Gel X', 'Pedicure'], currentIndustry: 'SALON' });
    const g = configGaps({ detection: ok, formatCount: 5, commissionPct: null, region: 'CA', postalCode: '92840' });
    expect(g.find((x) => x.key === 'commission')?.severity).toBe('blocking');
  });

  it('calls a missing region degraded, not blocking — it still works, nationally', () => {
    const ok = detectIndustry({ serviceNames: ['Gel X', 'Pedicure'], currentIndustry: 'SALON' });
    const g = configGaps({ detection: ok, formatCount: 5, commissionPct: 60, region: null, postalCode: null });
    expect(g.find((x) => x.key === 'region')?.severity).toBe('degraded');
    expect(g.find((x) => x.key === 'zips')?.severity).toBe('degraded');
  });

  it('reports nothing when a tenant is fully configured', () => {
    const ok = detectIndustry({ serviceNames: ['Gel X', 'Pedicure'], currentIndustry: 'SALON' });
    expect(configGaps({ detection: ok, formatCount: 10, commissionPct: 60, region: 'CA', postalCode: '92840' })).toEqual([]);
  });

  it('does not cry "wrong industry" on a weak signal', () => {
    const weak = detectIndustry({ tenantName: 'Beauty & Bistro', serviceNames: ['Spa day'], currentIndustry: 'SALON' });
    const g = configGaps({ detection: weak, formatCount: 5, commissionPct: 60, region: 'CA', postalCode: '92840' });
    expect(g.find((x) => x.key === 'industry')).toBeUndefined();
  });
});

describe('a written description outranks every heuristic here', () => {
  it('reads the business’s own words with the highest weight', () => {
    const d = detectIndustry({
      tenantName: 'Lumio Agency',
      declaredWhatWeDo: 'Dịch vụ marketing cho doanh nghiệp của người Việt tại Mỹ',
      serviceNames: ['Gói quản lý fanpage', 'Chạy quảng cáo'],
      currentIndustry: 'SALON',
    });
    // Not nail, whatever the neighbouring clients are.
    expect(d.detected).not.toBe('SALON');
  });

  it('refuses to propose an industry change against a written description', () => {
    // Overruling the only authoritative source with a keyword score would be
    // exactly the failure this whole file was rewritten to stop.
    const d = detectIndustry({
      tenantName: 'X',
      declaredWhatWeDo: 'Chúng tôi làm dịch vụ marketing cho các tiệm nail của người Việt tại Mỹ',
      serviceNames: ['Gel X', 'Pedicure', 'Dipping Powder'],
      currentIndustry: 'SERVICE',
    });
    // The nail words are all about the CLIENTS, not this business.
    expect(d.confidence).not.toBe('high');
  });

  it('still detects normally when nothing was declared', () => {
    const d = detectIndustry({
      tenantName: 'Lux Nail Spa',
      serviceNames: ['Gel X', 'Pedicure', 'Dipping Powder'],
      currentIndustry: 'SALON',
    });
    expect(d.detected).toBe('SALON');
    expect(d.confidence).toBe('high');
  });
});
