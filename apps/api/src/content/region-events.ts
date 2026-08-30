/**
 * What is coming up, for THIS salon, where it actually stands.
 *
 * The list this replaces was nine hardcoded dates shown to every salon on the
 * platform. That is wrong in two directions at once. A salon in Garden Grove
 * and a salon in Boston do not share a school calendar, a prom season, or a
 * customer base — and one of the hardcoded dates was simply incorrect: Tết was
 * written as 17 February of next year, which is right for 2026 and wrong for
 * every year after it. Lunar dates cannot be guessed from a formula, so they
 * come from a table of real dates here.
 *
 * Three rules this file keeps:
 *
 *   1. Anything computable is computed. US federal holidays follow nth-weekday
 *      rules, Easter follows the Gregorian computus. Nothing drifts.
 *   2. Anything not computable comes from a dated table, and the table ends.
 *      When it runs out the event stops appearing rather than silently
 *      extrapolating a wrong date.
 *   3. Anything approximate says so. School start weeks vary by district, not
 *      just by state, so those carry `precision: 'approximate'` and the UI
 *      shows a week rather than a day.
 *
 * And when the salon has no address on file, this returns only the events that
 * are true everywhere in its market, with `regionKnown: false` — so the screen
 * can ask for the address instead of pretending to know the neighbourhood.
 */

export type Market = 'US' | 'CA' | 'VN';
export type Precision = 'exact' | 'approximate';
export type Scope = 'national' | 'regional' | 'cultural';

export interface RegionInput {
  market?: string | null;
  city?: string | null;
  /** State/province code. Case-insensitive; stored uppercase. */
  region?: string | null;
}

export interface DatedEvent {
  name: string;
  /** ISO date (UTC midnight) the event lands on, or the window's first day. */
  date: string;
  daysAway: number;
  /** For a window ('mùa prom'), how many days it runs. 0 for a single day. */
  spanDays: number;
  note: string;
  scope: Scope;
  precision: Precision;
  /** Shown when precision is approximate, so nobody treats it as a fact. */
  caveat?: string;
}

// ---- 1. Date arithmetic ----------------------------------------------------

const DAY = 86_400_000;
const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const iso = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/** The nth given weekday of a month. n = 1..5, weekday 0 = Sunday. */
export function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(utc(year, month, 1)).getUTCDay();
  const offset = (weekday - first + 7) % 7;
  return utc(year, month, 1 + offset + (n - 1) * 7);
}

/** The last given weekday of a month — Memorial Day's rule. */
export function lastWeekday(year: number, month: number, weekday: number): number {
  const lastDay = new Date(utc(year, month + 1, 0)).getUTCDate();
  const last = new Date(utc(year, month, lastDay)).getUTCDay();
  return utc(year, month, lastDay - ((last - weekday + 7) % 7));
}

/**
 * Easter Sunday, Gregorian. Meeus/Jones/Butcher — exact, not an approximation,
 * and worth having because the whole spring salon season hangs off it: palm
 * Sunday photos, Easter brunch, and the pastel manicure that goes with both.
 */
export function easter(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

/**
 * Lunar New Year, from a table of real dates.
 *
 * There is no closed formula for this — it is the second new moon after the
 * winter solstice, computed against a lunisolar calendar. The old code tried a
 * fixed 17 February, which was only ever right for one year.
 *
 * Vietnamese Tết is reckoned at UTC+7 and Chinese New Year at UTC+8, so the two
 * occasionally fall a day apart (1985 and 2007 did). Through this table's range
 * they agree. When the table runs out the event disappears rather than
 * inventing a date — a missing event is a small problem, a confidently wrong
 * one that sends a salon's Tết campaign out eleven days late is not.
 */
const LUNAR_NEW_YEAR: Record<number, [number, number]> = {
  2026: [2, 17], 2027: [2, 6], 2028: [1, 26], 2029: [2, 13], 2030: [2, 3],
  2031: [1, 23], 2032: [2, 11], 2033: [1, 31], 2034: [2, 19], 2035: [2, 8],
};

export function lunarNewYear(year: number): number | null {
  const md = LUNAR_NEW_YEAR[year];
  return md ? utc(year, md[0], md[1]) : null;
}

// ---- 2. Where the salon is -------------------------------------------------

export interface ResolvedRegion {
  market: Market;
  city: string | null;
  region: string | null;
  /** True only when we know the state — everything regional depends on it. */
  regionKnown: boolean;
  label: string;
}

const US_STATES = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']);

export function resolveRegion(input: RegionInput): ResolvedRegion {
  const market: Market = input.market === 'VN' ? 'VN' : input.market === 'CA' ? 'CA' : 'US';
  const city = input.city?.trim() || null;
  const raw = input.region?.trim().toUpperCase() || null;
  // A US salon whose "state" is not a real state code is treated as unknown.
  // Half-right geography is worse than none: it produces a confident calendar
  // for a place that does not exist.
  const region = raw && (market !== 'US' || US_STATES.has(raw)) ? raw : null;
  const label = city && region ? `${city}, ${region}` : city || region || 'chưa rõ khu vực';
  return { market, city, region, regionKnown: Boolean(region), label };
}

/**
 * Pull city and state out of the free-text address salons already filled in.
 *
 * Most salons on the platform typed a full address into settings years ago, so
 * asking a hundred owners to re-enter their own city would be a poor way to
 * spend their evening. This reads what is already there.
 *
 * It is strict on purpose. A parser that returns a state whenever it sees two
 * capital letters will happily decide that "IN" in "NAILS IN THE CITY" is
 * Indiana, and then confidently serve that salon Indiana's school calendar. So
 * a state is only accepted when it sits where a state actually sits: at the end
 * of the address, next to a ZIP, or as the final comma-separated part. Anything
 * less clear returns null and the salon is treated as location-unknown.
 */
export function parseAddress(address: string | null | undefined, market: Market = 'US'): {
  city: string | null; region: string | null; postalCode: string | null;
} {
  const none = { city: null, region: null, postalCode: null };
  const raw = (address ?? '').trim();
  if (!raw || market !== 'US') return none;

  // "…, Garden Grove, CA 92840" / "… Garden Grove CA 92840-1234"
  const withZip = /(?:^|,)\s*([A-Za-z][A-Za-z .'\-]{1,40}?)[,\s]+([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?\s*$/.exec(raw);
  if (withZip) {
    const st = withZip[2].toUpperCase();
    if (US_STATES.has(st)) {
      return { city: withZip[1].trim(), region: st, postalCode: withZip[3] };
    }
  }

  // "45 Beacon Street Boston MA 02108" — no commas at all. The ZIP makes the
  // state safe to read, but the city is not safely recoverable: taking the word
  // before the state turns "San Jose" into "Jose" and "Fort Worth" into
  // "Worth". The state is what the calendar actually runs on, so take that and
  // leave the city null rather than print a mangled name back at the owner.
  const flat = /\b([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?\s*$/.exec(raw);
  if (flat) {
    const st = flat[1].toUpperCase();
    if (US_STATES.has(st)) return { city: null, region: st, postalCode: flat[2] };
  }

  // "…, Garden Grove, CA" — no ZIP, so the state must be the final part.
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1].toUpperCase();
    if (/^[A-Z]{2}$/.test(last) && US_STATES.has(last)) {
      return { city: parts[parts.length - 2] || null, region: last, postalCode: null };
    }
  }
  return none;
}

// ---- 3. School calendar, by state and honestly ------------------------------

/**
 * Roughly when school goes back, by state.
 *
 * This is genuinely a range, not a date. Districts inside one state can differ
 * by three weeks, and a few states legislate a start after Labor Day while
 * their neighbours start in the first week of August. So every entry here is a
 * WINDOW, carries `precision: 'approximate'`, and tells the reader to check the
 * local district. The salon still gets the useful part — "start posting about
 * back-to-school around now" — without being handed a fake date.
 *
 * Value is the day of August the window opens; 90 means "after Labor Day".
 */
const BACK_TO_SCHOOL_AUG: Record<string, number> = {
  AZ: 5, GA: 5, TN: 5, MS: 5, AL: 6, MO: 12, IN: 10, KY: 10, NC: 22, SC: 15,
  TX: 12, FL: 12, LA: 12, OK: 12, KS: 13, NV: 12, UT: 20, CO: 15, ID: 17,
  CA: 15, AR: 15, WV: 18, NM: 13, HI: 5, ND: 22, SD: 20, NE: 15, IA: 23,
  OH: 20, IL: 18, MI: 90, WI: 25, MN: 90, PA: 25, MD: 25, DE: 90, OR: 30,
  WA: 30, MT: 25, WY: 25, AK: 18, VA: 90, DC: 25,
  NY: 90, NJ: 90, CT: 90, MA: 90, RI: 90, NH: 90, VT: 90, ME: 90,
};

/**
 * Holidays that exist in some states and not others.
 *
 * This is the sharpest answer to "mỗi khu vực có ngày lễ khác nhau". A salon in
 * Louisiana loses a week to Mardi Gras; one in Utah closes for Pioneer Day; one
 * in Massachusetts has a Monday marathon holiday that empties the town. None of
 * those exist for the salon two states over, and a national calendar shows all
 * of them to everyone or none of them to anyone.
 *
 * Only days that change what a local business does are listed. Observances that
 * pass without anyone leaving the house are noise on this screen, and days with
 * contested histories are left out because a salon does not need this product
 * picking that fight for it.
 *
 * `at` receives the year and returns a UTC timestamp, so moveable feasts stay
 * correct forever instead of drifting.
 */
const STATE_HOLIDAYS: Record<string, { name: string; at: (y: number) => number; note: string }[]> = {
  LA: [{
    name: 'Mardi Gras',
    // Always 47 days before Easter — the whole city stops, and nails are part
    // of the costume. Computed, so it never needs updating.
    at: (y) => easter(y) - 47 * DAY,
    note: 'Cả vùng nghỉ và ăn mừng — móng theo màu tím/vàng/xanh lá, đặt kín từ tuần trước',
  }],
  MA: [{ name: "Patriots' Day", at: (y) => nthWeekday(y, 4, 1, 3), note: 'Ngày marathon Boston — phố đông, nhưng lịch hẹn buổi sáng thường vắng' }],
  ME: [{ name: "Patriots' Day", at: (y) => nthWeekday(y, 4, 1, 3), note: 'Ngày nghỉ của bang — nhiều gia đình rảnh cả ngày' }],
  UT: [{ name: 'Pioneer Day', at: (y) => utc(y, 7, 24), note: 'Ngày lễ lớn nhất của bang ngoài Quốc khánh — tiệc, diễu hành, chụp ảnh nhiều' }],
  HI: [
    { name: 'King Kamehameha Day', at: (y) => utc(y, 6, 11), note: 'Ngày nghỉ toàn bang, lễ hội và diễu hành' },
    { name: 'Statehood Day', at: (y) => nthWeekday(y, 8, 5, 3), note: 'Ngày nghỉ của bang, cuối tuần dài' },
  ],
  AK: [{ name: "Seward's Day", at: (y) => lastWeekday(y, 3, 1), note: 'Ngày nghỉ của bang — thứ 2 dài, khách rảnh' }],
  NV: [{ name: 'Nevada Day', at: (y) => lastWeekday(y, 10, 5), note: 'Ngày nghỉ toàn bang, thứ 6 dài trước Halloween' }],
  RI: [{ name: 'Victory Day', at: (y) => nthWeekday(y, 8, 1, 2), note: 'Ngày nghỉ riêng của Rhode Island — cuối tuần dài giữa tháng 8' }],
  VT: [{ name: 'Town Meeting Day', at: (y) => nthWeekday(y, 3, 2, 1), note: 'Ngày nghỉ của bang, trường đóng cửa' }],
  CA: [{ name: 'César Chávez Day', at: (y) => utc(y, 3, 31), note: 'Ngày nghỉ của bang California — trường và cơ quan đóng cửa' }],
  IL: [{ name: 'Casimir Pulaski Day', at: (y) => nthWeekday(y, 3, 1, 1), note: 'Trường ở Chicago nghỉ — mẹ và con gái rảnh cùng lúc' }],
  TX: [{ name: 'Texas Independence Day', at: (y) => utc(y, 3, 2), note: 'Ngày của bang — nội dung bám niềm tự hào địa phương chạy rất tốt ở đây' }],
};

/** Prom lands earlier in the South, later in the Northeast. */
const PROM_LATE = new Set(['NY','NJ','CT','MA','RI','NH','VT','ME','PA','MI','MN','WI','WA','OR','IL','OH','MD','DE','DC']);

// ---- 4. The calendar --------------------------------------------------------

interface Seed {
  name: string;
  ts: number;
  note: string;
  scope: Scope;
  precision?: Precision;
  spanDays?: number;
  caveat?: string;
}

function usSeeds(y: number, r: ResolvedRegion): Seed[] {
  const S: Seed[] = [
    { name: 'Năm mới', ts: utc(y, 1, 1), note: 'Móng lấp lánh, tiệc tùng, làm mới bản thân — khách đặt từ 26-30/12', scope: 'national' },
    { name: 'Valentine', ts: utc(y, 2, 14), note: 'Tông hồng đỏ, nail art trái tim, khách đi đôi. Bán gift card cho nam giới mua tặng', scope: 'national' },
    { name: 'Ngày của Mẹ', ts: nthWeekday(y, 5, 0, 2), note: 'Cao điểm gift card. Mẹ và con gái đi cùng — đẩy gói đôi', scope: 'national' },
    { name: 'Ngày của Cha', ts: nthWeekday(y, 6, 0, 3), note: 'Nhỏ hơn nhiều, nhưng là dịp bán pedicure cho nam', scope: 'national' },
    { name: 'Quốc khánh Mỹ 4/7', ts: utc(y, 7, 4), note: 'Đỏ trắng xanh, đi biển, pedicure trước kỳ nghỉ', scope: 'national' },
    { name: 'Lễ Lao động', ts: nthWeekday(y, 9, 1, 1), note: 'Cuối kỳ nghỉ hè — tuần bận, và là mốc tựu trường của nhiều bang', scope: 'national' },
    { name: 'Halloween', ts: utc(y, 10, 31), note: 'Nail art chủ đề, màu tối — nội dung dễ lan nhất trong năm', scope: 'national' },
    { name: 'Lễ Tạ ơn', ts: nthWeekday(y, 11, 4, 4), note: 'Tông ấm, gia đình tụ họp và chụp ảnh. Tuần trước đó rất bận', scope: 'national' },
    { name: 'Black Friday', ts: nthWeekday(y, 11, 4, 4) + DAY, note: 'Ngày bán gift card mạnh nhất năm — chuẩn bị nội dung từ đầu tháng 11', scope: 'national' },
    { name: 'Giáng sinh', ts: utc(y, 12, 25), note: 'Mùa cao điểm nhất năm — mở đặt lịch sớm, gift card, thợ làm thêm giờ', scope: 'national' },
    { name: 'Phục sinh', ts: easter(y), note: 'Tông pastel, ảnh gia đình, brunch — mùa xuân bắt đầu ở đây', scope: 'national' },
  ];

  const lny = lunarNewYear(y);
  if (lny !== null) {
    S.push({
      name: 'Tết Nguyên đán',
      ts: lny,
      note: 'Móng đỏ, vàng, cầu may. Nhiều tiệm đóng cửa vài ngày — báo khách trước 2 tuần',
      scope: 'cultural',
      caveat: 'Chỉ đẩy mạnh nếu tiệm có tệp khách Việt/Hoa — nếu không thì bỏ qua',
    });
  }

  // The Super Bowl has been the second Sunday of February since 2022. It is not
  // a holiday, but for a local business it behaves like one: the town is home,
  // the party is on Sunday, and the appointments are on Friday and Saturday.
  S.push({
    name: 'Super Bowl',
    ts: nthWeekday(y, 2, 0, 2),
    scope: 'national',
    note: 'Cả nước ở nhà xem — thứ 6 và thứ 7 trước đó là hai ngày bận, chủ nhật thì vắng',
  });

  if (r.regionKnown) {
    const st = r.region as string;
    for (const h of STATE_HOLIDAYS[st] ?? []) {
      S.push({ name: h.name, ts: h.at(y), scope: 'regional', note: h.note });
    }
    const aug = BACK_TO_SCHOOL_AUG[st];
    if (aug !== undefined) {
      const ts = aug === 90 ? nthWeekday(y, 9, 1, 1) + DAY : utc(y, 8, aug);
      S.push({
        name: 'Tựu trường',
        ts,
        spanDays: 10,
        precision: 'approximate',
        scope: 'regional',
        note: aug === 90
          ? `Học sinh ${st} phần lớn vào học sau Lễ Lao động — mẹ và con gái làm móng cuối tuần trước đó`
          : `Học sinh ${st} thường vào học quanh giữa tháng 8 — mẹ và con gái làm móng tuần trước đó`,
        caveat: 'Ngày thật khác nhau theo học khu — kiểm tra lịch học khu của tiệm rồi chỉnh lại',
      });
    }
    const promLate = PROM_LATE.has(st);
    S.push({
      name: 'Mùa prom',
      ts: promLate ? utc(y, 5, 1) : utc(y, 4, 10),
      spanDays: 30,
      precision: 'approximate',
      scope: 'regional',
      note: promLate
        ? 'Prom ở vùng này rơi vào tháng 5 — học sinh đặt theo nhóm, móng cầu kỳ, giá cao'
        : 'Prom ở vùng này rơi vào tháng 4 — học sinh đặt theo nhóm, móng cầu kỳ, giá cao',
      caveat: 'Ngày prom do từng trường đặt — hỏi khách học sinh xem trường các em prom hôm nào',
    });
    S.push({
      name: 'Mùa tốt nghiệp',
      ts: utc(y, 5, 20),
      spanDays: 25,
      precision: 'approximate',
      scope: 'regional',
      note: 'Lễ tốt nghiệp và tiệc gia đình — chụp ảnh nhiều, khách muốn móng bền 2 tuần',
      caveat: 'Tuần lễ tốt nghiệp khác nhau theo trường',
    });
    if (['CA','TX','AZ','NM','NV','IL','CO','FL'].includes(st)) {
      S.push({
        name: 'Cinco de Mayo',
        ts: utc(y, 5, 5),
        scope: 'cultural',
        note: 'Dịp lễ lớn với cộng đồng gốc Mexico ở bang này — màu rực, tiệc cuối tuần',
        caveat: 'Chỉ dùng nếu tiệm thật sự có tệp khách này',
      });
    }
  }
  return S;
}

function vnSeeds(y: number): Seed[] {
  const S: Seed[] = [
    { name: 'Tết Dương lịch', ts: utc(y, 1, 1), note: 'Làm móng đón năm mới, khách trẻ đi chơi', scope: 'national' },
    { name: 'Quốc tế Phụ nữ 8/3', ts: utc(y, 3, 8), note: 'Cao điểm — nam giới mua voucher tặng, tiệm nên bán gói đôi mẹ-con', scope: 'national' },
    { name: 'Giỗ Tổ · 30/4 · 1/5', ts: utc(y, 4, 30), spanDays: 3, note: 'Kỳ nghỉ dài, khách đi du lịch — làm móng trước khi đi', scope: 'national' },
    { name: 'Quốc khánh 2/9', ts: utc(y, 9, 2), note: 'Nghỉ lễ, tụ họp, chụp ảnh', scope: 'national' },
    { name: 'Phụ nữ Việt Nam 20/10', ts: utc(y, 10, 20), note: 'Dịp tặng quà lớn thứ hai trong năm sau 8/3', scope: 'national' },
    { name: 'Nhà giáo 20/11', ts: utc(y, 11, 20), note: 'Tệp khách giáo viên — gói làm nhanh sau giờ dạy', scope: 'national' },
    { name: 'Giáng sinh', ts: utc(y, 12, 25), note: 'Giới trẻ đi chơi, chụp ảnh — nail art theo chủ đề', scope: 'national' },
  ];
  const lny = lunarNewYear(y);
  if (lny !== null) {
    S.push({ name: 'Tết Nguyên đán', ts: lny, spanDays: 5, note: 'Mùa lớn nhất năm. Nhận khách kín từ 23 tháng Chạp — mở sổ đặt trước 3 tuần', scope: 'national' });
    S.push({ name: 'Cao điểm trước Tết', ts: lny - 14 * DAY, spanDays: 12, precision: 'approximate', scope: 'national', note: 'Hai tuần trước Tết là lúc đông nhất — tăng giá giờ cao điểm, mở thêm ca', caveat: 'Tùy năm, khách bắt đầu dồn từ 10-20 ngày trước Tết' });
  }
  return S;
}

/**
 * Everything coming up inside `horizonDays`, nearest first.
 *
 * Events are seeded for this year and next, then filtered — which is what makes
 * a December run see New Year and Tết correctly instead of showing dates that
 * have already gone by.
 */
export function regionEvents(
  today: Date,
  input: RegionInput = {},
  opts: { horizonDays?: number } = {},
): { region: ResolvedRegion; events: DatedEvent[] } {
  const r = resolveRegion(input);
  const horizon = opts.horizonDays ?? 45;
  const y = today.getUTCFullYear();
  const now = utc(today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate());

  const seeds = r.market === 'VN'
    ? [...vnSeeds(y), ...vnSeeds(y + 1)]
    : [...usSeeds(y, r), ...usSeeds(y + 1, r)];

  const seen = new Set<string>();
  const events: DatedEvent[] = [];
  for (const s of seeds.sort((a, b) => a.ts - b.ts)) {
    const span = s.spanDays ?? 0;
    // A window counts as upcoming until its LAST day: a salon should still be
    // told "mùa prom" on the second week of it, not have it vanish on day one.
    const endsAway = Math.round((s.ts + span * DAY - now) / DAY);
    const daysAway = Math.round((s.ts - now) / DAY);
    if (endsAway < 0 || daysAway > horizon) continue;
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    events.push({
      name: s.name,
      date: iso(s.ts),
      daysAway,
      spanDays: span,
      note: s.note,
      scope: s.scope,
      precision: s.precision ?? 'exact',
      ...(s.caveat ? { caveat: s.caveat } : {}),
    });
  }
  return { region: r, events: events.sort((a, b) => a.daysAway - b.daysAway) };
}

/** The calendar as prompt text, with its uncertainty intact. */
export function eventsToPrompt(r: ResolvedRegion, events: DatedEvent[]): string {
  if (!events.length) return '';
  const L = [`SỰ KIỆN SẮP TỚI TẠI ${r.label.toUpperCase()}:`];
  for (const e of events) {
    const when = e.daysAway <= 0 ? 'đang diễn ra' : `còn ${e.daysAway} ngày`;
    const span = e.spanDays ? ` (kéo dài ~${e.spanDays} ngày)` : '';
    L.push(`- ${e.name} — ${when}${span}. ${e.note}`);
    if (e.caveat) L.push(`  (không chắc chắn: ${e.caveat})`);
  }
  if (!r.regionKnown) {
    L.push('LƯU Ý: tiệm chưa điền thành phố/bang, nên đây chỉ là các dịp áp dụng ở mọi nơi.');
    L.push('Không được suy đoán tiệm nằm ở đâu, không nhắc tên địa phương nào.');
  }
  return L.join('\n');
}
