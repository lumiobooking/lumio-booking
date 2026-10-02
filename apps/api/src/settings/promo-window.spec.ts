import { BadRequestException } from '@nestjs/common';
import { cleanPromoWindow, inPromoWindow, salonYmd } from './promo-window';
import { SettingsService } from './settings.service';
import { BookingsService } from '../bookings/bookings.service';
import { weekdayPct, promoBanner } from '../display/checkin-pricing';

/**
 * "Tất cả chương trình giảm giá nên có ngày bắt đầu và ngày kết thúc."
 * A program with run dates gives its price only to visits inside them; a
 * program without any keeps behaving exactly as before.
 */

describe('the run-date window', () => {
  it('no dates = always on (every promotion saved before this keeps working)', () => {
    expect(inPromoWindow(undefined, '2026-10-02')).toBe(true);
    expect(inPromoWindow({}, '2026-10-02')).toBe(true);
    expect(inPromoWindow({ startDate: null, endDate: null }, '2026-10-02')).toBe(true);
  });
  it('first and last day are both inside', () => {
    const w = { startDate: '2026-10-02', endDate: '2026-10-25' };
    expect(inPromoWindow(w, '2026-10-01')).toBe(false);
    expect(inPromoWindow(w, '2026-10-02')).toBe(true);
    expect(inPromoWindow(w, '2026-10-25')).toBe(true);
    expect(inPromoWindow(w, '2026-10-26')).toBe(false);
  });
  it('only a start, or only an end', () => {
    expect(inPromoWindow({ startDate: '2026-11-01' }, '2026-10-31')).toBe(false);
    expect(inPromoWindow({ endDate: '2026-10-25' }, '2027-01-01')).toBe(false);
  });
  it('saving: omitted keeps, empty clears, garbage clears, end before start is refused', () => {
    const cur = { startDate: '2026-10-02', endDate: '2026-10-25' };
    expect(cleanPromoWindow({}, cur)).toEqual(cur);
    expect(cleanPromoWindow({ endDate: '' }, cur)).toEqual({ startDate: '2026-10-02', endDate: null });
    expect(cleanPromoWindow({ startDate: 'next week' as string }, cur)).toEqual({ startDate: null, endDate: '2026-10-25' });
    expect(() => cleanPromoWindow({ startDate: '2026-10-10', endDate: '2026-10-01' }, null)).toThrow(BadRequestException);
  });
  it('the day is the salon’s, not the server’s', () => {
    // 03:00 UTC on Oct 26 is still the evening of Oct 25 in Alabama.
    expect(salonYmd(new Date('2026-10-26T03:00:00Z'), 'America/Chicago')).toBe('2026-10-25');
  });
});

// ---------------------------------------------------------------- settings

type Row = { tenantId: string; key: string; value: unknown };
function settingsSvc(rows: Row[] = []) {
  const db = [...rows];
  const prisma = {
    setting: {
      findUnique: async ({ where }: { where: { tenantId_key: { tenantId: string; key: string } } }) =>
        db.find((r) => r.tenantId === where.tenantId_key.tenantId && r.key === where.tenantId_key.key) ?? null,
      upsert: async ({ where, update, create }: { where: { tenantId_key: { tenantId: string; key: string } }; update: { value: unknown }; create: Row }) => {
        const hit = db.find((r) => r.tenantId === where.tenantId_key.tenantId && r.key === where.tenantId_key.key);
        if (hit) hit.value = update.value; else db.push({ ...create });
        return {};
      },
    },
  };
  const svc = new SettingsService(prisma as never, { log: jest.fn() } as never);
  (svc as unknown as { get: unknown }).get = async () => ({});
  return { svc, db };
}
const owner = (tenantId: string) => ({ userId: 'u-' + tenantId, tenantId, role: 'SALON_ADMIN' } as never);

describe('every program can be given run dates', () => {
  it('weekday, first-visit and group all store a window; the date rules keep theirs', async () => {
    const { svc } = settingsSvc();
    await svc.updateWeekdayDiscounts(owner('t1'), { enabled: true, rules: [{ day: 2, categoryId: null, percent: 10 }], startDate: '2026-10-02', endDate: '2026-10-25' });
    await svc.updateFirstVisitDiscount(owner('t1'), { enabled: true, rules: [{ visit: 1, percent: 15 }], endDate: '2026-12-31' });
    await svc.updateGroupDiscount(owner('t1'), { enabled: true, tiers: [{ minSize: 2, percent: 10 }], startDate: '2026-11-01' });
    expect(await svc.getWeekdayDiscounts('t1')).toMatchObject({ startDate: '2026-10-02', endDate: '2026-10-25' });
    expect(await svc.getFirstVisitDiscount('t1')).toMatchObject({ startDate: null, endDate: '2026-12-31' });
    expect(await svc.getGroupDiscount('t1')).toMatchObject({ startDate: '2026-11-01', endDate: null });
  });
  it('re-saving the rules without dates keeps the dates already saved', async () => {
    const { svc } = settingsSvc();
    await svc.updateWeekdayDiscounts(owner('t1'), { enabled: true, rules: [{ day: 2, categoryId: null, percent: 10 }], endDate: '2026-10-25' });
    await svc.updateWeekdayDiscounts(owner('t1'), { rules: [{ day: 3, categoryId: null, percent: 20 }] });
    expect((await svc.getWeekdayDiscounts('t1')).endDate).toBe('2026-10-25');
  });
  it('one salon’s window never lands on another salon', async () => {
    const { svc } = settingsSvc();
    await svc.updateGroupDiscount(owner('t1'), { enabled: true, endDate: '2026-10-25' });
    const other = await svc.getGroupDiscount('t2');
    expect(other.endDate).toBeUndefined();
    expect(other.enabled).toBe(false);
  });
});

// ---------------------------------------------------------------- booking price

function bookingsSvc(settings: Record<string, Record<string, unknown>>, tz = 'America/Chicago') {
  const prisma = {
    setting: {
      findUnique: async ({ where }: { where: { tenantId_key: { tenantId: string; key: string } } }) => {
        const v = settings[where.tenantId_key.tenantId]?.[where.tenantId_key.key];
        return v ? { value: v } : null;
      },
      findFirst: async () => null,
    },
    tenant: { findUnique: async () => ({ timezone: tz }) },
    customer: { findFirst: async () => null }, // brand-new customer → visit #1
    appointment: { count: async () => 0 },
  };
  const svc = new BookingsService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  const p = svc as unknown as {
    programDiscountPercent: (t: string, dto: unknown, at?: Date) => Promise<number>;
    promoDiscountPercent: (t: string, at: Date, cat: string | null) => Promise<number>;
  };
  return p;
}
// Noon in Alabama on the given day.
const visit = (ymd: string) => new Date(`${ymd}T17:00:00Z`);
const newCustomer = { customerPhone: '+13345550123', partySize: 3 };

describe('the price a booking gets', () => {
  const t1 = {
    first_visit_discount: { enabled: true, rules: [{ visit: 1, percent: 15 }], startDate: '2026-10-02', endDate: '2026-10-25' },
    group_discount: { enabled: true, tiers: [{ minSize: 2, percent: 10 }], endDate: '2026-10-25' },
    weekday_discounts: { enabled: true, rules: [{ day: 2, categoryId: null, percent: 30 }], startDate: '2026-10-02', endDate: '2026-10-25' },
  };
  it('inside the window the program applies', async () => {
    const p = bookingsSvc({ t1 });
    expect(await p.programDiscountPercent('t1', newCustomer, visit('2026-10-10'))).toBe(15);
    expect(await p.promoDiscountPercent('t1', visit('2026-10-06'), null)).toBe(30); // a Tuesday
  });
  it('after the last day it does not — even if the customer booked during the sale', async () => {
    const p = bookingsSvc({ t1 });
    expect(await p.programDiscountPercent('t1', newCustomer, visit('2026-10-26'))).toBe(0);
    expect(await p.promoDiscountPercent('t1', visit('2026-10-27'), null)).toBe(0); // a Tuesday, after
  });
  it('before the first day it does not', async () => {
    const p = bookingsSvc({ t1 });
    expect(await p.programDiscountPercent('t1', { customerPhone: '+13345550123', partySize: 1 }, visit('2026-10-01'))).toBe(0);
  });
  it('programs without dates are untouched', async () => {
    const p = bookingsSvc({ t1: { group_discount: { enabled: true, tiers: [{ minSize: 2, percent: 10 }] } } });
    expect(await p.programDiscountPercent('t1', { partySize: 2 }, visit('2030-01-01'))).toBe(10);
  });
  it('a salon is priced by ITS programs only', async () => {
    const p = bookingsSvc({ t1, t2: {} });
    expect(await p.programDiscountPercent('t2', newCustomer, visit('2026-10-10'))).toBe(0);
    expect(await p.promoDiscountPercent('t2', visit('2026-10-06'), null)).toBe(0);
  });
});

describe('the kiosk screen', () => {
  const promos = { weekday: { enabled: true, message: 'Tuesday treat', rules: [{ day: 2, categoryId: null, percent: 10 }], endDate: '2026-10-25' } };
  it('shows a weekday price only while the program runs', () => {
    expect(weekdayPct(promos, { dayKey: '2026-10-20', weekday: 2 }, null)).toBe(10);
    expect(weekdayPct(promos, { dayKey: '2026-10-27', weekday: 2 }, null)).toBe(0);
    expect(promoBanner(promos, { dayKey: '2026-10-27', weekday: 2 }, [])).toBeNull();
  });
});
