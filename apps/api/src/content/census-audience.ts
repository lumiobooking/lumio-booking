/**
 * WHO lives around the shop — not just how many.
 *
 * WHY THIS FILE EXISTS
 *
 * The area panel said "27,136 people, median household income $102,886" and
 * every recommendation after it came from the salon's own booking history. That
 * is backwards for the question an owner is actually asking. "Who should I
 * aim at?" is a question about the twenty-seven thousand people OUTSIDE the
 * book, and a business with twenty-two bookings has almost no inside data to
 * reason from — the thinner the book, the more the answer has to come from the
 * market.
 *
 * So this pulls the demand side: the age and sex structure of the catchment,
 * how household income is distributed across it, and which languages are spoken
 * at home. All of it is free, citable, US Census ACS data about real people,
 * and none of it is derived from anything the salon has done.
 *
 * THE PROBLEM THIS FILE HAD TO SOLVE HONESTLY
 *
 * I cannot reach the Census data endpoint from where this was written — it
 * requires a key, and reusing the one that was pasted into a chat window is
 * exactly what I advised against. So every variable code here is unverified by
 * me, and a wrong code does not fail loudly: B01001_035E is "females 25 to 29"
 * and B01001_011E is "males 25 to 29", and confusing them produces a confident,
 * plausible, wrong audience.
 *
 * Two defences, chosen to match the two ways this can be wrong:
 *
 *   1. ARITHMETIC, for offset errors. The age bands must sum to their sex
 *      total, and the two sex totals must sum to the grand total. Reading the
 *      table one row out of alignment breaks those sums, so the breakdown is
 *      discarded rather than shown. A wrong number is worse than no number
 *      here: nobody can audit a demographic estimate by looking at it.
 *
 *   2. LABEL LOOKUP, for naming errors. Sums cannot catch "I read Korean as
 *      Vietnamese" — the totals still balance. So the language table's codes
 *      are not written down at all: they are discovered by asking the API for
 *      its own variable labels and matching on the language name. For a
 *      business serving Vietnamese customers in the US that column is the most
 *      valuable one on the screen and the one I am least able to verify, which
 *      is exactly when guessing is least acceptable.
 */

import type { FetchLike } from './census';

export type AgeBand = '18-24' | '25-34' | '35-44' | '45-54' | '55-64' | '65+';
export const AGE_BANDS: AgeBand[] = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];

export interface AreaAudience {
  ok: boolean;
  year: number | null;
  /** Adults by sex, summed across the ZIPs asked for. */
  female: Record<AgeBand, number>;
  male: Record<AgeBand, number>;
  totalPopulation: number | null;
  households: number | null;
  /** Households AT OR ABOVE each threshold — the shape a price decision needs. */
  incomeAtLeast: { usd: number; households: number; pct: number }[];
  /** People aged 5+ speaking this at home. Empty when the lookup did not run. */
  languages: { name: string; people: number; pct: number }[];
  /** Every part that could not be fetched or did not pass its check. */
  notes: string[];
}

const EMPTY_BANDS = (): Record<AgeBand, number> =>
  ({ '18-24': 0, '25-34': 0, '35-44': 0, '45-54': 0, '55-64': 0, '65+': 0 });

/**
 * B01001 "Sex by Age". Male runs _003.._025, female _027.._049, with identical
 * band layouts twenty-four apart. The pairs below are (code, band); the ones
 * under 18 are deliberately absent — this screen is about people who can book.
 */
const MALE_BANDS: [string, AgeBand][] = [
  ['B01001_007E', '18-24'], ['B01001_008E', '18-24'], ['B01001_009E', '18-24'], ['B01001_010E', '18-24'],
  ['B01001_011E', '25-34'], ['B01001_012E', '25-34'],
  ['B01001_013E', '35-44'], ['B01001_014E', '35-44'],
  ['B01001_015E', '45-54'], ['B01001_016E', '45-54'],
  ['B01001_017E', '55-64'], ['B01001_018E', '55-64'], ['B01001_019E', '55-64'],
  ['B01001_020E', '65+'], ['B01001_021E', '65+'], ['B01001_022E', '65+'],
  ['B01001_023E', '65+'], ['B01001_024E', '65+'], ['B01001_025E', '65+'],
];
const FEMALE_BANDS: [string, AgeBand][] = MALE_BANDS.map(([code, band]) => {
  const n = Number(code.slice(-4, -1)) + 24;
  return [`B01001_${String(n).padStart(3, '0')}E`, band] as [string, AgeBand];
});
/** Everything under 18, needed only to make the sum check add up. */
const MALE_CHILD = ['B01001_003E', 'B01001_004E', 'B01001_005E', 'B01001_006E'];
const FEMALE_CHILD = MALE_CHILD.map((c) => `B01001_${String(Number(c.slice(-4, -1)) + 24).padStart(3, '0')}E`);
const TOTAL = 'B01001_001E';
const MALE_TOTAL = 'B01001_002E';
const FEMALE_TOTAL = 'B01001_026E';

/**
 * B19001 "Household Income". _001 is the total; _002.._017 are the brackets in
 * ascending order. The lower bound of each bracket is what matters here — a
 * salon asking "how many households could comfortably pay $60" wants a count
 * above a line, not a distribution.
 */
const INCOME_BRACKETS: { code: string; floor: number }[] = [
  { code: 'B19001_002E', floor: 0 }, { code: 'B19001_003E', floor: 10_000 },
  { code: 'B19001_004E', floor: 15_000 }, { code: 'B19001_005E', floor: 20_000 },
  { code: 'B19001_006E', floor: 25_000 }, { code: 'B19001_007E', floor: 30_000 },
  { code: 'B19001_008E', floor: 35_000 }, { code: 'B19001_009E', floor: 40_000 },
  { code: 'B19001_010E', floor: 45_000 }, { code: 'B19001_011E', floor: 50_000 },
  { code: 'B19001_012E', floor: 60_000 }, { code: 'B19001_013E', floor: 75_000 },
  { code: 'B19001_014E', floor: 100_000 }, { code: 'B19001_015E', floor: 125_000 },
  { code: 'B19001_016E', floor: 150_000 }, { code: 'B19001_017E', floor: 200_000 },
];
const HOUSEHOLDS = 'B19001_001E';
/** The lines a pricing decision actually turns on. */
const INCOME_LINES = [75_000, 100_000, 150_000];

const num = (v: unknown): number | null => {
  const n = Number(v);
  // The Census marks unavailable estimates with sentinels like -666666666.
  return Number.isFinite(n) && n >= 0 && n < 50_000_000 ? n : null;
};

/** Header-name lookup: the server may order columns however it likes. */
function rowsByName(body: string): { header: string[]; rows: unknown[][] } | null {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return null; }
  if (!Array.isArray(parsed) || parsed.length < 2 || !Array.isArray(parsed[0])) return null;
  return {
    header: (parsed[0] as unknown[]).map(String),
    rows: parsed.slice(1).filter(Array.isArray) as unknown[][],
  };
}

function sumColumn(t: { header: string[]; rows: unknown[][] }, code: string): number | null {
  const i = t.header.indexOf(code);
  if (i < 0) return null;
  let total = 0;
  for (const r of t.rows) {
    const v = num(r[i]);
    if (v === null) return null; // one missing ZIP makes the total a lie
    total += v;
  }
  return total;
}

/** Within 2% — ACS estimates are rounded per geography, so they rarely tie exactly. */
function balances(parts: number, whole: number): boolean {
  if (whole <= 0) return parts === 0;
  return Math.abs(parts - whole) / whole <= 0.02;
}

function apiUrl(year: number, codes: string[], zips: string[], key?: string | null): string {
  const get = ['NAME', ...codes].join(',');
  const k = key ? `&key=${encodeURIComponent(key)}` : '';
  return `https://api.census.gov/data/${year}/acs/acs5`
    + `?get=${encodeURIComponent(get)}`
    + `&for=${encodeURIComponent(`zip code tabulation area:${zips.join(',')}`)}${k}`;
}

/**
 * Find the variable codes for named languages by reading the API's own labels.
 *
 * C16001 lists each language twice — once for everyone who speaks it at home,
 * once for the subset who speak English less than "very well". Only the first
 * is wanted, so any label mentioning English proficiency is skipped.
 */
export function languageCodesFromGroup(groupJson: string, wanted: string[]): { code: string; name: string }[] {
  let parsed: { variables?: Record<string, { label?: string }> };
  try { parsed = JSON.parse(groupJson) as typeof parsed; } catch { return []; }
  const vars = parsed?.variables ?? {};
  const out: { code: string; name: string }[] = [];
  for (const name of wanted) {
    const hit = Object.entries(vars).find(([code, v]) => {
      const label = String(v?.label ?? '');
      return /E$/.test(code)
        && !/^Annotation|Margin of Error/i.test(label)
        && !/less than/i.test(label)
        && new RegExp(`(^|!!)${name}(:|!!|$)`, 'i').test(label);
    });
    if (hit) out.push({ code: hit[0], name });
  }
  return out;
}

/** Languages worth asking about in a US market. Only ones that come back are shown. */
const LANGUAGES = ['Vietnamese', 'Spanish', 'Chinese', 'Korean', 'Tagalog', 'Russian, Polish, or other Slavic languages', 'Arabic'];

export async function fetchAreaAudience(
  zips: string[],
  opts: { apiKey?: string | null; fetchImpl?: FetchLike; year?: number } = {},
): Promise<AreaAudience> {
  const year = opts.year ?? 2023;
  const notes: string[] = [];
  const out: AreaAudience = {
    ok: false, year, female: EMPTY_BANDS(), male: EMPTY_BANDS(),
    totalPopulation: null, households: null, incomeAtLeast: [], languages: [], notes,
  };
  if (!zips.length) {
    notes.push('Chưa có mã ZIP để tra cứu.');
    return out;
  }

  const doFetch: FetchLike = opts.fetchImpl
    ?? ((u) => fetch(u, { signal: AbortSignal.timeout(15_000) }) as unknown as ReturnType<FetchLike>);

  const get = async (codes: string[], what: string) => {
    const res = await doFetch(apiUrl(year, codes, zips, opts.apiKey)).catch(() => null);
    if (!res || !res.ok) {
      notes.push(`Chưa lấy được ${what} từ Cục Thống kê Mỹ.`);
      return null;
    }
    const body = await res.text().catch(() => '');
    const t = rowsByName(body);
    if (!t) {
      notes.push(/missing key/i.test(body)
        ? 'Cục Thống kê Mỹ yêu cầu khoá API (CENSUS_API_KEY).'
        : `Không đọc được dữ liệu ${what}.`);
      return null;
    }
    return t;
  };

  // ---- age and sex --------------------------------------------------------
  const ageCodes = [TOTAL, MALE_TOTAL, FEMALE_TOTAL,
    ...MALE_CHILD, ...FEMALE_CHILD,
    ...MALE_BANDS.map(([c]) => c), ...FEMALE_BANDS.map(([c]) => c)];
  const ageTable = await get(ageCodes, 'cơ cấu tuổi và giới tính');
  if (ageTable) {
    const total = sumColumn(ageTable, TOTAL);
    const maleTotal = sumColumn(ageTable, MALE_TOTAL);
    const femaleTotal = sumColumn(ageTable, FEMALE_TOTAL);
    const male = EMPTY_BANDS();
    const female = EMPTY_BANDS();
    let maleParts = 0;
    let femaleParts = 0;
    let missing = false;
    for (const [code, band] of MALE_BANDS) {
      const v = sumColumn(ageTable, code);
      if (v === null) { missing = true; break; }
      male[band] += v; maleParts += v;
    }
    for (const [code, band] of FEMALE_BANDS) {
      const v = sumColumn(ageTable, code);
      if (v === null) { missing = true; break; }
      female[band] += v; femaleParts += v;
    }
    for (const c of MALE_CHILD) maleParts += sumColumn(ageTable, c) ?? 0;
    for (const c of FEMALE_CHILD) femaleParts += sumColumn(ageTable, c) ?? 0;

    // The check that catches reading the table one row out of alignment.
    const balanced = total !== null && maleTotal !== null && femaleTotal !== null
      && balances(maleTotal + femaleTotal, total)
      && balances(maleParts, maleTotal) && balances(femaleParts, femaleTotal);
    if (missing || !balanced) {
      notes.push('Cơ cấu tuổi/giới tính không khớp tổng dân số nên đã bỏ qua — thà không có số còn hơn có số sai.');
    } else {
      out.male = male; out.female = female; out.totalPopulation = total; out.ok = true;
    }
  }

  // ---- household income ---------------------------------------------------
  const incTable = await get([HOUSEHOLDS, ...INCOME_BRACKETS.map((b) => b.code)], 'phân bố thu nhập hộ gia đình');
  if (incTable) {
    const households = sumColumn(incTable, HOUSEHOLDS);
    const counts = INCOME_BRACKETS.map((b) => ({ floor: b.floor, n: sumColumn(incTable, b.code) }));
    const parts = counts.reduce((s, c) => s + (c.n ?? 0), 0);
    if (households === null || counts.some((c) => c.n === null) || !balances(parts, households)) {
      notes.push('Phân bố thu nhập không khớp tổng số hộ nên đã bỏ qua.');
    } else {
      out.households = households;
      out.incomeAtLeast = INCOME_LINES.map((line) => {
        const n = counts.filter((c) => c.floor >= line).reduce((s, c) => s + (c.n as number), 0);
        return { usd: line, households: n, pct: households ? Math.round((n / households) * 100) : 0 };
      });
    }
  }

  // ---- languages spoken at home ------------------------------------------
  const grp = await doFetch(`https://api.census.gov/data/${year}/acs/acs5/groups/C16001.json`).catch(() => null);
  if (grp?.ok) {
    const codes = languageCodesFromGroup(await grp.text().catch(() => ''), LANGUAGES);
    const totalCode = 'C16001_001E';
    if (codes.length) {
      const langTable = await get([totalCode, ...codes.map((c) => c.code)], 'ngôn ngữ nói ở nhà');
      const base = langTable ? sumColumn(langTable, totalCode) : null;
      if (langTable && base) {
        out.languages = codes
          .map((c) => ({ name: c.name, people: sumColumn(langTable, c.code) ?? 0 }))
          .filter((l) => l.people > 0)
          .map((l) => ({ ...l, pct: Math.round((l.people / base) * 1000) / 10 }))
          .sort((a, b) => b.people - a.people);
      }
    } else {
      notes.push('Không tìm được mã biến ngôn ngữ trong danh mục của Cục Thống kê.');
    }
  } else {
    notes.push('Chưa lấy được bảng ngôn ngữ.');
  }

  return out;
}

/** Adults 18+ of one sex, or both. */
export function adultsIn(a: AreaAudience, bands: AgeBand[], sex: 'female' | 'male' | 'all'): number {
  const add = (rec: Record<AgeBand, number>) => bands.reduce((s, b) => s + (rec[b] ?? 0), 0);
  if (sex === 'female') return add(a.female);
  if (sex === 'male') return add(a.male);
  return add(a.female) + add(a.male);
}
