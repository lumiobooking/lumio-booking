import {
  rankCandidates,
  pickBest,
  CandidateInput,
  DEFAULT_RULES,
  rejectionWindowDays,
  noResponseWindowDays,
  parseHmToMinutes,
  isWithinWorkingHours,
  getLocalSlot,
} from './assignment.util';

function candidate(partial: Partial<CandidateInput> & { staffId: string }): CandidateInput {
  return {
    performanceScore: 100,
    isPreferred: false,
    rejectionCount: 0,
    noResponseCount: 0,
    recentAssignmentCount: 0,
    ...partial,
  };
}

describe('rankCandidates / pickBest', () => {
  it('prefers the customer preferred staff even with lower performance', () => {
    const best = pickBest(
      [candidate({ staffId: 'a', performanceScore: 100 }), candidate({ staffId: 'b', performanceScore: 50, isPreferred: true })],
      DEFAULT_RULES,
    );
    expect(best).toBe('b');
  });

  it('excludes a staff over the rejection threshold', () => {
    const ranked = rankCandidates(
      [candidate({ staffId: 'a', rejectionCount: 3 }), candidate({ staffId: 'b', rejectionCount: 0 })],
      DEFAULT_RULES,
    );
    const a = ranked.find((r) => r.staffId === 'a')!;
    expect(a.excluded).toBe(true);
    expect(pickBest(
      [candidate({ staffId: 'a', rejectionCount: 3 }), candidate({ staffId: 'b', rejectionCount: 0 })],
      DEFAULT_RULES,
    )).toBe('b');
  });

  it('excludes a staff over the no-response threshold', () => {
    expect(pickBest(
      [candidate({ staffId: 'a', noResponseCount: 3 }), candidate({ staffId: 'b' })],
      DEFAULT_RULES,
    )).toBe('b');
  });

  it('returns null when every candidate is excluded', () => {
    expect(pickBest([candidate({ staffId: 'a', rejectionCount: 5 })], DEFAULT_RULES)).toBeNull();
  });

  it('balances load: fewer upcoming assignments ranks higher', () => {
    const best = pickBest(
      [candidate({ staffId: 'busy', recentAssignmentCount: 5 }), candidate({ staffId: 'free', recentAssignmentCount: 0 })],
      DEFAULT_RULES,
    );
    expect(best).toBe('free');
  });

  it('higher performance score ranks higher when otherwise equal', () => {
    const best = pickBest(
      [candidate({ staffId: 'lo', performanceScore: 90 }), candidate({ staffId: 'hi', performanceScore: 130 })],
      DEFAULT_RULES,
    );
    expect(best).toBe('hi');
  });

  it('returns null for an empty candidate list', () => {
    expect(pickBest([], DEFAULT_RULES)).toBeNull();
  });
});

describe('rule window helpers', () => {
  it('default rejection / no-response windows are 7 days', () => {
    expect(rejectionWindowDays(DEFAULT_RULES)).toBe(7);
    expect(noResponseWindowDays(DEFAULT_RULES)).toBe(7);
  });
});

describe('working hours helpers', () => {
  it('parses HH:mm to minutes', () => {
    expect(parseHmToMinutes('09:30')).toBe(570);
    expect(parseHmToMinutes('bad')).toBeNaN();
  });

  it('accepts a slot inside an active working block', () => {
    const slot = { dayOfWeek: 1, startMinutes: 600, endMinutes: 645 }; // 10:00–10:45 Mon
    expect(
      isWithinWorkingHours(slot, [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', isActive: true }]),
    ).toBe(true);
  });

  it('rejects a slot outside the working block', () => {
    const slot = { dayOfWeek: 1, startMinutes: 1020, endMinutes: 1065 }; // 17:00–17:45
    expect(
      isWithinWorkingHours(slot, [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', isActive: true }]),
    ).toBe(false);
  });

  it('maps a UTC time into a salon-local slot', () => {
    // 2026-06-15 14:00 UTC -> 10:00 in New York (EDT, UTC-4), Monday.
    const slot = getLocalSlot(new Date('2026-06-15T14:00:00.000Z'), 45, 'America/New_York');
    expect(slot.dayOfWeek).toBe(1); // Monday
    expect(slot.startMinutes).toBe(600); // 10:00
    expect(slot.endMinutes).toBe(645);
  });
});
