/**
 * NHẬP DOANH THU CŨ — the page half: which column of the owner's file is
 * which. The API (pos/sales-import.ts) is the authority on what each value
 * means (money in the salon's currency, day-first or month-first dates).
 * Pure.
 */
export type SaleField = 'date' | 'time' | 'bill' | 'customer' | 'phone' | 'staff' | 'item' | 'kind' | 'amount' | 'tip' | 'discount' | 'method' | 'count';

export const SALE_FIELDS: { key: SaleField; vi: string; en: string; required?: boolean }[] = [
  { key: 'date', vi: 'Ngày', en: 'Date', required: true },
  { key: 'staff', vi: 'Thợ', en: 'Technician' },
  { key: 'amount', vi: 'Số tiền (chưa tip)', en: 'Amount (before tip)', required: true },
  { key: 'tip', vi: 'Tip', en: 'Tip' },
  { key: 'item', vi: 'Dịch vụ / món', en: 'Service / item' },
  { key: 'bill', vi: 'Số bill', en: 'Bill / receipt #' },
  { key: 'method', vi: 'Thanh toán', en: 'Payment method' },
  { key: 'time', vi: 'Giờ', en: 'Time' },
  { key: 'customer', vi: 'Tên khách', en: 'Customer name' },
  { key: 'phone', vi: 'SĐT khách', en: 'Customer phone' },
  { key: 'kind', vi: 'Loại (dịch vụ/sản phẩm)', en: 'Type (service/product)' },
  { key: 'discount', vi: 'Giảm giá', en: 'Discount' },
  { key: 'count', vi: 'Số khách (dòng tổng ngày)', en: 'Customers (day-total rows)' },
];

const SYN: Record<SaleField, string[]> = {
  date: ['date', 'ngay', 'ngày', 'sale date', 'transaction date', 'ticket date', 'created', 'ngay ban', 'ngày bán'],
  time: ['time', 'gio', 'giờ', 'sale time'],
  bill: ['bill', 'so bill', 'số bill', 'receipt', 'receipt #', 'receipt number', 'ticket', 'ticket #', 'ticket number', 'order', 'order #', 'order number', 'invoice', 'ma bill', 'mã bill', 'hoa don', 'hoá đơn', 'hóa đơn'],
  customer: ['customer', 'client', 'customer name', 'client name', 'ten khach', 'tên khách', 'khach', 'khách'],
  phone: ['phone', 'customer phone', 'client phone', 'mobile', 'sdt', 'sđt', 'sđt khách', 'sdt khach', 'sđt khach', 'điện thoại', 'dien thoai', 'so dien thoai', 'số điện thoại'],
  staff: ['staff', 'technician', 'tech', 'employee', 'stylist', 'provider', 'team member', 'tho', 'thợ', 'nhan vien', 'nhân viên', 'ktv'],
  item: ['service', 'item', 'description', 'services', 'item name', 'product', 'dich vu', 'dịch vụ', 'noi dung', 'nội dung'],
  kind: ['type', 'item type', 'category type', 'loai', 'loại'],
  amount: ['amount', 'price', 'sales', 'net sales', 'gross sales', 'service amount', 'total', 'so tien', 'số tiền', 'doanh thu', 'tien', 'tiền', 'gia', 'giá'],
  tip: ['tip', 'tips', 'tip amount', 'tips amount', 'gratuity', 'tien tip', 'tiền tip'],
  discount: ['discount', 'discounts', 'giam gia', 'giảm giá', 'giam', 'giảm'],
  method: ['payment', 'payment method', 'tender', 'tender type', 'paid by', 'method', 'thanh toan', 'thanh toán', 'hinh thuc', 'hình thức'],
  count: ['customers', 'clients', 'count', 'so khach', 'số khách', 'luot khach', 'lượt khách', 'guests', 'visits'],
};

const norm = (s: string) => s.toLowerCase().replace(/[_\-.:#]+/g, ' ').replace(/\s+/g, ' ').trim();

export type SaleMapping = Record<SaleField, number>;

/** Which column holds what (-1 = none): exact header names first, then "contains". */
export function guessSaleMapping(headers: string[]): SaleMapping {
  const h = headers.map(norm);
  const used = new Set<number>();
  const out = {} as SaleMapping;
  // Tip before amount, so "Tip amount" is the tip and not the sale.
  const order: SaleField[] = ['date', 'time', 'tip', 'discount', 'count', 'bill', 'phone', 'customer', 'staff', 'method', 'kind', 'item', 'amount'];
  for (const f of order) {
    let idx = -1;
    for (const syn of SYN[f].map(norm)) { const i = h.findIndex((x, j) => !used.has(j) && x === syn); if (i >= 0) { idx = i; break; } }
    if (idx < 0) for (const syn of SYN[f].map(norm)) { if (syn.length < 4) continue; const i = h.findIndex((x, j) => !used.has(j) && x.includes(syn)); if (i >= 0) { idx = i; break; } }
    out[f] = idx;
    if (idx >= 0) used.add(idx);
  }
  return out;
}

/** Rows for the API: only mapped fields, trimmed; blank lines dropped. */
export function toSaleRows(table: string[][], mapping: SaleMapping): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const cells of table) {
    const r: Record<string, string> = {};
    for (const f of SALE_FIELDS) {
      const i = mapping[f.key];
      if (i >= 0 && cells[i] !== undefined && String(cells[i]).trim() !== '') r[f.key] = String(cells[i]).trim();
    }
    if (Object.keys(r).length) out.push(r);
  }
  return out;
}

/** The template the owner fills in: bills line by line, or one total per technician per day. */
export function saleTemplate(vi: boolean): string[][] {
  return vi
    ? [
      ['Ngày', 'Giờ', 'Số bill', 'Tên khách', 'SĐT khách', 'Thợ', 'Dịch vụ', 'Loại', 'Số tiền', 'Tip', 'Giảm giá', 'Thanh toán', 'Số khách'],
      ['14/09/2026', '14:30', '101', 'Ngọc Anh', '0901234567', 'Lan', 'Sơn gel', 'Dịch vụ', '250.000', '30.000', '', 'Chuyển khoản', ''],
      ['14/09/2026', '14:30', '101', 'Ngọc Anh', '0901234567', 'Mai', 'Đắp bột', 'Dịch vụ', '400.000', '50.000', '50.000', 'Chuyển khoản', ''],
      ['15/09/2026', '', '', '', '', 'Lan', 'Tổng ngày (sổ tay)', 'Dịch vụ', '2.150.000', '200.000', '', 'Tiền mặt', '9'],
    ]
    : [
      ['Date', 'Time', 'Bill #', 'Customer', 'Phone', 'Technician', 'Service', 'Type', 'Amount', 'Tip', 'Discount', 'Payment', 'Customers'],
      ['09/14/2026', '2:30 PM', '101', 'Jenny Tran', '512-886-8189', 'Lan', 'Gel manicure', 'Service', '35.00', '6.00', '', 'Card', ''],
      ['09/14/2026', '2:30 PM', '101', 'Jenny Tran', '512-886-8189', 'Mai', 'Pedicure', 'Service', '45.00', '8.00', '5.00', 'Card', ''],
      ['09/15/2026', '', '', '', '', 'Lan', 'Daily total (paper book)', 'Service', '620.00', '95.00', '', 'Cash', '11'],
    ];
}
