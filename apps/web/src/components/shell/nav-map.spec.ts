import { readFileSync } from 'fs';
import { join } from 'path';
import { activeHref, activeTab, DASHBOARD, GROUPS, ITEM_BY_HREF, SCREEN_BY_HREF, SECTIONS, menuOwner, sectionFor } from './nav-map';

// The drawings live in NavIcon.tsx (JSX, which this runner does not compile),
// so their names are read from the source: `  name: <...`.
const drawn = new Set(
  [...readFileSync(join(__dirname, '..', 'NavIcon.tsx'), 'utf8').matchAll(/^  (\w+): </gm)].map((m) => m[1]),
);

describe('menu icons', () => {
  const items = [DASHBOARD, ...GROUPS.flatMap((g) => g.items)];
  it('every screen and every area has a drawing (no silent fallback)', () => {
    for (const i of Object.values(SCREEN_BY_HREF)) expect([i.href, drawn.has(i.icon)]).toEqual([i.href, true]);
    for (const s of SECTIONS) expect([s.id, drawn.has(s.icon)]).toEqual([s.id, true]);
  });
  it('no two menu entries share an icon', () => {
    const seen = new Map<string, string>();
    for (const i of items) {
      expect([i.href, seen.get(i.icon) ?? null]).toEqual([i.href, null]);
      seen.set(i.icon, i.href);
    }
  });
});

/**
 * The new two-tier menu shows the same screens as the classic sidebar — none
 * lost, none twice — and always lights up the area the person is in.
 */
describe('the new menu', () => {
  const classic = [DASHBOARD.href, ...GROUPS.flatMap((g) => g.items.map((i) => i.href))];
  const sectioned = SECTIONS.flatMap((s) => s.hrefs);

  it('carries every entry of the classic sidebar, exactly once', () => {
    expect([...sectioned].sort()).toEqual([...classic].sort());
    expect(new Set(sectioned).size).toBe(sectioned.length);
  });

  it('every item it lists is a real menu item', () => {
    for (const h of sectioned) expect(ITEM_BY_HREF[h]).toBeDefined();
  });

  it('"less used" items belong to their own section', () => {
    for (const s of SECTIONS) for (const h of s.lessUsed ?? []) expect(s.hrefs).toContain(h);
  });

  it('finds the area of a route, deep pages and tabs included', () => {
    expect(sectionFor('/salon')).toBe('ops');
    expect(sectionFor('/salon/pos')).toBe('ops');
    expect(sectionFor('/salon/pos/report')).toBe('finance'); // not swallowed by /salon/pos
    expect(sectionFor('/salon/pos/shifts')).toBe('ops'); // a tab of Orders
    expect(sectionFor('/salon/marketing/monthly')).toBe('growth');
    expect(sectionFor('/salon/account')).toBe('account');
    expect(sectionFor('/salon/chain')).toBe('finance');
    expect(sectionFor('/salon/services')).toBe('catalog');
    expect(sectionFor('/salon/inventory')).toBe('catalog');
    expect(sectionFor('/salon/inbox/abc')).toBe('clients');
    expect(sectionFor('/salon/reviews-replies')).toBe('clients');
    expect(sectionFor('/salon/payment-terminals')).toBe('account');
  });

  it('the dashboard is active only on itself', () => {
    expect(activeHref('/salon', ['/salon', '/salon/pos'])).toBe('/salon');
    expect(activeHref('/salon/pos/shifts', ['/salon', '/salon/pos', '/salon/pos/shifts'])).toBe('/salon/pos/shifts');
    expect(activeHref('/salon/unknown', ['/salon'])).toBeNull();
  });
});

/** Screens that do one job live under one entry, as tabs — and none was lost doing it. */
describe('gathered entries', () => {
  // Every screen the menu had before the 2026-10-21 review.
  const before = ['/salon', '/salon/front-desk', '/salon/calendar', '/salon/bookings', '/salon/walkins', '/salon/activity', '/salon/tables', '/salon/menu',
    '/salon/waitlist', '/salon/pos', '/salon/orders', '/salon/customers', '/salon/feedback', '/salon/forms', '/salon/services', '/salon/products',
    '/salon/gift-cards', '/salon/staff', '/salon/stations', '/salon/content', '/salon/channels', '/salon/approve-posts', '/salon/marketing',
    '/salon/marketing/monthly', '/salon/email', '/salon/reviews', '/salon/reviews-replies', '/salon/inbox', '/salon/messenger', '/salon/voice',
    '/salon/ai', '/salon/payments', '/salon/payment-terminals', '/salon/card-transactions', '/salon/reports', '/salon/pos/report',
    '/salon/pos/shifts', '/salon/payroll', '/salon/inventory', '/salon/billing', '/salon/notifications', '/salon/integrations',
    '/salon/connections', '/salon/settings', '/salon/trash'];

  it('every screen is still reachable from the menu, keeping its gates', () => {
    for (const h of before) expect([h, !!SCREEN_BY_HREF[h]]).toEqual([h, true]);
    expect(SCREEN_BY_HREF['/salon/card-transactions'].market).toBe('na');
    expect(SCREEN_BY_HREF['/salon/pos/shifts'].feature).toBe('pos');
    expect(SCREEN_BY_HREF['/salon/connections'].team).toBe(true);
  });

  it('the menu is shorter', () => {
    const entries = [DASHBOARD, ...GROUPS.flatMap((g) => g.items)].filter((i) => !i.biz);
    // 26 after the 2026-10-21 review, + Thu & Chi (a new job, not a duplicate).
    expect(entries.length).toBeLessThanOrEqual(27);
  });

  it('a gathering entry opens its first tab, which is the entry itself', () => {
    for (const i of [DASHBOARD, ...GROUPS.flatMap((g) => g.items)]) {
      if (!i.tabs) continue;
      expect(i.tabs[0].href).toBe(i.href);
      expect(i.hubKey).toBeTruthy();
      expect(new Set(i.tabs.map((t) => t.href)).size).toBe(i.tabs.length);
    }
  });

  it('a tab page lights up the entry it lives under', () => {
    expect(menuOwner('/salon/bookings')).toBe('/salon/calendar');
    expect(menuOwner('/salon/waitlist')).toBe('/salon/calendar');
    expect(menuOwner('/salon/pos')).toBe('/salon/pos');
    expect(menuOwner('/salon/pos/shifts')).toBe('/salon/orders');
    expect(menuOwner('/salon/pos/report')).toBe('/salon/reports');
    expect(menuOwner('/salon/card-transactions')).toBe('/salon/orders');
    expect(menuOwner('/salon/marketing')).toBe('/salon/marketing');
    expect(menuOwner('/salon/marketing/monthly')).toBe('/salon/marketing/monthly');
    expect(menuOwner('/salon/marketing/report')).toBe('/salon/marketing/monthly');
    expect(menuOwner('/salon/activity')).toBe('/salon');
    expect(menuOwner('/salon/voice')).toBe('/salon/ai');
    expect(menuOwner('/salon/customers/abc')).toBe('/salon/customers');
    expect(menuOwner('/salon/nowhere')).toBeNull();
  });

  it('picks the tab of a page, ?tab= views included', () => {
    const rep = ITEM_BY_HREF['/salon/reports'].tabs!;
    expect(activeTab(rep, '/salon/reports', null)).toBe('/salon/reports');
    expect(activeTab(rep, '/salon/reports', 'services')).toBe('/salon/reports?tab=services');
    expect(activeTab(rep, '/salon/reports', 'nope')).toBe('/salon/reports');
    expect(activeTab(rep, '/salon/pos/report', null)).toBe('/salon/pos/report');
    const ord = ITEM_BY_HREF['/salon/orders'].tabs!;
    expect(activeTab(ord, '/salon/pos/shifts', null)).toBe('/salon/pos/shifts');
    expect(activeTab(ord, '/salon/pos', null)).toBeNull();
  });
});
