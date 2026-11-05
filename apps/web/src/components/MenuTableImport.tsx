'use client';

import { apiFetch } from '../lib/api';
import { formatPrice } from '../lib/money';
import { parseDelimited } from '../lib/service-import';
import { checkMenuRows, gridToMenuRows, menuPayload, menuTemplateCsv, menuTemplateRows, optionsText, type CheckedMenuRow, type MenuExistingWeb } from '../lib/menu-import';
import { checkTableRows, gridToTableRows, tablePayload, tableTemplateCsv, tableTemplateRows, type CheckedTableRow, type Spot, type TableExistingWeb } from '../lib/table-import';
import { SheetImport, download } from './SheetImport';
import { writeXlsx } from '../lib/xlsx-lite';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const stamp = () => new Date().toISOString().slice(0, 10);

/** The menu template, straight from the page (no need to open the import panel): the restaurant's language and currency. */
export function downloadMenuTemplate(vi: boolean, currency: string, kind: 'xlsx' | 'csv') {
  const base = `${vi ? 'lumio-thuc-don-mau' : 'lumio-menu-template'}-${stamp()}`;
  if (kind === 'csv') download(`${base}.csv`, menuTemplateCsv(vi, currency), 'text/csv;charset=utf-8');
  else download(`${base}.xlsx`, writeXlsx(menuTemplateRows(vi, currency), { sheetName: vi ? 'Thực đơn' : 'Menu', widths: MENU_WIDTHS }) as BlobPart, XLSX);
}

/** The tables & floor-plan template, straight from the page. */
export function downloadTableTemplate(vi: boolean, kind: 'xlsx' | 'csv') {
  const base = `${vi ? 'lumio-so-do-ban-mau' : 'lumio-floor-plan-template'}-${stamp()}`;
  if (kind === 'csv') download(`${base}.csv`, tableTemplateCsv(vi), 'text/csv;charset=utf-8');
  else download(`${base}.xlsx`, writeXlsx(tableTemplateRows(vi), { sheetName: vi ? 'Sơ đồ bàn' : 'Floor plan', widths: TABLE_WIDTHS }) as BlobPart, XLSX);
}

const MENU_WIDTHS = [14, 28, 10, 32, 60, 26, 8];
const TABLE_WIDTHS = [16, 10, 16, 28, 8, 8];

/** Row of "download the template" links shown on the page itself, above the import. */
export function TemplateLinks({ vi, onXlsx, onCsv, label }: { vi: boolean; onXlsx: () => void; onCsv: () => void; label: string }) {
  const link = { background: 'none', border: 'none', padding: 0, color: 'var(--ink-link)', fontWeight: 600, fontSize: 13, cursor: 'pointer', textDecoration: 'underline' } as const;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13, color: 'var(--c94a3b8)' }}>
      📄 {label}:
      <button type="button" onClick={onXlsx} style={link}>Excel (.xlsx)</button>
      <span aria-hidden="true">·</span>
      <button type="button" onClick={onCsv} style={link}>CSV</button>
      <span style={{ fontSize: 12 }}>{vi ? '— điền rồi bấm Nhập để tải lên' : '— fill it in, then Import to upload'}</span>
    </span>
  );
}

/** The restaurant's menu from a sheet: template, upload, preview, import (POST /menu-items/import). */
export function MenuImport({ token, vi, currency, existing, onDone, onClose }: {
  token: string; vi: boolean; currency: string; existing: MenuExistingWeb[]; onDone: () => void; onClose?: () => void;
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  const fmt = (m: number) => formatPrice(m, currency);
  const plain = (m: number) => formatPrice(m, currency).replace(/[^\d.,]/g, '');
  return (
    <SheetImport<CheckedMenuRow>
      vi={vi}
      title={L('Nhập thực đơn từ Excel', 'Import the menu from Excel')}
      subtitle={L('Tải file mẫu, điền món của quán, tải lên. Món đã có được cập nhật giá — không bị nhân đôi.', 'Download the template, fill in your dishes, upload. Dishes you already have get updated — never doubled.')}
      templateName="lumio-thuc-don-mau"
      sheetName={L('Thực đơn', 'Menu')}
      templateRows={() => menuTemplateRows(vi, currency)}
      templateCsv={() => menuTemplateCsv(vi, currency)}
      widths={MENU_WIDTHS}
      required={[1, 2]}
      maxRows={500}
      tips={[
        L('* bắt buộc: Tên món và Giá. Để trống Danh mục thì món thuộc danh mục ở dòng trên.', '* required: Dish name and Price. A blank Category belongs to the one above it.'),
        L(`Giá ghi số theo ${currency}${currency === 'VND' ? ' (vd 65000 hoặc 65.000)' : ' (vd 14 hoặc 14.50)'}.`, `Price in ${currency} (e.g. 14 or 14.50).`),
        L('Tuỳ chọn: "Cỡ tô*: Thường, Lớn +15000 | Thêm: Trứng +10000". Dấu * = khách bắt buộc chọn 1; "+giá" = tính thêm; các nhóm cách nhau bằng dấu |.', 'Options: "Size*: Regular, Large +3 | Extras: Egg +2". * = the guest must pick one; "+price" = costs extra; groups split by |.'),
        L('Link ảnh: dán đường link ảnh (https://…) nếu có; để trống thì giữ ảnh đang có. Ảnh cũng có thể tải lên từng món sau.', 'Photo link: an https:// address if you have one; blank keeps the current photo. Photos can also be uploaded per dish later.'),
        L('Nhập lại cùng file không tạo món trùng: món đã có chỉ được cập nhật phần thay đổi.', 'Importing the same file again creates no duplicates: existing dishes only get what changed.'),
      ]}
      check={async (grid, text) => checkMenuRows(gridToMenuRows(grid ?? parseDelimited(text ?? ''), currency), existing, vi, fmt)}
      headers={[L('Danh mục', 'Category'), L('Món', 'Dish'), L('Giá', 'Price'), L('Tuỳ chọn', 'Options')]}
      cells={(r) => [
        <span style={{ color: 'var(--c94a3b8)' }}>{r.category || '—'}</span>,
        <span style={{ fontWeight: 600 }}>{r.name || <i style={{ color: 'var(--c64748b)' }}>{L('(trống)', '(blank)')}</i>}{r.imageUrl && <span title={r.imageUrl} style={{ marginLeft: 6 }}>🖼</span>}</span>,
        <span style={{ whiteSpace: 'nowrap' }}>{r.status === 'error' && !r.priceCents ? '—' : fmt(r.priceCents)}</span>,
        <span style={{ color: 'var(--c94a3b8)', fontSize: 12 }}>{r.options?.length ? optionsText(r.options, plain) : r.optionsText ? <span style={{ color: 'var(--ink-warn)' }}>{L('không đọc được — xem cách ghi ở bước 1', 'not readable — see step 1')}</span> : '—'}</span>,
      ]}
      run={async (rows) => {
        const r = await apiFetch<{ created: number; updated: number; unchanged: number; skipped: number; errors: number }>('/menu-items/import', { method: 'POST', token, body: { items: menuPayload(rows) } });
        return L(`✓ Đã thêm ${r.created} món, cập nhật ${r.updated} món${r.unchanged ? `, ${r.unchanged} món giữ nguyên` : ''}.`, `✓ Added ${r.created} dishes, updated ${r.updated}${r.unchanged ? `, ${r.unchanged} unchanged` : ''}.`);
      }}
      onDone={onDone}
      onClose={onClose}
      pastePlaceholder={L('Dán các ô copy từ Excel / Google Sheets (có dòng tiêu đề như file mẫu)', 'Paste cells copied from Excel / Google Sheets (with the heading row, as in the template)')}
    />
  );
}

/** Tables and the floor plan from a sheet (POST /tables/import). Row / column place each table on the map. */
export function TableImport({ token, vi, existing, onDone, onClose }: {
  token: string; vi: boolean; existing: TableExistingWeb[]; onDone: () => void; onClose?: () => void;
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  const shapeName = (s: string | null) => (s === 'round' ? L('tròn', 'round') : s === 'square' ? L('vuông', 'square') : s === 'long' ? L('dài', 'long') : '');
  return (
    <SheetImport<CheckedTableRow>
      vi={vi}
      title={L('Nhập bàn & sơ đồ bàn từ Excel', 'Import tables & floor plan from Excel')}
      subtitle={L('Mỗi dòng một bàn: tên, số ghế, khu vực, hình dạng và vị trí (hàng, cột). Nhập xong có thể kéo thả chỉnh lại trên Sơ đồ bàn.', 'One row per table: name, seats, area, shape and position (row, column). Fine-tune by dragging on the Floor map afterwards.')}
      templateName="lumio-so-do-ban-mau"
      sheetName={L('Sơ đồ bàn', 'Floor plan')}
      templateRows={() => tableTemplateRows(vi)}
      templateCsv={() => tableTemplateCsv(vi)}
      widths={TABLE_WIDTHS}
      required={[0, 1]}
      maxRows={300}
      tips={[
        L('* bắt buộc: Tên bàn và Số ghế (1–50). Để trống Khu vực thì bàn thuộc khu ở dòng trên.', '* required: Table name and Seats (1–50). A blank Area belongs to the one above it.'),
        L('Hình dạng: tròn, vuông hoặc dài (bàn dài cho nhóm đông). Để trống = hệ thống chọn theo số ghế.', 'Shape: round, square or long (long tables for big groups). Blank = picked from the seats.'),
        L('Hàng / Cột = vị trí trên sơ đồ, như vẽ quán ra giấy: hàng 1 ở trên cùng, cột 1 bên trái. Bỏ trống một hàng hoặc cột để chừa lối đi. Để trống cả hai = hệ thống tự xếp.', 'Row / Column = where it stands, as if you sketched the room: row 1 at the top, column 1 on the left. Skip a row or column to leave an aisle. Both blank = placed for you.'),
        L('Nhập lại cùng file không tạo bàn trùng: bàn đã có (theo tên) chỉ được cập nhật.', 'Importing the same file again creates no duplicates: existing tables (by name) are only updated.'),
      ]}
      check={async (grid, text) => {
        const floor = await apiFetch<{ layout: Record<string, Spot> }>('/tables/floor', { token }).catch(() => ({ layout: {} as Record<string, Spot> }));
        return checkTableRows(gridToTableRows(grid ?? parseDelimited(text ?? '')), existing, floor.layout ?? {}, vi);
      }}
      headers={[L('Bàn', 'Table'), L('Ghế', 'Seats'), L('Khu vực', 'Area'), L('Vị trí', 'Position')]}
      cells={(r) => [
        <span style={{ fontWeight: 600 }}>{r.name || <i style={{ color: 'var(--c64748b)' }}>{L('(trống)', '(blank)')}</i>}</span>,
        <span>{r.seats || '—'}</span>,
        <span style={{ color: 'var(--c94a3b8)' }}>{r.area || '—'}</span>,
        <span style={{ color: 'var(--c94a3b8)', whiteSpace: 'nowrap' }}>{r.row !== null && r.col !== null ? L(`hàng ${r.row}, cột ${r.col}`, `row ${r.row}, col ${r.col}`) : L('tự xếp', 'auto')}{r.shape ? ` · ${shapeName(r.shape)}` : ''}</span>,
      ]}
      run={async (rows) => {
        const r = await apiFetch<{ created: number; updated: number; unchanged: number; placed: number }>('/tables/import', { method: 'POST', token, body: { tables: tablePayload(rows) } });
        return L(`✓ Đã thêm ${r.created} bàn, cập nhật ${r.updated} bàn${r.placed ? `, đặt ${r.placed} bàn lên sơ đồ` : ''}. Xem ở tab "Sơ đồ bàn".`, `✓ Added ${r.created} tables, updated ${r.updated}${r.placed ? `, placed ${r.placed} on the map` : ''}. See the "Floor map" tab.`);
      }}
      onDone={onDone}
      onClose={onClose}
      pastePlaceholder={L('Dán các ô copy từ Excel / Google Sheets (có dòng tiêu đề như file mẫu)', 'Paste cells copied from Excel / Google Sheets (with the heading row, as in the template)')}
    />
  );
}
