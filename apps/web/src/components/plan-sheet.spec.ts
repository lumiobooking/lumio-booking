import { emptyEntry, entryReady, entryToDraft, sheetProgress, sheetWeeks, entryHasContent, entryFromIdea, mergeIdeaInto, monthWeeks, monthTitle, nextMonth, shiftMonth, monthOffset, monthInRange } from './plan-sheet';

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

describe('an idea becoming a plan slot', () => {
  it('translates the kind of job into pillar, format and networks, and the brief into the caption', () => {
    const e = entryFromIdea({ kind: 'film', text: 'Đăng clip — Một ca khó hơn bình thường', brief: { caption: 'Hard set, done right.', hashtags: ['nailart', '#kerrville'] } });
    expect(e).toMatchObject({ pillar: 'inspiration', format: 'video', air: ['facebook', 'instagram'], topic: 'Đăng clip — Một ca khó hơn bình thường' });
    expect(e.detail).toBe('Hard set, done right.\n\n#nailart #kerrville');
    expect(entryFromIdea({ kind: 'gbp', text: 'Xin đánh giá' })).toMatchObject({ pillar: 'feedback', air: ['google'] });
    expect(entryFromIdea({ kind: 'offer', text: 'Ưu đãi' })).toMatchObject({ pillar: 'promotion', format: 'poster' });
  });
  it('fills only what the day still lacks — the plan is never overwritten by a suggestion', () => {
    const planned = { ...emptyEntry('2026-09-17'), topic: 'Khách cũ nói về lần làm trước', air: ['facebook'] as const };
    const idea = entryFromIdea({ kind: 'photo', text: 'Đăng bộ ảnh', brief: { caption: 'c' } });
    const patch = mergeIdeaInto({ ...planned, air: [...planned.air] }, idea);
    expect(patch.topic).toBeUndefined();
    expect(patch.air).toBeUndefined();
    expect(patch).toMatchObject({ pillar: 'inspiration', format: 'album', detail: 'c' });
    expect(mergeIdeaInto(undefined, idea)).toBe(idea);
  });
});

describe('a month as calendar rows', () => {
  it('starts on the Monday before the 1st, ends on the Sunday after the last day, marks the month', () => {
    const w = monthWeeks('2026-09', '2026-09-16');
    expect(w).toHaveLength(5);
    expect(w[0][0]).toMatchObject({ key: '2026-08-31', inWindow: false, past: true });
    expect(w[0][1]).toMatchObject({ key: '2026-09-01', inWindow: true });
    expect(w[2][2]).toMatchObject({ key: '2026-09-16', today: true });
    expect(w[4][6]).toMatchObject({ key: '2026-10-04', inWindow: false });
    expect(sheetProgress(w, {}).days).toBe(30);
  });
  it('names months and steps to the next', () => {
    expect(monthTitle('2026-09', true)).toBe('Tháng 9 · 2026');
    expect(monthTitle('2026-12', false)).toBe('December 2026');
    expect(nextMonth('2026-12')).toBe('2027-01');
  });

  it('steps both ways over the turn of the year, and knows how far it may go', () => {
    expect(shiftMonth('2026-11', 1)).toBe('2026-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2027-01', -1)).toBe('2026-12');
    expect(shiftMonth('2026-01', -2)).toBe('2025-11');
    expect(monthOffset('2026-12', '2027-02')).toBe(2);
    expect(monthOffset('2027-01', '2026-12')).toBe(-1);
    // a year back and a quarter ahead of the day we are on, and no further
    expect(monthInRange('2026-12-31', '2027-03')).toBe(true);
    expect(monthInRange('2026-12-31', '2027-04')).toBe(false);
    expect(monthInRange('2026-12-31', '2025-12')).toBe(true);
    expect(monthInRange('2026-12-31', '2025-11')).toBe(false);
  });

  it('draws every month it can reach, including a six-row November and a January', () => {
    for (let n = -12; n <= 3; n += 1) {
      const m = shiftMonth('2026-09', n);
      const w = monthWeeks(m, '2026-09-16');
      expect([4, 5, 6]).toContain(w.length);
      expect(w[0]).toHaveLength(7);
      expect(w.flat().filter((d) => d.inWindow).length).toBe(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5)), 0)).getUTCDate());
    }
  });
});
