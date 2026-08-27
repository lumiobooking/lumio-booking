import {
  smsPolicyFor, allowedAtThisHour, underDailyCap, isOptOut, maySendSms,
} from './sms-policy';

const VN = smsPolicyFor('VN');
const US = smsPolicyFor('US');
const at = (h: number, m = 0) => h * 60 + m;

describe('US and CA salons must behave exactly as they do today', () => {
  // 25 live salons. A commit about Vietnam is not allowed to change when their
  // marketing goes out, so this is asserted rather than assumed.
  it.each(['US', 'CA', '', null, undefined, 'ZZ'])('puts no time restriction on %s', (market) => {
    const p = smsPolicyFor(market);
    expect(p.adHoursLocal).toBeNull();
    expect(p.adPerDayCap).toBeNull();
  });

  it('sends US marketing at 3am, because that is what it does now', () => {
    expect(allowedAtThisHour({ policy: US, kind: 'marketing', nowMinutesLocal: at(3) })).toBe(true);
  });

  it('never caps US marketing however many went out', () => {
    const many = Array.from({ length: 50 }, () => new Date());
    expect(underDailyCap({ policy: US, kind: 'marketing', sentAt: many })).toBe(true);
  });

  it('keeps STOP working', () => {
    expect(isOptOut(US, 'STOP')).toBe(true);
  });
});

describe('a booking confirmation is not an advert', () => {
  // The distinction the whole file hangs on. Gate the receipt and the product
  // breaks: someone who books at 22:30 is entitled to know it worked.
  it('sends a confirmation at 23:00 in Vietnam', () => {
    expect(allowedAtThisHour({ policy: VN, kind: 'transactional', nowMinutesLocal: at(23) })).toBe(true);
  });

  it('sends a confirmation at 3am in Vietnam', () => {
    expect(maySendSms({ market: 'VN', kind: 'transactional', nowMinutesLocal: at(3) })).toEqual({ ok: true });
  });

  it('never caps confirmations, however many bookings they make', () => {
    const many = Array.from({ length: 9 }, () => new Date());
    expect(underDailyCap({ policy: VN, kind: 'transactional', sentAt: many })).toBe(true);
  });
});

describe('Vietnam — advertising hours (Nghị định 91/2020: 07:00–22:00)', () => {
  it.each([
    ['just before opening', at(6, 59), false],
    ['exactly 07:00', at(7), true],
    ['midday', at(13), true],
    ['21:59', at(21, 59), true],
    ['exactly 22:00', at(22), false],
    ['the 2am birthday campaign that started this', at(2), false],
    ['midnight', at(0), false],
  ])('%s → %s', (_name, minutes, expected) => {
    expect(allowedAtThisHour({ policy: VN, kind: 'marketing', nowMinutesLocal: minutes })).toBe(expected);
  });

  it('refuses rather than sends when the clock is unreadable', () => {
    expect(allowedAtThisHour({ policy: VN, kind: 'marketing', nowMinutesLocal: NaN })).toBe(false);
  });
});

describe('Vietnam — three adverts per number per 24 hours', () => {
  const now = new Date('2026-08-25T12:00:00Z');
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

  it('allows the first', () => {
    expect(underDailyCap({ policy: VN, kind: 'marketing', sentAt: [], now })).toBe(true);
  });

  it('allows the third', () => {
    expect(underDailyCap({ policy: VN, kind: 'marketing', sentAt: [hoursAgo(1), hoursAgo(2)], now })).toBe(true);
  });

  it('refuses the fourth', () => {
    expect(underDailyCap({ policy: VN, kind: 'marketing', sentAt: [hoursAgo(1), hoursAgo(2), hoursAgo(3)], now })).toBe(false);
  });

  // Rolling 24 hours, not "since midnight" — three at 23:00 and three at 01:00
  // is six in two hours, and a calendar-day reading would allow it.
  it('ignores anything older than 24 hours', () => {
    const old = [hoursAgo(25), hoursAgo(30), hoursAgo(48)];
    expect(underDailyCap({ policy: VN, kind: 'marketing', sentAt: old, now })).toBe(true);
  });

  it('counts across the calendar-day boundary', () => {
    const spanning = [hoursAgo(23), hoursAgo(20), hoursAgo(2)];
    expect(underDailyCap({ policy: VN, kind: 'marketing', sentAt: spanning, now })).toBe(false);
  });

  // Bad data must not raise the ceiling. A rule that fails open is not a rule.
  it('counts an unparseable timestamp against the sender', () => {
    expect(underDailyCap({ policy: VN, kind: 'marketing', sentAt: ['not a date', 'nope', 'nah'], now })).toBe(false);
  });
});

describe('the opt-out has to work in the language they speak', () => {
  // An opt-out that is not recognised is worse than none: the person believes
  // they stopped it, and the next message proves nobody listened.
  it.each(['TU CHOI', 'tu choi', 'TUCHOI', 'Từ chối', 'HUY', 'hủy', 'stop', 'STOP.'])(
    'accepts %s from a Vietnamese customer',
    (word) => {
      expect(isOptOut(VN, word)).toBe(true);
    },
  );

  it('does not treat an ordinary reply as an opt-out', () => {
    expect(isOptOut(VN, 'Dạ em muốn đặt lịch ạ')).toBe(false);
    expect(isOptOut(VN, 'huy hoang')).toBe(false);
    expect(isOptOut(VN, '')).toBe(false);
  });

  it('tells a Vietnamese customer how to stop, in Vietnamese', () => {
    expect(VN.optOutLine).toContain('TU CHOI');
    expect(US.optOutLine).toContain('STOP');
  });
});

describe('maySendSms says WHY it refused', () => {
  // A campaign that silently sends nothing looks exactly like a campaign with
  // no eligible customers. That ambiguity has cost this project an afternoon.
  it('names the hours', () => {
    expect(maySendSms({ market: 'VN', kind: 'marketing', nowMinutesLocal: at(2) }))
      .toEqual({ ok: false, reason: 'outside-hours' });
  });

  it('names the cap', () => {
    const now = new Date('2026-08-25T12:00:00Z');
    const three = [now, now, now];
    expect(maySendSms({ market: 'VN', kind: 'marketing', nowMinutesLocal: at(13), sentAt: three, now }))
      .toEqual({ ok: false, reason: 'daily-cap' });
  });

  it('lets a legitimate Vietnamese campaign through', () => {
    expect(maySendSms({ market: 'VN', kind: 'marketing', nowMinutesLocal: at(10) })).toEqual({ ok: true });
  });
});
