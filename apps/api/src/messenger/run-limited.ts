/**
 * Run `fn` over `items`, at most `limit` at a time, keeping input order in
 * the result. Facebook round trips are ~1 s each from Render; an agency grant
 * holds dozens of Pages, and walking them one after another is what kept the
 * "Đang hoàn tất kết nối…" screen up for minutes. Unbounded Promise.all is
 * the other failure: Meta rate-limits a burst of a hundred calls.
 *
 * A rejected item does not stop the others; its slot holds the error.
 */
export async function runLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<({ ok: true; value: R } | { ok: false; error: unknown })[]> {
  const out = new Array<{ ok: true; value: R } | { ok: false; error: unknown }>(items.length);
  let next = 0;
  const lanes = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = { ok: true, value: await fn(items[i], i) }; } catch (error) { out[i] = { ok: false, error }; }
    }
  };
  await Promise.all(Array.from({ length: lanes }, lane));
  return out;
}
