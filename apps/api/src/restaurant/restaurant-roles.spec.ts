import 'reflect-metadata';
import { CAPS_KEY } from '../auth/decorators/caps.decorator';
import { capabilitiesFor, hasCapability, ROLE_PRESETS } from '../auth/capabilities';
import { CAP_CATALOG } from '../support/support-scope';
import { RestaurantController } from './restaurant.controller';

/**
 * Restaurant staff roles. A server (WAITER) works the table till; the kitchen
 * tablet (KITCHEN) sees the kitchen screen and marks dishes sold out — and
 * nothing that shows tables' bills, money or another screen of the salon.
 */
describe('restaurant roles', () => {
  const capsOf = (method: keyof RestaurantController): string[] | undefined =>
    Reflect.getMetadata(CAPS_KEY, RestaurantController.prototype[method] as object)
    ?? Reflect.getMetadata(CAPS_KEY, RestaurantController);

  it('gives a server the till and the kitchen only its screen', () => {
    expect(ROLE_PRESETS.WAITER).toEqual(['pos']);
    expect(ROLE_PRESETS.KITCHEN).toEqual(['kitchen']);
    expect(capabilitiesFor('STAFF' as never, 'KITCHEN' as never)).toEqual(['kitchen']);
    expect(hasCapability('STAFF' as never, 'KITCHEN' as never, 'pos')).toBe(false);
    expect(hasCapability('STAFF' as never, 'WAITER' as never, 'pos.discount')).toBe(false);
    expect(hasCapability('STAFF' as never, 'WAITER' as never, 'pos.void')).toBe(false);
    // An owner's own pick still wins over the preset.
    expect(capabilitiesFor('STAFF' as never, 'WAITER' as never, ['pos', 'pos.discount'])).toEqual(['pos', 'pos.discount']);
    expect(capabilitiesFor('SALON_ADMIN' as never)).toContain('kitchen');
  });

  it('opens exactly the kitchen routes to the kitchen capability', () => {
    const kitchenRoutes = (Object.getOwnPropertyNames(RestaurantController.prototype) as (keyof RestaurantController)[])
      .filter((m) => m !== ('constructor' as never) && (capsOf(m) ?? []).includes('kitchen'))
      .sort();
    expect(kitchenRoutes).toEqual(['kitchen', 'menu', 'ready', 'soldOut']);
    // Everything else on the table till still needs `pos`.
    for (const m of ['open', 'addLine', 'send', 'pay', 'floor', 'getCheck' in RestaurantController.prototype ? 'getCheck' : 'get', 'acceptQr', 'qrCodes'] as (keyof RestaurantController)[]) {
      if (!(m in RestaurantController.prototype)) continue;
      expect(capsOf(m)).toEqual(['pos']);
    }
  });

  it('names the kitchen capability for the support screen, as not private', () => {
    const k = CAP_CATALOG.find((c) => c.id === 'kitchen');
    expect(k?.private).toBe(false);
  });
});
