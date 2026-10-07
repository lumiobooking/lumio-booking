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
