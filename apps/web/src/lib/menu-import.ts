/**
 * The restaurant menu sheet: template, reading, and the preview's verdicts.
 *
 * Same idea as the salon's service import (service-import.ts): a real
 * template in the restaurant's language and currency, read from .xlsx / .csv
 * / a paste, checked row by row BEFORE anything is saved. The verdicts here
 * mirror the server's plan (api menu/menu-import.ts) so the preview never
 * promises what the import will not do.
 *
 * Options are written in one cell, the way a menu board says them:
 *   "Cỡ tô*: Thường, Lớn +15000 | Thêm: Trứng +10000, Quẩy +5000"
 *   - groups split by "|" (or ";"), the group name before ":"
 *   - "*" after the group name = the guest must choose one
 *   - "+price" after a choice = it costs that much more
 */
import { fold, parseDelimited, parsePrice } from './service-import';
import { minorUnitDigits } from './money';

export interface OptionChoiceIn { name: string; priceCents: number }
export interface OptionGroupIn { name: string; required: boolean; max: number; choices: OptionChoiceIn[] }

export interface MenuRow {
  line: number;
  category: string;
  name: string;
  priceCents: number;
  description: string;
  imageUrl: string;
  options: OptionGroupIn[] | null;
  optionsText: string;
  sortOrder: number | null;
  err?: string;
}

export type MenuStatus = 'new' | 'update' | 'same' | 'duplicate' | 'error';
export interface CheckedMenuRow extends MenuRow { status: MenuStatus; note: string }

export interface MenuExistingWeb {
  name: string; category: string | null; priceCents: number; description: string | null; imageUrl: string | null;
  options?: unknown; sortOrder?: number;
}

type Field = 'category' | 'name' | 'price' | 'description' | 'options' | 'image' | 'sort';
const ALIASES: Record<Field, string[]> = {
  category: ['danh muc', 'nhom', 'loai', 'category', 'section', 'group'],
  name: ['ten mon', 'mon', 'ten', 'dish', 'dish name', 'item', 'name'],
  price: ['gia', 'gia ban', 'price', 'cost'],
  description: ['mo ta', 'ghi chu', 'description', 'desc', 'details'],
  options: ['tuy chon', 'lua chon', 'options', 'option', 'choices', 'size'],
  image: ['link anh', 'anh', 'hinh', 'hinh anh', 'image', 'photo', 'image url', 'photo url', 'picture'],
  sort: ['thu tu', 'stt', 'sort', 'order', 'position'],
};

function headerField(cell: string): Field | null {
  const f = fold(cell).replace(/\*/g, '').replace(/\(.*\)\s*$/, '').trim();
  if (!f) return null;
  for (const k of Object.keys(ALIASES) as Field[]) if (ALIASES[k].includes(f)) return k;
  for (const k of ['options', 'image', 'description', 'price', 'name', 'category', 'sort'] as Field[]) {
    if (ALIASES[k].some((a) => a.length > 2 && f.startsWith(a))) return k;
  }
  return null;
}

/** "Cỡ tô*: Thường, Lớn +15000 | Thêm: Trứng +10000" → groups. Null when the cell is blank. */
export function parseOptionsCell(cell: string, currency = 'USD'): OptionGroupIn[] | null {
  const src = String(cell ?? '').trim();
  if (!src) return null;
  const groups: OptionGroupIn[] = [];
  for (const part of src.split(/\s*[|;\n]\s*/)) {
    const m = part.match(/^([^:]+):(.*)$/);
    if (!m) continue;
    let gname = m[1].trim();
    const required = /\*\s*$/.test(gname);
    gname = gname.replace(/\*\s*$/, '').trim();
    const choices: OptionChoiceIn[] = [];
    for (const raw of m[2].split(',')) {
      const c = raw.trim();
      if (!c) continue;
      const pm = c.match(/^(.*?)\s*\(?\+\s*([^)]+?)\)?\s*$/);
      const price = pm ? parsePrice(pm[2], currency) : null;
      const name = (pm && price ? pm[1] : c).trim();
      if (name) choices.push({ name: name.slice(0, 40), priceCents: price?.minor ?? 0 });
    }
    if (gname && choices.length) groups.push({ name: gname.slice(0, 40), required, max: required ? 1 : choices.length, choices: choices.slice(0, 20) });
  }
  return groups.slice(0, 8);
}

/** Groups back to the cell text (for the preview and the template). */
export function optionsText(groups: OptionGroupIn[] | null | undefined, fmt: (minor: number) => string): string {
  return (groups ?? []).map((g) => `${g.name}${g.required ? '*' : ''}: ${g.choices.map((c) => `${c.name}${c.priceCents ? ` +${fmt(c.priceCents)}` : ''}`).join(', ')}`).join(' | ');
}

export function gridToMenuRows(grid: string[][], currency = 'USD'): MenuRow[] {
  if (!grid.length) return [];
  const header = grid[0].map(headerField);
  const hasHeader = header.includes('name');
  const cols: (Field | null)[] = hasHeader ? header : ['category', 'name', 'price', 'description', 'options', 'image', 'sort'];
  const body = hasHeader ? grid.slice(1) : grid;
  const at = (r: string[], f: Field) => { const i = cols.indexOf(f); return i >= 0 ? (r[i] ?? '').trim() : ''; };
  let lastCategory = '';
  return body.map((r, i) => {
    const price = parsePrice(at(r, 'price'), currency);
    // A blank category belongs to the group above it — how a menu is laid out in a sheet.
    const category = at(r, 'category') || lastCategory;
    lastCategory = category;
    const optCell = at(r, 'options');
    const sort = parseInt(at(r, 'sort'), 10);
    const img = at(r, 'image');
    const name = at(r, 'name');
    return {
      line: i + (hasHeader ? 2 : 1),
      category, name,
      priceCents: price?.minor ?? 0,
      description: at(r, 'description'),
      imageUrl: /^https?:\/\//i.test(img) ? img : '',
      options: parseOptionsCell(optCell, currency),
      optionsText: optCell,
      sortOrder: Number.isFinite(sort) ? sort : null,
      err: !name ? 'name' : !price ? 'price' : undefined,
    };
  });
}

export function parseMenuSheetText(text: string, currency = 'USD'): MenuRow[] {
  return gridToMenuRows(parseDelimited(text), currency);
}

const key = (s: string | null | undefined) => fold(String(s ?? '')).replace(/[^a-z0-9]+/g, ' ').trim();
const shape = (g: Array<{ name: string; required?: boolean; max?: number; choices?: Array<{ name: string; priceCents?: number }> }>) =>
  JSON.stringify(g.map((x) => [x.name, !!x.required, x.max ?? 1, (x.choices ?? []).map((c) => [c.name, c.priceCents ?? 0])]));

/** The preview's verdict per row — the same rules as the server's planMenuImport. */
export function checkMenuRows(rows: MenuRow[], existing: MenuExistingWeb[], vi: boolean, fmt: (minor: number) => string): CheckedMenuRow[] {
  const L = (v: string, e: string) => (vi ? v : e);
  const seen = new Set<string>();
  const touched = new Set<MenuExistingWeb>();
  return rows.map((r) => {
    if (r.err === 'name') return { ...r, status: 'error', note: L('Thiếu tên món', 'Dish name missing') };
    if (r.err === 'price') return { ...r, status: 'error', note: L('Thiếu giá hoặc giá không đọc được', 'Price missing or unreadable') };
    const k = `${key(r.category)}|${key(r.name)}`;
    if (seen.has(k)) return { ...r, status: 'duplicate', note: L('Trùng món ở dòng trên — bỏ qua', 'Same dish earlier in the file — skipped') };
    seen.add(k);
    const byName = existing.filter((e) => key(e.name) === key(r.name) && !touched.has(e));
    const hit = byName.find((e) => key(e.category) === key(r.category)) ?? (byName.length === 1 ? byName[0] : undefined);
    if (!hit) return { ...r, status: 'new', note: '' };
    touched.add(hit);
    const changes: string[] = [];
    if ((hit.category ?? '') !== (r.category || '')) changes.push(L('danh mục', 'category'));
    if (hit.priceCents !== r.priceCents) changes.push(`${fmt(hit.priceCents)} → ${fmt(r.priceCents)}`);
    if (r.description && r.description !== (hit.description ?? '')) changes.push(L('mô tả', 'description'));
    if (r.imageUrl && r.imageUrl !== (hit.imageUrl ?? '')) changes.push(L('ảnh', 'photo'));
    if (r.options && shape(r.options) !== shape(Array.isArray(hit.options) ? hit.options as never : [])) changes.push(L('tuỳ chọn', 'options'));
    if (r.sortOrder !== null && r.sortOrder !== (hit.sortOrder ?? 0)) changes.push(L('thứ tự', 'order'));
    return changes.length
      ? { ...r, status: 'update', note: `↻ ${L('Cập nhật', 'Update')}: ${changes.join(', ')}` }
      : { ...r, status: 'same', note: L('= Đã có, giữ nguyên', '= Already on the menu') };
  });
}

/** What the server is sent for the rows that change something. */
export function menuPayload(rows: CheckedMenuRow[]) {
  return rows.filter((r) => r.status === 'new' || r.status === 'update').map((r) => ({
    name: r.name,
    category: r.category || null,
    priceCents: r.priceCents,
    ...(r.description ? { description: r.description } : {}),
    ...(r.imageUrl ? { imageUrl: r.imageUrl } : {}),
    ...(r.options ? { options: r.options } : {}),
    ...(r.sortOrder !== null ? { sortOrder: r.sortOrder } : {}),
  }));
}

/** The template: header plus a short, real-looking menu in the restaurant's language and money. */
export function menuTemplateRows(vi: boolean, currency = 'USD'): string[][] {
  const zero = minorUnitDigits(currency) === 0;
  const p = (usd: number, vnd: number) => (zero ? String(vnd) : String(usd));
  const header = vi
    ? ['Danh mục', 'Tên món *', 'Giá *', 'Mô tả', 'Tuỳ chọn (Nhóm*: lựa chọn +giá, ... | Nhóm khác: ...)', 'Link ảnh', 'Thứ tự']
    : ['Category', 'Dish name *', 'Price *', 'Description', 'Options (Group*: choice +price, ... | Other group: ...)', 'Photo link', 'Order'];
  const rows = vi
    ? [
        ['Phở', 'Phở bò tái', p(14, 65000), 'Nước dùng hầm 12 tiếng', `Cỡ tô*: Thường, Lớn +${p(3, 15000)} | Thêm: Trứng chần +${p(2, 10000)}, Quẩy +${p(1, 5000)}`, '', '1'],
        ['', 'Phở gà', p(13, 60000), '', `Cỡ tô*: Thường, Lớn +${p(3, 15000)}`, '', '2'],
        ['Bún', 'Bún chả Hà Nội', p(15, 70000), 'Chả nướng than, ăn kèm rau sống', '', '', '1'],
        ['Khai vị', 'Gỏi cuốn (2 cuốn)', p(8, 40000), 'Tôm, thịt, bún, rau', `Nước chấm*: Tương đậu, Mắm nêm`, '', '1'],
        ['Đồ uống', 'Cà phê sữa đá', p(5, 30000), 'Pha phin', 'Đá: Ít đá, Không đá', '', '1'],
        ['', 'Trà đá', p(1, 5000), '', '', '', '2'],
      ]
    : [
        ['Pho', 'Rare Beef Pho', p(14, 65000), 'Broth simmered 12 hours', `Size*: Regular, Large +${p(3, 15000)} | Extras: Poached egg +${p(2, 10000)}, Fried dough +${p(1, 5000)}`, '', '1'],
        ['', 'Chicken Pho', p(13, 60000), '', `Size*: Regular, Large +${p(3, 15000)}`, '', '2'],
        ['Vermicelli', 'Grilled Pork Vermicelli', p(15, 70000), 'Charcoal-grilled pork, fresh herbs', '', '', '1'],
        ['Appetizers', 'Fresh Spring Rolls (2)', p(8, 40000), 'Shrimp, pork, noodles, herbs', 'Sauce*: Peanut, Fish sauce', '', '1'],
        ['Drinks', 'Vietnamese Iced Coffee', p(5, 30000), 'Slow-drip', 'Ice: Light ice, No ice', '', '1'],
        ['', 'Iced Tea', p(1, 5000), '', '', '', '2'],
      ];
  return [header, ...rows];
}

const csvEsc = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
/** CSV with a BOM, so Excel on Windows shows Vietnamese correctly. */
export function menuTemplateCsv(vi: boolean, currency = 'USD'): string {
  return '﻿' + menuTemplateRows(vi, currency).map((r) => r.map(csvEsc).join(',')).join('\r\n') + '\r\n';
}
