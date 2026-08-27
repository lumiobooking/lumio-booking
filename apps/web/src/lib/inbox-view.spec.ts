import { channelOf, channelLabel, stateOf, stateLabel, sortRows, composerNotice, waitingCount, sourcesFrom, sourceKey, pageColor, initialsOf, filterRows, displayName, InboxRow } from './inbox-view';

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

describe('naming a customer we have no name for', () => {
  // Meta's profile lookup is permission-gated and often fails. Falling back to
  // one generic word gave eight rows all called "Customer" — visually
  // identical, unsearchable, impossible to tell apart.
  it('uses the real name when there is one', () => {
    expect(displayName({ senderName: 'Trần Mỹ Linh', senderId: 'psid-999' }, true)).toBe('Trần Mỹ Linh');
  });

  it('makes two nameless customers distinguishable', () => {
    const a = displayName({ senderId: 'abc123456789' }, true);
    const b = displayName({ senderId: 'abc123999999' }, true);
    expect(a).not.toBe(b);
  });

  it('says it in the salon language', () => {
    expect(displayName({ senderId: 'x778899' }, true)).toBe('Khách 778899');
    expect(displayName({ senderId: 'x778899' }, false)).toBe('Customer 778899');
  });

  it.each([null, undefined, { senderName: '   ' }])('falls back to the bare word for %s', (row) => {
    expect(displayName(row as never, true)).toBe('Khách');
  });

  it('prefers a name over an id even when both are present', () => {
    expect(displayName({ senderName: 'Mai', senderId: 'psid-1' }, true)).toBe('Mai');
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

describe('ordering — by the last MESSAGE, never by the last click', () => {
  // The bug this replaced: the list sorted on updatedAt, which Prisma moves on
  // every write to the row — including marking it read. Clicking a conversation
  // threw it to the top, so the list rearranged itself under the hand of
  // whoever was working down it.
  it('does not move a conversation just because the row was touched', () => {
    const out = sortRows([
      // Opened five minutes ago (updatedAt moved) but nobody has written in it
      // since this morning.
      row({ id: 'just-clicked', lastMessageAt: '2026-08-27T08:00:00.000Z', updatedAt: '2026-08-27T13:55:00.000Z' }),
      row({ id: 'real-new-message', lastMessageAt: '2026-08-27T13:00:00.000Z', updatedAt: '2026-08-27T13:00:00.000Z' }),
    ]);
    expect(out[0].id).toBe('real-new-message');
  });

  it('puts the most recent message first', () => {
    const out = sortRows([
      row({ id: 'older', lastMessageAt: '2026-08-27T08:00:00.000Z' }),
      row({ id: 'newest', lastMessageAt: '2026-08-27T13:00:00.000Z' }),
      row({ id: 'mid', lastMessageAt: '2026-08-27T11:00:00.000Z' }),
    ]);
    expect(out.map((r) => r.id)).toEqual(['newest', 'mid', 'older']);
  });

  // Rows written before the column existed have no lastMessageAt; they must
  // still sort somewhere sensible rather than collapsing to the bottom.
  it('falls back to updatedAt for older rows', () => {
    const out = sortRows([
      row({ id: 'legacy-old', updatedAt: '2026-08-27T08:00:00.000Z' }),
      row({ id: 'legacy-new', updatedAt: '2026-08-27T14:00:00.000Z' }),
    ]);
    expect(out[0].id).toBe('legacy-new');
  });

  it('mixes new and legacy rows in one honest order', () => {
    const out = sortRows([
      row({ id: 'legacy', updatedAt: '2026-08-27T12:00:00.000Z' }),
      row({ id: 'stamped-newer', lastMessageAt: '2026-08-27T13:00:00.000Z', updatedAt: '2026-08-27T09:00:00.000Z' }),
    ]);
    expect(out[0].id).toBe('stamped-newer');
  });

  it('does not float a waiting customer above a newer message', () => {
    const out = sortRows([
      row({ id: 'new-bot', state: 'bot', lastMessageAt: '2026-08-27T13:00:00.000Z' }),
      row({ id: 'old-waiting', state: 'unclaimed', waitingMinutes: 90, lastMessageAt: '2026-08-27T09:00:00.000Z' }),
    ]);
    expect(out[0].id).toBe('new-bot');
  });

  it('survives an unparseable timestamp instead of scrambling the list', () => {
    const out = sortRows([
      row({ id: 'good', lastMessageAt: '2026-08-27T13:00:00.000Z' }),
      row({ id: 'broken', lastMessageAt: 'not a date', updatedAt: 'also not a date' }),
    ]);
    expect(out[0].id).toBe('good');
  });

  it('does not mutate what it was given', () => {
    const input = [row({ id: 'a' }), row({ id: 'b', lastMessageAt: '2026-08-27T13:00:00.000Z' })];
    const copy = [...input];
    sortRows(input);
    expect(input).toEqual(copy);
  });
});

describe('a colour per Page — what an icon cannot do', () => {
  // Two Fanpages are both Messenger and both draw the same envelope. Colour is
  // the only thing that separates them at a glance, which is exactly when a
  // salon has grown enough to need it.
  it('gives the same Page the same colour every time', () => {
    expect(pageColor('page-abc')).toEqual(pageColor('page-abc'));
  });

  it('gives two Pages different colours', () => {
    expect(pageColor('page-abc')).not.toEqual(pageColor('page-xyz'));
  });

  it('does not depend on what order Pages were connected in', () => {
    // Assigning colours by position would reshuffle every Page the moment one
    // is added or removed.
    const before = pageColor('page-2');
    const after = pageColor('page-2');
    expect(before).toEqual(after);
  });

  it.each([null, undefined, ''])('has a neutral colour for %s', (id) => {
    const c = pageColor(id);
    expect(c.bg).toBeTruthy();
    expect(c.fg).toBeTruthy();
  });

  it('always returns readable text on its own background', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']) {
      const c = pageColor(id);
      expect(c.bg).not.toBe(c.fg);
    }
  });
});

describe('avatar initials', () => {
  it('takes the last two words, the way Vietnamese names read', () => {
    expect(initialsOf('Nguyễn Thị Hằng')).toBe('TH');
    expect(initialsOf('Hai Cao')).toBe('HC');
  });

  it('copes with one word', () => {
    expect(initialsOf('Mai')).toBe('M');
  });

  it.each(['', '   ', null, undefined])('falls back for %s', (n) => {
    expect(initialsOf(n as never)).toBe('?');
  });
});

describe('the source rail — which Page, not which kind of app', () => {
  // Listing channel TYPES is useless to a salon running two Pages: both inboxes
  // collapse into one button and there is no way to answer as just one of them.
  const rows = [
    row({ id: 'a', pageId: 'p1', pageName: 'Lumio Agency', channel: 'messenger', state: 'unclaimed' }),
    row({ id: 'b', pageId: 'p1', pageName: 'Lumio Agency', channel: 'messenger', state: 'bot' }),
    row({ id: 'c', pageId: 'p2', pageName: 'Nailstop', channel: 'messenger', state: 'unclaimed' }),
    row({ id: 'd', pageId: 'p1', pageName: 'lumio.ig', channel: 'instagram', state: 'bot' }),
  ];

  it('lists one entry per Page and channel, not per channel type', () => {
    const out = sourcesFrom(rows);
    expect(out).toHaveLength(3);
    // Sorted by label with localeCompare, which ignores case — so 'lumio.ig'
    // sits beside 'Lumio Agency' rather than after 'Nailstop'. Asserted as a
    // set plus a stability check below, because the exact collation is the
    // platform's business, not ours.
    expect(new Set(out.map((s) => s.label))).toEqual(new Set(['Lumio Agency', 'Nailstop', 'lumio.ig']));
  });

  it('separates the same Page on two channels', () => {
    expect(sourceKey({ pageId: 'p1', channel: 'messenger' }))
      .not.toBe(sourceKey({ pageId: 'p1', channel: 'instagram' }));
  });

  it('counts waiting customers per source, not total conversations', () => {
    const byLabel = Object.fromEntries(sourcesFrom(rows).map((s) => [s.label, s.waiting]));
    expect(byLabel['Lumio Agency']).toBe(1);
    expect(byLabel['Nailstop']).toBe(1);
    expect(byLabel['lumio.ig']).toBe(0);
  });

  it('falls back to the channel name when a Page has none', () => {
    expect(sourcesFrom([row({ pageId: 'p9', channel: 'instagram' })])[0].label).toBe('Instagram');
  });

  it('keeps a stable order so the rail does not reshuffle', () => {
    const a = sourcesFrom(rows).map((s) => s.key);
    const b = sourcesFrom([...rows].reverse()).map((s) => s.key);
    expect(a).toEqual(b);
  });

  it('counts everyone waiting across all sources', () => {
    expect(waitingCount(rows)).toBe(2);
    expect(waitingCount([])).toBe(0);
  });
});

describe('filtering', () => {
  const rows = [
    row({ id: 'wait-fb', state: 'unclaimed', pageId: 'p1', channel: 'messenger', senderName: 'Nguyễn Thị Hằng', unread: true }),
    row({ id: 'wait-ig', state: 'unclaimed', pageId: 'p1', channel: 'instagram', senderName: 'Mai', unread: true }),
    row({ id: 'bot-fb', state: 'bot', pageId: 'p2', channel: 'messenger', senderName: 'Trang', lastText: 'Đặt lịch mai nhé' }),
    row({ id: 'mine', state: 'human', pageId: 'p1', channel: 'messenger', senderName: 'Linh', assignedName: 'Hà', assignedUserId: 'u-ha' }),
    row({ id: 'theirs', state: 'human', pageId: 'p1', channel: 'messenger', senderName: 'Thu', assignedName: 'Mai', assignedUserId: 'u-mai' }),
  ];

  // 'all' is the default now: the first thing you see is everything, newest
  // first, exactly like every other chat inbox.
  it('shows everything by default', () => {
    expect(filterRows(rows, {}).length).toBe(rows.length);
  });

  it('narrows to one Page on one channel', () => {
    const key = sourceKey({ pageId: 'p1', channel: 'instagram' });
    expect(filterRows(rows, { source: key }).map((r) => r.id)).toEqual(['wait-ig']);
  });

  it('does not mix two Pages that share a channel', () => {
    const key = sourceKey({ pageId: 'p2', channel: 'messenger' });
    expect(filterRows(rows, { source: key }).map((r) => r.id)).toEqual(['bot-fb']);
  });

  it('combines source and state', () => {
    const key = sourceKey({ pageId: 'p1', channel: 'messenger' });
    expect(filterRows(rows, { filter: 'waiting', source: key }).map((r) => r.id)).toEqual(['wait-fb']);
  });

  it('shows only the people waiting', () => {
    expect(filterRows(rows, { filter: 'waiting' }).map((r) => r.id).sort()).toEqual(['wait-fb', 'wait-ig']);
  });

  it('shows only what this person is holding', () => {
    expect(filterRows(rows, { filter: 'mine', meId: 'u-ha' }).map((r) => r.id)).toEqual(['mine']);
  });

  it('does not silently empty the list when we do not know who you are', () => {
    expect(filterRows(rows, { filter: 'mine', meId: null }).length).toBe(rows.length);
  });

  // Someone typing "hang" must find "Hằng", or the search box is useless to the
  // people it was built for.
  it.each([['hang', 'wait-fb'], ['Hằng', 'wait-fb'], ['HANG', 'wait-fb'], ['nguyen', 'wait-fb']])(
    'finds a Vietnamese name typed as %s', (q, id) => {
      expect(filterRows(rows, { query: q }).map((r) => r.id)).toEqual([id]);
    },
  );

  it('searches the last message too', () => {
    expect(filterRows(rows, { query: 'dat lich' }).map((r) => r.id)).toEqual(['bot-fb']);
  });

  it('handles đ, which survives accent-stripping untouched', () => {
    expect(filterRows(rows, { query: 'Đặt' }).map((r) => r.id)).toEqual(['bot-fb']);
  });

  it('finds nothing rather than everything for a miss', () => {
    expect(filterRows(rows, { query: 'zzzz' })).toEqual([]);
  });

  it.each(['', '   ', undefined])('ignores an empty query (%s)', (q) => {
    expect(filterRows(rows, { query: q }).length).toBe(rows.length);
  });
});

describe('the 24-hour window — a warning, never a lock', () => {
  // The composer must never be disabled by something we are only guessing at.
  it('says nothing at all when we have no timestamp', () => {
    expect(composerNotice({ open: true, minutesLeft: null, unknown: true }, true)).toEqual({ blocked: false, text: null });
  });

  it.each([null, undefined])('says nothing for %s', (w) => {
    expect(composerNotice(w, true)).toEqual({ blocked: false, text: null });
  });

  // Our copy of "when they last wrote" can be wrong; Meta is the only party
  // that knows. Warn on the guess, let the send decide.
  it('warns when we believe it has shut, but does not block', () => {
    const n = composerNotice({ open: false, minutesLeft: 0, unknown: false }, true);
    expect(n.blocked).toBe(false);
    expect(n.text).toContain('24 giờ');
  });

  it('tells them what to do if it does fail', () => {
    expect(composerNotice({ open: false, minutesLeft: 0 }, true).text).toMatch(/gọi|SMS/);
    expect(composerNotice({ open: false, minutesLeft: 0 }, false).text).toMatch(/call|text/);
  });

  it('counts down while there is still time to act', () => {
    const n = composerNotice({ open: true, minutesLeft: 45, unknown: false }, true);
    expect(n.blocked).toBe(false);
    expect(n.text).toContain('45');
  });

  it('writes a long remainder in hours', () => {
    expect(composerNotice({ open: true, minutesLeft: 90, unknown: false }, true).text).toContain('1h');
  });

  it('stays quiet when there is plenty of time', () => {
    expect(composerNotice({ open: true, minutesLeft: 600, unknown: false }, true).text).toBeNull();
  });

  // The property that matters most: nothing this function returns ever
  // disables the message box.
  it('never blocks, whatever it is given', () => {
    for (const w of [null, undefined, { open: false, minutesLeft: 0 }, { open: true, minutesLeft: null, unknown: true }, { open: true, minutesLeft: 5 }]) {
      expect(composerNotice(w as never, true).blocked).toBe(false);
    }
  });
});
