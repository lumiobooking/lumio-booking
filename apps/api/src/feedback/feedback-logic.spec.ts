import {
  DEFAULT_FEEDBACK_SETTINGS, caseDueAt, cleanReasons, isOverdue, maskPhone, reasonCounts, reasonLabel,
  sanitizeSettings, staffLines, suggestFix, techFlags, waitCluster, weekKey, weeklyTrend, AnswerRow,
} from './feedback-logic';

const row = (dayKey: string, sentiment: 'HAPPY' | 'UNHAPPY', staffId: string | null, reasons: string[] = [], toGoogle = false): AnswerRow => ({ dayKey, sentiment, staffId, reasons, toGoogle });

describe('feedback settings', () => {
  it('start off, so no salon is surprised by a new message to its customers', () => {
    expect(DEFAULT_FEEDBACK_SETTINGS.enabled).toBe(false);
  });
  it('clamp numbers, drop junk reasons, keep what was not sent', () => {
    const s = sanitizeSettings({ enabled: true, smsDelayMinutes: 2, replyHours: 999, reasons: ['  Price ', 'Price', '', 'Late'] });
    expect(s.enabled).toBe(true);
    expect(s.smsDelayMinutes).toBe(5);
    expect(s.replyHours).toBe(168);
    expect(s.reasons).toEqual(['Price', 'Late']);
    expect(s.cooldownDays).toBe(45);
  });
  it('an empty reason list falls back to the defaults rather than leaving the customer nothing to tap', () => {
    expect(sanitizeSettings({ reasons: [] }).reasons.length).toBeGreaterThan(3);
  });
});

describe('what the customer can send', () => {
  it('only reasons the salon offers survive', () => {
    expect(cleanReasons(['Price', 'Price', 'DROP TABLE', 7], ['Price', 'Other'])).toEqual(['Price']);
    expect(cleanReasons('Price', ['Price'])).toEqual([]);
  });
  it('reasons read in Vietnamese for a Vietnamese salon, custom ones as typed', () => {
    expect(reasonLabel('Waited too long', 'vi')).toBe('Chờ quá lâu');
    expect(reasonLabel('Music too loud', 'vi')).toBe('Music too loud');
    expect(reasonLabel('Price', 'en')).toBe('Price');
  });
});

describe('a phone on a shared screen', () => {
  it('shows the country, area and last four only', () => {
    expect(maskPhone('+15128868189')).toBe('+1 512 •••• 8189');
    expect(maskPhone('+84 912 345 678')).toBe('+84 912 •••• 5678');
    expect(maskPhone('512-886-8189')).toBe('512 •••• 8189');
    expect(maskPhone('123')).toBe('••••');
    expect(maskPhone(null)).toBeNull();
  });
});

describe('a case and its clock', () => {
  it('is due replyHours after it opened, and stops counting once the customer was contacted', () => {
    const t = new Date('2026-10-01T14:00:00Z');
    const due = caseDueAt(t, 24);
    expect(due.toISOString()).toBe('2026-10-02T14:00:00.000Z');
    const later = new Date('2026-10-02T15:00:00Z');
    expect(isOverdue({ status: 'NEW', dueAt: due }, later)).toBe(true);
    expect(isOverdue({ status: 'IN_PROGRESS', dueAt: due }, later)).toBe(true);
    expect(isOverdue({ status: 'CONTACTED', dueAt: due }, later)).toBe(false);
    expect(isOverdue({ status: 'NEW', dueAt: due }, t)).toBe(false);
  });
});

describe('the suggested fix', () => {
  it('offers a free fix for a quality problem and names the wait, in English for a US salon', () => {
    const s = suggestFix({ reasons: ['Waited too long', 'Polish chipped'], visits: 7, firstName: 'Anna', salonName: 'Zb Nails', senderName: 'Kim', techName: 'Lisa', lang: 'en' });
    expect(s.advice).toContain('A regular (7 visits)');
    expect(s.message).toMatch(/^Hi Anna, it's Kim from Zb Nails/);
    expect(s.message).toContain('the wait and the chip');
    expect(s.message).toContain('fix it for free');
  });
  it('asks the owner to talk to the technician about attitude — never tells the customer who', () => {
    const s = suggestFix({ reasons: ['Staff attitude'], visits: 1, firstName: null, salonName: 'Zb', senderName: null, techName: 'Minh', lang: 'en' });
    expect(s.advice).toContain('Have a private word with Minh');
    expect(s.message).not.toContain('Minh');
  });
  it('writes Vietnamese for a Vietnamese salon', () => {
    const s = suggestFix({ reasons: ['Price'], visits: 4, firstName: 'Lan', salonName: 'Tiệm A', senderName: 'Hoa', techName: null, lang: 'vi' });
    expect(s.message.startsWith('Chào Lan')).toBe(true);
    expect(s.advice).toContain('Khách quen');
  });
});

describe('the dashboard numbers', () => {
  const rows: AnswerRow[] = [
    row('2026-09-29', 'HAPPY', 'lisa', [], true), row('2026-09-30', 'HAPPY', 'lisa'), row('2026-09-30', 'UNHAPPY', 'lisa', ['Waited too long']),
    row('2026-09-30', 'UNHAPPY', 'minh', ['Staff attitude']), row('2026-10-01', 'UNHAPPY', 'minh', ['Staff attitude', 'Price']), row('2026-10-01', 'HAPPY', null),
  ];
  it('weeks start on Monday', () => {
    expect(weekKey('2026-10-01')).toBe('2026-09-28'); // Wednesday → Monday
    expect(weekKey('2026-09-28')).toBe('2026-09-28');
  });
  it('a 12-week trend keeps empty weeks so the line has no false jumps', () => {
    const t = weeklyTrend(rows, '2026-10-01', 12);
    expect(t).toHaveLength(12);
    expect(t[11]).toMatchObject({ week: '2026-09-28', answers: 6, happy: 3, pct: 50 });
    expect(t[11].google).toBe(rows.filter((r) => r.toGoogle && r.dayKey >= '2026-09-28').length);
    expect(t[0].pct).toBeNull();
  });
  it('per technician: answers, happy %, Google taps, top complaint', () => {
    const lines = staffLines(rows);
    const lisa = lines.find((l) => l.staffId === 'lisa')!;
    const minh = lines.find((l) => l.staffId === 'minh')!;
    expect(lisa).toMatchObject({ answers: 3, happy: 2, pct: 67, google: 1, complaints: 1, topReason: 'Waited too long' });
    expect(minh).toMatchObject({ answers: 2, happy: 0, pct: 0, complaints: 2, topReason: 'Staff attitude', topReasonCount: 2 });
    expect(lines.find((l) => l.staffId === null as unknown as string)).toBeUndefined();
  });
  it('reasons counted across answers, ties alphabetical', () => {
    expect(reasonCounts(rows)).toEqual([{ reason: 'Staff attitude', count: 2 }, { reason: 'Price', count: 1 }, { reason: 'Waited too long', count: 1 }]);
  });
  it('flags a technician at the owner’s threshold of the same reason', () => {
    expect(techFlags(rows, 2)).toEqual([{ staffId: 'minh', reason: 'Staff attitude', count: 2 }]);
    expect(techFlags(rows, 3)).toEqual([]);
  });
  it('finds a real cluster of long waits, and only a real one', () => {
    expect(waitCluster([13, 14, 14, 9])).toEqual({ from: 13, to: 15, count: 3, total: 4 });
    expect(waitCluster([9, 13, 17, 20])).toBeNull();
    expect(waitCluster([13, 14])).toBeNull();
  });
});
