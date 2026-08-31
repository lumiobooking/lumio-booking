import { fetchCensus, parseCensus, normaliseZips, describeArea, type FetchLike } from './census';

const reply = (body: string, ok = true, status = 200) =>
  (async () => ({ ok, status, text: async () => body })) as unknown as FetchLike;

const GOOD = JSON.stringify([
  ['NAME', 'DP05_0001E', 'DP03_0062E', 'DP05_0018E', 'zip code tabulation area'],
  ['ZCTA5 92840', '52000', '78000', '34.2', '92840'],
  ['ZCTA5 92841', '30000', '92000', '38.1', '92841'],
]);

describe('the response is read by column name, not by position', () => {
  it('parses a normal reply', () => {
    const rows = parseCensus(GOOD)!;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ zip: '92840', population: 52000, medianHouseholdIncomeUsd: 78000, medianAge: 34.2 });
  });

  it('still works when the server reorders the columns', () => {
    // A positional read that happens to work today breaks silently the day the
    // server changes its mind about column order.
    const shuffled = JSON.stringify([
      ['zip code tabulation area', 'DP03_0062E', 'NAME', 'DP05_0018E', 'DP05_0001E'],
      ['92840', '78000', 'ZCTA5 92840', '34.2', '52000'],
    ]);
    expect(parseCensus(shuffled)![0].medianHouseholdIncomeUsd).toBe(78000);
    expect(parseCensus(shuffled)![0].population).toBe(52000);
  });

  it('returns null on anything that is not the expected shape', () => {
    for (const junk of ['', 'not json', '{}', '[]', '[["NAME"]]', '["a","b"]']) {
      expect(parseCensus(junk)).toBeNull();
    }
  });
});

describe('Census sentinels never reach a screen', () => {
  it('treats -666666666 as missing, not as a number', () => {
    // Rendered as a dollar figure this is minus six hundred million, and one
    // sight of it destroys trust in every other number on the page.
    const body = JSON.stringify([
      ['NAME', 'DP05_0001E', 'DP03_0062E', 'DP05_0018E', 'zip code tabulation area'],
      ['ZCTA5 99999', '1200', '-666666666', '-666666666', '99999'],
    ]);
    const row = parseCensus(body)![0];
    expect(row.medianHouseholdIncomeUsd).toBeNull();
    expect(row.medianAge).toBeNull();
    expect(row.population).toBe(1200);
  });

  it('rejects values outside a believable range', () => {
    const body = JSON.stringify([
      ['NAME', 'DP05_0001E', 'DP03_0062E', 'DP05_0018E', 'zip code tabulation area'],
      ['ZCTA5 12345', '9999999', '5000000', '250', '12345'],
    ]);
    const row = parseCensus(body)![0];
    expect(row.population).toBeNull();
    expect(row.medianHouseholdIncomeUsd).toBeNull();
    expect(row.medianAge).toBeNull();
  });

  it('drops rows whose ZIP is not five digits', () => {
    const body = JSON.stringify([
      ['NAME', 'DP05_0001E', 'DP03_0062E', 'DP05_0018E', 'zip code tabulation area'],
      ['bad', '100', '50000', '30', 'ABCDE'],
    ]);
    expect(parseCensus(body)).toEqual([]);
  });
});

describe('ZIP input is cleaned before it is trusted', () => {
  it('takes five-digit codes from a messy string', () => {
    expect(normaliseZips('92840, 92841 ; 92843')).toEqual(['92840', '92841', '92843']);
  });

  it('drops anything that is not a ZIP, and de-duplicates', () => {
    expect(normaliseZips('92840, 928, abcde, 92840')).toEqual(['92840']);
    expect(normaliseZips(null)).toEqual([]);
  });

  it('caps the list — a hundred ZIPs is somebody’s mistake', () => {
    const many = Array.from({ length: 60 }, (_, i) => String(90000 + i)).join(',');
    expect(normaliseZips(many).length).toBeLessThanOrEqual(12);
  });
});

describe('failure is reported, never faked', () => {
  it('says so plainly when the API refuses, and keeps the reason for the team', () => {
    const r0 = fetchCensus('92840', { fetchImpl: reply('error: unknown variable DP03_0062E', false, 400) });
    return r0.then((r) => {
      expect(r.ok).toBe(false);
      expect(r.zips).toEqual([]);
      expect(r.error).toMatch(/Chưa lấy được dữ liệu dân cư/);
      // The diagnostic is what turns "it broke" into a fix. Salons never see it.
      expect(r.diagnostic).toMatch(/unknown variable/);
    });
  });

  it('survives the network throwing', async () => {
    const boom = (async () => { throw new Error('getaddrinfo ENOTFOUND'); }) as unknown as FetchLike;
    const r = await fetchCensus('92840', { fetchImpl: boom });
    expect(r.ok).toBe(false);
    expect(r.diagnostic).toMatch(/ENOTFOUND/);
  });

  it('asks for an older release when the newest has no data', async () => {
    const tried: string[] = [];
    const impl = (async (u: string) => {
      tried.push(u);
      const ok = u.includes('/2022/');
      return { ok, status: ok ? 200 : 404, text: async () => (ok ? GOOD : 'no data') };
    }) as unknown as FetchLike;
    const r = await fetchCensus('92840,92841', { fetchImpl: impl });
    expect(r.ok).toBe(true);
    expect(r.year).toBe(2022);
    expect(tried[0]).toContain('/2023/');
  });

  it('refuses to call the API with no ZIPs at all', async () => {
    let called = false;
    const impl = (async () => { called = true; return { ok: true, status: 200, text: async () => GOOD }; }) as unknown as FetchLike;
    const r = await fetchCensus('', { fetchImpl: impl });
    expect(called).toBe(false);
    // The message must point the SHOP at a screen the shop can open. It used to
    // say "Super Admin", which is our staff's screen — an instruction the person
    // reading it cannot carry out.
    expect(r.error).toMatch(/ZIP/);
    expect(r.error).toMatch(/Cài đặt tiệm/);
    expect(r.error).not.toMatch(/Super Admin/i);
  });
});

describe('the combined figures are weighted, not averaged', () => {
  it('weights income by population so a tiny ZIP cannot outvote a big one', async () => {
    const r = await fetchCensus('92840,92841', { fetchImpl: reply(GOOD) });
    expect(r.totalPopulation).toBe(82000);
    // (78000·52000 + 92000·30000) / 82000 = 83122, not the plain mean of 85000.
    expect(r.weightedMedianIncomeUsd).toBe(83122);
  });

  it('leaves the combined income null when no ZIP reported one', async () => {
    const body = JSON.stringify([
      ['NAME', 'DP05_0001E', 'DP03_0062E', 'DP05_0018E', 'zip code tabulation area'],
      ['ZCTA5 92840', '52000', '-666666666', '34.2', '92840'],
    ]);
    const r = await fetchCensus('92840', { fetchImpl: reply(body) });
    expect(r.ok).toBe(true);
    expect(r.weightedMedianIncomeUsd).toBeNull();
    expect(r.totalPopulation).toBe(52000);
  });
});

describe('the write-up says what the data supports and no more', () => {
  it('always admits a ZIP is not a five-mile circle', async () => {
    const lines = describeArea(await fetchCensus('92840,92841', { fetchImpl: reply(GOOD) }));
    expect(lines.join(' ')).toMatch(/không phải một vòng tròn 5 dặm/);
  });

  it('reads income as spending capacity, not as identity', async () => {
    const lines = describeArea(await fetchCensus('92840,92841', { fetchImpl: reply(GOOD) })).join(' ');
    expect(lines).toMatch(/nhạy giá|chịu được giá cao/);
    // The Census says what a household earns. It does not say who they are.
    for (const invented of ['phụ nữ', 'dân văn phòng', 'thích', 'ưa chuộng']) {
      expect(lines).not.toContain(invented);
    }
  });

  it('says nothing at all when the fetch failed', async () => {
    expect(describeArea(await fetchCensus('92840', { fetchImpl: reply('nope', false, 500) }))).toEqual([]);
  });
});

describe('the "Missing Key" page is named for what it is', () => {
  it('tells the operator to set CENSUS_API_KEY instead of saying "unparseable"', async () => {
    // What the live server actually returned on the deploy machine: HTTP 200,
    // an HTML page, title "Missing Key". A generic "unparseable" would have
    // sent someone hunting through variable codes for a one-line env fix.
    const html = '<html><head><title>Missing Key</title></head><body>error</body></html>';
    const r = await fetchCensus('92840', { fetchImpl: reply(html) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/khoá API/);
    expect(r.error).toMatch(/CENSUS_API_KEY/);
    expect(r.diagnostic).toMatch(/missing api key/);
  });

  it('stops after the first year rather than retrying a key problem twice more', async () => {
    let calls = 0;
    const impl = (async () => {
      calls += 1;
      return { ok: true, status: 200, text: async () => '<title>Missing Key</title>' };
    }) as unknown as FetchLike;
    await fetchCensus('92840', { fetchImpl: impl });
    expect(calls).toBe(1);
  });

  it('sends the key when there is one', async () => {
    let seen = '';
    const impl = (async (u: string) => { seen = u; return { ok: true, status: 200, text: async () => GOOD }; }) as unknown as FetchLike;
    await fetchCensus('92840', { apiKey: 'abc123', fetchImpl: impl });
    expect(seen).toContain('key=abc123');
  });
});
