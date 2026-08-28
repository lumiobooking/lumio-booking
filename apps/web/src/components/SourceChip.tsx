'use client';

import { srcMetaOf, SourceMeta } from '../lib/booking-sources';

/**
 * The chip that answers "khách này từ đâu tới?" on every booking card.
 *
 * One component for all three calendar views, the detail sheet and the legend,
 * so Instagram is the same pink everywhere and the answer can be trusted at a
 * glance. Brand colours do the talking; the label appears wherever there is
 * room. Line icons, one stroke family — the same rule as the sidebar, and for
 * the same reason: emoji are stickers from someone else's sheet.
 */

const ICONS: Record<string, React.ReactNode> = {
  gmap: <><path d="M12 21s-6.5-5.7-6.5-10.2a6.5 6.5 0 0 1 13 0C18.5 15.3 12 21 12 21Z" /><circle cx="12" cy="10.5" r="2.3" /></>,
  facebook: <path d="M14.5 8.5H13c-.6 0-1 .4-1 1V12h2.5l-.5 2.5h-2V21h-2.8v-6.5H7V12h2.2V9.2c0-2 1.3-3.2 3.3-3.2h2v2.5Z" />,
  instagram: <><rect x="4" y="4" width="16" height="16" rx="4.5" /><circle cx="12" cy="12" r="3.4" /><circle cx="16.8" cy="7.2" r=".9" fill="currentColor" stroke="none" /></>,
  messenger: <><path d="M12 3.5c-4.7 0-8.5 3.4-8.5 7.8 0 2.5 1.2 4.7 3.1 6.1v3.1l2.9-1.6c.8.2 1.6.3 2.5.3 4.7 0 8.5-3.4 8.5-7.9S16.7 3.5 12 3.5Z" /><path d="m7.5 13 3-3 2.2 2 3.8-3.4" /></>,
  zalo: <><rect x="3.5" y="5" width="17" height="14" rx="4" /><path d="M9 10h4l-4 4h4M15.5 10v4" /></>,
  hotline: <path d="M5 4.5C5 3.7 5.7 3 6.5 3h2L10 7.5 8 9c.9 2.4 2.7 4.2 5 5l1.5-2 4.5 1.5v2c0 .8-.7 1.5-1.5 1.5C10 17 7 14 5 6.5v-2Z" />,
  website: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.4 3.8 5.3 3.8 8.5s-1.3 6.1-3.8 8.5c-2.5-2.4-3.8-5.3-3.8-8.5S9.5 5.9 12 3.5Z" /></>,
  lumiolink: <><path d="M9.5 14.5 14.5 9.5" /><path d="M11 6.5 12.8 4.7a3.8 3.8 0 0 1 5.4 5.4L16.4 12M13 17.5l-1.8 1.8a3.8 3.8 0 0 1-5.4-5.4L7.6 12" /></>,
  walkin: <><circle cx="13" cy="4.5" r="2" /><path d="M10 20.5 12 15l-2-3 1-5 4 2 3 1.5" /><path d="m12 15 3 2 1 3.5M10 9.5 7 12l-2 1" /></>,
  staff: <><path d="M4 9.5 5.5 4h13L20 9.5" /><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5.5 12v8.5h13V12M9.5 20.5v-5h5v5" /></>,
  online: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.4 3.8 5.3 3.8 8.5s-1.3 6.1-3.8 8.5c-2.5-2.4-3.8-5.3-3.8-8.5S9.5 5.9 12 3.5Z" /></>,
};

function Glyph({ k, size }: { k: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0, display: 'block' }}>
      {ICONS[k] ?? ICONS.online}
    </svg>
  );
}

/** Icon-only, for the month grid where a card is one line tall. The colour
 *  still names the channel; the tooltip spells it out. */
export function SourceDot({ b, vi }: { b: { source?: string | null; utmSource?: string | null }; vi: boolean }) {
  const m = srcMetaOf(b);
  return (
    <span title={vi ? m.labelVi : m.labelEn}
      style={{ display: 'inline-grid', placeItems: 'center', width: 15, height: 15, borderRadius: 5, flexShrink: 0, background: `${m.color}22`, color: m.color }}>
      <Glyph k={m.key} size={11} />
    </span>
  );
}

/** Icon + label, for day views, the detail sheet and the legend. */
export function SourceChip({ b, vi, meta, count, active, onClick }: {
  b?: { source?: string | null; utmSource?: string | null };
  vi: boolean;
  /** Legend mode: pass the meta directly with a count. */
  meta?: SourceMeta;
  count?: number;
  active?: boolean;
  onClick?: () => void;
}) {
  const m = meta ?? srcMetaOf(b ?? {});
  const body = (
    <>
      <Glyph k={m.key} size={12} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vi ? m.labelVi : m.labelEn}</span>
      {count != null && <b style={{ fontVariantNumeric: 'tabular-nums' }}>{count}</b>}
    </>
  );
  const style: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0,
    fontSize: 11, fontWeight: 700, lineHeight: 1,
    borderRadius: 999, padding: '4px 9px',
    background: active ? m.color : `${m.color}1c`,
    color: active ? '#fff' : m.color,
    border: `1px solid ${active ? m.color : `${m.color}55`}`,
  };
  if (onClick) {
    return <button onClick={onClick} style={{ ...style, cursor: 'pointer' }} title={vi ? 'Bấm để lọc theo nguồn này' : 'Click to filter by this source'}>{body}</button>;
  }
  return <span style={style}>{body}</span>;
}
