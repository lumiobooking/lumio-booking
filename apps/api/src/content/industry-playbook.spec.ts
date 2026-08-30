import { playbookFor, videoFeeds, productWatch } from './industry-playbook';
import { regionEvents } from './region-events';

const TRADES = ['SALON', 'RESTAURANT', 'REAL_ESTATE', 'SERVICE'] as const;

describe('every trade has its own playbook, not a relabelled nail one', () => {
  it.each(TRADES)('%s names real filming sources with a time attached', (t) => {
    const p = playbookFor(t);
    expect(p.dailySources.length).toBeGreaterThanOrEqual(3);
    for (const s of p.dailySources) {
      expect(s.label.length).toBeGreaterThan(5);
      expect(s.when.length).toBeGreaterThan(3);
      expect(s.why.length).toBeGreaterThan(15);
    }
  });

  it.each(TRADES)('%s gives three posts with three different jobs', (t) => {
    const p = playbookFor(t);
    expect(p.postTypes).toHaveLength(3);
    expect(new Set(p.postTypes.map((x) => x.job)).size).toBe(3);
    for (const pt of p.postTypes) expect(pt.shots).toContain('·'); // shots in order
  });

  it('does not leak nail vocabulary into other trades', () => {
    for (const t of ['RESTAURANT', 'REAL_ESTATE'] as const) {
      const text = JSON.stringify(playbookFor(t));
      expect(text).not.toMatch(/móng|nail/i);
    }
  });

  it('falls back to the salon playbook rather than returning nothing', () => {
    expect(playbookFor('SOMETHING_NEW').trade).toBe(playbookFor('SALON').trade);
    expect(playbookFor(null).dailySources.length).toBeGreaterThan(0);
  });
});

describe('video feeds are feeds, never individual clips', () => {
  it.each(TRADES)('%s gets several real feed pages', (t) => {
    const f = videoFeeds(t);
    expect(f.length).toBeGreaterThanOrEqual(3);
    for (const l of f) {
      const u = new URL(l.url);
      expect(['www.tiktok.com', 'www.youtube.com']).toContain(u.host);
      // A link to one video would have to be invented, and would rot in a week.
      expect(l.url).not.toMatch(/\/video\/\d/);
      expect(l.url).not.toMatch(/watch\?v=/);
      expect(l.how.length).toBeGreaterThan(20);
    }
  });

  it('sends each trade to its own hashtags', () => {
    expect(videoFeeds('SALON').some((l) => l.url.includes('nail'))).toBe(true);
    expect(videoFeeds('RESTAURANT').some((l) => l.url.includes('food'))).toBe(true);
    expect(videoFeeds('REAL_ESTATE').some((l) => /realestate|housetour/.test(l.url))).toBe(true);
    expect(videoFeeds('RESTAURANT').some((l) => l.url.includes('nail'))).toBe(false);
  });

  it('gives every feed a unique key', () => {
    const keys = videoFeeds('SALON').map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('product watch ranks by something real, and claims nothing', () => {
  it('links to pages that compute the ranking themselves', () => {
    const p = productWatch('SALON');
    expect(p.length).toBeGreaterThan(0);
    for (const l of p) {
      expect(['www.amazon.com', 'trends.google.com']).toContain(new URL(l.url).host);
      expect(l.what.length).toBeGreaterThan(20);
    }
  });

  it('never names a product as trending', () => {
    for (const t of TRADES) {
      for (const l of productWatch(t)) {
        // Naming a product here would be a claim that goes stale in days and
        // cannot be checked by clicking. The ranking on the page does the
        // claiming instead.
        expect(l.title).not.toMatch(/đang hot|bán chạy nhất năm|số 1/i);
      }
    }
  });

  it('gives an empty list rather than a fake one when a trade has no good source', () => {
    // SERVICE is deliberately empty: there is no honest public ranking for
    // "local services", and inventing one would be worse than a blank section.
    expect(productWatch('SERVICE')).toEqual([]);
  });
});

describe('state holidays differ between states, which is the whole point', () => {
  const at = (day: string, region: string) =>
    regionEvents(new Date(`${day}T12:00:00Z`), { market: 'US', region }, { horizonDays: 200 })
      .events.map((e) => e.name);

  it('gives Louisiana Mardi Gras and Massachusetts nothing of the kind', () => {
    expect(at('2027-01-05', 'LA')).toContain('Mardi Gras');
    expect(at('2027-01-05', 'MA')).not.toContain('Mardi Gras');
  });

  it('computes Mardi Gras as 47 days before Easter, so it never drifts', () => {
    // Easter 2027 is 28 March; Mardi Gras is therefore 9 February.
    const e = regionEvents(new Date('2027-01-05T12:00:00Z'), { market: 'US', region: 'LA' }, { horizonDays: 200 })
      .events.find((x) => x.name === 'Mardi Gras');
    expect(e?.date).toBe('2027-02-09');
  });

  it('gives Utah Pioneer Day and Hawaii its own two days', () => {
    expect(at('2027-06-01', 'UT')).toContain('Pioneer Day');
    expect(at('2027-06-01', 'HI')).toContain('King Kamehameha Day');
    expect(at('2027-06-01', 'UT')).not.toContain('King Kamehameha Day');
  });

  it('gives a salon with no state none of them', () => {
    const nowhere = regionEvents(new Date('2027-01-05T12:00:00Z'), { market: 'US' }, { horizonDays: 200 })
      .events.map((e) => e.name);
    expect(nowhere).not.toContain('Mardi Gras');
    expect(nowhere).not.toContain('Pioneer Day');
    // But the nationwide ones still show — a salon is not left with an empty list.
    expect(nowhere.length).toBeGreaterThan(2);
  });

  it('includes the Super Bowl, which behaves like a holiday for a local shop', () => {
    const e = regionEvents(new Date('2027-01-05T12:00:00Z'), { market: 'US', region: 'CA' }, { horizonDays: 200 })
      .events.find((x) => x.name === 'Super Bowl');
    expect(e?.date).toBe('2027-02-14'); // second Sunday of February
    expect(e?.note).toMatch(/thứ 6 và thứ 7/);
  });

  it('marks state holidays as regional so the screen can label them', () => {
    const e = regionEvents(new Date('2027-01-05T12:00:00Z'), { market: 'US', region: 'LA' }, { horizonDays: 200 })
      .events.find((x) => x.name === 'Mardi Gras');
    expect(e?.scope).toBe('regional');
  });
});
