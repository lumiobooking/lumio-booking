/**
 * THE FLOOR MAP — where each table stands, and what is happening at it now.
 *
 * A restaurant's host thinks in a room, not a list: "the 4-top by the window
 * is free, the patio 6 sits down at 7". Each table gets a spot on a 100×100
 * grid (stored per restaurant in settings, key `table_layout` — no schema
 * change) and a shape; the map paints every table by its state at a moment:
 *   seated   — a reservation is running now
 *   soon     — the next one starts within the hour
 *   free     — nothing for the next hour
 * Pure.
 */

export type Shape = 'round' | 'square' | 'long';
export interface Spot { x: number; y: number; shape: Shape }
export type Layout = Record<string, Spot>;

export interface TableLike { id: string; name: string; seats: number; area: string | null; isActive: boolean; sortOrder: number }
export interface ResLike { id: string; tableId: string | null; startTime: Date; endTime: Date; status: string; partySize: number; customerName: string | null }

const LIVE = new Set(['PENDING', 'ASSIGNED', 'ACCEPTED', 'CONFIRMED', 'ARRIVED']);
const clamp = (n: number) => Math.min(96, Math.max(0, Math.round(n * 10) / 10));

/** Keep only this restaurant's tables, positions on the grid, known shapes. */
export function cleanLayout(input: unknown, tableIds: string[]): Layout {
  const ids = new Set(tableIds);
  const out: Layout = {};
  const o = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  for (const [id, raw] of Object.entries(o)) {
    if (!ids.has(id) || !raw || typeof raw !== 'object') continue;
    const r = raw as { x?: unknown; y?: unknown; shape?: unknown };
    const x = Number(r.x); const y = Number(r.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const shape: Shape = r.shape === 'square' || r.shape === 'long' ? r.shape : 'round';
    out[id] = { x: clamp(x), y: clamp(y), shape };
  }
  return out;
}

/** Tables never placed: laid out area by area in rows, so the first map is already readable. */
export function withDefaults(tables: TableLike[], layout: Layout): Layout {
  const out: Layout = { ...layout };
  const missing = tables.filter((t) => t.isActive && !out[t.id]);
  if (!missing.length) return out;
  const areas = [...new Set(missing.map((t) => t.area || ''))];
  let row = 0;
  for (const a of areas) {
    const inArea = missing.filter((t) => (t.area || '') === a).sort((p, q) => p.sortOrder - q.sortOrder || p.name.localeCompare(q.name));
    inArea.forEach((t, i) => {
      const col = i % 6; if (i && col === 0) row++;
      out[t.id] = { x: 4 + col * 15, y: Math.min(90, 6 + row * 18), shape: t.seats >= 6 ? 'long' : t.seats <= 2 ? 'round' : 'square' };
    });
    row++;
  }
  return out;
}

export interface TableState {
  id: string;
  state: 'seated' | 'soon' | 'free';
  current: { id: string; name: string | null; party: number; until: string } | null;
  next: { id: string; name: string | null; party: number; at: string } | null;
}

export function tableStates(tables: TableLike[], res: ResLike[], at: Date): TableState[] {
  const now = at.getTime();
  return tables.filter((t) => t.isActive).map((t) => {
    const mine = res.filter((r) => r.tableId === t.id && LIVE.has(r.status)).sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    const cur = mine.find((r) => r.startTime.getTime() <= now && r.endTime.getTime() > now) ?? null;
    const nxt = mine.find((r) => r.startTime.getTime() > now) ?? null;
    const soon = !!nxt && nxt.startTime.getTime() - now <= 60 * 60_000;
    return {
      id: t.id,
      state: cur ? 'seated' : soon ? 'soon' : 'free',
      current: cur ? { id: cur.id, name: cur.customerName, party: cur.partySize, until: cur.endTime.toISOString() } : null,
      next: nxt ? { id: nxt.id, name: nxt.customerName, party: nxt.partySize, at: nxt.startTime.toISOString() } : null,
    };
  });
}
