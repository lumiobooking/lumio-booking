'use client';

/**
 * Count the drawer note by note (500k × 12, 200k × 10 …) instead of adding it
 * up on a phone calculator. The total goes into the shift's "counted" field.
 */

import { useState, type CSSProperties } from 'react';
import { countTotal, denominationsFor } from '../lib/cash-count';

const inp: CSSProperties = { width: 64, height: 36, borderRadius: 8, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', textAlign: 'center', fontWeight: 700, fontSize: 14 };

export function CashCounter({ vi, currency, fmt, onTotal }: { vi: boolean; currency: string; fmt: (cents: number) => string; onTotal: (cents: number) => void }) {
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const notes = denominationsFor(currency);
  const total = countTotal(counts);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ alignSelf: 'flex-start', padding: '7px 12px', borderRadius: 8, border: '1px solid var(--c334155)', background: 'transparent', color: 'var(--ccbd5e1)', fontSize: 13, cursor: 'pointer' }}>
        {open ? (vi ? '▾ Ẩn đếm theo mệnh giá' : '▾ Hide note counter') : (vi ? '▸ Đếm theo mệnh giá' : '▸ Count by note')}
      </button>
      {open && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6 }}>
            {notes.map((v) => (
              <label key={v} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 10, border: '1px solid var(--line)' }}>
                <span style={{ fontWeight: 700, color: 'var(--ce2e8f0)' }}>{fmt(v)}</span>
                <input type="number" min={0} inputMode="numeric" value={counts[v] ?? ''} aria-label={`${vi ? 'Số tờ' : 'Count of'} ${fmt(v)}`}
                  onChange={(e) => { const next = { ...counts, [v]: Math.max(0, Math.round(Number(e.target.value) || 0)) }; setCounts(next); onTotal(countTotal(next)); }} style={inp} />
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, color: 'var(--ce2e8f0)' }}><span>{vi ? 'Tổng đếm được' : 'Counted'}</span><span>{fmt(total)}</span></div>
        </>
      )}
    </div>
  );
}
