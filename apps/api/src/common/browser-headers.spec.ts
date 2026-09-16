import { browserHeaders, CHROME_MAJOR, isWall, urlVariants, wallMessage } from './browser-headers';

describe('headers that a bot wall does not flag', () => {
  const h = browserHeaders();

  it('carries the Sec-Fetch and client-hint headers a real Chrome always sends', () => {
    for (const k of ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site', 'upgrade-insecure-requests']) {
      expect(h[k]).toBeTruthy();
    }
  });

  it('keeps the user-agent and sec-ch-ua on the SAME version — the mismatch is what gets blocked', () => {
    expect(h['user-agent']).toContain(`Chrome/${CHROME_MAJOR}.0.0.0`);
    expect(h['sec-ch-ua']).toContain(`"Google Chrome";v="${CHROME_MAJOR}"`);
    expect(h['sec-ch-ua']).toContain(`"Chromium";v="${CHROME_MAJOR}"`);
  });

  it('is not two years out of date', () => {
    // Chrome was on 153 in September 2026. A reader claiming 126 is a flag by
    // itself; this guards against the constant being forgotten again.
    expect(CHROME_MAJOR).toBeGreaterThanOrEqual(150);
  });

  it('never announces itself as a robot', () => {
    const all = JSON.stringify(h).toLowerCase();
    for (const word of ['bot', 'crawler', 'spider', 'lumio']) expect(all).not.toContain(word);
  });

  it('sends no referer — Chrome sends none for a typed address', () => {
    expect(h.referer).toBeUndefined();
    expect(h.referrer).toBeUndefined();
  });
});

describe('trying the other host', () => {
  it('tries the address as given FIRST, then the www twin', () => {
    expect(urlVariants('https://familysmarthomes.com')).toEqual([
      'https://familysmarthomes.com/', 'https://www.familysmarthomes.com/',
    ]);
    expect(urlVariants('https://www.familysmarthomes.com')).toEqual([
      'https://www.familysmarthomes.com/', 'https://familysmarthomes.com/',
    ]);
  });

  it('does not invent a host for a deep subdomain', () => {
    expect(urlVariants('https://shop.pages.example.com/x')).toHaveLength(1);
  });

  it('keeps the path and the query', () => {
    expect(urlVariants('https://example.com/about?x=1')[1]).toBe('https://www.example.com/about?x=1');
  });

  it('hands back junk unchanged rather than throwing inside a sweep', () => {
    expect(urlVariants('not a url')).toEqual(['not a url']);
    expect(urlVariants('')).toEqual([]);
  });
});

describe('what the person is told', () => {
  it('says the site blocks servers, not that they did something wrong', () => {
    const m = wallMessage(403, true);
    expect(m).toContain('chặn máy chủ');
    expect(m).toContain('Ctrl+A');
    expect(m).toContain('Fanpage');
  });

  it('treats every wall status the same way, including a rate limit', () => {
    for (const s of [401, 403, 406, 429, 503]) {
      expect(isWall(s)).toBe(true);
      expect(wallMessage(s, true)).toContain('Ctrl+A');
    }
  });

  it('tells a missing page apart from a wall', () => {
    expect(isWall(404)).toBe(false);
    expect(wallMessage(404, true)).toContain('Không tìm thấy');
    expect(wallMessage(404, false)).toContain('not found');
  });

  it('says something useful when there was no status at all', () => {
    expect(wallMessage(null, true)).toContain('Không tải được');
  });
});
