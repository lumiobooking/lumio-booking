import { isForbiddenHost, htmlToText, readWebsite, SiteReadError } from './site-reader';

describe('the server refuses to fetch its own network', () => {
  it('blocks loopback, link-local and every private range', () => {
    // This fetch runs from OUR server. Without this check, whoever can set the
    // URL can read the private network back through the response.
    for (const h of [
      'localhost', '127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.169.254',
      '172.16.0.1', '172.31.255.255', '0.0.0.0',
    ]) {
      expect(isForbiddenHost(h)).toBe(true);
    }
  });

  it('blocks a bare IP and anything carrying a port', () => {
    expect(isForbiddenHost('8.8.8.8')).toBe(true);
    expect(isForbiddenHost('example.com:8080')).toBe(true);
    expect(isForbiddenHost('')).toBe(true);
  });

  it('allows ordinary public hostnames', () => {
    for (const h of ['lumiobooking.com', 'www.familysmarthomes.com', 'sub.example.co.uk']) {
      expect(isForbiddenHost(h)).toBe(false);
    }
    // 172.32 is outside the private block — the boundary is worth pinning.
    expect(isForbiddenHost('172.32.0.1')).toBe(true); // bare IPv4, still refused
  });

  it('refuses a private address before making any request', async () => {
    const spy = jest.spyOn(globalThis, 'fetch' as never);
    await expect(readWebsite('http://127.0.0.1/admin')).rejects.toThrow(SiteReadError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses anything that is not http(s)', async () => {
    await expect(readWebsite('file:///etc/passwd')).rejects.toThrow(/https:\/\//);
    await expect(readWebsite('notaurl')).rejects.toThrow(/https:\/\//);
  });
});

describe('a page is reduced to readable words', () => {
  it('drops scripts, styles and tags', () => {
    const html = '<html><head><style>a{color:red}</style><script>alert(1)</script></head>'
      + '<body><h1>Lumio&nbsp;Agency</h1><p>Marketing cho người Việt</p></body></html>';
    const text = htmlToText(html);
    expect(text).toContain('Lumio');
    expect(text).toContain('Marketing cho người Việt');
    expect(text).not.toMatch(/alert|color:red|<[a-z]/i);
  });

  it('collapses whitespace so the size limit measures words, not indentation', () => {
    expect(htmlToText('<p>a</p>\n\n\n   <p>b</p>')).toBe('a b');
  });

  it('caps the length', () => {
    expect(htmlToText(`<p>${'x'.repeat(50_000)}</p>`, 100).length).toBe(100);
  });
});

describe('a site that blocks bots gets a useful message, not a status code', () => {
  it('names the two things a person can do instead', async () => {
    jest.spyOn(globalThis, 'fetch' as never).mockResolvedValue({
      ok: false, status: 403, text: async () => '',
    } as never);
    // The message must contain the alternatives, because "403" tells the owner
    // of a working website nothing they can act on.
    await expect(readWebsite('https://example.com')).rejects.toThrow(/Fanpage/);
    await expect(readWebsite('https://example.com')).rejects.toThrow(/Ctrl\+A/);
  });

  it('tries the www twin when the bare host is walled, and never confesses to being a robot', async () => {
    const urls: string[] = [];
    const agents: string[] = [];
    jest.spyOn(globalThis, 'fetch' as never).mockImplementation((async (u: string, init: { headers?: Record<string, string> }) => {
      urls.push(String(u));
      agents.push(String(init?.headers?.['user-agent'] ?? ''));
      return urls.length === 1
        ? { ok: false, status: 403, text: async () => '' }
        : { ok: true, status: 200, text: async () => '<p>Chúng tôi làm dịch vụ marketing cho doanh nghiệp của người Việt tại Mỹ.</p>' };
    }) as never);
    const r = await readWebsite('https://example.com');
    expect(r.text).toContain('marketing');
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('//example.com');
    expect(urls[1]).toContain('//www.example.com');
    // The old code retried as "LumioBot/1.0". Nothing that just refused a
    // suspicious browser admits a self-declared crawler — both attempts are
    // the same browser now.
    for (const a of agents) {
      expect(a).toMatch(/Chrome/);
      expect(a).not.toMatch(/LumioBot/i);
    }
  });

  it('sends the client-hint and Sec-Fetch headers whose absence was the 403', async () => {
    let sent: Record<string, string> = {};
    jest.spyOn(globalThis, 'fetch' as never).mockImplementation((async (_u: string, init: { headers?: Record<string, string> }) => {
      sent = init?.headers ?? {};
      return { ok: true, status: 200, text: async () => '<p>Chúng tôi làm dịch vụ marketing cho doanh nghiệp của người Việt tại Mỹ.</p>' };
    }) as never);
    await readWebsite('https://example.com');
    expect(sent['sec-ch-ua']).toContain('Google Chrome');
    expect(sent['sec-fetch-mode']).toBe('navigate');
    expect(sent['upgrade-insecure-requests']).toBe('1');
  });

  it('rejects a page with almost no words rather than returning noise', async () => {
    jest.spyOn(globalThis, 'fetch' as never).mockResolvedValue({
      ok: true, status: 200, text: async () => '<html><body> </body></html>',
    } as never);
    await expect(readWebsite('https://example.com')).rejects.toThrow(/không có đủ chữ/);
  });

  it('names the host it read, so the reviewer knows the source', async () => {
    jest.spyOn(globalThis, 'fetch' as never).mockResolvedValue({
      ok: true, status: 200,
      text: async () => '<p>Dịch vụ marketing cho doanh nghiệp người Việt tại Mỹ, hơn bốn mươi chữ để vượt ngưỡng đọc.</p>',
    } as never);
    const r = await readWebsite('https://lumiobooking.com/about');
    expect(r.source).toContain('lumiobooking.com');
  });
});
