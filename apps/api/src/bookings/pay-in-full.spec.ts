import { dueFromHold, holdAmount, keptOnLate } from './pay-in-full';
import { cancelMoney, HOUR_MS } from './deposit-policy';

describe('paying the whole visit instead of the deposit', () => {
  it('holds the whole price only when the salon allows it and the client asks', () => {
    expect(holdAmount({ depositCents: 300, priceCents: 1500, allow: true, asked: true })).toEqual({ cents: 1500, full: true });
    expect(holdAmount({ depositCents: 300, priceCents: 1500, allow: false, asked: true })).toEqual({ cents: 300, full: false });
    expect(holdAmount({ depositCents: 300, priceCents: 1500, allow: true, asked: false })).toEqual({ cents: 300, full: false });
    // No deposit rule, or a deposit already the whole price: nothing to choose.
    expect(holdAmount({ depositCents: 0, priceCents: 1500, allow: true, asked: true })).toEqual({ cents: 0, full: false });
    expect(holdAmount({ depositCents: 1500, priceCents: 1500, allow: true, asked: true })).toEqual({ cents: 1500, full: false });
  });

  it('charges what the held row was written for — never more than the price', () => {
    expect(dueFromHold({ depositCents: 300, priceCents: 1500, holdCents: 1500 })).toEqual({ base: 1500, kind: 'full' });
    expect(dueFromHold({ depositCents: 300, priceCents: 1500, holdCents: 300 })).toEqual({ base: 300, kind: 'deposit' });
    expect(dueFromHold({ depositCents: 300, priceCents: 1500, holdCents: null })).toEqual({ base: 300, kind: 'deposit' });
    expect(dueFromHold({ depositCents: 300, priceCents: 1500, holdCents: 99999 })).toEqual({ base: 300, kind: 'deposit' });
  });

  it('a late cancellation keeps the deposit part by default, everything when the salon says so', () => {
    const start = 10 * HOUR_MS, late = start - 2 * HOUR_MS;
    const plan = (rule?: 'deposit' | 'all') => cancelMoney({ startMs: start, nowMs: late, refundHours: 48, paidCents: 1529, depositCents: keptOnLate({ depositCents: 300, paidCents: 1529, priceCents: 1500, fullLateKeep: rule }) });
    expect(plan()).toEqual({ keepCents: 300, refundCents: 1229, reason: 'late' });
    expect(plan('deposit')).toEqual({ keepCents: 300, refundCents: 1229, reason: 'late' });
    expect(plan('all')).toEqual({ keepCents: 1529, refundCents: 0, reason: 'late' });
    // In time: everything back, whatever the rule.
    expect(cancelMoney({ startMs: start, nowMs: start - 72 * HOUR_MS, refundHours: 48, paidCents: 1529, depositCents: keptOnLate({ depositCents: 300, paidCents: 1529, priceCents: 1500, fullLateKeep: 'all' }) }))
      .toEqual({ keepCents: 0, refundCents: 1529, reason: 'early' });
    // Only the deposit was paid: the rule changes nothing.
    expect(keptOnLate({ depositCents: 300, paidCents: 306, priceCents: 1500, fullLateKeep: 'all' })).toBe(300);
  });
});
