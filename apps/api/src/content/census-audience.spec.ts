import { fetchAreaAudience, languageCodesFromGroup, adultsIn, type AreaAudience } from './census-audience';
import type { FetchLike } from './census';

/** B01001 male bands _003.._025, female _027.._049 — the real table layout. */
function ageRow(male: number[], female: number[]): string {
  const head = ['NAME', 'B01001_001E', 'B01001_002E', 'B01001_026E'];
  const vals: (string | number)[] = [
    '78704',
    male.reduce((a, b) => a + b, 0) + female.reduce((a, b) => a + b, 0),
    male.reduce((a, b) => a + b, 0),
    female.reduce((a, b) => a + b, 0),
  ];
  male.forEach((v, i) => { head.push(`B01001_${String(i + 3).padStart(3, '0')}E`); vals.push(v); });
  female.forEach((v, i) => { head.push(`B01001_${String(i + 27).padStart(3, '0')}E`); vals.push(v); });
  head.push('zip code tabulation area'); vals.push('78704');
  return JSON.stringify([head, vals]);
}

/** 23 bands: <5,5-9,10-14,15-17,18-19,20,21,22-24,25-29,30-34,35-39,40-44,45-49,50-54,55-59,60-61,62-64,65-66,67-69,70-74,75-79,80-84,85+ */
const MALE = [100, 100, 100, 50, 40, 20, 20, 60, 300, 320, 280, 260, 240, 220, 180, 60, 70, 40, 50, 80, 60, 40, 30];
const FEMALE = [90, 95, 98, 48, 42, 22, 21, 62, 340, 360, 300, 280, 260, 240, 190, 62, 72, 44, 52, 84, 66, 44, 36];

function incomeRow(brackets: number[]): string {
  const head = ['NAME', 'B19001_001E'];
  const vals: (string | number)[] = ['78704', brackets.reduce((a, b) => a + b, 0)];
  brackets.forEach((v, i) => { head.push(`B19001_${String(i + 2).padStart(3, '0')}E`); vals.push(v); });
  head.push('zip code tabulation area'); vals.push('78704');
  return JSON.stringify([head, vals]);
}
/** 16 brackets, floors 0,10k,15k,20k,25k,30k,35k,40k,45k,50k,60k,75k,100k,125k,150k,200k */
const INCOME = [200, 150, 150, 160, 170, 180, 190, 200, 210, 400, 500, 700, 800, 500, 600, 900];

const GROUP_JSON = JSON.stringify({
  variables: {
    C16001_001E: { label: 'Estimate!!Total:' },
    C16001_017E: { label: 'Estimate!!Total:!!Vietnamese:' },
    C16001_018E: { label: 'Estimate!!Total:!!Vietnamese:!!Speak English less than "very well"' },
    C16001_003E: { label: 'Estimate!!Total:!!Spanish:' },
    C16001_004E: { label: 'Estimate!!Total:!!Spanish:!!Speak English less than "very well"' },
    C16001_013E: { label: 'Estimate!!Total:!!Korean:' },
    C16001_017M: { label: 'Margin of Error!!Total:!!Vietnamese:' },
  },
});

function langRow(): string {
  return JSON.stringify([
    ['NAME', 'C16001_001E', 'C16001_017E', 'C16001_003E', 'C16001_013E', 'zip code tabulation area'],
    ['78704', 20_000, 1_800, 4_200, 300, '78704'],
  ]);
}

/** Routes each request by what it asks for. */
function router(bodies: { age?: string; income?: string; group?: string; lang?: string }): FetchLike {
  return (async (u: string) => {
    const ok = (text: string) => ({ ok: true, status: 200, text: async () => text });
    const fail = { ok: false, status: 400, text: async () => 'error: unknown variable' };
    if (u.includes('/groups/C16001.json')) return bodies.group ? ok(bodies.group) : fail;
    if (u.includes('C16001_001E')) return bodies.lang ? ok(bodies.lang) : fail;
    if (u.includes('B19001_001E')) return bodies.income ? ok(bodies.income) : fail;
    if (u.includes('B01001_001E')) return bodies.age ? ok(bodies.age) : fail;
    return fail;
  }) as unknown as FetchLike;
}

const ALL = () => router({
  age: ageRow(MALE, FEMALE), income: incomeRow(INCOME), group: GROUP_JSON, lang: langRow(),
});

describe('the age table is read into bands a campaign can be aimed at', () => {
  let a: AreaAudience;
  beforeAll(async () => { a = await fetchAreaAudience(['78704'], { fetchImpl: ALL() }); });

  it('sums the female 25-54 bands correctly', () => {
    // 25-29 + 30-34 = 25-34; 35-39 + 40-44 = 35-44; 45-49 + 50-54 = 45-54
    expect(a.female['25-34']).toBe(340 + 360);
    expect(a.female['35-44']).toBe(300 + 280);
    expect(a.female['45-54']).toBe(260 + 240);
  });

  it('does not mix the sexes up — the failure sums cannot catch by luck', () => {
    expect(a.male['25-34']).toBe(300 + 320);
    expect(a.male['25-34']).not.toBe(a.female['25-34']);
  });

  it('leaves under-18s out of every adult band', () => {
    const adults = adultsIn(a, ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'], 'all');
    const children = 100 + 100 + 100 + 50 + 90 + 95 + 98 + 48;
    expect(adults).toBe((a.totalPopulation as number) - children);
  });
});

describe('a misaligned read is discarded rather than displayed', () => {
  it('drops the breakdown when the bands do not sum to their sex total', () => {
    // The realistic failure mode: reading the table one row out of alignment.
    // Nobody can audit a demographic estimate by looking at it, so a wrong
    // number here is worse than no number.
    const broken = JSON.parse(ageRow(MALE, FEMALE)) as unknown[][];
    const head = broken[0] as string[];
    (broken[1] as number[])[head.indexOf('B01001_026E')] = 99_999;
    const a = router({ age: JSON.stringify(broken), income: incomeRow(INCOME) });
    return fetchAreaAudience(['78704'], { fetchImpl: a }).then((r) => {
      expect(r.ok).toBe(false);
      expect(r.female['25-34']).toBe(0);
      expect(r.notes.join(' ')).toMatch(/thà không có số còn hơn có số sai/);
    });
  });

  it('drops the income distribution when the brackets do not sum to the total', () => {
    const broken = JSON.parse(incomeRow(INCOME)) as unknown[][];
    const head = broken[0] as string[];
    (broken[1] as number[])[head.indexOf('B19001_001E')] = 1;
    return fetchAreaAudience(['78704'], {
      fetchImpl: router({ age: ageRow(MALE, FEMALE), income: JSON.stringify(broken) }),
    }).then((r) => {
      expect(r.incomeAtLeast).toEqual([]);
      expect(r.notes.join(' ')).toMatch(/không khớp tổng số hộ/);
    });
  });

  it('keeps the parts that worked when one table fails', () => {
    // Independent failure: a broken income table must not blank the ages.
    return fetchAreaAudience(['78704'], { fetchImpl: router({ age: ageRow(MALE, FEMALE) }) }).then((r) => {
      expect(r.ok).toBe(true);
      expect(r.female['25-34']).toBeGreaterThan(0);
      expect(r.incomeAtLeast).toEqual([]);
    });
  });

  it('names a missing API key rather than reporting no data', () => {
    const html = (async () => ({ ok: true, status: 200, text: async () => '<title>Missing Key</title>' })) as unknown as FetchLike;
    return fetchAreaAudience(['78704'], { fetchImpl: html }).then((r) => {
      expect(r.notes.join(' ')).toMatch(/CENSUS_API_KEY/);
    });
  });
});

describe('income is reported as counts above a line, not as a distribution', () => {
  it('counts households at or above each threshold', async () => {
    const a = await fetchAreaAudience(['78704'], { fetchImpl: ALL() });
    const total = INCOME.reduce((x, y) => x + y, 0);
    // floors 75k,100k,125k,150k,200k → last five brackets
    const at75 = 700 + 800 + 500 + 600 + 900;
    expect(a.households).toBe(total);
    expect(a.incomeAtLeast.find((x) => x.usd === 75_000)!.households).toBe(at75);
    expect(a.incomeAtLeast.find((x) => x.usd === 150_000)!.households).toBe(600 + 900);
  });

  it('reports only the lines a pricing decision turns on', () => {
    // Three thresholds, not sixteen brackets. A salon deciding whether to
    // discount needs "how many households are above the line", not a histogram.
    return fetchAreaAudience(['78704'], { fetchImpl: ALL() }).then((a) => {
      expect(a.incomeAtLeast.map((x) => x.usd)).toEqual([75_000, 100_000, 150_000]);
    });
  });
});

describe('language codes are discovered, never remembered', () => {
  // Sums cannot catch "I read Korean as Vietnamese" — the totals still balance.
  // For a business serving Vietnamese customers that is the most valuable
  // column on the screen and the one I could least verify, so the mapping is
  // asked of the API rather than written down.
  it('finds the language variable by its own label', () => {
    expect(languageCodesFromGroup(GROUP_JSON, ['Vietnamese'])).toEqual([{ code: 'C16001_017E', name: 'Vietnamese' }]);
  });

  it('never picks the "speaks English less than very well" subset', () => {
    const got = languageCodesFromGroup(GROUP_JSON, ['Spanish']);
    expect(got[0].code).toBe('C16001_003E');
    expect(got[0].code).not.toBe('C16001_004E');
  });

  it('ignores margin-of-error columns', () => {
    expect(languageCodesFromGroup(GROUP_JSON, ['Vietnamese'])[0].code).not.toMatch(/M$/);
  });

  it('returns nothing for a language the table does not carry', () => {
    expect(languageCodesFromGroup(GROUP_JSON, ['Klingon'])).toEqual([]);
  });

  it('survives a malformed catalogue instead of throwing', () => {
    expect(languageCodesFromGroup('not json', ['Vietnamese'])).toEqual([]);
  });

  it('reports the languages with their share of the area', async () => {
    const a = await fetchAreaAudience(['78704'], { fetchImpl: ALL() });
    const vi = a.languages.find((l) => l.name === 'Vietnamese')!;
    expect(vi.people).toBe(1_800);
    expect(vi.pct).toBe(9);
    // Sorted by size: Spanish 4,200 leads.
    expect(a.languages[0].name).toBe('Spanish');
  });
});

describe('Census sentinels never reach a screen', () => {
  it('treats -666666666 as missing rather than as a number', async () => {
    const broken = JSON.parse(ageRow(MALE, FEMALE)) as unknown[][];
    const head = broken[0] as string[];
    (broken[1] as number[])[head.indexOf('B01001_035E')] = -666666666;
    const r = await fetchAreaAudience(['78704'], { fetchImpl: router({ age: JSON.stringify(broken) }) });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('666666');
  });
});
