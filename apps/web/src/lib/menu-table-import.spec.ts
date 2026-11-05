import { checkMenuRows, gridToMenuRows, menuPayload, menuTemplateCsv, menuTemplateRows, parseOptionsCell, parseMenuSheetText } from './menu-import';
import { checkTableRows, gridToTableRows, parseTableSheetText, shapeOf, spotOf, tablePayload, tableTemplateCsv, tableTemplateRows } from './table-import';

/** "Phần nhập thực đơn, nhập sơ đồ bàn chưa có template mẫu để làm theo và import" (5 Nov 2026). */
const fmt = (m: number) => `$${(m / 100).toFixed(2)}`;

describe('menu template and sheet', () => {
  it('the template reads back as the menu it shows — every row valid, options parsed', () => {
    for (const [vi, cur] of [[true, 'VND'], [false, 'USD'], [true, 'USD']] as const) {
      const rows = gridToMenuRows(menuTemplateRows(vi, cur), cur);
      expect(rows.length).toBe(6);
      expect(rows.every((r) => !r.err)).toBe(true);
      expect(rows[0].options?.[0]).toMatchObject({ required: true, max: 1 });
      expect(rows[1].category).toBe(rows[0].category); // blank category = the one above
    }
    expect(menuTemplateCsv(true, 'VND').startsWith('﻿')).toBe(true);
  });

  it('options cell: required group, extras with prices, groups split by |', () => {
    expect(parseOptionsCell('Cỡ tô*: Thường, Lớn +15000 | Thêm: Trứng +10000, Quẩy +5.000', 'VND')).toEqual([
      { name: 'Cỡ tô', required: true, max: 1, choices: [{ name: 'Thường', priceCents: 0 }, { name: 'Lớn', priceCents: 15000 }] },
      { name: 'Thêm', required: false, max: 2, choices: [{ name: 'Trứng', priceCents: 10000 }, { name: 'Quẩy', priceCents: 5000 }] },
    ]);
    expect(parseOptionsCell('Size*: Small, Large +2.50', 'USD')![0].choices[1]).toEqual({ name: 'Large', priceCents: 250 });
    expect(parseOptionsCell('', 'USD')).toBeNull();
    expect(parseOptionsCell('Coke 330ml, no sugar', 'USD')).toEqual([]); // no "Group:" → nothing invented
  });

  it('headers in either language, any order; a CSV from Excel (; separated) too', () => {
    const rows = parseMenuSheetText('Giá;Tên món;Danh mục\n65.000;Phở bò;Phở\n;Phở gà;', 'VND');
    expect(rows.map((r) => [r.name, r.priceCents, r.category, r.err])).toEqual([['Phở bò', 65000, 'Phở', undefined], ['Phở gà', 0, 'Phở', 'price']]);
  });

  it('preview: new, update (what changes), same, duplicate, error — and only new/update are sent', () => {
    const existing = [{ name: 'Phở bò', category: 'Phở', priceCents: 1400, description: null, imageUrl: null, options: [], sortOrder: 0 }];
    const rows = checkMenuRows(parseMenuSheetText('Dish name,Category,Price\nPho bo,Phở,15\nBún chả,Bún,13\nBún chả,Bún,13\n,Bún,1', 'USD'), existing, false, fmt);
    expect(rows.map((r) => r.status)).toEqual(['update', 'new', 'duplicate', 'error']);
    expect(rows[0].note).toContain('$14.00 → $15.00');
    expect(menuPayload(rows).map((r) => r.name)).toEqual(['Pho bo', 'Bún chả']);
    const same = checkMenuRows(parseMenuSheetText('Dish name,Category,Price\nPhở bò,Phở,14', 'USD'), existing, false, fmt);
    expect(same[0].status).toBe('same');
  });
});

describe('floor-plan template and sheet', () => {
  it('the template reads back: every table valid, placed on rows and columns', () => {
    for (const vi of [true, false]) {
      const rows = gridToTableRows(tableTemplateRows(vi));
      expect(rows).toHaveLength(8);
      expect(rows.every((r) => !r.err && r.row !== null && r.col !== null && r.shape)).toBe(true);
    }
  });
  it('row / column → the map grid; shapes in either language', () => {
    expect(spotOf(2, 3)).toEqual({ x: 34, y: 24 });
    expect(spotOf(null, 1)).toBeNull();
    expect(['Tròn', 'vuông', 'Dài', 'square', 'tam giác'].map(shapeOf)).toEqual(['round', 'square', 'long', 'square', null]);
  });
  it('preview: new / update (seats, position) / same / errors', () => {
    const existing = [{ id: 't1', name: 'Bàn 1', seats: 4, area: 'Trong nhà' }];
    const rows = checkTableRows(parseTableSheetText('Tên bàn,Số ghế,Hàng,Cột,Hình dạng\nBàn 1,6,1,1,tròn\nBàn 2,2,,,\nBàn 3,0,,,\nBàn 4,2,,,tam giác'), existing, { t1: { x: 4, y: 6, shape: 'round' } }, true);
    expect(rows.map((r) => r.status)).toEqual(['update', 'new', 'error', 'error']);
    expect(rows[0].note).toBe('↻ Cập nhật: 4 → 6 ghế');
    expect(tablePayload(rows)).toEqual([{ name: 'Bàn 1', seats: 6, shape: 'round', row: 1, col: 1 }, { name: 'Bàn 2', seats: 2 }]);
  });
});

describe('the templates published for download (public/downloads/templates)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  const dir = path.join(__dirname, '../../public/downloads/templates');
  it('match what the importer expects — regenerate them when a template changes', () => {
    const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');
    expect(read('lumio-thuc-don-mau.csv')).toBe(menuTemplateCsv(true, 'VND'));
    expect(read('lumio-menu-template.csv')).toBe(menuTemplateCsv(false, 'USD'));
    expect(read('lumio-so-do-ban-mau.csv')).toBe(tableTemplateCsv(true));
    expect(read('lumio-floor-plan-template.csv')).toBe(tableTemplateCsv(false));
    for (const f of ['lumio-thuc-don-mau.xlsx', 'lumio-menu-template.xlsx', 'lumio-so-do-ban-mau.xlsx', 'lumio-floor-plan-template.xlsx']) {
      expect(fs.statSync(path.join(dir, f)).size).toBeGreaterThan(1000);
    }
  });
});
