import { nativeInboxUrl, windowNotice } from './inbox-view';

describe('rt236 — a closed conversation can still be answered by hand in Business Suite', () => {
  it('builds the link to this exact conversation, for this page only', () => {
    expect(nativeInboxUrl({ pageId: '1234567890', senderId: '9876543210', channel: 'messenger' }))
      .toBe('https://business.facebook.com/latest/inbox/messenger?asset_id=1234567890&mailbox_id=1234567890&selected_item_id=9876543210');
    expect(nativeInboxUrl({ pageId: '1234567890', senderId: '9876543210', channel: 'instagram' })).toContain('/inbox/instagram_direct?');
  });
  it('no link for Zalo / web, or without real ids', () => {
    expect(nativeInboxUrl({ pageId: '1234567890', senderId: '9876543210', channel: 'zalo' })).toBeNull();
    expect(nativeInboxUrl({ pageId: '', senderId: '9876543210' })).toBeNull();
    expect(nativeInboxUrl({ pageId: '12345678&x=1', senderId: '9876543210' })).toBeNull();
    expect(nativeInboxUrl(null)).toBeNull();
  });
  it('the closed-window words no longer say Business Suite cannot send', () => {
    const w = windowNotice({ kind: 'closed', hoursLeft: 0 } as never, true);
    expect(w?.banner).toContain('Business Suite');
    expect(w?.banner).not.toContain('cả Business Suite');
    expect(w?.blocked).toBe(true);
  });
});

import { closingInHours, queueCounts, queueRows } from './inbox-queues';
import type { InboxRow } from './inbox-view';

describe('rt236 — "Sắp hết hạn nhắn": message them before Meta closes the window', () => {
  const NOW = new Date('2026-11-25T04:00:00Z');
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
  const row = (id: string, last: string, over: Partial<InboxRow> = {}) => ({ id, lastCustomerAt: last, lastMessageAt: last, customerLast: false, state: 'human', ...over } as unknown as InboxRow);
  it('only the last 48 hours of the 7 days, soonest first', () => {
    expect(closingInHours({ lastCustomerAt: daysAgo(4) }, NOW)).toBeNull();
    expect(closingInHours({ lastCustomerAt: daysAgo(6) }, NOW)).toBe(24);
    expect(closingInHours({ lastCustomerAt: daysAgo(7.5) }, NOW)).toBeNull();
    expect(closingInHours({ lastCustomerAt: null }, NOW)).toBeNull();
    const rows = [row('a', daysAgo(5.5)), row('b', daysAgo(6.8)), row('c', daysAgo(2)), row('d', daysAgo(9))];
    expect(queueRows(rows, 'closing', null, NOW).map((r) => r.id)).toEqual(['b', 'a']);
    expect(queueCounts(rows, null, NOW).closing).toBe(2);
  });
});
