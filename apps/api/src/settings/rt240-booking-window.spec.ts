import { windowProblem } from './booking-window';

describe('rt240 — a booking window that leaves no bookable time is refused', () => {
  it('Nailstop: 90 hours before, 1 day ahead → nothing bookable', () => {
    expect(windowProblem(90, 1)).toMatch(/no time can ever be booked/);
    expect(windowProblem(24, 1)).toMatch(/no time/);
  });
  it('normal settings pass', () => {
    expect(windowProblem(1, 30)).toBeNull();
    expect(windowProblem(2, 1)).toBeNull();
    expect(windowProblem(0, 60)).toBeNull();
    expect(windowProblem(48, 3)).toBeNull();
  });
  it('junk is left to the DTO validation', () => {
    expect(windowProblem(undefined, 30)).toBeNull();
    expect(windowProblem(1, 0)).toMatch(/at least 1 day/);
  });
});
