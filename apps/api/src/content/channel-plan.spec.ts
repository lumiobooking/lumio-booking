import {
  channelReports, platformPlans, sizeCampaign,
  MEASURABLE_CONVERSIONS, type ChannelBooking, type PlanContext,
} from './channel-plan';

const NOW = Date.UTC(2026, 7, 31);
const DAY = 86_400_000;
const money = (c: number) => `$${Math.round(c / 100)}`;

/** n bookings on a channel, `newOnes` of which are first visits. */
function make(
  channel: ChannelBooking['channel'],
  n: number,
  opts: { newOnes?: number; visits?: number; price?: number; daysAgo?: number; idPrefix?: string } = {},
): ChannelBooking[] {
  const { newOnes = 0, visits = 1, price = 5000, daysAgo = 10, idPrefix = channel } = opts;
  return Array.from({ length: n }, (_, i) => ({
    channel,
    at: NOW - daysAgo * DAY,
    priceCents: price,
    customerId: `${idPrefix}-${i}`,
    isFirstVisit: i < newOnes,
    customerVisits: i < newOnes ? visits : 3,
  }));
}

const CTX: PlanContext = {
  grossMarginPct: 45,
  firstVisitTicketCents: 5000,
  openSlots: 20,
  runDayLabels: ['Chủ nhật', 'Thứ 2'],
  pauseDayLabels: ['Thứ 4'],
  quietLabels: ['Thứ 3 buổi sáng'],
  leadDays: 3,
  topServiceName: 'Bột đắp',
  city: 'Garden Grove', region: 'CA',
  lapsedCount: 42, customerCount: 240, reviewCount: 60,
  money,
};

describe('a channel is judged on who it brings, not how busy it is', () => {
  // The distinction the whole tab turns on: forty bookings from thirty-one new
  // people is a channel that builds a business; forty from nine regulars
  // rebooking is a convenience, and buying ads there buys people you had.
  const builds = make('gmap', 20, { newOnes: 14, visits: 3 });
  const convenience = make('lumiolink', 20, { newOnes: 2, visits: 3 });
  const { reports } = channelReports([...builds, ...convenience], NOW);
  const g = reports.find((r) => r.channel === 'gmap')!;
  const l = reports.find((r) => r.channel === 'lumiolink')!;

  it('calls the acquiring channel one that builds, with its counts', () => {
    expect(g.verdict).toBe('builds');
    expect(g.acquired).toBe(14);
    expect(g.says).toMatch(/14\/20 booking là khách LẦN ĐẦU/);
  });

  it('calls the rebooking channel a convenience, and says what that costs', () => {
    expect(l.verdict).toBe('convenience');
    expect(l.says).toMatch(/khách CŨ đặt lại/);
    expect(l.says).toMatch(/trả tiền cho người vốn đã tới/);
  });

  it('does not let the busier channel win on volume alone', () => {
    // Equal bookings, opposite verdicts. Sorting is by volume, judging is not.
    expect(g.bookings).toBe(l.bookings);
    expect(g.verdict).not.toBe(l.verdict);
  });
});

describe('it refuses to score what it cannot read', () => {
  it('gives no verdict under five bookings', () => {
    const { reports } = channelReports(make('zalo', 3, { newOnes: 3 }), NOW);
    expect(reports[0].verdict).toBe('unproven');
    expect(reports[0].says).toMatch(/chưa đủ để kết luận/);
  });

  it('withholds a rate rather than printing a percentage of three people', () => {
    const { reports } = channelReports(make('gmap', 6, { newOnes: 2 }), NOW);
    expect(reports[0].repeatPct).toBeNull();
    expect(reports[0].visitsPerAcquired).toBeNull();
  });

  it('calls a trend unknown when there is nothing to compare against', () => {
    const { reports } = channelReports(make('gmap', 6, { newOnes: 3 }), NOW);
    expect(reports[0].trend).toBe('unknown');
  });

  it('spots a real decline and says do not advertise over it', () => {
    const rows = [
      ...make('facebook', 4, { newOnes: 2, daysAgo: 20, idPrefix: 'recent' }),
      ...make('facebook', 16, { newOnes: 8, daysAgo: 120, idPrefix: 'old' }),
    ];
    const r = channelReports(rows, NOW).reports[0];
    expect(r.trend).toBe('down');
    expect(r.verdict).toBe('fading');
    expect(r.says).toMatch(/che chỗ hỏng/);
  });
});

describe('unattributed bookings are declared, never quietly divided away', () => {
  it('warns when most of the book carries no channel', () => {
    const rows = [...make('gmap', 5, { newOnes: 3 }), ...make('online', 40)];
    const { coverage, caveat } = channelReports(rows, NOW);
    expect(coverage.pct).toBe(11);
    expect(caveat).toMatch(/40\/45 booking/);
    expect(caveat).toMatch(/UTM/);
  });

  it('stays quiet when attribution is good', () => {
    const rows = [...make('gmap', 40, { newOnes: 20 }), ...make('online', 5)];
    expect(channelReports(rows, NOW).caveat).toBeNull();
  });
});

describe('the budget comes from the ceiling, not from a habit', () => {
  it('sizes the campaign at eight conversions × the ceiling', () => {
    // $15/day was hardcoded for every business on the platform. It looked right
    // for a nail salon, which is why it survived; for a business with a $500
    // ticket it could never buy enough conversions to measure anything.
    const s = sizeCampaign(2250, 20);
    expect(s.target).toBe(MEASURABLE_CONVERSIONS);
    expect(s.totalCents).toBe(Math.floor((2250 * 8) / 14) * 14);
    expect(s.note).toMatch(/8 booking/);
  });

  it('scales with the business rather than with the trade', () => {
    const salon = sizeCampaign(2250, 50);
    const agency = sizeCampaign(22_500, 50);
    expect(agency.dailyCents!).toBeGreaterThan(salon.dailyCents! * 9);
  });

  it('caps the target at the chairs actually free', () => {
    const s = sizeCampaign(2250, 5);
    expect(s.target).toBe(5);
    expect(s.note).toMatch(/giới hạn bởi số chỗ trống/);
  });

  it('says do not advertise when there is no room to seat anyone', () => {
    const s = sizeCampaign(2250, 2);
    expect(s.totalCents).toBeNull();
    expect(s.note).toMatch(/đừng bật quảng cáo/);
  });

  it('refuses to size anything without a ceiling', () => {
    const s = sizeCampaign(null, 20);
    expect(s.dailyCents).toBeNull();
    expect(s.note).toMatch(/chưa có cách nào biết ít hay nhiều/);
  });
});

describe('each platform gets its own number, its own steps and its own stop rule', () => {
  const rows = [
    ...make('gmap', 30, { newOnes: 20, visits: 3, price: 6000 }),
    ...make('facebook', 12, { newOnes: 1, visits: 2, price: 4000 }),
  ];
  const { reports } = channelReports(rows, NOW);
  const plans = platformPlans(reports, CTX);
  const google = plans.find((p) => p.platform === 'google')!;
  const meta = plans.find((p) => p.platform === 'meta')!;

  it('ranks the channel that brings new customers first', () => {
    expect(google.rank).toBe(1);
    expect(google.status).toBe('spend');
  });

  it('prices each platform from the ticket that platform produces', () => {
    // Google's bookings average $60, Meta's $40 — same margin, different
    // ceiling. One ceiling for both would overpay on one and underbid the other.
    expect(google.ceilingCents).toBe(2700);
    expect(meta.ceilingCents).toBe(1800);
  });

  it('gives the first platform a budget and the others none', () => {
    expect(google.totalCents).toBeGreaterThan(0);
    expect(meta.totalCents).toBeNull();
    expect(meta.how.join(' ')).toMatch(/khách cũ đặt lại|không biết kênh nào tạo ra nó/);
  });

  it('writes steps in the platform’s own controls, using the salon’s own data', () => {
    const text = google.how.join(' ');
    expect(text).toMatch(/Bột đắp/);            // its best-selling service
    expect(text).toMatch(/Garden Grove, CA/);    // its own catchment
    expect(text).toMatch(/BẬT Chủ nhật, Thứ 2/); // its own booking rhythm
    expect(text).toMatch(/TẮT Thứ 4/);
    expect(text).toMatch(/Performance Max/);     // the thing not to switch on
  });

  it('states the stop rule as arithmetic, never as a forecast', () => {
    expect(google.watch).toMatch(/tiền đã chi chia cho số booking/);
    expect(google.watch).toMatch(/\$27/);
    expect(JSON.stringify(plans)).not.toMatch(/sẽ mang về|dự kiến \d+ khách/);
  });

  it('warns about a thin Google profile before spending on clicks into it', () => {
    const thin = platformPlans(reports, { ...CTX, reviewCount: 3 });
    expect(thin.find((p) => p.platform === 'google')!.how.join(' ')).toMatch(/3 đánh giá/);
  });

  it('holds a platform whose bookings are all regulars rebooking', () => {
    const onlyRebook = channelReports(make('facebook', 20, { newOnes: 1 }), NOW).reports;
    const p = platformPlans(onlyRebook, CTX).find((x) => x.platform === 'meta')!;
    expect(p.status).toBe('hold');
    expect(p.totalCents).toBeNull();
  });

  it('says plainly when a platform has no history here', () => {
    const p = platformPlans(channelReports(make('gmap', 20, { newOnes: 12 }), NOW).reports, CTX)
      .find((x) => x.platform === 'meta')!;
    expect(p.status).toBe('unproven');
    expect(p.evidence).toMatch(/Chưa có booking nào ghi nhận từ/);
    expect(p.evidence).toMatch(/PHÉP THỬ/);
  });

  it('offers Zalo only in the market where it exists', () => {
    expect(platformPlans(reports, CTX).some((p) => p.platform === 'zalo')).toBe(false);
    expect(platformPlans(reports, { ...CTX, market: 'VN' }).some((p) => p.platform === 'zalo')).toBe(true);
  });

  it('never invents a budget without a margin', () => {
    const blind = platformPlans(reports, { ...CTX, grossMarginPct: null, firstVisitTicketCents: null });
    for (const p of blind) {
      expect(p.ceilingCents).toBeNull();
      expect(p.totalCents).toBeNull();
    }
  });
});
