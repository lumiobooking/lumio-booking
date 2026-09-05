import {
  regionEvents, resolveRegion, parseAddress, nthWeekday, lastWeekday, easter,
  lunarNewYear, hungKings, mondayBefore, eventsToPrompt,
} from './region-events';
import { enOf, viOf } from './i18n';

const d = (s: string) => new Date(`${s}T12:00:00Z`);
/** Names and notes are bilingual now; the calendar is identified by its Vietnamese side. */
const names = (today: string, input: Parameters<typeof regionEvents>[1], horizon = 45) =>
  regionEvents(d(today), input, { horizonDays: horizon }).events.map((e) => viOf(e.name));
const find = (today: string, input: Parameters<typeof regionEvents>[1], name: string, horizon = 400) =>
  regionEvents(d(today), input, { horizonDays: horizon }).events.find((e) => viOf(e.name) === name);
/** The same lookup, for a caller that has asked for the optional cultural days. */
const findCultural = (today: string, input: Parameters<typeof regionEvents>[1], name: string, horizon = 400) =>
  regionEvents(d(today), input, { horizonDays: horizon, includeCultural: true })
    .events.find((e) => viOf(e.name) === name);

describe('date arithmetic is right, not roughly right', () => {
  it('finds the nth weekday of a month', () => {
    // Thanksgiving 2026: 4th Thursday of November = 26 Nov.
    expect(new Date(nthWeekday(2026, 11, 4, 4)).toISOString().slice(0, 10)).toBe('2026-11-26');
    // Labor Day 2026: 1st Monday of September = 7 Sep.
    expect(new Date(nthWeekday(2026, 9, 1, 1)).toISOString().slice(0, 10)).toBe('2026-09-07');
    // Mother's Day 2027: 2nd Sunday of May = 9 May.
    expect(new Date(nthWeekday(2027, 5, 0, 2)).toISOString().slice(0, 10)).toBe('2027-05-09');
  });

  it('finds the last weekday of a month', () => {
    // Memorial Day 2026: last Monday of May = 25 May.
    expect(new Date(lastWeekday(2026, 5, 1)).toISOString().slice(0, 10)).toBe('2026-05-25');
    expect(new Date(lastWeekday(2027, 5, 1)).toISOString().slice(0, 10)).toBe('2027-05-31');
  });

  it('computes Easter across years', () => {
    expect(new Date(easter(2026)).toISOString().slice(0, 10)).toBe('2026-04-05');
    expect(new Date(easter(2027)).toISOString().slice(0, 10)).toBe('2027-03-28');
    expect(new Date(easter(2028)).toISOString().slice(0, 10)).toBe('2028-04-16');
  });

  it('reads Lunar New Year from the table, and admits when it runs out', () => {
    // The bug this replaces: a hardcoded 17 February, right only for 2026.
    expect(new Date(lunarNewYear(2026) as number).toISOString().slice(0, 10)).toBe('2026-02-17');
    expect(new Date(lunarNewYear(2027) as number).toISOString().slice(0, 10)).toBe('2027-02-06');
    expect(new Date(lunarNewYear(2028) as number).toISOString().slice(0, 10)).toBe('2028-01-26');
    expect(lunarNewYear(2099)).toBeNull();
  });
});

describe('a salon with no address is told the truth about it', () => {
  const blank = { market: 'US' };

  it('reports the region as unknown rather than picking one', () => {
    const r = resolveRegion(blank);
    expect(r.regionKnown).toBe(false);
    expect(r.label).toBe('chưa rõ khu vực');
  });

  it('offers only events that are true everywhere', () => {
    const got = names('2026-08-30', blank, 60);
    expect(got).toContain('Lễ Lao động');
    // Everything that depends on knowing the state must be absent.
    expect(got).not.toContain('Tựu trường');
    expect(got).not.toContain('Mùa prom');
  });

  it('tells the model not to guess a location', () => {
    const { region, events } = regionEvents(d('2026-08-30'), blank, { horizonDays: 60 });
    const text = eventsToPrompt(region, events);
    expect(text).toContain('chưa điền thành phố/bang');
    expect(text).toContain('Không được suy đoán');
  });

  it('treats a nonsense state as unknown, not as a place', () => {
    // Half-right geography produces a confident calendar for nowhere.
    expect(resolveRegion({ market: 'US', region: 'ZZ' }).regionKnown).toBe(false);
    expect(resolveRegion({ market: 'US', region: 'ca' }).region).toBe('CA');
  });
});

describe('reading the address the salon already typed in', () => {
  it('pulls city, state and ZIP from a normal US address', () => {
    expect(parseAddress('9550 Bolsa Ave, Westminster, CA 92683')).toEqual({ city: 'Westminster', region: 'CA', postalCode: '92683' });
    expect(parseAddress('123 Main St, Houston, TX 77002-1234').region).toBe('TX');
  });

  it('takes the state from a comma-less address but does not invent the city', () => {
    // Guessing the city from an unpunctuated string turns "San Jose" into
    // "Jose". The state drives the calendar, so keep that and leave city null.
    expect(parseAddress('45 Beacon Street Boston MA 02108')).toEqual({ city: null, region: 'MA', postalCode: '02108' });
    expect(parseAddress('1200 Story Rd San Jose CA 95122')).toEqual({ city: null, region: 'CA', postalCode: '95122' });
  });

  it('works without a ZIP when the state is the last part', () => {
    expect(parseAddress('12 Elm St, Garden Grove, CA')).toEqual({ city: 'Garden Grove', region: 'CA', postalCode: null });
  });

  it('refuses to read a state out of the middle of a name', () => {
    // The failure mode worth guarding: "IN" inside a business name becoming
    // Indiana, and that salon then getting Indiana's school calendar.
    expect(parseAddress('NAILS IN THE CITY, 22 Broadway').region).toBeNull();
    expect(parseAddress('Lux Nail Spa OR Beauty Bar').region).toBeNull();
    expect(parseAddress('Suite 200, ZZ 92840').region).toBeNull();
  });

  it('returns nothing rather than guessing from junk', () => {
    for (const s of ['', '   ', 'chưa cập nhật', '92840', null, undefined]) {
      expect(parseAddress(s as string).region).toBeNull();
    }
  });

  it('does not try to parse non-US addresses as US ones', () => {
    expect(parseAddress('12 Nguyễn Huệ, Quận 1, HCM', 'VN').region).toBeNull();
  });
});

describe('two salons in different states get different calendars', () => {
  const ca = { market: 'US', city: 'Garden Grove', region: 'CA' };
  const ma = { market: 'US', city: 'Boston', region: 'MA' };

  it('California is already back at school when Massachusetts is not', () => {
    // 1 August: CA's window (mid-Aug) is inside 45 days, and so is MA's
    // post-Labor-Day one — but they land on different dates.
    const caStart = find('2026-08-01', ca, 'Tựu trường')?.date;
    const maStart = find('2026-08-01', ma, 'Tựu trường')?.date;
    expect(caStart).toBe('2026-08-15');
    expect(maStart).toBe('2026-09-08'); // day after Labor Day
    expect(caStart).not.toBe(maStart);
  });

  it('prom is April in the South and May in the Northeast', () => {
    expect(find('2026-03-01', { market: 'US', region: 'TX' }, 'Mùa prom')?.date).toBe('2026-04-10');
    expect(find('2026-03-01', ma, 'Mùa prom')?.date).toBe('2026-05-01');
  });

  it('marks school and prom as approximate and says why', () => {
    const e = find('2026-08-01', ca, 'Tựu trường');
    expect(e?.precision).toBe('approximate');
    expect(viOf(e?.caveat)).toMatch(/học khu/);
    expect(e?.spanDays).toBeGreaterThan(0);
  });

  it('OFFERS ONLY THIS COUNTRY’S OWN HOLIDAYS', () => {
    // Tết on a Texas salon's calendar is real for a shop with Vietnamese
    // customers and noise for the shop next door — and once it is in the list
    // it looks exactly like a national holiday. The salon's calendar shows the
    // calendar of the country the salon is standing in.
    expect(find('2026-02-01', ca, 'Tết Nguyên đán')).toBeUndefined();
    expect(find('2026-04-20', ca, 'Cinco de Mayo')).toBeUndefined();
  });

  it('keeps the cultural days for a caller that knows the customer base', () => {
    // Not deleted — asked for. The caveats still say who they are for.
    const tet = findCultural('2026-02-01', ca, 'Tết Nguyên đán');
    expect(tet?.scope).toBe('cultural');
    expect(viOf(tet?.caveat)).toMatch(/nếu tiệm/);
    expect(findCultural('2026-04-20', ca, 'Cinco de Mayo')).toBeTruthy();
    expect(findCultural('2026-04-20', { market: 'US', region: 'ME' }, 'Cinco de Mayo')).toBeUndefined();
  });

  it('now carries the federal days it used to leave out', () => {
    // Every one of these is a paid Monday off for the customers, which for a
    // salon is the point: an empty Monday is the day to run the offer.
    expect(find('2026-05-01', ca, 'Lễ Chiến sĩ trận vong')?.date).toBe('2026-05-25');
    expect(find('2026-01-02', ca, 'Ngày Martin Luther King')?.date).toBe('2026-01-19');
    expect(find('2026-02-01', ca, 'Ngày Tổng thống')?.date).toBe('2026-02-16');
    expect(find('2026-06-01', ca, 'Juneteenth 19/6')?.date).toBe('2026-06-19');
    expect(find('2026-10-20', ca, 'Ngày Cựu chiến binh 11/11')?.date).toBe('2026-11-11');
    expect(find('2026-03-01', ca, 'Lễ Thánh Patrick 17/3')?.date).toBe('2026-03-17');
  });
});

describe('Canada gets Canada’s calendar, not the American one', () => {
  const on = { market: 'CA', city: 'Toronto', region: 'ON' };

  it('THE FOURTH OF JULY IS NOT A CANADIAN HOLIDAY', () => {
    // The sharpest version of the bug: a Toronto shop was handed the American
    // list — Independence Day, an American Thanksgiving six weeks late, and no
    // Canada Day at all.
    expect(find('2026-06-01', on, 'Quốc khánh Mỹ 4/7')).toBeUndefined();
    expect(find('2026-06-01', on, 'Quốc khánh Canada 1/7')?.date).toBe('2026-07-01');
  });

  it('puts Thanksgiving on the Canadian date, six weeks before the American one', () => {
    const t = find('2026-09-01', on, 'Lễ Tạ ơn Canada');
    expect(t?.date).toBe('2026-10-12'); // second Monday of October
    expect(find('2026-09-01', on, 'Lễ Tạ ơn')).toBeUndefined();
  });

  it('has the rest of the federal list, on the dates the federal list gives', () => {
    expect(find('2026-05-01', on, 'Ngày Victoria')?.date).toBe('2026-05-18');
    expect(find('2026-07-01', on, 'Ngày nghỉ tháng 8')?.date).toBe('2026-08-03');
    expect(find('2026-08-01', on, 'Lễ Lao động')?.date).toBe('2026-09-07');
    expect(find('2026-09-01', on, 'Ngày Sự thật và Hoà giải 30/9')?.date).toBe('2026-09-30');
    expect(find('2026-10-01', on, 'Ngày Tưởng niệm 11/11')?.date).toBe('2026-11-11');
    expect(find('2026-12-01', on, 'Boxing Day 26/12')?.date).toBe('2026-12-26');
  });

  it('gives a province its own February Monday, under its own name', () => {
    expect(viOf(find('2026-02-01', on, 'Family Day')?.name)).toBe('Family Day');
    expect(find('2026-02-01', { market: 'CA', region: 'MB' }, 'Louis Riel Day')?.date).toBe('2026-02-16');
    expect(find('2026-02-01', { market: 'CA', region: 'NS' }, 'Heritage Day')).toBeTruthy();
    // Québec's own national day, and only Québec's.
    expect(find('2026-06-01', { market: 'CA', region: 'QC' }, 'Quốc khánh Québec 24/6')?.date).toBe('2026-06-24');
    expect(find('2026-06-01', on, 'Quốc khánh Québec 24/6')).toBeUndefined();
  });

  it('reads Victoria Day’s rule, not a guessed date', () => {
    expect(mondayBefore(2026, 5, 24)).toBe(Date.UTC(2026, 4, 18));
    expect(mondayBefore(2027, 5, 24)).toBe(Date.UTC(2027, 4, 24)); // 24 May IS a Monday
  });
});

describe('the calendar always looks forward', () => {
  it('rolls into next year at the turn', () => {
    const got = names('2026-12-20', { market: 'US', region: 'CA' }, 40);
    expect(got).toContain('Giáng sinh');
    expect(got).toContain('Năm mới');
    // And New Year must be 2027's, not one that has passed.
    expect(find('2026-12-20', { market: 'US', region: 'CA' }, 'Năm mới')?.date).toBe('2027-01-01');
  });

  it('keeps a window visible while it is running, not only before it starts', () => {
    // 20 April is inside the Texas prom window that opened on the 10th.
    const e = find('2026-04-20', { market: 'US', region: 'TX' }, 'Mùa prom', 45);
    expect(e).toBeTruthy();
    expect(e!.daysAway).toBeLessThan(0);
  });

  it('never returns an event that has fully passed', () => {
    for (const day of ['2026-01-15', '2026-06-01', '2026-09-30', '2026-11-05']) {
      const { events } = regionEvents(d(day), { market: 'US', region: 'CA' });
      for (const e of events) expect(e.daysAway + e.spanDays).toBeGreaterThanOrEqual(0);
    }
  });

  it('lists nearest first and never repeats a name', () => {
    const { events } = regionEvents(d('2026-08-30'), { market: 'US', region: 'CA' }, { horizonDays: 365 });
    const seen = new Set<string>();
    let prev = -Infinity;
    for (const e of events) {
      expect(seen.has(viOf(e.name))).toBe(false);
      seen.add(viOf(e.name));
      expect(e.daysAway).toBeGreaterThanOrEqual(prev);
      prev = e.daysAway;
    }
  });
});

describe('Vietnam gets its own calendar, not a translated American one', () => {
  const vn = { market: 'VN', city: 'Hà Nội', region: 'HN' };

  it('shows Vietnamese holidays', () => {
    expect(names('2026-10-01', vn, 60)).toContain('Phụ nữ Việt Nam 20/10');
    expect(names('2026-11-01', vn, 40)).toContain('Nhà giáo 20/11');
  });

  it('does not show American ones', () => {
    const all = regionEvents(d('2026-06-01'), vn, { horizonDays: 365 }).events.map((e) => viOf(e.name));
    expect(all).not.toContain('Quốc khánh Mỹ 4/7');
    expect(all).not.toContain('Lễ Tạ ơn');
    expect(all).not.toContain('Black Friday');
  });

  it('GIVES THE HÙNG KINGS THEIR OWN DAY, NOT 30 APRIL', () => {
    // It used to be glued into one 'Giỗ Tổ · 30/4 · 1/5' entry dated 30 April,
    // which puts a lunar holiday on a fixed Gregorian date it never falls on.
    // It moves with the 3rd lunar month and usually lands in mid-April.
    expect(find('2026-03-01', vn, 'Giỗ Tổ Hùng Vương 10/3 âm lịch')?.date).toBe('2026-04-26');
    expect(find('2027-03-01', vn, 'Giỗ Tổ Hùng Vương 10/3 âm lịch')?.date).toBe('2027-04-16');
    expect(find('2026-03-01', vn, 'Giỗ Tổ · 30/4 · 1/5')).toBeUndefined();
  });

  it('and gives Reunification Day and May Day their own, correct names', () => {
    const e = find('2026-04-01', vn, 'Thống nhất 30/4 · Quốc tế Lao động 1/5');
    expect(e?.date).toBe('2026-04-30');
    expect(e?.spanDays).toBe(2);
    expect(enOf(e?.name)).toMatch(/Reunification Day/);
  });

  it('stops naming a Hùng Kings date once the table runs out', () => {
    // Same rule as Tết: a missing day is a small problem, a confidently wrong
    // one is not. Counting 68 days from Tết would be wrong by a whole month in
    // a year with an intercalary month.
    expect(hungKings(2026)).toBe(Date.UTC(2026, 3, 26));
    expect(hungKings(2035)).toBeNull();
  });

  it('warns about the rush two weeks before Tết, not only about Tết itself', () => {
    const e = find('2027-01-10', vn, 'Cao điểm trước Tết');
    expect(e?.date).toBe('2027-01-23'); // Tết 2027 is 6 Feb
    expect(e?.precision).toBe('approximate');
  });
});

describe('the same calendar reads in English', () => {
  const ca = { market: 'US', city: 'Garden Grove', region: 'CA' };

  it('gives each holiday the name Americans actually use', () => {
    // The English side is the real holiday, not a translation of the
    // Vietnamese: 'Lễ Lao động' is Labor Day, not "Labour Celebration Day".
    const labor = find('2026-08-30', ca, 'Lễ Lao động');
    expect(enOf(labor?.name)).toBe('Labor Day');
    expect(enOf(labor?.name)).not.toBe(viOf(labor?.name));
    expect(enOf(find('2026-11-01', ca, 'Lễ Tạ ơn')?.name)).toBe('Thanksgiving');
    expect(enOf(find('2026-04-20', ca, 'Ngày của Mẹ')?.name)).toBe("Mother's Day");
  });

  it('keeps Tết in the English name, because that IS its English name', () => {
    const tet = findCultural('2026-02-01', ca, 'Tết Nguyên đán');
    expect(enOf(tet?.name)).toContain('Tết');
    expect(enOf(tet?.name)).toMatch(/Lunar New Year/);
  });

  it('translates the notes and the caveats, not only the names', () => {
    const school = find('2026-08-01', ca, 'Tựu trường');
    expect(enOf(school?.note)).not.toBe(viOf(school?.note));
    expect(enOf(school?.note)).toMatch(/August/);
    expect(enOf(school?.caveat)).toMatch(/district/i);
  });

  it('still hands the model Vietnamese, whatever the screen shows', () => {
    const { region, events } = regionEvents(d('2026-11-01'), ca, { horizonDays: 40 });
    const text = eventsToPrompt(region, events);
    expect(text).toContain('Lễ Tạ ơn');
    expect(text).not.toContain('Thanksgiving');
    expect(text).not.toContain('[object Object]');
  });
});
