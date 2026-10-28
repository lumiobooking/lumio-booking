'use client';

/**
 * Small pieces shared by the AI brain screens (/salon/ai): the sub-tabs that
 * split a long section into pages, the on/off switch, the search box and the
 * pager bar. Same look in every section, light and dark.
 */
import type { CSSProperties, ReactNode } from 'react';

export const L = (vi: boolean, v: string, e: string) => (vi ? v : e);

export interface SubTab<T extends string> { id: T; label: string; count?: number; tone?: 'warn' }

/** A section's pages: "Lời dặn · 10 | AI chưa biết · 41". Each opens its own short list instead of one endless page. */
export function SubTabs<T extends string>({ tabs, value, onChange, label }: { tabs: SubTab<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', overflowX: 'auto', scrollbarWidth: 'none' }}>
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '0 14px', border: 0, background: 'transparent', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 14, fontWeight: on ? 800 : 600, color: on ? 'var(--ce2e8f0)' : 'var(--c94a3b8)', whiteSpace: 'nowrap',
              borderBottom: on ? '3px solid #4f46e5' : '3px solid transparent', marginBottom: -1,
            }}>
            {t.label}
            {typeof t.count === 'number' && (
              <span style={{
                minWidth: 22, height: 22, padding: '0 7px', boxSizing: 'border-box', borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 800,
                background: t.tone === 'warn' && t.count > 0 ? 'var(--wash-amber-3)' : on ? 'var(--wash-blue)' : 'var(--c1e293b)',
                color: t.tone === 'warn' && t.count > 0 ? 'var(--ink-warn)' : on ? 'var(--ink-link)' : 'var(--c94a3b8)',
                border: '1px solid var(--line)',
              }}>{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onChange}
      style={{ width: 44, height: 26, minHeight: 26, flexShrink: 0, borderRadius: 999, border: 0, background: on ? '#4f46e5' : 'var(--ink-faint)', position: 'relative', padding: 0, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 999, background: '#fff', transition: 'left .15s' }} />
    </button>
  );
}

export function Search({ id, value, onChange, placeholder, label }: { id: string; value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 0 }}>
      <label htmlFor={id} style={srOnly}>{label}</label>
      <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--c94a3b8)' }}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <input id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: '100%', boxSizing: 'border-box', minHeight: 42, padding: '0 12px 0 36px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'var(--c0f172a)', color: 'var(--ce2e8f0)', fontSize: 14, fontFamily: 'inherit' }} />
    </div>
  );
}

/** "1–8 / 41 · ‹ 1 2 3 4 5 6 ›" — numbered pages, so the owner can jump, not only step. */
export function PageBar({ page, pages, setPage, start, end, total, vi }: { page: number; pages: number; setPage: (p: number) => void; start: number; end: number; total: number; vi: boolean }) {
  if (total === 0) return null;
  const nums: (number | '…')[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  const btn = (on: boolean, disabled = false): CSSProperties => ({
    minWidth: 36, height: 36, padding: '0 10px', borderRadius: 9, cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: on ? 800 : 600,
    border: on ? '1px solid #4f46e5' : '1px solid var(--line-strong)', background: on ? '#4f46e5' : 'transparent', color: on ? '#fff' : disabled ? 'var(--ink-faint)' : 'var(--ce2e8f0)',
  });
  return (
    <nav aria-label={L(vi, 'Trang', 'Pages')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
      <span style={{ fontSize: 12.5, color: 'var(--c94a3b8)' }}>{L(vi, `${start + 1}–${end} trong ${total}`, `${start + 1}–${end} of ${total}`)}</span>
      {pages > 1 && (
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button type="button" aria-label={L(vi, 'Trang trước', 'Previous page')} disabled={page <= 1} onClick={() => setPage(page - 1)} style={btn(false, page <= 1)}>‹</button>
          {nums.map((n, i) => n === '…'
            ? <span key={`d${i}`} aria-hidden style={{ color: 'var(--c94a3b8)', padding: '0 2px' }}>…</span>
            : <button key={n} type="button" aria-current={n === page ? 'page' : undefined} onClick={() => setPage(n)} style={btn(n === page)}>{n}</button>)}
          <button type="button" aria-label={L(vi, 'Trang sau', 'Next page')} disabled={page >= pages} onClick={() => setPage(page + 1)} style={btn(false, page >= pages)}>›</button>
        </span>
      )}
    </nav>
  );
}

export const srOnly: CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' };

export const ghostBtn: CSSProperties = {
  minHeight: 38, padding: '0 14px', borderRadius: 9, border: '1px solid var(--line-strong)', background: 'transparent',
  color: 'var(--ce2e8f0)', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
};
export const primaryBtn: CSSProperties = {
  minHeight: 40, padding: '0 16px', borderRadius: 9, border: 0, background: '#4f46e5', color: '#fff',
  fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
};

/** An empty list, said plainly. */
export function Empty({ children }: { children: ReactNode }) {
  return <div style={{ padding: '28px 16px', textAlign: 'center', fontSize: 14, color: 'var(--c94a3b8)', lineHeight: 1.6, border: '1px dashed var(--line-strong)', borderRadius: 12 }}>{children}</div>;
}
