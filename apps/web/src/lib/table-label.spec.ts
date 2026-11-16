import { shortTables } from './table-label';

describe('shortTables', () => {
  it('joined tables fit one line', () => {
    expect(shortTables('Bàn 14 + Bàn 15 + Bàn 16')).toBe('14+15+16');
    expect(shortTables('Table 3 + Table 4')).toBe('3+4');
    expect(shortTables('A3 + S3')).toBe('A3+S3');
  });
  it('one table is left alone', () => {
    expect(shortTables('Bàn 5')).toBe('Bàn 5');
    expect(shortTables('Mang về #12')).toBe('Mang về #12');
  });
});

describe('tableTitle', () => {
  it('never "Bàn Bàn"', () => {
    const { tableTitle } = require('./table-label');
    expect(tableTitle('Bàn 14 + Bàn 15', true)).toBe('Bàn 14 + Bàn 15');
    expect(tableTitle('A3 + S3', true)).toBe('Bàn A3 + S3');
    expect(tableTitle('5', false)).toBe('Table 5');
  });
});
