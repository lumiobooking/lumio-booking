import { netCents, promoPct, priceService, promoBanner, PromoSettings, SalonDay } from './checkin-pricing';

// A Tuesday in Houston. Weekday 2, and a date rule that also covers it.
const TUE: SalonDay = { dayKey: '2026-09-22', weekday: 2 };
const WED: SalonDay = { dayKey: '2026-09-23', weekday: 3 };
const PEDI = { id: 'cat-pedi', name: 'Pedicure' };
const NAIL = { id: 'cat-nail', name: 'Nails' };

const promos: PromoSettings = {
  weekday: { enabled: true, message: 'Tuesday treat', rules: [{ day: 2, categoryId: PEDI.id, percent: 15 }] },
  dates: { enabled: true, rules: [{ startDate: '2026-09-20', endDate: '2026-09-25', categoryId: null, percent: 10, label: 'Grand opening' }] },
};

// The kiosk and the ticket used to disagree by exactly the discount. Every
// test here pins the ONE number both must print.
describe('what a walk-in pays today', () => {
  it('takes the service\'s own discount first, then the promotion on what is left', () => {
    // $65, own −20% → $52, then Tuesday −15% → $44.20
    expect(netCents(6500, 20, 15)).toBe(4420);
  });

  it('never stacks weekday and date — the higher one wins', () => {
    // Pedicure on Tuesday: weekday 15 vs date 10 → 15
    expect(promoPct(promos, TUE, PEDI.id)).toBe(15);
    // Nails on Tuesday: weekday rule is pedicure-only, date rule is for all → 10
    expect(promoPct(promos, TUE, NAIL.id)).toBe(10);
    // Wednesday: no weekday rule, date still running → 10
    expect(promoPct(promos, WED, PEDI.id)).toBe(10);
  });

  it('leaves the list price alone when nothing applies', () => {
    expect(netCents(5500, 0, 0)).toBe(5500);
    expect(promoPct({}, TUE, PEDI.id)).toBe(0);
    expect(promoPct({ weekday: { enabled: false, rules: [{ day: 2, categoryId: null, percent: 50 }] } }, TUE, null)).toBe(0);
  });

  it('rounds the way the booking page rounds — once per step, to the cent', () => {
    // $33.33 −10% → 2999.7 → 3000; then −15% → 2550
    expect(netCents(3333, 10, 15)).toBe(2550);
  });

  it('refuses a discount outside 0–90 rather than pricing at zero or negative', () => {
    expect(netCents(5000, 120, 0)).toBe(500);
    expect(netCents(5000, -5, 0)).toBe(5000);
  });
});

describe('a priced menu line', () => {
  it('carries both percentages and the net, so the screen can show its working', () => {
    const p = priceService(
      { id: 's1', name: 'Deluxe Pedicure', priceCents: 5500, discountPercent: 0, durationMinutes: 45, isFeatured: true, category: PEDI },
      promos, TUE,
    );
    expect(p).toMatchObject({ discountPercent: 0, promoPercent: 15, netCents: 4675, isFeatured: true });
  });

  it('an uncategorised service still gets an all-category promotion', () => {
    const p = priceService({ id: 's2', name: 'Add-on', priceCents: 1000, durationMinutes: 10, category: null }, promos, TUE);
    expect(p.promoPercent).toBe(10);
    expect(p.netCents).toBe(900);
  });
});

describe('the band at the top of the kiosk', () => {
  it('shouts the best offer running today and says what it covers', () => {
    expect(promoBanner(promos, TUE, [PEDI, NAIL])).toEqual({ percent: 15, label: 'Tuesday treat', scope: 'Pedicure' });
  });

  it('prefers the broader claim on a tie', () => {
    const tie: PromoSettings = {
      weekday: { enabled: true, message: '', rules: [{ day: 2, categoryId: PEDI.id, percent: 10 }] },
      dates: { enabled: true, rules: [{ startDate: '2026-09-22', endDate: null, categoryId: null, percent: 10, label: 'Everything' }] },
    };
    // Same 10% twice: the banner should say "everything", not "pedicures".
    expect(promoBanner(tie, TUE, [PEDI])).toEqual({ percent: 10, label: 'Everything', scope: 'all' });
  });

  it('is null on a day with nothing on, so the screen draws nothing', () => {
    expect(promoBanner(promos, { dayKey: '2026-10-05', weekday: 1 }, [PEDI])).toBeNull();
  });

  it('ignores a rule for a category that is no longer on the menu', () => {
    const ghost: PromoSettings = { weekday: { enabled: true, message: 'x', rules: [{ day: 2, categoryId: 'gone', percent: 50 }] } };
    expect(promoBanner(ghost, TUE, [PEDI])).toBeNull();
  });
});
