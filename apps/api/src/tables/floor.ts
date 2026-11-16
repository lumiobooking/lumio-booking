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
export interface ResLike { id: string; tableId: string | null; startTime: Date; endTime: Date; status: string; partySize: number; customerName: string | null; notes?: string | null }

/** The dishes ordered ahead, as written into the notes by bookings/pre-order.ts. */
export function preOrderOf(notes: string | null | undefined): string | null {
  const m = /Pre-order: ([^·]+)/.exec(notes ?? '');
  return m ? m[1].trim() : null;
}

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

/** "Bàn 2" before "Bàn 10": names compared as people read them. */
export function byTableName(a: { name: string; sortOrder?: number }, b: { name: string; sortOrder?: number }): number {
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'vi', { numeric: true, sensitivity: 'base' });
}

const COL_W = 12; // 8 tables a row
const ROW_H = 15;
const shapeFor = (seats: number): Shape => (seats >= 6 ? 'long' : seats <= 2 ? 'round' : 'square');

/**
 * Tables never placed get a place of their own. A table added later used to
 * be laid out from the TOP row, on top of tables already arranged (Nẫu Chill
 * Đêm: Bàn 33/34/35 sat on Bàn 1/2/4, and the till read 1, 33, 2, 34…). Now
 * they go into the rows BELOW everything placed, in number order; only when
 * the room is full do they fill free gaps. Never on top of another table.
 */
export function withDefaults(tables: TableLike[], layout: Layout): Layout {
  const out: Layout = { ...layout };
  const missing = tables.filter((t) => t.isActive && !out[t.id]);
  if (!missing.length) return out;
  const placed = Object.values(out);
  const order: TableLike[] = [];
  for (const a of [...new Set(missing.map((t) => t.area || ''))]) order.push(...missing.filter((t) => (t.area || '') === a).sort(byTableName));
  const free = (x: number, y: number) => Object.values(out).every((p) => Math.abs(p.x - x) >= COL_W - 2 || Math.abs(p.y - y) >= ROW_H - 3);
  let y = placed.length ? Math.max(...placed.map((p) => p.y)) + ROW_H : 4;
  let col = 0;
  let area: string | null = null;
  for (const t of order) {
    // A new area starts on a new row.
    if (area !== null && (t.area || '') !== area && col > 0) { col = 0; y += ROW_H; }
    area = t.area || '';
    let spot: { x: number; y: number } | null = null;
    while (y <= 90 && !spot) {
      const x = 2 + col * COL_W;
      if (free(x, y)) spot = { x, y };
      col++;
      if (col >= 8) { col = 0; y += ROW_H; }
    }
    if (!spot) {
      // The room is full below: the first free gap anywhere, reading order.
      for (let gy = 4; gy <= 90 && !spot; gy += ROW_H) for (let c = 0; c < 8 && !spot; c++) if (free(2 + c * COL_W, gy)) spot = { x: 2 + c * COL_W, y: gy };
    }
    out[t.id] = { ...(spot ?? { x: 2, y: 90 }), shape: shapeFor(t.seats) };
  }
  return out;
}

/** "Tự xếp theo số bàn": every table in number order, `perRow` a row, area by area. */
export function arrangeByNumber(tables: TableLike[], perRow = 8, keep: Layout = {}): Layout {
  const n = Math.max(3, Math.min(12, Math.round(perRow)));
  const colW = 96 / n;
  const active = tables.filter((t) => t.isActive);
  const rows = Math.ceil(active.length / n) + new Set(active.map((t) => t.area || '')).size;
  const rowH = Math.max(10, Math.min(ROW_H, 88 / Math.max(1, rows)));
  const out: Layout = {};
  let row = 0;
  for (const a of [...new Set(active.sort(byTableName).map((t) => t.area || ''))]) {
    const inArea = active.filter((t) => (t.area || '') === a).sort(byTableName);
    inArea.forEach((t, i) => {
      if (i && i % n === 0) row++;
      out[t.id] = { x: Math.round((2 + (i % n) * colW) * 10) / 10, y: Math.min(92, Math.round((4 + row * rowH) * 10) / 10), shape: keep[t.id]?.shape ?? shapeFor(t.seats) };
    });
    row++;
  }
  return out;
}

export interface TableState {
  id: string;
  state: 'seated' | 'soon' | 'free';
  current: { id: string; name: string | null; party: number; until: string; preOrder: string | null } | null;
  next: { id: string; name: string | null; party: number; at: string; preOrder: string | null } | null;
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
      current: cur ? { id: cur.id, name: cur.customerName, party: cur.partySize, until: cur.endTime.toISOString(), preOrder: preOrderOf(cur.notes) } : null,
      next: nxt ? { id: nxt.id, name: nxt.customerName, party: nxt.partySize, at: nxt.startTime.toISOString(), preOrder: preOrderOf(nxt.notes) } : null,
    };
  });
}

export interface Waiting { id: string; name: string | null; party: number; at: string; until: string; preOrder: string | null }

/**
 * Reservations with no table yet, from an hour ago to three hours ahead of
 * `at` — the host's "to seat" list. Earliest first.
 */
export function waitingForTable(res: ResLike[], at: Date): Waiting[] {
  const from = at.getTime() - 60 * 60_000;
  const to = at.getTime() + 3 * 60 * 60_000;
  return res
    .filter((r) => !r.tableId && LIVE.has(r.status) && r.startTime.getTime() >= from && r.startTime.getTime() <= to)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
    .map((r) => ({ id: r.id, name: r.customerName, party: r.partySize, at: r.startTime.toISOString(), until: r.endTime.toISOString(), preOrder: preOrderOf(r.notes) }));
}
