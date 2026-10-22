import { allocateRefund, cancelMoney, refundable, refundDeadline } from './deposit-policy';

const H = 3_600_000;
const start = Date.UTC(2026, 9, 25, 15, 0);

describe('what a cancellation does to the money', () => {
  it('early enough: everything goes back', () => {
    expect(cancelMoney({ startMs: start, nowMs: start - 30 * H, refundHours: 24, paidCents: 2000, depositCents: 2000 }))
      .toEqual({ keepCents: 0, refundCents: 2000, reason: 'early' });
  });
  it('exactly at the line still counts as on time', () => {
    expect(refundable(start, start - 24 * H, 24)).toBe(true);
    expect(refundable(start, start - 24 * H + 1, 24)).toBe(false);
  });
  it('too late: the salon keeps the deposit', () => {
    expect(cancelMoney({ startMs: start, nowMs: start - 2 * H, refundHours: 24, paidCents: 2000, depositCents: 2000 }))
      .toEqual({ keepCents: 2000, refundCents: 0, reason: 'late' });
  });
  it('prepaid in full and late: only the deposit is kept, the rest goes back', () => {
    expect(cancelMoney({ startMs: start, nowMs: start - H, refundHours: 24, paidCents: 6000, depositCents: 1800 }))
      .toEqual({ keepCents: 1800, refundCents: 4200, reason: 'late' });
  });
  it('no deposit rule: a late cancellation of a prepaid visit is refunded', () => {
    expect(cancelMoney({ startMs: start, nowMs: start - H, refundHours: 24, paidCents: 6000, depositCents: 0 }))
      .toEqual({ keepCents: 0, refundCents: 6000, reason: 'late' });
  });
  it('staff decide for one booking, either way', () => {
    expect(cancelMoney({ startMs: start, nowMs: start - H, refundHours: 24, paidCents: 2000, depositCents: 2000, override: 'refund' }).refundCents).toBe(2000);
    expect(cancelMoney({ startMs: start, nowMs: start - 99 * H, refundHours: 24, paidCents: 2000, depositCents: 2000, override: 'keep' }).keepCents).toBe(2000);
  });
  it('nothing paid, nothing to do', () => {
    expect(cancelMoney({ startMs: start, nowMs: start, refundHours: 24, paidCents: 0, depositCents: 2000 }).reason).toBe('nothing');
  });
  it('0 hours means "any time before the start"', () => {
    expect(refundable(start, start - 1, 0)).toBe(true);
    expect(refundDeadline(start, 0)).toBe(start);
  });
});

describe('spreading a refund over the payments taken', () => {
  it('largest first, splitting the last one', () => {
    expect(allocateRefund([{ id: 'a', amountCents: 1000 }, { id: 'b', amountCents: 3000 }], 3500))
      .toEqual([{ id: 'b', refundCents: 3000, whole: true }, { id: 'a', refundCents: 500, whole: false }]);
  });
  it('never more than was paid', () => {
    expect(allocateRefund([{ id: 'a', amountCents: 1000 }], 5000)).toEqual([{ id: 'a', refundCents: 1000, whole: true }]);
  });
});
