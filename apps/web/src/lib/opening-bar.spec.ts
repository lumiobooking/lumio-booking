import { openingBarMode, windowsForDisplay, planOpeningBar } from './opening-bar';

const NINE_TO_FIVE = { closed: false, openMinutes: 9 * 60, closeMinutes: 17 * 60 };
const SPLIT = {
  closed: false, openMinutes: 10 * 60, closeMinutes: 20 * 60,
  intervals: [{ open: 10 * 60, close: 14 * 60 }, { open: 16 * 60, close: 20 * 60 }],
};

describe('an unreadable setting must never resurrect the promise', () => {
  // Every salon row written before this setting existed comes back undefined.
  // Those salons must land on the mode that states a fact, not the one that
  // announces a slot the page cannot verify.
  it.each([null, undefined, '', '   ', 'HOURS', 'nonsense', 0, true, {}])('reads %s as hours', (raw) => {
    expect(openingBarMode(raw)).toBe('hours');
  });

  it('accepts the two deliberate choices', () => {
    expect(openingBarMode('soonest')).toBe('soonest');
    expect(openingBarMode('off')).toBe('off');
    expect(openingBarMode(' Soonest ')).toBe('soonest');
  });
});

describe('the badge agrees with the rule the server enforces', () => {
  // It mirrors windowsForDay on the API side. A badge that disagrees with the
  // booking endpoint teaches customers to distrust both.
  it('reads a normal day', () => {
    expect(windowsForDisplay(NINE_TO_FIVE)).toEqual([{ open: 540, close: 1020 }]);
  });

  it('prefers split shifts over the single span', () => {
    expect(windowsForDisplay(SPLIT)).toHaveLength(2);
    expect(windowsForDisplay(SPLIT)[0]).toEqual({ open: 600, close: 840 });
  });

  it('sorts windows so the earliest is announced first', () => {
    const jumbled = { ...SPLIT, intervals: [{ open: 16 * 60, close: 20 * 60 }, { open: 10 * 60, close: 14 * 60 }] };
    expect(windowsForDisplay(jumbled)[0].open).toBe(600);
  });

  it('treats a window that closes before it opens as closed, not as all day', () => {
    expect(windowsForDisplay({ closed: false, openMinutes: 18 * 60, closeMinutes: 9 * 60 })).toEqual([]);
  });

  it('drops a malformed interval rather than letting it open the day', () => {
    const bad = { closed: false, openMinutes: 9 * 60, closeMinutes: 17 * 60, intervals: [{ open: 100, close: 50 }] };
    expect(windowsForDisplay(bad)).toEqual([{ open: 540, close: 1020 }]);
  });

  it.each([null, undefined, {}])('says nothing for %s rather than inventing hours', (day) => {
    expect(windowsForDisplay(day as never)).toEqual([]);
  });

  it('says nothing on a closed day', () => {
    expect(windowsForDisplay({ closed: true, openMinutes: 0, closeMinutes: 0 })).toEqual([]);
  });
});

describe('what gets drawn', () => {
  it('draws the hours by default', () => {
    expect(planOpeningBar({ mode: undefined, day: NINE_TO_FIVE }))
      .toEqual({ kind: 'hours', windows: [{ open: 540, close: 1020 }] });
  });

  it('draws nothing when the salon turned it off', () => {
    expect(planOpeningBar({ mode: 'off', day: NINE_TO_FIVE })).toEqual({ kind: 'off' });
  });

  it('still offers the old badge to a salon that wants it', () => {
    expect(planOpeningBar({ mode: 'soonest', day: NINE_TO_FIVE })).toEqual({ kind: 'soonest' });
  });

  // A holiday beats the weekly pattern: normally open on a Thursday, shut on
  // THIS Thursday. Announcing 9–5 on a day the salon is closed sends someone
  // to a locked door.
  it('a day off outranks the weekly hours', () => {
    expect(planOpeningBar({ mode: 'hours', day: NINE_TO_FIVE, isDayOff: true })).toEqual({ kind: 'closed' });
  });

  // Saying "Closed today" is the answer the visitor came for. Drawing nothing
  // makes them hunt through a date picker to discover it.
  it('says closed rather than going blank', () => {
    expect(planOpeningBar({ mode: 'hours', day: { closed: true } })).toEqual({ kind: 'closed' });
    expect(planOpeningBar({ mode: 'hours', day: null })).toEqual({ kind: 'closed' });
  });

  it('off wins even on a closed day — the salon asked for silence', () => {
    expect(planOpeningBar({ mode: 'off', day: { closed: true }, isDayOff: true })).toEqual({ kind: 'off' });
  });
});
