import { checkRows, fold, parseDelimited, parseMenuText, parsePrice, rowsToItems, templateCsv, templateRows } from './service-import';

describe('prices as people write them', () => {
  it('dollars', () => {
    expect(parsePrice('$62+', 'USD')).toEqual({ minor: 6200, from: true });
    expect(parsePrice('62.50', 'USD')).toEqual({ minor: 6250, from: false });
    expect(parsePrice('1,200', 'USD')).toEqual({ minor: 120000, from: false });
    expect(parsePrice('1.200,50', 'AUD')).toEqual({ minor: 120050, from: false });
    expect(parsePrice('from 45', 'CAD')).toEqual({ minor: 4500, from: true });
  });
  it('dong: every separator is a thousands separator, and "k" means thousand', () => {
    expect(parsePrice('150.000đ', 'VND')).toEqual({ minor: 150000, from: false });
    expect(parsePrice('150,000 VND', 'VND')).toEqual({ minor: 150000, from: false });
    expect(parsePrice('từ 200k', 'VND')).toEqual({ minor: 200000, from: true });
  });
  it('nothing numeric is null, not zero', () => {
    expect(parsePrice('', 'USD')).toBeNull();
    expect(parsePrice('call us', 'USD')).toBeNull();
  });
});

describe('CSV and pasted sheets', () => {
  it('reads quotes, commas in quotes and the Excel BOM', () => {
    expect(parseDelimited('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
  });
  it('picks tab for a spreadsheet paste and ; for European Excel', () => {
    expect(parseDelimited('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseDelimited('a;b\n1,5;2')).toEqual([['a', 'b'], ['1,5', '2']]);
  });
});

describe('rows to services', () => {
  it('finds columns by header in either language, whatever the order', () => {
    const grid = [['Tên dịch vụ', 'Giá', 'Danh mục', 'Thời gian (phút)', 'Giá từ (có/không)'], ['Sơn gel', '150.000', 'Tay', '45', 'không'], ['Full set', '350.000', '', '75', 'có']];
    const out = rowsToItems(grid, 'VND');
    expect(out[0]).toMatchObject({ name: 'Sơn gel', category: 'Tay', priceCents: 150000, durationMinutes: 45, priceFrom: false, line: 2 });
    // A blank category carries down from the row above, as menus are laid out.
    expect(out[1]).toMatchObject({ name: 'Full set', category: 'Tay', priceCents: 350000, priceFrom: true });
  });
  it('with no header, uses the template order', () => {
    const out = rowsToItems([['Manicure', 'Gel Manicure', '35', 'no', '45']], 'USD');
    expect(out[0]).toMatchObject({ category: 'Manicure', name: 'Gel Manicure', priceCents: 3500, durationMinutes: 45, line: 1 });
  });
  it('reads durations like "1h 15m" and "1.5 giờ", defaults to 30', () => {
    const g = [['Name', 'Price', 'Duration'], ['a', '1', '1h 15m'], ['b', '1', '1.5 giờ'], ['c', '1', '']];
    expect(rowsToItems(g).map((r) => r.durationMinutes)).toEqual([75, 90, 30]);
  });
  it('still reads the original "# Category / Name | price | min" format', () => {
    const out = parseMenuText('# Acrylic\nNew Set | 62+ | 60\nRefill | 50\n# Waxing\nEyebrows | 10+', 'USD');
    expect(out.map((r) => [r.category, r.name, r.priceCents, r.priceFrom, r.durationMinutes])).toEqual([
      ['Acrylic', 'New Set', 6200, true, 60],
      ['Acrylic', 'Refill', 5000, false, 30],
      ['Waxing', 'Eyebrows', 1000, true, 30],
    ]);
  });
  it('reads a paste from Excel with its header', () => {
    const out = parseMenuText('Category\tService name\tPrice\nPedicure\tSpa Pedicure\t45', 'USD');
    expect(out[0]).toMatchObject({ category: 'Pedicure', name: 'Spa Pedicure', priceCents: 4500 });
  });
});

describe('the preview says what the import will do', () => {
  it('skips names the salon has and repeats in the file; flags missing names and prices', () => {
    const rows = rowsToItems([['Name', 'Price'], ['Gel', '30'], ['gel ', '31'], ['Refill', '40'], ['', '10'], ['Mystery', 'ask']]);
    const st = checkRows(rows, ['REFILL'], false).map((r) => r.status);
    expect(st).toEqual(['new', 'duplicate', 'duplicate', 'error', 'error']);
  });
});

describe('the template', () => {
  it('reads back through the importer exactly', () => {
    for (const [vi, cur] of [[true, 'VND'], [false, 'USD'], [false, 'AUD']] as const) {
      const rows = parseMenuText(templateCsv(vi, cur), cur);
      expect(rows).toHaveLength(templateRows(vi, cur).length - 1);
      expect(rows.every((r) => r.name && !('err' in r && r.err))).toBe(true);
      expect(rows.some((r) => r.priceFrom)).toBe(true);
    }
  });
  it('folds Vietnamese headers', () => {
    expect(fold('Thời gian (phút)')).toBe('thoi gian (phut)');
  });
});
