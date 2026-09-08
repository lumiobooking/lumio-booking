import { adsCalendar, pushLead } from './ads-calendar';
import { bi, viOf } from './i18n';
import type { DatedEvent } from './region-events';

const today = new Date('2026-09-07T12:00:00Z');
const ev = (o: Partial<DatedEvent>): DatedEvent => ({
  name: bi('Halloween', 'Halloween'), date: '2026-10-31', daysAway: 54, spanDays: 0,
  note: '', scope: 'national', precision: 'exact', ...o,
});
const dayOf = (c: ReturnType<typeof adsCalendar>, iso: string) =>
  c.periods.find((p) => p.from <= iso && iso <= p.to)!;

describe('adsCalendar', () => {
  it('opens the push as early as THIS shop books, not on a fixed rule', () => {
    expect(pushLead(4)).toBe(7);   // books 4 days ahead → open a week before
    expect(pushLead(11)).toBe(14); // books far ahead → capped at two weeks
    expect(pushLead(null)).toBe(7); // no measurement → a week
    expect(pushLead(1)).toBe(5);   // same-week shop → floor of five days
  });

  it('spends more in the run-up to a date and less straight after it', () => {
    const c = adsCalendar({ baseDailyCents: 2000, events: [ev({ date: '2026-10-31' })], leadDays: 4, today });
    // 7 days before Halloween, through the day itself.
    expect(dayOf(c, '2026-10-26').kind).toBe('push');
    expect(dayOf(c, '2026-10-31').kind).toBe('push');
    expect(dayOf(c, '2026-10-26').dailyCents).toBeGreaterThan(2000);
    // And the days after, when everyone who wanted it has just been in.
    expect(dayOf(c, '2026-11-02').kind).toBe('cut');
    expect(dayOf(c, '2026-11-02').dailyCents).toBeLessThan(2000);
    expect(viOf(dayOf(c, '2026-11-02').why)).toMatch(/vừa làm xong/);
  });

  it('MOVES the money rather than asking for more — each month costs what flat cost', () => {
    // The property that makes the advice checkable: an agency whose answer to
    // every question is "spend more" cannot be argued with.
    const c = adsCalendar({
      baseDailyCents: 2000, leadDays: 4, today,
      events: [ev({ date: '2026-10-31' }), ev({ name: bi('Mùa prom', 'Prom season'), date: '2026-11-10', spanDays: 20 })],
    });
    for (const m of c.months) {
      expect(Math.abs(m.totalCents - m.flatCents) / m.flatCents).toBeLessThan(0.02);
    }
  });

  it('lets the next run-up beat the lull after the last one', () => {
    // Two dates four days apart: the cut after the first must not silence the
    // push into the second, which is what a naive "last window wins" would do.
    const c = adsCalendar({
      baseDailyCents: 2000, leadDays: 1, today,
      events: [ev({ name: bi('Ngày A', 'Day A'), date: '2026-09-20' }), ev({ name: bi('Ngày B', 'Day B'), date: '2026-09-24' })],
    });
    expect(dayOf(c, '2026-09-21').kind).toBe('push');
    expect(viOf(dayOf(c, '2026-09-21').label!)).toBe('Ngày B');
  });

  it('holds steady, and says so, when nothing is coming', () => {
    const c = adsCalendar({ baseDailyCents: 2000, events: [], leadDays: 4, today });
    expect(c.periods.every((p) => p.kind === 'base' && p.dailyCents === 2000)).toBe(true);
    expect(viOf(c.plain)).toMatch(/Không có dịp nào/);
    expect(c.diary).toHaveLength(0);
  });

  it('schedules nothing at all rather than guessing when there is no base budget', () => {
    const c = adsCalendar({ baseDailyCents: 0, events: [ev({})], leadDays: 4, today });
    expect(c.periods).toEqual([]);
    expect(viOf(c.plain)).toMatch(/Ngưỡng chi cho mỗi khách phải có trước/);
  });

  it('writes the diary line a person acts on, with the date to do it', () => {
    const c = adsCalendar({ baseDailyCents: 2000, events: [ev({ date: '2026-10-31' })], leadDays: 4, today });
    const d = c.diary[0];
    expect(d.on).toBe('2026-10-24');
    expect(viOf(d.line)).toMatch(/^Nâng lên \$\d+\/ngày cho Halloween — chạy tới 2026-10-31\.$/);
  });
});
