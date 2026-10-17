import { promoLine } from '../content/auto-comments';
import { appliesOn, channelOf, channelOfSource, channelSuffix, cleanChannel, dateRulesFor, programFor } from './promo-channel';

describe('where a promotion applies', () => {
  it('reads a promotion saved before channels existed as the whole salon', () => {
    expect(channelOf({})).toBe('all');
    expect(channelOf(null)).toBe('all');
    expect(channelOf({ appliesTo: 'bogus' })).toBe('all');
    expect(cleanChannel('online')).toBe('online');
    expect(cleanChannel(undefined, 'walkin')).toBe('walkin');
  });

  it('the whole salon covers online, the desk and walk-ins; the others only their own', () => {
    for (const where of ['online', 'desk', 'walkin'] as const) expect(appliesOn({ appliesTo: 'all' }, where)).toBe(true);
    expect(appliesOn({ appliesTo: 'online' }, 'online')).toBe(true);
    expect(appliesOn({ appliesTo: 'online' }, 'walkin')).toBe(false);
    expect(appliesOn({ appliesTo: 'online' }, 'desk')).toBe(false);
    expect(appliesOn({ appliesTo: 'walkin' }, 'walkin')).toBe(true);
    expect(appliesOn({ appliesTo: 'walkin' }, 'online')).toBe(false);
    expect(appliesOn({ appliesTo: 'walkin' }, 'desk')).toBe(false);
  });

  it('tells a self-booked customer from the desk and from a walk-in', () => {
    for (const s of ['hosted', 'plugin', 'messenger', 'hotline', 'voice', 'online', 'web', 'mobile', 'public', 'instagram']) expect(channelOfSource(s)).toBe('online');
    for (const s of ['admin', 'pos', 'staff', '', null, undefined]) expect(channelOfSource(s)).toBe('desk');
    expect(channelOfSource('walkin')).toBe('walkin');
  });

  it('switches a programme off where it does not apply, and leaves it alone where it does', () => {
    const wd = { enabled: true, appliesTo: 'online', rules: [{ day: 2, percent: 10 }] };
    expect(programFor(wd, 'walkin')?.enabled).toBe(false);
    expect(programFor(wd, 'online')).toBe(wd);
    expect(programFor(null, 'online')).toBeNull();
  });

  it('keeps only the date rules meant for this channel', () => {
    const d = { enabled: true, rules: [
      { startDate: '2026-10-10', label: 'Halloween', appliesTo: 'online' },
      { startDate: '2026-10-20', label: 'Walk-in week', appliesTo: 'walkin' },
      { startDate: '2026-10-25', label: 'Old sale' },
    ] };
    expect(dateRulesFor(d, 'online')?.rules?.map((r) => r.label)).toEqual(['Halloween', 'Old sale']);
    expect(dateRulesFor(d, 'walkin')?.rules?.map((r) => r.label)).toEqual(['Walk-in week', 'Old sale']);
    expect(dateRulesFor(d, 'desk')?.rules?.map((r) => r.label)).toEqual(['Old sale']);
  });

  it('says who a promotion is for in a post', () => {
    expect(channelSuffix({ appliesTo: 'online' }, true)).toBe(' khi đặt lịch online');
    expect(channelSuffix({ appliesTo: 'walkin' }, false)).toBe(' for walk-ins');
    expect(channelSuffix({}, true)).toBe('');
  });
});

/** Tenant isolation: the channel helpers are pure and carry nothing from one salon to the next. */
describe('promotion channels are per salon', () => {
  it('two salons with opposite settings each get their own answer', () => {
    const salonA = { enabled: true, appliesTo: 'online' };
    const salonB = { enabled: true, appliesTo: 'walkin' };
    expect(programFor(salonA, 'walkin')?.enabled).toBe(false);
    expect(programFor(salonB, 'walkin')?.enabled).toBe(true);
    expect(salonA.enabled).toBe(true); // never mutated
  });
});

describe('a post names who the promotion is for', () => {
  const base = { today: '2026-10-17', weekday: 6 };
  it('online-only and walk-in-only sales say so; the whole salon says nothing extra', () => {
    expect(promoLine({ ...base, dates: { enabled: true, rules: [{ startDate: '2026-10-10', endDate: '2026-10-31', percent: 10, label: 'Halloween', appliesTo: 'online' }] } }, true))
      .toBe('Giảm 10% khi đặt lịch online · Halloween đến 31/10');
    expect(promoLine({ ...base, weekdays: { enabled: true, appliesTo: 'walkin', rules: [{ day: 6, percent: 15 }] } }, false)).toBe('15% off today for walk-ins');
    expect(promoLine({ ...base, firstVisit: { enabled: true, percent: 10 } }, false)).toBe('10% off your first visit');
  });
});
