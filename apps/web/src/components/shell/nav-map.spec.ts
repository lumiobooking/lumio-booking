import { activeHref, DASHBOARD, GROUPS, ITEM_BY_HREF, SECTIONS, sectionFor } from './nav-map';

/**
 * The new two-tier menu shows the same screens as the classic sidebar — none
 * lost, none twice — and always lights up the area the person is in.
 */
describe('the new menu', () => {
  const classic = [DASHBOARD.href, ...GROUPS.flatMap((g) => g.items.map((i) => i.href))];
  const sectioned = SECTIONS.flatMap((s) => s.hrefs);

  it('carries every screen of the classic sidebar, exactly once', () => {
    expect([...sectioned].sort()).toEqual([...classic].sort());
    expect(new Set(sectioned).size).toBe(sectioned.length);
  });

  it('every item it lists is a real menu item', () => {
    for (const h of sectioned) expect(ITEM_BY_HREF[h]).toBeDefined();
  });

  it('"less used" items belong to their own section', () => {
    for (const s of SECTIONS) for (const h of s.lessUsed ?? []) expect(s.hrefs).toContain(h);
  });

  it('finds the area of a route, deep pages included', () => {
    expect(sectionFor('/salon')).toBe('ops');
    expect(sectionFor('/salon/pos')).toBe('ops');
    expect(sectionFor('/salon/pos/report')).toBe('finance'); // not swallowed by /salon/pos
    expect(sectionFor('/salon/marketing/monthly')).toBe('growth');
    expect(sectionFor('/salon/account')).toBe('account');
    expect(sectionFor('/salon/chain')).toBe('finance');
    expect(sectionFor('/salon/services')).toBe('catalog');
    expect(sectionFor('/salon/inbox/abc')).toBe('clients');
  });

  it('the dashboard is active only on itself', () => {
    expect(activeHref('/salon', ['/salon', '/salon/pos'])).toBe('/salon');
    expect(activeHref('/salon/pos/shifts', ['/salon', '/salon/pos', '/salon/pos/shifts'])).toBe('/salon/pos/shifts');
    expect(activeHref('/salon/unknown', ['/salon'])).toBeNull();
  });
});
