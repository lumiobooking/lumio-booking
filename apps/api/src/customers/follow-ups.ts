/**
 * "CẦN GỌI LẠI" — a real-estate office's follow-ups.
 *
 * A lead's record carries "Hẹn liên hệ lại" (industryFields.nextStep, a
 * YYYY-MM-DD in the office's own calendar). Every lead whose date has come —
 * today or overdue — and who is not closed (won / lost) is on the list, most
 * overdue first; the team gets one morning push with the count. Pure.
 */

export interface LeadRow { id: string; firstName: string; lastName: string | null; phone: string | null; industryFields: unknown }
export interface FollowUp { id: string; name: string; phone: string | null; stage: string | null; nextStep: string; overdueDays: number }

const CLOSED = new Set(['won', 'lost']);

/** "Today" in the office's timezone, as YYYY-MM-DD. */
export function todayIn(tz: string | null | undefined, now = new Date()): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
  catch { return now.toISOString().slice(0, 10); }
}

const days = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

export function dueFollowUps(rows: LeadRow[], today: string): FollowUp[] {
  const out: FollowUp[] = [];
  for (const r of rows) {
    const f = (r.industryFields && typeof r.industryFields === 'object' ? r.industryFields : {}) as Record<string, unknown>;
    const next = String(f.nextStep ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || next > today) continue;
    const stage = f.stage ? String(f.stage) : null;
    if (stage && CLOSED.has(stage)) continue;
    out.push({ id: r.id, name: `${r.firstName}${r.lastName ? ' ' + r.lastName : ''}`.trim(), phone: r.phone, stage, nextStep: next, overdueDays: days(today, next) });
  }
  return out.sort((a, b) => b.overdueDays - a.overdueDays || a.name.localeCompare(b.name));
}

/** The morning push, or null when there is nothing to call. */
export function followUpPush(list: FollowUp[], vi: boolean): { title: string; body: string } | null {
  if (!list.length) return null;
  const late = list.filter((x) => x.overdueDays > 0).length;
  const names = list.slice(0, 3).map((x) => x.name).join(', ') + (list.length > 3 ? '…' : '');
  return vi
    ? { title: `📞 ${list.length} khách cần gọi lại hôm nay`, body: `${names}${late ? ` · ${late} đã quá hạn` : ''}` }
    : { title: `📞 ${list.length} lead${list.length > 1 ? 's' : ''} to call today`, body: `${names}${late ? ` · ${late} overdue` : ''}` };
}
