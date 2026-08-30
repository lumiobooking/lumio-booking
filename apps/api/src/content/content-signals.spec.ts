import {
  audienceSignal, buildSignalProfile, keywordSignals, postSignals,
  serviceSignals, signalsToPrompt,
} from './content-signals';

describe('local search demand', () => {
  it('spots a rising keyword and states the real percentage', () => {
    const out = keywordSignals(
      [{ keyword: 'dip powder near me', count: 69 }],
      [{ keyword: 'dip powder near me', count: 50 }],
    );
    expect(out[0].trend).toBe('up');
    expect(out[0].pct).toBe(38);
  });

  it('refuses to turn noise into a trend — small numbers are dropped', () => {
    // "3 impressions became 9" is a 200% rise and means nothing.
    expect(keywordSignals([{ keyword: 'x', count: 3 }], [{ keyword: 'x', count: 1 }])).toEqual([]);
  });

  it('a keyword with no previous month is "new", never a fake percentage', () => {
    const out = keywordSignals([{ keyword: 'chrome nails', count: 20 }], []);
    expect(out[0].trend).toBe('new');
    expect(out[0].pct).toBeNull();
  });

  it('a tiny previous month gives direction but no percentage', () => {
    const out = keywordSignals([{ keyword: 'k', count: 40 }], [{ keyword: 'k', count: 2 }]);
    expect(out[0].trend).toBe('up');
    expect(out[0].pct).toBeNull(); // dividing by 2 would print "1900%"
  });

  it('rising keywords outrank merely large ones', () => {
    const out = keywordSignals(
      [{ keyword: 'big steady', count: 200 }, { keyword: 'climbing', count: 40 }],
      [{ keyword: 'big steady', count: 200 }, { keyword: 'climbing', count: 20 }],
    );
    expect(out[0].keyword).toBe('climbing');
  });

  it('survives nulls and blanks without throwing', () => {
    expect(keywordSignals(null, null)).toEqual([]);
    expect(keywordSignals([{ keyword: '  ', count: 99 }], null)).toEqual([]);
  });
});

describe('what the salon is actually selling', () => {
  it('flags a service that is climbing', () => {
    const out = serviceSignals([{ name: 'Dipping Powder', count: 24 }], [{ name: 'Dipping Powder', count: 15 }]);
    expect(out[0].trend).toBe('up');
    expect(out[0].pct).toBe(60);
  });
  it('a brand-new service reads as new, not as infinite growth', () => {
    const out = serviceSignals([{ name: 'Chrome Add-on', count: 8 }], []);
    expect(out[0].trend).toBe('new');
    expect(out[0].pct).toBeNull();
  });
  it('one-off bookings are ignored', () => {
    expect(serviceSignals([{ name: 'Rare thing', count: 1 }], [])).toEqual([]);
  });
});

describe('which format this audience watches', () => {
  const reels = [
    { type: 'reel', views: 1400, likes: 7, comments: 0, caption: 'a busy day' },
    { type: 'video', views: 1100, likes: 5, comments: 0, caption: 'dry heels' },
  ];
  const photos = [
    { type: 'photo', views: 300, likes: 4, comments: 1, caption: 'set of the day' },
    { type: 'image', views: 260, likes: 2, comments: 0, caption: 'pedicure' },
  ];

  it('calls the winner and the multiple', () => {
    const s = postSignals([...reels, ...photos]);
    expect(s.verdict).toBe('reel-wins');
    expect(s.multiple).toBeGreaterThan(3);
  });

  it('will not call a winner from one post of each kind', () => {
    expect(postSignals([reels[0], photos[0]]).verdict).toBe('not-enough-data');
  });

  it('says "too close" instead of manufacturing a difference', () => {
    const s = postSignals([
      { type: 'reel', views: 100 }, { type: 'reel', views: 110 },
      { type: 'photo', views: 95 }, { type: 'photo', views: 100 },
    ]);
    expect(s.verdict).toBe('too-close');
    expect(s.multiple).toBeNull();
  });

  it('surfaces the best posts so the AI can reuse what worked', () => {
    const s = postSignals([...reels, ...photos]);
    expect(s.topPosts[0].views).toBe(1400);
    expect(s.topPosts[0].caption).toContain('busy day');
  });

  it('an empty feed is honest about it', () => {
    expect(postSignals([]).verdict).toBe('not-enough-data');
    expect(postSignals(null).reel.posts).toBe(0);
  });
});

describe('who follows this salon', () => {
  it('reports the dominant age band and gender split', () => {
    const a = audienceSignal({ age: { '18-24': 30, '25-34': 40, '35-44': 10 }, gender: { F: 71, M: 29 } });
    expect(a.topAgeBand).toBe('25-34');
    expect(a.topAgePct).toBe(50);
    expect(a.femalePct).toBe(71);
    expect(a.basis).toBe('instagram');
  });
  it('no data means no claim', () => {
    expect(audienceSignal(null).basis).toBe('none');
    expect(audienceSignal({}).topAgeBand).toBeNull();
  });
});

describe('the seasonal calendar has moved out of this file', () => {
  it('is no longer exported from here', () => {
    // It lived here as one hardcoded list for the whole platform, with Tết
    // pinned to 17 February — right for 2026, wrong every year after. The
    // region-aware version in region-events.ts replaced it, and this module
    // must not keep a second copy: two calendars in one prompt is how a model
    // quotes the wrong Tết date with total confidence.
    const mod = require('./content-signals') as Record<string, unknown>;
    expect(mod.seasonEvents).toBeUndefined();
  });

  it('leaves events out of the signal profile entirely', () => {
    const p = buildSignalProfile({ today: new Date('2026-08-30T00:00:00Z') });
    expect('events' in p).toBe(false);
  });

  it('does not print an events section in the prompt', () => {
    const text = signalsToPrompt(buildSignalProfile({ today: new Date('2026-08-30T00:00:00Z') }));
    expect(text).not.toContain('SỰ KIỆN SẮP TỚI');
  });
});

describe('the whole profile, as the AI receives it', () => {
  const full = buildSignalProfile({
    keywordsNow: [{ keyword: 'dip powder near me', count: 69 }],
    keywordsPrev: [{ keyword: 'dip powder near me', count: 50 }],
    servicesNow: [{ name: 'Dipping Powder', count: 24 }],
    servicesPrev: [{ name: 'Dipping Powder', count: 15 }],
    posts: [
      { type: 'reel', views: 1400, likes: 7 }, { type: 'reel', views: 1100, likes: 5 },
      { type: 'photo', views: 300, likes: 4 }, { type: 'photo', views: 260, likes: 2 },
    ],
    audience: { age: { '25-34': 40, '18-24': 30 }, gender: { F: 71, M: 29 } },
    today: new Date('2026-08-30T00:00:00Z'),
  });

  it('carries every real number into the prompt', () => {
    const p = signalsToPrompt(full);
    expect(p).toContain('dip powder near me');
    expect(p).toContain('tăng 38%');
    expect(p).toContain('Dipping Powder');
    expect(p).toContain('Reel/video ăn hơn bài ảnh');
    expect(p).toContain('25-34');
    // Events moved to region-events.ts and are appended by eventsToPrompt.
    expect(p).not.toContain('Tựu trường');
    expect(full.thin).toBe(false);
  });

  it('a brand-new salon is flagged thin, and the prompt FORBIDS inventing numbers', () => {
    const empty = buildSignalProfile({ today: new Date('2026-06-15T00:00:00Z') });
    expect(empty.thin).toBe(true);
    const p = signalsToPrompt(empty);
    expect(p).toMatch(/chưa có đủ dữ liệu/);
    expect(p).toMatch(/không bịa/i);
  });

  it('never crashes on a completely empty input', () => {
    expect(() => signalsToPrompt(buildSignalProfile({}))).not.toThrow();
  });
});
