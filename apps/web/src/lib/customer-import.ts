/**
 * NHẬP KHÁCH CŨ — reading a client list exported from the salon's old system.
 *
 * Square, Vagaro, Fresha, GlossGenius, Booker, Mangomint… each name their
 * columns differently. This reads the CSV, guesses which column is which
 * (the owner can change any guess), and builds rows with the canonical keys
 * the API reads (api customers/import-rows.ts). Pure.
 */
export type Field = 'firstName' | 'lastName' | 'name' | 'phone' | 'email' | 'birthday' | 'points' | 'spent' | 'visits' | 'lastVisit' | 'notes' | 'smsOptIn';

export const FIELDS: { key: Field; vi: string; en: string }[] = [
  { key: 'firstName', vi: 'Tên', en: 'First name' },
  { key: 'lastName', vi: 'Họ', en: 'Last name' },
  { key: 'name', vi: 'Họ tên (một cột)', en: 'Full name (one column)' },
  { key: 'phone', vi: 'Số điện thoại', en: 'Phone' },
  { key: 'email', vi: 'Email', en: 'Email' },
  { key: 'birthday', vi: 'Sinh nhật', en: 'Birthday' },
  { key: 'points', vi: 'Điểm tích luỹ', en: 'Loyalty points' },
  { key: 'spent', vi: 'Tổng đã chi', en: 'Total spent' },
  { key: 'visits', vi: 'Số lần ghé', en: 'Number of visits' },
  { key: 'lastVisit', vi: 'Lần ghé gần nhất', en: 'Last visit' },
  { key: 'notes', vi: 'Ghi chú', en: 'Notes' },
  { key: 'smsOptIn', vi: 'Đồng ý nhận SMS', en: 'SMS opt-in' },
];

/** Header words per field, lower-case, punctuation removed. Order matters: first match wins. */
const SYNONYMS: Record<Field, string[]> = {
  firstName: ['first name', 'firstname', 'given name', 'customer first name', 'client first name', 'ten', 'tên'],
  lastName: ['last name', 'lastname', 'surname', 'family name', 'customer last name', 'client last name', 'ho', 'họ'],
  name: ['name', 'full name', 'client name', 'customer name', 'client', 'customer', 'ho ten', 'họ tên', 'họ và tên'],
  phone: ['phone', 'phone number', 'mobile', 'mobile phone', 'mobile number', 'cell', 'cell phone', 'telephone', 'primary phone', 'so dien thoai', 'số điện thoại', 'sđt', 'sdt'],
  email: ['email', 'email address', 'e mail', 'client email', 'customer email'],
  birthday: ['birthday', 'birth date', 'birthdate', 'date of birth', 'dob', 'sinh nhat', 'sinh nhật', 'ngày sinh'],
  points: ['points', 'loyalty points', 'reward points', 'points balance', 'loyalty balance', 'diem', 'điểm', 'điểm tích luỹ', 'điểm tích lũy'],
  spent: ['total spend', 'total spent', 'total sales', 'lifetime spend', 'lifetime value', 'total revenue', 'amount spent', 'sales', 'tong chi', 'tổng chi', 'doanh thu'],
  visits: ['total visits', 'visits', 'number of visits', 'visit count', 'appointments', 'total appointments', '# of visits', 'so lan', 'số lần ghé', 'số lần'],
  lastVisit: ['last visit', 'last visit date', 'last appointment', 'last seen', 'last booking', 'lan cuoi', 'lần ghé gần nhất', 'lần cuối'],
  notes: ['notes', 'note', 'memo', 'comments', 'client notes', 'customer notes', 'ghi chu', 'ghi chú'],
  smsOptIn: ['sms opt in', 'sms consent', 'text opt in', 'sms marketing', 'accepts sms', 'marketing sms', 'sms subscription status', 'text marketing', 'đồng ý sms'],
};

const norm = (s: string) => s.toLowerCase().replace(/[_\-.:]+/g, ' ').replace(/\s+/g, ' ').trim();

/** CSV → rows of cells. Handles quotes, escaped quotes, CRLF, a BOM, and ; or tab files. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const firstLine = t.split(/\r?\n/, 1)[0] ?? '';
  const delim = [',', ';', '\t'].map((d) => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export type Mapping = Record<Field, number>;

/** Which column holds what (-1 = none). Exact header names first, then "contains". */
export function guessMapping(headers: string[]): Mapping {
  const h = headers.map(norm);
  const used = new Set<number>();
  const out = {} as Mapping;
  for (const f of FIELDS) {
    let idx = -1;
    for (const syn of SYNONYMS[f.key]) { const i = h.findIndex((x, j) => !used.has(j) && x === syn); if (i >= 0) { idx = i; break; } }
    if (idx < 0 && f.key !== 'name') {
      for (const syn of SYNONYMS[f.key]) { if (syn.length < 4) continue; const i = h.findIndex((x, j) => !used.has(j) && x.includes(syn)); if (i >= 0) { idx = i; break; } }
    }
    out[f.key] = idx;
    if (idx >= 0) used.add(idx);
  }
  // A separate first/last pair beats a "name" column that is really the same person.
  if (out.firstName >= 0 && out.name >= 0) out.name = -1;
  return out;
}

/** The export this probably is, to label the import ("Square", "Vagaro"…). */
export function detectSource(headers: string[]): string {
  const h = headers.map(norm).join('|');
  if (/reference id|square customer id|email subscription status/.test(h)) return 'Square';
  if (/vagaro|customer first name|# of visits/.test(h)) return 'Vagaro';
  if (/fresha|client source|blocked/.test(h)) return 'Fresha';
  if (/glossgenius/.test(h)) return 'GlossGenius';
  if (/booker/.test(h)) return 'Booker';
  if (/mangomint/.test(h)) return 'Mangomint';
  return 'CSV';
}

/** Rows for the API: only mapped fields, trimmed strings. */
export function toRows(table: string[][], mapping: Mapping): Record<string, string>[] {
  return table.map((cells) => {
    const r: Record<string, string> = {};
    for (const f of FIELDS) {
      const i = mapping[f.key];
      if (i >= 0 && cells[i] !== undefined && String(cells[i]).trim() !== '') r[f.key] = String(cells[i]).trim();
    }
    return r;
  });
}

export const SAMPLE_CSV = `First Name,Last Name,Phone,Email,Birthday,Points,Total Spent,Total Visits,Last Visit,Notes,SMS Opt-in
Debbie,Smith,(403) 555-0100,debbie@example.com,03/14,120,$410.00,7,06/01/2026,Likes almond shape,Yes
Aly,Nguyen,403-555-0111,,,30,95,2,2026-05-20,,No
`;
