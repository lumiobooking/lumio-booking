import { planFeatureDefaults, planTierOf, resolvePolicy } from './feature-policy.constants';

describe('rt256 each plan opens what it sells', () => {
  it('reads the tier from the plan name', () => {
    expect(planTierOf('Starter')).toBe('starter');
    expect(planTierOf('Pro')).toBe('pro');
    expect(planTierOf('Premium')).toBe('premium');
    expect(planTierOf(null)).toBeNull();
  });

  it('Starter opens nothing extra; Pro opens the inbox, bot, marketing, reviews, payroll; Premium adds Hotline + chain', () => {
    const starter = resolvePolicy({}, () => true, planFeatureDefaults('Starter'));
    expect(starter.inbox).toBe('platform');
    expect(starter.messengerAi).toBe('platform');
    const pro = resolvePolicy({}, () => true, planFeatureDefaults('Pro'));
    for (const k of ['inbox', 'messengerAi', 'aiBrain', 'marketing', 'marketingReport', 'reviews', 'googleReviews', 'payroll']) expect(pro[k]).toBe('salon');
    expect(pro.voiceAi).toBe('platform');
    expect(pro.chain).toBe('platform');
    expect(pro.channels).toBe('platform'); // Lumio sets up the connections
    const premium = resolvePolicy({}, () => true, planFeatureDefaults('Premium'));
    expect(premium.voiceAi).toBe('salon');
    expect(premium.chain).toBe('salon');
  });

  it('a live Hotline line opens the Hotline screen on any plan', () => {
    expect(resolvePolicy({}, () => true, planFeatureDefaults('Starter', { hotlineLive: true })).voiceAi).toBe('salon');
  });

  it('a switch set by hand wins over the plan, and the market veto wins over both', () => {
    const p = resolvePolicy({ inbox: 'platform' }, (k) => k !== 'voiceAi', planFeatureDefaults('Premium'));
    expect(p.inbox).toBe('platform');
    expect(p.voiceAi).toBe('platform');
  });
});
