import { DEFAULT_TAGS, cleanTags, readTags, MAX_TAGS } from './plan-tags';

describe('a salon\'s own pillar and format chips', () => {
  it('starts every salon on the built-in set', () => {
    expect(readTags(null)).toEqual(DEFAULT_TAGS);
    expect(readTags({})).toEqual(DEFAULT_TAGS);
  });

  it('adds a chip with a fresh custom id', () => {
    const next = cleanTags({ pillars: [...DEFAULT_TAGS.pillars, { vi: 'Món mới', color: 10 }] }, DEFAULT_TAGS);
    const added = next.pillars.find((p) => p.vi === 'Món mới')!;
    expect(added.id).toMatch(/^c-[a-z0-9]{4,24}$/);
    expect(added.en).toBe('Món mới');
    expect(added.color).toBe(10);
  });

  it('rewords a chip without changing its id', () => {
    const rows = DEFAULT_TAGS.pillars.map((p) => (p.id === 'behind' ? { ...p, vi: 'Phía sau quầy' } : p));
    const next = cleanTags({ pillars: rows }, DEFAULT_TAGS);
    expect(next.pillars.find((p) => p.id === 'behind')!.vi).toBe('Phía sau quầy');
  });

  // THE RULE THAT KEEPS OLD PLANS READABLE: dropping a row hides it.
  it('never deletes — a missing chip comes back hidden', () => {
    const next = cleanTags({ pillars: DEFAULT_TAGS.pillars.filter((p) => p.id !== 'feedback') }, DEFAULT_TAGS);
    const fb = next.pillars.find((p) => p.id === 'feedback')!;
    expect(fb).toBeDefined();
    expect(fb.hidden).toBe(true);
  });

  it('keeps a custom chip that a later save forgot', () => {
    const withCustom = cleanTags({ formats: [...DEFAULT_TAGS.formats, { vi: 'Reels' }] }, DEFAULT_TAGS);
    const reels = withCustom.formats.find((f) => f.vi === 'Reels')!;
    const later = cleanTags({ formats: DEFAULT_TAGS.formats }, withCustom);
    expect(later.formats.find((f) => f.id === reels.id)?.hidden).toBe(true);
  });

  it('refuses a forged id instead of trusting it', () => {
    const next = cleanTags({ pillars: [{ id: '<script>', vi: 'x' }] }, DEFAULT_TAGS);
    expect(next.pillars.some((p) => p.id === '<script>')).toBe(false);
  });

  it('drops blank labels and caps length and count', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ vi: `Tag ${i}` }));
    const next = cleanTags({ pillars: [{ vi: '   ' }, { vi: 'x'.repeat(80) }, ...many] }, DEFAULT_TAGS);
    expect(next.pillars.length).toBeLessThanOrEqual(MAX_TAGS);
    expect(next.pillars.every((p) => p.vi.trim().length > 0 && p.vi.length <= 30)).toBe(true);
  });
});
