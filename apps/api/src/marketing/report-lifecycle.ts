/**
 * WHERE A MONTH'S REPORT STANDS — pure.
 *
 *   collecting  the month is still running (the screen shows "to date")
 *   closing     the month ended ≤ 3 days ago; the last numbers are still being read
 *   draft       a draft exists and waits for a person ('review')
 *   approved    a person approved it; it can be sent
 *   sent        the client has it; the text is locked
 *   none        the month ended, nothing drafted (inactive salon, or drafting failed)
 *
 * And the agency's send policy per salon: send by hand (default), or send by
 * itself on day N of the next month when nobody objected.
 */

export type LifecycleState = 'collecting' | 'closing' | 'draft' | 'approved' | 'sent' | 'none';

export interface ReportPolicy {
  /** Send the month's report to the salon without a person pressing Send. */
  autoSend: boolean;
  /** Day of the next month on which the auto-send goes out (2–28). */
  sendDay: number;
  /** Extra recipients the salon wants copied (besides its admins). */
  extraRecipients: string[];
}

export const DEFAULT_REPORT_POLICY: ReportPolicy = { autoSend: false, sendDay: 5, extraRecipients: [] };
export const REPORT_POLICY_KEY = 'marketing_report_policy';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function cleanReportPolicy(input: unknown, cur: ReportPolicy = DEFAULT_REPORT_POLICY): ReportPolicy {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const dayRaw = Number(o.sendDay);
  return {
    autoSend: typeof o.autoSend === 'boolean' ? o.autoSend : cur.autoSend,
    sendDay: Number.isInteger(dayRaw) && dayRaw >= 2 && dayRaw <= 28 ? dayRaw : cur.sendDay,
    extraRecipients: Array.isArray(o.extraRecipients)
      ? [...new Set(o.extraRecipients.map((e) => String(e).trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)))].slice(0, 5)
      : cur.extraRecipients,
  };
}

export interface ReportLike { status: string; sentAt?: Date | string | null }

/** 'YYYY-MM' → the first day of the next month, as a date key. */
function nextMonthKey(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Days from the month's end to `todayKey` (1 on the first day after). ≤ 0 while the month runs. */
export function daysAfterMonth(month: string, todayKey: string): number {
  const next = nextMonthKey(month);
  const a = Date.UTC(Number(next.slice(0, 4)), Number(next.slice(5, 7)) - 1, 1);
  const b = Date.UTC(Number(todayKey.slice(0, 4)), Number(todayKey.slice(5, 7)) - 1, Number(todayKey.slice(8, 10)));
  return Math.round((b - a) / 86_400_000) + 1;
}

export function lifecycleOf(month: string, report: ReportLike | null | undefined, todayKey: string): LifecycleState {
  if (report) {
    if (report.status === 'sent' || report.sentAt) return 'sent';
    if (report.status === 'approved') return 'approved';
    return 'draft';
  }
  const after = daysAfterMonth(month, todayKey);
  if (after <= 0) return 'collecting';
  if (after <= 3) return 'closing';
  return 'none';
}

/**
 * Is today the day the policy sends this month's report by itself?
 * On or after sendDay of the next month, a draft or approved report that was
 * never sent goes out. A month older than one is never auto-sent — a report
 * nobody sent for two months is a decision, not a backlog.
 */
export function autoSendDue(month: string, report: ReportLike | null | undefined, policy: ReportPolicy, todayKey: string): boolean {
  if (!policy.autoSend || !report) return false;
  if (report.status === 'sent' || report.sentAt) return false;
  const after = daysAfterMonth(month, todayKey);
  return after >= policy.sendDay && after <= 31 + policy.sendDay;
}

/** The one thing to do next, as a key the UI translates. */
export function nextActionOf(state: LifecycleState, policy: ReportPolicy): 'wait' | 'closing' | 'review' | 'send' | 'auto-send' | 'done' | 'generate' {
  switch (state) {
    case 'collecting': return 'wait';
    case 'closing': return 'closing';
    case 'draft': return policy.autoSend ? 'auto-send' : 'review';
    case 'approved': return policy.autoSend ? 'auto-send' : 'send';
    case 'sent': return 'done';
    case 'none': return 'generate';
  }
}
