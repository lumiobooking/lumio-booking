import { buildCampaignSpec, GOOGLE_HEADLINE_MAX, GOOGLE_DESC_MAX, type CampaignSpecInput } from './campaign-spec';
import { bi, enOf, viOf } from './i18n';

const money = (c: number) => `$${Math.round(c / 100)}`;
const BASE: CampaignSpecInput = {
  platform: 'google',
  businessName: 'Lumio Nails',
  city: 'Katy', region: 'TX',
  topServiceName: 'Bột đắp móng',
  offerHeadline: null,
  reviewCount: 34,
  bookingUrl: 'https://lumionails.com/dat-lich',
  lapsedCount: 41,
  runDayLabels: [bi('Thứ 3', 'Tue'), bi('Thứ 4', 'Wed')],
  quietLabel: bi('Thứ 3 sáng', 'Tuesday morning'),
  dailyCents: 1400, days: 14, ceilingCents: 2450, targetBookings: 8,
  weekKey: '2026-W36',
  money,
};
const spec = (over: Partial<CampaignSpecInput> = {}) => buildCampaignSpec({ ...BASE, ...over });

/** Everything a person would have to type in, present and unambiguous. */
describe('the plan stops being advice and becomes a form somebody can fill in', () => {
  const s = spec();

  it('names the campaign so it is still identifiable in three months', () => {
    // "Campaign 2 (copy)" is the name every account ends up full of.
    expect(viOf(s.name)).toBe('Search_Bot-dap-mong_Katy_2026-W36');
    // ad platforms and exports dislike diacritics in names — in either language
    expect(viOf(s.name)).not.toMatch(/[^\x20-\x7e]/);
    expect(enOf(s.name)).not.toMatch(/[^\x20-\x7e]/);
  });

  it('gives the ad set its audience, its radius and its schedule', () => {
    const set = s.adSets[0];
    expect(viOf(set.who)).toContain('Bột đắp móng');
    expect(viOf(set.where)).toContain('Katy, TX');
    expect(viOf(set.when)).toContain('Thứ 3');
    expect(set.exclude).toBeTruthy();
  });

  it('picks the setting that is wrong by default, by name', () => {
    // "People interested in this location" is the default that quietly bills a
    // salon for clicks from three states away.
    expect(viOf(s.adSets[0].where)).toContain('Presence');
    expect(viOf(s.objective)).toMatch(/Performance Max/);
  });

  it('says what to check before the money starts moving, not after', () => {
    expect(s.before.map(viOf).join(' ')).toMatch(/UTM/);
    expect(s.before.length).toBeGreaterThan(1);
  });

  it('turns the stop rule into dates and dollars', () => {
    const m = s.measure.map(viOf).join(' ');
    expect(m).toContain('$25'); // the ceiling, rounded by money()
    expect(m).toMatch(/Ngày 3/);
    expect(m).toMatch(/Ngày 7/);
  });
});

describe('the copy only says things the salon can stand behind', () => {
  it('never writes a superlative or a rating nobody earned', () => {
    const all = [...spec().creative.headlines, ...spec().creative.descriptions].join(' ').toLowerCase();
    // A claim we invent becomes a claim the salon is answering for — to the ad
    // platform's review, and to a state's advertising rules.
    for (const banned of ['tốt nhất', 'số 1', 'uy tín nhất', 'rẻ nhất', '5 sao', 'best', 'top-rated', '#1']) {
      expect(all).not.toContain(banned);
    }
  });

  it('mentions reviews only when there are enough of them to help', () => {
    expect(spec({ reviewCount: 34 }).creative.headlines.join(' ')).toContain('34 đánh giá');
    // "3 đánh giá" advertises that the salon is new.
    expect(spec({ reviewCount: 3 }).creative.headlines.join(' ')).not.toContain('đánh giá');
  });

  it('leaves the offer line out entirely when no discount was justified', () => {
    expect(spec({ offerHeadline: null }).creative.headlines.every((h) => !/giảm|off|sale/i.test(h))).toBe(true);
  });

  it('says the landing page is missing rather than inventing one', () => {
    const s = spec({ bookingUrl: null });
    expect(viOf(s.creative.landing)).toMatch(/CHƯA CÓ/);
    expect(viOf(s.creative.landing)).not.toMatch(/https?:/);
  });

  it('points the picture at footage that exists instead of asking for a shoot', () => {
    expect(viOf(spec({ platform: 'meta' }).creative.visual)).toMatch(/lượt xem cao nhất/);
  });
});

describe('platform character limits are enforced, because past them the ad is rejected', () => {
  it('keeps every Google headline and description inside the limit', () => {
    const s = spec({ topServiceName: 'Bột đắp móng gel cao cấp phủ thạch anh nhiều màu' });
    for (const h of s.creative.headlines) expect(h.length).toBeLessThanOrEqual(GOOGLE_HEADLINE_MAX);
    for (const d of s.creative.descriptions) expect(d.length).toBeLessThanOrEqual(GOOGLE_DESC_MAX);
  });

  it('cuts on a word boundary and reports what it cut', () => {
    const s = spec({ topServiceName: 'Bột đắp móng gel cao cấp phủ thạch anh nhiều màu' });
    expect(s.warnings.length).toBeGreaterThan(0);
    // A headline that lost its second half should be rewritten by a person, so
    // the cut is surfaced rather than shipped quietly.
    expect(viOf(s.warnings[0])).toMatch(/quá giới hạn 30/);
    for (const h of s.creative.headlines) expect(h).not.toMatch(/\s$/);
  });

  it('says nothing when nothing had to be cut', () => {
    expect(spec().warnings).toEqual([]);
  });
});

describe('Meta is planned as three audiences in price order, not one', () => {
  const s = spec({ platform: 'meta' });

  it('starts with the customers the salon already paid to acquire', () => {
    expect(viOf(s.adSets[0].who)).toContain('41 khách cũ');
  });

  it('falls back to retargeting when the lapsed list is too small to upload', () => {
    // Meta will not match a list of nine, so offering it as an ad set would be
    // an instruction that fails silently in the interface.
    const small = spec({ platform: 'meta', lapsedCount: 9 });
    expect(viOf(small.adSets[0].who)).toMatch(/nhắn tin|xem trang/);
  });

  it('chooses an objective that produces bookings rather than applause', () => {
    expect(viOf(s.objective)).toMatch(/Messages|Leads/);
    expect(viOf(s.objective)).toMatch(/KHÔNG chọn Engagement/);
  });

  it('keeps the regulars out of every ad set', () => {
    expect(s.adSets.every((a) => a.exclude !== null)).toBe(true);
  });
});

describe('what it refuses to print', () => {
  it('gives no budget line when the ceiling could not be computed', () => {
    const s = spec({ dailyCents: null, ceilingCents: null });
    expect(viOf(s.budgetLine)).toMatch(/Chưa tính được/);
    expect(viOf(s.budgetLine)).not.toMatch(/\$/);
    expect(enOf(s.budgetLine)).not.toMatch(/\$/);
  });

  it('drops the daily-number measurement when there is no ceiling to measure against', () => {
    const s = spec({ ceilingCents: null });
    expect(s.measure.map(viOf).join(' ')).not.toMatch(/Ngày 3/);
  });

  it('still works for a salon that has declared almost nothing', () => {
    const s = spec({ businessName: null, city: null, region: null, topServiceName: null, quietLabel: null, runDayLabels: [] });
    expect(viOf(s.name)).toBe('Search_Dich-vu_Local_2026-W36');
    expect(s.creative.headlines.length).toBeGreaterThan(0);
    expect(viOf(s.adSets[0].when)).toContain('cả tuần');
  });
});

describe('an English reader gets English', () => {
  it('writes the objective, the ad sets and the stop rule twice', () => {
    const s = spec();
    expect(enOf(s.objective)).toMatch(/Performance Max/);
    expect(enOf(s.objective)).not.toBe(viOf(s.objective));

    const set = s.adSets[0];
    // The service and the town are the salon's own words and read the same.
    expect(enOf(set.who)).toContain('Bột đắp móng');
    expect(enOf(set.where)).toContain('Katy, TX');
    expect(enOf(set.where)).toMatch(/3 to 5 mile radius/);
    // The day and slot names arrive bilingual now, instead of Vietnamese ones
    // being printed inside an English sentence.
    expect(enOf(set.when)).toMatch(/^Run it Tue, Wed\./);
    expect(enOf(set.when)).toContain('Tuesday morning');
    expect(enOf(set.exclude)).not.toBe(viOf(set.exclude));

    // A sentence with money and a day count in it is written out whole.
    expect(enOf(s.budgetLine)).toMatch(/\$14\/day × 14 days = \$196/);
    expect(s.measure.map(enOf).join(' ')).toMatch(/Over \$25 a booking and you are losing money/);
    expect(s.before.map(enOf).join(' ')).toMatch(/utm_source=google/);
  });

  it('does not leave a Vietnamese slug in the name an English reader types in', () => {
    const s = spec({ topServiceName: null });
    expect(viOf(s.name)).toBe('Search_Dich-vu_Katy_2026-W36');
    expect(enOf(s.name)).toBe('Search_Service_Katy_2026-W36');

    const meta = spec({ platform: 'meta', topServiceName: null });
    expect(enOf(meta.adSets[0].name)).toBe('Lapsed-41');
    expect(s.adSets.every((a) => enOf(a.when) !== viOf(a.when))).toBe(true);
  });

  it('says what is missing in English too', () => {
    const s = spec({ bookingUrl: null });
    expect(enOf(s.creative.landing)).toMatch(/MISSING/);
    expect(enOf(s.creative.landing)).not.toBe(viOf(s.creative.landing));
    const cut = spec({ topServiceName: 'Bột đắp móng gel cao cấp phủ thạch anh nhiều màu' });
    expect(enOf(cut.warnings[0])).toMatch(/past the 30-character limit on a Google headline/);
  });
});
