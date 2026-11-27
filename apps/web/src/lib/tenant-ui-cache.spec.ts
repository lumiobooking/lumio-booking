import { claimTenantCache, TENANT_UI_KEYS, UI_TENANT_KEY } from './tenant-ui-cache';

function store(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
}

describe('rt250 the device cache belongs to one business', () => {
  it('a nail salon manager signing in after a restaurant: the restaurant facts are gone', () => {
    const s = store({ [UI_TENANT_KEY]: 'restaurant-1', lumio_industry: 'RESTAURANT', lumio_is_restaurant: '1', lumio_theme_keep: 'x', 'lumio.theme': 'dark' });
    expect(claimTenantCache(s, 'nail-2')).toBe(true);
    for (const k of TENANT_UI_KEYS) expect(s.m.has(k)).toBe(false);
    expect(s.m.get(UI_TENANT_KEY)).toBe('nail-2');
    // Personal choices (theme) are not business facts: kept.
    expect(s.m.get('lumio.theme')).toBe('dark');
  });
  it('the same business again keeps its cache (no flash on reload)', () => {
    const s = store({ [UI_TENANT_KEY]: 'nail-2', lumio_industry: 'NAIL' });
    expect(claimTenantCache(s, 'nail-2')).toBe(false);
    expect(s.m.get('lumio_industry')).toBe('NAIL');
  });
  it('a device that never recorded whose cache it was is cleared once', () => {
    const s = store({ lumio_industry: 'RESTAURANT' });
    expect(claimTenantCache(s, 'nail-2')).toBe(true);
    expect(s.m.has('lumio_industry')).toBe(false);
  });
  it('no business (platform admin) or no storage: nothing happens', () => {
    const s = store({ lumio_industry: 'RESTAURANT' });
    expect(claimTenantCache(s, null)).toBe(false);
    expect(claimTenantCache(null, 't')).toBe(false);
    expect(s.m.get('lumio_industry')).toBe('RESTAURANT');
  });
});
