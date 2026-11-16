import { digestDue, digestPush, digestSettingFrom, localParts } from './ai-digest';

describe('the Monday AI digest — owner only, opt-in, once a week', () => {
  it('is off until the salon switches it on', () => {
    expect(digestSettingFrom(null)).toEqual({ on: false, lastWeek: null });
    expect(digestSettingFrom('{"on":true,"lastWeek":"2026-11-16"}')).toEqual({ on: true, lastWeek: '2026-11-16' });
    expect(digestSettingFrom({ on: 'yes', lastWeek: 'x' })).toEqual({ on: false, lastWeek: null });
  });

  it('is due on Monday at nine in the SALON’s time zone, once', () => {
    const on = { on: true, lastWeek: null };
    // Monday 16 Nov 2026 09:30 in Chicago = 15:30 UTC.
    const chicago = new Date('2026-11-16T15:30:00Z');
    expect(localParts(chicago, 'America/Chicago')).toEqual({ weekday: 1, hour: 9, date: '2026-11-16' });
    expect(digestDue(on, chicago, 'America/Chicago')).toBe('2026-11-16');
    // The same instant is Monday 22:30 in Vietnam: not now.
    expect(digestDue(on, chicago, 'Asia/Ho_Chi_Minh')).toBeNull();
    // Already sent this Monday (a restart, a second instance).
    expect(digestDue({ on: true, lastWeek: '2026-11-16' }, chicago, 'America/Chicago')).toBeNull();
    // Next Monday it is due again.
    expect(digestDue({ on: true, lastWeek: '2026-11-16' }, new Date('2026-11-23T15:05:00Z'), 'America/Chicago')).toBe('2026-11-23');
    // Off, a Tuesday, ten o'clock: never.
    expect(digestDue({ on: false, lastWeek: null }, chicago, 'America/Chicago')).toBeNull();
    expect(digestDue(on, new Date('2026-11-17T15:30:00Z'), 'America/Chicago')).toBeNull();
    expect(digestDue(on, new Date('2026-11-16T16:30:00Z'), 'America/Chicago')).toBeNull();
    // A broken zone falls back instead of throwing.
    expect(() => digestDue(on, chicago, 'Not/AZone')).not.toThrow();
  });

  it('says the three numbers, and opens the page where the work is', () => {
    const p = digestPush({ conversations: 90, selfHandledRate: 0.82, booked: 41, toTeach: 3, happyRate: 0.93 }, true)!;
    expect(p.body).toBe('AI tự xử lý 82% trong 90 cuộc trò chuyện · 41 lịch đã chốt · 93% khách hài lòng · 3 câu cần dạy AI');
    expect(p.url).toBe('/salon/ai?tab=learn');
    const q = digestPush({ conversations: 12, selfHandledRate: null, booked: 2, toTeach: 0, happyRate: null }, false)!;
    expect(q.body).toBe('12 chats · 2 booked · nothing to teach');
    expect(q.url).toBe('/salon/ai?tab=home');
  });

  it('a week with no conversations sends nothing', () => {
    expect(digestPush({ conversations: 0, selfHandledRate: null, booked: 0, toTeach: 0, happyRate: null }, true)).toBeNull();
  });
});
