/**
 * What the server-rendered booking page says, for a reader that runs no
 * JavaScript: Google's business-link crawler and the Actions Center reviewer.
 *
 * Google's merchant-page checks want the facts a customer needs before booking,
 * on the page itself: the salon's real hours (not "open 7 days a week"), every
 * price as the final price (never a bare "$0"), the cancellation rule, and who
 * runs the booking page. Kept pure so each sentence is tested.
 */

export interface SeoHours { day: number; closed: boolean; open: string; close: string; intervals?: { open: string; close: string }[] }
export interface SeoPolicy { selfCancel: boolean; cancelNoticeHours: number | null }

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The đồng shop reads a 24-hour clock; everywhere else we serve reads 9:30 AM. */
export function uses12h(currency: string | null | undefined): boolean {
  return String(currency || 'USD').toUpperCase() !== 'VND';
}

/** "09:30" -> "9:30 AM" (or "09:30" on a 24-hour clock). Anything odd is shown as given. */
export function clock(hhmm: string, h12: boolean): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return String(hhmm || '');
  const h = Number(m[1]) % 24;
  if (!h12) return `${String(h).padStart(2, '0')}:${m[2]}`;
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** One line per day, Monday first, split shifts joined: "9:30 AM – 1:00 PM, 2:00 PM – 7:00 PM". */
export function hoursRows(hours: SeoHours[] | null | undefined, h12: boolean): { day: string; text: string }[] {
  const byDay = new Map((hours ?? []).filter((h) => h && h.day >= 0 && h.day <= 6).map((h) => [h.day, h]));
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => byDay.has(d)).map((d) => {
    const h = byDay.get(d)!;
    if (h.closed) return { day: DAYS[d], text: 'Closed' };
    const ivs = h.intervals && h.intervals.length ? h.intervals : [{ open: h.open, close: h.close }];
    return { day: DAYS[d], text: ivs.map((iv) => `${clock(iv.open, h12)} – ${clock(iv.close, h12)}`).join(', ') };
  });
}

/** Minor units -> "$49" (the đồng has no sub-unit, so it is never divided). */
export function money(minorUnits: number, currency: string | null | undefined): string {
  const code = currency || 'USD';
  try {
    const nf = new Intl.NumberFormat('en-US', { style: 'currency', currency: code, maximumFractionDigits: 0 });
    const zeroDecimal = new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits === 0;
    return nf.format(zeroDecimal ? minorUnits : minorUnits / 100);
  } catch {
    return `$${Math.round(minorUnits / 100)}`;
  }
}

/**
 * The price as a customer should read it. A bare "$0" looks like a placeholder
 * to a reviewer and like a mistake to a customer: a free add-on says Free, and
 * a "from $0" (the price is set at the chair) says so in words.
 */
export function priceLabel(cents: number | null | undefined, from: boolean, currency: string | null | undefined): string {
  const c = Number(cents) || 0;
  if (c <= 0) return from ? 'Price set at the salon' : 'Free';
  return `${from ? 'from ' : ''}${money(c, currency)}`;
}

/** The salon's own cancellation rule, in one sentence. */
export function cancelLine(policy: SeoPolicy | null | undefined, phone: string | null | undefined): string {
  if (policy?.selfCancel) {
    const h = Number(policy.cancelNoticeHours) || 0;
    return h > 0
      ? `You can cancel or reschedule online up to ${h} hour${h === 1 ? '' : 's'} before your appointment, using the link in your confirmation.`
      : 'You can cancel or reschedule online using the link in your confirmation.';
  }
  return phone ? `To cancel or reschedule, call the salon at ${phone}.` : 'To cancel or reschedule, contact the salon.';
}
