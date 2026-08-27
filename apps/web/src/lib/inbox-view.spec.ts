import { channelOf, channelLabel, stateOf, stateLabel, sortRows, composerNotice, InboxRow } from './inbox-view';

const row = (over: Partial<InboxRow> = {}): InboxRow => ({
  id: 'r', updatedAt: '2026-08-27T12:00:00.000Z', ...over,
});

describe('which channel a message came from', () => {
  it.each([
    ['messenger', 'messenger'],
    ['instagram', 'instagram'],
    ['zalo', 'zalo'],
    ['INSTAGRAM', 'instagram'],
    [' Zalo ', 'zalo'],
  ])('%s → %s', (raw, expected) => {
    expect(channelOf(raw)).toBe(expected);
  });

  it.each([null, undefined, '', 'whatsapp', 'sms', 123])('reads %s as Messenger, the one every salon has', (raw) => {
    expect(channelOf(raw)).toBe('messenger');
  });

  it('gives each channel its own colour and wording', () => {
    const seen = new Set(['messenger', 'instagram', 'zalo'].map((c) => channelLabel(c).text));
    expect(seen.size).toBe(3);
  });

  // Windows ships no country-flag glyphs, and Chrome there draws a flag emoji
  // as its two raw regional-indicator letters — which is how a Super Admin
  // column once read "us US". Nothing here may depend on one.
  it('uses no flag emoji anywhere', () => {
    for (const c of ['messenger', 'instagram', 'zalo', 'nonsense']) {
      expect(channelLabel(c).text).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u);
    }
  });
});

describe('an older API build must not break the badge', () => {
  // The page can be newer than the server for a few minutes during a deploy.
  it('falls back to the handoff flag when state is missing', () => {
    expect(stateOf({ handoff: true })).toBe('human');
    expect(stateOf({ handoff: false })).toBe('bot');
    expect(stateOf(null)).toBe('bot');
  });

  it('prefers the server-derived state when it is there', () => {
    expect(stateOf({ state: 'unclaimed', handoff: false })).toBe('unclaimed');
  });
});

describe('the badge wording', () => {
  it('names the person holding it', () => {
    expect(stateLabel(row({ state: 'human', assignedName: 'Hà' }), true).text).toBe('Hà giữ');
    expect(stateLabel(row({ state: 'human', assignedName: 'Ha' }), false).text).toBe('Ha holding');
  });

  it('still says a human has it when we do not know who', () => {
    expect(stateLabel(row({ state: 'human' }), true).tone).toBe('held');
  });

  // The number that decides whether someone drops what they are doing. Without
  // it the state reads as ordinary, and three conversations sat unanswered
  // overnight behind exactly that.
  it('puts the waiting time on an unclaimed conversation', () => {
    expect(stateLabel(row({ state: 'unclaimed', waitingMinutes: 6 }), true).text).toContain('6');
  });

  it('says unclaimed even without a timer', () => {
    expect(stateLabel(row({ state: 'unclaimed' }), true).text).toBe('Chưa ai nhận');
  });

  it('gives the four states four different tones', () => {
    const tones = (['bot', 'unclaimed', 'human', 'done'] as const).map((s) => stateLabel(row({ state: s }), true).tone);
    expect(new Set(tones).size).toBe(4);
  });
});

describe('ordering — the ignored customer goes to the top', () => {
  // A plain newest-first list buries the person who has waited longest under
  // everyone who just said hello.
  it('puts waiting customers above everything else', () => {
    const out = sortRows([
      row({ id: 'bot-recent', state: 'bot', updatedAt: '2026-08-27T13:00:00.000Z' }),
      row({ id: 'waiting', state: 'unclaimed', waitingMinutes: 3, updatedAt: '2026-08-27T09:00:00.000Z' }),
    ]);
    expect(out[0].id).toBe('waiting');
  });

  it('puts the longest wait first within that group', () => {
    const out = sortRows([
      row({ id: 'short', state: 'unclaimed', waitingMinutes: 2 }),
      row({ id: 'long', state: 'unclaimed', waitingMinutes: 40 }),
      row({ id: 'mid', state: 'unclaimed', waitingMinutes: 12 }),
    ]);
    expect(out.map((r) => r.id)).toEqual(['long', 'mid', 'short']);
  });

  it('puts unread above read', () => {
    const out = sortRows([
      row({ id: 'read', state: 'bot', unread: false, updatedAt: '2026-08-27T13:00:00.000Z' }),
      row({ id: 'unread', state: 'bot', unread: true, updatedAt: '2026-08-27T10:00:00.000Z' }),
    ]);
    expect(out[0].id).toBe('unread');
  });

  it('sinks closed conversations to the bottom however recent', () => {
    const out = sortRows([
      row({ id: 'done', state: 'done', updatedAt: '2026-08-27T14:00:00.000Z' }),
      row({ id: 'open', state: 'bot', updatedAt: '2026-08-27T08:00:00.000Z' }),
    ]);
    expect(out[out.length - 1].id).toBe('done');
  });

  it('falls back to newest first inside a group', () => {
    const out = sortRows([
      row({ id: 'older', state: 'bot', updatedAt: '2026-08-27T08:00:00.000Z' }),
      row({ id: 'newer', state: 'bot', updatedAt: '2026-08-27T11:00:00.000Z' }),
    ]);
    expect(out[0].id).toBe('newer');
  });

  it('does not mutate what it was given', () => {
    const input = [row({ id: 'a', state: 'bot' }), row({ id: 'b', state: 'unclaimed' })];
    const copy = [...input];
    sortRows(input);
    expect(input).toEqual(copy);
  });
});

describe('the 24-hour window, said before they type', () => {
  // Telling someone AFTER they have written a long answer is how a reply is
  // lost and the customer hears nothing at all.
  it('blocks and explains once the window has shut', () => {
    const n = composerNotice({ open: false, minutesLeft: 0 }, true);
    expect(n.blocked).toBe(true);
    expect(n.text).toContain('24 giờ');
  });

  it('tells them what to do instead, not just that it failed', () => {
    expect(composerNotice({ open: false, minutesLeft: 0 }, true).text).toMatch(/Gọi|SMS/);
    expect(composerNotice({ open: false, minutesLeft: 0 }, false).text).toMatch(/Call|text/);
  });

  it('warns while there is still time to act', () => {
    const n = composerNotice({ open: true, minutesLeft: 45 }, true);
    expect(n.blocked).toBe(false);
    expect(n.text).toContain('45');
  });

  it('writes a long remainder in hours', () => {
    expect(composerNotice({ open: true, minutesLeft: 90 }, true).text).toContain('1h');
  });

  it('stays quiet when there is plenty of time', () => {
    expect(composerNotice({ open: true, minutesLeft: 600 }, true).text).toBeNull();
  });

  it('says nothing rather than guessing when the window is unknown', () => {
    expect(composerNotice(null, true)).toEqual({ blocked: false, text: null });
    expect(composerNotice(undefined, false).blocked).toBe(false);
  });
});
