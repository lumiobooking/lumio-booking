import { buildCampaignSpec, GOOGLE_HEADLINE_MAX, GOOGLE_DESC_MAX, type CampaignSpecInput } from './campaign-spec';

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
  runDayLabels: ['Thứ 3', 'Thứ 4'],
  quietLabel: 'Thứ 3 sáng',
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
    expect(s.name).toBe('Search_Bot-dap-mong_Katy_2026-W36');
    expect(s.name).not.toMatch(/[^\x20-\x7e]/); // ad platforms and exports dislike diacritics in names
  });

  it('gives the ad set its audience, its radius and its schedule', () => {
    const set = s.adSets[0];
    expect(set.who).toContain('Bột đắp móng');
    expect(set.where).toContain('Katy, TX');
    expect(set.when).toContain('Thứ 3');
    expect(set.exclude).toBeTruthy();
  });

  it('picks the setting that is wrong by default, by name', () => {
    // "People interested in this location" is the default that quietly bills a
    // salon for clicks from three states away.
    expect(s.adSets[0].where).toContain('Presence');
    expect(s.objective).toMatch(/Performance Max/);
  });

  it('says what to check before the money starts moving, not after', () => {
    expect(s.before.join(' ')).toMatch(/UTM/);
    expect(s.before.length).toBeGreaterThan(1);
  });

  it('turns the stop rule into dates and dollars', () => {
    const m = s.measure.join(' ');
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
    expect(s.creative.landing).toMatch(/CHƯA CÓ/);
    expect(s.creative.landing).not.toMatch(/https?:/);
  });

  it('points the picture at footage that exists instead of asking for a shoot', () => {
    expect(spec({ platform: 'meta' }).creative.visual).toMatch(/lượt xem cao nhất/);
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
    expect(s.warnings[0]).toMatch(/quá giới hạn 30/);
    for (const h of s.creative.headlines) expect(h).not.toMatch(/\s$/);
  });

  it('says nothing when nothing had to be cut', () => {
    expect(spec().warnings).toEqual([]);
  });
});

describe('Meta is planned as three audiences in price order, not one', () => {
  const s = spec({ platform: 'meta' });

  it('starts with the customers the salon already paid to acquire', () => {
    expect(s.adSets[0].who).toContain('41 khách cũ');
  });

  it('falls back to retargeting when the lapsed list is too small to upload', () => {
    // Meta will not match a list of nine, so offering it as an ad set would be
    // an instruction that fails silently in the interface.
    const small = spec({ platform: 'meta', lapsedCount: 9 });
    expect(small.adSets[0].who).toMatch(/nhắn tin|xem trang/);
  });

  it('chooses an objective that produces bookings rather than applause', () => {
    expect(s.objective).toMatch(/Messages|Leads/);
    expect(s.objective).toMatch(/KHÔNG chọn Engagement/);
  });

  it('keeps the regulars out of every ad set', () => {
    expect(s.adSets.every((a) => a.exclude !== null)).toBe(true);
  });
});

describe('what it refuses to print', () => {
  it('gives no budget line when the ceiling could not be computed', () => {
    const s = spec({ dailyCents: null, ceilingCents: null });
    expect(s.budgetLine).toMatch(/Chưa tính được/);
    expect(s.budgetLine).not.toMatch(/\$/);
  });

  it('drops the daily-number measurement when there is no ceiling to measure against', () => {
    const s = spec({ ceilingCents: null });
    expect(s.measure.join(' ')).not.toMatch(/Ngày 3/);
  });

  it('still works for a salon that has declared almost nothing', () => {
    const s = spec({ businessName: null, city: null, region: null, topServiceName: null, quietLabel: null, runDayLabels: [] });
    expect(s.name).toBe('Search_Dich-vu_Local_2026-W36');
    expect(s.creative.headlines.length).toBeGreaterThan(0);
    expect(s.adSets[0].when).toContain('cả tuần');
  });
});
