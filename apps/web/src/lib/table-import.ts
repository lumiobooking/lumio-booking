/**
 * The floor-plan sheet: one row per table — name, seats, area, shape, and
 * where it stands as ROW and COLUMN (row 1 = the top of the room, column 1 =
 * the left), the way an owner sketches the room on paper. Template, reading
 * and the preview's verdicts; the server (api tables/table-import.ts) applies
 * the same rules.
 */
import { fold, parseDelimited } from './service-import';

export type Shape = 'round' | 'square' | 'long';
export interface Spot { x: number; y: number; shape: Shape }

export interface TableRow {
  line: number; name: string; seats: number; area: string; shapeText: string; shape: Shape | null;
  row: number | null; col: number | null; err?: string;
}
export type TableStatus = 'new' | 'update' | 'same' | 'duplicate' | 'error';
export interface CheckedTableRow extends TableRow { status: TableStatus; note: string }
export interface TableExistingWeb { id: string; name: string; seats: number; area: string | null }

type Field = 'name' | 'seats' | 'area' | 'shape' | 'row' | 'col';
const ALIASES: Record<Field, string[]> = {
  name: ['ten ban', 'ban', 'ten', 'table', 'table name', 'name'],
  seats: ['so ghe', 'ghe', 'so cho', 'cho ngoi', 'seats', 'capacity', 'covers'],
  area: ['khu vuc', 'khu', 'tang', 'area', 'zone', 'section', 'room'],
  shape: ['hinh dang', 'hinh', 'kieu ban', 'shape'],
  row: ['hang', 'dong', 'row'],
  col: ['cot', 'column', 'col'],
};
function headerField(cell: string): Field | null {
  const f = fold(cell).replace(/\*/g, '').replace(/\(.*\)\s*$/, '').trim();
  if (!f) return null;
  for (const k of Object.keys(ALIASES) as Field[]) if (ALIASES[k].includes(f)) return k;
  for (const k of ['seats', 'shape', 'area', 'name', 'row', 'col'] as Field[]) if (ALIASES[k].some((a) => a.length > 2 && f.startsWith(a))) return k;
  return null;
}

export function shapeOf(cell: string): Shape | null {
  const s = fold(cell);
  if (!s) return null;
  if (/^(tron|round|circle|o)$/.test(s)) return 'round';
  if (/^(vuong|square)$/.test(s)) return 'square';
  if (/^(dai|chu nhat|long|rect|rectangle|bang dai|ban dai)$/.test(s)) return 'long';
  return null;
}

/** Same grid as the map's own placement (api floor.ts withDefaults). */
export function spotOf(row: number | null, col: number | null): { x: number; y: number } | null {
  if (row === null || col === null || row < 1 || col < 1) return null;
  return { x: Math.min(94, 4 + (col - 1) * 15), y: Math.min(90, 6 + (row - 1) * 18) };
}

const int = (s: string) => { const n = parseInt(String(s ?? '').replace(/[^\d-]/g, ''), 10); return Number.isFinite(n) ? n : null; };

export function gridToTableRows(grid: string[][]): TableRow[] {
  if (!grid.length) return [];
  const header = grid[0].map(headerField);
  const hasHeader = header.includes('name');
  const cols: (Field | null)[] = hasHeader ? header : ['name', 'seats', 'area', 'shape', 'row', 'col'];
  const body = hasHeader ? grid.slice(1) : grid;
  const at = (r: string[], f: Field) => { const i = cols.indexOf(f); return i >= 0 ? (r[i] ?? '').trim() : ''; };
  let lastArea = '';
  return body.map((r, i) => {
    const name = at(r, 'name');
    const seats = int(at(r, 'seats'));
    const area = at(r, 'area') || lastArea;
    lastArea = area;
    const shapeText = at(r, 'shape');
    return {
      line: i + (hasHeader ? 2 : 1), name, seats: seats ?? 0, area, shapeText, shape: shapeOf(shapeText),
      row: int(at(r, 'row')), col: int(at(r, 'col')),
      err: !name ? 'name' : seats === null || seats < 1 || seats > 50 ? 'seats' : shapeText && !shapeOf(shapeText) ? 'shape' : undefined,
    };
  });
}
export const parseTableSheetText = (text: string) => gridToTableRows(parseDelimited(text));

const key = (s: string | null | undefined) => fold(String(s ?? ''));

export function checkTableRows(rows: TableRow[], existing: TableExistingWeb[], layout: Record<string, Spot>, vi: boolean): CheckedTableRow[] {
  const L = (v: string, e: string) => (vi ? v : e);
  const seen = new Set<string>();
  return rows.map((r) => {
    if (r.err === 'name') return { ...r, status: 'error', note: L('Thiếu tên bàn', 'Table name missing') };
    if (r.err === 'seats') return { ...r, status: 'error', note: L('Số ghế phải từ 1 đến 50', 'Seats must be 1–50') };
    if (r.err === 'shape') return { ...r, status: 'error', note: L('Hình dạng ghi: tròn, vuông hoặc dài', 'Shape: round, square or long') };
    const k = key(r.name);
    if (seen.has(k)) return { ...r, status: 'duplicate', note: L('Trùng tên bàn ở dòng trên — bỏ qua', 'Same table earlier in the file — skipped') };
    seen.add(k);
    const hit = existing.find((e) => key(e.name) === k);
    if (!hit) return { ...r, status: 'new', note: '' };
    const changes: string[] = [];
    if (hit.seats !== r.seats) changes.push(`${hit.seats} → ${r.seats} ${L('ghế', 'seats')}`);
    if (r.area && r.area !== (hit.area ?? '')) changes.push(L('khu vực', 'area'));
    const pos = spotOf(r.row, r.col);
    const now = layout[hit.id];
    if (pos && !(now && now.x === pos.x && now.y === pos.y)) changes.push(L('vị trí', 'position'));
    if (r.shape && !(now && now.shape === r.shape)) changes.push(L('hình dạng', 'shape'));
    return changes.length
      ? { ...r, status: 'update', note: `↻ ${L('Cập nhật', 'Update')}: ${changes.join(', ')}` }
      : { ...r, status: 'same', note: L('= Đã có, giữ nguyên', '= Already set up') };
  });
}

export function tablePayload(rows: CheckedTableRow[]) {
  return rows.filter((r) => r.status === 'new' || r.status === 'update').map((r) => ({
    name: r.name, seats: r.seats,
    ...(r.area ? { area: r.area } : {}),
    ...(r.shape ? { shape: r.shape } : {}),
    ...(r.row !== null && r.col !== null ? { row: r.row, col: r.col } : {}),
  }));
}

/** A small room: two rows indoors, a long table, the patio and the bar. */
export function tableTemplateRows(vi: boolean): string[][] {
  return vi
    ? [
        ['Tên bàn *', 'Số ghế *', 'Khu vực', 'Hình dạng (tròn / vuông / dài)', 'Hàng', 'Cột'],
        ['Bàn 1', '2', 'Trong nhà', 'tròn', '1', '1'],
        ['Bàn 2', '4', 'Trong nhà', 'vuông', '1', '2'],
        ['Bàn 3', '4', 'Trong nhà', 'vuông', '1', '3'],
        ['Bàn 4', '4', 'Trong nhà', 'vuông', '2', '1'],
        ['Bàn 5', '8', 'Trong nhà', 'dài', '2', '2'],
        ['Sân 1', '4', 'Sân ngoài', 'vuông', '4', '1'],
        ['Sân 2', '4', 'Sân ngoài', 'vuông', '4', '2'],
        ['Bar 1', '2', 'Quầy bar', 'tròn', '4', '5'],
      ]
    : [
        ['Table name *', 'Seats *', 'Area', 'Shape (round / square / long)', 'Row', 'Column'],
        ['T1', '2', 'Indoor', 'round', '1', '1'],
        ['T2', '4', 'Indoor', 'square', '1', '2'],
        ['T3', '4', 'Indoor', 'square', '1', '3'],
        ['T4', '4', 'Indoor', 'square', '2', '1'],
        ['T5', '8', 'Indoor', 'long', '2', '2'],
        ['Patio 1', '4', 'Patio', 'square', '4', '1'],
        ['Patio 2', '4', 'Patio', 'square', '4', '2'],
        ['Bar 1', '2', 'Bar', 'round', '4', '5'],
      ];
}

const csvEsc = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
export function tableTemplateCsv(vi: boolean): string {
  return '﻿' + tableTemplateRows(vi).map((r) => r.map(csvEsc).join(',')).join('\r\n') + '\r\n';
}
