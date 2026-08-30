import { trendLinks, trendsGeo, profileFor, trendLinksToPrompt } from './trend-sources';

const all = (i: Parameters<typeof trendLinks>[0]) => {
  const r = trendLinks(i);
  return [...r.weekly, ...r.monthly];
};

describe('every link is a real, reachable tool', () => {
  const links = all({ industry: 'SALON', market: 'US', region: 'CA' });

  it('produces both a weekly and a monthly set', () => {
    const r = trendLinks({ industry: 'SALON', market: 'US', region: 'CA' });
    expect(r.weekly.length).toBeGreaterThanOrEqual(3);
    expect(r.monthly.length).toBeGreaterThanOrEqual(3);
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
    const month = new URL(l.find((x) => x.key === 'gtrends-30')!.url).searchParams.get('date');
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
