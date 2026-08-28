import { writeKind, successText, cacheable, cacheKey, GetCache, GET_TTL_MS } from './api-feedback';

describe('which taps earn a receipt', () => {
  it.each([
    ['POST', '/messenger/threads/t1/labels'],
    ['POST', '/messenger/threads/t1/followup'],
    ['POST', '/messenger/labels'],
    ['PATCH', '/salon/settings'],
    ['DELETE', '/services/s1'],
    ['POST', '/messenger/send'],
  ])('%s %s announces', (m, p) => {
    expect(writeKind(m, p)).toBe('announce');
  });

  // The distinction this module exists for: a receipt for something nobody did
  // is noise, and noise trains people to ignore the receipt that matters.
  it.each([
    ['POST', '/messenger/threads/t1/read'],   // fires on every conversation open
    ['POST', '/push/subscribe'],              // background re-subscription
    ['POST', '/auth/login'],                  // has its own full-page outcome
  ])('%s %s stays silent', (m, p) => {
    expect(writeKind(m, p)).toBe('silent');
  });

  it('GET never announces, whatever the path', () => {
    expect(writeKind('GET', '/messenger/threads')).toBe('silent');
  });

  it('a query string does not smuggle a silent path past the check', () => {
    expect(writeKind('POST', '/salon/settings?redirect=/read')).toBe('announce');
  });
});

describe('what the receipt says', () => {
  it('a sent message says sent — "saved" would be a lie about where it went', () => {
    expect(successText('/messenger/send', true)).toBe('Đã gửi');
  });
  it('a delete says deleted', () => {
    expect(successText('/messenger/threads/t/notes/n/delete', true)).toBe('Đã xoá');
  });
  it('everything else says saved', () => {
    expect(successText('/salon/settings', true)).toBe('Đã lưu');
    expect(successText('/salon/settings', false)).toBe('Saved');
  });
});

describe('what may be answered from memory', () => {
  it('plain GETs cache', () => {
    expect(cacheable('GET', '/services')).toBe(true);
    expect(cacheable('GET', '/messenger/threads')).toBe(true);
  });
  it('writes never cache', () => {
    expect(cacheable('POST', '/services')).toBe(false);
  });
  it('streams, health and file downloads never cache', () => {
    expect(cacheable('GET', '/messenger/stream')).toBe(false);
    expect(cacheable('GET', '/healthz')).toBe(false);
    expect(cacheable('GET', '/invoices/export')).toBe(false);
  });
});

describe('the cache itself', () => {
  it('answers within the TTL and forgets after it', () => {
    const c = new GetCache();
    c.set('k', { a: 1 }, 1_000);
    expect(c.get('k', 1_000 + GET_TTL_MS - 1)).toEqual({ hit: true, data: { a: 1 } });
    expect(c.get('k', 1_000 + GET_TTL_MS + 1).hit).toBe(false);
  });

  // The rule that keeps the cache HONEST: after any write, every screen shows
  // the saved world. Selective invalidation is a graph nobody maintains.
  it('one write wipes everything', () => {
    const c = new GetCache();
    c.set('a', 1); c.set('b', 2);
    c.clear();
    expect(c.get('a').hit).toBe(false);
    expect(c.get('b').hit).toBe(false);
  });

  it('never grows without bound over a long shift', () => {
    const c = new GetCache();
    for (let i = 0; i < 500; i += 1) c.set(`k${i}`, i);
    expect(c.size).toBeLessThanOrEqual(201);
  });
});

describe('one identity never reads another identity’s cache', () => {
  it('different tokens, different keys', () => {
    expect(cacheKey('/services', 'aaaa.bbbb.cccc-salon-A', null))
      .not.toBe(cacheKey('/services', 'aaaa.bbbb.cccc-salon-B', null));
  });
  it('different branches, different keys', () => {
    expect(cacheKey('/services', 'tok', 'branch-1')).not.toBe(cacheKey('/services', 'tok', 'branch-2'));
  });
  it('the whole JWT is not embalmed in the key', () => {
    const jwt = 'header.payload.signature-abcdefghijklmnop';
    expect(cacheKey('/x', jwt, null)).not.toContain('header.payload');
  });
});
