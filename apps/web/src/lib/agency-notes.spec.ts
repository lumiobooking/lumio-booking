import { dropNote, firstLine, placeNote, sortNotes, summaryOf, type NoteView } from './agency-notes';

const n = (id: string, over: Partial<NoteView> = {}): NoteView => ({
  id, body: id, pinned: false, by: 'Lan', at: '2026-10-24T08:00:00Z', editedAt: null, doneAt: null, doneBy: null, canEdit: true, ...over,
});

describe('agency notes on the list', () => {
  it('pinned first, then newest', () => {
    const list = [n('old', { at: '2026-10-24T07:00:00Z' }), n('new', { at: '2026-10-24T09:00:00Z' }), n('pin', { pinned: true, at: '2026-10-20T09:00:00Z' })];
    expect(sortNotes(list).map((x) => x.id)).toEqual(['pin', 'new', 'old']);
  });

  it('the row summary reads like the API one, and is null when nothing is open', () => {
    expect(summaryOf([])).toBeNull();
    expect(summaryOf([n('a', { doneAt: '2026-10-24T09:00:00Z' })])).toBeNull();
    const s = summaryOf([n('a', { at: '2026-10-24T09:00:00Z' }), n('b', { pinned: true, by: 'Minh' })]);
    expect(s).toMatchObject({ open: 2, pinned: 1, top: { body: 'b', by: 'Minh', pinned: true } });
    expect(summaryOf([n('x'.repeat(400))])!.top!.body.length).toBeLessThanOrEqual(160);
  });

  it('shows the first written line', () => {
    expect(firstLine('\n  Gọi lại thứ 6 \nchi tiết')).toBe('Gọi lại thứ 6');
  });

  it('moves a note between open and done, and drops it', () => {
    const lists = { open: [n('a'), n('b')], done: [] as NoteView[] };
    const closed = placeNote(lists, n('a', { doneAt: '2026-10-24T09:00:00Z' }));
    expect(closed.open.map((x) => x.id)).toEqual(['b']);
    expect(closed.done.map((x) => x.id)).toEqual(['a']);
    const back = placeNote(closed, n('a', { pinned: true }));
    expect(back.open.map((x) => x.id)).toEqual(['a', 'b']);
    expect(back.done).toHaveLength(0);
    expect(dropNote(back, 'a').open.map((x) => x.id)).toEqual(['b']);
  });
});
