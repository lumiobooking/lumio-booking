/**
 * The technician columns' order on the calendar (api calendar-layout): the
 * salon's saved line-up first, then anyone not in it A → Z. A hidden
 * technician is left off — unless she has a booking that day: a booking must
 * never vanish from the calendar because its column was hidden.
 */
export interface StaffLayout { order: string[]; hidden: string[] }

export function arrange<T extends { id: string; firstName: string }>(staff: T[], layout: StaffLayout | null | undefined, busy: ReadonlySet<string> = new Set()): T[] {
  const order = layout?.order ?? [];
  const hidden = new Set(layout?.hidden ?? []);
  const pos = new Map(order.map((id, i) => [id, i]));
  return staff
    .filter((s) => !hidden.has(s.id) || busy.has(s.id))
    .slice()
    .sort((a, b) => {
      const pa = pos.has(a.id) ? (pos.get(a.id) as number) : Infinity;
      const pb = pos.has(b.id) ? (pos.get(b.id) as number) : Infinity;
      if (pa !== pb) return pa - pb;
      return a.firstName.localeCompare(b.firstName);
    });
}

/** Move `id` so it lands at `to` (0 = first) in the full list of ids. */
export function moveTo(ids: string[], id: string, to: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return ids.slice();
  const out = ids.slice();
  out.splice(from, 1);
  const at = Math.max(0, Math.min(out.length, to));
  out.splice(at, 0, id);
  return out;
}

/**
 * Where a column dragged over `overIndex` would land, from which half of that
 * column the pointer is in. Indexes are in the list WITHOUT the dragged one.
 */
export function dropIndex(overIndex: number, rightHalf: boolean): number {
  return overIndex + (rightHalf ? 1 : 0);
}
