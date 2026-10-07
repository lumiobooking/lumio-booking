/**
 * RECALL — "time for your check-up", and the right words for every trade.
 *
 * The rebooking reminder was written for nails: "your nails are probably
 * ready for a refresh 💅" — sent, unchanged, to a dental clinic's patients.
 * Now:
 *   - a patient whose record says "recall every N months" (DENTAL record,
 *     common/industry-fields) is reminded N months after the last visit,
 *     with check-up wording;
 *   - every other trade that is not a nail salon gets neutral "time for your
 *     next visit" wording;
 *   - nail salons keep exactly the message they have today.
 * Pure.
 */

const DAY = 86_400_000;
const MONTH_DAYS = 30.44;

/** Is a recall due? N months after the last visit, once per visit, never with a visit already booked. */
export function recallDue(o: { lastVisitEnd: Date; months: number; remindedAt: Date | null; hasUpcoming: boolean; now: Date }): boolean {
  if (!Number.isFinite(o.months) || o.months < 1 || o.months > 60) return false;
  if (o.hasUpcoming) return false;
  if (o.remindedAt && o.remindedAt.getTime() >= o.lastVisitEnd.getTime()) return false; // already reminded for this visit
  return o.now.getTime() >= o.lastVisitEnd.getTime() + Math.round(o.months * MONTH_DAYS) * DAY;
}

/** The months on a customer's record, or null. */
export function recallMonthsOf(industryFields: unknown): number | null {
  const v = Number((industryFields as { recallMonths?: unknown } | null)?.recallMonths);
  return Number.isFinite(v) && v >= 1 && v <= 60 ? Math.round(v) : null;
}

export interface RebookCopy { subject: string; headline: string; tagline: string; body: string; button: string; text: string; sms: string }

/** The words of the reminder, per trade. NAIL returns null = keep the original nail message. */
export function rebookCopy(industry: string, o: { salon: string; cust: string; service: string | null; months: number | null; url: string }): RebookCopy | null {
  const k = String(industry || 'NAIL').toUpperCase();
  if (k === 'NAIL') return null;
  if (k === 'DENTAL') {
    const since = o.months ? `${o.months} months` : 'a while';
    return {
      subject: `${o.cust}, time for your check-up 🦷`,
      headline: `Hi ${o.cust}, it's check-up time`,
      tagline: 'Your regular visit is due',
      body: `It's been ${since} since your last visit — time for your regular check-up and cleaning. Pick a time that suits you in a few taps.`,
      button: 'Book my check-up',
      text: `Hi ${o.cust}! It's been ${since} since your last visit to ${o.salon} — time for your regular check-up. Book here: ${o.url}`,
      sms: `${o.salon}: Hi ${o.cust}, your check-up is due. Book in a few taps: ${o.url} Reply STOP to opt out.`,
    };
  }
  const svc = o.service ? ` for another ${o.service}` : '';
  return {
    subject: `${o.cust}, ready for your next visit?`,
    headline: `Hi ${o.cust}, it's been a little while!`,
    tagline: 'We would love to see you again',
    body: `It may be time for your next visit${svc}. Book in a few taps — we look forward to seeing you.`,
    button: 'Book my next visit',
    text: `Hi ${o.cust}! It may be time for your next visit${svc} at ${o.salon}. Book here: ${o.url}`,
    sms: `${o.salon}: Hi ${o.cust}! Ready for your next visit? Book in a few taps: ${o.url} Reply STOP to opt out.`,
  };
}
