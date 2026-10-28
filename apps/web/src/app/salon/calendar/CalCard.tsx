'use client';

/**
 * What an appointment block on the calendar says: who, what, which number,
 * from when to when — the same on the desk's technician columns, the phone's
 * columns and the phone's one-technician view (lib/cal-card.ts decides how
 * many lines fit). The block itself (drag, click, position) stays with each
 * view; this is only its face.
 */
import type { CSSProperties, ReactNode } from 'react';
import { cardInk } from '../../../lib/cal-day';
import { serviceColor, type CardColorMode, type CardSize } from '../../../lib/cal-card';

export interface CardFace {
  name: string;
  partySize?: number | null;
  price: string;
  service: string;
  /** The main service alone, and how many more lines — the wide card shows them apart. */
  serviceName?: string;
  extra?: number;
  phone: string;
  /** "11:30 – 12:30 PM" */
  range: string;
  /** "11:30" — leads the one-line card. */
  start: string;
  status: string;
  /** The service's id (or name), for colour by service. */
  serviceKey: string | null;
  paid?: boolean;
  paidTitle?: string;
  /** Where it came from (a chip), shown on the full card. */
  source?: ReactNode;
  /** "In chair", "Pending"… shown on the large card. */
  tag?: string | null;
  cancelled?: boolean;
}

/** `solid`: the card is painted in a service colour with white text (the source chip turns white on it). */
export interface CardLook { background: string; border: string; main: string; sub: string; ink: string; chip: string; solid?: boolean }

/**
 * The colours of one block. By status: the status hue mixed into the card
 * surface (opaque, so hour lines never show through text) with theme-aware
 * ink. By service: the service's own solid colour with white text — the same
 * in light and dark mode.
 */
export function cardLook(f: Pick<CardFace, 'status' | 'serviceKey' | 'cancelled'>, mode: CardColorMode, statusHue: string): CardLook {
  if (f.cancelled) {
    return { background: 'var(--c18202f)', border: '1px solid var(--c334155)', main: 'var(--c94a3b8)', sub: 'var(--c94a3b8)', ink: 'var(--c94a3b8)', chip: 'transparent' };
  }
  if (mode === 'service') {
    const c = serviceColor(f.serviceKey);
    return { background: c, border: `1px solid ${c}`, main: '#ffffff', sub: 'rgba(255,255,255,0.92)', ink: '#ffffff', chip: 'rgba(255,255,255,0.2)', solid: true };
  }
  return {
    background: `color-mix(in srgb, ${statusHue} 16%, var(--c111827))`,
    border: `1px solid color-mix(in srgb, ${statusHue} 60%, var(--c111827))`,
    main: 'var(--cf1f5f9)', sub: 'var(--ccbd5e1)', ink: cardInk(f.status), chip: `color-mix(in srgb, ${statusHue} 22%, transparent)`,
  };
}

/** Padding per tier, sized so the lines fit the heights in TIER_MIN. */
export function cardPad(tier: 1 | 2 | 3 | 4, size: CardSize): string {
  if (tier === 1) return size === 'lg' ? '0 10px' : '0 7px';
  if (tier === 2) return size === 'lg' ? '3px 10px' : '2px 7px';
  if (tier === 3) return size === 'lg' ? '6px 10px' : '5px 7px';
  return size === 'lg' ? '7px 10px' : '6px 8px';
}

const one: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 };

/** A card at least this wide reads across, in three columns (canvas board 1B). */
export const WIDE_CARD_PX = 520;

export function CardBody({ f, tier, size, look, wide, vi }: { f: CardFace; tier: 1 | 2 | 3 | 4; size: CardSize; look: CardLook; wide?: boolean; vi?: boolean }) {
  const lg = size === 'lg';
  const nameFs = lg ? 15 : 13.5;
  const subFs = lg ? 13.5 : 12;
  const timeFs = lg ? 12.5 : 11.5;
  const nameLh = lg ? '20px' : '18px';
  const subLh = lg ? '18px' : '16px';
  const strike = f.cancelled ? 'line-through' : 'none';
  const who = `${f.name}${f.partySize != null && f.partySize > 1 ? ` ×${f.partySize}` : ''}`;
  const dot = f.paid ? <span title={f.paidTitle} style={{ width: 8, height: 8, borderRadius: '50%', background: look.ink === '#ffffff' ? '#ffffff' : '#22c55e', flexShrink: 0 }} /> : null;
  const nameRow = (
    <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, width: '100%', minWidth: 0, lineHeight: nameLh }}>
      <span style={{ ...one, flex: 1, fontSize: nameFs, fontWeight: 700, color: look.main, textDecoration: strike }}>{who}</span>
      <span style={{ flexShrink: 0, fontSize: subFs, fontWeight: 700, color: look.main }}>{f.price}</span>
    </span>
  );
  const subLine = (text: string) => <span style={{ ...one, display: 'block', width: '100%', fontSize: subFs, color: look.sub, lineHeight: subLh }}>{text}</span>;
  const joined = (...parts: string[]) => parts.filter(Boolean).join(' · ');

  // One technician on the day: the column is the whole screen. A one-row card
  // left the price alone at the far right and a sea of empty card between —
  // across three columns, the price stands right after the name (board 1B).
  if (wide && tier >= 3) {
    const col: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 };
    const divider: CSSProperties = { ...col, borderLeft: `1px solid ${look.solid ? 'rgba(255,255,255,0.35)' : 'color-mix(in srgb, currentColor 18%, transparent)'}`, paddingLeft: 16, color: look.sub };
    const extra = f.extra ?? 0;
    return (
      <span style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1.1fr) minmax(200px, 1.3fr) minmax(180px, 1fr)', columnGap: 24, alignItems: 'start', width: '100%', minWidth: 0 }}>
        <span style={col}>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0, lineHeight: nameLh }}>
            <span style={{ ...one, fontSize: nameFs + 1.5, fontWeight: 700, color: look.main, textDecoration: strike }}>{who}</span>
            {f.price ? <span style={{ flexShrink: 0, fontSize: subFs + 1, fontWeight: 700, color: look.main, background: look.chip, border: `1px solid ${look.solid ? 'rgba(255,255,255,0.45)' : 'color-mix(in srgb, currentColor 22%, transparent)'}`, borderRadius: 6, padding: '0 7px' }}>{f.price}</span> : null}
            {dot}
          </span>
          {f.phone ? <span style={{ ...one, fontSize: subFs, color: look.sub, lineHeight: subLh }}>{f.phone}</span> : null}
        </span>
        <span style={divider}>
          <span style={{ ...one, fontSize: subFs + 1, fontWeight: 600, color: look.main, lineHeight: subLh }}>{f.serviceName ?? f.service}</span>
          {extra > 0 ? <span style={{ ...one, fontSize: subFs, color: look.sub, lineHeight: subLh }}>{vi ? `+${extra} dịch vụ thêm` : `+${extra} more service${extra > 1 ? 's' : ''}`}</span> : null}
        </span>
        <span style={divider}>
          <span style={{ fontSize: timeFs + 1, fontWeight: 700, color: look.ink, whiteSpace: 'nowrap', lineHeight: subLh }}>{f.range}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {f.source ? <span className={look.solid ? 'cal-src-solid' : 'cal-src-tint'} style={{ display: 'inline-flex', minWidth: 0, overflow: 'hidden' }}>{f.source}</span> : null}
            {f.tag ? <span style={{ flexShrink: 0, height: 18, padding: '0 7px', borderRadius: 999, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', background: look.chip, color: look.ink, whiteSpace: 'nowrap' }}>{f.tag}</span> : null}
          </span>
        </span>
      </span>
    );
  }

  if (tier === 1) {
    return (
      <span style={{ ...one, display: 'block', width: '100%', fontSize: lg ? 13.5 : 12, lineHeight: lg ? '20px' : '16px', color: look.main }}>
        <span style={{ fontWeight: 700, color: look.ink }}>{f.start}</span>{' '}
        <span style={{ fontWeight: 700, textDecoration: strike }}>{who}</span>
        <span style={{ color: look.sub }}>{f.phone ? ` · ${f.phone}` : ''}{f.service ? ` · ${f.service}` : ''}</span>
      </span>
    );
  }
  if (tier === 2) {
    return (
      <>
        <span style={{ ...one, display: 'block', width: '100%', fontSize: nameFs, fontWeight: 700, color: look.main, lineHeight: nameLh, textDecoration: strike }}>
          {who}{f.service ? <span style={{ fontWeight: 500, color: look.sub }}> · {f.service}</span> : null}
        </span>
        {subLine(joined(f.phone, f.range))}
      </>
    );
  }
  if (tier === 3) {
    return (
      <>
        {nameRow}
        {subLine(f.service)}
        {subLine(joined(f.phone, f.range))}
      </>
    );
  }
  return (
    <>
      {nameRow}
      {subLine(f.service)}
      {f.phone ? subLine(f.phone) : null}
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', minWidth: 0, lineHeight: nameLh }}>
        <span style={{ flexShrink: 0, fontSize: timeFs, fontWeight: 700, color: look.ink, whiteSpace: 'nowrap' }}>{f.range}</span>
        {/* The source chip keeps its brand colour on a tinted card; on a solid
            service colour it turns white, and in light mode it is darkened —
            a lilac label on a purple card could not be read (globals.css). */}
        {f.source ? <span className={look.solid ? 'cal-src-solid' : 'cal-src-tint'} style={{ display: 'inline-flex', minWidth: 0, overflow: 'hidden' }}>{f.source}</span> : null}
        {lg && f.tag ? <span style={{ flexShrink: 0, height: 18, padding: '0 7px', borderRadius: 999, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', background: look.chip, color: look.ink, whiteSpace: 'nowrap' }}>{f.tag}</span> : null}
        <span style={{ flex: 1 }} />
        {dot}
      </span>
    </>
  );
}

/** "Màu thẻ: Trạng thái | Dịch vụ" — one switch for every calendar view. */
export function CardColorSwitch({ mode, set, vi, compact }: { mode: CardColorMode; set: (m: CardColorMode) => void; vi: boolean; compact?: boolean }) {
  const btn = (m: CardColorMode, label: string) => (
    <button type="button" aria-pressed={mode === m} onClick={() => set(m)}
      style={{ height: compact ? 30 : 32, padding: '0 10px', border: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: mode === m ? 700 : 600,
        background: mode === m ? '#4f46e5' : 'transparent', color: mode === m ? '#fff' : 'var(--ccbd5e1)' }}>{label}</button>
  );
  return (
    <span role="group" aria-label={vi ? 'Màu thẻ lịch hẹn' : 'Card colour'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {!compact && <span style={{ fontSize: 12, color: 'var(--c94a3b8)' }}>{vi ? 'Màu thẻ' : 'Card colour'}</span>}
      <span style={{ display: 'inline-flex', border: '1px solid var(--c334155)', borderRadius: 8, overflow: 'hidden' }}>
        {btn('status', vi ? 'Trạng thái' : 'Status')}
        {btn('service', vi ? 'Dịch vụ' : 'Service')}
      </span>
    </span>
  );
}
