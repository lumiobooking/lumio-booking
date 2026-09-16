import {
  API_COST_CENTS_PER_REPLY, billFor, CHAT_TIERS, cleanChatPlan, dailyLines, DEFAULT_CHAT_PLAN,
  marginOf, mayReply, money, suggestTier, type ChatPlan,
} from './chat-billing';

const standard = CHAT_TIERS.find((t) => t.id === 'standard')!.plan;

describe('nothing is billed until somebody turns it on', () => {
  it('charges a salon with no plan nothing at all', () => {
    expect(billFor(5_000, DEFAULT_CHAT_PLAN)).toMatchObject({ totalCents: 0, overageCents: 0 });
    expect(cleanChatPlan({}).active).toBe(false);
    expect(cleanChatPlan({ active: 'yes', monthlyCents: 19900 }).active).toBe(false);
  });

  it('reads junk as no plan rather than as some other price', () => {
    expect(cleanChatPlan('nonsense')).toEqual(DEFAULT_CHAT_PLAN);
    expect(cleanChatPlan({ monthlyCents: 'lots' }).monthlyCents).toBe(0);
  });

  it('refuses to store a price a typo could produce', () => {
    // $19,900 instead of $199 — clamped to the $1,000/month ceiling, which is
    // above the top tier ($999) and far below a bill anybody would pay by mistake
    expect(cleanChatPlan({ monthlyCents: 1_990_000 }).monthlyCents).toBe(1_000_00);
    expect(cleanChatPlan({ monthlyCents: 39900 }).monthlyCents).toBe(39900);
    expect(cleanChatPlan({ overageCentsPerReply: 5000 }).overageCentsPerReply).toBe(100);
    expect(cleanChatPlan({ monthlyCents: -500 }).monthlyCents).toBe(0);
  });
});

describe('a normal month on the Standard plan', () => {
  it('inside the allowance costs the monthly fee and nothing more', () => {
    const b = billFor(1_840, standard);
    expect(b).toMatchObject({ overageReplies: 0, overageCents: 0, totalCents: 19900 });
    expect(Math.round(b.used * 100)).toBe(61);
    expect(money(b.totalCents)).toBe('$199.00');
  });

  it('past the allowance charges only the replies past it', () => {
    const b = billFor(3_500, standard);
    expect(b.overageReplies).toBe(500);
    expect(b.overageCents).toBe(500 * 4);
    expect(money(b.totalCents)).toBe('$219.00');
  });

  it('a quiet month still costs the monthly fee — that is what a bundle is', () => {
    expect(billFor(0, standard).totalCents).toBe(19900);
  });
});

describe('the hard cap, for a salon that must never be surprised', () => {
  const capped: ChatPlan = { ...standard, hardCap: true };

  it('bills no overage and stops the bot once the allowance is gone', () => {
    const b = billFor(3_500, capped);
    expect(b.overageCents).toBe(0);
    expect(b.totalCents).toBe(19900);
    expect(b.stopped).toBe(true);
    expect(mayReply(3_500, capped)).toBe(false);
  });

  it('keeps answering right up to the last included reply', () => {
    expect(mayReply(2_999, capped)).toBe(true);
    expect(mayReply(3_000, capped)).toBe(false);
  });

  it('never stops a salon that did NOT ask to be capped — silence costs more than overage', () => {
    expect(mayReply(30_000, standard)).toBe(true);
    expect(billFor(30_000, standard).stopped).toBe(false);
  });
});

describe('the day-by-day line the salon reads', () => {
  const small: ChatPlan = { monthlyCents: 9900, includedReplies: 100, overageCentsPerReply: 5, hardCap: false, active: true };

  it('splits the day the allowance ran out instead of charging the whole day', () => {
    const rows = dailyLines({ '2026-09-01': 60, '2026-09-02': 60, '2026-09-03': 40 }, small);
    expect(rows.map((r) => r.overageReplies)).toEqual([0, 20, 40]);
    expect(rows[1].overageCents).toBe(100);
    expect(rows.reduce((a, r) => a + r.overageCents, 0)).toBe(billFor(160, small).overageCents);
  });

  it('reads days in order and ignores keys that are not days', () => {
    const rows = dailyLines({ '2026-09-03': 5, 'total': 999, '2026-09-01': 5 } as Record<string, number>, small);
    expect(rows.map((r) => r.day)).toEqual(['2026-09-01', '2026-09-03']);
  });

  it('shows no money at all on a plan nobody turned on', () => {
    const rows = dailyLines({ '2026-09-01': 500 }, DEFAULT_CHAT_PLAN);
    expect(rows[0]).toMatchObject({ replies: 500, overageCents: 0 });
  });
});

describe('the prices are actually worth charging', () => {
  it.each(CHAT_TIERS)('$id keeps a healthy margin at its own ceiling', (tier) => {
    const m = marginOf(tier.plan.includedReplies, tier.plan);
    expect(m).toBeGreaterThan(0.6);
  });

  it('every overage price stays above what the reply costs us', () => {
    for (const t of CHAT_TIERS) expect(t.plan.overageCentsPerReply).toBeGreaterThan(API_COST_CENTS_PER_REPLY);
  });

  it('still makes money on a heavy month that blows through the top tier', () => {
    // the five-page client: ~30,000 replies a month
    const b = billFor(30_000, CHAT_TIERS[2].plan);
    expect(money(b.totalCents)).toBe('$999.00');
    expect(marginOf(30_000, CHAT_TIERS[2].plan)).toBeGreaterThan(0.6);
  });

  it('recommends the cheapest tier that fits, and the top one when nothing does', () => {
    expect(suggestTier(400).id).toBe('basic');
    expect(suggestTier(2_500).id).toBe('standard');
    expect(suggestTier(9_000).id).toBe('pro');
    expect(suggestTier(50_000).id).toBe('pro');
  });
});

describe('money never drifts', () => {
  it('is integer cents end to end', () => {
    const b = billFor(3_333, standard);
    expect(Number.isInteger(b.totalCents)).toBe(true);
    expect(Number.isInteger(b.overageCents)).toBe(true);
    expect(money(19900)).toBe('$199.00');
    expect(money(0)).toBe('$0.00');
    expect(money(5)).toBe('$0.05');
  });

  it('a fractional reply count cannot create a fractional cent', () => {
    expect(billFor(3_000.7 as number, standard).replies).toBe(3_001);
    expect(Number.isInteger(billFor(3_000.7 as number, standard).overageCents)).toBe(true);
  });
});
