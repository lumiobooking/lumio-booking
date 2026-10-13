'use client';

/**
 * NHẬP DOANH THU CŨ — typed straight into Lumio, no file.
 *
 * For the salon whose history is a paper book: one row per technician per
 * day ("Lan · 2.150.000 · tip 200.000 · 9 khách") or one row per bill. The
 * "fill a whole day" button lays out one row for every technician on that
 * date, so a month of the book is ~30 clicks plus the numbers.
 *
 * Rows become the same keys the file import sends (lib/sales-import.ts), with
 * the technician as an id picked from the salon's own list. The draft is kept
 * in this browser until it is imported, so a long evening of typing survives a
 * closed tab.
 */
import { useState, type CSSProperties } from 'react';
import { ui } from '../lib/ui';

export interface GridRow {
  id: string; date: string; bill: string; staffId: string; item: string;
  amount: string; tip: string; count: string; method: string;
}
export interface StaffOption { id: string; name: string }

const DRAFT_KEY = 'lumio_sales_entry_draft';
const newId = () => Math.random().toString(36).slice(2, 10);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Draft rows → the import's row keys. A row with neither amount nor tip is left out. */
export function gridToRows(rows: GridRow[]): Record<string, string>[] {
  return rows
    .filter((r) => r.amount.trim() || r.tip.trim())
    .map((r) => {
      const o: Record<string, string> = { date: r.date, amount: r.amount.trim() || '0' };
      if (r.tip.trim()) o.tip = r.tip.trim();
      if (r.staffId) o.staffId = r.staffId;
      if (r.item.trim()) o.item = r.item.trim();
      if (r.bill.trim()) o.bill = r.bill.trim();
      if (r.count.trim()) o.count = r.count.trim();
      if (r.method) o.method = r.method;
      return o;
    });
}

export function loadDraft(scope: string): GridRow[] {
  try {
    const raw = window.localStorage.getItem(`${DRAFT_KEY}:${scope}`);
    const v = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? (v as GridRow[]).filter((r) => r && typeof r.id === 'string') : [];
  } catch { return []; }
}
export function saveDraft(scope: string, rows: GridRow[]) {
  try {
    if (rows.length) window.localStorage.setItem(`${DRAFT_KEY}:${scope}`, JSON.stringify(rows));
    else window.localStorage.removeItem(`${DRAFT_KEY}:${scope}`);
  } catch { /* private window: the draft just is not kept */ }
}

export function SalesEntryGrid({ vi, staff, rows, setRows, market }: {
  vi: boolean; staff: StaffOption[]; rows: GridRow[]; setRows: (r: GridRow[]) => void; market: 'VN' | 'US';
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  const [day, setDay] = useState(today());
  const [dayMethod, setDayMethod] = useState('cash');

  const methods: Array<[string, string]> = [
    ['cash', L('Tiền mặt', 'Cash')], ['card', L('Thẻ', 'Card')], ['transfer', L('Chuyển khoản', 'Transfer')],
    ...(market === 'VN' ? [['momo', 'MoMo'], ['zalopay', 'ZaloPay'], ['vietqr', 'VietQR']] as Array<[string, string]> : [['transfer', 'Zelle / Venmo'] as [string, string]]),
    ['other', L('Không rõ', 'Unknown')],
  ];

  const set = (id: string, patch: Partial<GridRow>) => setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const remove = (id: string) => setRows(rows.filter((r) => r.id !== id));
  const addRow = () => {
    const last = rows[rows.length - 1];
    setRows([...rows, { id: newId(), date: last?.date ?? day, bill: '', staffId: '', item: '', amount: '', tip: '', count: '', method: last?.method ?? dayMethod }]);
  };
  const fillDay = () => {
    const taken = new Set(rows.filter((r) => r.date === day).map((r) => r.staffId));
    const add = staff.filter((s) => !taken.has(s.id)).map((s) => ({
      id: newId(), date: day, bill: '', staffId: s.id, item: L('Tổng ngày', 'Day total'), amount: '', tip: '', count: '', method: dayMethod,
    }));
    setRows([...rows, ...add]);
  };

  const cell: CSSProperties = { ...ui.input, padding: '6px 8px', fontSize: 13, minWidth: 0 };
  const th: CSSProperties = { textAlign: 'left', padding: '6px 6px', color: 'var(--c94a3b8)', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' };
  const td: CSSProperties = { padding: '4px 4px', borderTop: '1px solid var(--line)', verticalAlign: 'top' };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', background: 'var(--c0f172a)', border: '1px solid var(--line)', borderRadius: 10, padding: 10, marginBottom: 10 }}>
        <label style={{ fontSize: 12.5 }}>
          <span style={{ display: 'block', color: 'var(--c94a3b8)', marginBottom: 3 }}>{L('Ngày', 'Day')}</span>
          <input type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} style={{ ...cell, width: 160 }} />
        </label>
        <label style={{ fontSize: 12.5 }}>
          <span style={{ display: 'block', color: 'var(--c94a3b8)', marginBottom: 3 }}>{L('Thanh toán', 'Paid by')}</span>
          <select value={dayMethod} onChange={(e) => setDayMethod(e.target.value)} style={{ ...cell, width: 150 }}>
            {methods.map(([v, t], i) => <option key={`${v}${i}`} value={v}>{t}</option>)}
          </select>
        </label>
        <button type="button" onClick={fillDay} disabled={!staff.length} style={ui.primaryBtn}>
          {L('+ Thêm 1 dòng cho mỗi thợ', '+ One row per technician')}
        </button>
        <span style={{ fontSize: 12, color: 'var(--c64748b)', flex: '1 1 200px' }}>
          {L('Hợp với sổ ghi tay: mỗi thợ một dòng tổng của ngày đó (số tiền, tip, số khách).', 'Suits a paper book: one total per technician for that day (amount, tip, customers).')}
        </span>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--c334155)', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
          <thead>
            <tr>
              <th style={th}>{L('Ngày', 'Day')}</th>
              <th style={th}>{L('Thợ', 'Technician')}</th>
              <th style={th}>{L('Dịch vụ / nội dung', 'Service / note')}</th>
              <th style={th}>{L('Số tiền', 'Amount')}</th>
              <th style={th}>Tip</th>
              <th style={th}>{L('Số khách', 'Customers')}</th>
              <th style={th}>{L('Thanh toán', 'Paid by')}</th>
              <th style={th}>{L('Số bill', 'Bill #')}</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}><input type="date" value={r.date} max={today()} onChange={(e) => set(r.id, { date: e.target.value })} style={{ ...cell, width: 140 }} /></td>
                <td style={td}>
                  <select value={r.staffId} onChange={(e) => set(r.id, { staffId: e.target.value })} style={{ ...cell, width: 150 }}>
                    <option value="">{L('— chưa gán —', '— unassigned —')}</option>
                    {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </td>
                <td style={td}><input value={r.item} placeholder={L('VD: Sơn gel', 'e.g. Gel mani')} onChange={(e) => set(r.id, { item: e.target.value })} style={{ ...cell, width: 160 }} /></td>
                <td style={td}><input inputMode="decimal" value={r.amount} placeholder={market === 'VN' ? '250000' : '45.00'} onChange={(e) => set(r.id, { amount: e.target.value })} style={{ ...cell, width: 110 }} /></td>
                <td style={td}><input inputMode="decimal" value={r.tip} onChange={(e) => set(r.id, { tip: e.target.value })} style={{ ...cell, width: 90 }} /></td>
                <td style={td}><input inputMode="numeric" value={r.count} placeholder="1" onChange={(e) => set(r.id, { count: e.target.value.replace(/[^\d]/g, '') })} style={{ ...cell, width: 64 }} /></td>
                <td style={td}>
                  <select value={r.method} onChange={(e) => set(r.id, { method: e.target.value })} style={{ ...cell, width: 130 }}>
                    {methods.map(([v, t], i) => <option key={`${v}${i}`} value={v}>{t}</option>)}
                  </select>
                </td>
                <td style={td}><input value={r.bill} placeholder={L('tuỳ chọn', 'optional')} onChange={(e) => set(r.id, { bill: e.target.value })} style={{ ...cell, width: 80 }} /></td>
                <td style={td}>
                  <button type="button" onClick={() => remove(r.id)} aria-label={L('Xoá dòng', 'Remove row')} style={{ background: 'none', border: 'none', color: 'var(--ink-bad)', cursor: 'pointer', fontSize: 16 }}>×</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={9} style={{ ...td, color: 'var(--c64748b)', fontSize: 13, padding: 12 }}>
                {L('Chưa có dòng nào. Chọn ngày rồi bấm "Thêm 1 dòng cho mỗi thợ", hoặc "Thêm dòng" để nhập từng bill.', 'No rows yet. Pick a day and press "One row per technician", or "Add row" to type bills one by one.')}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
        <button type="button" onClick={addRow} style={{ background: 'none', border: '1px solid var(--line)', color: 'var(--ccbd5e1)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>
          + {L('Thêm dòng', 'Add row')}
        </button>
        {rows.length > 0 && (
          <button type="button" onClick={() => { if (window.confirm(L('Xoá hết các dòng đang nhập?', 'Clear every row?'))) setRows([]); }} style={{ background: 'none', border: 'none', color: 'var(--c94a3b8)', cursor: 'pointer', fontSize: 12.5 }}>
            {L('Xoá hết', 'Clear all')}
          </button>
        )}
        <span style={{ fontSize: 12, color: 'var(--c64748b)' }}>
          {L('Cùng ngày + cùng số bill = một bill. Bản nháp được giữ trên máy này cho tới khi nhập.', 'Same day + same bill # = one bill. The draft stays on this device until imported.')}
        </span>
      </div>
    </div>
  );
}
