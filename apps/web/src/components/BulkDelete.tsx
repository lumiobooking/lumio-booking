'use client';

/**
 * Shared "tick rows → delete many" behaviour for every admin list.
 *
 * Every list page keeps its own single-row Delete button; this adds a checkbox
 * column, a select-all box in the header and a bar that appears only when
 * something is ticked. Deletes run one by one (so a row protected by the API
 * can fail on its own without killing the rest) and the page reloads once.
 */

import { useEffect, useMemo, useState } from 'react';
import { useLang, tr } from '../lib/i18n';

export function useBulkSelect(ids: string[]) {
  const [sel, setSel] = useState<string[]>([]);
  const key = ids.join(',');

  // Drop ids that disappeared (deleted, filtered out, page changed).
  useEffect(() => {
    setSel((prev) => {
      const next = prev.filter((id) => ids.includes(id));
      return next.length === prev.length ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const has = (id: string) => sel.includes(id);
  const toggle = (id: string) => setSel((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const allOn = useMemo(() => ids.length > 0 && ids.every((id) => sel.includes(id)), [key, sel]);
  const toggleAll = () => setSel(allOn ? [] : ids);
  const clear = () => setSel([]);

  return { sel, has, toggle, allOn, toggleAll, clear, count: sel.length };
}

const box: React.CSSProperties = { width: 16, height: 16, cursor: 'pointer', accentColor: '#6366f1' };

/** Checkbox for the table header — ticks/unticks every visible row. */
export function BulkAllBox({ on, onChange }: { on: boolean; onChange: () => void }) {
  const { lang } = useLang();
  return (
    <input
      type="checkbox"
      checked={on}
      onChange={onChange}
      title={tr(on ? 'bulk.clear' : 'bulk.selectAll', lang)}
      style={box}
    />
  );
}

/** Checkbox for one row. */
export function BulkRowBox({ on, onChange }: { on: boolean; onChange: () => void }) {
  return <input type="checkbox" checked={on} onChange={onChange} style={box} onClick={(e) => e.stopPropagation()} />;
}

/**
 * Bar shown above a list while rows are ticked. `onDelete` receives the ids and
 * must delete them; it should NOT ask for confirmation (this component does).
 */
export function BulkBar({
  count,
  ids,
  onDelete,
  onClear,
  noun,
}: {
  count: number;
  ids: string[];
  onDelete: (ids: string[]) => Promise<{ failed: number } | void>;
  onClear: () => void;
  noun?: string;
}) {
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (count === 0) return null;

  async function run() {
    const what = noun ? `${count} ${noun}` : String(count);
    if (!confirm(t('bulk.confirm').replace('{n}', what))) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await onDelete(ids);
      const failed = r && typeof r.failed === 'number' ? r.failed : 0;
      if (failed > 0) setMsg(t('bulk.someFailed').replace('{n}', String(failed)));
      else onClear();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '8px 12px', marginBottom: 10, borderRadius: 10,
        background: 'var(--c1e1b4b)', border: '1px solid #4338ca',
      }}
    >
      <span style={{ fontSize: 13, color: 'var(--cc7d2fe)', fontWeight: 600 }}>
        {t('bulk.selected').replace('{n}', String(count))}
      </span>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        style={{
          fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8,
          border: '1px solid #b91c1c', background: busy ? 'var(--c7f1d1d)' : '#dc2626',
          color: '#fff', cursor: busy ? 'default' : 'pointer',
        }}
      >
        {busy ? t('bulk.deleting') : t('bulk.deleteSelected')}
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={busy}
        style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--c94a3b8)', cursor: 'pointer' }}
      >
        {t('bulk.clear')}
      </button>
      {msg && <span style={{ fontSize: 12, color: 'var(--cfca5a5)' }}>{msg}</span>}
    </div>
  );
}

/**
 * Runs one delete per id, never stopping on the first error, then reloads once.
 * Returns how many failed so the bar can say so instead of lying.
 */
export async function runBulkDelete(ids: string[], del: (id: string) => Promise<unknown>, reload?: () => Promise<unknown> | unknown) {
  let failed = 0;
  for (const id of ids) {
    try {
      await del(id);
    } catch {
      failed += 1;
    }
  }
  if (reload) await reload();
  return { failed };
}
