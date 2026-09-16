import { addMinutes, rangesOverlap, planLineTechnician } from './booking.util';

describe('addMinutes', () => {
  it('adds minutes correctly', () => {
    const base = new Date('2026-06-15T09:00:00.000Z');
    expect(addMinutes(base, 45).toISOString()).toBe('2026-06-15T09:45:00.000Z');
  });
});

describe('rangesOverlap', () => {
  const at = (h: number, m = 0) => new Date(2026, 5, 15, h, m);

  it('detects a clear overlap', () => {
    expect(rangesOverlap(at(9), at(10), at(9, 30), at(10, 30))).toBe(true);
  });

  it('detects full containment', () => {
    expect(rangesOverlap(at(9), at(12), at(10), at(11))).toBe(true);
  });

  it('treats back-to-back bookings as non-overlapping', () => {
    // 09:00–10:00 and 10:00–11:00 must be allowed.
    expect(rangesOverlap(at(9), at(10), at(10), at(11))).toBe(false);
  });

  it('treats fully separate ranges as non-overlapping', () => {
    expect(rangesOverlap(at(9), at(10), at(14), at(15))).toBe(false);
  });

  it('is symmetric', () => {
    expect(rangesOverlap(at(9, 30), at(10, 30), at(9), at(10))).toBe(true);
  });
});

describe('who does the second service of a visit', () => {
  const one = { partySize: 1, primaryStaffId: 'tuan', primaryCanDo: true, fillGaps: true };

  it('one person, one chair: the technician on the visit does every service they can', () => {
    expect(planLineTechnician({}, one)).toBe('primary');
    expect(planLineTechnician({ staffMemberId: null }, one)).toBe('primary');
  });
  it('another technician only when the first cannot do that service', () => {
    expect(planLineTechnician({}, { ...one, primaryCanDo: false })).toBe('other');
    expect(planLineTechnician({}, { ...one, primaryCanDo: false, fillGaps: false })).toBe('leave');
  });
  it('a group is served at once, so its services spread', () => {
    expect(planLineTechnician({}, { ...one, partySize: 2 })).toBe('other');
    expect(planLineTechnician({}, { ...one, partySize: 3, fillGaps: false })).toBe('leave');
  });
  it('never overwrites a technician somebody already set on the line', () => {
    expect(planLineTechnician({ staffMemberId: 'tiffany' }, one)).toBe('keep');
  });
  it('with nobody on the visit yet, the engine may fill or a person decides', () => {
    expect(planLineTechnician({}, { ...one, primaryStaffId: null })).toBe('other');
    expect(planLineTechnician({}, { ...one, primaryStaffId: null, fillGaps: false })).toBe('leave');
  });
});
