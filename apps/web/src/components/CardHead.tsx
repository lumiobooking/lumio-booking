'use client';

/**
 * One heading style for every card on the content screen.
 *
 * The three SEO-shaped tabs were built weeks apart, and each grew its own
 * heading: 15px here, 14.5px there, a subtitle in one grey on one card and a
 * different grey on the next. None of it is wrong on its own, and together it
 * reads as three screens stapled together rather than one product.
 *
 * `alsoIn` exists for a specific, honest reason. The same keyword list and the
 * same five local-SEO checks genuinely appear on more than one tab, because
 * each tab asks a different question of them. Saying so on the card is the
 * difference between a person thinking "I've seen this, which one is current?"
 * and knowing there is one list shown in two places.
 */

import type { ReactNode } from 'react';

export function CardHead({
  icon, title, note, alsoIn, right,
}: {
  icon?: string;
  title: string;
  note?: string;
  /** Where the same material also appears, named as the person sees it. */
  alsoIn?: string;
  right?: ReactNode;
}) {
  return (
    <div style={{ marginBottom: note || alsoIn ? 12 : 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ce2e8f0)', lineHeight: 1.35, minWidth: 0 }}>
          {icon ? <span style={{ marginRight: 7 }}>{icon}</span> : null}{title}
        </div>
        {right}
      </div>
      {note && (
        <div style={{ fontSize: 12.5, color: 'var(--c64748b)', lineHeight: 1.6, marginTop: 4 }}>{note}</div>
      )}
      {alsoIn && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 7,
          fontSize: 11, color: 'var(--c94a3b8)',
          background: 'var(--c0f172a)', border: '1px solid var(--c334155)',
          borderRadius: 20, padding: '2px 9px',
        }}>
          <span style={{ opacity: 0.7 }}>↔</span> Cùng dữ liệu với tab {alsoIn}
        </div>
      )}
    </div>
  );
}
