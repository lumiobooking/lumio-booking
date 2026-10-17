import { discountRules, promoKnowledge, shortDay } from './promo-knowledge';

const cats = (id: string) => ({ c1: 'Pedicure' } as Record<string, string>)[id];
const TODAY = '2026-10-17';

describe('what the chat bot may say about discounts', () => {
  it('lists the Halloween sale for an online chat, with its dates', () => {
    const lines = promoKnowledge({ dates: { enabled: true, rules: [{ startDate: '2026-10-10', endDate: '2026-10-31', categoryId: null, percent: 10, label: 'Halloween Glam & Treats', appliesTo: 'online' }] } }, { today: TODAY, categoryName: cats });
    expect(lines).toEqual(['- Halloween Glam & Treats: 10% off all services, Oct 10–Oct 31 (running today)']);
  });

  it('leaves out what is not for this channel, what is over, and what is far away', () => {
    const lines = promoKnowledge({
      dates: { enabled: true, rules: [
        { startDate: '2026-10-10', endDate: '2026-10-31', categoryId: null, percent: 20, label: 'Walk-in week', appliesTo: 'walkin' },
        { startDate: '2026-09-01', endDate: '2026-09-30', categoryId: null, percent: 30, label: 'September' },
        { startDate: '2027-03-01', endDate: null, categoryId: null, percent: 25, label: 'Spring' },
      ] },
      weekday: { enabled: true, appliesTo: 'walkin', rules: [{ day: 2, categoryId: null, percent: 15 }] },
      firstVisit: { enabled: false, percent: 10 },
    }, { today: TODAY, categoryName: cats });
    expect(lines).toEqual([]);
  });

  it('describes weekday, first-visit and group programmes in plain words', () => {
    const lines = promoKnowledge({
      weekday: { enabled: true, rules: [{ day: 2, categoryId: 'c1', percent: 15 }], endDate: '2026-11-30' },
      firstVisit: { enabled: true, rules: [{ visit: 1, percent: 10 }, { visit: 5, percent: 15 }] },
      group: { enabled: true, tiers: [{ minSize: 3, percent: 15 }, { minSize: 2, percent: 10 }] },
    }, { today: TODAY, categoryName: cats });
    expect(lines).toEqual([
      '- Every Tuesday: 15% off Pedicure services (for visits on that day) (until Nov 30)',
      '- First visit: 10% off for a brand-new customer (checked automatically from the phone number when you book)',
      '- 5th visit: 15% off as a thank-you (checked automatically from the phone number)',
      '- Groups of 2 or more booked together: 10% off for each person',
      '- Groups of 3 or more booked together: 15% off for each person',
    ]);
  });

  it('makes the system promotions the only quotable discounts when there are any', () => {
    const block = discountRules(['- Halloween: 10% off all services'], []).join('\n');
    expect(block).toMatch(/SALON PROMOTIONS/);
    expect(block).toMatch(/ONLY discounts you may quote/);
    expect(block).toMatch(/out of date: do NOT quote it/);
  });

  it('keeps the old behaviour when the salon has set nothing', () => {
    expect(discountRules([], []).join('\n')).toMatch(/only mention an offer if the salon's own notes above state one/);
  });

  it('formats days for the prompt', () => {
    expect(shortDay('2026-10-31')).toBe('Oct 31');
  });
});

/** Tenant isolation: the block is built only from the settings handed in — one salon's promotions never appear in another's. */
describe('one salon\'s promotions only', () => {
  it('two salons, two answers', () => {
    const a = promoKnowledge({ group: { enabled: true, tiers: [{ minSize: 2, percent: 10 }] } }, { today: TODAY, categoryName: cats });
    const b = promoKnowledge({}, { today: TODAY, categoryName: cats });
    expect(a).toHaveLength(1);
    expect(b).toEqual([]);
  });
});
