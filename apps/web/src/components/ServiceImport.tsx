'use client';

import { useMemo, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { formatPrice } from '../lib/money';
import { ui } from '../lib/ui';
import { useIsMobile } from '../lib/responsive';
import { checkRows, parseMenuText, rowsToItems, templateCsv, templateRows, type CheckedRow } from '../lib/service-import';
import { readXlsx, writeXlsx } from '../lib/xlsx-lite';

/**
 * Import a whole menu: download the template, fill it, upload it, check, go.
 *
 * The old box only took a pasted "Name | price | minutes" list, which nobody
 * has lying around — owners keep their prices in Excel, Google Sheets, or a
 * photo on the wall. So: a real template in their language and currency,
 * a drop zone that takes .xlsx or .csv as they are, and a preview that says
 * row by row what will be created and what will be skipped BEFORE anything
 * is written. Pasting still works, including cells copied out of a sheet.
 */

const MAX_ROWS = 500; // the API's own limit
const MAX_BYTES = 3 * 1024 * 1024;

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function ServiceImport({ token, currency = 'USD', vi, existingNames, onDone }: {
  token: string;
  currency?: string;
  vi: boolean;
  existingNames: string[];
  onDone: () => void;
}) {
  const L = (v: string, e: string) => (vi ? v : e);
  const isMobile = useIsMobile();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<CheckedRow[] | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [drag, setDrag] = useState(false);
  const [readErr, setReadErr] = useState<string | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const counts = useMemo(() => {
    const r = rows ?? [];
    const fresh = r.filter((x) => x.status === 'new');
    return {
      fresh: fresh.length,
      skip: r.filter((x) => x.status === 'duplicate').length,
      bad: r.filter((x) => x.status === 'error').length,
      cats: new Set(fresh.map((x) => x.category.trim().toLowerCase()).filter(Boolean)).size,
    };
  }, [rows]);

  function takeRows(parsed: ReturnType<typeof parseMenuText>, label: string) {
    setResult(null); setReadErr(null);
    if (!parsed.length) { setRows(null); setSource(null); setReadErr(L('Không tìm thấy dịch vụ nào trong file. Dòng đầu nên là tiêu đề cột như file mẫu.', 'No services found. The first row should be the column headings, as in the template.')); return; }
    if (parsed.length > MAX_ROWS) { setRows(null); setSource(null); setReadErr(L(`File có ${parsed.length} dòng — tối đa ${MAX_ROWS} dòng mỗi lần. Hãy chia làm nhiều file.`, `The file has ${parsed.length} rows — up to ${MAX_ROWS} per import. Split it into several files.`)); return; }
    setRows(checkRows(parsed, existingNames, vi));
    setSource(label);
  }

  async function readFile(f: File) {
    setReadErr(null); setResult(null);
    if (f.size > MAX_BYTES) { setReadErr(L('File quá lớn (tối đa 3 MB).', 'File too large (3 MB max).')); return; }
    const name = f.name.toLowerCase();
    try {
      if (name.endsWith('.xls') && !name.endsWith('.xlsx')) {
        setReadErr(L('Đây là file Excel đời cũ (.xls). Mở bằng Excel rồi "Lưu thành" .xlsx hoặc .csv.', 'This is an old Excel file (.xls). Open it in Excel and "Save as" .xlsx or .csv.'));
        return;
      }
      if (name.endsWith('.xlsx')) {
        const grid = await readXlsx(await f.arrayBuffer());
        takeRows(rowsToItems(grid, currency), f.name);
        return;
      }
      takeRows(parseMenuText(await f.text(), currency), f.name);
    } catch (e) {
      setReadErr(e instanceof Error ? e.message : L('Không đọc được file.', 'Could not read the file.'));
    }
  }

  function readPaste(text: string) {
    setPaste(text);
    if (!text.trim()) { setRows(null); setSource(null); return; }
    takeRows(parseMenuText(text, currency), L('Nội dung đã dán', 'Pasted text'));
  }

  function clear() {
    setRows(null); setSource(null); setPaste(''); setReadErr(null); setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function run() {
    const items = (rows ?? []).filter((r) => r.status === 'new').map((r) => ({
      category: r.category, name: r.name, priceCents: r.priceCents, priceFrom: r.priceFrom,
      durationMinutes: r.durationMinutes,
      ...(r.description ? { description: r.description } : {}),
      ...(r.imageUrl ? { imageUrl: r.imageUrl } : {}),
    }));
    if (!items.length) return;
    setBusy(true); setResult(null);
    try {
      const r = await apiFetch<{ createdCategories: number; createdServices: number; skipped: number }>(
        '/services/import', { method: 'POST', token, body: { items } },
      );
      setResult({ ok: true, text: L(
        `✓ Đã thêm ${r.createdServices} dịch vụ, ${r.createdCategories} danh mục mới${r.skipped ? ` (${r.skipped} bỏ qua)` : ''}.`,
        `✓ Added ${r.createdServices} services and ${r.createdCategories} new categories${r.skipped ? ` (${r.skipped} skipped)` : ''}.`,
      ) });
      setTimeout(onDone, 1200);
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : L('Nhập thất bại', 'Import failed') });
    } finally { setBusy(false); }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const tpl = () => templateRows(vi, currency);
  const cols = tpl()[0];
  const shown = (rows ?? []).filter((r) => !onlyIssues || r.status !== 'new');

  const step = (n: number, title: string, sub: string) => (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
      <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 12, background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 800, display: 'grid', placeItems: 'center' }}>{n}</span>
      <div>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>{title}</div>
        <div style={{ color: 'var(--c94a3b8)', fontSize: 12.5, marginTop: 2, lineHeight: 1.45 }}>{sub}</div>
      </div>
    </div>
  );
  const pill = (text: string, color: string, border: string) => (
    <span style={{ fontSize: 12.5, fontWeight: 700, color, border: `1px solid ${border}`, borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' }}>{text}</span>
  );
  const ghostBtn = { ...ui.primaryBtn, background: 'transparent', border: '1px solid var(--c475569)', color: 'var(--ce2e8f0)' };

  return (
    <div style={{ ...ui.card, marginBottom: 16, padding: isMobile ? 14 : 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16 }}>⇪ {L('Nhập dịch vụ hàng loạt', 'Import services in bulk')}</div>
          <div style={{ color: 'var(--c94a3b8)', fontSize: 13, marginTop: 3 }}>
            {L('Từ file Excel, CSV hoặc dán từ Google Sheets. Dịch vụ đã có sẽ được giữ nguyên.', 'From an Excel or CSV file, or pasted from Google Sheets. Services you already have are left untouched.')}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1.25fr', gap: 14 }}>
        {/* ---- 1. template ---- */}
        <div style={{ border: '1px solid var(--c334155)', borderRadius: 12, padding: 14, background: 'var(--c0f172a)' }}>
          {step(1, L('Tải file mẫu', 'Download the template'), L('Điền mỗi dòng một dịch vụ. Giữ nguyên dòng tiêu đề.', 'One service per row. Keep the heading row.'))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <button type="button" style={{ ...ui.primaryBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() => download(`lumio-services-template-${stamp}.xlsx`, writeXlsx(tpl(), { sheetName: L('Dịch vụ', 'Services'), widths: [16, 30, 12, 22, 16, 44] }) as BlobPart, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}>
              ⬇ Excel (.xlsx)
            </button>
            <button type="button" style={ghostBtn}
              onClick={() => download(`lumio-services-template-${stamp}.csv`, templateCsv(vi, currency), 'text/csv;charset=utf-8')}>
              ⬇ CSV
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginBottom: 6 }}>{L('Các cột:', 'Columns:')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {cols.map((c, i) => (
              <span key={c} style={{ fontSize: 12, padding: '3px 8px', borderRadius: 6, background: 'var(--c1e293b)', border: '1px solid var(--c334155)', color: i < 3 ? 'var(--ce2e8f0)' : 'var(--c94a3b8)', fontWeight: i === 1 || i === 2 ? 700 : 500 }}>
                {c}{i === 1 || i === 2 ? ' *' : ''}
              </span>
            ))}
          </div>
          <ul style={{ margin: '10px 0 0', paddingLeft: 18, color: 'var(--c94a3b8)', fontSize: 12, lineHeight: 1.6 }}>
            <li>{L('* bắt buộc. Để trống Danh mục thì dịch vụ thuộc danh mục ở dòng trên.', '* required. A blank Category belongs to the one above it.')}</li>
            <li>{L(`Giá ghi số theo ${currency}${currency === 'VND' ? ' (vd 150000 hoặc 150.000)' : ' (e.g. 35 or 35.50)'}; thêm "+" hoặc ghi "có" ở cột Giá từ nếu là giá khởi điểm.`, `Price in ${currency} (e.g. 35 or 35.50); add "+" or write "yes" under Starting price for "from" pricing.`)}</li>
            <li>{L('Thời gian ghi số phút (45) hoặc "1h 15m"; trống = 30 phút.', 'Duration in minutes (45) or "1h 15m"; blank = 30 min.')}</li>
          </ul>
        </div>

        {/* ---- 2. upload ---- */}
        <div style={{ border: '1px solid var(--c334155)', borderRadius: 12, padding: 14, background: 'var(--c0f172a)', display: 'flex', flexDirection: 'column' }}>
          {step(2, L('Tải file đã điền lên', 'Upload your filled file'), L('Nhận .xlsx, .csv. Hoặc dán thẳng từ Excel / Google Sheets.', 'Takes .xlsx or .csv. Or paste straight from Excel / Google Sheets.'))}
          <input ref={fileRef} type="file" accept=".xlsx,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); }} />
          <button type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) void readFile(f); }}
            style={{
              flex: 1, minHeight: 130, width: '100%', borderRadius: 12, cursor: 'pointer', font: 'inherit',
              border: `2px dashed ${drag ? '#6366f1' : 'var(--c475569)'}`,
              background: drag ? 'rgba(99,102,241,.10)' : 'transparent', color: 'var(--ce2e8f0)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 16,
            }}>
            <span style={{ fontSize: 28 }}>📄</span>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{isMobile ? L('Bấm để chọn file', 'Tap to choose a file') : L('Kéo thả file vào đây hoặc bấm để chọn', 'Drop the file here or click to choose')}</span>
            <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>.xlsx · .csv · {L('tối đa', 'up to')} {MAX_ROWS} {L('dòng', 'rows')}</span>
          </button>
          <button type="button" onClick={() => setShowPaste((s) => !s)}
            style={{ background: 'none', border: 'none', color: 'var(--ink-link)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '10px 0 0', textAlign: 'left' }}>
            {showPaste ? '▾' : '▸'} {L('Hoặc dán nội dung', 'Or paste instead')}
          </button>
          {showPaste && (
            <textarea value={paste} onChange={(e) => readPaste(e.target.value)} rows={7}
              placeholder={L('Dán các ô copy từ Excel / Google Sheets (có dòng tiêu đề)\n\nhoặc kiểu nhanh:\n# Acrylic\nFull set | 55+ | 75\nFill | 40 | 45', 'Paste cells copied from Excel / Google Sheets (with the heading row)\n\nor the quick format:\n# Acrylic\nFull Set | 55+ | 75\nFill | 40 | 45')}
              style={{ marginTop: 8, width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--c475569)', background: 'var(--c111827)', color: 'var(--ce2e8f0)', fontSize: 13.5, fontFamily: 'ui-monospace, Menlo, monospace', resize: 'vertical' }} />
          )}
        </div>
      </div>

      {readErr && <div style={{ ...ui.banner, marginTop: 14, marginBottom: 0 }}>{readErr}</div>}

      {/* ---- 3. preview ---- */}
      {rows && (
        <div style={{ marginTop: 16, border: '1px solid var(--c334155)', borderRadius: 12, padding: 14 }}>
          {step(3, L('Kiểm tra rồi nhập', 'Check, then import'), L('Chưa có gì được lưu cho tới khi bấm nút bên dưới.', 'Nothing is saved until you press the button below.'))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: 'var(--c94a3b8)', marginRight: 4 }}>📎 {source}</span>
            {pill(`✓ ${counts.fresh} ${L('mới', 'new')}`, 'var(--ink-good)', '#166534')}
            {counts.cats > 0 && pill(`${counts.cats} ${L('danh mục', 'categories')}`, 'var(--c94a3b8)', 'var(--c334155)')}
            {counts.skip > 0 && pill(`↷ ${counts.skip} ${L('bỏ qua', 'skipped')}`, 'var(--ink-warn)', '#92400e')}
            {counts.bad > 0 && pill(`✗ ${counts.bad} ${L('lỗi', 'errors')}`, 'var(--ink-bad)', '#7f1d1d')}
            {(counts.skip > 0 || counts.bad > 0) && (
              <label style={{ fontSize: 12.5, color: 'var(--c94a3b8)', display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 'auto', cursor: 'pointer' }}>
                <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> {L('Chỉ xem dòng có vấn đề', 'Only rows with issues')}
              </label>
            )}
          </div>
          <div style={{ maxHeight: 340, overflow: 'auto', border: '1px solid var(--c1f2937)', borderRadius: 10 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, background: 'var(--c111827)', zIndex: 1 }}>
                  {[L('Dòng', 'Row'), L('Danh mục', 'Category'), L('Dịch vụ', 'Service'), L('Giá', 'Price'), L('Thời gian', 'Time'), L('Kết quả', 'Result')].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--c94a3b8)', fontWeight: 600, borderBottom: '1px solid var(--c334155)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={`${r.line}-${r.name}`} style={{ borderBottom: '1px solid var(--c1f2937)', background: r.status === 'error' ? 'rgba(239,68,68,.07)' : r.status === 'duplicate' ? 'rgba(245,158,11,.05)' : 'transparent' }}>
                    <td style={{ padding: '7px 10px', color: 'var(--c64748b)' }}>{r.line}</td>
                    <td style={{ padding: '7px 10px', color: 'var(--c94a3b8)' }}>{r.category || '—'}</td>
                    <td style={{ padding: '7px 10px', fontWeight: 600 }}>{r.name || <i style={{ color: 'var(--c64748b)' }}>{L('(trống)', '(blank)')}</i>}</td>
                    <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{r.status === 'error' && !r.priceCents ? '—' : `${r.priceFrom ? L('từ ', 'from ') : ''}${formatPrice(r.priceCents, currency)}`}</td>
                    <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', color: 'var(--c94a3b8)' }}>{r.durationMinutes} {L('phút', 'min')}</td>
                    <td style={{ padding: '7px 10px', whiteSpace: 'nowrap', fontWeight: 600, color: r.status === 'new' ? 'var(--ink-good)' : r.status === 'duplicate' ? 'var(--ink-warn)' : 'var(--ink-bad)' }}>
                      {r.status === 'new' ? `✓ ${L('Thêm mới', 'Will add')}` : r.note}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
            <button type="button" onClick={run} disabled={busy || counts.fresh === 0} style={{ ...ui.primaryBtn, opacity: busy || counts.fresh === 0 ? 0.55 : 1 }}>
              {busy ? L('Đang nhập…', 'Importing…') : L(`Nhập ${counts.fresh} dịch vụ`, `Import ${counts.fresh} service${counts.fresh === 1 ? '' : 's'}`)}
            </button>
            <button type="button" onClick={clear} style={ghostBtn}>{L('Chọn file khác', 'Choose another file')}</button>
            {counts.bad > 0 && !result && (
              <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L('Dòng lỗi sẽ không được nhập — sửa trong file rồi tải lên lại.', 'Rows with errors are not imported — fix them in the file and upload again.')}</span>
            )}
            {result && <span style={{ fontSize: 13.5, fontWeight: 600, color: result.ok ? 'var(--ink-good)' : 'var(--ink-bad)' }}>{result.text}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
