import { TurnClock, stepsOf } from './turn-timing';

describe('where one AI reply\'s working time went (./turn-timing)', () => {
  function clock() { let now = 1_000; const c = new TurnClock(() => now); return { c, tick: (ms: number) => { now += ms; } }; }

  it('splits the time: preparing, the model, the check, tools — and counts calls and rewrites', async () => {
    const { c, tick } = clock();
    tick(300);                                                    // reading the thread, the customer, the salon
    await c.time('model', async () => { tick(1800); });           // first draft …
    await c.time('tools', async () => { tick(250); });            // … looked in the book
    await c.time('model', async () => { tick(1500); }); c.draft();
    await c.time('check', async () => { tick(900); });            // the owner's instructions: blocked
    await c.time('model', async () => { tick(2100); }); c.draft(); // written again
    await c.time('check', async () => { tick(800); });
    expect(c.steps()).toEqual({ p: 300, m: 5400, j: 1700, k: 250, n: 3, r: 1 });
  });

  it('a reply that needed no model at all still has its preparing time, and no rewrite', () => {
    const { c, tick } = clock();
    tick(120);
    expect(c.steps()).toEqual({ p: 120, m: 0, j: 0, k: 0, n: 0, r: 0 });
  });

  it('a step that throws is still timed, and its error is not swallowed', async () => {
    const { c, tick } = clock();
    await expect(c.time('model', async () => { tick(700); throw new Error('anthropic 529'); })).rejects.toThrow('529');
    expect(c.steps().m).toBe(700);
    expect(c.steps().n).toBe(1);
  });

  it('reads stored steps defensively: an older reply has none', () => {
    expect(stepsOf({ w: 1000, t: 3500, s: 500 })).toBeNull();
    expect(stepsOf(null)).toBeNull();
    expect(stepsOf({ w: 1, t: 2, s: 3, p: 300, m: 2000, j: 900, k: 0, n: 1, r: 0 })).toEqual({ p: 300, m: 2000, j: 900, k: 0, n: 1, r: 0 });
    expect(stepsOf({ p: -1, m: 1, j: 1, k: 1, n: 1, r: 0 })).toBeNull();
  });
});
