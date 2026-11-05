'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ui } from '../lib/ui';
import { useIsMobile } from '../lib/responsive';
import { readXlsx, writeXlsx } from '../lib/xlsx-lite';

/**
 * Import from a sheet, in three steps: download the template, upload the
 * filled file (.xlsx / .csv, or paste from Excel / Google Sheets), check the
 * preview row by row, then import. Nothing is saved before the last button.
 *
 * The same steps as the salon's service import (ServiceImport), made generic
 * for the restaurant's menu and floor plan: the caller brings the template,
 * the reader and checker, the preview columns and the import call.
 */

export type SheetStatus = 'new' | 'update' | 'same' | 'duplicate' | 'error';
export interface SheetRow { line: number; status: SheetStatus; note: string }

const MAX_BYTES = 3 * 1024 * 1024;

export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function SheetImport<R extends SheetRow>(p: {
  vi: boolean;
  title: string;
  subtitle: string;
  /** File name without extension, e.g. "lumio-menu-template". */
  templateName: string;
  sheetName: string;
  templateRows: () => string[][];
  templateCsv: () => string;
  widths?: number[];
  /** Column indexes that must be filled (shown with *). */
  required: number[];
  tips: ReactNode[];
  maxRows: number;
  /** Read + check: a grid (from .xlsx or parsed text) to the preview rows. */
  check: (grid: string[][] | null, text: string | null) => Promise<R[]>;
  headers: string[];
  cells: (r: R) => ReactNode[];
  run: (rows: R[]) => Promise<string>;
  onDone: () => void;
  pastePlaceholder: string;
  onClose?: () => void;
}) {
  const { vi } = p;
  const L = (v: string, e: string) => (vi ? v : e);
  const isMobile = useIsMobile();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<R[] | null>(null);
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
    const n = (s: SheetStatus) => r.filter((x) => x.status === s).length;
    return { fresh: n('new'), update: n('update'), same: n('same'), skip: n('duplicate'), bad: n('error') };
  }, [rows]);

  async function take(grid: string[][] | null, text: string | null, label: string) {
    setResult(null); setReadErr(null);
    const out = await p.check(grid, text);
    if (!out.length) { setRows(null); setSource(null); setReadErr(L('Không tìm thấy dòng nào. Dòng đầu nên là tiêu đề cột như file mẫu.', 'No rows found. The first row should be the column headings, as in the template.')); return; }
    if (out.length > p.maxRows) { setRows(null); setSource(null); setReadErr(L(`File có ${out.length} dòng — tối đa ${p.maxRows} dòng mỗi lần. Hãy chia làm nhiều file.`, `The file has ${out.length} rows — up to ${p.maxRows} per import. Split it into several files.`)); return; }
    setRows(out); setSource(label);
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
      if (name.endsWith('.xlsx')) { await take(await readXlsx(await f.arrayBuffer()), null, f.name); return; }
      await take(null, await f.text(), f.name);
    } catch (e) {
      setReadErr(e instanceof Error ? e.message : L('Không đọc được file.', 'Could not read the file.'));
    }
  }

  function readPaste(text: string) {
    setPaste(text);
    if (!text.trim()) { setRows(null); setSource(null); return; }
    void take(null, text, L('Nội dung đã dán', 'Pasted text'));
  }

  function clear() {
    setRows(null); setSource(null); setPaste(''); setReadErr(null); setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function run() {
    const todo = (rows ?? []).filter((r) => r.status === 'new' || r.status === 'update');
    if (!todo.length) return;
    setBusy(true); setResult(null);
    try {
      setResult({ ok: true, text: await p.run(rows ?? []) });
      setTimeout(p.onDone, 1200);
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : L('Nhập thất bại', 'Import failed') });
    } finally { setBusy(false); }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const cols = p.templateRows()[0];
  const shown = (rows ?? []).filter((r) => !onlyIssues || r.status === 'duplicate' || r.status === 'error');
  const todo = counts.fresh + counts.update;

  const step = (n: number, title: string, sub: string) => (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10 }}>
      <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 12, background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 700, display: 'grid', placeItems: 'center' }}>{n}</span>
      <div>
        <div style={{ fontWeight: 600, fontSize: 14.5 }}>{title}</div>
        <div style={{ color: 'var(--c94a3b8)', fontSize: 12.5, marginTop: 2, lineHeight: 1.45 }}>{sub}</div>
      </div>
    </div>
  );
  const pill = (text: string, color: string, border: string) => (
    <span style={{ fontSize: 12.5, fontWeight: 600, color, border: `1px solid ${border}`, borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' }}>{text}</span>
  );
  const ghostBtn = { ...ui.primaryBtn, background: 'transparent', border: '1px solid var(--c475569)', color: 'var(--ce2e8f0)' };
  const color = (s: SheetStatus) => (s === 'new' ? 'var(--ink-good)' : s === 'update' ? 'var(--ink-link)' : s === 'same' ? 'var(--c94a3b8)' : s === 'duplicate' ? 'var(--ink-warn)' : 'var(--ink-bad)');

  return (
    <div style={{ ...ui.card, marginBottom: 16, padding: isMobile ? 14 : 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>⇪ {p.title}</div>
          <div style={{ color: 'var(--c94a3b8)', fontSize: 13, marginTop: 3 }}>{p.subtitle}</div>
        </div>
        {p.onClose && <button type="button" onClick={p.onClose} aria-label={L('Đóng', 'Close')} style={{ background: 'none', border: 'none', color: 'var(--c94a3b8)', fontSize: 18, cursor: 'pointer' }}>✕</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1.2fr', gap: 14 }}>
        <div style={{ border: '1px solid var(--c334155)', borderRadius: 12, padding: 14, background: 'var(--c0f172a)' }}>
          {step(1, L('Tải file mẫu', 'Download the template'), L('Điền mỗi dòng một mục. Giữ nguyên dòng tiêu đề.', 'One item per row. Keep the heading row.'))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <button type="button" style={{ ...ui.primaryBtn, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              onClick={() => download(`${p.templateName}-${stamp}.xlsx`, writeXlsx(p.templateRows(), { sheetName: p.sheetName, widths: p.widths }) as BlobPart, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}>
              ⬇ Excel (.xlsx)
            </button>
            <button type="button" style={ghostBtn} onClick={() => download(`${p.templateName}-${stamp}.csv`, p.templateCsv(), 'text/csv;charset=utf-8')}>⬇ CSV</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--c94a3b8)', marginBottom: 6 }}>{L('Các cột:', 'Columns:')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {cols.map((c, i) => (
              <span key={c} style={{ fontSize: 12, padding: '3px 8px', borderRadius: 6, background: 'var(--c1e293b)', border: '1px solid var(--c334155)', color: p.required.includes(i) ? 'var(--ce2e8f0)' : 'var(--c94a3b8)', fontWeight: p.required.includes(i) ? 700 : 500 }}>{c}</span>
            ))}
          </div>
          <ul style={{ margin: '10px 0 0', paddingLeft: 18, color: 'var(--c94a3b8)', fontSize: 12, lineHeight: 1.6 }}>
            {p.tips.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>

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
              flex: 1, minHeight: 120, width: '100%', borderRadius: 12, cursor: 'pointer', font: 'inherit',
              border: `2px dashed ${drag ? '#6366f1' : 'var(--c475569)'}`, background: drag ? 'rgba(99,102,241,.10)' : 'transparent', color: 'var(--ce2e8f0)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 16,
            }}>
            <span style={{ fontSize: 28 }}>📄</span>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{isMobile ? L('Bấm để chọn file', 'Tap to choose a file') : L('Kéo thả file vào đây hoặc bấm để chọn', 'Drop the file here or click to choose')}</span>
            <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>.xlsx · .csv · {L('tối đa', 'up to')} {p.maxRows} {L('dòng', 'rows')}</span>
          </button>
          <button type="button" onClick={() => setShowPaste((s) => !s)}
            style={{ background: 'none', border: 'none', color: 'var(--ink-link)', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '10px 0 0', textAlign: 'left' }}>
            {showPaste ? '▾' : '▸'} {L('Hoặc dán nội dung', 'Or paste instead')}
          </button>
          {showPaste && (
            <textarea value={paste} onChange={(e) => readPaste(e.target.value)} rows={6} placeholder={p.pastePlaceholder}
              style={{ marginTop: 8, width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--c475569)', background: 'var(--c111827)', color: 'var(--ce2e8f0)', fontSize: 13.5, fontFamily: 'ui-monospace, Menlo, monospace', resize: 'vertical' }} />
          )}
        </div>
      </div>

      {readErr && <div style={{ ...ui.banner, marginTop: 14, marginBottom: 0 }}>{readErr}</div>}

      {rows && (
        <div style={{ marginTop: 16, border: '1px solid var(--c334155)', borderRadius: 12, padding: 14 }}>
          {step(3, L('Kiểm tra rồi nhập', 'Check, then import'), L('Chưa có gì được lưu cho tới khi bấm nút bên dưới.', 'Nothing is saved until you press the button below.'))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: 'var(--c94a3b8)', marginRight: 4 }}>📎 {source}</span>
            {pill(`✓ ${counts.fresh} ${L('mới', 'new')}`, 'var(--ink-good)', '#166534')}
            {counts.update > 0 && pill(`↻ ${counts.update} ${L('cập nhật', 'to update')}`, 'var(--ink-link)', 'var(--c334155)')}
            {counts.same > 0 && pill(`= ${counts.same} ${L('đã có, giữ nguyên', 'unchanged')}`, 'var(--c94a3b8)', 'var(--c334155)')}
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
                  {[L('Dòng', 'Row'), ...p.headers, L('Kết quả', 'Result')].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--c94a3b8)', fontWeight: 600, borderBottom: '1px solid var(--c334155)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={`${r.line}-${i}`} style={{ borderBottom: '1px solid var(--c1f2937)', background: r.status === 'error' ? 'rgba(239,68,68,.07)' : r.status === 'duplicate' ? 'rgba(245,158,11,.05)' : 'transparent' }}>
                    <td style={{ padding: '7px 10px', color: 'var(--c64748b)' }}>{r.line}</td>
                    {p.cells(r).map((c, j) => <td key={j} style={{ padding: '7px 10px', verticalAlign: 'top' }}>{c}</td>)}
                    <td style={{ padding: '7px 10px', fontWeight: 600, color: color(r.status), whiteSpace: 'nowrap' }}>{r.status === 'new' ? `✓ ${L('Thêm mới', 'Will add')}` : r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
            <button type="button" onClick={run} disabled={busy || todo === 0} style={{ ...ui.primaryBtn, opacity: busy || todo === 0 ? 0.55 : 1 }}>
              {busy ? L('Đang nhập…', 'Importing…') : L(`Nhập ${todo} dòng`, `Import ${todo} row${todo === 1 ? '' : 's'}`)}
            </button>
            <button type="button" onClick={clear} style={ghostBtn}>{L('Chọn file khác', 'Choose another file')}</button>
            {counts.bad > 0 && !result && <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L('Dòng lỗi sẽ không được nhập — sửa trong file rồi tải lên lại.', 'Rows with errors are not imported — fix them in the file and upload again.')}</span>}
            {result && <span style={{ fontSize: 13.5, fontWeight: 600, color: result.ok ? 'var(--ink-good)' : 'var(--ink-bad)' }}>{result.text}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
