/**
 * ĐẾN HẠN TÁI KHÁM — a dental clinic's recall list for the front desk.
 *
 * Every patient whose record says "recall every N months" and whose last
 * finished visit + N months has come (or comes within the next 14 days),
 * with no visit already booked. Most overdue first. The automatic reminder
 * (bookings/recall.ts) still runs when the clinic turned it on; this list
 * is for the patients a phone call brings back. "Đã liên hệ" hides a patient
 * for 14 days. Pure.
 */
const DAY = 86_400_000;
const MONTH_DAYS = 30.44;
export const SOON_DAYS = 14;
export const CONTACTED_KEY = 'recall_contacted';
export const HIDE_AFTER_CONTACT_DAYS = 14;

export interface RecallRow { id: string; name: string; phone: string | null; months: number; lastVisitEnd: Date | null; hasUpcoming: boolean; remindedAt: Date | null }
export interface RecallItem { id: string; name: string; phone: string | null; months: number; lastVisit: string; dueDate: string; overdueDays: number; autoReminded: boolean }

export function recallList(rows: RecallRow[], now: Date, contacted: Record<string, string> = {}): RecallItem[] {
  const out: RecallItem[] = [];
  for (const r of rows) {
    if (!r.lastVisitEnd || r.hasUpcoming) continue;
    if (!Number.isFinite(r.months) || r.months < 1 || r.months > 60) continue;
    const due = r.lastVisitEnd.getTime() + Math.round(r.months * MONTH_DAYS) * DAY;
    if (due > now.getTime() + SOON_DAYS * DAY) continue;
    const c = contacted[r.id] ? Date.parse(contacted[r.id]) : NaN;
    if (Number.isFinite(c) && now.getTime() - c < HIDE_AFTER_CONTACT_DAYS * DAY) continue;
    out.push({
      id: r.id, name: r.name, phone: r.phone, months: r.months,
      lastVisit: r.lastVisitEnd.toISOString(), dueDate: new Date(due).toISOString(),
      overdueDays: Math.floor((now.getTime() - due) / DAY),
      autoReminded: !!r.remindedAt && r.remindedAt.getTime() >= r.lastVisitEnd.getTime(),
    });
  }
  return out.sort((a, b) => b.overdueDays - a.overdueDays || a.name.localeCompare(b.name));
}

/** Keep the "contacted" map small: drop entries older than the hide window. */
export function pruneContacted(map: unknown, now: Date): Record<string, string> {
  const o = (map && typeof map === 'object' && !Array.isArray(map) ? map : {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    const t = typeof v === 'string' ? Date.parse(v) : NaN;
    if (Number.isFinite(t) && now.getTime() - t < HIDE_AFTER_CONTACT_DAYS * DAY) out[k] = v as string;
  }
  return out;
}
