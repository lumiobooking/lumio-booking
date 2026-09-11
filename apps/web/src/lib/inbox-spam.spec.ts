/**
 * SPAM IS THE ONE FILTER THAT WORKS BACKWARDS.
 *
 * 'waiting', 'unread' and 'mine' each narrow the same list. Spam is a pile
 * every OTHER view has to leave out — if it only added a view of its own,
 * marking something as junk would change nothing about the screen it was
 * cluttering, which is the entire point of marking it.
 *
 * Every count on the screen has to agree with that, or the inbox says "3
 * waiting" over a list showing two.
 */
import { filterRows, spamCount, isSpamRow, waitingCount, followUpCount, channelCounts, type InboxRow } from './inbox-view';

const row = (o: Partial<InboxRow>): InboxRow => ({ id: Math.random().toString(36), channel: 'messenger', ...o } as InboxRow);

const junk = row({ id: 'junk', status: 'spam', senderName: 'Scam Bot', state: 'unclaimed', unread: true, channel: 'messenger' });
const live = row({ id: 'live', senderName: 'Anna', state: 'unclaimed', unread: true, channel: 'messenger' });
const done = row({ id: 'done', status: 'done', senderName: 'Bo', state: 'done', channel: 'instagram' });

describe('spam leaves every other view', () => {
  const rows = [junk, live, done];

  it('is gone from All', () => {
    expect(filterRows(rows, { filter: 'all' }).map((r) => r.id)).toEqual(['live', 'done']);
  });

  it('is gone from Waiting, even though it IS unclaimed', () => {
    expect(filterRows(rows, { filter: 'waiting' }).map((r) => r.id)).toEqual(['live']);
  });

  it('is gone from Unread, even though it IS unread', () => {
    expect(filterRows(rows, { filter: 'unread' }).map((r) => r.id)).toEqual(['live']);
  });

  it('is gone from a search that matches its name', () => {
    expect(filterRows(rows, { filter: 'all', query: 'scam' })).toEqual([]);
  });

  it('is gone from a channel filter it belongs to', () => {
    expect(filterRows(rows, { filter: 'all', channel: 'messenger' }).map((r) => r.id)).toEqual(['live']);
  });
});

describe('and it is the ONLY thing in its own view', () => {
  it('Spam shows spam', () => {
    expect(filterRows([junk, live, done], { filter: 'spam' }).map((r) => r.id)).toEqual(['junk']);
  });

  it('Spam shows nothing else, including closed conversations', () => {
    expect(filterRows([live, done], { filter: 'spam' })).toEqual([]);
  });
});

describe('the numbers on the screen agree with the list', () => {
  const rows = [junk, live, done];

  it('waiting does not count junk', () => {
    expect(waitingCount(rows)).toBe(1);
  });

  it('follow-up does not count junk', () => {
    const overdue = row({ id: 'j2', status: 'spam', followUpAt: '2020-01-01T00:00:00.000Z' });
    expect(followUpCount([overdue])).toBe(0);
  });

  it('the channel chips do not count junk', () => {
    const m = channelCounts(rows).find((c) => c.key === 'messenger');
    expect(m?.total).toBe(1);
    expect(m?.waiting).toBe(1);
  });

  it('spamCount counts exactly the bin', () => {
    expect(spamCount(rows)).toBe(1);
    expect(spamCount([live, done])).toBe(0);
  });
});

describe('what counts as spam', () => {
  it('only the literal status', () => {
    expect(isSpamRow(row({ status: 'spam' }))).toBe(true);
    expect(isSpamRow(row({ status: 'open' }))).toBe(false);
    expect(isSpamRow(row({ status: 'done' }))).toBe(false);
    expect(isSpamRow(row({}))).toBe(false);
    expect(isSpamRow(null)).toBe(false);
  });

  // Rows written before the column had a value, and rows from an older API
  // that does not send `status` at all, are ordinary conversations. Guessing
  // otherwise would silently empty somebody's inbox on deploy day.
  it('a missing status is never junk', () => {
    expect(filterRows([row({ id: 'a' }), row({ id: 'b', status: null })], { filter: 'all' }).map((r) => r.id))
      .toEqual(['a', 'b']);
  });
});
