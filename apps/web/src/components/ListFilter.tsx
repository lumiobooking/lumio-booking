'use client';

import { useEffect, useState } from 'react';
import { useLang, tr } from '../lib/i18n';

/**
 * Shared list filtering: a date-range bar (quick presets + two date inputs) and
 * helpers to filter a list by date and sort it newest-first. Used by every page
 * that shows a data list so the behaviour is identical everywhere.
 */

export type Preset = 'all' | '7d' | '30d' | '90d' | 'month' | 'custom';

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// openFuture: for future-oriented lists (bookings) the presets leave the END
// open so upcoming appointments still show ("from N days ago onward").
function computeRange(preset: Preset, openFuture = false): { from: string; to: string } {
  const today = isoDay(new Date());
  const end = openFuture ? '' : today;
  if (preset === 'all' || preset === 'custom') return { from: '', to: '' };
  if (preset === 'month') {
    const d = new Date();
    return { from: isoDay(new Date(d.getFullYear(), d.getMonth(), 1)), to: end };
  }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  return { from: isoDay(new Date(Date.now() - (days - 1) * 86400000)), to: end };
}

export interface DateRange {
  from: string;
  to: string;
  preset: Preset;
  applyPreset: (p: Preset) => void;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  /** True when a value's day falls inside the selected range (open-ended if a bound is blank). */
  inRange: (dateStr?: string | null) => boolean;
}

/**
 * State + logic for a date range. Default 'all' shows everything (so nothing is
 * ever hidden until the user narrows the range).
 */
export function useDateRange(initial: Preset = 'all', openFuture = false): DateRange {
  const init = computeRange(initial, openFuture);
  const [from, setFromState] = useState(init.from);
  const [to, setToState] = useState(init.to);
  const [preset, setPreset] = useState<Preset>(initial);

  const applyPreset = (p: Preset) => {
    const r = computeRange(p, openFuture);
    setFromState(r.from);
    setToState(r.to);
    setPreset(p);
  };
  // Editing a date input directly switches to "custom" (no preset highlighted).
  const setFrom = (v: string) => {
    setFromState(v);
    setPreset('custom');
  };
  const setTo = (v: string) => {
    setToState(v);
    setPreset('custom');
  };

  const inRange = (dateStr?: string | null) => {
    if (!from && !to) return true;
    if (!dateStr) return false;
    const day = isoDay(new Date(dateStr));
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  };

  return { from, to, preset, applyPreset, setFrom, setTo, inRange };
}

/** Returns a NEW array sorted newest-first by the given date accessor. */
export function sortNewest<T>(items: T[], getDate: (item: T) => string | null | undefined): T[] {
  return [...items].sort((a, b) => {
    const ta = getDate(a) ? new Date(getDate(a) as string).getTime() : 0;
    const tb = getDate(b) ? new Date(getDate(b) as string).getTime() : 0;
    return tb - ta;
  });
}

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
  { key: 'month', label: 'Month' },
];

const presetBtn = (active: boolean): React.CSSProperties => ({
  padding: '5px 11px',
  borderRadius: 6,
  border: 'none',
  background: active ? '#6366f1' : 'transparent',
  color: active ? '#fff' : '#cbd5e1',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
});

const dateInput: React.CSSProperties = {
  padding: '7px 9px',
  borderRadius: 8,
  border: '1px solid #475569',
  background: '#0f172a',
  color: '#e2e8f0',
  fontSize: 13,
  colorScheme: 'dark',
};

/** Case-insensitive substring match (true when the query is empty). */
export function matchesQuery(haystack: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystack.toLowerCase().includes(q);
}

/** A compact search box for filtering long lists. */
export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const { lang } = useLang();
  const ph = placeholder ?? tr('lf.search', lang);
  return (
    <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 340 }}>
      <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#64748b', fontSize: 13, pointerEvents: 'none' }}>🔍</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={ph}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '8px 30px 8px 30px', borderRadius: 8,
          border: '1px solid #475569', background: '#0f172a', color: '#e2e8f0', fontSize: 14, colorScheme: 'dark',
        }}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          aria-label="Clear search"
          style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 16 }}
        >
          ×
        </button>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------
 * Pagination — long lists page instead of scrolling forever. Newest is already
 * first (callers sort with sortNewest), so page 1 always shows the latest rows.
 * -------------------------------------------------------------------------- */

export interface Paged<T> {
  paged: T[];
  page: number;
  setPage: (p: number) => void;
  totalPages: number;
  total: number;
  start: number;
  end: number;
}

/**
 * Slices an already-sorted array into pages. When the underlying list shrinks
 * (e.g. the user filters/searches), the page auto-clamps back into range so the
 * view never ends up on an empty page.
 */
export function usePaged<T>(items: T[], pageSize = 20): Paged<T> {
  const [page, setPage] = useState(1);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, totalPages);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const start = (current - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  return { paged: items.slice(start, end), page: current, setPage, totalPages, total, start, end };
}

const pagerBtn = (disabled: boolean): React.CSSProperties => ({
  padding: '7px 14px',
  borderRadius: 8,
  border: '1px solid #475569',
  background: disabled ? 'transparent' : '#1e293b',
  color: disabled ? '#475569' : '#e2e8f0',
  fontSize: 13,
  fontWeight: 600,
  cursor: disabled ? 'default' : 'pointer',
});

/** Prev / page-indicator / Next bar. Renders nothing when there's only one page. */
export function Pager({ paged }: { paged: Pick<Paged<unknown>, 'page' | 'totalPages' | 'setPage' | 'total' | 'start' | 'end'> }) {
  const { page, totalPages, setPage, total, start, end } = paged;
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  if (total === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 14 }}>
      <span style={{ color: '#64748b', fontSize: 12 }}>
        {t('lf.showing').replace('{a}', String(start + 1)).replace('{b}', String(end)).replace('{n}', String(total))}
      </span>
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} style={pagerBtn(page <= 1)}>{t('lf.prev')}</button>
          <span style={{ color: '#94a3b8', fontSize: 13 }}>{t('lf.page').replace('{p}', String(page)).replace('{t}', String(totalPages))}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} style={pagerBtn(page >= totalPages)}>{t('lf.next')}</button>
        </div>
      )}
    </div>
  );
}

/** The visual date-range control. Pass it the object returned by useDateRange. */
export function DateRangeBar({ range }: { range: DateRange }) {
  const { from, to, preset, applyPreset, setFrom, setTo } = range;
  const { lang } = useLang();
  const t = (k: string) => tr(k, lang);
  const today = isoDay(new Date());
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <div style={{ display: 'flex', gap: 4, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: 3 }}>
        {PRESETS.map((p) => (
          <button key={p.key} onClick={() => applyPreset(p.key)} style={presetBtn(preset === p.key)}>
            {p.key === 'all' ? t('lf.all') : p.key === 'month' ? t('lf.month') : p.label}
          </button>
        ))}
      </div>
      <input
        type="date"
        value={from}
        max={to || today}
        onChange={(e) => setFrom(e.target.value)}
        style={dateInput}
        aria-label="From date"
      />
      <span style={{ color: '#64748b' }}>→</span>
      <input
        type="date"
        value={to}
        min={from || undefined}
        onChange={(e) => setTo(e.target.value)}
        style={dateInput}
        aria-label="To date"
      />
    </div>
  );
}
