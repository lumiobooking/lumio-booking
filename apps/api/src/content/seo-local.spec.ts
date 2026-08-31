import { buildSeoReport, type SeoInput } from './seo-local';

const NOW = Date.UTC(2026, 7, 31);
const DAY = 86_400_000;
const review = (daysAgo: number, starRating = 5, replied = true) =>
  ({ starRating, createdAt: NOW - daysAgo * DAY, repliedAt: replied ? NOW - daysAgo * DAY : null });

const run = (over: Partial<SeoInput> = {}) => buildSeoReport({ now: NOW, ...over });
const check = (r: ReturnType<typeof buildSeoReport>, key: string) => r.checks.find((c) => c.key === key)!;

describe('it measures what decides the map results, not what looks tidy', () => {
  it('scores review volume on the bands that matter', () => {
    expect(check(run({ reviews: Array.from({ length: 60 }, () => review(10)) }), 'review-count').state).toBe('pass');
    expect(check(run({ reviews: Array.from({ length: 25 }, () => review(10)) }), 'review-count').state).toBe('warn');
    expect(check(run({ reviews: Array.from({ length: 5 }, () => review(10)) }), 'review-count').state).toBe('fail');
  });

  it('fails a big but stale profile — the count alone hides it', () => {
    // 200 reviews and none in a year: the number looks excellent and the
    // profile reads as abandoned. Volume and freshness are separate checks
    // precisely so one cannot cover for the other.
    const stale = Array.from({ length: 200 }, () => review(400));
    const r = run({ reviews: stale });
    expect(check(r, 'review-count').state).toBe('pass');
    expect(check(r, 'review-velocity').state).toBe('fail');
    expect(check(r, 'review-velocity').finding).toMatch(/400 ngày/);
  });

  it('treats an unanswered low review as a failure whatever the reply rate is', () => {
    const rs = [
      ...Array.from({ length: 30 }, () => review(5, 5, true)),
      review(3, 2, false),
    ];
    const c = check(run({ reviews: rs }), 'review-replies');
    expect(c.state).toBe('fail');
    expect(c.action).toMatch(/hôm nay/);
    expect(c.why).toMatch(/lời cuối cùng về tiệm/);
  });

  it('passes a profile that replies to nearly everything', () => {
    expect(check(run({ reviews: Array.from({ length: 20 }, () => review(5, 5, true)) }), 'review-replies').state).toBe('pass');
  });
});

describe('services the shop sells must be findable by their own name', () => {
  const keywords = [{ keyword: 'nail salon near me', count: 40 }, { keyword: 'pedicure austin', count: 12 }];

  it('flags services that appear in no search term', () => {
    const c = check(run({
      keywords,
      services: [{ name: 'Pedicure Deluxe' }, { name: 'Dipping Powder' }, { name: 'Lash Extensions' }],
    }), 'keyword-match');
    expect(c.state).not.toBe('pass');
    expect(c.finding).toMatch(/dipping|lash/i);
    expect(c.finding).not.toMatch(/pedicure deluxe/i); // this one IS covered
  });

  it('passes when everything the shop sells is being searched for', () => {
    const c = check(run({ keywords, services: [{ name: 'Pedicure' }] }), 'keyword-match');
    expect(c.state).toBe('pass');
  });

  it('says it cannot tell when Google reported no terms', () => {
    expect(check(run({ services: [{ name: 'Pedicure' }] }), 'keyword-match').state).toBe('unknown');
  });
});

describe('the final measure is customers, not rankings', () => {
  it('reads the share of bookings that came from search', () => {
    const c = check(run({ sources: { google: 30, gbp: 10, walkin: 40, facebook: 20 } }), 'search-share');
    expect(c.state).toBe('pass');
    expect(c.finding).toMatch(/40%/);
  });

  it('fails when search brings almost nobody', () => {
    const c = check(run({ sources: { google: 2, walkin: 80, facebook: 18 } }), 'search-share');
    expect(c.state).toBe('fail');
    expect(c.action).toMatch(/trước khi nghĩ tới website/);
  });

  it('refuses to read a percentage off a handful of bookings', () => {
    const c = check(run({ sources: { google: 1, walkin: 3 } }), 'search-share');
    expect(c.state).toBe('unknown');
    expect(c.finding).toMatch(/chưa đủ để đọc/);
  });
});

describe('it says what it cannot see', () => {
  it('names the website factors it does not measure, rather than scoring them', () => {
    const r = run({ reviews: [review(5)] });
    expect(r.blindSpots.join(' ')).toMatch(/tốc độ tải/);
    expect(r.blindSpots.join(' ')).toMatch(/backlink/);
    // And it does not silently include them in a score.
    expect(r.checks.some((c) => /backlink|meta description/i.test(c.title))).toBe(false);
  });

  it('never invents a rank', () => {
    const text = JSON.stringify(run({ reviews: [review(2)], sources: { google: 50, walkin: 50 } }));
    expect(text).not.toMatch(/hạng \d|top \d|vị trí \d/i);
  });

  it('marks unmeasurable checks unknown instead of failing them', () => {
    const bare = run({});
    expect(bare.checks.every((c) => ['unknown', 'fail', 'warn', 'pass'].includes(c.state))).toBe(true);
    expect(bare.checks.filter((c) => c.state === 'unknown').length).toBeGreaterThanOrEqual(3);
  });
});

describe('the verdict is blunt on purpose', () => {
  it('counts the blocking problems rather than issuing a score out of 100', () => {
    // "73/100" invites an argument about the 73. "2 việc đang chặn" invites
    // someone to go and fix two things.
    const r = run({
      reviews: Array.from({ length: 4 }, () => review(200, 5, false)),
      sources: { google: 1, walkin: 60 },
    });
    expect(r.failing).toBeGreaterThan(0);
    expect(r.headline).toMatch(/đang chặn/);
    expect(JSON.stringify(r)).not.toMatch(/\/100/);
  });

  it('says so plainly when nothing is broken', () => {
    const r = run({
      reviews: Array.from({ length: 60 }, () => review(5, 5, true)),
      keywords: [{ keyword: 'pedicure', count: 10 }],
      services: [{ name: 'Pedicure' }],
      sources: { google: 40, walkin: 30 },
    });
    expect(r.failing).toBe(0);
    expect(r.headline).toMatch(/đang ổn/);
  });

  it('gives every failing check exactly one next action', () => {
    const r = run({ reviews: Array.from({ length: 3 }, () => review(300, 2, false)) });
    for (const c of r.checks.filter((x) => x.state === 'fail')) {
      expect(c.action.length).toBeGreaterThan(15);
      expect(c.why.length).toBeGreaterThan(20);
    }
  });
});
