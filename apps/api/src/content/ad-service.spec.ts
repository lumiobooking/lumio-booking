import { pickAdServices, MIN_AD_MINUTES, pickBasisNote } from './ad-service';
import { viOf } from './i18n';

// A real nail-salon menu, shortened. The waxing rows are why this module exists:
// $8 for 5 minutes is $96 an hour and beats every full set on the board.
const MENU = [
  { name: 'Chin', priceCents: 800, durationMinutes: 5, bookings: 6 },
  { name: 'Lip', priceCents: 700, durationMinutes: 5, bookings: 4 },
  { name: 'Full Face', priceCents: 4000, durationMinutes: 25, bookings: 2 },
  { name: 'Gel Manicure', priceCents: 5500, durationMinutes: 60, bookings: 44 },
  { name: 'Dip Powder', priceCents: 5000, durationMinutes: 45, bookings: 27 },
  { name: 'Polish Change', priceCents: 1500, durationMinutes: 30, bookings: 15 },
  { name: 'Pedicure', priceCents: 4500, durationMinutes: 50, bookings: 31 },
];

describe('pickAdServices', () => {
  it('never leads with the five-minute wax that tops the per-chair-hour table', () => {
    const p = pickAdServices(MENU, 4500);
    expect(p.names).not.toContain('Chin');
    expect(p.names).not.toContain('Lip');
  });

  it('rules out anything under half an hour as an add-on, not a destination', () => {
    const p = pickAdServices(MENU, 4500);
    // Full Face is 25 minutes: priced fine, still bought in the chair.
    expect(p.names).not.toContain('Full Face');
    expect(p.skipped.filter((s) => s.why === 'add-on').map((s) => s.name)).toContain('Chin');
    expect(p.rows.every((r) => r.minutes >= MIN_AD_MINUTES)).toBe(true);
  });

  it('requires the service to be worth at least an average ticket', () => {
    // Polish Change is 30 minutes and popular, and at $15 the campaign would be
    // paying up to a $45 ticket's profit to sell it.
    const p = pickAdServices(MENU, 4500);
    expect(p.names).not.toContain('Polish Change');
    expect(p.skipped.filter((s) => s.why === 'under-ticket').map((s) => s.name)).toContain('Polish Change');
    expect(p.floorCents).toBe(4500);
  });

  it('ranks what is left by chair-hour, not by the price on the board', () => {
    const p = pickAdServices(MENU, 4500, 3);
    // Dip $50/45min = $66/hr beats Gel $55/60min = $55/hr, even though Gel has
    // the bigger sticker price and more bookings.
    expect(p.names[0]).toBe('Dip Powder');
    expect(p.rows[0].perHourCents).toBe(6667);
    expect(p.basis).toBe('booked-and-pays');
  });

  it('prefers a booked service over an unbooked one that earns more on paper', () => {
    const p = pickAdServices([
      { name: 'Luxury Set', priceCents: 9000, durationMinutes: 60, bookings: 0 },
      { name: 'Gel Manicure', priceCents: 5500, durationMinutes: 60, bookings: 44 },
    ], 5000, 1);
    expect(p.names).toEqual(['Gel Manicure']);
  });

  it('says when the pick came off the price list and not out of the book', () => {
    const p = pickAdServices([
      { name: 'Full Set', priceCents: 6000, durationMinutes: 60, bookings: 0 },
    ], 5000);
    expect(p.basis).toBe('pays-not-booked');
    expect(viOf(pickBasisNote(p))).toMatch(/chưa có lượt đặt/);
  });

  it('drops the money floor rather than returning nothing, and says which happened', () => {
    const p = pickAdServices([
      { name: 'Polish Change', priceCents: 1500, durationMinutes: 30, bookings: 9 },
      { name: 'Pedicure', priceCents: 3500, durationMinutes: 45, bookings: 4 },
    ], 6000);
    expect(p.basis).toBe('best-available');
    expect(p.names[0]).toBe('Pedicure');
    // The floor removed everything, so naming individual rows as "under ticket"
    // would be a list of the whole menu.
    expect(p.skipped.filter((s) => s.why === 'under-ticket')).toHaveLength(0);
  });

  it('still answers when there is no ticket yet, on length and yield alone', () => {
    const p = pickAdServices(MENU, null);
    expect(p.floorCents).toBeNull();
    expect(p.names).not.toContain('Chin');
    expect(p.names[0]).toBe('Dip Powder');
  });

  it('returns nothing to advertise when the menu has no price or no duration', () => {
    expect(pickAdServices([{ name: 'Gel', priceCents: 0, durationMinutes: 60 }], 4500).basis).toBe('none');
    expect(pickAdServices([{ name: 'Gel', priceCents: 5000, durationMinutes: 0 }], 4500).basis).toBe('none');
    expect(pickAdServices([], 4500).names).toHaveLength(0);
    expect(pickAdServices(null, 4500).basis).toBe('none');
  });

  it('names the add-ons it skipped even when nothing is long enough to advertise', () => {
    const p = pickAdServices([
      { name: 'Chin', priceCents: 800, durationMinutes: 5, bookings: 6 },
      { name: 'Lip', priceCents: 700, durationMinutes: 5, bookings: 4 },
    ], 4500);
    expect(p.basis).toBe('none');
    expect(p.names).toHaveLength(0);
    expect(p.skipped.map((s) => s.name)).toContain('Chin');
  });

  it('trims whitespace and caps the list at two names by default', () => {
    const p = pickAdServices(MENU.map((m) => ({ ...m, name: `  ${m.name} ` })), 4500);
    expect(p.names).toHaveLength(2);
    expect(p.names[0]).toBe('Dip Powder');
  });

  it('counts bookings as zero when the tally has no row for the service', () => {
    const p = pickAdServices([{ name: 'Full Set', priceCents: 6000, durationMinutes: 60 }], 5000);
    expect(p.rows[0].bookings).toBe(0);
  });

  it('survives a menu row with a rubbish name', () => {
    const p = pickAdServices([
      { name: '   ', priceCents: 6000, durationMinutes: 60 },
      { name: 'Full Set', priceCents: 6000, durationMinutes: 60, bookings: 3 },
    ], 5000);
    expect(p.names).toEqual(['Full Set']);
  });
});
