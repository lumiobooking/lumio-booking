import { cleanInbox, newArrivals, unseenCount, type Inbox, type InboxItem } from './booking-inbox';

const NOW = Date.parse('2026-10-28T15:00:00Z');
const it_ = (id: string, minsAgo: number): InboxItem => ({
  id, status: 'PENDING', customer: 'Anna', service: 'Gel', extra: 0, startTime: '2026-10-28T19:00:00Z', staff: null,
  priceCents: 4500, currency: 'USD', source: 'online', utmSource: null, attrReferrer: null, attrLandingUrl: null,
  at: new Date(NOW - minsAgo * 60_000).toISOString(),
});
const box = (p: Partial<Inbox>): Inbox => ({ needs: [], fresh: [], cancelled: [], ...p });

describe('booking inbox (header)', () => {
  it('the first load is the baseline — no toasts for what was already there', () => {
    expect(newArrivals(null, box({ needs: [it_('a', 1)] }), NOW)).toEqual([]);
  });

  it('a booking that just arrived pops up once, on its tab', () => {
    const prev = box({ needs: [it_('a', 30)] });
    const next = box({ needs: [it_('b', 1), it_('a', 30)], cancelled: [it_('c', 2)] });
    expect(newArrivals(prev, next, NOW).map((t) => t.key)).toEqual(['needs:b', 'cancelled:c']);
    expect(newArrivals(next, next, NOW)).toEqual([]);
  });

  it('confirmed by someone (moved from "to confirm" to "new") is not news; something old is not either', () => {
    const prev = box({ needs: [it_('a', 3)] });
    expect(newArrivals(prev, box({ fresh: [it_('a', 3)] }), NOW)).toEqual([]);
    expect(newArrivals(box({}), box({ fresh: [it_('z', 90)] }), NOW)).toEqual([]);
  });

  it('bell count: every booking still to confirm + the new / cancelled ones not seen yet', () => {
    const b = box({ needs: [it_('a', 200), it_('b', 1)], fresh: [it_('c', 5), it_('d', 120)], cancelled: [it_('e', 2)] });
    expect(unseenCount(b, NOW - 60 * 60_000)).toBe(2 + 1 + 1);
    expect(unseenCount(b, NOW)).toBe(2);
  });

  it('a bad answer from the server is an empty inbox, never a crash', () => {
    expect(cleanInbox(null)).toEqual({ needs: [], fresh: [], cancelled: [] });
    expect(cleanInbox({ needs: [null, { id: 'x' }], fresh: 'no' }).needs).toHaveLength(1);
  });
});
