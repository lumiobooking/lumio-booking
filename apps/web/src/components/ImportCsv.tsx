'use client';

import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { ui } from '../lib/ui';

// Minimal CSV parser (handles quoted fields and escaped quotes).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cells: string[] = [];
    let cur = '', q = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (q) {
        if (c === '"') { if (raw[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { cells.push(cur); cur = ''; }
      else cur += c;
    }
    cells.push(cur);
    rows.push(cells.map((s) => s.trim()));
  }
  return rows;
}

// Reusable "Import from CSV" panel: pick a .csv file or paste rows, then bulk-
// create via the given endpoint. Skips rows whose name already exists.
export function ImportCsv({ token, endpoint, header, sample, existing, buildBody, onDone }: {
  token: string | null;
  endpoint: string;
  header: string;
  sample: string;
  existing: () => Set<string>;
  buildBody: (cols: string[]) => Record<string, unknown> | null;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true); setMsg(null);
    try {
      const rows = parseCsv(text);
      const h0 = header.split(',')[0].trim().toLowerCase();
      const data = rows.filter((r, i) => !(i === 0 && (r[0] || '').toLowerCase() === h0));
      const have = existing();
      let made = 0, skipped = 0, failed = 0;
      for (const r of data) {
        const body = buildBody(r);
        const nm = body && body.name ? String(body.name) : '';
        if (!nm) { failed++; continue; }
        if (have.has(nm.toLowerCase())) { skipped++; continue; }
        try { await apiFetch(endpoint, { method: 'POST', token, body: body as Record<string, unknown> }); made++; have.add(nm.toLowerCase()); }
        catch { failed++; }
      }
      setMsg(`Imported ${made} · skipped ${skipped}${failed ? ` · failed ${failed}` : ''}`);
      onDone();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Import failed'); }
    finally { setBusy(false); }
  }

  const rowCount = text.split(/\r?\n/).filter((l) => l.trim()).length;
  const ghost: React.CSSProperties = { padding: '7px 12px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#cbd5e1', fontSize: 13, cursor: 'pointer' };

  return (
    <div style={{ marginBottom: 14 }}>
      <button onClick={() => setOpen(!open)} style={ghost}>{open ? '✕ Close import' : '⭳ Import CSV'}</button>
      {open && (
        <div style={{ ...ui.card, marginTop: 8 }}>
          <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>Columns: <code style={{ color: '#cbd5e1' }}>{header}</code> — choose a .csv file, or paste rows, or Load sample.</div>
          <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then(setText); }} style={{ fontSize: 13, marginBottom: 8, color: '#cbd5e1' }} />
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={header + '\n…'} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace', fontSize: 12, padding: 8, borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#e2e8f0' }} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <button onClick={run} disabled={busy || !text.trim()} style={ui.primaryBtn}>{busy ? 'Importing…' : `Import ${rowCount} row${rowCount === 1 ? '' : 's'}`}</button>
            <button onClick={() => setText(sample)} style={ghost}>Load sample</button>
            {msg && <span style={{ fontSize: 13, color: '#a7f3d0' }}>{msg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
