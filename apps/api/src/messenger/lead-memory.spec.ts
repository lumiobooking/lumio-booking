import { dossierHas, leadDossier, rawMemoryFallback } from './lead-memory';

describe('the dossier — facts the customer already gave, never asked twice', () => {
  const lead = {
    name: 'Cẩm Tú', phone: '+14085551234', salonName: 'Tú Nail & Spa',
    city: 'Garden Grove', interest: 'Gói Lumio Boost', note: null,
  };

  it('renders every banked fact, in the customer’s own words', () => {
    const d = leadDossier(lead);
    expect(d).toContain('Cẩm Tú');
    expect(d).toContain('+14085551234');
    expect(d).toContain('Tú Nail & Spa');
    expect(d).toContain('Garden Grove');
    expect(d).toContain('Gói Lumio Boost');
  });

  it('states the rule that broke a real consultation: do not ask again', () => {
    const d = leadDossier(lead);
    expect(d).toMatch(/không được hỏi lại/i);
  });

  it('newer information from the live chat wins — silently', () => {
    // The customer correcting their own phone number must never be met with
    // "which one is right?".
    expect(leadDossier(lead)).toMatch(/thông tin mới thắng/i);
  });

  it('an empty or missing lead adds NOTHING to the prompt', () => {
    expect(leadDossier(null)).toBe('');
    expect(leadDossier(undefined)).toBe('');
    expect(leadDossier({ name: '', phone: '   ' })).toBe('');
  });

  it('a partial lead lists only what is known — no blank labels', () => {
    const d = leadDossier({ name: 'Colin', phone: null, salonName: null, city: null });
    expect(d).toContain('Colin');
    expect(d).not.toMatch(/Số điện thoại/);
    expect(d).not.toMatch(/Tên tiệm/);
  });

  it('dossierHas answers "do we already know this?"', () => {
    expect(dossierHas(lead, 'phone')).toBe(true);
    expect(dossierHas(lead, 'note')).toBe(false);
    expect(dossierHas(null, 'name')).toBe(false);
  });
});

describe('memory survives an AI outage', () => {
  const dropped = [
    { role: 'user', content: 'Tiệm em tên Tú Nail ở Garden Grove' },
    { role: 'assistant', content: 'Dạ em ghi nhận ạ' },
    { role: 'user', content: 'Số em là 408-555-1234' },
  ];

  it('banks the turns RAW rather than losing them — the credit-outage case', () => {
    const out = rawMemoryFallback('- Khách quan tâm gói Boost', dropped);
    expect(out).toContain('Khách quan tâm gói Boost'); // the old profile survives
    expect(out).toContain('Tú Nail');                  // and the new facts land
    expect(out).toContain('408-555-1234');
    expect(out).toContain('KHÁCH');                    // speaker tags stay readable
  });

  it('marks itself as raw so the next distillation knows to tidy it', () => {
    expect(rawMemoryFallback(null, dropped)).toContain('chưa chưng cất');
  });

  it('nothing dropped → the profile is untouched', () => {
    expect(rawMemoryFallback('- hồ sơ cũ', [])).toBe('- hồ sơ cũ');
    expect(rawMemoryFallback(null, [])).toBe('');
  });

  it('when it must trim, it keeps the NEWEST facts', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ role: 'user', content: `tin nhắn số ${i}` }));
    const out = rawMemoryFallback('x'.repeat(1500), many, 800);
    expect(out.length).toBeLessThanOrEqual(800);
    expect(out).toContain('tin nhắn số 59');   // the last thing said survives
    expect(out).not.toContain('x'.repeat(50)); // the stale head is what gets cut
  });

  it('long single messages are clipped, not allowed to eat the profile', () => {
    const out = rawMemoryFallback(null, [{ role: 'user', content: 'a'.repeat(5000) }]);
    expect(out.length).toBeLessThan(400);
  });
});

describe('the dossier follows the customer\'s language', () => {
  const lead = { name: 'Anna', phone: '512-555-1234', salonName: null, city: null, interest: null, note: null } as never;

  it('is written in English for an English customer — it sits closest to their message', () => {
    const d = leadDossier(lead, 'en');
    expect(d).toMatch(/WHAT THIS CUSTOMER HAS ALREADY TOLD US/);
    expect(d).toMatch(/Customer name: Anna/);
    expect(d).not.toMatch(/Tên khách/);
  });

  it('stays Vietnamese for a Vietnamese customer, and when nobody can tell', () => {
    expect(leadDossier(lead, 'vi')).toMatch(/Tên khách: Anna/);
    expect(leadDossier(lead)).toMatch(/Tên khách: Anna/);
  });
});

describe('the salon’s own customer, for the booking bot', () => {
  const { customerDossier } = jest.requireActual('./lead-memory') as typeof import('./lead-memory');
  it('puts name, phone and the next appointment in front of the model, and forbids asking again', () => {
    const d = customerDossier({ firstName: 'Anna', lastName: 'Le', phone: '+18052808824', upcoming: [{ service: 'Gel manicure', when: 'Fri, Oct 3, 2:00 PM', staff: 'Ivy' }], visits: 4 }, 'en');
    expect(d).toMatch(/KNOWN CUSTOMER/);
    expect(d).toMatch(/Customer name: Anna Le/);
    expect(d).toMatch(/Phone number: \+18052808824/);
    expect(d).toMatch(/Gel manicure · Fri, Oct 3, 2:00 PM · with Ivy/);
    expect(d).toMatch(/do not ask for their phone number/);
  });
  it('is Vietnamese for a Vietnamese customer, falls back to the profile name, and is empty with nothing to say', () => {
    expect(customerDossier({ firstName: 'Trang', phone: '0901' }, 'vi')).toMatch(/KHÁCH ĐÃ CÓ HỒ SƠ[\s\S]*Tên khách: Trang/);
    expect(customerDossier({ displayName: 'Petty N.' })).toMatch(/Tên khách: Petty N\./);
    expect(customerDossier({})).toBe('');
    expect(customerDossier(null)).toBe('');
  });
});
