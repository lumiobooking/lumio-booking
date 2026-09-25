import { crc32, readXlsx, unzip, writeXlsx, zipStored } from './xlsx-lite';

describe('xlsx-lite', () => {
  it('CRC-32 matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('a stored zip reads back', async () => {
    const z = zipStored([{ name: 'a.txt', data: new TextEncoder().encode('hello') }]);
    const files = await unzip(z);
    expect(new TextDecoder().decode(files.get('a.txt'))).toBe('hello');
  });
  it('writes a sheet it can read, keeping Vietnamese, commas, quotes and numbers', async () => {
    const rows = [['Danh mục', 'Tên dịch vụ', 'Giá'], ['Tay', 'Sơn gel "cao cấp", bền', '150000'], ['Chân & spa', '<Pedi>', '200000.5']];
    const back = await readXlsx(writeXlsx(rows, { sheetName: 'Dịch vụ', widths: [16, 30, 12] }));
    expect(back).toEqual(rows);
  });
  it('reads shared strings, rich-text runs and sparse cells', async () => {
    const enc = new TextEncoder();
    const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="B2"><v>45</v></c><c r="C2" t="b"><v>1</v></c></row></sheetData></worksheet>';
    const ss = '<sst><si><t>Name</t></si><si><r><t>Pri</t></r><r><t xml:space="preserve">ce</t></r></si></sst>';
    const z = zipStored([
      { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheet) },
      { name: 'xl/sharedStrings.xml', data: enc.encode(ss) },
    ]);
    expect(await readXlsx(z)).toEqual([['Name', '', 'Price'], ['', '45', 'TRUE']]);
  });
  it('refuses something that is not a zip', async () => {
    await expect(readXlsx(new TextEncoder().encode('name,price\n'))).rejects.toThrow(/xlsx/);
  });
});
