'use client';

import { useEffect, useMemo, useState } from 'react';

/** Curated IANA zones (full US coverage + Canada/Mexico + world majors). */
const GROUPS: { label: string; zones: { tz: string; name: string }[] }[] = [
  { label: 'United States', zones: [
    { tz: 'America/New_York', name: 'Eastern — New York' },
    { tz: 'America/Detroit', name: 'Eastern — Detroit' },
    { tz: 'America/Indiana/Indianapolis', name: 'Eastern — Indianapolis' },
    { tz: 'America/Chicago', name: 'Central — Chicago' },
    { tz: 'America/Denver', name: 'Mountain — Denver' },
    { tz: 'America/Phoenix', name: 'Mountain (no DST) — Phoenix' },
    { tz: 'America/Los_Angeles', name: 'Pacific — Los Angeles' },
    { tz: 'America/Anchorage', name: 'Alaska — Anchorage' },
    { tz: 'Pacific/Honolulu', name: 'Hawaii — Honolulu' },
  ]},
  { label: 'Canada', zones: [
    { tz: 'America/Toronto', name: 'Eastern — Toronto' },
    { tz: 'America/Winnipeg', name: 'Central — Winnipeg' },
    { tz: 'America/Edmonton', name: 'Mountain — Edmonton' },
    { tz: 'America/Vancouver', name: 'Pacific — Vancouver' },
    { tz: 'America/Halifax', name: 'Atlantic — Halifax' },
    { tz: 'America/St_Johns', name: 'Newfoundland — St. John’s' },
  ]},
  { label: 'Mexico', zones: [
    { tz: 'America/Mexico_City', name: 'Mexico City' },
    { tz: 'America/Cancun', name: 'Cancún' },
    { tz: 'America/Tijuana', name: 'Tijuana' },
  ]},
  { label: 'Europe', zones: [
    { tz: 'Europe/London', name: 'London' },
    { tz: 'Europe/Paris', name: 'Paris' },
    { tz: 'Europe/Berlin', name: 'Berlin' },
    { tz: 'Europe/Madrid', name: 'Madrid' },
    { tz: 'Europe/Rome', name: 'Rome' },
    { tz: 'Europe/Amsterdam', name: 'Amsterdam' },
  ]},
  { label: 'Asia', zones: [
    { tz: 'Asia/Ho_Chi_Minh', name: 'Vietnam — Ho Chi Minh' },
    { tz: 'Asia/Bangkok', name: 'Bangkok' },
    { tz: 'Asia/Singapore', name: 'Singapore' },
    { tz: 'Asia/Hong_Kong', name: 'Hong Kong' },
    { tz: 'Asia/Shanghai', name: 'China — Shanghai' },
    { tz: 'Asia/Tokyo', name: 'Tokyo' },
    { tz: 'Asia/Seoul', name: 'Seoul' },
    { tz: 'Asia/Kolkata', name: 'India — Kolkata' },
    { tz: 'Asia/Dubai', name: 'Dubai' },
  ]},
  { label: 'Australia', zones: [
    { tz: 'Australia/Sydney', name: 'Sydney' },
    { tz: 'Australia/Brisbane', name: 'Brisbane' },
    { tz: 'Australia/Perth', name: 'Perth' },
  ]},
  { label: 'Other', zones: [{ tz: 'UTC', name: 'UTC' }] },
];

function offsetLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch { return ''; }
}

function detectTz(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
}

/**
 * Friendly timezone selector. Auto-fills the device-detected zone when empty,
 * lets the salon pick any major zone, and shows the live local time so they can
 * confirm it's right. Stores the canonical IANA name (e.g. America/Chicago).
 */
export function TimezonePicker({ value, onChange, selectStyle }: { value: string; onChange: (tz: string) => void; selectStyle?: React.CSSProperties }) {
  const detected = useMemo(() => detectTz(), []);
  const [, tick] = useState(0);

  // Auto-fill the detected zone the first time when nothing is set yet.
  useEffect(() => { if (!value && detected) onChange(detected); }, [value, detected, onChange]);
  // Re-render every 30s so the "current time" stays live.
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(id); }, []);

  const known = new Set(GROUPS.flatMap((g) => g.zones.map((z) => z.tz)));
  let currentTime = '';
  try {
    if (value) currentTime = new Date().toLocaleString('en-US', { timeZone: value, weekday: 'short', hour: 'numeric', minute: '2-digit' });
  } catch { /* invalid tz */ }

  return (
    <div>
      <select value={value || ''} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
        {/* Keep a stored value visible even if it's not in the curated list. */}
        {value && !known.has(value) && <option value={value}>{value} ({offsetLabel(value)})</option>}
        {GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.zones.map((z) => (
              <option key={z.tz} value={z.tz}>{z.name} ({offsetLabel(z.tz)})</option>
            ))}
          </optgroup>
        ))}
      </select>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 6, fontSize: 12 }}>
        {currentTime && <span style={{ color: '#16a34a', fontWeight: 600 }}>Salon time now: {currentTime}</span>}
        {detected && detected !== value && (
          <button type="button" onClick={() => onChange(detected)} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: 12, padding: 0, textDecoration: 'underline' }}>
            Use detected ({detected})
          </button>
        )}
      </div>
    </div>
  );
}
