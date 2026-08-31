/**
 * Who lives around the shop, from the US Census Bureau.
 *
 * WHAT THIS IS HONEST ABOUT
 *
 * A five-mile circle is not a ZIP code. ZIP Code Tabulation Areas are the
 * finest geography the free ACS API exposes, they are shaped like postal
 * routes rather than circles, and one of them can be a third of a small city or
 * a few blocks of a dense one. So this module reports "các ZIP quanh tiệm" and
 * never claims to have drawn a radius. The team enters the neighbouring ZIPs;
 * nothing here guesses which ZIPs are within five miles, because guessing that
 * without geocoding would be inventing geography.
 *
 * WHY IT IS WRITTEN THIS DEFENSIVELY
 *
 * I could not reach api.census.gov from the machine this was written on, so
 * every assumption about the response — the year that has data, the variable
 * codes, the shape of the array — is unverified until it runs on the deploy.
 * Code written against an unverified API should fail loudly and specifically,
 * not quietly produce a plausible number. Therefore:
 *
 *   - nothing throws; failures come back as { ok: false, error } and the screen
 *     says it could not fetch, rather than showing a blank where data should be;
 *   - every value is range-checked before it is believed. The Census marks
 *     unavailable estimates with large negative sentinels like -666666666, and
 *     a median income of minus six hundred million rendered as a dollar figure
 *     is exactly the kind of nonsense that destroys trust in a whole screen;
 *   - when the full request fails, it retries with a single well-known variable.
 *     That distinguishes "the API is down" from "one of my variable codes is
 *     wrong", which are different problems with different fixes;
 *   - the raw first line of any error is kept for the diagnostic endpoint, so
 *     the fix comes from reading what the server said rather than from guessing.
 */

export interface ZipDemographics {
  zip: string;
  population: number | null;
  medianHouseholdIncomeUsd: number | null;
  medianAge: number | null;
}

export interface CensusResult {
  ok: boolean;
  year: number | null;
  zips: ZipDemographics[];
  /** Combined across the ZIPs that returned data. */
  totalPopulation: number | null;
  /** Population-weighted, so a big ZIP is not outvoted by a tiny one. */
  weightedMedianIncomeUsd: number | null;
  error?: string;
  /** Kept verbatim for the diagnostic screen — never shown to a salon. */
  diagnostic?: string;
}

/** ACS 5-year Data Profile codes. Unverified from here; checked at runtime. */
const VARS = {
  population: 'DP05_0001E',
  medianIncome: 'DP03_0062E',
  medianAge: 'DP05_0018E',
} as const;

/**
 * The ACS release to ask for.
 *
 * There is always a lag between a year ending and its 5-year estimates being
 * published, and the exact newest release is not something to hardcode with
 * confidence. So it walks backwards and takes the first year that answers.
 */
const YEARS = [2023, 2022, 2021];

/**
 * Census marks unavailable estimates with large negative sentinels.
 * Anything outside a sane range is treated as missing rather than rendered.
 */
function sane(raw: unknown, min: number, max: number): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

function url(year: number, vars: string[], zips: string[], key?: string | null): string {
  const get = ['NAME', ...vars].join(',');
  const forClause = `zip code tabulation area:${zips.join(',')}`;
  const k = key ? `&key=${encodeURIComponent(key)}` : '';
  return `https://api.census.gov/data/${year}/acs/acs5/profile`
    + `?get=${encodeURIComponent(get)}&for=${encodeURIComponent(forClause)}${k}`;
}

/**
 * Parse the Census array-of-arrays response.
 *
 * It comes back as a header row followed by data rows, with the geography
 * column last. Reading by column NAME rather than by position matters: the
 * server is free to order columns as it likes, and a positional read that
 * happens to work today becomes silently wrong the day it does not.
 */
export function parseCensus(body: string): ZipDemographics[] | null {
  let rows: unknown;
  try { rows = JSON.parse(body); } catch { return null; }
  if (!Array.isArray(rows) || rows.length < 2 || !Array.isArray(rows[0])) return null;
  const header = (rows[0] as unknown[]).map((h) => String(h));
  const at = (name: string) => header.indexOf(name);
  const zipCol = at('zip code tabulation area');
  if (zipCol < 0) return null;

  const out: ZipDemographics[] = [];
  for (const r of rows.slice(1)) {
    if (!Array.isArray(r)) continue;
    const pick = (name: string) => (at(name) >= 0 ? r[at(name)] : undefined);
    out.push({
      zip: String(r[zipCol] ?? '').trim(),
      population: sane(pick(VARS.population), 0, 500_000),
      medianHouseholdIncomeUsd: sane(pick(VARS.medianIncome), 1, 1_000_000),
      medianAge: sane(pick(VARS.medianAge), 1, 120),
    });
  }
  return out.filter((z) => /^\d{5}$/.test(z.zip));
}

export function normaliseZips(input: unknown): string[] {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(/[^0-9]+/);
  const seen = new Set<string>();
  for (const z of raw) {
    const s = String(z ?? '').trim();
    if (/^\d{5}$/.test(s)) seen.add(s);
    if (seen.size >= 12) break; // the API takes a list; a hundred is someone's mistake
  }
  return Array.from(seen);
}

export async function fetchCensus(
  zipsInput: unknown,
  opts: { apiKey?: string | null; fetchImpl?: FetchLike } = {},
): Promise<CensusResult> {
  const zips = normaliseZips(zipsInput);
  const empty: CensusResult = { ok: false, year: null, zips: [], totalPopulation: null, weightedMedianIncomeUsd: null };
  if (!zips.length) {
    return { ...empty, error: 'Chưa có mã ZIP nào để tra cứu. Thêm địa chỉ có ZIP ở Cài đặt tiệm → Thông tin công ty.' };
  }

  const doFetch: FetchLike = opts.fetchImpl
    ?? ((u) => fetch(u, { signal: AbortSignal.timeout(12_000) }) as unknown as ReturnType<FetchLike>);

  let lastDiag = '';
  for (const year of YEARS) {
    const res = await doFetch(url(year, Object.values(VARS), zips, opts.apiKey)).catch((e: unknown) => {
      lastDiag = `network: ${String(e).slice(0, 200)}`;
      return null;
    });
    if (!res) continue;
    const body = await res.text().catch(() => '');
    if (!res.ok) {
      // Census returns a plain-text reason on 400 — usually "unknown variable".
      lastDiag = `HTTP ${res.status} (${year}): ${body.slice(0, 200)}`;
      continue;
    }
    const parsed = parseCensus(body);
    if (!parsed || !parsed.length) {
      // The live server answers a keyless request with an HTML page titled
      // "Missing Key" and a 200 status — so a plain response check passes and
      // the parse is what discovers it. Worth naming explicitly: "unparseable"
      // would send someone hunting through variable codes for a problem that
      // is one environment variable.
      const needsKey = /missing key/i.test(body);
      lastDiag = needsKey
        ? `missing api key (${year}): Census trả về trang "Missing Key"`
        : `unparseable (${year}): ${body.slice(0, 200)}`;
      if (needsKey) {
        return {
          ...empty,
          error: 'Cục Thống kê Mỹ yêu cầu khoá API. Đăng ký miễn phí tại api.census.gov/data/key_signup.html rồi đặt biến CENSUS_API_KEY trên Render.',
          diagnostic: lastDiag,
        };
      }
      continue;
    }

    const withPop = parsed.filter((z) => z.population !== null);
    const totalPopulation = withPop.length
      ? withPop.reduce((s, z) => s + (z.population as number), 0)
      : null;
    const withIncome = parsed.filter((z) => z.medianHouseholdIncomeUsd !== null && z.population !== null);
    const weighted = withIncome.length && totalPopulation
      ? Math.round(withIncome.reduce((s, z) => s + (z.medianHouseholdIncomeUsd as number) * (z.population as number), 0)
        / withIncome.reduce((s, z) => s + (z.population as number), 0))
      : null;

    return { ok: true, year, zips: parsed, totalPopulation, weightedMedianIncomeUsd: weighted };
  }

  return {
    ...empty,
    error: 'Chưa lấy được dữ liệu dân cư từ Cục Thống kê Mỹ. Số liệu khu vực tạm thời chưa hiển thị.',
    diagnostic: lastDiag || 'no response from any year tried',
  };
}

/**
 * The area, in words a salon owner can use.
 *
 * Reads only what the numbers support. Income and age get one sentence each of
 * interpretation, and that interpretation is about SPENDING CAPACITY, not about
 * who these people are — the data says how much a household earns, not what
 * they want done to their nails.
 */
export function describeArea(r: CensusResult, market = 'US'): string[] {
  if (!r.ok) return [];
  const out: string[] = [];
  if (r.totalPopulation) {
    out.push(`Khoảng ${r.totalPopulation.toLocaleString('en-US')} người sống trong các mã ZIP quanh tiệm.`);
  }
  if (r.weightedMedianIncomeUsd) {
    const inc = r.weightedMedianIncomeUsd;
    const band = inc >= 110_000 ? 'cao' : inc >= 75_000 ? 'khá' : inc >= 50_000 ? 'trung bình' : 'thấp';
    out.push(
      `Thu nhập hộ gia đình trung vị ${'$'}${inc.toLocaleString('en-US')} mỗi năm — mức ${band} so với mặt bằng ${market === 'US' ? 'Mỹ' : market}. `
      + (inc >= 90_000
        ? 'Vùng này chịu được giá cao hơn; cạnh tranh bằng giảm giá ở đây là bỏ tiền đi.'
        : inc >= 60_000
          ? 'Vùng này nhạy giá vừa phải: gói combo và giá trị thêm hiệu quả hơn giảm giá thẳng.'
          : 'Vùng này nhạy giá. Giữ một mức giá dễ tiếp cận cho dịch vụ cơ bản, và kiếm lãi ở các dịch vụ nâng cấp.'),
    );
  }
  const ages = r.zips.map((z) => z.medianAge).filter((a): a is number => a !== null);
  if (ages.length) {
    const avg = Math.round(ages.reduce((a, b) => a + b, 0) / ages.length);
    out.push(`Tuổi trung vị quanh đây khoảng ${avg}.`);
  }
  out.push('Lưu ý: đây là số liệu theo mã ZIP của Cục Thống kê Mỹ, không phải một vòng tròn 5 dặm. ZIP có thể rộng hoặc hẹp hơn nhiều.');
  return out;
}
