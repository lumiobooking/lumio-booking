import { cleanBrief, briefForShop, briefHasContent, emptyBrief, isMonthKey, monthKeyIn, BRIEF_LIMITS } from './month-brief';

describe('the month key', () => {
  it('is the salon\'s month, not the server\'s', () => {
    // 03:00 UTC on Oct 1st is still Sept 30th in Chicago.
    expect(monthKeyIn(new Date('2026-10-01T03:00:00Z'), 'America/Chicago')).toBe('2026-09');
    expect(monthKeyIn(new Date('2026-10-01T03:00:00Z'), 'Asia/Ho_Chi_Minh')).toBe('2026-10');
  });
  it('accepts only YYYY-MM', () => {
    expect(isMonthKey('2026-09')).toBe(true);
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey('2026-9')).toBe(false);
    expect(isMonthKey(null)).toBe(false);
  });
});

describe('cleaning what the team typed', () => {
  it('splits needs on lines, drops blanks, caps the count', () => {
    const b = cleanBrief({ focus: ' Lấy review ', needs: 'Gửi 3 clip\n\n  Chụp mặt tiền \n' + 'x\n'.repeat(20) }, '2026-09');
    expect(b.focus).toBe('Lấy review');
    expect(b.needs.slice(0, 2)).toEqual(['Gửi 3 clip', 'Chụp mặt tiền']);
    expect(b.needs).toHaveLength(BRIEF_LIMITS.needs);
  });
  it('reads junk as an empty brief rather than throwing', () => {
    expect(cleanBrief('nope', '2026-09')).toEqual(emptyBrief('2026-09'));
    expect(cleanBrief(null, '2026-09').needs).toEqual([]);
  });
  it('caps each field so a pasted essay cannot become the shop\'s screen', () => {
    const b = cleanBrief({ direction: 'a'.repeat(5000) }, '2026-09');
    expect(b.direction).toHaveLength(BRIEF_LIMITS.direction);
  });
});

describe('what the shop sees', () => {
  it('sees nothing until the team has written something', () => {
    expect(briefForShop(emptyBrief('2026-09'))).toBeNull();
    expect(briefHasContent(emptyBrief('2026-09'))).toBe(false);
  });
  it('sees the four parts and the date, never who typed it', () => {
    const b = cleanBrief({ focus: 'f', goals: 'g', direction: 'd', needs: ['n'], updatedAt: '2026-09-15T00:00:00Z', updatedBy: 'staff@lumio' }, '2026-09');
    const s = briefForShop(b)!;
    expect(Object.keys(s).sort()).toEqual(['direction', 'focus', 'goals', 'month', 'needs', 'updatedAt']);
    expect(JSON.stringify(s)).not.toContain('staff@lumio');
  });
});
