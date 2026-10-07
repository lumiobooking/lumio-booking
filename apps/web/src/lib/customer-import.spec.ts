import { detectSource, guessMapping, parseCsv, toRows } from './customer-import';

describe('reading an old client list', () => {
  it('parses quotes, commas inside quotes, CRLF, a BOM and semicolon files', () => {
    expect(parseCsv('﻿Name,Notes\r\n"Smith, Ann","said ""hi"""\r\n')).toEqual([['Name', 'Notes'], ['Smith, Ann', 'said "hi"']]);
    expect(parseCsv('a;b\n1;2\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\n\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('a Square export maps itself', () => {
    const h = ['Reference ID', 'First Name', 'Last Name', 'Email Address', 'Phone Number', 'Birthday', 'Total Spend', 'Total Visits', 'Last Visit', 'Memo', 'Email Subscription Status'];
    const m = guessMapping(h);
    expect(m).toMatchObject({ firstName: 1, lastName: 2, email: 3, phone: 4, birthday: 5, spent: 6, visits: 7, lastVisit: 8, notes: 9, name: -1 });
    expect(detectSource(h)).toBe('Square');
  });
  it('a Vagaro-style export and a one-column name', () => {
    const v = guessMapping(['Customer First Name', 'Customer Last Name', 'Mobile Phone', 'Points', '# of Visits', 'Total Spent']);
    expect(v).toMatchObject({ firstName: 0, lastName: 1, phone: 2, points: 3, visits: 4, spent: 5 });
    const f = guessMapping(['Client name', 'Mobile number', 'Total sales', 'Total visits']);
    expect(f).toMatchObject({ name: 0, phone: 1, spent: 2, visits: 3, firstName: -1 });
  });
  it('rows carry only the mapped, non-empty cells', () => {
    const m = guessMapping(['First Name', 'Phone', 'Points']);
    expect(toRows([['Ann', ' 403 ', ''], ['Bo', '', '5']], m)).toEqual([{ firstName: 'Ann', phone: '403' }, { firstName: 'Bo', points: '5' }]);
  });
});
