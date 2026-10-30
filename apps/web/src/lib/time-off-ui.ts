/** Nghỉ phép — the small pure bits both the owner's panel and the technician's page show. */

export interface TimeOffSpan { startDate: string; endDate: string; startTime: string | null; endTime: string | null }

/** "T4 14/10" / "14/10 → 16/10" / "14/10 · 13:00–17:00". */
export function whenLabel(r: TimeOffSpan, vi: boolean): string {
  const d = (k: string) => new Date(`${k}T12:00:00Z`).toLocaleDateString(vi ? 'vi-VN' : 'en-US', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });
  if (r.startTime && r.endTime) return `${d(r.startDate)} · ${r.startTime}–${r.endTime}`;
  if (r.startDate === r.endDate) return d(r.startDate);
  return `${d(r.startDate)} → ${d(r.endDate)}`;
}

/** How many days a request takes (a part of a day counts as 0.5). */
export function daysOf(r: TimeOffSpan): number {
  if (r.startTime && r.endTime) return 0.5;
  return Math.round((Date.parse(`${r.endDate}T12:00:00Z`) - Date.parse(`${r.startDate}T12:00:00Z`)) / 86_400_000) + 1;
}

/** The one sentence the desk reads when the engine found nobody and some were on leave. */
export function leaveReason(onShift: number, onLeave: number | undefined, vi: boolean): string | null {
  if (onShift !== 0 || !onLeave) return null;
  return vi
    ? `Thợ làm được đang nghỉ phép hôm đó (${onLeave} người). Xem Ngày nghỉ trên trang Thợ.`
    : `The technicians who could do it are on leave that day (${onLeave}). See Time off on the Staff page.`;
}

const VI_DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const EN_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const VI_DOW_LONG = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const EN_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The calendar tile on each card: "T7" / "31" / "Th10". Salon day keys, no timezone maths. */
export function dateTile(day: string, vi: boolean): { dow: string; day: string; month: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return { dow: '', day: '', month: '' };
  const wd = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return { dow: vi ? VI_DOW[wd] : EN_DOW[wd], day: String(Number(m[3])), month: vi ? `Th${Number(m[2])}` : EN_MON[Number(m[2]) - 1] };
}

/** The sentence a person reads: "Thứ Bảy 31/10 · 13:00–16:00", "31/10 → 2/11 (3 ngày)". */
export function spanSentence(r: TimeOffSpan, vi: boolean): string {
  const one = (k: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k);
    if (!m) return k;
    const wd = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
    return vi ? `${VI_DOW_LONG[wd]} ${Number(m[3])}/${Number(m[2])}` : `${EN_DOW[wd]} ${Number(m[2])}/${Number(m[3])}`;
  };
  if (r.startTime && r.endTime) return `${one(r.startDate)} · ${r.startTime}–${r.endTime}`;
  if (r.startDate === r.endDate) return `${one(r.startDate)} · ${vi ? 'cả ngày' : 'all day'}`;
  const n = daysOf(r);
  return `${one(r.startDate)} → ${one(r.endDate)} (${n} ${vi ? 'ngày' : 'days'})`;
}

/** Off today (the card says "Đang nghỉ"), later ("Sắp tới") or already over. */
export function phaseOf(r: TimeOffSpan, today: string): 'now' | 'later' | 'past' {
  if (!today) return 'later';
  if (r.endDate < today) return 'past';
  if (r.startDate <= today) return 'now';
  return 'later';
}

/** The form's kind from a stored row: hours, one day or several. */
export function kindOf(r: TimeOffSpan): 'hours' | 'day' | 'days' {
  if (r.startTime && r.endTime) return 'hours';
  return r.startDate === r.endDate ? 'day' : 'days';
}

/** "YYYY-MM-DD" plus n days. */
export function addDaysKey(day: string, n: number): string {
  const t = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(t.getTime())) return day;
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
