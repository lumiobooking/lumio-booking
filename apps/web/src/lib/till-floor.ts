/**
 * The restaurant till's floor, as the room is (Nov 2026 redesign). Pure.
 */
export type Shape = 'round' | 'square' | 'long';
export interface Spot { x: number; y: number; shape: Shape }

/** The numbers above the floor: tables with guests, open bills, money on the tables, what needs someone. */
export function floorStats(
  tableCount: number,
  checks: Array<{ tableIds: string[]; guests: number; subtotalCents: number; unsentCount: number; payRequestedAt?: string | null; pendingCount?: number; callReason?: string | null }>,
): { tables: number; busyTables: number; guests: number; openBills: number; takeaway: number; openCents: number; attention: number } {
  const busy = new Set<string>();
  for (const c of checks) for (const id of c.tableIds) busy.add(id);
  return {
    tables: tableCount,
    busyTables: busy.size,
    guests: checks.filter((c) => c.tableIds.length).reduce((s, c) => s + (c.guests || 0), 0),
    openBills: checks.length,
    takeaway: checks.filter((c) => c.tableIds.length === 0).length,
    openCents: checks.reduce((s, c) => s + (c.subtotalCents || 0), 0),
    attention: checks.filter((c) => c.unsentCount > 0 || !!c.payRequestedAt || (c.pendingCount ?? 0) > 0 || !!c.callReason).length,
  };
}

/**
 * Where the till draws a table. The layout's x is a percentage of the map's
 * width (kept); its y is a percentage of the owner's map, where a row is 18%
 * apart — the till spaces rows 140 px apart for its larger tiles, and the box
 * is only as tall as the lowest table needs.
 */
export const ROW_PX = 140;
export function spotTop(y: number): number {
  return Math.round((Math.max(0, y - 6) / 18) * ROW_PX); // the first row sits at 6%
}
export function mapBox(spots: Spot[]): { height: number } {
  const lowest = spots.reduce((m, s) => Math.max(m, spotTop(s.y)), 0);
  return { height: Math.max(420, lowest + ROW_PX) };
}

/** How many of each dish a bill already carries (voided lines aside). */
export function qtyByDish(lines: Array<{ menuItemId: string | null; quantity: number; state: string }>): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) {
    if (!l.menuItemId || l.state === 'VOID') continue;
    m.set(l.menuItemId, (m.get(l.menuItemId) ?? 0) + l.quantity);
  }
  return m;
}
