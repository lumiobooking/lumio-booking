/**
 * What the badge at the top of a booking page is allowed to say.
 *
 * WHY THE OLD BADGE WAS WITHDRAWN AS THE DEFAULT
 *
 * "Next opening today at 2:00 PM" was computed from business hours alone. The
 * component that drew it received rules, services and a timezone — no
 * appointments, no staff, no availability of any kind. So the sentence never
 * meant what it says. It meant "the salon's hours say it is open at 2:00 PM and
 * that is past the minimum lead time". A salon booked solid all day still
 * announced 2:00 PM, and the customer found out one click later.
 *
 * It also quoted the SHORTEST service on the menu, because that is what fits
 * earliest — so the time could be unreachable for the service the customer
 * actually wanted. The best case, presented as the answer.
 *
 * 'hours' says something the owner typed in themselves. It cannot be wrong, it
 * still answers "can I come today?", and it does not tell every visitor the
 * shop is empty.
 */

export type OpeningBarMode = 'hours' | 'soonest' | 'off';

/** Anything unrecognised — an older salon row, a typo, a rolled-back value —
 *  reads as 'hours', the mode that cannot make a false claim. */
export function openingBarMode(raw: unknown): OpeningBarMode {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'soonest' || v === 'off' ? v : 'hours';
}

export interface DayLike {
  closed?: boolean;
  openMinutes?: number;
  closeMinutes?: number;
  intervals?: { open: number; close: number }[] | null;
}

/**
 * The open windows for one day, in minutes from midnight.
 *
 * Mirrors the server's windowsForDay (apps/api/src/settings/business-hours.ts)
 * on purpose: a badge that disagrees with the rule the booking endpoint
 * enforces is worse than no badge, because it teaches customers to distrust
 * both. Split shifts win over the single span; a window that closes before it
 * opens is treated as closed rather than as all day.
 */
export function windowsForDisplay(day: DayLike | null | undefined): { open: number; close: number }[] {
  if (!day || day.closed) return [];
  const ivs = Array.isArray(day.intervals) ? day.intervals : [];
  const clean = ivs
    .map((iv) => ({ open: Math.round(Number(iv?.open)), close: Math.round(Number(iv?.close)) }))
    .filter((iv) => Number.isFinite(iv.open) && Number.isFinite(iv.close) && iv.close > iv.open);
  if (clean.length) return clean.sort((a, b) => a.open - b.open);

  const open = Math.round(Number(day.openMinutes));
  const close = Math.round(Number(day.closeMinutes));
  if (!Number.isFinite(open) || !Number.isFinite(close) || close <= open) return [];
  return [{ open, close }];
}

/**
 * What to draw, decided in one place so the component has no judgement left.
 *
 * `closed` is returned rather than `off` when the salon is shut today: an empty
 * space says nothing, whereas "Closed today" is the answer the visitor came
 * for, and saves them hunting through a date picker to discover it.
 */
export type OpeningBarPlan =
  | { kind: 'off' }
  | { kind: 'closed' }
  | { kind: 'hours'; windows: { open: number; close: number }[] }
  | { kind: 'soonest' };

export function planOpeningBar(args: {
  mode: unknown;
  day: DayLike | null | undefined;
  isDayOff?: boolean;
}): OpeningBarPlan {
  const mode = openingBarMode(args.mode);
  if (mode === 'off') return { kind: 'off' };
  if (mode === 'soonest') return { kind: 'soonest' };

  // A holiday in Days off outranks the weekly pattern — the salon can be
  // "normally open Thursday" and still shut on this particular Thursday.
  if (args.isDayOff) return { kind: 'closed' };
  const windows = windowsForDisplay(args.day);
  return windows.length ? { kind: 'hours', windows } : { kind: 'closed' };
}
