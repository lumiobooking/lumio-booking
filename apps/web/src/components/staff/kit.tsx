'use client';

/**
 * The technician app's own small kit: bottom sheets, a toast, icons, and the
 * few styles every staff screen shares.
 *
 * Built for how a technician holds the phone: one hand, between clients,
 * sometimes in gloves or with polish still drying. So every control here is
 * at least 48px tall, the main action of a screen sits in the bottom third
 * (where a thumb reaches without regripping), and nothing irreversible
 * happens on a single tap — it asks in a sheet, then offers an undo.
 *
 * Colours are theme tokens, so the same screens work by day (light) and by
 * night (dark) — a salon floor under bright lights is the light case.
 */

import { CSSProperties, ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export const L = (vi: boolean, viText: string, enText: string) => (vi ? viText : enText);

/** Turns can be halves (a small add-on is worth ½): 1.5 → "1½". */
export function fmtTurns(n: number): string {
  const whole = Math.floor(n + 1e-9);
  if (Math.abs(n - whole - 0.5) < 0.01) return whole ? `${whole}½` : '½';
  return String(Math.round(n * 100) / 100);
}

export function minsSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

// ---------------------------------------------------------------- icons

export const IC = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  turns: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6',
  me: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a7 7 0 0 1 16 0v1',
  check: 'M5 12l5 5 9-10',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  message: 'M4 5h16v11H8l-4 4z',
  chevron: 'M9 6l6 6-6 6',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  chair: 'M6 4v8h12V4M4 12h16v3H4zM6 15v5M18 15v5',
  money: 'M3 6h18v12H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9v.01M18 15v.01',
  star: 'M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1L3.2 9.4l6.1-.8z',
  back: 'M15 6l-6 6 6 6',
};

export function Icon({ d, size = 22, stroke = 2, color = 'currentColor', fill = 'none' }: { d: string; size?: number; stroke?: number; color?: string; fill?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      {d.split('M').filter(Boolean).map((seg, i) => <path key={i} d={'M' + seg} />)}
    </svg>
  );
}

// ---------------------------------------------------------------- styles

export const st = {
  card: { background: 'var(--c111827)', border: '1px solid var(--line)', borderRadius: 18, padding: 16 } as CSSProperties,
  label: { fontSize: 12, fontWeight: 700, color: 'var(--c94a3b8)', letterSpacing: '0.08em', textTransform: 'uppercase' } as CSSProperties,
  primary: {
    height: 52, borderRadius: 14, border: 'none', background: '#4f46e5', color: '#fff',
    fontSize: 16, fontWeight: 700, cursor: 'pointer', padding: '0 18px', whiteSpace: 'nowrap',
  } as CSSProperties,
  done: {
    height: 56, borderRadius: 16, border: 'none', background: '#15803d', color: '#fff',
    fontSize: 17, fontWeight: 800, cursor: 'pointer', padding: '0 18px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
  } as CSSProperties,
  ghost: {
    height: 48, borderRadius: 12, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ce2e8f0)',
    fontSize: 15, fontWeight: 600, cursor: 'pointer', padding: '0 14px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, textDecoration: 'none', whiteSpace: 'nowrap',
  } as CSSProperties,
};

/** Room left under a page for the tab bar (and the iPhone's home bar). */
export const TAB_H = 66;
export const BOTTOM_SAFE = 'env(safe-area-inset-bottom, 0px)';

// ---------------------------------------------------------------- sheet

/**
 * A bottom sheet: the phone's own pattern for "look closer / are you sure".
 * The sheet rises from the bottom, so its buttons land under the thumb; tap
 * the dimmed area or the handle row to close.
 */
export function Sheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open || !mounted) return null;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={label}
      style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(2,6,23,0.66)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <button type="button" aria-label="Close" onClick={onClose} style={{ flex: 1, background: 'transparent', border: 'none', cursor: 'pointer' }} />
      <div style={{
        background: 'var(--c111827)', borderTop: '1px solid var(--line)', borderRadius: '22px 22px 0 0',
        padding: `8px 16px calc(20px + ${BOTTOM_SAFE})`, maxHeight: '88dvh', overflowY: 'auto',
        width: '100%', maxWidth: 560, margin: '0 auto', boxSizing: 'border-box',
      }}>
        <button type="button" onClick={onClose} aria-label="Close"
          style={{ display: 'block', width: '100%', height: 24, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 8 }}>
          <span style={{ display: 'block', width: 40, height: 5, borderRadius: 999, background: 'var(--c334155)', margin: '0 auto' }} />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- toast

/** A short confirmation over the tab bar, with an optional undo. */
export function Toast({ text, action, onAction, raised = false }: { text: string; action?: string; onAction?: () => void; raised?: boolean }) {
  return (
    <div role="status" style={{
      position: 'fixed', left: 12, right: 12, zIndex: 250, maxWidth: 536, margin: '0 auto',
      bottom: `calc(${raised ? TAB_H + 84 : TAB_H + 12}px + ${BOTTOM_SAFE})`,
      background: '#1f2937', color: '#f8fafc', borderRadius: 14,
      padding: '6px 6px 6px 16px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 10px 28px rgba(0,0,0,0.35)', minHeight: 44,
    }}>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{text}</span>
      {action && onAction && (
        <button type="button" onClick={onAction}
          style={{ height: 44, padding: '0 14px', borderRadius: 10, border: 'none', background: '#312e81', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          {action}
        </button>
      )}
    </div>
  );
}

/** One toast at a time, gone after a few seconds (longer when it offers an undo). */
export function useToast() {
  const [toast, setToast] = useState<{ text: string; action?: string; onAction?: () => void; id: number } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), toast.action ? 7000 : 3200);
    return () => window.clearTimeout(t);
  }, [toast]);
  const show = (text: string, action?: string, onAction?: () => void) => setToast({ text, action, onAction, id: Date.now() });
  return { toast, show, clear: () => setToast(null) };
}

// ---------------------------------------------------------------- bits

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 2px 8px' }}>
      <span style={st.label}>{children}</span>
      {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
    </div>
  );
}

export function Pill({ text, tone }: { text: string; tone: 'good' | 'warn' | 'info' | 'mute' | 'bad' | 'sky' }) {
  const map = {
    good: { bg: 'var(--c052e16)', fg: 'var(--ink-good)' },
    warn: { bg: 'var(--wash-amber-2)', fg: 'var(--ink-warn)' },
    info: { bg: 'var(--c1e1b4b)', fg: 'var(--cc7d2fe)' },
    mute: { bg: 'var(--c1e293b)', fg: 'var(--c94a3b8)' },
    bad: { bg: 'var(--wash-red)', fg: 'var(--ink-bad)' },
    sky: { bg: 'var(--wash-blue)', fg: 'var(--ink-sky)' },
  }[tone];
  return (
    <span style={{ fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: map.bg, color: map.fg, whiteSpace: 'nowrap' }}>{text}</span>
  );
}
