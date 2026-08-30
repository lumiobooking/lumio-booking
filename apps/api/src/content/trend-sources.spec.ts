import { trendLinks, trendsGeo, profileFor, trendLinksToPrompt, topicsFor } from './trend-sources';

const SALON = {
  industry: 'SALON', market: 'US', region: 'CA', city: 'Garden Grove',
  services: [{ name: 'Dipping Powder', count: 24 }, { name: 'Gel X', count: 18 }, { name: 'Pedicure', count: 12 }],
  keywords: [{ keyword: 'dip powder near me', count: 69 }],
  events: [{ name: 'Tựu trường', daysAway: 9, note: 'Mẹ và con gái làm móng trước ngày đi học' }],
};

const all = (i: Parameters<typeof trendLinks>[0]) => {
  const r = trendLinks(i);
  return [...r.weekly, ...r.monthly];
};

describe('every link is a real, reachable tool', () => {
  const links = all({ industry: 'SALON', market: 'US', region: 'CA' });

  it('produces 3-5 links in each set', () => {
    const r = trendLinks({ industry: 'SALON', market: 'US', region: 'CA' });
    expect(r.weekly.length).toBeGreaterThanOrEqual(3);
    expect(r.weekly.length).toBeLessThanOrEqual(5);
    expect(r.monthly.length).toBeGreaterThanOrEqual(3);
    expect(r.monthly.length).toBeLessThanOrEqual(5);
    expect(r.weekly.every((l) => l.cadence === 'weekly')).toBe(true);
    expect(r.monthly.every((l) => l.cadence === 'monthly')).toBe(true);
  });

  it('points only at the four verified domains', () => {
    // Checked by hand before wiring: each base URL resolves and keeps its
    // query parameters through the vendor's redirects.
    const OK = ['ads.tiktok.com', 'trends.google.com', 'www.facebook.com', 'trends.pinterest.com'];
    for (const l of links) {
      const host = new URL(l.url).host;
      expect(OK).toContain(host);
      expect(l.url.startsWith('https://')).toBe(true);
    }
  });

  it('never links to an individual video — those would be invented', () => {
    for (const l of links) {
      expect(l.url).not.toMatch(/tiktok\.com\/@/);
      expect(l.url).not.toMatch(/\/video\/\d/);
      expect(l.url).not.toMatch(/youtu\.?be/);
    }
  });

  it('tells the salon what to DO with each page, not just to open it', () => {
    for (const l of links) {
      expect(l.what.length).toBeGreaterThan(20);
      expect(l.how.length).toBeGreaterThan(20);
    }
  });

  it('gives every link a distinct key so the UI can track clicks', () => {
    const keys = links.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('geography is applied, and the CA trap is avoided', () => {
  it('scopes Google Trends to the state when it is known', () => {
    expect(trendsGeo('US', 'CA')).toBe('US-CA');
    expect(trendsGeo('US', 'TX')).toBe('US-TX');
  });

  it('does not confuse Canada with California', () => {
    // "CA" is California inside the US and Canada at the top level. A Toronto
    // salon asking for US-CA would silently be shown California.
    expect(trendsGeo('CA', 'ON')).toBe('CA-ON');
    expect(trendsGeo('CA', null)).toBe('CA');
    expect(trendsGeo('US', null)).toBe('US');
  });

  it('falls back to the whole country when the salon has no address', () => {
    const r = trendLinks({ industry: 'SALON', market: 'US', region: null });
    expect(r.regionKnown).toBe(false);
    const g = r.weekly.find((l) => l.key === 'gtrends-7')!;
    expect(decodeURIComponent(new URL(g.url).searchParams.get('geo') || '')).toBe('US');
  });

  it('sends the right country code to TikTok and Meta', () => {
    const vn = all({ industry: 'SALON', market: 'VN' });
    expect(vn.find((l) => l.key === 'tiktok-7')!.url).toContain('countryCode=VN');
    expect(vn.find((l) => l.key === 'meta-ads')!.url).toContain('country=VN');
  });

  it('asks Google Trends for the right window', () => {
    const l = all({ market: 'US', region: 'CA' });
    const week = new URL(l.find((x) => x.key === 'gtrends-7')!.url).searchParams.get('date');
    const month = new URL(l.find((x) => x.key === 'gtrends-compare')!.url).searchParams.get('date');
    expect(week).toBe('now 7-d');
    expect(month).toBe('today 1-m');
  });
});

describe('the search terms match the trade', () => {
  it('asks about nails for a salon and houses for an agency', () => {
    const salon = new URL(all({ industry: 'SALON', market: 'US', region: 'CA' }).find((l) => l.key === 'gtrends-7')!.url);
    expect(salon.searchParams.get('q')).toMatch(/nail/i);
    const re = new URL(all({ industry: 'REAL_ESTATE', market: 'US', region: 'CA' }).find((l) => l.key === 'gtrends-7')!.url);
    expect(re.searchParams.get('q')).toMatch(/home|house/i);
  });

  it('falls back to salon terms for an unknown trade rather than breaking', () => {
    expect(profileFor('SOMETHING_NEW').trade).toBe(profileFor('SALON').trade);
    expect(profileFor(null).terms.length).toBeGreaterThan(0);
  });
});

describe('the model is kept away from URLs', () => {
  it('forbids inventing links, clip names, songs or view counts', () => {
    const p = trendLinksToPrompt();
    expect(p).toMatch(/KHÔNG tự bịa link/);
    expect(p).toMatch(/lượt xem/);
  });

  it('hands the model no URL to copy', () => {
    expect(trendLinksToPrompt()).not.toMatch(/https?:\/\//);
  });
});

describe('the topics come from what we actually know about this salon', () => {
  it('leads with the salon’s own services, not the trade’s generic list', () => {
    const t = topicsFor(SALON);
    expect(t[0].label).toBe('Dipping Powder');
    expect(t[0].from).toBe('salon');
    expect(t[0].why).toContain('24');
  });

  it('uses the words customers actually typed into Google', () => {
    const t = topicsFor(SALON);
    const kw = t.find((x) => x.label === 'dip powder near me');
    expect(kw).toBeTruthy();
    expect(kw!.why).toMatch(/chữ của khách/);
  });

  it('brings in what the region is walking into, with the days attached', () => {
    const t = topicsFor({ ...SALON, services: [], keywords: [] });
    const ev = t.find((x) => x.from === 'region');
    expect(ev?.label).toBe('Tựu trường');
    expect(ev?.why).toContain('9 ngày');
    expect(ev?.why).toMatch(/trước dịp/);
  });

  it('falls back to trade angles for a salon that opened on Monday', () => {
    const t = topicsFor({ industry: 'SALON', market: 'US' });
    expect(t.length).toBeGreaterThan(0);
    expect(t.every((x) => x.from === 'trade')).toBe(true);
  });

  it('gives a real-estate agency its own angles, not nail ones', () => {
    const t = topicsFor({ industry: 'REAL_ESTATE', market: 'US' });
    expect(t.some((x) => /nhà|mua/i.test(x.label + x.why))).toBe(true);
    expect(t.some((x) => /móng/i.test(x.label))).toBe(false);
  });

  it('never states that something IS trending — only what to look for', () => {
    for (const t of topicsFor(SALON)) {
      expect(t.label).not.toMatch(/đang trending|viral|triệu view/i);
      expect(t.why.length).toBeGreaterThan(20);
    }
  });

  it('puts topics on every link, even for a salon with no data', () => {
    const r = trendLinks({ industry: 'SALON', market: 'US' });
    for (const l of [...r.weekly, ...r.monthly]) expect(l.topics.length).toBeGreaterThan(0);
  });

  it('puts topics on every link, tailored per link', () => {
    const r = trendLinks(SALON);
    for (const l of [...r.weekly, ...r.monthly]) {
      expect(l.topics.length).toBeGreaterThan(0);
      for (const t of l.topics) expect(t.why.length).toBeGreaterThan(15);
    }
  });
});

describe('the salon’s own numbers steer the queries', () => {
  it('asks Google Trends about the service the salon actually sells most', () => {
    const g = trendLinks(SALON).weekly.find((l) => l.key === 'gtrends-7')!;
    expect(new URL(g.url).searchParams.get('q')).toBe('Dipping Powder');
  });

  it('compares the salon’s services side by side, not four generic terms', () => {
    const c = trendLinks(SALON).monthly.find((l) => l.key === 'gtrends-compare')!;
    const q = new URL(c.url).searchParams.get('q') || '';
    expect(q).toContain('Dipping Powder');
    expect(q).toContain('Gel X');
    expect(q.split(',').length).toBeLessThanOrEqual(5); // Google Trends caps at 5
  });

  it('searches the ad library for competitors in this salon’s own city', () => {
    const m = trendLinks(SALON).monthly.find((l) => l.key === 'meta-ads-local')!;
    expect(decodeURIComponent(new URL(m.url).searchParams.get('q') || '')).toContain('Garden Grove');
  });

  it('still produces working links for a salon with no data at all', () => {
    const r = trendLinks({ industry: 'SALON', market: 'US' });
    expect(r.weekly).toHaveLength(5);
    for (const l of [...r.weekly, ...r.monthly]) expect(() => new URL(l.url)).not.toThrow();
  });

  it('asks for the twelve-month shape so seasons are read, not guessed', () => {
    const s = trendLinks(SALON).monthly.find((l) => l.key === 'gtrends-season')!;
    expect(new URL(s.url).searchParams.get('date')).toBe('today 12-m');
    expect(s.how).toMatch(/đang xuống/);
  });
});
