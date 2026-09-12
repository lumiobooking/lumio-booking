import { assessSalon, adsAim, firstAction, REVIEWS_THIN, BOOKINGS_QUIET, SETTLING_DAYS } from './salon-assessment';
import { viOf } from './i18n';

const keys = (s: Parameters<typeof assessSalon>[0]) => assessSalon(s).findings.map((f) => f.key);

/** A salon that has been trading for years and is doing fine. */
const ESTABLISHED = {
  googleConnected: true, googleReviews: 210, googleRating: 4.8,
  fanpageConnected: true, websiteUrl: 'https://x.test', postedLast30: 12,
  menuSize: 24, bookings90: 380, customers: 900, daysWithUs: 400, areaKnown: true,
};

describe('the two salons a single-source reading cannot tell apart', () => {
  it('calls a busy established salon healthy', () => {
    expect(keys(ESTABLISHED)).toEqual(['healthy']);
  });

  it('catches the one being FOUND and not BOOKED — the case reviews alone miss', () => {
    // Same profile strength, same posting, no bookings. The old rule read
    // reviews and posts, so this salon looked identical to the one above.
    const k = keys({ ...ESTABLISHED, bookings90: 2 });
    expect(k).toContain('found-not-booked');
    expect(k).not.toContain('thin-google');   // the profile is not the problem
  });

  it('tells it to fix the path to booking, not to collect more reviews', () => {
    const a = assessSalon({ ...ESTABLISHED, bookings90: 0 });
    const first = firstAction(a)!;
    expect(first.key).toBe('found-not-booked');
    expect(viOf(first.doNext!)).toMatch(/link đặt lịch/);
  });

  it('puts this salon’s own numbers in the reason, not an adjective', () => {
    const a = assessSalon({ ...ESTABLISHED, bookings90: 3 });
    const f = a.findings.find((x) => x.key === 'found-not-booked')!;
    expect(viOf(f.because)).toContain('210');
    expect(viOf(f.because)).toContain('3');
  });
});

describe('it never refuses to answer, whatever is missing', () => {
  it('says something useful about a salon we know nothing about', () => {
    const a = assessSalon({});
    expect(a.findings.length).toBeGreaterThan(0);
    expect(a.findings[0].key).toBe('no-google');
    expect(a.confidence).toBeLessThan(0.3);
  });

  it('reports every source, including the silent ones', () => {
    const a = assessSalon({});
    expect(a.read).toHaveLength(7);
    expect(a.read.every((r) => r.answered === false)).toBe(true);
    // Silence is recorded, never dropped from the list.
    expect(a.read.map((r) => r.source)).toContain('website');
  });

  it('raises confidence as sources answer', () => {
    const bare = assessSalon({}).confidence;
    const full = assessSalon({ ...ESTABLISHED, googlePhotos: 30, googleHours: true }).confidence;
    expect(full).toBeGreaterThan(bare);
    expect(full).toBe(1);
  });
});

describe('the three situations that used to read as "not enough data"', () => {
  it('a salon of nine years that just arrived is judged on its Google profile', () => {
    // No bookings with us at all, because we are four days old to them.
    const k = keys({
      googleConnected: true, googleReviews: 180, postedLast30: 0,
      menuSize: 30, bookings90: 0, daysWithUs: 4, fanpageConnected: true,
      websiteUrl: 'https://x.test', areaKnown: true,
    });
    expect(k).toContain('silent-online');
    expect(k).toContain('too-early-to-judge');
    // It must NOT be accused of not converting — we have not watched long enough.
    expect(k).not.toContain('found-not-booked');
  });

  it('a salon about to open is told to build the profile, not to chase reviews it cannot get', () => {
    const a = assessSalon({ googleConnected: false, googleReviews: 0, bookings90: 0, daysWithUs: 2, menuSize: 12 });
    expect(firstAction(a)!.key).toBe('no-google');
  });

  it('does not call a four-day-old salon quiet', () => {
    const k = keys({ ...ESTABLISHED, bookings90: 0, daysWithUs: 4 });
    expect(k).toContain('too-early-to-judge');
    expect(k).not.toContain('found-not-booked');
  });

  it('does call it quiet once it has had time', () => {
    const k = keys({ ...ESTABLISHED, bookings90: 0, daysWithUs: SETTLING_DAYS + 1 });
    expect(k).toContain('found-not-booked');
  });
});

describe('ordering is dependency, not alphabet', () => {
  it('fixes the missing profile before the missing posts', () => {
    const k = keys({ googleConnected: false, postedLast30: 0, menuSize: 0 });
    expect(k.indexOf('no-google')).toBeLessThan(k.indexOf('no-menu'));
  });

  it('does not tell a salon with no Google profile to post more into it', () => {
    expect(keys({ googleConnected: false, postedLast30: 0 })).not.toContain('silent-online');
  });

  it('names the cheap gaps without calling them emergencies', () => {
    const a = assessSalon({ ...ESTABLISHED, websiteUrl: null, fanpageConnected: false });
    const sev = (k: string) => a.findings.find((f) => f.key === k)?.severity;
    expect(sev('no-website')).toBe('watch');
    expect(sev('no-fanpage')).toBe('watch');
  });

  it('only says healthy when nothing needs fixing', () => {
    expect(keys({ ...ESTABLISHED, menuSize: 0 })).not.toContain('healthy');
  });
});

describe('what the salon\u2019s own profile decides about its ads', () => {
  /**
   * These used to assert that advertising was BLOCKED. It is not any more, and
   * the reason is worth keeping next to the tests: reviews come from customers,
   * customers come from traffic, and advertising is traffic — so "reach twenty
   * reviews, then advertise" asks a shop to wait for the thing advertising
   * produces, and asks a shop opening next month to wait for ever. What the
   * profile can honestly decide is where the click LANDS.
   */
  it('sends the click away from a Google profile the salon does not have', () => {
    const a = adsAim(assessSalon({ googleConnected: false, menuSize: 20, bookings90: 50 }));
    expect(a?.key).toBe('no-google');
  });

  it('does the same for a three-review profile — and still lets the money out', () => {
    const a = adsAim(assessSalon({ googleConnected: true, googleReviews: 3, bookings90: 0, daysWithUs: 200 }));
    expect(a?.key).toBe('thin-google');
    // The sentence an owner reads must not tell them to stop advertising.
    expect(viOf(a!.because)).toMatch(/Vẫn chạy quảng cáo được/);
    expect(viOf(a!.because)).not.toMatch(/đốt tiền/);
  });

  it('points a found-but-not-booked salon at its booking link', () => {
    const a = adsAim(assessSalon({ ...ESTABLISHED, bookings90: 1 }))!;
    expect(a.key).toBe('found-not-booked');
    expect(viOf(a.doNext!)).toMatch(/link đặt lịch/);
  });

  it('says nothing about a missing website or a quiet Page — those are not where the click lands', () => {
    expect(adsAim(assessSalon({ ...ESTABLISHED, websiteUrl: null, fanpageConnected: false, postedLast30: 1 }))).toBeNull();
  });

  it('leaves a healthy salon\u2019s ads pointed wherever they were', () => {
    expect(adsAim(assessSalon(ESTABLISHED))).toBeNull();
  });

  it('does not redirect a salon that is merely too new to read', () => {
    expect(adsAim(assessSalon({ ...ESTABLISHED, bookings90: 0, daysWithUs: 5 }))).toBeNull();
  });

  it('NEVER tells a brand-new salon to wait for reviews before it advertises', () => {
    // The circular case, stated as a test because it is the one that matters
    // most: a shop about to open has no customers, therefore no reviews, and
    // being known is the whole job. It gets an aim, never a refusal.
    const a = adsAim(assessSalon({ googleConnected: true, googleReviews: 0, bookings90: 0, daysWithUs: 2 }));
    expect(a?.key).toBe('thin-google');
    expect(viOf(a!.doNext!)).toMatch(/Xin đánh giá/);
  });
});
});

