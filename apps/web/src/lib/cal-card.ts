/**
 * THE APPOINTMENT CARD, EVERYWHERE THE SAME — name, service, phone, time.
 *
 * Owners compared our calendar with the one they used before: there, every
 * block on the day said who, what, which number and from when to when; ours
 * said a start time, a source, a price, a first name and a service in grey,
 * and the phone was one tap away. The desk works from the phone number, so
 * the card now carries it, and the card is tall enough to: the hour grows,
 * and a short booking folds its lines together instead of dropping one
 * (cardTier). Mockup: canvas "Lịch — thẻ đủ thông tin".
 *
 * Pure functions plus one tiny preference hook; the cards themselves are in
 * app/salon/calendar/CalCard.tsx.
 */
import { useEffect, useState } from 'react';

/**
 * A phone number written the way people read it. Masked numbers (the
 * technician app, "••• 0142") and anything we do not recognise come back as
 * they were — a reformat must never change what a number IS.
 */
export function fmtPhone(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (s.includes('•')) return s;
  const d = s.replace(/\D/g, '');
  // North America: +1 714 555 0142 / 7145550142.
  if (d.length === 11 && d.startsWith('1') && !s.startsWith('+84')) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10 && !d.startsWith('0')) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  // Vietnam: +84 90 123 4567 → 0901 234 567.
  if (d.startsWith('84') && (d.length === 11 || d.length === 12)) { const l = `0${d.slice(2)}`; return `${l.slice(0, 4)} ${l.slice(4, 7)} ${l.slice(7)}`; }
  if (d.startsWith('0') && d.length === 10) return `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  return s;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * "11:30 – 12:30 PM", "11:30 AM – 12:30 PM", or 24-hour "11:30 – 12:30" in
 * Vietnamese. Minutes of the salon's day in, words out.
 */
export function timeRange(startMin: number, endMin: number, vi: boolean): string {
  const h = (m: number) => Math.floor(((m % 1440) + 1440) % 1440 / 60);
  const mm = (m: number) => ((m % 60) + 60) % 60;
  if (vi) return `${h(startMin)}:${pad(mm(startMin))} – ${h(endMin)}:${pad(mm(endMin))}`;
  const c = (m: number) => `${(h(m) % 12) || 12}:${pad(mm(m))}`;
  const ap = (m: number) => (h(m) < 12 ? 'AM' : 'PM');
  return ap(startMin) === ap(endMin) ? `${c(startMin)} – ${c(endMin)} ${ap(endMin)}` : `${c(startMin)} ${ap(startMin)} – ${c(endMin)} ${ap(endMin)}`;
}

/** Card text sizes: 'sm' for the desk and the phone's side-by-side columns, 'lg' for one technician on a phone. */
export type CardSize = 'sm' | 'lg';
/** Pixels each tier needs, by size (4 lines = name·price / service / phone / time·source). */
export const TIER_MIN: Record<CardSize, [number, number, number]> = { sm: [86, 64, 40], lg: [96, 72, 46] };

/**
 * How many lines a card of this height can show without text on text:
 * 4 = everything; 3 = phone and time share a line; 2 = name · service, then
 * phone · time; 1 = name · phone · service on one line. Never fewer things —
 * only fewer lines.
 */
export function cardTier(h: number, size: CardSize = 'sm'): 1 | 2 | 3 | 4 {
  const [t4, t3, t2] = TIER_MIN[size];
  return h >= t4 ? 4 : h >= t3 ? 3 : h >= t2 ? 2 : 1;
}

/** Pixels per hour, per view. The desk used 62, the phone 52 and 84 — too short for four lines. */
export const HOUR_PX = { desk: 96, phoneColumns: 120, phoneOne: 120 } as const;

/**
 * One colour per service, for "colour by service" (the look owners knew from
 * their old calendar). Dark enough for white text (≥ 4.5 : 1) in both themes,
 * and the same service always gets the same colour on every screen.
 */
export const SERVICE_PALETTE = ['#0e7490', '#c2410c', '#6d28d9', '#be185d', '#1d4ed8', '#047857', '#b45309', '#4338ca', '#9f1239', '#0f766e', '#7e22ce', '#1e40af'] as const;

export function serviceColor(key: string | null | undefined): string {
  const s = String(key ?? '');
  if (!s) return '#475569';
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return SERVICE_PALETTE[h % SERVICE_PALETTE.length];
}

export type CardColorMode = 'status' | 'service';
export const CARD_COLOR_KEY = 'lumio_cal_card_color';
const EVT = 'lumio-cal-card-color';

/** The colour mode this device shows (a per-person preference; storage may be unavailable). */
export function readCardColor(): CardColorMode {
  try { return window.localStorage.getItem(CARD_COLOR_KEY) === 'service' ? 'service' : 'status'; } catch { return 'status'; }
}

/** Every calendar on the page follows one switch. */
export function useCardColor(): [CardColorMode, (m: CardColorMode) => void] {
  const [mode, setMode] = useState<CardColorMode>('status');
  useEffect(() => {
    setMode(readCardColor());
    const on = () => setMode(readCardColor());
    window.addEventListener(EVT, on);
    window.addEventListener('storage', on);
    return () => { window.removeEventListener(EVT, on); window.removeEventListener('storage', on); };
  }, []);
  const set = (m: CardColorMode) => {
    try { window.localStorage.setItem(CARD_COLOR_KEY, m); } catch { /* the choice still applies until reload */ }
    setMode(m);
    try { window.dispatchEvent(new Event(EVT)); } catch { /* old browsers */ }
  };
  return [mode, set];
}
