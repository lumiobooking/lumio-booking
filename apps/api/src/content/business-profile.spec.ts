import { resolveIdentity, identityToPrompt, EMPTY_PROFILE } from './business-profile';
import { enOf, viOf } from './i18n';

/** Every phrase this file produces is bilingual; the specs read one side at a time. */
const viAll = (xs: Parameters<typeof viOf>[0][]) => xs.map(viOf).join(' | ');

/** The real business that exposed the flaw: not a salon, not any of the four codes. */
const AGENCY = {
  tenantName: 'Lumio Agency',
  industry: 'SALON',
  declared: {
    whatWeDo: 'Làm dịch vụ marketing cho doanh nghiệp của người Việt tại Mỹ',
    whoWeServe: 'Chủ tiệm nail, nhà hàng, spa người Việt ở Texas và California',
    languages: 'Tiếng Việt, English',
    serviceArea: 'Toàn nước Mỹ, làm việc từ xa',
  },
};

describe('what the business declares outranks the enum', () => {
  it('labels the screen with the business’s own sentence, never the trade code', () => {
    // "ngành nail" sat on top of a marketing agency's screen for a week, and
    // nothing on the page made the cause visible.
    const id = resolveIdentity(AGENCY);
    expect(id.declared).toBe(true);
    expect(id.label).toContain('marketing');
    expect(id.label).not.toMatch(/nail|SALON/i);
  });

  it('tells the model to follow the description when it contradicts the code', () => {
    const p = identityToPrompt(resolveIdentity(AGENCY), 'SALON');
    expect(p).toMatch(/ƯU TIÊN TRÊN MỌI THỨ KHÁC/);
    expect(p).toMatch(/LUÔN theo mô tả ở trên/);
    expect(p).toMatch(/ô phân loại thô/);
  });

  it('carries who the business serves, verbatim', () => {
    const p = identityToPrompt(resolveIdentity(AGENCY), 'SALON');
    expect(p).toContain('Chủ tiệm nail, nhà hàng, spa người Việt');
    expect(p).toContain('Tiếng Việt, English');
  });

  it('keeps a nationwide service area instead of a shop radius', () => {
    const id = resolveIdentity(AGENCY);
    expect(id.profile.serviceArea).toMatch(/Toàn nước Mỹ/);
  });
});

describe('the website and fanpage fill gaps, but never overwrite a declaration', () => {
  it('uses the learned intro when the salon has written nothing', () => {
    const id = resolveIdentity({
      tenantName: 'X', bizIntro: 'Chuyên chăm sóc móng và mi tại Garden Grove',
    });
    expect(id.declared).toBe(true);
    expect(id.profile.whatWeDo).toMatch(/chăm sóc móng/);
    expect(viAll(id.provenance)).toMatch(/website\/fanpage/);
  });

  it('lets the salon’s own words win over the learned intro', () => {
    // The intro was written to greet a customer, not to brief a strategist.
    const id = resolveIdentity({
      declared: { whatWeDo: 'Dịch vụ marketing cho người Việt tại Mỹ' },
      bizIntro: 'Chào mừng bạn đến với chúng tôi!',
    });
    expect(id.profile.whatWeDo).toMatch(/marketing/);
    expect(viOf(id.provenance[0])).toMatch(/tự khai/);
  });

  it('records where every fact came from', () => {
    const id = resolveIdentity({
      declared: { whatWeDo: 'A' }, website: 'https://x.com',
      serviceNames: ['a', 'b'], city: 'Austin', region: 'TX',
    });
    expect(viAll(id.provenance)).toMatch(/tự khai/);
    expect(viAll(id.provenance)).toMatch(/x\.com/);
    expect(viAll(id.provenance)).toMatch(/2 dịch vụ/);
  });
});

describe('it will not invent who the customers are', () => {
  it('forbids inferring the audience when it was not declared', () => {
    const p = identityToPrompt(resolveIdentity({
      declared: { whatWeDo: 'Dịch vụ marketing' },
    }), 'SERVICE');
    expect(p).toMatch(/KHÔNG được tự suy ra tệp khách/);
  });

  it('says nothing is known when nothing was declared at all', () => {
    const id = resolveIdentity({ tenantName: 'ABC', industry: 'SALON' });
    expect(id.declared).toBe(false);
    expect(viOf(id.label)).toMatch(/chưa khai báo/i);
    const p = identityToPrompt(id, 'SALON');
    expect(p).toMatch(/CHƯA TỰ KHAI BÁO/);
    expect(p).toMatch(/KHÔNG mô tả khách hàng của họ/);
    expect(p).toMatch(/gợi ý nền/);
  });

  it('never derives the audience from the neighbourhood', () => {
    const id = resolveIdentity({ city: 'Garden Grove', region: 'CA', tenantName: 'X' });
    expect(id.profile.whoWeServe).toBe('');
    // The city may fill the service AREA — a fact about geography — but never
    // the customer profile, which is a fact only the business has.
    expect(id.profile.serviceArea).toBe('Garden Grove, CA');
  });
});

describe('the gaps say what each blank costs', () => {
  it('lists every empty field with its consequence', () => {
    const id = resolveIdentity({ tenantName: 'X' });
    expect(id.gaps.length).toBe(Object.keys(EMPTY_PROFILE).length);
    for (const g of id.gaps) {
      expect(viOf(g.label).length).toBeGreaterThan(4);
      expect(viOf(g.cost).length).toBeGreaterThan(30);
      // The English side is not allowed to be a copy of the Vietnamese one:
      // that is exactly the bug this pass exists to fix.
      expect(enOf(g.label)).not.toBe(viOf(g.label));
      expect(enOf(g.cost)).not.toBe(viOf(g.cost));
    }
  });

  it('warns that a nationwide business must not be given a five-mile radius', () => {
    const id = resolveIdentity({ declared: { whatWeDo: 'A' } });
    expect(viOf(id.gaps.find((g) => g.field === 'serviceArea')?.cost)).toMatch(/5 dặm/);
  });

  it('counts what is filled so the screen can show progress', () => {
    expect(resolveIdentity(AGENCY).filled).toBe(4);
    expect(resolveIdentity({ tenantName: 'X' }).filled).toBe(0);
  });

  it('reports no gaps once everything is declared', () => {
    const id = resolveIdentity({
      declared: { whatWeDo: 'a', whoWeServe: 'b', languages: 'c', serviceArea: 'd', edge: 'e', avoid: 'f' },
    });
    expect(id.gaps).toEqual([]);
    expect(id.filled).toBe(6);
  });
});

describe('the “never assume” field is passed through as a hard rule', () => {
  it('reaches the prompt as a prohibition', () => {
    const p = identityToPrompt(resolveIdentity({
      declared: { whatWeDo: 'Dịch vụ marketing', avoid: 'Đây KHÔNG phải tiệm nail' },
    }), 'SALON');
    expect(p).toMatch(/TUYỆT ĐỐI KHÔNG giả định: Đây KHÔNG phải tiệm nail/);
  });
});

describe('an English reader gets English', () => {
  it('renders provenance, gaps and the placeholder label in English too', () => {
    const id = resolveIdentity({
      declared: { whatWeDo: 'A' }, website: 'https://x.com', serviceNames: ['a', 'b'],
    });
    const en = id.provenance.map(enOf).join(' | ');
    expect(en).toMatch(/Description written by the business/);
    expect(en).toMatch(/2 services listed in the system/);
    expect(en).not.toMatch(/tự khai|dịch vụ đã khai/);

    const blank = resolveIdentity({ tenantName: 'X' });
    expect(enOf(blank.label)).toMatch(/business not described yet/i);
    expect(viOf(blank.label)).toMatch(/chưa khai báo/i);
  });
});
