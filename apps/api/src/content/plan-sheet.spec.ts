import { cleanEntry, cleanSheet, emptyEntry, entryHasContent, entryForShop, isDayKey, mergeEntry, monthsCovering, windowOf, ENTRY_LIMITS } from './plan-sheet';

const NOW = new Date('2026-09-15T10:00:00Z');

describe('a day key', () => {
  it('is YYYY-MM-DD and nothing looser', () => {
    expect(isDayKey('2026-09-15')).toBe(true);
    expect(isDayKey('2026-9-15')).toBe(false);
    expect(isDayKey('2026-09-32')).toBe(false);
    expect(isDayKey(undefined)).toBe(false);
  });
});

describe('cleaning an entry', () => {
  it('keeps only known pillars, formats and channels', () => {
    const e = cleanEntry({ pillar: 'Inspiration', format: 'video', air: ['facebook', 'myspace', 'facebook', 'tiktok'] }, '2026-09-15');
    expect(e.pillar).toBe('');           // case matters: ids, not labels
    expect(e.format).toBe('video');
    expect(e.air).toEqual(['facebook', 'tiktok']);
  });
  it('caps text so a pasted essay cannot become the sheet', () => {
    const e = cleanEntry({ detail: 'x'.repeat(9000), topic: ' Jelly French ' }, '2026-09-15');
    expect(e.detail).toHaveLength(ENTRY_LIMITS.detail);
    expect(e.topic).toBe('Jelly French');
  });
  it('reads junk as empty rather than throwing', () => {
    expect(cleanEntry('nope', '2026-09-15')).toEqual(emptyEntry('2026-09-15'));
    expect(entryHasContent(cleanEntry(null, '2026-09-15'))).toBe(false);
  });
});

describe('merging a patch', () => {
  const stored = mergeEntry(null, { topic: 'St Kilda Weekend Pedi', detail: 'long caption', air: ['facebook'] }, '2026-09-18', 'an@lumio', NOW);

  it('moves only the keys the client sent', () => {
    const next = mergeEntry(stored, { format: 'poster' }, '2026-09-18', 'binh@lumio', NOW);
    expect(next.detail).toBe('long caption');   // untouched by a save that did not carry it
    expect(next.format).toBe('poster');
    expect(next.updatedBy).toBe('binh@lumio');
  });
  it('treats postId: null as "unlink", not "leave alone"', () => {
    const linked = mergeEntry(stored, { postId: 'post_1' }, '2026-09-18', 'an@lumio', NOW);
    expect(linked.postId).toBe('post_1');
    expect(mergeEntry(linked, { postId: null }, '2026-09-18', 'an@lumio', NOW).postId).toBeNull();
    expect(mergeEntry(linked, { topic: 'x' }, '2026-09-18', 'an@lumio', NOW).postId).toBe('post_1');
  });
  it('ignores keys that are not columns', () => {
    const next = mergeEntry(stored, { day: '1999-01-01', updatedBy: 'hacker', role: 'admin' }, '2026-09-18', 'an@lumio', NOW);
    expect(next.day).toBe('2026-09-18');
    expect(next.updatedBy).toBe('an@lumio');
    expect((next as unknown as Record<string, unknown>).role).toBeUndefined();
  });
});

describe('a stored month', () => {
  it('drops empty slots and days filed under the wrong month', () => {
    const s = cleanSheet({
      '2026-09-15': { topic: 'a' },
      '2026-09-16': {},
      '2026-10-01': { topic: 'wrong month' },
      'garbage': { topic: 'x' },
    }, '2026-09');
    expect(Object.keys(s)).toEqual(['2026-09-15']);
  });
});

describe('the 35-day window', () => {
  it('spans two months at a month edge and one otherwise', () => {
    expect(monthsCovering('2026-09-14', 35)).toEqual(['2026-09', '2026-10']);
    expect(monthsCovering('2026-09-01', 28)).toEqual(['2026-09']);
    expect(monthsCovering('2026-12-28', 35)).toEqual(['2026-12', '2027-01']);
  });
  it('keeps only the days inside it', () => {
    const sheet = {
      '2026-09-13': cleanEntry({ topic: 'before' }, '2026-09-13'),
      '2026-09-14': cleanEntry({ topic: 'first' }, '2026-09-14'),
      '2026-10-18': cleanEntry({ topic: 'last' }, '2026-10-18'),
      '2026-10-19': cleanEntry({ topic: 'after' }, '2026-10-19'),
    };
    expect(Object.keys(windowOf(sheet, '2026-09-14', 35)).sort()).toEqual(['2026-09-14', '2026-10-18']);
  });
});

describe('what the shop sees of a slot', () => {
  it('is the post-to-be and nothing about how it was made', () => {
    const e = mergeEntry(null, { topic: 't', detail: 'd', mediaUrl: 'https://drive.google.com/x', air: ['facebook'], pillar: 'promotion', format: 'poster' }, '2026-09-18', 'an@lumio', NOW);
    const s = entryForShop(e);
    expect(Object.keys(s).sort()).toEqual(['air', 'day', 'detail', 'format', 'pillar', 'postId', 'topic', 'updatedAt']);
    expect(JSON.stringify(s)).not.toContain('drive.google.com');
    expect(JSON.stringify(s)).not.toContain('an@lumio');
  });
});
