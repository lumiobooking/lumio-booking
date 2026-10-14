/**
 * The facts on the salon card at the top of the booking page (option B):
 * is the shop open right now, until when, and where the Call / Directions
 * buttons go. Pure functions, so the card has no judgement left and every
 * rule here is tested.
 *
 * "Now" is the SALON's clock, never the visitor's — the same rule as
 * lib/salon-clock.ts. A visitor reading a Calgary salon's page from Vietnam
 * must still be told whether Calgary is open.
 */
import { windowsForDisplay, openingBarMode, type DayLike } from './opening-bar';

/** Minutes since midnight at the salon. No timezone → the visitor's clock (old behaviour). */
export function minutesInZone(timeZone: string | null | undefined, now: Date = new Date()): number {
  const tz = String(timeZone ?? '').trim();
  if (tz) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
      const h = Number(parts.find((p) => p.type === 'hour')?.value);
      const m = Number(parts.find((p) => p.type === 'minute')?.value);
      if (Number.isFinite(h) && Number.isFinite(m)) return (h % 24) * 60 + m;
    } catch { /* unknown zone: fall through */ }
  }
  return now.getHours() * 60 + now.getMinutes();
}

export type OpenStatus =
  | { kind: 'open'; until: number }
  | { kind: 'later'; at: number; until: number }
  | { kind: 'closedNow' }
  | { kind: 'closedToday' };

/**
 * Today's status from the hours the owner typed in. Returns null when the
 * owner switched the opening line off — the card then says nothing about hours
 * rather than contradicting that choice.
 */
export function openStatus(args: { day: DayLike | null | undefined; isDayOff?: boolean; nowMinutes: number; mode?: unknown }): OpenStatus | null {
  if (openingBarMode(args.mode) === 'off') return null;
  if (args.isDayOff) return { kind: 'closedToday' };
  const windows = windowsForDisplay(args.day);
  if (!windows.length) return { kind: 'closedToday' };
  const now = args.nowMinutes;
  const inside = windows.find((w) => now >= w.open && now < w.close);
  if (inside) return { kind: 'open', until: inside.close };
  const next = windows.find((w) => w.open > now);
  if (next) return { kind: 'later', at: next.open, until: next.close };
  return { kind: 'closedNow' };
}

/** tel: link from whatever the owner typed ("(403) 991-5868", "+1 403…"). Empty when there are no digits. */
export function telHref(phone: string | null | undefined): string {
  const raw = String(phone ?? '').trim();
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 3) return '';
  return `tel:${raw.startsWith('+') ? '+' : ''}${digits}`;
}

/** Google Maps search for the shop. The name helps Maps land on the business, not just the building. */
export function mapsHref(name: string | null | undefined, address: string | null | undefined): string {
  const a = String(address ?? '').trim();
  if (!a) return '';
  const q = [String(name ?? '').trim(), a].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** Up to two letters for a salon with no logo ("An Sen Massage" → "AS"). */
export function initialsOf(name: string | null | undefined): string {
  const words = String(name ?? '').trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  const letters = words.slice(0, 2).map((w) => Array.from(w.replace(/^[^\p{L}\p{N}]+/u, ''))[0] ?? '');
  return letters.join('').toUpperCase();
}
