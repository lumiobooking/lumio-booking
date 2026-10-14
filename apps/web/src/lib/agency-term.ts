/**
 * How the agency list reads a salon's service term (api/src/support/service-term.ts).
 *
 * The server stores calendar days; everything about "today" is decided here,
 * on the viewer's own calendar, so a row turns amber on the morning it should
 * for the person looking at it.
 */

export interface RenewMark {
  state: 'told' | 'renewed';
  by: string | null;
  at: string;
  note?: string;
  forEnd?: string;
  renewedTo?: string;
  prevEnd?: string;
  months?: number;
}
export interface ServiceTerm {
  start: string | null;
  end: string;
  months: number | null;
  alertDays: number;
  renew: RenewMark | null;
}

export type TermState = 'expired' | 'soon' | 'ok' | 'none';
/** Where this cycle's renewal stands. 'untold' = nobody has passed it on yet. */
export type RenewState = 'untold' | 'told' | 'renewed';

export const DEFAULT_ALERT_DAYS = 14;
export const TERM_ORDER: TermState[] = ['expired', 'soon', 'ok', 'none'];

/** The viewer's calendar day, YYYY-MM-DD. */
export function todayKey(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

function utc(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
/** Whole days from a to b (b − a). */
export function dayDiff(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}

/** Same rule as the server: 31 Jan + 1 month = end of February. */
export function addMonthsDay(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const mo = m - 1 + months;
  const ty = y + Math.floor(mo / 12); const tm = ((mo % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ty, tm, Math.min(d, last))).toISOString().slice(0, 10);
}

/** A calendar day moved by n days. */
export function addDays(day: string, n: number): string {
  return new Date(utc(day) + n * 86_400_000).toISOString().slice(0, 10);
}

/** "19/10" this year, "19/10/2027" otherwise (or always, with `year`). */
export function fmtDay(day: string, today?: string, year = false): string {
  const [y, m, d] = day.split('-');
  const sameYear = today ? today.slice(0, 4) === y : false;
  return year || !sameYear ? `${d}/${m}/${y}` : `${d}/${m}`;
}

export interface TermStatus {
  state: TermState;
  /** Days until the end (negative once past it); null without a term. */
  daysLeft: number | null;
  end: string | null;
  alertDays: number;
}

/**
 * The end day itself still counts as service: "còn 0 ngày" is the last day,
 * "hết hạn 1 ngày" the day after.
 */
export function termStatus(term: ServiceTerm | null | undefined, today: string): TermStatus {
  if (!term?.end) return { state: 'none', daysLeft: null, end: null, alertDays: DEFAULT_ALERT_DAYS };
  const alertDays = term.alertDays || DEFAULT_ALERT_DAYS;
  const daysLeft = dayDiff(today, term.end);
  const state: TermState = daysLeft < 0 ? 'expired' : daysLeft <= alertDays ? 'soon' : 'ok';
  return { state, daysLeft, end: term.end, alertDays };
}

/** A mark only counts for the cycle it was made in — see the server's note. */
export function renewState(term: ServiceTerm | null | undefined): RenewState {
  const r = term?.renew;
  if (!term || !r) return 'untold';
  if (r.state === 'told' && r.forEnd === term.end) return 'told';
  if (r.state === 'renewed' && r.renewedTo === term.end) return 'renewed';
  return 'untold';
}

/** Expired or about to, and nobody has passed it on: the rows someone must act on. */
export function needsRenewal(term: ServiceTerm | null | undefined, today: string): boolean {
  const s = termStatus(term, today).state;
  return (s === 'expired' || s === 'soon') && renewState(term) === 'untold';
}

/** Renewed during the viewer's current month. */
export function renewedThisMonth(term: ServiceTerm | null | undefined, today: string): boolean {
  if (renewState(term) !== 'renewed' || !term?.renew?.at) return false;
  const at = new Date(term.renew.at);
  return todayKey(at).slice(0, 7) === today.slice(0, 7);
}

/** Where a salon sits in the "Gia hạn" view, or null when it does not belong there. */
export function renewBucket(term: ServiceTerm | null | undefined, today: string): RenewState | null {
  const s = termStatus(term, today).state;
  const r = renewState(term);
  if (r === 'renewed') return renewedThisMonth(term, today) ? 'renewed' : null;
  if (s === 'expired' || s === 'soon') return r;
  return null;
}

/** How far through the term today is, 0..1 — the bar in the detail panel. Null without a start. */
export function termProgress(term: ServiceTerm | null | undefined, today: string): number | null {
  if (!term?.start || !term.end) return null;
  const total = dayDiff(term.start, term.end);
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, dayDiff(term.start, today) / total));
}

/** "lan@lumio.vn" → "lan": the name the team uses for each other. */
export function whoShort(email: string | null | undefined): string {
  if (!email) return '';
  return email.split('@')[0];
}

/** One short phrase for the term, as the row prints it. */
export function termPhrase(st: TermStatus, today: string): string {
  if (st.state === 'none' || st.end === null || st.daysLeft === null) return 'Chưa có thời hạn';
  if (st.state === 'expired') return `Hết hạn ${-st.daysLeft} ngày`;
  if (st.state === 'soon') return st.daysLeft === 0 ? 'Hết hạn hôm nay' : `Còn ${st.daysLeft} ngày`;
  return `Đến ${fmtDay(st.end, today)}`;
}
