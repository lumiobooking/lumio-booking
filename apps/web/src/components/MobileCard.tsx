'use client';

import { ReactNode } from 'react';
import { ui } from '../lib/ui';

/**
 * Primitives for replacing a dense data TABLE with stacked "cards" on phones.
 * A table row becomes one MCard with a bold MHead (primary value + optional
 * badge on the right), several "Label: value" MRows, and an MActions button row.
 * Desktop keeps the real table; pages render `isMobile ? <MList>…</MList> : <table>`.
 */
export function MList({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>{children}</div>;
}

export function MCard({ children }: { children: ReactNode }) {
  return (
    <div style={{ ...ui.card, padding: 12, marginBottom: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
      {children}
    </div>
  );
}

export function MHead({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
      <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 15, minWidth: 0, wordBreak: 'break-word' }}>{children}</div>
      {right != null && <div style={{ flexShrink: 0, textAlign: 'right' }}>{right}</div>}
    </div>
  );
}

export function MRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, alignItems: 'baseline' }}>
      <span style={{ color: '#94a3b8', flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#e2e8f0', textAlign: 'right', minWidth: 0, wordBreak: 'break-word' }}>{children}</span>
    </div>
  );
}

export function MActions({ children }: { children: ReactNode }) {
  return <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>{children}</div>;
}
