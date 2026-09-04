import { presetFor } from '../common/markets';

/**
 * One fact, two fields — and until now only one of them moved.
 *
 * `tenant.market` decides SMS routing, feature availability and money.
 * `company_extra.country` decides the dial code, address parsing, and — until
 * this release — which market-specific panels the settings screen showed. They
 * were written together when a salon was created and never again, so moving a
 * salon between markets in Super Admin produced a shop that was half in each:
 * its messages went out through the Vietnamese carrier while the screen that
 * configures that carrier stayed hidden, and nothing on any screen said why.
 *
 * These tests pin the rule the update now follows: the country goes where the
 * market goes, and the MONEY does not — prices already quoted to real
 * customers must not change meaning because someone corrected a label.
 */
describe('the country a market implies', () => {
  it('gives every market a country to move to', () => {
    expect(presetFor('VN').companyExtra.country).toBe('VN');
    expect(presetFor('US').companyExtra.country).toBe('US');
    expect(presetFor('CA').companyExtra.country).toBe('CA');
  });

  it('sends anything unrecognised to the market every existing salon is in', () => {
    // The safe direction: an unknown code must not strand a live salon in a
    // market whose carrier cannot reach its customers.
    for (const bad of [null, undefined, '', 'ZZ', 'Vietnam']) {
      expect(presetFor(bad as string).market).toBe('US');
      expect(presetFor(bad as string).companyExtra.country).toBe('US');
    }
  });

  it('carries the money rules that make a market readable', () => {
    // Not applied on a market MOVE — see the note above — but this is the
    // table a new Vietnamese salon is created from, and a ₫ shown with two
    // decimals quoted a 250.000₫ set as 2.500₫ once already.
    const vn = presetFor('VN');
    expect(vn.bookingRules.currency).toBe('VND');
    expect(vn.bookingRules.priceDecimals).toBe(0);
    expect(vn.bookingRules.symbolPosition).toBe('after');
    expect(vn.posSettings.tipsEnabled).toBe(false);
    expect(vn.lang).toBe('vi');

    const us = presetFor('US');
    expect(us.bookingRules.currency).toBe('USD');
    expect(us.bookingRules.priceDecimals).toBe(2);
    expect(us.posSettings.tipsEnabled).toBe(true);
  });

  it('puts a Vietnamese salon on Vietnamese time', () => {
    expect(presetFor('VN').tenant.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(presetFor('US').tenant.timezone).not.toBe('Asia/Ho_Chi_Minh');
  });
});
