/**
 * rt250 — "tạo user quản lý thì hệ thống nhảy vào hệ thống nhà hàng".
 *
 * The salon screens remember a few facts about the business on the DEVICE so
 * the next load paints right away: its line of business (nail / restaurant…),
 * whether it is a restaurant, POS on/off, hidden menu items, its time zone.
 * Those were never tied to WHICH business: after someone used a restaurant on
 * this browser (Lumio staff, an owner of two businesses), a new manager of a
 * nail salon signing in got the restaurant screens and menu, and the shell
 * sent them to a restaurant page before the salon's own answer arrived.
 *
 * Now the cache belongs to one business: signing in to a different one clears
 * it first. Pure apart from the storage it is given.
 */
export const UI_TENANT_KEY = 'lumio_ui_tenant';
export const TENANT_UI_KEYS = ['lumio_industry', 'lumio_is_restaurant', 'lumio_pos_enabled', 'lumio_hidden_hrefs', 'lumio_tz', 'lumio_active_branch'];

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

/** True when the cache was another business's and has been cleared. */
export function claimTenantCache(store: Store | null | undefined, tenantId: string | null | undefined): boolean {
  if (!store || !tenantId) return false;
  try {
    const was = store.getItem(UI_TENANT_KEY);
    if (was === tenantId) return false;
    for (const k of TENANT_UI_KEYS) store.removeItem(k);
    store.setItem(UI_TENANT_KEY, tenantId);
    return true;
  } catch {
    return false;
  }
}
