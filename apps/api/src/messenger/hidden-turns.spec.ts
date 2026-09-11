/**
 * HIDING A MESSAGE HAS TO STICK.
 *
 * The transcript is not stored. It is re-read from Meta on every open and
 * re-merged with our own buffer, so a message hidden at 9am arrives again at
 * 9:05 through a different route with a different shape. If the hide is keyed
 * on anything that moves — a position, a timestamp Meta rounds differently —
 * the message comes back, and the person who pressed the button watches it
 * reappear. These are the cases where that happens.
 */
import { turnKeys, isHidden, mergeHistory, type HistoryTurn } from './history-merge';

const t = (o: Partial<HistoryTurn>): HistoryTurn => ({ role: 'assistant', content: 'x', ...o } as HistoryTurn);

describe('naming a message so it can be found again', () => {
  it('keys on Meta\'s id AND on the text, because neither alone is always there', () => {
    expect(turnKeys(t({ messageId: 'mid.123', content: 'Hello' })))
      .toEqual(['m:mid.123', 'k:assistant:Hello']);
  });

  it('a turn with no id is still nameable', () => {
    expect(turnKeys(t({ content: 'Hello' }))).toEqual(['k:assistant:Hello']);
  });

  it('an empty message has no key, so it can never be hidden by accident', () => {
    expect(turnKeys(t({ content: '   ' }))).toEqual([]);
  });

  it('the same words from the customer and from us are different messages', () => {
    expect(turnKeys(t({ role: 'user', content: 'Hi' })))
      .not.toEqual(turnKeys(t({ role: 'assistant', content: 'Hi' })));
  });

  it('text is compared trimmed — Meta pads, we do not', () => {
    expect(turnKeys(t({ content: '  Hello  ' }))).toEqual(['k:assistant:Hello']);
  });
});

describe('a hidden message stays hidden', () => {
  const hidden = ['m:mid.123', 'k:assistant:Hello'];

  it('by id', () => {
    expect(isHidden(t({ messageId: 'mid.123', content: 'anything at all' }), hidden)).toBe(true);
  });

  it('by text, when the copy we have carries no id', () => {
    expect(isHidden(t({ content: 'Hello' }), hidden)).toBe(true);
  });

  // THE CASE THIS IS ALL FOR. We hid our local copy, which had no Meta id.
  // Meta then hands the same message back WITH an id we have never seen. If
  // the hide were keyed only on the id, it would reappear.
  it('when Meta returns the same message with an id we did not have', () => {
    expect(isHidden(t({ messageId: 'mid.new', content: 'Hello' }), ['k:assistant:Hello'])).toBe(true);
  });

  // And the mirror: hidden by id, then the text is edited nowhere but our
  // buffer has an older copy of the words.
  it('when the copy we have carries the id but different whitespace', () => {
    expect(isHidden(t({ messageId: 'mid.123', content: '' }), hidden)).toBe(true);
  });

  it('leaves every other message alone', () => {
    expect(isHidden(t({ messageId: 'mid.999', content: 'Something else' }), hidden)).toBe(false);
    expect(isHidden(t({ role: 'user', content: 'Hello' }), hidden)).toBe(false);
  });

  it('nothing hidden means nothing filtered', () => {
    expect(isHidden(t({ content: 'Hello' }), [])).toBe(false);
    expect(isHidden(t({ content: 'Hello' }), null)).toBe(false);
  });
});

describe('hiding does not disturb the merge', () => {
  it('the transcript is still built the same way; hiding happens after', () => {
    const meta = [
      t({ role: 'user', content: 'Hi', at: '2026-09-10T01:00:00.000Z', messageId: 'm1' }),
      t({ role: 'assistant', content: 'Hello', at: '2026-09-10T01:00:05.000Z', messageId: 'm2' }),
    ];
    const local = [t({ role: 'assistant', content: 'Sent seconds ago', at: '2026-09-10T01:00:09.000Z' })];
    const merged = mergeHistory(meta, local);
    expect(merged.map((x) => x.content)).toEqual(['Hi', 'Hello', 'Sent seconds ago']);

    // Now hide the middle one. Order and the rest survive untouched.
    const hidden = turnKeys(merged[1]);
    expect(merged.filter((x) => !isHidden(x, hidden)).map((x) => x.content))
      .toEqual(['Hi', 'Sent seconds ago']);
  });

  it('hiding a FAILED reply does not hide the retry that succeeded', () => {
    // Same words, one failed and one sent. They are the same key, so hiding
    // one hides both — this test exists to record that deliberately: the
    // salon asked for those words gone from the screen, not for one of two
    // identical lines to stay.
    const failed = t({ content: 'Bảng giá ạ', failed: true });
    const sent = t({ content: 'Bảng giá ạ', messageId: 'm9' });
    const hidden = turnKeys(failed);
    expect(isHidden(failed, hidden)).toBe(true);
    expect(isHidden(sent, hidden)).toBe(true);
  });
});
