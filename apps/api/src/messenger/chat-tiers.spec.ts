import {
  CHAT_TIERS_BY_MARKET, tiersFor, ladderIsSound, inPlanRate, billFor, marginOf,
  cleanChatPlan, capsFor, apiCostPerReply, suggestTier, tierIdOf, money,
} from './chat-billing';

const MARKETS = Object.keys(CHAT_TIERS_BY_MARKET);

// A price list is the one file where a quiet arithmetic slip turns into a
// year of selling at a loss, or into a customer discovering that growing with
// us costs more than leaving. Both rules are checked on every market here, so
// a future edit to one table cannot pass while breaking the other.
describe('the ladder holds in every market', () => {
  it.each(MARKETS)('%s: overage clears cost, sits under the in-plan rate, and upgrades pay', (m) => {
    const tiers = tiersFor(m);
    expect(tiers.length).toBeGreaterThanOrEqual(3);
    expect(ladderIsSound(tiers, apiCostPerReply(tiers[0].currency))).toEqual([]);
  });

  it.each(MARKETS)('%s: every figure survives its own currency ceiling', (m) => {
    // The ceilings used to be dollar-shaped, which made every Vietnamese tier
    // unstorable. A tier the validator would trim is a tier that silently
    // bills a different number from the one on the price list.
    for (const t of tiersFor(m)) {
      expect(cleanChatPlan(t.plan, t.currency)).toEqual(t.plan);
    }
  });
});

describe('what the tables actually say', () => {
  it('prices the US ladder at 99 / 169 / 349 with falling overage', () => {
    expect(tiersFor('US').map((t) => [t.plan.monthlyCents, t.plan.includedReplies, t.plan.overageCentsPerReply]))
      .toEqual([[9900, 1000, 4], [16900, 3000, 3], [34900, 10000, 2]]);
  });

  it('prices the Vietnamese ladder in đồng, not in converted dollars', () => {
    expect(tiersFor('VN').map((t) => [t.plan.monthlyCents, t.plan.includedReplies, t.plan.overageCentsPerReply]))
      .toEqual([[390_000, 1000, 350], [890_000, 3000, 280], [2_690_000, 10000, 250]]);
    expect(tiersFor('VN').every((t) => t.currency === 'VND')).toBe(true);
  });

  it('leaves a real margin on every rung even at the pessimistic cost figure', () => {
    // The planning costs are rounded up on purpose, so these margins are the
    // FLOOR. If a rung cannot clear 20% here it cannot be sold at all.
    for (const m of MARKETS) {
      for (const t of tiersFor(m)) {
        expect(marginOf(t.plan.includedReplies, t.plan, t.currency)).toBeGreaterThan(0.2);
      }
    }
  });

  it('falls back to the US ladder for a market nobody has priced', () => {
    expect(tiersFor('AU')).toEqual(tiersFor('US'));
    expect(tiersFor(null)).toEqual(tiersFor('US'));
  });
});

// The account this ladder was rebuilt for: roughly a thousand replies a day.
describe('a shop sending about 1,000 replies a day', () => {
  const PER_MONTH = 30_000;

  it('costs $749 a month in the US, and the margin is still healthy', () => {
    const pro = tiersFor('US')[2].plan;
    const bill = billFor(PER_MONTH, pro, 'USD');
    expect(bill.totalCents).toBe(74_900);
    expect(marginOf(PER_MONTH, pro, 'USD')).toBeGreaterThan(0.55);
  });

  it('costs about 7.7 million đồng in Vietnam, on a deliberately thinner margin', () => {
    const pro = tiersFor('VN')[2].plan;
    const bill = billFor(PER_MONTH, pro, 'VND');
    expect(bill.totalCents).toBe(7_690_000);
    // Thinner than the US on purpose — but never thin enough to be a loss.
    const margin = marginOf(PER_MONTH, pro, 'VND');
    expect(margin).toBeGreaterThan(0.2);
    expect(margin).toBeLessThan(marginOf(PER_MONTH, tiersFor('US')[2].plan, 'USD'));
  });

  it('recommends the top tier rather than pretending a small one fits', () => {
    expect(suggestTier(PER_MONTH, 'VN').id).toBe('pro');
    expect(suggestTier(500, 'VN').id).toBe('basic');
  });
});

describe('the currency ceilings', () => {
  it('lets a Vietnamese plan be stored at all', () => {
    const p = { monthlyCents: 2_690_000, includedReplies: 10_000, overageCentsPerReply: 250, hardCap: false, active: true };
    expect(cleanChatPlan(p, 'VND').monthlyCents).toBe(2_690_000);
    // The old single ceiling would have cut this to 100,000₫ — about $4.
    expect(cleanChatPlan(p).monthlyCents).toBe(100_000);
  });

  it('still refuses a typo, in either currency', () => {
    expect(cleanChatPlan({ monthlyCents: 999_999_999, active: true }, 'VND').monthlyCents).toBe(capsFor('VND').monthly);
    expect(cleanChatPlan({ monthlyCents: 999_999_999, active: true }, 'USD').monthlyCents).toBe(capsFor('USD').monthly);
  });

  it('keeps the dollar ceilings for callers that never pass a currency', () => {
    expect(capsFor(undefined)).toEqual(capsFor('USD'));
    expect(capsFor('ZZZ')).toEqual(capsFor('USD'));
  });
});

describe('writing money down', () => {
  it('does not divide the đồng by a hundred', () => {
    // "$3,900.00" for a 390,000₫ plan is the bug this replaced.
    const out = money(390_000, 'VND');
    expect(out).toMatch(/390\.000/);
    expect(out).not.toMatch(/3\.900/);
  });

  it('still writes dollars the way it always did', () => {
    expect(money(9900, 'USD')).toBe('$99.00');
  });
});

describe('naming the tier a stored plan came from', () => {
  it('recognises a listed tier', () => {
    expect(tierIdOf(tiersFor('VN')[1].plan, 'VN')).toBe('standard');
  });

  it('says nothing for a hand-negotiated deal, instead of guessing the nearest', () => {
    expect(tierIdOf({ monthlyCents: 6_900_000, includedReplies: 30_000, overageCentsPerReply: 220, hardCap: false, active: true }, 'VN')).toBeNull();
  });
});

describe('in-plan rate', () => {
  it('is what the monthly fee works out to per reply', () => {
    expect(inPlanRate(tiersFor('US')[0].plan)).toBeCloseTo(9.9, 5);
  });

  it('is zero for a plan with no allowance, rather than dividing by zero', () => {
    expect(inPlanRate({ monthlyCents: 5000, includedReplies: 0, overageCentsPerReply: 3, hardCap: false, active: true })).toBe(0);
  });
});
