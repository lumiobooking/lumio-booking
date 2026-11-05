/**
 * IMPORT THE TABLES AND THE FLOOR PLAN FROM A SHEET (Nov 2026: "nhập sơ đồ
 * bàn chưa có template mẫu").
 *
 * One row per table: name, seats, area, shape, and where it stands as a
 * ROW and COLUMN on the floor (row 1 = the top of the room, column 1 = the
 * left) — the way an owner sketches the room on paper. Row / column become
 * the map's x / y on the same grid the map uses when it places tables by
 * itself (floor.ts withDefaults), so an imported room looks like a drawn one
 * and can still be dragged into place afterwards.
 *
 * Matching is by table name: importing the same sheet twice changes nothing;
 * a corrected seat count updates that table. A blank cell keeps what the
 * table has. Pure — the service applies it, tenant-scoped.
 */
import type { Shape, Spot } from './floor';

export const MAX_TABLE_IMPORT = 300;

export interface TableImportRow {
  name: string;
  seats: number;
  area?: string | null;
  shape?: string | null;
  row?: number | null;
  col?: number | null;
}

export interface TableExisting { id: string; name: string; seats: number; area: string | null; sortOrder: number }

export interface TablePlan {
  create: Array<{ name: string; seats: number; area: string | null; sortOrder: number; spot: Partial<Spot> | null }>;
  update: Array<{ id: string; data: Partial<{ seats: number; area: string | null }>; spot: Partial<Spot> | null }>;
  same: number;
  duplicate: number;
  error: number;
}

export const tableKey = (s: string | null | undefined) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .toLowerCase().replace(/\s+/g, ' ').trim();

/** "tròn", "round", "vuông", "square", "dài", "chữ nhật", "long", "rectangle" → the map's shapes. */
export function shapeOf(cell: string | null | undefined): Shape | null {
  const s = tableKey(cell);
  if (!s) return null;
  if (/^(tron|round|circle|o)$/.test(s)) return 'round';
  if (/^(vuong|square)$/.test(s)) return 'square';
  if (/^(dai|chu nhat|long|rect|rectangle|bang dai|ban dai)$/.test(s)) return 'long';
  return null;
}

/** Row / column → the map's percentages (same grid as floor.ts withDefaults: 15% a column, 18% a row). */
export function spotOf(row: number | null | undefined, col: number | null | undefined): { x: number; y: number } | null {
  const r = Math.round(Number(row));
  const c = Math.round(Number(col));
  if (!Number.isFinite(r) || !Number.isFinite(c) || r < 1 || c < 1) return null;
  return { x: Math.min(94, 4 + (c - 1) * 15), y: Math.min(90, 6 + (r - 1) * 18) };
}

export function planTableImport(existing: TableExisting[], rows: TableImportRow[], layout: Record<string, Spot> = {}): TablePlan {
  const plan: TablePlan = { create: [], update: [], same: 0, duplicate: 0, error: 0 };
  const seen = new Set<string>();
  const nextSort = existing.reduce((m, t) => Math.max(m, t.sortOrder), -1) + 1;
  rows.slice(0, MAX_TABLE_IMPORT).forEach((r, i) => {
    const name = typeof r?.name === 'string' ? r.name.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    const seats = Math.round(Number(r?.seats));
    if (!name || !Number.isFinite(seats) || seats < 1 || seats > 50) { plan.error += 1; return; }
    const key = tableKey(name);
    if (seen.has(key)) { plan.duplicate += 1; return; }
    seen.add(key);
    const area = typeof r.area === 'string' && r.area.trim() ? r.area.replace(/\s+/g, ' ').trim().slice(0, 40) : null;
    const pos = spotOf(r.row, r.col);
    const shape = shapeOf(r.shape);
    const spot: Partial<Spot> | null = pos || shape ? { ...(pos ?? {}), ...(shape ? { shape } : {}) } : null;
    const hit = existing.find((e) => tableKey(e.name) === key);
    if (!hit) {
      plan.create.push({ name, seats, area, sortOrder: nextSort + i, spot });
      return;
    }
    const data: TablePlan['update'][number]['data'] = {};
    if (hit.seats !== seats) data.seats = seats;
    if (area !== null && area !== (hit.area ?? null)) data.area = area;
    // Already standing there, in that shape: nothing to move.
    const now = layout[hit.id];
    const moves = !!spot && !(now && (spot.x === undefined || (spot.x === now.x && spot.y === now.y)) && (spot.shape === undefined || spot.shape === now.shape));
    if (Object.keys(data).length || moves) plan.update.push({ id: hit.id, data, spot: moves ? spot : null });
    else plan.same += 1;
  });
  return plan;
}
