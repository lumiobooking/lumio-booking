'use client';

// A date + time picker that reads the way the salon does.
//
// <input type="datetime-local"> draws its text in the COMPUTER's language,
// not the app's: on a Windows set to Vietnamese a US salon read
// "21/10/2026 05:00 CH" in an English screen, and no attribute changes that
// (lang="en-US" is ignored by Chrome). Here the date is a button showing
// "Wed, Oct 21, 2026" (the app's own locale — lib/datetime uiLocale) that
// opens the browser's calendar, and the time is a list of "5:00 PM" slots.
//
// Same contract as the native field it replaces: value / onChange carry a
// wall-clock "YYYY-MM-DDTHH:mm" string, so callers keep their conversions.

import { useRef, type CSSProperties } from 'react';
import { uiLocale } from '../lib/datetime';
import { ui } from '../lib/ui';

const pad = (n: number) => String(n).padStart(2, '0');

export function DateTimeField({ value, onChange, style, wrapStyle, step = 15, disabled, required, ariaLabel }: {
  value: string;
  onChange: (v: string) => void;
  /** Applied to both the date button and the time list (padding, font size…). */
  style?: CSSProperties;
  /** Applied to the row that holds them. */
  wrapStyle?: CSSProperties;
  /** Minutes between the times offered. A value off the grid is kept and shown. */
  step?: number;
  disabled?: boolean;
  required?: boolean;
  ariaLabel?: string;
}) {
  const loc = uiLocale();
  const vi = loc.startsWith('vi');
  const dateRef = useRef<HTMLInputElement>(null);
  const [d = '', t0 = ''] = String(value || '').split('T');
  const t = t0.slice(0, 5);
  const today = (() => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`; })();

  const dateLabel = d
    ? new Date(`${d}T12:00:00`).toLocaleDateString(loc, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    : (vi ? 'Chọn ngày' : 'Pick a date');
  const fmtTime = (hm: string) => new Date(`2000-01-01T${hm}:00`).toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' });
  const times: string[] = [];
  for (let m = 0; m < 24 * 60; m += Math.max(1, step)) times.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
  if (t && !times.includes(t)) { times.push(t); times.sort(); }

  const openPicker = () => {
    const el = dateRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!el || disabled) return;
    try { if (el.showPicker) { el.showPicker(); return; } } catch { /* falls through */ }
    el.focus(); el.click();
  };

  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1, minWidth: 0, ...wrapStyle }}>
      <span style={{ position: 'relative', flex: '1 1 150px', minWidth: 0 }}>
        <button type="button" onClick={openPicker} disabled={disabled} aria-label={ariaLabel ? `${ariaLabel} — ${vi ? 'ngày' : 'date'}` : (vi ? 'Ngày' : 'Date')}
          style={{ ...ui.input, ...style, width: '100%', boxSizing: 'border-box', textAlign: 'left', cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 0 }}>
          {dateLabel}
        </button>
        <input ref={dateRef} type="date" tabIndex={-1} aria-hidden="true" value={d} required={required} disabled={disabled}
          onChange={(e) => { if (e.target.value) onChange(`${e.target.value}T${t || '09:00'}`); }}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, pointerEvents: 'none', border: 0, padding: 0, margin: 0 }} />
      </span>
      <select value={t} disabled={disabled} required={required} aria-label={ariaLabel ? `${ariaLabel} — ${vi ? 'giờ' : 'time'}` : (vi ? 'Giờ' : 'Time')}
        onChange={(e) => onChange(`${d || today}T${e.target.value}`)}
        style={{ ...ui.input, ...style, flex: '0 0 auto', width: 'auto', minWidth: 104, marginBottom: 0 }}>
        {!t && <option value="">{vi ? 'Giờ' : 'Time'}</option>}
        {times.map((hm) => <option key={hm} value={hm}>{fmtTime(hm)}</option>)}
      </select>
    </span>
  );
}
