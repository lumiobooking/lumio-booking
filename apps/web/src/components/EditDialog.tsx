'use client';

/**
 * ONE WAY TO EDIT A ROW.
 *
 * Every list used to open its editor by pushing a panel down INTO the table —
 * the row grew to a screen tall, the rows below jumped away, and on a long
 * menu the owner lost which row she was editing and what the table looked
 * like. Now an edit opens on top: a dialog centred on a desktop, a sheet that
 * rises from the bottom of a phone, the list untouched behind it. Esc or the
 * backdrop closes it; the page cannot scroll while it is open; the dialog's
 * own body scrolls. The forms inside are the same ones as before.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { useIsMobile } from '../lib/responsive';

export function EditDialog({ open, title, subtitle, onClose, children, width = 760 }: {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Desktop width in px; the sheet is always full width on a phone. */
  width?: number;
}) {
  const mobile = useIsMobile(720);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus the first field so the owner can start typing straight away.
    window.setTimeout(() => panel.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus(), 30);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(2,6,23,0.72)',
        display: 'flex', alignItems: mobile ? 'flex-end' : 'center', justifyContent: 'center',
        padding: mobile ? 0 : 16,
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        style={{
          width: mobile ? '100%' : `min(${width}px, 100%)`,
          maxHeight: mobile ? '92dvh' : '90vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--c1e293b)', border: '1px solid var(--c334155)',
          borderRadius: mobile ? '16px 16px 0 0' : 14,
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 18px 12px', borderBottom: '1px solid var(--c334155)' }}>
          {mobile && <span style={{ position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', width: 40, height: 4, borderRadius: 2, background: 'var(--c475569)' }} />}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--cf1f5f9)', lineHeight: 1.25 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12.5, color: 'var(--c94a3b8)', marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ width: 34, height: 34, borderRadius: 9, border: '1px solid var(--c334155)', background: 'var(--c0f172a)', color: 'var(--ccbd5e1)', cursor: 'pointer', fontSize: 16, flexShrink: 0 }}>✕</button>
        </div>
        <div style={{ overflowY: 'auto', padding: '14px 18px', paddingBottom: mobile ? 'max(18px, env(safe-area-inset-bottom))' : 18, WebkitOverflowScrolling: 'touch' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
