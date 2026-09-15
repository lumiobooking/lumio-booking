import { emptyEntry, entryReady, entryToDraft, sheetProgress, sheetWeeks, entryHasContent } from './plan-sheet';

const ALL = { facebook: true, instagram: true, tiktok: true, google: true };

describe('a slot becoming a post', () => {
  it('uses the detail as the caption and keeps the topic as the working title', () => {
    const e = { ...emptyEntry('2026-09-16'), topic: 'Jelly French Is Having a Moment', detail: 'Soft, glossy, see-through colour…', air: ['facebook', 'instagram'] as const };
    const d = entryToDraft({ ...e, air: [...e.air] }, ALL);
    expect(d.message).toBe('Soft, glossy, see-through colour…');
    expect(d.teamNote).toContain('Jelly French');
    expect(d.channels).toEqual(['facebook', 'instagram']);
    expect(d.at).toBe('2026-09-16T10:00');
  });
  it('falls back to the topic when no caption was written yet', () => {
    const e = { ...emptyEntry('2026-09-16'), topic: 'Remind', air: ['facebook' as const] };
    expect(entryToDraft(e, ALL).message).toBe('Remind');
  });
  it('drops channels the salon has not connected rather than failing at publish', () => {
    const e = { ...emptyEntry('2026-09-16'), topic: 'x', air: ['tiktok' as const, 'instagram' as const] };
    expect(entryToDraft(e, { ...ALL, tiktok: false }).channels).toEqual(['instagram']);
    expect(entryToDraft(e, { facebook: true, instagram: false, tiktok: false, google: false }).channels).toEqual(['facebook']);
  });
  it('is ready only with words and a network', () => {
    expect(entryReady({ ...emptyEntry('d'), topic: 'x' })).toBe(false);
    expect(entryReady({ ...emptyEntry('d'), topic: 'x', air: ['facebook'] })).toBe(true);
    expect(entryHasContent(emptyEntry('d'))).toBe(false);
  });
});

describe('the bands', () => {
  it('start on a Monday and mark today and the 30-day window', () => {
    const w = sheetWeeks('2026-09-15', '2026-09-15');   // a Tuesday
    expect(w).toHaveLength(5);
    expect(w[0][0].key).toBe('2026-09-14');
    expect(w[0][0].past).toBe(true);
    expect(w[0][1].today).toBe(true);
    expect(w[4][6].key).toBe('2026-10-18');
    expect(w[4][6].inWindow).toBe(false);                // day 33 from today
  });
  it('counts the window, not the band', () => {
    const w = sheetWeeks('2026-09-15', '2026-09-15');
    const p = sheetProgress(w, {
      '2026-09-14': { ...emptyEntry('2026-09-14'), topic: 'yesterday' },      // past: not counted
      '2026-09-16': { ...emptyEntry('2026-09-16'), topic: 'a', postId: 'p1' },
      '2026-09-17': { ...emptyEntry('2026-09-17'), pillar: 'cta' },
    });
    expect(p).toEqual({ filled: 2, scheduled: 1, days: 30 });
  });
});
