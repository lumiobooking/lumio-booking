/**
 * Moving a row in a list, and knowing when the list underneath really changed.
 *
 * WHY THIS IS A MODULE AND NOT FOUR LINES INSIDE THE PANEL
 *
 * The first drag-to-reorder panel did not work at all, and the reason was two
 * lines of plumbing rather than anything to do with dragging:
 *
 *     useEffect(() => { setOrder(services); }, [services]);
 *
 * `services` was rebuilt by `.filter()` on every parent render, so it was a new
 * array reference every time even when it held exactly the same services. The
 * effect therefore fired on every render and reset the list the instant
 * anything was dragged. The panel looked dead because it was.
 *
 * The fix is to compare what the list IS, not which object it happens to be —
 * and that comparison is a pure function, so it can be tested, which the
 * version living inside a component never was.
 */

/** Move one item and return a new array. Out-of-range moves change nothing. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
}

/**
 * A signature of the list's identity AND order.
 *
 * Order is deliberately part of it: after a save, the server sends the same
 * services back in their new order, and the panel must re-seed from that
 * rather than keep showing its own local copy.
 */
export function orderSignature(ids: readonly string[]): string {
  return ids.join(',');
}

/** True when two id lists hold the same items in the same places. */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => b[i] === id);
}
