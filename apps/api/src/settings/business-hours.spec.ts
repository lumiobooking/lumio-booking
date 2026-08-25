import {
  windowsForDay, fitsBusinessHours, suspiciousHours, minutesToClock, describeWindows,
} from './business-hours';

const NINE_TO_SEVEN = { closed: false, openMinutes: 9 * 60 + 30, closeMinutes: 19 * 60 };
const SPLIT = {
  closed: false, openMinutes: 10 * 60 + 30, closeMinutes: 20 * 60 + 30,
  intervals: [{ open: 10 * 60 + 30, close: 14 * 60 + 30 }, { open: 16 * 60 + 30, close: 20 * 60 + 30 }],
};

describe('a booking must fit inside the hours the salon actually opens', () => {
  // The slot grid is generated in the BROWSER. Before this, the endpoint had no
  // hours check at all, so a request posted directly — a script, a stale tab, a
  // bot, a page left open past a settings change — was accepted for 3am on a
  // day the salon is shut. The salon finds out when someone turns up.
  it('accepts a normal appointment', () => {
    expect(fitsBusinessHours({ day: NINE_TO_SEVEN, startMinutes: 10 * 60, durationMin: 60 })).toBe(true);
  });

  it('refuses one that starts before opening', () => {
    expect(fitsBusinessHours({ day: NINE_TO_SEVEN, startMinutes: 9 * 60, durationMin: 30 })).toBe(false);
  });

  it('refuses the small hours, which is the case that started this', () => {
    expect(fitsBusinessHours({ day: NINE_TO_SEVEN, startMinutes: 0, durationMin: 65 })).toBe(false);
    expect(fitsBusinessHours({ day: NINE_TO_SEVEN, startMinutes: 90, durationMin: 65 })).toBe(false);
  });

  // The WHOLE appointment has to fit. A 60-minute service starting 30 minutes
  // before closing is a customer left sitting in a dark salon.
  it('refuses one that starts in time but finishes after closing', () => {
    expect(fitsBusinessHours({ day: NINE_TO_SEVEN, startMinutes: 18 * 60 + 30, durationMin: 60 })).toBe(false);
  });

  it('accepts one that finishes exactly at closing', () => {
    expect(fitsBusinessHours({ day: NINE_TO_SEVEN, startMinutes: 18 * 60, durationMin: 60 })).toBe(true);
  });

  it('accepts one that starts exactly at opening', () => {
    expect(fitsBusinessHours({ day: NINE_TO_SEVEN, startMinutes: 9 * 60 + 30, durationMin: 30 })).toBe(true);
  });

  it('refuses everything on a closed day', () => {
    const shut = { closed: true, openMinutes: 9 * 60, closeMinutes: 18 * 60 };
    expect(fitsBusinessHours({ day: shut, startMinutes: 12 * 60, durationMin: 30 })).toBe(false);
  });

  it.each([null, undefined, {}])('refuses when the day is %s rather than waving it through', (day) => {
    expect(fitsBusinessHours({ day: day as never, startMinutes: 12 * 60, durationMin: 30 })).toBe(false);
  });
});

describe('split shifts', () => {
  it('accepts a slot inside either window', () => {
    expect(fitsBusinessHours({ day: SPLIT, startMinutes: 11 * 60, durationMin: 60 })).toBe(true);
    expect(fitsBusinessHours({ day: SPLIT, startMinutes: 17 * 60, durationMin: 60 })).toBe(true);
  });

  // The whole point of a split shift: the salon is shut over lunch. The old
  // single-span reading would have called 15:00 open, because it only knew
  // 10:30 to 20:30.
  it('refuses a slot in the gap between them', () => {
    expect(fitsBusinessHours({ day: SPLIT, startMinutes: 15 * 60, durationMin: 30 })).toBe(false);
  });

  it('refuses one that starts in the first window and runs into the gap', () => {
    expect(fitsBusinessHours({ day: SPLIT, startMinutes: 14 * 60, durationMin: 60 })).toBe(false);
  });

  it('prefers intervals over the span when both are present', () => {
    expect(windowsForDay(SPLIT)).toHaveLength(2);
  });
});

describe('values that should not be trusted', () => {
  it('treats a window that closes before it opens as closed, not as all day', () => {
    const backwards = { closed: false, openMinutes: 18 * 60, closeMinutes: 9 * 60 };
    expect(windowsForDay(backwards)).toEqual([]);
    expect(fitsBusinessHours({ day: backwards, startMinutes: 12 * 60, durationMin: 30 })).toBe(false);
  });

  it('drops a malformed interval instead of letting it open the day', () => {
    const bad = { closed: false, openMinutes: 9 * 60, closeMinutes: 18 * 60, intervals: [{ open: 100, close: 50 }] };
    // Falls back to the valid single span rather than to nothing or to anything.
    expect(windowsForDay(bad)).toEqual([{ open: 540, close: 1080 }]);
  });

  it('refuses a negative start time', () => {
    expect(fitsBusinessHours({ day: NINE_TO_SEVEN, startMinutes: -60, durationMin: 30 })).toBe(false);
  });

  it('does not let a zero or missing duration wave the check through', () => {
    expect(fitsBusinessHours({ day: NINE_TO_SEVEN, startMinutes: 3 * 60, durationMin: 0 })).toBe(false);
    expect(fitsBusinessHours({ day: NINE_TO_SEVEN, startMinutes: 3 * 60, durationMin: NaN })).toBe(false);
  });
});

describe('hours that are legal but almost certainly a typo', () => {
  // The actual case: Sunday saved as 00:00–17:00, because the owner picked
  // 12 AM in a 12-hour picker meaning noon. Every layer believed them, and the
  // booking page offered 12:00 AM, 12:30 AM, 1:00 AM.
  it('flags a day that opens at midnight', () => {
    expect(suspiciousHours({ closed: false, openMinutes: 0, closeMinutes: 17 * 60 })).toBe('opens-too-early');
  });

  it('flags anything before 5am', () => {
    expect(suspiciousHours({ closed: false, openMinutes: 4 * 60 + 59, closeMinutes: 17 * 60 })).toBe('opens-too-early');
  });

  it('flags a day longer than any single shift', () => {
    expect(suspiciousHours({ closed: false, openMinutes: 6 * 60, closeMinutes: 23 * 60 })).toBe('span-too-long');
  });

  it('says nothing about ordinary hours', () => {
    expect(suspiciousHours(NINE_TO_SEVEN)).toBeNull();
    expect(suspiciousHours(SPLIT)).toBeNull();
    expect(suspiciousHours({ closed: false, openMinutes: 5 * 60, closeMinutes: 20 * 60 })).toBeNull();
  });

  it('says nothing about a closed day', () => {
    expect(suspiciousHours({ closed: true, openMinutes: 0, closeMinutes: 0 })).toBeNull();
  });
});

describe('putting a time in front of a human', () => {
  it.each([
    [0, '12:00 AM'],
    [30, '12:30 AM'],
    [9 * 60 + 30, '9:30 AM'],
    [12 * 60, '12:00 PM'],
    [12 * 60 + 30, '12:30 PM'],
    [19 * 60, '7:00 PM'],
  ])('writes %i as %s', (mins, text) => {
    expect(minutesToClock(mins)).toBe(text);
  });

  it('describes a normal day and a split one', () => {
    expect(describeWindows(NINE_TO_SEVEN)).toBe('9:30 AM–7:00 PM');
    expect(describeWindows(SPLIT)).toBe('10:30 AM–2:30 PM, 4:30 PM–8:30 PM');
  });

  it('says closed rather than showing an empty range', () => {
    expect(describeWindows({ closed: true, openMinutes: 0, closeMinutes: 0 })).toBe('closed');
  });
});
