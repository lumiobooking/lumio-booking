/**
 * Reading a salon's price list into services — the pure half of the importer.
 *
 * Three ways a menu arrives, and all three end up as the same rows:
 *  - the Excel/CSV template downloaded from the Services page (header row,
 *    one service per row);
 *  - cells copied straight out of Excel or Google Sheets and pasted into the
 *    box (tab-separated, header optional);
 *  - the original quick format: "# Category" lines and "Name | price | min".
 *
 * No DOM and no network here, so every rule is pinned by a test
 * (service-import.spec.ts). The XLSX container lives in xlsx-lite.ts.
 */
import { minorUnitDigits } from './money';

export interface ImportRow {
  category: string;
  name: string;
  priceCents: number;
  priceFrom: boolean;
  durationMinutes: number;
  description?: string;
  imageUrl?: string;
}

export type RowStatus = 'new' | 'duplicate' | 'error';
export interface CheckedRow extends ImportRow {
  line: number;
  status: RowStatus;
  note?: string;
}

type Field = 'category' | 'name' | 'price' | 'from' | 'minutes' | 'description' | 'image';

/** Header words in either language, lower-cased and without accents. */
const ALIASES: Record<Field, string[]> = {
  category: ['category', 'group', 'danh muc', 'nhom', 'loai'],
  name: ['service name', 'service', 'name', 'ten dich vu', 'dich vu', 'ten'],
  price: ['price', 'gia', 'gia tien', 'don gia', 'cost'],
  from: ['starting price', 'from price', 'from', 'price from', 'gia tu', 'tu'],
  minutes: ['duration', 'duration (min)', 'minutes', 'min', 'mins', 'time', 'thoi gian', 'thoi gian (phut)', 'phut'],
  description: ['description', 'details', 'mo ta', 'ghi chu', 'note'],
  image: ['image url', 'image', 'photo', 'link anh', 'anh', 'hinh'],
};

/** "Thời gian (phút)" → "thoi gian (phut)" */
export function fold(s: string): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function headerField(cell: string): Field | null {
  const f = fold(cell).replace(/\s*\((yes\/no|co\/khong|min|phut)\)\s*$/, '').trim();
  if (!f) return null;
  for (const key of Object.keys(ALIASES) as Field[]) {
    if (ALIASES[key].includes(f)) return key;
  }
  // "Giá từ (có/không)", "Starting price (yes/no)" and similar with trailing notes.
  for (const key of ['from', 'minutes', 'price', 'name', 'category', 'description', 'image'] as Field[]) {
    if (ALIASES[key].some((a) => a.length > 3 && f.startsWith(a))) return key;
  }
  return null;
}

/**
 * CSV / TSV to a grid, RFC 4180 quoting. The separator is guessed from the
 * first line: a tab means it came from a spreadsheet paste; otherwise the
 * more frequent of `;` (European Excel) and `,`.
 */
export function parseDelimited(text: string): string[][] {
  const src = String(text ?? '').replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = first.includes('\t') ? '\t'
    : (first.split(';').length > first.split(',').length ? ';' : ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') { quoted = true; continue; }
    if (ch === sep) { row.push(cell); cell = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
      continue;
    }
    cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

const YES = new Set(['yes', 'y', 'true', '1', 'x', 'co', 'c', 'dung', '+', 'from', 'tu']);

/**
 * A price as a person writes it, in the salon's currency.
 * "$62+", "62.50", "1,200", "150.000đ", "150,000 VND", "from 45", "từ 200k".
 * Returns null when there is no number at all.
 */
export function parsePrice(raw: string, currency = 'USD'): { minor: number; from: boolean } | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const f = fold(s);
  const from = s.includes('+') || /^(from|tu|starting)\b/.test(f);
  const k = /\d\s*k\b/i.test(s);
  const digits = minorUnitDigits(currency);
  let numText = s.replace(/[^\d.,]/g, '');
  if (!numText) return null;
  let value: number;
  if (digits === 0) {
    // VND and friends: every separator is a thousands separator.
    value = Number(numText.replace(/[.,]/g, ''));
  } else {
    // "1,200.50" / "1.200,50" / "62,5" — the LAST separator is the decimal
    // point only when it has one or two digits after it.
    const last = Math.max(numText.lastIndexOf('.'), numText.lastIndexOf(','));
    if (last >= 0 && numText.length - last - 1 <= 2) {
      numText = numText.slice(0, last).replace(/[.,]/g, '') + '.' + numText.slice(last + 1);
    } else {
      numText = numText.replace(/[.,]/g, '');
    }
    value = Number(numText);
  }
  if (!Number.isFinite(value)) return null;
  if (k) value *= 1000;
  return { minor: Math.round(value * 10 ** digits), from };
}

function minutesOf(raw: string): number {
  const s = fold(raw);
  if (!s) return 30;
  const h = /(\d+(?:[.,]\d+)?)\s*(h|hr|hrs|hour|hours|gio|tieng)\b/.exec(s);
  const m = /(\d+)\s*(m|min|mins|minute|minutes|p|phut)?\b/.exec(s.replace(h?.[0] ?? '', ''));
  let total = 0;
  if (h) total += Math.round(Number(h[1].replace(',', '.')) * 60);
  if (m) total += Number(m[1]);
  if (!total) return 30;
  return Math.min(600, Math.max(5, total));
}

/** The original "# Category / Name | price | minutes" format. */
function parsePipes(text: string, currency: string): Array<ImportRow & { line: number; err?: string }> {
  const out: Array<ImportRow & { line: number; err?: string }> = [];
  let category = '';
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line) return;
    if (line.startsWith('#')) { category = line.replace(/^#+/, '').trim(); return; }
    const parts = line.split('|').map((p) => p.trim());
    const price = parsePrice(parts[1] ?? '', currency);
    out.push({
      line: i + 1,
      category,
      name: parts[0] ?? '',
      priceCents: price?.minor ?? 0,
      priceFrom: price?.from ?? false,
      durationMinutes: minutesOf(parts[2] ?? ''),
      err: price ? undefined : 'price',
    });
  });
  return out;
}

/** Grid rows (from CSV, TSV or XLSX) to services. Header optional. */
export function rowsToItems(grid: string[][], currency = 'USD'): Array<ImportRow & { line: number; err?: string }> {
  if (!grid.length) return [];
  const header = grid[0].map(headerField);
  const hasHeader = header.includes('name');
  // No header: the template's own column order.
  const cols: (Field | null)[] = hasHeader ? header : ['category', 'name', 'price', 'from', 'minutes', 'description'];
  const body = hasHeader ? grid.slice(1) : grid;
  const at = (r: string[], f: Field) => { const i = cols.indexOf(f); return i >= 0 ? (r[i] ?? '') : ''; };
  let lastCategory = '';
  return body.map((r, i) => {
    const price = parsePrice(at(r, 'price'), currency);
    const fromCell = fold(at(r, 'from'));
    // A blank category in a later row belongs to the group above it — that is
    // how people lay out a menu in a sheet.
    const cat = at(r, 'category') || lastCategory;
    lastCategory = cat;
    const desc = at(r, 'description');
    const img = at(r, 'image');
    return {
      line: i + (hasHeader ? 2 : 1),
      category: cat,
      name: at(r, 'name'),
      priceCents: price?.minor ?? 0,
      priceFrom: (price?.from ?? false) || YES.has(fromCell),
      durationMinutes: minutesOf(at(r, 'minutes')),
      ...(desc ? { description: desc } : {}),
      ...(/^https?:\/\//i.test(img) ? { imageUrl: img } : {}),
      err: price ? undefined : 'price',
    };
  });
}

/** Pasted text in any of the three shapes. */
export function parseMenuText(text: string, currency = 'USD'): Array<ImportRow & { line: number; err?: string }> {
  const t = String(text ?? '');
  if (!t.trim()) return [];
  const lines = t.split(/\r?\n/).filter((l) => l.trim());
  const pipes = lines.some((l) => l.includes('|')) || lines.some((l) => l.trim().startsWith('#'));
  const tabbedOrCsv = lines[0].includes('\t') || headerField((lines[0].split(/[;,]/)[1] ?? '')) !== null;
  if (pipes && !tabbedOrCsv) return parsePipes(t, currency);
  return rowsToItems(parseDelimited(t), currency);
}

/**
 * What will happen to each row. A name the salon already has, or one that
 * appears twice in the file, is skipped — the server does the same, so the
 * preview never promises something the import will not do.
 */
export function checkRows(
  rows: Array<ImportRow & { line: number; err?: string }>,
  existingNames: string[],
  vi: boolean,
): CheckedRow[] {
  const have = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const seen = new Set<string>();
  return rows.map((r) => {
    const key = r.name.trim().toLowerCase();
    const { err, ...row } = r;
    if (!key) return { ...row, status: 'error', note: vi ? 'Thiếu tên dịch vụ' : 'Missing service name' };
    if (err === 'price') return { ...row, status: 'error', note: vi ? 'Giá không đọc được' : 'Price not readable' };
    if (have.has(key)) return { ...row, status: 'duplicate', note: vi ? 'Đã có — bỏ qua' : 'Already exists — skipped' };
    if (seen.has(key)) return { ...row, status: 'duplicate', note: vi ? 'Trùng trong file — bỏ qua' : 'Repeated in file — skipped' };
    seen.add(key);
    return { ...row, status: 'new' };
  });
}

/** The template: header plus a few rows in the salon's language and money. */
export function templateRows(vi: boolean, currency = 'USD'): string[][] {
  const header = vi
    ? ['Danh mục', 'Tên dịch vụ', 'Giá', 'Giá từ (có/không)', 'Thời gian (phút)', 'Mô tả']
    : ['Category', 'Service name', 'Price', 'Starting price (yes/no)', 'Duration (min)', 'Description'];
  const zero = minorUnitDigits(currency) === 0;
  const p = (usd: number, vnd: number) => (zero ? String(vnd) : String(usd));
  const Y = vi ? 'có' : 'yes';
  const N = vi ? 'không' : 'no';
  const rows = vi
    ? [
        ['Tay', 'Sơn gel tay', p(35, 150000), N, '45', 'Sơn gel bền màu 2-3 tuần'],
        ['Tay', 'Móng bột full set', p(55, 350000), Y, '75', 'Giá tuỳ độ dài và kiểu dáng'],
        ['Chân', 'Chăm sóc chân spa', p(45, 200000), N, '60', ''],
        ['Wax', 'Wax chân mày', p(12, 80000), N, '15', ''],
      ]
    : [
        ['Manicure', 'Gel Manicure', p(35, 150000), N, '45', 'Long-lasting gel colour, 2-3 weeks'],
        ['Acrylic', 'Full Set', p(55, 350000), Y, '75', 'Price depends on length and shape'],
        ['Pedicure', 'Spa Pedicure', p(45, 200000), N, '60', ''],
        ['Waxing', 'Eyebrow Wax', p(12, 80000), N, '15', ''],
      ];
  return [header, ...rows];
}

/** The template as CSV, with a BOM so Excel on Windows reads Vietnamese right. */
export function templateCsv(vi: boolean, currency = 'USD'): string {
  const esc = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return '﻿' + templateRows(vi, currency).map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}
