'use client';

/**
 * NHẬP DOANH THU CŨ — bring the old system's sales (or the handwritten book)
 * into Lumio, so the sales report, payroll and the dashboard have the months
 * before Lumio too.
 *
 * 1. Choose the file (Excel or CSV) — or fill in the template.
 * 2. Check which column is which (guessed; change any).
 * 3. Check: the server reads the file without writing anything and shows the
 *    totals per technician and per month, the rows it cannot read, and any
 *    technician name that matches nobody (the owner picks who it is).
 * 4. Import. A second import of the same file adds nothing; each import can
 *    be taken back out from the list below, unless its days are in a payroll
 *    that is already closed.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ui, formatPrice } from '../lib/ui';
import { parseCsv } from '../lib/customer-import';
import { readXlsx, writeXlsx } from '../lib/xlsx-lite';
import { SALE_FIELDS, guessSaleMapping, saleTemplate, toSaleRows, type SaleField, type SaleMapping } from '../lib/sales-import';
import { uiMarket } from '../lib/ui-market';
import { SalesEntryGrid, gridToRows, loadDraft, saveDraft, type GridRow, type StaffOption } from './SalesEntryGrid';

interface Summary {
  tickets: number; lines: number; salesCents: number; tipsCents: number; discountCents: number;
  firstDay: string | null; lastDay: string | null;
  byStaff: { staffId: string | null; name: string; tickets: number; salesCents: number; tipsCents: number }[];
  byMonth: { month: string; tickets: number; salesCents: number }[];
}
interface Preview {
  currency: string; dayFirst: boolean; rows: number; summary: Summary; duplicates: number;
  unknownStaff: { key: string; name: string; rows: number }[];
  staff: { id: string; name: string }[];
  errors: { row: number; reason: string }[]; errorCount: number; lockedRows: number;
}
interface Done { batch: string; created: number; failed: number; duplicates: number; errorCount: number; summary: Summary }
interface Batch { batch: string; label: string | null; tickets: number; totalCents: number; tipsCents: number; firstAt: string | null; lastAt: string | null }

const CHUNK_LIMIT = 5000;

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function SalesImport({ vi, onClose, onDone }: { vi: boolean; onClose: () => void; onDone?: () => void }) {
  const { token, user } = useAuth();
  const L = (v: string, e: string) => (vi ? v : e);
  const [table, setTable] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<SaleMapping | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [staffMap, setStaffMap] = useState<Record<string, string>>({});
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<'' | 'check' | 'import' | 'undo'>('');
  const [done, setDone] = useState<Done | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  // Typed straight in (default: most owners copy from a paper book) or from a file.
  const [mode, setMode] = useState<'grid' | 'file'>('grid');
  const draftScope = user?.tenantId ?? 'salon';
  const [gridRows, setGridRowsState] = useState<GridRow[]>([]);
  const [staffList, setStaffList] = useState<StaffOption[]>([]);
  useEffect(() => { setGridRowsState(loadDraft(draftScope)); }, [draftScope]);
  useEffect(() => {
    if (!token) return;
    apiFetch<{ id: string; firstName: string; lastName: string | null; isActive: boolean }[]>('/staff', { token })
      .then((list) => setStaffList(list.filter((s) => s.isActive).map((s) => ({ id: s.id, name: `${s.firstName}${s.lastName ? ` ${s.lastName}` : ''}` }))))
      .catch(() => setStaffList([]));
  }, [token]);
  const setGridRows = (next: GridRow[]) => { setGridRowsState(next); saveDraft(draftScope, next); setPreview(null); };

  const headers = table?.[0] ?? [];
  const body = useMemo(() => (table ? table.slice(1) : []), [table]);
  const rows = useMemo(
    () => (mode === 'grid' ? gridToRows(gridRows) : mapping ? toSaleRows(body, mapping) : []),
    [mode, gridRows, body, mapping],
  );
  const money = (c: number) => formatPrice(c, preview?.currency);

  const loadBatches = useCallback(() => {
    if (!token) return;
    apiFetch<Batch[]>('/pos/import-sales/batches', { token }).then(setBatches).catch(() => setBatches([]));
  }, [token]);
  useEffect(() => { loadBatches(); }, [loadBatches]);

  function takeTable(t: string[][], name: string) {
    const clean = t.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
    if (clean.length < 2) { setErr(L('File không có dòng doanh thu nào (cần dòng tiêu đề + ít nhất 1 dòng).', 'The file has no sales rows (a header row plus at least one row).')); return; }
    if (clean.length - 1 > CHUNK_LIMIT) { setErr(L(`Tối đa ${CHUNK_LIMIT} dòng mỗi lần — chia file theo tháng.`, `At most ${CHUNK_LIMIT} rows at a time — split the file by month.`)); return; }
    setErr(null); setDone(null); setPreview(null); setStaffMap({});
    setTable(clean); setFileName(name); setMapping(guessSaleMapping(clean[0]));
  }
  async function onFile(f: File | undefined) {
    if (!f) return;
    try {
      if (/\.xlsx$/i.test(f.name)) takeTable(await readXlsx(await f.arrayBuffer()), f.name);
      else if (/\.(csv|txt|tsv)$/i.test(f.name)) takeTable(parseCsv(await f.text()), f.name);
      else setErr(L('Chọn file Excel (.xlsx) hoặc CSV.', 'Choose an Excel (.xlsx) or CSV file.'));
    } catch { setErr(L('Không đọc được file này.', 'Could not read this file.')); }
  }

  const missing = mode === 'file' && mapping ? SALE_FIELDS.filter((f) => f.required && mapping[f.key] < 0) : [];

  async function check(map = staffMap) {
    if (!rows.length || missing.length) return;
    setBusy('check'); setErr(null);
    try { setPreview(await apiFetch<Preview>('/pos/import-sales/preview', { method: 'POST', token, body: { rows, staffMap: map } })); }
    catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(''); }
  }

  const unanswered = (preview?.unknownStaff ?? []).filter((u) => !(u.key in staffMap));
  async function run() {
    if (!preview || unanswered.length || busy) return;
    setBusy('import'); setErr(null);
    try {
      const r = await apiFetch<Done>('/pos/import-sales', { method: 'POST', token, body: { rows, staffMap, label } });
      setDone(r); loadBatches(); onDone?.();
      if (mode === 'grid' && r.failed === 0) { setGridRowsState([]); saveDraft(draftScope, []); }
    } catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(''); }
  }
  async function undo(b: Batch) {
    if (!window.confirm(L(`Xoá ${b.tickets} bill của lần nhập này khỏi doanh thu và bảng lương?`, `Remove this import's ${b.tickets} bills from sales and payroll?`))) return;
    setBusy('undo'); setErr(null);
    try { await apiFetch(`/pos/import-sales/${b.batch}`, { method: 'DELETE', token }); loadBatches(); onDone?.(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'error'); }
    finally { setBusy(''); }
  }

  const reason = (r: string) => ({
    date: L('ngày không đọc được', 'unreadable date'),
    future: L('ngày trong tương lai', 'date in the future'),
    'payroll-closed': L('thuộc kỳ lương đã chốt', 'inside a closed payroll'),
    amount: L('số tiền không hợp lệ (hoặc âm)', 'invalid (or negative) amount'),
    tip: L('tip không hợp lệ', 'invalid tip'),
    empty: L('không có số tiền', 'no amount'),
  } as Record<string, string>)[r] ?? r;
  const known = uiMarket();
  const market: 'VN' | 'US' = preview ? (preview.currency === 'VND' ? 'VN' : 'US') : known ? (known === 'VN' ? 'VN' : 'US') : vi ? 'VN' : 'US';
  const tab = (on: boolean): CSSProperties => ({ background: on ? 'var(--c1e293b)' : 'none', border: '1px solid var(--line)', color: on ? 'var(--ink-link)' : 'var(--c94a3b8)', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: on ? 700 : 500 });
  const col = (f: SaleField) => (mapping ? mapping[f] : -1);
  const th: CSSProperties = { textAlign: 'left', padding: '6px 8px', color: 'var(--c94a3b8)', borderBottom: '1px solid var(--c334155)', whiteSpace: 'nowrap', fontWeight: 600 };
  const td: CSSProperties = { padding: '6px 8px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...ui.card, width: '100%', maxWidth: 860, marginTop: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 18, flex: 1 }}>{L('Nhập doanh thu cũ', 'Import past sales')}</h2>
          <button type="button" onClick={onClose} aria-label={L('Đóng', 'Close')} style={{ background: 'none', border: 'none', color: 'var(--c94a3b8)', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <p style={{ margin: '0 0 12px', color: 'var(--c94a3b8)', fontSize: 13, lineHeight: 1.55 }}>
          {L('Đưa doanh thu từ phần mềm cũ hoặc sổ ghi tay vào Lumio. Mỗi dòng là một dịch vụ của một bill (cùng số bill + cùng ngày = một bill), hoặc một dòng tổng cho mỗi thợ mỗi ngày. Sau khi nhập, báo cáo bán hàng, bảng lương và trang tổng quan tính luôn các ngày này. Không trừ kho, không cộng điểm, không gửi tin cho khách.',
            'Bring sales from the old system or the paper book into Lumio. Each row is one service on a bill (same bill # + same day = one bill), or one total per technician per day. Once imported, the sales report, payroll and the dashboard include those days. No stock is deducted, no points are added, nobody is messaged.')}
        </p>

        {!done && (
          <div role="tablist" style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <button type="button" role="tab" aria-selected={mode === 'grid'} onClick={() => { setMode('grid'); setPreview(null); setErr(null); }} style={tab(mode === 'grid')}>✎ {L('Nhập trực tiếp', 'Type it in')}</button>
            <button type="button" role="tab" aria-selected={mode === 'file'} onClick={() => { setMode('file'); setPreview(null); setErr(null); }} style={tab(mode === 'file')}>⇪ {L('Từ file Excel / CSV', 'From an Excel / CSV file')}</button>
          </div>
        )}

        {mode === 'grid' && !done && (
          <div style={{ marginBottom: 12 }}>
            <SalesEntryGrid vi={vi} staff={staffList} rows={gridRows} setRows={setGridRows} market={market} />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
              <button type="button" onClick={() => check()} disabled={!rows.length || busy !== ''} style={{ ...ui.primaryBtn, opacity: rows.length ? 1 : 0.5 }}>
                {busy === 'check' ? L('Đang kiểm tra…', 'Checking…') : L(`Kiểm tra ${rows.length} dòng`, `Check ${rows.length} rows`)}
              </button>
              {!rows.length && gridRows.length > 0 && <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L('Điền số tiền cho ít nhất một dòng.', 'Fill in an amount on at least one row.')}</span>}
            </div>
          </div>
        )}

        {mode === 'file' && !done && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <label style={{ ...ui.primaryBtn, display: 'inline-block', cursor: 'pointer' }}>
              {fileName ? L('Chọn file khác', 'Choose another file') : L('Chọn file Excel / CSV', 'Choose Excel / CSV file')}
              <input type="file" accept=".xlsx,.csv,.txt,.tsv" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            {fileName && <span style={{ fontSize: 13, color: 'var(--ccbd5e1)' }}>{fileName} · {body.length} {L('dòng', 'rows')}</span>}
            <button type="button" onClick={() => download(vi ? 'lumio-nhap-doanh-thu.xlsx' : 'lumio-past-sales.xlsx', writeXlsx(saleTemplate(vi), { sheetName: L('Doanh thu', 'Sales'), widths: [12, 8, 9, 16, 14, 12, 22, 10, 12, 10, 10, 14, 10] }) as BlobPart, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--c818cf8)', cursor: 'pointer', fontSize: 13 }}>
              ⬇ {L('Tải file mẫu', 'Download template')}
            </button>
          </div>
        )}

        {err && <div style={ui.banner}>{err}</div>}

        {mode === 'file' && mapping && !done && (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, margin: '6px 0 8px' }}>{L('Cột nào là gì? (đã tự đoán — sửa nếu sai)', 'Which column is what? (guessed — fix any)')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
              {SALE_FIELDS.map((f) => (
                <label key={f.key} style={{ fontSize: 12.5 }}>
                  <span style={{ display: 'block', color: f.required && col(f.key) < 0 ? 'var(--ink-warn)' : 'var(--c94a3b8)', marginBottom: 3 }}>{vi ? f.vi : f.en}{f.required ? ' *' : ''}</span>
                  <select value={col(f.key)} onChange={(e) => { setMapping({ ...mapping, [f.key]: Number(e.target.value) }); setPreview(null); }} style={{ ...ui.input, padding: '6px 8px', fontSize: 13 }}>
                    <option value={-1}>{L('— không có —', '— none —')}</option>
                    {headers.map((h, i) => <option key={i} value={i}>{h || `#${i + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {col('staff') < 0 && <div style={{ fontSize: 12.5, color: 'var(--ink-warn)', marginTop: 8 }}>{L('Chưa chọn cột Thợ: doanh thu sẽ vào mục "chưa gán thợ" và không tính lương cho ai.', 'No Technician column: sales go to "unassigned" and count towards nobody’s pay.')}</div>}

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14 }}>
              <button type="button" onClick={() => check()} disabled={!rows.length || missing.length > 0 || busy !== ''} style={{ ...ui.primaryBtn, opacity: rows.length && !missing.length ? 1 : 0.5 }}>
                {busy === 'check' ? L('Đang kiểm tra…', 'Checking…') : L(`Kiểm tra ${rows.length} dòng`, `Check ${rows.length} rows`)}
              </button>
              {missing.length > 0 && <span style={{ fontSize: 12.5, color: 'var(--ink-warn)' }}>{L('Cần chọn cột: ', 'Map: ')}{missing.map((f) => (vi ? f.vi : f.en)).join(', ')}</span>}
            </div>
          </>
        )}

        {preview && !done && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              {[
                [L('Bill sẽ nhập', 'Bills to import'), String(preview.summary.tickets)],
                [L('Doanh thu', 'Sales'), money(preview.summary.salesCents)],
                [L('Tip', 'Tips'), money(preview.summary.tipsCents)],
                [L('Từ ngày → đến ngày', 'Days'), preview.summary.firstDay ? `${preview.summary.firstDay} → ${preview.summary.lastDay}` : '—'],
              ].map(([k, v]) => (
                <div key={k} style={{ background: 'var(--c0f172a)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 11.5, color: 'var(--c94a3b8)' }}>{k}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--cf8fafc)' }}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: 'var(--c64748b)', marginTop: 6 }}>
              {preview.dayFirst ? L('Ngày đọc theo kiểu ngày/tháng/năm.', 'Dates read as day/month/year.') : L('Ngày đọc theo kiểu tháng/ngày/năm (Mỹ).', 'Dates read as month/day/year (US).')}
              {preview.duplicates > 0 ? ` · ${preview.duplicates} ${L('bill đã nhập trước đó — bỏ qua', 'bills already imported — skipped')}` : ''}
            </div>

            {preview.unknownStaff.length > 0 && (
              <div style={{ marginTop: 14, border: '1px solid var(--ink-warn)', borderRadius: 10, padding: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-warn)', marginBottom: 8 }}>{L('Tên thợ trong file không khớp ai — chọn đúng người', 'Technician names that match nobody — pick who each one is')}</div>
                {preview.unknownStaff.map((u) => (
                  <div key={u.key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span style={{ minWidth: 140, fontSize: 13 }}><b>{u.name}</b> <span style={{ color: 'var(--c64748b)' }}>· {u.rows} {L('dòng', 'rows')}</span></span>
                    <select value={u.key in staffMap ? staffMap[u.key] : '__'} onChange={(e) => { const next = { ...staffMap, [u.key]: e.target.value }; setStaffMap(next); }} style={{ ...ui.input, padding: '6px 8px', fontSize: 13, maxWidth: 260 }}>
                      <option value="__" disabled>{L('— chọn —', '— choose —')}</option>
                      {preview.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      <option value="">{L('Để "chưa gán thợ"', 'Leave unassigned')}</option>
                    </select>
                  </div>
                ))}
                <button type="button" onClick={() => check(staffMap)} disabled={unanswered.length > 0 || busy !== ''} style={{ ...ui.primaryBtn, marginTop: 6, opacity: unanswered.length ? 0.5 : 1 }}>{L('Kiểm tra lại', 'Check again')}</button>
              </div>
            )}

            {preview.summary.byStaff.length > 0 && (
              <div style={{ overflowX: 'auto', border: '1px solid var(--c334155)', borderRadius: 8, marginTop: 14 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead><tr><th style={th}>{L('Thợ', 'Technician')}</th><th style={th}>{L('Bill', 'Bills')}</th><th style={th}>{L('Doanh thu', 'Sales')}</th><th style={th}>Tip</th></tr></thead>
                  <tbody>{preview.summary.byStaff.map((s) => (
                    <tr key={s.staffId ?? 'none'}><td style={td}>{s.staffId ? s.name : <span style={{ color: 'var(--ink-warn)' }}>{L('Chưa gán thợ', 'Unassigned')}</span>}</td><td style={td}>{s.tickets}</td><td style={td}>{money(s.salesCents)}</td><td style={td}>{money(s.tipsCents)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {preview.summary.byMonth.length > 1 && (
              <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 8 }}>
                {preview.summary.byMonth.map((m) => `${m.month}: ${m.tickets} bill · ${money(m.salesCents)}`).join('  |  ')}
              </div>
            )}

            {preview.errorCount > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: 'pointer', color: 'var(--ink-warn)', fontSize: 13 }}>{L('Dòng sẽ bỏ qua', 'Rows that will be skipped')} ({preview.errorCount}){preview.lockedRows ? ` · ${preview.lockedRows} ${L('dòng thuộc kỳ lương đã chốt', 'in a closed payroll')}` : ''}</summary>
                <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 4 }}>{preview.errors.slice(0, 60).map((e) => <div key={e.row}>{L('Dòng', 'Row')} {e.row + 1}: {reason(e.reason)}</div>)}</div>
              </details>
            )}

            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 16 }}>
              <label style={{ fontSize: 12.5, flex: '1 1 220px' }}>
                <span style={{ display: 'block', color: 'var(--c94a3b8)', marginBottom: 3 }}>{L('Ghi chú lần nhập (tuỳ chọn)', 'Label for this import (optional)')}</span>
                <input style={ui.input} value={label} maxLength={60} placeholder={L('VD: Sổ tháng 9', 'e.g. Square, Sep')} onChange={(e) => setLabel(e.target.value)} />
              </label>
              <button type="button" onClick={run} disabled={busy !== '' || unanswered.length > 0 || preview.summary.tickets === 0} style={{ ...ui.primaryBtn, opacity: unanswered.length || !preview.summary.tickets ? 0.5 : 1 }}>
                {busy === 'import' ? L('Đang nhập…', 'Importing…') : L(`Nhập ${preview.summary.tickets} bill`, `Import ${preview.summary.tickets} bills`)}
              </button>
            </div>
          </div>
        )}

        {done && (
          <div style={{ fontSize: 14, lineHeight: 1.7 }}>
            <div style={{ color: 'var(--ink-good)', fontWeight: 700 }}>✓ {L('Đã nhập xong', 'Import finished')}</div>
            <div>{L('Bill đã nhập', 'Bills imported')}: <b>{done.created}</b> · {L('Doanh thu', 'Sales')}: <b>{formatPrice(done.summary.salesCents)}</b> · Tip: <b>{formatPrice(done.summary.tipsCents)}</b></div>
            {done.duplicates > 0 && <div>{L('Bỏ qua vì đã nhập trước đó', 'Skipped as already imported')}: <b>{done.duplicates}</b></div>}
            {done.failed > 0 && <div style={{ color: 'var(--ink-bad)' }}>{L('Không ghi được', 'Could not be written')}: <b>{done.failed}</b> — {L('bấm nhập lại, những bill đã có sẽ không bị nhập trùng.', 'import again; bills already in are not duplicated.')}</div>}
            <div style={{ color: 'var(--c94a3b8)', fontSize: 13 }}>{L('Xem trong Báo cáo bán hàng và Bảng lương (chọn đúng khoảng ngày).', 'See them in the Sales report and Payroll (pick the right dates).')}</div>
            <button type="button" onClick={onClose} style={{ ...ui.primaryBtn, marginTop: 12 }}>{L('Xong', 'Done')}</button>
          </div>
        )}

        {batches.length > 0 && (
          <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{L('Các lần đã nhập', 'Past imports')}</div>
            {batches.map((b) => (
              <div key={b.batch} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5, padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
                <span style={{ flex: 1, minWidth: 200 }}>
                  <b>{b.label || b.batch}</b> · {b.tickets} bill · {formatPrice(b.totalCents)}
                  <span style={{ color: 'var(--c64748b)' }}> · {b.firstAt?.slice(0, 10)} → {b.lastAt?.slice(0, 10)}</span>
                </span>
                <button type="button" onClick={() => undo(b)} disabled={busy !== ''} style={{ background: 'none', border: '1px solid var(--line)', color: 'var(--ink-bad)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}>{L('Xoá lần nhập này', 'Remove this import')}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
