import {
  pickStage, weekIndex, rotate,
  REVIEWS_FLOOR, POSTS_FLOOR, LAPSED_FLOOR,
  type RoadmapSignals,
} from './roadmap';
import { viOf, enOf } from './i18n';

/** A shop past the foundation, with nothing else outstanding. */
const SETTLED: RoadmapSignals = {
  reviewCount: 40,
  postedLast30: 12,
  lapsedCount: 2,
  customerCount: 200,
  hasQuietSlot: false,
  marginKnown: true,
  attributedBookings: 30,
};
const at = (over: Partial<RoadmapSignals> = {}) => pickStage({ ...SETTLED, ...over });

describe('the path runs cheapest-first', () => {
  it('starts at the profile a paid click would land on', () => {
    expect(at({ reviewCount: 3 }).key).toBe('foundation');
    expect(at({ reviewCount: 40, postedLast30: 2 }).key).toBe('foundation');
  });

  it('then the people who already paid once', () => {
    expect(at({ lapsedCount: 40 }).key).toBe('reactivate');
  });

  it('then the hours the shop is already staffing', () => {
    expect(at({ hasQuietSlot: true }).key).toBe('fill-gap');
  });

  it('and only then the one that costs money', () => {
    expect(at().key).toBe('acquire');
  });

  it('keeps paid reach LAST even when everything else is quiet', () => {
    // The order is the point. A shop with a thin profile must not be sent to
    // buy clicks into it, however tempting the empty chairs look.
    expect(at({ reviewCount: 2, hasQuietSlot: true, lapsedCount: 50 }).key).toBe('foundation');
    expect(at({ hasQuietSlot: true, lapsedCount: 50 }).key).toBe('reactivate');
  });

  it('falls back to holding the rhythm when nothing is outstanding', () => {
    expect(at({ marginKnown: false }).key).toBe('keep');
  });
});

describe('the stage moves on what was DONE, never on the calendar', () => {
  it('does not advance because weeks passed', () => {
    // pickStage takes no date at all — that is the guarantee, not a policy.
    // A shop that did nothing for a month is still on step one, which is where
    // it actually is.
    const thin = { reviewCount: 4, postedLast30: 0 };
    expect(at(thin).key).toBe('foundation');
    expect(at(thin).step).toBe(1);
  });

  it('advances the moment the exit condition is met, not a week later', () => {
    expect(at({ reviewCount: REVIEWS_FLOOR - 1, postedLast30: POSTS_FLOOR }).key).toBe('foundation');
    expect(at({ reviewCount: REVIEWS_FLOOR, postedLast30: POSTS_FLOOR }).key).not.toBe('foundation');
  });

  it('holds the lapsed stage until the list is genuinely small', () => {
    expect(at({ lapsedCount: LAPSED_FLOOR }).key).toBe('reactivate');
    expect(at({ lapsedCount: LAPSED_FLOOR - 1 }).key).not.toBe('reactivate');
  });
});

describe('every stage tells the owner how it ends', () => {
  const all = [
    at({ reviewCount: 1 }), at({ lapsedCount: 30 }), at({ hasQuietSlot: true }),
    at(), at({ marginKnown: false }),
  ];

  it('names a measurable exit, not "when you are ready"', () => {
    for (const s of all) {
      expect(viOf(s.exitWhen).length).toBeGreaterThan(20);
      expect(viOf(s.goal).length).toBeGreaterThan(20);
      expect(viOf(s.why).length).toBeGreaterThan(30);
    }
  });

  it('gives every stage at least one job for the week', () => {
    for (const s of all) expect(s.jobs.length).toBeGreaterThan(0);
  });

  it('counts progress where progress is countable', () => {
    const p = at({ reviewCount: 6 }).progress!;
    expect(p.done).toBe(6);
    expect(p.need).toBe(REVIEWS_FLOOR);
    expect(viOf(p.label)).toBe('đánh giá Google');
  });

  it('switches the counter to posts once the reviews are there', () => {
    const p = at({ reviewCount: 25, postedLast30: 3 }).progress!;
    expect(viOf(p.label)).toMatch(/bài đã đăng/);
    expect(p.done).toBe(3);
  });

  it('says how many reviews are still missing, in the job itself', () => {
    expect(viOf(at({ reviewCount: 6 }).jobs[0].text)).toContain('14');
  });
});

describe('every stage speaks both languages the dashboard speaks', () => {
  // The EN/VI switch is the whole reason these fields are bilingual: an owner
  // on EN must not get an English frame around Vietnamese text.
  const all = [
    at({ reviewCount: 1 }), at({ lapsedCount: 30 }), at({ hasQuietSlot: true }),
    at(), at({ marginKnown: false }),
  ];

  it('carries an English side on everything that reaches the screen', () => {
    for (const s of all) {
      for (const t of [s.title, s.goal, s.why, s.exitWhen]) {
        expect(enOf(t)).not.toBe(viOf(t));
        expect(enOf(t).length).toBeGreaterThan(0);
      }
      if (s.progress) expect(enOf(s.progress.label)).not.toBe(viOf(s.progress.label));
      for (const j of s.jobs) {
        expect(enOf(j.text)).not.toBe(viOf(j.text));
        expect(enOf(j.why)).not.toBe(viOf(j.why));
        if (j.when) expect(enOf(j.when)).not.toBe(viOf(j.when));
      }
    }
  });

  it('reads as English, not as translated Vietnamese', () => {
    const foundation = at({ reviewCount: 6 });
    expect(enOf(foundation.title)).toBe('Foundation');
    expect(enOf(foundation.exitWhen)).toBe(`${REVIEWS_FLOOR} Google reviews and ${POSTS_FLOOR} posts in the last 30 days.`);
    // The count sits in a different place in each language, so the sentence is
    // written out whole in both — not stitched together from fragments.
    expect(enOf(foundation.jobs[0].text)).toContain('14 more to go');
    expect(enOf(at({ lapsedCount: 30 }).exitWhen)).toContain(`below ${LAPSED_FLOOR}`);
  });
});

describe('the filming angles rotate so a week is never a repeat of the last', () => {
  const pool = ['a', 'b', 'c', 'd', 'e'];

  it('gives a different set of three each week', () => {
    const w0 = rotate(pool, 0).join('');
    const w1 = rotate(pool, 1).join('');
    const w2 = rotate(pool, 2).join('');
    expect(new Set([w0, w1, w2]).size).toBe(3);
  });

  it('is deterministic — the same week opened twice reads the same', () => {
    // Random variety would mean the plan changed while the owner was reading it.
    expect(rotate(pool, 4)).toEqual(rotate(pool, 4));
  });

  it('runs five distinct weeks before anything comes round again', () => {
    const seen = new Set(Array.from({ length: 5 }, (_, w) => rotate(pool, w).join('')));
    expect(seen.size).toBe(5);
  });

  it('never invents an angle a trade does not have', () => {
    for (let w = 0; w < 12; w += 1) {
      for (const x of rotate(pool, w)) expect(pool).toContain(x);
    }
  });

  it('copes with a pool smaller than the ask', () => {
    expect(rotate(['a', 'b'], 3)).toEqual(['a', 'b']);
    expect(rotate([], 1)).toEqual([]);
  });
});

describe('the week number counts from the shop’s own start', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  it('is 0 in the first week and 1 in the second', () => {
    expect(weekIndex(start, new Date('2026-01-03T00:00:00Z'))).toBe(0);
    expect(weekIndex(start, new Date('2026-01-08T00:00:00Z'))).toBe(1);
    expect(weekIndex(start, new Date('2026-03-01T00:00:00Z'))).toBe(8);
  });

  it('is 0 for a salon that has never had a plan', () => {
    expect(weekIndex(null, new Date())).toBe(0);
  });

  it('never goes negative on a clock that disagrees', () => {
    expect(weekIndex(new Date('2026-06-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))).toBe(0);
  });
});
