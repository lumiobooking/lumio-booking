import { pillarFor, seasonFor, seasonToPrompt, pillarToPrompt, trendsToPrompt } from './season-pillars';
import { playbookFor } from './industry-playbook';
import { viOf } from './i18n';

describe('the design season', () => {
  it('knows September is fall transition and December is the sparkle month', () => {
    expect(seasonFor('SALON', 9)!.designs).toContain('fall nails');
    expect(seasonFor('SALON', 12)!.designs.join(' ')).toContain('christmas');
  });

  it('stays out of trades that are not salons — their calendar is the events module', () => {
    expect(seasonFor('RESTAURANT', 9)).toBeNull();
  });

  it('phrases the prompt block in Vietnamese with the English design keywords intact', () => {
    const block = seasonToPrompt(seasonFor('SALON', 10), 10);
    expect(block).toContain('MÙA THIẾT KẾ THÁNG 10');
    expect(block).toContain('halloween nails');
  });

  it('says nothing at all when there is no season', () => {
    expect(seasonToPrompt(null, 6)).toBe('');
  });
});

describe("today's pillar", () => {
  const book = playbookFor('SALON');

  it('walks through every angle before repeating — five days, five different pillars', () => {
    const seen = new Set(
      ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05']
        .map((d) => viOf(pillarFor(book, d).label)),
    );
    expect(seen.size).toBe(book.postTypes.length);
  });

  it('gives the same day the same pillar, every time it is asked', () => {
    expect(pillarFor(book, '2026-09-02')).toBe(pillarFor(book, '2026-09-02'));
  });

  it('names the pillar and its job in the prompt', () => {
    const block = pillarToPrompt(book.postTypes[0]);
    expect(block).toContain('TRỤ NỘI DUNG HÔM NAY');
    expect(block).toContain(viOf(book.postTypes[0].label));
  });
});

describe('the live-trend block', () => {
  it('lists trends with their velocity and demands the exact title back', () => {
    const block = trendsToPrompt(
      [{ title: 'Chrome cat-eye on almond nails', source: 'youtube', perDay: 41000 }],
      [{ query: 'chrome nails', growthPct: 140, source: 'google' }],
    );
    expect(block).toContain('Chrome cat-eye on almond nails');
    expect(block).toContain('41,000');
    expect(block).toContain('"chrome nails" (+140%)');
    expect(block).toContain('trendTitle');
  });

  it('says nothing when the feed has nothing — no block beats an empty ritual', () => {
    expect(trendsToPrompt([], [])).toBe('');
  });
});
