'use client';

/**
 * NHẬP KHÁCH CŨ — bring the client list over from the old system.
 *
 * 1. Choose the CSV exported from Square / Vagaro / Fresha / … (or the sample).
 * 2. Check which column is which (guessed; change any).
 * 3. Import: sent in chunks of 500 to POST /customers/import. Existing clients
 *    (same phone or email) are completed, not duplicated; points from the old
 *    system are added once; spend, visits and last visit are kept as history.
 * SMS marketing consent is only recorded when the file says "yes" AND the
 * owner ticks the attestation — otherwise those clients get email only.
 */
import { useMemo, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ui } from '../lib/ui';
import { FIELDS, SAMPLE_CSV, detectSource, guessMapping, parseCsv, toRows, type Field, type Mapping } from '../lib/customer-import';

interface Result { created: number; updated: number; skipped: number; pointsAdded: number; pointsSkipped: number; errors: { row: number; reason: string }[] }
const CHUNK = 500;

export function CustomerImport({ vi, onClose, onDone }: { vi: boolean; onClose: () => void; onDone: () => void }) {
  const { token } = useAuth();
  const [table, setTable] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [source, setSource] = useState('CSV');
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const L = (v: string, e: string) => (vi ? v : e);

  const headers = table?.[0] ?? [];
  const body = useMemo(() => (table ? table.slice(1) : []), [table]);
  const rows = useMemo(() => (mapping ? toRows(body, mapping) : []), [body, mapping]);

  function load(text: string, name: string) {
    const t = parseCsv(text);
    if (t.length < 2) { setErr(L('File không có dòng khách nào (cần dòng tiêu đề + ít nhất 1 khách).', 'The file has no client rows (a header row plus at least one client).')); return; }
    setErr(null); setResult(null); setTable(t); setFileName(name);
    setMapping(guessMapping(t[0])); setSource(detectSource(t[0]));
  }
  async function onFile(f: File | undefined) {
    if (!f) return;
    if (!/\.(csv|txt|tsv)$/i.test(f.name)) { setErr(L('Hãy lưu file dưới dạng CSV (Excel: File → Save As → CSV).', 'Save the file as CSV (Excel: File → Save As → CSV).')); return; }
    load(await f.text(), f.name);
  }
  function downloadSample() {
    const url = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'lumio-customers-sample.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const canImport = !!mapping && rows.length > 0 && (mapping.firstName >= 0 || mapping.name >= 0 || mapping.phone >= 0 || mapping.email >= 0);

  async function run() {
    if (!canImport || busy) return;
    setBusy(true); setErr(null); setProgress(0);
    const total: Result = { created: 0, updated: 0, skipped: 0, pointsAdded: 0, pointsSkipped: 0, errors: [] };
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const r = await apiFetch<Result>('/customers/import', { method: 'POST', token, body: { rows: rows.slice(i, i + CHUNK), source, consentAttested: attest } });
        total.created += r.created; total.updated += r.updated; total.skipped += r.skipped; total.pointsAdded += r.pointsAdded; total.pointsSkipped += r.pointsSkipped;
        total.errors.push(...r.errors.map((e) => ({ ...e, row: e.row + i + 1 })));
        setProgress(Math.min(rows.length, i + CHUNK));
      }
      setResult(total);
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }

  const col = (f: Field) => (mapping ? mapping[f] : -1);
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ ...ui.card, width: '100%', maxWidth: 760, marginTop: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 18, flex: 1 }}>{L('Nhập khách từ hệ thống cũ', 'Import clients from your old system')}</h2>
          <button type="button" onClick={onClose} aria-label={L('Đóng', 'Close')} style={{ background: 'none', border: 'none', color: 'var(--c94a3b8)', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>
        <p style={{ margin: '0 0 12px', color: 'var(--c94a3b8)', fontSize: 13, lineHeight: 1.55 }}>
          {L('Xuất danh sách khách từ hệ thống cũ (Square, Vagaro, Fresha, GlossGenius…) ra file CSV rồi chọn ở đây. Khách trùng số điện thoại hoặc email sẽ được bổ sung thông tin, không tạo trùng. Điểm tích luỹ cũ được cộng một lần; tổng chi, số lần ghé và lần ghé cuối được lưu làm lịch sử để xem và chạy chương trình gọi khách quay lại.',
            'Export the client list from your old system (Square, Vagaro, Fresha, GlossGenius…) as CSV and choose it here. Clients with the same phone or email are completed, never duplicated. Old points are added once; total spent, visits and last visit are kept as history for the profile and the win-back programmes.')}
        </p>

        {!result && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <label style={{ ...ui.primaryBtn, display: 'inline-block', cursor: 'pointer' }}>
              {fileName ? L('Chọn file khác', 'Choose another file') : L('Chọn file CSV', 'Choose CSV file')}
              <input type="file" accept=".csv,.txt,.tsv,text/csv" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
            {fileName && <span style={{ fontSize: 13, color: 'var(--ccbd5e1)' }}>{fileName} · {body.length} {L('dòng', 'rows')}</span>}
            <button type="button" onClick={downloadSample} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--c818cf8)', cursor: 'pointer', fontSize: 13 }}>{L('Tải file mẫu', 'Download sample')}</button>
          </div>
        )}

        {err && <div style={ui.banner}>{err}</div>}

        {mapping && !result && (
          <>
            <div style={{ fontSize: 13, fontWeight: 600, margin: '6px 0 8px' }}>{L('Cột nào là gì? (đã tự đoán — sửa nếu sai)', 'Which column is what? (guessed — fix any)')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8 }}>
              {FIELDS.map((f) => (
                <label key={f.key} style={{ fontSize: 12.5 }}>
                  <span style={{ display: 'block', color: 'var(--c94a3b8)', marginBottom: 3 }}>{vi ? f.vi : f.en}</span>
                  <select value={col(f.key)} onChange={(e) => setMapping({ ...mapping, [f.key]: Number(e.target.value) })} style={{ ...ui.input, padding: '6px 8px', fontSize: 13 }}>
                    <option value={-1}>{L('— không có —', '— none —')}</option>
                    {headers.map((h, i) => <option key={i} value={i}>{h || `#${i + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>

            <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>{L('Xem trước', 'Preview')}</div>
            <div style={{ overflowX: 'auto', border: '1px solid var(--c334155)', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead><tr>{FIELDS.filter((f) => col(f.key) >= 0).map((f) => <th key={f.key} style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--c94a3b8)', borderBottom: '1px solid var(--c334155)', whiteSpace: 'nowrap' }}>{vi ? f.vi : f.en}</th>)}</tr></thead>
                <tbody>{rows.slice(0, 5).map((r, i) => <tr key={i}>{FIELDS.filter((f) => col(f.key) >= 0).map((f) => <td key={f.key} style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{r[f.key] ?? ''}</td>)}</tr>)}</tbody>
              </table>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 14 }}>
              <label style={{ fontSize: 12.5 }}><span style={{ display: 'block', color: 'var(--c94a3b8)', marginBottom: 3 }}>{L('Nguồn (hệ thống cũ)', 'Source (old system)')}</span>
                <input style={ui.input} value={source} maxLength={40} onChange={(e) => setSource(e.target.value)} /></label>
            </div>
            {col('smsOptIn') >= 0 && (
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, fontSize: 13, lineHeight: 1.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} style={{ marginTop: 3 }} />
                <span>{L('Tôi xác nhận những khách có "Đồng ý nhận SMS" = có trong file đã đồng ý nhận tin nhắn quảng cáo từ tiệm. (Không đánh dấu: các khách này chỉ nhận email quảng cáo; tin xác nhận/nhắc lịch vẫn gửi bình thường.)',
                  'I confirm the clients marked as SMS opt-in in this file agreed to receive marketing texts from this salon. (Unticked: they get marketing by email only; booking confirmations and reminders are unaffected.)')}</span>
              </label>
            )}

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16 }}>
              <button type="button" onClick={run} disabled={!canImport || busy} style={{ ...ui.primaryBtn, opacity: canImport ? 1 : 0.5 }}>
                {busy ? L(`Đang nhập… ${progress}/${rows.length}`, `Importing… ${progress}/${rows.length}`) : L(`Nhập ${rows.length} khách`, `Import ${rows.length} clients`)}
              </button>
              {!canImport && <span style={{ fontSize: 12.5, color: 'var(--ink-warn)' }}>{L('Cần ít nhất cột tên, số điện thoại hoặc email.', 'Map at least a name, phone or email column.')}</span>}
            </div>
          </>
        )}

        {result && (
          <div style={{ fontSize: 14, lineHeight: 1.7 }}>
            <div style={{ color: 'var(--ink-good)', fontWeight: 700 }}>✓ {L('Đã nhập xong', 'Import finished')}</div>
            <div>{L('Khách mới', 'New clients')}: <b>{result.created}</b> · {L('Đã bổ sung', 'Completed existing')}: <b>{result.updated}</b> · {L('Bỏ qua', 'Skipped')}: <b>{result.skipped}</b></div>
            <div>{L('Điểm đã cộng', 'Points added')}: <b>{result.pointsAdded}</b>{result.pointsSkipped ? ` · ${L('không cộng lại cho', 'not added again for')} ${result.pointsSkipped} ${L('khách đã nhập trước đó', 'clients imported before')}` : ''}</div>
            {result.errors.length > 0 && (
              <details style={{ marginTop: 6 }}><summary style={{ cursor: 'pointer', color: 'var(--ink-warn)' }}>{L('Dòng bị bỏ qua', 'Skipped rows')} ({result.errors.length})</summary>
                <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{result.errors.slice(0, 50).map((e) => <div key={e.row}>#{e.row}: {e.reason}</div>)}</div>
              </details>
            )}
            <button type="button" onClick={onClose} style={{ ...ui.primaryBtn, marginTop: 12 }}>{L('Xong', 'Done')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
