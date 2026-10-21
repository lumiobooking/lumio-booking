import { runLimited } from './run-limited';

describe('runLimited', () => {
  it('keeps order and never runs more than the limit at once', async () => {
    let live = 0; let peak = 0;
    const res = await runLimited([5, 1, 4, 2, 3, 0], 2, async (n) => {
      live++; peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, n * 3));
      live--;
      return n * 10;
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(res.map((r) => (r.ok ? r.value : null))).toEqual([50, 10, 40, 20, 30, 0]);
  });

  it('a failing item does not stop the rest', async () => {
    const res = await runLimited([1, 2, 3], 3, async (n) => { if (n === 2) throw new Error('boom'); return n; });
    expect(res[0]).toEqual({ ok: true, value: 1 });
    expect(res[1].ok).toBe(false);
    expect(res[2]).toEqual({ ok: true, value: 3 });
  });

  it('copes with an empty list and a silly limit', async () => {
    expect(await runLimited([], 4, async () => 1)).toEqual([]);
    expect((await runLimited([1, 2], 0, async (n) => n)).map((r) => r.ok)).toEqual([true, true]);
  });
});
