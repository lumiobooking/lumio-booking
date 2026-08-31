import { canSelfReschedule, type RescheduleWindow, type RescheduleAsk } from './self-reschedule';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 8, 1, 9, 0);

const W: RescheduleWindow = { enabled: true, noticeHours: 24, minLeadHours: 1, maxMoves: 2 };

/** An appointment three days out, asked to move to four days out. */
const A: RescheduleAsk = {
  now: NOW,
  currentStartMs: NOW + 72 * HOUR,
  newStartMs: NOW + 96 * HOUR,
  maxAdvanceDays: 60,
  movesSoFar: 0,
  live: true,
};

const ask = (over: Partial<RescheduleAsk> = {}, w: Partial<RescheduleWindow> = {}) =>
  canSelfReschedule({ ...W, ...w }, { ...A, ...over });

describe('a customer may move their own appointment inside the window', () => {
  it('allows a normal change with plenty of notice', () => {
    const r = ask();
    expect(r.allowed).toBe(true);
    expect(r.code).toBe('ok');
    expect(r.detail).toMatch(/move 1\/2/);
  });

  it('leaves the confirmation sentence to the caller, who has the real time', () => {
    // The refusals carry their words; the success does not, because only the
    // caller knows what the new time actually reads as in the salon's clock.
    expect(ask().say).toBe('');
  });
});

describe('the notice window is about the ORIGINAL time', () => {
  it('refuses when the appointment is closer than the salon allows', () => {
    const r = ask({ currentStartMs: NOW + 3 * HOUR });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe('too-late');
    expect(r.say).toMatch(/còn 3 tiếng nữa/);
    expect(r.say).toMatch(/báo trước 24 tiếng/);
  });

  it('says a staff member will call rather than just saying no', () => {
    // A refusal that ends the conversation loses a customer who was trying to
    // do the right thing. Every "no" here hands them a next step.
    expect(ask({ currentStartMs: NOW + 1 * HOUR }).say).toMatch(/nhân viên gọi lại/);
  });

  it('handles an appointment that has already started', () => {
    const r = ask({ currentStartMs: NOW - HOUR });
    expect(r.code).toBe('too-late');
    expect(r.say).toMatch(/giờ hẹn đã qua/);
  });

  it('checks the notice BEFORE the new time', () => {
    // A customer who has already missed the window cannot fix it by picking a
    // later slot; telling them the wrong reason wastes their next message.
    const r = ask({ currentStartMs: NOW + HOUR, newStartMs: NOW + 5 * 60_000 });
    expect(r.code).toBe('too-late');
  });

  it('is NOT the same number as the booking lead time', () => {
    // Booking into an empty slot an hour from now costs the salon nothing;
    // vacating a committed slot an hour from now leaves a hole. Reusing
    // minLeadHours here would let a customer walk away from a staffed chair.
    const r = ask({ currentStartMs: NOW + 2 * HOUR }, { minLeadHours: 1, noticeHours: 24 });
    expect(r.allowed).toBe(false);
  });
});

describe('the new time must clear the same bar as a fresh booking', () => {
  it('refuses a new time inside the salon’s lead time', () => {
    const r = ask({ newStartMs: NOW + 20 * 60_000 }, { minLeadHours: 2 });
    expect(r.code).toBe('too-soon');
    expect(r.say).toMatch(/trước 2 tiếng/);
  });

  it('refuses a new time past the booking horizon', () => {
    const r = ask({ newStartMs: NOW + 100 * 24 * HOUR, maxAdvanceDays: 60 });
    expect(r.code).toBe('too-far');
    expect(r.say).toMatch(/60 ngày/);
  });
});

describe('it refuses the things that are not a reschedule at all', () => {
  it('does not move a cancelled or finished appointment', () => {
    const r = ask({ live: false });
    expect(r.code).toBe('not-live');
    expect(r.say).toMatch(/đặt một lịch mới/);
  });

  it('asks again when the time could not be understood', () => {
    const r = ask({ newStartMs: NaN });
    expect(r.code).toBe('bad-time');
  });

  it('spots a move to the time it is already at', () => {
    const r = ask({ newStartMs: A.currentStartMs });
    expect(r.code).toBe('same-time');
  });

  it('stops the ping-pong at the salon’s limit', () => {
    // One appointment moved five times is a no-show arriving slowly.
    const r = ask({ movesSoFar: 2 });
    expect(r.code).toBe('too-many');
    expect(r.say).toMatch(/đã đổi 2 lần/);
  });

  it('hands the whole feature back to staff when the salon turns it off', () => {
    const r = ask({}, { enabled: false });
    expect(r.code).toBe('disabled');
    expect(r.say).toMatch(/nhân viên xử lý/);
  });
});

describe('every refusal is a sentence, not a code', () => {
  it('never returns an empty reason when it says no', () => {
    const cases: [Partial<RescheduleAsk>, Partial<RescheduleWindow>][] = [
      [{ live: false }, {}],
      [{ newStartMs: NaN }, {}],
      [{ currentStartMs: NOW + HOUR }, {}],
      [{ movesSoFar: 9 }, {}],
      [{ newStartMs: NOW + 60_000 }, { minLeadHours: 4 }],
      [{ newStartMs: NOW + 999 * 24 * HOUR }, {}],
      [{}, { enabled: false }],
    ];
    for (const [a, w] of cases) {
      const r = ask(a, w);
      expect(r.allowed).toBe(false);
      expect(r.say.length).toBeGreaterThan(25);
      expect(r.detail.length).toBeGreaterThan(5);
    }
  });

  it('never blames a policy for a timing problem, or the reverse', () => {
    // The two are different promises to the customer and only one is true.
    expect(ask({ currentStartMs: NOW + HOUR }).say).not.toMatch(/chính sách|policy/i);
    expect(ask({}, { enabled: false }).say).not.toMatch(/sát quá|tiếng nữa/);
  });
});
