import {
  cleanTradeProfile, customScope, customTenantOf, feedsOf, playbookOf, profileFingerprint, queriesOf,
  tradeProfilePrompt, wantsTradeProfile,
} from './trade-profile';

const good = {
  trade: { vi: 'agency marketing địa phương', en: 'local marketing agency' },
  dailySources: [1, 2, 3, 4].map((i) => ({ label: { vi: `Nguồn ${i}`, en: `Source ${i}` }, when: { vi: 'sáng', en: 'morning' }, why: { vi: 'vì', en: 'because' } })),
  postTypes: [1, 2, 3, 4].map((i) => ({ label: { vi: `Dạng ${i}`, en: `Type ${i}` }, job: { vi: 'việc', en: 'job' }, shots: { vi: 'cảnh', en: 'shots' } })),
  habits: [{ kind: 'engage', text: { vi: 'Trả lời', en: 'Reply' }, why: { vi: 'vì', en: 'because' }, when: { vi: 'sáng', en: 'am' } }],
  youtube: ['local seo for nail salons', 'facebook ads for small business', 'google business profile tips'],
  mustMatch: ['marketing', 'seo', 'google business', 'facebook ads'],
  hashtags: ['#LocalSEO', 'smallbusinessmarketing', 'nail salon marketing', 'agencylife'],
  google: ['local seo'],
};

describe('trade profile — a playbook the engine never wrote', () => {
  it('only the catch-all trade wants one', () => {
    expect(wantsTradeProfile('SERVICE')).toBe(true);
    expect(wantsTradeProfile('')).toBe(true);
    expect(wantsTradeProfile('RESTAURANT')).toBe(false);
    expect(wantsTradeProfile('nail')).toBe(false);
  });

  it('accepts a complete profile and normalises the search vocabulary', () => {
    const p = cleanTradeProfile(good);
    expect(p).not.toBeNull();
    expect(p!.hashtags).toEqual(['localseo', 'smallbusinessmarketing', 'nailsalonmarketing', 'agencylife']);
    expect(p!.mustMatch).toContain('google business');
    expect(p!.youtube.length).toBe(3);
  });

  it('refuses a thin one — three sources, three post types, two search terms is the floor', () => {
    expect(cleanTradeProfile({ ...good, dailySources: good.dailySources.slice(0, 2) })).toBeNull();
    expect(cleanTradeProfile({ ...good, hashtags: ['a'] })).toBeNull();
    expect(cleanTradeProfile({ ...good, trade: null })).toBeNull();
    expect(cleanTradeProfile('nope')).toBeNull();
  });

  it('never lets the hashtag list past seven — Instagram budgets thirty unique tags a week', () => {
    const p = cleanTradeProfile({ ...good, hashtags: Array.from({ length: 20 }, (_, i) => `tag${i}`) });
    expect(p!.hashtags.length).toBe(7);
  });

  it('reads as a playbook and as trade queries', () => {
    const p = cleanTradeProfile(good)!;
    const book = playbookOf(p);
    expect(book.dailySources.length).toBe(4);
    expect(book.habits[0].kind).toBe('engage');
    const q = queriesOf(p);
    expect(q.mustMatch.test('Local SEO for beginners')).toBe(true);
    expect(q.mustMatch.test('Best nail art 2026')).toBe(false);
    expect(q.google).toEqual(['local seo']);
    expect(feedsOf(p)[0].url).toContain('localseo');
  });

  it('fingerprints the description so a rewrite is noticed and a reorder is not', () => {
    const a = profileFingerprint({ whatWeDo: 'Agency marketing', edge: 'x' }, ['SEO', 'Ads']);
    expect(profileFingerprint({ whatWeDo: 'agency marketing ', edge: 'x' }, ['SEO', 'Ads'])).toBe(a);
    expect(profileFingerprint({ whatWeDo: 'Nail salon', edge: 'x' }, ['SEO', 'Ads'])).not.toBe(a);
  });

  it('scopes trend snapshots per business and reads the tenant back', () => {
    expect(customScope('t1', 'vn')).toBe('CUSTOM-t1:VN');
    expect(customScope('t1', 'xx')).toBe('CUSTOM-t1:US');
    expect(customTenantOf('CUSTOM-t1:US')).toBe('t1');
    expect(customTenantOf('SALON:US')).toBeNull();
  });

  it('tells the model the agency-versus-its-clients trap and the market language', () => {
    const p = tradeProfilePrompt({ whatWeDo: 'Agency', services: [], market: 'US', tenantName: 'Lumio' });
    expect(p.system).toMatch(/KHÔNG PHẢI tiệm nail/);
    expect(p.system).toMatch(/tiếng Anh là chính/);
    expect(tradeProfilePrompt({ whatWeDo: 'Agency', services: [], market: 'VN', tenantName: 'L' }).system).toMatch(/tiếng Việt là chính/);
  });
});
