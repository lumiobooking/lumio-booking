import { cleanPlatformRates, projectOverage, resolveRate, usageLine } from './usage-rates';

describe('the bug: a salon with SMS but no AI Hotline had no price at all', () => {
  it('falls back to the platform default instead of reading as zero', () => {
    // VoiceLine does not exist for this salon, so the tenant rate is missing
    const r = resolveRate(null, 2);
    expect(r).toEqual({ centsPerUnit: 2, source: 'platform', billable: true });
  });

  it('never calls an unpriced unit "free" — that promise is what loses the dispute', () => {
    const r = resolveRate(null, null);
    expect(r.source).toBe('unset');
    expect(r.billable).toBe(false);
    const line = usageLine('sms', 350, 100, r);
    expect(line.over).toBe(250);
    expect(line.overageCents).toBe(0);
    expect(line.wording).toBe('unset');     // the screen says "not priced yet"
    expect(line.wording).not.toBe('free');
  });

  it('keeps a deliberate zero as a real decision, not as a missing price', () => {
    const r = resolveRate(0, 5);
    expect(r).toEqual({ centsPerUnit: 0, source: 'free', billable: false });
    expect(usageLine('sms', 350, 100, r).wording).toBe('free');
  });

  it("lets the salon's own agreed price beat the platform default", () => {
    expect(resolveRate(3, 2)).toEqual({ centsPerUnit: 3, source: 'tenant', billable: true });
  });
});

describe('one line on the invoice', () => {
  const rate = resolveRate(null, 2);

  it('charges only what went over the allowance', () => {
    const l = usageLine('sms', 137, 100, rate);
    expect(l).toMatchObject({ used: 137, included: 100, over: 37, overageCents: 74, wording: 'priced' });
  });

  it('charges nothing inside the allowance', () => {
    expect(usageLine('sms', 42, 100, rate)).toMatchObject({ over: 0, overageCents: 0 });
  });

  it('treats no allowance as unlimited rather than as "everything is overage"', () => {
    const l = usageLine('minutes', 900, 0, rate);
    expect(l).toMatchObject({ over: 0, overageCents: 0, wording: 'unlimited' });
  });

  it('cannot produce a fractional cent from a fractional count', () => {
    const l = usageLine('chat', 137.6 as number, 100, rate);
    expect(Number.isInteger(l.overageCents)).toBe(true);
    expect(l.used).toBe(138);
  });
});

describe('platform defaults read from config strings', () => {
  it('reads what is set and leaves what is not', () => {
    expect(cleanPlatformRates({ sms_overage_cents: '2', chat_overage_cents_per_reply: '4' }))
      .toEqual({ smsCents: 2, minuteCents: null, chatReplyCents: 4 });
  });
  it('reads junk and empty strings as "never said", not as zero', () => {
    const r = cleanPlatformRates({ sms_overage_cents: '', hotline_overage_cents_per_min: 'free' });
    expect(r.smsCents).toBeNull();
    expect(r.minuteCents).toBeNull();
    expect(resolveRate(null, r.smsCents).source).toBe('unset');
  });
});

describe('the month-end projection', () => {
  it('scales what has been used so far across the whole month', () => {
    expect(projectOverage(300, 10, 30)).toBe(900);
  });
  it('does not shrink below what has already been charged', () => {
    expect(projectOverage(300, 30, 30)).toBe(300);
    expect(projectOverage(300, 31, 30)).toBe(300);
  });
  it('survives day zero without dividing by it', () => {
    expect(projectOverage(300, 0, 30)).toBe(9000);
    expect(Number.isFinite(projectOverage(300, 0, 0))).toBe(true);
  });
});
