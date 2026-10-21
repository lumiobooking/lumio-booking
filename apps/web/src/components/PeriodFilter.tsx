'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { dayKeyInTz, uiLocale } from '../lib/datetime';
import {
  PRESETS, canStepForward, comparePeriod, customPeriod, inPeriod, kindLabel, periodFor, rangeText, shiftPeriod,
  type CompareKind, type Period, type PeriodKind,
} from '../lib/period';

/**
 * The one period control of every money screen: Sales, Reports (all tabs),
 * By technician, Payments.
 *
 *   ‹  📅 This month · Oct 1 – 21, 2026 ▾  ›     [vs. previous period ▾]
 *
 * Named periods or a custom range, stepped with ‹ › by whole periods, and
 * what the numbers are compared with. Each screen remembers its own choice
 * on this device (a named period is recomputed for today, so "Today" is
 * always today). Dates read in the app's locale — never the browser's
 * dd/mm/yyyy.
 */

export interface PeriodState {
  period: Period;
  from: string; to: string;
  today: string;
  set: (p: Period) => void;
  compare: CompareKind;
  setCompare: (c: CompareKind) => void;
  /** The range compared against (null = none). */
  cmp: { from: string; to: string } | null;
  /** Whether an instant falls on one of the period's salon days. */
  inRange: (at?: string | null) => boolean;
}

const KEY = (k: string) => `lumio_period_${k}`;

export function usePeriod(storageKey: string, initial: PeriodKind, initialCompare: CompareKind = 'previous'): PeriodState {
  const today = dayKeyInTz(new Date());
  const [period, setPeriod] = useState<Period>(() => periodFor(initial, today));
  const [compare, setCompareState] = useState<CompareKind>(initialCompare);
  // The last choice on this device, read after mount (nothing stored = the screen's default).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY(storageKey));
      if (!raw) return;
      const v = JSON.parse(raw) as { kind?: string; from?: string; to?: string; cmp?: string };
      const day = /^\d{4}-\d{2}-\d{2}$/;
      if (v.kind && (PRESETS as string[]).includes(v.kind)) setPeriod(periodFor(v.kind as PeriodKind, today));
      else if (v.from && v.to && day.test(v.from) && day.test(v.to)) setPeriod(customPeriod(v.from, v.to > today ? today : v.to, today));
      if (v.cmp === 'previous' || v.cmp === 'lastYear' || v.cmp === 'none') setCompareState(v.cmp);
    } catch { /* storage off: the default stands */ }
  }, [storageKey, today]);
  const save = useCallback((p: Period, c: CompareKind) => {
    try { window.localStorage.setItem(KEY(storageKey), JSON.stringify({ kind: p.kind, from: p.from, to: p.to, cmp: c })); } catch { /* ignore */ }
  }, [storageKey]);
  const set = useCallback((p: Period) => { setPeriod(p); save(p, compare); }, [save, compare]);
  const setCompare = useCallback((c: CompareKind) => { setCompareState(c); save(period, c); }, [save, period]);
  const cmp = useMemo(() => comparePeriod(period, compare), [period, compare]);
  const inRange = useCallback((at?: string | null) => !!at && inPeriod(dayKeyInTz(at), period), [period]);
  return { period, from: period.from, to: period.to, today, set, compare, setCompare, cmp, inRange };
}

export function PeriodFilter({ state, vi, showCompare = false }: { state: PeriodState; vi: boolean; showCompare?: boolean }) {
  const L = (v: string, e: string) => (vi ? v : e);
  const loc = uiLocale();
  const { period, today } = state;
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  useEffect(() => { if (open) { setFrom(period.from); setTo(period.to); } }, [open, period.from, period.to]);
  const label = period.kind === 'custom' ? rangeText(period.from, period.to, loc) : `${kindLabel(period.kind, vi)} · ${rangeText(period.from, period.to, loc)}`;
  const fwd = canStepForward(period, today);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'stretch', border: '1px solid var(--c334155)', borderRadius: 10, background: 'var(--c111827)', height: 38 }}>
        <button type="button" onClick={() => state.set(shiftPeriod(period, -1, today))} aria-label={L('Kỳ trước', 'Previous period')} style={arrow}>‹</button>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="dialog" aria-expanded={open}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 12px', border: 'none', borderLeft: '1px solid var(--c334155)', borderRight: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ce2e8f0)', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
          <span aria-hidden>📅</span>{label}<span style={{ fontSize: 10, color: 'var(--c94a3b8)' }}>▾</span>
        </button>
        <button type="button" disabled={!fwd} onClick={() => state.set(shiftPeriod(period, 1, today))} aria-label={L('Kỳ sau', 'Next period')} style={{ ...arrow, opacity: fwd ? 1 : 0.35, cursor: fwd ? 'pointer' : 'default' }}>›</button>

        {open && (
          <>
            <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
            <div role="dialog" aria-label={L('Chọn kỳ', 'Pick a period')}
              style={{ position: 'absolute', top: 44, left: 0, zIndex: 61, width: 340, maxWidth: 'calc(100vw - 24px)', background: 'var(--c111827)', border: '1px solid var(--c334155)', borderRadius: 14, boxShadow: '0 18px 48px rgba(0,0,0,.3)', padding: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {PRESETS.map((k) => {
                  const on = period.kind === k;
                  return (
                    <button key={k} type="button" onClick={() => { state.set(periodFor(k, today)); setOpen(false); }}
                      style={{ padding: '8px 10px', borderRadius: 9, border: `1px solid ${on ? '#4f46e5' : 'var(--c334155)'}`, fontSize: 13, fontWeight: on ? 700 : 600, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                        background: on ? '#4f46e5' : 'transparent', color: on ? '#fff' : 'var(--ccbd5e1)' }}>
                      {kindLabel(k, vi)}
                    </button>
                  );
                })}
              </div>
              <div style={{ borderTop: '1px solid var(--c334155)', margin: '12px 0 10px' }} />
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.06em', color: 'var(--c94a3b8)', marginBottom: 6 }}>{L('KHOẢNG TUỲ CHỌN', 'CUSTOM RANGE')}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <DateBtn value={from} max={today} onChange={setFrom} loc={loc} aria={L('Từ ngày', 'From')} />
                <span style={{ color: 'var(--c94a3b8)' }}>→</span>
                <DateBtn value={to} max={today} onChange={setTo} loc={loc} aria={L('Đến ngày', 'To')} />
              </div>
              <button type="button" onClick={() => { state.set(customPeriod(from, to, today)); setOpen(false); }}
                style={{ marginTop: 10, width: '100%', height: 36, borderRadius: 9, border: 'none', background: '#4f46e5', color: '#fff', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit' }}>
                {L('Áp dụng', 'Apply')}
              </button>
            </div>
          </>
        )}
      </div>
      {showCompare && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--c94a3b8)' }}>
          <select value={state.compare} onChange={(e) => state.setCompare(e.target.value as CompareKind)}
            style={{ height: 38, padding: '0 10px', borderRadius: 10, border: '1px solid var(--c334155)', background: 'var(--c111827)', color: 'var(--ce2e8f0)', fontSize: 13, fontFamily: 'inherit' }}>
            <option value="previous">{L('So với kỳ trước', 'vs. previous period')}</option>
            <option value="lastYear">{L('So với cùng kỳ năm trước', 'vs. same period last year')}</option>
            <option value="none">{L('Không so sánh', 'No comparison')}</option>
          </select>
          {state.cmp && <span style={{ whiteSpace: 'nowrap' }}>({rangeText(state.cmp.from, state.cmp.to, loc)})</span>}
        </label>
      )}
    </div>
  );
}

/** A date reading "Oct 1, 2026" that opens the browser's own calendar. */
function DateBtn({ value, onChange, max, loc, aria }: { value: string; onChange: (v: string) => void; max: string; loc: string; aria: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const open = () => {
    const el = ref.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!el) return;
    try { if (el.showPicker) { el.showPicker(); return; } } catch { /* falls through */ }
    el.focus(); el.click();
  };
  return (
    <span style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <button type="button" onClick={open} aria-label={aria}
        style={{ width: '100%', height: 36, padding: '0 10px', borderRadius: 9, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', fontSize: 13, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
        {value ? new Date(`${value}T12:00:00Z`).toLocaleDateString(loc, { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
      </button>
      <input ref={ref} type="date" tabIndex={-1} aria-hidden="true" value={value} max={max} onChange={(e) => { if (e.target.value) onChange(e.target.value); }}
        style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none', width: '100%', height: '100%', border: 0, padding: 0, margin: 0 }} />
    </span>
  );
}

const arrow: CSSProperties = { width: 34, border: 'none', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 18, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };

/** "▲ 12%" in green / "▼ 8%" in red, or nothing to compare with. */
export function Delta({ cur, prev, vi, invert = false }: { cur: number; prev: number | null | undefined; vi: boolean; invert?: boolean }) {
  if (prev === null || prev === undefined) return null;
  if (!prev) return <span style={{ color: 'var(--c94a3b8)' }}>{vi ? 'kỳ so sánh = 0' : 'nothing to compare'}</span>;
  const p = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  const good = invert ? p <= 0 : p >= 0;
  return <span style={{ color: p === 0 ? 'var(--c94a3b8)' : good ? 'var(--ink-good)' : 'var(--ink-bad)', fontWeight: 700 }}>{p > 0 ? '▲' : p < 0 ? '▼' : '='} {Math.abs(p)}%</span>;
}
