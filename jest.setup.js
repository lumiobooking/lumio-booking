/**
 * No test may touch the network. Enforced, not requested.
 *
 * This file exists because the same mistake shipped twice in two days, in two
 * different places, and both times the build was the thing that noticed:
 *
 *   1. the content-refresh tests ran `refreshFor` with whatever ANTHROPIC_API_KEY
 *      the machine happened to have. Locally there was none, so drafting bailed
 *      out and everything passed. On the deploy machine the key is real — so the
 *      build called Anthropic, twice, with a sixty-second timeout, and jest
 *      killed both tests at five seconds.
 *
 *   2. the tenant-isolation tests called `planFor`, which reaches `areaFor`,
 *      which calls the US Census. That one got as far as api.census.gov and came
 *      back with "Missing Key" and a timeout — printed in the deploy log for
 *      anyone to read.
 *
 * After the first, I wrote a lint rule listing the functions known to call out.
 * It did not catch the second, because `planFor` was not on my list. That is the
 * flaw in naming hazards one at a time: the list only ever describes the
 * failures that already happened. The hazard is not "these four functions" — it
 * is "a unit test reached the internet", and that is what this blocks.
 *
 * A test that reaches the network is not a unit test. It gives a different
 * answer on every machine, it is slow where it is meant to be fast, and when the
 * far end costs money it turns every deploy into a purchase.
 *
 * Opting out is deliberate and loud: a test that wants a real request must
 * install its own `jest.spyOn(globalThis, 'fetch')`, which replaces this. The
 * error below names the file, so a failure points at the fix instead of at a
 * mystery.
 */
const BLOCKED = (url) => {
  const where = typeof url === 'string' ? url : String(url?.url ?? url ?? 'unknown');
  return new Error(
    `Test tried to reach the network: ${where}\n`
    + 'Unit tests must not make real requests — they behave differently on every\n'
    + 'machine, and a paid API turns each deploy into an invoice.\n'
    + "Fix: jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })",
  );
};

beforeEach(() => {
  // Reassigned each test so a spy installed by one file cannot leak into the
  // next: jest restores spies, and this puts the block back underneath.
  globalThis.fetch = (url) => Promise.reject(BLOCKED(url));
});
