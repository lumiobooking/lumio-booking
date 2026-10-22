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

/**
 * The next day the shop opens, counting from tomorrow, on the salon's calendar.
 * "Closed now" alone reads as "you can't book here"; "Opens tomorrow at 9:00"
 * tells the visitor the truth and keeps them booking. Days off are skipped.
 * `today` is the salon's date at local midnight (lib/salon-clock todayInZone).
 */
export function nextOpening(args: {
  week: (DayLike | null | undefined)[];
  daysOff?: string[];
  today: Date;
  maxDays?: number;
}): { inDays: number; at: number; date: Date } | null {
  const off = new Set(args.daysOff ?? []);
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  for (let i = 1; i <= (args.maxDays ?? 14); i++) {
    const d = new Date(args.today.getFullYear(), args.today.getMonth(), args.today.getDate() + i);
    if (off.has(key(d))) continue;
    const w = windowsForDisplay(args.week[d.getDay()]);
    if (w.length) return { inDays: i, at: w[0].open, date: d };
  }
  return null;
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

// ---------------------------------------------------------------- where the page is open

/**
 * In-app browsers — Facebook, Messenger, Instagram, TikTok, Zalo, LINE,
 * Snapchat, Pinterest, an Android WebView. Most of our visitors arrive in one
 * (the booking link is sent in Messenger, posted on Instagram and TikTok), and
 * in them a new tab is often swallowed, the share sheet does not exist and the
 * clipboard can refuse — which is why "Directions / Share do nothing" was
 * reported by customers while the owner, in Safari or Chrome, saw them work.
 */
export function isInAppBrowser(ua: string | null | undefined): boolean {
  return /FBAN|FBAV|FB_IAB|FBIOS|Messenger|Orca-Android|Instagram|musical_ly|TikTok|BytedanceWebview|Line\/|Zalo|Snapchat|Pinterest|KAKAOTALK|GSA\/|; wv\)/i.test(String(ua ?? ''));
}

/**
 * How Directions opens. Inside an embed (a salon's own website) it must be a
 * new tab — Google Maps refuses to load inside someone else's frame. Inside an
 * in-app browser it is the same tab, the one thing every one of them follows.
 */
export function mapsTarget(env: { framed: boolean; inApp: boolean }): '_blank' | '_self' {
  if (env.framed) return '_blank';
  return env.inApp ? '_self' : '_blank';
}

/** A text message carrying the link — the share that works everywhere (iOS and Android read `sms:?&body=`). */
export function smsShareHref(name: string | null | undefined, url: string): string {
  const n = String(name ?? '').trim();
  return `sms:?&body=${encodeURIComponent(n ? `${n} — ${url}` : url)}`;
}

/** The number a person reads: (403) 555-0123 for North America, otherwise as the salon typed it. */
export function prettyPhone(phone: string | null | undefined): string {
  const raw = String(phone ?? '').trim();
  const d = raw.replace(/[^\d]/g, '');
  const us = d.length === 11 && d.startsWith('1') ? d.slice(1) : d.length === 10 && !raw.startsWith('+') ? d : null;
  return us ? `(${us.slice(0, 3)}) ${us.slice(3, 6)}-${us.slice(6)}` : raw;
}
