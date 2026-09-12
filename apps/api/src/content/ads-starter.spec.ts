import { adsPitch } from './ads-pitch';
import {
  ticketHint, ticketAsk, dataRoadmap, roadmapProgress, confidenceOf, confidenceLabel, TICKET_BAND,
} from './ads-starter';
import { viOf, enOf } from './i18n';

const money = (c: number) => `$${Math.round(c / 100)}`;

/** Everything a salon on its first day has: a channel, a trade, nothing else. */
const thin = {
  ceilingCents: null,
  dailyCents: 1500,
  days: 14,
  totalCents: 21000,
  bookingsToBreakEven: null,
  openSlots: null,
  feasible: 'unknown' as const,
  missing: 'ticket' as const,
  platform: { label: { vi: 'Google (Tìm kiếm + Maps)', en: 'Google (Search + Maps)' }, key: 'google' },
  secondPlatform: { vi: 'Facebook và Instagram', en: 'Facebook and Instagram' },
  platformShort: { vi: 'Google', en: 'Google' },
  secondShort: { vi: 'Meta', en: 'Meta' },
  runDays: [{ vi: 'Thứ 3', en: 'Tue' }, { vi: 'Thứ 4', en: 'Wed' }],
  pauseDays: [{ vi: 'Thứ 7', en: 'Sat' }],
  quietBlocks: [{ vi: 'Thứ 4 2-5 giờ chiều', en: 'Wed 2-5pm' }],
};

const bare = { hasMenuPrices: false, marginEntered: false, hasHours: false, hasStaff: false, googleConnected: false, pageConnected: false, hasTicket: false, ticketMeasured: false };

describe('the ad card on a shop with no numbers yet', () => {
  it('PROPOSES instead of refusing — the state that used to be a dead end', () => {
    // The screen an owner meets on the first call. It used to print one
    // sentence of homework and no plan, which is the moment the agency most
    // needs something to talk about.
    const p = adsPitch({ ...thin, roadmap: dataRoadmap(bare), ask: ticketAsk(ticketHint('NAIL', money)) });
    expect(p.state).toBe('starter');
    expect(p.confidence).toBe('starter');
    expect(viOf(p.headline)).toBe('Đề xuất khởi động cho tiệm');
    expect(viOf(p.headline)).not.toMatch(/Chưa tính được/);
    // Four of the five questions are answered without the missing number.
    expect(p.steps.length).toBeGreaterThanOrEqual(3);
    expect(p.figures).toHaveLength(3);
    expect(p.roadmap?.length).toBeGreaterThan(0);
    expect(p.ask).not.toBeNull();
  });

  it('NEVER invents a break-even out of a trade average', () => {
    // The one number on this card that could lose her real money is a
    // spending limit per customer. A limit derived from a borrowed ticket
    // would be believed precisely because it looks like arithmetic.
    const p = adsPitch({ ...thin, roadmap: dataRoadmap(bare), ask: ticketAsk(ticketHint('NAIL', money)) });
    const figures = p.figures.map((f) => `${f.value} ${viOf(f.label)}`).join(' | ');
    expect(figures).not.toMatch(/huề vốn|hoà vốn|tối đa mỗi khách/);
    // What it shows instead is structural: the floor spend, the window, and
    // the booking count below which no cost-per-customer means anything.
    expect(p.figures[0].value).toBe('$15');
    expect(viOf(p.figures[2].label)).toMatch(/đọc được kết quả/);
    expect(p.figures[2].value).toBe('8');
  });

  it('states the stopping rule in words when it cannot state it in dollars', () => {
    // The bug this replaces: the steps quote the limit five times, and with no
    // ticket the substitution was empty — "Rẻ hơn /khách", a sentence with a
    // hole in it, on the card that is supposed to make a yes safe to give.
    const p = adsPitch({ ...thin, roadmap: dataRoadmap(bare), ask: ticketAsk(null) });
    const vi = p.steps.map((st) => [viOf(st.head), viOf(st.body), st.detail ? viOf(st.detail) : '', st.when ? viOf(st.when) : ''].join(' ')).join(' ');
    const en = p.steps.map((st) => [enOf(st.head), enOf(st.body), st.detail ? enOf(st.detail) : '', st.when ? enOf(st.when) : ''].join(' ')).join(' ');
    expect(vi).not.toMatch(/Rẻ hơn \/|Dưới \/|Vượt \s/);
    expect(en).not.toMatch(/Cheaper than  |Under  |Over  /);
    expect(vi).toMatch(/ngưỡng hoà vốn của tiệm/);
    expect(en).toMatch(/your break-even limit/);
  });

  it('keeps the trade vocabulary out of the starter card too', () => {
    const p = adsPitch({ ...thin, roadmap: dataRoadmap(bare), ask: ticketAsk(ticketHint('NAIL', money)) });
    const both = Object.values(p).map((v) => JSON.stringify(v)).join(' ');
    expect(both).not.toMatch(/CPA|feasib|lifetime|LTV|phép đo|unproven|verdict/i);
  });

  it('falls back to the old refusal ONLY when there is no channel to name', () => {
    // Honest end of the ladder: with no ticket and no connected channel there
    // is genuinely nowhere to put money, and saying so beats a plan made up.
    const p = adsPitch({ ...thin, platform: null, secondPlatform: null, roadmap: dataRoadmap(bare), ask: ticketAsk(null) });
    expect(p.state).toBe('unknown');
    expect(p.figures).toHaveLength(0);
    expect(viOf(p.why)).toMatch(/nối Google hoặc Fanpage/);
    // It still names the thing that would actually fix it.
    expect(viOf(p.why)).toMatch(/bảng giá dịch vụ/);
  });

  it('carries the roadmap on the COSTED tiers as well', () => {
    // On a fully measured card the same list stops being a list of faults and
    // becomes what would sharpen the answer. Hiding it there would make it
    // read as a punishment for being new.
    const p = adsPitch({
      ceilingCents: 3800, dailyCents: 1400, days: 14, totalCents: 19600,
      bookingsToBreakEven: 6, openSlots: 14, feasible: 'yes',
      confidence: 'measured',
      roadmap: dataRoadmap({ ...bare, hasMenuPrices: true, hasTicket: true, ticketMeasured: true }),
    });
    expect(p.state).toBe('offer');
    expect(p.confidence).toBe('measured');
    expect(p.roadmap?.some((st) => !st.done)).toBe(true);
  });
});

describe('the roadmap', () => {
  it('puts what is NOT done first, so the top of the list is the next move', () => {
    const steps = dataRoadmap({ ...bare, hasMenuPrices: true, googleConnected: true });
    const firstDone = steps.findIndex((s) => s.done);
    const lastUndone = steps.map((s) => s.done).lastIndexOf(false);
    expect(lastUndone).toBeLessThan(firstDone);
  });

  it('keeps finished steps on the list — a list that hides progress shows none', () => {
    const steps = dataRoadmap({ ...bare, hasMenuPrices: true });
    expect(steps).toHaveLength(6);
    expect(steps.find((s) => s.key === 'menu-prices')?.done).toBe(true);
  });

  it('says what each step UNLOCKS, not just what to type', () => {
    for (const st of dataRoadmap(bare)) {
      expect(viOf(st.unlocks).length).toBeGreaterThan(20);
      expect(viOf(st.where).length).toBeGreaterThan(5);
      expect(st.minutes).toBeGreaterThan(0);
      expect(['shop', 'lumio']).toContain(st.who);
    }
  });

  it('leads with the price list, because it unlocks the most per minute', () => {
    expect(dataRoadmap(bare)[0].key).toBe('menu-prices');
  });

  it('counts the minutes left, so "later" has a size', () => {
    const p = roadmapProgress(dataRoadmap(bare));
    expect(p.done).toBe(0);
    expect(p.total).toBe(6);
    expect(p.minutesLeft).toBe(32);
    const half = roadmapProgress(dataRoadmap({ ...bare, hasMenuPrices: true, hasHours: true }));
    expect(half.done).toBe(2);
    expect(half.minutesLeft).toBe(14);
  });
});

describe('the trade price band', () => {
  it('offers a band as a HINT and says out loud that it is not the shop\'s number', () => {
    const h = ticketHint('NAIL', money)!;
    expect(h.lowCents).toBe(3000);
    expect(viOf(h.note)).toMatch(/KHÔNG phải số của tiệm/);
    expect(enOf(h.note)).toMatch(/NOT your number/);
  });

  it('REFUSES to guess for a trade it has no published figure for', () => {
    // Lash refills, facials, massage packages and PMU touch-ups all have a
    // real typical visit and this file has no citation for one. Estimating
    // them from the nail band is exactly the fabrication the card exists to
    // avoid: an over-stated ticket licenses over-spending.
    for (const trade of ['LASH', 'BROW', 'SPA', 'MASSAGE', 'PMU', 'RESTAURANT', 'REAL_ESTATE', 'SERVICE']) {
      expect(ticketHint(trade, money)).toBeNull();
      expect(TICKET_BAND[trade]).toBeUndefined();
    }
  });

  it('leans on the LOW end of the band, because the ticket sets the spending limit', () => {
    for (const band of Object.values(TICKET_BAND)) {
      expect(band.lowCents).toBeLessThan(band.highCents);
    }
    const ask = ticketAsk(ticketHint('HAIR', money))!;
    expect(viOf(ask.question)).toMatch(/thu khoảng bao nhiêu/);
    expect(viOf(ask.unlocks)).toMatch(/Không cần chờ có lịch hẹn/);
  });

  it('asks the question even with no band to suggest', () => {
    const ask = ticketAsk(null);
    expect(ask.hint).toBeNull();
    expect(viOf(ask.question).length).toBeGreaterThan(10);
  });
});

describe('which tier the card is on', () => {
  it('never presents an estimate with the confidence of a measurement', () => {
    expect(confidenceOf({ ticketMeasured: true, hasTicket: true })).toBe('measured');
    expect(confidenceOf({ ticketMeasured: false, hasTicket: true })).toBe('estimated');
    expect(confidenceOf({ ticketMeasured: false, hasTicket: false })).toBe('starter');
    expect(viOf(confidenceLabel('measured'))).toMatch(/lịch hẹn thật/);
    expect(viOf(confidenceLabel('estimated'))).toMatch(/Tạm tính/);
    expect(viOf(confidenceLabel('starter'))).toMatch(/chưa có số của tiệm/);
  });
});
