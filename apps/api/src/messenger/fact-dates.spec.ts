import { factLiveOn, type BotFact } from './messenger.service';

/**
 * A dated fact — "20% off through Oct 25" — is told to customers only
 * between its dates and vanishes from the bot the day after, with nobody
 * having to remember to untick it.
 */
describe('a fact with dates', () => {
  const promo: BotFact = { label: 'Grand Opening Special', value: '20% off all services', on: true, from: '2026-09-29', until: '2026-10-25' };

  it('is live on the first day, the last day and every day between', () => {
    expect(factLiveOn(promo, '2026-09-29')).toBe(true);
    expect(factLiveOn(promo, '2026-10-10')).toBe(true);
    expect(factLiveOn(promo, '2026-10-25')).toBe(true);
  });

  it('is not live before it starts nor after it ends', () => {
    expect(factLiveOn(promo, '2026-09-28')).toBe(false);
    expect(factLiveOn(promo, '2026-10-26')).toBe(false);
    expect(factLiveOn(promo, '2027-01-01')).toBe(false);
  });

  it('with no dates is always live while ticked, and never when unticked', () => {
    expect(factLiveOn({ label: 'Parking', value: 'Free lot behind the shop', on: true }, '2030-01-01')).toBe(true);
    expect(factLiveOn({ ...promo, on: false }, '2026-10-10')).toBe(false);
  });

  it('ignores a malformed date rather than hiding the fact', () => {
    expect(factLiveOn({ ...promo, until: 'soon' }, '2027-01-01')).toBe(true);
    expect(factLiveOn({ ...promo, from: null, until: null }, '2020-01-01')).toBe(true);
  });
});
