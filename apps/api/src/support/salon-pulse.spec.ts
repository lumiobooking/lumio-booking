/**
 * The agency list's pulse: bookings this month against the same span of last
 * month, a growth verdict that refuses to guess on thin numbers, and an ads
 * status that flags money going out with nothing coming in. Then the service:
 * every query bounded to the listed salons, nothing from anyone else.
 */
jest.mock('bcrypt', () => ({ hash: async () => 'hashed', compare: async () => true }));
import { adsVerdict, growthVerdict, monthLabel, monthWindows, pctChange, salonPulse } from './salon-pulse';
import { SupportService } from './support.service';

describe('month windows', () => {
  it('compares the 1st–16th with the 1st–16th of last month, never the whole month', () => {
    const w = monthWindows(new Date('2026-10-16T14:30:00Z'));
    expect(w.key).toBe('2026-10');
    expect(w.thisStart.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(w.lastStart.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(w.lastSameEnd.toISOString()).toBe('2026-09-16T14:30:00.000Z');
    expect(w.series.map((m) => m.key)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(w.series[4].end).toBe(w.now);
    expect(w.series[3].end.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('clamps the 31st to a shorter last month, and crosses the year', () => {
    const w = monthWindows(new Date('2026-03-31T10:00:00Z'));
    expect(w.lastSameEnd.toISOString()).toBe('2026-02-28T10:00:00.000Z');
    const j = monthWindows(new Date('2026-01-05T00:00:00Z'));
    expect(j.lastStart.toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(j.series[0].key).toBe('2025-09');
  });
});

describe('growth verdict', () => {
  const old = 400;
  it('reads up, flat and down from the same-span comparison', () => {
    expect(growthVerdict({ month: 138, lastSameSpan: 112 }, old)).toMatchObject({ kind: 'up', label: '▲ +23%' });
    expect(growthVerdict({ month: 115, lastSameSpan: 112 }, old)).toMatchObject({ kind: 'flat', label: '+3%' });
    expect(growthVerdict({ month: 92, lastSameSpan: 112 }, old)).toMatchObject({ kind: 'down', label: '▼ -18%' });
    expect(growthVerdict({ month: 92, lastSameSpan: 112 }, old).reason).toBe('cùng kỳ tháng trước 112 → 92');
  });
  it('refuses to call 7 → 9 a trend, or to judge a salon younger than a month', () => {
    expect(growthVerdict({ month: 9, lastSameSpan: 7 }, old).kind).toBe('thin');
    expect(growthVerdict({ month: 90, lastSameSpan: 60 }, 12)).toMatchObject({ kind: 'thin', label: 'Tiệm mới' });
    expect(growthVerdict({ month: 0, lastSameSpan: 0 }, old).label).toBe('Chưa có booking');
  });
  it('pctChange is null with nothing to compare against', () => {
    expect(pctChange(5, 0)).toBeNull();
    expect(pctChange(150, 100)).toBe(50);
  });
});

describe('ads verdict', () => {
  it('on, with the cost of a booking, when money went out and bookings came through a paid channel', () => {
    expect(adsVerdict({ spendCents: 30000, bookings: 12, lastSpendMonth: '2026-10' }, '2026-10'))
      .toEqual({ kind: 'on', spendCents: 30000, bookings: 12, perBookingCents: 2500, lastMonth: '2026-10' });
  });
  it('warns from $50 with nothing back; a $20 test does not alarm anyone', () => {
    expect(adsVerdict({ spendCents: 18000, bookings: 0, lastSpendMonth: '2026-10' }, '2026-10').kind).toBe('warn');
    expect(adsVerdict({ spendCents: 2000, bookings: 0, lastSpendMonth: '2026-10' }, '2026-10').kind).toBe('on');
  });
  it('off remembers the last month that ran; none never ran', () => {
    expect(adsVerdict({ spendCents: 0, bookings: 3, lastSpendMonth: '2026-08' }, '2026-10')).toMatchObject({ kind: 'off', lastMonth: '2026-08' });
    expect(adsVerdict({ spendCents: 0, bookings: 3, lastSpendMonth: null }, '2026-10').kind).toBe('none');
    expect(monthLabel('2026-08')).toBe('T8/2026');
  });
});

describe('salonPulse', () => {
  it('assembles the row: last month entire under the arrow, pct null when thin', () => {
    const p = salonPulse({ month: 60, lastSameSpan: 50, series: [80, 90, 100, 110, 60], createdAt: new Date('2025-01-01'), now: new Date('2026-10-16T12:00:00Z'), spendCents: 0, adsBookings: 0, lastSpendMonth: null });
    expect(p.bookings).toEqual({ month: 60, lastSameSpan: 50, lastMonth: 110, series: [80, 90, 100, 110, 60], pct: 20 });
    expect(p.growth.kind).toBe('up');
    const thin = salonPulse({ month: 3, lastSameSpan: 2, series: [0, 0, 0, 4, 3], createdAt: new Date('2025-01-01'), now: new Date('2026-10-16T12:00:00Z'), spendCents: 0, adsBookings: 0, lastSpendMonth: null });
    expect(thin.bookings.pct).toBeNull();
  });
});

describe('the list reads every salon in grouped queries, bounded to the listed salons', () => {
  type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const seen: Row[] = [];
  const ten = (id: string, created: string) => ({ id, name: id.toUpperCase(), slug: id, status: 'ACTIVE', createdAt: new Date(created), supportTeam: null, market: 'US' });
  const counts: Record<string, Record<string, number>> = {
    // keyed by the window's start month; the same-span window shares a start with September entire
    a: { '2026-10': 138, '2026-09': 112, '2026-08': 120, '2026-07': 100, '2026-06': 90 },
    b: { '2026-10': 2, '2026-09': 1 },
  };
  const prisma: Row = {
    tenant: { findMany: async () => [ten('a', '2025-01-01'), ten('b', '2026-10-01')] },
    setting: { findMany: async () => [] },
    scheduledPost: { groupBy: async () => [] },
    messengerPage: { findMany: async () => [] },
    appointment: {
      groupBy: async ({ where }: Row) => {
        seen.push(where);
        const key = (where.startTime.gte as Date).toISOString().slice(0, 7);
        const sameSpan = (where.startTime.lt as Date).getUTCDate() === 16 && key === '2026-09';
        return (where.tenantId.in as string[]).filter((id) => counts[id]).map((id) => ({
          tenantId: id, _count: { _all: sameSpan ? Math.round((counts[id][key] ?? 0) * 0.5) : (counts[id][key] ?? 0) },
        }));
      },
      findMany: async ({ where }: Row) => {
        seen.push(where);
        // Salon z is NOT on the list and must never leak into anyone's count.
        return [
          { tenantId: 'a', source: 'plugin', utmSource: 'facebook' }, { tenantId: 'a', source: 'gmap' }, { tenantId: 'a', source: 'walkin' },
          { tenantId: 'z', source: 'gmap' },
        ].filter((r) => (where.tenantId.in as string[]).includes(r.tenantId));
      },
    },
    marketingSpend: {
      findMany: async ({ where }: Row) => { seen.push(where); return [{ tenantId: 'a', amountCents: 30000 }, { tenantId: 'a', amountCents: 10000 }]; },
      groupBy: async ({ where }: Row) => { seen.push(where); return [{ tenantId: 'a', _max: { periodMonth: '2026-10' } }]; },
    },
  };

  it('prints the pulse per salon, scoped by tenantId on every query', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-16T14:30:00Z'));
    try {
      const svc = new SupportService(prisma as never, {} as never, {} as never, {} as never);
      const rows = await svc.listTenants() as Row[];
      const a = rows.find((r) => r.id === 'a')!.pulse;
      // 138 this month vs the first half of September (56): up; September entire (112) under the arrow.
      expect(a.bookings).toMatchObject({ month: 138, lastSameSpan: 56, lastMonth: 112, series: [90, 100, 120, 112, 138] });
      expect(a.growth.kind).toBe('up');
      // $400 spent, 2 bookings through paid channels (facebook utm + Google Maps; the walk-in is not one).
      expect(a.ads).toEqual({ kind: 'on', spendCents: 40000, bookings: 2, perBookingCents: 20000, lastMonth: '2026-10' });
      // Salon b opened this month: no verdict, no ads ever.
      const b = rows.find((r) => r.id === 'b')!.pulse;
      expect(b.growth.kind).toBe('thin');
      expect(b.ads.kind).toBe('none');
      for (const w of seen) expect(w.tenantId.in).toEqual(['a', 'b']);
    } finally { jest.useRealTimers(); }
  });
});
